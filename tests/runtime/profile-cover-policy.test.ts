import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Hono} from 'hono';
import {Problem} from '../../packages/shared/problem.js';
import {runWithImageProcessor,createUnavailableImageProcessor} from '../../packages/shared/image-runtime.js';
import {normalizeProfileCover,profileCoverPolicy} from '../../modules/assets/profile-cover.js';
import {readAuthorizedProfileCover,readPublicProfileCover,readMemberProfileCover,readOwnerProfileCover,profileCoverProjectionSql,type ProfileCoverSnapshot} from '../../modules/assets/profile-cover-read.js';
import {createPublicProfileCoverRoutes,checkProfileCoverHeaders,isProfileCoverUpload} from '../../apps/platform-api/src/routes/profile-covers.js';
import {sha256,prepareLegacyMediaRepresentation,writeVerifiedObject,objectKey,type ObjectStore} from '../../packages/asset-storage/index.js';
import {memberProfileAuthoritySql,publicProfileAuthoritySql} from '../../packages/shared/profile-authority.js';
const id='00000000-0000-4000-8000-000000000001';
// Structural fixtures exercise guards, NOT a native image decode.
function webp(width=1600,height=600){const bytes=Buffer.alloc(30);bytes.write('RIFF');bytes.writeUInt32LE(22,4);bytes.write('WEBP',8);bytes.write('VP8 ',12);bytes.writeUInt32LE(10,16);bytes.set([0x9d,1,0x2a],23);bytes.writeUInt16LE(width,26);bytes.writeUInt16LE(height,28);return bytes;}
const stream=(bytes:Uint8Array)=>new ReadableStream<Uint8Array>({start(c){c.enqueue(bytes);c.close();}});
const rejected=(status:number)=>(e:unknown)=>e instanceof Problem&&e.status===status;
async function fixture(){const bytes=webp(),row:ProfileCoverSnapshot={user_id:id,version:'2',generation:'3',asset_id:id,scope_id:id,representation_id:id,byte_size:bytes.length,content_sha256:await sha256(bytes),policy_revision:'test-v1'};
 const metadata={contentType:'image/webp' as const,byteSize:row.byte_size,sha256:row.content_sha256,transformVersion:'member.profile-cover.webp.v1' as const,policyRevision:row.policy_revision,profileId:'member.profile-cover' as const};let gets=0;
 const store:ObjectStore={get:async()=>{gets++;return {metadata,body:stream(bytes)};},head:async()=>null,putImmutable:async()=>{throw Error('unexpected write');},delete:async()=>{throw Error('unexpected delete');}};return {bytes,row,store,gets:()=>gets,metadata};}
