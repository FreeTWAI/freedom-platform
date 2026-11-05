import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {Pool,type PoolClient} from 'pg';
import {readMigrationSources} from '../../packages/db/migration-files.mjs';
import {legacyMigrationProfile} from '../../packages/db/migration-plan.mjs';
import {runMigrationPlan} from '../../packages/db/migration-runner.mjs';

// AUTHORED, NOT RUN in this change. These are actual PostgreSQL contracts, not
// a mock Pool or assertions that searching SQL text proves constraint behavior.
// No listener, external object store or native image decoder is started here.
const databaseUrl=process.env.TEST_DATABASE_URL;
const schema=`fp_prize_photo_schema_${process.pid}_${Date.now()}`;
const sources=readMigrationSources(fileURLToPath(new URL('../../migrations',import.meta.url))).filter(row=>Number(row.name.slice(0,3))<=201);
const profile=legacyMigrationProfile({first:1,last:201,known_gaps:[22]});
let admin:Pool,pool:Pool,created=false;
before(async()=>{
  assert.ok(databaseUrl,'Explicit isolated TEST_DATABASE_URL is required');
  const url=new URL(databaseUrl);
  assert.ok(['postgres:','postgresql:'].includes(url.protocol)&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)
    &&/^\/fp_[A-Za-z0-9_]+$/.test(url.pathname)&&!url.search&&!url.hash,'Only a local disposable fp_* database is admitted');
  admin=new Pool({connectionString:databaseUrl});
  pool=new Pool({connectionString:databaseUrl,options:`-c search_path=${schema} -c statement_timeout=10000`,max:8});
  await admin.query(`CREATE SCHEMA ${schema}`);created=true;
  await runMigrationPlan(pool,{sources,profile});
});
after(async()=>{if(pool)await pool.end();if(admin){try{if(created)await admin.query(`DROP SCHEMA ${schema} CASCADE`);}finally{await admin.end();}}});
type Query=Pick<PoolClient,'query'>;
type Target={community:string;user:string;principal:string;scope:string;event:string;prize:string;target:string};
type Upload={asset:string;intent:string;representation:string;expected:number};
const purpose='community.event-prize-photo';
const prize=(id:string=randomUUID())=>({prize_id:id,name:'合成獎品',description:'僅供資料庫契約測試',quantity:1,icon_id:'gift',completion_rule:'主辦評選',claim_note:'現場領取'});
const integrity=(error:unknown)=>['23514','23503'].includes((error as {code?:string}).code??'');
async function tx<T>(body:(q:PoolClient)=>Promise<T>,db=pool){const q=await db.connect();try{await q.query('BEGIN');const result=await body(q);await q.query('COMMIT');return result;}catch(error){await q.query('ROLLBACK');throw error;}finally{q.release();}}
async function fixture(db:Query=pool,sharedPrize:string=randomUUID(),createTarget=true):Promise<Target>{
  const f={community:randomUUID(),user:randomUUID(),principal:randomUUID(),scope:randomUUID(),event:randomUUID(),prize:sharedPrize,target:randomUUID()};
  await db.query('INSERT INTO communities(community_id,name) VALUES($1,$2)',[f.community,'Synthetic prize photo']);
  await db.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref)
    VALUES($1,$2,$3,'Synthetic','not-a-login', $4)`,[f.user,f.community,`${f.user}@prize.test`,randomUUID()]);
  await db.query('INSERT INTO principals(principal_id,user_ref) VALUES($1,$2)',[f.principal,f.user]);
  await db.query("INSERT INTO resource_scopes(scope_id,kind,community_ref) VALUES($1,'community',$2)",[f.scope,f.community]);
  await db.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,prize_details)
    VALUES($1,$2,$3,'Synthetic','Synthetic',clock_timestamp()+interval '1 day',clock_timestamp()+interval '2 days','online','Synthetic',$4::jsonb)`,[f.event,f.community,f.user,JSON.stringify([prize(f.prize)])]);
  if(createTarget)await insertTarget(db,f);
  return f;
}
async function insertTarget(q:Query,f:Target){await q.query(`INSERT INTO community_event_prize_photo_targets(target_id,event_id,prize_id,community_id,scope_id,owner_principal_id,owner_user_id)
  VALUES($1,$2,$3,$4,$5,$6,$7)`,[f.target,f.event,f.prize,f.community,f.scope,f.principal,f.user]);}
