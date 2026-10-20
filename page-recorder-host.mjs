import { VoiceRecorder } from "./voice-recorder.mjs";
import { encodeTake } from "./voice-codec.mjs";
import { listMicrophones } from "./microphone-inputs.mjs";

// Runs in YouTube's top-level document, in the extension's isolated world.
// The browser can present its normal site permission prompt here.
export function attachPageRecorder(port, {
  recorder = new VoiceRecorder({ startupTimeoutMs: 60000 }),
  currentVideo = () => new URL(location.href).searchParams.get("v"),
  pauseVideo = () => document.querySelector("#movie_player video.html5-main-video")?.pause()
} = {}) {
  let connected = true, started = false, terminal = false, completing = false;
  const send = message => {
    if (!connected) return;
    try { port.postMessage(message); }
    catch { connected = false; void recorder.stop({ discard: true }); }
  };
  const fail = error => {
    if (terminal) return;
    terminal = true;
    send({ type: "error", error: error.message });
  };
  port.onDisconnect.addListener(() => {
    connected = false;
    void recorder.stop({ discard: true });
  });
  port.onMessage.addListener(message => {
    if (!connected || terminal) return;
    if (message?.type === "start") {
      if (started) return;
      started = true;
      if (!message.id || message.id !== currentVideo()) {
        fail(new Error("The video changed. Load its transcript again."));
        return;
      }
      void recorder.start({
        deviceId: typeof message.deviceId === "string" ? message.deviceId : "",
        beforeStart: async () => {
          if (message.id !== currentVideo()) throw new Error("The video changed. Choose a sentence again.");
          pauseVideo();
        },
        onState: state => { if (state !== "idle") send({ type: "state", state }); },
        onInput: input => {
          send({ type: "input", input });
          void listMicrophones().then(inputs => send({ type: "input", input, inputs })).catch(() => {});
        },
        onLevel: level => send({ type: "level", level }),
        onComplete: async (blob, reason, signal) => {
          completing = true;
          try {
            const take = await encodeTake(blob);
            if (connected && !terminal) {
              terminal = true;
              send({ type: "complete", take, reason, signal });
            }
          } catch (error) { fail(error); }
        },
        onError: fail
      }).catch(fail);
    } else if (message?.type === "stop") {
      void recorder.stop({ discard: Boolean(message.discard) }).then(() => {
        if (!completing && !terminal) {
          terminal = true;
          send({ type: "canceled" });
        }
      }).catch(fail);
    }
  });
  return {
    cancel(message = "The video changed. Choose a sentence again.") {
      fail(new Error(message));
      connected = false;
      void recorder.stop({ discard: true });
      // Let the error reach the panel; it closes the port after receiving it.
      // Disconnecting here could drop the just-posted navigation message.
    }
  };
}
