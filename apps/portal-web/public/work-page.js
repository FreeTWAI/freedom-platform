(() => {
  'use strict';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const panel = document.querySelector('[data-work-id]');
  const rawId = panel?.getAttribute('data-work-id') ?? '';
  const id = rawId.length === 36 && uuid.test(rawId) ? rawId.toLowerCase() : null;
  if (!id) return;

  const rawShareId = panel.getAttribute('data-share-id') ?? '';
  let shareId = rawShareId.length === 36 && uuid.test(rawShareId) ? rawShareId.toLowerCase() : null;

  const loginLink = panel.querySelector('[data-work-login]');
  const shareButton = panel.querySelector('[data-work-share]');
  const resultBox = document.getElementById('work-share-result');
  const status = document.getElementById('work-share-status');
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

  const postJson = async (path, payload, csrfToken) => {
    const response = await fetch('/api/v1' + path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
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
    return body;
  };

  const selectWithNotice = (input, message) => {
    input.focus();
    input.select();
    status.textContent = message;
  };

  const renderShareResult = result => {
    resultBox.replaceChildren();
    const input = document.createElement('input');
    input.readOnly = true;
    input.setAttribute('aria-label', '我的分享連結');
    input.value = new URL(result.path, location.origin).href;
    resultBox.append(input);

    const actions = document.createElement('div');
    actions.className = 'work-share-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'button secondary btn-secondary';
    copyBtn.textContent = '複製連結';
    copyBtn.addEventListener('click', () => {
      if (!navigator.clipboard?.writeText) {
        selectWithNotice(input, '請手動複製上面的連結。');
        return;
      }
      void navigator.clipboard.writeText(input.value).then(
        () => { status.textContent = '已複製。'; },
        () => { selectWithNotice(input, '請手動複製上面的連結。'); },
      );
    });
    actions.append(copyBtn);

    if (typeof navigator.share === 'function') {
      const shareBtn = document.createElement('button');
      shareBtn.type = 'button';
      shareBtn.className = 'button secondary btn-secondary';
      shareBtn.textContent = '分享';
      shareBtn.addEventListener('click', () => {
        void navigator.share({ title: document.title, url: input.value }).catch(err => {
          if (err?.name === 'AbortError') return;
          selectWithNotice(input, '無法開啟分享，請複製上面的連結');
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
      const csrfToken = session.csrf_token;
      if (!shareId) {
        const created = await postJson('/shares', { kind: 'work', ref_id: id }, csrfToken);
        if (!created || typeof created.share_id !== 'string' || !uuid.test(created.share_id)) {
          throw new Error('分享連結回應不完整');
        }
        shareId = created.share_id.toLowerCase();
        panel.setAttribute('data-share-id', shareId);
      }
      const body = await postJson(`/shares/${shareId}/links`, {}, csrfToken);
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
