import test from 'node:test';
import type {Pool} from 'pg';
import type {PlatformRuntime} from '../../apps/platform-api/src/runtime.js';
import assert from 'node:assert/strict';
import {createPlatformApp} from '../../apps/platform-api/src/platform-app.js';
import {decodeProfileSettings} from '../../apps/portal-web/src/modules/profile-publication-controller.js';
import {ProfilePublicationInput,defaultProfileLayout,ProfilePublicationSettingsSchema,MemberVisitorProfile} from '../../packages/shared/member-profile.js';
const origin='https://example.invalid',path='/api/v1/me/profile-publication';
const token='x'.repeat(43),cookie=`__Host-freedom_session=${token}`;
const actor={user_id:'10000000-0000-4000-8000-000000000001',community_id:'20000000-0000-4000-8000-000000000001',session_hash:'synthetic',csrf_token:'synthetic',onboarding_required:false,onboarding_completed_at:null};
const validRow=()=>({visibility:'private',display_name:'測試',bio:'',links:[],layout:structuredClone(defaultProfileLayout),cover:null,include_cover:false,cover_version:null,aggregate_version:'1'});
type Options={row?:unknown;fail?:string;onboarding?:boolean;cookie?:string;host?:string;method?:string;body?:unknown;expected?:string;route?:string;state?:{row:any;receipts:Map<string,any>;writes:number};key?:string};
async function request(o:Options={}){
 const queries:string[]=[];let released=false;
 const result=(rows:any[])=>({rows,rowCount:rows.length});
 const query=async(sql:string,params:any[]=[])=>{
  const s=sql.replace(/\s+/g,' ').trim();queries.push(s);
  if(o.fail==='schema'&&s.includes('FROM member_profile_publications p'))throw Object.assign(new Error('synthetic missing column'),{code:'42703'});
  if(['BEGIN','COMMIT','ROLLBACK'].includes(s)||s.startsWith('SELECT pg_advisory_xact_lock'))return result([]);
  if(s.startsWith('SELECT 1 FROM users u'))return result([{}]);
  if(s.startsWith('SELECT * FROM command_receipts'))return result(o.state?.receipts.has(params[2])?[o.state.receipts.get(params[2])]:[]);
  if(s.startsWith('SELECT aggregate_version FROM member_profile_publications'))return result(o.state?.row?[{aggregate_version:o.state.row.aggregate_version}]:[]);
  if(s.startsWith('INSERT INTO member_profile_publications')){assert.ok(o.state);o.state.writes++;const version=String(BigInt(o.state.row?.aggregate_version??'0')+1n);o.state.row={...validRow(),visibility:params[2],display_name:params[3],bio:params[4],links:JSON.parse(params[5]),layout:JSON.parse(params[6]),include_cover:params[7],cover_version:params[8],aggregate_version:version};return result([{aggregate_version:version}]);}
  if(s.startsWith('INSERT INTO transition_journal'))return result([]);
  if(s.startsWith('INSERT INTO command_receipts')){assert.ok(o.state);o.state.receipts.set(params[2],{request_sha256:params[3],response:JSON.parse(params[4])});return result([]);}
  if(s.startsWith('UPDATE sessions'))return result([]);
  if(s.startsWith('SELECT u.user_id,u.community_id,u.email'))return result(o.fail==='authenticate'?[]:[{...actor,onboarding_required:o.onboarding??false}]);
  if(s.startsWith('SELECT user_id FROM users'))return result(o.fail==='user-lock'?[]:[{user_id:actor.user_id}]);
  if(s.startsWith('SELECT token_hash FROM sessions'))return result((o.fail==='session-lock'&&s.includes('FOR SHARE'))||(o.fail==='session-clock'&&s.includes('clock_timestamp()'))?[]:[{token_hash:'synthetic'}]);
  if(s.includes('AS ready FROM users'))return result([{ready:o.fail!=='eligibility'}]);
  if(s.includes('FROM member_profile_publications p'))return result(o.row===null?[]:[o.state?.row??o.row??validRow()]);
  console.error('UNEXPECTED MOCK QUERY',s);throw Error(`Unexpected mock query: ${s}`);
 };
 // No real Pool or socket is created. Unknown queries fail closed.
 const pool={query,connect:async()=>{if(o.fail==='connect')throw Error('synthetic pool unavailable');return {query,release(){released=true;}};}};
 const runtime:PlatformRuntime={maintainerWebhookSecret:()=>undefined,adminVerifier:async()=>{throw Error('admin access not installed in fixture');},sourceNetwork:()=> 'synthetic',allowedHosts:new Set(['example.invalid']),publicOrigin:origin,registrationCommunityId:()=>undefined,githubTokenKey:()=>undefined,githubMetricsToken:()=>undefined};
 const app=createPlatformApp(pool as unknown as Pool,origin,'staging',runtime);
 const res=await app.request(`${o.host??origin}${o.route??path}`,{method:o.method??'GET',headers:{Cookie:o.cookie??cookie,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':'synthetic','Idempotency-Key':o.key??'synthetic-key',...(o.expected?{'If-Match':o.expected}:{})},...(o.body?{body:JSON.stringify(o.body)}:{})});
 return {status:res.status,body:await res.json(),headers:res.headers,queries,released};
}
test('actual composed GET: no publication is valid empty settings',async()=>{
 const r=await request({row:null});assert.equal(r.status,200);assert.equal(decodeProfileSettings(r.body).aggregate_version,null);assert.equal(r.released,true);assert.ok(r.queries.includes('COMMIT'));assert.equal(r.headers.get('Cache-Control'),'private, no-store');
});
test('saved valid profiles decode canonical numeric wire versions to internal strings',async()=>{
 for(const visibility of ['private','members','public'])for(const name of ['一般會員','😀'.repeat(30),' A '])for(const version of ['1','2','9007199254740991']){
  const {aggregate_version,cover,...body}=validRow();const input=ProfilePublicationInput.parse({...body,visibility,display_name:name,confirm_public:true});
  const r=await request({row:{...input,aggregate_version:version,cover:null}});assert.equal(r.status,200);assert.equal(r.body.aggregate_version,Number(version));assert.equal(r.body.display_name,input.display_name);assert.equal(decodeProfileSettings(r.body).aggregate_version,version);
 }
});
for(const [label,options,status,code] of [
 ['missing cookie',{cookie:''},401,'login_required'],['wrong deployment cookie',{cookie:`freedom_local_session=${token}`},401,'login_required'],['duplicate cookie',{cookie:`${cookie}; ${cookie}`},403,'credential_kind_rejected'],['session missing',{fail:'authenticate'},401,'session_expired'],['onboarding incomplete',{onboarding:true},403,'onboarding_required'],['inactive user lock',{fail:'user-lock'},401,'session_expired'],['revoked session lock',{fail:'session-lock'},401,'session_expired'],['expired after read',{fail:'session-clock'},401,'session_expired'],['eligibility changed',{fail:'eligibility'},403,'onboarding_required'],['missing SQL column',{fail:'schema'},500,'internal_error'],['pool unavailable',{fail:'connect'},500,'internal_error'],['wrong host',{host:'https://other.invalid'},403,'host_rejected'],
] as const)test(`actual composed GET: ${label}`,async()=>{const r=await request(options);assert.equal(r.status,status);assert.equal(r.body.code,code);if(r.queries.includes('BEGIN')){assert.ok(r.queries.includes('ROLLBACK'));assert.equal(r.released,true);assert.ok(!r.queries.includes('COMMIT'));}});
test('read-side server validation rejects DB-shape-only values with HTTP 422, before client decoding',async()=>{
 for(const change of [{display_name:' '},{links:[{}]},{bio:'line\nbreak'}]){
  const r=await request({row:{...validRow(),...change}});assert.equal(r.status,422,JSON.stringify({change,result:r.body}));assert.equal(r.body.code,'validation_failed');assert.ok(r.queries.includes('ROLLBACK'));
 }
});
test('selected cover availability preserves cover strings and decoded aggregate version',async()=>{
 for(const cover of [null,{version:'2',generation:'2'}]){const r=await request({row:{...validRow(),include_cover:true,cover_version:'2',aggregate_version:'2',cover}});assert.equal(r.status,200);assert.equal(r.body.cover_version,'2');assert.equal(r.body.aggregate_version,2);assert.equal(decodeProfileSettings(r.body).aggregate_version,'2');}
});

test('unsafe bigint is intentionally rejected at wire serializer, not frontend',async()=>{for(const version of ['9007199254740993','9223372036854775807']){const r=await request({row:{...validRow(),aggregate_version:version}});assert.equal(r.status,500);assert.equal(r.body.code,'version_overflow');}});

const settingsDto=()=>({...validRow(),avatar_url:null});
const visitorDto=(version:unknown)=>({profile:{display_name:'Visitor',bio:'',links:[],avatar_url:null,layout:structuredClone(defaultProfileLayout),cover:null},actions:{is_self:false,friendship:{state:'accepted',requester_ref:actor.user_id,aggregate_version:version},can_request:false,can_accept:false,can_message:true}});
test('both profile decoders reject unsafe/nonpositive/nonintegral numeric versions and preserve bounded strings',()=>{
 for(const version of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1,NaN,Infinity,-Infinity,true,{},[],undefined,'1e3','1.0',' 1 ','', '0','01','-1','1.5','9223372036854775808']){
  assert.equal(ProfilePublicationSettingsSchema.safeParse({...settingsDto(),aggregate_version:version}).success,false,String(version));
  assert.equal(MemberVisitorProfile.safeParse(visitorDto(version)).success,false,String(version));
 }
 for(const version of [null,1,Number.MAX_SAFE_INTEGER,'1','9223372036854775807']){
  assert.equal(ProfilePublicationSettingsSchema.parse({...settingsDto(),aggregate_version:version}).aggregate_version,version===null?null:String(version));
  assert.equal(MemberVisitorProfile.parse(visitorDto(version)).actions.friendship.aggregate_version,version===null?null:String(version));
 }
 assert.equal(ProfilePublicationSettingsSchema.safeParse({...settingsDto(),cover_version:2}).success,false);
 for(const cover of [{version:2,generation:'1'},{version:'2',generation:1}])assert.equal(ProfilePublicationSettingsSchema.safeParse({...settingsDto(),cover}).success,false);
});
test('actual member visitor route decodes a normal persisted friendship version',async()=>{
 for(const state of ['none','pending','accepted','removed']){const version=state==='none'?null:'4';const r=await request({route:`/api/v1/members/${actor.user_id}/profile`,row:{...validRow(),is_self:false,friendship_state:state,requester_ref:state==='none'?null:actor.user_id,friendship_version:version}});
 assert.equal(r.status,200);assert.equal(r.body.actions.friendship.aggregate_version,version===null?null:4);assert.equal(MemberVisitorProfile.parse(r.body).actions.friendship.aggregate_version,version);}
});
test('actual POST, replay and If-Match retain command semantics and decode current numeric versions',async()=>{
 const state={row:validRow(),receipts:new Map(),writes:0};const {aggregate_version,cover,...body}=validRow();
 const input={...body,display_name:'Changed',confirm_public:false};
 const first=await request({method:'POST',body:input,expected:'"1"',state});assert.equal(first.status,200);assert.equal(decodeProfileSettings(first.body).aggregate_version,'2');assert.equal(state.writes,1);
 assert.equal(first.headers.get('etag'),null);assert.equal(first.headers.get('cache-control'),'private, no-store');assert.equal(first.headers.get('vary'),'Cookie');assert.equal(first.headers.get('x-robots-tag'),'noindex, nofollow');
 state.row={...state.row,display_name:'Later current value',aggregate_version:'3'};
 const replay=await request({method:'POST',body:input,expected:'"1"',state});assert.equal(replay.status,200);assert.equal(decodeProfileSettings(replay.body).aggregate_version,'3');assert.equal(replay.body.display_name,'Later current value');assert.equal(state.writes,1);
 const stale=await request({method:'POST',body:input,expected:'"1"',state,key:'new-command-key'});assert.equal(stale.status,412);assert.equal(stale.body.code,'version_conflict');assert.equal(state.writes,1);
 const missing=await request({method:'POST',body:input,state,key:'missing-version-key'});assert.equal(missing.status,428);assert.equal(state.writes,1);
});

test('PortalClient reads and command mutation decode actual app responses without unknown-write misclassification',async(t)=>{
 const {PortalClient}=await import('../../apps/portal-web/src/api.js');
 const {readProfileSettings}=await import('../../apps/portal-web/src/modules/profile-publication-controller.js');
 const {setSharingDraftAccount,sharingMutationState}=await import('../../apps/portal-web/src/modules/authoring-drafts.js');
 const {performModuleMutation}=await import('../../apps/portal-web/src/modules/shared.js');
 const state={row:validRow(),receipts:new Map(),writes:0};
 t.mock.method(globalThis,'fetch',async(url:RequestInfo|URL,init?:RequestInit)=>{
  const headers=new Headers(init?.headers);
  const r=await request({state,method:init?.method??'GET',route:new URL(String(url),origin).pathname,body:init?.body?JSON.parse(String(init.body)):undefined,expected:headers.get('If-Match')??undefined,key:headers.get('Idempotency-Key')??undefined});
  return new Response(JSON.stringify(r.body),{status:r.status,headers:r.headers});
 });
 const client=new PortalClient();client.csrfToken='synthetic';
 assert.equal((await readProfileSettings(client,new AbortController().signal)).aggregate_version,'1');
 setSharingDraftAccount(actor.user_id,900);const mutation=sharingMutationState({userId:actor.user_id,type:'profile-publication-settings'});
 const {aggregate_version,cover,...body}=validRow();
 const saved=await performModuleMutation(client,mutation,'/me/profile-publication',{...body,display_name:'Client update',confirm_public:false},'1',decodeProfileSettings);
 assert.equal(saved?.aggregate_version,'2');assert.equal(state.writes,1);assert.equal(mutation.snapshot.lastFailureUnknown,false);assert.equal(mutation.keys.size,0);
});

test('first publication POST without If-Match creates once and returns decodable settings',async()=>{const state={row:null as any,receipts:new Map(),writes:0};const {aggregate_version,cover,...body}=validRow();const r=await request({method:'POST',body:{...body,confirm_public:false},state});assert.equal(r.status,200);assert.equal(decodeProfileSettings(r.body).aggregate_version,'1');assert.equal(state.writes,1);});
