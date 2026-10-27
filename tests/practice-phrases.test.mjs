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

test("seven-second mode combines short sentences and splits overlong ones", () => {
  const cues = [
    { start: 0, end: 3, text: "One sentence." },
    { start: 3, end: 7, text: "Two sentences." },
    { start: 7, end: 19, text: "This long sentence stays intact." }
  ];
  assert.equal(buildPracticePhrases(cues, { mode: "pause" }).length, 4);
  const seven = buildPracticePhrases(cues, { mode: "seven" });
  assert.equal(seven.length, 3);
  assert.equal(seven[0].end, 7);
  assert.equal(seven[0].text, "One sentence. Two sentences.");
  assert.equal(seven.at(-1).end, 19);
  assert.ok(seven.every(p => p.end - p.start <= 10));
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

test("unpunctuated auto captions with overlapping cues still split into short cards", () => {
  // Rolling auto-captions: no punctuation, each cue overlaps the next.
  const cues = Array.from({ length: 20 }, (_, i) => ({
    start: i * 2, end: i * 2 + 3.5, text: `word${i} is still possible to make it`
  }));
  for (const mode of ["pause", "seven"]) {
    const phrases = buildPracticePhrases(cues, { mode });
    assert.ok(phrases.length >= 5, `${mode}: ${phrases.length}`);
    assert.ok(phrases.every(p => p.end - p.start <= 10));
    assert.equal(phrases.map(p => p.text).join(" "), cues.map(c => c.text).join(" "));
    assert.ok(phrases.every(p => !p.estimatedTiming));
  }
});

function continuousCaptions(count = 28) {
  return Array.from({ length: count }, (_, i) => ({
    start: i * 3, end: i * 3 + 3.2,
    text: i === count - 1 ? "only the last caption has punctuation." : `caption${i} is continuous speech without punctuation`
  }));
}
function assertPreserved(cues, phrases) {
  assert.equal(phrases.map(p => p.text).join(" "), cues.map(c => c.text.trim()).join(" "));
  assert.equal(phrases[0].start, cues[0].start);
  assert.equal(phrases.at(-1).end, cues.at(-1).end);
  for (const [i, phrase] of phrases.entries()) {
    assert.ok(phrase.end > phrase.start);
    assert.ok(phrase.end - phrase.start <= 10 + 1e-8);
    if (i) assert.ok(phrases[i - 1].end <= phrase.start);
  }
}

test("sparse punctuation cannot produce the 0, 21, 42 second blocks in either mode", () => {
  const cues = continuousCaptions();
  for (const mode of ["pause", "seven"]) {
    const phrases = buildPracticePhrases(cues, { mode });
    assertPreserved(cues, phrases);
    assert.ok(phrases.length >= 10);
    assert.ok(phrases.every(p => !p.estimatedTiming), "use existing cue boundaries when available");
  }
});

test("a remote sentence ending cannot change segmentation earlier in the video", () => {
  const cues = continuousCaptions();
  const withoutFinalPeriod = cues.map(c => ({ ...c, text: c.text.replace(/\.$/, "") }));
  for (const mode of ["pause", "seven"]) {
    assert.deepEqual(buildPracticePhrases(cues, { mode }).filter(p => p.end <= 60),
      buildPracticePhrases(withoutFinalPeriod, { mode }).filter(p => p.end <= 60));
  }
});

test("one long provider block is split using estimated word boundaries without losing words", () => {
  for (const punctuation of ["", "."]) {
    const cues = [{ start: 50, end: 88, text: Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ") + punctuation }];
    for (const mode of ["pause", "seven"]) {
      const phrases = buildPracticePhrases(cues, { mode });
      assertPreserved(cues, phrases);
      assert.ok(phrases.length >= 4);
      assert.ok(phrases.every(p => p.estimatedTiming));
    }
  }
});

test("fallback chooses a known cue boundary close to seven seconds", () => {
  for (const mode of ["pause", "seven"]) {
    const cues = continuousCaptions(10);
    const phrases = buildPracticePhrases(cues, { mode });
    assertPreserved(cues, phrases);
    assert.ok(Math.abs(phrases[0].end - 7) <= 1, "6 seconds is closer than 9 seconds");
    assert.ok(phrases.every(p => !p.estimatedTiming));
  }
});

test("natural sentence and pause boundaries still distinguish the two modes", () => {
  const cues = [
    { start: 0, end: 2, text: "First sentence." },
    { start: 2, end: 5, text: "Second sentence." },
    { start: 5.5, end: 7, text: "A pause follows" },
    { start: 7.5, end: 9, text: "then we continue." }
  ];
  const pause = buildPracticePhrases(cues, { mode: "pause" });
  const seven = buildPracticePhrases(cues, { mode: "seven" });
  assert.equal(pause.length, 4);
  assert.equal(seven.length, 2);
  assertPreserved(cues, pause);
  assertPreserved(cues, seven);
});

test("neither mode combines known speakers or a long break", () => {
  const cues = [
    { start: 0, end: 2, text: "first speaker", speaker: "A" },
    { start: 2, end: 4, text: "second speaker", speaker: "B" },
    { start: 9, end: 11, text: "after a break", speaker: "B" }
  ];
  for (const mode of ["pause", "seven"]) assert.equal(buildPracticePhrases(cues, { mode }).length, 3);
});

test("seven-second grouping cannot recombine short units into an overlong card", () => {
  const cues = [
    { start: 0, end: 1.5, text: "Short." },
    { start: 1.5, end: 10.5, text: "This complete sentence lasts nine seconds." }
  ];
  const phrases = buildPracticePhrases(cues, { mode: "seven" });
  assert.equal(phrases.length, 2);
  assertPreserved(cues, phrases);
});

test("a single word with a long source duration is retained without inventing a word split", () => {
  const cues = [{ start: 0, end: 25, text: "hello" }, { start: 26, end: 28, text: "there." }];
  for (const mode of ["pause", "seven"]) {
    const phrases = buildPracticePhrases(cues, { mode });
    assert.equal(phrases[0].text, "hello");
    assert.equal(phrases[0].end, 25);
    assert.equal(phrases.at(-1).text, "there.");
  }
});
