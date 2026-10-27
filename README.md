# Shadow Speak 0.7.5

Practice YouTube sentences with bounded playback and per-sentence Record / Hear controls.

## Install in Chrome

1. Download this repository using **Code → Download ZIP** and extract it, or clone it with Git.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the extracted repository folder containing `manifest.json`.
4. Refresh YouTube, open a video, then click Shadow Speak’s toolbar icon.
5. Enter your own Supadata API key once. Each user’s key remains in their own browser; no API key is bundled in this repository.

## Update an existing installation

Replace the files in the same folder Chrome already loads, or pull the latest changes if you cloned this repository. Click Reload on Shadow Speak at `chrome://extensions`, refresh YouTube, then reopen the panel. Keeping the same installed folder retains the saved key and microphone choice.

This update uses extension manifest version **0.7.5**. No additional permissions are required.

## Changes in 0.7.5

- Fixed sparse-punctuation transcripts forming repeated 21-second cards in both modes. A sentence ending elsewhere in the video no longer controls the length of unpunctuated passages.
- Both modes split overlong runs near seven seconds, preferring existing caption edges in the 5–10 second window. A single long caption block can be split at estimated word boundaries instead. Words and chronological order are preserved.
- By pause retains short natural sentence and caption-gap boundaries; Every 7 seconds combines short units toward the target and also splits long units. Normally cards are no longer than ten seconds. A single word assigned an unusually long duration is kept intact because there is no safe internal word boundary.
- The dropdown still only stages a choice. Click the adjacent **↻** to apply it, including reapplying the current mode. Re-splitting uses saved raw captions and makes no Supadata request.
- Existing edits, merges and folds restore when the original boundaries still match. An incompatible old layout shows a warning instead of being applied to the wrong phrases; its saved storage record is not automatically deleted or overwritten. Recordings only carry across when their phrase timing and text still match.
- Added regression coverage for sparse punctuation, long provider blocks, later punctuation changing earlier cards, cue-boundary preference, local cache reuse and staged ↻ application. Provider data and media input are simulated in these checks.

## Changes in 0.7.4

- Added the approved soft, flowing ivory wave logo on a terracotta rounded square. PNG icons are included at 16, 32, 48, 128 and 256 pixels, with transparent outer corners.
- Chrome toolbar and extension management use the new icons; the panel header and favicon use the same artwork. The small toolbar version preserves the soft-wave appearance, with less fine detail visible at 16px.
- Recording, transcripts and the YouTube Shadow launcher are unchanged. No new permissions are required.

## Changes in 0.7.3

- Disabled Hear keeps the same full-opacity text and icon color as Edit. It remains a native disabled button, with no hover background or pointer cursor until a recording is available.

## Changes in 0.7.2

- Lighter Record control: 8px horizontal padding and a 7px dot, with the existing accent fill and recording state preserved.
- Hear and Edit share the same text color and 12px vector icons. Hear stays disabled and faded until a take exists. All three actions use 13px labels, aligned icons and 8px spacing; narrow layouts keep the Edit label visible and 32px touch targets.
- The Shadow button below YouTube videos, its opening behavior and all recorder functionality remain unchanged.
- Local preview checks confirm the three labeled actions fit a 320px panel without horizontal overflow. The existing 81 automated tests pass; no live microphone capture or provider requests were needed for this styling change.

## Changes in 0.7.1

- Removed the separate circular recording control from the right of each card. Expanded cards always show the original Record, Hear and Edit actions; Hear is disabled until a recording exists.
- The merged-card undo control is now labeled **Unfold**. It still reverses only the latest merge. Ordinary folding keeps its **− / +** controls.
- Folded cards show no sentence text or preview. Their visual height is 28px, down from 54px at the same 420px preview width (48% shorter), while controls retain 32px hit areas.
- The microphone selector is 48px high with 15px text and a wider input area. Expanded action rows remain stable while dragging adjacent cards to merge.
- Preview checks cover merging, Unfold restoration, folded content, visible Hear controls and narrow layouts without card overflow. These use simulated video and microphone input; real microphone capture was not retested for this UI-only release.

## Changes in 0.7.0

