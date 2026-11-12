import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_COMMUNITY,DEMO_USERS,DEMO_PASSWORD} from '../../packages/testing/seed.js';
import type {Actor} from '../../modules/identity-membership/service.js';
import {transaction} from '../../packages/db/index.js';
import {createShare,shareLink,retractShare,reportShare,visibleShare,listShares,myCredit} from '../../modules/shares/service.js';
import {publicSharePage} from '../../modules/shares/public-page.js';
import {createNodePreviewFetch} from '../../apps/platform-api/src/node-preview-fetch.js';
import {fetchShareLink} from '../../modules/shares/adapters/link.js';
import {repositoryFacts} from '../../modules/shares/adapters/repository.js';
import {refreshRepository} from '../../modules/shares/repository-cache.js';
import {createPromotionLink,creditPromotionClick} from '../../modules/community/promotion.js';
import {applyShareBackfill} from '../../modules/shares/backfill.js';
import {creditEventRegistrations} from '../../modules/shares/credit.js';
import {moderateShare} from '../../modules/shares/moderation.js';
import {authenticateAdmin} from '../../modules/platform-admin/service.js';
import {claimShareAuthor} from '../../modules/shares/repository-actions.js';
import {GitHubSocial} from '../../modules/github-social/service.js';
const url=process.env.TEST_DATABASE_URL;
assert.ok(url,'An explicitly provisioned disposable TEST_DATABASE_URL is required');
const schema=`fp_security_shares_${randomUUID().replaceAll('-','')}`;
const admin=new Pool({connectionString:url}),pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
const actors:Actor[]=[];
const command=(actor:Actor,body:unknown,operation='security.share',key=randomUUID())=>({actor,body,operation,key});
const previewFetch=async()=>new Response('<title>Synthetic public link</title>',{headers:{'content-type':'text/html'}});
const link=(actor=actors[0])=>createShare(pool,command(actor,{url:`https://example.com/security/${randomUUID()}`}),{previewFetch});
const repository=(id=18001)=>({id,full_name:`synthetic/repository-${id}`,private:false,visibility:'public',archived:false,fork:false,owner:{id:19001,login:'synthetic'},default_branch:'main',description:'Synthetic fixture',stargazers_count:3});
const count=async(id:string,basis?:string)=>(await pool.query('SELECT coalesce(sum(units),0)::int n FROM share_credit_events WHERE share_id=$1 AND ($2::text IS NULL OR basis=$2)',[id,basis??null])).rows[0].n as number;
before(async()=>{
 await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);await seedLocal(pool);
 for(let i=0;i<8;i++){
  const id=randomUUID(),session=randomUUID();
  await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,active,onboarding_required)
   SELECT $1,community_id,$2,'Synthetic security reviewer',password_hash,$3,true,false FROM users WHERE user_id=$4`,[id,`security-share-${i}@example.com`,randomUUID(),DEMO_USERS[0].user_id]);
  await pool.query("INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$1,now()+interval '1 day')",[session,id]);
  actors.push({user_id:id,community_id:DEMO_COMMUNITY,session_hash:session} as Actor);
 }
});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});

test('SSRF: private hosts, alternate IP encodings, credentials, ports and redirect pivots never reach the transport',async()=>{
 for(const target of ['https://127.0.0.1/','https://2130706433/','https://0x7f000001/','https://0177.0.0.1/','https://[::ffff:127.0.0.1]/','https://[::1]/','https://169.254.169.254/','https://10.0.0.1/','https://localhost./','https://a.local/','https://a.internal/','https://a.lan/','https://user:password@example.com/','https://example.com:8443/','http://example.com/','file:///etc/passwd']){
  let fetched=0;await assert.rejects(fetchShareLink(target,async()=>{fetched++;return previewFetch();}),target);assert.equal(fetched,0,target);
  let hops=0;await assert.rejects(fetchShareLink('https://example.com/start',async()=>{hops++;return new Response(null,{status:302,headers:{location:target}});}));assert.equal(hops,1,target);
 }
 await assert.rejects(fetchShareLink('https://example.com/'),/暫時/);
});

test('SSRF: private and mixed DNS answers are refused through the real host transport',async()=>{
 for(const addresses of [[{address:'127.0.0.1',family:4}],[{address:'169.254.169.254',family:4}],[{address:'::ffff:127.0.0.1',family:6}],[{address:'1.1.1.1',family:4},{address:'10.0.0.1',family:4}],[]]){
  const transport=createNodePreviewFetch(async()=>addresses);
  await assert.rejects(fetchShareLink('https://public-looking.example/',transport));
  await assert.rejects(fetchShareLink('https://example.com/start',(input,init)=>input==='https://example.com/start'?Promise.resolve(new Response(null,{status:302,headers:{location:'https://public-looking.example/'}})):transport(input,init)));
 }
});

test('SSRF: fixed GitHub origin rejects hostile coordinates, redirects, fork pivots and oversized JSON',async()=>{
 for(const target of ['https://127.0.0.1/o/r','https://github.com.evil.example/o/r','https://github.com@evil.example/o/r','https://github.com/o/r?url=https://localhost/','https://github.com/o/%2e%2e/secret','https://github.com/o/r%2f..%2fsecret','https://github.com/o/r/tree/main']){
  let fetched=0;await assert.rejects(repositoryFacts(target,{fetcher:async()=>{fetched++;return Response.json(repository());}}));assert.equal(fetched,0,target);
 }
 let hops=0;await assert.rejects(repositoryFacts('https://github.com/synthetic/repository',{fetcher:async()=>{hops++;return new Response(null,{status:302,headers:{location:'https://127.0.0.1/'}});}}));assert.equal(hops,1);
 await assert.rejects(repositoryFacts('https://github.com/synthetic/repository',{fetcher:async()=>Response.json({...repository(),fork:true,source:{full_name:'../private'}})}));
 await assert.rejects(repositoryFacts('https://github.com/synthetic/repository',{fetcher:async()=>new Response('x'.repeat(196609))}));
 for(const privacy of [{private:true},{visibility:'internal'},{archived:true}])await assert.rejects(repositoryFacts('https://github.com/synthetic/repository',{fetcher:async()=>Response.json({...repository(),...privacy})}));
});

test('fetch budgets reject excessive HTML, unsupported content and redirect loops',async()=>{
 await assert.rejects(fetchShareLink('https://example.com/',async()=>new Response('x'.repeat(1048577),{headers:{'content-type':'text/html'}})),/過大/);
 await assert.rejects(fetchShareLink('https://example.com/',async()=>new Response('{}',{headers:{'content-type':'application/json'}})));
 let hops=0;await assert.rejects(fetchShareLink('https://example.com/',async()=>{hops++;return new Response(null,{status:307,headers:{location:'/again'}});}));assert.equal(hops,4);
});

test('repository refresh refuses private redirects and oversized README without installing attacker data',async()=>{
 const fixture=repository(18002),created=await createShare(pool,command(actors[0],{url:'https://github.com/synthetic/repository-18002'}),{fetcher:async()=>Response.json(fixture)});
 const repoId=(await pool.query('SELECT repo_id FROM shares WHERE share_id=$1',[created.share_id])).rows[0].repo_id;
 for(const mode of ['redirect','oversized'] as const){
  const calls:string[]=[];
  await assert.rejects(refreshRepository(pool,repoId,{fetcher:async(input)=>{const request=String(input);calls.push(request);if(request.endsWith('/readme'))return mode==='redirect'?new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}}):new Response('x'.repeat(1048577));return Response.json(fixture);}},true));
  assert.ok(calls.every(u=>new URL(u).origin==='https://api.github.com'));
  assert.equal((await pool.query('SELECT readme_html FROM canonical_repositories WHERE repo_id=$1',[repoId])).rows[0].readme_html,null);
 }
});

test('forged counts, roles and authors are rejected; disconnected author claims cannot become verified',async()=>{
 for(const extra of [{units:100},{stars:9000},{first_sharer_user_id:actors[1].user_id},{role:'original_author'},{repository:{owner_login:'forged'}}])await assert.rejects(createShare(pool,command(actors[0],{url:'https://example.com/security/forgery',...extra}),{previewFetch}));
 const created=await createShare(pool,command(actors[0],{url:'https://github.com/synthetic/repository-18003'}),{fetcher:async()=>Response.json(repository(18003))});
 const social=new GitHubSocial(pool,undefined,async()=>{throw Error('Disconnected identity must not fetch');});
 await assert.rejects(claimShareAuthor(pool,command(actors[1],{statement:'I claim to have created this repository.'},'security.claim'),created.share_id,social));
 assert.equal(await count(created.share_id,'claim_verified'),0);
});

test('repeated co-sharing and many concurrent tracked-link requests cannot multiply one fact',async()=>{
 const created=await link(),source=(await pool.query('SELECT canonical_url FROM shares WHERE share_id=$1',[created.share_id])).rows[0].canonical_url;
 await Promise.all(Array.from({length:8},()=>createShare(pool,command(actors[1],{url:source}),{previewFetch})));
 assert.equal(await count(created.share_id,'shared_again'),1);
 const links=await Promise.all(Array.from({length:8},()=>shareLink(pool,command(actors[1],{},'security.links'),created.share_id)));
 assert.equal(new Set(links.map(l=>l.code)).size,1);
 await Promise.all(Array.from({length:8},()=>creditPromotionClick(pool,{code:links[0].code,userAgent:'Mozilla/5.0',network:'synthetic-network',sessionUserId:actors[2].user_id,now:new Date()})));
 assert.equal(await count(created.share_id,'qualified_click_day'),1);
});

test('authenticated self clicks and bots earn nothing; anonymous self clicks are bounded by one link and Taipei day',async()=>{
 const created=await link(),tracked=await shareLink(pool,command(actors[0],{},'security.links'),created.share_id);
 for(const [userAgent,sessionUserId] of [['Mozilla/5.0',actors[0].user_id],['Googlebot',null]] as const)await creditPromotionClick(pool,{code:tracked.code,userAgent,sessionUserId,network:'synthetic-self',now:new Date()});
 assert.equal(await count(created.share_id,'qualified_click_day'),0);
 await creditPromotionClick(pool,{code:tracked.code,userAgent:'Mozilla/5.0',sessionUserId:null,network:'synthetic-self',now:new Date()});
 assert.equal(await count(created.share_id,'qualified_click_day'),1);
 const second=await shareLink(pool,command(actors[0],{},'security.links'),created.share_id);
 assert.equal((await createPromotionLink(pool,actors[0],{kind:'share',target:created.share_id})).code,tracked.code,'The original link endpoint returns the same link too');
 assert.equal(second.code,tracked.code);
 await creditPromotionClick(pool,{code:second.code,userAgent:'Mozilla/5.0',sessionUserId:null,network:'another-synthetic-network',now:new Date()});
 assert.equal(await count(created.share_id,'qualified_click_day'),1,'A different anonymous visitor still earns at most one link-day');
 await creditPromotionClick(pool,{code:second.code,userAgent:'Mozilla/5.0',sessionUserId:null,network:'synthetic-self',now:new Date(Date.now()+86400000)});
 assert.equal(await count(created.share_id,'qualified_click_day'),2,'A new Taipei day earns one additional reach fact');
});

test('a sharer cannot suppress co-sharers; personal reversals, retries and concurrent reopening preserve history',async()=>{
 const created=await link(),id=created.share_id,source=(await pool.query('SELECT canonical_url FROM shares WHERE share_id=$1',[id])).rows[0].canonical_url;
 await assert.rejects(retractShare(pool,command(actors[1],{},'security.retract'),id));
 await transaction(pool,async q=>{assert.equal((await myCredit(q,actors[1])).items.some(i=>i.share_id===id),false);await assert.rejects(myCredit(q,actors[1],{user_id:actors[0].user_id}));});
 await createShare(pool,command(actors[1],{url:source}),{previewFetch});
 const original=(await pool.query('SELECT * FROM share_credit_events WHERE share_id=$1 ORDER BY event_id',[id])).rows;
 const withdraw=command(actors[0],{},'security.retract');
 assert.equal((await retractShare(pool,withdraw,id)).state,'published');
 await retractShare(pool,withdraw,id);
 assert.equal(await count(id),1);
 assert.match((await publicSharePage(pool,id,'https://platform.example.com')).html,/1 位會員分享/);
 assert.equal((await pool.query('SELECT count(*)::int n FROM share_endorsements WHERE share_id=$1 AND user_id=$2 AND withdrawn_at IS NULL',[id,actors[0].user_id])).rows[0].n,0);
 await retractShare(pool,command(actors[1],{},'security.retract'),id);
 await assert.rejects(publicSharePage(pool,id,'https://platform.example.com'));
 await transaction(pool,q=>assert.rejects(visibleShare(q,actors[1],id)));
 assert.equal(await count(id),0);
 assert.equal((await transaction(pool,q=>listShares(q,actors[1],{}))).items.some(s=>s.share_id===id),false);
 const reopened=await Promise.all([actors[0],actors[2]].map(actor=>createShare(pool,command(actor,{url:source}),{previewFetch})));
 assert.ok(reopened.every(s=>s.share_id===id));assert.equal(await count(id),2);
 assert.deepEqual((await pool.query('SELECT * FROM share_credit_events WHERE event_id=ANY($1::uuid[]) ORDER BY event_id',[original.map(e=>e.event_id)])).rows,original,'Original historical facts stay immutable');
 await Promise.all([actors[0],actors[2]].map(actor=>retractShare(pool,command(actor,{},'security.retract'),id)));
 assert.equal((await pool.query('SELECT state FROM shares WHERE share_id=$1',[id])).rows[0].state,'retracted');
 assert.equal(await count(id),0);
});

test('private existing sources never become public through share references',async()=>{
 const work=randomUUID();
 await pool.query(`INSERT INTO showcases(showcase_id,community_id,owner_ref,title,description,artifact_ref,visibility,status,consent_recorded_at) VALUES($1,$2,$3,'Synthetic private draft','Private fixture','synthetic-private-artifact','private','draft',NULL)`,[work,DEMO_COMMUNITY,actors[0].user_id]);
 await assert.rejects(createShare(pool,command(actors[1],{kind:'work',ref_id:work})));
 assert.equal((await pool.query('SELECT count(*)::int n FROM shares WHERE ref_id=$1',[work])).rows[0].n,0);
});

test('young accounts and sharers cannot hide; eligible reports hide without penalty and admin decisions are idempotent',async()=>{
 const created=await link(),id=created.share_id,source=(await pool.query('SELECT canonical_url FROM shares WHERE share_id=$1',[id])).rows[0].canonical_url;
 await createShare(pool,command(actors[1],{url:source}),{previewFetch});
 await pool.query("UPDATE users SET created_at=now()-interval '8 days' WHERE user_id=ANY($1::uuid[])",[actors.slice(0,2).map(a=>a.user_id)]);
 for(const actor of actors.slice(0,5))await reportShare(pool,command(actor,{reason:'synthetic report'},'security.report'),id);
 assert.equal((await pool.query('SELECT count(*)::int n FROM share_reports WHERE share_id=$1 AND NOT eligible',[id])).rows[0].n,5);
 assert.equal((await pool.query('SELECT state FROM shares WHERE share_id=$1',[id])).rows[0].state,'published');
 await pool.query("UPDATE users SET created_at=now()-interval '8 days' WHERE user_id=ANY($1::uuid[])",[actors.slice(5).map(a=>a.user_id)]);
 const report=command(actors[5],{reason:'eligible repeated report'},'security.report');
 await Promise.all([report,report,command(actors[5],{reason:'retry'},'security.report')].map(c=>reportShare(pool,c,id)));
 assert.equal((await pool.query('SELECT state FROM shares WHERE share_id=$1',[id])).rows[0].state,'published');
 await Promise.all(actors.slice(6).map(actor=>reportShare(pool,command(actor,{reason:'eligible report'},'security.report'),id)));
 assert.equal((await pool.query('SELECT state FROM shares WHERE share_id=$1',[id])).rows[0].state,'hidden');
 await assert.rejects(publicSharePage(pool,id,'https://platform.example.com'));
 assert.equal(await count(id),2,'Report hiding must not punish either sharer');
 await transaction(pool,async q=>{for(const actor of actors.slice(0,2))assert.equal((await myCredit(q,actor)).items.find(i=>i.share_id===id)?.state,'hidden');});
 await assert.rejects(createShare(pool,command(actors[2],{url:source}),{previewFetch}));
 const adminId=randomUUID();
 await pool.query("INSERT INTO platform_admins(admin_id,community_id,email,display_name,role) VALUES($1,$2,'security-admin@example.com','Synthetic admin','super_admin')",[adminId,DEMO_COMMUNITY]);
 const administrator=await authenticateAdmin(pool,{email:'security-admin@example.com',subject:'synthetic-admin',csrfToken:randomUUID()});
 const moderation=(decision:string)=>({admin:administrator,operation:`POST /admin/api/shares/${id}/${decision}`,key:randomUUID(),body:{reason:'Synthetic moderation decision'}});
 const restore=moderation('restore');
 await Promise.all([moderateShare(pool,restore,id,'restore'),moderateShare(pool,restore,id,'restore')]);
 assert.equal((await pool.query('SELECT state FROM shares WHERE share_id=$1',[id])).rows[0].state,'published');
 assert.equal(await count(id),2);
 assert.equal((await pool.query('SELECT count(*)::int n FROM share_reports WHERE share_id=$1 AND dismissed_at IS NULL',[id])).rows[0].n,0);
 // Replaying a dismissed report cannot re-hide the restored share.
 await reportShare(pool,command(actors[5],{reason:'try again'},'security.report'),id);
 assert.equal((await pool.query('SELECT state FROM shares WHERE share_id=$1',[id])).rows[0].state,'published');
 // A new object supplies a separate review episode for confirm.
 const other=await link();
 for(const actor of actors.slice(5))await reportShare(pool,command(actor,{reason:'eligible report'},'security.report'),other.share_id);
 const confirm={...moderation('confirm'),operation:`POST /admin/api/shares/${other.share_id}/confirm`};
 await Promise.all([moderateShare(pool,confirm,other.share_id,'confirm'),moderateShare(pool,confirm,other.share_id,'confirm')]);
 await moderateShare(pool,{...confirm,key:randomUUID()},other.share_id,'confirm');
 assert.equal(await count(other.share_id),0);
 assert.equal((await pool.query('SELECT count(*)::int n FROM share_credit_events WHERE share_id=$1 AND units=-1',[other.share_id])).rows[0].n,1);
 assert.equal((await pool.query("SELECT count(*)::int n FROM platform_admin_audit WHERE target_type='share' AND target_ref=$1 AND action='share_restore'",[id])).rows[0].n,1);
 await pool.query('UPDATE platform_admins SET active=false WHERE admin_id=$1',[adminId]);
 await assert.rejects(moderateShare(pool,restore,id,'restore'),(e:any)=>e.code==='admin_required');
});

test('mail-only guest farming earns nothing; later confirmations and member identities dedupe once',async()=>{
 const event=randomUUID();
 await pool.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,state,visibility) VALUES($1,$2,$3,'Synthetic security event','Fixture',now()+interval '2 days',now()+interval '3 days','online','Fixture','published','workshop')`,[event,DEMO_COMMUNITY,actors[0].user_id]);
 await pool.query("INSERT INTO community_event_rsvps(rsvp_id,event_id,user_id,state,referred_by_user_id) VALUES($1,$2,$3,'going',$4)",[randomUUID(),event,actors[2].user_id,actors[1].user_id]);
 for(const [email,sent] of [['security-share-2@example.com',true],['security-share-1@example.com',true],['unsent-security@example.com',false]] as const)await pool.query("INSERT INTO community_event_guest_rsvps(event_id,email,name,state,referred_by_user_id,email_sent_at) VALUES($1,$2,'Synthetic guest','going',$3,$4)",[event,email,actors[1].user_id,sent?new Date():null]);
 const plan={repositories:[],events:[{event_id:event,community_id:DEMO_COMMUNITY,organizer_ref:actors[0].user_id,title:'Synthetic security event',created_at:new Date()}]};
 await applyShareBackfill(pool,plan,true);
 const id=(await pool.query('SELECT share_id FROM shares WHERE ref_id=$1',[event])).rows[0].share_id;
 assert.equal(await count(id,'registration'),1);
 for(let i=0;i<4;i++)await pool.query("INSERT INTO community_event_guest_rsvps(event_id,email,name,state,referred_by_user_id,email_sent_at) VALUES($1,$2,'Synthetic guest','going',$3,now())",[event,`mail-only-${i}@example.com`,actors[1].user_id]);
 await applyShareBackfill(pool,plan,true);
 assert.equal(await count(id,'registration'),1,'Unconfirmed guest addresses must not create registration credit');
 await pool.query("UPDATE community_event_guest_rsvps SET confirmed_at=now() WHERE event_id=$1 AND email IN ('mail-only-0@example.com','security-share-2@example.com','security-share-1@example.com')",[event]);
 const credits=await Promise.all(Array.from({length:4},()=>transaction(pool,q=>creditEventRegistrations(q,event))));
 assert.equal(credits.reduce((a,b)=>a+b,0),1);
 assert.equal(await count(id,'registration'),2,'Confirmed self-referral and guest/member duplicate do not count twice');
 await pool.query('UPDATE users SET email=$2 WHERE user_id=$1',[actors[6].user_id,'mail-only-0@example.com']);
 await pool.query("INSERT INTO community_event_rsvps(rsvp_id,event_id,user_id,state,referred_by_user_id) VALUES($1,$2,$3,'going',$4)",[randomUUID(),event,actors[6].user_id,actors[1].user_id]);
 await transaction(pool,q=>creditEventRegistrations(q,event));assert.equal(await count(id,'registration'),2,'Guest then member also counts once');
 await applyShareBackfill(pool,plan,true);assert.equal(await count(id,'registration'),2);
 await pool.query("UPDATE community_event_guest_rsvps SET confirmed_at=now() WHERE event_id=$1 AND email='mail-only-1@example.com'",[event]);
 await applyShareBackfill(pool,plan,true);assert.equal(await count(id,'registration'),3,'Backfill also detects later confirmations exactly once');
 await transaction(pool,q=>creditEventRegistrations(q,event));assert.equal(await count(id,'registration'),3);
});


