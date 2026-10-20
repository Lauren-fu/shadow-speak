import { decodeTake } from "./voice-codec.mjs";

// The panel controls a recorder in the YouTube document through a private port.
export class PageRecorder {
  constructor({ connect, videoId, startupTimeoutMs = 65000, stopTimeoutMs = 7000 }) {
    Object.assign(this, { connect, videoId, startupTimeoutMs, stopTimeoutMs });
    this.session = null;
  }
  get busy() { return Boolean(this.session); }
  get recording() { return ["recording", "recording-manual"].includes(this.session?.state); }

  async start({
    deviceId = "", beforeStart = async () => {}, onState = () => {},
    onInput = () => {}, onLevel = () => {}, onComplete = () => {}, onError = () => {}
  } = {}) {
    if (this.busy) throw new Error("Finish the current recording first.");
    const session = { state: "requesting", onState, onComplete, onError };
    session.done = new Promise(resolve => { session.resolveDone = resolve; });
    session.ready = new Promise(resolve => { session.resolveReady = resolve; });
    this.session = session;
    onState("requesting");
    session.timer = setTimeout(() => this.finish(session, new Error(
      "Microphone permission is still pending. Check the microphone icon beside YouTube's address, then try again."
    )), this.startupTimeoutMs);
    try {
      await Promise.race([beforeStart(), session.done]);
      if (session.finished) return;
      session.port = this.connect();
      session.port.onDisconnect.addListener(() => {
        // Reading lastError prevents Chrome's unchecked-disconnect warning.
        void globalThis.chrome?.runtime?.lastError;
        if (!session.finished) this.finish(session, new Error("Recording disconnected. Refresh YouTube and try again."));
      });
      session.port.onMessage.addListener(message => {
        if (session.finished) return;
        try {
          if (message.type === "state") {
            session.state = message.state;
            if (["recording", "recording-manual"].includes(message.state)) {
              clearTimeout(session.timer);
              session.resolveReady();
            }
            onState(message.state);
          } else if (message.type === "complete") {
            this.finish(session, null, decodeTake(message.take), message.reason, message.signal);
          } else if (message.type === "input") onInput(message.input, message.inputs);
          else if (message.type === "level") onLevel(message.level);
          else if (message.type === "error") this.finish(session, new Error(message.error));
          else if (message.type === "canceled") this.finish(session);
        } catch (error) { this.finish(session, error); }
      });
      session.port.postMessage({ type: "start", id: this.videoId(), deviceId });
      await session.ready;
    } catch (error) { this.finish(session, error); }
  }

  stop({ discard = false } = {}) {
    const session = this.session;
    if (!session) return Promise.resolve();
    session.discard ||= discard;
    if (!session.port) this.finish(session);
    else if (!session.stopping) {
      session.stopping = true;
      session.state = "stopping";
      session.onState("stopping");
      clearTimeout(session.timer);
      session.timer = setTimeout(() => this.finish(session, new Error("Recording could not finish. Please try again.")), this.stopTimeoutMs);
      try { session.port.postMessage({ type: "stop", discard }); }
      catch (error) { this.finish(session, error); }
    } else if (discard) {
      try { session.port.postMessage({ type: "stop", discard: true }); } catch {}
    }
    return session.done;
  }

  finish(session, error, blob, reason, signal) {
    if (session.finished) return;
    session.finished = true;
    clearTimeout(session.timer);
    if (this.session === session) this.session = null;
    try { session.port?.disconnect(); } catch {}
    session.onState("idle");
    if (error) session.onError(error);
    else if (blob && !session.discard) session.onComplete(blob, reason, signal);
    session.resolveReady();
    session.resolveDone();
  }
}
