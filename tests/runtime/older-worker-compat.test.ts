import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import type {Hono} from 'hono';
import {z} from 'zod';
import {createPool,LOCAL_DATABASE_URL,transaction} from '../../packages/db/index.js';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_USERS,DEMO_PASSWORD,DEMO_COMMUNITY} from '../../packages/testing/seed.js';
import {createApp} from '../../apps/platform-api/src/app.js';
import {ensureGuestCapability,processEventNotices} from '../../modules/community/event-waitlist.js';
import {notifyEventRegistrants} from '../../modules/community/event-changes.js';
import {eventNoticeAccessSql} from '../../modules/member-communications/notifications.js';
import type {Actor} from '../../modules/identity-membership/service.js';

const origin='http://127.0.0.1:46499';
const url=process.env.TEST_DATABASE_URL??LOCAL_DATABASE_URL;
const schema=`fp_older_worker_${process.pid}_${Date.now()}`;
const admin=createPool(url);
const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`,max:8});
let app:Hono<{Variables:{actor:Actor}}>;
type Session={cookie:string;csrf:string};
let sessions:Session[]=[];

// Copied verbatim from origin/main:modules/community/events.ts (setRsvp).
const oldMemberRsvp=`INSERT INTO community_event_rsvps(rsvp_id,event_id,user_id,state,referred_by_user_id,confirmed_at) VALUES($1,$2,$3,$4,$5,CASE WHEN $4='going' THEN now() END)
      ON CONFLICT(event_id,user_id) DO UPDATE SET state=EXCLUDED.state,confirmed_at=COALESCE(community_event_rsvps.confirmed_at,EXCLUDED.confirmed_at),
        referred_by_user_id=COALESCE(community_event_rsvps.referred_by_user_id,EXCLUDED.referred_by_user_id),
        aggregate_version=community_event_rsvps.aggregate_version+1,updated_at=now()
      RETURNING rsvp_id,aggregate_version`;

const errorBody=z.object({code:z.string(),detail:z.string()}).passthrough();

async function postJson(route:string,body:unknown,session?:Session,extraHeaders:Record<string,string>={}){
  const headers:Record<string,string>={Origin:origin,'Content-Type':'application/json','Idempotency-Key':randomUUID(),...extraHeaders};
  if(session){headers.Cookie=session.cookie;headers['X-CSRF-Token']=session.csrf;}
  const res=await app.request(origin+route,{method:'POST',headers,body:JSON.stringify(body)});
  return {status:res.status,data:await res.json() as Record<string,unknown>};
}

before(async()=>{
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
  app=createApp(pool,origin,'local',{eventParticipationEnabled:true,eventEmailSender:async()=>{}});
});

after(async()=>{
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

beforeEach(async()=>{
  await pool.query('TRUNCATE communities,login_attempts,auth_rate_limits CASCADE');
  await seedLocal(pool);
  sessions=[];
  for(const user of DEMO_USERS){
    const res=await app.request(origin+'/api/v1/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:user.email,password:DEMO_PASSWORD})});
    assert.equal(res.status,200);
    const data=z.object({csrf_token:z.string()}).parse(await res.json());
    sessions.push({cookie:res.headers.get('set-cookie')!.split(';')[0],csrf:data.csrf_token});
  }
});

test('1. external-only event rejects older Worker RSVP writes with 23514 while preserving 409 routes, cancel, and platform RSVP',async()=>{
  const externalId=randomUUID(),platformId=randomUUID(),organizer=DEMO_USERS[0].user_id,member=DEMO_USERS[1].user_id;
  await pool.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,state,visibility,waitlist_enabled,response_window_minutes,registration_mode,external_registration_url)
    VALUES($1,$2,$3,'Synthetic external event','Details','2099-01-01T10:00:00Z','2099-01-01T11:00:00Z','in_person','Location','published','open',true,30,'external','https://example.org/register')`,[externalId,DEMO_COMMUNITY,organizer]);
  await pool.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,state,visibility,waitlist_enabled,response_window_minutes,registration_mode)
    VALUES($1,$2,$3,'Synthetic platform event','Details','2099-01-01T10:00:00Z','2099-01-01T11:00:00Z','in_person','Location','published','open',true,30,'platform')`,[platformId,DEMO_COMMUNITY,organizer]);

  // Older Worker member RSVP write fails with SQLSTATE 23514.
  await assert.rejects(
    pool.query(oldMemberRsvp,[randomUUID(),externalId,member,'going',null]),
    (err:{code?:string})=>err.code==='23514'
  );

  // Older Worker guest RSVP writes (pending/going) fail with SQLSTATE 23514.
  const guestEmail=`${randomUUID()}@example.invalid`;
  await assert.rejects(
    pool.query("INSERT INTO community_event_guest_rsvps(event_id,email,name,state) VALUES($1,$2,'Synthetic guest','pending')",[externalId,guestEmail]),
    (err:{code?:string})=>err.code==='23514'
  );
  await assert.rejects(
    pool.query("INSERT INTO community_event_guest_rsvps(event_id,email,name,state,confirmed_at) VALUES($1,$2,'Synthetic guest','going',now())",[externalId,guestEmail]),
    (err:{code?:string})=>err.code==='23514'
  );

  // Update of state back to going on an existing cancelled RSVP fails with 23514, while cancelling stays allowed.
  await pool.query(oldMemberRsvp,[randomUUID(),externalId,member,'cancelled',null]);
  await assert.rejects(
    pool.query('UPDATE community_event_rsvps SET state=$3 WHERE event_id=$1 AND user_id=$2',[externalId,member,'going']),
    (err:{code?:string})=>err.code==='23514'
  );
  await pool.query("INSERT INTO community_event_guest_rsvps(event_id,email,name,state) VALUES($1,$2,'Synthetic guest','cancelled')",[externalId,guestEmail]);
  await assert.rejects(
    pool.query('UPDATE community_event_guest_rsvps SET state=$3 WHERE event_id=$1 AND email=$2',[externalId,guestEmail,'going']),
    (err:{code?:string})=>err.code==='23514'
  );

  // Current Worker routes return 409 with today's message.
  const memberRes=await postJson(`/api/v1/events/${externalId}/rsvp`,{going:true},sessions[1]);
  assert.equal(memberRes.status,409);
  const memberErr=errorBody.parse(memberRes.data);
  assert.equal(memberErr.code,'external_registration');
  assert.equal(memberErr.detail,'請到原站報名。');

  const guestRes=await postJson(`/api/v1/public/events/${externalId}/register`,{name:'Synthetic guest',email:guestEmail});
  assert.equal(guestRes.status,409);
  const guestErr=errorBody.parse(guestRes.data);
  assert.equal(guestErr.code,'external_registration');
  assert.equal(guestErr.detail,'請到原站報名。');

  const waitlistRes=await postJson(`/api/v1/events/${externalId}/waitlist`,{action:'join'},sessions[1],{'If-Match':'"1"'});
  assert.equal(waitlistRes.status,409);
  const waitlistErr=errorBody.parse(waitlistRes.data);
  assert.equal(waitlistErr.code,'external_registration');
  assert.equal(waitlistErr.detail,'請到原站報名。');

  // Cancelling via current route on external event stays possible.
  const cancelRes=await postJson(`/api/v1/events/${externalId}/rsvp`,{going:false},sessions[1]);
  assert.equal(cancelRes.status,200);

  // Platform-registration event RSVP still works on both routes and older SQL.
  const platformRes=await postJson(`/api/v1/events/${platformId}/rsvp`,{going:true},sessions[1]);
  assert.equal(platformRes.status,200);
  await pool.query(oldMemberRsvp,[randomUUID(),platformId,DEMO_USERS[2].user_id,'going',null]);
  assert.equal((await pool.query('SELECT state FROM community_event_rsvps WHERE event_id=$1 AND user_id=$2',[platformId,DEMO_USERS[2].user_id])).rows[0].state,'going');
});

test('2. guest announcements are invisible to the older pending query and delivered once by the current sender',async()=>{
  const eventId=randomUUID(),organizer=DEMO_USERS[0].user_id,email=`${randomUUID()}@example.invalid`;
  await pool.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,state,visibility)
    VALUES($1,$2,$3,'Synthetic platform event','Details','2099-01-01T10:00:00Z','2099-01-01T11:00:00Z','in_person','Location','published','open')`,[eventId,DEMO_COMMUNITY,organizer]);
  await transaction(pool,q=>ensureGuestCapability(q,eventId,{email,name:'Synthetic guest'}));
  await pool.query('UPDATE community_event_guest_capabilities SET verified_at=now() WHERE event_id=$1 AND email=$2',[eventId,email]);
  await pool.query("INSERT INTO community_event_guest_rsvps(event_id,email,name,state,confirmed_at) VALUES($1,$2,'Synthetic guest','going',now())",[eventId,email]);

  const eventRow=(await pool.query('SELECT * FROM community_events WHERE event_id=$1',[eventId])).rows[0];
  await transaction(pool,q=>notifyEventRegistrants(q,eventRow,'event_announcement','Synthetic private content'));

  const initial=(await pool.query("SELECT status,attempted_at FROM community_event_participation_notices WHERE event_id=$1 AND kind='event_announcement'",[eventId])).rows;
  assert.equal(initial.length,1);
  assert.equal(initial[0].status,'queued');
  assert.equal(initial[0].attempted_at,null);

  // Copied verbatim from origin/main:modules/community/event-waitlist.ts.
  const oldPending="SELECT notice_id,event_id FROM community_event_participation_notices WHERE status='pending' AND ($1::uuid IS NULL OR event_id=$1) ORDER BY notice_id LIMIT 100";
  const visible=(await pool.query(oldPending,[eventId])).rows;
  assert.equal(visible.length,0);

  const delivered:Array<{to:string;subject:string;body:string}>=[];
  const send=async(to:string,subject:string,body:string)=>{delivered.push({to,subject,body});};
  const first=await processEventNotices(pool,send,origin,eventId);
  assert.deepEqual(first,{provider_accepted:1,failed:0});
  assert.equal(delivered.length,1);
  assert.equal(delivered[0].to,email);

  const afterSend=(await pool.query("SELECT status,attempted_at FROM community_event_participation_notices WHERE event_id=$1 AND kind='event_announcement'",[eventId])).rows[0];
  assert.equal(afterSend.status,'provider_accepted');
  assert.ok(afterSend.attempted_at!==null);

  const second=await processEventNotices(pool,send,origin,eventId);
  assert.deepEqual(second,{provider_accepted:0,failed:0});
  assert.equal(delivered.length,1);

  // Schedule changes still write pending and deliver as before.
  await pool.query('UPDATE community_events SET aggregate_version=aggregate_version+1 WHERE event_id=$1',[eventId]);
  const updatedRow=(await pool.query('SELECT * FROM community_events WHERE event_id=$1',[eventId])).rows[0];
  await transaction(pool,q=>notifyEventRegistrants(q,updatedRow,'event_schedule_changed'));
  const sched=(await pool.query("SELECT status FROM community_event_participation_notices WHERE event_id=$1 AND kind='event_schedule_changed'",[eventId])).rows[0];
  assert.equal(sched.status,'pending');
  const third=await processEventNotices(pool,send,origin,eventId);
  assert.deepEqual(third,{provider_accepted:1,failed:0});
  assert.equal((await pool.query("SELECT status FROM community_event_participation_notices WHERE event_id=$1 AND kind='event_schedule_changed'",[eventId])).rows[0].status,'provider_accepted');
});

