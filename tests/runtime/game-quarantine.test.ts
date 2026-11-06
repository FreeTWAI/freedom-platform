import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {createAssetLifecycle,createAssetLifecycleWithAuthority,type LifecycleProfile,type LifecyclePrepare} from '../../modules/assets/engine.js';
import {memberLifecycleAuthority} from '../../modules/assets/lifecycle-authority.js';
import {prepareGameQuarantineSource,gameQuarantinePolicy} from '../../modules/absurd-daily/game-quarantine.js';
import {FakeObjectStore} from '../../packages/asset-storage/fake-store.js';
import {objectKey,writeVerifiedObject,readVerifiedObject,validateMetadata,preparePrivateText,prepareLegacyMediaRepresentation,AssetStorageError,type ObjectMetadata} from '../../packages/asset-storage/index.js';
import {Problem} from '../../packages/shared/problem.js';
import {checkGameSourceHeaders,isGameSourceUpload,readGameSourceRequest,createGameUploadRoutes} from '../../apps/platform-api/src/routes/game-uploads.js';
const stream=(bytes:Uint8Array)=>new ReadableStream<Uint8Array>({start(c){c.enqueue(bytes);c.close();}});
const bytes=new TextEncoder().encode('\ufeff<!doctype html>\r\n<script>throw new Error("NEVER RUN")</script>');
const policy={revision:'synthetic-game-v1',platformPersistenceAllowed:true,retainedByteLimit:'1048576'};

test('opaque game storage preserves exact original bytes without executing, fetching or generic HTML admission',async()=>{
 const prepared=await prepareGameQuarantineSource(stream(bytes),'text/html',policy);
 assert.equal(prepared.metadata.contentType,'application/octet-stream');assert.equal(prepared.metadata.profileId,'member.game-source');
 const key=objectKey({scopeId:randomUUID(),assetId:randomUUID(),representationId:randomUUID()}),store=new FakeObjectStore();
 await writeVerifiedObject(store,key,prepared,policy);assert.deepEqual((await readVerifiedObject(store,key,prepared.metadata)).bytes,bytes);
 for(const delta of [{contentType:'text/html'},{profileId:'member.ar-target'},{transformVersion:'private-text.utf8.v1'},{byteSize:262145},{profileId:undefined}])assert.throws(()=>validateMetadata({...prepared.metadata,...delta} as ObjectMetadata),AssetStorageError);
 await assert.rejects(preparePrivateText(stream(bytes),'text/html',policy),AssetStorageError);
 await assert.rejects(prepareLegacyMediaRepresentation(stream(bytes),'application/octet-stream','member.game-source',policy),AssetStorageError);
 await assert.rejects(prepareGameQuarantineSource(stream(bytes),'text/plain',policy));
 await assert.rejects(prepareGameQuarantineSource(stream(bytes),'text/html',{...policy,platformPersistenceAllowed:false}));
 const mutated={...prepared,bytes:prepared.bytes.slice()};mutated.bytes[0]^=1;await assert.rejects(writeVerifiedObject(store,key,mutated,policy),AssetStorageError);
});
test('new profile rejects mixed authority, purpose, target, variant and nonfinite capacity before I/O',()=>{
 const fail=async():Promise<never>=>{throw Error('unexpected I/O');};
 const profile:LifecycleProfile<LifecyclePrepare,never>={purpose:'member.game-source',targetKind:'member.game-source',variant:'draft',inputMaxBytes:262144,outputMaxBytes:262144,retireReplacedAsset:false,parsePrepare:x=>x,targetId:()=>randomUUID(),lockTarget:fail,resolvePolicy:fail,requireCapacity:fail,prepareRepresentation:fail,lockPublication:fail,publish:fail};
 const pool={} as Pool,store=new FakeObjectStore();assert.doesNotThrow(()=>createAssetLifecycle(pool,{store},profile));
 for(const delta of [{purpose:'work.private-draft'},{targetKind:'work.private-result'},{variant:'image'},{inputMaxBytes:262145},{outputMaxBytes:262145},{retireReplacedAsset:true}])assert.throws(()=>createAssetLifecycle(pool,{store},{...profile,...delta} as typeof profile));
 assert.throws(()=>createAssetLifecycleWithAuthority(pool,{store},profile,{...memberLifecycleAuthority}));
});
test('policy requires explicit r2-only permission, finite retained quota and valid revision',async()=>{
 const valid={mode:'r2_only',persistence_allowed:true,policy_revision:policy.revision,retained_byte_limit:'1048576'};
 for(const row of [undefined,{...valid,mode:'legacy'},{...valid,mode:'bridge'},{...valid,persistence_allowed:false},{...valid,policy_revision:null},{...valid,retained_byte_limit:'262143'},{...valid,retained_byte_limit:'9223372036854775808'}]){
  const q={query:async()=>({rows:row?[row]:[]})} as unknown as PoolClient;
  await assert.rejects(gameQuarantinePolicy(q),(e:unknown)=>e instanceof Problem&&e.status===503);
 }
 assert.deepEqual(await gameQuarantinePolicy({query:async()=>({rows:[valid]})} as unknown as PoolClient),policy);
});
test('source transport is exact-route, exact-MIME, bounded and cancels on disconnect',async()=>{
 const id=randomUUID(),path=`/api/v1/me/game-drafts/${id}/source`;
 assert(isGameSourceUpload('POST',path));for(const [method,p] of [['GET',path],['POST',path+'/'],['POST',path+'?x=1'],['POST',path.replace(id,'invalid')]])assert.equal(isGameSourceUpload(method,p),false);
 checkGameSourceHeaders('text/html','262144');for(const type of ['text/html; charset=utf-8','application/zip','image/png',undefined])assert.throws(()=>checkGameSourceHeaders(type));assert.throws(()=>checkGameSourceHeaders('text/html','262145'));
 assert.deepEqual(await readGameSourceRequest(new Request('https://example.test',{method:'POST',body:bytes})),bytes);
 await assert.rejects(readGameSourceRequest(new Request('https://example.test',{method:'POST',body:new Uint8Array(262145)})));
 const controller=new AbortController();let canceled=false;
 const body=new ReadableStream<Uint8Array>({pull(){return new Promise(()=>{});},cancel(){canceled=true;}});
 const pending=readGameSourceRequest(new Request('https://example.test',{method:'POST',body,signal:controller.signal,duplex:'half'} as RequestInit));controller.abort();
 await assert.rejects(pending,(e:unknown)=>e instanceof Problem&&e.status===408);assert(canceled);
});
test('no source or arbitrary object serving route exists in private router',async()=>{
 const app=createGameUploadRoutes({} as Pool,new FakeObjectStore()),id=randomUUID();
 for(const path of [`/me/game-drafts/${id}/source`,`/me/game-drafts/${id}/source/index.html`,`/me/game-drafts/${id}/revisions/1/source`,`/assets/${id}`,`/public/game-drafts/${id}`])assert.equal((await app.request(path)).status,404);
});
