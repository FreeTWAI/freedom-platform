import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';
import {z} from 'zod';
import {memberCommand} from '../../packages/db/member-command.js';
import {checkVersion,journal} from '../../packages/db/index.js';
import {readWithMemberSession} from '../../packages/db/member-session.js';
import {Problem,requireCondition} from '../../packages/shared/problem.js';
import * as policy from '../../modules/community/event-attendance-state.js';
import {attendanceAck,attendancePage} from '../../apps/portal-web/src/modules/event-attendance-client.js';

const EVENT='10000000-0000-4000-8000-000000000001',HOST='20000000-0000-4000-8000-000000000001',MEMBER='30000000-0000-4000-8000-000000000001',PEER='30000000-0000-4000-8000-000000000002',COMMUNITY='40000000-0000-4000-8000-000000000001';
const source=readFileSync('modules/community/event-attendance.ts','utf8');
let forbiddenIO=0;
const noIO=()=>{forbiddenIO++;throw Error('No real I/O permitted in pure command test');};
// Execute the complete production domain module against a statement-aware model.
// Real command/session/receipt/transaction orchestration is retained. This does
// NOT prove PostgreSQL locks, isolation, constraints or database rollback.
const domain={exports:{} as any};
runInNewContext(transformSync(source,{loader:'ts',format:'cjs',target:'es2022'}).code,{
 module:domain,exports:domain.exports,fetch:noIO,console,Date,Map,Set,
 require(name:string){
  if(name==='node:crypto')return {randomUUID};if(name==='zod')return {z};
  if(name.endsWith('/db/index.js'))return {command:memberCommand,checkVersion,journal};
  if(name.endsWith('/db/member-session.js'))return {readWithMemberSession};
  if(name.endsWith('/shared/problem.js'))return {Problem,requireCondition};
  if(name.endsWith('/avatars.js'))return {avatarUrl:()=>'/api/v1/members/avatar'};
  if(name.endsWith('/onboarding.js'))return {lockMemberGuilds:async(q:any,a:any)=>q.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`guild-member/${a.community_id}/${a.user_id}`])};
  if(name==='./events.js')return {canAccessGuildEvent:async(q:any,a:any,e:any)=>e.visibility!=='guild'||a.user_id===e.organizer_ref||q.state.memberGuild,
   refuseInternGuildExchange:async(q:any)=>{requireCondition(q.state.hostTier!=='intern',403,'guild_full_member_required','full member required');}};
  if(name==='./event-attendance-state.js')return policy;
  throw Error('Unexpected module '+name);
 },
});
const {listEventAttendance,mutateEventAttendance}=domain.exports;
function fixture(){
 const state:any={event:{event_id:EVENT,community_id:COMMUNITY,organizer_ref:HOST,state:'published',starts_at:new Date('2020-01-01T00:00:00Z'),visibility:'workshop',guild_key:null,event_kind:'other'},started:true,actorActive:true,sessionActive:true,memberActive:true,memberOnboarding:false,memberHidden:false,memberGuild:true,hostReady:true,hostTier:'full',records:new Map(),rsvps:new Map([MEMBER,PEER,HOST].map(id=>[id,{rsvp_id:randomUUID(),state:'going'}])),receipts:new Map(),journal:[],fail:'',sessionClock:0};
 let snapshot:any;const queries:{sql:string;params:any[]}[]=[];
 const q:any={state,release(){},async query(raw:string,p:any[]=[]){
  const sql=raw.replace(/\s+/g,' ').trim();queries.push({sql,params:p});const rows=(r:any[])=>({rows:r,rowCount:r.length});
  if(sql==='BEGIN'){snapshot=structuredClone({records:state.records,receipts:state.receipts,journal:state.journal});return rows([]);}
  if(sql==='COMMIT')return rows([]);
  if(sql==='ROLLBACK'){Object.assign(state,snapshot);return rows([]);}
  if(sql.startsWith('SELECT user_id FROM users'))return rows(state.actorActive&&p[1]===COMMUNITY?[{user_id:p[0]}]:[]);
  if(sql.startsWith('SELECT token_hash FROM sessions')){if(sql.includes('clock_timestamp'))state.sessionClock++;return rows(state.sessionActive&&!(state.fail==='session_expiry'&&state.sessionClock>=2)?[{token_hash:'synthetic-session'}]:[]);}
  if(sql.startsWith('SELECT pg_advisory_xact_lock'))return rows([]);
  if(sql.startsWith('SELECT pg_try_advisory_xact_lock'))return rows([{acquired:state.blockedGuild!==p[0]}]);
  if(state.blockedRow&&sql.includes(state.blockedRow)&&sql.endsWith('NOWAIT'))throw Object.assign(new Error('synthetic lock unavailable'),{code:'55P03'});
  if(sql.startsWith('SELECT active,onboarding_required'))return rows(p[1]===COMMUNITY&&state.rsvps.has(p[0])?[{active:state.memberActive,onboarding_required:state.memberOnboarding,onboarding_completed_at:null,hidden:state.memberHidden}]:[]);
  if(sql.startsWith('SELECT event_id,community_id,organizer_ref'))return rows(state.event&&p[0]===EVENT&&p[1]===state.event.community_id?[state.event]:[]);
  if(sql.startsWith('SELECT rsvp_id,state'))return rows(p[0]===EVENT&&state.rsvps.has(p[1])?[state.rsvps.get(p[1])]:[]);
  if(sql.startsWith('SELECT * FROM community_event_attendance'))return rows(state.records.has(p[1])?[state.records.get(p[1])]:[]);
  if(sql.startsWith('SELECT * FROM command_receipts')){const value=state.receipts.get(p.join('/'));return rows(value?[value]:[]);}
  if(sql.startsWith('SELECT $1::timestamptz'))return rows([{started:state.started}]);
  if(sql.startsWith('SELECT onboarding_required'))return rows([{onboarding_required:!state.hostReady,onboarding_completed_at:null}]);
  if(sql.startsWith('SELECT member_tier'))return rows(state.hostTier?[{member_tier:state.hostTier}]:[]);
  if(sql.startsWith('INSERT INTO community_event_attendance')){
   const value={attendance_id:p[0],community_id:p[1],event_id:p[2],member_ref:p[3],rsvp_id:p[4],state:'confirmed',aggregate_version:'2',recorded_by:p[5],recorded_at:new Date('2026-11-04T12:00:00Z'),updated_by:p[5],updated_at:new Date('2026-11-04T12:00:00Z'),retraction_reason:null};state.records.set(p[3],value);return rows([value]);
  }
  if(sql.startsWith('UPDATE community_event_attendance')){const prior=[...state.records.values()].find((r:any)=>r.attendance_id===p[0]);const value={...prior,state:p[1],retraction_reason:p[2],updated_by:p[3],updated_at:new Date('2026-11-04T13:00:00Z'),aggregate_version:String(Number(prior.aggregate_version)+1),...(p[1]==='confirmed'?{recorded_by:p[3],recorded_at:new Date('2026-11-04T13:00:00Z')}:{})};state.records.set(prior.member_ref,value);return rows([value]);}
  if(sql.startsWith('INSERT INTO transition_journal')){if(state.fail==='journal')throw Error('synthetic journal failure');state.journal.push(p);return rows([]);}
  if(sql.startsWith('INSERT INTO command_receipts')){if(state.fail==='receipt')throw Error('synthetic receipt failure');state.receipts.set(p.slice(0,3).join('/'),{request_sha256:p[3],response:JSON.parse(p[4])});return rows([]);}
  if(sql.startsWith('WITH members AS MATERIALIZED')){
   const all=[...state.rsvps.entries()].filter(([id,r]:any)=>(r.state==='going'||state.records.has(id))&&(state.records.has(id)||!state.memberHidden)).map(([id,r]:any)=>({member_ref:id,registration_state:r.state,registered_at:new Date('2026-11-01T00:00:00Z'),display_name:id===HOST?'主辦':'合成會員',active:state.memberActive,onboarding_required:state.memberOnboarding,onboarding_completed_at:null,hidden:state.memberHidden,guild_eligible:state.memberGuild,...state.records.get(id),avatar_present:false,total:0}));const total=all.length;const items=all.slice(p[3],p[3]+p[2]).map((r:any)=>({...r,total}));return rows(items.length?items:[{member_ref:null,total}]);
  }
  throw Error('Unmodelled SQL: '+sql);
 }};
 const pool:any={async connect(){return q;},query:noIO};const actor:any={user_id:HOST,community_id:COMMUNITY,session_hash:'synthetic-session'};
 const input=(body:any={action:'confirm'},expected:any='1',key=randomUUID(),user=HOST,member=MEMBER)=>({actor:{...actor,user_id:user},operation:`POST /events/${EVENT}/attendance/${member}`,key,body,expected});
 const mutate=(body:any={action:'confirm'},expected:any='1',key=randomUUID(),user=HOST,member=MEMBER)=>mutateEventAttendance(pool,input(body,expected,key,user,member),EVENT,member);
 return {state,pool,q,queries,actor,input,mutate,list:()=>listEventAttendance(pool,actor,EVENT,{})};
}
const rejects=(status:number,code?:string)=>(error:any)=>error.status===status&&(!code||error.code===code);