// Accepted by lead decision: already delivered while member had access; current Worker hides it after access ends.
test('3. delivered announcement remains visible to older notifications query after access ends while current Worker hides it',async()=>{
  const eventId=randomUUID(),organizer=DEMO_USERS[0].user_id,recipient=DEMO_USERS[1].user_id;
  await pool.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,state,visibility)
    VALUES($1,$2,$3,'Synthetic platform event','Details','2099-01-01T10:00:00Z','2099-01-01T11:00:00Z','in_person','Location','published','open')`,[eventId,DEMO_COMMUNITY,organizer]);
  await pool.query(oldMemberRsvp,[randomUUID(),eventId,recipient,'going',null]);
  const eventRow=(await pool.query('SELECT * FROM community_events WHERE event_id=$1',[eventId])).rows[0];
  await transaction(pool,q=>notifyEventRegistrants(q,eventRow,'event_announcement','Synthetic private content'));

  const before=(await pool.query(`SELECT ${eventNoticeAccessSql} AS allowed FROM (SELECT 'event_announcement'::text kind,$3::text action_resource_id) n`,[DEMO_COMMUNITY,recipient,eventId])).rows[0].allowed;
  assert.equal(before,true);
  const currentBefore=await app.request(origin+'/api/v1/me/notifications',{headers:{Cookie:sessions[1].cookie}});
  assert.equal(currentBefore.status,200);
  const notificationListSchema=z.object({items:z.array(z.object({kind:z.string(),action:z.object({tab:z.string(),resource_id:z.string().nullish()}).nullable()}))});
  const itemsBefore=notificationListSchema.parse(await currentBefore.json()).items;
  assert.ok(itemsBefore.some(row=>row.kind==='event_announcement'&&row.action?.resource_id===eventId));

  await pool.query("UPDATE community_events SET state='pending' WHERE event_id=$1",[eventId]);

  // Copied from origin/main:modules/member-communications/service.ts, with
  // notificationVisibilitySQL(true) interpolated as the literal TRUE.
  const oldNotifications=`SELECT notification_id,kind,title,body,created_at,read_at,action_tab,action_resource_id FROM member_notifications
      WHERE community_id=$1 AND recipient_ref=$2 AND TRUE ORDER BY created_at DESC,notification_id DESC LIMIT $3 OFFSET $4`;
  const oldRows=(await pool.query(oldNotifications,[DEMO_COMMUNITY,recipient,51,0])).rows;
  assert.ok(oldRows.some(row=>row.kind==='event_announcement'&&row.action_resource_id===eventId));

  const current=(await pool.query(`SELECT ${eventNoticeAccessSql} AS allowed FROM (SELECT 'event_announcement'::text kind,$3::text action_resource_id) n`,[DEMO_COMMUNITY,recipient,eventId])).rows[0].allowed;
  assert.equal(current,false);
  const currentAfter=await app.request(origin+'/api/v1/me/notifications',{headers:{Cookie:sessions[1].cookie}});
  assert.equal(currentAfter.status,200);
  const itemsAfter=notificationListSchema.parse(await currentAfter.json()).items;
  assert.equal(itemsAfter.some(row=>row.kind==='event_announcement'&&row.action?.resource_id===eventId),false);
});
