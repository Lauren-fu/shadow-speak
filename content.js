(() => {
  let active = null;
  let timer = null;
  let deadline = null;
  const videoId = () => new URL(location.href).searchParams.get("v");
  const video = () => document.querySelector("#movie_player video.html5-main-video") || document.querySelector("video");
  const isAd = () => document.querySelector("#movie_player")?.classList.contains("ad-showing");

  function cancel(pause = false) {
    clearInterval(timer);
    clearTimeout(deadline);
    deadline = null;
    timer = null;
    const old = active;
    active = null;
    if (pause && old) old.media.pause();
  }

  function checkBoundary() {
    if (!active) return;
    const { media, end, id } = active;
    if (id !== videoId() || isAd() || media !== video()) return cancel(true);
    // A small guard accounts for scheduling jitter without skipping a word.
    if (media.currentTime >= end - 0.015 * (media.playbackRate || 1) || media.ended) {
      media.pause();
      cancel();
      if (media.currentTime > end) media.currentTime = end;
    }
  }

  function scheduleDeadline() {
    clearTimeout(deadline);
    if (!active || active.media.paused || active.initialSeek) return;
    const seconds = (active.end - active.media.currentTime) / (active.media.playbackRate || 1);
    deadline = setTimeout(() => {
      checkBoundary();
      if (active) scheduleDeadline();
    }, Math.max(5, seconds * 1000 - 10));
  }

  for (const event of ["ratechange", "playing", "seeked"]) {
    document.addEventListener(event, scheduleDeadline, true);
  }
  document.addEventListener("yt-navigate-start", () => cancel(true));
  document.addEventListener("timeupdate", checkBoundary, true);
  document.addEventListener("seeking", () => {
    if (active && !active.initialSeek &&
        (active.media.currentTime < active.start - 0.15 || active.media.currentTime > active.end + 0.15)) cancel(true);
  }, true);

  function getCaptions() {
    const media = video();
    if (!videoId() || !media) throw new Error("Open a YouTube video first.");
    if (isAd()) throw new Error("Wait until the advertisement finishes.");
    const tracks = Array.from(media.textTracks || []);
    for (const track of tracks.sort((a, b) => Number(b.mode === "showing") - Number(a.mode === "showing"))) {
      const cues = Array.from(track.cues || []).map(cue => ({
        start: cue.startTime, end: cue.endTime,
        text: cue.text.replace(/<[^>]*>/g, "").trim(), reliableEnd: true
      })).filter(c => c.text);
      if (cues.length) return { cues, source: "Timed caption track", approximate: false };
    }

    // YouTube's public DOM changes over time; subtitle import is the stable fallback.
    const rows = Array.from(document.querySelectorAll("ytd-transcript-segment-renderer"))
      .filter(row => row.getClientRects().length > 0);
    const items = rows.map(row => {
      const label = row.querySelector(".segment-timestamp")?.textContent.trim();
      const text = row.querySelector(".segment-text")?.textContent.trim();
      const start = label?.split(":").reduce((sum, part) => sum * 60 + Number(part), 0);
      return { start, text };
    }).filter(c => Number.isFinite(c.start) && c.text);
    if (!items.length) throw new Error('No transcript is open on this page. Use “Get full transcript” with a Supadata key above, or open YouTube’s “Show transcript” and click “Read YouTube transcript” again.');
    const cues = items.map((item, i) => ({
      ...item,
      end: items[i + 1]?.start ?? (Number.isFinite(media.duration) ? Math.min(media.duration, item.start + 4) : item.start + 4),
      reliableEnd: false
    })).filter(c => c.end > c.start);
    return { cues, source: "YouTube transcript · estimated end times", approximate: true };
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.channel !== "shadow-speak") return;
    (async () => {
      const media = video();
      if (message.type === "info") return {
        id: videoId(), title: document.querySelector("h1.ytd-watch-metadata")?.textContent.trim() || document.title,
        supported: new URL(location.href).pathname === "/watch" && Boolean(videoId()),
        hasVideo: Boolean(media),
        duration: media?.duration
      };
      if (message.type === "captions") return { ...getCaptions(), id: videoId() };
      if (message.id !== videoId()) throw new Error("The video changed. Load its transcript before practicing.");
      if (!media) throw new Error("The video player is not ready.");
      if (message.type === "stop") { cancel(); media.pause(); return {}; }
      if (message.type === "rate") {
        if (!Number.isFinite(message.rate) || message.rate < 0.5 || message.rate > 1.5) throw new Error("Invalid playback speed.");
        media.playbackRate = message.rate;
        scheduleDeadline();
        return {};
      }
      if (message.type === "play") {
        const { start, end, rate, nextStart } = message;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start ||
            !Number.isFinite(rate) || rate < 0.5 || rate > 1.5) throw new Error("Invalid playback range.");
        if (nextStart !== undefined && (!Number.isFinite(nextStart) || nextStart <= start)) throw new Error("Invalid next phrase boundary.");
        if (isAd()) throw new Error("Wait until the advertisement finishes.");
        if (Number.isFinite(media.duration) && start >= media.duration) throw new Error("This phrase is outside the video.");
        cancel();
        media.pause();
        const run = { media, start, end: Math.min(end, nextStart ?? Infinity, media.duration || end), id: videoId(), initialSeek: true };
        active = run;
        media.playbackRate = rate;
        media.currentTime = start;
        // Finish seeking before playback and guard against a second phrase click.
        if (media.seeking) await new Promise(resolve => {
          const done = () => { clearTimeout(fallback); media.removeEventListener("seeked", done); resolve(); };
          const fallback = setTimeout(done, 1500);
          media.addEventListener("seeked", done, { once: true });
        });
        if (active !== run) return {};
        run.initialSeek = false;
        timer = setInterval(checkBoundary, 10);
        try {
          await media.play();
          if (active === run) scheduleDeadline();
        }
        catch (error) { if (active === run) cancel(); throw error; }
        return {};
      }
      throw new Error("Unknown action.");
    })().then(data => respond({ ok: true, ...data }), error => respond({ ok: false, error: error.message }));
    return true;
  });
})();
