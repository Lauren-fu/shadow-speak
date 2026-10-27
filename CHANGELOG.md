# Changelog

Release notes for Shadow Speak. See the [product overview](README.md) for getting started.

## 0.7.5

- Fixed sparse-punctuation transcripts forming repeated 21-second cards in both modes. A sentence ending elsewhere in the video no longer controls the length of unpunctuated passages.
- Both modes split overlong runs near seven seconds, preferring existing caption edges in the 5–10 second window. A single long caption block can be split at estimated word boundaries instead. Words and chronological order are preserved.
- By pause retains short natural sentence and caption-gap boundaries; Every 7 seconds combines short units toward the target and also splits long units. Normally cards are no longer than ten seconds. A single word assigned an unusually long duration is kept intact because there is no safe internal word boundary.
- The dropdown still only stages a choice. Click the adjacent **↻** to apply it, including reapplying the current mode. Re-splitting uses saved raw captions and makes no Supadata request.
- Existing edits, merges and folds restore when the original boundaries still match. An incompatible old layout shows a warning instead of being applied to the wrong phrases; its saved storage record is not automatically deleted or overwritten. Recordings only carry across when their phrase timing and text still match.
- Added regression coverage for sparse punctuation, long provider blocks, later punctuation changing earlier cards, cue-boundary preference, local cache reuse and staged ↻ application. Provider data and media input are simulated in these checks.

## 0.7.4

- Added the approved soft, flowing ivory wave logo on a terracotta rounded square. PNG icons are included at 16, 32, 48, 128 and 256 pixels, with transparent outer corners.
- Chrome toolbar and extension management use the new icons; the panel header and favicon use the same artwork. The small toolbar version preserves the soft-wave appearance, with less fine detail visible at 16px.
- Recording, transcripts and the YouTube Shadow launcher are unchanged. No new permissions are required.

## 0.7.3

- Disabled Hear keeps the same full-opacity text and icon color as Edit. It remains a native disabled button, with no hover background or pointer cursor until a recording is available.

## 0.7.2

- Lighter Record control: 8px horizontal padding and a 7px dot, with the existing accent fill and recording state preserved.
- Hear and Edit share the same text color and 12px vector icons. Hear stays disabled and faded until a take exists. All three actions use 13px labels, aligned icons and 8px spacing; narrow layouts keep the Edit label visible and 32px touch targets.
- The Shadow button below YouTube videos, its opening behavior and all recorder functionality remain unchanged.
- Local preview checks confirm the three labeled actions fit a 320px panel without horizontal overflow. The existing 81 automated tests pass; no live microphone capture or provider requests were needed for this styling change.

## 0.7.1

- Removed the separate circular recording control from the right of each card. Expanded cards always show the original Record, Hear and Edit actions; Hear is disabled until a recording exists.
- The merged-card undo control is now labeled **Unfold**. It still reverses only the latest merge. Ordinary folding keeps its **− / +** controls.
- Folded cards show no sentence text or preview. Their visual height is 28px, down from 54px at the same 420px preview width (48% shorter), while controls retain 32px hit areas.
- The microphone selector is 48px high with 15px text and a wider input area. Expanded action rows remain stable while dragging adjacent cards to merge.
- Preview checks cover merging, Unfold restoration, folded content, visible Hear controls and narrow layouts without card overflow. These use simulated video and microphone input; real microphone capture was not retested for this UI-only release.

## 0.7.0

- Compact four-column phrase grid, 18px text at 1.5 line height, 8px card gaps and full-card accent highlighting. Inner playback buttons use a transparent background so they cannot paint over part of the highlight.
- Record/Hear/Edit actions appear on the current, hovered or keyboard-focused expanded card. A separate circular Record control remains available on other cards. Hear is hidden until a take exists. During recording the controls remain visible, the Record button pulses red, and elapsed time uses the recorder's existing level events; the capture implementation is unchanged.
- Folded cards show a single-line preview of approximately 30 Unicode characters. Their quick Record control unfolds the card and invokes the original Record action so Stop remains accessible.
- Sticky 56px header and sticky practice controls; matching 40px settings controls, icon buttons for API settings and microphone refresh, and no extra speed scale row. An observed toolbar height keeps centered phrases clear of the sticky controls.
- Space starts/stops recording, H plays/stops the current take, and Up/Down play the previous/next original phrase. Text inputs, edit mode, modified/repeating keys and native control interactions are excluded; the phrase play button accepts these shortcuts. Existing Alt+Up/Down merging remains unchanged.
- Narrow screens preserve the grid with a 14px handle column and secondary action icons. Card action targets grow to at least 32px on narrow/touch layouts, while regular desktop action buttons remain 28px. Reduced-motion preferences disable the recording pulse.

### UI verification

Using the same 24 sample phrases at 420 × 900 CSS pixels, mean expanded-card height decreased from **142.44px to 88.92px (37.6%)**, and fully visible cards increased from **4 to 6**. The 35% height target is met for this sample; **the requested 2× sentence density is not met at this size**. The retained 18px text, four-column layout, 32px touch targets and persistent controls limit narrow-screen density. These measurements are sample-specific, not a guarantee for every transcript.

At 320px width, the preview has no horizontal overflow and all visible button targets are at least 32px high. Browser checks cover full-root highlight coverage, sticky controls while seeking, one-click recording from a folded card, recording timer/stop, typing safety, editing, and adjacent merge/Undo. The preview uses simulated video/microphone data; no Supadata credits or real microphone capture are used for these visual checks.

## 0.6.0

- Edit replaces Adjust timing. Click Edit, correct the words, and click Save (or Cmd/Ctrl + Enter). Cancel or Escape discards a draft. Text edits do not change timestamps or resegment phrases.
- Drag the small grip at the upper-left onto the preceding or following card to merge. Only adjacent visible cards can merge, in either drag direction. The merged card preserves chronological text order and spans the earlier start through the later end. The two previous cards are replaced by that card.
- Merged cards can be merged again with either neighbor, with no artificial count limit. Merging two already-merged groups is also supported. Alt + Up / Down on the grip provides a keyboard alternative.
- Undo at the upper-right reverses only that card's latest merge: ABC made from AB + C restores AB and C, then another Undo on AB restores A and B. A child keeps the wording it had before merging. Wording entered directly on a merged parent is discarded when that merge is undone.
- Fold is now at the upper-right, marked − when expanded and + when folded. Undo remains available on a folded merged card.
- Saved edits and the complete remaining merge history restore on future visits. Each video and phrase mode has its own layout. Raw saved captions remain unchanged, and none of these actions calls Supadata. Storage failures show a warning rather than claiming the changes were saved.

## 0.5.0

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
