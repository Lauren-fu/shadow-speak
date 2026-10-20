export function createSilenceDetector({
  startedAt = 0, threshold = 0.004, quietMs = 1200,
  speechMs = 150, noSpeechMs = 10000, maxMs = 120000
} = {}) {
  let previous = startedAt, voicedMs = 0, heardVoice = false, lastVoice = startedAt;
  return {
    sample(level, now) {
      const elapsed = Math.max(0, Math.min(100, now - previous));
      previous = now;
      if (level >= threshold) {
        voicedMs += elapsed;
        lastVoice = now;
        if (voicedMs >= speechMs) heardVoice = true;
      } else if (!heardVoice) voicedMs = 0;
      if (now - startedAt >= maxMs) return "limit";
      if (heardVoice && now - lastVoice >= quietMs) return "silence";
      if (!heardVoice && now - startedAt >= noSpeechMs) return "no-speech";
      return null;
    }
  };
}

export class VoiceRecorder {
  constructor({
    mediaDevices = navigator.mediaDevices, AudioContextClass = globalThis.AudioContext,
    MediaRecorderClass = globalThis.MediaRecorder, now = () => performance.now(),
    // Native Window timers cannot be called as methods of this recorder.
    setIntervalImpl = (...args) => globalThis.setInterval(...args),
    clearIntervalImpl = (...args) => globalThis.clearInterval(...args),
    startupTimeoutMs = 15000
  } = {}) {
    Object.assign(this, { mediaDevices, AudioContextClass, MediaRecorderClass, now, setIntervalImpl, clearIntervalImpl, startupTimeoutMs });
    this.session = null;
  }
  get busy() { return Boolean(this.session); }
  get recording() { return this.session?.recorder?.state === "recording"; }

