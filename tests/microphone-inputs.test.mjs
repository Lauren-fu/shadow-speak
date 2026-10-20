import test from "node:test";
import assert from "node:assert/strict";
import { listMicrophones } from "../microphone-inputs.mjs";

test("microphone selection excludes output devices and keeps actual input IDs and labels", async () => {
  const inputs = await listMicrophones({ enumerateDevices: async () => [
    { kind: "audioinput", deviceId: "default", label: "Default - Microsoft Teams" },
    { kind: "audioinput", deviceId: "built-in", label: "MacBook Microphone" },
    { kind: "audioinput", deviceId: "built-in", label: "Duplicate" },
    { kind: "audiooutput", deviceId: "speaker", label: "Speaker" },
    { kind: "videoinput", deviceId: "camera", label: "Camera" }
  ] });
  assert.deepEqual(inputs, [
    { id: "default", label: "Default - Microsoft Teams" },
    { id: "built-in", label: "MacBook Microphone" }
  ]);
});
