import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

test("Shadow opens the side panel immediately for this extension's top-level YouTube tab only", async () => {
  let handler, opened;
  const context = { URL, console, chrome: {
    storage: { local: { setAccessLevel: async () => {} } },
    runtime: { id: "self", onMessage: { addListener(fn) { handler = fn; } } },
    sidePanel: { setPanelBehavior: async () => {}, open(options) { opened = options; return Promise.resolve(); } }
  } };
  vm.runInNewContext(readFileSync(new URL("../background.js", import.meta.url), "utf8"), context);
  const sender = { id: "self", frameId: 0, tab: { id: 42, windowId: 7 }, url: "https://www.youtube.com/watch?v=abcdefghijk" };
  const message = { channel: "shadow-speak", type: "open-panel" };
  const response = new Promise(resolve => {
    assert.equal(handler(message, sender, resolve), true);
    // Must occur synchronously, before an await could lose the user gesture.
    assert.equal(opened.windowId, 7);
  });
  assert.equal((await response).ok, true);
  for (const invalid of [{ ...sender, id: "other" }, { ...sender, frameId: 3 }, { ...sender, url: "https://example.com/watch" }, { ...sender, tab: null }]) {
    opened = null;
    assert.equal(handler(message, invalid, () => {}), undefined);
    assert.equal(opened, null);
  }
});

test("launcher installs once, survives YouTube action-bar replacement, and disappears off watch pages", async () => {
  let installed, observer, scheduled, click, sent;
  const location = { href: "https://www.youtube.com/watch?v=abcdefghijk" };
  const target = () => ({
    children: [], contains(button) { return this.children.includes(button); },
    prepend(button) { this.children.unshift(button); button.parent = this; installed = button; }
  });
  let actions = target();
  const document = {
    body: {}, getElementById: () => installed,
    querySelector: () => actions, addEventListener() {},
    createElement: () => ({ setAttribute() {}, addEventListener(name, fn) { if (name === "click") click = fn; },
      remove() { this.parent.children = this.parent.children.filter(child => child !== this); installed = undefined; } })
  };
  const context = { URL, location, document,
    MutationObserver: class { constructor(fn) { observer = fn; } observe() {} },
    setTimeout(fn) { scheduled = fn; return 1; },
    chrome: { runtime: { async sendMessage(message) { sent = message; return { ok: true }; } } }
  };
  vm.runInNewContext(readFileSync(new URL("../launcher.js", import.meta.url), "utf8"), context);
  assert.equal(actions.children.length, 1);
  assert.equal(installed.textContent, "Shadow");
  observer(); scheduled();
  assert.equal(actions.children.length, 1);
  actions = target();
  observer(); scheduled();
  assert.equal(actions.children.length, 1);
  click();
  assert.equal(sent.type, "open-panel");
  await Promise.resolve();
  assert.equal(installed.title, "Open Shadow Speak");
  location.href = "https://www.youtube.com/";
  observer(); scheduled();
  assert.equal(actions.children.length, 0);
});
