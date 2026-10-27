import { buildPracticePhrases, recordingKey, phraseRange, clock } from "./captions.mjs";
import { getActiveVideo } from "./connection.mjs";
import { fetchTranscript } from "./transcript-api.mjs";
import { createKeyStore } from "./key-store.mjs";
import { PageRecorder } from "./page-recorder.mjs";
import { createTranscriptStore } from "./transcript-store.mjs";
import { currentPhrase } from "./playback-sync.mjs";
import { practiceShortcut } from "./panel-ui.mjs";
import { createPhraseDocument, documentPhrases, savePhraseDocument, editPhrase, mergeAdjacent, undoMerge } from "./phrase-document.mjs";
const $ = id => document.getElementById(id);
let tabId, id, cues = [], phrases = [], selected = -1, rows = [];
let contextVersion = 0, recordingIndex = -1, hearingIndex = -1, audioRequest = 0;
const voice = new PageRecorder({
  connect: () => chrome.tabs.connect(tabId, { name: "shadow-speak-voice-v1", frameId: 0 }),
  videoId: () => id
});
const keyStore = createKeyStore(chrome.storage.local);
const transcriptStore = createTranscriptStore(chrome.storage.local);
const recordings = new Map();
const transcriptCache = new Map(), pendingJobs = new Map();
let foldedKeys = new Set(), foldWrite = Promise.resolve();
let phraseDocument = null, documentWrite = Promise.resolve(), editingIndex = -1, changing = false, dragging = null;
const documentsCache = new Map();
let latestInfo = null, syncTimer = null, closed = false;
let cloudRequest = null;
// The rendered split. The dropdown only stages a choice until ↻ applies it.
let appliedMode = "pause";
let savedKey = "";
let selectedMicrophone = "";
const microphoneReady = chrome.storage.local.get("microphoneDeviceId").then(settings => {
  selectedMicrophone = settings.microphoneDeviceId || "";
}).catch(() => {});
const modeReady = chrome.storage.local.get("phraseMode").then(settings => {
  if (["pause", "seven"].includes(settings.phraseMode)) $("split-mode").value = appliedMode = settings.phraseMode;
}).catch(() => {});

function showMicrophones(inputs) {
  const select = $("microphone");
  select.replaceChildren();
  const choices = [{ id: "", label: "System default" }, ...inputs];
  if (selectedMicrophone && !choices.some(choice => choice.id === selectedMicrophone)) {
    choices.push({ id: selectedMicrophone, label: "Selected microphone unavailable — choose another" });
  }
  for (const choice of choices) {
    const option = document.createElement("option");
    option.value = choice.id; option.textContent = choice.label;
    select.append(option);
  }
  select.value = selectedMicrophone;
}
async function refreshMicrophones() {
  await microphoneReady;
  if (!tabId || !id) return;
  const version = contextVersion;
  const result = await chrome.tabs.sendMessage(tabId, { channel: "shadow-speak-audio", type: "inputs", id });
  if (version !== contextVersion) return;
  if (!result?.ok) throw new Error(result?.error || "Refresh YouTube to load the microphone controls.");
  showMicrophones(result.inputs || []);
}
$("microphone-refresh").addEventListener("click", async () => {
  try { await refreshMicrophones(); }
  catch (error) { $("microphone-status").textContent = error.message; }
});
$("microphone").addEventListener("change", async () => {
  selectedMicrophone = $("microphone").value;
  await chrome.storage.local.set({ microphoneDeviceId: selectedMicrophone });
  $("microphone-status").textContent = "";
});

function cloudBusy(busy) {
  for (const name of ["cloud-load", "api-key", "save-key", "forget-key", "change-key", "ai-fallback", "split-mode", "split-refresh", "microphone", "microphone-refresh"]) $(name).disabled = busy;
  $("cloud-cancel").hidden = !busy;
}

