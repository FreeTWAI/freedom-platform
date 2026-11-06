import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Pool,PoolClient} from 'pg';
import type {Actor} from '../identity-membership/service.js';
import {digest,checkVersion,type Command} from '../../packages/db/index.js';
import {withMemberScope,type MemberScopeContext} from '../../packages/resource-scopes/index.js';
import {scopedMemberCommand,scopedJournal,type ScopedMemberCommand} from '../../packages/scoped-commands/index.js';
import {assertCurrentSessionClock} from '../../packages/db/member-session.js';
import {Problem,requireCondition} from '../../packages/shared/problem.js';
import {requirePersistence,snapshotBoundedBytes,AssetStorageError,type ObjectStore,type PreparedRepresentation} from '../../packages/asset-storage/index.js';
import {createAssetLifecycle,assetCommandKey,assetVersion,type LifecyclePolicy} from '../assets/engine.js';
import {validateGameUploadSource,GAME_UPLOAD_SOURCE_MAX_BYTES} from './game-upload-source.js';

export const GAME_SOURCE_PURPOSE='member.game-source' as const;
const title=z.string().trim().min(1).max(80).refine(v=>!/[\u0000-\u001f\u007f<>]/.test(v));
const draftInput=z.object({title,description:z.string().trim().max(1000).refine(v=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/.test(v))}).strict();
const prepareInput=z.object({key:assetCommandKey,targetGameId:z.uuid(),expectedVersion:assetVersion,contentType:z.literal('text/html'),byteSize:z.number().int().min(1).max(GAME_UPLOAD_SOURCE_MAX_BYTES),sha256:z.string().regex(/^[0-9a-f]{64}$(?![\s\S])/)}).strict();
const stream=(bytes:Uint8Array)=>new ReadableStream<Uint8Array>({start(c){c.enqueue(bytes);c.close();}});
const unavailable=()=>new Problem(503,'game_upload_unavailable','遊戲來源保存尚未開放或暫時無法使用。');
const missing=()=>new Problem(404,'game_draft_not_found','找不到這份遊戲草稿。');
export interface GameDraft {game_id:string;title:string;description:string;version:string;state:'draft'|'quarantined'|'withdrawn';source_revision:string;trust:'unreviewed';visibility:'private'}
interface GameRow {game_id:string;title:string;description:string;aggregate_version:string;state:GameDraft['state'];source_revision:string}
const view=(row:GameRow):GameDraft=>({game_id:row.game_id,title:row.title,description:row.description,version:row.aggregate_version,state:row.state,source_revision:row.source_revision,trust:'unreviewed',visibility:'private'});
/** Called inside the canonical locked member transaction, never trusts the HTTP onboarding snapshot. */
async function member(q:PoolClient,actor:Actor){
 const row=(await q.query('SELECT onboarding_required,onboarding_completed_at FROM users WHERE user_id=$1 AND community_id=$2',[actor.user_id,actor.community_id])).rows[0];
 requireCondition(row&&(!row.onboarding_required||row.onboarding_completed_at),403,'onboarding_required','請先完成會員入門。');
}
async function owned(q:PoolClient,c:MemberScopeContext,actor:Actor,id:string,lock=false,editable=false):Promise<GameRow>{
 await member(q,actor);
 const row=(await q.query<GameRow>(`SELECT game_id,title,description,aggregate_version::text,state,source_revision::text FROM member_game_drafts WHERE game_id=$1 AND scope_id=$2 AND owner_principal_id=$3 AND owner_user_id=$4 AND community_id=$5${lock?' FOR UPDATE':''}`,[id,c.scope.scope_id,c.subject_principal.principal_id,actor.user_id,actor.community_id])).rows[0];
 if(!row)throw missing();
 if(editable)requireCondition(row.state!=='withdrawn',409,'game_draft_withdrawn','這份遊戲草稿已撤回。');
 return row;
}
export async function gameQuarantinePolicy(q:PoolClient):Promise<LifecyclePolicy>{
 const row=(await q.query("SELECT mode,policy_revision,persistence_allowed,retained_byte_limit::text FROM domain_media_storage_policy WHERE purpose='member.game-source' FOR SHARE")).rows[0];
 if(!row||row.mode!=='r2_only'||row.persistence_allowed!==true||typeof row.retained_byte_limit!=='string'||!/^[1-9][0-9]{0,18}$/.test(row.retained_byte_limit)||BigInt(row.retained_byte_limit)<262144n||BigInt(row.retained_byte_limit)>9223372036854775807n)throw unavailable();
 const policy=Object.freeze({revision:row.policy_revision,platformPersistenceAllowed:true,retainedByteLimit:row.retained_byte_limit});
 try{requirePersistence(policy);}catch{throw unavailable();}return policy;
}
/** Only the domain validator prepares opaque original bytes. No HTML rendering, rewriting or fetching. */
export async function prepareGameQuarantineSource(body:ReadableStream<Uint8Array>,mime:string,policy:LifecyclePolicy):Promise<PreparedRepresentation>{
 const frozen=Object.freeze({...policy});requirePersistence(frozen);
 const source=await validateGameUploadSource({body,contentType:mime});
 return Object.freeze({bytes:source.copyBytes(),metadata:Object.freeze({profileId:GAME_SOURCE_PURPOSE,contentType:'application/octet-stream',byteSize:source.byteSize,sha256:source.sha256,transformVersion:'member.game-source.utf8-quarantine.v1',policyRevision:frozen.revision})});
}
export async function createGameDraft(pool:Pool,raw:Command,body:unknown):Promise<GameDraft>{
 const actor=Object.freeze({...raw.actor}),key=assetCommandKey.parse(raw.key),input=draftInput.parse(body);
 const command:ScopedMemberCommand={actor,scope:'personal',lockUser:true,operation:'game.draft.create',key,target:{kind:'member.game-drafts',id:actor.user_id},body:input};
 return scopedMemberCommand(pool,command,q=>member(q,actor),async(q,c)=>{
  // Bound even metadata-only drafts; withdrawn records remain retained.
  await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`game.drafts/v1/${c.scope.scope_id}`]);
  const count=(await q.query('SELECT count(*)::int n FROM member_game_drafts WHERE scope_id=$1',[c.scope.scope_id])).rows[0].n;
  requireCondition(count<100,409,'game_draft_quota','遊戲草稿數量已達上限。');await assertCurrentSessionClock(q,actor);
  const row=(await q.query<GameRow>(`INSERT INTO member_game_drafts(game_id,scope_id,owner_principal_id,owner_user_id,community_id,title,description) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING game_id,title,description,aggregate_version::text,state,source_revision::text`,[randomUUID(),c.scope.scope_id,c.subject_principal.principal_id,actor.user_id,actor.community_id,input.title,input.description])).rows[0];
  await scopedJournal(q,c,{aggregate_type:'member_game',id:row.game_id,version:'1',operation:command.operation,data:{state:'draft'},eventType:'freedom.game.draft.created.v1'});return view(row);
 },q=>member(q,actor));
}
export async function readGameDraft(pool:Pool,rawActor:Actor,rawId:string,store?:ObjectStore){
 const actor=Object.freeze({...rawActor}),id=z.uuid().parse(rawId).toLowerCase();
 return withMemberScope(pool,{actor,scope:'personal',lockUser:true},q=>member(q,actor),async(q,c)=>{
  const row=await owned(q,c,actor,id,true);let available=false;
  if(store&&row.state!=='withdrawn')try{await gameQuarantinePolicy(q);available=true;}catch(error){if(!(error instanceof Problem&&error.status===503))throw error;}
  await assertCurrentSessionClock(q,actor);return {...view(row),upload_available:available};
 });
}
function lifecycle(pool:Pool,store:ObjectStore,actor:Actor,id:string){return createAssetLifecycle<z.infer<typeof prepareInput>,GameDraft>(pool,{store},{
 purpose:GAME_SOURCE_PURPOSE,targetKind:GAME_SOURCE_PURPOSE,variant:'draft',inputMaxBytes:262144,outputMaxBytes:262144,retireReplacedAsset:false,
 parsePrepare:raw=>prepareInput.parse(raw),targetId:raw=>raw.targetGameId,
 revalidate:async(q,c)=>{await owned(q,c,actor,id);},
 async lockTarget(q,c,current,targetId){if(targetId!==id)throw missing();const row=await owned(q,c,current,id,true,true);return {targetId:id,aggregateVersion:row.aggregate_version,assetId:null};},
 resolvePolicy:gameQuarantinePolicy,
 async requireCapacity(q,c,_actor,_target,policy,reserve){
  const row=(await q.query(`SELECT COALESCE(sum(COALESCE(o.byte_size,i.reserved_bytes,262144)::bigint),0)::text used FROM assets a LEFT JOIN asset_objects o USING(asset_id) LEFT JOIN asset_upload_intents i USING(asset_id) WHERE a.scope_id=$1 AND a.purpose='member.game-source'`,[c.scope.scope_id])).rows[0];
  requireCondition(BigInt(row.used)+BigInt(reserve)<=BigInt(policy.retainedByteLimit),409,'asset_retained_quota','遊戲來源儲存容量已達上限；撤回不會立即釋放容量。');
 },prepareRepresentation:prepareGameQuarantineSource,
 async lockPublication(q,c,current){await owned(q,c,current,id,true,true);},
 async publish(q,c,current,intent){
  // game row, intent, Asset and policy locks are already held by the engine.
  const row=(await q.query<GameRow>(`UPDATE member_game_drafts SET aggregate_version=aggregate_version+1,source_revision=source_revision+1,state='quarantined' WHERE game_id=$1 AND aggregate_version=$2 AND state<>'withdrawn' RETURNING game_id,title,description,aggregate_version::text,state,source_revision::text`,[id,intent.expected_version])).rows[0];
  requireCondition(row,412,'version_conflict','草稿已更新，請重新載入。');
  await q.query(`INSERT INTO member_game_source_revisions(game_id,revision,game_version,asset_id,scope_id,owner_principal_id,owner_user_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,row.source_revision,row.aggregate_version,intent.asset_id,c.scope.scope_id,c.subject_principal.principal_id,current.user_id]);
  return {aggregateVersion:row.aggregate_version,result:view(row),fact:{aggregateType:'member_game',id,data:{state:'quarantined',source_revision:row.source_revision},eventType:'freedom.game.source.quarantined.v1'}};
 }
});}
export async function uploadGameSource(pool:Pool,raw:Command,rawId:string,rawBytes:Uint8Array,store?:ObjectStore):Promise<GameDraft>{
 const actor=Object.freeze({...raw.actor}),id=z.uuid().parse(rawId).toLowerCase(),key=assetCommandKey.parse(raw.key),expected=assetVersion.parse(raw.expected);
 const bytes=snapshotBoundedBytes(rawBytes,GAME_UPLOAD_SOURCE_MAX_BYTES);
 // Validation is pure and bounded. Authority must precede storage and historical replay.
 const source=await validateGameUploadSource({body:stream(bytes),contentType:'text/html'});
 const command:ScopedMemberCommand={actor,scope:'personal',lockUser:true,operation:'game.source.upload',key,expected,target:{kind:'member.game',id},body:{game_id:id,content_type:'text/html',byte_size:source.byteSize,sha256:source.sha256}};
 const authorize=(q:PoolClient,c:MemberScopeContext)=>owned(q,c,actor,id);
 const probe=async()=>{const miss=new Error('game_receipt_miss');try{return await scopedMemberCommand<GameDraft>(pool,command,authorize,async()=>{throw miss;},authorize);}catch(error){if(error!==miss)throw error;return undefined;}};
 const replay=await probe();if(replay)return replay;if(!store)throw unavailable();
 const assets=lifecycle(pool,store,actor,id),prepareKey=digest({operation:command.operation,key,id});
 try{
  const prepared=await assets.prepare(actor,{key:prepareKey,targetGameId:id,expectedVersion:expected,contentType:'text/html',byteSize:source.byteSize,sha256:source.sha256});
  const lease=await assets.resumeUpload(actor,{key:prepareKey,intentId:prepared.intentId}),binding={intentId:lease.intentId,fence:lease.fence,leaseToken:lease.leaseToken};
  if(lease.state==='prepared'||lease.state==='processing')await assets.write(actor,{...binding,key:digest({prepareKey,phase:'write',fence:lease.fence})},stream(source.copyBytes()));
  return await assets.finalizeVia(actor,{...binding,key:digest({prepareKey,phase:'finalize'})},{operation:command.operation,
   execute:run=>scopedMemberCommand(pool,command,authorize,run,authorize),
   validateIntent:row=>requireCondition(row.target_game_id===id&&row.expected_version===expected&&row.source_content_type==='text/html'&&row.source_byte_size===source.byteSize&&row.source_sha256===source.sha256,409,'asset_source_mismatch','上傳內容與原操作不同。'),result:value=>value});
 }catch(error){const saved=await probe();if(saved)return saved;if(error instanceof AssetStorageError)throw unavailable();throw error;}
}
export async function withdrawGameDraft(pool:Pool,raw:Command,rawId:string):Promise<GameDraft>{
 const actor=Object.freeze({...raw.actor}),id=z.uuid().parse(rawId).toLowerCase(),key=assetCommandKey.parse(raw.key),expected=assetVersion.parse(raw.expected);
 const command:ScopedMemberCommand={actor,scope:'personal',lockUser:true,operation:'game.draft.withdraw',key,expected,target:{kind:'member.game',id},body:{game_id:id}};
 const authorize=(q:PoolClient,c:MemberScopeContext)=>owned(q,c,actor,id,true);
 return scopedMemberCommand(pool,command,authorize,async(q,c)=>{
  const current=await owned(q,c,actor,id,true,true);checkVersion(current.aggregate_version,expected);await assertCurrentSessionClock(q,actor);
  const row=(await q.query<GameRow>(`UPDATE member_game_drafts SET aggregate_version=aggregate_version+1,state='withdrawn' WHERE game_id=$1 AND aggregate_version=$2 RETURNING game_id,title,description,aggregate_version::text,state,source_revision::text`,[id,expected])).rows[0];
  requireCondition(row,412,'version_conflict','草稿已更新，請重新載入。');
  await scopedJournal(q,c,{aggregate_type:'member_game',id,version:row.aggregate_version,operation:command.operation,data:{state:'withdrawn'},eventType:'freedom.game.draft.withdrawn.v1'});return view(row);
 },authorize);
}
