import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createPool} from '../../packages/db/index.js';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_USERS,DEMO_PASSWORD,DEMO_COMMUNITY} from '../../packages/testing/seed.js';
import {createApp} from '../../apps/platform-api/src/app.js';
import {EVENT_PRIZE_ICON_IDS} from '../../modules/community/event-prize-icons.js';
import type {EventPrizeDetail} from '../../modules/community/event-prize-details.js';

// Official runtime CI only: explicit isolated database and disposable schema.
// These are descriptive organizer promises, never awards or proof of completion.
const databaseUrl=process.env.TEST_DATABASE_URL;
const schema=`fp_event_prizes_${process.pid}_${Date.now()}`,origin='http://127.0.0.1:4310';
let admin:Pool,pool:Pool,app:ReturnType<typeof createApp>,createdSchema=false;
type Session={cookie:string;csrf:string};
type EventResult={event_id:string;aggregate_version:number;prize_details:EventPrizeDetail[];state:string;can_review?:boolean;code?:string;[key:string]:unknown};
let sessions:Session[];
before(async()=>{
  assert.ok(databaseUrl,'TEST_DATABASE_URL must explicitly name an isolated test database');
  admin=createPool(databaseUrl);pool=new Pool({connectionString:databaseUrl,options:`-c search_path=${schema}`,max:8});
  await admin.query(`CREATE SCHEMA ${schema}`);createdSchema=true;await migrate(pool);
  app=createApp(pool,origin,'local',{eventEmailSender:async()=>{}});
});
after(async()=>{if(pool)await pool.end();if(admin){try{if(createdSchema)await admin.query(`DROP SCHEMA ${schema} CASCADE`);}finally{await admin.end();}}});
beforeEach(async()=>{
  await pool.query('TRUNCATE communities,login_attempts,auth_rate_limits CASCADE');await seedLocal(pool);
  sessions=[];
  for(const user of DEMO_USERS){
    const response=await app.request(`${origin}/api/v1/auth/login`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:user.email,password:DEMO_PASSWORD})});
    assert.equal(response.status,200);
    const body=await response.json() as {csrf_token:string};
    sessions.push({cookie:response.headers.get('set-cookie')!.split(';')[0],csrf:body.csrf_token});
  }
});
function details(){return {title:'合成有獎活動',description:'隔離獎品說明測試',starts_at:'2099-01-01T12:00:00Z',ends_at:'2099-01-01T13:00:00Z',mode:'online',location:'合成教室',capacity:20,visibility:'open'};}
function prize(extra:Partial<EventPrizeDetail>={}):EventPrizeDetail{return {prize_id:randomUUID(),name:'紀念筆記本',description:'主辦者提供的合成獎品說明',quantity:2,icon_id:'gift',completion_rule:'完成活動中公告的分享任務，由主辦者確認。',claim_note:'請在活動結束後向主辦者詢問領取方式。',...extra};}
async function request<T=EventResult>(path:string,session:Session|undefined=sessions[0],body?:unknown,version?:number,key=randomUUID()){
  const headers:Record<string,string>={Origin:origin,...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{})};
  if(body!==undefined){headers['Content-Type']='application/json';headers['Idempotency-Key']=key;if(version!==undefined)headers['If-Match']=`"${version}"`;}
  const response=await app.request(`${origin}/api/v1${path}`,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,data:await response.json() as T};
}
async function create(prizes:EventPrizeDetail[]=[prize()]){
  const response=await request('/events',sessions[0],{...details(),prize_details:prizes});
  assert.equal(response.status,201,JSON.stringify(response.data));return response.data;
}
async function stored(id:string){return (await pool.query('SELECT to_jsonb(e) AS value FROM community_events e WHERE event_id=$1',[id])).rows[0].value;}
async function snapshot(){
  const tables=['community_events','community_event_bulletins','member_notifications','command_receipts','transition_journal','outbox','auth_rate_limits','community_event_rsvps','community_event_guest_rsvps'];
  const result:Record<string,unknown>={};
  for(const table of tables)result[table]=(await pool.query(`SELECT to_jsonb(t) AS value FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
  return result;
}
async function makeReviewer(){
  await pool.query("INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state) VALUES($1,$2,$3,'guild_member_operations','active') ON CONFLICT DO NOTHING",[randomUUID(),DEMO_COMMUNITY,DEMO_USERS[1].user_id]);
  await pool.query("INSERT INTO positioning_guild_officers(community_id,guild_key,user_id) VALUES($1,'guild_member_operations',$2) ON CONFLICT DO NOTHING",[DEMO_COMMUNITY,DEMO_USERS[1].user_id]);
}

test('prize details survive HTTP create, owner edit, member list/detail and anonymous public detail',async()=>{
  const input=prize({prize_id:'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',name:'  紀念筆記本  ',description:'  紙本說明  ',completion_rule:'  分享一次心得  ',claim_note:'  活動後向主辦者領取  '});
  const canonical={...input,prize_id:input.prize_id.toLowerCase(),name:'紀念筆記本',description:'紙本說明',completion_rule:'分享一次心得',claim_note:'活動後向主辦者領取'};
  const first=await create([input]);assert.deepEqual(first.prize_details,[canonical]);
  assert.deepEqual((await stored(first.event_id)).prize_details,[canonical]);
  assert.deepEqual((await request(`/events/${first.event_id}`)).data.prize_details,[canonical]);
  const changed={...canonical,name:'更新後的筆記本',quantity:3,icon_id:'book' as const};
  const edited=await request(`/events/${first.event_id}/update`,sessions[0],{...details(),prize_details:[changed]},first.aggregate_version);
  assert.equal(edited.status,200);assert.deepEqual(edited.data.prize_details,[changed]);
  await makeReviewer();
  const approved=await request(`/events/${first.event_id}/review`,sessions[1],{decision:'approve',reason:'合成資料完整'},edited.data.aggregate_version);
  assert.equal(approved.status,200);
  const member=await request(`/events/${first.event_id}`,sessions[2]);assert.equal(member.status,200);assert.deepEqual(member.data.prize_details,[changed]);
  const list=await request<{items:EventResult[]}>('/events',sessions[2]);assert.equal(list.status,200);
  assert.deepEqual(list.data.items.find(item=>item.event_id===first.event_id)?.prize_details,[changed]);
  const publicResponse=await app.request(`${origin}/api/v1/public/events/${first.event_id}`);assert.equal(publicResponse.status,200);
  const publicData=await publicResponse.json() as EventResult;assert.deepEqual(publicData.prize_details,[changed]);
  for(const key of ['organizer_ref','community_id','email','guest_email','session_hash','csrf_token','attendees'])assert.equal(Object.hasOwn(publicData,key),false,key);
  assert.equal(JSON.stringify(publicData).includes('@local.test'),false);
});

test('legacy inserts and omitted create default to empty; omitted update preserves and explicit empty clears',async()=>{
  const legacyId=randomUUID();
  await pool.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,capacity,state,visibility)
    VALUES($1,$2,$3,'合成舊活動','未傳新欄位','2099-01-01T12:00:00Z','2099-01-01T13:00:00Z','online','合成教室',20,'published','open')`,[legacyId,DEMO_COMMUNITY,DEMO_USERS[0].user_id]);
  assert.deepEqual((await stored(legacyId)).prize_details,[]);
  const publicLegacy=await app.request(`${origin}/api/v1/public/events/${legacyId}`);assert.equal(publicLegacy.status,200);assert.deepEqual((await publicLegacy.json() as EventResult).prize_details,[]);
  const omitted=await request('/events',sessions[0],details());assert.equal(omitted.status,201);assert.deepEqual(omitted.data.prize_details,[]);
  const first=await create(),path=`/events/${first.event_id}/update`;
  const preserved=await request(path,sessions[0],{...details(),title:'只修改活動名稱'},first.aggregate_version);
  assert.equal(preserved.status,200);assert.deepEqual(preserved.data.prize_details,first.prize_details);
  assert.deepEqual((await stored(first.event_id)).prize_details,first.prize_details);
  const cleared=await request(path,sessions[0],{...details(),prize_details:[]},preserved.data.aggregate_version);
  assert.equal(cleared.status,200);assert.deepEqual(cleared.data.prize_details,[]);assert.deepEqual((await stored(first.event_id)).prize_details,[]);
});

