export function timestamp(value) {
  const parts = value.trim().replace(",", ".").split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some(p => !/^\d+(?:\.\d+)?$/.test(p))) return NaN;
  return parts.reduce((sum, part) => sum * 60 + Number(part), 0);
}

export function parseSubtitles(source) {
  const cues = [];
  for (const block of source.replace(/\r/g, "").trim().split(/\n\s*\n/)) {
    const lines = block.split("\n");
    const index = lines.findIndex(line => line.includes("-->"));
    if (index < 0) continue;
    const [left, right] = lines[index].split("-->");
    const start = timestamp(left);
    const end = timestamp(right.trim().split(/\s+/)[0]);
    const raw = lines.slice(index + 1).join(" ");
    const speaker = raw.match(/<v(?:\.[^\s>]+)?\s+([^>]+)>/)?.[1] || "";
    const text = raw.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").trim();
    if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && text) {
      cues.push({ start, end, text, speaker, reliableEnd: true });
    }
  }
  return cues.sort((a, b) => a.start - b.start);
}

// Boundaries stay on caption cues: inventing word timestamps would cut words.
export function segmentCues(cues, { pause = 0.45, maxDuration = 12 } = {}) {
  const clean = cues.filter(c => Number.isFinite(c.start) && Number.isFinite(c.end)
    && c.start >= 0 && c.end > c.start && c.text?.trim()).sort((a, b) => a.start - b.start);
  const result = [];
  let group;
  for (const [index, cue] of clean.entries()) {
    const gap = group && cue.start - group.end;
    const previous = group && clean[group.lastIndex];
    const speakerChange = group && cue.speaker && group.speaker && cue.speaker !== group.speaker;
    const punctuation = group && /[.!?。！？]["'”’)]*$/.test(group.text);
    const tooLong = group && cue.end - group.start > maxDuration;
    const pauseBoundary = group && previous.reliableEnd !== false && gap >= pause;
    if (group && cue.start > group.start && (speakerChange || punctuation || tooLong || pauseBoundary)) {
      result.push(group);
      group = null;
    }
    if (!group) group = { start: cue.start, end: cue.end, text: cue.text.trim(), speaker: cue.speaker || "" };
    else {
      group.text += " " + cue.text.trim();
      group.end = Math.max(group.end, cue.end);
    }
    group.lastIndex = index;
  }
  if (group) result.push(group);
  // Providers can return overlapping caption durations. A card must never
  // play into the next card, even when its source cue remains on screen.
  return result.map(({ lastIndex, ...phrase }, index) => ({
    ...phrase, end: Math.min(phrase.end, result[index + 1]?.start ?? Infinity)
  }));
}

export function phraseRange(phrases, index, start = phrases[index]?.start, end = phrases[index]?.end) {
  const nextStart = phrases[index + 1]?.start;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
    throw new Error("End must be later than Start.");
  }
  if (Number.isFinite(nextStart)) {
    if (start >= nextStart) throw new Error("Start must be before the next phrase.");
    end = Math.min(end, nextStart);
  }
  return { start, end, ...(Number.isFinite(nextStart) ? { nextStart } : {}) };
}

// Caption blocks do not provide exact word times. Split their text first,
// interpolating internal word boundaries explicitly as estimates. Never
// claim these are acoustic silence measurements.
export function buildPracticePhrases(cues, { mode = "pause", targetSeconds = 7 } = {}) {
  if (!["pause", "seven"].includes(mode)) throw new Error("Unknown phrase mode.");
  const sorted = cues.filter(c => Number.isFinite(c.start) && Number.isFinite(c.end)
    && c.start >= 0 && c.end > c.start && typeof c.text === "string" && c.text.trim())
    .sort((a, b) => a.start - b.start);
  // Several provider rows can share a timestamp. Keep all their text rather
  // than creating zero-length practice cards.
  const clean = [];
  for (const cue of sorted) {
    const previous = clean.at(-1);
    if (previous?.start === cue.start) {
      previous.text += " " + cue.text.trim();
      previous.end = Math.max(previous.end, cue.end);
    } else clean.push({ ...cue, text: cue.text.trim() });
  }
  const units = [];
  let sentence = null;
  const finish = () => { if (sentence) units.push(sentence); sentence = null; };
  const endsSentence = word => /[.!?。！？]["'”’)\]]*$/.test(word)
    && !/^(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|e\.g|i\.e)\.$/i.test(word)
    && !/^(?:[A-Z]\.){2,}$/.test(word);

  clean.forEach((cue, index) => {
    const nextStart = clean[index + 1]?.start;
    const end = Math.min(cue.end, nextStart ?? Infinity);
    const tokens = cue.text.trim().match(/\S+/g) || [];
    const totalWeight = tokens.reduce((sum, word) => sum + word.length + 1, 0);
    let weight = 0;
    tokens.forEach((word, tokenIndex) => {
      const start = cue.start + (end - cue.start) * weight / totalWeight;
      weight += word.length + 1;
      const stop = tokenIndex === tokens.length - 1 ? end : cue.start + (end - cue.start) * weight / totalWeight;
      const pause = sentence && tokenIndex === 0 && clean[index - 1]?.reliableEnd !== false && start - sentence.end >= 0.35;
      const speakerChange = sentence && cue.speaker && sentence.speaker && cue.speaker !== sentence.speaker;
      if (pause || speakerChange) finish();
      if (!sentence) sentence = { start, end: stop, text: word, speaker: cue.speaker || "", estimatedTiming: tokenIndex > 0 };
      else { sentence.text += " " + word; sentence.end = Math.max(sentence.end, stop); }
      if (endsSentence(word)) {
        sentence.estimatedTiming ||= tokenIndex < tokens.length - 1;
        finish();
      }
    });
  });
  finish();
  let result = units;
  if (mode === "seven") {
    result = [];
    let group = null;
    for (const unit of units) {
      if (group) {
        const current = group.end - group.start;
        const combined = unit.end - group.start;
        if ((unit.speaker && group.speaker && unit.speaker !== group.speaker) || unit.start - group.end >= 2 ||
            (combined > targetSeconds && Math.abs(current - targetSeconds) <= Math.abs(combined - targetSeconds))) {
          result.push(group); group = null;
        }
      }
      if (!group) group = { ...unit };
      else {
        group.text += " " + unit.text;
        group.end = unit.end;
        group.estimatedTiming ||= unit.estimatedTiming;
      }
      if (group.end - group.start >= targetSeconds) { result.push(group); group = null; }
    }
    if (group) result.push(group);
  }
  return result.map((phrase, index) => ({
    ...phrase, end: Math.min(phrase.end, result[index + 1]?.start ?? Infinity)
  })).filter(phrase => phrase.end > phrase.start);
}

export function recordingKey(phrase) {
  return `${phrase.start.toFixed(4)}:${phrase.end.toFixed(4)}:${phrase.text}`;
}

export function clock(seconds) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
