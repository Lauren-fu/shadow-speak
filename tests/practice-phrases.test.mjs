import test from "node:test";
import assert from "node:assert/strict";
import { buildPracticePhrases } from "../captions.mjs";

test("splits sentences inside a paragraph and carries incomplete sentences across blocks", () => {
  const cues = [
    { start: 36, end: 45, text: "extremely comfy cozy. I sit tested it and made sure it was perfect. We picked this like chintz fabric. I thought it was really bold and beautiful. I have" },
    { start: 45, end: 54, text: "always kind of had this dream and vision of like a very just exotic kind of crazy couch that becomes the statement in the room and this one turned out perfectly." }
  ];
  const phrases = buildPracticePhrases(cues);
  assert.equal(phrases.length, 5);
  assert.match(phrases[4].text, /^I have always/);
  assert.equal(phrases[4].end, 54);
  assert.ok(phrases.every(phrase => /[.!?]$/.test(phrase.text)));
  assert.ok(phrases.some(phrase => phrase.estimatedTiming));
  for (let i = 0; i < phrases.length - 1; i++) assert.ok(phrases[i].end <= phrases[i + 1].start);
});

test("seven-second mode combines short sentences without cutting a long one", () => {
  const cues = [
    { start: 0, end: 3, text: "One sentence." },
    { start: 3, end: 7, text: "Two sentences." },
    { start: 7, end: 19, text: "This long sentence stays intact." }
  ];
  assert.equal(buildPracticePhrases(cues, { mode: "pause" }).length, 3);
  const seven = buildPracticePhrases(cues, { mode: "seven" });
  assert.equal(seven.length, 2);
  assert.equal(seven[0].end, 7);
  assert.equal(seven[0].text, "One sentence. Two sentences.");
  assert.equal(seven[1].end, 19);
});

test("pause mode uses caption gaps even when text has no punctuation", () => {
  const cues = [
    { start: 0, end: 2, text: "a short phrase" },
    { start: 2.5, end: 5, text: "another short phrase" }
  ];
  assert.equal(buildPracticePhrases(cues).length, 2);
  assert.equal(buildPracticePhrases(cues, { mode: "seven" }).length, 1);
  assert.equal(buildPracticePhrases(cues.map(c => ({ ...c, reliableEnd: false }))).length, 1);
});

test("overlapping durations and equal timestamps keep text with bounded ranges", () => {
  const phrases = buildPracticePhrases([
    { start: 0, end: 5, text: "Hello there." },
    { start: 0, end: 5, text: "Another line." },
    { start: 4, end: 8, text: "Final line." }
  ]);
  assert.equal(phrases.map(p => p.text).join(" "), "Hello there. Another line. Final line.");
  assert.ok(phrases.every(p => p.end > p.start));
  assert.equal(phrases[1].end, 4);
});

test("common titles do not introduce spurious sentence breaks", () => {
  assert.equal(buildPracticePhrases([{ start: 0, end: 7, text: "Dr. Smith is here. So am I." }]).length, 2);
});
