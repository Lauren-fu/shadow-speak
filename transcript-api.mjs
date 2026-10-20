const ENDPOINT = "https://api.supadata.ai/v1/transcript";

export function normalizeTranscript(data) {
  const content = data?.result?.content ?? data?.content;
  if (!Array.isArray(content)) throw new Error("The service did not return timed captions. Try again with a video that has captions.");
  const cues = content.flatMap(item => {
    if (typeof item?.text !== "string" || !item.text.trim() ||
        !Number.isFinite(item.offset) || !Number.isFinite(item.duration) ||
        item.offset < 0 || item.duration <= 0) return [];
    return [{
      start: item.offset / 1000, end: (item.offset + item.duration) / 1000,
      text: item.text.trim(), reliableEnd: true
    }];
  }).sort((a, b) => a.start - b.start);
  if (!cues.length) throw new Error("No usable timed speech was returned for this video.");
  return { cues, language: data?.result?.lang ?? data?.lang ?? "" };
}

function httpError(status) {
  const messages = {
    206: "No existing captions were found. You can enable AI fallback and try again; it may use more Supadata credits.",
    400: "Supadata could not process this video link. Check that the video is public and has finished streaming.",
    401: "Supadata rejected the API key. Check the key in your Supadata dashboard.",
    402: "Your Supadata account needs more credits.",
    403: "Supadata denied access. Check your account and whether this video is restricted.",
    404: "Supadata could not find an accessible video or transcript.",
    429: "Supadata's rate or usage limit was reached. Wait before retrying, or check your account limits."
  };
  return new Error(messages[status] || `Supadata request failed (HTTP ${status}). Please try again later.`);
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function fetchTranscript({
  videoId, apiKey, mode = "native", signal, jobId, onJob = () => {},
  onProgress = () => {}, fetchImpl = globalThis.fetch, pollMs = 3000, timeoutMs = 600000
}) {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId || "")) throw new Error("The YouTube video ID is invalid.");
  if (typeof apiKey !== "string" || !apiKey.trim()) throw new Error("Enter your Supadata API key first.");
  if (!["native", "auto"].includes(mode)) throw new Error("Unsupported transcript mode.");
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const timeout = setTimeout(() => { timedOut = true; cancel(); }, timeoutMs);

  async function request(url) {
    controller.signal.throwIfAborted();
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { "x-api-key": apiKey.trim() },
        credentials: "omit", redirect: "error", cache: "no-store",
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new Error("Could not reach Supadata. Check your connection and reload the updated extension so its API permission takes effect.");
    }
    if (!response.ok || response.status === 206) throw httpError(response.status);
    let data;
    try { data = await response.json(); }
    catch (error) {
      if (controller.signal.aborted) throw error;
      throw new Error("Supadata returned an unreadable response. Try again later.");
    }
    controller.signal.throwIfAborted();
    return { data, status: response.status };
  }

  try {
    if (!jobId) {
      const url = new URL(ENDPOINT);
      // Only send the video ID, never browsing parameters or cookies.
      url.searchParams.set("url", `https://www.youtube.com/watch?v=${videoId}`);
      url.searchParams.set("text", "false");
      url.searchParams.set("lang", "en");
      url.searchParams.set("mode", mode);
      onProgress("Requesting the full transcript from Supadata…");
      const result = await request(url.href);
      if (result.status !== 202 && !result.data?.jobId) return normalizeTranscript(result.data);
      jobId = result.data?.jobId;
      if (typeof jobId !== "string" || !jobId) throw new Error("Supadata returned a processing job without an ID.");
      onJob(jobId);
    }
    for (;;) {
      onProgress("Supadata is processing this video. You can keep watching while it finishes…");
      await delay(pollMs, controller.signal);
      const { data } = await request(`${ENDPOINT}/${encodeURIComponent(jobId)}`);
      if (data.status === "completed") return normalizeTranscript(data);
      if (data.status === "failed") {
        const error = new Error("Supadata could not produce a transcript for this video. Check video availability or try another video.");
        error.jobFailed = true;
        throw error;
      }
      if (!["queued", "active"].includes(data.status)) throw new Error("Supadata returned an unexpected processing status.");
    }
  } catch (error) {
    if (timedOut) throw new Error("This transcript is taking longer than 10 minutes. Try again to resume a known job while this panel remains open.");
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}