function status(text, error = false) { $("status").textContent = text; $("status").classList.toggle("error", error); }
async function command(type, extra = {}) {
  if (!tabId) throw new Error("Open a YouTube video and load its transcript first.");
  let result;
  try { result = await chrome.tabs.sendMessage(tabId, { channel: "shadow-speak", type, id, ...extra }); }
  catch { throw new Error("Refresh the YouTube page after installing the extension, then try again."); }
  if (!result?.ok) throw new Error(result?.error || "The player did not respond.");
  return result;
}
async function bind(connected) {
  if (voice.busy) throw new Error("Finish your recording first.");
  connected ||= await getActiveVideo(chrome.tabs);
  if (tabId && id) await command("cancel").catch(() => {});
  tabId = connected.tabId;
  const info = connected.info;
  id = info.id;
  latestInfo = info;
  contextVersion++;
  stopHearing();
  recordings.forEach(URL.revokeObjectURL);
  recordings.clear();
  cues = []; phrases = []; rows = []; selected = -1;
  foldedKeys = new Set(); phraseDocument = null; editingIndex = -1; clearDrag();
  $("phrases").replaceChildren();
  return info;
}
function updateRowButtons() {
  $("microphone").disabled = $("microphone-refresh").disabled = voice.busy || Boolean(cloudRequest);
  const editing = editingIndex >= 0;
  $("cloud-load").disabled = Boolean(cloudRequest) || voice.busy || editing || changing;
  $("split-mode").disabled = $("split-refresh").disabled = Boolean(cloudRequest) || voice.busy || editing || changing;
  rows.forEach((row, index) => {
    row.record.disabled = (voice.busy && index !== recordingIndex) || editing || changing;
    row.record.textContent = index === recordingIndex && voice.busy
      ? (voice.recording ? "■ Stop" : "Cancel") : "Record";
    row.hear.disabled = voice.busy || editing || changing || !recordings.has(row.key);
    row.hear.textContent = index === hearingIndex ? "Stop" : "Hear";
    row.hear.setAttribute("aria-label", index === hearingIndex ? "Stop recording playback" : "Hear recording");
    row.hear.classList.toggle("is-playing", index === hearingIndex);
    row.card.classList.toggle("is-recording", voice.recording && index === recordingIndex);
    row.card.classList.toggle("is-requesting", voice.busy && !voice.recording && index === recordingIndex);
    row.card.classList.toggle("is-hearing", index === hearingIndex);
    row.card.classList.toggle("is-editing", index === editingIndex);
    row.play.disabled = voice.busy || editing || changing;
    row.edit.disabled = voice.busy || editing || changing;
    row.undo.disabled = voice.busy || editing || changing;
    row.drag.disabled = voice.busy || editing || changing;
    row.drag.draggable = !row.drag.disabled;
    row.save.disabled = row.cancelEdit.disabled = changing;
    row.fold.disabled = (voice.busy && index === recordingIndex) || index === editingIndex || changing;
    row.signal.hidden = !(voice.busy && index === recordingIndex && voice.recording);
  });
}
function stopHearing() {
  if (hearingIndex >= 0 && rows[hearingIndex]) rows[hearingIndex].note.textContent = "Click Hear to listen";
  audioRequest++;
  $("voice-playback").pause();
  $("voice-playback").removeAttribute("src");
  $("voice-playback").load();
  hearingIndex = -1;
  updateRowButtons();
}
function range(index) {
  return { ...phraseRange(phrases, index), rate: Number($("rate").value) };
}
async function play(index) {
  if (voice.busy) throw new Error("Finish recording before playing the original.");
  stopHearing();
  await command("play", range(index));
  highlight(index);
  status("");
}

function highlight(index) {
  if (selected === index) return;
  selected = index;
  rows.forEach((row, i) => {
    row.card.classList.toggle("active", i === index);
    if (i === index) row.card.setAttribute("aria-current", "true");
    else row.card.removeAttribute("aria-current");
  });
  if (index >= 0 && editingIndex < 0 && !dragging) rows[index].card.scrollIntoView({ behavior: "smooth", block: "center" });
}
function followVideo(info) {
  latestInfo = info;
  if (Number.isFinite(info.currentTime)) highlight(currentPhrase(phrases, info.currentTime, info.isAd));
}

function foldRow(row, folded) {
  row.card.classList.toggle("folded", folded);
  row.fold.textContent = folded ? "+" : "−";
  row.fold.title = folded ? "Expand phrase" : "Fold phrase";
  row.fold.setAttribute("aria-label", row.fold.title);
  row.fold.setAttribute("aria-expanded", String(!folded));
}