test('nonowners, including a current reviewer, cannot change prizes or mint receipts',async()=>{
  const first=await create();await makeReviewer();
  assert.equal((await request(`/events/${first.event_id}`,sessions[1])).data.can_review,true);
  const before=await snapshot();
  for(const session of [sessions[1],sessions[2]]){
    const denied=await request(`/events/${first.event_id}/update`,session,{...details(),prize_details:[]},first.aggregate_version);
    assert.equal(denied.status,403);assert.equal(denied.data.code,'organizer_required');assert.deepEqual(await snapshot(),before);
  }
});

test('public prize descriptions do not bypass pending, private-event or referral-location visibility',async()=>{
  const first=await create();
  let response=await app.request(`${origin}/api/v1/public/events/${first.event_id}`);assert.equal(response.status,404);
  for(const visibility of ['workshop','guild']){
    await pool.query("UPDATE community_events SET state='published',visibility=$2,event_kind=CASE WHEN $2='guild' THEN 'guild_skill_exchange' ELSE 'other' END,guild_key=CASE WHEN $2='guild' THEN 'guild_member_operations' ELSE NULL END WHERE event_id=$1",[first.event_id,visibility]);
    response=await app.request(`${origin}/api/v1/public/events/${first.event_id}`);assert.equal(response.status,404);
  }
  await pool.query("UPDATE community_events SET visibility='referral',registration_policy='community_member',location='https://example.org/private-meeting',online_url='https://example.org/private-meeting' WHERE event_id=$1",[first.event_id]);
  response=await app.request(`${origin}/api/v1/public/events/${first.event_id}`);assert.equal(response.status,200);
  const publicData=await response.json() as EventResult;assert.deepEqual(publicData.prize_details,first.prize_details);
  assert.equal(publicData.online_url,null);assert.equal(publicData.location,'登入並完成報名後可查看參與資料');
  assert.equal(JSON.stringify(publicData).includes('private-meeting'),false);
  const member=await request(`/events/${first.event_id}`,sessions[2]);assert.equal(member.status,200);
  assert.deepEqual(member.data.prize_details,first.prize_details);assert.equal(member.data.online_url,null);
  assert.equal(JSON.stringify(member.data).includes('private-meeting'),false);
});

