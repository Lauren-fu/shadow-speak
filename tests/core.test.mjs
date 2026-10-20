import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parseSubtitles, segmentCues, phraseRange, timestamp } from "../captions.mjs";

test("SRT import handles milliseconds, multiple lines, CRLF and invalid ranges", () => {
  const cues = parseSubtitles("1\r\n00:00:01,200 --> 00:00:03,500\r\nHello\r\nthere.\r\n\r\n2\r\n00:00:05,000 --> 00:00:04,000\r\nInvalid");
  assert.equal(cues.length, 1);
  assert.deepEqual(cues[0], { start: 1.2, end: 3.5, text: "Hello there.", speaker: "", reliableEnd: true });
  assert.ok(Number.isNaN(timestamp("wrong")));
});
test("VTT import reads speaker labels and cue settings", () => {
  const cues = parseSubtitles("WEBVTT\n\n00:01.000 --> 00:03.000 align:start\n<v Alice>Hello &amp; welcome.</v>\n\n00:03.000 --> 00:04.000\n<v Bob>Thank you</v>");
  assert.equal(cues[0].speaker, "Alice");
  assert.equal(cues[0].text, "Hello & welcome.");
  assert.equal(segmentCues(cues).length, 2);
});
const cue = (start, end, text, extra = {}) => ({ start, end, text, reliableEnd: true, ...extra });
test("segmentation uses sentence punctuation, real cue gaps, duration and speakers", () => {
  assert.equal(segmentCues([cue(0, 1, "Hello"), cue(1.1, 2, "world."), cue(2, 3, "Next")]).length, 2);
  assert.equal(segmentCues([cue(0, 1, "First"), cue(1.6, 2, "Second")]).length, 2);
  assert.equal(segmentCues([cue(0, 8, "Long"), cue(8, 15, "phrase")]).length, 2);
  assert.equal(segmentCues([cue(0, 1, "Hello", { speaker: "A" }), cue(1, 2, "Hi", { speaker: "B" })]).length, 2);
});
test("estimated transcript endings are not treated as measured pauses", () => {
  assert.equal(segmentCues([cue(0, 1, "Hello", { reliableEnd: false }), cue(2, 3, "world")]).length, 1);
});
test("invalid cues are discarded and text is not split into invented word times", () => {
  const result = segmentCues([cue(-1, 2, "bad"), cue(2, 1, "bad"), cue(3, 5, "One. Two.")]);
  assert.equal(result.length, 1);
  assert.equal(result[0].text, "One. Two.");
  assert.equal(result[0].end, 5);
});
test("overlapping captions stop at the next displayed card (reported 0:57 / 1:05 case)", () => {
  const phrases = segmentCues([cue(57, 75, "Tomorrow morning,"), cue(65, 70, "so it is in a little less than 24 hours.")]);
  assert.equal(phrases.length, 2);
  assert.equal(phrases[0].end, 65);
  assert.deepEqual(phraseRange(phrases, 0, 57, 80), { start: 57, end: 65, nextStart: 65 });
  assert.throws(() => phraseRange(phrases, 0, 66, 80), /before the next phrase/);
});
test("simultaneous caption starts share a card instead of creating an unplayable range", () => {
  const result = segmentCues([cue(0, 4, "Hello."), cue(0, 3, "Welcome."), cue(2, 5, "Next.")]);
  assert.equal(result.length, 2);
  assert.equal(result[0].end, 2);
  assert.match(result[0].text, /Welcome/);
});

