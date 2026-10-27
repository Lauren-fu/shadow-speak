chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);
chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  .catch(() => console.error("Could not restrict extension storage access."));

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.channel !== "shadow-speak" || message.type !== "open-panel") return;
  const url = new URL(sender.url || "https://invalid.local");
  if (sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id) || sender.frameId !== 0 ||
      url.origin !== "https://www.youtube.com" || url.pathname !== "/watch") return;
  // Do not await storage or other work before open(): Chrome requires a user gesture.
  chrome.sidePanel.open({ windowId: sender.tab.windowId }).then(
    () => respond({ ok: true }),
    () => respond({ ok: false })
  );
  return true;
});
