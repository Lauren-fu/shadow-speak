import { recordingKey } from "./captions.mjs";

// An overlay on immutable timed captions. Flat merge edges preserve each
// previous pair without duplicating whole paragraphs or nesting JSON deeply.
function fingerprint(base) {
  const text = JSON.stringify(base.map(phrase => [phrase.start, phrase.end, phrase.text, phrase.speaker || ""]));
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ text.charCodeAt(i);
  }
  return `${text.length}:${a >>> 0}:${b >>> 0}`;
}
const invalid = () => new Error("Saved phrase changes could not be restored. Your original transcript is still saved.");
const object = value => value && typeof value === "object" && !Array.isArray(value);

export function createPhraseDocument(base, saved = null) {
  const source = fingerprint(base);
  const state = saved ?? { version: 1, source, order: base.map((_, i) => `p${i}`), merges: {}, edits: {}, next: 0 };
  if (state.version !== 1 || state.source !== source || !Array.isArray(state.order) ||
      !object(state.merges) || !object(state.edits) || !Number.isSafeInteger(state.next) || state.next < 0) throw invalid();
  const ranges = new Map(base.map((_, i) => [`p${i}`, [i, i]]));
  const merges = {};
  for (const key of Object.keys(state.merges).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) {
    const children = state.merges[key];
    if (!/^m(?:0|[1-9]\d*)$/.test(key) || Number(key.slice(1)) >= state.next || !Array.isArray(children) || children.length !== 2) throw invalid();
    const left = ranges.get(children[0]), right = ranges.get(children[1]);
    // Children must already exist and cover neighboring source intervals.
    // This rejects cycles, reversed merges, gaps and duplicated phrases.
    if (!left || !right || left[1] + 1 !== right[0]) throw invalid();
    ranges.set(key, [left[0], right[1]]);
    merges[key] = [...children];
  }
  let nextLeaf = 0;
  const used = new Set(), pending = [...state.order];
  for (const key of state.order) {
    const range = ranges.get(key);
    if (!range || range[0] !== nextLeaf) throw invalid();
    nextLeaf = range[1] + 1;
  }
  if (nextLeaf !== base.length) throw invalid();
  while (pending.length) {
    const key = pending.pop();
    if (used.has(key)) throw invalid();
    used.add(key);
    if (merges[key]) pending.push(...merges[key]);
  }
  if (used.size !== ranges.size) throw invalid();
  const edits = {};
  for (const [key, text] of Object.entries(state.edits)) {
    if (!used.has(key) || typeof text !== "string" || !text.trim()) throw invalid();
    edits[key] = text;
  }
  return { base, version: 1, source, order: [...state.order], merges, edits, next: state.next, ranges };
}

export function savePhraseDocument(doc) {
  return { version: doc.version, source: doc.source, order: [...doc.order],
    merges: Object.fromEntries(Object.entries(doc.merges).map(([key, pair]) => [key, [...pair]])),
    edits: { ...doc.edits }, next: doc.next };
}

export function documentPhrases(doc) {
  return doc.order.map(nodeId => {
    const [first, last] = doc.ranges.get(nodeId), words = [], pending = [nodeId];
    while (pending.length) {
      const key = pending.pop();
      if (Object.hasOwn(doc.edits, key)) words.push(doc.edits[key]);
      else if (doc.merges[key]) pending.push(doc.merges[key][1], doc.merges[key][0]);
      else words.push(doc.base[Number(key.slice(1))].text);
    }
    return { ...doc.base[first], start: doc.base[first].start, end: doc.base[last].end,
      text: words.join(" "), nodeId, merged: Boolean(doc.merges[nodeId]),
      foldKey: doc.merges[nodeId] ? `merge:${nodeId}` : recordingKey(doc.base[first]) };
  });
}

export function editPhrase(doc, index, text) {
  if (!doc.order[index]) throw new Error("Choose a phrase to edit.");
  if (typeof text !== "string" || !text.trim()) throw new Error("Phrase cannot be empty.");
  const state = savePhraseDocument(doc);
  state.edits[doc.order[index]] = text.trim();
  return createPhraseDocument(doc.base, state);
}

export function mergeAdjacent(doc, from, onto) {
  if (!Number.isInteger(from) || !Number.isInteger(onto) || !doc.order[from] || !doc.order[onto] || Math.abs(from - onto) !== 1) {
    throw new Error("Only adjacent phrases can be merged.");
  }
  const index = Math.min(from, onto), state = savePhraseDocument(doc), key = `m${state.next++}`;
  state.merges[key] = state.order.slice(index, index + 2);
  state.order.splice(index, 2, key);
  return createPhraseDocument(doc.base, state);
}

export function undoMerge(doc, index) {
  const key = doc.order[index];
  if (!doc.merges[key]) throw new Error("This phrase has no merge to undo.");
  const state = savePhraseDocument(doc);
  state.order.splice(index, 1, ...state.merges[key]);
  delete state.merges[key];
  delete state.edits[key];
  return createPhraseDocument(doc.base, state);
}