test('cross-community events stay unreadable and cannot be edited by a valid member session',async()=>{
  const first=await create(),other=randomUUID();await pool.query("INSERT INTO communities(community_id,name) VALUES($1,'合成另一社群')",[other]);
  await pool.query('UPDATE community_events SET community_id=$2 WHERE event_id=$1',[first.event_id,other]);
  const before=await snapshot();
  assert.equal((await request(`/events/${first.event_id}`)).status,404);
  const denied=await request(`/events/${first.event_id}/update`,sessions[0],{...details(),prize_details:[]},first.aggregate_version);
  assert.equal(denied.status,404);assert.equal(denied.data.code,'not_found');assert.deepEqual(await snapshot(),before);
});

test('published promises and already-started pending events cannot be rewritten',async()=>{
  const first=await create(),path=`/events/${first.event_id}/update`;
  for(const state of ['published','started']){
    if(state==='published')await pool.query("UPDATE community_events SET state='published' WHERE event_id=$1",[first.event_id]);
    else await pool.query("UPDATE community_events SET state='pending',starts_at=now()-interval '1 minute' WHERE event_id=$1",[first.event_id]);
    const before=await snapshot(),denied=await request(path,sessions[0],{...details(),prize_details:[]},first.aggregate_version);
    assert.equal(denied.status,409);assert.equal(denied.data.code,'event_closed');assert.deepEqual(await snapshot(),before);
  }
});

