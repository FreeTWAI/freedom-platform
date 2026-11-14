import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { migrate } from '../../scripts/database.js';
import { seedLocal,DEMO_USERS,DEMO_COMMUNITY,DEMO_PASSWORD } from '../../packages/testing/seed.js';
import type { Actor } from '../../modules/identity-membership/service.js';
import { createShare,reportShare,retractShare,shareLink,myCredit } from '../../modules/shares/service.js';
import { appendCredit,reverseCredit } from '../../modules/shares/credit.js';
import { transaction } from '../../packages/db/index.js';
import { fetchShareLink } from '../../modules/shares/adapters/link.js';
import { repositoryFacts } from '../../modules/shares/adapters/repository.js';
import { creditPromotionClick,promotionGo } from '../../modules/community/promotion.js';
import { createShowcase, withdrawOwnShowcase, updateOwnShowcase, publishOwnShowcase } from '../../modules/opportunity-project-work/business.js';
import { readPublicWork, setShowcaseSharing } from '../../modules/opportunity-project-work/public-sharing.js';
const url=process.env.TEST_DATABASE_URL;
assert.ok(url,'Set an isolated TEST_DATABASE_URL');
const schema=`fp_shares_${randomUUID().replaceAll('-','')}`;
const admin=new Pool({connectionString:url});const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
let actors:Actor[]=[];
const original={id:901,full_name:'fixture/original',private:false,visibility:'public',archived:false,fork:false,owner:{id:990,login:'fixture'},default_branch:'main',description:'Original repository',stargazers_count:23};
let fetches=0;
const fetcher:typeof fetch=async input=>{fetches++;const path=new URL(String(input)).pathname;return new Response(JSON.stringify(path==='/repos/fixture/fork'?{...original,id:902,full_name:'fixture/fork',fork:true,source:{full_name:'fixture/original'}}:original),{headers:{'Content-Type':'application/json'}});};
const context={fetcher};
const cmd=(actor:Actor,body:unknown,operation='POST /shares',key=randomUUID())=>({actor,body,operation,key});
before(async()=>{
 await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);await seedLocal(pool);
 for(let i=0;i<5;i++){
  const id=i===0?DEMO_USERS[0].user_id:randomUUID(),token=randomUUID();
  if(i>0)await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,active,onboarding_required)
    SELECT $1,community_id,$2,'Synthetic sharer',password_hash,$3,true,false FROM users WHERE user_id=$4`,[id,`shares-${i}@example.com`,randomUUID(),DEMO_USERS[0].user_id]);
  await pool.query('UPDATE users SET email=$2 WHERE user_id=$1',[id,`shares-${i}@example.com`]);
  await pool.query(`INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$1,now()+interval '1 day')`,[token,id]);
  actors.push({user_id:id,community_id:DEMO_COMMUNITY,session_hash:token} as Actor);
 }
});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
test('fork resolves to upstream original; wrong hosts and hidden/archived repositories rejected',async()=>{
 assert.equal((await repositoryFacts('https://github.com/fixture/fork',context)).id,'901');
 for(const u of ['http://github.com/o/r','https://github.com.evil.test/o/r','https://user@github.com/o/r','https://github.com/o/r/tree/main'])await assert.rejects(repositoryFacts(u,context));
 for(const change of [{private:true},{visibility:'private'},{archived:true}])await assert.rejects(repositoryFacts('https://github.com/fixture/original',{fetcher:async()=>new Response(JSON.stringify({...original,...change}))}));
});
test('fetch guard rejects private shapes, redirects, failed transport, and oversized content',async()=>{
 for(const u of ['https://127.0.0.1/','https://[::1]/','https://localhost/','https://a.internal/','http://example.com/'])await assert.rejects(fetchShareLink(u,async()=>{throw Error('must not fetch');}));
 await assert.rejects(fetchShareLink('https://example.com/'));
 await assert.rejects(fetchShareLink('https://example.com/',async()=>new Response(null,{status:302,headers:{Location:'https://127.0.0.1/'}})));
 await assert.rejects(fetchShareLink('https://example.com/',async()=>new Response('x'.repeat(1048577),{headers:{'Content-Type':'text/html'}})));
 assert.equal((await fetchShareLink('https://example.com/?utm_source=x',async()=>new Response('<title>Safe</title>',{headers:{'Content-Type':'text/html'}}))).url,'https://example.com/');
});
test('platform share routes send the metrics credential only to GitHub API reads',async()=>{
 const {createApp}=await import('../../apps/platform-api/src/app.js');
 const {DEMO_PASSWORD}=await import('../../packages/testing/seed.js');
 const {randomBytes}=await import('node:crypto');
 const secret=randomBytes(24).toString('hex'),calls:{url:string;authorization:string|null}[]=[];
 const github:typeof fetch=async(input,init)=>{
  const url=String(input);calls.push({url,authorization:new Headers(init?.headers).get('authorization')});
  if(url.endsWith('/readme'))return new Response('<p>README</p>');
  if(url.endsWith('/releases/latest'))return new Response(null,{status:404});
  return Response.json({...original,id:1901,full_name:'fixture/token'});
 };
 const preview:typeof fetch=async(input,init)=>{
  const url=String(input);calls.push({url,authorization:new Headers(init?.headers).get('authorization')});
  return url.includes('/start')?new Response(null,{status:302,headers:{location:'https://elsewhere.example/final'}}):new Response('<title>Link</title>',{headers:{'Content-Type':'text/html'}});
 };
 const deferred:Promise<void>[]=[],origin='http://127.0.0.1:4310';
 const app=createApp(pool,origin,'local',{githubSocial:{metricsToken:secret,fetcher:github},linkPreviewFetch:preview,afterResponse:work=>{deferred.push(work());}});
 const login=await app.request(origin+'/api/v1/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'shares-0@example.com',password:DEMO_PASSWORD})});
 assert.equal(login.status,200);const session=await login.json() as {csrf_token:string};
 const headers={Origin:origin,Cookie:login.headers.get('set-cookie')!.split(';')[0],'X-CSRF-Token':session.csrf_token,'Content-Type':'application/json','Idempotency-Key':randomUUID()};
 for(const body of [{kind:'repository',url:'https://github.com/fixture/token'},{kind:'link',url:'https://example.com/start'}]){
  const response=await app.request(origin+'/api/v1/shares/preview',{method:'POST',headers,body:JSON.stringify(body)});assert.equal(response.status,200);
 }
 const created=await createShare(pool,cmd(actors[0],{url:'https://github.com/fixture/token'}),{fetcher:github});
 calls.length=0;
 const page=await app.request(origin+'/s/'+created.share_id);assert.equal(page.status,200);await Promise.all(deferred);
 assert.ok(calls.some(call=>call.url.startsWith('https://api.github.com/')&&call.authorization===`Bearer ${secret}`));
 calls.length=0;
 for(const body of [{kind:'repository',url:'https://github.com/fixture/token'},{kind:'link',url:'https://example.com/start'}]){
  const response=await app.request(origin+'/api/v1/shares/preview',{method:'POST',headers,body:JSON.stringify(body)});assert.equal(response.status,200);
 }
 assert.ok(calls.some(call=>call.url.startsWith('https://api.github.com/')&&call.authorization===`Bearer ${secret}`));
 const links=calls.filter(call=>!call.url.startsWith('https://api.github.com/'));assert.equal(links.length,2);assert.ok(links.every(call=>call.authorization===null));
});
test('create retries, duplicate co-sharer, concurrent creates, ledger uniqueness and retraction',async()=>{
 const c=cmd(actors[0],{url:'https://github.com/fixture/original'});const first=await createShare(pool,c,context);const n=fetches;
 assert.deepEqual(await createShare(pool,c,{fetcher:async()=>{throw Error('offline');}}),first);assert.equal(fetches,n);
 const duplicates=await Promise.all([1,1,2].map(i=>createShare(pool,cmd(actors[i],{kind:'link',url:'https://github.com/fixture/fork'}),context)));
 assert.ok(duplicates.every(d=>d.share_id===first.share_id&&!d.created));
 assert.equal((await pool.query('SELECT count(*)::int n FROM share_credit_events WHERE share_id=$1',[first.share_id])).rows[0].n,3);
 await assert.rejects(createShare(pool,{...c,body:{url:'https://github.com/other/repo'}},context),/同一操作/);
 await assert.rejects(pool.query('UPDATE share_credit_events SET units=-1 WHERE share_id=$1',[first.share_id]),/append-only/);
 await assert.rejects(pool.query('DELETE FROM share_credit_events WHERE share_id=$1',[first.share_id]),/append-only/);
 const fact={community_id:actors[0].community_id,share_id:first.share_id,user_id:actors[0].user_id,role:'sharer' as const,basis:'star_confirmed' as const,source_ref:'star:901:synthetic',actor_user_id:actors[3].user_id};
 await transaction(pool,async q=>{const id=await appendCredit(q,fact);assert.ok(id);assert.equal(await appendCredit(q,fact),undefined);await reverseCredit(q,id!);await reverseCredit(q,id!);});
 await transaction(pool,async q=>{assert.equal(await appendCredit(q,{...fact,source_ref:'self',actor_user_id:actors[0].user_id}),undefined);});
 await pool.query('UPDATE users SET email=$2 WHERE user_id=$1',[actors[4].user_id,'verification@example.invalid']);
 await transaction(pool,async q=>{assert.equal(await appendCredit(q,{...fact,source_ref:'test-actor',actor_user_id:actors[4].user_id}),undefined);assert.equal(await appendCredit(q,{...fact,source_ref:'test-beneficiary',user_id:actors[4].user_id}),undefined);});
 await pool.query('UPDATE users SET email=$2 WHERE user_id=$1',[actors[4].user_id,'shares-4@example.com']);
 const links=await shareLink(pool,cmd(actors[0],{},'links'),first.share_id);
 for(const [ua,user] of [['Googlebot',null],['Mozilla/5.0',actors[0].user_id]] as const)await creditPromotionClick(pool,{code:links.code,userAgent:ua,sessionUserId:user,network:'synthetic',now:new Date()});
 assert.equal((await pool.query('SELECT count(*)::int n FROM promotion_clicks')).rows[0].n,0);
 for(let i=0;i<2;i++)await creditPromotionClick(pool,{code:links.code,userAgent:'Mozilla/5.0',sessionUserId:actors[2].user_id,network:'synthetic',now:new Date()});
 assert.equal((await pool.query("SELECT count(*)::int n FROM share_credit_events WHERE basis='qualified_click_day'")).rows[0].n,1);
 await reportShare(pool,cmd(actors[1],{reason:'Spam'},'report'),first.share_id);await reportShare(pool,cmd(actors[1],{reason:'Spam'},'report'),first.share_id);
 assert.equal((await pool.query('SELECT state FROM shares WHERE share_id=$1',[first.share_id])).rows[0].state,'published');
 await reportShare(pool,cmd(actors[2],{reason:'Spam'},'report'),first.share_id);await reportShare(pool,cmd(actors[3],{reason:'Spam'},'report'),first.share_id);
 assert.equal((await pool.query('SELECT state FROM shares WHERE share_id=$1',[first.share_id])).rows[0].state,'published','Young accounts and co-sharers do not count toward hiding');
 assert.equal((await pool.query('SELECT sum(units)::int n FROM share_credit_events WHERE share_id=$1',[first.share_id])).rows[0].n,4);
 await transaction(pool,async q=>{assert.ok((await myCredit(q,actors[0])).items.some(x=>x.count===1));});
 await retractShare(pool,cmd(actors[0],{},'retract'),first.share_id);await retractShare(pool,cmd(actors[0],{},'retract'),first.share_id);
 assert.equal((await pool.query('SELECT sum(units)::int n FROM share_credit_events WHERE share_id=$1',[first.share_id])).rows[0].n,3,'Co-sharers and spreader reach survive personal retraction');
});
test('twenty per-member daily creations; retry and existing object remain allowed',async()=>{
 const member=actors[4],previewFetch=async()=>new Response('<title>Page</title>',{headers:{'Content-Type':'text/html'}});
 for(let i=0;i<20;i++)await createShare(pool,cmd(member,{url:`https://example.com/page/${i}`}),{previewFetch});
 await assert.rejects(createShare(pool,cmd(member,{url:'https://example.com/overflow'}),{previewFetch}),/今天/);
 const r=await createShare(pool,cmd(member,{url:'https://example.com/page/0'}),{previewFetch});assert.equal(r.created,false);
});

