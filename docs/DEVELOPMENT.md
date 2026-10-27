# Development and implementation notes

See the [product overview](../README.md) and [release history](../CHANGELOG.md). These notes describe the current implementation and its limits.

## Install in Chrome

1. Download this repository using **Code → Download ZIP** and extract it, or clone it with Git.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the extracted repository folder containing `manifest.json`.
4. Refresh YouTube, open a video, then click Shadow Speak’s toolbar icon.
5. Enter your own Supadata API key once. Each user’s key remains in their own browser; no API key is bundled in this repository.

## Update an existing installation

Replace the files in the same folder Chrome already loads, or pull the latest changes if you cloned this repository. Click Reload on Shadow Speak at `chrome://extensions`, refresh YouTube, then reopen the panel. Keeping the same installed folder retains the saved key and microphone choice.

This update uses extension manifest version **0.7.5**. No additional permissions are required.

## Use

Open a regular YouTube video and click **Shadow** below it, or use the extension toolbar icon. Saved transcripts appear automatically; use **Get full transcript** for a video that has not been saved yet.

1. Enter a Supadata API key once, then click Save key or Get full transcript. Change API key reopens the editor.
2. Choose the intended physical microphone. If System default points to Microsoft Teams or another virtual device, choose the built-in or headset microphone explicitly. The choice is remembered locally.
3. Click a sentence to hear its video range once.
4. Click Record on that card. Allow microphone access on YouTube if asked. Recording starts automatically; the input meter shows incoming audio.
5. Stop manually or pause for approximately 1.2 seconds after speaking. Click Hear to listen. Each card retains its latest take while the panel remains open.

The actual microphone name is available as a tooltip on the microphone selector. Zero measured input produces an error instead of a blank new take. The automatic stop has a ten-second start window and a two-minute maximum. Background noise can delay the stop; use Stop if needed. If the level meter is unavailable, use manual Stop.

Recordings stay in panel memory and are never uploaded by the extension. They are cleared when the panel closes, the transcript is reloaded, or you change videos/tabs. Regrouping preserves takes for matching phrases. There is no recording export feature.

## Transcript key and a public version without key entry

