(() => {
  if (window.__pmathScheduleController) return;
  window.__pmathScheduleController = true;

  const GAME = "/games-mathproblem";
  const LOGIN_PATHS = new Set(["/", "/login", "/index.php"]);
  const ACTIVE_WINDOWS = [[420, 732], [740, 1101]]; // local time: 07:00–12:12, 12:20–18:21
  const REFRESH_LIMIT = 5;
  const REFRESH_WINDOW_MS = 10 * 60 * 1000;
  const $ = (selector) => document.querySelector(selector);
  let enabled = false;
  let lastActionMinute = "";
  let refreshes = [];

  const timeText = () => new Intl.DateTimeFormat(undefined, {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true
  }).format(new Date());
  const minuteOfDay = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const isActive = (m) => ACTIVE_WINDOWS.some(([start, end]) => m >= start && m < end);
  const isLogin = () => LOGIN_PATHS.has(location.pathname.replace(/\/$/, "") || "/") || Boolean($("#loginForm"));
  const isGame = () => location.pathname.includes("games-mathproblem");

  const panel = document.createElement("aside");
  panel.id = "pmath-schedule-panel";
  panel.innerHTML = `<header>PMath Schedule <span id="pmath-clock">--:--:--</span></header>
    <div id="pmath-state">Schedule paused</div>
    <div class="pmath-times">Runs 7:00–12:12 and 12:20–6:21<br>Local device time</div>
    <button id="pmath-toggle" type="button">Enable schedule</button>`;
  const style = document.createElement("style");
  style.textContent = `#pmath-schedule-panel{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:230px;padding:12px;border:1px solid #475569;border-radius:12px;background:#0f172a;color:#e2e8f0;box-shadow:0 10px 32px #0007;font:13px/1.4 system-ui,sans-serif}#pmath-schedule-panel header{display:flex;justify-content:space-between;font-weight:700;border-bottom:1px solid #334155;padding-bottom:8px}#pmath-clock{color:#7dd3fc;font-variant-numeric:tabular-nums}#pmath-state{padding:9px 0 3px;font-weight:650}#pmath-schedule-panel .pmath-times{font-size:11px;color:#94a3b8;margin-bottom:9px}#pmath-toggle{width:100%;border:0;border-radius:7px;padding:8px;background:#38bdf8;color:#082f49;font-weight:700;cursor:pointer}`;
  document.documentElement.append(style, panel);

  const stateLabel = (m) => !enabled ? "Schedule paused" : isActive(m) ? "Scheduled session active" : m >= 1101 ? "Outside schedule · sign-out window" : "Break · waiting for next session";
  function draw() {
    const m = minuteOfDay();
    $("#pmath-clock").textContent = timeText();
    $("#pmath-state").textContent = stateLabel(m);
    $("#pmath-toggle").textContent = enabled ? "Disable schedule" : "Enable schedule";
    panel.dataset.enabled = String(enabled);
  }

  async function loadEnabled() {
    const result = await chrome.storage.local.get({ enabled: false });
    enabled = Boolean(result.enabled);
    draw();
    tick();
  }

  $("#pmath-toggle").addEventListener("click", async () => {
    enabled = !enabled;
    await chrome.storage.local.set({ enabled });
    chrome.runtime.sendMessage({ type: "SET_ENABLED", enabled });
    draw();
    tick();
  });

  function doOncePerMinute(action) {
    const key = `${new Date().toDateString()}-${Math.floor(Date.now() / 60000)}-${action}`;
    if (lastActionMinute === key) return false;
    lastActionMinute = key;
    return true;
  }

  function scheduledAction() {
    const now = minuteOfDay();
    if (!enabled) return;
    if (now >= 1101) {
      if (doOncePerMinute("logout")) {
        const logout = [...document.querySelectorAll("a")].find((a) => /\/logout(?:\/|$|\?)/i.test(a.getAttribute("href") || "") || /^\s*sign\s*out\s*$/i.test(a.textContent));
        if (logout) location.href = logout.href;
      }
      return;
    }
    if (!isActive(now)) return;
    if (isLogin()) {
      const user = $("#loginForm [name='userName']");
      const pass = $("#loginForm [name='passWord']");
      const button = $("#loginBtn");
      // Only invoke the site's normal login flow when the browser has already filled both fields.
      if (user?.value?.trim() && pass?.value && button && !button.disabled && doOncePerMinute("login")) button.click();
    } else if (!isGame() && doOncePerMinute("game-nav")) {
      const gameLink = [...document.querySelectorAll("a")].find((a) => (a.getAttribute("href") || "").includes("games-mathproblem"));
      location.href = gameLink?.href || new URL(GAME, location.origin).href;
    }
  }

  function maybeRecover() {
    if (!enabled) return;
    const body = (document.body?.innerText || "").slice(0, 12000);
    if (!/service\s+(?:is\s+)?unavailable|temporarily unavailable|cannot load|unable to load|connection (?:lost|failed)/i.test(body)) return;
    const now = Date.now();
    refreshes = refreshes.filter((t) => now - t < REFRESH_WINDOW_MS);
    if (refreshes.length >= REFRESH_LIMIT) {
      $("#pmath-state").textContent = "Recovery paused after 5 refreshes; check connection";
      return;
    }
    refreshes.push(now);
    sessionStorage.setItem("pmath-refresh-history", JSON.stringify(refreshes));
    setTimeout(() => location.reload(), 2500 + Math.random() * 1500);
  }

  try { refreshes = JSON.parse(sessionStorage.getItem("pmath-refresh-history") || "[]"); } catch { refreshes = []; }
  function tick() { draw(); scheduledAction(); maybeRecover(); }
  chrome.runtime.onMessage.addListener((message) => { if (message?.type === "SCHEDULE_TICK") tick(); });
  loadEnabled();
  setInterval(tick, 1000);
})();