test('create and update exact retries return original receipts; changed body or version conflicts without writes',async()=>{
  const body={...details(),prize_details:[prize()]},key=randomUUID();
  const first=await request('/events',sessions[0],body,undefined,key);assert.equal(first.status,201);
  const created=await snapshot(),replay=await request('/events',sessions[0],body,undefined,key);
  assert.equal(replay.status,201);assert.deepEqual(replay.data,first.data);assert.deepEqual(await snapshot(),created);
  const conflict=await request('/events',sessions[0],{...body,prize_details:[]},undefined,key);
  assert.equal(conflict.status,409);assert.equal(conflict.data.code,'idempotency_conflict');assert.deepEqual(await snapshot(),created);
  const path=`/events/${first.data.event_id}/update`,updateKey=randomUUID(),changed={...details(),prize_details:[prize()]};
  const edited=await request(path,sessions[0],changed,first.data.aggregate_version,updateKey);assert.equal(edited.status,200);
  const saved=await snapshot(),repeat=await request(path,sessions[0],changed,first.data.aggregate_version,updateKey);
  assert.equal(repeat.status,200);assert.deepEqual(repeat.data,edited.data);assert.deepEqual(await snapshot(),saved);
  for(const [value,version] of [[{...changed,prize_details:[]},first.data.aggregate_version],[changed,edited.data.aggregate_version]] as const){
    const mismatch=await request(path,sessions[0],value,version,updateKey);assert.equal(mismatch.status,409);assert.equal(mismatch.data.code,'idempotency_conflict');assert.deepEqual(await snapshot(),saved);
  }
  const stale=await request(path,sessions[0],changed,first.data.aggregate_version);assert.equal(stale.status,412);assert.equal(stale.data.code,'version_conflict');assert.deepEqual(await snapshot(),saved);
  const missing=await request(path,sessions[0],changed);assert.equal(missing.status,428);assert.equal(missing.data.code,'version_required');assert.deepEqual(await snapshot(),saved);
});

test('concurrent updates from one version commit one prize list and one receipt only',async()=>{
  const first=await create(),path=`/events/${first.event_id}/update`,before=await snapshot();
  const lists=[[prize({name:'候選甲'})],[prize({name:'候選乙'})]];
  const results=await Promise.all(lists.map(prize_details=>request(path,sessions[0],{...details(),prize_details},first.aggregate_version)));
  assert.deepEqual(results.map(item=>item.status).sort(),[200,412]);
  const winner=results.findIndex(item=>item.status===200),row=await stored(first.event_id);
  assert.deepEqual(row.prize_details,lists[winner]);assert.equal(Number(row.aggregate_version),first.aggregate_version+1);
  const after=await snapshot();
  for(const table of ['command_receipts','transition_journal'])assert.equal((after[table] as unknown[]).length,(before[table] as unknown[]).length+1);
});

test('current organizer authority is checked before replaying a previously successful edit',async()=>{
  const first=await create(),path=`/events/${first.event_id}/update`,body={...details(),prize_details:[prize()]},key=randomUUID();
  assert.equal((await request(path,sessions[0],body,first.aggregate_version,key)).status,200);
  await pool.query('UPDATE community_events SET organizer_ref=$2 WHERE event_id=$1',[first.event_id,DEMO_USERS[2].user_id]);
  const before=await snapshot(),denied=await request(path,sessions[0],body,first.aggregate_version,key);
  assert.equal(denied.status,403);assert.equal(denied.data.code,'organizer_required');assert.deepEqual(await snapshot(),before);
});

