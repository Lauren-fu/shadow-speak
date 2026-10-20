import test from "node:test";
import assert from "node:assert/strict";
import { VoiceRecorder } from "../voice-recorder.mjs";
import { PageRecorder } from "../page-recorder.mjs";
import { attachPageRecorder } from "../page-recorder-host.mjs";
import { encodeTake, decodeTake } from "../voice-codec.mjs";
import { portPair } from "./port-harness.mjs";

function harness({ denied = false, neverConnect = false, startupTimeoutMs = 1000 } = {}) {
  let grant, requested, calls = 0, stopped = 0, tick, time = 0, level = 0, paused = 0;
  const asked = new Promise(resolve => { requested = resolve; });
  const stream = { getTracks: () => [{ stop() { stopped++; } }] };
  const permission = new Promise(resolve => { grant = () => resolve(stream); });
  class AudioContext {
    state = "running";
    async resume() {} async close() {}
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() { return { fftSize: 2048, getFloatTimeDomainData(array) { array.fill(level); }, disconnect() {} }; }
  }
  class MediaRecorder {
    static isTypeSupported() { return true; }
    constructor() { this.state = "inactive"; this.mimeType = "audio/webm"; }
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive";
      queueMicrotask(() => { this.ondataavailable({ data: new Blob([Uint8Array.of(0, 255, 42, 91)]) }); this.onstop(); });
    }
  }
  const recorder = new VoiceRecorder({
    mediaDevices: { getUserMedia() {
      calls++; requested();
      return denied ? Promise.reject(new DOMException("Denied", "NotAllowedError")) : permission;
    } },
    AudioContextClass: AudioContext, MediaRecorderClass: MediaRecorder,
    now: () => time, setIntervalImpl(fn) { tick = fn; return 1; }, clearIntervalImpl() { tick = null; }
  });
  let video = "test-video", host;
  const pair = portPair();
  if (!neverConnect) host = attachPageRecorder(pair.page, { recorder, currentVideo: () => video, pauseVideo() { paused++; } });
  const client = new PageRecorder({ connect: () => pair.panel, videoId: () => "test-video", startupTimeoutMs });
  return {
    client, recorder, asked, grant, pair, host,
    setVideo(value) { video = value; },
    tick(at, volume) { time = at; level = volume; tick?.(); },
    get calls() { return calls; }, get stopped() { return stopped; }, get paused() { return paused; }
  };
}

test("Record requests permission once and Allow immediately starts that same take", async () => {
  const h = harness();
  const states = []; let take;
  const starting = h.client.start({ onState: state => states.push(state), onComplete: blob => { take = blob; } });
  await h.asked;
  assert.equal(h.client.busy, true);
  assert.equal(h.client.recording, false);
  assert.equal(h.paused, 1);
  h.grant();
  await starting;
  assert.equal(h.calls, 1);
  assert.equal(h.client.recording, true);
  assert.ok(states.includes("recording"));
  await h.client.stop();
  assert.deepEqual(new Uint8Array(await take.arrayBuffer()), Uint8Array.of(0, 255, 42, 91));
  assert.equal(h.stopped, 1);
  assert.equal(h.client.busy, false);
});

test("silence automatically saves a take through the page-to-panel connection", async () => {
  const h = harness(); let complete;
  const done = new Promise(resolve => { complete = resolve; });
  const starting = h.client.start({ onComplete: (blob, reason) => complete({ blob, reason }) });
  await h.asked; h.grant(); await starting;
  for (const at of [50, 100, 150, 200]) h.tick(at, 0.1);
  h.tick(1400, 0);
  const result = await done;
  assert.equal(result.reason, "silence");
  assert.equal(result.blob.size, 4);
  assert.equal(h.stopped, 1);
  assert.equal(h.client.busy, false);
});

test("Cancel during the native prompt unlocks the panel and discards a late Allow", async () => {
  const h = harness(); let takes = 0;
  const starting = h.client.start({ onComplete: () => takes++ });
  await h.asked;
  await h.client.stop();
  await starting;
  assert.equal(h.client.busy, false);
  h.grant(); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.stopped, 1);
  assert.equal(takes, 0);
});

test("denied site permission shows a YouTube permission error and releases controls", async () => {
  const h = harness({ denied: true }); let error;
  await h.client.start({ onError: value => { error = value; } });
  assert.match(error.message, /YouTube/);
  assert.equal(h.client.busy, false);
  assert.equal(h.recorder.busy, false);
});

test("closing the panel releases the page microphone and cancels recording", async () => {
  const h = harness(); let takes = 0, error;
  const starting = h.client.start({ onComplete: () => takes++, onError: value => { error = value; } });
  await h.asked; h.grant(); await starting;
  h.pair.panel.disconnect();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.recorder.busy, false);
  assert.equal(h.stopped, 1);
  assert.equal(takes, 0);
  assert.match(error.message, /disconnected/);
});

test("navigation discards an active take and stale video requests never open the microphone", async () => {
  const h = harness(); let error;
  const starting = h.client.start({ onError: value => { error = value; } });
  await h.asked; h.grant(); await starting;
  h.host.cancel();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.recorder.busy, false);
  assert.equal(h.stopped, 1);
  assert.match(error.message, /video changed/);
  const stale = harness(); stale.setVideo("other");
  await stale.client.start({ onError: value => { error = value; } });
  assert.match(error.message, /video changed/);
  assert.equal(stale.calls, 0);
});

test("an absent page connection times out instead of leaving recording controls locked", async () => {
  const h = harness({ neverConnect: true, startupTimeoutMs: 10 }); let error;
  await h.client.start({ onError: value => { error = value; } });
  assert.match(error.message, /pending/);
  assert.equal(h.client.busy, false);
});

test("audio messages survive Chrome JSON serialization with exact bytes", async () => {
  const source = new Blob([Uint8Array.from({ length: 70000 }, (_, i) => i % 256)], { type: "audio/webm;codecs=opus" });
  const received = decodeTake(JSON.parse(JSON.stringify(await encodeTake(source))));
  assert.equal(received.type, source.type);
  assert.deepEqual(new Uint8Array(await received.arrayBuffer()), new Uint8Array(await source.arrayBuffer()));
  assert.throws(() => decodeTake({ base64: "", mimeType: "text/html" }), /could not be received/);
});
