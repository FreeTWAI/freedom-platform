import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createPool,transaction,type Command} from '../../packages/db/index.js';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_USERS,DEMO_PASSWORD,DEMO_COMMUNITY} from '../../packages/testing/seed.js';
import {login,type Actor} from '../../modules/identity-membership/service.js';
import {Problem} from '../../packages/shared/problem.js';
import {createApp} from '../../apps/platform-api/src/app.js';
import {createEvent,updateEvent,publicEvent,registerPublicEvent,setRsvp,getEventShareCode} from '../../modules/community/events.js';
import {ensureGuestCapability,readGuestEventParticipation,mutateGuestEventParticipation,requestGuestEventParticipation,reconcileEventWaitlist,processEventWaitlist,readEventParticipation,mutateEventWaitlist,countEventSeats} from '../../modules/community/event-waitlist.js';

const databaseUrl=process.env.TEST_DATABASE_URL;
const schema=`fp_event_policy_${process.pid}_${Date.now()}`;
let admin:Pool,pool:Pool,createdSchema=false,eventId:string,actors:Actor[];
const starts='2099-01-01T12:00:00Z',ends='2099-01-01T13:00:00Z',origin='http://127.0.0.1:4310';
let sent=0;
const send=async()=>{sent++;};
const denied=(code:string)=>(error:unknown)=>error instanceof Problem&&error.code===code;
before(async()=>{
  assert.ok(databaseUrl,'TEST_DATABASE_URL must explicitly name an isolated test database');
  admin=createPool(databaseUrl);pool=new Pool({connectionString:databaseUrl,options:`-c search_path=${schema}`,max:8});
  await admin.query(`CREATE SCHEMA ${schema}`);createdSchema=true;await migrate(pool);
});
after(async()=>{if(pool)await pool.end();if(admin){try{if(createdSchema)await admin.query(`DROP SCHEMA ${schema} CASCADE`);}finally{await admin.end();}}});
beforeEach(async()=>{
  await pool.query('TRUNCATE communities,login_attempts,auth_rate_limits CASCADE');await seedLocal(pool);sent=0;
  actors=(await Promise.all(DEMO_USERS.map(user=>login(pool,user.email,DEMO_PASSWORD)))).map(result=>result.actor);
  eventId=randomUUID();
  await pool.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,capacity,state,visibility,waitlist_enabled,response_window_minutes)
    VALUES($1,$2,$3,'合成社群活動','隔離報名政策測試',$4,$5,'online','合成線上教室',1,'published','open',true,30)`,[eventId,DEMO_COMMUNITY,actors[0].user_id,starts,ends]);
});
function command(index:number,operation:string,body:unknown,expected?:number):Command{return {actor:actors[index],operation,key:randomUUID(),body,...(expected===undefined?{}:{expected:String(expected)})};}
async function memberOnly(){await pool.query("UPDATE community_events SET registration_policy='community_member' WHERE event_id=$1",[eventId]);}
async function capability(email='guest@local.test'){return transaction(pool,q=>ensureGuestCapability(q,eventId,{email,name:'合成訪客'}));}
async function guestAction(token:string,action:string){const state=await readGuestEventParticipation(pool,eventId,token);const body={action,expected_version:state.event_version},key=randomUUID();return {result:await mutateGuestEventParticipation(pool,eventId,token,body,key),body,key};}
function details(){return {title:'合成合作賽事',description:'隔離報名政策測試',starts_at:starts,ends_at:ends,mode:'online',location:'合成教室',capacity:2,visibility:'open'};}

test('existing/default guest events stay public and register with the original email flow',async()=>{
  assert.equal((await publicEvent(pool,eventId)).registration_policy,'guest_allowed');
  await registerPublicEvent(pool,eventId,{name:'合成訪客',email:'legacy@local.test'},send,origin);
  assert.equal(sent,1);assert.equal(await countEventSeats(pool,eventId),1);
});

test('community-member policy is public metadata but rejects both legacy registration and new guest capability without writes or email',async()=>{
  await memberOnly();const metadata=await publicEvent(pool,eventId);assert.equal(metadata.registration_policy,'community_member');
  for(const enabled of [false,true])await assert.rejects(registerPublicEvent(pool,eventId,{name:'合成訪客',email:'blocked@local.test'},send,origin,enabled),denied('event_member_required'));
  await assert.rejects(requestGuestEventParticipation(pool,eventId,{name:'合成訪客',email:'blocked@local.test'},send,origin),denied('event_member_required'));
  assert.equal(sent,0);
  for(const table of ['community_event_guest_rsvps','community_event_guest_capabilities','community_event_guest_commands','community_event_waitlist'])assert.equal((await pool.query(`SELECT 1 FROM ${table} WHERE event_id=$1`,[eventId])).rowCount,0);
});

for(const action of ['register','join','accept'])test(`retained guest capability cannot ${action} in member mode or create a receipt`,async()=>{
  const token=await capability();await memberOnly();
  await assert.rejects(guestAction(token,action),denied('event_member_required'));
  assert.equal((await pool.query('SELECT 1 FROM community_event_guest_commands WHERE event_id=$1',[eventId])).rowCount,0);
  assert.equal(await countEventSeats(pool,eventId),0);
});

test('current guest policy precedes receipt replay while retained history, recovery and cancellation remain usable',async()=>{
  const token=await capability();const admitted=await guestAction(token,'register');await memberOnly();
  await assert.rejects(mutateGuestEventParticipation(pool,eventId,token,admitted.body,admitted.key),denied('event_member_required'));
  assert.equal((await readGuestEventParticipation(pool,eventId,token)).rsvp_state,'going');
  await requestGuestEventParticipation(pool,eventId,{name:'合成訪客',email:'guest@local.test'},send,origin);assert.equal(sent,1);
  assert.equal((await guestAction(token,'cancel')).result.rsvp_state,'cancelled');assert.equal(await countEventSeats(pool,eventId),0);
});

test('reconciliation withdraws unconsumed guest offers and never mails a member-only guest invitation',async()=>{
  const first=await capability('first@local.test'),second=await capability('second@local.test');
  await guestAction(first,'join');await guestAction(second,'join');await memberOnly();
  await transaction(pool,q=>reconcileEventWaitlist(q,eventId));await processEventWaitlist(pool,send,origin,undefined,eventId);
  assert.equal((await readGuestEventParticipation(pool,eventId,first)).waitlist?.status,'cancelled');
  assert.equal((await readGuestEventParticipation(pool,eventId,second)).waitlist?.status,'cancelled');
  assert.equal(sent,0);assert.equal(await countEventSeats(pool,eventId),0);
});

test('same-community members register idempotently without guild membership and competing last-seat requests cannot overbook',async()=>{
  await memberOnly();const first=command(1,`POST /events/${eventId}/rsvp`,{going:true});
  await setRsvp(pool,first,eventId,true);await setRsvp(pool,first,eventId,true);
  assert.equal(await countEventSeats(pool,eventId),1);
  await assert.rejects(setRsvp(pool,command(2,`POST /events/${eventId}/rsvp`,{going:true}),eventId,true),denied('event_full'));
  await setRsvp(pool,command(1,`POST /events/${eventId}/rsvp`,{going:false}),eventId,true);
  const results=await Promise.allSettled([1,2].map(index=>setRsvp(pool,command(index,`POST /events/${eventId}/rsvp`,{going:true}),eventId,true)));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(await countEventSeats(pool,eventId),1);
});

test('member waitlist admission and acceptance work in member mode',async()=>{
  await memberOnly();const before=await readEventParticipation(pool,actors[1],eventId);
  const joined=await mutateEventWaitlist(pool,command(1,`POST /events/${eventId}/waitlist`,{action:'join'},before.event_version),eventId);
  assert.equal(joined.waitlist?.status,'invited');
  const accepted=await mutateEventWaitlist(pool,command(1,`POST /events/${eventId}/waitlist`,{action:'accept'},joined.event_version),eventId);
  assert.equal(accepted.rsvp_state,'going');assert.equal(await countEventSeats(pool,eventId),1);
});

test('another community event cannot be joined using an authenticated account or a spoofed request field',async()=>{
  await memberOnly();const other=randomUUID();await pool.query("INSERT INTO communities(community_id,name) VALUES($1,'合成另一社群')",[other]);
  await pool.query('UPDATE community_events SET community_id=$2 WHERE event_id=$1',[eventId,other]);
  await assert.rejects(setRsvp(pool,command(1,`POST /events/${eventId}/rsvp`,{going:true}),eventId),denied('not_found'));
  await assert.rejects(readEventParticipation(pool,actors[1],eventId),denied('not_found'));
  await assert.rejects(setRsvp(pool,command(1,`POST /events/${eventId}/rsvp`,{going:true,community_id:other}),eventId));
  assert.equal(await countEventSeats(pool,eventId),0);
});

test('creation policy is explicit, legacy omission defaults guest, and pending owner edits preserve omission',async()=>{
  const legacy=await createEvent(pool,command(0,'POST /events',details()));assert.equal(legacy.registration_policy,'guest_allowed');
  const created=await createEvent(pool,command(0,'POST /events',{...details(),registration_policy:'community_member'}));assert.equal(created.registration_policy,'community_member');
  const updated=await updateEvent(pool,command(0,`PUT /events/${created.event_id}`,details(),Number(created.aggregate_version)),created.event_id);
  assert.equal(updated.registration_policy,'community_member');
  await assert.rejects(updateEvent(pool,command(1,`PUT /events/${created.event_id}`,{...details(),registration_policy:'guest_allowed'},Number(updated.aggregate_version)),created.event_id),denied('organizer_required'));
  const changed=await updateEvent(pool,command(0,`PUT /events/${created.event_id}`,{...details(),registration_policy:'guest_allowed'},Number(updated.aggregate_version)),created.event_id);assert.equal(changed.registration_policy,'guest_allowed');
  await pool.query("UPDATE community_events SET state='published' WHERE event_id=$1",[created.event_id]);
  await assert.rejects(updateEvent(pool,command(0,`PUT /events/${created.event_id}`,{...details(),registration_policy:'community_member'},Number(changed.aggregate_version)),created.event_id),denied('event_closed'));
});

test('policy rejects unknown values at schema and database boundaries',async()=>{
  await assert.rejects(createEvent(pool,command(0,'POST /events',{...details(),registration_policy:'partner_verified'})));
  await assert.rejects(pool.query("UPDATE community_events SET registration_policy='partner_verified' WHERE event_id=$1",[eventId]),(error:any)=>error.code==='23514');
});


test('HTTP guest admission is blocked with participation ON or OFF without exposing tokens or contacts',async()=>{
  const token=await capability();await memberOnly();
  for(const enabled of [false,true]){
    const app=createApp(pool,origin,'local',{eventParticipationEnabled:enabled,eventEmailSender:send});
    const metadata=await app.request(`${origin}/api/v1/public/events/${eventId}`);assert.equal(metadata.status,200);
    for(const suffix of enabled?['register','participation-request']:['register']){
      const response=await app.request(`${origin}/api/v1/public/events/${eventId}/${suffix}`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'合成訪客',email:`http-${enabled}-${suffix}@local.test`})});
      assert.equal(response.status,403);const body=await response.text();assert.match(body,/event_member_required/);assert.ok(!body.includes(token));assert.ok(!body.includes('@local.test'));
    }
    if(enabled){
      for(const action of ['register','join','accept']){
        const version=(await readGuestEventParticipation(pool,eventId,token)).event_version;
        const response=await app.request(`${origin}/api/v1/public/events/${eventId}/participation`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Event-Participation-Token':token,'If-Match':`"${version}"`,'Idempotency-Key':randomUUID()},body:JSON.stringify({action,expected_version:version})});
        assert.equal(response.status,403);assert.match(await response.text(),/event_member_required/);
      }
    }
  }
  assert.equal(sent,0);assert.equal(await countEventSeats(pool,eventId),0);
});

test('revoked member session cannot replay a successful community registration',async()=>{
  await memberOnly();const input=command(1,`POST /events/${eventId}/rsvp`,{going:true});await setRsvp(pool,input,eventId);
  await pool.query('UPDATE sessions SET revoked_at=now() WHERE token_hash=$1',[actors[1].session_hash]);
  await assert.rejects(setRsvp(pool,input,eventId),denied('session_expired'));
  assert.equal(await countEventSeats(pool,eventId),1,'revocation does not rewrite historical participation');
});


test('valid referral and management tokens do not bypass member policy or commit verification on denied admission',async()=>{
  await pool.query("UPDATE community_events SET visibility='referral' WHERE event_id=$1",[eventId]);
  const {code}=await getEventShareCode(pool,actors[0],eventId);
  const token=await transaction(pool,q=>ensureGuestCapability(q,eventId,{name:'合成訪客',email:'referral@local.test',referral_code:code}));
  await memberOnly();
  assert.equal((await publicEvent(pool,eventId)).location,'登入並完成報名後可查看參與資料');
  await assert.rejects(registerPublicEvent(pool,eventId,{name:'合成訪客',email:'referral@local.test',referral_code:code},send,origin,true),denied('event_member_required'));
  await assert.rejects(requestGuestEventParticipation(pool,eventId,{name:'合成訪客',email:'referral@local.test',referral_code:code},send,origin),denied('event_member_required'));
  await assert.rejects(mutateGuestEventParticipation(pool,eventId,token,{action:'register',expected_version:1,referral_code:code},randomUUID()),denied('event_member_required'));
  assert.equal((await pool.query('SELECT verified_at FROM community_event_guest_capabilities WHERE event_id=$1',[eventId])).rows[0].verified_at,null);
  assert.equal(sent,0);assert.equal(await countEventSeats(pool,eventId),0);
});
