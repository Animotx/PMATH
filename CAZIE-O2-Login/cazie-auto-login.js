(() => {
  'use strict';

  let submitted = false;

  const visible = (el) => !!el && el.isConnected && el.getClientRects().length > 0 && !el.disabled;

  function onLoginPage() {
    return /\/login\/?$/i.test(location.pathname) ||
      !!document.querySelector('input[type="password"], input[autocomplete="current-password"]');
  }

  function getLoginForm() {
    const password = [...document.querySelectorAll('input[type="password"], input[autocomplete="current-password"]')]
      .find(visible);
    if (!password) return null;
    const form = password.closest('form');
    if (!form) return null;

    const username = form.querySelector('input[autocomplete="username"], input[type="email"], input[type="text"]');
    const button = form.querySelector('#loginBtn, button[type="submit"]');
    if (!username || !button || !visible(button)) return null;
    return { form, username, password, button };
  }

  function loginErrorIsVisible() {
    const message = document.querySelector('#loginMessage');
    return !!message && !!message.textContent.trim();
  }

  function clickLoginPageLink() {
    if (!/^\/login\/?$/i.test(location.pathname) || loginErrorIsVisible()) return;
    const loginLink = [...document.querySelectorAll('a[href]')].find((link) => {
      try {
        const url = new URL(link.href, location.href);
        return url.origin === location.origin && /\/login\/?$/i.test(url.pathname) &&
          visible(link) && /\blogin\b/i.test(link.textContent.trim());
      } catch { return false; }
    });
    if (loginLink) loginLink.click();
  }

  function clickSavedLogin() {
    if (submitted) return;
    const parts = getLoginForm();
    if (!parts) return;
    // Do not retain or copy credentials. Require the browser/password manager
    // to have filled both fields before submitting the form.
    if (!parts.username.value.trim() || !parts.password.value) return;

    submitted = true;
    parts.button.click();
  }

  function tick() {
    if (onLoginPage()) {
      clickSavedLogin();
      clickLoginPageLink();
      return;
    }
    submitted = false;
  }

  tick();
  window.setInterval(tick, 1000);
  new MutationObserver(tick).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['value', 'disabled', 'href', 'aria-current']
  });
})();