test('closed cover HTTP input ceiling and binary exemption exact path',()=>{
 for(const mime of ['image/png','image/jpeg','image/webp'])checkProfileCoverHeaders(mime,'4194304');
 assert.throws(()=>checkProfileCoverHeaders('image/svg+xml','1'),rejected(415));
 for(const length of ['4194305','-1','NaN'])assert.throws(()=>checkProfileCoverHeaders('image/png',length),rejected(413));
 assert.equal(isProfileCoverUpload('POST','/api/v1/me/profile-cover'),true);assert.equal(isProfileCoverUpload('POST','/api/v1/me/profile-cover/remove'),false);assert.equal(isProfileCoverUpload('GET','/api/v1/me/profile-cover'),false);
});
test('normalizer refuses URL/HTML/GIF/mismatched MIME and unavailable decoder; never raw fallback',async()=>{
 for(const [mime,bytes] of [['image/png',Buffer.from('<svg/>')],['image/jpeg',webp()],['image/gif',Buffer.from('GIF89a')]] as const)await assert.rejects(()=>normalizeProfileCover(mime,bytes),rejected(415));
 await assert.rejects(()=>runWithImageProcessor(createUnavailableImageProcessor(),()=>normalizeProfileCover('image/webp',webp())),rejected(503));
});
test('normalizer enforces fixed canonical size and immutable full decode spec through trusted processor',async()=>{
 let called=0;const input=webp();const out=await runWithImageProcessor({name:'synthetic-guard-only',normalize:async(bytes,spec)=>{called++;assert.notEqual(bytes,input);assert.equal(spec.purpose,'profile_cover');assert.equal(spec.maxPixels,16777216);assert.equal(spec.maxDimension,4096);assert.equal(spec.maxOutputBytes,524288);assert.equal(spec.output.fit,'cover');assert.ok(Object.isFrozen(spec)&&Object.isFrozen(spec.output));return webp();}},()=>normalizeProfileCover('image/webp',input));
 assert.equal(called,1);assert.deepEqual(out,webp());
 await assert.rejects(()=>runWithImageProcessor({name:'wrong-size',normalize:async()=>webp(100,100)},()=>normalizeProfileCover('image/webp',input)),rejected(422));
 const animated=Buffer.from(webp());animated.write('ANIM',12);await assert.rejects(()=>normalizeProfileCover('image/webp',animated),rejected(422));
});
test('storage profile independently refuses noncanonical dimensions before PUT',async()=>{
 await assert.rejects(()=>prepareLegacyMediaRepresentation(stream(webp(1,1)),'image/webp','member.profile-cover',{revision:'test-v1',platformPersistenceAllowed:true}));
 const f=await fixture();let puts=0;const bad=webp(1,1);await assert.rejects(async()=>writeVerifiedObject({...f.store,putImmutable:async()=>{puts++;return 'created';}},objectKey({scopeId:id,assetId:id,representationId:id}),{bytes:bad,metadata:{...f.metadata,byteSize:bad.length,sha256:await sha256(bad)}},{revision:'test-v1',platformPersistenceAllowed:true}));assert.equal(puts,0);
});
test('byte reader denies before object access, checks twice and never substitutes another version',async()=>{
 const f=await fixture();await assert.rejects(()=>readAuthorizedProfileCover(async()=>undefined,f.store,'2','3'),rejected(404));assert.equal(f.gets(),0);
 await assert.rejects(()=>readAuthorizedProfileCover(async()=>f.row,f.store,'9','3'),rejected(404));assert.equal(f.gets(),0);
 let calls=0;assert.deepEqual(await readAuthorizedProfileCover(async()=>{calls++;return {...f.row};},f.store,'2','3'),new Uint8Array(f.bytes));assert.equal(calls,2);assert.equal(f.gets(),1);
 for(const changed of [undefined,{...f.row,generation:'4'},{...f.row,version:'5'},{...f.row,asset_id:'00000000-0000-4000-8000-000000000002'}]){let n=0;await assert.rejects(()=>readAuthorizedProfileCover(async()=>++n===1?f.row:changed,f.store,'2','3'),rejected(404));assert.equal(n,2);}
});
test('mutable callback cannot rewrite first snapshot and digest mismatch never serves bytes',async()=>{
 const f=await fixture();let n=0;await assert.rejects(()=>readAuthorizedProfileCover(async()=>{if(++n===2)f.row.generation='4';return f.row;},f.store,'2','3'),rejected(404));
 const corrupted={...f.store,get:async()=>({metadata:f.metadata,body:stream(Buffer.alloc(f.bytes.length))})};await assert.rejects(()=>readAuthorizedProfileCover(async()=>f.row,corrupted,'2','4'),rejected(503));
});
test('anonymous cover HTTP ignores cookies and Range/conditional headers, twice repeats public ACL',async()=>{
 const f=await fixture(),queries:{sql:string;values:unknown[]}[]=[];const pool={query:async(sql:string,values:unknown[])=>{queries.push({sql,values});return {rows:[f.row]};}};
 const app=new Hono();app.route('/api/v1',createPublicProfileCoverRoutes(pool as any,f.store));
 for(const cookie of ['', 'session=must-not-upgrade']){const response=await app.request(`/api/v1/public/member-profiles/${id}/cover?v=2&generation=3`,{headers:{Cookie:cookie,Range:'bytes=0-1','If-None-Match':'old','If-Modified-Since':'future'}});assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('ETag'),null);assert.equal(response.headers.get('Content-Type'),'image/webp');assert.equal((await response.arrayBuffer()).byteLength,f.bytes.length);}
 assert.equal(queries.length,4);for(const query of queries){assert.deepEqual(query,queries[0]);assert.match(query.sql,/p.visibility='public'/);assert.match(query.sql,/p.include_cover/);assert.match(query.sql,/vcover.retired_at IS NULL/);assert.match(query.sql,/a.deletion_fence=0/);assert.deepEqual(query.values,[id,'2','3']);}
});
test('exact selected image is projected under shared profile authority and policy defaults closed',async()=>{
 assert.match(memberProfileAuthoritySql(),/p.user_id=\$2 OR/);assert.match(memberProfileAuthoritySql(),/member_interaction_blocks/);assert.match(publicProfileAuthoritySql(),/p.visibility='public'/);assert.doesNotMatch(publicProfileAuthoritySql(),/\$2|Cookie/);
 assert.match(profileCoverProjectionSql,/cv.version=p.cover_version/);assert.match(profileCoverProjectionSql,/p.include_cover/);assert.doesNotMatch(profileCoverProjectionSql,/t.aggregate_version/);
 for(const row of [undefined,{mode:'legacy',persistence_allowed:true,policy_revision:'v1',retained_byte_limit:'9999999'},{mode:'r2_only',persistence_allowed:false,policy_revision:'v1',retained_byte_limit:'9999999'}])await assert.rejects(()=>profileCoverPolicy({query:async()=>({rows:row?[row]:[]})} as any),rejected(503));
});

// Synthetic transaction/query adapter: checks identity capture, NOT PostgreSQL ACL.
test('member and owner cover reads capture one actor before both authority snapshots',async()=>{
 for(const owner of [false,true]){
  const f=await fixture(),actor={user_id:id,community_id:'community-original',session_hash:'session-original'},queries:{sql:string;values:unknown[]}[]=[];
  const q={query:async(sql:string,values:unknown[]=[])=>{queries.push({sql,values});return {rowCount:1,rows:sql.includes('vcover.user_id')?[{...f.row,generation:owner?'owner':'3'}]:[{}]};},release:()=>{}};
  const pool={connect:async()=>q};const store={...f.store,get:async(key:Parameters<ObjectStore['get']>[0])=>{actor.user_id='00000000-0000-4000-8000-000000000099';actor.community_id='changed';actor.session_hash='changed';return f.store.get(key);}};
  const result=owner?await readOwnerProfileCover(pool as any,actor as any,'2',store):await readMemberProfileCover(pool as any,actor as any,id,'2','3',store);
  assert.deepEqual(result,new Uint8Array(f.bytes));assert.equal(queries.filter(q=>q.sql.includes('vcover.user_id')).length,2);
  for(const query of queries)assert.equal(query.values.includes('changed')||query.values.includes(actor.user_id),false);
  assert.equal(queries.filter(q=>q.values.includes('session-original')).length,4);
 }
});