test('strict input accepts only a manual confirmation or bounded correction reason',()=>{
 assert.deepEqual(policy.attendanceInput.parse({action:'confirm'}),{action:'confirm'});
 for(const reason of ['marked_wrong_member','not_confirmed'])assert.equal(policy.attendanceInput.parse({action:'retract',reason}).action,'retract');
 for(const value of [null,{},[],{action:'confirmed'},{action:'confirm',occurred_at:'2020-01-01'},{action:'confirm',actor:HOST},{action:'retract'},{action:'retract',reason:'absent'},{action:'retract',reason:'not_confirmed',note:'private'},{action:'confirm',bulk:[MEMBER]}])assert.equal(policy.attendanceInput.safeParse(value).success,false);
});
for(const [patch,reason] of [
 [{self:true},'self_confirmation'],[{eventState:'pending'},'event_unavailable'],[{eventState:'rejected'},'event_unavailable'],[{eventState:'cancelled'},'event_unavailable'],[{started:false},'event_not_started'],[{going:false},'registration_cancelled'],[{memberEligible:false},'member_unavailable'],[{organizerEligible:false},'organizer_unavailable'],[{version:Number.MAX_SAFE_INTEGER},'version_exhausted'],
] as const)test(`confirmation policy preserves ${reason}`,()=>assert.equal(policy.attendanceConfirmUnavailable({self:false,eventState:'published',started:true,going:true,memberEligible:true,organizerEligible:true,version:1,...patch}),reason));
test('published started event is eligible without inferring completion or checking event end time',()=>assert.equal(policy.attendanceConfirmUnavailable({self:false,eventState:'published',started:true,going:true,memberEligible:true,organizerEligible:true,version:1}),null));

