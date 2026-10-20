// Tab URLs are permission-gated. A missing tabs.Tab.url does not mean that
// YouTube isn't open; ask our content script what page it is running on.
export async function getActiveVideo(tabs) {
  const [tab] = await tabs.query({ active: true, currentWindow: true });
  if (!Number.isInteger(tab?.id) || tab.id < 0) {
    throw new Error("No active browser tab was found. Select your YouTube tab and try again.");
  }

  let info;
  try {
    info = await tabs.sendMessage(tab.id, { channel: "shadow-speak", type: "info" });
  } catch {
    throw new Error("Cannot connect to the active page. Select your YouTube video tab and refresh it, then try again. In the extension’s details, make sure site access is allowed on YouTube.");
  }
  if (!info?.ok) throw new Error(info?.error || "The video page did not respond. Refresh YouTube and try again.");
  if (!info.supported || !info.id) throw new Error("Open a regular YouTube video page, then try again. Home, Shorts, and embedded videos are not supported yet.");
  if (!info.hasVideo) throw new Error("YouTube is open, but its video player is still loading. Wait a moment and try again.");
  return { tabId: tab.id, info };
}
