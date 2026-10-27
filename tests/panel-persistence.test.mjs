import test from "node:test";
import assert from "node:assert/strict";
import { createPhraseDocument, savePhraseDocument, editPhrase, mergeAdjacent } from "../phrase-document.mjs";

// Keep real panel control flow and replace only the external Chrome/DOM edges.
test("reopening restores saved captions without a key or fetch; folding and seeks follow the same video", async t => {
  const video = "abcdefghijk", other = "lmnopqrstuv";
  const data = { [`transcript:v1:${video}`]: { language: "en", cues: [
    { start: 0, end: 3, text: "First sentence." },
    { start: 3, end: 5, text: "Second sentence." },
    { start: 8, end: 10, text: "Last sentence." }
  ] } };
  let nodes, pageEvents, activate, currentVideo = video, time = 1, ad = false, fetches = 0;
  const messages = [];
  function node() {
    const classes = new Set();
    return {
      value: "", hidden: false, disabled: false, children: [], handlers: {}, attrs: {}, scrolls: 0,
      classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) },
      setAttribute(name, value) { this.attrs[name] = value; }, removeAttribute(name) { delete this.attrs[name]; },
      append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; },
      addEventListener(name, handler) { this.handlers[name] = handler; },
      scrollIntoView() { this.scrolls++; }, pause() {}, load() {}, focus() {}, async play() {}
    };
  }
  function newPage() {
    nodes = new Map(); pageEvents = {};
    globalThis.document = {
      getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); },
      createElement: node, createTextNode: text => text
    };
    globalThis.window = { addEventListener(name, handler) { pageEvents[name] = handler; } };
    $("split-mode").value = "pause"; $("rate").value = "1";
  }
  const $ = id => document.getElementById(id);
  async function waitFor(check) {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > 2000) throw new Error("Panel did not reach expected state");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  const cards = () => $("phrases").children;
  const store = {
    async get(key) { return structuredClone({ [key]: data[key] }); },
    async set(value) { Object.assign(data, structuredClone(value)); },
    async remove(key) { delete data[key]; }, async setAccessLevel() {}
  };
  globalThis.chrome = {
    storage: { local: store }, tabs: {
      query: async () => [{ id: 42 }],
      sendMessage: async (tabId, message) => {
        messages.push(message);
        if (message.channel === "shadow-speak-audio") return { ok: true, inputs: [] };
        if (message.type === "info") return { ok: true, id: currentVideo, hasVideo: true, supported: true, currentTime: time, paused: false, isAd: ad };
        return { ok: true };
      },
      onActivated: { addListener(fn) { activate = fn; } }, onUpdated: { addListener() {} }
    }
  };
  globalThis.fetch = async () => { fetches++; throw new Error("Automatic fetch must never happen"); };
  t.after(() => pageEvents.pagehide?.());
  newPage();
  await import("../panel.mjs?persistence-first");
  await waitFor(() => cards().length === 3);
  assert.equal(fetches, 0);
  assert.equal($("api-key").value, "");
  assert.equal(cards()[0].attrs["aria-current"], "true");
  const beforeFold = messages.length;
  cards()[0].children[5].handlers.click();
  await waitFor(() => Object.keys(data).some(key => key.endsWith(":folds:pause")));
  assert.equal(cards()[0].classList.contains("folded"), true);
  assert.equal(cards()[0].children[5].attrs["aria-expanded"], "false");
  assert.ok(messages.slice(beforeFold).every(message => message.type === "info"));
  // Reopen a completely new panel, preserving only Chrome's stored data.
  pageEvents.pagehide();
  newPage();
  await import("../panel.mjs?persistence-second");
  await waitFor(() => cards().length === 3);
  assert.equal(cards()[0].classList.contains("folded"), true);
  assert.equal(cards()[0].attrs["aria-current"], "true");
  assert.equal(fetches, 0);
  // Forward and backward seeks update highlight/scroll; following never unfolds a card.
  time = 9;
  await waitFor(() => cards()[2].attrs["aria-current"] === "true");
  assert.ok(cards()[2].scrolls > 0);
  time = 1;
  await waitFor(() => cards()[0].attrs["aria-current"] === "true");
  assert.equal(cards()[0].classList.contains("folded"), true);
  ad = true;
  await waitFor(() => !cards().some(card => card.attrs["aria-current"]));
  ad = false;
  // An explicit Get click also reuses disk, even with no saved API key.
  await $("cloud-load").handlers.click();
  assert.equal(cards().length, 3);
  assert.equal(fetches, 0);
  // Switching video clears old content and never requests an uncached one automatically.
  currentVideo = other;
  activate({ tabId: 7 });
  await waitFor(() => cards().length === 0);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(fetches, 0);
  // Returning automatically restores the correct transcript and fold state.
  currentVideo = video;
  await waitFor(() => cards().length === 3);
  assert.equal(cards()[0].classList.contains("folded"), true);
  assert.equal(fetches, 0);
  // A different phrase mode preserves the original mode's folds without charging.
  $("split-mode").value = "seven";
  await $("split-mode").handlers.change();
  await $("split-refresh").handlers.click();
  assert.equal(data.phraseMode, "seven");
  assert.equal(cards()[0].classList.contains("folded"), false);
  $("split-mode").value = "pause";
  await $("split-mode").handlers.change();
  await $("split-refresh").handlers.click();
  assert.equal(cards()[0].classList.contains("folded"), true);
  assert.equal(fetches, 0);
  // A delayed restore from the previous video cannot replace newer content.
  let releaseOld, enteredOld;
  const oldRead = new Promise(resolve => { releaseOld = resolve; });
  const entered = new Promise(resolve => { enteredOld = resolve; });
  const originalGet = store.get;
  store.get = async key => {
    if (key === `transcript:v1:${other}`) { enteredOld(); await oldRead; }
    return originalGet(key);
  };
  currentVideo = other;
  activate({ tabId: 7 });
  await entered;
  currentVideo = video;
  await $("cloud-load").handlers.click();
  assert.equal(cards().length, 3);
  releaseOld();
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(cards().length, 3);
  assert.equal(cards()[0].classList.contains("folded"), true);
  assert.equal(fetches, 0);
  // Edit words without changing their times, and cancel/validate drafts.
  cards()[0].children[5].handlers.click();
  cards()[0].children[1].children[2].handlers.click();
  assert.equal(cards()[0].children[3].hidden, false);
  cards()[0].children[3].children[0].value = "   ";
  await cards()[0].children[3].handlers.submit({ preventDefault() {} });
  assert.match($("status").textContent, /cannot be empty/);
  cards()[0].children[3].children[1].children[1].handlers.click();
  assert.equal(cards()[0].children[3].hidden, true);
  cards()[0].children[1].children[2].handlers.click();
  cards()[0].children[3].children[0].value = "Corrected first sentence.";
  await cards()[0].children[3].handlers.submit({ preventDefault() {} });
  const textOf = card => card.children[0].children[1].children.join("");
  assert.equal(textOf(cards()[0]), "Corrected first sentence.");
  assert.equal(data[`transcript:v1:${video}`].cues[0].text, "First sentence.");
  // Reject a non-neighbor drop, then merge through the actual panel handlers.
  let accepted = false;
  const dragEvent = { dataTransfer: { setData() {} }, preventDefault() { accepted = true; } };
  cards()[0].children[7].handlers.dragstart(dragEvent);
  cards()[2].handlers.dragover(dragEvent);
  assert.equal(accepted, false);
  await cards()[2].handlers.drop(dragEvent);
  assert.equal(cards().length, 3);
  cards()[1].handlers.dragover(dragEvent);
  assert.equal(accepted, true);
  await cards()[1].handlers.drop(dragEvent);
  assert.equal(cards().length, 2);
  assert.equal(textOf(cards()[0]), "Corrected first sentence. Second sentence.");
  assert.equal(cards()[0].children[6].hidden, false);
  assert.equal(cards()[1].children[6].hidden, true);
  await cards()[0].children[0].handlers.click();
  const firstPlay = messages.filter(message => message.type === "play").at(-1);
  assert.equal(firstPlay.start, 0); assert.equal(firstPlay.end, 5); assert.equal(firstPlay.nextStart, 8);
  // Drag a later cell backward onto the previous merged cell: order never changes.
  cards()[1].children[7].handlers.dragstart(dragEvent);
  await cards()[0].handlers.drop(dragEvent);
  assert.equal(cards().length, 1);
  assert.equal(textOf(cards()[0]), "Corrected first sentence. Second sentence. Last sentence.");
  await cards()[0].children[0].handlers.click();
  assert.equal(messages.filter(message => message.type === "play").at(-1).end, 10);
  // Fresh panel restores the nested merge, then Undo restores the latest pair.
  pageEvents.pagehide(); newPage();
  await import("../panel.mjs?persistence-third");
  await waitFor(() => cards().length === 1);
  await cards()[0].children[6].handlers.click();
  assert.equal(cards().length, 2);
  assert.equal(textOf(cards()[0]), "Corrected first sentence. Second sentence.");
  assert.equal(textOf(cards()[1]), "Last sentence.");
  await cards()[0].children[6].handlers.click();
  assert.equal(cards().length, 3);
  assert.equal(textOf(cards()[0]), "Corrected first sentence.");
  assert.equal(cards()[0].children[6].hidden, true);
  $("split-mode").value = "seven";
  await $("split-mode").handlers.change();
  await $("split-refresh").handlers.click();
  assert.equal(textOf(cards()[0]), "First sentence. Second sentence.");
  $("split-mode").value = "pause";
  await $("split-mode").handlers.change();
  await $("split-refresh").handlers.click();
  assert.equal(textOf(cards()[0]), "Corrected first sentence.");
  assert.equal(fetches, 0);
  // Saving failures warn rather than claiming persistence or contacting Supadata.
  const originalSet = store.set;
  store.set = async values => {
    if (Object.keys(values).some(key => key.includes(":phrases:v1:"))) throw new Error("Quota full");
    return originalSet(values);
  };
  cards()[0].children[1].children[2].handlers.click();
  cards()[0].children[3].children[0].value = "Only in this panel.";
  await cards()[0].children[3].handlers.submit({ preventDefault() {} });
  assert.match($("status").textContent, /could not be saved/);
  assert.equal(textOf(cards()[0]), "Only in this panel.");
  pageEvents.pagehide(); newPage();
  await import("../panel.mjs?persistence-fourth");
  await waitFor(() => cards().length === 3);
  assert.equal(textOf(cards()[0]), "Corrected first sentence.");
  assert.equal(fetches, 0);
  // A cached sparse-punctuation transcript is re-split locally after an update.
  // An incompatible saved layout warns, while both its data and raw captions
  // remain on disk. Changing the dropdown alone must still wait for ↻.
  store.set = originalSet;
  const raw = { language: "en", cues: Array.from({ length: 28 }, (_, i) => ({
    start: i * 3, end: i * 3 + 3.2,
    text: i === 27 ? "the final caption has a period." : `caption${i} continues without punctuation`
  })) };
  data[`transcript:v1:${other}`] = structuredClone(raw);
  const oldBase = Array.from({ length: 4 }, (_, i) => ({
    start: i * 21, end: i === 3 ? 84.2 : (i + 1) * 21,
    text: raw.cues.slice(i * 7, i * 7 + 7).map(cue => cue.text).join(" ")
  }));
  const oldDocument = savePhraseDocument(mergeAdjacent(editPhrase(createPhraseDocument(oldBase), 0, "An earlier correction."), 0, 1));
  const savedKey = `transcript:v1:${other}:phrases:v1:pause`;
  data[savedKey] = structuredClone(oldDocument);
  currentVideo = other; time = 0;
  activate({ tabId: 7 });
  await waitFor(() => cards().length > 4);
  assert.match($("status").textContent, /earlier edits and merges/);
  const ranges = () => cards().map(card => card.children[0].attrs["aria-label"]);
  const beforeRefresh = ranges();
  $("split-mode").value = "seven";
  await $("split-mode").handlers.change();
  assert.deepEqual(ranges(), beforeRefresh);
  assert.equal(data.phraseMode, "pause");
  await $("split-refresh").handlers.click();
  assert.equal(data.phraseMode, "seven");
  assert.ok(cards().length > 4);
  await cards()[0].children[0].handlers.click();
  const range = messages.filter(message => message.type === "play").at(-1);
  assert.equal(range.start, 0);
  assert.ok(range.end <= 10);
  assert.deepEqual(data[`transcript:v1:${other}`], raw);
  assert.deepEqual(data[savedKey], oldDocument);
  assert.equal(fetches, 0);

});
