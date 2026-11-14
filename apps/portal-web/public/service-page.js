(() => {
  'use strict';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const panel = document.querySelector('[data-service-id]');
  const rawId = panel?.getAttribute('data-service-id') ?? '';
  const id = rawId.length === 36 && uuid.test(rawId) ? rawId.toLowerCase() : null;
  if (!id) return;

  const loginLink = panel.querySelector('[data-service-login]');
  const shareButton = panel.querySelector('[data-service-share]');
  const resultBox = document.getElementById('service-share-result');
  const status = document.getElementById('service-share-status');
  if (!loginLink || !shareButton || !resultBox || !status) return;

  let session = null;
  let checking = false;

  const paintMember = () => {
    const signedIn = Boolean(session?.user?.user_id && session?.csrf_token);
    loginLink.hidden = signedIn;
    shareButton.hidden = !signedIn;
  };

  const checkSession = async () => {
    if (checking || document.visibilityState === 'hidden') return;
    checking = true;
    try {
      const response = await fetch('/api/v1/session', {
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        headers: { Accept: 'application/json' },
      });
      session = response.ok ? await response.json() : null;
    } catch {
      session = null;
    } finally {
      checking = false;
      paintMember();
    }
  };

  const renderShareResult = result => {
    resultBox.replaceChildren();
    const input = document.createElement('input');
    input.readOnly = true;
    input.setAttribute('aria-label', '我的分享連結');
    input.value = new URL(result.path, location.origin).href;
    resultBox.append(input);

    const counts = document.createElement('p');
    const clicks = Number(result.points?.all ?? 0);
    counts.textContent = `${clicks} 個有效點閱日`;
    resultBox.append(counts);

    const actions = document.createElement('div');
    actions.className = 'service-share-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn btn-secondary';
    copyBtn.textContent = '複製連結';
    copyBtn.addEventListener('click', () => {
      if (!navigator.clipboard?.writeText) {
        input.focus();
        input.select();
        status.textContent = '請手動複製上面的連結。';
        return;
      }
      void navigator.clipboard.writeText(input.value).then(() => {
        status.textContent = '已複製。';
      }, () => {
        input.focus();
        input.select();
        status.textContent = '請手動複製上面的連結。';
      });
    });
    actions.append(copyBtn);

    if (typeof navigator.share === 'function') {
      const shareBtn = document.createElement('button');
      shareBtn.type = 'button';
      shareBtn.className = 'btn btn-secondary';
      shareBtn.textContent = '分享';
      shareBtn.addEventListener('click', () => {
        void navigator.share({ title: document.title, url: input.value }).catch(err => {
          if (err?.name === 'AbortError') return;
          input.focus();
          input.select();
          status.textContent = '無法開啟分享，請複製上面的連結';
        });
      });
      actions.append(shareBtn);
    }

    resultBox.append(actions);
    input.select();
    status.textContent = '分享連結已建立';
  };

  shareButton.addEventListener('click', async () => {
    if (shareButton.disabled) return;
    if (!session?.csrf_token) {
      await checkSession();
      if (!session?.csrf_token) {
        status.textContent = '請重新登入';
        return;
      }
    }
    shareButton.disabled = true;
    status.textContent = '處理中…';
    try {
      const response = await fetch('/api/v1/promotion/links', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': session.csrf_token,
        },
        body: JSON.stringify({ kind: 'member_service', target: id }),
      });
      let body = null;
      try { body = await response.json(); } catch {}
      if (response.status === 401) {
        session = null;
        paintMember();
        throw new Error('請重新登入');
      }
      if (!response.ok) {
        throw new Error(response.status >= 500 ? '分享連結暫時無法建立，請稍後再試。' : (body?.detail || body?.message || '操作未完成，請再試一次。'));
      }
      if (!body || typeof body.path !== 'string' || !body.path.startsWith('/go/')) {
        throw new Error('分享連結回應不完整');
      }
      renderShareResult(body);
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : '操作未完成，請再試一次。';
    } finally {
      shareButton.disabled = false;
    }
  });

  void checkSession();
  window.addEventListener('focus', checkSession);
  window.addEventListener('pageshow', checkSession);
  document.addEventListener('visibilitychange', checkSession);
})();