test('revoked sessions cannot replay a successful prize write',async()=>{
  const body={...details(),prize_details:[prize()]},key=randomUUID();assert.equal((await request('/events',sessions[0],body,undefined,key)).status,201);
  await pool.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1',[DEMO_USERS[0].user_id]);
  const before=await snapshot(),denied=await request('/events',sessions[0],body,undefined,key);assert.equal(denied.status,401);assert.deepEqual(await snapshot(),before);
});

function invalidLists():unknown[]{
  const item=prize(),{claim_note:_claim,...missing}=item;
  return [null,{},'prizes',[null],[missing],[{...item,award_state:'awarded'}],[{...item,prize_id:'not-a-uuid'}],
    [{...item,prize_id:'10000000-0000-1000-8000-000000000001'}],[item,{...item}],
    Array.from({length:6},()=>prize()),...['name','completion_rule','claim_note'].flatMap(field=>[[{...item,[field]:''}],[{...item,[field]:'   '}],[{...item,[field]:null}]]),
    [{...item,name:'字'.repeat(121)}],[{...item,description:'字'.repeat(501)}],[{...item,completion_rule:'字'.repeat(501)}],[{...item,claim_note:'字'.repeat(501)}],
    [{...item,name:'😀'.repeat(121)}],[{...item,description:'😀'.repeat(501)}],[{...item,completion_rule:'\t'}],[{...item,claim_note:'\u00a0'}],
    [{...item,description:'\0'}],[{...item,name:'\ud800'}],[{...item,icon_id:'https://example.org/image.svg'}],
    ...[0,501,-1,1.5,'2',null].map(quantity=>[{...item,quantity}])];
}
test('invalid prize input is rejected for both create and update with no receipt, quota or domain effects',async()=>{
  const first=await create(),before=await snapshot(),key=randomUUID();
  for(const prize_details of invalidLists()){
    for(const [path,version] of [['/events',undefined],[`/events/${first.event_id}/update`,first.aggregate_version]] as const){
      const result=await request(path,sessions[0],{...details(),prize_details},version,key);
      assert.equal(result.status,422,JSON.stringify(prize_details));assert.equal(result.data.code,'validation_failed');assert.deepEqual(await snapshot(),before);
    }
  }
  assert.equal((await request('/events',sessions[0],{...details(),prize_details:[]},undefined,key)).status,201,'failed validation does not consume the key');
});

test('SQL constraints reject malformed prize JSON and preserve existing data',async()=>{
  const first=await create(),before=await stored(first.event_id);
  const sqlInvalid=invalidLists().filter(value=>!JSON.stringify(value).includes('\\u0000')&&!JSON.stringify(value).includes('\\ud800'));
  for(const field of ['name','description','completion_rule','claim_note'])for(const padding of [' ', '\t', '\n', '\u00a0', '\u3000', '\ufeff'])sqlInvalid.push([{...prize(),[field]:padding+'內容'+padding}]);
  sqlInvalid.push([{...prize(),name:'x'+' '.repeat(10000)}]);
  sqlInvalid.push([{...prize(),prize_id:'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'}]);
  for(const value of sqlInvalid){
    await assert.rejects(pool.query('UPDATE community_events SET prize_details=$2::jsonb WHERE event_id=$1',[first.event_id,JSON.stringify(value)]),(error:unknown)=>(error as {code?:string}).code==='23514',JSON.stringify(value));
    assert.deepEqual(await stored(first.event_id),before);
  }
  await assert.rejects(pool.query('UPDATE community_events SET prize_details=NULL WHERE event_id=$1',[first.event_id]),(error:unknown)=>(error as {code?:string}).code==='23502');
});

