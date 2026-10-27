import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_USERS,DEMO_COMMUNITY,DEMO_PASSWORD} from '../../packages/testing/seed.js';
import {login,type Actor} from '../../modules/identity-membership/service.js';
import {recordSocialChat,readSocialAchievements,saveSocialAchievements,eraseSocialAchievements,moderateSocialAchievements,appealSocialAchievements} from '../../modules/social-achievements/service.js';
import {createApp} from '../../apps/platform-api/src/app.js';
const url=process.env.TEST_DATABASE_URL;if(!url)throw new Error('TEST_DATABASE_URL must name a disposable database');
const schema=`fp_social_titles_${process.pid}_${Date.now()}`,admin=new Pool({connectionString:url}),pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
const [A,B]=DEMO_USERS.map(x=>x.user_id);let actor:Actor;
before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
beforeEach(async()=>{await pool.query('TRUNCATE communities,login_attempts,auth_rate_limits CASCADE');await seedLocal(pool);actor=(await login(pool,DEMO_USERS[0].email,DEMO_PASSWORD)).actor;await pool.query('UPDATE users SET email_verified_at=clock_timestamp()');});
const input=(body:unknown,expected?:string,key=randomUUID())=>({actor,operation:'social-test',key,body,expected});
async function enroll(){await pool.query(`INSERT INTO social_achievement_settings(user_id,community_id,counting_enabled,consent_since) VALUES($1,$3,true,'2025-01-01'),($2,$3,true,'2025-01-01')`,[A,B,DEMO_COMMUNITY]);}
let seq=0;
async function exchange(day:string,options:{self?:boolean;retracted?:boolean;kind?:string}={}){
 const ids=[randomUUID(),randomUUID(),randomUUID()],kind=options.kind??'world',channel=kind==='world'?'world':'guild_ai_vibe';await pool.query('INSERT INTO member_chat_channels(community_id,kind,channel_key) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[DEMO_COMMUNITY,kind,channel]);const q=await pool.connect();try{await q.query('BEGIN');for(let i=0;i<3;i++)await q.query(`INSERT INTO member_channel_messages(message_id,community_id,kind,channel_key,sequence,sender_ref,body,reply_to_message_id,created_at,retracted_at) VALUES($1,$2,$3,$10,$4,$5,'private body must never be copied',$6,$7::timestamptz+make_interval(secs=>$8),CASE WHEN $9 THEN clock_timestamp() ELSE NULL END)`,[ids[i],DEMO_COMMUNITY,options.kind??'world',++seq,i===1&&!options.self?B:A,i?ids[i-1]:null,day+'T04:00:00Z',i,Boolean(options.retracted&&i===0),channel]);await recordSocialChat(q,DEMO_COMMUNITY,ids[2]);await q.query('COMMIT');return ids[2];}catch(e){await q.query('ROLLBACK');throw e;}finally{q.release();}}
test('default off, explicit consent only, authoritative day dedupe and first unlock',async()=>{
 const off=await readSocialAchievements(pool,actor);assert.equal(off.counting_enabled,false);assert.equal(off.show_title,false);
 await exchange('2026-01-01');assert.equal((await readSocialAchievements(pool,actor)).chat.days,0);
 await enroll();const id=await exchange('2026-01-01');await exchange('2026-01-01');
 const q=await pool.connect();try{await q.query('BEGIN');await recordSocialChat(q,DEMO_COMMUNITY,id);await q.query('COMMIT');}finally{q.release();}
 const state=await readSocialAchievements(pool,actor);assert.equal(state.chat.days,1);assert.equal(state.participation.days,1);assert.equal(state.titles.filter(t=>t.unlocked).length,2);assert.equal(state.show_title,false);
});
test('same pair monthly cap, no streak reset and next month recovery',async()=>{
 await enroll();for(let i=1;i<=9;i++)await exchange(`2026-01-${String(i).padStart(2,'0')}`);
 assert.equal((await readSocialAchievements(pool,actor)).chat.days,8);await exchange('2026-03-15');assert.equal((await readSocialAchievements(pool,actor)).chat.days,9);
});
test('self, retracted, non-world, pre-consent, inactive, test accounts and reciprocal blocks cannot earn',async()=>{
 await enroll();await exchange('2026-01-01',{self:true});await exchange('2026-01-02',{retracted:true});await exchange('2026-01-03',{kind:'guild'});
 await pool.query("UPDATE social_achievement_settings SET consent_since='2026-02-01'");await exchange('2026-01-04');
 await pool.query("UPDATE social_achievement_settings SET consent_since='2025-01-01'");await pool.query('UPDATE users SET active=false WHERE user_id=$1',[B]);await exchange('2026-01-05');
 await pool.query("UPDATE users SET active=true,email='synthetic@example.invalid' WHERE user_id=$1",[B]);await exchange('2026-01-06');await pool.query('UPDATE users SET email=$2 WHERE user_id=$1',[B,DEMO_USERS[1].email]);
 await pool.query("INSERT INTO member_interaction_blocks(community_id,owner_ref,target_ref,state) VALUES($1,$2,$3,'active')",[DEMO_COMMUNITY,B,A]);await exchange('2026-01-07');assert.equal((await readSocialAchievements(pool,actor)).chat.days,0);
});
test('settings CAS, unknown titles rejected, replay cannot restore erased data',async()=>{
 await enroll();await exchange('2026-01-01');const b={policy_version:'social_days_v1',counting_enabled:true,show_title:true,selected_title:'chat_1'},key=randomUUID();
 const saved=await saveSocialAchievements(pool,input(b,'1',key));assert.equal(saved.show_title,true);
 await assert.rejects(saveSocialAchievements(pool,input({...b,selected_title:'chat_365'},saved.aggregate_version!)));
 await assert.rejects(saveSocialAchievements(pool,input(b,'1')));
 const erased=await eraseSocialAchievements(pool,{...input({confirm:true},saved.aggregate_version!),operation:'erase-test'});assert.equal(erased.chat.days,0);assert.equal(erased.counting_enabled,false);
 const replay=await saveSocialAchievements(pool,input(b,'1',key));assert.equal(replay.show_title,false);assert.equal(replay.chat.days,0);
});
test('non-admin cannot revoke or inspect review queue; no unauthenticated progress',async()=>{
 await enroll();await pool.query('DELETE FROM platform_admins');await assert.rejects(moderateSocialAchievements(pool,input({status:'revoked',reason:'synthetic'},'1'),A));
 const origin='http://127.0.0.1:4310',app=createApp(pool,origin,'local',{socialAchievementsEnabled:true});const response=await app.request(origin+'/api/v1/me/social-achievements');assert.equal(response.status,401);
});
test('disabled runtime does not expose capability or routes',async()=>{
 const origin='http://127.0.0.1:4310',app=createApp(pool,origin,'local');const site=await(await app.request(origin+'/api/v1/site')).json() as any;assert.equal(site.social_achievements_enabled,false);
});
test('paused awards keep valid days; appeal restore recomputes without resetting progress',async()=>{
 await enroll();await pool.query(`INSERT INTO platform_admins(admin_id,community_id,email,display_name) VALUES($1,$2,$3,'Synthetic admin') ON CONFLICT(email) DO UPDATE SET active=true`,[randomUUID(),DEMO_COMMUNITY,actor.email]);
 await moderateSocialAchievements(pool,{...input({status:'paused',reason:'Synthetic review pending'},'1'),operation:'moderation-test'},A);
 await exchange('2026-01-01');let state=await readSocialAchievements(pool,actor);assert.equal(state.chat.days,1);assert.equal(state.titles.filter(t=>t.unlocked).length,0);
 state=await appealSocialAchievements(pool,{...input({reason:'Synthetic correction'},state.aggregate_version!),operation:'appeal-test'});assert.equal(state.appeal_state,'pending');
 await moderateSocialAchievements(pool,{...input({status:'active',reason:'Synthetic evidence corrected'},state.aggregate_version!),operation:'moderation-test'},A);
 state=await readSocialAchievements(pool,actor);assert.equal(state.chat.days,1);assert.equal(state.titles.filter(t=>t.unlocked).length,2);assert.equal(state.appeal_state,'resolved');
 await pool.query('UPDATE platform_admins SET active=false WHERE email=$1',[actor.email]);await assert.rejects(moderateSocialAchievements(pool,{...input({status:'revoked',reason:'Denied'},state.aggregate_version!),operation:'moderation-test'},A));
});

// Hosted disposable-PostgreSQL cases: in-process HTTP requests exercise the original
// accepted Work command and its hook, not a synthetic historical helper replay.
const workOrigin='http://127.0.0.1:4310';
interface WorkSession {cookie:string;csrf:string;user:any}
function workFlow(enabled=true){
 const app=createApp(pool,workOrigin,'local',{socialAchievementsEnabled:enabled});
 async function request(path:string,session?:WorkSession,body?:unknown,version?:string,key=randomUUID()){
  const headers:Record<string,string>={Origin:workOrigin,...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{})};
  if(body!==undefined){headers['Content-Type']='application/json';headers['Idempotency-Key']=key;if(version)headers['If-Match']=`"${version}"`;}
  const response=await app.request(workOrigin+'/api/v1'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});
  return {response,data:await response.json() as any};
 }
 async function signIn(index:number):Promise<WorkSession>{const {response,data}=await request('/auth/login',undefined,{email:DEMO_USERS[index].email,password:DEMO_PASSWORD});assert.equal(response.status,200,JSON.stringify(data));return {cookie:response.headers.get('set-cookie')!.split(';')[0],csrf:data.csrf_token,user:data.user};}
 async function accept(member:WorkSession,reviewer:WorkSession){
  const created=await request('/work-items',reviewer,{title:'合成稱號驗收工作',objective:'驗證既有驗收流程',acceptance_criteria:'交付合成測試成果',gain:'測試非報酬承諾',estimated_minutes:20,maximum_minutes:30,claim_by:new Date(Date.now()+86400000).toISOString(),finish_by:new Date(Date.now()+172800000).toISOString(),will_review:true});
  assert.equal(created.response.status,201,JSON.stringify(created.data));
  const item=(await request('/work-items',member)).data.items.find((w:any)=>w.work_item_id===created.data.work_item_id);assert.ok(item);
  const claimed=await request(`/work-items/${item.work_item_id}:claim`,member,{claimant_type:'user',acting_profession_membership_ref:member.user.profession_membership_ref,expected_aggregate_version:item.aggregate_version,terms_status:'declared',participation_terms_revision:item.participation_terms_revision,participation_terms_sha256:item.participation_terms_sha256},item.aggregate_version);
  assert.equal(claimed.response.status,201,JSON.stringify(claimed.data));let current=claimed.data;
  for(const [who,name,body] of [[member,'start',{}],[member,'submit',{summary:'合成驗收成果',artifact_ref:`artifact:social-test-${randomUUID()}`}],[reviewer,'begin-review',{}]] as const){const result=await request(`/work-claims/${current.claim_id}:${name}`,who,body,current.aggregate_version);assert.equal(result.response.status,200,JSON.stringify(result.data));current=result.data;}
  const path=`/work-claims/${current.claim_id}:decide`,body={decision:'accept',feedback:'合成成果符合條件',submission_sha256:current.latest_submission.sha256},version=current.aggregate_version,key=randomUUID();
  const accepted=await request(path,reviewer,body,version,key);assert.equal(accepted.response.status,200,JSON.stringify(accepted.data));
  return {replay:()=>request(path,reviewer,body,version,key)};
 }
 return {signIn,accept};
}
test('actual accepted Work credits opposite deliverers once each without changing contribution facts',async()=>{
 await enroll();const flow=workFlow(),a=await flow.signIn(0),b=await flow.signIn(1),accepted=await flow.accept(a,b);
 assert.equal((await readSocialAchievements(pool,actor)).participation.days,1);assert.equal((await readSocialAchievements(pool,actor)).chat.days,0);
 await flow.accept(b,a);const days=await pool.query("SELECT user_id,count(*)::int AS n FROM social_achievement_days WHERE track='participation' GROUP BY user_id ORDER BY user_id");assert.equal(days.rowCount,2);assert.ok(days.rows.every(r=>r.n===1));
 const before=(await pool.query('SELECT count(*)::int AS n FROM contributions')).rows[0].n;assert.equal((await accepted.replay()).response.status,200);assert.equal((await pool.query('SELECT count(*)::int AS n FROM contributions')).rows[0].n,before);
 const state=await readSocialAchievements(pool,actor);await eraseSocialAchievements(pool,{...input({confirm:true},state.aggregate_version!),operation:'erase-test'});
 const erased=await readSocialAchievements(pool,actor);await saveSocialAchievements(pool,input({policy_version:'social_days_v1',counting_enabled:true,show_title:false,selected_title:null},erased.aggregate_version!));
 assert.equal((await accepted.replay()).response.status,200);assert.equal((await readSocialAchievements(pool,actor)).participation.days,0);
});
test('actual Work acceptance is default-off and consent never backfills historical acceptance',async()=>{
 await enroll();const off=workFlow(false),a=await off.signIn(0),b=await off.signIn(1);await off.accept(a,b);assert.equal((await readSocialAchievements(pool,actor)).participation.days,0);
 await pool.query('DELETE FROM social_achievement_settings');const enabled=workFlow(),accepted=await enabled.accept(a,b);await enroll();assert.equal((await accepted.replay()).response.status,200);assert.equal((await readSocialAchievements(pool,actor)).participation.days,0);
});
test('revoked title visibility does not disqualify either consenting conversation participant',async()=>{
 await enroll();await pool.query("UPDATE social_achievement_settings SET status='revoked' WHERE user_id=$1",[A]);await exchange('2026-01-01');
 const counts=await pool.query('SELECT user_id,count(*)::int AS n FROM social_achievement_days GROUP BY user_id');assert.equal(counts.rowCount,2);assert.ok(counts.rows.every(r=>r.n===2));
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM social_achievement_awards WHERE user_id=$1',[A])).rows[0].n,0);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM social_achievement_awards WHERE user_id=$1',[B])).rows[0].n,2);
});

