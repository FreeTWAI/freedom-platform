import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_USERS,DEMO_COMMUNITY} from '../../packages/testing/seed.js';
import {transaction} from '../../packages/db/index.js';
import {tokenHash,type Actor} from '../../modules/identity-membership/service.js';
import {createEvent,setRsvp,registerPublicEvent,publicEvent,reviewEventAsAdmin} from '../../modules/community/events.js';
import {shareEvent} from '../../modules/community/event-sharing.js';
import {publishEventShare} from '../../modules/shares/event-ledger.js';
import {creditEventRegistrations} from '../../modules/shares/credit.js';
import {createShare,retractShare,reportShare,myCredit} from '../../modules/shares/service.js';
import {moderateShare} from '../../modules/shares/moderation.js';
import {claimEventOrganizer,reviewEventOrganizer} from '../../modules/community/event-claims.js';
import {ensureGuestCapability,readGuestEventParticipation,mutateGuestEventParticipation,readEventParticipation,mutateEventWaitlist} from '../../modules/community/event-waitlist.js';
import {readGuestEventCalendar} from '../../modules/community/event-calendar.js';
import {creditPromotionClick} from '../../modules/community/promotion.js';
const url=process.env.TEST_DATABASE_URL;assert.ok(url);
const schema=`fp_event_security_${randomUUID().replaceAll('-','')}`,root=new Pool({connectionString:url}),pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
const cmd=(actor:Actor,body:unknown,expected?:number)=>({actor,body,key:randomUUID(),operation:'event-security',...(expected===undefined?{}:{expected:String(expected)})});
const eventBody=()=>({title:`合成安全活動 ${randomUUID().slice(0,8)}`,starts_at:'2099-01-01T10:00:00Z',location:'合成場地'});
before(async()=>{await root.query(`CREATE SCHEMA ${schema}`);await migrate(pool);await seedLocal(pool);});
after(async()=>{await pool.end();await root.query(`DROP SCHEMA ${schema} CASCADE`);await root.end();});
async function member(){
 const id=randomUUID(),token=randomBytes(32).toString('base64url'),email=`${id}@example.com`;
 await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,active,onboarding_required,created_at)
 SELECT $1,community_id,$2,'合成會員',password_hash,$3,true,false,now()-interval '8 days' FROM users WHERE user_id=$4`,[id,email,randomUUID(),DEMO_USERS[0].user_id]);
 await pool.query("INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$1,now()+interval '1 day')",[tokenHash(token),id]);
 return {user_id:id,community_id:DEMO_COMMUNITY,session_hash:tokenHash(token)} as Actor;
}
async function fixture(){const owner=await member(),other=await member(),e=await createEvent(pool,cmd(owner,eventBody()));return {owner,other,e};}
async function count(id:string,basis:string){return (await pool.query('SELECT COALESCE(sum(units),0)::int n FROM share_credit_events WHERE share_id=$1 AND basis=$2',[id,basis])).rows[0].n;}
async function active(id:string){return (await pool.query('SELECT count(*)::int n FROM share_endorsements WHERE share_id=$1 AND withdrawn_at IS NULL',[id])).rows[0].n;}
async function code(eventId:string,userId:string){return (await pool.query('SELECT code FROM community_event_share_codes WHERE event_id=$1 AND user_id=$2',[eventId,userId])).rows[0].code;}
async function email(actor:Actor){return (await pool.query('SELECT email FROM users WHERE user_id=$1',[actor.user_id])).rows[0].email as string;}
async function admin(){const id=randomUUID(),email=`${id}@example.com`;await pool.query('INSERT INTO platform_admins(admin_id,community_id,email,display_name) VALUES($1,$2,$3,$4)',[id,DEMO_COMMUNITY,email,'合成管理員']);return {admin_id:id,community_id:DEMO_COMMUNITY,email,display_name:'合成管理員',role:'super_admin' as const,subject:'synthetic'};}
async function hide(shareId:string){for(let i=0;i<3;i++)await reportShare(pool,cmd(await member(),{reason:'合成檢舉'}),shareId);}

test('publication and share-box event envelope endorse once, including replay and concurrent publisher calls',async()=>{
 const owner=await member(),input=cmd(owner,{kind:'event',event:eventBody()}),result=await createShare(pool,input);
 assert.deepEqual(await createShare(pool,input),result);
 const e=(await pool.query('SELECT e.* FROM community_events e JOIN shares s ON s.ref_id=e.event_id WHERE s.share_id=$1',[result.share_id])).rows[0];
 await Promise.all([0,1].map(()=>transaction(pool,async q=>{await q.query('SELECT 1 FROM community_events WHERE event_id=$1 FOR UPDATE',[e.event_id]);await publishEventShare(q,e);})));
 assert.equal(await active(result.share_id),1);assert.equal(await count(result.share_id,'created'),1);
 const other=await member();await createShare(pool,cmd(other,{kind:'event',ref_id:e.event_id}));assert.equal(await active(result.share_id),2);assert.equal(await count(result.share_id,'shared_again'),1);
});

test('event-page co-sharing, personal withdrawal and both re-share routes preserve identity and hidden holds',async()=>{
 const {owner,other,e}=await fixture();
 await Promise.all([shareEvent(pool,cmd(other,{}),e.event_id),shareEvent(pool,cmd(other,{}),e.event_id)]);
 assert.equal(await active(e.share_id),2);assert.equal(await count(e.share_id,'shared_again'),1);
 await retractShare(pool,cmd(owner,{}),e.share_id);assert.equal(await active(e.share_id),1);assert.equal((await publicEvent(pool,e.event_id)).event_id,e.event_id);
 await retractShare(pool,cmd(other,{}),e.share_id);assert.equal((await pool.query('SELECT state FROM shares WHERE share_id=$1',[e.share_id])).rows[0].state,'retracted');
 await shareEvent(pool,cmd(other,{}),e.event_id);assert.equal(await active(e.share_id),1);assert.equal(await count(e.share_id,'shared_again'),1);
 await retractShare(pool,cmd(other,{}),e.share_id);await createShare(pool,cmd(owner,{kind:'event',ref_id:e.event_id}));
 assert.equal(await active(e.share_id),1);assert.equal(await count(e.share_id,'created'),1);
 assert.equal((await pool.query('SELECT first_sharer_user_id FROM shares WHERE share_id=$1',[e.share_id])).rows[0].first_sharer_user_id,owner.user_id);
 await hide(e.share_id);assert.equal(await count(e.share_id,'created'),1);
 const credit=await transaction(pool,q=>myCredit(q,owner));assert.ok(credit.items.some(r=>r.share_id===e.share_id&&r.basis==='created'&&r.count===1&&r.title===e.title));
 await assert.rejects(shareEvent(pool,cmd(other,{}),e.event_id));await assert.rejects(createShare(pool,cmd(other,{kind:'event',ref_id:e.event_id})));
 await retractShare(pool,cmd(owner,{}),e.share_id);assert.equal(await active(e.share_id),0);
 await assert.rejects(transaction(pool,async q=>publishEventShare(q,(await q.query('SELECT * FROM community_events WHERE event_id=$1 FOR UPDATE',[e.event_id])).rows[0])),{code:'share_unavailable'});
 assert.equal((await pool.query('SELECT state FROM shares WHERE share_id=$1',[e.share_id])).rows[0].state,'hidden');
 const a=await admin();await moderateShare(pool,{admin:a,key:randomUUID(),operation:'restore',body:{reason:'合成審核恢復'}},e.share_id,'restore');
 assert.equal((await pool.query('SELECT state FROM shares WHERE share_id=$1',[e.share_id])).rows[0].state,'retracted');
 await shareEvent(pool,cmd(other,{}),e.event_id);assert.equal(await active(e.share_id),1);
});

test('legacy event approval cannot bypass share moderation; admin restoration dismisses reports and preserves facts',async()=>{
 const {e}=await fixture(),a=await admin();await hide(e.share_id);
 const version=(await pool.query('SELECT aggregate_version FROM community_events WHERE event_id=$1',[e.event_id])).rows[0].aggregate_version;
 await assert.rejects(reviewEventAsAdmin(pool,{admin:a,key:randomUUID(),operation:'review',expected:String(version),body:{decision:'approve',reason:'合成舊審核'}},e.event_id),{code:'share_unavailable'});
 assert.equal(await count(e.share_id,'created'),1);await assert.rejects(publicEvent(pool,e.event_id),{status:404});
 await moderateShare(pool,{admin:a,key:randomUUID(),operation:'restore',body:{reason:'合成恢復公開'}},e.share_id,'restore');
 assert.equal((await publicEvent(pool,e.event_id)).event_id,e.event_id);assert.equal(await count(e.share_id,'created'),1);
 assert.equal((await pool.query('SELECT count(*)::int n FROM share_reports WHERE share_id=$1 AND dismissed_at IS NOT NULL',[e.share_id])).rows[0].n,3);
});

test('sent-but-unconfirmed guest earns nothing; token confirmation is atomic and repeated/concurrent confirmation credits once',async()=>{
 const {owner,e}=await fixture(),ref=await code(e.event_id,owner.user_id),guest='unconfirmed@example.com';
 await registerPublicEvent(pool,e.event_id,{name:'合成訪客',email:guest,referral_code:ref},async()=>{},'https://example.test',true);
 await registerPublicEvent(pool,e.event_id,{name:'合成訪客',email:guest,referral_code:ref},async()=>{},'https://example.test',true);
 await transaction(pool,q=>creditEventRegistrations(q,e.event_id));assert.equal(await count(e.share_id,'registration'),0);
 const token=(await pool.query('SELECT token_secret FROM community_event_guest_capabilities WHERE event_id=$1 AND email=$2',[e.event_id,guest])).rows[0].token_secret;
 await assert.rejects(transaction(pool,async q=>{await readGuestEventParticipation(q,e.event_id,token);throw Error('rollback confirmation');}),/rollback confirmation/);
 assert.equal((await pool.query('SELECT confirmed_at FROM community_event_guest_rsvps WHERE event_id=$1 AND email=$2',[e.event_id,guest])).rows[0].confirmed_at,null);assert.equal(await count(e.share_id,'registration'),0);
 await Promise.all([readGuestEventParticipation(pool,e.event_id,token),readGuestEventParticipation(pool,e.event_id,token),readGuestEventCalendar(pool,e.event_id,token),readGuestEventCalendar(pool,e.event_id,token)]);
 assert.equal(await count(e.share_id,'registration'),1);
 const never='never-confirms@example.com';await registerPublicEvent(pool,e.event_id,{name:'合成訪客',email:never,referral_code:ref},async()=>{},'https://example.test',true);
 await transaction(pool,q=>creditEventRegistrations(q,e.event_id));assert.equal(await count(e.share_id,'registration'),1);
});

for(const guestFirst of [false,true])test(`member/guest same person counts once (${guestFirst?'guest':'member'} first), with competing referrers and email changes`,async()=>{
 const {owner,other,e}=await fixture(),person=await member();await shareEvent(pool,cmd(other,{}),e.event_id);
 const memberRef=await code(e.event_id,owner.user_id),guestRef=await code(e.event_id,other.user_id),address=await email(person);
 const memberRsvp=()=>setRsvp(pool,cmd(person,{going:true,referral_code:memberRef}),e.event_id);
 const guestRsvp=async()=>{await registerPublicEvent(pool,e.event_id,{name:'合成訪客',email:address.toUpperCase(),referral_code:guestRef},async()=>{},'https://example.test',true);const token=(await pool.query('SELECT token_secret FROM community_event_guest_capabilities WHERE event_id=$1 AND email=$2',[e.event_id,address])).rows[0].token_secret;await readGuestEventParticipation(pool,e.event_id,token);};
 if(guestFirst){await guestRsvp();await memberRsvp();}else{await memberRsvp();await guestRsvp();}
 await pool.query('UPDATE users SET email=$2 WHERE user_id=$1',[person.user_id,`changed-${address}`]);
 await setRsvp(pool,cmd(person,{going:false}),e.event_id);await memberRsvp();assert.equal(await count(e.share_id,'registration'),1);
 assert.equal((await pool.query("SELECT user_id FROM share_credit_events WHERE share_id=$1 AND basis='registration' AND units=1",[e.share_id])).rows[0].user_id,guestFirst?other.user_id:owner.user_id);
});

for(const guest of [false,true])test(`${guest?'guest':'member'} waitlist promotion and re-registration use the single credit path`,async()=>{
 const {owner,other,e}=await fixture(),ref=await code(e.event_id,owner.user_id),address=await email(other);
 const token=guest?await transaction(pool,q=>ensureGuestCapability(q,e.event_id,{email:address,name:'合成訪客',referral_code:ref})):null;
 const action=async(verb:'join'|'accept'|'cancel'|'register')=>{
  if(token){const v=await readGuestEventParticipation(pool,e.event_id,token);return mutateGuestEventParticipation(pool,e.event_id,token,{action:verb,expected_version:v.event_version,referral_code:ref},randomUUID());}
  const v=await readEventParticipation(pool,other,e.event_id);return mutateEventWaitlist(pool,cmd(other,{action:verb,referral_code:ref},v.event_version),e.event_id);
 };
 await action('join');assert.equal(await count(e.share_id,'registration'),0);await action('accept');await action('accept');assert.equal(await count(e.share_id,'registration'),1);
 if(token){await action('cancel');await action('register');}else{await setRsvp(pool,cmd(other,{going:false}),e.event_id);await action('join');await action('accept');}
 assert.equal(await count(e.share_id,'registration'),1);
});

test('organizer claims cannot manufacture endorsements or reopen hidden shares; revocation keeps sharer facts',async()=>{
 const owner=await member(),claimant=await member(),a=await admin(),e=await createEvent(pool,cmd(owner,{...eventBody(),source_url:`https://example.com/${randomUUID()}`}));
 const claim=await claimEventOrganizer(pool,cmd(claimant,{statement:'我是這場合成活動的主辦者。',evidence_url:'https://example.com/proof',declared:true}),e.event_id);
 const input={admin:a,key:randomUUID(),operation:'claim',expected:'1',body:{decision:'verify',reason:'合成核實來源'}};
 await reviewEventOrganizer(pool,input,claim.claim_id);await reviewEventOrganizer(pool,input,claim.claim_id);
 assert.equal(await active(e.share_id),1);assert.equal(await count(e.share_id,'claim_verified'),1);
 await shareEvent(pool,cmd(claimant,{}),e.event_id);assert.equal(await active(e.share_id),2);
 await reviewEventOrganizer(pool,{...input,key:randomUUID(),expected:'2',body:{decision:'revoke',reason:'合成撤回核實'}},claim.claim_id);
 assert.equal(await count(e.share_id,'claim_verified'),0);assert.equal(await count(e.share_id,'shared_again'),1);
 const hiddenClaimant=await member(),hiddenClaim=await claimEventOrganizer(pool,cmd(hiddenClaimant,{statement:'我是這場合成活動的主辦者。',evidence_url:'https://example.com/proof2',declared:true}),e.event_id);
 await hide(e.share_id);await reviewEventOrganizer(pool,{...input,key:randomUUID()},hiddenClaim.claim_id);
 assert.equal(await count(e.share_id,'claim_verified'),0);assert.equal(await active(e.share_id),2);
});

