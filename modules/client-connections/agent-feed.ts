import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import type {Actor} from '../identity-membership/service.js';
import {readWithMemberSession} from '../../packages/db/member-session.js';
import {requireCondition} from '../../packages/shared/problem.js';
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
