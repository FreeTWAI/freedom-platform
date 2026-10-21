import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {scheduler} from 'node:timers/promises';
import {once} from 'node:events';
import {serve} from '@hono/node-server';
import {Pool} from 'pg';
import type {Hono} from 'hono';
import {z} from 'zod';
import {authenticate,type Actor} from '../../modules/identity-membership/service.js';
import {Problem} from '../../packages/shared/problem.js';
import {readEventParticipation,reconcileEventWaitlist,countEventSeats} from '../../modules/community/event-waitlist.js';
import {readEventReminder} from '../../modules/community/event-reminders.js';
import {readMemberEventCalendar,readGuestEventCalendar} from '../../modules/community/event-calendar.js';
import {createPool,transaction} from '../../packages/db/index.js';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_USERS,DEMO_PASSWORD,DEMO_COMMUNITY} from '../../packages/testing/seed.js';
import {createApp} from '../../apps/platform-api/src/app.js';

const origin='http://127.0.0.1:4310';
const databaseUrl=process.env.TEST_DATABASE_URL;
const schema=`fp_participation_api_${process.pid}_${Date.now()}`;
let admin:Pool,pool:Pool,app:Hono<{Variables:{actor:Actor}}>,off:Hono<{Variables:{actor:Actor}}>;
let createdSchema=false;
type Session={cookie:string;csrf:string};
type Mail={to:string;body:string};
let sessions:Session[],mail:Mail[],eventId:string;
const starts='2099-03-14T06:30:00.000Z',ends='2099-03-14T08:30:00.000Z';
const privateLocation='合成私人教室',privateOnline='https://meeting.local.test/private-room';
const calendarProperty=(calendar:string,name:string)=>calendar.replace(/\r\n[ \t]/g,'').split('\r\n').find(line=>line.startsWith(name+':'))?.slice(name.length+1);
const responseBody=z.object({code:z.string().optional(),event_version:z.number().optional(),version:z.number().optional(),calendar:z.string().optional(),rsvp_state:z.string().nullable().optional(),enabled:z.boolean().optional()}).passthrough();
before(async()=>{
  assert.ok(databaseUrl,'TEST_DATABASE_URL must explicitly name an isolated test database');
  admin=createPool(databaseUrl);
  pool=new Pool({connectionString:databaseUrl,options:`-c search_path=${schema}`,max:8});
  await admin.query(`CREATE SCHEMA ${schema}`);createdSchema=true;
  await migrate(pool);
  const eventEmailSender=async(to:string,_subject:string,body:string)=>{mail.push({to,body});};
  app=createApp(pool,origin,'local',{eventParticipationEnabled:true,eventEmailSender});
  off=createApp(pool,origin,'local',{eventParticipationEnabled:false,eventEmailSender});
});
after(async()=>{
  if(pool)await pool.end();
  if(admin){try{if(createdSchema)await admin.query(`DROP SCHEMA ${schema} CASCADE`);}finally{await admin.end();}}
});
beforeEach(async()=>{
  await pool.query('TRUNCATE communities,login_attempts,auth_rate_limits CASCADE');await seedLocal(pool);
  mail=[];sessions=[];
  for(const user of DEMO_USERS){
    const response=await app.request(origin+'/api/v1/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:user.email,password:DEMO_PASSWORD})});
    assert.equal(response.status,200);
    const data=z.object({csrf_token:z.string()}).parse(await response.json());
    sessions.push({cookie:response.headers.get('set-cookie')!.split(';')[0],csrf:data.csrf_token});
  }
  eventId=await event();
});
async function event(visibility='open'){
  const id=randomUUID();
  await pool.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,online_url,capacity,state,visibility)
    VALUES($1,$2,$3,'合成 API 活動','隔離 API 驗證',$4,$5,'online',$6,$7,NULL,'published',$8)`,[id,DEMO_COMMUNITY,DEMO_USERS[0].user_id,starts,ends,privateLocation,privateOnline,visibility]);
  return id;
}
function path(id=eventId,suffix='participation',publicRoute=true){return `/api/v1/${publicRoute?'public/':''}events/${id}/${suffix}`;}
async function call(route:string,options:{method?:string;body?:unknown;token?:string;session?:Session;headers?:Record<string,string>;application?:typeof app}={}){
  const headers:Record<string,string>={};
  if(options.method){headers.Origin=origin;headers['Content-Type']='application/json';}
  if(options.token)headers['X-Event-Participation-Token']=options.token;
  if(options.session){headers.Cookie=options.session.cookie;headers['X-CSRF-Token']=options.session.csrf;}
  Object.assign(headers,options.headers);
  const response=await (options.application??app).request(origin+route,{method:options.method??'GET',headers,body:options.body===undefined?undefined:JSON.stringify(options.body)});
  return {status:response.status,headers:response.headers,data:responseBody.parse(await response.json())};
}
function clean(value:unknown,secrets:string[]=[]){
  const encoded=JSON.stringify(value);
  assert.equal(secrets.some(secret=>encoded.includes(secret)),false,'response must not disclose private credentials or contact values');
  const visit=(item:unknown)=>{if(item&&typeof item==='object')for(const [key,child] of Object.entries(item)){assert.equal(/^(email|guest_email|name|token|token_secret|token_hash|contact|contacts)$/i.test(key),false,'private contact/capability field must not be returned');visit(child);}};
  visit(value);
}
async function guest(id=eventId,email='guest@local.test',register=true,referral_code?:string){
  const route=path(id,register?'register':'participation-request');
  const result=await call(route,{method:'POST',body:{name:'合成訪客',email,...(referral_code?{referral_code}:{})}});
  assert.equal(result.status,200);clean(result.data,[email]);
  const sent=mail.filter(item=>item.to===email).at(-1);assert.ok(sent);
  const match=sent.body.match(/#participation=([A-Za-z0-9_-]{43})(?:\s|$)/);assert.ok(match,'capability is obtained only from the injected private mailbox');
  return {token:match[1],email};
}
async function mutate(token:string,action:string,id=eventId,key=randomUUID(),referral_code?:string){
  const current=await call(path(id),{token});assert.equal(current.status,200);
  const body={action,expected_version:current.data.event_version,...(referral_code?{referral_code}:{})};
  const headers={'If-Match':`"${body.expected_version}"`,'Idempotency-Key':key};
  return {result:await call(path(id),{method:'POST',token,body,headers}),body,headers,key};
}
async function reminder(token:string,config:Record<string,unknown>,id=eventId,key=randomUUID()){
  const current=await call(path(id,'reminder'),{token});assert.equal(current.status,200);
  const body={command_id:key,expected_version:current.data.version,...config};
  const headers={'If-Match':`"${body.expected_version}"`,'Idempotency-Key':key};
  return {result:await call(path(id,'reminder'),{method:'PATCH',token,body,headers}),body,headers,key};
}

test('feature OFF returns private non-indexable 404 before member or guest participation authorization',async()=>{
  for(const publicRoute of [true,false])for(const suffix of ['participation','calendar','reminder']){
    const result=await call(path(eventId,suffix,publicRoute),{application:off});
    assert.equal(result.status,404);assert.equal(result.data.code,'not_found');
    assert.match(result.headers.get('Cache-Control')??'',/no-store/);assert.match(result.headers.get('X-Robots-Tag')??'',/noindex/);
  }
  for(const [suffix,method] of [['participation','POST'],['reminder','PATCH'],['participation-request','POST']]){
    const result=await call(path(eventId,suffix),{application:off,method,body:{}});
    assert.equal(result.status,404);assert.match(result.headers.get('Cache-Control')??'',/no-store/);assert.match(result.headers.get('X-Robots-Tag')??'',/noindex/);
  }
  assert.equal(mail.length,0);
  assert.equal((await pool.query('SELECT count(*)::int AS total FROM community_event_guest_capabilities')).rows[0].total,0);
});

test('guest capability authorizes only own exact public routes, without member CSRF and with the repository browser-origin policy',async()=>{
  const g=await guest();
  for(const suffix of ['participation','calendar','reminder']){
    assert.equal((await call(path(eventId,suffix,false),{token:g.token})).status,401);
    const own=await call(path(eventId,suffix),{token:g.token});assert.equal(own.status,200);clean(own.data,[g.token,g.email]);
    assert.equal((await call(path(eventId,suffix))).status,404);
    assert.equal((await call(path(eventId,suffix),{session:sessions[0]})).status,404);
  }
  const current=(await call(path(),{token:g.token})).data;
  const body={action:'cancel',expected_version:current.event_version},headers={'If-Match':`"${current.event_version}"`,'Idempotency-Key':randomUUID()};
  for(const deniedOrigin of ['', 'https://attacker.local.test']){
    const result=await call(path(),{method:'POST',token:g.token,body,headers:{...headers,Origin:deniedOrigin}});
    assert.equal(result.status,403);assert.equal(result.data.code,'origin_rejected');
  }
  assert.equal((await pool.query('SELECT state FROM community_event_guest_rsvps WHERE event_id=$1 AND email=$2',[eventId,g.email])).rows[0].state,'going');
  const cancelled=await call(path(),{method:'POST',token:g.token,body,headers});assert.equal(cancelled.status,200);assert.equal(cancelled.data.rsvp_state,'cancelled');
  const localAliasReplay=await call(path(),{method:'POST',token:g.token,body,headers:{...headers,Origin:'http://localhost:4310'}});
  assert.equal(localAliasReplay.status,200);assert.deepEqual(localAliasReplay.data,cancelled.data);
  const memberWrite=await call(path(eventId,'rsvp',false),{method:'POST',token:g.token,body:{going:true},headers:{Cookie:sessions[1].cookie,'Idempotency-Key':randomUUID()}});
  assert.equal(memberWrite.status,403);
});

test('cross-event, wrong, malformed, query-only and Authorization capabilities disclose no participation',async()=>{
  const g=await guest(),other=await event();
  for(const suffix of ['participation','calendar','reminder']){
    for(const token of ['invalid', 'A'.repeat(43)])assert.equal((await call(path(eventId,suffix),{token})).status,404);
    assert.equal((await call(path(other,suffix),{token:g.token})).status,404);
    for(const query of [`?token=${g.token}`,`?participation=${g.token}`]){
      const denied=await call(path(eventId,suffix)+query);assert.equal(denied.status,404);clean(denied.data,[g.token,g.email]);
    }
    assert.equal((await call(path(eventId,suffix),{headers:{Authorization:`Bearer ${g.token}`}})).status,404);
  }
  assert.equal((await pool.query('SELECT count(*)::int AS total FROM community_event_guest_commands')).rows[0].total,0);
});

test('guest mutation preconditions reject missing, malformed, unsafe, mismatched and stale versions without side effects',async()=>{
  const g=await guest(eventId,'preconditions@local.test',false),current=(await call(path(),{token:g.token})).data;
  assert.ok(current.event_version);
  const body={action:'register',expected_version:current.event_version},key=randomUUID();
  for(const [version,status,code] of [[undefined,428,'version_required'],['1',400,'version_required'],['W/"1"',400,'version_required'],['"01"',400,'version_required'],['"9007199254740992"',400,'version_required'],[`"${current.event_version+1}"`,400,'version_mismatch']] as const){
    const result=await call(path(),{method:'POST',token:g.token,body,headers:{'Idempotency-Key':key,...(version?{'If-Match':version}:{})}});
    assert.equal(result.status,status);assert.equal(result.data.code,code);
  }
  for(const invalidKey of ['short','bad key value'])assert.equal((await call(path(),{method:'POST',token:g.token,body,headers:{'If-Match':`"${body.expected_version}"`,'Idempotency-Key':invalidKey}})).status,400);
  await pool.query('UPDATE community_events SET aggregate_version=aggregate_version+1 WHERE event_id=$1',[eventId]);
  const stale=await call(path(),{method:'POST',token:g.token,body,headers:{'If-Match':`"${body.expected_version}"`,'Idempotency-Key':key}});assert.equal(stale.status,412);
  assert.equal((await pool.query('SELECT count(*)::int AS total FROM community_event_guest_rsvps')).rows[0].total,0);
  assert.equal((await pool.query('SELECT count(*)::int AS total FROM community_event_guest_commands')).rows[0].total,0);
});

test('matching guest commands replay durably across app instances and changed bodies conflict without duplicate business writes',async()=>{
  const g=await guest(eventId,'durable@local.test',false);
  const current=await call(path(),{token:g.token}),key=randomUUID();
  const body={action:'register',expected_version:current.data.event_version};
  const headers={'If-Match':`"${body.expected_version}"`,'Idempotency-Key':key};
  const concurrent=await Promise.all([call(path(),{method:'POST',token:g.token,body,headers}),call(path(),{method:'POST',token:g.token,body,headers})]);
  assert.deepEqual(concurrent.map(result=>result.status),[200,200]);assert.deepEqual(concurrent[0].data,concurrent[1].data);
  const command={result:concurrent[0],body,headers};
  assert.equal(command.result.status,200);assert.equal(command.result.data.rsvp_state,'going');clean(command.result.data,[g.email,g.token]);
  const fresh=createApp(pool,origin,'local',{eventParticipationEnabled:true,eventEmailSender:async()=>{throw new Error('replay must not send');}});
  const replay=await call(path(),{application:fresh,method:'POST',token:g.token,body:command.body,headers:command.headers});assert.equal(replay.status,200);assert.deepEqual(replay.data,command.result.data);
  const conflict=await call(path(),{method:'POST',token:g.token,body:{...command.body,action:'cancel'},headers:command.headers});assert.equal(conflict.status,409);assert.equal(conflict.data.code,'idempotency_conflict');
  const receipts=(await pool.query('SELECT result FROM community_event_guest_commands WHERE event_id=$1',[eventId])).rows;
  assert.equal(receipts.length,1);clean(receipts,[g.email,g.token]);assert.deepEqual(receipts[0].result,command.result.data);
  const rsvp=(await pool.query('SELECT state,confirmed_at FROM community_event_guest_rsvps WHERE event_id=$1 AND email=$2',[eventId,g.email])).rows;
  assert.equal(rsvp.length,1);assert.equal(rsvp[0].state,'going');assert.ok(rsvp[0].confirmed_at);
  assert.equal(mail.length,1,'capability request does not become a second registration email on replay');
});

test('guest reminder receipts enforce preconditions, matching command key, own RSVP and durable replay',async()=>{
  const g=await guest(eventId,'reminder@local.test',false);
  const notGoing=await reminder(g.token,{enabled:true,minutes_before_start:30,channel:'email'});assert.equal(notGoing.result.status,409);assert.equal(notGoing.result.data.code,'rsvp_required');
  assert.equal((await mutate(g.token,'register')).result.status,200);
  const key=randomUUID(),body={command_id:key,expected_version:1,enabled:true,minutes_before_start:30,channel:'email'};
  for(const [version,status] of [[undefined,428],['1',400],['"2"',400]] as const){
    const result=await call(path(eventId,'reminder'),{method:'PATCH',token:g.token,body,headers:{'Idempotency-Key':key,...(version?{'If-Match':version}:{})}});assert.equal(result.status,status);
  }
  const mismatch=await call(path(eventId,'reminder'),{method:'PATCH',token:g.token,body,headers:{'If-Match':'"1"','Idempotency-Key':randomUUID()}});assert.equal(mismatch.status,400);assert.equal(mismatch.data.code,'idempotency_mismatch');
  const saved=await reminder(g.token,{enabled:true,minutes_before_start:30,channel:'email'});assert.equal(saved.result.status,200);assert.equal(saved.result.data.enabled,true);clean(saved.result.data,[g.token,g.email]);
  const disabled=await reminder(g.token,{enabled:false});assert.equal(disabled.result.status,200);assert.equal(disabled.result.data.enabled,false);
  const fresh=createApp(pool,origin,'local',{eventParticipationEnabled:true});
  const replay=await call(path(eventId,'reminder'),{application:fresh,method:'PATCH',token:g.token,body:saved.body,headers:saved.headers});assert.equal(replay.status,200);assert.deepEqual(replay.data,saved.result.data);
  const conflict=await call(path(eventId,'reminder'),{method:'PATCH',token:g.token,body:{...saved.body,minutes_before_start:60},headers:saved.headers});assert.equal(conflict.status,409);assert.equal(conflict.data.code,'idempotency_conflict');
  const state=(await pool.query('SELECT enabled,status,due_at FROM community_event_reminders WHERE event_id=$1',[eventId])).rows;
  assert.equal(state.length,1);assert.equal(state[0].enabled,false);assert.equal(state[0].status,'cancelled');assert.equal(state[0].due_at.toISOString(),'2099-03-14T06:00:00.000Z');
  const receipts=(await pool.query('SELECT result FROM community_event_reminder_receipts WHERE event_id=$1',[eventId])).rows;assert.equal(receipts.length,2);clean(receipts,[g.token,g.email]);
});

test('legal open and referral sources authorize private calendar data only after own RSVP; revoked and private sources fail closed',async()=>{
  const referral=await event('referral');
  const share=await call(path(referral,'share-code',false),{method:'POST',session:sessions[0],body:{},headers:{'Idempotency-Key':randomUUID()}});assert.equal(share.status,200);
  const code=z.string().parse(share.data.code),g=await guest(referral,'referral@local.test',false,code);
  const before=await call(path(referral,'calendar'),{token:g.token});assert.equal(before.status,200);
  assert.ok(before.data.calendar);
  assert.equal(calendarProperty(before.data.calendar,'LOCATION'),undefined);assert.equal(calendarProperty(before.data.calendar,'X-FREETWAI-ONLINE'),undefined);
  const memberBefore=await call(path(referral,'calendar',false),{session:sessions[1]});assert.equal(memberBefore.status,200);assert.ok(memberBefore.data.calendar);assert.equal(calendarProperty(memberBefore.data.calendar,'X-FREETWAI-ONLINE'),undefined);
  const registered=await mutate(g.token,'register',referral,randomUUID(),code);assert.equal(registered.result.status,200);
  const calendar=await call(path(referral,'calendar'),{token:g.token});assert.equal(calendar.status,200);clean(calendar.data,[g.token,g.email]);
  assert.ok(calendar.data.calendar);
  const text=calendar.data.calendar.replace(/\r\n[ \t]/g,'');assert.ok(text.includes(`UID:${referral}@freetwai.com\r\n`));assert.ok(text.includes(`SEQUENCE:${registered.result.data.event_version}\r\n`));assert.ok(text.includes('DTSTART:20990314T063000Z\r\n'));assert.ok(text.includes('DTEND:20990314T083000Z\r\n'));assert.equal(calendarProperty(text,'X-FREETWAI-ONLINE'),privateOnline);
  await pool.query('DELETE FROM community_event_share_codes WHERE event_id=$1',[referral]);
  for(const suffix of ['participation','calendar','reminder'])assert.equal((await call(path(referral,suffix),{token:g.token})).status,404);
  for(const visibility of ['workshop','guild']){
    const own=await guest(eventId,`${visibility}@local.test`,false);
    await pool.query("UPDATE community_events SET visibility=$2,event_kind=CASE WHEN $2='guild' THEN 'guild_skill_exchange' ELSE 'other' END,guild_key=CASE WHEN $2='guild' THEN 'guild_member_operations' ELSE NULL END WHERE event_id=$1",[eventId,visibility]);
    for(const suffix of ['participation','calendar','reminder'])assert.equal((await call(path(eventId,suffix),{token:own.token})).status,404);
    await pool.query("UPDATE community_events SET visibility='open' WHERE event_id=$1",[eventId]);
  }
  const hidden=await guest(eventId,'hidden@local.test',false);
  await pool.query('UPDATE users SET email=$2 WHERE user_id=$1',[DEMO_USERS[0].user_id,'synthetic-host@example.invalid']);
  for(const suffix of ['participation','calendar','reminder'])assert.equal((await call(path(eventId,suffix),{token:hidden.token})).status,404);
});

test('cancelled actual own participation remains accessible with stable calendar identity, but arbitrary cancellation rows are not history proof',async()=>{
  const g=await guest(),other=await guest(eventId,'no-history@local.test',false);
  const joined=await call(path(eventId,'rsvp',false),{method:'POST',session:sessions[1],body:{going:true},headers:{'Idempotency-Key':randomUUID()}});assert.equal(joined.status,200);
  const version=(await call(path(eventId,'participation',false),{session:sessions[0]})).data.event_version;
  assert.ok(version);
  const before=await call(path(eventId,'calendar'),{token:g.token});assert.equal(before.status,200);
  const cancelled=await call(path(eventId,'cancel',false),{method:'POST',session:sessions[0],body:{},headers:{'If-Match':`"${version}"`,'Idempotency-Key':randomUUID()}});assert.equal(cancelled.status,200);
  for(const suffix of ['participation','calendar','reminder']){
    assert.equal((await call(path(eventId,suffix),{token:g.token})).status,200);
    assert.equal((await call(path(eventId,suffix,false),{session:sessions[1]})).status,200);
    assert.equal((await call(path(eventId,suffix),{token:other.token})).status,404);
    assert.equal((await call(path(eventId,suffix,false),{session:sessions[2]})).status,404);
  }
  const calendar=await call(path(eventId,'calendar'),{token:g.token});assert.ok(calendar.data.calendar);
  const text=calendar.data.calendar.replace(/\r\n[ \t]/g,'');
  assert.ok(before.data.calendar);assert.equal(before.data.calendar.replace(/\r\n[ \t]/g,'').split('\r\n').find(line=>line.startsWith('UID:')),text.split('\r\n').find(line=>line.startsWith('UID:')));
  assert.ok(text.includes(`UID:${eventId}@freetwai.com\r\n`));assert.ok(text.includes('STATUS:CANCELLED\r\n'));assert.ok(text.includes(`SEQUENCE:${version+1}\r\n`));assert.equal(calendarProperty(text,'X-FREETWAI-ONLINE'),undefined);assert.equal(calendarProperty(text,'LOCATION'),undefined);
  await pool.query("INSERT INTO community_event_guest_rsvps(event_id,email,name,state) VALUES($1,$2,'合成取消列','cancelled')",[eventId,other.email]);
  await pool.query("INSERT INTO community_event_rsvps(rsvp_id,event_id,user_id,state) VALUES($1,$2,$3,'cancelled')",[randomUUID(),eventId,DEMO_USERS[2].user_id]);
  for(const suffix of ['participation','calendar','reminder']){
    assert.equal((await call(path(eventId,suffix),{token:other.token})).status,404);
    assert.equal((await call(path(eventId,suffix,false),{session:sessions[2]})).status,404);
  }
  const mailCount=mail.length;
  const request=await call(path(eventId,'participation-request'),{method:'POST',body:{email:other.email,name:'合成取消列'}});
  assert.equal(request.status,404,'a cancelled row without confirmation is not proof of previous participation');assert.equal(mail.length,mailCount);
});

for(const change of ['event_cancelled','rsvp_cancelled','no_history'] as const){
  test(`guest calendar uses current participation after a blocked ${change} transaction`,async()=>{
    const g=await guest(eventId,`${change}@local.test`,change!=='no_history');
    const applicationName=`fp_calendar_${randomUUID()}`;
    const reader=new Pool({connectionString:databaseUrl,options:`-c search_path=${schema} -c statement_timeout=10000`,application_name:applicationName,max:1});
    const locker=await pool.connect();
    let pending:Promise<{value:{calendar:string;filename:string}}|{error:unknown}>|undefined;
    try{
      await locker.query('BEGIN');
      const pid=(await locker.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await locker.query('SELECT 1 FROM community_events WHERE event_id=$1 FOR UPDATE',[eventId]);
      if(change==='rsvp_cancelled'){
        await locker.query("UPDATE community_event_guest_rsvps SET state='cancelled' WHERE event_id=$1 AND email=$2",[eventId,g.email]);
      }else{
        await locker.query("UPDATE community_events SET state='cancelled',aggregate_version=aggregate_version+1 WHERE event_id=$1",[eventId]);
      }
      await locker.query('SELECT 1 FROM community_event_guest_capabilities WHERE event_id=$1 AND email=$2 FOR UPDATE',[eventId,g.email]);
      pending=readGuestEventCalendar(reader,eventId,g.token).then(value=>({value}),error=>({error}));
      let waiting=false;
      for(let attempt=0;attempt<1000;attempt++){
        waiting=(await admin.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))',[applicationName,pid])).rowCount===1;
        if(waiting)break;
        await scheduler.yield();
      }
      assert.ok(waiting,'calendar must wait on the concurrent participation transaction');
      await locker.query('COMMIT');
      const outcome=await pending;
      if(change==='no_history'){
        assert.ok('error' in outcome&&outcome.error instanceof Problem&&outcome.error.status===404);
      }else{
        assert.ok('value' in outcome);
        assert.equal(calendarProperty(outcome.value.calendar,'STATUS'),change==='event_cancelled'?'CANCELLED':'CONFIRMED');
        assert.equal(calendarProperty(outcome.value.calendar,'LOCATION'),undefined);
        assert.equal(calendarProperty(outcome.value.calendar,'X-FREETWAI-ONLINE'),undefined);
        assert.equal(calendarProperty(outcome.value.calendar,'UID'),`${eventId}@freetwai.com`);
      }
    }finally{
      await locker.query('ROLLBACK');locker.release();
      await pending;await reader.end();
    }
  });
}


// Exercise the domain reads directly: HTTP authentication must not be their only fence.
const memberReads=[
  ['participation',readEventParticipation],
  ['reminder',readEventReminder],
  ['calendar',readMemberEventCalendar],
] as const;
for(const [name,read] of memberReads){
  test(`private member ${name} rejects a previously authenticated but revoked session`,async()=>{
    const actor=await authenticate(pool,sessions[1].cookie.slice(sessions[1].cookie.indexOf('=')+1));
    await pool.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1',[actor.session_hash]);
    await assert.rejects(read(pool,actor,eventId),error=>error instanceof Problem&&error.code==='session_expired');
  });
  test(`private member ${name} refreshes session expiry after a blocked source query`,async()=>{
    const actor=await authenticate(pool,sessions[1].cookie.slice(sessions[1].cookie.indexOf('=')+1));
    const applicationName=`${schema}_${name}_expiry`;
    const reader=new Pool({connectionString:databaseUrl,options:`-c search_path=${schema} -c statement_timeout=10000`,application_name:applicationName,max:1});
    const locker=await pool.connect();
    let pending:Promise<{value:unknown}|{error:unknown}>|undefined;
    try{
      await locker.query('BEGIN');
      await locker.query('LOCK TABLE community_events IN ACCESS EXCLUSIVE MODE');
      await pool.query("UPDATE sessions SET expires_at=clock_timestamp()+interval '2 seconds' WHERE token_hash=$1",[actor.session_hash]);
      pending=read(reader,actor,eventId).then(value=>({value}),error=>({error}));
      let waiting=false;
      for(let attempt=0;attempt<200;attempt++){
        waiting=(await admin.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[applicationName])).rowCount===1;
        if(waiting)break;
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      assert.ok(waiting,'read must reach the held source table after locking its session');
      await pool.query("SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM (expires_at-clock_timestamp())))+0.05) FROM sessions WHERE token_hash=$1",[actor.session_hash]);
      await locker.query('COMMIT');
      const outcome=await pending;
      assert.ok('error' in outcome&&outcome.error instanceof Problem&&outcome.error.code==='session_expired','expired read must not return private data');
    }finally{
      await locker.query('ROLLBACK');locker.release();
      await pending;await reader.end();
    }
  });
}

interface GuestHttp {
  configure(enabled:boolean,database?:Pool):void;
  request(route:string,options?:{body?:unknown;token?:string;headers?:Record<string,string>}):Promise<{status:number;headers:Headers;data:z.infer<typeof responseBody>}>;
  close():Promise<void>;
}
async function guestHttp(send:(to:string,subject:string,body:string)=>Promise<void>):Promise<GuestHttp>{
  let application=app;
  const server=serve({fetch:request=>application.fetch(request),hostname:'127.0.0.1',port:0});
  if(!server.listening)await once(server,'listening');
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const httpOrigin=`http://127.0.0.1:${address.port}`;
  const configure=(enabled:boolean,database:Pool=pool)=>{application=createApp(database,httpOrigin,'local',{eventParticipationEnabled:enabled,eventEmailSender:send});};
  configure(true);
  return {
    configure,
    async request(route:string,options:{body?:unknown;token?:string;headers?:Record<string,string>}={}){
      const headers:Record<string,string>={Origin:httpOrigin,...options.headers};
      if(options.body!==undefined)headers['Content-Type']='application/json';
      if(options.token)headers['X-Event-Participation-Token']=options.token;
      const response=await fetch(httpOrigin+route,{method:options.body===undefined?'GET':'POST',headers,body:options.body===undefined?undefined:JSON.stringify(options.body)});
      return {status:response.status,headers:response.headers,data:responseBody.parse(await response.json())};
    },
    close:()=>new Promise<void>((resolve,reject)=>{server.close(error=>error?reject(error):resolve());if('closeAllConnections' in server)server.closeAllConnections();}),
  };
}
async function httpInvitation(http:GuestHttp,email:string){
  const requested=await http.request(path(eventId,'participation-request'),{body:{name:'合成 TCP 候補訪客',email}});
  assert.equal(requested.status,200);clean(requested.data,[email]);
  const message=mail.filter(item=>item.to===email).at(-1);assert.ok(message);
  const match=message.body.match(/#participation=([A-Za-z0-9_-]{43})(?:\s|$)/);assert.ok(match);
  const token=match[1],current=await http.request(path(),{token});assert.equal(current.status,200);
  const joined=await http.request(path(),{token,body:{action:'join',expected_version:current.data.event_version},
    headers:{'If-Match':`"${current.data.event_version}"`,'Idempotency-Key':randomUUID()}});
  assert.equal(joined.status,200);
  return token;
}
async function assertHttpParticipationOff(http:GuestHttp,token:string){
  for(const suffix of ['participation','calendar','reminder']){
    const denied=await http.request(path(eventId,suffix),{token});
    assert.equal(denied.status,404);assert.equal(denied.data.code,'not_found');
    assert.match(denied.headers.get('Cache-Control')??'',/no-store/);
    assert.match(denied.headers.get('X-Robots-Tag')??'',/noindex/);
    clean(denied.data,[token,privateLocation,privateOnline]);
  }
}

for(const rejectFirst of [false,true])test(`TCP feature-OFF ordinary registration never credits an unswept expired invitation (provider retry=${rejectFirst})`,async()=>{
  let registration=false,sends=0;
  const http=await guestHttp(async(to,_subject,body)=>{
    mail.push({to,body});
    if(registration&&++sends===1&&rejectFirst)throw new Error('synthetic provider rejection');
  });
  try{
    await pool.query('UPDATE community_events SET capacity=1,waitlist_enabled=true,response_window_minutes=30 WHERE event_id=$1',[eventId]);
    const email='tcp-expired@local.test',token=await httpInvitation(http,email);
    const original=(await pool.query('SELECT invitation_id FROM community_event_waitlist WHERE event_id=$1 AND guest_email=$2',[eventId,email])).rows[0].invitation_id;
    assert.ok(original);
    await pool.query("UPDATE community_event_waitlist SET invited_at=clock_timestamp()-interval '2 seconds',expires_at=clock_timestamp()-interval '1 second' WHERE event_id=$1 AND guest_email=$2",[eventId,email]);
    http.configure(false);registration=true;
    await assertHttpParticipationOff(http,token);
    const body={name:'合成一般報名',email:email.toUpperCase()};
    let pendingAttempt:string|undefined;
    if(rejectFirst){
      const rejected=await http.request(path(eventId,'register'),{body});
      assert.equal(rejected.status,503);assert.equal(rejected.data.code,'event_email_delivery_failed');
      const pending=(await pool.query('SELECT state,registration_attempt_id,credited_invitation_id,email_sent_at FROM community_event_guest_rsvps WHERE event_id=$1 AND email=$2',[eventId,email])).rows[0];
      assert.equal(pending.state,'pending');assert.equal(pending.credited_invitation_id,null);assert.equal(pending.email_sent_at,null);
      pendingAttempt=pending.registration_attempt_id;
      assert.equal((await pool.query('SELECT status FROM community_event_waitlist WHERE event_id=$1 AND guest_email=$2',[eventId,email])).rows[0].status,'invited');
    }
    const accepted=await http.request(path(eventId,'register'),{body});
    assert.equal(accepted.status,200);assert.deepEqual(accepted.data,{registered:true,provider_status:'provider_accepted'});
    const rows=(await pool.query('SELECT state,registration_attempt_id,credited_invitation_id,email_sent_at FROM community_event_guest_rsvps WHERE event_id=$1 AND email=$2',[eventId,email])).rows;
    assert.equal(rows.length,1);assert.equal(rows[0].state,'going');assert.equal(rows[0].credited_invitation_id,null);assert.ok(rows[0].email_sent_at);
    if(pendingAttempt)assert.equal(rows[0].registration_attempt_id,pendingAttempt);
    assert.equal(sends,rejectFirst?2:1);
    assert.equal((await pool.query('SELECT status FROM community_event_waitlist WHERE event_id=$1 AND guest_email=$2',[eventId,email])).rows[0].status,'invited');
    await transaction(pool,q=>reconcileEventWaitlist(q,eventId));
    const offer=(await pool.query('SELECT status,invitation_id FROM community_event_waitlist WHERE event_id=$1 AND guest_email=$2',[eventId,email])).rows[0];
    assert.equal(offer.status,'expired');assert.equal(offer.invitation_id,original);assert.equal(await countEventSeats(pool,eventId),1);
    const publicRead=await http.request(`/api/v1/public/events/${eventId}`);assert.equal(publicRead.status,200);assert.equal(publicRead.data.attending_count,1);
    for(const message of mail.slice(-sends))assert.doesNotMatch(message.body,/#participation=|私人參與管理/);
    await assertHttpParticipationOff(http,token);
  }finally{await http.close();}
});

for(const participationEnabled of [false,true])for(const change of ['deadline','policy','both'] as const)test(`TCP retry retains exact admitted invitation across ${change} gap (participation=${participationEnabled})`,async()=>{
  let registration=false,sends=0;
  const http=await guestHttp(async(to,_subject,body)=>{
    mail.push({to,body});
    if(registration&&++sends===1)throw new Error('synthetic provider rejection');
  });
  try{
    await pool.query('UPDATE community_events SET capacity=1,waitlist_enabled=true,response_window_minutes=30 WHERE event_id=$1',[eventId]);
    const email='tcp-live@local.test',nextEmail='tcp-next@local.test',token=await httpInvitation(http,email);
    await httpInvitation(http,nextEmail);
    const original=(await pool.query('SELECT invitation_id,status FROM community_event_waitlist WHERE event_id=$1 AND guest_email=$2',[eventId,email])).rows[0];
    assert.equal(original.status,'invited');assert.ok(original.invitation_id);
    assert.equal((await pool.query('SELECT status FROM community_event_waitlist WHERE event_id=$1 AND guest_email=$2',[eventId,nextEmail])).rows[0].status,'queued');
    let gaps=0,admittedAttempt:string|undefined;
    // Delay only the committed admission boundary, not rate-limit transactions or SQL results.
    const gapPool=new Proxy(pool,{get(target,key){
      if(key!=='connect'){const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}
      return async()=>{
        const client=await target.connect();let admission=false;
        return new Proxy(client,{get(q,property){
          if(property!=='query'){const value=Reflect.get(q,property,q);return typeof value==='function'?value.bind(q):value;}
          return async(sql:string,values?:unknown[])=>{
            const result=await q.query(sql,values);
            if(sql.includes('INSERT INTO community_event_guest_rsvps')&&sql.includes('credited_invitation_id'))admission=true;
            if(sql==='COMMIT'&&admission&&gaps===0){
              gaps++;
              const admitted=(await pool.query('SELECT state,registration_attempt_id,credited_invitation_id FROM community_event_guest_rsvps WHERE event_id=$1 AND email=$2',[eventId,email])).rows[0];
              assert.equal(admitted.state,'pending');assert.equal(admitted.credited_invitation_id,original.invitation_id);admittedAttempt=admitted.registration_attempt_id;
              if(change!=='policy')await pool.query("UPDATE community_event_waitlist SET invited_at=clock_timestamp()-interval '2 seconds',expires_at=clock_timestamp()-interval '1 second' WHERE event_id=$1 AND guest_email=$2",[eventId,email]);
              if(change!=='deadline')await pool.query('UPDATE community_events SET waitlist_enabled=false,response_window_minutes=NULL WHERE event_id=$1',[eventId]);
              await transaction(pool,q=>reconcileEventWaitlist(q,eventId));
              assert.equal((await pool.query('SELECT status FROM community_event_waitlist WHERE event_id=$1 AND guest_email=$2',[eventId,email])).rows[0].status,'invited');
              assert.equal(await countEventSeats(pool,eventId),1);
            }
            return result;
          };
        }});
      };
    }});
    http.configure(participationEnabled,gapPool);registration=true;
    const body={name:'合成已獲邀 TCP 訪客',email:email.toUpperCase()};
    const rejected=await http.request(path(eventId,'register'),{body});
    assert.equal(rejected.status,503);assert.equal(rejected.data.code,'event_email_delivery_failed');assert.equal(gaps,1);
    const pending=(await pool.query('SELECT state,registration_attempt_id,credited_invitation_id,email_sent_at FROM community_event_guest_rsvps WHERE event_id=$1 AND email=$2',[eventId,email])).rows[0];
    assert.equal(pending.state,'pending');assert.equal(pending.registration_attempt_id,admittedAttempt);assert.equal(pending.credited_invitation_id,original.invitation_id);assert.equal(pending.email_sent_at,null);
    await transaction(pool,q=>reconcileEventWaitlist(q,eventId));
    const held=(await pool.query('SELECT status,invitation_id FROM community_event_waitlist WHERE event_id=$1 AND guest_email=$2',[eventId,email])).rows[0];
    assert.equal(held.status,'invited');assert.equal(held.invitation_id,original.invitation_id);
    const accepted=await http.request(path(eventId,'register'),{body});
    assert.equal(accepted.status,200);assert.deepEqual(accepted.data,{registered:true,provider_status:'provider_accepted'});assert.equal(sends,2);
    await transaction(pool,q=>reconcileEventWaitlist(q,eventId));
    const rows=(await pool.query('SELECT state,registration_attempt_id,credited_invitation_id,email_sent_at FROM community_event_guest_rsvps WHERE event_id=$1 AND email=$2',[eventId,email])).rows;
    assert.equal(rows.length,1);assert.equal(rows[0].state,'going');assert.ok(rows[0].email_sent_at);
    assert.equal(rows[0].registration_attempt_id,admittedAttempt);assert.equal(rows[0].credited_invitation_id,original.invitation_id);
    const final=(await pool.query('SELECT status,invitation_id FROM community_event_waitlist WHERE event_id=$1 AND guest_email=$2',[eventId,email])).rows[0];
    assert.equal(final.status,'accepted');assert.equal(final.invitation_id,original.invitation_id);
    assert.equal((await pool.query('SELECT status FROM community_event_waitlist WHERE event_id=$1 AND guest_email=$2',[eventId,nextEmail])).rows[0].status,change==='deadline'?'queued':'cancelled');
    assert.equal(await countEventSeats(pool,eventId),1);
    const publicRead=await http.request(`/api/v1/public/events/${eventId}`);assert.equal(publicRead.status,200);assert.equal(publicRead.data.attending_count,1);
    if(participationEnabled){
      const own=await http.request(path(),{token});assert.equal(own.status,200);assert.equal(own.data.rsvp_state,'going');
      assert.equal(z.object({status:z.string()}).parse(own.data.waitlist).status,'accepted');
    }else{
      await assertHttpParticipationOff(http,token);
      for(const message of mail.slice(-2))assert.doesNotMatch(message.body,/#participation=|私人參與管理/);
    }
  }finally{await http.close();}
});
