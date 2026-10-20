// Bundled with the recorder into recording-content.js. No runtime imports.
(() => {
  let active = null;
  function cancel() {
    active?.cancel();
    active = null;
  }
  document.addEventListener("yt-navigate-start", cancel);
  window.addEventListener("pagehide", cancel);
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.channel !== "shadow-speak-audio" || message.type !== "inputs") return;
    if (message.id !== new URL(location.href).searchParams.get("v")) {
      respond({ ok: false, error: "The video changed. Load its transcript again." });
      return;
    }
    listMicrophones().then(inputs => respond({ ok: true, inputs }),
      () => respond({ ok: false, error: "Could not list microphones. Allow microphone access on YouTube first." }));
    return true;
  });
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== "shadow-speak-voice-v1") return;
    if (port.sender?.id && port.sender.id !== chrome.runtime.id) { port.disconnect(); return; }
    cancel();
    active = attachPageRecorder(port);
  });
})();
