import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import type {Pool} from 'pg';
import {createApp} from '../../apps/platform-api/src/app.js';
import {developmentPages} from '../../modules/development/pages.js';
import {TAB_TITLES} from '../../apps/portal-web/src/features/metadata.js';
import {interfaceMessages} from '../../apps/portal-web/src/interface-messages.js';
import {developmentMap,markdownBody} from '../../modules/development/service.js';
import {PUBLIC_AUTHOR_CLAIM_SQL} from '../../modules/community/repo-author-claims.js';
import {PUBLIC_BOOK_CACHE_SQL,PUBLIC_BOOK_METRICS_SQL} from '../../modules/shares/repository-cache.js';

const origin='http://127.0.0.1:4310';
// Guidance may enrich a skill page from the public repository cache only. Guild designations
// (catalog names and approved guild→book bindings) are public catalog facts, not member data.
const normalizeSql=(sql:string)=>sql.replace(/\s+/g,' ').trim();
const publicEditorial='SELECT summary,collaboration_intro,milestones,tasks,updated_at,aggregate_version FROM skill_book_editorial WHERE book_id=$1';
const publicDiscovery=new Set(['SELECT book_id,published_at FROM skill_publications WHERE published_at<=$1','SELECT book_id,summary FROM skill_book_editorial','SELECT guild_key,name FROM positioning_guild_catalog','SELECT DISTINCT guild_key,book_id FROM guild_skill_book_bindings',`SELECT repository_key,count(*) FILTER(WHERE first_confirmed_at>$1 AND first_confirmed_at<=$3)::int AS week_stars, count(*) FILTER(WHERE first_confirmed_at>$2 AND first_confirmed_at<=$3)::int AS month_stars FROM skill_star_support WHERE active AND first_confirmed_at>$2 AND first_confirmed_at<=$3 GROUP BY repository_key`,normalizeSql(PUBLIC_AUTHOR_CLAIM_SQL),normalizeSql(PUBLIC_BOOK_CACHE_SQL),normalizeSql(PUBLIC_BOOK_METRICS_SQL)]);
const publiclyReadable=(sql:string)=>sql===publicEditorial||publicDiscovery.has(normalizeSql(sql));
let privateQueries=0;
const pool={query:(sql:string)=>{
 if(publiclyReadable(sql)||sql==='SELECT snapshot,checked_at,retry_after,last_error FROM github_repository_metrics WHERE repository_key=$1')return Promise.resolve({rows:[]});
 privateQueries++;throw new Error('public guidance accessed private database');
}} as unknown as Pool;
const app=createApp(pool,origin);

for(const [id,title] of [['private-ai','私人 AI 工作室'],['workbench','任務協作'],['showcase','作品與合作']] as const){
 test(`${id} keeps the same title in navigation, page heading and page tools`,()=>{
  assert.equal(interfaceMessages[`nav.${id}`][0],title);
  assert.equal(TAB_TITLES[id],title);
  // PageTools uses this title for its group, dialog name and visible heading.
  assert.equal(developmentPages.find(page=>page.id===id)?.title,title);
 });
}

test('every workspace page and entry flow maps to existing source, tests and an actual managed repository',()=>{
 const map=developmentMap(),repos=new Set(map.repositories.map(repo=>repo.repository));
 assert.equal(repos.size,61);assert.equal(map.skill_books.length,55);
 const types=readFileSync('apps/portal-web/src/types.ts','utf8');
 const tabs=[...types.match(/export type TabId = ([^\n]+)/)![1].matchAll(/'([^']+)'/g)].map(match=>match[1]);
 for(const id of [...tabs,'registration','onboarding','admin','skillbooks'])assert.ok(developmentPages.some(page=>page.id===id),id);
 for(const page of map.pages){
  assert.ok(repos.has(page.repository));
  for(const repo of page.related_repositories)assert.ok(repos.has(repo),repo);
  for(const path of page.source_paths)assert.ok(existsSync(path),path);
  for(const command of page.checks)for(const match of command.matchAll(/tests\/[\w/.-]+/g))assert.ok(existsSync(match[0]),match[0]);
 }
 for(const book of map.skill_books){
  assert.ok(book.guide,book.id);assert.ok(repos.has(new URL(book.repository_url).pathname.slice(1)));
 }
});

