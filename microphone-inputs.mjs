export async function listMicrophones(mediaDevices = navigator.mediaDevices) {
  if (!mediaDevices?.enumerateDevices) return [];
  const devices = await mediaDevices.enumerateDevices();
  const seen = new Set();
  return devices.filter(device => device.kind === "audioinput" && device.deviceId && !seen.has(device.deviceId) && seen.add(device.deviceId))
    .map((device, index) => ({ id: device.deviceId, label: device.label || "Microphone " + (index + 1) }));
}
