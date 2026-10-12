async function render() {
  const { enabled = false } = await chrome.storage.local.get({ enabled: false });
  document.querySelector("#status").textContent = enabled ? "Schedule is enabled" : "Schedule is paused";
  document.querySelector("#toggle").textContent = enabled ? "Disable schedule" : "Enable schedule";
  document.querySelector("#toggle").onclick = async () => {
    await chrome.storage.local.set({ enabled: !enabled });
    await render();
    const tabs = await chrome.tabs.query({ url: ["https://pmath100.com/*", "https://www.pmath100.com/*"] });
    for (const tab of tabs) if (tab.id) chrome.tabs.sendMessage(tab.id, { type: "SCHEDULE_TICK" }).catch(() => {});
  };
}
render();
