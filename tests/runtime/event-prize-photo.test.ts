import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Pool,PoolClient} from 'pg';
import type {Actor} from '../../modules/identity-membership/service.js';
import {createAssetLifecycle,createAssetLifecycleWithAuthority,type LifecycleProfile,type LifecyclePrepare} from '../../modules/assets/engine.js';
import {memberLifecycleAuthority} from '../../modules/assets/lifecycle-authority.js';
import {assertEventPrizePhotoSource,normalizeEventPrizePhoto,eventPrizePhotoPolicy,readEventPrizePhotoAvailability} from '../../modules/assets/event-prize-photo.js';
import {readAuthorizedEventPrizePhoto,type EventPrizePhotoSnapshot} from '../../modules/assets/event-prize-photo-read.js';
import {eventPrizePhotoTargetId} from '../../modules/community/event-prize-photos.js';
import {eventPrizePhotoUrl} from '../../modules/community/event-prize-photo-state.js';
import {runWithImageProcessor,createUnavailableImageProcessor} from '../../packages/shared/image-runtime.js';
import {FakeObjectStore} from '../../packages/asset-storage/fake-store.js';
import {prepareLegacyMediaRepresentation,writeVerifiedObject,objectKey,sha256,AssetStorageError,validateMetadata,type ObjectMetadata,type ObjectStore} from '../../packages/asset-storage/index.js';
import {Problem} from '../../packages/shared/problem.js';
import {isEventPrizePhotoUpload,isEventPrizePhotoRemove,checkEventPrizePhotoHeaders,createEventPrizePhotoRoutes,createPublicEventPrizePhotoRoutes} from '../../apps/platform-api/src/routes/event-prize-photos.js';

const eventId='10000000-0000-4000-8000-000000000001',prizeId='20000000-0000-4000-8000-000000000001';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
// Structural container only. The controlled processor is NOT native pixel decoding.
function webp(width=1,height=1){const b=Buffer.alloc(26);b.write('RIFF');b.writeUInt32LE(18,4);b.write('WEBP',8);b.write('VP8L',12);b.writeUInt32LE(5,16);b[20]=0x2f;b.writeUInt32LE((width-1)|((height-1)<<14),21);return b;}
const stream=(bytes:Uint8Array)=>new ReadableStream<Uint8Array>({start(c){c.enqueue(bytes);c.close();}});
const policy={revision:'synthetic-event-prize-photo',platformPersistenceAllowed:true};