function playerHarness() {
  let listener, tick, ad = false;
  let deadline;
  const events = {};
  const media = {
    currentTime: 0, duration: 100, paused: true, seeking: false, ended: false,
    pause() { this.paused = true; }, async play() { this.paused = false; },
    addEventListener() {}, removeEventListener() {}, textTracks: []
  };
  const location = { href: "https://www.youtube.com/watch?v=abc" };
  const context = {
    URL, location, console,
    setTimeout(fn) { deadline = fn; return 1; }, clearTimeout() { deadline = null; },
    setInterval(fn) { tick = fn; return 1; }, clearInterval() { tick = null; },
    document: {
      addEventListener(name, fn) { events[name] = fn; },
      querySelector(selector) {
        if (selector === "#movie_player") return { classList: { contains: () => ad } };
        if (selector.includes("video")) return media;
        return null;
      }
    },
    chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } } } }
  };
  vm.runInNewContext(readFileSync(new URL("../content.js", import.meta.url), "utf8"), context);
  return {
    media, location, events,
    tick() { tick?.(); }, deadline() { const fn = deadline; deadline = null; fn?.(); }, ad(value) { ad = value; },
    send(type, data = {}) { return new Promise(resolve => listener({ channel: "shadow-speak", type, id: "abc", ...data }, {}, resolve)); }
  };
}
test("phrase playback seeks, plays and stops at the requested end", async () => {
  const h = playerHarness();
  assert.equal((await h.send("play", { start: 10, end: 12, rate: 0.75 })).ok, true);
  assert.equal(h.media.currentTime, 10);
  assert.equal(h.media.playbackRate, 0.75);
  assert.equal(h.media.paused, false);
  h.media.currentTime = 11.95; h.tick();
  assert.equal(h.media.paused, false);
  h.media.currentTime = 12.01; h.tick();
  assert.equal(h.media.paused, true);
});
test("player independently enforces next-card boundary and corrects an overshoot", async () => {
  const h = playerHarness();
  await h.send("play", { start: 57, end: 75, nextStart: 65, rate: 1 });
  h.media.currentTime = 64.9; h.tick();
  assert.equal(h.media.paused, false);
  h.media.currentTime = 65.02; h.deadline();
  assert.equal(h.media.paused, true);
  assert.equal(h.media.currentTime, 65);
});
test("slider speeds update an active phrase without seeking or losing its stop boundary", async () => {
  const h = playerHarness();
  await h.send("play", { start: 10, end: 12, rate: 0.85 });
  h.media.currentTime = 11;
  assert.equal((await h.send("rate", { rate: 1.1 })).ok, true);
  assert.equal(h.media.currentTime, 11);
  assert.equal(h.media.playbackRate, 1.1);
  assert.equal(h.media.paused, false);
  h.media.currentTime = 12; h.deadline();
  assert.equal(h.media.paused, true);
  assert.equal((await h.send("rate", { rate: 8 })).ok, false);
});
test("page info identifies a watch page and its player independently of tab metadata", async () => {
  const h = playerHarness();
  const info = await h.send("info");
  assert.equal(info.ok, true);
  assert.equal(info.supported, true);
  assert.equal(info.hasVideo, true);
  assert.equal(info.id, "abc");
  h.location.href = "https://www.youtube.com/";
  assert.equal((await h.send("info")).supported, false);
});
test("a new phrase replaces the previous stop boundary", async () => {
  const h = playerHarness();
  await h.send("play", { start: 1, end: 2, rate: 1 });
  await h.send("play", { start: 10, end: 15, rate: 1 });
  h.media.currentTime = 11; h.tick();
  assert.equal(h.media.paused, false);
  h.media.currentTime = 15; h.tick();
  assert.equal(h.media.paused, true);
});
test("navigation, stale video IDs, ads and invalid ranges are guarded", async () => {
  const h = playerHarness();
  assert.equal((await h.send("play", { start: 2, end: 1, rate: 1 })).ok, false);
  h.ad(true);
  assert.equal((await h.send("play", { start: 1, end: 2, rate: 1 })).ok, false);
  h.ad(false);
  await h.send("play", { start: 1, end: 2, rate: 1 });
  h.location.href = "https://www.youtube.com/watch?v=other";
  h.tick();
  assert.equal(h.media.paused, true);
  assert.equal((await h.send("play", { start: 1, end: 2, rate: 1 })).ok, false);
});