- Compact four-column phrase grid, 18px text at 1.5 line height, 8px card gaps and full-card accent highlighting. Inner playback buttons use a transparent background so they cannot paint over part of the highlight.
- Record/Hear/Edit actions appear on the current, hovered or keyboard-focused expanded card. A separate circular Record control remains available on other cards. Hear is hidden until a take exists. During recording the controls remain visible, the Record button pulses red, and elapsed time uses the recorder's existing level events; the capture implementation is unchanged.
- Folded cards show a single-line preview of approximately 30 Unicode characters. Their quick Record control unfolds the card and invokes the original Record action so Stop remains accessible.
- Sticky 56px header and sticky practice controls; matching 40px settings controls, icon buttons for API settings and microphone refresh, and no extra speed scale row. An observed toolbar height keeps centered phrases clear of the sticky controls.
- Space starts/stops recording, H plays/stops the current take, and Up/Down play the previous/next original phrase. Text inputs, edit mode, modified/repeating keys and native control interactions are excluded; the phrase play button accepts these shortcuts. Existing Alt+Up/Down merging remains unchanged.
- Narrow screens preserve the grid with a 14px handle column and secondary action icons. Card action targets grow to at least 32px on narrow/touch layouts, while regular desktop action buttons remain 28px. Reduced-motion preferences disable the recording pulse.

### UI verification

Using the same 24 sample phrases at 420 × 900 CSS pixels, mean expanded-card height decreased from **142.44px to 88.92px (37.6%)**, and fully visible cards increased from **4 to 6**. The 35% height target is met for this sample; **the requested 2× sentence density is not met at this size**. The retained 18px text, four-column layout, 32px touch targets and persistent controls limit narrow-screen density. These measurements are sample-specific, not a guarantee for every transcript.

At 320px width, the preview has no horizontal overflow and all visible button targets are at least 32px high. Browser checks cover full-root highlight coverage, sticky controls while seeking, one-click recording from a folded card, recording timer/stop, typing safety, editing, and adjacent merge/Undo. The preview uses simulated video/microphone data; no Supadata credits or real microphone capture are used for these visual checks.

## Changes in 0.6.0

- Edit replaces Adjust timing. Click Edit, correct the words, and click Save (or Cmd/Ctrl + Enter). Cancel or Escape discards a draft. Text edits do not change timestamps or resegment phrases.
- Drag the small grip at the upper-left onto the preceding or following card to merge. Only adjacent visible cards can merge, in either drag direction. The merged card preserves chronological text order and spans the earlier start through the later end. The two previous cards are replaced by that card.
- Merged cards can be merged again with either neighbor, with no artificial count limit. Merging two already-merged groups is also supported. Alt + Up / Down on the grip provides a keyboard alternative.
- Undo at the upper-right reverses only that card's latest merge: ABC made from AB + C restores AB and C, then another Undo on AB restores A and B. A child keeps the wording it had before merging. Wording entered directly on a merged parent is discarded when that merge is undone.
- Fold is now at the upper-right, marked − when expanded and + when folded. Undo remains available on a folded merged card.
- Saved edits and the complete remaining merge history restore on future visits. Each video and phrase mode has its own layout. Raw saved captions remain unchanged, and none of these actions calls Supadata. Storage failures show a warning rather than claiming the changes were saved.

## Changes in 0.5.0

- Full timed transcripts are saved on this device by YouTube video ID. Opening the panel on the same video automatically restores its transcript, including after closing the tab or restarting Chrome. No Supadata request is made for a saved transcript, even if Get full transcript is clicked again or phrase mode changes.
- A small arrow at the top-left of each card folds/unfolds its content. Folded cards keep their timestamp. This never skips or alters video playback. Fold choices are remembered separately for each video and phrase mode.
- The current phrase is highlighted and scrolled into view as YouTube plays or seeks. Manually scrolling the transcript does not change any mode or show an extra control. Folded phrases remain folded when highlighted.
- A Shadow button beside YouTube's action buttons opens the extension. It is restored when YouTube rebuilds that area during navigation. Refresh already-open YouTube tabs after updating.
- Manual YouTube seeks release any previous sentence stop boundary and preserve normal playback.

## Earlier UI changes

- Removed the separate Stop video control, phrase count and video title from the panel. Sentence playback still pauses automatically at its boundary.

- Removed recording downloads and the export control.
- A completed recording shows exactly **Click Hear to listen**. Hear toggles to Stop during playback.
- Removed onboarding paragraphs, slogans, caption-source and cache notices, permanent success messages, diagnostic player controls and the version footer from the panel.
- Kept the transcript controls, speed slider, phrase modes, microphone selector and refresh button, input meter, per-card Record/Hear, and collapsed timing adjustments.
- Normal messages are brief and empty messages take no space. Permission requests, recording progress and actionable errors remain visible when needed.

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

## Development

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
