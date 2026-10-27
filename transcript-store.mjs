// Raw timed captions are independent of phrase grouping and provider mode.
// Never expire or evict a saved transcript automatically: refetching costs credits.
const PREFIX = "transcript:v1:";
function videoKey(videoId) {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId || "")) throw new Error("Invalid YouTube video ID.");
  return PREFIX + videoId;
}
function cleanResult(result) {
  if (!Array.isArray(result?.cues) || !result.cues.length) throw new Error("Saved transcript is unreadable. No new API request was made.");
  const cues = result.cues.map(cue => {
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start ||
        typeof cue.text !== "string" || !cue.text.trim()) throw new Error("Saved transcript is unreadable. No new API request was made.");
    return { start: cue.start, end: cue.end, text: cue.text, reliableEnd: cue.reliableEnd !== false,
      ...(typeof cue.speaker === "string" && cue.speaker ? { speaker: cue.speaker } : {}) };
  });
  return { cues, language: typeof result.language === "string" ? result.language : "" };
}

export function createTranscriptStore(storage) {
  return {
    async read(videoId) {
      const key = videoKey(videoId), data = await storage.get(key);
      return data[key] === undefined ? null : cleanResult(data[key]);
    },
    async save(videoId, result) {
      await storage.set({ [videoKey(videoId)]: cleanResult(result) });
    },
    async readFolds(videoId, mode) {
      const key = `${videoKey(videoId)}:folds:${mode}`, data = await storage.get(key);
      return new Set(Array.isArray(data[key]) ? data[key].filter(value => typeof value === "string") : []);
    },
    async saveFolds(videoId, mode, keys) {
      await storage.set({ [`${videoKey(videoId)}:folds:${mode}`]: [...keys] });
    },
    async readDocument(videoId, mode) {
      const key = `${videoKey(videoId)}:phrases:v1:${mode}`, data = await storage.get(key);
      return data[key] ?? null;
    },
    async saveDocument(videoId, mode, state) {
      await storage.set({ [`${videoKey(videoId)}:phrases:v1:${mode}`]: state });
    }
  };
}