async function enable(q:Query=pool){await q.query("UPDATE domain_media_storage_policy SET mode='r2_only',persistence_allowed=true,policy_revision='synthetic-prize-v1',retained_byte_limit=10485760 WHERE purpose=$1",[purpose]);}
async function prepared(f:Target,expected=1,q:Query=pool):Promise<Upload>{
  const u={asset:randomUUID(),intent:randomUUID(),representation:randomUUID(),expected};
  await q.query(`INSERT INTO assets(asset_id,scope_id,scope_kind,community_ref,owner_principal_id,owner_user_id,purpose,policy_revision,representation_id,write_effect_coverage)
    VALUES($1,$2,'community',$3,$4,$5,$6,'synthetic-prize-v1',$7,true)`,[u.asset,f.scope,f.community,f.principal,f.user,purpose,u.representation]);
  await q.query(`INSERT INTO asset_upload_intents(intent_id,asset_id,representation_id,scope_id,owner_principal_id,target_user_id,purpose,policy_revision,prepare_key,request_digest,
    source_content_type,source_byte_size,source_sha256,expected_version,expires_at,reserved_bytes,target_kind,target_prize_photo_id,target_community_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,'synthetic-prize-v1',$8,$9,'image/png',80,$9,$10,clock_timestamp()+interval '1 hour',1048576,$7,$11,$12)`,
  [u.intent,u.asset,u.representation,f.scope,f.principal,f.user,purpose,randomUUID(),'a'.repeat(64),expected,f.target,f.community]);
  return u;
}
async function stored(f:Target,expected=1,q:Query=pool):Promise<Upload>{
  const u=await prepared(f,expected,q);
  await q.query("UPDATE asset_upload_intents SET state='processing',fence=1,lease_token=$2,lease_expires_at=clock_timestamp()+interval '30 minutes' WHERE intent_id=$1",[u.intent,randomUUID()]);
  await q.query(`INSERT INTO asset_objects(asset_id,scope_id,representation_id,variant,content_type,byte_size,content_sha256,transform_version,policy_revision,purpose,profile_id,pixel_width,pixel_height)
    VALUES($1,$2,$3,'photo','image/webp',80,$4,'community.event-prize-photo.webp.v1','synthetic-prize-v1',$5,$5,40,20)`,[u.asset,f.scope,u.representation,'b'.repeat(64),purpose]);
  await q.query("UPDATE asset_upload_intents SET state='stored' WHERE intent_id=$1",[u.intent]);
  return u;
}
async function attach(q:Query,f:Target,u:Upload,finalize=true,retire=true){
  await q.query('SELECT 1 FROM community_events WHERE event_id=$1 FOR UPDATE',[f.event]);
  const old=(await q.query('SELECT asset_id FROM community_event_prize_photo_targets WHERE target_id=$1 FOR UPDATE',[f.target])).rows[0].asset_id;
  await q.query("UPDATE assets SET state='ready',ready_at=clock_timestamp() WHERE asset_id=$1",[u.asset]);
  const version=await q.query('UPDATE community_events SET aggregate_version=aggregate_version+1 WHERE event_id=$1 AND aggregate_version=$2 RETURNING aggregate_version',[f.event,u.expected]);
  assert.equal(version.rowCount,1,'The event CAS must succeed');
  await q.query('UPDATE community_event_prize_photo_targets SET asset_id=$2,linked_at_version=$3 WHERE target_id=$1',[f.target,u.asset,u.expected+1]);
  if(old&&retire)await q.query("UPDATE assets SET state='retired',retired_at=clock_timestamp() WHERE asset_id=$1",[old]);
  if(finalize)await q.query("UPDATE asset_upload_intents SET state='finalized',finalized_at=clock_timestamp() WHERE intent_id=$1",[u.intent]);
}
async function snapshot(f:Target){return (await pool.query(`SELECT t.target_id,t.asset_id,t.linked_at_version,e.aggregate_version,e.prize_details,
  a.state,a.deletion_fence,i.state AS intent_state FROM community_event_prize_photo_targets t JOIN community_events e USING(event_id)
  LEFT JOIN assets a USING(asset_id) LEFT JOIN asset_upload_intents i ON i.asset_id=t.asset_id WHERE t.target_id=$1`,[f.target])).rows[0];}
