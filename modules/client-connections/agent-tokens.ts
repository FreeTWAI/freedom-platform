import {randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Pool} from 'pg';
import {transaction} from '../../packages/db/transaction.js';
import {lockMemberSession,assertCurrentSessionClock,readWithMemberSession} from '../../packages/db/member-session.js';
import {command,type Command} from '../../packages/db/index.js';
import {tokenHash,type Actor} from '../identity-membership/service.js';
import {requireCondition} from '../../packages/shared/problem.js';
const input=z.object({name:z.string().trim().min(1).max(80),scopes:z.array(z.enum(['read','share','rsvp'])).min(1).max(3).refine(s=>new Set(s).size===s.length)}).strict();
const fields='connection_id,client_name,scopes,created_at,expires_at,last_used_at,revoked_at,suspended_at,failure_count,public_confirmed_at,public_daily_cap,reaction_daily_cap,aggregate_version';
function browser(actor:Actor){requireCondition(!actor.agent,403,'browser_required','請在瀏覽器管理 Agent 金鑰。');}
/** One-time secrets never enter command receipts or logs. A lost response can be
 * recovered by revoking/renewing the visible connection, never by reading a key. */
export async function issueAgentToken(pool:Pool,actor:Actor,raw:unknown,renewId?:string){
 browser(actor);const body=input.parse(raw);if(renewId)z.uuid().parse(renewId);
 return transaction(pool,async q=>{
  await lockMemberSession(q,actor);
  await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`agent-tokens/${actor.user_id}`]);
  if(renewId){
   requireCondition((await q.query(`UPDATE member_client_connections SET revoked_at=clock_timestamp(),aggregate_version=aggregate_version+1
    WHERE connection_id=$1 AND user_id=$2 AND community_id=$3 AND kind='agent' AND revoked_at IS NULL RETURNING connection_id`,[renewId,actor.user_id,actor.community_id])).rowCount===1,404,'connection_not_found','找不到這個連線。');
  }
  requireCondition(Number((await q.query("SELECT count(*) FROM member_client_connections WHERE user_id=$1 AND kind='agent' AND revoked_at IS NULL AND expires_at>clock_timestamp()",[actor.user_id])).rows[0].count)<20,409,'connection_limit','請先撤銷不再使用的連線。');
  const token='fw_agent_'+randomBytes(32).toString('base64url');
  const row=(await q.query(`INSERT INTO member_client_connections(connection_id,user_id,community_id,client_name,kind,scope,scopes,token_hash,expires_at)
   VALUES($1,$2,$3,$4,'agent','agent',$5,$6,clock_timestamp()+interval '90 days') RETURNING ${fields}`,[randomUUID(),actor.user_id,actor.community_id,body.name,body.scopes,tokenHash(token)])).rows[0];
  await assertCurrentSessionClock(q,actor);
  return {...row,access_token:token};
 });
}
export async function listAgentTokens(pool:Pool,actor:Actor){
 browser(actor);return readWithMemberSession(pool,actor,async q=>({items:(await q.query(`SELECT ${fields},
 (SELECT jsonb_build_object('operation',p.operation,'body',p.body,'request_sha256',p.request_sha256,'approved_at',p.approved_at)
  FROM agent_pending_publications p WHERE p.connection_id=c.connection_id AND c.public_confirmed_at IS NULL) AS pending_publication,
 COALESCE((SELECT public_items FROM agent_daily_usage d WHERE d.connection_id=c.connection_id AND day=(clock_timestamp() AT TIME ZONE 'UTC')::date),0) AS public_items_today
 FROM member_client_connections c WHERE user_id=$1 AND community_id=$2 AND kind='agent' ORDER BY created_at DESC LIMIT 100`,[actor.user_id,actor.community_id])).rows}));
}
export async function manageAgentToken(pool:Pool,input:Command,id:string,action:'revoke'|'confirm'){
 browser(input.actor);z.uuid().parse(id);
 const body=action==='confirm'?z.object({request_sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(input.body):z.object({}).strict().parse(input.body);
 return command(pool,input,async q=>{
  requireCondition((await q.query("SELECT 1 FROM member_client_connections WHERE connection_id=$1 AND user_id=$2 AND community_id=$3 AND kind='agent' FOR UPDATE",[id,input.actor.user_id,input.actor.community_id])).rowCount===1,404,'connection_not_found','找不到這個連線。');
 },async q=>{
  if(action==='revoke')await q.query('UPDATE member_client_connections SET revoked_at=COALESCE(revoked_at,clock_timestamp()),aggregate_version=aggregate_version+1 WHERE connection_id=$1',[id]);
  else requireCondition((await q.query(`UPDATE agent_pending_publications SET approved_at=clock_timestamp() WHERE connection_id=$1 AND request_sha256=$2
   AND EXISTS(SELECT 1 FROM member_client_connections WHERE connection_id=$1 AND revoked_at IS NULL AND suspended_at IS NULL AND expires_at>clock_timestamp())`,[id,(body as {request_sha256:string}).request_sha256])).rowCount===1,409,'publication_changed','發布內容或連線已變更。');
  return {ok:true};
 });
}