test('prize target identity binds the canonical event and prize tuple, never prize alone',()=>{
 const first=eventPrizePhotoTargetId(eventId,prizeId);assert.equal(first,eventPrizePhotoTargetId(eventId.toUpperCase(),prizeId.toUpperCase()));
 assert.match(first,/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 assert.notEqual(first,eventPrizePhotoTargetId('10000000-0000-4000-8000-000000000002',prizeId));
 assert.notEqual(first,eventPrizePhotoTargetId(eventId,'20000000-0000-4000-8000-000000000002'));
 assert.throws(()=>eventPrizePhotoTargetId(eventId,eventId+'?v=2'));assert.throws(()=>eventPrizePhotoTargetId(eventId,first));
 assert.equal(eventPrizePhotoUrl(eventId,prizeId,3),`/api/v1/events/${eventId}/prizes/${prizeId}/photo?v=3`);
 assert.equal(eventPrizePhotoUrl(eventId,prizeId,3,true),`/api/v1/public/events/${eventId}/prizes/${prizeId}/photo?v=3`);
});

test('closed engine manifest rejects mixed purpose, target, size, variant and nonretiring prize profiles',()=>{
 let touched=false;const fail=async()=>{touched=true;throw Error('forbidden IO');};
 const profile:LifecycleProfile<LifecyclePrepare,never>={purpose:'community.event-prize-photo',targetKind:'community.event-prize-photo',variant:'photo',inputMaxBytes:2097152,outputMaxBytes:1048576,retireReplacedAsset:true,parsePrepare:v=>v,targetId:()=>eventId,lockTarget:fail,resolvePolicy:fail,requireCapacity:fail,prepareRepresentation:fail,lockPublication:fail,publish:fail};
 const pool={} as Pool,store=new FakeObjectStore();assert.doesNotThrow(()=>createAssetLifecycle(pool,{store},profile));
 assert.throws(()=>createAssetLifecycleWithAuthority(pool,{store},profile,{...memberLifecycleAuthority,clock:fail}),(e:unknown)=>e instanceof Problem&&e.code==='asset_authority_profile_invalid');
 for(const delta of [{purpose:'community.event-banner'},{targetKind:'community.event-banner'},{variant:'image'},{inputMaxBytes:2097153},{outputMaxBytes:1048577},{retireReplacedAsset:false}])
  assert.throws(()=>createAssetLifecycle(pool,{store},{...profile,...delta} as typeof profile),(e:unknown)=>e instanceof Problem&&e.code==='asset_profile_invalid');
 assert.equal(touched,false);
});

test('static framing rejects MIME mismatch, markup, truncation, trailing bytes, empty and overlimit before decode',async()=>{
 let calls=0;await runWithImageProcessor({name:'controlled',async normalize(){calls++;return webp();}},async()=>{
  for(const [mime,bytes] of [['image/jpeg',png],['image/png',Buffer.from('<svg/>')],['image/png',png.subarray(0,-1)],['image/png',Buffer.concat([png,Buffer.from('<script/>')])],['image/webp',Buffer.concat([webp(),Buffer.from('x')])],['image/webp',webp(4097,1)],['image/png',Buffer.alloc(0)],['image/png',Buffer.alloc(2097153)]] as const)
   await assert.rejects(normalizeEventPrizePhoto(mime,bytes));
  await assert.rejects(normalizeEventPrizePhoto('image/svg+xml',png));
 });assert.equal(calls,0);assert.equal(assertEventPrizePhotoSource('image/png',png),'png');assert.equal(assertEventPrizePhotoSource('image/webp',webp()),'webp');
 await runWithImageProcessor(createUnavailableImageProcessor(),async()=>assert.rejects(normalizeEventPrizePhoto('image/png',png),(e:unknown)=>e instanceof Problem&&e.status===503));
});

test('snapshot precedes await; decoder gets bounded inside/no enlargement spec and metadata-free canonical output gate',async()=>{
 const original=Buffer.from(png),before=Buffer.from(png);let release!:()=>void;const wait=new Promise<void>(r=>{release=r;});
 await runWithImageProcessor({name:'controlled',async normalize(bytes,spec){
  assert.equal(spec.purpose,'event_prize_photo');assert.equal(spec.maxPixels,16777216);assert.equal(spec.maxDimension,4096);assert.equal(spec.maxOutputBytes,1048576);
  assert.deepEqual(spec.output,{width:1920,height:1920,fit:'inside',quality:80,effort:4});await wait;assert.deepEqual(bytes,before);return webp(1800,900);
 }},async()=>{const result=normalizeEventPrizePhoto('image/png',original);original.fill(0);release();assert.equal((await result).length,26);});
 for(const output of [webp(1921,1),Buffer.from(png),Buffer.concat([webp(),Buffer.from('EXIF')])])await runWithImageProcessor({name:'controlled-bad',async normalize(){return output;}},async()=>assert.rejects(normalizeEventPrizePhoto('image/png',png),(e:unknown)=>e instanceof Problem&&e.status===422));
});

test('storage independently rejects wrong transform/MIME/size/metadata and noncanonical dimensions before immutable PUT',async()=>{
 const bytes=webp(),value=await prepareLegacyMediaRepresentation(stream(bytes),'image/webp','community.event-prize-photo',policy);validateMetadata(value.metadata);
 for(const delta of [{transformVersion:'storefront.product-photo.webp.v1'},{contentType:'image/png'},{byteSize:1048577},{pixel_width:1}])assert.throws(()=>validateMetadata({...value.metadata,...delta} as ObjectMetadata),AssetStorageError);
 let puts=0;const store=new FakeObjectStore();const originalPut=store.putImmutable.bind(store);store.putImmutable=async(...args)=>{puts++;return originalPut(...args);};
 const key=objectKey({scopeId:eventId,assetId:prizeId,representationId:'30000000-0000-4000-8000-000000000001'});
 for(const bad of [webp(1921,1),Buffer.concat([webp(),Buffer.from('EXIF')])])await assert.rejects(writeVerifiedObject(store,key,{bytes:bad,metadata:{...value.metadata,byteSize:bad.length,sha256:await sha256(bad)}},policy),AssetStorageError);
 assert.equal(puts,0);await writeVerifiedObject(store,key,value,policy);assert.equal(puts,1);
});

test('canonical policy defaults fail closed with no banner or commerce fallback',async()=>{
 for(const row of [undefined,{mode:'legacy',persistence_allowed:true,policy_revision:'x',retained_byte_limit:'9999999'},{mode:'r2_only',persistence_allowed:false,policy_revision:'x',retained_byte_limit:'9999999'},{mode:'bridge',persistence_allowed:true,policy_revision:null,retained_byte_limit:'9999999'},{mode:'bridge',persistence_allowed:true,policy_revision:'x',retained_byte_limit:'1048575'}]){
  const q={async query(sql:string){assert.match(sql,/purpose='community.event-prize-photo' FOR SHARE/);return {rows:row?[row]:[]};}} as unknown as PoolClient;
  await assert.rejects(eventPrizePhotoPolicy(q),(e:unknown)=>e instanceof Problem&&e.status===503);
 }
 const q={async query(){return {rows:[{mode:'bridge',persistence_allowed:true,policy_revision:'x',retained_byte_limit:'1048576'}]};}} as unknown as PoolClient;assert.deepEqual(await eventPrizePhotoPolicy(q),{revision:'x',platformPersistenceAllowed:true,retainedByteLimit:'1048576'});
});

test('verified current-photo read rechecks pointer/version/authority after object bytes, never returns stale bytes',async()=>{
 const store=new FakeObjectStore(),bytes=webp(),value=await prepareLegacyMediaRepresentation(stream(bytes),'image/webp','community.event-prize-photo',policy);
 const row:EventPrizePhotoSnapshot={event_id:eventId,prize_id:prizeId,photo_version:'2',asset_id:prizeId,scope_id:eventId,representation_id:'30000000-0000-4000-8000-000000000001',byte_size:bytes.length,content_sha256:await sha256(bytes),policy_revision:policy.revision,authority:'current'};
 await writeVerifiedObject(store,objectKey({scopeId:row.scope_id,assetId:row.asset_id,representationId:row.representation_id}),value,policy);
 let calls=0;assert.deepEqual(await readAuthorizedEventPrizePhoto(async()=>{calls++;return {...row};},store,'2'),new Uint8Array(bytes));assert.equal(calls,2);
 for(const next of [undefined,{...row,photo_version:'3'},{...row,authority:'cancelled'},{...row,asset_id:eventId},{...row,scope_id:prizeId}]){
  calls=0;await assert.rejects(readAuthorizedEventPrizePhoto(async()=>++calls===1?{...row}:next,store,'2'),(e:unknown)=>e instanceof Problem&&e.status===404);assert.equal(calls,2);
 }
 calls=0;await assert.rejects(readAuthorizedEventPrizePhoto(async()=>{calls++;return row;},store,'1'),(e:unknown)=>e instanceof Problem&&e.status===404);assert.equal(calls,1);
 await assert.rejects(readAuthorizedEventPrizePhoto(async()=>row,undefined,'2'),(e:unknown)=>e instanceof Problem&&e.status===503);
});

test('binary gate admits exactly POST and two valid UUIDs; malformed route/body/header remains rejected',()=>{
 const path=`/api/v1/events/${eventId}/prizes/${prizeId}/photo`;assert.equal(isEventPrizePhotoUpload('POST',path),true);assert.equal(isEventPrizePhotoUpload('POST',path.toUpperCase()),false);
 assert.equal(isEventPrizePhotoUpload('POST',path.replace(prizeId,prizeId.toUpperCase())),true);
 for(const candidate of [path+'/',path+'/remove',path+'?x=1',path.replace(prizeId,'-'.repeat(36)),path.replace('/prizes/','/anything/'),path.replace(prizeId,eventPrizePhotoTargetId(eventId,prizeId))])assert.equal(isEventPrizePhotoUpload('POST',candidate),false);
 for(const method of ['GET','PUT','PATCH','HEAD','DELETE'])assert.equal(isEventPrizePhotoUpload(method,path),false);
 assert.equal(isEventPrizePhotoRemove('POST',path+'/remove'),true);assert.equal(isEventPrizePhotoRemove('POST',path+'/remove/'),false);
 checkEventPrizePhotoHeaders('image/png','2097152');for(const [mime,length] of [['image/svg+xml','3'],['image/png; charset=utf-8','3'],['image/png','2097153'],['image/png','3\n'],['image/png','-1']])assert.throws(()=>checkEventPrizePhotoHeaders(mime,length),Problem);
});

test('Hono malformed photo requests refuse before any database or fetch port without listening',async t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw Error('fetch forbidden');});
 let io=0;const pool={query:async()=>{io++;throw Error('DB forbidden');},connect:async()=>{io++;throw Error('DB forbidden');}} as unknown as Pool;
 const app=createEventPrizePhotoRoutes(pool);app.onError(()=>new Response('rejected',{status:400}));
 const malformed=await app.request(`/events/${eventId}/prizes/${prizeId}/photo`,{method:'POST',headers:{'content-type':'image/svg+xml'},body:'bad'});assert.equal(malformed.status,400);
 assert.equal(malformed.headers.get('Cache-Control'),'private, no-store');assert.equal(malformed.headers.get('Vary'),'Cookie');assert.equal(malformed.headers.get('Cross-Origin-Resource-Policy'),'same-origin');assert.equal(malformed.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(malformed.headers.get('ETag'),null);
 const publicApp=createPublicEventPrizePhotoRoutes(pool);publicApp.onError(()=>new Response('rejected',{status:400}));
 const rejectedPublic=await publicApp.request(`/public/events/${eventId}/prizes/${prizeId}/photo?v=0`,{headers:{Range:'bytes=0-0','If-None-Match':'pretend-known'}});
 assert.equal(rejectedPublic.status,400);assert.equal(rejectedPublic.headers.get('Cache-Control'),'no-store');assert.equal(rejectedPublic.headers.get('ETag'),null);assert.equal(rejectedPublic.headers.get('Last-Modified'),null);assert.equal(rejectedPublic.headers.get('Content-Range'),null);assert.equal(io,0);
});