test('unauthenticated crawlers get useful HTML, Markdown and JSON without JavaScript or member data',async()=>{
 const index=await app.request(origin+'/development');assert.equal(index.status,200);
 assert.match(index.headers.get('content-type')??'',/text\/html/);
 const html=await index.text();assert.match(html,/href="\/development\/onboarding"/);assert.match(html,/href="\/development\/skills\/security-scanner"/);
 const mapResponse=await app.request(origin+'/api/v1/development-map');assert.equal(mapResponse.status,200);
 const map:any=await mapResponse.json();assert.equal(map.format,'freedom.development-map/v1');
 assert.deepEqual(await (await app.request(origin+'/.well-known/freedom-development.json')).json(),map);
 for(const page of map.pages){
  const response=await app.request(origin+page.guide_url);assert.equal(response.status,200,page.id);
  const body=await response.text();assert.match(body,/href="https:\/\/github.com\/FreeTWAI\/freedom-platform\/fork"/);
  assert.match(body,/AGENTS\.md/);assert.equal(body.includes('<script'),false);
  for(const repo of page.related_repositories)assert.ok(body.includes(`href="https://github.com/${repo}"`),repo);
  const markdown=await app.request(origin+page.markdown_url);assert.equal(markdown.status,200);assert.match(await markdown.text(),/^# /);
 }
 for(const book of map.skill_books){
  const response=await app.request(origin+book.guide_url);assert.equal(response.status,200,book.id);
  const body=await response.text();assert.ok(body.includes(book.guide.first_result));assert.ok(body.includes(book.upstream_url));
  assert.match(await (await app.request(origin+book.markdown_url)).text(),/## 使用筆記/);
 }
 const llms=await (await app.request(origin+'/llms.txt')).text();assert.match(llms,/\/development\/admin\.md/);
 assert.doesNotMatch(JSON.stringify(map),/@|user_id|csrf_token|access_token|session_id|"\/home\/|"\/tmp\//);
 assert.equal((await app.request(origin+'/api/v1/me/account')).status,401);
 assert.equal((await app.request(origin+'/api/v1/dashboard')).status,401);
 assert.equal((await app.request(origin+'/admin/api/bootstrap')).status,503); // no Access configuration in local tests
 assert.equal(privateQueries,0);
});

test('public skill guidance survives a repository cache outage without substituting zero counts and renders cached original metadata when present',async()=>{
 const offline=createApp({query:(sql:string)=>publiclyReadable(sql)?Promise.resolve({rows:[]}):Promise.reject(Error('cache unavailable'))} as unknown as Pool,origin);
 const response=await offline.request(origin+'/development/skills/security-scanner');assert.equal(response.status,200);
 const html=await response.text(),support=html.match(/<section class="public-github-social"[^>]*>[\s\S]*?<\/section>/)?.[0];
 assert.ok(support,'GitHub actions remain available when the public cache is unavailable');
 assert.equal(support.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim(),'☆ 加星 —');
 assert.ok(html.includes('href="https://github.com/teddashh/ai-security-scanner"'));
 assert.ok(html.includes('從原作開始共創 ↗'));

 // Cached original README, release, stars, author and ahead-of-pin notice render natively across HTML, .md and SKILL.md.
 const cached=createApp({query:(sql:string)=>{
  const normalized=normalizeSql(sql);
  if(normalized===normalizeSql(PUBLIC_BOOK_CACHE_SQL)){
   return Promise.resolve({rows:[{
    provider_repo_id:'9001',
    full_name:'teddashh/ai-security-scanner',
    current_url:'https://github.com/teddashh/ai-security-scanner',
    description:'Cached original scanner description from GitHub',
    topics:['security'],
    license_spdx:'MIT',
    readme_html:'<p>Cached original README body</p><pre><code>npx security-scan</code></pre>',
    latest_release:{tag_name:'v2.4.0',name:'Scanner v2.4.0',html_url:'https://github.com/teddashh/ai-security-scanner/releases/tag/v2.4.0',published_at:'2026-11-10T00:00:00Z'},
    facts:{owner_login:'teddashh',default_branch:'main',stars:421,head_sha:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'},
    fetched_at:'2026-11-12T00:00:00Z',
    fetch_state:'ready',
    observed_book_id:'security-scanner',
    observed_requested_full_name:'teddashh/ai-security-scanner',
    metric_snapshot:null,
    metric_checked_at:null
   }]});
  }
  return publiclyReadable(sql)?Promise.resolve({rows:[]}):Promise.reject(Error('private'));
 }} as unknown as Pool,origin);
 const cachedHtml=await (await cached.request(origin+'/development/skills/security-scanner')).text();
 assert.ok(cachedHtml.includes('Cached original scanner description from GitHub'));
 assert.ok(cachedHtml.includes('Cached original README body'));
 assert.ok(cachedHtml.includes('v2.4.0'));
 assert.ok(cachedHtml.includes('★ 421'));
 assert.ok(cachedHtml.includes('原作者有新版本'));
 assert.ok(cachedHtml.includes('https://github.com/teddashh/ai-security-scanner/releases/tag/v2.4.0'));
 const notesStart=cachedHtml.indexOf('id="skill-usage-notes"');
 const copyIdx=cachedHtml.indexOf('https://github.com/FreeTWAI/ai-security-scanner');
 assert.ok(notesStart>0&&copyIdx>notesStart,'integration copy stays inside 使用筆記 history');
 const cachedMd=await (await cached.request(origin+'/development/skills/security-scanner.md')).text();
 assert.ok(cachedMd.includes('原作者有新版本：https://github.com/teddashh/ai-security-scanner/releases/tag/v2.4.0'));
 assert.ok(cachedMd.includes('## 使用筆記')&&cachedMd.indexOf('歷史紀錄（工坊整合副本）')>cachedMd.indexOf('## 使用筆記'));
});

test('unknown guide paths do not become an SPA fallback and authored text cannot inject executable HTML',async()=>{
 for(const path of ['/development/unknown','/development/skills/unknown.md','/development/skills/unknown/other'])
  assert.equal((await app.request(origin+path)).status,404,path);
 const body=markdownBody('## <img src=x onerror=alert(1)>\nhttps://example.invalid/"onclick="alert(1)\n```sh\n<script>boom</script>\n```');
 assert.equal(body.includes('<img'),false);assert.equal(body.includes('<script>'),false);
 assert.equal(body.includes('href="javascript:'),false);assert.match(body,/&lt;script&gt;/);
});
