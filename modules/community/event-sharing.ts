import {randomBytes} from 'node:crypto';
import type {Pool} from 'pg';
import {z} from 'zod';
import {command,type Command} from '../../packages/db/index.js';
import {requireCondition} from '../../packages/shared/problem.js';
import {readEvent,getEventShareCode} from './events.js';
import {appendCredit} from '../shares/credit.js';
export async function shareEvent(pool:Pool,input:Command,id:string){
 z.object({}).strict().parse(input.body);
 return command(pool,input,async q=>{await q.query('SELECT 1 FROM community_events WHERE event_id=$1 FOR UPDATE',[id]);const e=await readEvent(q,input.actor,id);requireCondition(e.state==='published',404,'not_found','找不到活動。');},async q=>{
  await getEventShareCode(q,input.actor,id);
  const s=(await q.query("SELECT * FROM shares WHERE kind='event' AND ref_id=$1 AND community_id=$2 AND state='published'",[id,input.actor.community_id])).rows[0];requireCondition(s,404,'not_found','找不到分享。');
  await appendCredit(q,{community_id:s.community_id,share_id:s.share_id,user_id:input.actor.user_id,role:'co_sharer',basis:'shared_again',source_ref:`share:${s.share_id}:${input.actor.user_id}`,actor_user_id:input.actor.user_id});
  const link=(await q.query(`INSERT INTO promotion_links(community_id,user_id,kind,target_key,code) VALUES($1,$2,'event',$3,$4)
   ON CONFLICT(community_id,user_id,kind,target_key) WHERE revoked_at IS NULL DO UPDATE SET target_key=EXCLUDED.target_key RETURNING code`,[input.actor.community_id,input.actor.user_id,id,randomBytes(7).toString('base64url')])).rows[0];
  const counts=(await q.query(`SELECT COALESCE(sum(units) FILTER(WHERE basis='qualified_click_day'),0)::int clicks,COALESCE(sum(units) FILTER(WHERE basis='registration'),0)::int registrations FROM share_credit_events WHERE share_id=$1 AND user_id=$2`,[s.share_id,input.actor.user_id])).rows[0];
  return {path:`/go/${link.code}`,share_id:s.share_id,...counts};
 });
}