test('concurrent new shares cannot exceed the per-member twenty-per-day creation cap',async()=>{
 const results=await Promise.allSettled(Array.from({length:24},()=>link(actors[7])));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,20);
 const rejected=results.filter(r=>r.status==='rejected');assert.equal(rejected.length,4);
 assert.ok(rejected.every(r=>r.reason.code==='share_daily_limit'));
 assert.equal((await pool.query('SELECT count(*)::int n FROM shares WHERE first_sharer_user_id=$1',[actors[7].user_id])).rows[0].n,20);
});


test('share links cannot bypass the existing daily promotion-link cap, including concurrent creators',async()=>{
 const existingShare=await link(),first=await shareLink(pool,command(actors[5],{},'security.links'),existingShare.share_id);
 await pool.query(`INSERT INTO promotion_links(community_id,user_id,kind,target_key,code,revoked_at)
  SELECT $1,$2,'platform','workshop','seclink'||lpad(n::text,3,'0'),now() FROM generate_series(1,198) n`,[DEMO_COMMUNITY,actors[5].user_id]);
 const a=await link(),b=await link();
 const results=await Promise.allSettled([a,b].map(s=>shareLink(pool,command(actors[5],{},'security.links'),s.share_id)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1,'Only one of two concurrent requests may claim the last link slot');
 const failure=results.find(r=>r.status==='rejected');assert.ok(failure&&failure.status==='rejected');assert.equal(failure.reason.code,'promotion_link_limit');
 assert.equal((await shareLink(pool,command(actors[5],{},'security.links'),existingShare.share_id)).code,first.code,'Existing link retries remain available at cap');
});


test('share and original promotion endpoints cannot race for separate copies of the last budget slot',async()=>{
 const a=await link();
 await pool.query(`INSERT INTO promotion_links(community_id,user_id,kind,target_key,code,revoked_at)
  SELECT $1,$2,'platform','workshop','mixlink'||lpad(n::text,3,'0'),now() FROM generate_series(1,199) n`,[DEMO_COMMUNITY,actors[6].user_id]);
 const results=await Promise.allSettled([
  shareLink(pool,command(actors[6],{},'security.links'),a.share_id),
  createPromotionLink(pool,actors[6],{kind:'platform',target:'tester-map'}),
 ]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const failure=results.find(r=>r.status==='rejected');assert.ok(failure&&failure.status==='rejected');assert.equal(failure.reason.code,'promotion_link_limit');
});

test('admin share routes require verified active admin and CSRF, scope community and journal retries once',async()=>{
 const {createApp}=await import('../../apps/platform-api/src/app.js');
 const {createAdminAccessVerifier}=await import('../../modules/platform-admin/access.js');
 const {createLocalJWKSet,exportJWK,generateKeyPair,SignJWT}=await import('jose');
 const {randomBytes}=await import('node:crypto');
 const pair=await generateKeyPair('RS256'),jwk=await exportJWK(pair.publicKey);
 const issuer='https://synthetic.cloudflareaccess.com',audience='share-admin-tests',email='share-http-admin@example.com',origin='http://127.0.0.1:46451';
 const verifier=createAdminAccessVerifier({issuer,audience,csrfSecret:randomBytes(32).toString('hex'),keySet:createLocalJWKSet({keys:[{...jwk,kid:'fixture',alg:'RS256'}]})});
 const app=createApp(pool,origin,'local',{adminVerifier:verifier});
 const adminId=randomUUID();await pool.query('INSERT INTO platform_admins(admin_id,community_id,email,display_name) VALUES($1,$2,$3,$4)',[adminId,DEMO_COMMUNITY,email,'Synthetic HTTP admin']);
 const now=Math.floor(Date.now()/1000),jwt=await new SignJWT({type:'app',email,sub:'synthetic-http-admin',iss:issuer,aud:audience,iat:now,nbf:now,exp:now+600}).setProtectedHeader({alg:'RS256',kid:'fixture'}).sign(pair.privateKey);
 const csrf=(await verifier(new Request(origin,{headers:{'Cf-Access-Jwt-Assertion':jwt}}))).csrfToken;
 const created=await link(),id=created.share_id;
 for(const actor of actors.slice(5))await reportShare(pool,command(actor,{reason:'eligible HTTP report'},'security.report'),id);
 const request=(decision:string,headers:Record<string,string>,key=randomUUID(),shareId=id)=>app.request(origin+`/admin/api/shares/${shareId}/${decision}`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','Idempotency-Key':key,...headers},body:JSON.stringify({reason:'Synthetic review decision'})});
 const valid={'Cf-Access-Jwt-Assertion':jwt,'X-Admin-CSRF':csrf};
 const login=await app.request(origin+'/api/v1/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'security-share-0@example.com',password:DEMO_PASSWORD})});
 assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!.split(';')[0];
 for(const decision of ['restore','confirm'])assert.equal((await request(decision,{Cookie:cookie})).status,401,'A member session is not admin authority');
 for(const decision of ['restore','confirm']){
   assert.equal((await request(decision,{})).status,401);
   assert.equal((await request(decision,{'Cf-Access-Jwt-Assertion':jwt})).status,403);
   assert.equal((await request(decision,{...valid,'X-Admin-CSRF':'invalid'})).status,403);
 }
 const foreignCommunity=randomUUID(),foreignShare=randomUUID();
 await pool.query('INSERT INTO communities(community_id,name) VALUES($1,$2)',[foreignCommunity,'Synthetic foreign community']);
 await pool.query("INSERT INTO shares(share_id,community_id,kind,canonical_key,canonical_url,title,state) VALUES($1,$2,'link',$3,'https://example.com/foreign','Synthetic foreign share','hidden')",[foreignShare,foreignCommunity,randomUUID()]);
 for(const decision of ['restore','confirm'])assert.equal((await request(decision,valid,randomUUID(),foreignShare)).status,404);
 const key=randomUUID();
 for(let i=0;i<2;i++)assert.equal((await request('confirm',valid,key)).status,200);
 assert.equal(await count(id),0);
 assert.equal((await pool.query("SELECT count(*)::int n FROM platform_admin_audit WHERE target_ref=$1 AND action='share_confirm'",[id])).rows[0].n,1);
 assert.equal((await request('restore',valid)).status,200);
 assert.equal((await pool.query('SELECT state FROM shares WHERE share_id=$1',[id])).rows[0].state,'published');
 assert.equal(await count(id),0,'Restore does not rewrite previously confirmed reversal history');
 await pool.query('UPDATE platform_admins SET active=false WHERE admin_id=$1',[adminId]);
 assert.equal((await request('confirm',valid,key)).status,403,'Revoked admin cannot replay a receipt');
});
