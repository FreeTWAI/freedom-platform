import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createPool} from '../../packages/db/index.js';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_USERS,DEMO_PASSWORD} from '../../packages/testing/seed.js';
import {createApp} from '../../apps/platform-api/src/app.js';
import {tokenHash} from '../../modules/identity-membership/service.js';
const origin='http://127.0.0.1:4310';
const url=process.env.TEST_DATABASE_URL!;
assert.ok(url?.includes('/fp_'),'explicit isolated database required');
const schema=`fp_agent_${process.pid}_${Date.now()}`,admin=createPool(url),pool=new Pool({connectionString:url,options:`-c search_path=${schema}`,max:12});
let shareFetchOffline=false,shareFetchCalls=0;
const app=createApp(pool,origin,'local',{eventParticipationEnabled:true,socialAchievementsEnabled:true,linkPreviewFetch:async url=>{shareFetchCalls++;if(shareFetchOffline)throw Error('synthetic upstream offline');return new Response('<title>Synthetic '+new URL(String(url)).pathname+'</title>',{headers:{'Content-Type':'text/html'}});}});
before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
beforeEach(async()=>{shareFetchOffline=false;shareFetchCalls=0;await pool.query('TRUNCATE communities,login_attempts,auth_rate_limits CASCADE');await seedLocal(pool);});
type Session={cookie:string;csrf:string;user:any};
async function req(path:string,opts:{session?:Session;token?:string;body?:unknown;key?:string;method?:string;headers?:Record<string,string>}={}){
 const {session,token,body,key=randomUUID(),method=body===undefined?'GET':'POST'}=opts;
 const headers:Record<string,string>={...(session?{Origin:origin,Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{}),...(token?{Authorization:'Bearer '+token}:{}),...opts.headers};
 if(body!==undefined){headers['Content-Type']='application/json';headers['Idempotency-Key']=key;}
 const response=await app.request(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json() as any;return {status:response.status,data,response};
}
async function ready(index=0):Promise<Session>{
 const r=await req('/api/v1/auth/login',{body:{email:DEMO_USERS[index].email,password:DEMO_PASSWORD},headers:{Origin:origin}});assert.equal(r.status,200);
 await pool.query('UPDATE users SET onboarding_completed_at=now() WHERE user_id=$1',[r.data.user.user_id]);
 return {cookie:r.response.headers.get('set-cookie')!.split(';')[0],csrf:r.data.csrf_token,user:r.data.user};
}
async function issue(session:Session,scopes=['read','share','rsvp']){const r=await req('/api/v1/me/agent-tokens',{session,body:{name:'測試 Agent',scopes}});assert.equal(r.status,201,JSON.stringify(r.data));return r.data;}
const eventBody=()=>({title:'測試活動',description:'一起交流',starts_at:new Date(Date.now()+86400000).toISOString(),ends_at:new Date(Date.now()+90000000).toISOString(),mode:'online',location:'線上',capacity:30,visibility:'open'});

test('one-time hashed credential, browser-only lifecycle, rotation and immediate revocation',async()=>{
 const session=await ready(),issued=await issue(session);
 assert.match(issued.access_token,/^fw_agent_[A-Za-z0-9_-]{43}$/);
 const stored=(await pool.query('SELECT * FROM member_client_connections WHERE connection_id=$1',[issued.connection_id])).rows[0];
 assert.equal(stored.token_hash,tokenHash(issued.access_token));assert.ok(!JSON.stringify(stored).includes(issued.access_token));
 assert.ok(Math.abs(new Date(stored.expires_at).getTime()-Date.now()-90*86400000)<5000);
 const listed=await req('/api/v1/me/agent-tokens',{session});assert.equal(listed.status,200);assert.ok(!JSON.stringify(listed.data).includes(issued.access_token));assert.ok(!JSON.stringify(listed.data).includes(stored.token_hash));
 assert.equal((await req('/api/v1/events',{token:issued.access_token})).status,200);
 const renewed=await req(`/api/v1/me/agent-tokens/${issued.connection_id}/renew`,{session,body:{name:'新連線',scopes:['read']}});assert.equal(renewed.status,201);
 assert.equal((await req('/api/v1/events',{token:issued.access_token})).status,401);
 assert.equal((await req('/api/v1/events',{token:renewed.data.access_token})).status,200);
 assert.equal((await req(`/api/v1/me/agent-tokens/${renewed.data.connection_id}/revoke`,{session,body:{}})).status,200);
 assert.equal((await req('/api/v1/events',{token:renewed.data.access_token})).status,401);
});
test('scope/default denial, mixed credentials, expired and inactive owner',async()=>{
 const session=await ready(),issued=await issue(session,['read']),token=issued.access_token;
 assert.equal((await req('/api/v1/events',{token,body:eventBody()})).status,403);
 assert.equal((await req('/api/v1/not-registered',{token})).status,403);
 assert.equal((await req('/api/v1/events',{token,session})).status,400);
 assert.equal((await req('/api/v1/events',{token,headers:{Cookie:'unrelated=value'}})).status,400);
 assert.equal((await req('/api/v1/events',{token,headers:{'X-Route-Pattern':'/api/v1/events'}})).status,200);
 await pool.query("UPDATE member_client_connections SET expires_at=clock_timestamp()-interval '1 second' WHERE connection_id=$1",[issued.connection_id]);
 assert.equal((await req('/api/v1/events',{token})).status,401);
 await pool.query("UPDATE member_client_connections SET expires_at=clock_timestamp()+interval '1 day' WHERE connection_id=$1",[issued.connection_id]);
 await pool.query('UPDATE users SET active=false WHERE user_id=$1',[session.user.user_id]);
 assert.equal((await req('/api/v1/events',{token})).status,401);
});
const forbidden=[
 ['password','POST','/api/v1/me/password'],['TOTP','POST','/api/v1/me/totp/enable'],['email','POST','/api/v1/me/email'],
 ['issue token','POST','/api/v1/me/agent-tokens'],['list tokens','GET','/api/v1/me/agent-tokens'],
 ['renew token','POST',`/api/v1/me/agent-tokens/${randomUUID()}/renew`],['revoke token','POST',`/api/v1/me/agent-tokens/${randomUUID()}/revoke`],
 ['read credentials','GET','/api/v1/me/client-connections'],['pairing','POST','/api/v1/client-connections/start'],
 ['account deletion','POST','/api/v1/me/delete'],['payment','POST','/api/v1/payments'],['checkout','POST','/api/v1/checkout'],
 ['provider key','POST','/api/v1/me/model-settings'],['platform admin','GET','/admin/api/members'],['member admin','GET','/api/v1/admin/reports'],
 ['guild master review','POST',`/api/v1/events/${randomUUID()}/review`],['guild launchpad','POST','/api/v1/guilds/guild_test/launchpad/publish'],
 ['reaction','POST',`/api/v1/shares/${randomUUID()}/star`],['message','POST',`/api/v1/me/conversations/${randomUUID()}/messages`],
 ['public login','POST','/api/v1/auth/login'],['public alias','GET','/events'],
] as const;
for(const [family,method,path] of forbidden)test(`bearer cannot reach ${family}`,async()=>{
 const session=await ready(),issued=await issue(session);
 const r=await req(path,{token:issued.access_token,method,...(method==='POST'?{body:{}}:{})});assert.equal(r.status,403,JSON.stringify(r.data));assert.equal(r.data.code,'scope_required');
});
test('first exact publication waits for browser confirmation; replay, concurrency and daily cap',async()=>{
 const session=await ready(),issued=await issue(session),token=issued.access_token,body=eventBody(),key=randomUUID(),path='/api/v1/events';
 assert.equal((await req(path,{token,body,key:''})).status,400);
 const pending=await req(path,{token,body,key});assert.equal(pending.status,202);assert.equal(pending.data.code,'pending_member');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM community_events WHERE organizer_ref=$1',[session.user.user_id])).rows[0].n,0);
 const list=await req('/api/v1/me/agent-tokens',{session}),proposal=list.data.items[0].pending_publication;
 assert.deepEqual(proposal.body,body);
 const other=await ready(1);assert.equal((await req(`/api/v1/me/agent-tokens/${issued.connection_id}/confirm`,{session:other,body:{request_sha256:proposal.request_sha256}})).status,404);
 assert.equal((await req(`/api/v1/me/agent-tokens/${issued.connection_id}/confirm`,{session,body:{request_sha256:proposal.request_sha256}})).status,200);
 assert.equal((await req(path,{token,body:{...body,title:'未核准內容'},key})).status,202);
 assert.equal((await req(path,{token,body,key})).status,202,'changing a pending proposal clears old consent');
 assert.equal((await req(`/api/v1/me/agent-tokens/${issued.connection_id}/confirm`,{session,body:{request_sha256:proposal.request_sha256}})).status,200);
 const created=await req(path,{token,body,key});assert.equal(created.status,201,JSON.stringify(created.data));assert.equal(created.data.via_agent,true);assert.equal(created.data.organizer_ref,session.user.user_id);
 assert.deepEqual((await req(path,{token,body,key})).data,created.data);
 assert.equal((await pool.query('SELECT public_items FROM agent_daily_usage WHERE connection_id=$1',[issued.connection_id])).rows[0].public_items,1);
 assert.equal((await pool.query('SELECT via_agent FROM community_events WHERE event_id=$1',[created.data.event_id])).rows[0].via_agent,true);
 await pool.query('UPDATE member_client_connections SET public_daily_cap=2 WHERE connection_id=$1',[issued.connection_id]);
 const concurrent=await Promise.all([req(path,{token,body:eventBody()}),req(path,{token,body:eventBody()})]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[201,429]);
 assert.equal((await req(path,{token,body,key})).status,201,'replay works at cap');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM agent_publications WHERE connection_id=$1',[issued.connection_id])).rows[0].n,2);
});
test('ten denied requests suspend a token; successful reads do not erase failures',async()=>{
 const session=await ready(),issued=await issue(session),token=issued.access_token;
 for(let i=0;i<10;i++){assert.equal((await req('/api/v1/unlisted',{token})).status,403);if(i<9)assert.equal((await req('/api/v1/events',{token})).status,200);}
 assert.equal((await req('/api/v1/events',{token})).status,401);
 const row=(await req('/api/v1/me/agent-tokens',{session})).data.items[0];assert.ok(row.suspended_at);assert.equal(row.failure_count,10);assert.ok(row.last_used_at);
});
test('own credential management cannot access another member and browser CSRF remains required',async()=>{
 const owner=await ready(),other=await ready(1),issued=await issue(owner);
 assert.equal((await req(`/api/v1/me/agent-tokens/${issued.connection_id}/revoke`,{session:other,body:{}})).status,404);
 assert.equal((await req('/api/v1/me/agent-tokens',{session:owner,body:{name:'test',scopes:['read']},headers:{'X-CSRF-Token':''}})).status,403);
 assert.equal((await req('/api/v1/me/agent-tokens',{session:owner,body:{name:'test',scopes:['react']}})).status,422);
});

test('every registered non-allowlisted API route is denied before its handler, including every admin and guild action',async()=>{
 const {agentOperation}=await import('../../apps/platform-api/src/agent-allowlist.js');
 const session=await ready(),issued=await issue(session);
 let checked=0;
 for(const route of app.routes){
  if(route.method==='ALL'||!route.path.includes('/api')||agentOperation(route.method,route.path))continue;
  const path=route.path.replace(/:([A-Za-z_][A-Za-z_0-9]*)(\{[^}]*\})?/g,randomUUID()).replace(/\*/g,'denied');
  await pool.query('UPDATE member_client_connections SET failure_count=0,suspended_at=NULL WHERE connection_id=$1',[issued.connection_id]);
  const r=await req(path,{token:issued.access_token,method:route.method,...(['GET','HEAD'].includes(route.method)?{}:{body:{}})});
  assert.equal(r.status,403,`${route.method} ${route.path}: ${r.data.code}`);checked++;
 }
 assert.ok(checked>300,`examined ${checked} registered routes`);
});

test('receipt namespaces are per token; session receipt is never replayed by a token',async()=>{
 const session=await ready(),one=await issue(session),two=await issue(session),body=eventBody(),key=randomUUID();
 // Same operation/key with browser authority has a distinct receipt namespace.
 const browser=await req('/api/v1/events',{session,body,key});assert.equal(browser.status,201);
 for(const token of [one.access_token,two.access_token])assert.equal((await req('/api/v1/events',{token,body,key})).status,202);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM agent_pending_publications')).rows[0].n,2);
});

test('allowlisted RSVP, waitlist, own credit and notifications use current token authority',async()=>{
 const session=await ready(),other=await ready(1),issued=await issue(session),token=issued.access_token;
 const created=await req('/api/v1/events',{session,body:eventBody()});assert.equal(created.status,201);
 const id=created.data.event_id;
 await pool.query("UPDATE community_events SET state='published',waitlist_enabled=true,response_window_minutes=30 WHERE event_id=$1",[id]);
 const path=`/api/v1/events/${id}/rsvp`,key=randomUUID(),r=await req(path,{token,body:{going:true},key});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.my_rsvp,'going');
 assert.deepEqual((await req(path,{token,body:{going:true},key})).data,r.data);
 assert.equal((await req(`/api/v1/events/${id}`,{token})).status,200);
 assert.equal((await req(path,{token,body:{going:false}})).status,200);
 const current=await req(`/api/v1/events/${id}`,{token});
 const wait=await req(`/api/v1/events/${id}/waitlist`,{token,body:{action:'join'},headers:{'If-Match':`"${current.data.aggregate_version}"`}});assert.equal(wait.status,200,JSON.stringify(wait.data));
 for(const path of ['/me/contribution-records','/me/contribution-outcomes','/me/social-achievements']){
  const own=await req('/api/v1'+path,{token});assert.equal(own.status,200,`${path}: ${JSON.stringify(own.data)}`);
  assert.deepEqual(own.data,(await req('/api/v1'+path,{session})).data);
 }
 const {notifyMember}=await import('../../modules/member-communications/notifications.js');
 for(const member of [session,other])await notifyMember(pool,{community_id:(await pool.query('SELECT community_id FROM users WHERE user_id=$1',[member.user.user_id])).rows[0].community_id,recipient_ref:member.user.user_id,kind:'friend_request',source_key:randomUUID(),title:'測試通知',body:member===session?'自己的通知':'別人的通知',action:null});
 const notifications=await req('/api/v1/me/notifications',{token});assert.equal(notifications.status,200,JSON.stringify(notifications.data));assert.ok(JSON.stringify(notifications.data).includes('自己的通知'));assert.ok(!JSON.stringify(notifications.data).includes('別人的通知'));
 assert.equal((await req(`/api/v1/members/${other.user.user_id}/contribution-outcomes`,{token})).status,403);
 assert.equal((await req('/api/v1/me/notifications?user_id='+other.user.user_id,{token})).status,422);
});

