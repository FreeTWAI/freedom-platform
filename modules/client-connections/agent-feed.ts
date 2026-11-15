import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import type {Actor} from '../identity-membership/service.js';
import {readWithMemberSession} from '../../packages/db/member-session.js';
import {requireCondition} from '../../packages/shared/problem.js';
import {markIdleAgentFeed} from './agent-authority.js';
export type AgentChangeKind='event.updated'|'event.approved'|'rsvp.confirmed'|'rsvp.waitlist_promoted'|'message.received'|'share.credited';
/** Integration port: call in the SAME transaction as an actual share credit.
 * sourceKey identifies that immutable credit event, never an attempted share. */
export async function recordAgentChange(q:PoolClient,input:{community_id:string;user_id:string;kind:AgentChangeKind;source_key:string;resource_id:string}){
 await q.query('SELECT record_agent_change($1,$2,$3,$4,$5)',[input.community_id,input.user_id,input.kind,input.source_key,input.resource_id]);
}
export async function readAgentFeed(pool:Pool,actor:Actor,raw:unknown){
 const {after}=z.object({after:z.string().max(64).optional()}).strict().parse(raw);
 let position='0';
 if(after){
  const parts=/^([0-9a-f-]{36}):(0|[1-9][0-9]{0,17})$/.exec(after);
  requireCondition(parts&&parts[1]===actor.user_id,400,'invalid_cursor','請使用這位會員的變更游標。');position=parts[2];
 }
 if(actor.agent){
  const a=actor.agent;
  // Empty polls disclose no change data. Check current credential, scope,
  // account and both unassigned/assigned queues in a single lock-free snapshot.
  // A fact committed after this snapshot is picked up by the next poll.
  const current=(await pool.query(`SELECT c.scopes,u.onboarding_required,u.onboarding_completed_at,
    coalesce(cursor.last_cursor,0)::text AS last_cursor,
    (EXISTS(SELECT 1 FROM agent_change_events e WHERE e.user_id=$1 AND e.community_id=$2 AND e.cursor IS NULL)
      OR EXISTS(SELECT 1 FROM agent_change_events e WHERE e.user_id=$1 AND e.community_id=$2 AND e.cursor>$5::bigint)) AS has_new
    FROM agent_token_connections c JOIN users u ON u.user_id=c.user_id AND u.community_id=c.community_id
    LEFT JOIN agent_change_cursors cursor ON cursor.user_id=u.user_id
    WHERE c.user_id=$1 AND c.community_id=$2 AND c.connection_id=$3 AND c.token_hash=$4 AND c.kind='agent'
      AND c.revoked_at IS NULL AND c.suspended_at IS NULL AND c.expires_at>clock_timestamp() AND u.active`,
   [actor.user_id,actor.community_id,a.connection_id,a.token_hash,position])).rows[0];
  requireCondition(current,401,'agent_token_invalid','Agent 金鑰已失效。');
  requireCondition(a.scope&&current.scopes.includes(a.scope),403,'scope_required','Agent 沒有這項權限。');
  requireCondition(!current.onboarding_required||Boolean(current.onboarding_completed_at),403,'onboarding_required','請先選擇主要公會。');
  requireCondition(BigInt(position)<=BigInt(current.last_cursor),400,'invalid_cursor','變更游標不正確。');
  if(!current.has_new){
   markIdleAgentFeed(actor);
   return {items:[],next_cursor:`${actor.user_id}:${position}`,has_more:false};
  }
 }
 return readWithMemberSession(pool,actor,async q=>{
  await q.query('INSERT INTO agent_change_cursors(user_id) VALUES($1) ON CONFLICT DO NOTHING',[actor.user_id]);
  const row=(await q.query('SELECT last_cursor FROM agent_change_cursors WHERE user_id=$1 FOR UPDATE',[actor.user_id])).rows[0];
  requireCondition(BigInt(position)<=BigInt(row.last_cursor),400,'invalid_cursor','變更游標不正確。');
  const assigned=await q.query(`WITH pending AS (
    SELECT event_id,row_number() OVER(ORDER BY created_at,event_id) AS ordinal FROM (
     SELECT event_id,created_at FROM agent_change_events WHERE user_id=$1 AND community_id=$3 AND cursor IS NULL ORDER BY created_at,event_id LIMIT 1000
    ) batch
   ) UPDATE agent_change_events e SET cursor=$2::bigint+p.ordinal FROM pending p WHERE e.event_id=p.event_id RETURNING e.cursor`,[actor.user_id,row.last_cursor,actor.community_id]);
  const end=BigInt(row.last_cursor)+BigInt(assigned.rowCount??0);
  if(assigned.rowCount)await q.query('UPDATE agent_change_cursors SET last_cursor=$2 WHERE user_id=$1',[actor.user_id,end.toString()]);
  const rows=(await q.query(`SELECT event_id,kind,resource_id,created_at,cursor FROM agent_change_events
   WHERE user_id=$1 AND community_id=$2 AND cursor>$3 ORDER BY cursor LIMIT 101`,[actor.user_id,actor.community_id,position])).rows;
  const items=rows.slice(0,100),next=items.at(-1)?.cursor??position;
  return {items:items.map(({cursor,...item})=>({...item,cursor:`${actor.user_id}:${cursor}`})),next_cursor:`${actor.user_id}:${next}`,has_more:rows.length>100||assigned.rowCount===1000};
 });
}
