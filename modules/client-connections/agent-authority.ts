import type { Pool, PoolClient } from 'pg';
import type { Actor } from '../identity-membership/service.js';
import { tokenHash } from '../identity-membership/service.js';
import { requireCondition } from '../../packages/shared/problem.js';
import { digest } from '../../packages/db/legacy-digest.js';
import { transaction } from '../../packages/db/transaction.js';

export async function authenticateAgent(pool:Pool,authorization:string):Promise<Actor> {
  requireCondition(/^Bearer +fw_agent_[A-Za-z0-9_-]{43}$/i.test(authorization)&&authorization.split(/ +/)[1].startsWith('fw_agent_'),401,'agent_token_invalid','Agent 金鑰已失效。');
  const hash=tokenHash(authorization.split(/ +/)[1]);
  const row=(await pool.query(`SELECT u.user_id,u.community_id,u.email,u.display_name,u.profession_membership_ref,u.onboarding_required,u.onboarding_completed_at,
    c.connection_id,c.scopes FROM member_client_connections c JOIN users u USING(user_id,community_id)
    WHERE c.kind='agent' AND c.token_hash=$1 AND c.revoked_at IS NULL AND c.suspended_at IS NULL AND c.expires_at>clock_timestamp() AND u.active`,[hash])).rows[0];
  requireCondition(row,401,'agent_token_invalid','Agent 金鑰已失效。');
  return {...row,session_hash:'',csrf_token:'',agent:{connection_id:row.connection_id,token_hash:hash,scopes:row.scopes}};
}
export async function assertAgentClock(q:PoolClient,actor:Pick<Actor,'user_id'|'agent'>) {
  const a=actor.agent!;
  requireCondition((await q.query(`SELECT 1 FROM member_client_connections WHERE connection_id=$1 AND user_id=$2 AND token_hash=$3 AND kind='agent'
    AND revoked_at IS NULL AND suspended_at IS NULL AND expires_at>clock_timestamp()`,[a.connection_id,actor.user_id,a.token_hash])).rowCount===1,401,'agent_token_invalid','Agent 金鑰已失效。');
}
export async function lockAgent(q:PoolClient,actor:Actor,write=false) {
  const a=actor.agent!;
  const row=(await q.query(`SELECT scopes FROM member_client_connections WHERE connection_id=$1 AND user_id=$2 AND community_id=$3 AND token_hash=$4 AND kind='agent'
    FOR ${write?'UPDATE':'SHARE'}`,[a.connection_id,actor.user_id,actor.community_id,a.token_hash])).rows[0];
  requireCondition(row,401,'agent_token_invalid','Agent 金鑰已失效。');
  await assertAgentClock(q,actor);
  requireCondition(a.scope&&row.scopes.includes(a.scope),403,'scope_required','Agent 沒有這項權限。');
}
export const publicationDigest=(operation:string,key:string,body:unknown,expected?:string)=>digest({operation,key,body,expected:expected??null});
/** Persist the first exact proposed publication without running the domain handler. */
export async function stageAgentPublication(pool:Pool,actor:Actor,operation:string,key:string,body:unknown,expected?:string) {
 return transaction(pool,async q=>{
  requireCondition((await q.query('SELECT 1 FROM users WHERE user_id=$1 AND community_id=$2 AND active FOR SHARE',[actor.user_id,actor.community_id])).rowCount===1,401,'agent_token_invalid','Agent 金鑰已失效。');
  await lockAgent(q,actor,true);
  const a=actor.agent!,row=(await q.query('SELECT public_confirmed_at FROM member_client_connections WHERE connection_id=$1',[a.connection_id])).rows[0];
  if(row.public_confirmed_at)return true;
  const hash=publicationDigest(operation,key,body,expected);
  await q.query(`INSERT INTO agent_pending_publications(connection_id,operation,idempotency_key,request_sha256,body) VALUES($1,$2,$3,$4,$5)
   ON CONFLICT(connection_id) DO UPDATE SET operation=EXCLUDED.operation,idempotency_key=EXCLUDED.idempotency_key,
   request_sha256=EXCLUDED.request_sha256,body=EXCLUDED.body,approved_at=NULL,created_at=clock_timestamp()
   WHERE agent_pending_publications.request_sha256<>EXCLUDED.request_sha256`,[a.connection_id,operation,key,hash,JSON.stringify(body)]);
  const pending=(await q.query('SELECT request_sha256,approved_at FROM agent_pending_publications WHERE connection_id=$1',[a.connection_id])).rows[0];
  return pending.request_sha256===hash&&Boolean(pending.approved_at);
 });
}
/** Called inside the domain command transaction, after checking for a replay. */
export async function consumeAgentBudget(q:PoolClient,actor:Actor,operation:string,key:string,body:unknown,expected?:string) {
 const a=actor.agent!;
 requireCondition(a.operation===operation,403,'scope_required','Agent 操作不符。');
 if(!a.public_item&&a.scope!=='react')return;
 const row=(await q.query('SELECT * FROM member_client_connections WHERE connection_id=$1',[a.connection_id])).rows[0];
 if(a.scope==='react'){
  const usage=await q.query(`INSERT INTO agent_daily_usage(connection_id,day,reactions) SELECT $1,(clock_timestamp() AT TIME ZONE 'UTC')::date,1 WHERE $2::int>0
   ON CONFLICT(connection_id,day) DO UPDATE SET reactions=agent_daily_usage.reactions+1 WHERE agent_daily_usage.reactions<$2 RETURNING reactions`,[a.connection_id,row.reaction_daily_cap]);
  requireCondition(usage.rowCount===1,429,'agent_daily_cap','Agent 今日互動已達上限。');return;
 }
 if(!row.public_confirmed_at){
  const pending=(await q.query('SELECT * FROM agent_pending_publications WHERE connection_id=$1',[a.connection_id])).rows[0];
  requireCondition(pending?.approved_at&&pending.request_sha256===publicationDigest(operation,key,body,expected),409,'pending_member','請會員在瀏覽器確認首次發布。');
  await q.query('UPDATE member_client_connections SET public_confirmed_at=clock_timestamp() WHERE connection_id=$1',[a.connection_id]);
 }
 const usage=await q.query(`INSERT INTO agent_daily_usage(connection_id,day,public_items) SELECT $1,(clock_timestamp() AT TIME ZONE 'UTC')::date,1 WHERE $2::int>0
 ON CONFLICT(connection_id,day) DO UPDATE SET public_items=agent_daily_usage.public_items+1 WHERE agent_daily_usage.public_items<$2 RETURNING public_items`,[a.connection_id,row.public_daily_cap]);
 requireCondition(usage.rowCount===1,429,'agent_daily_cap','Agent 今日發布已達上限。');
}
export async function recordAgentPublication<T>(q:PoolClient,actor:Actor,operation:string,key:string,result:T):Promise<T> {
 if(!actor.agent?.public_item)return result;
 const r=result as Record<string,unknown>,id=r.event_id??r.project_id??r.share_id??null;
 await q.query('INSERT INTO agent_publications(connection_id,user_id,operation,idempotency_key,resource_id) VALUES($1,$2,$3,$4,$5)',[actor.agent.connection_id,actor.user_id,operation,key,id]);
 if(operation==='POST /api/v1/events'&&r.event_id)await q.query('UPDATE community_events SET via_agent=true WHERE event_id=$1 AND organizer_ref=$2',[r.event_id,actor.user_id]);
 if(operation==='POST /api/v1/opensource/projects'&&r.project_id)await q.query('UPDATE oss_projects SET via_agent=true WHERE project_id=$1',[r.project_id]);
 return {...r,via_agent:true} as T;
}
export async function recordAgentResponse(pool:Pool,actor:Actor,status:number) {
 await pool.query(`UPDATE member_client_connections SET last_used_at=clock_timestamp(),
 failure_count=CASE WHEN $2 BETWEEN 400 AND 499 THEN failure_count+1 ELSE failure_count END,
 suspended_at=CASE WHEN $2 BETWEEN 400 AND 499 AND failure_count>=9 THEN COALESCE(suspended_at,clock_timestamp()) ELSE suspended_at END
 WHERE connection_id=$1`,[actor.agent!.connection_id,status]);
}
