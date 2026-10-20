chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);
chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  .catch(() => console.error("Could not restrict extension storage access."));