test('repository sharing uses existing import with hash-only credentials and member attribution',async t=>{
 const session=await ready(),issued=await issue(session),token=issued.access_token;
 t.mock.method(globalThis,'fetch',async(input:string|URL|Request)=>{
  const url=String(input);assert.equal(new URL(url).hostname,'api.github.com');
  if(url.endsWith('/repos/example/project'))return Response.json({id:12345,full_name:'example/project',private:false,visibility:'public',default_branch:'main',fork:false,archived:false});
  if(url.endsWith('/commits/main'))return Response.json({sha:'a'.repeat(40)});
  if(url.includes('/license?ref='))return Response.json({path:'LICENSE',license:{spdx_id:'MIT'}});
  throw new Error('unexpected fixture request');
 });
 const body={repository_url:'https://github.com/example/project',title:'範例專案',description:'專案介紹',use_notes:'讀取 README',relationship:'curator',consent_to_share:true},key=randomUUID(),path='/api/v1/opensource/projects';
 assert.equal((await req(path,{token,body,key})).status,202);
 const list=await req('/api/v1/me/agent-tokens',{session});
 await req(`/api/v1/me/agent-tokens/${issued.connection_id}/confirm`,{session,body:{request_sha256:list.data.items[0].pending_publication.request_sha256}});
 const result=await req(path,{token,body,key});assert.equal(result.status,201,JSON.stringify(result.data));assert.equal(result.data.owner_ref,session.user.user_id);assert.equal(result.data.via_agent,true);
 assert.deepEqual((await req(path,{token,body,key})).data,result.data);
});

