import {randomBytes,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {command,transaction,journal,checkVersion,type Command} from '../../packages/db/index.js';
import {tokenHash,type Actor} from '../identity-membership/service.js';
import {requireCondition} from '../../packages/shared/problem.js';
import type {JournalSnapshot} from './payload.js';
export const MAX_BYTES=2*1024*1024;
const keyInput=z.object({label:z.string().trim().min(1).max(80),expires_in_days:z.number().int().min(1).max(90).default(30)}).strict();
const uuid=(id:string)=>{requireCondition(z.uuid().safeParse(id).success,404,'not_found','找不到投稿。');return id;};
const keyColumns='key_id,label,expires_at,revoked_at,created_at';
const receiptColumns='submission_id,source_revision,payload_sha256,status,created_at';
async function publisher(q:PoolClient,owner:Pick<Actor,'user_id'|'community_id'>){
 const row=(await q.query(`SELECT * FROM community_journal_publisher WHERE singleton AND community_id=$1 AND owner_ref=$2 FOR UPDATE`,[owner.community_id,owner.user_id])).rows[0];
 requireCondition(row,403,'journal_editor_required','目前帳號沒有共創誌編輯權限。');return row;
}
export async function editorState(q:PoolClient,actor:Actor){
 const current=await publisher(q,actor);
 return {aggregate_version:String(current.aggregate_version),published_submission_id:current.published_submission_id,keys:(await q.query(`SELECT ${keyColumns} FROM community_journal_keys WHERE community_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 100`,[actor.community_id,actor.user_id])).rows,submissions:(await q.query(`SELECT ${receiptColumns} FROM community_journal_submissions WHERE community_id=$1 AND owner_ref=$2 ORDER BY created_at DESC LIMIT 100`,[actor.community_id,actor.user_id])).rows};
}
export async function createKey(pool:Pool,input:Command){
 const body=keyInput.parse(input.body);let token:string|null=null;
 const key=await command(pool,input,q=>publisher(q,input.actor),async q=>{
  const count=Number((await q.query('SELECT count(*) FROM community_journal_keys WHERE community_id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>now()',[input.actor.community_id,input.actor.user_id])).rows[0].count);
  requireCondition(count<5,409,'journal_key_limit','最多保留五把有效金鑰。');
  token='fjp_'+randomBytes(32).toString('base64url');const id=randomUUID();
  const row=(await q.query(`INSERT INTO community_journal_keys(key_id,community_id,user_id,label,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+make_interval(days=>$6)) RETURNING ${keyColumns}`,[id,input.actor.community_id,input.actor.user_id,body.label,tokenHash(token),body.expires_in_days])).rows[0];
  await journal(q,input.actor,'community_journal_key',id,1,'issue',{scope:'journal:submit'});return row;
 });return {key,token};
}
export async function revokeKey(pool:Pool,input:Command,id:string){
 uuid(id);z.object({}).strict().parse(input.body);
 return command(pool,input,q=>publisher(q,input.actor),async q=>{
  const row=(await q.query(`UPDATE community_journal_keys SET revoked_at=coalesce(revoked_at,now()) WHERE key_id=$1 AND community_id=$2 AND user_id=$3 RETURNING ${keyColumns}`,[id,input.actor.community_id,input.actor.user_id])).rows[0];
  requireCondition(row,404,'not_found','找不到金鑰。');await journal(q,input.actor,'community_journal_key',id,2,'revoke');return row;
 });
}
export async function readSubmission(q:PoolClient,actor:Actor,id:string){
 uuid(id);await publisher(q,actor);const row=(await q.query(`SELECT ${receiptColumns},payload FROM community_journal_submissions WHERE submission_id=$1 AND community_id=$2 AND owner_ref=$3`,[id,actor.community_id,actor.user_id])).rows[0];
 requireCondition(row,404,'not_found','找不到投稿。');return row;
}
export async function publish(pool:Pool,input:Command,id:string){
 uuid(id);const body=z.object({consent_to_publish:z.literal(true),payload_sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(input.body);
 return command(pool,input,q=>publisher(q,input.actor),async q=>{
  const current=await publisher(q,input.actor);checkVersion(String(current.aggregate_version),input.expected);
  const row=await readSubmission(q,input.actor,id);requireCondition(row.status==='ready_for_review',409,'journal_not_draft','這個版本目前不能發布。');
  requireCondition(row.payload_sha256===body.payload_sha256,412,'journal_digest_mismatch','內容摘要不符，請重新審閱。');
  await q.query("UPDATE community_journal_submissions SET status='superseded' WHERE submission_id=$1",[current.published_submission_id]);
  await q.query("UPDATE community_journal_submissions SET status='published' WHERE submission_id=$1",[id]);
  await q.query('UPDATE community_journal_publisher SET published_submission_id=$1,aggregate_version=aggregate_version+1 WHERE singleton',[id]);
  await journal(q,input.actor,'community_journal',id,Number(current.aggregate_version)+1,'publish',{payload_sha256:row.payload_sha256,source_revision:row.source_revision});
  return {submission_id:id,status:'published',aggregate_version:String(Number(current.aggregate_version)+1)};
 });
}
export async function withdraw(pool:Pool,input:Command){
 z.object({}).strict().parse(input.body);
 return command(pool,input,q=>publisher(q,input.actor),async q=>{
  const current=await publisher(q,input.actor);checkVersion(String(current.aggregate_version),input.expected);
  if(current.published_submission_id){await q.query("UPDATE community_journal_submissions SET status='withdrawn' WHERE submission_id=$1",[current.published_submission_id]);await journal(q,input.actor,'community_journal',current.published_submission_id,Number(current.aggregate_version)+1,'withdraw');}
  await q.query('UPDATE community_journal_publisher SET published_submission_id=NULL,aggregate_version=aggregate_version+1 WHERE singleton');
  return {aggregate_version:String(Number(current.aggregate_version)+1)};
 });
}
export function credentialHash(header:string|undefined){const match=header?.match(/^Bearer (fjp_[A-Za-z0-9_-]{43})$/i);requireCondition(match,401,'journal_key_invalid','需要有效的日誌投稿金鑰。');return tokenHash(match[1]);}
export async function findKey(pool:Pool,hash:string){const row=(await pool.query('SELECT key_id,user_id,community_id FROM community_journal_keys WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()',[hash])).rows[0];requireCondition(row,401,'journal_key_invalid','日誌投稿金鑰無效。');return row as {key_id:string;user_id:string;community_id:string};}
async function agentTransaction<T>(pool:Pool,hash:string,action:(q:PoolClient,key:Awaited<ReturnType<typeof findKey>>)=>Promise<T>){
 const key=await findKey(pool,hash);
 return transaction(pool,async q=>{
  const user=await q.query('SELECT 1 FROM users WHERE user_id=$1 AND community_id=$2 AND active AND (NOT onboarding_required OR onboarding_completed_at IS NOT NULL) FOR SHARE',[key.user_id,key.community_id]);requireCondition(user.rowCount===1,401,'journal_key_invalid','日誌投稿金鑰無效。');
  await publisher(q,key);
  const current=await q.query('SELECT 1 FROM community_journal_keys WHERE key_id=$1 AND token_hash=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE',[key.key_id,hash]);requireCondition(current.rowCount===1,401,'journal_key_invalid','日誌投稿金鑰無效。');
  const result=await action(q,key);
  const live=await q.query('SELECT 1 FROM community_journal_keys WHERE key_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()',[key.key_id]);requireCondition(live.rowCount===1,401,'journal_key_invalid','日誌投稿金鑰已過期。');return result;
 });
}
export function idempotency(value:string|undefined){requireCondition(value&&/^[A-Za-z0-9_-]{8,128}$/.test(value),400,'idempotency_required','請提供有效的 Idempotency-Key。');return value;}
export async function submit(pool:Pool,hash:string,idem:string,payload:JournalSnapshot,sha256:string){
 return agentTransaction(pool,hash,async(q,key)=>{
  const prior=(await q.query(`SELECT ${receiptColumns} FROM community_journal_submissions WHERE key_id=$1 AND idempotency_key=$2`,[key.key_id,idem])).rows[0];
  if(prior){requireCondition(prior.payload_sha256===sha256,409,'idempotency_conflict','相同識別碼不可送不同內容。');return prior;}
  const count=Number((await q.query("SELECT count(*) FROM community_journal_submissions WHERE community_id=$1 AND owner_ref=$2 AND status='ready_for_review'",[key.community_id,key.user_id])).rows[0].count);requireCondition(count<10,409,'journal_draft_limit','最多保留十份待審版本。');
  const id=randomUUID();const row=(await q.query(`INSERT INTO community_journal_submissions(submission_id,community_id,owner_ref,key_id,idempotency_key,source_revision,payload_sha256,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${receiptColumns}`,[id,key.community_id,key.user_id,key.key_id,idem,payload.source_revision,sha256,JSON.stringify(payload)])).rows[0];
  await journal(q,key as unknown as Actor,'community_journal',id,1,'submit',{source_revision:payload.source_revision,payload_sha256:sha256});return row;
 });
}
export async function receipt(pool:Pool,hash:string,idem:string){return agentTransaction(pool,hash,async(q,key)=>{const row=(await q.query(`SELECT ${receiptColumns} FROM community_journal_submissions WHERE key_id=$1 AND idempotency_key=$2`,[key.key_id,idem])).rows[0];requireCondition(row,404,'not_found','找不到投稿收據。');return row;});}
export async function publicSnapshot(pool:Pool){const row=(await pool.query("SELECT s.payload,s.source_revision,s.payload_sha256 FROM community_journal_publisher p JOIN community_journal_submissions s ON s.submission_id=p.published_submission_id AND s.community_id=p.community_id AND s.owner_ref=p.owner_ref WHERE p.singleton AND s.status='published'")).rows[0];return row?{data:row.payload,source_revision:row.source_revision,payload_sha256:row.payload_sha256}:{data:{people:[],journals:[]},source_revision:null,payload_sha256:null};}

export async function discard(pool:Pool,input:Command,id:string){
 uuid(id);z.object({}).strict().parse(input.body);
 return command(pool,input,q=>publisher(q,input.actor),async q=>{const row=await readSubmission(q,input.actor,id);requireCondition(row.status==='ready_for_review',409,'journal_not_draft','只能捨棄待審閱版本。');await q.query("UPDATE community_journal_submissions SET status='withdrawn' WHERE submission_id=$1",[id]);await journal(q,input.actor,'community_journal',id,2,'discard');return {submission_id:id,status:'withdrawn'};});
}
