(() => {
  const buttonId = "shadow-speak-launcher";
  let scheduled = null;
  function install() {
    scheduled = null;
    const url = new URL(location.href);
    const existing = document.getElementById(buttonId);
    if (url.pathname !== "/watch" || !url.searchParams.get("v")) { existing?.remove(); return; }
    const target = document.querySelector("ytd-watch-metadata #actions #top-level-buttons-computed")
      || document.querySelector("ytd-watch-metadata #actions ytd-menu-renderer");
    if (!target || target.contains(existing)) return;
    existing?.remove();
    const button = document.createElement("button");
    button.id = buttonId;
    button.type = "button";
    button.textContent = "Shadow";
    button.title = "Open Shadow Speak";
    button.setAttribute("aria-label", "Open Shadow Speak");
    button.addEventListener("click", () => {
      // Keep this request directly inside the click's user gesture.
      try {
        chrome.runtime.sendMessage({ channel: "shadow-speak", type: "open-panel" }).then(result => {
          button.title = result?.ok ? "Open Shadow Speak" : "Use the Shadow Speak toolbar icon to open the panel.";
        }).catch(() => { button.title = "Reload YouTube after updating Shadow Speak."; });
      } catch { button.title = "Reload YouTube after updating Shadow Speak."; }
    });
    target.prepend(button);
  }
  function schedule() {
    if (scheduled === null) scheduled = setTimeout(install, 120);
  }
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("yt-navigate-finish", schedule);
  install();
})();
