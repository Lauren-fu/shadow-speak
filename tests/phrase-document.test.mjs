import test from "node:test";
import assert from "node:assert/strict";
import { createPhraseDocument, documentPhrases, savePhraseDocument, editPhrase, mergeAdjacent, undoMerge } from "../phrase-document.mjs";
import { phraseRange } from "../captions.mjs";
import { currentPhrase } from "../playback-sync.mjs";

const base = ["A", "B", "C", "D"].map((text, i) => ({ start: i * 3, end: i * 3 + 2, text }));
const texts = doc => documentPhrases(doc).map(phrase => phrase.text);

test("editing changes only words, preserves time and folding identity, and rejects blank text", () => {
  const original = createPhraseDocument(base), doc = editPhrase(original, 1, "  Corrected B.  ");
  assert.deepEqual(texts(original), ["A", "B", "C", "D"]);
  assert.deepEqual(texts(doc), ["A", "Corrected B.", "C", "D"]);
  const phrase = documentPhrases(doc)[1];
  assert.equal(phrase.start, 3); assert.equal(phrase.end, 5);
  assert.equal(phrase.foldKey, documentPhrases(original)[1].foldKey);
  assert.throws(() => editPhrase(doc, 1, " \n "), /cannot be empty/);
});
test("dropping in either direction merges only adjacent visible cells in chronological order", () => {
  const original = createPhraseDocument(base);
  const forward = mergeAdjacent(original, 0, 1), backward = mergeAdjacent(original, 1, 0);
  assert.deepEqual(texts(forward), ["A B", "C", "D"]);
  assert.deepEqual(texts(backward), texts(forward));
  assert.deepEqual(phraseRange(documentPhrases(forward), 0), { start: 0, end: 5, nextStart: 6 });
  assert.equal(currentPhrase(documentPhrases(forward), 4), 0);
  for (const [from, onto] of [[0, 2], [0, 0], [0, -1], [3, 4]]) assert.throws(() => mergeAdjacent(original, from, onto), /Only adjacent/);
});
test("nested merges undo the latest pair and preserve the children’s earlier edits", () => {
  let doc = editPhrase(createPhraseDocument(base), 0, "Edited A");
  doc = mergeAdjacent(doc, 0, 1);
  doc = editPhrase(doc, 0, "Edited AB");
  doc = mergeAdjacent(doc, 1, 0);
  assert.deepEqual(texts(doc), ["Edited AB C", "D"]);
  doc = editPhrase(doc, 0, "Edited ABC");
  doc = createPhraseDocument(base, JSON.parse(JSON.stringify(savePhraseDocument(doc))));
  doc = undoMerge(doc, 0);
  assert.deepEqual(texts(doc), ["Edited AB", "C", "D"]);
  assert.equal(documentPhrases(doc)[0].merged, true);
  doc = undoMerge(doc, 0);
  assert.deepEqual(texts(doc), ["Edited A", "B", "C", "D"]);
  assert.equal(documentPhrases(doc)[0].merged, false);
});
test("independent merges, merging two groups and later merges retain valid undo history", () => {
  let doc = mergeAdjacent(createPhraseDocument(base), 0, 1);
  doc = mergeAdjacent(doc, 1, 2);
  assert.deepEqual(texts(doc), ["A B", "C D"]);
  doc = mergeAdjacent(doc, 1, 0);
  assert.deepEqual(texts(doc), ["A B C D"]);
  doc = undoMerge(doc, 0);
  assert.deepEqual(texts(doc), ["A B", "C D"]);
  doc = undoMerge(doc, 0);
  doc = mergeAdjacent(doc, 1, 2);
  assert.deepEqual(texts(doc), ["A", "B C D"]);
  doc = undoMerge(doc, 1);
  assert.deepEqual(texts(doc), ["A", "B", "C D"]);
});
test("thousands of nested cells restore, display and undo without recursive JSON or a merge-count limit", () => {
  const count = 5000, phrases = Array.from({ length: count }, (_, i) => ({ start: i, end: i + 1, text: String(i) }));
  const state = savePhraseDocument(createPhraseDocument(phrases));
  state.merges.m0 = ["p0", "p1"];
  for (let i = 1; i < count - 1; i++) state.merges[`m${i}`] = [`m${i - 1}`, `p${i + 1}`];
  state.order = [`m${count - 2}`]; state.next = count - 1;
  let doc = createPhraseDocument(phrases, JSON.parse(JSON.stringify(state)));
  assert.equal(documentPhrases(doc)[0].text, phrases.map(phrase => phrase.text).join(" "));
  assert.equal(documentPhrases(doc)[0].end, count);
  doc = undoMerge(doc, 0);
  assert.equal(documentPhrases(doc).length, 2);
  assert.equal(documentPhrases(doc)[1].text, "4999");
});
test("saved changes reject a changed baseline, cycles, gaps, duplicates, reordered cells and unknown edits", () => {
  const doc = createPhraseDocument(base);
  assert.throws(() => createPhraseDocument(base.slice(1), savePhraseDocument(doc)), /could not be restored/);
  for (const patch of [
    { order: ["p1", "p0", "p2", "p3"] },
    { order: ["p0", "p1", "p2", "p2"] },
    { merges: { m0: ["m0", "p1"] }, next: 1 },
    { merges: { m0: ["p0", "p2"] }, next: 1 },
    { edits: { missing: "bad" } }
  ]) assert.throws(() => createPhraseDocument(base, { ...savePhraseDocument(doc), ...patch }), /could not be restored/);
});
