import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {before,after,test} from 'node:test';
import {Pool} from 'pg';
import {migrate} from '../../scripts/database.js';
import {tokenHash,type Actor} from '../../modules/identity-membership/service.js';
import type {Command} from '../../packages/db/index.js';
import {createGameDraft,readGameDraft,uploadGameSource,withdrawGameDraft} from '../../modules/absurd-daily/game-quarantine.js';
import {FakeObjectStore} from '../../packages/asset-storage/fake-store.js';
import {objectKey,readVerifiedObject} from '../../packages/asset-storage/index.js';
import {Problem} from '../../packages/shared/problem.js';
import {readAvatar} from '../../modules/identity-membership/avatars.js';
import {TENANT_DATA_CATALOG} from '../../modules/module-data/catalog.js';
import {checkTenantCatalog,introspectTenantSchema} from '../../modules/module-data/catalog-check.js';
// Authored real SQL/lifecycle tests; not run without provisioned isolated PostgreSQL and dependencies.
const url=process.env.TEST_DATABASE_URL,schema=`fp_game_quarantine_${process.pid}_${Date.now()}`;
let admin:Pool,pool:Pool,created=false;
before(async()=>{assert.ok(url,'Explicit isolated TEST_DATABASE_URL required');const parsed=new URL(url);
 assert(['postgres:','postgresql:'].includes(parsed.protocol)&&['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)&&/^\/fp_[a-zA-Z0-9_]+$/.test(parsed.pathname)&&!parsed.search&&!parsed.hash);
 admin=new Pool({connectionString:url});pool=new Pool({connectionString:url,options:`-c search_path=${schema} -c statement_timeout=10000`,max:8});await admin.query(`CREATE SCHEMA ${schema}`);created=true;await migrate(pool);
});
after(async()=>{if(pool)await pool.end();if(admin){try{if(created)await admin.query(`DROP SCHEMA ${schema} CASCADE`);}finally{await admin.end();}}});
const bytes=new TextEncoder().encode('<!doctype html>\n<script>throw "never execute"</script>');
const status=(value:number)=>(e:unknown)=>e instanceof Problem&&e.status===value;
const integrity=(e:unknown)=>['23514','23503'].includes((e as {code?:string}).code??'');
const command=(actor:Actor,expected?:string,key=randomUUID()):Command=>({actor,key,expected,operation:'synthetic',body:null});
async function member(community:string):Promise<Actor>{const id=randomUUID(),hash=tokenHash(randomBytes(32).toString('base64url'));
 const row=(await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref) VALUES($1,$2,$3,'Synthetic','not-login',$4) RETURNING *`,[id,community,`${id}@game.test`,randomUUID()])).rows[0];
 await pool.query("INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,'synthetic',clock_timestamp()+interval '1 hour')",[hash,id]);return {...row,session_hash:hash,csrf_token:'synthetic'};
}
async function fixture(){const community=randomUUID();await pool.query('INSERT INTO communities(community_id,name) VALUES($1,$2)',[community,'Synthetic game']);const actor=await member(community),create=command(actor);
 const draft=await createGameDraft(pool,create,{title:'合成遊戲',description:'私有隔離測試'});return {community,actor,create,draft,store:new FakeObjectStore()};
}
async function enable(){await pool.query("UPDATE domain_media_storage_policy SET mode='r2_only',persistence_allowed=true,policy_revision='synthetic-game-v1',retained_byte_limit=1048576 WHERE purpose='member.game-source'");}
async function counts(id:string){return (await pool.query('SELECT count(*)::int n FROM member_game_source_revisions WHERE game_id=$1',[id])).rows[0].n;}
test('closed policy and missing store never persist; metadata creation has exact replay and no source',async()=>{
 const f=await fixture();await pool.query("UPDATE domain_media_storage_policy SET persistence_allowed=false WHERE purpose='member.game-source'");
 assert.equal((await readGameDraft(pool,f.actor,f.draft.game_id,f.store)).upload_available,false);
 await assert.rejects(uploadGameSource(pool,command(f.actor,'1'),f.draft.game_id,bytes,f.store),status(503));await enable();
 await assert.rejects(uploadGameSource(pool,command(f.actor,'1'),f.draft.game_id,bytes),status(503));assert.equal(await counts(f.draft.game_id),0);
 assert.deepEqual(await createGameDraft(pool,f.create,{title:'合成遊戲',description:'私有隔離測試'}),f.draft);
});
test('real lifecycle stores exact opaque bytes, immutable revisions, cold metadata and retained withdrawal',async()=>{
 const f=await fixture();await enable();const c=command(f.actor,'1'),saved=await uploadGameSource(pool,c,f.draft.game_id,bytes,f.store);assert.equal(saved.version,'2');assert.equal(saved.source_revision,'1');assert.equal(saved.state,'quarantined');
 assert.deepEqual(await uploadGameSource(pool,c,f.draft.game_id,bytes),saved);assert.equal(await counts(f.draft.game_id),1);
 await assert.rejects(uploadGameSource(pool,c,f.draft.game_id,new TextEncoder().encode('different'),f.store),status(409));
 const object=(await pool.query(`SELECT o.* FROM member_game_source_revisions r JOIN asset_objects o USING(asset_id) WHERE r.game_id=$1`,[f.draft.game_id])).rows[0];
 let gets=0;const originalGet=f.store.get.bind(f.store);f.store.get=async(...args)=>{gets++;return originalGet(...args);};
 await assert.rejects(readAvatar(pool,f.actor,f.actor.user_id,undefined,f.store),status(404));assert.equal(gets,0,'An existing avatar route cannot pick a game Asset by owner');
 await assert.rejects(pool.query("UPDATE assets SET purpose='member.avatar' WHERE asset_id=$1",[object.asset_id]),integrity);
 await assert.rejects(pool.query("UPDATE asset_objects SET content_type='text/html' WHERE asset_id=$1",[object.asset_id]),integrity);
 assert.equal(object.content_type,'application/octet-stream');const metadata={contentType:object.content_type,byteSize:object.byte_size,sha256:object.content_sha256,transformVersion:object.transform_version,policyRevision:object.policy_revision,profileId:object.profile_id};
 assert.deepEqual((await readVerifiedObject(f.store,objectKey({scopeId:object.scope_id,assetId:object.asset_id,representationId:object.representation_id}),metadata)).bytes,bytes);
 await assert.rejects(pool.query("UPDATE member_game_source_revisions SET trust='approved' WHERE game_id=$1",[f.draft.game_id]),integrity);
 await assert.rejects(pool.query('DELETE FROM member_game_source_revisions WHERE game_id=$1',[f.draft.game_id]),integrity);
 await assert.rejects(pool.query("UPDATE member_game_drafts SET aggregate_version=3,source_revision=2,state='quarantined' WHERE game_id=$1",[f.draft.game_id]),integrity);
 const second=await uploadGameSource(pool,command(f.actor,'2'),f.draft.game_id,new TextEncoder().encode('<html>revision two</html>'),f.store);assert.equal(second.source_revision,'2');
 const cold=new Pool({connectionString:url,options:`-c search_path=${schema}`});try{assert.equal((await readGameDraft(cold,f.actor,f.draft.game_id)).source_revision,'2');}finally{await cold.end();}
 await pool.query("UPDATE domain_media_storage_policy SET persistence_allowed=false WHERE purpose='member.game-source'");
 const withdraw=command(f.actor,'3'),removed=await withdrawGameDraft(pool,withdraw,f.draft.game_id);assert.equal(removed.state,'withdrawn');assert.equal(removed.version,'4');
 assert.deepEqual(await withdrawGameDraft(pool,withdraw,f.draft.game_id),removed);assert.deepEqual(await uploadGameSource(pool,c,f.draft.game_id,bytes),saved);
 assert.equal((await readGameDraft(pool,f.actor,f.draft.game_id)).state,'withdrawn');assert.equal(await counts(f.draft.game_id),2);await enable();
 await assert.rejects(uploadGameSource(pool,command(f.actor,'4'),f.draft.game_id,bytes,f.store),status(409));
 const forbidden=/object_key|lease_token|<script>|never execute|bucket|asset_id|sha256/;
 assert.doesNotMatch(JSON.stringify(saved),forbidden);
 const facts=(await pool.query("SELECT data FROM scoped_transition_journal WHERE aggregate_type='member_game' AND aggregate_id=$1",[f.draft.game_id])).rows;assert.doesNotMatch(JSON.stringify(facts),forbidden);
});
test('current owner/community/session is required before old receipts or metadata',async()=>{
 const f=await fixture();await enable();const c=command(f.actor,'1');await uploadGameSource(pool,c,f.draft.game_id,bytes,f.store);
 const stranger=await member(f.community);await assert.rejects(readGameDraft(pool,stranger,f.draft.game_id),status(404));await assert.rejects(uploadGameSource(pool,{...c,actor:stranger},f.draft.game_id,bytes,f.store),status(404));
 await assert.rejects(readGameDraft(pool,{...f.actor,community_id:randomUUID()},f.draft.game_id));
 await pool.query('UPDATE sessions SET expires_at=clock_timestamp()-interval \'1 second\' WHERE token_hash=$1',[f.actor.session_hash]);
 await assert.rejects(uploadGameSource(pool,c,f.draft.game_id,bytes,f.store));await assert.rejects(readGameDraft(pool,f.actor,f.draft.game_id));
});
test('withdraw during verified external I/O prevents finalization and retains uncertain source charges',async()=>{
 const f=await fixture();await enable();const original=f.store.putImmutable.bind(f.store);let entered!:()=>void,release!:()=>void;const reached=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
 f.store.putImmutable=async(...args)=>{entered();await gate;return original(...args);};
 const pending=uploadGameSource(pool,command(f.actor,'1'),f.draft.game_id,bytes,f.store);await reached;
 await withdrawGameDraft(pool,command(f.actor,'1'),f.draft.game_id);release();await assert.rejects(pending);
 assert.equal(await counts(f.draft.game_id),0);assert.equal((await readGameDraft(pool,f.actor,f.draft.game_id)).state,'withdrawn');
 const assets=(await pool.query("SELECT count(*)::int n FROM assets WHERE owner_user_id=$1 AND purpose='member.game-source'",[f.actor.user_id])).rows[0].n;assert.equal(assets,1);
});
test('unknown PUT reconciliation is immutable, quota remains charged, and source catalog coverage is complete',async()=>{
 const f=await fixture();await enable();f.store.failNext('put-after');const saved=await uploadGameSource(pool,command(f.actor,'1'),f.draft.game_id,bytes,f.store);assert.equal(saved.version,'2');
 const effects=(await pool.query("SELECT e.state FROM asset_object_write_effects e JOIN asset_upload_intents i USING(intent_id) WHERE i.target_game_id=$1",[f.draft.game_id])).rows;assert(effects.some(r=>r.state==='unknown'));
 const q=await pool.connect();try{assert.deepEqual(checkTenantCatalog(await introspectTenantSchema(q,schema),TENANT_DATA_CATALOG),[]);}finally{q.release();}
});
