import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { migrate } from '../../scripts/database.js';
import { seedLocal,DEMO_USERS,DEMO_COMMUNITY } from '../../packages/testing/seed.js';
import type { Actor } from '../../modules/identity-membership/service.js';
import { createShare,reportShare,retractShare,shareLink,myCredit } from '../../modules/shares/service.js';
import { appendCredit,reverseCredit } from '../../modules/shares/credit.js';
import { transaction } from '../../packages/db/index.js';
import { fetchShareLink } from '../../modules/shares/adapters/link.js';
import { repositoryFacts } from '../../modules/shares/adapters/repository.js';
import { creditPromotionClick,promotionGo } from '../../modules/community/promotion.js';
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
 assert.equal((await pool.query('SELECT state FROM shares WHERE share_id=$1',[first.share_id])).rows[0].state,'hidden');
 assert.equal((await pool.query('SELECT sum(units)::int n FROM share_credit_events WHERE share_id=$1',[first.share_id])).rows[0].n,0);
 await transaction(pool,async q=>{assert.equal(await appendCredit(q,{...fact,source_ref:'hidden'}),undefined);assert.ok((await myCredit(q,actors[0])).items.every(x=>x.count===0));});
 await retractShare(pool,cmd(actors[0],{},'retract'),first.share_id);await retractShare(pool,cmd(actors[0],{},'retract'),first.share_id);
 assert.equal((await pool.query('SELECT sum(units)::int n FROM share_credit_events WHERE share_id=$1',[first.share_id])).rows[0].n,0);
});
test('twenty per-member daily creations; retry and existing object remain allowed',async()=>{
 const member=actors[4],previewFetch=async()=>new Response('<title>Page</title>',{headers:{'Content-Type':'text/html'}});
 for(let i=0;i<20;i++)await createShare(pool,cmd(member,{url:`https://example.com/page/${i}`}),{previewFetch});
 await assert.rejects(createShare(pool,cmd(member,{url:'https://example.com/overflow'}),{previewFetch}),/今天/);
 const r=await createShare(pool,cmd(member,{url:'https://example.com/page/0'}),{previewFetch});assert.equal(r.created,false);
});

test('repository cache renders original README/release, caches 24h and hides a vanished upstream with reversals',async()=>{
 const {refreshRepository,repositoryPage}=await import('../../modules/shares/repository-cache.js');
 const fixture:typeof fetch=async(input,init)=>{
  const path=new URL(String(input)).pathname;
  if(path.endsWith('/readme')){assert.equal(new Headers(init?.headers).get('accept'),'application/vnd.github.html+json');return new Response('<h2>安裝</h2><pre><code>npm install fixture</code></pre><script>bad()</script>',{headers:{etag:'"readme-1"'}});}
  if(path.endsWith('/releases/latest'))return new Response(JSON.stringify({tag_name:'v1',name:'First',html_url:'https://github.com/fixture/cache/releases/tag/v1',published_at:'2026-11-01T00:00:00Z'}));
  return new Response(JSON.stringify({...original,id:903,full_name:'fixture/cache'}));
 };
 const s=await createShare(pool,cmd(actors[0],{url:'https://github.com/fixture/cache'}),{fetcher:fixture});
 const repoId=(await pool.query('SELECT repo_id FROM shares WHERE share_id=$1',[s.share_id])).rows[0].repo_id;
 await refreshRepository(pool,repoId,{fetcher:fixture});
 const {createPublicShareRoutes}=await import('../../apps/platform-api/src/routes/shares.js');
 const publicApp=createPublicShareRoutes(pool,'https://platform.example.com',{fetcher:fixture});
 const publicResponse=await publicApp.request(`/s/${s.share_id}?via=synthetic1`);assert.equal(publicResponse.status,200);
 const publicHtml=await publicResponse.text();assert.match(publicHtml,/npm install fixture/);assert.doesNotMatch(publicHtml,/<script|onclick/);assert.match(publicHtml,/synthetic1/);
 assert.equal(publicResponse.headers.get('cache-control'),'no-store');
 await transaction(pool,async q=>{const page=await repositoryPage(q,repoId);assert.equal(page.stale,false);assert.equal(page.quick_start,'npm install fixture');assert.doesNotMatch(page.readme_html,/script/);assert.equal(page.latest_release.tag_name,'v1');});
 await refreshRepository(pool,repoId,{fetcher:async()=>{throw Error('fresh cache must not fetch');}});
 await pool.query("UPDATE canonical_repositories SET refresh_after=now()-interval '1 day' WHERE repo_id=$1",[repoId]);
 await refreshRepository(pool,repoId,{fetcher:async()=>new Response(null,{status:404})});
 assert.equal((await pool.query('SELECT state FROM shares WHERE share_id=$1',[s.share_id])).rows[0].state,'hidden');
 assert.equal((await pool.query('SELECT sum(units)::int n FROM share_credit_events WHERE share_id=$1',[s.share_id])).rows[0].n,0);
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
