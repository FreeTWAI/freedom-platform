/* Progressive enhancement only: public content and account links work without this script.
 * Reads current availability; never submits registration, grants, Stars or analytics. */
(() => {
  const panels = [...document.querySelectorAll('[data-skill-acquisition]')];
  if (!panels.length) return;
  let active = null;
  let sequence = 0;
  function paint(member, registration) {
    for (const panel of panels) {
      const join = panel.querySelector('[data-skill-join]');
      const login = panel.querySelector('[data-skill-login]');
      const library = panel.querySelector('[data-skill-library]');
      const guilds = panel.querySelector('[data-skill-guilds]');
      const status = panel.querySelector('[data-skill-account-status]');
      if (!join || !login || !library || !guilds || !status) continue;
      join.hidden = member || registration === false;
      login.hidden = member;
      library.hidden = !member;
      guilds.hidden = !member;
      join.textContent = registration === null ? '前往帳號入口，探索更多資源' : '免費加入，探索更多資源';
      status.textContent = member ? '你已登入，可前往技能書架繼續探索。'
        : registration === false ? '目前暫停新帳號註冊；你仍可閱讀本頁，已有帳號也可登入。'
        : registration === null ? '註冊狀態暫時無法確認；帳號入口會再次確認，本頁仍可閱讀。' : '';
    }
  }
  async function refresh() {
    if (document.visibilityState === 'hidden' || active) return;
    const controller = new AbortController(), ticket = ++sequence;
    active = controller;
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const read = async (path, credentials) => {
      const response = await fetch(path, {credentials, cache: 'no-store', redirect: 'error', signal: controller.signal, headers: {Accept: 'application/json'}});
      if (!response.ok) return null;
      return response.json();
    };
    try {
      const [site, session] = await Promise.allSettled([read('/api/v1/site', 'omit'), read('/api/v1/session', 'same-origin')]);
      if (ticket !== sequence || document.visibilityState === 'hidden') return;
      const member = session.status === 'fulfilled' && typeof session.value?.user?.user_id === 'string' && !!session.value.user.user_id;
      const registration = site.status === 'fulfilled' && typeof site.value?.registration_enabled === 'boolean' ? site.value.registration_enabled : null;
      paint(member, registration);
    } finally { clearTimeout(timeout); if (active === controller) active = null; }
  }
  function cancel() { sequence++; active?.abort(); active = null; }
  window.addEventListener('pagehide', cancel);
  window.addEventListener('pageshow', refresh);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') cancel(); else void refresh(); });
  void refresh();
})();
