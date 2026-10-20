import test from "node:test";
import assert from "node:assert/strict";
import { PageRecorder } from "../page-recorder.mjs";
import { portPair } from "./port-harness.mjs";

test("packaged recorder handles strict browser timers and blocked runtime module loads", async t => {
  const originalSet = globalThis.setInterval, originalClear = globalThis.clearInterval;
  globalThis.setInterval = function (...args) {
    if (this !== globalThis) throw new TypeError("Illegal invocation");
    return originalSet(...args);
  };
  globalThis.clearInterval = function (...args) {
    if (this !== globalThis) throw new TypeError("Illegal invocation");
    return originalClear(...args);
  };
  t.after(() => { globalThis.setInterval = originalSet; globalThis.clearInterval = originalClear; });
  let connectListener, messageListener, requested, allow, calls = 0, stopped = 0, paused = 0, take, constraints;
  const asked = new Promise(resolve => { requested = resolve; });
  const permission = new Promise(resolve => { allow = resolve; });
  globalThis.location = { href: "https://www.youtube.com/watch?v=test-video" };
  globalThis.document = {
    addEventListener() {},
    querySelector() { return { pause() { paused++; } }; }
  };
  globalThis.window = { addEventListener() {} };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    mediaDevices: {
      getUserMedia(value) { constraints = value; calls++; requested(); return permission; },
      async enumerateDevices() { return [{ kind: "audioinput", deviceId: "built-in", label: "MacBook Microphone" }]; }
    }
  } });
  globalThis.AudioContext = class {
    state = "running";
    async resume() {} async close() {}
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() { return { fftSize: 2048, getFloatTimeDomainData(array) { array.fill(0); }, disconnect() {} }; }
  };
  globalThis.MediaRecorder = class {
    static isTypeSupported() { return true; }
    constructor() { this.state = "inactive"; this.mimeType = "audio/webm"; }
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive";
      queueMicrotask(() => { this.ondataavailable({ data: new Blob(["recorded speech"]) }); this.onstop(); });
    }
  };
  globalThis.chrome = { runtime: {
    id: "shadow-speak-test",
    getURL() { throw new Error("Runtime module loads are blocked in this browser"); },
    onMessage: { addListener(fn) { messageListener = fn; } },
    onConnect: { addListener(fn) { connectListener = fn; } }
  } };
  await import("../recording-content.js");
  const inputs = await new Promise(resolve => messageListener({ channel: "shadow-speak-audio", type: "inputs", id: "test-video" }, {}, resolve));
  assert.deepEqual(inputs.inputs, [{ id: "built-in", label: "MacBook Microphone" }]);
  const client = new PageRecorder({
    videoId: () => "test-video",
    connect() {
      const pair = portPair();
      pair.page.name = "shadow-speak-voice-v1";
      pair.page.sender = { id: "shadow-speak-test" };
      connectListener(pair.page);
      return pair.panel;
    }
  });
  const starting = client.start({ deviceId: "built-in", onComplete: blob => { take = blob; } });
  await asked;
  assert.equal(client.recording, false);
  assert.equal(paused, 1);
  assert.deepEqual(constraints.audio.deviceId, { exact: "built-in" });
  allow({ getTracks: () => [{ stop() { stopped++; } }] });
  await starting;
  assert.equal(client.recording, true);
  assert.equal(calls, 1);
  await client.stop();
  assert.equal(await take.text(), "recorded speech");
  assert.equal(stopped, 1);
});