  async start({
    deviceId = "", beforeStart = async () => {}, onState = () => {},
    onInput = () => {}, onLevel = () => {}, onComplete = () => {}, onError = () => {}
  } = {}) {
    if (this.busy) throw new Error("Finish the current recording first.");
    const session = { chunks: [], onState, onComplete, onError, reason: "manual", peakRms: 0, levelSamples: 0, lastLevelAt: -Infinity };
    session.done = new Promise(resolve => { session.resolve = resolve; });
    this.session = session;
    onState("requesting");
    // A permission prompt or an unresponsive player must never lock the panel.
    const startupTimer = setTimeout(() => this.finish(session, new Error(
      "Microphone setup timed out. Check microphone permission in Chrome, then click Record again."
    )), this.startupTimeoutMs);
    session.startupTimer = startupTimer;
    const canceled = Symbol("canceled");
    const wait = promise => Promise.race([promise, session.done.then(() => canceled)]);
    try {
      // A suspended context can leave resume() pending. Recording does not
      // depend on Web Audio; only the optional silence detector does.
      try {
        session.context = new this.AudioContextClass();
        void session.context.resume().catch(() => {});
      } catch { /* Manual stop still works when Web Audio is unavailable. */ }
      await wait(beforeStart());
      if (session.finished) return;
      const microphone = this.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true
      }).then(stream => {
        if (session.finished) stream.getTracks().forEach(track => track.stop());
        else session.stream = stream;
        return stream;
      });
      const stream = await wait(microphone);
      if (session.finished || stream === canceled) return;
      const track = stream.getAudioTracks?.()[0] || stream.getTracks()[0];
      session.input = {
        deviceId: track?.getSettings?.().deviceId || deviceId,
        label: track?.label || "System default microphone",
        muted: Boolean(track?.muted)
      };
      onInput(session.input);
      track?.addEventListener?.("ended", () => {
        if (!session.finished) this.finish(session, new Error("Microphone disconnected. Choose a microphone and record again."));
      }, { once: true });
      // Active capture may allow Web Audio to start after the permission click.
      try { void session.context?.resume().catch(() => {}); } catch {}
      try {
        session.source = session.context.createMediaStreamSource(stream);
        session.analyser = session.context.createAnalyser();
        session.analyser.fftSize = 2048;
        session.source.connect(session.analyser);
      } catch { /* Keep recording with a manual Stop button. */ }
      const samples = new Float32Array(2048);
      const mimeType = ["audio/webm;codecs=opus", "audio/webm"].find(type => this.MediaRecorderClass.isTypeSupported(type));
      session.recorder = mimeType ? new this.MediaRecorderClass(stream, { mimeType }) : new this.MediaRecorderClass(stream);
      session.recorder.ondataavailable = event => { if (event.data.size) session.chunks.push(event.data); };
      session.recorder.onstop = () => this.finish(session);
      session.recorder.onerror = () => this.finish(session, new Error("Recording failed. Check your microphone and try again."));
      session.recorder.start();
      clearTimeout(startupTimer);
      const startedAt = this.now();
      const detector = createSilenceDetector({ startedAt });
      let manualNotified = false;
      session.interval = this.setIntervalImpl(() => {
        if (session.finished || session.stopping) return;
        if (!session.analyser || (session.context.state && session.context.state !== "running")) {
          if (!manualNotified) { manualNotified = true; onState("recording-manual"); }
          if (this.now() - session.lastLevelAt >= 100) {
            session.lastLevelAt = this.now();
            onLevel({ available: false, rms: 0, peakRms: session.peakRms, elapsed: this.now() - startedAt });
          }
          if (this.now() - startedAt >= 120000) { session.reason = "limit"; void this.stop(); }
          return;
        }
        try { session.analyser.getFloatTimeDomainData(samples); }
        catch { session.analyser = null; return; }
        if (manualNotified) { manualNotified = false; onState("recording"); }
        const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
        session.peakRms = Math.max(session.peakRms, rms);
        session.levelSamples++;
        if (this.now() - session.lastLevelAt >= 100) {
          session.lastLevelAt = this.now();
          onLevel({ available: true, rms, peakRms: session.peakRms, elapsed: this.now() - startedAt });
        }
        const reason = detector.sample(rms, this.now());
        if (reason) {
          session.reason = reason;
          void this.stop({ discard: reason === "no-speech" });
        }
      }, 50);
      onState("recording");
    } catch (error) {
      if (!session.finished) this.finish(session, error);
    }
  }

  stop({ discard = false } = {}) {
    const session = this.session;
    if (!session) return Promise.resolve();
    session.discard ||= discard;
    if (!session.stopping) {
      session.stopping = true;
      session.onState("stopping");
      this.stopSampling(session);
      if (session.recorder?.state === "recording") {
        session.stopTimer = setTimeout(() => this.finish(session, new Error("Recording could not finish. Please try again.")), 5000);
        try { session.recorder.stop(); }
        catch (error) { this.finish(session, error); }
      }
      else if (!session.recorder) this.finish(session);
    }
    return session.done;
  }

  stopSampling(session) {
    const interval = session.interval;
    session.interval = null;
    if (interval == null) return;
    try { this.clearIntervalImpl(interval); }
    catch {
      // Cleanup must continue even if an injected scheduler fails.
      try { globalThis.clearInterval(interval); } catch {}
    }
  }

  finish(session, error) {
    if (session.finished) return;
    session.finished = true;
    clearTimeout(session.startupTimer);
    clearTimeout(session.stopTimer);
    this.stopSampling(session);
    // A failure after MediaRecorder.start() must also end actual capture.
    if (session.recorder?.state === "recording") {
      session.recorder.ondataavailable = () => {};
      session.recorder.onstop = () => {};
      session.recorder.onerror = () => {};
      try { session.recorder.stop(); } catch {}
    }
    session.stream?.getTracks().forEach(track => { try { track.stop(); } catch {} });
    try { session.source?.disconnect(); session.analyser?.disconnect(); } catch {}
    try { void session.context?.close().catch(() => {}); } catch {}
    if (this.session === session) this.session = null;
    session.onState("idle");
    if (error) {
      session.onError(error.name === "NotAllowedError"
        ? new Error("Microphone permission was not granted. Allow the microphone for YouTube using the permissions icon beside its address, then try again.")
        : error.name === "NotFoundError" ? new Error("No microphone was found. Connect a microphone and try again.")
        : error.name === "OverconstrainedError" ? new Error("The selected microphone is unavailable. Choose another microphone and record again.")
        : error.name === "NotReadableError" ? new Error("The microphone could not be opened. Check the selected device and Chrome’s microphone access in system settings.") : error);
    } else if (session.reason === "no-speech") {
      session.onError(new Error("No voice was detected from " + (session.input?.label || "the microphone") + ". Choose your built-in microphone and record again."));
    } else if (!session.discard && session.levelSamples >= 3 && session.peakRms < 0.00005) {
      session.onError(new Error("The microphone delivered silence. Choose your built-in microphone and check that the input level moves while speaking."));
    } else if (!session.discard && session.chunks.length) {
      session.onComplete(new Blob(session.chunks, { type: session.recorder.mimeType }), session.reason, {
        input: session.input, peakRms: session.peakRms, analyzed: session.levelSamples >= 3
      });
    } else if (!session.discard && session.recorder) {
      session.onError(new Error("No audio was captured. Check your microphone and try recording again."));
    }
    session.resolve();
  }
}
