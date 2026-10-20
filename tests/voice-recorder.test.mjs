import test from "node:test";
import assert from "node:assert/strict";
import { createSilenceDetector, VoiceRecorder } from "../voice-recorder.mjs";

test("silence detector waits for speech then stops after 1.2 seconds of quiet", () => {
  const detector = createSilenceDetector();
  assert.equal(detector.sample(0, 3000), null);
  for (const time of [3050, 3100, 3150, 3200]) assert.equal(detector.sample(0.06, time), null);
  assert.equal(detector.sample(0.001, 4350), null);
  assert.equal(detector.sample(0.001, 4400), "silence");
});
test("short pauses and a single click do not stop recording", () => {
  const detector = createSilenceDetector();
  assert.equal(detector.sample(0.1, 50), null);
  assert.equal(detector.sample(0, 500), null);
  assert.equal(detector.sample(0, 2000), null);
  for (const time of [2050, 2100, 2150]) detector.sample(0.05, time);
  assert.equal(detector.sample(0, 3000), null);
  assert.equal(detector.sample(0.05, 3050), null);
  assert.equal(detector.sample(0, 4000), null);
  assert.equal(detector.sample(0, 4250), "silence");
});
test("no speech and maximum duration have bounded stops", () => {
  assert.equal(createSilenceDetector().sample(0, 10000), "no-speech");
  assert.equal(createSilenceDetector().sample(0.1, 120000), "limit");
});

function harness({ getUserMedia, resume, contextState, startupTimeoutMs, nativeTimers = false, intervalFailure = false } = {}) {
  let now = 0, sample, tracksStopped = 0, contextsClosed = 0, created = 0;
  const stream = { getTracks: () => [{ stop() { tracksStopped++; } }] };
  const analyser = { level: 0, fftSize: 0, getFloatTimeDomainData(array) { array.fill(this.level); }, disconnect() {} };
  class Context {
    state = contextState;
    async resume() { return resume?.(); }
    async close() { contextsClosed++; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() { return analyser; }
  }
  class Recorder {
    static isTypeSupported() { return true; }
    constructor() { created++; this.state = "inactive"; this.mimeType = "audio/webm"; }
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive";
      queueMicrotask(() => {
        this.ondataavailable({ data: new Blob(["voice sample"]) });
        this.onstop();
      });
    }
  }
  const voice = new VoiceRecorder({
    mediaDevices: { getUserMedia: getUserMedia || (async () => stream) },
    AudioContextClass: Context, MediaRecorderClass: Recorder, now: () => now,
    startupTimeoutMs,
    ...(!nativeTimers ? {
      setIntervalImpl(fn) {
        if (intervalFailure) throw new TypeError("Illegal invocation");
        sample = fn; return 1;
      }, clearIntervalImpl() { sample = null; }
    } : {})
  });
  return { voice, stream,
    tick(time, level) { now = time; analyser.level = level; sample?.(); },
    get tracksStopped() { return tracksStopped; }, get contextsClosed() { return contextsClosed; }, get created() { return created; }
  };
}
test("automatic silence stop produces a replayable Blob and releases microphone", async () => {
  const h = harness();
  let blob, reason, paused = false;
  await h.voice.start({
    beforeStart: async () => { paused = true; },
    onComplete: (value, why) => { blob = value; reason = why; }
  });
  assert.equal(paused, true);
  assert.equal(h.voice.recording, true);
  for (const time of [50, 100, 150, 200]) h.tick(time, 0.1);
  h.tick(1400, 0);
  await Promise.resolve();
  assert.equal(h.voice.busy, false);
  assert.equal(reason, "silence");
  assert.equal(await blob.text(), "voice sample");
  assert.equal(h.tracksStopped, 1);
  assert.equal(h.contextsClosed, 1);
});
test("manual stop saves a take and another recording can start", async () => {
  const h = harness(); let takes = 0;
  await h.voice.start({ onComplete: () => takes++ });
  const done = h.voice.stop();
  assert.equal(h.voice.busy, true); // Wait for MediaRecorder's final data.
  await done;
  assert.equal(takes, 1);
  await h.voice.start({ onComplete: () => takes++ });
  await h.voice.stop();
  assert.equal(takes, 2);
});
test("navigation while microphone permission is pending discards and releases the late stream", async () => {
  let resolveMic, prompt;
  const prompted = new Promise(resolve => { prompt = resolve; });
  const h = harness({ getUserMedia: () => { prompt(); return new Promise(resolve => { resolveMic = resolve; }); } });
  let complete = 0;
  const starting = h.voice.start({ onComplete: () => complete++ });
  await prompted;
  await h.voice.stop({ discard: true });
  resolveMic(h.stream);
  await starting;
  assert.equal(h.voice.busy, false);
  assert.equal(h.created, 0);
  assert.equal(h.tracksStopped, 1);
  assert.equal(complete, 0);
});
test("no speech discards silence; denied permission releases audio resources", async () => {
  const h = harness(); let error, takes = 0;
  await h.voice.start({ onComplete: () => takes++, onError: value => { error = value; } });
  h.tick(10000, 0);
  await Promise.resolve();
  assert.match(error.message, /No voice/);
  assert.equal(takes, 0);
  const denied = harness({ getUserMedia: async () => { throw new DOMException("Denied", "NotAllowedError"); } });
  await denied.voice.start({ onError: value => { error = value; } });
  assert.match(error.message, /permission/);
  assert.equal(denied.voice.busy, false);
  assert.equal(denied.contextsClosed, 1);
});

