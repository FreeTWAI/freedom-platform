import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {Pool} from 'pg';
import sharp from 'sharp';
import {migrate} from '../../scripts/database.js';
import type {Command} from '../../packages/db/index.js';
import {tokenHash,type Actor} from '../../modules/identity-membership/service.js';
import {mutateEventPrizePhoto,readEventPrizePhotoAvailability} from '../../modules/assets/event-prize-photo.js';
import {readMemberEventPrizePhoto,readPublicEventPrizePhoto} from '../../modules/assets/event-prize-photo-read.js';
import {eventPrizePhotos,eventPrizePhotoTargetId} from '../../modules/community/event-prize-photos.js';
import {updateEvent} from '../../modules/community/events.js';
import {FakeObjectStore} from '../../packages/asset-storage/fake-store.js';
import {Problem} from '../../packages/shared/problem.js';
import {runWithImageProcessor,createUnavailableImageProcessor} from '../../packages/shared/image-runtime.js';

// AUTHORING ONLY, NOT RUN. Full real migrations, real command/receipt/SQL paths
// and the installed native sharp codec; FakeObjectStore is only external I/O.
// These are not R2, Worker, HTTP middleware, browser or production evidence.
const databaseUrl=process.env.TEST_DATABASE_URL;
const schema=`fp_prize_photo_db_${process.pid}_${Date.now()}`;
let admin:Pool,pool:Pool,created=false,png:Buffer,otherPng:Buffer;
before(async()=>{
  assert.ok(databaseUrl,'Explicit isolated TEST_DATABASE_URL required');const url=new URL(databaseUrl);
  assert.ok(['postgres:','postgresql:'].includes(url.protocol)&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)
    &&/^\/fp_[A-Za-z0-9_]+$/.test(url.pathname)&&!url.search&&!url.hash,'A local disposable fp_* database is required');
  admin=new Pool({connectionString:databaseUrl});pool=new Pool({connectionString:databaseUrl,options:`-c search_path=${schema} -c statement_timeout=10000`,max:12});
  await admin.query(`CREATE SCHEMA ${schema}`);created=true;await migrate(pool);
  png=await sharp({create:{width:80,height:40,channels:3,background:'green'}}).png().toBuffer();
  otherPng=await sharp({create:{width:30,height:60,channels:3,background:'blue'}}).png().toBuffer();
});
after(async()=>{if(pool)await pool.end();if(admin){try{if(created)await admin.query(`DROP SCHEMA ${schema} CASCADE`);}finally{await admin.end();}}});
const code=(value:string)=>(error:unknown)=>error instanceof Problem&&error.code===value;
const status=(value:number)=>(error:unknown)=>error instanceof Problem&&error.status===value;
const sqlIntegrity=(error:unknown)=>['23514','23503'].includes((error as {code?:string}).code??'');
const prize=(id=randomUUID())=>({prize_id:id,name:'合成獎品',description:'主辦者提供',quantity:1,icon_id:'gift' as const,completion_rule:'完成主辦評選',claim_note:'現場領取'});
async function member(community:string):Promise<Actor>{
  const id=randomUUID(),hash=tokenHash(randomBytes(32).toString('base64url'));
  const row=(await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref)
    VALUES($1,$2,$3,'Synthetic organizer','not-a-login',$4) RETURNING *`,[id,community,`${id}@prize-photo.test`,randomUUID()])).rows[0];
  await pool.query("INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,'synthetic',clock_timestamp()+interval '1 hour')",[hash,id]);
  return {...row,session_hash:hash,csrf_token:'synthetic'};
}
async function setup(){
  const community=randomUUID(),id=randomUUID(),p=prize();await pool.query('INSERT INTO communities VALUES($1,$2)',[community,'Synthetic prize photo lifecycle']);const owner=await member(community);
  const body={title:'合成活動',description:'合成資料庫生命週期',starts_at:new Date(Date.now()+86400000).toISOString(),ends_at:new Date(Date.now()+172800000).toISOString(),mode:'online' as const,location:'合成教室',capacity:20,event_kind:'other' as const,visibility:'open' as const,prize_details:[p]};
  await pool.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,capacity,state,visibility,event_kind,prize_details)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending','open','other',$11::jsonb)`,[id,community,owner.user_id,body.title,body.description,body.starts_at,body.ends_at,body.mode,body.location,body.capacity,JSON.stringify(body.prize_details)]);
  await pool.query("UPDATE domain_media_storage_policy SET mode='r2_only',persistence_allowed=true,policy_revision='synthetic-prize-v1',retained_byte_limit=10485760 WHERE purpose='community.event-prize-photo'");
  return {community,id,prizeId:p.prize_id,owner,body,store:new FakeObjectStore()};
}
type Fixture=Awaited<ReturnType<typeof setup>>;
const command=(f:Fixture,expected='1',key=randomUUID(),actor=f.owner):Command=>({actor,key,expected,operation:`POST /api/v1/events/${f.id}/prizes/${f.prizeId}/photo`,body:null});
const upload=(f:Fixture,c=command(f),bytes=png)=>mutateEventPrizePhoto(pool,c,f.id,f.prizeId,{mime:'image/png',bytes},f.store);
const remove=(f:Fixture,c:Command)=>mutateEventPrizePhoto(pool,c,f.id,f.prizeId,null);
const read=(f:Fixture,version:string,db=pool,actor=f.owner)=>readMemberEventPrizePhoto(db,actor,f.id,f.prizeId,version,f.store);
async function facts(f:Fixture){return (await pool.query("SELECT aggregate_version,operation,data FROM scoped_transition_journal WHERE aggregate_type='community_event' AND aggregate_id=$1 AND operation LIKE 'community.event.prize-photo.%' ORDER BY aggregate_version",[f.id])).rows;}
async function current(f:Fixture){return (await pool.query('SELECT * FROM community_event_prize_photo_targets WHERE event_id=$1 AND prize_id=$2',[f.id,f.prizeId])).rows[0];}
async function eventVersion(f:Fixture){return (await pool.query('SELECT aggregate_version FROM community_events WHERE event_id=$1',[f.id])).rows[0].aggregate_version;}
async function assets(f:Fixture){return (await pool.query("SELECT a.asset_id,a.state,i.intent_id,i.state AS intent_state,o.byte_size FROM assets a JOIN asset_upload_intents i USING(asset_id) LEFT JOIN asset_objects o USING(asset_id) WHERE i.target_prize_photo_id=$1 ORDER BY a.created_at,a.asset_id",[eventPrizePhotoTargetId(f.id,f.prizeId)])).rows;}
async function waitFor(check:()=>Promise<boolean>,message:string,ms=6000){const end=Date.now()+ms;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail(message);}
async function blockedBy(pid:number){return Boolean((await pool.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS yes',[pid])).rows[0].yes);}

test('availability reads the real current policy and saved prize without creating a target, intent or Asset',async()=>{
  const f=await setup(),availability=(store?:FakeObjectStore)=>readEventPrizePhotoAvailability(pool,f.owner,f.id,f.prizeId,store);
  const expected=(upload_available:boolean)=>({event_id:f.id,prize_id:f.prizeId,organizer_ref:f.owner.user_id,upload_available});
  const empty=async()=>{
    const counts=(await pool.query(`SELECT
      (SELECT count(*)::int FROM community_event_prize_photo_targets WHERE event_id=$1) AS targets,
      (SELECT count(*)::int FROM asset_upload_intents WHERE target_prize_photo_id=$2) AS intents,
      (SELECT count(*)::int FROM assets WHERE owner_user_id=$3 AND purpose='community.event-prize-photo') AS assets`,[f.id,eventPrizePhotoTargetId(f.id,f.prizeId),f.owner.user_id])).rows[0];
    assert.deepEqual(counts,{targets:0,intents:0,assets:0});assert.equal(await eventVersion(f),'1');
  };
  await empty();assert.deepEqual(await availability(),expected(false),'An admitted policy alone does not supply runtime storage');
  assert.deepEqual(await availability(f.store),expected(true));await empty();
  await pool.query("UPDATE domain_media_storage_policy SET persistence_allowed=false WHERE purpose='community.event-prize-photo'");
  assert.deepEqual(await availability(f.store),expected(false));
  await assert.rejects(readEventPrizePhotoAvailability(pool,await member(f.community),f.id,f.prizeId,f.store),code('organizer_required'));
  await assert.rejects(readEventPrizePhotoAvailability(pool,f.owner,f.id,randomUUID(),f.store),code('event_prize_not_found'));
  await pool.query("UPDATE domain_media_storage_policy SET mode='r2_only',persistence_allowed=true,policy_revision='synthetic-prize-v1',retained_byte_limit=10485760 WHERE purpose='community.event-prize-photo'");
  assert.deepEqual(await availability(f.store),expected(true));
  await pool.query("UPDATE community_events SET state='published' WHERE event_id=$1",[f.id]);
  assert.deepEqual(await availability(f.store),expected(false));
  await pool.query("UPDATE community_events SET state='pending',starts_at=clock_timestamp()-interval '1 second' WHERE event_id=$1",[f.id]);
  assert.deepEqual(await availability(f.store),expected(false));await empty();
});

test('actual adapter persists canonical bytes, cold pool reads, replaces once, removes, and retains historical charges',async()=>{
  const f=await setup(),firstCommand=command(f),first=await upload(f,firstCommand);
  assert.deepEqual(first,{acknowledged:true,event_id:f.id,prize_id:f.prizeId,organizer_ref:f.owner.user_id,command_key:firstCommand.key,operation:'replace',completed_version:2,photo:{prize_id:f.prizeId,photo_version:2,url:`/api/v1/events/${f.id}/prizes/${f.prizeId}/photo?v=2`}});
  assert.equal((await current(f)).target_id,eventPrizePhotoTargetId(f.id,f.prizeId));assert.equal((await current(f)).linked_at_version,'2');
  const cold=new Pool({connectionString:databaseUrl,options:`-c search_path=${schema}`});try{const bytes=await read(f,'2',cold);const metadata=await sharp(bytes).metadata();assert.equal(metadata.format,'webp');assert.equal(metadata.width,80);assert.equal(metadata.height,40);assert.equal(metadata.exif,undefined);assert.deepEqual(await eventPrizePhotos(cold,f.id),[first.photo]);}finally{await cold.end();}
  await assert.rejects(readPublicEventPrizePhoto(pool,f.id,f.prizeId,'2',f.store),status(404));
  const originalAsset=(await current(f)).asset_id,secondCommand=command(f,'2'),second=await upload(f,secondCommand,otherPng);assert.equal(second.completed_version,3);
  assert.equal((await pool.query('SELECT state FROM assets WHERE asset_id=$1',[originalAsset])).rows[0].state,'retired');
  await assert.rejects(read(f,'2'),status(404));assert.equal((await sharp(await read(f,'3')).metadata()).height,60);
  await pool.query("UPDATE domain_media_storage_policy SET persistence_allowed=false WHERE purpose='community.event-prize-photo'");
  const removal=command(f,'3'),removed=await remove(f,removal);assert.equal(removed.completed_version,4);assert.equal(removed.photo,null);
  assert.deepEqual(await remove(f,removal),removed);assert.equal(await eventVersion(f),'4');assert.equal((await current(f)).asset_id,null);await assert.rejects(read(f,'3'),status(404));
  const retained=await assets(f);assert.equal(retained.length,2);assert(retained.every(row=>row.state==='retired'&&row.intent_state==='finalized'&&row.byte_size>0));
  assert.deepEqual((await facts(f)).map(row=>row.aggregate_version),['2','3','4']);
  await assert.rejects(pool.query('SELECT lock_asset_deletion_domain($1)',[retained[0].asset_id]),sqlIntegrity);
});

test('same original key replays exact historical ACK after replacement/removal/publication without decoding or changing current photo',async()=>{
  const f=await setup(),original=command(f),first=await upload(f,original);let puts=0;const put=f.store.putImmutable.bind(f.store);f.store.putImmutable=async(...args)=>{puts++;return put(...args);};
  assert.deepEqual(await upload(f,original),first);assert.equal(puts,0);
  await upload(f,command(f,'2'),otherPng);const secondAsset=(await current(f)).asset_id;
  assert.deepEqual(await mutateEventPrizePhoto(pool,original,f.id,f.prizeId,{mime:'image/png',bytes:png}),first,'Historical ACK needs no installed storage');assert.equal((await current(f)).asset_id,secondAsset);
  await assert.rejects(upload(f,original,otherPng),status(409));await assert.rejects(upload(f,{...original,expected:'2'}),status(409));
  const sameSize=Buffer.from(png);sameSize[sameSize.length-1]^=1;
  for(const file of [{mime:'image/jpeg',bytes:png},{mime:'image/png',bytes:Buffer.concat([png,Buffer.from([0])])},{mime:'image/png',bytes:sameSize}])
    await assert.rejects(mutateEventPrizePhoto(pool,original,f.id,f.prizeId,file,f.store),status(409));
  await remove(f,command(f,'3'));const after=await facts(f);
  await pool.query("UPDATE domain_media_storage_policy SET persistence_allowed=false WHERE purpose='community.event-prize-photo'");
  assert.deepEqual(await runWithImageProcessor(createUnavailableImageProcessor(),()=>mutateEventPrizePhoto(pool,original,f.id,f.prizeId,{mime:'image/png',bytes:png})),first);assert.equal((await current(f)).asset_id,null);
  await pool.query("UPDATE community_events SET state='published',aggregate_version=5 WHERE event_id=$1",[f.id]);
  assert.deepEqual(await runWithImageProcessor(createUnavailableImageProcessor(),()=>mutateEventPrizePhoto(pool,original,f.id,f.prizeId,{mime:'image/png',bytes:png})),first);assert.equal(await eventVersion(f),'5');assert.deepEqual(await facts(f),after);assert.equal((await assets(f)).length,2);
  assert.equal(puts,1,'Only the genuinely new second image issued PUT');
});

test('current session, organizer and community authority precede old receipt replay',async()=>{
  for(const loss of ['revoked','expired','inactive','principal','scope','onboarding'] as const){
    const f=await setup(),c=command(f);await upload(f,c);const before=await facts(f);let puts=0;f.store.putImmutable=async()=>{puts++;throw Error('Unexpected PUT');};
    if(loss==='revoked')await pool.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1',[f.owner.session_hash]);
    if(loss==='expired')await pool.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1",[f.owner.session_hash]);
    if(loss==='inactive')await pool.query('UPDATE users SET active=false WHERE user_id=$1',[f.owner.user_id]);
    if(loss==='principal')await pool.query("UPDATE principals SET status='disabled' WHERE user_ref=$1",[f.owner.user_id]);
    if(loss==='scope')await pool.query("UPDATE resource_scopes SET status='disabled' WHERE community_ref=$1",[f.community]);
    if(loss==='onboarding'){
      assert.equal(f.owner.onboarding_required,false,'The HTTP actor still carries its earlier authorization snapshot');
      await pool.query('UPDATE users SET onboarding_required=true,onboarding_completed_at=NULL WHERE user_id=$1',[f.owner.user_id]);
      const beforeTarget=await current(f),beforeAssets=await assets(f);
      await assert.rejects(upload(f,command(f,'2')),code('onboarding_required'),'A new upload must recheck the locked current user');
      await assert.rejects(remove(f,command(f,'2')),code('onboarding_required'),'Removal must not use stale HTTP onboarding');
      await assert.rejects(read(f,'2'),code('onboarding_required'));
      await assert.rejects(readEventPrizePhotoAvailability(pool,f.owner,f.id,f.prizeId,f.store),code('onboarding_required'));
      assert.deepEqual(await current(f),beforeTarget);assert.deepEqual(await assets(f),beforeAssets);
      // This is specifically a text update that removes a saved prize with a
      // current photo. It makes no claim about unrelated or omitted text fields.
      const clearing={...command(f,'2'),operation:`POST /api/v1/events/${f.id}`,body:{...f.body,prize_details:[]}};
      const deletionState=async()=>({
        target:await current(f),
        event:(await pool.query('SELECT * FROM community_events WHERE event_id=$1',[f.id])).rows,
        assets:(await pool.query('SELECT a.* FROM assets a JOIN asset_upload_intents i USING(asset_id) WHERE i.target_prize_photo_id=$1 ORDER BY a.asset_id',[eventPrizePhotoTargetId(f.id,f.prizeId)])).rows,
        facts:(await pool.query("SELECT * FROM transition_journal WHERE aggregate_type='community_event' AND aggregate_id=$1 ORDER BY aggregate_version",[f.id])).rows,
        photoFacts:(await pool.query("SELECT * FROM scoped_transition_journal WHERE aggregate_type='community_event' AND aggregate_id=$1 ORDER BY aggregate_version",[f.id])).rows,
        receipts:(await pool.query('SELECT * FROM command_receipts WHERE user_id=$1 AND operation=$2 ORDER BY idempotency_key',[f.owner.user_id,clearing.operation])).rows,
      });
      const beforeDeletion=await deletionState();
      await assert.rejects(updateEvent(pool,clearing,f.id),code('onboarding_required'),'Deleting a prize with a photo must recheck current DB onboarding');
      assert.deepEqual(await deletionState(),beforeDeletion,'Rejected deletion preserves the full pointer, event, Assets, facts and receipt rows');
    }
    await assert.rejects(upload(f,c),code(loss==='principal'?'principal_disabled':loss==='scope'?'scope_disabled':loss==='onboarding'?'onboarding_required':'session_expired'));assert.equal(puts,0);assert.deepEqual(await facts(f),before);assert.equal(await eventVersion(f),'2');
  }
  const f=await setup(),c=command(f);await upload(f,c);await assert.rejects(upload(f,{...c,actor:await member(f.community)}),code('organizer_required'));
});

test('updateEvent omission and same-ID edits preserve photos; clear uses real atomic detach-retire and old writers fail',async()=>{
  const f=await setup();await upload(f);const asset=(await current(f)).asset_id;
  await assert.rejects(pool.query("UPDATE community_events SET prize_details='[]'::jsonb,aggregate_version=aggregate_version+1 WHERE event_id=$1",[f.id]),sqlIntegrity);
  const {prize_details:ignored,...omitted}=f.body;void ignored;
  await updateEvent(pool,{...command(f,'2'),operation:`POST /api/v1/events/${f.id}`,body:{...omitted,title:'僅改活動文字'}},f.id);
  assert.equal((await current(f)).asset_id,asset);assert.equal((await current(f)).linked_at_version,'2');
  await updateEvent(pool,{...command(f,'3'),operation:`POST /api/v1/events/${f.id}`,body:{...f.body,prize_details:[{...f.body.prize_details[0],name:'同一項獎品改名'}]}},f.id);
  assert.equal((await current(f)).asset_id,asset);assert.equal(await eventVersion(f),'4');
  const clearing={...command(f,'4'),operation:`POST /api/v1/events/${f.id}`,body:{...f.body,prize_details:[]}};
  const result=await updateEvent(pool,clearing,f.id);assert.deepEqual(result.prize_details,[]);assert.deepEqual(result.prize_photos,[]);
  assert.equal(await eventVersion(f),'5');assert.equal((await current(f)).asset_id,null);assert.equal((await assets(f))[0].state,'retired');
  assert.deepEqual(JSON.parse(JSON.stringify(await updateEvent(pool,clearing,f.id))),JSON.parse(JSON.stringify(result)));assert.equal(await eventVersion(f),'5');
  await assert.rejects(upload(f,command(f,'5')),code('event_prize_not_found'));assert.equal((await assets(f)).length,1);
});

test('photo prize deletion rolls back after a proven receipt INSERT wait crosses the original start, even when rescheduled later',async()=>{
  const f=await setup();await upload(f);const blocker=await pool.connect();let task:Promise<{value?:unknown;error?:unknown}>|undefined;
  const clearing={...command(f,'2'),operation:`POST /api/v1/events/${f.id}`,body:{...f.body,prize_details:[]}};
  const snapshot=async()=>({
    event:(await pool.query('SELECT * FROM community_events WHERE event_id=$1',[f.id])).rows,
    target:(await pool.query('SELECT * FROM community_event_prize_photo_targets WHERE event_id=$1',[f.id])).rows,
    asset:(await pool.query('SELECT a.* FROM assets a JOIN asset_upload_intents i USING(asset_id) WHERE i.target_prize_photo_id=$1 ORDER BY a.asset_id',[eventPrizePhotoTargetId(f.id,f.prizeId)])).rows,
    intent:(await pool.query('SELECT * FROM asset_upload_intents WHERE target_prize_photo_id=$1 ORDER BY intent_id',[eventPrizePhotoTargetId(f.id,f.prizeId)])).rows,
    facts:(await pool.query("SELECT * FROM transition_journal WHERE aggregate_type='community_event' AND aggregate_id=$1 ORDER BY aggregate_version",[f.id])).rows,
    photoFacts:await facts(f),
    receipts:(await pool.query('SELECT * FROM command_receipts WHERE user_id=$1 AND operation=$2 ORDER BY idempotency_key',[f.owner.user_id,clearing.operation])).rows,
    photoReceipts:(await pool.query('SELECT * FROM scoped_command_receipts WHERE target_id=$1 ORDER BY operation,idempotency_key',[f.id])).rows,
  });
  try{
    await blocker.query('BEGIN');await blocker.query('LOCK TABLE command_receipts IN SHARE MODE');
    const blockerPid=Number((await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
    await pool.query("UPDATE community_events SET starts_at=clock_timestamp()+interval '3 seconds' WHERE event_id=$1",[f.id]);
    const before=await snapshot();assert.equal(before.target[0].asset_id,before.asset[0].asset_id);assert.equal(before.asset[0].state,'ready');
    // The body moves the start back to tomorrow. The original deadline must
    // still govern this photo detachment, without banning legitimate reschedules.
    task=updateEvent(pool,clearing,f.id).then(value=>({value}),error=>({error}));
    await waitFor(async()=>Boolean((await pool.query(`SELECT EXISTS(
      SELECT 1 FROM pg_stat_activity a WHERE $1=ANY(pg_blocking_pids(a.pid))
        AND a.wait_event_type='Lock' AND a.query LIKE 'INSERT INTO command_receipts(%'
        AND EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=a.pid AND l.relation='command_receipts'::regclass
          AND l.mode='RowExclusiveLock' AND NOT l.granted)) AS waiting`,[blockerPid])).rows[0].waiting),
      'The real command must reach receipt INSERT, after detachment, retirement, event update and journal write');
    await waitFor(async()=>Boolean((await pool.query('SELECT starts_at<=clock_timestamp() expired FROM community_events WHERE event_id=$1',[f.id])).rows[0].expired),
      'The database clock must cross the committed original start while receipt INSERT remains blocked');
    assert.equal((await pool.query('SELECT $1::timestamptz>clock_timestamp() AS future',[clearing.body.starts_at])).rows[0].future,true);
    await blocker.query('COMMIT');const result=await task;assert.ok(code('event_closed')(result.error),'The old deadline must reject the whole transaction after receipt insertion');
    assert.deepEqual(await snapshot(),before,'Pointer, linked version, Asset retirement, event/reschedule, facts and receipts must all roll back');
    assert.equal(await eventVersion(f),'2');assert((await read(f,'2')).byteLength>0);
  }finally{await blocker.query('ROLLBACK');blocker.release();if(task)await task;}
});

test('public bytes retain their ACL after owner onboarding revocation and observe visibility and cancellation',async()=>{
  const f=await setup();await upload(f);await pool.query("UPDATE community_events SET state='published',aggregate_version=3 WHERE event_id=$1",[f.id]);
  const publicBytes=await readPublicEventPrizePhoto(pool,f.id,f.prizeId,'2',f.store);assert(publicBytes.byteLength>0);
  await pool.query('UPDATE users SET onboarding_required=true,onboarding_completed_at=NULL WHERE user_id=$1',[f.owner.user_id]);
  await assert.rejects(read(f,'2'),code('onboarding_required'));
  assert.deepEqual(await readPublicEventPrizePhoto(pool,f.id,f.prizeId,'2',f.store),publicBytes,'Anonymous published/open access does not acquire the member-only onboarding gate');
  await pool.query("UPDATE community_events SET visibility='workshop' WHERE event_id=$1",[f.id]);await assert.rejects(readPublicEventPrizePhoto(pool,f.id,f.prizeId,'2',f.store),status(404));
  await pool.query("UPDATE community_events SET visibility='open' WHERE event_id=$1",[f.id]);const get=f.store.get.bind(f.store);
  f.store.get=async(...args)=>{const value=await get(...args);await pool.query("UPDATE community_events SET state='cancelled',aggregate_version=4 WHERE event_id=$1",[f.id]);return value;};
  await assert.rejects(readPublicEventPrizePhoto(pool,f.id,f.prizeId,'2',f.store),status(404));assert.equal((await current(f)).linked_at_version,'2');
});

for(const loss of ['session','onboarding'] as const)test(`${loss} revocation during object bytes is observed by the second member snapshot`,async()=>{
  const f=await setup();await upload(f);const get=f.store.get.bind(f.store);let called=false;
  f.store.get=async(...args)=>{const object=await get(...args);assert.ok(object);return {...object,body:new ReadableStream<Uint8Array>({async start(controller){try{
    if(loss==='session')await pool.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1',[f.owner.session_hash]);
    else await pool.query('UPDATE users SET onboarding_required=true,onboarding_completed_at=NULL WHERE user_id=$1',[f.owner.user_id]);
    called=true;controller.enqueue(new Uint8Array(await new Response(object.body).arrayBuffer()));controller.close();
  }catch(error){controller.error(error);}}})};};
  await assert.rejects(read(f,'2'),code(loss==='session'?'session_expired':'onboarding_required'));assert.equal(called,true);
  assert.equal(f.owner.onboarding_required,false,'The second snapshot must not trust the unchanged HTTP actor');assert.equal(await eventVersion(f),'2');
});

test('unknown PUT survives original retry as one retained intent and is never silently settled by later readback',async()=>{
  const f=await setup(),c=command(f);f.store.failNext('put-after');f.store.failNext('get');await assert.rejects(upload(f,c),status(503));
  const pending=await assets(f);assert.equal(pending.length,1);assert.equal(pending[0].state,'pending');assert.equal(await eventVersion(f),'1');assert.equal((await current(f)).asset_id,null);
  const result=await upload(f,c);assert.equal(result.completed_version,2);assert.equal((await assets(f)).length,1);
  const effects=(await pool.query('SELECT state FROM asset_object_write_effects WHERE intent_id=$1 ORDER BY begun_at,effect_id',[pending[0].intent_id])).rows.map(row=>row.state);
  assert(effects.includes('unknown'));assert(effects.includes('fulfilled'));assert((await read(f,'2')).byteLength>0);
  assert.deepEqual((await pool.query('SELECT state FROM asset_object_write_effects WHERE intent_id=$1 ORDER BY begun_at,effect_id',[pending[0].intent_id])).rows.map(row=>row.state),effects);
});

test('concurrent same command converges on one ACK, one event version, one intent and one domain fact',async()=>{
  const f=await setup(),c=command(f);const responses=await Promise.all([upload(f,c),upload(f,c)]);assert.deepEqual(responses[0],responses[1]);
  assert.equal(await eventVersion(f),'2');assert.equal((await assets(f)).length,1);assert.equal((await facts(f)).length,1);
  assert.equal((await pool.query("SELECT count(*)::int n FROM scoped_command_receipts WHERE target_id=$1 AND operation='community.event.prize-photo.replace' AND idempotency_key=$2",[f.id,c.key])).rows[0].n,1);
});

test('concurrent different photos share the one event CAS and cannot both publish expected version one',async()=>{
  const f=await setup();const results=await Promise.allSettled([upload(f,command(f)),upload(f,command(f),otherPng)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const denied=results.find(r=>r.status==='rejected') as PromiseRejectedResult;assert.ok(status(412)(denied.reason));
  assert.equal(await eventVersion(f),'2');assert.equal((await facts(f)).length,1);assert.equal((await assets(f)).filter(row=>row.state==='ready').length,1);
});

for(const deadline of ['session','event'] as const)test(`${deadline} expiry during a proven event lock wait prevents any image write`,async()=>{
  const f=await setup(),lock=await pool.connect();let task:Promise<{value?:unknown;error?:unknown}>|undefined,puts=0;const put=f.store.putImmutable.bind(f.store);f.store.putImmutable=async(...args)=>{puts++;return put(...args);};
  try{
    if(deadline==='session')await pool.query("UPDATE sessions SET expires_at=clock_timestamp()+interval '2 seconds' WHERE token_hash=$1",[f.owner.session_hash]);
    else await pool.query("UPDATE community_events SET starts_at=clock_timestamp()+interval '2 seconds' WHERE event_id=$1",[f.id]);
    await lock.query('BEGIN');const pid=Number((await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);await lock.query('SELECT 1 FROM community_events WHERE event_id=$1 FOR UPDATE',[f.id]);
    task=upload(f).then(value=>({value}),error=>({error}));await waitFor(()=>blockedBy(pid),'The real event lock wait must be observed');
    await waitFor(async()=>Boolean((await pool.query(deadline==='session'?'SELECT expires_at<=clock_timestamp() expired FROM sessions WHERE token_hash=$1':'SELECT starts_at<=clock_timestamp() expired FROM community_events WHERE event_id=$1',[deadline==='session'?f.owner.session_hash:f.id])).rows[0].expired),'The DB decision clock must cross the deadline');
    await lock.query('COMMIT');const result=await task;assert.ok(result.error);assert.ok(code(deadline==='session'?'session_expired':'event_closed')(result.error));
    assert.equal(puts,0);assert.equal((await assets(f)).length,0);assert.equal(await eventVersion(f),'1');
  }finally{await lock.query('ROLLBACK');lock.release();if(task)await task;}
});

for(const mutation of ['replace','remove'] as const)test(`member read discards old bytes when ${mutation} completes during GET body`,async()=>{
  const f=await setup();await upload(f);const get=f.store.get.bind(f.store);let changed=false;
  f.store.get=async(...args)=>{const object=await get(...args);assert.ok(object);if(changed)return object;changed=true;
    return {...object,body:new ReadableStream<Uint8Array>({async start(controller){try{
      if(mutation==='replace')await upload(f,command(f,'2'),otherPng);else await remove(f,command(f,'2'));
      controller.enqueue(new Uint8Array(await new Response(object.body).arrayBuffer()));controller.close();
    }catch(error){controller.error(error);}}})};
  };
  await assert.rejects(read(f,'2'),status(404));assert.equal(changed,true);assert.equal(await eventVersion(f),'3');
  if(mutation==='replace')assert((await read(f,'3')).byteLength>0);else assert.equal((await current(f)).asset_id,null);
});
