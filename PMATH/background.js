const ALARM = "pmath-minute-check";

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({ enabled: false });
  chrome.alarms.create(ALARM, { periodInMinutes: 1 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM) return;
  const { enabled } = await chrome.storage.local.get({ enabled: false });
  if (!enabled) return;
  const d = new Date();
  const minute = d.getHours() * 60 + d.getMinutes();
  const active = (minute >= 420 && minute < 732) || (minute >= 740 && minute < 1101);
  const tabs = await chrome.tabs.query({ url: ["https://pmath100.com/*", "https://www.pmath100.com/*"] });
  if (active && tabs.length === 0) {
    await chrome.tabs.create({ url: "https://pmath100.com/" });
    return;
  }
  for (const tab of tabs) {
    if (!tab.id) continue;
    try { await chrome.tabs.sendMessage(tab.id, { type: "SCHEDULE_TICK" }); } catch { /* tab is navigating */ }
  }
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "SET_ENABLED") {
    chrome.storage.local.set({ enabled: Boolean(message.enabled) });
  }
});
