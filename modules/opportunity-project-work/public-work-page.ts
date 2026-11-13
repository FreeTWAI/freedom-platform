import type { PublicWorkView } from './public-sharing.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeOriginUrl(origin: string): string {
  try {
    const parsed = new URL(origin);
    if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password) {
      return parsed.origin;
    }
  } catch { /* Fall through cleanly. */ }
  return 'https://freetwai.com';
}

export function safeExternalUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password) {
      return parsed.toString();
    }
  } catch { /* Refuse invalid or unsafe schemes. */ }
  return null;
}

export function publicWorkHtml(work: PublicWorkView, origin: string): string {
  const base = safeOriginUrl(origin);
  const canonicalUrl = `${base}/works/${work.showcase_id}`;
  const ogImage = `${base}/brand/og-image.jpg`;
  const summary = work.description.trim();
  const ogDescription = summary.slice(0, 200);
  const externalLink = safeExternalUrl(work.public_url);
  const authorInitial = Array.from(work.creator_name.trim())[0] ?? '工';
  const titleText = `${work.title}｜自由工坊`;

  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(titleText)}</title>
  <meta name="description" content="${escapeHtml(ogDescription)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="自由工坊">
  <meta property="og:title" content="${escapeHtml(titleText)}">
  <meta property="og:description" content="${escapeHtml(ogDescription)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:image" content="${escapeHtml(ogImage)}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="stylesheet" href="/social-post.css">
</head>
<body>
  <a class="skip-link" href="#content">跳至作品內容</a>
  <header class="site-header">
    <a class="brand" href="/"><img src="/brand/freedom-workshop-compact-transparent.png" alt="自由工坊"></a>
    <span class="site-label">公開作品</span>
  </header>
  <main id="content" tabindex="-1">
    <article class="card">
      <div class="post-author">
        <div class="author-mark" aria-hidden="true">${escapeHtml(authorInitial)}</div>
        <div>
          <p class="author">${escapeHtml(work.creator_name)}</p>
          <p class="post-date">創作者公開作品</p>
        </div>
        ${work.sharer_name ? `<span class="public-label">由 ${escapeHtml(work.sharer_name)} 推薦分享</span>` : ''}
      </div>
      <h1>${escapeHtml(work.title)}</h1>
      <p class="post-text">${escapeHtml(summary)}</p>
      ${externalLink ? `<p><a class="source-link" href="${escapeHtml(externalLink)}" rel="noopener noreferrer nofollow" target="_blank">前往作品外部連結</a></p>` : ''}
    </article>
    <section class="card reading-invite" aria-label="前往自由工坊">
      <h2>想在自由工坊交流或合作嗎？</h2>
      <p>登入或加入自由工坊後，可以查看更多會員作品與合作討論。</p>
      <div class="actions">
        <a class="button primary" href="/#showcase/${escapeHtml(work.showcase_id)}">在自由工坊查看作品</a>
        <a class="button secondary" href="/">回到自由工坊首頁</a>
      </div>
    </section>
  </main>
  <footer class="site-footer">
    <a href="/">自由工坊</a>
  </footer>
</body>
</html>`;
}

export function unavailableWorkHtml(): string {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>找不到公開作品｜自由工坊</title>
  <link rel="stylesheet" href="/social-post.css">
</head>
<body>
  <header class="site-header">
    <a class="brand" href="/"><img src="/brand/freedom-workshop-compact-transparent.png" alt="自由工坊"></a>
    <span class="site-label">公開作品</span>
  </header>
  <main id="content" tabindex="-1">
    <article class="card unavailable">
      <h1>找不到公開作品</h1>
      <p>這件作品尚未開放公開閱讀、內容已更新待重新確認，或目前無法檢視。</p>
      <div class="actions">
        <a class="button primary" href="/">返回自由工坊</a>
      </div>
    </article>
  </main>
</body>
</html>`;
}