test('real command orchestration records version2 then correction version3 with immutable first confirmation',async()=>{
 const f=fixture(),before={...f.state.event};const ack=await f.mutate();assert.equal(ack.attendance_version,2);assert.equal(ack.changed,true);assert.equal(ack.member_ref,MEMBER);assert.equal(ack.state,undefined);
 const initial=structuredClone(f.state.records.get(MEMBER));const corrected=await f.mutate({action:'retract',reason:'marked_wrong_member'},'2');assert.equal(corrected.attendance_version,3);assert.equal(f.state.records.get(MEMBER).state,'retracted');assert.deepEqual(f.state.records.get(MEMBER).recorded_at,initial.recorded_at);assert.equal(f.state.records.get(MEMBER).attendance_id,initial.attendance_id);assert.equal(f.state.journal.length,2);assert.deepEqual(f.state.event,before);assert(!f.queries.some(q=>/outbox|notifications|UPDATE community_events/.test(q.sql)));
});
test('different member rows have independent first versions and never modify event aggregate',async()=>{const f=fixture();await f.mutate();await f.mutate({action:'confirm'},'1',randomUUID(),HOST,PEER);assert.equal(f.state.records.get(MEMBER).aggregate_version,'2');assert.equal(f.state.records.get(PEER).aggregate_version,'2');assert.equal(f.state.journal.length,2);});
test('same key replays original minimal ACK after later retract and cancellation without resurrecting row',async()=>{
 const f=fixture(),key=randomUUID();const original=await f.mutate({action:'confirm'},'1',key);await f.mutate({action:'retract',reason:'not_confirmed'},'2');f.state.event.state='cancelled';f.state.rsvps.get(MEMBER).state='cancelled';const replay=await f.mutate({action:'confirm'},'1',key);assert.deepEqual(JSON.parse(JSON.stringify(replay)),JSON.parse(JSON.stringify(original)));assert.equal(f.state.records.get(MEMBER).state,'retracted');assert.equal(f.state.records.get(MEMBER).aggregate_version,'3');assert.equal(f.state.journal.length,2);
});
test('same key different valid body or attendance expected version conflicts before effect',async()=>{const f=fixture(),key=randomUUID();await f.mutate({action:'confirm'},'1',key);await assert.rejects(f.mutate({action:'retract',reason:'not_confirmed'},'1',key),rejects(409,'idempotency_conflict'));await assert.rejects(f.mutate({action:'confirm'},'2',key),rejects(409,'idempotency_conflict'));assert.equal(f.state.journal.length,1);});
test('new key same state is an explicit no-op without journal/version growth',async()=>{const f=fixture();await f.mutate();const a=await f.mutate({action:'confirm'},'2');assert.equal(a.changed,false);assert.equal(a.attendance_version,2);assert.equal(f.state.journal.length,1);await f.mutate({action:'retract',reason:'not_confirmed'},'2');const b=await f.mutate({action:'retract',reason:'marked_wrong_member'},'3');assert.equal(b.changed,false);assert.equal(b.attendance_version,3);assert.equal(f.state.journal.length,2);});
test('missing expected fails428 and stale new command fails412',async()=>{const f=fixture();await assert.rejects(mutateEventAttendance(f.pool,{...f.input(),expected:undefined},EVENT,MEMBER),rejects(428));await f.mutate();await assert.rejects(f.mutate(),rejects(412));assert.equal(f.state.journal.length,1);});
for(const who of [MEMBER,PEER])test(`non-organizer ${who} cannot read, confirm or replay`,async()=>{const f=fixture(),key=randomUUID();await f.mutate({action:'confirm'},'1',key);await assert.rejects(listEventAttendance(f.pool,{...f.actor,user_id:who},EVENT,{}),rejects(403));await assert.rejects(f.mutate({action:'confirm'},'1',key,who),rejects(403));assert.equal(f.state.journal.length,1);});
test('current host cannot attest self, while correction of existing self record remains permitted',async()=>{const f=fixture();await assert.rejects(f.mutate({action:'confirm'},'1',randomUUID(),HOST,HOST),rejects(409,'attendance_self_confirmation'));await f.mutate();f.state.records.set(HOST,{...f.state.records.get(MEMBER),member_ref:HOST,rsvp_id:f.state.rsvps.get(HOST).rsvp_id,attendance_id:randomUUID()});const a=await f.mutate({action:'retract',reason:'not_confirmed'},'2',randomUUID(),HOST,HOST);assert.equal(a.attendance_version,3);});
for(const failure of ['event_missing','owner_changed','community_changed','inactive_actor','session_revoked'])test(`successful old receipt cannot bypass ${failure}`,async()=>{const f=fixture(),key=randomUUID();await f.mutate({action:'confirm'},'1',key);if(failure==='event_missing')f.state.event=null;if(failure==='owner_changed')f.state.event.organizer_ref=PEER;if(failure==='community_changed')f.state.event.community_id=randomUUID();if(failure==='inactive_actor')f.state.actorActive=false;if(failure==='session_revoked')f.state.sessionActive=false;const priorReads=f.queries.filter(q=>q.sql.startsWith('SELECT * FROM command_receipts')).length;await assert.rejects(f.mutate({action:'confirm'},'1',key));assert.equal(f.queries.filter(q=>q.sql.startsWith('SELECT * FROM command_receipts')).length,priorReads);assert.equal(f.state.journal.length,1);});
for(const state of ['pending','rejected','cancelled'])test(`${state} event refuses a new confirmation`,async()=>{const f=fixture();f.state.event.state=state;await assert.rejects(f.mutate(),rejects(409));assert.equal(f.state.records.size,0);});
for(const change of ['not_started','cancelled_rsvp','inactive_member','member_onboarding','left_guild'])test(`new confirmation rechecks ${change}; existing correction survives`,async()=>{const f=fixture();await f.mutate();if(change==='not_started')f.state.started=false;if(change==='cancelled_rsvp')f.state.rsvps.get(MEMBER).state='cancelled';if(change==='inactive_member')f.state.memberActive=false;if(change==='member_onboarding')f.state.memberOnboarding=true;if(change==='left_guild'){f.state.event.visibility='guild';f.state.memberGuild=false;}if(change==='host_intern'){f.state.event.event_kind='guild_skill_exchange';f.state.hostTier='intern';}if(change==='host_onboarding')f.state.hostReady=false;await f.mutate({action:'retract',reason:'not_confirmed'},'2');await assert.rejects(f.mutate({action:'confirm'},'3'),rejects(409));assert.equal(f.state.records.get(MEMBER).state,'retracted');assert.equal(f.state.journal.length,2);});
for(const change of ['host_intern','host_onboarding'])test(`actor ${change} refuses writes and replay; only intern retains read-only history`,async()=>{const f=fixture(),key=randomUUID();await f.mutate({action:'confirm'},'1',key);if(change==='host_intern'){f.state.event.event_kind='guild_skill_exchange';f.state.hostTier='intern';}else f.state.hostReady=false;await assert.rejects(f.mutate({action:'retract',reason:'not_confirmed'},'2'),rejects(403));await assert.rejects(f.mutate({action:'confirm'},'1',key),rejects(403));if(change==='host_onboarding')await assert.rejects(f.list(),rejects(403,'onboarding_required'));else{const p=await f.list();assert.equal(p.items.find((r:any)=>r.member_ref===MEMBER).can_retract,false);assert.equal(attendancePage(p,EVENT,HOST,0),true);}assert.equal(f.state.journal.length,1);});
test('cancelled event and RSVP keep recorded member visible and retractable',async()=>{const f=fixture();await f.mutate();f.state.event.state='cancelled';f.state.rsvps.get(MEMBER).state='cancelled';const p=await f.list(),row=p.items.find((r:any)=>r.member_ref===MEMBER);assert(row);assert.equal(row.registration_state,'cancelled');assert.equal(row.can_retract,true);assert.equal(row.can_confirm,false);await f.mutate({action:'retract',reason:'not_confirmed'},'2');assert.equal((await f.list()).items.find((r:any)=>r.member_ref===MEMBER).state,'retracted');});
test('private list uses only member summary, independent attendance state and server record time',async()=>{const f=fixture();const p=await f.list();assert.equal(attendancePage(p,EVENT,HOST,0),true);assert.equal(p.total,3);assert.equal(p.items.find((r:any)=>r.member_ref===HOST).can_confirm,false);assert.equal(p.items.find((r:any)=>r.member_ref===MEMBER).state,'unconfirmed');assert(!JSON.stringify(p).includes('email'));assert(!JSON.stringify(p).includes('guest'));await f.mutate();assert.equal(attendancePage(await f.list(),EVENT,HOST,0),true);});
test('version exhaustion cannot wrap or clear a retained row',async()=>{const f=fixture();await f.mutate();f.state.records.get(MEMBER).aggregate_version=String(Number.MAX_SAFE_INTEGER);await assert.rejects(f.mutate({action:'retract',reason:'not_confirmed'},String(Number.MAX_SAFE_INTEGER)),rejects(409,'attendance_version_exhausted'));assert.equal(f.state.records.get(MEMBER).state,'confirmed');});
for(const failure of ['journal','receipt','session_expiry'])test(`real transaction orchestration calls rollback on ${failure} (model, not PostgreSQL proof)`,async()=>{const f=fixture();f.state.fail=failure;await assert.rejects(f.mutate());assert.equal(f.state.records.size,0);assert.equal(f.state.journal.length,0);assert.equal(f.state.receipts.size,0);assert.equal(f.queries.at(-1)?.sql,'ROLLBACK');});
test('subject and guild locks are obtained before event then RSVP/row, authorization before receipt read',async()=>{const f=fixture();await f.mutate();const index=(part:string)=>f.queries.findIndex(q=>q.sql.includes(part));assert(index('SELECT active,onboarding_required')<index('FROM community_events'));const guild=f.queries.filter(q=>q.params[0]?.startsWith?.('guild-member/'));assert.deepEqual(guild.map(q=>q.params[0]),[HOST,MEMBER].sort().map(id=>`guild-member/${COMMUNITY}/${id}`));assert(f.queries.indexOf(guild.at(-1)!)<index('FROM community_events'));assert(index('FROM community_events')<index('FROM community_event_rsvps'));assert(index('FROM community_event_rsvps')<index('SELECT * FROM command_receipts'));assert(f.queries[index('FROM community_events')].sql.endsWith('FOR UPDATE NOWAIT'));});