async function record(index) {
  if (voice.busy) {
    if (recordingIndex === index) { await voice.stop(); return; }
    throw new Error("Finish the current recording first.");
  }
  const version = contextVersion, row = rows[index];
  const connected = await getActiveVideo(chrome.tabs);
  if (version !== contextVersion || rows[index] !== row) return;
  if (voice.busy) return;
  if (connected.tabId !== tabId || connected.info.id !== id) throw new Error("Return to the YouTube video, then click Record again.");
  stopHearing();
  recordingIndex = index;
  row.level.value = 0;
  row.levelText.textContent = "";
  row.recordClock.textContent = "0:00";
  status("");
  await voice.start({
    deviceId: selectedMicrophone,
    beforeStart: async () => {
      await command("stop");
      if (version !== contextVersion) throw new Error("The video changed. Choose a phrase again.");
    },
    onState: state => {
      if (version !== contextVersion) return;
      row.note.textContent = ({
        requesting: "Allow microphone access",
        recording: "Recording…",
        "recording-manual": "Recording… Click Stop",
        stopping: "Stopping…", idle: ""
      })[state];
      updateRowButtons();
    },
    onInput: (input, inputs) => {
      if (version !== contextVersion) return;
      $("microphone").title = "Using: " + input.label;
      $("microphone-status").textContent = "";
      if (inputs?.length) showMicrophones(inputs);
    },
    onLevel: level => {
      if (version !== contextVersion) return;
      if (Number.isFinite(level.elapsed)) row.recordClock.textContent = clock(level.elapsed / 1000);
      row.level.value = level.available ? Math.min(1, Math.sqrt(level.rms) * 3) : 0;
      row.levelText.textContent = !level.available ? "Meter unavailable"
        : level.elapsed > 1500 && level.peakRms < 0.00005 ? "No input"
        : "";
    },
    onComplete: blob => {
      if (version !== contextVersion) return;
      if (recordings.has(row.key)) URL.revokeObjectURL(recordings.get(row.key));
      recordings.set(row.key, URL.createObjectURL(blob));
      row.note.textContent = "Click Hear to listen";
      updateRowButtons();
    },
    onError: error => {
      if (version !== contextVersion) return;
      row.note.textContent = error.message;
      status(error.message, true);
    }
  });
}

async function hear(index) {
  if (voice.busy) throw new Error("Finish recording before listening.");
  if (hearingIndex === index) { stopHearing(); return; }
  const url = recordings.get(rows[index].key);
  if (!url) return;
  stopHearing();
  const version = contextVersion, request = audioRequest;
  await command("stop");
  if (version !== contextVersion || request !== audioRequest) return;
  hearingIndex = index;
  $("voice-playback").src = url;
  $("voice-playback").muted = false;
  $("voice-playback").volume = 1;
  $("voice-playback").playbackRate = 1;
  rows[index].note.textContent = "Playing…";
  updateRowButtons();
  try { await $("voice-playback").play(); }
  catch (error) { stopHearing(); throw error; }
}

function clearDrag() {
  dragging = null;
  rows.forEach(row => {
    row.card.classList.toggle("merge-target", false);
    row.card.classList.toggle("dragging", false);
  });
}
function canDrop(index) {
  return dragging && dragging.document === phraseDocument && dragging.version === contextVersion &&
    !voice.busy && !changing && editingIndex < 0 && Math.abs(dragging.index - index) === 1;
}
function cancelEditing() {
  if (editingIndex >= 0 && rows[editingIndex]) rows[editingIndex].editor.hidden = true;
  editingIndex = -1;
  updateRowButtons();
}
function openEditor(index) {
  if (voice.busy || changing || editingIndex >= 0) return;
  stopHearing();
  const row = rows[index];
  editingIndex = index;
  row.textarea.value = phrases[index].text;
  row.editor.hidden = false;
  updateRowButtons();
  row.textarea.focus();
}
async function changeDocument(next) {
  if (voice.busy || changing || cloudRequest) throw new Error("Finish the current action first.");
  changing = true;
  updateRowButtons();
  const version = contextVersion, previous = phraseDocument;
  stopHearing();
  try {
    await command("cancel").catch(() => {});
    if (version !== contextVersion || previous !== phraseDocument || closed) return;
    phraseDocument = next;
    const state = savePhraseDocument(next), videoId = id, mode = appliedMode;
    documentsCache.set(`${videoId}:${mode}`, state);
    const nextVersion = ++contextVersion;
    render();
    const write = documentWrite.catch(() => {}).then(() => transcriptStore.saveDocument(videoId, mode, state));
    documentWrite = write.catch(() => {});
    try { await write; }
    catch {
      if (nextVersion === contextVersion) status("Changes could not be saved on this device. They will be lost when the panel closes.", true);
    }
  } finally {
    changing = false;
    updateRowButtons();
  }
}

