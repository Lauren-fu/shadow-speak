// Chrome's extension messages use JSON, so transfer recorded audio as base64.
export async function encodeTake(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length > 16 * 1024 * 1024) throw new Error("This recording is too large. Try a shorter take.");
  const parts = [];
  for (let i = 0; i < bytes.length; i += 32768) parts.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
  return { base64: btoa(parts.join("")), mimeType: blob.type || "audio/webm" };
}

export function decodeTake({ base64, mimeType }) {
  if (typeof base64 !== "string" || base64.length > 24 * 1024 * 1024 ||
      typeof mimeType !== "string" || !/^audio\/[\w.+-]+(?:;[\w= .+-]+)?$/.test(mimeType)) {
    throw new Error("The recording could not be received. Please try again.");
  }
  const binary = atob(base64);
  return new Blob([Uint8Array.from(binary, letter => letter.charCodeAt(0))], { type: mimeType });
}
