import test from "node:test";
import assert from "node:assert/strict";
import { attachPageRecorder } from "../page-recorder-host.mjs";
import { portPair } from "./port-harness.mjs";

// Execute the real panel module using small DOM/Chrome test doubles. These
// verify UI wiring, not Chrome rendering or live provider availability.
test("panel restores key, loads captions, records and hears each card, caches, and cancels", async t => {
  const nodes = new Map();
  const node = () => ({
    value: "", checked: false, hidden: false, disabled: false, textContent: "", children: [],
    handlers: {}, classes: new Set(), classList: { toggle() {} },
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    addEventListener(name, fn) { this.handlers[name] = fn; },
    pause() {}, async play() {}, load() {}, removeAttribute() {}, setAttribute() {}, focus() {}, scrollIntoView() {}
  });
  globalThis.document = {
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); },
    querySelectorAll() { return []; }, createElement: node, createTextNode: value => value
  };
  const pageEvents = {};
  globalThis.window = { addEventListener(name, fn) { pageEvents[name] = fn; } };
  t.after(() => pageEvents.pagehide?.());
  let microphoneCalls = 0, activate, voiceLevel = 0.04, constraints;
  let pendingMicrophone = null, microphoneEntered = null, stoppedLateTracks = 0;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    mediaDevices: { getUserMedia: async value => {
      constraints = value;
      microphoneCalls++;
      if (pendingMicrophone) { microphoneEntered(); return pendingMicrophone; }
      return { getTracks: () => [{ label: "MacBook Microphone", getSettings: () => ({ deviceId: "built-in" }), stop() {} }] };
    }, enumerateDevices: async () => [{ kind: "audioinput", deviceId: "built-in", label: "MacBook Microphone" }] }
  } });
  globalThis.AudioContext = class {
    async resume() {} async close() {}
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() { return { fftSize: 2048, getFloatTimeDomainData(array) { array.fill(voiceLevel); }, disconnect() {} }; }
  };
  globalThis.MediaRecorder = class {
    static isTypeSupported() { return true; }
    constructor() { this.state = "inactive"; this.mimeType = "audio/webm"; }
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive";
      queueMicrotask(() => { this.ondataavailable({ data: new Blob(["recording"]) }); this.onstop(); });
    }
  };
  const $ = id => document.getElementById(id);
  $("split-mode").value = "pause"; $("rate").value = "1";
  const bridgeMessages = [];
  let currentVideo = "dQw4w9WgXcQ";
  const saved = { supadataApiKey: "saved-test-key", microphoneDeviceId: "built-in" };
  globalThis.chrome = {
    runtime: { getURL: path => `chrome-extension://test/${path}` },
    storage: { local: {
    async setAccessLevel() {},
    async get(name) { return { [name]: saved[name] }; },
    async set(data) { Object.assign(saved, data); },
    async remove(name) { delete saved[name]; }
  } }, tabs: {
    connect(tabId, options) {
      assert.equal(tabId, 42);
      assert.equal(options.frameId, 0);
      assert.equal(options.name, "shadow-speak-voice-v1");
      const pair = portPair();
      attachPageRecorder(pair.page, { currentVideo: () => currentVideo, pauseVideo() {} });
      return pair.panel;
    },
    query: async () => [{ id: 42 }], // Regression: Chrome does not expose tab.url.
    onActivated: { addListener(fn) { activate = fn; } }, onUpdated: { addListener() {} },
    sendMessage: async (tabId, message) => {
      bridgeMessages.push(message);
      if (message.channel === "shadow-speak-audio") return { ok: true, inputs: [{ id: "built-in", label: "MacBook Microphone" }] };
      return message.type === "info" ? {
        ok: true, id: currentVideo, title: "Test video", supported: true, hasVideo: true
      } : { ok: true };
    }
  } };
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return { ok: true, status: 200, json: async () => ({ lang: "en", content: [
      { offset: 1000, duration: 1500, text: "First sentence." },
      { offset: 3000, duration: 2000, text: "Second sentence." }
    ] }) };
  };
  await import("../panel.mjs");
  // Double-clicking while saved settings are loading must not bill twice.
  await Promise.all([$("cloud-load").handlers.click(), $("cloud-load").handlers.click()]);
  assert.equal($("api-key").value, "saved-test-key");
  assert.equal($("api-setup").hidden, true);
  assert.equal($("change-key").hidden, false);
  $("change-key").handlers.click();
  assert.equal($("api-setup").hidden, false);
  $("api-key").value = "unsaved-edit";
  $("change-key").handlers.click();
  assert.equal($("api-key").value, "saved-test-key");
  assert.equal($("api-setup").hidden, true);
  assert.equal($("phrases").children.length, 2);
  assert.equal($("microphone").value, "built-in");
  await $("microphone").handlers.change();
  assert.equal(saved.microphoneDeviceId, "built-in");
  assert.equal($("cloud-load").disabled, false);
  assert.equal($("cloud-cancel").hidden, true);
  assert.equal(requests, 1);
  assert.ok(!JSON.stringify(bridgeMessages).includes($("api-key").value));
  const firstCard = $("phrases").children[0], secondCard = $("phrases").children[1];
  await firstCard.children[0].handlers.click();
  assert.equal(bridgeMessages.at(-1).type, "play");
  assert.equal(bridgeMessages.at(-1).start, 1);
  assert.equal(bridgeMessages.at(-1).end, 2.5);
  assert.equal(bridgeMessages.at(-1).nextStart, 3);
  $("rate").value = "1.1";
  await $("rate").handlers.input();
  assert.equal($("rate-value").textContent, "1.10×");
  assert.equal(bridgeMessages.at(-1).type, "rate");
  assert.equal(bridgeMessages.at(-1).rate, 1.1);
  const [firstRecord, firstHear] = firstCard.children[1].children;
  const [secondRecord, secondHear] = secondCard.children[1].children;
  assert.equal(firstCard.children[1].children.length, 4);
  assert.equal(firstHear.disabled, true);
  let allowMicrophone;
  pendingMicrophone = new Promise(resolve => { allowMicrophone = resolve; });
  const permissionRequested = new Promise(resolve => { microphoneEntered = resolve; });
  const firstStart = firstRecord.handlers.click();
  await permissionRequested;
  assert.equal(microphoneCalls, 1);
  assert.equal(firstRecord.textContent, "Cancel");
  assert.equal(firstRecord.disabled, false);
  assert.equal(secondRecord.disabled, true);
  assert.equal($("phrases").children.length, 2);
  // A browser Allow response must continue the original click automatically.
  allowMicrophone({ getTracks: () => [{ label: "MacBook Microphone", getSettings: () => ({ deviceId: "built-in" }), stop() {} }] });
  await firstStart;
  pendingMicrophone = null;
  assert.equal(microphoneCalls, 1);
  assert.deepEqual(constraints.audio.deviceId, { exact: "built-in" });
  assert.equal(firstRecord.textContent, "■ Stop");
  assert.equal($("microphone").title, "Using: MacBook Microphone");
  assert.equal($("microphone-status").textContent, "");
  await new Promise(resolve => setTimeout(resolve, 160));
  assert.match(firstCard.children[1].children[3].textContent, /^\d+:\d{2}$/);
  assert.ok(firstCard.children[4].children[0].value > 0);
  assert.equal(firstCard.children[4].children[1].textContent, "");
  assert.equal(secondRecord.disabled, true);
  assert.ok(bridgeMessages.some(message => message.type === "stop"));
  await firstRecord.handlers.click();
  assert.equal(firstCard.children[2].textContent, "Click Hear to listen");
  assert.equal(firstHear.disabled, false);
  assert.equal(secondHear.disabled, true);
  await secondRecord.handlers.click();
  await secondRecord.handlers.click();
  assert.equal(secondHear.disabled, false);
  assert.equal(secondCard.children[2].textContent, "Click Hear to listen");
  $("voice-playback").muted = true;
  $("voice-playback").volume = 0;
  await pageEvents.keydown({ key: "h", preventDefault() {} });
  const firstUrl = $("voice-playback").src;
  assert.ok(firstUrl.startsWith("blob:"));
  assert.equal($("voice-playback").muted, false);
  assert.equal($("voice-playback").volume, 1);
  $("voice-playback").handlers.ended();
  assert.equal(firstCard.children[2].textContent, "Click Hear to listen");
  await secondHear.handlers.click();
  const secondUrl = $("voice-playback").src;
  assert.notEqual(firstUrl, secondUrl);
  $("split-mode").value = "seven";
  await $("split-mode").handlers.change();
  assert.equal($("phrases").children.length, 2, "choosing a mode waits for refresh");
  assert.match($("status").textContent, /re-split/);
  await $("split-refresh").handlers.click();
  assert.equal($("phrases").children.length, 1);
  assert.equal($("phrases").children[0].children[1].children[1].disabled, true);
  assert.equal(requests, 1);
  $("split-mode").value = "pause";
  await $("split-mode").handlers.change();
  await $("split-refresh").handlers.click();
  assert.equal($("phrases").children.length, 2);
  await $("phrases").children[0].children[1].children[1].handlers.click();
  assert.equal($("voice-playback").src, firstUrl);
  await $("phrases").children[1].children[1].children[1].handlers.click();
  assert.equal($("voice-playback").src, secondUrl);
  let resolveMicrophone;
  pendingMicrophone = new Promise(resolve => { resolveMicrophone = resolve; });
  const enteredMicrophone = new Promise(resolve => { microphoneEntered = resolve; });
  const cancelRecord = $("phrases").children[0].children[1].children[0];
  const otherRecord = $("phrases").children[1].children[1].children[0];
  const startingRecording = cancelRecord.handlers.click();
  await enteredMicrophone;
  assert.equal(cancelRecord.textContent, "Cancel");
  assert.equal(cancelRecord.disabled, false);
  assert.equal(otherRecord.disabled, true);
  await cancelRecord.handlers.click();
  await startingRecording;
  assert.equal(otherRecord.disabled, false);
  resolveMicrophone({ getTracks: () => [{ stop() { stoppedLateTracks++; } }] });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(stoppedLateTracks, 1);
  pendingMicrophone = null;
  await $("cloud-load").handlers.click();
  assert.equal(requests, 1);
  assert.equal($("status").textContent, "");
  await $("forget-key").handlers.click();
  assert.equal($("api-key").value, "");
  assert.equal(saved.supadataApiKey, undefined);
  assert.equal($("api-setup").hidden, false);
  assert.equal($("change-key").hidden, true);

  $("api-key").value = "test-key-not-a-real-secret";
  await $("save-key").handlers.click();
  assert.equal($("api-setup").hidden, true);
  assert.equal($("change-key").hidden, false);
  assert.equal(saved.supadataApiKey, "test-key-not-a-real-secret");
  currentVideo = "abcdefghijk";
  let enteredFetch;
  const entered = new Promise(resolve => { enteredFetch = resolve; });
  globalThis.fetch = async (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    enteredFetch();
  });
  const pending = $("cloud-load").handlers.click();
  await entered;
  $("cloud-cancel").handlers.click();
  await pending;
  assert.equal($("cloud-load").disabled, false);
  assert.equal($("phrases").children.length, 0);
  assert.equal($("status").textContent, "");
  // A quota failure must be visible, preserve the usable transcript in this
  // panel, and never silently re-bill on another Get click.
  const originalSet = chrome.storage.local.set;
  chrome.storage.local.set = async values => {
    if (Object.keys(values).some(key => key.startsWith("transcript:v1:"))) throw new Error("QUOTA_BYTES exceeded");
    return originalSet(values);
  };
  globalThis.fetch = async () => {
    requests++;
    return { ok: true, status: 200, json: async () => ({ lang: "en", content: [
      { offset: 1000, duration: 1500, text: "Saved only in memory." }
    ] }) };
  };
  await $("cloud-load").handlers.click();
  assert.equal(requests, 2);
  assert.equal($("phrases").children.length, 1);
  assert.match($("status").textContent, /could not be saved/);
  assert.equal(saved[`transcript:v1:${currentVideo}`], undefined);
  await $("cloud-load").handlers.click();
  assert.equal(requests, 2);
});
