import {PUBLIC_REVALIDATION_MARKUP} from '../../packages/shared/public-revalidation.js';
import type {PublicSocialPostPage} from './public-social-posts.js';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]!));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const login = (id: string) => `/?post_return=${id}#account`;
const join = (id: string) => `/?post_return=${id}&join=1#account`;

function documentHtml(title: string, metadata: string, body: string) {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="color-scheme" content="light dark"><title>${escapeHtml(title)}</title>${metadata}<link rel="stylesheet" href="/social-post.css"><script src="/social-post.js" defer></script>${PUBLIC_REVALIDATION_MARKUP}</head><body><a class="skip-link" href="#post-content">跳到貼文</a><header class="site-header"><a class="brand" href="/" aria-label="自由工坊首頁"><img src="/brand/freedom-workshop.webp" width="1280" height="720" alt="自由工坊"></a><span class="site-label">工坊分享</span></header><main id="post-content" tabindex="-1">${body}</main><footer class="site-footer"><a href="/">回到自由工坊</a></footer></body></html>`;
}

/** A missing or withdrawn publication must not keep its previous title, OG,
 * author or image. A separate member login intent preserves old private links. */
export function unavailableSocialPostHtml(id: string) {
  const memberLink = id.length===36&&uuid.test(id) ? `<a class="button primary" href="/?social-post=${id}#account">會員登入後查看</a>` : '';
  return documentHtml('目前無法閱讀這則貼文｜自由工坊', '', `<section class="card unavailable"><p class="eyebrow">工坊分享</p><h1>目前無法閱讀這則貼文</h1><p>這則貼文尚未開放免登入閱讀，或目前已無法查看。</p><p class="muted">如果你已是會員，可以登入後確認是否有閱覽權限。</p>${memberLink}</section>`);
}

export function publicSocialPostHtml(page: PublicSocialPostPage, publicOrigin: string, registrationEnabled: boolean) {
  const {post} = page;
  const path = `/posts/${post.post_id}`;
  const canonical = new URL(path, publicOrigin).href;
  const description = Array.from(post.note ?? post.title).slice(0, 160).join('');
  const image = new URL(post.image_url ?? '/brand/freedom-workshop.webp', publicOrigin).href;
  const metadata = `<meta name="description" content="${escapeHtml(description)}"><meta property="og:type" content="article"><meta property="og:title" content="${escapeHtml(post.title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(canonical)}"><meta property="og:image" content="${escapeHtml(image)}"><meta property="og:site_name" content="自由工坊">`;
  const date = new Intl.DateTimeFormat('zh-TW', {dateStyle:'medium',timeZone:'Asia/Taipei'}).format(new Date(post.created_at));
  const text = post.kind === 'note'
    ? `<h1 class="visually-hidden">${escapeHtml(post.author.display_name)}的貼文</h1><div class="post-text">${escapeHtml(post.note ?? post.title)}</div>`
    : `<h1>${escapeHtml(post.title)}</h1>${post.note ? `<div class="post-text">${escapeHtml(post.note)}</div>` : ''}${post.url ? `<a class="source-link" href="${escapeHtml(post.url)}" target="_blank" rel="noopener noreferrer">查看原文 <span aria-hidden="true">↗</span><span class="visually-hidden">（在新分頁開啟）</span></a>` : ''}`;
  const related = page.related.slice(0, 3).map(item => `<article class="preview-card"><p class="author">${escapeHtml(item.author.display_name)}</p><h3>${escapeHtml(item.title)}</h3><p class="preview-text">${escapeHtml(item.summary)}</p><a class="button secondary" data-related-post="${escapeHtml(item.post_id)}" href="${login(item.post_id)}">登入繼續閱讀</a></article>`).join('');
  const body = `<article class="card shared-post" data-public-post="${escapeHtml(post.post_id)}" data-public-version="${escapeHtml(page.version)}"><header class="post-author"><span class="author-mark" aria-hidden="true">${escapeHtml(Array.from(post.author.display_name)[0] ?? '工')}</span><div><p class="author">${escapeHtml(post.author.display_name)}</p><p class="post-date"><time datetime="${escapeHtml(post.created_at)}">${escapeHtml(date)}</time>${post.edited_at ? ' · 已編輯' : ''}</p></div><span class="public-label">公開分享</span></header>${text}${post.image_url ? `<img class="post-image" src="${escapeHtml(post.image_url)}" alt="貼文附圖" width="640" height="360">` : ''}</article>
<section class="card reading-invite" aria-labelledby="reading-invite-title"><div><h2 id="reading-invite-title" data-invite-title>繼續看看工坊裡的分享</h2><p data-invite-description>你已讀完這篇公開貼文。登入後可以看更多分享、按讚與加入討論。</p></div><div class="actions"><a class="button primary" data-post-login="${escapeHtml(post.post_id)}" href="${login(post.post_id)}">登入看更多與留言</a>${registrationEnabled ? `<a class="button secondary" data-post-join href="${escapeHtml(join(post.post_id))}">建立帳號</a>` : ''}</div></section>
${related ? `<section class="related" aria-label="更多工坊分享"><h2>更多工坊分享</h2><p class="muted" data-preview-description>先看看幾則分享，登入後就能繼續閱讀。</p><div class="preview-list">${related}</div></section>` : ''}<p class="reading-status muted" role="status" data-reading-status></p>`;
  return documentHtml(`${post.title}｜自由工坊`, metadata, body);
}