The current extension directly calls [Supadata](https://docs.supadata.ai/get-transcript), so each installation needs a personal API key. It is saved in trusted local extension storage and restored on reopening. It is not synced to other devices; uninstalling clears it. Chrome local extension storage is not an encrypted vault.

Other people can use a future public version without obtaining a provider key if a hosted backend handles transcript retrieval:

1. The extension sends a video ID to your backend.
2. The backend uses your Supadata key, stored as a server secret, and returns timed captions.
3. Users receive transcripts without entering a provider key. Provider credits are charged to your account.

That service should cache shared transcript results and enforce user quotas and rate limits. A personal paid-provider key should not be bundled into a distributed extension. Login or invite codes can control access; they are product choices rather than a need to expose the provider key.

**No shared backend is configured in this release.** Removing the user key step requires implementing and deploying that service, then connecting the extension to it. See [Supadata pricing](https://supadata.ai/pricing) and [Cloudflare Workers server secrets](https://developers.cloudflare.com/workers/configuration/secrets/) for one hosting approach.

The default request uses existing captions. AI fallback is opt-in under account Options and consumes additional credits. Requests send the canonical YouTube video link to Supadata; cookies and microphone audio are not sent. A known processing job can be resumed in the current panel. Cancel stops local waiting and does not cancel provider-side processing or guarantee unused credits.

Transcripts are stored in Chrome's local extension storage, separate from API keys and microphone recordings. Saved captions have no automatic expiry or eviction. A cache miss does not trigger a provider call: only an explicit Get full transcript click can do that. A storage read error stops loading instead of silently fetching again. If saving fails (for example, local storage is full), the panel shows a warning and keeps the transcript available in memory for that session.

[Chrome local extension storage](https://developer.chrome.com/docs/extensions/reference/api/storage) has a 10 MB limit with the current permissions. Saved transcripts, edits, merges and folds stay in the same Chrome profile; they do not sync to another device. Removing the extension or clearing its extension storage deletes them. Transcripts retrieved by earlier releases cannot be recovered after those panels have closed; load them once in 0.5.0 to save them. Raw captions are kept so switching phrase mode never needs another API request.

## Timing

By pause approximates speaker pauses with sentence punctuation and caption gaps. It does not measure acoustic silence. Overlong passages are divided near seven seconds regardless of punctuation elsewhere in the video. Nearby caption edges are preferred; cuts inside a long caption block use word positions estimated from text length. Hover over the mode selector for the timing description.

Every 7 seconds groups short units near a seven-second target and splits long passages rather than carrying them through unchanged. Sentence endings can be retained up to a ten-second limit; the rare case of a single word with a longer provider duration remains intact. Each range is capped at the next card’s start. Choose a mode and click ↻ to apply it locally; no transcript API request is needed. Edit corrects words only; manually merged cells may exceed this automatic duration limit. There is no manual timing editor in this release.

The player uses a rate-aware deadline, a 10 ms boundary check and media events. Browser scheduling and inaccurate captions can affect precision. Keep YouTube visible. Normal desktop watch pages are supported; Shorts, live streams, embedded players and mobile pages are not target formats.

## Build and checks

The shipped extension is ready to load. After changing recorder sources, rebuild the packaged content script. The build uses only Node’s built-in tools:

```sh
node build.mjs
node --test tests/*.test.mjs
```

- `panel.html`, `panel.css`, `panel.mjs`: compact UI, sticky controls, recording feedback and per-card recording URLs.
- `panel-ui.mjs`: presentation-only shortcut dispatch rules.
- `captions.mjs`: sentence grouping, estimated internal timing and playback range validation.
- `voice-recorder.mjs`, `microphone-inputs.mjs`: exact input selection, measured levels, local silence detection and cleanup.
- `recording-entry.js`, `page-recorder-host.mjs`, `voice-codec.mjs`, `page-recorder.mjs`: private page/panel messages and audio transfer. `recording-content.js` is generated from these sources and the recorder.
- `content.js`, `connection.mjs`: video detection and bounded playback.
- `transcript-api.mjs`, `key-store.mjs`, `transcript-store.mjs`: transcript requests and local key/transcript/fold storage.
- `playback-sync.mjs`: phrase selection at the current video timestamp.
- `phrase-document.mjs`: text corrections, ordered adjacent merges, flat undo history and saved-layout validation.
- `launcher.js`, `launcher.css`: the Shadow button on YouTube watch pages.
- `background.js`, `manifest.json`: Chrome side-panel integration.

The manifest uses sidePanel, activeTab and storage, host access to `https://api.supadata.ai/*`, and content scripts on `https://www.youtube.com/*`. Recording runs in the page’s isolated extension context through a statically bundled script; no runtime module imports from YouTube are needed. No remote scripts or analytics are loaded.

**90 automated tests pass.** They cover video boundaries, sentence grouping, API errors, local key and microphone persistence, permission continuation, strict browser timer calls, blocked runtime imports, exact audio transfer, input levels, capture cleanup, independent per-card takes, compact recording feedback, playback, regrouping and cancellation. They also cover persistent transcript restoration without a key or provider call, saved folds, playback following and seeks, storage quota failures, stale restoration races, and the YouTube launcher. Editing/merging checks cover empty text, both drag directions, rejection of nonadjacent cells, nested and independent merges, undo after reopening, mode isolation, playback bounds, storage errors, and restoring 5,000 merged phrases without recursive JSON. Browser interfaces and media input are simulated in these tests.

## References

- [Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Chrome extension message passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)
- [Microphone access](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- [YouTube Digest](https://github.com/zarazhangrui/youtube-digest), the user-provided reference for the direct Supadata approach.