function render() {
  stopHearing();
  clearDrag();
  editingIndex = -1;
  phrases = documentPhrases(phraseDocument);
  splitTitle();
  selected = -1;
  rows = [];
  $("phrases").replaceChildren();
  phrases.forEach((phrase, index) => {
    const card = document.createElement("article"); card.className = "phrase";
    card.classList.toggle("merged", phrase.merged);
    const button = document.createElement("button");
    button.className = "phrase-play";
    button.title = "Play only this phrase";
    const time = document.createElement("span"); time.className = "time"; time.textContent = clock(phrase.start);
    const text = document.createElement("span"); text.className = "phrase-text";
    text.id = `phrase-text-${index}`;
    if (phrase.speaker) { const speaker = document.createElement("span"); speaker.className = "speaker"; speaker.textContent = phrase.speaker; text.append(speaker); }
    text.append(document.createTextNode(phrase.text));
    button.append(time, text);
    button.setAttribute("aria-label", `Play phrase at ${clock(phrase.start)}: ${phrase.text}`);
    button.addEventListener("click", safe(() => play(index)));
    const actions = document.createElement("div"); actions.className = "phrase-actions";
    const recordButton = document.createElement("button"); recordButton.textContent = "Record"; recordButton.className = "phrase-record"; recordButton.title = "Record / Stop (Space)";
    const hearButton = document.createElement("button"); hearButton.textContent = "Hear"; hearButton.className = "phrase-hear"; hearButton.title = "Hear recording (H)";
    const edit = document.createElement("button"); edit.textContent = "Edit"; edit.className = "phrase-edit"; edit.title = "Edit phrase"; edit.setAttribute("aria-label", "Edit phrase");
    recordButton.addEventListener("click", safe(() => record(index)));
    hearButton.addEventListener("click", safe(() => hear(index)));
    edit.addEventListener("click", () => openEditor(index));
    const recordClock = document.createElement("output"); recordClock.className = "recording-clock";
    recordClock.setAttribute("aria-live", "off");
    recordClock.setAttribute("aria-label", "Recording elapsed time"); recordClock.textContent = "0:00";
    actions.append(recordButton, hearButton, edit, recordClock);
    const note = document.createElement("p"); note.className = "phrase-note"; note.setAttribute("role", "status");
    const signal = document.createElement("div"); signal.className = "input-signal"; signal.hidden = true;
    const level = document.createElement("meter"); level.min = 0; level.max = 1; level.value = 0;
    level.setAttribute("aria-label", "Microphone input level");
    const levelText = document.createElement("span");
    signal.append(level, levelText);
    const editor = document.createElement("form"); editor.className = "phrase-editor"; editor.hidden = true;
    const textarea = document.createElement("textarea"); textarea.rows = 4;
    textarea.setAttribute("aria-label", "Phrase text");
    const editActions = document.createElement("div"); editActions.className = "edit-actions";
    const save = document.createElement("button"); save.textContent = "Save"; save.type = "submit";
    const cancelEdit = document.createElement("button"); cancelEdit.textContent = "Cancel"; cancelEdit.type = "button";
    cancelEdit.addEventListener("click", cancelEditing);
    const saveEdit = safe(async event => {
      event.preventDefault();
      await changeDocument(editPhrase(phraseDocument, index, textarea.value));
    });
    editor.addEventListener("submit", saveEdit);
    textarea.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); cancelEditing(); }
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void saveEdit(event);
    });
    editActions.append(save, cancelEdit);
    editor.append(textarea, editActions);
    const fold = document.createElement("button"); fold.className = "phrase-fold"; fold.type = "button";
    fold.setAttribute("aria-controls", text.id);
    const undo = document.createElement("button"); undo.className = "phrase-undo"; undo.type = "button";
    undo.textContent = "Unfold"; undo.title = "Unfold: undo latest merge"; undo.setAttribute("aria-label", "Unfold merged phrase"); undo.hidden = !phrase.merged;
    undo.addEventListener("click", safe(() => changeDocument(undoMerge(phraseDocument, index))));
    const drag = document.createElement("button"); drag.className = "phrase-drag"; drag.type = "button"; drag.draggable = true;
    drag.textContent = "⠿"; drag.title = "Drag onto the previous or next phrase to merge. Or use Alt + Up / Down.";
    drag.setAttribute("aria-label", "Drag to merge adjacent phrases");
    drag.setAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown");
    drag.addEventListener("dragstart", event => {
      if (voice.busy || changing || editingIndex >= 0) { event.preventDefault(); return; }
      dragging = { document: phraseDocument, version: contextVersion, index };
      event.dataTransfer.setData("application/x-shadow-speak-phrase", phrase.nodeId);
      event.dataTransfer.effectAllowed = "move";
      card.classList.toggle("dragging", true);
    });
    drag.addEventListener("dragend", clearDrag);
    drag.addEventListener("keydown", safe(async event => {
      if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        await changeDocument(mergeAdjacent(phraseDocument, index, index + (event.key === "ArrowUp" ? -1 : 1)));
      }
    }));
    card.addEventListener("dragover", event => {
      if (!canDrop(index)) return;
      event.preventDefault(); event.dataTransfer.dropEffect = "move";
      card.classList.toggle("merge-target", true);
    });
    card.addEventListener("dragleave", () => card.classList.toggle("merge-target", false));
    card.addEventListener("drop", safe(async event => {
      if (!canDrop(index)) return;
      event.preventDefault();
      const from = dragging.index;
      clearDrag();
      await changeDocument(mergeAdjacent(phraseDocument, from, index));
    }));
    const row = { recordClock, key: recordingKey(phrase), foldKey: phrase.foldKey, card, play: button, fold, undo, drag, edit, editor, textarea, save, cancelEdit,
      record: recordButton, hear: hearButton, note, signal, level, levelText };
    if (recordings.has(row.key)) note.textContent = "Click Hear to listen";
    foldRow(row, foldedKeys.has(row.foldKey));
    const toggleFold = () => {
      const folded = !foldedKeys.has(row.foldKey);
      if (folded) foldedKeys.add(row.foldKey); else foldedKeys.delete(row.foldKey);
      foldRow(row, folded);
      const videoId = id, mode = appliedMode, keys = [...foldedKeys], version = contextVersion;
      foldWrite = foldWrite.catch(() => {}).then(() => transcriptStore.saveFolds(videoId, mode, keys)).catch(() => {
        if (version === contextVersion) status("Could not save folded phrases on this device.", true);
      });
    };
    fold.addEventListener("click", toggleFold);
    card.append(button, actions, note, editor, signal, fold, undo, drag);
    rows.push(row);
    $("phrases").append(card);
  });
  updateRowButtons();
  status(phrases.length ? "" : "No timed captions found.", !phrases.length);
  if (latestInfo) followVideo(latestInfo);
}
const safe = handler => async (...args) => { try { await handler(...args); } catch (error) { status(error.message, true); } };
function setKeyEditor(editing) {
  $("api-setup").hidden = !editing;
  $("change-key").hidden = !savedKey;
  $("change-key").textContent = "⚙";
  $("change-key").title = editing ? "Close API key settings" : "Change API key";
  $("change-key").setAttribute("aria-label", $("change-key").title);
  $("change-key").setAttribute("aria-expanded", String(editing));
  $("cloud").classList.toggle("connected", !editing);
}
const keyReady = keyStore.read().then(key => {
  savedKey = key;
  if (!$("api-key").value) $("api-key").value = key;
  setKeyEditor(!key);
}).catch(() => {
  setKeyEditor(true);
  status("Could not read settings. Reload the extension.", true);
});
async function saveKey() {
  await keyReady;
  await keyStore.save($("api-key").value);
  savedKey = $("api-key").value.trim();
  setKeyEditor(false);
}
$("save-key").addEventListener("click", safe(async () => {
  await saveKey();
  $("change-key").focus();
}));
$("change-key").addEventListener("click", () => {
  const opening = $("api-setup").hidden;
  if (!opening) $("api-key").value = savedKey;
  setKeyEditor(opening);
  if (opening) $("api-key").focus();
});
$("forget-key").addEventListener("click", safe(async () => {
  await keyReady;
  await keyStore.clear();
  savedKey = "";
  $("api-key").value = "";
  setKeyEditor(true);
  status("");
}));
$("cloud-cancel").addEventListener("click", () => {
  cloudRequest?.abort();
});
async function readSaved(videoId) {
  if (transcriptCache.has(videoId)) return transcriptCache.get(videoId);
  let result;
  try { result = await transcriptStore.read(videoId); }
  catch { throw new Error("Could not read saved transcripts. No API request was made. Reload the extension."); }
  if (result) transcriptCache.set(videoId, result);
  return result;
}
function splitTitle() {
  $("split-mode").title = $("split-mode").value === "seven"
    ? "Targets 7 seconds near sentence or caption boundaries; long blocks are split. Internal word times are estimates. Click ↻ to apply."
    : "Uses sentence endings and caption gaps as approximate pauses, with a 7–10 second fallback for long runs. Does not detect audio silence. Click ↻ to apply.";
  $("split-refresh").classList.toggle("pending", $("split-mode").value !== appliedMode);
}
async function showResult(result, version) {
  const videoId = id, mode = appliedMode;
  await Promise.all([foldWrite, documentWrite]);
  const [folds, saved] = await Promise.all([
    transcriptStore.readFolds(videoId, mode),
    documentsCache.has(`${videoId}:${mode}`) ? documentsCache.get(`${videoId}:${mode}`) : transcriptStore.readDocument(videoId, mode)
  ]);
  if (version !== contextVersion) return;
  if (mode !== appliedMode) return showResult(result, version);
  const base = buildPracticePhrases(result.cues, { mode });
  // Saved edits belong to one exact split. If splitting rules changed, start
  // from the new split instead of leaving the panel empty.
  let next, reset = false;
  try { next = createPhraseDocument(base, saved); }
  catch { next = createPhraseDocument(base); reset = true; }
  cues = result.cues;
  foldedKeys = folds;
  phraseDocument = next;
  documentsCache.set(`${videoId}:${mode}`, savePhraseDocument(next));
  render();
  if (reset) status("This transcript is now split differently, so earlier edits and merges for it were not applied.", true);
  await refreshMicrophones().catch(error => {
    if (version === contextVersion) $("microphone-status").textContent = error.message;
  });
}
$("cloud-load").addEventListener("click", safe(async () => {
  if (cloudRequest) return;
  const request = new AbortController();
  cloudRequest = request;
  cloudBusy(true);
  status("Loading…");
  let cacheKey, version;
  try {
    await modeReady;
    await bind();
    request.signal.throwIfAborted();
    version = contextVersion;
    const videoId = id, targetTab = tabId;
    // Check disk before asking for a key or contacting the paid provider.
    let result = await readSaved(videoId);
    let saveWarning = false;
    if (!result) {
      await keyReady;
      await saveKey();
      const apiKey = savedKey;
      const mode = $("ai-fallback").checked ? "auto" : "native";
      cacheKey = `${videoId}:${mode}`;
      result = await fetchTranscript({
        videoId, apiKey, mode, signal: request.signal,
        jobId: pendingJobs.get(cacheKey),
        onJob: jobId => pendingJobs.set(cacheKey, jobId),
        onProgress: () => { if (version === contextVersion) status("Loading…"); }
      });
      transcriptCache.set(videoId, result);
      pendingJobs.delete(cacheKey);
      try { await transcriptStore.save(videoId, result); }
      catch { saveWarning = true; }
    }
    request.signal.throwIfAborted();
    if (version !== contextVersion) return;
    const current = await getActiveVideo(chrome.tabs);
    if (current.tabId !== targetTab || current.info.id !== videoId) throw new Error("The video changed. Select the intended video and get its transcript again.");
    latestInfo = current.info;
    request.signal.throwIfAborted();
    await showResult(result, version);
    if (saveWarning && version === contextVersion) status("Transcript loaded, but could not be saved on this device. Local storage may be full; reopening could use credits.", true);
  } catch (error) {
    if (error.jobFailed && cacheKey) pendingJobs.delete(cacheKey);
    if (version === undefined || version === contextVersion) status(request.signal.aborted ? "" : error.message, !request.signal.aborted);
  } finally {
    if (cloudRequest === request) { cloudRequest = null; cloudBusy(false); updateRowButtons(); }
  }
}));
$("split-mode").addEventListener("change", () => {
  splitTitle();
  if (cues.length && $("split-mode").value !== appliedMode) status("Click ↻ to re-split the transcript.");
});
$("split-refresh").addEventListener("click", safe(async () => {
  await voice.stop();
  appliedMode = $("split-mode").value;
  splitTitle();
  await chrome.storage.local.set({ phraseMode: appliedMode });
  if (cues.length) {
    await command("cancel");
    const version = ++contextVersion;
    await showResult({ cues }, version);
  }
}));
$("rate").addEventListener("input", safe(async () => {
  const rate = Number($("rate").value);
  $("rate-value").textContent = `${rate.toFixed(2)}×`;
  $("rate").setAttribute("aria-valuetext", `${rate.toFixed(2)} times`);
  if (tabId && id) await command("rate", { rate });
}));
$("voice-playback").addEventListener("ended", () => {
  if (hearingIndex >= 0 && rows[hearingIndex]) rows[hearingIndex].note.textContent = "Click Hear to listen";
  hearingIndex = -1;
  updateRowButtons();
});
$("voice-playback").addEventListener("error", () => {
  if (hearingIndex < 0) return;
  const message = "Could not play recording. Record again.";
  rows[hearingIndex].note.textContent = message;
  hearingIndex = -1;
  status(message, true);
  updateRowButtons();
});
function invalidate() {
  cloudRequest?.abort();
  contextVersion++;
  void voice.stop({ discard: true });
  stopHearing();
  if (tabId && id) command("cancel").catch(() => {});
  recordings.forEach(URL.revokeObjectURL);
  recordings.clear();
  cues = []; phrases = []; rows = []; selected = -1;
  $("phrases").replaceChildren();
  tabId = null; id = null; latestInfo = null; foldedKeys = new Set();
  phraseDocument = null; editingIndex = -1; clearDrag();
  status("");
}
chrome.tabs.onActivated.addListener(({ tabId: nextTab }) => {
  if (tabId && nextTab !== tabId) invalidate();
});
chrome.tabs.onUpdated.addListener((changedTab, change) => {
  if (changedTab === tabId && change.url && new URL(change.url).searchParams.get("v") !== id) invalidate();
});
window.addEventListener("pagehide", () => {
  closed = true;
  clearTimeout(syncTimer);
  cloudRequest?.abort();
  $("api-key").value = "";
  contextVersion++;
  void voice.stop({ discard: true });
  stopHearing();
  recordings.forEach(URL.revokeObjectURL);
  if (tabId && id) command("cancel").catch(() => {});
});