test('all catalog icons and boundary values survive SQL validation without implying a grant',async()=>{
  const first=await create();
  for(const icon_id of EVENT_PRIZE_ICON_IDS){
    const list=[prize({icon_id,name:'字'.repeat(120),description:'',quantity:500,completion_rule:'字'.repeat(500),claim_note:'字'.repeat(500)})];
    await pool.query('UPDATE community_events SET prize_details=$2::jsonb WHERE event_id=$1',[first.event_id,JSON.stringify(list)]);
    assert.deepEqual((await stored(first.event_id)).prize_details,list);
  }
  const supplementary=[prize({name:'😀'.repeat(120),description:'😀'.repeat(500),completion_rule:'😀'.repeat(500),claim_note:'😀'.repeat(500)})];
  await pool.query('UPDATE community_events SET prize_details=$2::jsonb WHERE event_id=$1',[first.event_id,JSON.stringify(supplementary)]);assert.deepEqual((await stored(first.event_id)).prize_details,supplementary);
  const five=Array.from({length:5},()=>prize({quantity:1}));
  const response=await request(`/events/${first.event_id}/update`,sessions[0],{...details(),prize_details:five},first.aggregate_version);
  assert.equal(response.status,200);assert.deepEqual(response.data.prize_details,five);
  const journal=await pool.query("SELECT data FROM transition_journal WHERE aggregate_id=$1 AND aggregate_type='community_event' ORDER BY aggregate_version",[first.event_id]);
  assert.ok(journal.rowCount);assert.equal(JSON.stringify(journal.rows).includes('completion_rule'),false,'audit stays minimal instead of copying prize prose');
  for(const table of ['community_event_rsvps','community_event_guest_rsvps'])assert.equal((await pool.query(`SELECT 1 FROM ${table} WHERE event_id=$1`,[first.event_id])).rowCount,0);
});

test('receipt failures atomically roll back create and update, including prize data, journal and quota',async()=>{
  const first=await create(),before=await snapshot();
  await pool.query(`CREATE FUNCTION fail_prize_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.operation LIKE 'POST /api/v1/events%' THEN RAISE EXCEPTION 'synthetic prize receipt failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_prize_receipt BEFORE INSERT ON command_receipts FOR EACH ROW EXECUTE FUNCTION fail_prize_receipt()`);
  const createKey=randomUUID(),updateKey=randomUUID(),body={...details(),prize_details:[prize()]},path=`/events/${first.event_id}/update`;
  try{
    assert.equal((await request('/events',sessions[0],body,undefined,createKey)).status,500);assert.deepEqual(await snapshot(),before);
    assert.equal((await request(path,sessions[0],body,first.aggregate_version,updateKey)).status,500);assert.deepEqual(await snapshot(),before);
  }finally{await pool.query('DROP TRIGGER fail_prize_receipt ON command_receipts; DROP FUNCTION fail_prize_receipt()');}
  assert.equal((await request('/events',sessions[0],body,undefined,createKey)).status,201);
  const retried=await request(path,sessions[0],body,first.aggregate_version,updateKey);assert.equal(retried.status,200);assert.deepEqual(retried.data.prize_details,body.prize_details);
});


test('maximum-length Unicode event descriptions and five prizes survive the bounded HTTP route',async()=>{
  const char='😀',prize_details=Array.from({length:5},()=>prize({name:char.repeat(120),description:char.repeat(500),completion_rule:char.repeat(500),claim_note:char.repeat(500),quantity:500}));
  const body={...details(),title:char.repeat(120),description:char.repeat(3000),help_need:char.repeat(500),location:char.repeat(300),topic:char.repeat(160),online_url:'https://example.org/'+char.repeat(480),prize_details};
  assert(Buffer.byteLength(JSON.stringify(body))>32768);
  const first=await request('/events',sessions[0],body);assert.equal(first.status,201,JSON.stringify(first.data));assert.deepEqual(first.data.prize_details,prize_details);
  const update=await request(`/events/${first.data.event_id}/update`,sessions[0],body,first.data.aggregate_version);assert.equal(update.status,200);assert.deepEqual(update.data.prize_details,prize_details);
});