test('cached repository facts appear in share JSON and public HTML without a new fetch',async()=>{
 const {createApp}=await import('../../apps/platform-api/src/app.js');
 const source={...original,id:899,full_name:'fixture/facts',license:{spdx_id:'MIT'},homepage:'https://example.org/project?a=1&b=2',
  topics:['one','two','three','four','five','six'],forks_count:0,open_issues_count:12,subscribers_count:5,pushed_at:'2026-01-02T03:04:05Z',language:null};
 let reads=0;const fixture:typeof fetch=async()=>{reads++;return Response.json(source);};
 const share=await createShare(pool,cmd(actors[0],{url:'https://github.com/fixture/facts'}),{fetcher:fixture});
 const repoId=(await pool.query('SELECT repo_id FROM shares WHERE share_id=$1',[share.share_id])).rows[0].repo_id;
 await pool.query("UPDATE canonical_repositories SET fetched_at=now(),refresh_after=now()+interval '1 day' WHERE repo_id=$1",[repoId]);
 const origin='http://127.0.0.1:4310',app=createApp(pool,origin,'local',{githubSocial:{fetcher:fixture}});
 const login=await app.request(origin+'/api/v1/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'shares-0@example.com',password:DEMO_PASSWORD})});
 assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!.split(';')[0];reads=0;
 const response=await app.request(`${origin}/api/v1/shares/${share.share_id}`,{headers:{Cookie:cookie}});assert.equal(response.status,200);
 const json=await response.json() as any,repo=json.repository;
 assert.equal(repo.license_spdx,'MIT');assert.equal(repo.homepage,source.homepage);assert.equal(repo.pushed_at,source.pushed_at);
 assert.deepEqual([repo.forks_count,repo.open_issues_count,repo.subscribers_count],[0,12,5]);assert.deepEqual(repo.topics,source.topics.slice(0,5));
 const html=await (await app.request(`${origin}/s/${share.share_id}`)).text();
 for(const expected of ['MIT','2026-01-02','Fork：0','Issues：12','Watchers：5','>one<','>five<','https://example.org/project?a=1&amp;b=2'])assert.ok(html.includes(expected),expected);
 assert.ok(!html.includes('>six<'));assert.equal(reads,0);
 await pool.query("UPDATE canonical_repositories SET homepage='javascript:alert(1)',license_spdx=NULL,topics='{}',facts=facts-'metrics' WHERE repo_id=$1",[repoId]);
 await pool.query('DELETE FROM github_repository_metrics WHERE repository_key=$1',['fixture/facts']);
 const missing=await (await app.request(`${origin}/s/${share.share_id}`)).text();
 for(const absent of ['javascript:alert','授權：','更新：','Fork：','Issues：','Watchers：','share-topics'])assert.ok(!missing.includes(absent),absent);
});

test('repository cache renders original README/release, caches 24h and hides a vanished upstream without automatic credit penalty',async()=>{
 const {refreshRepository,repositoryPage}=await import('../../modules/shares/repository-cache.js');
 const fixture:typeof fetch=async(input,init)=>{
  const path=new URL(String(input)).pathname;
  if(path.endsWith('/readme')){assert.equal(new Headers(init?.headers).get('accept'),'application/vnd.github.html+json');if(new Headers(init?.headers).has('if-none-match'))return new Response(null,{status:304});return new Response('<h2>安裝</h2><pre><code>npm install fixture</code></pre><script>bad()</script>',{headers:{etag:'"readme-1"'}});}
  if(path.endsWith('/releases/latest'))return new Response(JSON.stringify({tag_name:'v1',name:'First',html_url:'https://github.com/fixture/cache/releases/tag/v1',published_at:'2026-11-01T00:00:00Z'}));
  return new Response(JSON.stringify({...original,id:903,full_name:'fixture/cache'}));
 };
 const s=await createShare(pool,cmd(actors[0],{url:'https://github.com/fixture/cache'}),{fetcher:fixture});
 const repoId=(await pool.query('SELECT repo_id FROM shares WHERE share_id=$1',[s.share_id])).rows[0].repo_id;
 await refreshRepository(pool,repoId,{fetcher:fixture});
 assert.equal((await pool.query('SELECT facts FROM canonical_repositories WHERE repo_id=$1',[repoId])).rows[0].facts.quick_start,'npm install fixture','quick start is calculated during the cache write');
 const {createPublicShareRoutes}=await import('../../apps/platform-api/src/routes/shares.js');
 const publicApp=createPublicShareRoutes(pool,'https://platform.example.com',{fetcher:fixture});
 const publicResponse=await publicApp.request(`/s/${s.share_id}?via=synthetic1`);assert.equal(publicResponse.status,200);
 const publicHtml=await publicResponse.text();assert.match(publicHtml,/npm install fixture/);assert.doesNotMatch(publicHtml,/<script|onclick/);assert.match(publicHtml,/synthetic1/);
 assert.equal(publicResponse.headers.get('cache-control'),'no-store');
 await transaction(pool,async q=>{const page=await repositoryPage(q,repoId);assert.equal(page.stale,false);assert.equal(page.quick_start,'npm install fixture');assert.doesNotMatch(page.readme_html,/script/);assert.equal(page.latest_release.tag_name,'v1');});
 await pool.query("UPDATE canonical_repositories SET facts=facts-'quick_start' WHERE repo_id=$1",[repoId]);
 await refreshRepository(pool,repoId,{fetcher:fixture},true);
 assert.equal((await pool.query('SELECT facts FROM canonical_repositories WHERE repo_id=$1',[repoId])).rows[0].facts.quick_start,'npm install fixture','304 upgrades an older cache on write');
 await refreshRepository(pool,repoId,{fetcher:async()=>{throw Error('fresh cache must not fetch');}});
 await pool.query("UPDATE canonical_repositories SET refresh_after=now()-interval '1 day' WHERE repo_id=$1",[repoId]);
 await refreshRepository(pool,repoId,{fetcher:async()=>new Response(null,{status:404})});
 assert.equal((await pool.query('SELECT state FROM shares WHERE share_id=$1',[s.share_id])).rows[0].state,'hidden');
 assert.equal((await pool.query('SELECT sum(units)::int n FROM share_credit_events WHERE share_id=$1',[s.share_id])).rows[0].n,1);
});

test('prepared facts from a concurrent replay cannot hide a different repository identity',async()=>{
 const {refreshRepository}=await import('../../modules/shares/repository-cache.js');
 const current={...original,id:7777002,full_name:'fixture/stable'};
 const other=await repositoryFacts('https://github.com/fixture/stable',{fetcher:async()=>Response.json({...current,id:7777003})});
 const s=await createShare(pool,cmd(actors[0],{url:'https://github.com/fixture/stable'}),{fetcher:async()=>Response.json(current)});
 const repoId=(await pool.query('SELECT repo_id FROM shares WHERE share_id=$1',[s.share_id])).rows[0].repo_id;
 const calls:string[]=[];
 const fetcher:typeof fetch=async input=>{
  const path=new URL(String(input)).pathname;calls.push(path);
  if(path==='/repositories/7777002'||path==='/repos/fixture/stable')return Response.json(current);
  return new Response(null,{status:404});
 };
 await refreshRepository(pool,repoId,{fetcher},true,other);
 assert.ok(calls.includes('/repositories/7777002'),'mismatched prepared facts require independent verification');
 assert.equal((await pool.query('SELECT state FROM shares WHERE share_id=$1',[s.share_id])).rows[0].state,'published');
 assert.equal((await pool.query('SELECT fetch_state FROM canonical_repositories WHERE repo_id=$1',[repoId])).rows[0].fetch_state,'ready');
});

test('a renamed repository recomputes a cached clone fallback when the README is unchanged',async()=>{
 const {refreshRepository}=await import('../../modules/shares/repository-cache.js');
 const facts=await repositoryFacts('https://github.com/fixture/after',{fetcher:async()=>Response.json({...original,id:7777001,full_name:'fixture/after'})});
 const repoId=randomUUID();
 // A share may update the current name before the old facts are refreshed.
 await pool.query(`INSERT INTO canonical_repositories
   (repo_id,provider,provider_repo_id,full_name,current_url,fetch_state,readme_html,etag,facts)
   VALUES($1,'github',$2,$3,$4,'ready','<p>No installation section</p>',$5,$6)`,
   [repoId,facts.id,facts.full_name,facts.url,'"unchanged"',JSON.stringify({...facts,full_name:'fixture/before',quick_start:'git clone https://github.com/fixture/before.git'})]);
 const fetcher:typeof fetch=async input=>new URL(String(input)).pathname.endsWith('/readme')?new Response(null,{status:304}):new Response(null,{status:404});
 await refreshRepository(pool,repoId,{fetcher},true,facts);
 assert.equal((await pool.query("SELECT facts->>'quick_start' quick_start FROM canonical_repositories WHERE repo_id=$1",[repoId])).rows[0].quick_start,'git clone https://github.com/fixture/after.git');
});

test('repository list cache selects no README and returns the stored quick start',async()=>{
 const {readBookOriginalCaches,readBookOriginalCache}=await import('../../modules/shares/repository-cache.js');
 const book={id:'summary',repository_url:'https://github.com/fixture/summary'};
 const row={provider_repo_id:'444',established_provider_repo_id:'444',observed_needs_recheck:false,observed_book_id:'summary',observed_requested_full_name:'fixture/summary',full_name:'fixture/summary',current_url:book.repository_url,readme_html:'<pre>very large README</pre>',facts:{quick_start:'npm install fixture'},fetch_state:'ready',fetched_at:new Date()};
 const queries:string[]=[];
 const spy={query:async(sql:string)=>{queries.push(sql);return {rows:[row]};}} as unknown as Pool;
 const list=(await readBookOriginalCaches(spy,[book],{includeReadme:false})).get('summary')!;
 assert.doesNotMatch(queries[0],/\bcr\.readme_html\b/);
 assert.equal(list.quick_start,'npm install fixture');
 queries.length=0;
 const detail=await readBookOriginalCache(spy,book);
 assert.match(queries[0],/\bcr\.readme_html\b/);
 assert.equal(detail.readme_html,row.readme_html);
 const {createApp}=await import('../../apps/platform-api/src/app.js');
 const app=createApp(spy,'http://127.0.0.1:46496','local');
 for(const path of ['/api/v1/site','/api/v1/community']){
  queries.length=0;assert.equal((await app.request(path)).status,200);
  const cacheQueries=queries.filter(sql=>sql.includes('FROM catalog_repo_observations'));
  assert.equal(cacheQueries.length,1);assert.doesNotMatch(cacheQueries[0],/\bcr\.readme_html\b/);
 }
});

test('scheduled cache work backfills legacy quick starts in bounded batches without GitHub',async()=>{
 const {refreshDueRepositories}=await import('../../modules/shares/repository-cache.js');
 const ids=[randomUUID(),randomUUID(),randomUUID()].sort();
 for(let i=0;i<ids.length;i++)await pool.query(`INSERT INTO canonical_repositories
   (repo_id,provider,provider_repo_id,full_name,current_url,fetch_state,readme_html,facts,refresh_after)
   VALUES($1,'github',$2,$3,$4,$6,$5,'{}',now()+interval '1 day')`,
   [ids[i],String(99901+i),`fixture/legacy-${i}`,`https://github.com/fixture/legacy-${i}`,'<h2>Install</h2><pre><code>npm install legacy</code></pre>',i===2?'error':'ready']);
 const noFetch:typeof fetch=async()=>{throw Error('legacy cache backfill must not fetch');};
 await refreshDueRepositories(pool,{fetcher:noFetch},2);
 let rows=(await pool.query("SELECT repo_id,facts->>'quick_start' quick_start FROM canonical_repositories WHERE repo_id=ANY($1::uuid[]) ORDER BY repo_id",[ids])).rows;
 assert.deepEqual(rows.map(row=>row.quick_start),['npm install legacy','npm install legacy',null]);
 await refreshDueRepositories(pool,{fetcher:noFetch},2);
 rows=(await pool.query("SELECT facts->>'quick_start' quick_start FROM canonical_repositories WHERE repo_id=ANY($1::uuid[]) ORDER BY repo_id",[ids])).rows;
 assert.deepEqual(rows.map(row=>row.quick_start),Array(3).fill('npm install legacy'));
 const oversized=randomUUID(),raced=randomUUID(),invalidFacts=randomUUID();
 await pool.query(`INSERT INTO canonical_repositories
   (repo_id,provider,provider_repo_id,full_name,current_url,fetch_state,readme_html,facts,refresh_after)
   VALUES($1,'github','99904','fixture/oversized','https://github.com/fixture/oversized','ready',repeat('x',8388609),'{}',now()+interval '1 day'),
   ($2,'github','99905','fixture/raced','https://github.com/fixture/raced','ready','<h2>Install</h2><pre>old command</pre>','{}',now()+interval '1 day'),
   ($3,'github','99906','fixture/invalid','https://github.com/fixture/invalid','ready','<h2>Install</h2><pre>ignore</pre>','[]',now()+interval '1 day')`,[oversized,raced,invalidFacts]);
 let changed=false;
 const racingPool={query:async(sql:string,values?:unknown[])=>{
  const result=await pool.query(sql,values);
  if(!changed&&sql.includes('SELECT repo_id,full_name,readme_html FROM canonical_repositories')){
   changed=true;await pool.query("UPDATE canonical_repositories SET readme_html='<h2>Install</h2><pre>new command</pre>' WHERE repo_id=$1",[raced]);
  }
  return result;
 }} as unknown as Pool;
 await refreshDueRepositories(racingPool,{fetcher:noFetch},2);
 assert.equal((await pool.query("SELECT facts->>'quick_start' quick_start FROM canonical_repositories WHERE repo_id=$1",[raced])).rows[0].quick_start,null,'a concurrent README update must not receive stale text');
 await refreshDueRepositories(pool,{fetcher:noFetch},2);
 assert.equal((await pool.query("SELECT facts->>'quick_start' quick_start FROM canonical_repositories WHERE repo_id=$1",[raced])).rows[0].quick_start,'new command');
 assert.equal((await pool.query("SELECT facts->>'quick_start' quick_start FROM canonical_repositories WHERE repo_id=$1",[oversized])).rows[0].quick_start,null,'oversized legacy HTML is not loaded into the Worker');
 assert.deepEqual((await pool.query('SELECT facts FROM canonical_repositories WHERE repo_id=$1',[invalidFacts])).rows[0].facts,[],'malformed legacy facts cannot block the batch');
});

test('repository share responds before cache refresh and reuses its verified GitHub facts',async()=>{
 const {Hono}=await import('hono');
 const {createShareRoutes}=await import('../../apps/platform-api/src/routes/shares.js');
 const calls:string[]=[];const pending:(()=>Promise<void>)[]=[];
 const source={...original,id:1903,full_name:'fixture/deferred'};
 const fixture:typeof fetch=async input=>{
  const path=new URL(String(input)).pathname;calls.push(path);
  if(path.endsWith('/readme'))return new Response('<h2>Install</h2><pre><code>npm install fixture</code></pre>');
  if(path.endsWith('/releases/latest'))return new Response(null,{status:404});
  if(path.includes('/commits/'))return Response.json({sha:'b'.repeat(40)});
  return Response.json(source);
 };
 const app=new Hono<import('../../apps/platform-api/src/module-context.js').PlatformEnv>();
 app.use('*',async(c,next)=>{c.set('actor',actors[0]);await next();});
 app.route('/',createShareRoutes(pool,{fetcher:fixture},undefined,work=>pending.push(work)));
 const response=await app.request('/shares',{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify({url:'https://github.com/fixture/deferred'})});
 assert.equal(response.status,200);assert.deepEqual(calls,['/repos/fixture/deferred']);
 assert.equal(pending.length,1,'cache enrichment is queued after response');
 await pending[0]();
 assert.equal(calls.filter(path=>path==='/repos/fixture/deferred').length,1,'repository facts are not fetched twice');
 assert.equal(calls.includes('/repositories/1903'),false,'the just-verified identity needs no second lookup');
 assert.ok(calls.includes('/repos/fixture/deferred/readme'));
 const result=await response.json() as {share_id:string};
 const row=(await pool.query('SELECT c.fetch_state,c.readme_html FROM shares s JOIN canonical_repositories c USING(repo_id) WHERE s.share_id=$1',[result.share_id])).rows[0];
 assert.equal(row.fetch_state,'ready');assert.match(row.readme_html,/npm install fixture/);
});

test('scheduled Worker lease blocks overlapping runs and recovers an expired lease',async()=>{
 const {createWorkerHandler}=await import('../../apps/platform-api/src/worker.js');
 let started!:()=>void,release!:()=>void;
 const entered=new Promise<void>(resolve=>{started=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 let refreshes=0;const phases:string[]=[];
 const handler=createWorkerHandler({
  createPool:()=>new Pool({connectionString:url,options:`-c search_path=${schema}`}),
  authPrune:async()=>{phases.push('cleanup');return {sessions:0,login_attempts:0,auth_rate_limits:0,password_reset_tokens:0};},
  sharesRefresh:async()=>{phases.push('refresh');refreshes++;if(refreshes===1){started();await gate;}return 0;},
  syncGitHub:async()=>({requests:0,repositories:0,items_upserted:0,not_modified:0,stop_reason:'completed'})
 });
 const env={HYPERDRIVE:{connectionString:url!},ASSETS:{fetch:async()=>new Response()},FREEDOM_COMMERCE_QUARANTINE:'true'};
 const ctx={waitUntil:(_work:Promise<unknown>)=>{}};
 const first=handler.scheduled({},env,ctx);await entered;
 try{
  assert.equal((await pool.query("SELECT count(*)::int n FROM github_feed_state WHERE feed_name='worker_scheduled_lease' AND next_sync_at>clock_timestamp()" )).rows[0].n,1);
  await handler.scheduled({},env,ctx);assert.equal(refreshes,1);assert.deepEqual(phases,['cleanup','refresh']);
 }finally{release();await first;}
 assert.equal((await pool.query("SELECT count(*)::int n FROM github_feed_state WHERE feed_name='worker_scheduled_lease'")).rows[0].n,0);
 await pool.query("INSERT INTO github_feed_state(feed_name,etag,next_sync_at) VALUES('worker_scheduled_lease','stale',clock_timestamp()-interval '1 second')");
 await handler.scheduled({},env,ctx);
 assert.equal(refreshes,2);assert.equal((await pool.query("SELECT count(*)::int n FROM github_feed_state WHERE feed_name='worker_scheduled_lease'")).rows[0].n,0);
});

test('real GitHub adapter confirms repository star once and verifies an author outside the catalog',async()=>{
 const {GitHubSocial}=await import('../../modules/github-social/service.js');
 const {starShare,claimShareAuthor}=await import('../../modules/shares/repository-actions.js');
 const {randomBytes}=await import('node:crypto');
 const source={...original,id:904,full_name:'fixture/actions',forks_count:0,open_issues_count:0,subscribers_count:1,pushed_at:null,language:null,permissions:{admin:true,maintain:true}};
 const s=await createShare(pool,cmd(actors[0],{url:'https://github.com/fixture/actions'}),{fetcher:async()=>Response.json(source)});
 const config={clientId:'synthetic-client',clientSecret:randomBytes(32).toString('hex'),tokenKey:randomBytes(32).toString('base64'),redirectUri:'https://platform.example.com/github/callback'};
 let starred=false,puts=0;
 const provider:typeof fetch=async(input,init)=>{
  const u=new URL(String(input)),method=init?.method??'GET';
  if(u.pathname==='/login/oauth/access_token')return Response.json({access_token:'ghu_'+randomBytes(24).toString('hex'),token_type:'bearer',scope:''});
  if(u.pathname==='/user')return Response.json({id:991,login:'synthetic'});
  if(u.pathname==='/repos/fixture/actions')return Response.json(source);
  if(u.pathname==='/user/starred/fixture/actions'){if(method==='PUT'){starred=true;puts++;return new Response(null,{status:204});}return new Response(null,{status:starred?204:404});}
  throw Error(`Unexpected fixture endpoint ${u.pathname}`);
 };
 const social=new GitHubSocial(pool,config,provider);
 const start=await social.start(actors[1],`#shares/${s.share_id}`);await social.complete(actors[1],new URL(start.authorization_url).searchParams.get('state')!,'synthetic-code');
 const c=cmd(actors[1],{},'POST /shares/star');
 assert.equal((await starShare(pool,c,s.share_id,social)).confirmed,true);
 await starShare(pool,c,s.share_id,social);assert.equal(puts,1);
 await starShare(pool,cmd(actors[1],{},'POST /shares/star'),s.share_id,social);
 assert.equal((await pool.query("SELECT count(*)::int n FROM share_credit_events WHERE share_id=$1 AND basis='star_confirmed'",[s.share_id])).rows[0].n,1);
 const claim=await claimShareAuthor(pool,cmd(actors[1],{statement:'I created this synthetic repository.'},'claim'),s.share_id,social);
 assert.equal(claim.state,'verified');
 assert.equal((await pool.query("SELECT count(*)::int n FROM share_credit_events WHERE share_id=$1 AND basis='claim_verified'",[s.share_id])).rows[0].n,1);
 await pool.query("UPDATE repo_credit_claims SET state='revoked' WHERE claim_id=$1",[claim.claim_id]);
 assert.equal((await pool.query("SELECT sum(units)::int n FROM share_credit_events WHERE share_id=$1 AND basis='claim_verified'",[s.share_id])).rows[0].n,0);
});

test('renamed repository URLs share one numeric identity and current name; moved fork source resolves',async()=>{
 const current={...original,id:950,full_name:'fixture/renamed'};
 const calls:string[]=[];
 const fixture:typeof fetch=async(input,init)=>{
  const u=String(input);calls.push(u);assert.equal(init?.redirect,'manual');
  if(u==='https://api.github.com/repos/fixture/old')return new Response(null,{status:301,headers:{Location:'https://api.github.com/repositories/950'}});
  if(u==='https://api.github.com/repos/fixture/moved-fork')return Response.json({...original,id:951,fork:true,source:{full_name:'fixture/old'}});
  assert.ok(['https://api.github.com/repositories/950','https://api.github.com/repos/fixture/renamed'].includes(u));return Response.json(current);
 };
 assert.equal((await repositoryFacts('https://github.com/fixture/moved-fork',{fetcher:fixture})).full_name,current.full_name);
 const a=await createShare(pool,cmd(actors[0],{url:'https://github.com/fixture/old'}),{fetcher:fixture});
 const b=await createShare(pool,cmd(actors[1],{url:'https://github.com/fixture/renamed'}),{fetcher:fixture});
 assert.equal(a.share_id,b.share_id);assert.equal(b.created,false);
 // Existing shares created before the move also refresh their list projection on re-sharing.
 await pool.query("UPDATE shares SET title='fixture/old',canonical_url='https://github.com/fixture/old' WHERE share_id=$1",[a.share_id]);
 await pool.query("UPDATE canonical_repositories SET full_name='fixture/old',current_url='https://github.com/fixture/old' WHERE provider_repo_id='950'");
 await createShare(pool,cmd(actors[1],{url:'https://github.com/fixture/old'}),{fetcher:fixture});
 const stored=(await pool.query('SELECT s.title,s.canonical_url,c.full_name,c.current_url FROM shares s JOIN canonical_repositories c USING(repo_id) WHERE s.share_id=$1',[a.share_id])).rows[0];
 assert.deepEqual(stored,{title:current.full_name,canonical_url:'https://github.com/fixture/renamed',full_name:current.full_name,current_url:'https://github.com/fixture/renamed'});
 assert.equal((await pool.query("SELECT count(*)::int n FROM shares WHERE canonical_key='github:950'")).rows[0].n,1);
});

test('repository moves refuse every unsafe Location and unsupported status before another fetch',async()=>{
 const {Problem}=await import('../../packages/shared/problem.js');
 const locations=[
  'https://evil.test/repositories/950','http://api.github.com/repositories/950',
  'https://api.github.com:443/repositories/950','https://api.github.com:8443/repositories/950',
  'https://user@api.github.com/repositories/950','https://user:password@api.github.com/repositories/950',
  'https://api.github.com/repositories/950?x=1','https://api.github.com/repositories/950#x',
  'https://api.github.com/repositories/abc','https://api.github.com/repositories/',
  'https://api.github.com/repositories/123456789012345678901','https://api.github.com/repositories/950/',
  'https://api.github.com/repositories/%39%35%30','https://api.github.com/repositories/950/../951',
  'https://api.github.com/repositories/950/readme','https://api.github.com/repos/fixture/old',
  'https://API.GITHUB.COM/repositories/950','https://api.github.com.evil.test/repositories/950',
  '//api.github.com/repositories/950','/repositories/950','',
 ];
 for(const location of locations){
  let calls=0;
  await assert.rejects(repositoryFacts('https://github.com/fixture/old',{fetcher:async(input)=>{
   calls++;assert.equal(String(input),'https://api.github.com/repos/fixture/old');
   return new Response(null,{status:301,headers:{Location:location}});
  }}),e=>e instanceof Problem&&e.status===422&&e.code==='github_repository_moved'&&e.message==='這個儲存庫已搬移，請貼上新的網址。',location);
  assert.equal(calls,1,location);
 }
 for(const status of [302,303,305,306]){
  let calls=0;
  await assert.rejects(repositoryFacts('https://github.com/fixture/old',{fetcher:async()=>{calls++;return new Response(null,{status,headers:{Location:'https://api.github.com/repositories/950'}});}}),{code:'github_repository_moved'});
  assert.equal(calls,1);
 }
});

test('301, 307 and 308 accept 1–20 digits; a second move or loop is refused',async()=>{
 for(const status of [301,307,308])for(const id of ['1','12345678901234567890']){
  let calls=0;
  const facts=await repositoryFacts('https://github.com/fixture/old',{fetcher:async input=>{
   calls++;if(calls===1)return new Response(null,{status,headers:{Location:`https://api.github.com/repositories/${id}`}});
   assert.equal(String(input),`https://api.github.com/repositories/${id}`);return Response.json(original);
  }});assert.equal(facts.id,'901');assert.equal(calls,2);
 }
 for(const next of ['https://api.github.com/repositories/951','https://api.github.com/repositories/950','https://api.github.com/repos/fixture/old','https://evil.test/repositories/951']){
  const calls:string[]=[];
  await assert.rejects(repositoryFacts('https://github.com/fixture/old',{fetcher:async input=>{
   calls.push(String(input));return new Response(null,{status:301,headers:{Location:calls.length===1?'https://api.github.com/repositories/950':next}});
  }}),{code:'github_repository_moved'});
  assert.deepEqual(calls,['https://api.github.com/repos/fixture/old','https://api.github.com/repositories/950']);
 }
});

test('redirect keeps token-first then anonymous retry, Retry-After and shared signal',async()=>{
 const {randomBytes}=await import('node:crypto');
 const {shareRepositoryJson}=await import('../../modules/shares/github.js');
 const token=randomBytes(24).toString('hex');
 for(const status of [401,403,429]){
  const calls:{url:string;auth:string|null}[]=[];const signal=AbortSignal.timeout(8000);
  const result=await shareRepositoryJson('/repos/fixture/old',signal,async(input,init)=>{
   const auth=new Headers(init?.headers).get('authorization');calls.push({url:String(input),auth});
   assert.equal(init?.signal,signal);assert.equal(init?.redirect,'manual');
   if(calls.length===1)return new Response(null,{status:301,headers:{Location:'https://api.github.com/repositories/950'}});
   return auth?new Response('denied',{status}):Response.json(original);
  },false,196608,token);
  assert.deepEqual(result,original);
  assert.deepEqual(calls,[{url:'https://api.github.com/repos/fixture/old',auth:`Bearer ${token}`},{url:'https://api.github.com/repositories/950',auth:`Bearer ${token}`},{url:'https://api.github.com/repositories/950',auth:null}]);
 }
 let calls=0;
 await assert.rejects(shareRepositoryJson('/repos/fixture/old',AbortSignal.timeout(8000),async()=>{
  calls++;
  if(calls===1)return new Response(null,{status:301,headers:{Location:'https://api.github.com/repositories/950'}});
  return new Response(null,{status:429,headers:calls===2?{'Retry-After':'17'}:{}});
 },false,196608,token),{code:'github_rate_limited',retryAfterSeconds:17});
 assert.equal(calls,3);
 calls=0;
 await assert.rejects(shareRepositoryJson('/repos/fixture/old',AbortSignal.timeout(8000),async()=>{
  calls++;if(calls===2)return new Response(null,{status:401});
  return new Response(null,{status:301,headers:{Location:`https://api.github.com/repositories/${calls===1?950:951}`}});
 },false,196608,token),{code:'github_repository_moved'});assert.equal(calls,3);
});

test('redirect retains JSON limits and public visibility; shared GitHub reader still refuses moves',async()=>{
 const {publicRepositoryJson}=await import('../../modules/opensource-marketing/github.js');
 for(const [payload,code] of [[{...original,description:'x'.repeat(196608)},'github_response_too_large'],[{...original,private:true},'github_repository_unavailable'],[{...original,archived:true},'github_repository_unavailable']] as const){
  let calls=0;
  await assert.rejects(repositoryFacts('https://github.com/fixture/old',{fetcher:async()=>++calls===1?new Response(null,{status:301,headers:{Location:'https://api.github.com/repositories/950'}}):Response.json(payload)}),{code});
 }
 let calls=0;
 await assert.rejects(publicRepositoryJson('/repos/fixture/old',AbortSignal.timeout(8000),async()=>{calls++;return new Response(null,{status:301,headers:{Location:'https://api.github.com/repositories/950'}});}),{code:'github_unavailable'});
 assert.equal(calls,1);
});

test('refresh resolves renamed facts, README and release; conditional reads and body limits survive',async()=>{
 const {refreshRepository,repositoryPage}=await import('../../modules/shares/repository-cache.js');
 const s=await createShare(pool,cmd(actors[0],{url:'https://github.com/fixture/pre-move'}),{fetcher:async()=>Response.json({...original,id:960,full_name:'fixture/pre-move'})});
 const repoId=(await pool.query('SELECT repo_id FROM shares WHERE share_id=$1',[s.share_id])).rows[0].repo_id;
 let conditional=false,oversized=false,badSuffix=false,bare=false;const calls:string[]=[];
 const fixture:typeof fetch=async(input,init)=>{
  const path=new URL(String(input)).pathname;calls.push(path);assert.equal(init?.redirect,'manual');
  if(path.startsWith('/repos/')){
   const suffix=path.endsWith('/readme')?'/readme':path.endsWith('/releases/latest')?'/releases/latest':'';
   return new Response(null,{status:308,headers:{Location:`https://api.github.com/repositories/960${badSuffix&&suffix==='/readme'?'/releases/latest':bare?'':suffix}`}});
  }
  if(path==='/repositories/960/readme'){
   assert.equal(new Headers(init?.headers).get('accept'),'application/vnd.github.html+json');
   if(conditional){assert.equal(new Headers(init?.headers).get('if-none-match'),'"moved-readme"');return new Response(null,{status:304});}
   return new Response(oversized?'x'.repeat(1048577):'<h2>Install</h2><pre><code>npm install renamed</code></pre>',{headers:{etag:'"moved-readme"'}});
  }
  if(path==='/repositories/960/releases/latest')return Response.json({tag_name:'v2',name:'Moved',html_url:'https://github.com/fixture/post-move/releases/tag/v2',published_at:null});
  assert.equal(path,'/repositories/960');return Response.json({...original,id:960,full_name:'fixture/post-move'});
 };
 await refreshRepository(pool,repoId,{fetcher:fixture},true);
 assert.ok(calls.includes('/repositories/960/readme'));assert.ok(calls.includes('/repositories/960/releases/latest'));
 const stored=(await pool.query('SELECT title,canonical_url FROM shares WHERE share_id=$1',[s.share_id])).rows[0];
 assert.deepEqual(stored,{title:'fixture/post-move',canonical_url:'https://github.com/fixture/post-move'});
 await transaction(pool,async q=>{const page=await repositoryPage(q,repoId);assert.equal(page.full_name,'fixture/post-move');assert.equal(page.quick_start,'npm install renamed');assert.equal(page.latest_release.tag_name,'v2');});
 conditional=true;bare=true;await refreshRepository(pool,repoId,{fetcher:fixture},true);
 conditional=false;oversized=true;
 await assert.rejects(refreshRepository(pool,repoId,{fetcher:fixture},true),{code:'readme_too_large'});
 assert.match((await pool.query('SELECT readme_html FROM canonical_repositories WHERE repo_id=$1',[repoId])).rows[0].readme_html,/npm install renamed/);
 oversized=false;badSuffix=true;
 await assert.rejects(refreshRepository(pool,repoId,{fetcher:fixture},true),{code:'github_repository_moved'});
});

test('refresh looks up current location by provider_repo_id without calling the stored old name and marks 404 unavailable',async()=>{
 const {currentRepositoryLocation,refreshRepository}=await import('../../modules/shares/repository-cache.js');
 const s=await createShare(pool,cmd(actors[0],{url:'https://github.com/fixture/old-by-id'}),{fetcher:async()=>Response.json({...original,id:965,full_name:'fixture/old-by-id'})});
 const repoId=(await pool.query('SELECT repo_id FROM shares WHERE share_id=$1',[s.share_id])).rows[0].repo_id;

 const calls:string[]=[];
 const renamedFetcher:typeof fetch=async input=>{
  const path=new URL(String(input)).pathname;calls.push(path);
  assert.equal(path.startsWith('/repos/fixture/old-by-id'),false,'old name must never be requested: '+path);
  if(path==='/repositories/965')return Response.json({...original,id:965,full_name:'fixture/new-by-id'});
  if(path==='/repos/fixture/new-by-id')return Response.json({...original,id:965,full_name:'fixture/new-by-id'});
  if(path==='/repos/fixture/new-by-id/readme')return new Response('<h2>Moved</h2>');
  if(path.startsWith('/repos/fixture/new-by-id/'))return new Response(null,{status:404});
  throw new Error('Unexpected GitHub request '+path);
 };
 await refreshRepository(pool,repoId,{fetcher:renamedFetcher},true);
 assert.equal(calls.some(p=>p.startsWith('/repos/fixture/old-by-id')),false);
 assert.ok(calls.includes('/repositories/965'));
 const updatedRepo=(await pool.query('SELECT fetch_state,full_name,current_url FROM canonical_repositories WHERE repo_id=$1',[repoId])).rows[0];
 assert.deepEqual(updatedRepo,{fetch_state:'ready',full_name:'fixture/new-by-id',current_url:'https://github.com/fixture/new-by-id'});
 const updatedShare=(await pool.query('SELECT state,title,canonical_url FROM shares WHERE share_id=$1',[s.share_id])).rows[0];
 assert.deepEqual(updatedShare,{state:'published',title:'fixture/new-by-id',canonical_url:'https://github.com/fixture/new-by-id'});

 await refreshRepository(pool,repoId,{fetcher:async input=>{
  const path=new URL(String(input)).pathname;
  assert.equal(path,'/repositories/965');
  return new Response(null,{status:404});
 }},true);
 const deadRepo=(await pool.query('SELECT fetch_state FROM canonical_repositories WHERE repo_id=$1',[repoId])).rows[0];
 assert.equal(deadRepo.fetch_state,'unavailable');
 const deadShare=(await pool.query('SELECT state FROM shares WHERE share_id=$1',[s.share_id])).rows[0];
 assert.equal(deadShare.state,'hidden');

 assert.deepEqual(await currentRepositoryLocation('965',{fetcher:async()=>Response.json({...original,id:999,full_name:'fixture/wrong'})}),{kind:'unavailable'});
 assert.deepEqual(await currentRepositoryLocation('965',{fetcher:async()=>Response.json({...original,id:965,private:true,full_name:'fixture/secret'})}),{kind:'unavailable'});
 assert.deepEqual(await currentRepositoryLocation('965',{fetcher:async()=>new Response(null,{status:404})}),{kind:'unavailable'});
 assert.deepEqual(await currentRepositoryLocation('965',{fetcher:async()=>new Response(null,{status:503})}),{kind:'unknown'});
 assert.deepEqual(await currentRepositoryLocation('965',{fetcher:async()=>Response.json({bad:true})}),{kind:'unknown'});
 assert.deepEqual(await currentRepositoryLocation('965',{fetcher:renamedFetcher}),{kind:'current',url:'https://github.com/fixture/new-by-id'});
});

test('work shares keep non-opted-in works member-only and link opted-in works outward with once-per-click sharer credit', async () => {
 const creator = actors[0], sharer = actors[1], visitor = actors[2];
 const work = await createShowcase(pool, cmd(creator, {
  title: '可公開分享的作品',
  description: '作品簡介內容',
  artifact_ref: 'artifact:work-share-test',
  consent_to_share: true,
 }, 'showcases'));

 // Non-opted-in work can be shared inside the community, but refuses outward /go/ links.
 const workShare = await createShare(pool, cmd(sharer, { kind: 'work', ref_id: work.showcase_id }, 'shares'), {});
 assert.equal(workShare.created, true);
 const storedShare = (await pool.query('SELECT kind, canonical_url, ref_id FROM shares WHERE share_id=$1', [workShare.share_id])).rows[0];
 assert.equal(storedShare.kind, 'work');
 assert.equal(storedShare.canonical_url, `/#showcase/${work.showcase_id}`);
 await assert.rejects(shareLink(pool, cmd(sharer, {}, 'links'), workShare.share_id), { code: 'use_original_share' });

 // Owner opts in for the exact work version.
 const enabled = await setShowcaseSharing(pool, { ...cmd(creator, { enabled: true, work_version: String(work.aggregate_version) }, 'sharing'), expected: String(work.aggregate_version) }, work.showcase_id);
 assert.equal(enabled.available, true);

 // Now creating an outward /go/:code link succeeds and resolves to /works/:id?via=:code.
 const links = await shareLink(pool, cmd(sharer, {}, 'links'), workShare.share_id);
 assert.match(links.path, /^\/go\/[A-Za-z0-9_-]{10}$/);
 const goHtml = await promotionGo(pool, links.code, undefined, 'http://127.0.0.1:4310');
 assert.ok(goHtml && goHtml.includes(`/works/${work.showcase_id}?via=${links.code}`));

 // Qualified click credits the sharer once; self-click and duplicate visitor click do not double-credit.
 await creditPromotionClick(pool, { code: links.code, userAgent: 'Mozilla/5.0', sessionUserId: sharer.user_id, network: 'synthetic', now: new Date() });
 for (let i = 0; i < 2; i++) {
  await creditPromotionClick(pool, { code: links.code, userAgent: 'Mozilla/5.0', sessionUserId: visitor.user_id, network: 'synthetic-visitor', now: new Date() });
 }
 const credits = (await pool.query("SELECT basis, units, user_id FROM share_credit_events WHERE share_id=$1 AND basis='qualified_click_day'", [workShare.share_id])).rows;
 assert.equal(credits.length, 1);
 assert.equal(credits[0].units, 1);
 assert.equal(credits[0].user_id, sharer.user_id);

 // Public work view resolves sharer credit from ?via=code.
 const publicView = await readPublicWork(pool, work.showcase_id, DEMO_COMMUNITY, links.code);
 assert.ok(publicView);
 assert.equal(publicView.sharer_name, (await pool.query('SELECT display_name FROM users WHERE user_id=$1', [sharer.user_id])).rows[0].display_name);

 // Withdrawing public consent immediately disables /go/:code and /works/:id and refuses new /links.
 await setShowcaseSharing(pool, { ...cmd(creator, { enabled: false }, 'sharing'), expected: enabled.version }, work.showcase_id);
 const afterWithdrawGo = await promotionGo(pool, links.code, undefined, 'http://127.0.0.1:4310');
 assert.equal(afterWithdrawGo, null);
 assert.equal(await readPublicWork(pool, work.showcase_id, DEMO_COMMUNITY, links.code), null);
 await assert.rejects(shareLink(pool, cmd(sharer, {}, 'links'), workShare.share_id), { code: 'use_original_share' });
});


test('work previews never disclose an internal share snapshot after editing and approving a new version', async () => {
 const creator = actors[0], sharer = actors[1];
 const work = await createShowcase(pool, cmd(creator, {
  title: 'Confidential customer X', description: 'Internal-only summary',
  public_url: 'https://example.com/internal-version', consent_to_share: true,
 }, 'showcases'));
 const share = await createShare(pool, cmd(sharer, {kind:'work', ref_id:work.showcase_id}, 'shares'), {});
 const withdrawn = await withdrawOwnShowcase(pool, {...cmd(creator, {}, 'withdraw'), expected:String(work.aggregate_version)}, work.showcase_id);
 const edited = await updateOwnShowcase(pool, {...cmd(creator, {
  title:'Approved public work', description:'Approved public summary', public_url:'https://example.com/approved-version',
 }, 'edit'), expected:String(withdrawn.aggregate_version)}, work.showcase_id);
 const published = await publishOwnShowcase(pool, {...cmd(creator, {consent_to_share:true}, 'publish'), expected:String(edited.aggregate_version)}, work.showcase_id);
 await assert.rejects(shareLink(pool, cmd(sharer, {}, 'links'), share.share_id), {code:'use_original_share'});
 const approved = await setShowcaseSharing(pool, {...cmd(creator, {enabled:true, work_version:String(published.aggregate_version)}, 'sharing'), expected:String(published.aggregate_version)}, work.showcase_id);
 const link = await shareLink(pool, cmd(sharer, {}, 'links'), share.share_id);
 const projection = await readPublicWork(pool, work.showcase_id, DEMO_COMMUNITY);
 assert.ok(projection);
 const html = await promotionGo(pool, link.code, undefined, 'https://example.com');
 assert.ok(html);
 for (const secret of ['Confidential customer X', 'Internal-only summary', '/internal-version']) assert.equal(html.includes(secret), false, secret);
 assert.ok(html.includes(projection.title));
 assert.ok(html.includes(projection.description));
 assert.match(html, /property="og:title" content="Approved public work/);
 assert.match(html, /property="og:description" content="Approved public summary/);
 assert.equal((await pool.query('SELECT title FROM shares WHERE share_id=$1', [share.share_id])).rows[0].title, 'Confidential customer X');
 await setShowcaseSharing(pool, {...cmd(creator, {enabled:false}, 'sharing'), expected:approved.version}, work.showcase_id);
 assert.equal(await promotionGo(pool, link.code, undefined, 'https://example.com'), null);
});

test('previous Worker inserts consecutive guest notices after the new migrations',async()=>{
 const {ensureGuestCapability}=await import('../../modules/community/event-waitlist.js');
 const id=randomUUID(),email=`${randomUUID()}@example.invalid`;
 await pool.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,state)
  VALUES($1,$2,$3,'Synthetic event','Synthetic event','2099-01-01T10:00:00Z','2099-01-01T11:00:00Z','in_person','Synthetic location','published')`,[id,DEMO_COMMUNITY,actors[0].user_id]);
 await transaction(pool,q=>ensureGuestCapability(q,id,{email,name:'Synthetic guest'}));
 await pool.query('UPDATE community_event_guest_capabilities SET verified_at=now() WHERE event_id=$1 AND email=$2',[id,email]);
 await pool.query("INSERT INTO community_event_guest_rsvps(event_id,email,name,state,confirmed_at) VALUES($1,$2,'Synthetic guest','going',now())",[id,email]);
 // Copied from origin/main:modules/community/event-waitlist.ts.
 const legacy=`INSERT INTO community_event_participation_notices(notice_id,event_id,guest_email,event_version,kind) SELECT gen_random_uuid(),$1,email,$2,$3 FROM community_event_guest_capabilities c WHERE event_id=$1 AND verified_at IS NOT NULL AND (EXISTS(SELECT 1 FROM community_event_guest_rsvps g WHERE g.event_id=c.event_id AND g.email=c.email AND g.state='going') OR EXISTS(SELECT 1 FROM community_event_waitlist w WHERE w.event_id=c.event_id AND w.guest_email=c.email AND w.status IN ('queued','invited','cancelled'))) ON CONFLICT(event_id,guest_email,event_version,kind) DO NOTHING`;
 for(const version of [1,2])assert.equal((await pool.query(legacy,[id,version,'event_schedule_changed'])).rowCount,1);
 assert.equal((await pool.query(legacy,[id,2,'event_schedule_changed'])).rowCount,0);
 assert.deepEqual((await pool.query('SELECT event_version FROM community_event_participation_notices WHERE event_id=$1 ORDER BY event_version',[id])).rows.map(row=>row.event_version),['1','2']);
});

test('previous Worker device list and quota exclude newly issued Agent credentials',async()=>{
 const {issueAgentToken}=await import('../../modules/client-connections/agent-tokens.js');
 const actor=actors[0];
 // SQL and field list copied from origin/main:modules/client-connections/service.ts.
 const approvedFields='connection_id,client_name,kind,scope,store_id,aggregate_version,created_at,expires_at,revoked_at';
 const count='SELECT count(*) FROM member_client_connections WHERE user_id=$1 AND community_id=$2 AND revoked_at IS NULL AND expires_at>now()';
 const list=`SELECT ${approvedFields} FROM member_client_connections WHERE community_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 100`;
 const beforeCount=(await pool.query(count,[actor.user_id,actor.community_id])).rows[0].count;
 const beforeList=(await pool.query(list,[actor.community_id,actor.user_id])).rows;
 await issueAgentToken(pool,actor,{name:'Synthetic agent',scopes:['read']});
 assert.equal((await pool.query(count,[actor.user_id,actor.community_id])).rows[0].count,beforeCount);
 assert.deepEqual((await pool.query(list,[actor.community_id,actor.user_id])).rows,beforeList);
});

test('previous Worker account deactivation keeps Agent credentials revoked after reactivation',async()=>{
 const {issueAgentToken}=await import('../../modules/client-connections/agent-tokens.js');
 const actor=actors[2],issued=await issueAgentToken(pool,actor,{name:'Synthetic agent',scopes:['read']});
 await pool.query('UPDATE users SET active=false WHERE user_id=$1',[actor.user_id]);
 // Copied from origin/main:modules/identity-membership/deactivation.ts.
 await pool.query('UPDATE member_client_connections SET revoked_at=COALESCE(revoked_at,now()),aggregate_version=aggregate_version+1 WHERE user_id=$1 AND revoked_at IS NULL',[actor.user_id]);
 await pool.query('UPDATE users SET active=true WHERE user_id=$1',[actor.user_id]);
 assert.ok((await pool.query('SELECT revoked_at FROM agent_token_connections WHERE connection_id=$1',[issued.connection_id])).rows[0].revoked_at);
});

test('a page of 50 shares, credits, results and calendar entries uses bounded SQL',async()=>{
 const {listShares}=await import('../../modules/shares/service.js');
 const {myShareResults}=await import('../../modules/shares/results.js');
 const {publicEventCalendar}=await import('../../modules/community/event-exposure.js');
 const inserted=await pool.query(`WITH events AS (
  INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,state,visibility)
  SELECT gen_random_uuid(),$1,$2,'Synthetic page '||n,'Synthetic description','2099-01-01T10:00:00Z','2099-01-01T11:00:00Z','in_person','Synthetic location','published','open'
  FROM generate_series(1,50) n RETURNING event_id,title
 ) INSERT INTO shares(community_id,kind,canonical_key,canonical_url,ref_table,ref_id,title,first_sharer_user_id)
 SELECT $1,'event','event:'||event_id,'/events/'||event_id,'community_events',event_id,title,$2 FROM events RETURNING share_id`,[DEMO_COMMUNITY,actors[0].user_id]);
 const ids=inserted.rows.map(r=>r.share_id);
 await pool.query(`INSERT INTO share_credit_events(community_id,share_id,user_id,role,basis,units,source_ref)
  SELECT $1,id,$2,'spreader','qualified_click_day',1,'synthetic-page:'||id FROM unnest($3::uuid[]) id`,[DEMO_COMMUNITY,actors[0].user_id,ids]);
 let count=0;
 const counted={query:(...args:any[])=>{count++;return (pool.query as any)(...args);}} as unknown as import('pg').PoolClient;
 const list=await listShares(counted,actors[0],{limit:'50'}),listCount=count;count=0;
 const credit=await myCredit(counted,actors[0]),creditCount=count;count=0;
 const results=await myShareResults(counted,actors[0]),resultsCount=count;count=0;
 const calendar=await publicEventCalendar(counted),calendarCount=count;
 assert.equal(list.items.length,50);assert.equal(credit.items.length,50);assert.equal(results.items.length,50);
 assert.equal((calendar.match(/BEGIN:VEVENT/g)??[]).length,50);
 assert.deepEqual({list:listCount===1,credit:creditCount===1,results:resultsCount===1,calendar:calendarCount===1},
  {list:true,credit:true,results:true,calendar:true},`SQL calls: ${JSON.stringify({listCount,creditCount,resultsCount,calendarCount})}`);
});

test('event registration credit locates an event share by leading kind and reference keys',async()=>{
 const indexes=await pool.query(`SELECT array_agg(pg_get_indexdef(i.indexrelid,k,true) ORDER BY k) AS columns
  FROM pg_index i CROSS JOIN LATERAL generate_series(1,i.indnkeyatts) k
  WHERE i.indrelid='shares'::regclass AND i.indexprs IS NULL GROUP BY i.indexrelid`);
 assert.ok(indexes.rows.some(row=>row.columns[0]==='kind'&&row.columns[1]==='ref_id'),
  'creditEventRegistrations does not constrain community_id, so kind and ref_id must lead an index');
 const q=await pool.connect();
 try{
  await q.query('BEGIN');
  await q.query(`INSERT INTO shares(community_id,kind,canonical_key,canonical_url,title,first_sharer_user_id,legacy_ref)
   SELECT $1,'link','index-fixture:'||n,'https://example.org/'||n,'Synthetic index fixture',$2,
    jsonb_build_array(jsonb_build_object('kind','book','id','synthetic-'||n))
   FROM generate_series(1,10000) n`,[DEMO_COMMUNITY,actors[0].user_id]);
  await q.query('ANALYZE shares');await q.query('ANALYZE share_legacy_promotion_targets');
  const plan=await q.query(`EXPLAIN (FORMAT JSON) SELECT share_id FROM shares
   WHERE kind='event' AND ref_id=$1::uuid AND state='published'`,[randomUUID()]);
  assert.match(JSON.stringify(plan.rows[0]),/shares_kind_ref/);
  const reference=await q.query(`EXPLAIN (FORMAT JSON) SELECT * FROM shares WHERE community_id=$1
   AND kind='event' AND ref_id=$2::uuid AND state='published' ORDER BY share_id LIMIT 1`,[DEMO_COMMUNITY,randomUUID()]);
  assert.match(JSON.stringify(reference.rows[0]),/shares_kind_ref/);
  const legacy=await q.query(`EXPLAIN (FORMAT JSON) WITH candidates AS MATERIALIZED (
   SELECT share_id FROM share_legacy_promotion_targets WHERE community_id=$1 AND target_key=$2
  ) SELECT sh.* FROM candidates c JOIN shares sh ON sh.share_id=c.share_id
   WHERE sh.state='published' ORDER BY sh.share_id LIMIT 1`,[DEMO_COMMUNITY,'book:synthetic-1']);
  assert.match(JSON.stringify(legacy.rows[0]),/share_legacy_promotion_lookup/);
  await q.query('ROLLBACK');
 }finally{q.release();}
});

test('legacy promotion keys follow share edits, hiding and republication',async()=>{
 const id=randomUUID();
 await pool.query(`INSERT INTO shares(share_id,community_id,kind,canonical_key,canonical_url,title,first_sharer_user_id,legacy_ref)
  VALUES($1,$2,'link',$3,'https://example.org/legacy','Synthetic legacy',$4,$5)`,[id,DEMO_COMMUNITY,`legacy:${id}`,actors[0].user_id,JSON.stringify([{kind:'book',id:'before'},{kind:'book',id:'before'}])]);
 const keys=async()=>(await pool.query('SELECT target_key FROM share_legacy_promotion_targets WHERE share_id=$1 ORDER BY target_key',[id])).rows.map(row=>row.target_key);
 assert.deepEqual(await keys(),['book:before']);
 await pool.query('UPDATE shares SET legacy_ref=$2 WHERE share_id=$1',[id,JSON.stringify([{kind:'skill_submission',id:randomUUID()}])]);
 assert.match((await keys())[0],/^submission:/);
 await pool.query("UPDATE shares SET state='hidden' WHERE share_id=$1",[id]);assert.deepEqual(await keys(),[]);
 await pool.query("UPDATE shares SET state='published' WHERE share_id=$1",[id]);assert.equal((await keys()).length,1);
});

test('share landing and click bookkeeping avoid repeated reads and inline pruning',async()=>{
 const id=randomUUID(),code=randomUUID().replaceAll('-','').slice(0,10);
 await pool.query("INSERT INTO shares(share_id,community_id,kind,canonical_key,canonical_url,title,first_sharer_user_id) VALUES($1,$2,'link',$3,'https://example.com/fixture','Synthetic link',$4)",[id,DEMO_COMMUNITY,`go:${id}`,actors[0].user_id]);
 await pool.query("INSERT INTO promotion_links(community_id,user_id,kind,target_key,code) VALUES($1,$2,'share',$3,$4)",[DEMO_COMMUNITY,actors[0].user_id,id,code]);
 const statements:string[]=[];
 const counted={query:(...args:any[])=>{statements.push(String(args[0]));return (pool.query as any)(...args);},connect:async()=>{
  const client=await pool.connect();return {query:(...args:any[])=>{statements.push(String(args[0]));return (client.query as any)(...args);},release:()=>client.release()};
 }} as unknown as Pool;
 assert.ok(await promotionGo(counted,code,undefined,'https://example.com'));
 const landing=statements.length;statements.length=0;
 await creditPromotionClick(counted,{code,userAgent:'Synthetic browser',network:'synthetic',sessionUserId:null,now:new Date()});
 const salts=statements.filter(sql=>/promotion_click_salts/i.test(sql));
 assert.deepEqual({landing:landing<=2,saltStatements:salts.length,noDelete:!salts.some(sql=>/\bDELETE\b/i.test(sql))},
  {landing:true,saltStatements:1,noDelete:true},`Landing ${landing}; salt statements ${salts.length}`);
});

test('manual share publication validates attacker URLs, keeps receipts, and never fetches',async()=>{
 const {createApp}=await import('../../apps/platform-api/src/app.js');
 let fetchCalls=0;
 const origin='http://127.0.0.1:4310';
 const app=createApp(pool,origin,'local',{linkPreviewFetch:async()=>{fetchCalls++;throw Error('unexpected preview fetch');}});
 const login=await app.request(origin+'/api/v1/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'shares-2@example.com',password:DEMO_PASSWORD})});
 assert.equal(login.status,200);
 const session=await login.json() as {csrf_token:string};
 const headers={Origin:origin,Cookie:login.headers.get('set-cookie')!.split(';')[0],'X-CSRF-Token':session.csrf_token,'Content-Type':'application/json'};
 const send=(body:unknown,key=randomUUID())=>app.request(origin+'/api/v1/shares',{method:'POST',headers:{...headers,'Idempotency-Key':key},body:JSON.stringify(body)});
 const key=randomUUID(),body={kind:'link',url:`https://example.com/manual-${randomUUID()}?utm_source=ignored`,manual_title:'手動分享標題'};
 const created=await send(body,key);assert.equal(created.status,200);
 const result=await created.json() as {share_id:string};
 const replay=await send(body,key);assert.equal(replay.status,200);assert.equal((await replay.json() as {share_id:string}).share_id,result.share_id);
 assert.equal((await send({...body,manual_title:'不同標題'},key)).status,409);
 const publicPage=await app.request(origin+'/s/'+result.share_id);assert.equal(publicPage.status,200);
 const html=await publicPage.text();assert.match(html,/手動分享標題/);assert.match(html,/>example\.com</);
 const before=(await pool.query('SELECT count(*)::int AS n FROM shares')).rows[0].n;
 for(const url of ['https://127.0.0.1/','https://[::1]/','https://localhost/','https://host.internal/','https://host.local/','http://example.com/','ftp://example.com/','https://user:pass@example.com/','https://example.com/'+ 'x'.repeat(2048),'https://github.com/fixture/repo','https://github.com./fixture/repo']){
  const refused=await send({kind:'link',url,manual_title:'測試標題'});assert.equal(refused.status,422,url);
 }
 assert.equal((await send({kind:'link',url:'https://example.com/missing',manual_title:''})).status,422);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM shares')).rows[0].n,before);
 assert.equal(fetchCalls,0);
});

test('unsafe link addresses return the same refusal with or without manual_title',async()=>{
 const {createApp}=await import('../../apps/platform-api/src/app.js');
 let fetchCalls=0;
 const origin='http://127.0.0.1:4310';
 const app=createApp(pool,origin,'local',{linkPreviewFetch:async()=>{fetchCalls++;throw Error('unexpected preview fetch');}});
 const login=await app.request(origin+'/api/v1/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'shares-2@example.com',password:DEMO_PASSWORD})});
 assert.equal(login.status,200);
 const session=await login.json() as {csrf_token:string};
 const headers={Origin:origin,Cookie:login.headers.get('set-cookie')!.split(';')[0],'X-CSRF-Token':session.csrf_token,'Content-Type':'application/json'};
 const send=(body:unknown)=>app.request(origin+'/api/v1/shares',{method:'POST',headers:{...headers,'Idempotency-Key':randomUUID()},body:JSON.stringify(body)});
 const before=(await pool.query('SELECT count(*)::int AS n FROM shares')).rows[0].n;
 for(const url of ['https://127.0.0.1/','https://[::1]/','https://10.0.0.1/','https://169.254.169.254/','https://localhost/','https://host.internal/','https://host.local/','https://host.lan/','http://example.com/','ftp://example.com/','https://user:pass@example.com/','https://user@example.com/','https://example.com:8443/','https://example.com/'+'x'.repeat(2048)]){
  const plain=await send({kind:'link',url});
  const manual=await send({kind:'link',url,manual_title:'測試標題'});
  assert.equal(manual.status,plain.status,url);
  assert.equal(manual.status,422,url);
  const plainBody=await plain.json() as {code?:string;detail?:string};
  const manualBody=await manual.json() as {code?:string;detail?:string};
  assert.equal(manualBody.code,plainBody.code,url);
  assert.equal(manualBody.detail,plainBody.detail,url);
 }
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM shares')).rows[0].n,before);
 assert.equal(fetchCalls,0);
});

test('manual share publication respects the daily quota',async()=>{
 const id=randomUUID(),token=randomUUID();
 await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,active,onboarding_required)
  SELECT $1,community_id,$2,'Synthetic quota member',password_hash,$3,true,false FROM users WHERE user_id=$4`,[id,`manual-${id}@example.com`,randomUUID(),DEMO_USERS[0].user_id]);
 await pool.query("INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$1,now()+interval '1 day')",[token,id]);
 const actor={user_id:id,community_id:DEMO_COMMUNITY,session_hash:token} as Actor;
 const first=cmd(actor,{kind:'link',url:'https://example.com/manual-quota-0',manual_title:'分享'});
 const created=await createShare(pool,first,{});
 for(let i=1;i<20;i++)await createShare(pool,cmd(actor,{kind:'link',url:`https://example.com/manual-quota-${i}`,manual_title:'分享'}),{});
 assert.equal((await createShare(pool,first,{})).share_id,created.share_id);
 assert.equal((await createShare(pool,cmd(actor,{kind:'link',url:'https://example.com/manual-quota-0',manual_title:'分享'}),{})).created,false);
 await assert.rejects(createShare(pool,cmd(actor,{kind:'link',url:'https://example.com/manual-quota-overflow',manual_title:'分享'}),{}),{code:'share_daily_limit'});
});

test('repository preview and publication never create a share when GitHub is unavailable',async()=>{
 const {previewShare}=await import('../../modules/shares/service.js');
 const before=(await pool.query('SELECT count(*)::int AS n FROM shares')).rows[0].n;
 for(const [fetcher,code] of [[async()=>{throw Error('timeout');},'github_unavailable'],[async()=>new Response('rate limit',{status:429}),'github_rate_limited']] as const){
  const body={kind:'repository' as const,url:'https://github.com/fixture/unavailable'};
  await assert.rejects(previewShare(pool,cmd(actors[3],body,'POST /shares/preview'),{fetcher}),{status:503,code});
  await assert.rejects(createShare(pool,cmd(actors[3],body),{fetcher}),{status:503,code});
 }
 await assert.rejects(createShare(pool,cmd(actors[3],{url:'https://github.com/fixture/unavailable',manual_title:'手動標題'}),{}),{status:422,code:'repository_identity_required'});
 await assert.rejects(createShare(pool,cmd(actors[3],{url:'https://www.github.com/fixture/unavailable',manual_title:'手動標題'}),{}),{status:422,code:'repository_identity_required'});
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM shares')).rows[0].n,before);
});

test('unknown /s/:id and /events/:id return a Chinese 404 page with security headers for browsers and JSON for other clients', async () => {
  const { createApp } = await import('../../apps/platform-api/src/app.js');
  const { createEvent } = await import('../../modules/community/events.js');
  const origin = 'http://127.0.0.1:4310';
  const app = createApp(pool, origin, 'local');
  const share = await createShare(pool, cmd(actors[3], { url: 'https://example.com/public-v02' }), { previewFetch: async () => new Response('<title>公開連結</title>', { headers: { 'content-type': 'text/html' } }) });
  const openEvent = await createEvent(pool, cmd(actors[3], { title: '公開活動範例', starts_at: '2099-01-01T10:00:00Z', location: '合成場地', visibility: 'open' }, 'POST /events'));
  const unknownId = '00000000-0000-4000-8000-000000009999';
  const badId = '<script>alert(1)</script>';
  const headerNames = ['cache-control', 'x-content-type-options', 'referrer-policy', 'content-security-policy'];

  for (const [foundPath, missingPath, invalidPath, extraHeaders] of [
    [`/s/${share.share_id}`, `/s/${unknownId}`, `/s/${encodeURIComponent(badId)}`, [] as string[]],
    [`/events/${openEvent.event_id}`, `/events/${unknownId}`, `/events/${encodeURIComponent(badId)}`, ['vary']],
  ] as const) {
    const found = await app.request(origin + foundPath, { headers: { Accept: 'text/html,application/xhtml+xml' } });
    assert.equal(found.status, 200, foundPath);

    for (const probePath of [missingPath, invalidPath]) {
      const htmlRes = await app.request(origin + probePath, { headers: { Accept: 'text/html,application/xhtml+xml' } });
      assert.equal(htmlRes.status, 404, probePath);
      assert.match(htmlRes.headers.get('content-type') ?? '', /text\/html/i, probePath);
      for (const h of [...headerNames, ...extraHeaders]) {
        assert.equal(htmlRes.headers.get(h), found.headers.get(h), `${probePath} header ${h}`);
      }
      const html = await htmlRes.text();
      assert.match(html, /找不到這個頁面/, probePath);
      assert.match(html, /<a[^>]*class="[^"]*\bbtn-primary\b[^"]*"[^>]*href="\/"[^>]*>回到首頁<\/a>/, probePath);
      assert.equal((html.match(/<a\b[^>]*href="\//g) ?? []).length, 1, `${probePath} should link to / once`);
      assert.doesNotMatch(html, /\sstyle=/i, probePath);
      assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/i, probePath);
      assert.equal(html.includes(unknownId), false, `${probePath} should not print raw id`);
    }

    for (const accept of ['application/json', '*/*', 'text/html;q=0', undefined]) {
      const headers = accept ? { Accept: accept } : undefined;
      const jsonMissing = await app.request(origin + missingPath, { headers });
      assert.equal(jsonMissing.status, 404, `${missingPath} (${accept ?? 'none'})`);
      assert.match(jsonMissing.headers.get('content-type') ?? '', /application\/json/i, `${missingPath} (${accept ?? 'none'})`);

      const jsonInvalid = await app.request(origin + invalidPath, { headers });
      assert.equal(jsonInvalid.status, 422, `${invalidPath} (${accept ?? 'none'})`);
      assert.match(jsonInvalid.headers.get('content-type') ?? '', /application\/json/i, `${invalidPath} (${accept ?? 'none'})`);
    }
  }
});

test('public /s/:id and /events/:id have one primary CTA, unique link destinations, light portal theme, and short pre-action text', async () => {
  const { eventPageHtml } = await import('../../modules/community/event-page.js');
  const { publicSharePage } = await import('../../modules/shares/public-page.js');
  const repoShare = await createShare(pool, cmd(actors[3], { url: 'https://github.com/fixture/v10-repo' }), { fetcher: async () => Response.json({ ...original, id: 990, full_name: 'fixture/v10-repo' }) });
  const linkShare = await createShare(pool, cmd(actors[3], { url: 'https://example.com/v10-link' }), { previewFetch: async () => new Response('<title>外部文章</title>', { headers: { 'content-type': 'text/html' } }) });

  for (const id of [repoShare.share_id, linkShare.share_id]) {
    const { html } = await publicSharePage(pool, id, 'https://platform.example.com');
    const hrefs = [...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(m => m[1]);
    assert.equal(new Set(hrefs).size, hrefs.length, `duplicate href on /s/${id}: ${hrefs.join(', ')}`);
    assert.equal((html.match(/\bbtn-primary\b/g) ?? []).length, 1, `expected 1 btn-primary on /s/${id}`);
    assert.match(html, /href="\/event-page\.css"/);
    assert.doesNotMatch(html, /href="\/development\.css"/);
    assert.doesNotMatch(html, /\sstyle=/i);
    assert.doesNotMatch(html, /<h2>README<\/h2>/);
  }

  const event = {
    event_id: randomUUID(),
    title: '公開分享活動',
    description: '活動說明',
    starts_at: '2099-05-01T10:00:00Z',
    ends_at: '2099-05-01T12:00:00Z',
    location: '台北自由工坊',
    mode: 'in_person',
    organizer_name: '示範創作者',
    capacity: 20,
    attending_count: 3,
    aggregate_version: 1,
    visibility: 'open',
    state: 'published',
    registration_mode: 'native',
    registration_policy: 'member_only',
    share_id: randomUUID(),
    is_organizer: false,
    waitlist_status: null,
    imported: false,
  };
  const eventHtml = eventPageHtml(event, 'https://platform.example.com', { member: false, participation: true, guest: false });
  const eventHrefs = [...eventHtml.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(eventHrefs).size, eventHrefs.length, `duplicate href on /events/:id: ${eventHrefs.join(', ')}`);
  assert.equal((eventHtml.match(/\bbtn-primary\b/g) ?? []).length, 1);
  assert.match(eventHtml, /href="\/#explore\/events"/);
  assert.doesNotMatch(eventHtml, /\sstyle=/i);
  const mainSlice = eventHtml.split('<main>')[1] ?? '';
  const beforeFirstAction = mainSlice.slice(0, mainSlice.search(/<(?:a|button)\b/)).replace(/<[^>]*>/g, '').replace(event.title, '').trim();
  assert.ok(beforeFirstAction.length <= 20, `expected <=20 static chars before first action, got ${beforeFirstAction.length}: ${beforeFirstAction}`);
});
