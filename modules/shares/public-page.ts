import type {Pool} from 'pg';
import {transaction} from '../../packages/db/index.js';
import {requireCondition} from '../../packages/shared/problem.js';
import {escapeReadme as escape} from './sanitize.js';
import {repositoryPage} from './repository-cache.js';
export const sharePageCss='main{min-width:0}.share-readme{overflow-x:auto}.share-readme img{max-width:100%;height:auto}.share-readme table{display:block;overflow-x:auto}.share-actions{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px}.share-meta a,.share-release a,header a{display:inline-flex;align-items:center;min-height:44px}.share-code{overflow-x:auto;padding:12px;border-radius:12px;border:1px solid var(--line);background:var(--bg)}@media(max-width:480px){.share-actions .btn-primary{width:100%}}.share-topics{display:flex;gap:.35rem;flex-wrap:wrap}.share-topic{border:1px solid var(--line,#535e77);border-radius:999px;padding:.15rem .55rem;font-size:.78rem}';
/** Minimal Chinese 404 page for unknown public share/event URLs without reflecting raw ids. */
export function publicNotFoundHtml(){
 return '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>找不到這個頁面｜自由工坊</title><link rel="stylesheet" href="/event-page.css"></head><body><header><img class="logo" src="/brand/freedom-workshop-compact-transparent.png" alt="自由工坊" width="132" height="44"></header><main><section aria-labelledby="not-found-title"><h1 id="not-found-title">找不到這個頁面</h1><a class="btn btn-primary" href="/">回到首頁</a></section></main></body></html>';
}
/** Only intrinsically public repository/link objects. Domain references keep their own audience. */
export async function publicSharePage(pool:Pool,id:string,origin:string,via?:string){
 const data=await transaction(pool,async q=>{
  const share=(await q.query(`SELECT share_id,title,kind,canonical_url,repo_id FROM shares WHERE share_id=$1 AND kind IN ('repository','link') AND state='published'
    AND (first_sharer_user_id IS NULL OR NOT is_verification_test_account(first_sharer_user_id))`,[id])).rows[0];
  requireCondition(share,404,'not_found','找不到分享。');
  const count=(await q.query(`SELECT count(*)::int n FROM share_endorsements WHERE share_id=$1 AND withdrawn_at IS NULL AND NOT is_verification_test_account(user_id)`,[id])).rows[0].n;
  return {share,count,repository:share.repo_id?await repositoryPage(q,share.repo_id):null};
 });
 const {share:s,repository:r}=data;
 const member=`/#shares/${id}${via&&/^[A-Za-z0-9_-]{10}$/.test(via)?`?via=${via}`:''}`;
 const facts=r?[r.license_spdx?`授權：${escape(r.license_spdx)}`:null,r.pushed_at?`更新：${escape(r.pushed_at.slice(0,10))}`:null,
  r.forks_count!==null?`Fork：${r.forks_count}`:null,r.open_issues_count!==null?`Issues：${r.open_issues_count}`:null,r.subscribers_count!==null?`Watchers：${r.subscribers_count}`:null,
  r.homepage?`<a href="${escape(r.homepage)}" rel="noopener noreferrer">網站</a>`:null].filter(Boolean):[];
 const repoSection=r?`<section aria-label="專案資訊">${r.description?.trim()?`<p>${escape(r.description)}</p>`:''}${facts.length?`<p class="share-facts">${facts.join(' · ')}</p>`:''}${r.topics.length?`<div class="share-topics">${r.topics.slice(0,5).map((topic:string)=>`<span class="share-topic">${escape(topic)}</span>`).join('')}</div>`:''}<p class="share-meta">${r.stars===null?'':`GitHub 星數：${r.stars} · `}原作帳號：<a href="https://github.com/${encodeURIComponent(r.original_author)}">${escape(r.original_author)}</a></p>${r.quick_start?.trim()?`<h2>開始用</h2><pre class="share-code">${escape(r.quick_start)}</pre>`:''}${r.readme_html?.trim()?`<h2>README</h2><section class="share-readme">${r.readme_html}</section>`:''}${r.latest_release?`<h2>最新版本</h2><p class="share-release"><a href="${escape(r.latest_release.html_url)}">${escape(r.latest_release.name||r.latest_release.tag_name)}</a></p>`:''}</section>`:'';
 const host=!r&&s.kind==='link'?new URL(s.canonical_url).hostname:'';
 const body=`<h1>${escape(s.title)}</h1>${host?`<p class="share-meta">${escape(host)}</p>`:''}<section aria-label="分享"><div class="share-actions"><a class="btn btn-primary" href="${escape(member)}">登入並加入分享</a>${r?'':`<a class="btn btn-secondary" href="${escape(s.canonical_url)}" rel="nofollow noopener noreferrer">開啟原文</a>`}</div><p>${data.count} 位會員分享</p></section>${repoSection}`;
 return {repo_id:s.repo_id,stale:r?.stale??false,html:`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(s.title)}｜自由工坊</title><link rel="canonical" href="${escape(origin+'/s/'+id)}"><meta property="og:title" content="${escape(s.title)}"><link rel="stylesheet" href="/event-page.css"><link rel="stylesheet" href="/share-page.css"></head><body><header><a href="/"><img class="logo" src="/brand/freedom-workshop-compact-transparent.png" alt="自由工坊" width="132" height="44"></a></header><main>${body}</main></body></html>`};
}
