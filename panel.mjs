import { buildPracticePhrases, recordingKey, phraseRange, clock } from "./captions.mjs";
import { getActiveVideo } from "./connection.mjs";
import { fetchTranscript } from "./transcript-api.mjs";
import { createKeyStore } from "./key-store.mjs";
import { PageRecorder } from "./page-recorder.mjs";
const $ = id => document.getElementById(id);
let tabId, id, cues = [], phrases = [], selected = -1, rows = [];
let contextVersion = 0, recordingIndex = -1, hearingIndex = -1, audioRequest = 0;
const voice = new PageRecorder({
  connect: () => chrome.tabs.connect(tabId, { name: "shadow-speak-voice-v1", frameId: 0 }),
  videoId: () => id
});
const keyStore = createKeyStore(chrome.storage.local);
const recordings = new Map();
const transcriptCache = new Map(), pendingJobs = new Map();
let cloudRequest = null;
let savedKey = "";
let selectedMicrophone = "";
const microphoneReady = chrome.storage.local.get("microphoneDeviceId").then(settings => {
  selectedMicrophone = settings.microphoneDeviceId || "";
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
  for (const name of ["cloud-load", "api-key", "save-key", "forget-key", "change-key", "ai-fallback", "split-mode", "microphone", "microphone-refresh"]) $(name).disabled = busy;
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
async function bind() {
  if (voice.busy) throw new Error("Finish your recording first.");
  const connected = await getActiveVideo(chrome.tabs);
  if (tabId && id) await command("stop").catch(() => {});
  tabId = connected.tabId;
  const info = connected.info;
  id = info.id;
  contextVersion++;
  stopHearing();
  recordings.forEach(URL.revokeObjectURL);
  recordings.clear();
  cues = []; phrases = []; rows = []; selected = -1;
  $("phrases").replaceChildren();
  return info;
}
function updateRowButtons() {
  $("microphone").disabled = $("microphone-refresh").disabled = voice.busy || Boolean(cloudRequest);
  rows.forEach((row, index) => {
    row.record.disabled = voice.busy && index !== recordingIndex;
    row.record.textContent = index === recordingIndex && voice.busy
      ? (voice.recording ? "■ Stop" : "Cancel") : "● Record";
    row.hear.disabled = voice.busy || !recordings.has(row.key);
    row.hear.textContent = index === hearingIndex ? "■ Stop" : "▶ Hear";
    row.play.disabled = voice.busy;
    row.start.disabled = row.end.disabled = voice.busy;
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
  const row = rows[index];
  const value = phraseRange(phrases, index, Number(row.start.value), Number(row.end.value));
  Object.assign(phrases[index], { start: value.start, end: value.end });
  row.end.value = value.end.toFixed(2);
  return { ...value, rate: Number($("rate").value) };
}
async function play(index) {
  if (voice.busy) throw new Error("Finish recording before playing the original.");
  stopHearing();
  selected = index;
  rows.forEach((row, i) => row.card.classList.toggle("active", i === index));
  await command("play", range(index));
  status("");
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

function render() {
  stopHearing();
  phrases = buildPracticePhrases(cues, { mode: $("split-mode").value });
  $("split-mode").title = $("split-mode").value === "seven"
    ? "Targets 7 seconds, keeping sentences intact. A long sentence may run longer. Times inside caption blocks are estimated."
    : "Uses sentence endings and caption gaps as approximate pauses. Times inside caption blocks are estimated; actual audio silence is not measured.";
  selected = -1;
  rows = [];
  $("phrases").replaceChildren();
  phrases.forEach((phrase, index) => {
    const card = document.createElement("article"); card.className = "phrase";
    const button = document.createElement("button");
    button.className = "phrase-play";
    button.title = "Play only this phrase";
    const time = document.createElement("span"); time.className = "time"; time.textContent = clock(phrase.start);
    const text = document.createElement("span"); text.className = "phrase-text";
    if (phrase.speaker) { const speaker = document.createElement("span"); speaker.className = "speaker"; speaker.textContent = phrase.speaker; text.append(speaker); }
    text.append(document.createTextNode(phrase.text));
    button.append(time, text);
    button.addEventListener("click", safe(() => play(index)));
    const actions = document.createElement("div"); actions.className = "phrase-actions";
    const recordButton = document.createElement("button"); recordButton.textContent = "● Record";
    const hearButton = document.createElement("button"); hearButton.textContent = "▶ Hear";
    recordButton.addEventListener("click", safe(() => record(index)));
    hearButton.addEventListener("click", safe(() => hear(index)));
    actions.append(recordButton, hearButton);
    const note = document.createElement("p"); note.className = "phrase-note"; note.setAttribute("role", "status");
    const signal = document.createElement("div"); signal.className = "input-signal"; signal.hidden = true;
    const level = document.createElement("meter"); level.min = 0; level.max = 1; level.value = 0;
    level.setAttribute("aria-label", "Microphone input level");
    const levelText = document.createElement("span");
    signal.append(level, levelText);
    const details = document.createElement("details"); details.className = "timing";
    const summary = document.createElement("summary"); summary.textContent = "Adjust timing";
    const inputs = document.createElement("div"); inputs.className = "settings";
    const start = document.createElement("input"), end = document.createElement("input");
    for (const [input, labelText, value] of [[start, "Start (seconds)", phrase.start], [end, "End (seconds)", phrase.end]]) {
      const label = document.createElement("label"); label.append(document.createTextNode(labelText), input);
      input.type = "number"; input.min = "0"; input.step = "0.05"; input.value = value.toFixed(2);
      input.addEventListener("change", safe(() => { range(index); }));
      inputs.append(label);
    }
    if (phrases[index + 1]) end.max = phrases[index + 1].start.toFixed(2);
    details.append(summary, inputs);
    card.append(button, actions, note, details, signal);
    rows.push({ key: recordingKey(phrase), card, play: button, record: recordButton, hear: hearButton, note, start, end, signal, level, levelText });
    $("phrases").append(card);
  });
  updateRowButtons();
  status(phrases.length ? "" : "No timed captions found.", !phrases.length);
}
const safe = handler => async (...args) => { try { await handler(...args); } catch (error) { status(error.message, true); } };
function setKeyEditor(editing) {
  $("api-setup").hidden = !editing;
  $("change-key").hidden = !savedKey;
  $("change-key").textContent = editing ? "Cancel" : "Change API key";
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
$("cloud-load").addEventListener("click", safe(async () => {
  if (cloudRequest) return;
  await keyReady;
  if (cloudRequest) return;
  const apiKey = $("api-key").value.trim();
  if (!apiKey) throw new Error("Enter your Supadata API key above, then click Get full transcript.");
  const request = new AbortController();
  cloudRequest = request;
  cloudBusy(true);
  status("Loading…");
  let cacheKey, version;
  try {
    await saveKey();
    await bind();
    request.signal.throwIfAborted();
    version = contextVersion;
    const videoId = id, targetTab = tabId;
    const mode = $("ai-fallback").checked ? "auto" : "native";
    cacheKey = `${videoId}:${mode}`;
    let result = transcriptCache.get(cacheKey);
    if (!result) {
      result = await fetchTranscript({
        videoId, apiKey, mode, signal: request.signal,
        jobId: pendingJobs.get(cacheKey),
        onJob: jobId => pendingJobs.set(cacheKey, jobId),
        onProgress: () => status("Loading…")
      });
      transcriptCache.set(cacheKey, result);
      if (transcriptCache.size > 10) transcriptCache.delete(transcriptCache.keys().next().value);
      pendingJobs.delete(cacheKey);
    }
    request.signal.throwIfAborted();
    if (version !== contextVersion) return;
    const current = await getActiveVideo(chrome.tabs);
    if (current.tabId !== targetTab || current.info.id !== videoId) throw new Error("The video changed. Select the intended video and get its transcript again.");
    request.signal.throwIfAborted();
    cues = result.cues;
    await refreshMicrophones().catch(error => { $("microphone-status").textContent = error.message; });
    render();
  } catch (error) {
    if (error.jobFailed && cacheKey) pendingJobs.delete(cacheKey);
    if (request.signal.aborted) {
      status("");
    } else {
      status(error.message, true);
    }
  } finally {
    if (cloudRequest === request) { cloudRequest = null; cloudBusy(false); }
  }
}));
$("split-mode").addEventListener("change", safe(async () => {
  await voice.stop();
  if (cues.length) {
    await command("stop");
    contextVersion++;
    render();
  } else {
    $("split-mode").title = $("split-mode").value === "seven"
      ? "Targets 7 seconds, keeping sentences intact. A long sentence may run longer."
      : "By pause uses sentence endings and caption gaps as an approximation of speaker pauses.";
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
  if (tabId && id) command("stop").catch(() => {});
  recordings.forEach(URL.revokeObjectURL);
  recordings.clear();
  cues = []; phrases = []; rows = []; selected = -1;
  $("phrases").replaceChildren();
  tabId = null; id = null;
  status("");
}
chrome.tabs.onActivated.addListener(({ tabId: nextTab }) => {
  if (tabId && nextTab !== tabId) invalidate();
});
chrome.tabs.onUpdated.addListener((changedTab, change) => {
  if (changedTab === tabId && change.url && new URL(change.url).searchParams.get("v") !== id) invalidate();
});
window.addEventListener("pagehide", () => {
  cloudRequest?.abort();
  $("api-key").value = "";
  contextVersion++;
  void voice.stop({ discard: true });
  stopHearing();
  recordings.forEach(URL.revokeObjectURL);
  if (tabId && id) command("stop").catch(() => {});
});