test('active opted-in members without mailbox verification can start, but inactive/onboarding/test users still cannot earn',async()=>{
 await enroll();await pool.query('UPDATE users SET email_verified_at=NULL WHERE user_id=ANY($1::uuid[])',[[A,B]]);
 await exchange('2026-01-01');assert.equal((await readSocialAchievements(pool,actor)).chat.days,1,'first eligible unverified-mail exchange is not silently excluded');
 await pool.query('UPDATE users SET active=false WHERE user_id=$1',[B]);await exchange('2026-01-02');assert.equal((await readSocialAchievements(pool,actor)).chat.days,1);
 await pool.query('UPDATE users SET active=true,onboarding_required=true,onboarding_completed_at=NULL WHERE user_id=$1',[B]);await exchange('2026-01-03');assert.equal((await readSocialAchievements(pool,actor)).chat.days,1);
 await pool.query("UPDATE users SET onboarding_required=false,email='synthetic@example.invalid' WHERE user_id=$1",[B]);await exchange('2026-01-04');assert.equal((await readSocialAchievements(pool,actor)).chat.days,1);
 await pool.query('UPDATE users SET email=$2 WHERE user_id=$1',[B,DEMO_USERS[1].email]);await exchange('2026-01-05');assert.equal((await readSocialAchievements(pool,actor)).chat.days,2,'restored current eligibility permits the next day without mailbox verification');
});
