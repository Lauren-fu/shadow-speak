import test from "node:test";
import assert from "node:assert/strict";
import { getActiveVideo } from "../connection.mjs";

const goodInfo = { ok: true, id: "video123", supported: true, hasVideo: true, title: "Test video" };
function mockTabs(tab, info = goodInfo) {
  return {
    async query(query) {
      assert.deepEqual(query, { active: true, currentWindow: true });
      return tab ? [tab] : [];
    },
    async sendMessage(id, message) {
      assert.equal(id, tab.id);
      assert.deepEqual(message, { channel: "shadow-speak", type: "info" });
      return info;
    }
  };
}
test("connects to YouTube when Chrome withholds tab.url (reported failure)", async () => {
  const connected = await getActiveVideo(mockTabs({ id: 42 }));
  assert.equal(connected.tabId, 42);
  assert.equal(connected.info.id, "video123");
});
test("uses the loaded page's response instead of stale tab URL metadata", async () => {
  const connected = await getActiveVideo(mockTabs({ id: 42, url: "https://www.youtube.com/" }));
  assert.equal(connected.info.id, "video123");
});
test("connects normally when tab URL is available", async () => {
  const connected = await getActiveVideo(mockTabs({ id: 42, url: "https://www.youtube.com/watch?v=video123" }));
  assert.equal(connected.tabId, 42);
});
test("missing active tab gives a specific error", async () => {
  await assert.rejects(getActiveVideo(mockTabs(null)), /No active browser tab/);
});
test("missing content script gives refresh and site-access instructions", async () => {
  const tabs = mockTabs({ id: 42 });
  tabs.sendMessage = async () => { throw new Error("Receiving end does not exist"); };
  await assert.rejects(getActiveVideo(tabs), /refresh it.*site access/);
});
test("YouTube home and Shorts are rejected based on the page response", async () => {
  await assert.rejects(getActiveVideo(mockTabs({ id: 42 }, { ...goodInfo, supported: false })), /regular YouTube video/);
  await assert.rejects(getActiveVideo(mockTabs({ id: 42 }, { ...goodInfo, id: null })), /regular YouTube video/);
});
test("loading player and page errors get distinct messages", async () => {
  await assert.rejects(getActiveVideo(mockTabs({ id: 42 }, { ...goodInfo, hasVideo: false })), /player is still loading/);
  await assert.rejects(getActiveVideo(mockTabs({ id: 42 }, { ok: false, error: "Page error" })), /Page error/);
});