test('event anonymous clicks are bounded per sharer and Taipei day; hiding preserves earned reach',async()=>{
 const {other,e}=await fixture(),link=await shareEvent(pool,cmd(other,{}),e.event_id),c=link.path.split('/').pop()!;
 for(const network of ['first','second'])await creditPromotionClick(pool,{code:c,sessionUserId:null,userAgent:'Mozilla/5.0',network,now:new Date('2098-01-01T01:00:00Z')});
 assert.equal(await count(e.share_id,'qualified_click_day'),1);
 await creditPromotionClick(pool,{code:c,sessionUserId:null,userAgent:'Mozilla/5.0',network:'next-day',now:new Date('2098-01-02T01:00:00Z')});
 assert.equal(await count(e.share_id,'qualified_click_day'),2);await hide(e.share_id);assert.equal(await count(e.share_id,'qualified_click_day'),2);
});


test('pending CLI creates endorsements and reconciles existing evidence once, excluding hidden and retracted shares',async()=>{
 const owner=await member(),person=await member(),id=randomUUID();
 await pool.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,state,visibility)
 VALUES($1,$2,$3,'合成待發布活動','合成歷史資料','2099-01-01T10:00Z','2099-01-01T11:00Z','in_person','合成場地','pending','open')`,[id,DEMO_COMMUNITY,owner.user_id]);
 await pool.query("INSERT INTO community_event_rsvps(rsvp_id,event_id,user_id,state,referred_by_user_id) VALUES($1,$2,$3,'going',$4)",[randomUUID(),id,person.user_id,owner.user_id]);
 await pool.query("INSERT INTO community_event_guest_rsvps(event_id,email,name,state,email_sent_at,referred_by_user_id) VALUES($1,'cli-unconfirmed@example.com','合成未確認訪客','going',now(),$2)",[id,owner.user_id]);
 const hidden=await createEvent(pool,cmd(owner,eventBody())),retracted=await createEvent(pool,cmd(owner,eventBody()));
 await hide(hidden.share_id);await retractShare(pool,cmd(owner,{}),retracted.share_id);
 await pool.query("UPDATE community_events SET state='pending' WHERE event_id=$1",[retracted.event_id]);
 const run=async(args:string[])=>{const {stdout}=await promisify(execFile)(process.execPath,['--import','tsx','scripts/publish-pending-events.ts',...args],{cwd:process.cwd(),env:{...process.env,PGOPTIONS:`-c search_path=${schema}`}});return stdout.trim().split('\n').map(s=>JSON.parse(s));};
 assert.deepEqual(await run([]),[{mode:'dry-run',eligible:1,applied:0}]);
 assert.deepEqual(await run(['--apply']),[{mode:'dry-run',eligible:1,applied:0},{mode:'apply',eligible:1,applied:1}]);
 assert.deepEqual(await run(['--apply']),[{mode:'dry-run',eligible:0,applied:0},{mode:'apply',eligible:0,applied:0}]);
 const share=(await pool.query("SELECT * FROM shares WHERE kind='event' AND ref_id=$1",[id])).rows[0];
 assert.equal(await active(share.share_id),1);assert.equal(await count(share.share_id,'created'),1);assert.equal(await count(share.share_id,'registration'),1);
 for(const [shareId,state] of [[hidden.share_id,'hidden'],[retracted.share_id,'retracted']])assert.equal((await pool.query('SELECT state FROM shares WHERE share_id=$1',[shareId])).rows[0].state,state);
});
