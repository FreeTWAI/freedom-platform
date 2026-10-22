(() => {
  try {
    const choice = localStorage.getItem('freedom-theme');
    const theme = choice === 'guide-dragon' ? 'dark' : choice === 'guide-ai-sister' ? 'light' : choice;
    if (['light', 'dark', 'versefolk'].includes(theme)) document.documentElement.dataset.theme = theme;
  } catch { /* Reading remains available when browser storage is disabled. */ }
  // Treat DOM attributes as untrusted input even on a server-rendered page.
  // Only UUIDs can become link destinations or API path components.
  const canonicalId = value => typeof value === 'string' && value.length === 36
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase() : null;
  const article = document.querySelector('[data-public-post]');
  const id = canonicalId(article?.getAttribute('data-public-post'));
  if (!id) return;
  const encodedId = encodeURIComponent(id);
  const lifetime = new AbortController();
  let checking = false;
  let capabilityEpoch = 0;
  const status = document.querySelector('[data-reading-status]');
  const json = async path => {
    const request = new AbortController(),abort = () => request.abort();
    lifetime.signal.addEventListener('abort', abort, {once:true});
    const timeout = setTimeout(abort, 8000);
    try {
      if (lifetime.signal.aborted) request.abort();
      const response = await fetch(path, {credentials:'same-origin',cache:'no-store',redirect:'error',signal:request.signal});
      return {response, value:response.ok ? await response.json() : null};
    } finally { clearTimeout(timeout); lifetime.signal.removeEventListener('abort', abort); }
  };
  const reloadCurrent = () => {
    document.body.replaceChildren();
    document.title = '自由工坊';
    for (const meta of document.querySelectorAll('meta[property^="og:"],meta[name="description"]')) meta.remove();
    location.reload();
  };
  const setMember = member => {
    const link = document.querySelector('[data-post-login]');
    if (link) {
      link.href = member ? `/?social-post=${encodedId}#social` : `/?post_return=${encodedId}#account`;
      link.textContent = member ? '開啟貼文與討論' : '登入看更多與留言';
    }
    const description = document.querySelector('[data-invite-description]');
    if (description) description.textContent = member ? '繼續閱讀其他分享，或回到貼文加入討論。' : '你已讀完這篇公開貼文。登入後可以看更多分享、按讚與加入討論。';
    const preview = document.querySelector('[data-preview-description]');
    if (preview) preview.textContent = member ? '看看其他夥伴的公開分享。' : '先看看幾則分享，登入後就能繼續閱讀。';
    for (const related of document.querySelectorAll('[data-related-post]')) {
      const target = canonicalId(related.getAttribute('data-related-post'));
      if (!target) {
        related.removeAttribute('href');
        related.textContent = '這則分享暫時無法開啟';
        continue;
      }
      const encodedTarget = encodeURIComponent(target);
      related.href = member ? `/posts/${encodedTarget}` : `/?post_return=${encodedTarget}#account`;
      related.textContent = member ? '繼續閱讀' : '登入繼續閱讀';
    }
  };
  const capabilities = async () => {
    const epoch = ++capabilityEpoch;
    const [session, site] = await Promise.allSettled([json('/api/v1/session'), json('/api/v1/site')]);
    if (lifetime.signal.aborted || epoch !== capabilityEpoch) return;
    const member = session.status === 'fulfilled' && Boolean(session.value.value?.user?.user_id);
    setMember(member);
    const join = document.querySelector('[data-post-join]');
    if (join) join.hidden = member || site.status !== 'fulfilled' || site.value.value?.registration_enabled !== true;
  };
  // Re-check when a reader returns from another tab. No background polling or
  // anonymous member-feed calls. Revocation uses the server's generic page.
  const refresh = async () => {
    if (checking || document.visibilityState === 'hidden' || lifetime.signal.aborted) return;
    checking = true;
    try {
      const result = await json(`/api/v1/public/shared-posts/${encodedId}`);
      if (result.response.status === 404) { reloadCurrent(); return; }
      if (!result.response.ok) { if (status) status.textContent = '暫時無法確認貼文最新狀態，請重新整理。'; return; }
      // The opaque projection digest also changes after an image replacement,
      // a new publication consent, or a changed/withdrawn related preview.
      if (result.value.version !== article.getAttribute('data-public-version')) { reloadCurrent(); return; }
      if (status) status.textContent = '';
      await capabilities();
    } catch { if (!lifetime.signal.aborted && status) status.textContent = '暫時無法確認貼文最新狀態，請重新整理。'; }
    finally { checking = false; }
  };
  void capabilities();
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('pagehide', () => lifetime.abort(), {once:true});
})();