test("suspended Web Audio cannot block recording and manual stop still saves audio", async () => {
  const h = harness({ resume: () => new Promise(() => {}), contextState: "suspended" });
  let blob, state;
  await h.voice.start({ onState: value => { state = value; }, onComplete: value => { blob = value; } });
  assert.equal(h.voice.recording, true);
  h.tick(100, 0);
  assert.equal(state, "recording-manual");
  h.tick(11000, 0); // Suspended analyser must not wrongly report no speech.
  assert.equal(h.voice.recording, true);
  await h.voice.stop();
  assert.equal(await blob.text(), "voice sample");
});

test("microphone timeout unlocks controls and closes a late granted stream", async () => {
  let resolveMic, error;
  const h = harness({ startupTimeoutMs: 10, getUserMedia: () => new Promise(resolve => { resolveMic = resolve; }) });
  await h.voice.start({ onError: value => { error = value; } });
  assert.match(error.message, /timed out/);
  assert.equal(h.voice.busy, false);
  resolveMic(h.stream);
  await Promise.resolve();
  assert.equal(h.tracksStopped, 1);
  assert.equal(h.created, 0);
});

test("Cancel releases pending startup without waiting for permission to settle", async () => {
  const h = harness({ getUserMedia: () => new Promise(() => {}) });
  const starting = h.voice.start();
  await Promise.resolve();
  await h.voice.stop();
  await starting;
  assert.equal(h.voice.busy, false);
  assert.equal(h.created, 0);
});

test("an unresponsive player before recording also times out", async () => {
  const h = harness({ startupTimeoutMs: 10 });
  let error;
  await h.voice.start({ beforeStart: () => new Promise(() => {}), onError: value => { error = value; } });
  assert.match(error.message, /timed out/);
  assert.equal(h.voice.busy, false);
  assert.equal(h.created, 0);
});

test("default browser timers keep their Window receiver (Illegal invocation regression)", async () => {
  const originalSet = globalThis.setInterval, originalClear = globalThis.clearInterval;
  let started = 0, cleared = 0;
  globalThis.setInterval = function (...args) {
    if (this !== globalThis) throw new TypeError("Illegal invocation");
    started++;
    return originalSet(...args);
  };
  globalThis.clearInterval = function (...args) {
    if (this !== globalThis) throw new TypeError("Illegal invocation");
    cleared++;
    return originalClear(...args);
  };
  try {
    const h = harness({ nativeTimers: true });
    let blob;
    await h.voice.start({ onComplete: value => { blob = value; } });
    assert.equal(h.voice.recording, true);
    await h.voice.stop();
    assert.equal(await blob.text(), "voice sample");
    assert.equal(h.voice.busy, false);
    assert.equal(h.tracksStopped, 1);
    assert.equal(started, 1);
    assert.ok(cleared >= 1);
  } finally {
    globalThis.setInterval = originalSet;
    globalThis.clearInterval = originalClear;
  }
});

test("a startup failure after capture begins still stops microphone tracks and recorder", async () => {
  const h = harness({ intervalFailure: true });
  let error, takes = 0;
  await h.voice.start({ onError: value => { error = value; }, onComplete: () => takes++ });
  await Promise.resolve();
  assert.match(error.message, /Illegal invocation/);
  assert.equal(h.voice.busy, false);
  assert.equal(h.voice.recording, false);
  assert.equal(h.tracksStopped, 1);
  assert.equal(h.contextsClosed, 1);
  assert.equal(takes, 0);
});

test("failed interval cleanup cannot prevent microphone release or finishing a take", async () => {
  const h = harness(); let blob;
  await h.voice.start({ onComplete: value => { blob = value; } });
  h.voice.clearIntervalImpl = () => { throw new TypeError("Illegal invocation"); };
  await h.voice.stop();
  assert.equal(h.voice.busy, false);
  assert.equal(h.tracksStopped, 1);
  assert.equal(h.contextsClosed, 1);
  assert.equal(await blob.text(), "voice sample");
});

test("selected microphone is requested exactly and live input levels report measured audio", async () => {
  let constraints, input, level, signal, blob;
  const track = { label: "MacBook Microphone", getSettings: () => ({ deviceId: "built-in" }), stop() {} };
  const h = harness({ getUserMedia: async value => {
    constraints = value;
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  } });
  await h.voice.start({
    deviceId: "built-in", onInput: value => { input = value; }, onLevel: value => { level = value; },
    onComplete: (value, reason, summary) => { blob = value; signal = summary; }
  });
  assert.deepEqual(constraints.audio, { deviceId: { exact: "built-in" } });
  assert.equal(input.label, "MacBook Microphone");
  for (const at of [50, 100, 150, 200]) h.tick(at, 0.006);
  assert.equal(level.available, true);
  assert.ok(level.rms > 0.005);
  h.tick(1400, 0);
  await Promise.resolve();
  assert.equal(signal.input.deviceId, "built-in");
  assert.equal(signal.analyzed, true);
  assert.equal(await blob.text(), "voice sample");
});

test("manual stop of a microphone delivering silence does not offer a blank take", async () => {
  const h = harness(); let takes = 0, error;
  await h.voice.start({ onComplete: () => takes++, onError: value => { error = value; } });
  for (const at of [50, 100, 150, 200]) h.tick(at, 0);
  await h.voice.stop();
  assert.equal(takes, 0);
  assert.match(error.message, /delivered silence/);
  assert.equal(h.tracksStopped, 1);
});