test('public guide and generated contract describe exactly the granted operations without credentials',async()=>{
 const {agentOperations}=await import('../../apps/platform-api/src/agent-allowlist.js');
 const response=await app.request(origin+'/agent.md'),guide=await response.text();assert.equal(response.status,200);assert.match(response.headers.get('content-type')!,/text\/markdown/);
 assert.ok(guide.includes('Idempotency-Key'));assert.ok(!/fw_agent_[A-Za-z0-9_-]{43}/.test(guide));
 assert.ok((await (await app.request(origin+'/llms.txt')).text()).includes('/agent.md'));
 const contract=await (await app.request(origin+'/agent/openapi.json')).json() as any;
 assert.deepEqual(Object.values(contract.paths).flatMap((p:any)=>Object.values(p).map((op:any)=>op.operationId)).sort(),agentOperations.filter(op=>op.granted!==false).map(op=>op.id).sort());
 assert.equal(contract.paths['/shares/{share_id}/star'],undefined);
});

test('contract --check detects a changed allowlist and a changed generated artifact',async()=>{
 const {mkdtempSync,mkdirSync,copyFileSync,appendFileSync,readFileSync,writeFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join,dirname}=await import('node:path');const {spawnSync}=await import('node:child_process');
 const dir=mkdtempSync(join(tmpdir(),'agent-contract-test-'));
 try{
  const files=['scripts/build-agent-contract.mjs','apps/platform-api/src/agent-allowlist.ts','contracts/agent/v1/openapi.json','apps/portal-web/src/modules/agent-operations.ts','modules/client-connections/agent-contract.ts'];
  for(const file of files){mkdirSync(dirname(join(dir,file)),{recursive:true});copyFileSync(file,join(dir,file));}
  writeFileSync(join(dir,'package.json'),'{"type":"module"}');
  const check=()=>spawnSync(process.execPath,['scripts/build-agent-contract.mjs','--check'],{cwd:dir,encoding:'utf8'});
  assert.equal(check().status,0);
  appendFileSync(join(dir,files[2]),' ');assert.equal(check().status,1);
  copyFileSync(files[2],join(dir,files[2]));
  const table=join(dir,files[1]);writeFileSync(table,readFileSync(table,'utf8').replace("title:'查看活動'","title:'活動列表'"));assert.equal(check().status,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('change feed is member-bound, cursor-paged, and does not skip late commits or expose message bodies',async()=>{
 const session=await ready(),other=await ready(1),issued=await issue(session),otherToken=await issue(other),token=issued.access_token;
 const community=(await pool.query('SELECT community_id FROM users WHERE user_id=$1',[session.user.user_id])).rows[0].community_id;
 const empty=await req('/api/v1/agent/events',{token});assert.equal(empty.status,200);const start=empty.data.next_cursor;
 const {notifyMember}=await import('../../modules/member-communications/notifications.js');
 const delayed=await pool.connect();
 try{
  await delayed.query('BEGIN');
  await notifyMember(delayed,{community_id:community,recipient_ref:session.user.user_id,kind:'event_approved',source_key:randomUUID(),title:'核准',body:'測試',action:{tab:'events',resource_id:randomUUID()}});
  await pool.query('INSERT INTO member_direct_messages(community_id,sender_ref,recipient_ref,body) VALUES($1,$2,$3,$4)',[community,other.user.user_id,session.user.user_id,'不應回傳的正文']);
  const first=await req('/api/v1/agent/events?after='+start,{token});assert.equal(first.status,200);assert.deepEqual(first.data.items.map((e:any)=>e.kind),['message.received']);assert.ok(!JSON.stringify(first.data).includes('不應回傳的正文'));
  await delayed.query('COMMIT');
  const late=await req('/api/v1/agent/events?after='+first.data.next_cursor,{token});assert.equal(late.status,200);assert.deepEqual(late.data.items.map((e:any)=>e.kind),['event.approved']);
  assert.equal((await req('/api/v1/agent/events?after='+late.data.next_cursor,{token:otherToken.access_token})).status,400);
  assert.deepEqual((await req('/api/v1/agent/events',{token:otherToken.access_token})).data.items,[]);
  for(let i=0;i<105;i++)await pool.query('SELECT record_agent_change($1,$2,$3,$4,$5)',[community,session.user.user_id,'share.credited','synthetic-credit/'+i,randomUUID()]);
  const page1=await req('/api/v1/agent/events?after='+late.data.next_cursor,{token});assert.equal(page1.data.items.length,100);assert.equal(page1.data.has_more,true);
  const page2=await req('/api/v1/agent/events?after='+page1.data.next_cursor,{token});assert.equal(page2.data.items.length,5);assert.equal(new Set([...page1.data.items,...page2.data.items].map((e:any)=>e.event_id)).size,105);
  assert.deepEqual((await req('/api/v1/agent/events?after='+page2.data.next_cursor,{token})).data.items,[]);
 }finally{await delayed.query('ROLLBACK');delayed.release();}
});

test('RSVP and notification producers emit confirmed, updated and waitlist invitation changes',async()=>{
 const session=await ready(),issued=await issue(session),token=issued.access_token;
 const created=await req('/api/v1/events',{session,body:eventBody()}),id=created.data.event_id;
 await pool.query("UPDATE community_events SET state='published' WHERE event_id=$1",[id]);
 const r=await req(`/api/v1/events/${id}/rsvp`,{token,body:{going:true}});assert.equal(r.status,200);
 const {notifyMember}=await import('../../modules/member-communications/notifications.js');
 await pool.query("UPDATE community_events SET description='更新內容',aggregate_version=aggregate_version+1 WHERE event_id=$1",[id]);
 for(const kind of ['event_waitlist_invited'] as const)await notifyMember(pool,{community_id:created.data.community_id,recipient_ref:session.user.user_id,kind,source_key:randomUUID(),title:'測試',body:'測試通知',action:{tab:'events',resource_id:id}});
 const feed=await req('/api/v1/agent/events',{token});assert.equal(feed.status,200);for(const kind of ['rsvp.confirmed','event.updated','rsvp.waitlist_promoted'])assert.ok(feed.data.items.some((e:any)=>e.kind===kind),kind);
 const readonly=await issue(session,['rsvp']);assert.equal((await req('/api/v1/agent/events',{token:readonly.access_token})).status,403);
});

test('a guild master token cannot read another member pending event through list, detail or RSVP cancellation',async()=>{
 const owner=await ready(),reviewer=await ready(1),issued=await issue(reviewer);
 const created=await req('/api/v1/events',{session:owner,body:eventBody()});assert.equal(created.status,201);assert.equal(created.data.state,'pending');
 await pool.query(`INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state)
 VALUES($1,$2,$3,$4,'active') ON CONFLICT DO NOTHING`,[randomUUID(),created.data.community_id,reviewer.user.user_id,created.data.review_guild_key]);
 await pool.query('INSERT INTO positioning_guild_officers(community_id,guild_key,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[created.data.community_id,created.data.review_guild_key,reviewer.user.user_id]);
 const path='/api/v1/events/'+created.data.event_id;
 assert.equal((await req(path,{session:reviewer})).status,200,'browser reviewer retains existing authority');
 assert.equal((await req(path,{token:issued.access_token})).status,404);
 const list=await req('/api/v1/events',{token:issued.access_token});assert.equal(list.status,200);assert.ok(!list.data.items.some((e:any)=>e.event_id===created.data.event_id));
 assert.equal((await req(path+'/rsvp',{token:issued.access_token,body:{going:false}})).status,404);
 assert.equal((await pool.query('SELECT 1 FROM community_event_rsvps WHERE event_id=$1 AND user_id=$2',[created.data.event_id,reviewer.user.user_id])).rowCount,0);
 await pool.query("UPDATE community_events SET state='published' WHERE event_id=$1",[created.data.event_id]);
 const key=randomUUID();assert.equal((await req(path+'/rsvp',{token:issued.access_token,body:{going:true},key})).status,200);
 await pool.query("UPDATE community_events SET state='pending' WHERE event_id=$1",[created.data.event_id]);
 assert.equal((await req(path+'/rsvp',{token:issued.access_token,body:{going:true},key})).status,404,'receipt replay rechecks current non-review visibility');
});

test('expiry during a real domain wait rejects data and rolls back writes; revocation winning the credential lock rejects reads',async()=>{
 const {setImmediate}=await import('node:timers/promises');
 const session=await ready(),issued=await issue(session),token=issued.access_token;
 const created=await req('/api/v1/events',{session,body:eventBody()}),id=created.data.event_id;
 await pool.query("UPDATE community_events SET state='published' WHERE event_id=$1",[id]);
 for(const mode of ['read-expiry','write-expiry','revoke'] as const){
  const gate=await admin.connect();let pending:Promise<Awaited<ReturnType<typeof req>>>|undefined;
  try{
   await pool.query("UPDATE member_client_connections SET expires_at=clock_timestamp()+interval '2 seconds',revoked_at=NULL WHERE connection_id=$1",[issued.connection_id]);
   await gate.query('BEGIN');
   if(mode==='revoke')await gate.query(`UPDATE ${schema}.member_client_connections SET revoked_at=clock_timestamp() WHERE connection_id=$1`,[issued.connection_id]);
   else await gate.query(`LOCK TABLE ${schema}.community_events IN ACCESS EXCLUSIVE MODE`);
   const pid=(await gate.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
   pending=mode==='write-expiry'?req(`/api/v1/events/${id}/rsvp`,{token,body:{going:true}}):req('/api/v1/events',{token});
   const deadline=Date.now()+1500;
   while(!(await admin.query('SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',[pid])).rowCount){assert.ok(Date.now()<deadline,'request reached the database lock');await setImmediate();}
   if(mode!=='revoke')await admin.query(`SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM expires_at-clock_timestamp()))+0.05) FROM ${schema}.member_client_connections WHERE connection_id=$1`,[issued.connection_id]);
   await gate.query(mode==='revoke'?'COMMIT':'ROLLBACK');
   const response=await pending;assert.equal(response.status,401);assert.equal(response.data.code,'agent_token_invalid');assert.equal(response.data.items,undefined);
   assert.equal((await pool.query('SELECT 1 FROM community_event_rsvps WHERE event_id=$1',[id])).rowCount,0);
  }finally{await gate.query('ROLLBACK');gate.release();if(pending)await pending;}
 }
});

async function shareMember(index=0){
 const session=await ready(index);
 await pool.query('UPDATE users SET email=$2 WHERE user_id=$1',[session.user.user_id,`agent-share-${index}@example.com`]);
 return session;
}
async function confirmShare(session:Session,connectionId:string){
 const list=await req('/api/v1/me/agent-tokens',{session});
 const pending=list.data.items.find((i:any)=>i.connection_id===connectionId).pending_publication;
 assert.ok(pending);
 assert.equal((await req(`/api/v1/me/agent-tokens/${connectionId}/confirm`,{session,body:{request_sha256:pending.request_sha256}})).status,200);
}
test('shares: read/share scopes stay separate, report/claim/star and unknown routes deny, mixed credentials reject',async()=>{
 const session=await shareMember(),read=await issue(session,['read']),write=await issue(session,['share']);
 const body={url:'https://example.com/scope'};
 assert.equal((await req('/api/v1/shares/preview',{token:read.access_token,body})).status,403);
 assert.equal((await req('/api/v1/shares',{token:read.access_token,body})).status,403);
 assert.equal((await req('/api/v1/shares/preview',{token:write.access_token,body})).status,200);
 assert.equal((await req('/api/v1/shares',{token:write.access_token})).status,403);
 assert.equal((await req('/api/v1/me/credit',{token:write.access_token})).status,403);
 assert.equal((await req('/api/v1/shares',{token:read.access_token})).status,200);
 assert.equal((await req('/api/v1/me/credit',{token:read.access_token})).status,200);
 const full=await issue(session),id=randomUUID();
 for(const suffix of ['report','claim','star','delete','anything'])assert.equal((await req(`/api/v1/shares/${id}/${suffix}`,{token:full.access_token,body:{reason:'synthetic'}})).status,403,suffix);
 assert.equal((await req(`/s/${id}`,{token:full.access_token})).status,403);
 for(const path of ['/api/v1/shares','/api/v1/me/credit'])assert.equal((await req(path,{token:full.access_token,session})).status,400);
 assert.equal((await req('/api/v1/shares',{token:full.access_token,session,body})).status,400);
});
test('shares: A token cannot list, read, retract or link B shares, including receipt replay after visibility changes',async()=>{
 const a=await shareMember(),b=await shareMember(1),issued=await issue(a),token=issued.access_token;
 const own=await req('/api/v1/shares',{session:a,body:{url:'https://example.com/a',text:'private editor note'}});
 const other=await req('/api/v1/shares',{session:b,body:{url:'https://example.com/b',text:'B private editor note'}});
 assert.equal(own.status,200);assert.equal(other.status,200);
 const id=own.data.share_id,foreign=other.data.share_id;
 const listed=await req('/api/v1/shares',{token});assert.equal(listed.status,200);assert.deepEqual(listed.data.items.map((i:any)=>i.share_id),[id]);
 const detail=await req(`/api/v1/shares/${id}`,{token});assert.equal(detail.status,200);assert.ok(!JSON.stringify(detail.data).includes('private editor note'));assert.equal(detail.data.editor_notes,undefined);
 for(const suffix of ['','/retract','/links'])assert.equal((await req(`/api/v1/shares/${foreign}${suffix}`,{token,...(suffix?{body:{}}:{})})).status,404,suffix);
 assert.equal((await req('/api/v1/shares?user_id='+b.user.user_id,{token})).status,422);
 const credit=await req('/api/v1/me/credit',{token});assert.equal(credit.status,200);assert.ok(credit.data.items.length);assert.ok(credit.data.items.every((i:any)=>i.share_id===id));
 const key=randomUUID();assert.equal((await req(`/api/v1/shares/${id}/links`,{token,body:{},key})).status,200);
 await assert.rejects(pool.query('UPDATE shares SET first_sharer_user_id=$2 WHERE share_id=$1',[id,b.user.user_id]),/identity is immutable/);
 assert.equal((await req(`/api/v1/shares/${id}/retract`,{session:a,body:{}})).status,200);
 assert.equal((await req(`/api/v1/shares/${id}/links`,{token,body:{},key})).status,404,'cached link is not replayed after retraction');
 assert.equal((await pool.query("SELECT state FROM shares WHERE share_id=$1",[foreign])).rows[0].state,'published');
 assert.equal((await pool.query('SELECT count(*)::int n FROM promotion_links WHERE target_key=$1',[foreign])).rows[0].n,0);
});
test('shares: first publication waits for exact browser consent, offline replay is per token, and concurrent daily cap holds at twenty',async()=>{
 const session=await shareMember(),issued=await issue(session),token=issued.access_token,path='/api/v1/shares',body={url:'https://example.com/first'},key=randomUUID();
 assert.equal((await req(path,{token,body,key})).status,202);
 assert.equal((await pool.query('SELECT count(*)::int n FROM shares')).rows[0].n,0);
 await confirmShare(session,issued.connection_id);
 const created=await req(path,{token,body,key});assert.equal(created.status,200,JSON.stringify(created.data));assert.equal(created.data.via_agent,true);
 const fetches=shareFetchCalls;shareFetchOffline=true;
 assert.deepEqual((await req(path,{token,body,key})).data,created.data);assert.equal(shareFetchCalls,fetches,'replay does not read upstream');shareFetchOffline=false;
 assert.equal((await req(path,{token,body:{url:'https://example.com/changed'},key})).status,409);
 for(let i=1;i<19;i++)assert.equal((await req(path,{token,body:{url:`https://example.com/item/${i}`}})).status,200);
 const final=await Promise.all([19,20].map(i=>req(path,{token,body:{url:`https://example.com/item/${i}`}})));
 assert.deepEqual(final.map(r=>r.status).sort(),[200,429]);assert.equal(final.find(r=>r.status===429)!.data.code,'agent_daily_cap');
 assert.equal((await pool.query('SELECT public_items FROM agent_daily_usage WHERE connection_id=$1',[issued.connection_id])).rows[0].public_items,20);
 assert.equal((await pool.query('SELECT count(*)::int n FROM agent_publications WHERE connection_id=$1',[issued.connection_id])).rows[0].n,20);
 assert.equal((await pool.query('SELECT count(*)::int n FROM shares WHERE first_sharer_user_id=$1',[session.user.user_id])).rows[0].n,20);
 shareFetchOffline=true;assert.deepEqual((await req(path,{token,body,key})).data,created.data);
 const second=await issue(session);assert.equal((await req(path,{token:second.access_token,body,key})).status,202,'a different token cannot replay a confirmed publication');
 const retractKey=randomUUID(),retract=`${path}/${created.data.share_id}/retract`;
 assert.equal((await req(retract,{token,body:{},key:retractKey})).status,200);
 assert.equal((await req(retract,{token,body:{},key:retractKey})).status,200);
 assert.equal((await req(`${path}/${created.data.share_id}`,{token})).status,404);
});

test('shares: source privacy and receipt authority remain current; browser receipts never become agent receipts',async()=>{
 const session=await shareMember(),issued=await issue(session),token=issued.access_token,path='/api/v1/shares',body={url:'https://example.com/namespace'},key=randomUUID();
 const browser=await req(path,{session,body,key});assert.equal(browser.status,200);
 assert.equal((await req(path,{token,body,key})).status,202);await confirmShare(session,issued.connection_id);
 const agent=await req(path,{token,body,key});assert.equal(agent.status,200);assert.equal(agent.data.created,false);assert.equal(agent.data.via_agent,true);
 assert.equal((await pool.query('SELECT count(*)::int n FROM command_receipts WHERE user_id=$1 AND idempotency_key=$2',[session.user.user_id,key])).rows[0].n,2);
 const foreign=await shareMember(1),foreignShare=await req(path,{session:foreign,body:{url:'https://example.com/foreign'}});
 assert.equal(foreignShare.status,200);
 assert.equal((await req(path,{token,body:{url:'https://example.com/foreign'}})).status,404,'cannot co-share B canonical object through the token');
 const eventId=randomUUID();
 await pool.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,state,visibility,event_kind)
 SELECT $1,community_id,user_id,'private source fixture','synthetic',now()+interval '1 day',now()+interval '25 hours','online','online','published','open','other' FROM users WHERE user_id=$2`,[eventId,session.user.user_id]);
 const eventBody={kind:'event',ref_id:eventId},eventKey=randomUUID();
 const shared=await req(path,{token,body:eventBody,key:eventKey});assert.equal(shared.status,200,JSON.stringify(shared.data));
 await pool.query("UPDATE community_events SET state='cancelled' WHERE event_id=$1",[eventId]);
 assert.equal((await req(`${path}/${shared.data.share_id}`,{token})).status,404);
 assert.equal((await req(path,{token,body:eventBody,key:eventKey})).status,404,'publication receipt does not reveal withdrawn source');
 const credit=await req('/api/v1/me/credit',{token});assert.equal(credit.status,200);assert.ok(!JSON.stringify(credit.data).includes('private source fixture'));
});

test('shares: committed credit reaches only its member feed once; replay, reversal and rolled-back facts emit nothing new',async()=>{
 const a=await shareMember(),b=await shareMember(1),issued=await issue(a),other=await issue(b),token=issued.access_token;
 const body={url:'https://example.com/credited'},key=randomUUID();
 const share=await req('/api/v1/shares',{session:a,body,key});assert.equal(share.status,200);
 const id=share.data.share_id;
 const credit=(await pool.query('SELECT event_id,source_ref FROM share_credit_events WHERE share_id=$1 AND units=1',[id])).rows[0];
 const recorded=(await pool.query("SELECT source_key FROM agent_change_events WHERE resource_id=$1 AND kind='share.credited'",[id])).rows;
 assert.deepEqual(recorded,[{source_key:credit.event_id}]);
 assert.deepEqual((await req('/api/v1/shares',{session:a,body,key})).data,share.data);
 const first=await req('/api/v1/agent/events',{token});assert.equal(first.status,200);
 assert.equal(first.data.items.filter((i:any)=>i.kind==='share.credited'&&i.resource_id===id).length,1);
 assert.equal((await req('/api/v1/agent/events',{token:other.access_token})).data.items.filter((i:any)=>i.resource_id===id).length,0);
 const {transaction}=await import('../../packages/db/index.js');
 const {appendCredit}=await import('../../modules/shares/credit.js');
 const community=(await pool.query('SELECT community_id FROM users WHERE user_id=$1',[a.user.user_id])).rows[0].community_id;
 await assert.rejects(transaction(pool,async q=>{
  assert.ok(await appendCredit(q,{share_id:id,community_id:community,user_id:a.user.user_id,role:'sharer',basis:'star_confirmed',source_ref:randomUUID(),actor_user_id:b.user.user_id}));
  throw Error('synthetic rollback');
 }),/synthetic rollback/);
 assert.equal((await req(`/api/v1/shares/${id}/retract`,{session:a,body:{}})).status,200);
 assert.equal((await pool.query('SELECT sum(units)::int n FROM share_credit_events WHERE share_id=$1',[id])).rows[0].n,0);
 const next=await req('/api/v1/agent/events?after='+encodeURIComponent(first.data.next_cursor),{token});assert.equal(next.status,200);assert.deepEqual(next.data.items,[]);
 assert.equal((await pool.query("SELECT count(*)::int n FROM agent_change_events WHERE resource_id=$1 AND kind='share.credited'",[id])).rows[0].n,1);
});
