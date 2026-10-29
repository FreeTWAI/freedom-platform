import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_USERS,DEMO_PASSWORD,DEMO_COMMUNITY} from '../../packages/testing/seed.js';
import {createApp} from '../../apps/platform-api/src/app.js';
// Author DB cases: require an explicitly supplied disposable local fp_* target.
// Never discover or fall back to a developer/production database.
const databaseUrl=process.env.TEST_DATABASE_URL;
if(!databaseUrl)throw new Error('Event mission DB tests require explicit disposable TEST_DATABASE_URL');
const target=new URL(databaseUrl);
if(!['localhost','127.0.0.1','[::1]'].includes(target.hostname)||!/^\/fp_[a-zA-Z0-9_]+$/.test(target.pathname)||target.search)throw new Error('Event mission DB tests require a local fp_* database without query overrides');
const schema=`fp_event_missions_${process.pid}_${Date.now()}`,admin=new Pool({connectionString:databaseUrl});
const pool=new Pool({connectionString:databaseUrl,options:`-c search_path=${schema}`,max:8});
const origin='http://127.0.0.1:4315',app=createApp(pool,origin,'local');
type Session={cookie:string;csrf:string;id:string};
before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
beforeEach(async()=>{await pool.query('TRUNCATE communities,login_attempts,auth_rate_limits CASCADE');await seedLocal(pool);});
async function login(index:number):Promise<Session>{
 const r=await app.request(origin+'/api/v1/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:DEMO_USERS[index].email,password:DEMO_PASSWORD})});
 assert.equal(r.status,200);const d=await r.json() as any;return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:d.csrf_token,id:d.user.user_id};
}
async function request(path:string,s?:Session,body?:unknown,version?:number,key=randomUUID()){
 const headers:Record<string,string>={Origin:origin,...(s?{Cookie:s.cookie,'X-CSRF-Token':s.csrf}:{})};
 if(body!==undefined){headers['Content-Type']='application/json';headers['Idempotency-Key']=key;if(version!==undefined)headers['If-Match']=`"${version}"`;}
 const r=await app.request(origin+'/api/v1'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,headers:r.headers,data:await r.json() as any};
}
async function fixture(extra:Record<string,unknown>={}){
 const host=await login(0),member=await login(1),peer=await login(2);
 const created=await request('/events',host,{title:'私人練習活動',description:'合成測試活動',starts_at:new Date(Date.now()+86400000).toISOString(),ends_at:new Date(Date.now()+90000000).toISOString(),mode:'online',location:'https://example.test/meeting',capacity:1,visibility:'open',help_need:'協助報到',...extra});
 assert.equal(created.status,201,JSON.stringify(created.data));const id=created.data.event_id;
 // Publication fixture only; create/update review invariants tested separately.
 await pool.query("UPDATE community_events SET state='published' WHERE event_id=$1",[id]);
 return {host,member,peer,id,path:`/events/${id}/my-missions`};
}
test('explicit opt-in persists exactly three private assignments without RSVP or helper side effects',async()=>{
 const {member,peer,id,path}=await fixture();const initial=await request(path,member);assert.equal(initial.status,200);assert.equal(initial.headers.get('cache-control'),'private, no-store');assert.equal(initial.data.enabled,false);
 assert.equal((await pool.query('SELECT count(*) n FROM event_mission_progress')).rows[0].n,'0');
 assert.equal((await request(path,member,{action:'start'},1)).status,200);const current=await request(path,member);assert.equal(current.data.slots.length,3);assert.deepEqual((await request(path,member)).data,current.data);
 assert.equal((await request(path,peer)).data.enabled,false);
 for(const table of ['community_event_rsvps','community_event_helpers'])assert.equal((await pool.query(`SELECT count(*) n FROM ${table} WHERE event_id=$1`,[id])).rows[0].n,'0');
 assert.equal((await request(path,undefined)).status,401);
});
test('same command deduplicates concurrent starts and replay after clear does not resurrect tasks',async()=>{
 const {member,path}=await fixture(),key=randomUUID();const r=await Promise.all([request(path,member,{action:'start'},1,key),request(path,member,{action:'start'},1,key)]);assert.deepEqual(r.map(v=>v.status),[200,200]);assert.deepEqual(r[0].data,r[1].data);
 assert.equal((await request(path,member,{action:'clear'},2)).status,200);const cleared=await request(path,member);assert.equal(cleared.data.version,3);assert.deepEqual(cleared.data.slots,[]);
 const replay=await request(path,member,{action:'start'},1,key);assert.deepEqual(replay.data,r[0].data);assert.deepEqual((await request(path,member)).data,cleared.data);
 assert.doesNotMatch(JSON.stringify(replay.data),/template_id|title|description|slots/);
 assert.equal((await request(path,member,{action:'start'},1)).status,412);
});
test('replace, skip and self-report use CAS; no arbitrary body or peer identity accepted',async()=>{
 const {member,path}=await fixture();await request(path,member,{action:'start'},1);const old=(await request(path,member)).data;
 assert.equal((await request(path,member,{action:'replace',slot:0},2)).status,200);const next=(await request(path,member)).data;assert.ok(!old.slots.some((s:any)=>s.template_id===next.slots[0].template_id));assert.deepEqual(next.slots.slice(1),old.slots.slice(1));
 assert.equal((await request(path,member,{action:'skip',slot:1},2)).status,412);
 assert.equal((await request(path,member,{action:'skip',slot:1},3)).status,200);
 assert.equal((await request(path,member,{action:'mark_done',slot:2},4)).status,200);
 assert.deepEqual((await request(path,member)).data.slots.map((s:any)=>s.state),['active','skipped','self_reported']);
 for(const body of [{action:'skip',slot:3},{action:'start',member_ref:member.id},{action:'mark_done',slot:0,text:'private text'}])assert.notEqual((await request(path,member,body,5)).status,200);
});
test('event cancellation or hidden source blocks progress/replay but owner can clear',async()=>{
 const {member,id,path}=await fixture(),key=randomUUID();await request(path,member,{action:'start'},1,key);
 await pool.query("UPDATE community_events SET state='cancelled' WHERE event_id=$1",[id]);
 const hidden=await request(path,member);assert.equal(hidden.status,200);assert.equal(hidden.data.editable,false);assert.deepEqual(hidden.data.slots,[]);
 assert.notEqual((await request(path,member,{action:'start'},1,key)).status,200);
 assert.equal((await request(path,member,{action:'clear'},2)).status,200);assert.equal((await request(path,member)).data.enabled,false);
});
test('revoked session is rejected even for a stored ACK',async()=>{
 const {member,path}=await fixture(),key=randomUUID();await request(path,member,{action:'start'},1,key);
 await pool.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1',[member.id]);assert.equal((await request(path,member,{action:'start'},1,key)).status,401);assert.equal((await request(path,member)).status,401);
});
test('replaying an old clear ACK cannot clear a later fresh start',async()=>{
 const {member,path}=await fixture(),key=randomUUID();await request(path,member,{action:'start'},1);
 const first=await request(path,member,{action:'clear'},2,key);assert.equal(first.status,200);
 assert.equal((await request(path,member,{action:'start'},3)).status,200);const restarted=(await request(path,member)).data;
 assert.deepEqual((await request(path,member,{action:'clear'},2,key)).data,first.data);assert.deepEqual((await request(path,member)).data,restarted);assert.equal(restarted.enabled,true);
});
test('clear and progress serialize against the same version; non-owner cannot clear someone else',async()=>{
 const {member,peer,path}=await fixture();await request(path,member,{action:'start'},1);
 assert.equal((await request(path,peer,{action:'clear'},2)).status,404);
 const race=await Promise.all([request(path,member,{action:'clear'},2),request(path,member,{action:'skip',slot:0},2)]);
 assert.deepEqual(race.map(r=>r.status).sort(),[200,412]);const current=(await request(path,member)).data;assert.equal(current.version,3);
 if(!current.enabled)assert.deepEqual(current.slots,[]);else assert.equal(current.slots[0].state,'skipped');
});
test('foreign community event is hidden for original owner and other members, including stored ACK',async()=>{
 const {host,member,peer,id,path}=await fixture(),key=randomUUID();await request(path,member,{action:'start'},1,key);
 const foreign=randomUUID();await pool.query("INSERT INTO communities(community_id,name) VALUES($1,'隔離合成社群')",[foreign]);
 await pool.query('UPDATE community_events SET community_id=$2 WHERE event_id=$1',[id,foreign]);
 for(const session of [host,member,peer])assert.equal((await request(path,session)).status,404);
 assert.equal((await request(path,member,{action:'start'},1,key)).status,404);
 assert.equal((await request(path,member,{action:'clear'},2)).status,404);
});
test('guild membership loss redacts own content and rejects old progress receipt but allows clear',async()=>{
 const {member,id,path}=await fixture(),key=randomUUID();
 await pool.query("UPDATE community_events SET visibility='guild',event_kind='guild_skill_exchange',guild_key='guild_member_operations' WHERE event_id=$1",[id]);
 await pool.query("INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state) VALUES($1,$2,$3,'guild_member_operations','active') ON CONFLICT DO NOTHING",[randomUUID(),DEMO_COMMUNITY,member.id]);
 assert.equal((await request(path,member,{action:'start'},1,key)).status,200);
 await pool.query("UPDATE positioning_profession_memberships SET state='left' WHERE user_id=$1 AND guild_key='guild_member_operations'",[member.id]);
 const own=await request(path,member);assert.equal(own.status,200);assert.equal(own.data.editable,false);assert.deepEqual(own.data.slots,[]);
 assert.equal((await request(path,member,{action:'start'},1,key)).status,404);assert.equal((await request(path,member,{action:'clear'},2)).status,200);
});
for(const revoked of ['inactive','onboarding'] as const)test(`${revoked} status is checked before progress receipt replay`,async()=>{
 const {member,path}=await fixture(),key=randomUUID();await request(path,member,{action:'start'},1,key);
 if(revoked==='inactive')await pool.query('UPDATE users SET active=false WHERE user_id=$1',[member.id]);
 else await pool.query('UPDATE users SET onboarding_required=true,onboarding_completed_at=NULL WHERE user_id=$1',[member.id]);
 const replay=await request(path,member,{action:'start'},1,key);assert.ok([401,403].includes(replay.status));
 const read=await request(path,member);if(read.status===200){assert.equal(read.data.editable,false);assert.deepEqual(read.data.slots,[]);}else assert.ok([401,403].includes(read.status));
});
test('wrong body under same key is rejected without modifying current progress',async()=>{
 const {member,path}=await fixture(),key=randomUUID();await request(path,member,{action:'start'},1,key);const original=(await request(path,member)).data;
 assert.equal((await request(path,member,{action:'skip',slot:0},1,key)).status,409);assert.deepEqual((await request(path,member)).data,original);
});
test('malformed event IDs never return task content or acknowledgement',async()=>{
 const {member}=await fixture();
 for(const id of ['not-a-uuid','123','00000000-0000-0000-0000-00000000000x']){
  for(const body of [undefined,{action:'start'}]){const r=await request(`/events/${id}/my-missions`,member,body,1);assert.ok([400,422].includes(r.status));assert.equal(r.data.acknowledged,undefined);assert.equal(r.data.slots,undefined);}
 }
});
test('maximum safe version refuses overflow without clearing or modifying slots',async()=>{
 const {member,path}=await fixture();await request(path,member,{action:'start'},1);await pool.query('UPDATE event_mission_progress SET aggregate_version=$1 WHERE member_ref=$2',[Number.MAX_SAFE_INTEGER,member.id]);
 const original=(await request(path,member)).data;assert.equal(original.version,Number.MAX_SAFE_INTEGER);
 for(const body of [{action:'skip',slot:0},{action:'clear'}])assert.equal((await request(path,member,body,Number.MAX_SAFE_INTEGER)).status,409);
 assert.deepEqual((await request(path,member)).data,original);
});
