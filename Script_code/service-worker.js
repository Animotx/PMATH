async function hardRefresh(tabId) {
  try {
    if (tabId == null) {
      await chrome.tabs.reload(undefined, { bypassCache: true });
    } else {
      await chrome.tabs.reload(tabId, { bypassCache: true });
    }
  } catch (error) {
    console.error('Hard refresh failed:', error);
  }
}

chrome.action.onClicked.addListener((tab) => {
  hardRefresh(tab.id);
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'hard-refresh-current-tab') {
    hardRefresh();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'CAZIE_HARD_REFRESH' || sender.tab?.id == null) return;

  let isCaziePage = false;
  try {
    isCaziePage = new URL(sender.url || '').origin === 'https://cazie-s.onrender.com';
  } catch {}
  if (!isCaziePage) return;

  // Acknowledge first; the reload will unload this document immediately.
  sendResponse({ ok: true });
  hardRefresh(sender.tab.id);
});