test('ACK validator binds every field and exact safe version while accepting historical acknowledgment only',()=>{
 const command={eventId:EVENT,memberId:MEMBER,body:{action:'confirm' as const},key:'original-key',version:1};const ack={acknowledged:true,event_id:EVENT,member_ref:MEMBER,action:'confirm',retraction_reason:null,command_key:'original-key',attendance_version:2,changed:true};assert.equal(attendanceAck(ack,command),true);
 for(const value of [null,{},[],{...ack,event_id:PEER},{...ack,member_ref:PEER},{...ack,command_key:'other-key'},{...ack,action:'retract'},{...ack,retraction_reason:'not_confirmed'},{...ack,attendance_version:'2'},{...ack,attendance_version:3},{...ack,attendance_version:1},{...ack,changed:undefined},{...ack,changed:false}])assert.equal(attendanceAck(value,command),false);
 assert.equal(attendanceAck({...ack,attendance_version:1,changed:false},command),false);
 assert.equal(attendanceAck({...ack,attendance_version:2,changed:false},{...command,version:2}),true);
 assert.equal(attendanceAck({...ack,action:'retract',retraction_reason:'not_confirmed',attendance_version:3,changed:false},{...command,version:3,body:{action:'retract',reason:'not_confirmed'}}),true);
 const retract={...command,body:{action:'retract' as const,reason:'not_confirmed' as const},version:2};assert.equal(attendanceAck({...ack,action:'retract',retraction_reason:'not_confirmed',attendance_version:3},retract),true);assert.equal(attendanceAck({...ack,action:'retract',retraction_reason:'marked_wrong_member',attendance_version:3},retract),false);
});
test('list validator rejects foreign identities, malformed numbers, missing records and ambiguous paging',async()=>{
 const f=fixture(),p=await f.list();for(const value of [null,{},[],{...p,event_id:PEER},{...p,organizer_ref:PEER},{...p,total:'3'},{...p,total:2},{...p,next_offset:20},{...p,items:[...p.items,p.items[0]]},{...p,items:[{...p.items[1],state:'absent'}]},{...p,items:[{...p.items[1],version:2}]},{...p,items:[{...p.items[0],can_confirm:true,confirm_unavailable:null}]}])assert.equal(attendancePage(value,EVENT,HOST,0),false);
});
test('migration is additive, zero-backfill, identity-bound and permits parent cleanup without DELETE guards',()=>{
 const sql=readFileSync('migrations/200_event_member_attendance.sql','utf8');assert.match(sql,/UNIQUE\(rsvp_id,event_id,user_id\)/);assert.match(sql,/FOREIGN KEY\(rsvp_id,event_id,member_ref\)/);assert.match(sql,/FOREIGN KEY\(member_ref,community_id\)[\s\S]*?ON DELETE CASCADE/);assert.match(sql,/BEFORE UPDATE ON community_event_attendance/);assert.doesNotMatch(sql,/BEFORE DELETE|INSERT INTO|UPDATE community_event_rsvps|DROP TABLE|CREATE POLICY|GRANT|REVOKE/i);assert.match(sql,/9007199254740991/);
});
test('route and panel integration retain organizer-private entry, ordinary attendee contract and leave guard',()=>{
 const route=readFileSync('apps/platform-api/src/routes/community-events.ts','utf8'),panel=readFileSync('apps/portal-web/src/modules/EventsPanel.tsx','utf8');assert.match(route,/app\.get\('\/events\/:id\/attendance'/);assert.match(route,/app\.post\('\/events\/:id\/attendance\/:memberId'/);assert.doesNotMatch(route,/attendance\/me/);assert.match(panel,/if\(selected&&selected\.organizer_ref===session\.user\.user_id\)attendanceScope\.current=selectedId/);assert.match(panel,/canView=\{Boolean\(selected&&selected\.organizer_ref===session\.user\.user_id\)\}/);assert.match(panel,/attendanceBlocked\.current\)\{setNotice/);assert.match(panel,/helperBlocked\.current\|\|missionBlocked\.current\|\|attendanceBlocked\.current/);assert.match(source,/readWithMemberSession/);assert.doesNotMatch(source,/eventType|notifyMember|outbox|UPDATE community_events|DELETE FROM/);
});


test('a formerly authenticated actor cannot expose private history after current onboarding is revoked',async()=>{
 const f=fixture();await f.mutate();const previouslyAuthenticated={...f.actor,onboarding_required:false,onboarding_completed_at:null};
 f.state.hostReady=false;const start=f.queries.length;await assert.rejects(listEventAttendance(f.pool,previouslyAuthenticated,EVENT,{}),rejects(403,'onboarding_required'));
 const queries=f.queries.slice(start);assert(queries.some(q=>q.sql.startsWith('SELECT user_id FROM users')&&q.sql.endsWith('FOR SHARE')));assert(queries.some(q=>q.sql.startsWith('SELECT onboarding_required')));assert(!queries.some(q=>q.sql.startsWith('WITH members')));assert.equal(queries.at(-1)?.sql,'ROLLBACK');
});

for(const blocked of ['first_guild','second_guild','subject','event','rsvp','attendance'])test(`nonblocking ${blocked} conflict rolls back without receipt/effect and permits explicit same tuple retry`,async()=>{
 const f=fixture(),key=randomUUID();
 if(blocked.endsWith('guild'))f.state.blockedGuild=`guild-member/${COMMUNITY}/${blocked==='first_guild'?HOST:MEMBER}`;
 else f.state.blockedRow={subject:'SELECT active,onboarding_required',event:'FROM community_events',rsvp:'SELECT rsvp_id,state',attendance:'SELECT * FROM community_event_attendance'}[blocked];
 await assert.rejects(f.mutate({action:'confirm'},'1',key),rejects(409,'attendance_busy'));
 assert.equal(f.state.records.size,0);assert.equal(f.state.receipts.size,0);assert.equal(f.state.journal.length,0);assert.equal(f.queries.at(-1)?.sql,'ROLLBACK');
 assert(!f.queries.some(q=>q.sql.startsWith('SELECT * FROM command_receipts')));assert.equal(f.queries.filter(q=>q.sql==='BEGIN').length,1,'No automatic retry');
 if(blocked==='second_guild'){const guilds=f.queries.filter(q=>q.sql.includes('pg_try_advisory_xact_lock'));assert.equal(guilds.length,2);assert.equal(guilds[0].params[0],`guild-member/${COMMUNITY}/${HOST}`);}
 if(!blocked.endsWith('guild'))assert.equal(f.queries.at(-2)?.sql.endsWith('NOWAIT'),true,'Only ROLLBACK follows 55P03');
 f.state.blockedGuild=null;f.state.blockedRow=null;const ack=await f.mutate({action:'confirm'},'1',key);assert.equal(ack.attendance_version,2);assert.equal(f.state.journal.length,1);
});
test('new attendance locks preserve canonical keys and read locking while avoiding tier/helper writer cycles',()=>{
 const guild=readFileSync('modules/positioning/onboarding.ts','utf8');assert.match(guild,/guild-member\/\$\{actor.community_id\}\/\$\{actor.user_id\}/);
 assert.match(source,/pg_try_advisory_xact_lock\(hashtextextended\(\$1,0\)\) AS acquired/);
 assert.match(source,/write \? 'FOR UPDATE NOWAIT' : 'FOR SHARE'/);assert.match(source,/user_id=\$1 AND community_id=\$2 FOR SHARE NOWAIT/);
 assert.match(source,/FROM community_event_rsvps WHERE event_id=\$1 AND user_id=\$2 FOR UPDATE NOWAIT/);assert.match(source,/member_ref=\$2 FOR UPDATE NOWAIT/);
});

test('pure suite never used external transport or real pool query',()=>assert.equal(forbiddenIO,0));
