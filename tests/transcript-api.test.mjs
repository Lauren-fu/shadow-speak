import test from "node:test";
import assert from "node:assert/strict";
import { fetchTranscript, normalizeTranscript } from "../transcript-api.mjs";

const videoId = "dQw4w9WgXcQ";
const payload = { lang: "en", content: [{ offset: 1250, duration: 2500, text: "Hello there." }] };
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, async json() { return data; } });
const options = { videoId, apiKey: "test-key-not-a-real-secret", pollMs: 1 };

test("request uses canonical YouTube URL, timed output and native captions by default", async () => {
  const result = await fetchTranscript({ ...options, fetchImpl: async (url, config) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://api.supadata.ai");
    assert.equal(parsed.searchParams.get("url"), `https://www.youtube.com/watch?v=${videoId}`);
    assert.equal(parsed.searchParams.get("text"), "false");
    assert.equal(parsed.searchParams.get("mode"), "native");
    assert.equal(parsed.searchParams.get("lang"), "en");
    assert.equal(config.headers["x-api-key"], options.apiKey);
    assert.equal(config.credentials, "omit");
    assert.equal(config.redirect, "error");
    assert.ok(!url.includes(options.apiKey));
    return response(payload);
  } });
  assert.deepEqual(result.cues, [{ start: 1.25, end: 3.75, text: "Hello there.", reliableEnd: true }]);
});
test("AI fallback is explicit and asynchronous processing supports both response shapes", async () => {
  for (const completed of [{ status: "completed", ...payload }, { status: "completed", result: payload }]) {
    let count = 0, capturedJob;
    const result = await fetchTranscript({ ...options, mode: "auto", onJob: job => { capturedJob = job; }, fetchImpl: async url => {
      count++;
      if (count === 1) {
        assert.equal(new URL(url).searchParams.get("mode"), "auto");
        return response({ jobId: "job/123" }, 202);
      }
      assert.ok(url.endsWith("/job%2F123"));
      return response(count === 2 ? { status: "active" } : completed);
    } });
    assert.equal(capturedJob, "job/123");
    assert.equal(count, 3);
    assert.equal(result.language, "en");
  }
});
test("resume polls the existing job instead of submitting a second request", async () => {
  let count = 0;
  await fetchTranscript({ ...options, jobId: "known-job", fetchImpl: async url => {
    count++;
    assert.ok(url.endsWith("/known-job"));
    return response({ status: "completed", ...payload });
  } });
  assert.equal(count, 1);
});
test("missing captions, invalid key, credit and rate failures have actionable messages", async () => {
  for (const [status, expected] of [[206, /No existing captions/], [401, /API key/], [402, /credits/], [429, /limit/]]) {
    await assert.rejects(fetchTranscript({ ...options, fetchImpl: async () => response({ message: options.apiKey }, status) }), error => {
      assert.match(error.message, expected);
      assert.ok(!error.message.includes(options.apiKey));
      return true;
    });
  }
});
test("validates credentials and video ID before making any network request", async () => {
  const fetchImpl = async () => { assert.fail("Unexpected request"); };
  await assert.rejects(fetchTranscript({ ...options, apiKey: "", fetchImpl }), /Enter your/);
  await assert.rejects(fetchTranscript({ ...options, videoId: "https://youtube.com", fetchImpl }), /ID is invalid/);
});
test("normalization rejects untimed or empty content and filters invalid timings", () => {
  assert.throws(() => normalizeTranscript({ content: "plain text" }), /timed captions/);
  assert.throws(() => normalizeTranscript({ content: [] }), /No usable/);
  const result = normalizeTranscript({ content: [
    { offset: -1, duration: 20, text: "bad" }, { offset: 1, duration: 0, text: "bad" },
    { offset: "100", duration: 50, text: "bad" }, ...payload.content
  ] });
  assert.equal(result.cues.length, 1);
});
test("failed jobs are terminal and not automatically resubmitted", async () => {
  let requests = 0;
  await assert.rejects(fetchTranscript({ ...options, jobId: "failed", fetchImpl: async () => {
    requests++; return response({ status: "failed", error: "provider internals" });
  } }), error => error.jobFailed === true);
  assert.equal(requests, 1);
});
test("aborting before a request prevents network use", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fetchTranscript({ ...options, signal: controller.signal, fetchImpl: async () => assert.fail("Unexpected request") }), { name: "AbortError" });
});
test("cancel interrupts pending fetch and polling", async () => {
  const controller = new AbortController();
  await assert.rejects(fetchTranscript({
    ...options, signal: controller.signal,
    fetchImpl: async (url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      controller.abort();
    })
  }), { name: "AbortError" });
  const second = new AbortController();
  await assert.rejects(fetchTranscript({
    ...options, signal: second.signal, jobId: "pending",
    onProgress: () => second.abort(), fetchImpl: async () => assert.fail("Unexpected poll")
  }), { name: "AbortError" });
});
test("timeouts stop pending requests with a useful message", async () => {
  await assert.rejects(fetchTranscript({ ...options, timeoutMs: 5, fetchImpl: async (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }) }), /longer than 10 minutes/);
});