async function waitBlocked(blocker:number){const end=Date.now()+5000;while(Date.now()<end){const result=await pool.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked',[blocker]);if(result.rows[0].blocked)return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('A real PostgreSQL blocking relationship was not observed');}

test('new policy is unavailable, targets start empty, identity is retained, and strict seven-field JSON is unchanged',async()=>{
  assert.deepEqual((await pool.query('SELECT mode,persistence_allowed,policy_revision,retained_byte_limit FROM domain_media_storage_policy WHERE purpose=$1',[purpose])).rows,[{mode:'legacy',persistence_allowed:false,policy_revision:null,retained_byte_limit:null}]);
  const f=await fixture();const row=await snapshot(f);assert.equal(row.asset_id,null);assert.equal(row.linked_at_version,null);assert.equal(row.aggregate_version,'1');
  for(const field of ['target_id','event_id','prize_id','community_id','scope_id','owner_principal_id','owner_user_id'])await assert.rejects(pool.query(`UPDATE community_event_prize_photo_targets SET ${field}=$2 WHERE target_id=$1`,[f.target,randomUUID()]),integrity);
  await assert.rejects(pool.query('DELETE FROM community_event_prize_photo_targets WHERE target_id=$1',[f.target]),integrity);
  await assert.rejects(insertTarget(pool,{...f,target:randomUUID()}),(error:unknown)=>(error as {code?:string}).code==='23505');
  await assert.rejects(insertTarget(pool,{...f,target:randomUUID(),prize:randomUUID()}),integrity);
  for(const extra of [{asset_id:randomUUID()},{photo_url:'https://example.test/photo'},{target_id:f.target}])await assert.rejects(pool.query('UPDATE community_events SET prize_details=$2::jsonb WHERE event_id=$1',[f.event,JSON.stringify([{...prize(f.prize),...extra}])]),integrity);
});

test('exact stored upload attaches, cold reads survive new connection, replacement retires, and removal retains history',async()=>{
  const f=await fixture();await enable();const one=await stored(f);await tx(q=>attach(q,f,one));
  const cold=await pool.connect();try{assert.deepEqual((await cold.query('SELECT asset_id,linked_at_version FROM community_event_prize_photo_targets WHERE event_id=$1 AND prize_id=$2',[f.event,f.prize])).rows,[{asset_id:one.asset,linked_at_version:'2'}]);}finally{cold.release();}
  const two=await stored(f,2);await tx(q=>attach(q,f,two));assert.equal((await snapshot(f)).aggregate_version,'3');assert.equal((await snapshot(f)).intent_state,'finalized');
  assert.equal((await pool.query('SELECT state FROM assets WHERE asset_id=$1',[one.asset])).rows[0].state,'retired');
  await pool.query('UPDATE domain_media_storage_policy SET persistence_allowed=false WHERE purpose=$1',[purpose]);
  await tx(async q=>{await q.query('UPDATE community_events SET aggregate_version=aggregate_version+1 WHERE event_id=$1 AND aggregate_version=3',[f.event]);await q.query('UPDATE community_event_prize_photo_targets SET asset_id=NULL,linked_at_version=NULL WHERE target_id=$1',[f.target]);await q.query("UPDATE assets SET state='retired',retired_at=clock_timestamp() WHERE asset_id=$1",[two.asset]);});
  assert.equal((await snapshot(f)).asset_id,null);assert.equal((await snapshot(f)).aggregate_version,'4');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM asset_upload_intents WHERE target_prize_photo_id=$1',[f.target])).rows[0].n,2);
  assert.equal((await pool.query('SELECT sum(o.byte_size)::int AS n FROM asset_objects o JOIN assets a USING(asset_id) WHERE a.scope_id=$1',[f.scope])).rows[0].n,160,'Both retired representations remain retained and charged');
  await assert.rejects(pool.query('SELECT lock_asset_deletion_domain($1)',[two.asset]),integrity);
});

test('stored-to-finalized and detach-to-retired obligations fail at COMMIT and roll back the whole publication',async()=>{
  const f=await fixture();await enable();const one=await stored(f);await assert.rejects(tx(q=>attach(q,f,one,false)),integrity);
  assert.equal((await snapshot(f)).asset_id,null);assert.equal((await snapshot(f)).aggregate_version,'1');
  assert.equal((await pool.query('SELECT state FROM assets WHERE asset_id=$1',[one.asset])).rows[0].state,'pending');
  await tx(q=>attach(q,f,one));const two=await stored(f,2);await assert.rejects(tx(q=>attach(q,f,two,true,false)),integrity);
  assert.equal((await snapshot(f)).asset_id,one.asset);assert.equal((await snapshot(f)).aggregate_version,'2');
  await assert.rejects(tx(async q=>{await q.query('UPDATE community_event_prize_photo_targets SET asset_id=NULL,linked_at_version=NULL WHERE target_id=$1',[f.target]);}),integrity);
  assert.equal((await snapshot(f)).asset_id,one.asset);
});

test('same prize ID in a different event has independent targets and cannot steal a stored upload',async()=>{
  const f=await fixture(),other=await fixture(pool,f.prize);await enable();assert.notEqual(f.target,other.target);
  const u=await stored(f);await assert.rejects(tx(async q=>{await q.query("UPDATE assets SET state='ready',ready_at=clock_timestamp() WHERE asset_id=$1",[u.asset]);await q.query('UPDATE community_events SET aggregate_version=2 WHERE event_id=$1',[other.event]);await q.query('UPDATE community_event_prize_photo_targets SET asset_id=$2,linked_at_version=2 WHERE target_id=$1',[other.target,u.asset]);}),integrity);
  for(const patch of [{scope:other.scope},{principal:other.principal},{user:other.user},{community:other.community}]){const fresh=await fixture(pool,randomUUID(),false);await assert.rejects(insertTarget(pool,{...fresh,...patch}),integrity);}
  await assert.rejects(pool.query('UPDATE asset_upload_intents SET target_prize_photo_id=$2 WHERE intent_id=$1',[u.intent,other.target]),integrity);
  await assert.rejects(pool.query('UPDATE asset_upload_intents SET target_event_id=$2 WHERE intent_id=$1',[u.intent,f.event]),integrity);
});

test('current photo prevents old-writer prize deletion; atomic detach-retire-delete preserves a reusable retained target',async()=>{
  const f=await fixture();await enable();const u=await stored(f);await tx(q=>attach(q,f,u));
  await assert.rejects(pool.query("UPDATE community_events SET prize_details='[]'::jsonb,aggregate_version=aggregate_version+1 WHERE event_id=$1",[f.event]),integrity);
  assert.equal((await snapshot(f)).asset_id,u.asset);assert.equal((await snapshot(f)).aggregate_version,'2');
  await pool.query('UPDATE community_events SET prize_details=$2::jsonb,aggregate_version=aggregate_version+1 WHERE event_id=$1',[f.event,JSON.stringify([{...prize(f.prize),name:'同 ID 更名'}])]);
  assert.equal((await snapshot(f)).linked_at_version,'2');assert.equal((await snapshot(f)).aggregate_version,'3');
  await tx(async q=>{await q.query('SELECT 1 FROM community_events WHERE event_id=$1 FOR UPDATE',[f.event]);await q.query('UPDATE community_event_prize_photo_targets SET asset_id=NULL,linked_at_version=NULL WHERE target_id=$1',[f.target]);await q.query("UPDATE assets SET state='retired',retired_at=clock_timestamp() WHERE asset_id=$1",[u.asset]);await q.query("UPDATE community_events SET prize_details='[]'::jsonb,aggregate_version=4 WHERE event_id=$1 AND aggregate_version=3",[f.event]);});
  assert.equal((await snapshot(f)).target_id,f.target);assert.deepEqual((await snapshot(f)).prize_details,[]);
  await pool.query('UPDATE community_events SET prize_details=$2::jsonb,aggregate_version=5 WHERE event_id=$1',[f.event,JSON.stringify([prize(f.prize)])]);
  const replacement=await stored(f,5);await tx(q=>attach(q,f,replacement));assert.equal((await snapshot(f)).linked_at_version,'6');
});

test('publication rejects stale event version, started/published event, disabled/revised policy and missing objects',async()=>{
  for(const mode of ['stale','started','published','disabled','revision']){
    const f=await fixture();await enable();const u=await stored(f);
    if(mode==='stale')await pool.query('UPDATE community_events SET aggregate_version=2 WHERE event_id=$1',[f.event]);
    if(mode==='started')await pool.query("UPDATE community_events SET starts_at=clock_timestamp()-interval '1 minute' WHERE event_id=$1",[f.event]);
    if(mode==='published')await pool.query("UPDATE community_events SET state='published' WHERE event_id=$1",[f.event]);
    if(mode==='disabled')await pool.query('UPDATE domain_media_storage_policy SET persistence_allowed=false WHERE purpose=$1',[purpose]);
    if(mode==='revision')await pool.query("UPDATE domain_media_storage_policy SET policy_revision='synthetic-prize-v2' WHERE purpose=$1",[purpose]);
    await assert.rejects(tx(async q=>{await q.query("UPDATE assets SET state='ready',ready_at=clock_timestamp() WHERE asset_id=$1",[u.asset]);await q.query('UPDATE community_events SET aggregate_version=aggregate_version+1 WHERE event_id=$1',[f.event]);await q.query('UPDATE community_event_prize_photo_targets SET asset_id=$2,linked_at_version=2 WHERE target_id=$1',[f.target,u.asset]);}),integrity);
    assert.equal((await snapshot(f)).asset_id,null);
  }
  const f=await fixture();await enable();const u=await prepared(f);await assert.rejects(pool.query("UPDATE assets SET state='ready',ready_at=clock_timestamp() WHERE asset_id=$1",[u.asset]),integrity);
});

test('actual event lock serializes old-writer deletion after publication and preserves the new photo',async()=>{
  const f=await fixture();await enable();const u=await stored(f);const lock=await pool.connect();let pending:Promise<unknown>|undefined;
  try{await lock.query('BEGIN');const pid=Number((await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);await lock.query('SELECT 1 FROM community_events WHERE event_id=$1 FOR UPDATE',[f.event]);
    pending=pool.query("UPDATE community_events SET prize_details='[]'::jsonb WHERE event_id=$1",[f.event]).then(()=>({ok:true}),error=>({error}));
    await waitBlocked(pid);await attach(lock,f,u);await lock.query('COMMIT');const result=await pending as {error?:unknown};assert.ok(result.error);assert.ok(integrity(result.error));assert.equal((await snapshot(f)).asset_id,u.asset);
  }finally{await lock.query('ROLLBACK');lock.release();if(pending)await pending;}
});

test('upgrade from schema200 preserves existing prizes and installed admissions, adds one closed policy, and is idempotent',async()=>{
  const name=`${schema}_upgrade`,old=new Pool({connectionString:databaseUrl,options:`-c search_path=${name} -c statement_timeout=10000`});let made=false;
  try{await admin.query(`CREATE SCHEMA ${name}`);made=true;await runMigrationPlan(old,{sources:sources.filter(s=>Number(s.name.slice(0,3))<=200),profile:legacyMigrationProfile({first:1,last:200,known_gaps:[22]})});
    const f=await fixture(old,randomUUID(),false),before=(await old.query('SELECT to_jsonb(e) AS value FROM community_events e WHERE event_id=$1',[f.event])).rows;
    const ledger=(await old.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
    const functions=await old.query("SELECT proname,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND proname IN ('preserve_domain_media_floor','preserve_asset_object_write_effect','lock_asset_deletion_domain','check_asset_deletion_claim') ORDER BY proname");
    const applied=await runMigrationPlan(old,{sources,profile});assert.deepEqual(applied.applied,['201_event_prize_photos.sql']);
    assert.deepEqual((await old.query('SELECT to_jsonb(e) AS value FROM community_events e WHERE event_id=$1',[f.event])).rows,before);
    assert.deepEqual((await old.query("SELECT * FROM schema_migrations WHERE name<'201_' ORDER BY name")).rows,ledger);
    assert.deepEqual((await old.query('SELECT mode,persistence_allowed,policy_revision,retained_byte_limit FROM domain_media_storage_policy WHERE purpose=$1',[purpose])).rows,[{mode:'legacy',persistence_allowed:false,policy_revision:null,retained_byte_limit:null}]);
    for(const row of functions.rows){const after=(await old.query('SELECT pg_get_functiondef($1::regproc) AS definition',[row.proname])).rows[0].definition;assert.equal(after.replace(",'community.event-prize-photo'",''),row.definition,row.proname);}
    assert.equal((await old.query('SELECT count(*)::int AS n FROM community_event_prize_photo_targets')).rows[0].n,0);assert.deepEqual((await runMigrationPlan(old,{sources,profile})).applied,[]);
  }finally{await old.end();if(made)await admin.query(`DROP SCHEMA ${name} CASCADE`);}
});

test('object schema rejects legacy transform, missing profile/dimensions, oversized output and nonpositive or oversized dimensions',async()=>{
  const f=await fixture(),u=await prepared(f);
  const sql=`INSERT INTO asset_objects(asset_id,scope_id,representation_id,variant,content_type,byte_size,content_sha256,transform_version,policy_revision,purpose,profile_id,pixel_width,pixel_height)
    VALUES($1,$2,$3,$4,'image/webp',$5,$6,$7,'synthetic-prize-v1',$8,$9,$10,$11)`;
  const good={variant:'photo',bytes:80,transform:'community.event-prize-photo.webp.v1',profile:purpose,width:40,height:20};
  for(const patch of [{variant:'image'},{bytes:0},{bytes:1048577},{transform:'community.event-prize-photo.legacy-bytes.v1'},{profile:null},{width:null},{height:null},{width:0},{height:-1},{width:1921},{height:1921}]){
    const value={...good,...patch};await assert.rejects(pool.query(sql,[u.asset,f.scope,u.representation,value.variant,value.bytes,'b'.repeat(64),value.transform,purpose,value.profile,value.width,value.height]),integrity);
  }
  await pool.query(sql,[u.asset,f.scope,u.representation,good.variant,good.bytes,'b'.repeat(64),good.transform,purpose,good.profile,good.width,good.height]);
  assert.equal((await pool.query('SELECT pixel_width FROM asset_objects WHERE asset_id=$1',[u.asset])).rows[0].pixel_width,40);
});
