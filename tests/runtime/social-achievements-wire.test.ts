import test from 'node:test';
import assert from 'node:assert/strict';
import type {Pool} from 'pg';
import type {PlatformRuntime} from '../../apps/platform-api/src/runtime.js';
import {createPlatformApp} from '../../apps/platform-api/src/platform-app.js';
import {AchievementState} from '../../apps/portal-web/src/modules/social-achievements-state.js';
import {SOCIAL_POLICY} from '../../modules/social-achievements/policy.js';

const origin='https://example.invalid',path='/api/v1/me/social-achievements';
const actor={user_id:'10000000-0000-4000-8000-000000000001',community_id:'20000000-0000-4000-8000-000000000001',session_hash:'synthetic',csrf_token:'synthetic',onboarding_required:false,onboarding_completed_at:null};
const validRow=()=>({counting_enabled:true,show_title:false,selected_title:null,status:'active',moderation_reason:null as string|null,appeal_state:'none',aggregate_version:'1'});
type Row=ReturnType<typeof validRow>;
const fixture=(row:Row|null=validRow())=>({row,receipts:new Map<string,any>(),writes:0});
type Fixture=ReturnType<typeof fixture>;
type Options={method?:string;body?:unknown;expected?:string;key?:string;route?:string;enabled?:boolean;fail?:string};
async function request(state:Fixture,o:Options={}){
 const queries:string[]=[];let releases=0;
 const result=(rows:any[])=>({rows,rowCount:rows.length});
 const query=async(sql:string,params:any[]=[])=>{
  const s=sql.replace(/\s+/g,' ').trim();queries.push(s);
  if(['BEGIN','COMMIT','ROLLBACK'].includes(s)||s.startsWith('SELECT pg_advisory_xact_lock'))return result([]);
  if(s.startsWith('UPDATE sessions'))return result([]);
  if(s.startsWith('SELECT u.user_id,u.community_id,u.email'))return result([{...actor}]);
  if(s.startsWith('SELECT user_id FROM users'))return result([{user_id:actor.user_id}]);
  if(s.startsWith('SELECT token_hash FROM sessions'))return result(o.fail==='session-clock'&&s.includes('clock_timestamp()')?[]:[{token_hash:'synthetic'}]);
  if(s.includes('AS ready FROM users'))return result([{ready:true}]);
  if(s.startsWith('SELECT 1 FROM users u'))return result(s.includes('platform_admins')?[]:[{}]);
  if(s.startsWith('SELECT * FROM command_receipts'))return result(state.receipts.has(params[2])?[state.receipts.get(params[2])]:[]);
  if(s.startsWith('INSERT INTO command_receipts')){state.receipts.set(params[2],{request_sha256:params[3],response:JSON.parse(params[4])});return result([]);}
  if(s.startsWith('INSERT INTO transition_journal'))return result([]);
  if(s.startsWith('SELECT counting_enabled,show_title,selected_title')||s.startsWith('SELECT aggregate_version'))return result(state.row?[state.row]:[]);
  if(s.startsWith('SELECT track,count(*)')||s.startsWith('SELECT title_id FROM social_achievement_awards'))return result([]);
  if(s.startsWith('INSERT INTO social_achievement_settings')){
   const version=String(BigInt(state.row?.aggregate_version??'0')+1n);
   state.row={...(state.row??validRow()),counting_enabled:params[2],show_title:params[3],selected_title:params[4],aggregate_version:version};state.writes++;return result([{aggregate_version:version}]);
  }
  if(s==='DELETE FROM social_achievement_awards WHERE user_id=$1'||s==='DELETE FROM social_achievement_days WHERE user_id=$1')return result([]);
  if(s.startsWith('UPDATE social_achievement_settings SET counting_enabled=false')){assert.ok(state.row);state.row={...state.row,counting_enabled:false,show_title:false,selected_title:null,aggregate_version:String(BigInt(state.row.aggregate_version)+1n)};state.writes++;return result([]);}
  if(s.startsWith('UPDATE social_achievement_settings SET appeal=$2')){assert.ok(state.row);state.row={...state.row,appeal_state:'pending',aggregate_version:String(BigInt(state.row.aggregate_version)+1n)};state.writes++;return result([{aggregate_version:state.row.aggregate_version}]);}
  throw Error(`Unexpected synthetic query: ${s}`);
 };
 // Synthetic SQL responses only: no Pool, socket, PostgreSQL execution or persistence proof.
 // Unknown queries throw rather than silently authorizing new service behavior.
 const pool={query,connect:async()=>({query,release(){releases++;}})};
 const runtime:PlatformRuntime={socialAchievementsEnabled:o.enabled??true,maintainerWebhookSecret:()=>undefined,adminVerifier:async()=>{throw Error('no admin fixture');},sourceNetwork:()=> 'synthetic',allowedHosts:new Set(['example.invalid']),publicOrigin:origin,registrationCommunityId:()=>undefined,githubTokenKey:()=>undefined,githubMetricsToken:()=>undefined};
 const app=createPlatformApp(pool as unknown as Pool,origin,'staging',runtime);
 const response=await app.request(origin+(o.route??path),{method:o.method??'GET',headers:{Cookie:`__Host-freedom_session=${'x'.repeat(43)}`,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':'synthetic','Idempotency-Key':o.key??'synthetic-key',...(o.expected?{'If-Match':o.expected}:{})},...(o.body?{body:JSON.stringify(o.body)}:{})});
 return {status:response.status,body:await response.json(),headers:response.headers,queries,releases};
}
const settings={policy_version:SOCIAL_POLICY,counting_enabled:true,show_title:false,selected_title:null};

test('actual composed GET decodes absent and persisted settings into client string versions',async()=>{
 for(const version of [null,'1','2','9007199254740991']){
  const r=await request(fixture(version===null?null:{...validRow(),aggregate_version:version}));
  assert.equal(r.status,200);assert.equal(r.body.aggregate_version,version===null?null:Number(version));
  assert.equal(AchievementState.parse(r.body).aggregate_version,version);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('vary'),'Cookie');assert.equal(r.releases,1);
 }
});
test('actual composed POST creates, updates, replays current state, erases and appeals with decodable numeric versions',async()=>{
 const state=fixture(null);
 const first=await request(state,{method:'POST',body:settings});assert.equal(first.status,200);assert.equal(AchievementState.parse(first.body).aggregate_version,'1');assert.equal(state.writes,1);
 const update=await request(state,{method:'POST',body:{...settings,counting_enabled:false},expected:'"1"',key:'synthetic-update'});assert.equal(update.status,200);assert.equal(AchievementState.parse(update.body).aggregate_version,'2');assert.equal(state.writes,2);
 const replay=await request(state,{method:'POST',body:settings});assert.equal(replay.status,200);assert.equal(AchievementState.parse(replay.body).aggregate_version,'2');assert.equal(replay.body.counting_enabled,false);assert.equal(state.writes,2);
 const stale=await request(state,{method:'POST',body:settings,expected:'"1"',key:'synthetic-stale'});assert.equal(stale.status,412);assert.equal(stale.body.code,'version_conflict');
 const missing=await request(state,{method:'POST',body:settings,key:'synthetic-missing'});assert.equal(missing.status,428);assert.equal(state.writes,2);
 const erased=await request(state,{method:'POST',route:path+'/erase',body:{confirm:true},expected:'"2"',key:'synthetic-erase'});assert.equal(erased.status,200);assert.equal(AchievementState.parse(erased.body).aggregate_version,'3');assert.equal(erased.body.counting_enabled,false);
 assert.ok(state.row);state.row={...state.row,status:'paused',moderation_reason:'Synthetic restriction'};
 const appeal=await request(state,{method:'POST',route:path+'/appeal',body:{reason:'Please review'},expected:'"3"',key:'synthetic-appeal'});assert.equal(appeal.status,200);assert.equal(AchievementState.parse(appeal.body).aggregate_version,'4');assert.equal(appeal.body.appeal_state,'pending');assert.equal(state.writes,4);
});
test('decoder preserves legacy strings/null and rejects unsafe, nonintegral and nonpositive numbers',async()=>{
 const {body}=await request(fixture(null));
 for(const version of [null,'1','9007199254740993','9223372036854775807',1,2,Number.MAX_SAFE_INTEGER])assert.equal(AchievementState.parse({...body,aggregate_version:version}).aggregate_version,version===null?null:String(version));
 for(const version of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1,NaN,Infinity,-Infinity,true,{},[],undefined,'','0','01','-1','1.5','1e3',' 1 '])assert.equal(AchievementState.safeParse({...body,aggregate_version:version}).success,false,String(version));
});
test('real wire serializer rejects overflow before client parsing; feature-off and expired reads stay closed',async()=>{
 const overflow=await request(fixture({...validRow(),aggregate_version:'9007199254740993'}));assert.equal(overflow.status,500);assert.equal(overflow.body.code,'version_overflow');
 const off=await request(fixture(),{enabled:false});assert.equal(off.status,404);assert.equal(off.queries.some(s=>s.includes('social_achievement')),false);
 const expired=await request(fixture(),{fail:'session-clock'});assert.equal(expired.status,401);assert.equal(expired.body.code,'session_expired');assert.ok(expired.queries.includes('ROLLBACK'));
});

test('PortalClient uses decoded string as quoted If-Match and accepts the actual numeric response',async(t)=>{
 const {PortalClient}=await import('../../apps/portal-web/src/api.js');
 const state=fixture(),sent:Array<{method:string;version:string|null;key:string|null}>=[];
 t.mock.method(globalThis,'fetch',async(url:RequestInfo|URL,init?:RequestInit)=>{
  const headers=new Headers(init?.headers),method=init?.method??'GET';
  sent.push({method,version:headers.get('If-Match'),key:headers.get('Idempotency-Key')});
  const r=await request(state,{method,route:new URL(String(url),origin).pathname,body:init?.body?JSON.parse(String(init.body)):undefined,expected:headers.get('If-Match')??undefined,key:headers.get('Idempotency-Key')??undefined});
  return new Response(JSON.stringify(r.body),{status:r.status,headers:r.headers});
 });
 const client=new PortalClient();client.csrfToken='synthetic';
 const before=AchievementState.parse(await client.get('/me/social-achievements'));
 assert.equal(before.aggregate_version,'1');
 const after=AchievementState.parse(await client.post('/me/social-achievements',settings,{ifMatch:before.aggregate_version!,idempotencyKey:'synthetic-client-update'}));
 assert.equal(after.aggregate_version,'2');assert.equal(state.writes,1);
 assert.deepEqual(sent,[{method:'GET',version:null,key:null},{method:'POST',version:'"1"',key:'synthetic-client-update'}]);
});

test('extracted client schema still rejects malformed policy, state, progress and titles',async()=>{
 const {body}=await request(fixture());
 for(const change of [
  {policy_version:'other'}, {counting_enabled:'true'}, {show_title:1}, {selected_title:'chat_2'},
  {status:'unknown'}, {moderation_reason:1}, {appeal_state:'unknown'}, {can_moderate:'false'},
  {chat:{days:-1,next_days:1,remaining:1}}, {chat:{days:0.5,next_days:1,remaining:1}},
  {participation:{days:0,next_days:0,remaining:1}}, {participation:{days:0,next_days:1,remaining:-1}},
  {titles:[]}, {titles:[{...body.titles[0],title_id:'chat_2'}]},
  {titles:[{...body.titles[0],days:0}]}, {titles:[{...body.titles[0],track:'other'}]},
  {titles:[{...body.titles[0],unlocked:'true'}]},
 ])assert.equal(AchievementState.safeParse({...body,...change}).success,false,JSON.stringify(change));
});
