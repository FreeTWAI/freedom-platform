import type {Pool} from 'pg';
import {transaction} from '../../packages/db/index.js';
import {requireCondition} from '../../packages/shared/problem.js';
import {escapeReadme as escape} from './sanitize.js';
import {repositoryPage} from './repository-cache.js';
export const sharePageCss='main{min-width:0}.share-readme{overflow-x:auto}.share-readme img{max-width:100%;height:auto}.share-readme table{display:block;overflow-x:auto}.share-actions{display:flex;gap:12px;flex-wrap:wrap}.share-actions a{border:1px solid #535e77;padding:4px 12px;border-radius:8px;text-decoration:none}';
/** Only intrinsically public repository/link objects. Domain references keep their own audience. */
export async function publicSharePage(pool:Pool,id:string,origin:string,via?:string){
 const data=await transaction(pool,async q=>{
  const share=(await q.query(`SELECT share_id,title,kind,canonical_url,repo_id FROM shares WHERE share_id=$1 AND kind IN ('repository','link') AND state='published'
    AND (first_sharer_user_id IS NULL OR NOT is_verification_test_account(first_sharer_user_id))`,[id])).rows[0];
  requireCondition(share,404,'not_found','找不到分享。');
  const count=(await q.query(`SELECT count(*)::int n FROM share_credit_events e WHERE share_id=$1 AND basis IN ('created','shared_again') AND units=1
    AND NOT EXISTS(SELECT 1 FROM share_credit_events r WHERE r.reverses_event_id=e.event_id)`,[id])).rows[0].n;
  return {share,count,repository:share.repo_id?await repositoryPage(q,share.repo_id):null};
 });
 const {share:s,repository:r}=data;
 const member=`/#shares/${id}${via&&/^[A-Za-z0-9_-]{10}$/.test(via)?`?via=${via}`:''}`;
 const body=`<h1>${escape(s.title)}</h1><div class="share-actions">${r?`<a href="${escape(member)}">☆ 加星</a>`:`<a href="${escape(s.canonical_url)}" rel="nofollow noopener noreferrer">開啟原文</a>`}<a href="${escape(member)}">我也要分享</a></div>`+
   (r?`<p>${escape(r.description??'')}</p><p>${r.stars===null?'':`GitHub 星數：${r.stars} · `}原作帳號：<a href="https://github.com/${encodeURIComponent(r.original_author)}">${escape(r.original_author)}</a></p>
    <h2>開始用</h2><pre>${escape(r.quick_start)}</pre><h2>README</h2><section class="share-readme">${r.readme_html}</section>
    ${r.latest_release?`<h2>最新版本</h2><a href="${escape(r.latest_release.html_url)}">${escape(r.latest_release.name||r.latest_release.tag_name)}</a>`:''}`:'')+`<p>${data.count} 位會員分享</p>`;
 return {repo_id:s.repo_id,stale:r?.stale??false,html:`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(s.title)}｜自由工坊</title><link rel="canonical" href="${escape(origin+'/s/'+id)}"><meta property="og:title" content="${escape(s.title)}"><link rel="stylesheet" href="/development.css"><link rel="stylesheet" href="/share-page.css"></head><body><nav><a href="/">自由工坊</a></nav><main>${body}</main></body></html>`};
}
