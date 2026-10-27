// Presentation shortcuts only. The panel dispatches these to the same actions
// used by its buttons; capture, transcription and saved documents are unchanged.
export function practiceShortcut(event, { count, selected, editing, changing, loading, busy, recordingIndex, hasTake }) {
  if (!count || editing || changing || loading || event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (event.target?.closest?.('input, textarea, select, button:not(.phrase-play), a, summary, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return null;
  const index = selected >= 0 ? selected : 0;
  if (event.key === " " || event.code === "Space") return { type: "record", index: busy ? recordingIndex : index };
  if (busy) return null;
  if (event.key?.toLowerCase() === "h" && hasTake(index)) return { type: "hear", index };
  if (event.key === "ArrowDown" && index < count - 1) return { type: "play", index: index + 1 };
  if (event.key === "ArrowUp" && index > 0) return { type: "play", index: index - 1 };
  return null;
}