test('actual availability facade stays read-only, current-authorized and false without its own policy or runtime store',async()=>{
 // Statement-aware in-process model, not PostgreSQL locking/constraint evidence.
 const actor={user_id:'30000000-0000-4000-8000-000000000001',community_id:eventId,session_hash:'synthetic',onboarding_required:false} as Actor;
 const clock=new Date('2030-01-01T00:00:00Z'),seen:string[]=[];
 let onboarding={onboarding_required:false,onboarding_completed_at:null as Date|null},owner=actor.user_id,prizes=[{prize_id:prizeId}],state='pending',starts=new Date(clock.getTime()+1000),live=true;
 let policyRow:Record<string,unknown>={mode:'legacy',persistence_allowed:false,policy_revision:null,retained_byte_limit:null};
 const q={release(){},async query(sql:string,values:unknown[]=[]){
  seen.push(sql);let rows:unknown[]=[];
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.startsWith('SELECT pg_advisory_xact_lock'))return {rows,rowCount:0};
  if(sql.startsWith('SELECT user_id FROM users'))rows=[{user_id:actor.user_id}];
  else if(sql.startsWith('SELECT token_hash FROM sessions'))rows=live||!sql.includes('clock_timestamp')?[{token_hash:'synthetic'}]:[];
  else if(sql.startsWith('SELECT principal_id,kind,status'))rows=[{principal_id:actor.user_id,kind:'person',status:'active'}];
  else if(sql.startsWith('SELECT scope_id,kind,status'))rows=[{scope_id:eventId,kind:'community',status:'active'}];
  else if(sql.startsWith('SELECT onboarding_required')){assert.deepEqual(values,[actor.user_id,actor.community_id]);rows=[onboarding];}
  else if(sql.startsWith('SELECT * FROM community_events'))rows=[{event_id:eventId,community_id:eventId,organizer_ref:owner,event_kind:'other',state,starts_at:starts,prize_details:prizes}];
  else if(sql.includes('FROM domain_media_storage_policy'))rows=[policyRow];
  else if(sql==='SELECT clock_timestamp() AS now')rows=[{now:clock}];
  else assert.fail('Unexpected SQL, especially a write: '+sql);
  return {rows,rowCount:rows.length};
 }};
 const pool={async connect(){return q;}} as unknown as Pool,store=new FakeObjectStore();
 const read=(installed:ObjectStore|undefined=store)=>readEventPrizePhotoAvailability(pool,actor,eventId,prizeId,installed);
 const expected={event_id:eventId,prize_id:prizeId,organizer_ref:actor.user_id,upload_available:false};
 assert.deepEqual(await read(),expected);
 policyRow={mode:'bridge',persistence_allowed:true,policy_revision:'synthetic-v1',retained_byte_limit:'1048576'};
 assert.deepEqual(await readEventPrizePhotoAvailability(pool,actor,eventId,prizeId),expected,'Missing runtime store cannot advertise upload');
 assert.deepEqual(await read(),{...expected,upload_available:true});
 for(const mode of ['published','cancelled','rejected']){state=mode;assert.deepEqual(await read(),expected);}state='pending';
 starts=clock;assert.deepEqual(await read(),expected);starts=new Date(clock.getTime()+1000);
 onboarding={onboarding_required:true,onboarding_completed_at:null};await assert.rejects(read(),(e:unknown)=>e instanceof Problem&&e.code==='onboarding_required');
 onboarding={onboarding_required:true,onboarding_completed_at:clock};assert.equal((await read()).upload_available,true);
 owner=eventId;await assert.rejects(read(),(e:unknown)=>e instanceof Problem&&e.code==='organizer_required');owner=actor.user_id;
 prizes=[];await assert.rejects(read(),(e:unknown)=>e instanceof Problem&&e.code==='event_prize_not_found');prizes=[{prize_id:prizeId}];
 live=false;await assert.rejects(read(),(e:unknown)=>e instanceof Problem&&e.code==='session_expired');
 assert(seen.every(sql=>!/^(?:INSERT|UPDATE|DELETE)/.test(sql)));assert(seen.every(sql=>!sql.includes('community_event_prize_photo_targets')&&!sql.includes('asset_upload_intents')));
});