// Only local player/storage messages run automatically. A cache miss never
// calls Supadata; that still requires an explicit Get full transcript click.
async function syncVideo() {
  try {
    await modeReady;
    if (closed || cloudRequest) return;
    const connected = await getActiveVideo(chrome.tabs);
    if (closed || cloudRequest) return;
    if (connected.tabId !== tabId || connected.info.id !== id) {
      invalidate();
      await bind(connected);
      const version = contextVersion;
      try {
        const result = await readSaved(id);
        if (result && version === contextVersion && !closed) await showResult(result, version);
      } catch (error) {
        if (version === contextVersion) status(error.message, true);
      }
    } else followVideo(connected.info);
  } catch {
    if (!cloudRequest && tabId) invalidate();
  } finally {
    if (!closed) syncTimer = setTimeout(syncVideo, 250);
  }
}
syncTimer = setTimeout(syncVideo, 0);

// Respect native form/button keys and the existing Alt+Up/Down merge shortcut.
window.addEventListener("keydown", safe(async event => {
  const shortcutSelected = selected >= 0 ? selected
    : phrases.findLastIndex(phrase => Number.isFinite(latestInfo?.currentTime) && phrase.start <= latestInfo.currentTime);
  const action = practiceShortcut(event, {
    count: rows.length, selected: shortcutSelected, editing: editingIndex >= 0, changing,
    loading: Boolean(cloudRequest), busy: voice.busy, recordingIndex,
    hasTake: index => recordings.has(rows[index]?.key)
  });
  if (!action || action.index < 0) return;
  event.preventDefault();
  if (action.type === "record") await record(action.index);
  else if (action.type === "hear") await hear(action.index);
  else await play(action.index);
}));
// Keep centered phrases below the actual sticky controls, including errors
// and responsive text wrapping, without hardcoding a guessed toolbar height.
if (typeof ResizeObserver !== "undefined") {
  const toolbarObserver = new ResizeObserver(entries => {
    document.documentElement.style.setProperty("--toolbar-height", `${entries[0].target.getBoundingClientRect().height}px`);
  });
  toolbarObserver.observe($("practice-toolbar"));
  window.addEventListener("pagehide", () => toolbarObserver.disconnect());
}
