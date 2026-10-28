/** Real PostgreSQL/native decoder integration source. NOT RUN locally. Requires
 * the integrated customization migration and explicit isolated TEST_DATABASE_URL. */
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import sharp from 'sharp';
import {createPool,type Command} from '../../packages/db/index.js';
import {migrate} from '../../scripts/database.js';
import {tokenHash,type Actor} from '../../modules/identity-membership/service.js';
import {FakeObjectStore} from '../../packages/asset-storage/fake-store.js';
import {createProfileCoverUpload,profileCoverMetadata,removeProfileCover,lockProfileCoverSelection} from '../../modules/assets/profile-cover.js';
import {readPublicProfileCover,readMemberProfileCover,readOwnerProfileCover} from '../../modules/assets/profile-cover-read.js';
import {Problem} from '../../packages/shared/problem.js';
const connectionString=process.env.TEST_DATABASE_URL;if(!connectionString)throw Error('Explicit isolated TEST_DATABASE_URL required');
const schema=`fp_profile_cover_${process.pid}_${Date.now()}`,admin=createPool(connectionString),pool=new Pool({connectionString,options:`-c search_path=${schema} -c statement_timeout=10000`,max:10});
const community=randomUUID();let initialized=false,png:Buffer;
before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);initialized=true;await migrate(pool);png=await sharp({create:{width:50,height:25,channels:3,background:'blue'}}).png().toBuffer();await pool.query("UPDATE domain_media_storage_policy SET mode='r2_only',persistence_allowed=true,policy_revision='synthetic-v1',retained_byte_limit=16777216 WHERE purpose='member.profile-cover'");});
after(async()=>{await pool.end();if(initialized)await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
beforeEach(async()=>{await pool.query('TRUNCATE communities CASCADE');await pool.query('INSERT INTO communities VALUES($1,$2)',[community,'Synthetic profile cover']);});
async function member():Promise<Actor>{const id=randomUUID(),hash=tokenHash(randomBytes(32).toString('base64url'));const row=(await pool.query('INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[id,community,id+'@cover.local.test','Synthetic','not-login',randomUUID()])).rows[0];await pool.query("INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,'synthetic',clock_timestamp()+interval '1 hour')",[hash,id]);return {...row,session_hash:hash,csrf_token:'synthetic'};}
const command=(actor:Actor,expected='1',key=randomUUID(),body:unknown=null):Command=>({actor,expected,key,operation:'POST /api/v1/me/profile-cover',body});
const code=(status:number)=>(e:unknown)=>e instanceof Problem&&e.status===status;
async function select(actor:Actor,version:string|null,visibility='public'){const q=await pool.connect();try{await q.query('BEGIN');if(version)await lockProfileCoverSelection(q,actor,version);const row=(await q.query(`INSERT INTO member_profile_publications(user_id,community_id,visibility,display_name,include_cover,cover_version) VALUES($1,$2,$3,'Synthetic',$4,$5) ON CONFLICT(user_id) DO UPDATE SET visibility=$3,include_cover=$4,cover_version=$5,aggregate_version=member_profile_publications.aggregate_version+1 RETURNING aggregate_version`,[actor.user_id,actor.community_id,visibility,version!==null,version])).rows[0];await q.query('COMMIT');return String(row.aggregate_version);}catch(e){await q.query('ROLLBACK');throw e;}finally{q.release();}}
test('real upload replays once; replacement is private staged and selected old bytes survive Cancel',async()=>{
 const owner=await member(),store=new FakeObjectStore(),upload=createProfileCoverUpload(pool,store),firstCommand=command(owner);
 const first=await upload(firstCommand,{mime:'image/png',bytes:png});assert.deepEqual(first,{version:'2',present:true});assert.deepEqual(await upload(firstCommand,{mime:'image/png',bytes:png}),first);
 assert.equal((await pool.query('SELECT count(*)::int n FROM assets')).rows[0].n,1);
 await assert.rejects(()=>readPublicProfileCover(pool,owner.user_id,'2','1',store),code(404));
 const generation=await select(owner,'2');const old=await readPublicProfileCover(pool,owner.user_id,'2',generation,store);assert.ok(old.length>0);
 const second=await upload(command(owner,'2'),{mime:'image/png',bytes:png});assert.equal(second.version,'3');
 assert.deepEqual(await readPublicProfileCover(pool,owner.user_id,'2',generation,store),old);
 await assert.rejects(()=>readPublicProfileCover(pool,owner.user_id,'3',generation,store),code(404));assert.ok((await readOwnerProfileCover(pool,owner,'3',store)).length>0);
 await assert.rejects(()=>removeProfileCover(pool,command(owner,'3',randomUUID(),{version:'2'}),true),code(409));
 const newer=await select(owner,'3');assert.ok((await readPublicProfileCover(pool,owner.user_id,'3',newer,store)).length>0);
 await assert.rejects(()=>readPublicProfileCover(pool,owner.user_id,'2',generation,store),code(404));
 await removeProfileCover(pool,command(owner,'3',randomUUID(),{version:'2'}),true);await assert.rejects(()=>upload(firstCommand,{mime:'image/png',bytes:png}),code(409));
});
test('member block, consent revocation, inactive owner and expired reader deny bytes after positive controls',async()=>{
 const owner=await member(),viewer=await member(),store=new FakeObjectStore();await createProfileCoverUpload(pool,store)(command(owner),{mime:'image/png',bytes:png});const generation=await select(owner,'2','members');
 assert.ok((await readMemberProfileCover(pool,viewer,owner.user_id,'2',generation,store)).length>0);
 await pool.query("INSERT INTO member_interaction_blocks(community_id,owner_ref,target_ref,state) VALUES($1,$2,$3,'active')",[community,viewer.user_id,owner.user_id]);await assert.rejects(()=>readMemberProfileCover(pool,viewer,owner.user_id,'2',generation,store),code(404));
 const publicGeneration=await select(owner,'2');assert.ok((await readPublicProfileCover(pool,owner.user_id,'2',publicGeneration,store)).length>0);
 await pool.query('UPDATE users SET active=false WHERE user_id=$1',[owner.user_id]);await assert.rejects(()=>readPublicProfileCover(pool,owner.user_id,'2',publicGeneration,store),code(404));await pool.query('UPDATE users SET active=true WHERE user_id=$1',[owner.user_id]);
 assert.ok((await readOwnerProfileCover(pool,owner,'2',store)).length>0);await pool.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",[owner.user_id]);await assert.rejects(()=>readOwnerProfileCover(pool,owner,'2',store),code(401));
 await select({...owner},null);await assert.rejects(()=>readPublicProfileCover(pool,owner.user_id,'2',publicGeneration,store),code(404));
});
test('revocation committed during object GET rejects bytes at the final SQL snapshot',async()=>{
 const owner=await member(),store=new FakeObjectStore();await createProfileCoverUpload(pool,store)(command(owner),{mime:'image/png',bytes:png});const generation=await select(owner,'2');assert.ok((await readPublicProfileCover(pool,owner.user_id,'2',generation,store)).length>0);
 const gated={get:async(...args:Parameters<typeof store.get>)=>{const object=await store.get(...args);await select(owner,null);return object;},head:store.head.bind(store),putImmutable:store.putImmutable.bind(store),delete:store.delete.bind(store)};
 await assert.rejects(()=>readPublicProfileCover(pool,owner.user_id,'2',generation,gated),code(404));
});
test('draft cap is bounded; removal uses CAS and cannot cross owner or select retired cover',async()=>{
 const owner=await member(),other=await member(),store=new FakeObjectStore(),upload=createProfileCoverUpload(pool,store);
 for(const expected of ['1','2','3'])await upload(command(owner,expected),{mime:'image/png',bytes:png});
 const metadata=await profileCoverMetadata(pool,owner,true);assert.deepEqual(metadata.draft_versions,['4','3','2']);
 await assert.rejects(()=>upload(command(owner,'4'),{mime:'image/png',bytes:png}),code(409));
 await assert.rejects(()=>lockProfileCoverSelection(pool as any,other,'2'),code(409));
 await assert.rejects(()=>removeProfileCover(pool,command(owner,'3',randomUUID(),{version:'2'}),true),code(412));
 const removed=await removeProfileCover(pool,command(owner,'4',randomUUID(),{version:'2'}),true);assert.equal(removed.version,'5');
 await assert.rejects(()=>select(owner,'2'),code(409));assert.equal((await upload(command(owner,'5'),{mime:'image/png',bytes:png})).version,'6');
});
