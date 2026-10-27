import test from "node:test";
import assert from "node:assert/strict";
import { createTranscriptStore } from "../transcript-store.mjs";
import { currentPhrase } from "../playback-sync.mjs";

function disk() {
  const saved = {};
  return {
    saved,
    async get(key) { return structuredClone({ [key]: saved[key] }); },
    async set(data) { Object.assign(saved, structuredClone(data)); }
  };
}
const video = "abcdefghijk", other = "lmnopqrstuv";
const transcript = { language: "en", cues: [
  { start: 0, end: 3, text: "Hello.", speaker: "A", reliableEnd: true },
  { start: 5, end: 9, text: "Welcome.", reliableEnd: true }
] };

test("raw transcript survives a new store instance and has no expiry or ten-video eviction", async () => {
  const storage = disk();
  await createTranscriptStore(storage).save(video, { ...transcript, apiKey: "must-not-be-saved" });
  for (let n = 0; n < 15; n++) await createTranscriptStore(storage).save(String(n).padStart(11, "0"), transcript);
  const reopened = createTranscriptStore(storage);
  assert.deepEqual(await reopened.read(video), transcript);
  assert.equal(await reopened.read(other), null);
  assert.ok(!JSON.stringify(storage.saved).includes("must-not-be-saved"));
});
test("fold choices persist separately by video and phrase mode", async () => {
  const storage = disk(), store = createTranscriptStore(storage);
  await store.save(video, transcript);
  await store.saveFolds(video, "pause", ["first", "second"]);
  const reopened = createTranscriptStore(storage);
  assert.deepEqual([...await reopened.readFolds(video, "pause")], ["first", "second"]);
  assert.deepEqual([...await reopened.readFolds(video, "seven")], []);
  assert.deepEqual([...await reopened.readFolds(other, "pause")], []);
  assert.deepEqual(await reopened.read(video), transcript);
  await reopened.saveFolds(video, "pause", []);
  assert.equal((await store.readFolds(video, "pause")).size, 0);
});
test("broken saved data and storage failures remain errors instead of a silent cache miss", async () => {
  const storage = disk(), store = createTranscriptStore(storage);
  await storage.set({ [`transcript:v1:${video}`]: { cues: [] } });
  await assert.rejects(store.read(video), /No new API request/);
  await assert.rejects(store.save(video, { cues: [{ start: 1, end: 0, text: "bad" }] }), /unreadable/);
  await assert.rejects(store.read("invalid"), /Invalid/);
  storage.set = async () => { throw new Error("quota full"); };
  await assert.rejects(store.save(video, transcript), /quota full/);
});
test("playback selection follows forward/backward seeks, shared boundaries, gaps and ads", () => {
  const phrases = [{ start: 1, end: 3 }, { start: 3, end: 5 }, { start: 8, end: 10 }];
  assert.equal(currentPhrase(phrases, 0), -1);
  assert.equal(currentPhrase(phrases, 1), 0);
  assert.equal(currentPhrase(phrases, 3), 1);
  assert.equal(currentPhrase(phrases, 9), 2);
  assert.equal(currentPhrase(phrases, 2), 0);
  assert.equal(currentPhrase(phrases, 6), -1);
  assert.equal(currentPhrase(phrases, 10), -1);
  assert.equal(currentPhrase(phrases, 2, true), -1);
  assert.equal(currentPhrase(phrases, NaN), -1);
});
