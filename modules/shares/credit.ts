import {recordAgentChange} from '../client-connections/agent-feed.js';
import type { PoolClient } from 'pg';
import {recordAgentChange} from '../client-connections/agent-feed.js';
export type CreditFact={share_id:string;community_id:string;user_id:string;role:'sharer'|'co_sharer'|'original_author'|'organizer'|'spreader';basis:'created'|'shared_again'|'claim_verified'|'qualified_click_day'|'star_confirmed'|'registration';source_ref:string;actor_user_id?:string|null};
/** Internal evidence writer. No client route accepts a fact or client-supplied units. */
export async function appendCredit(q:PoolClient,fact:CreditFact) {
  const id=(await q.query(`INSERT INTO share_credit_events(share_id,community_id,user_id,role,basis,units,source_ref,actor_user_id)
    VALUES($1,$2,$3,$4,$5,1,$6,$7) ON CONFLICT DO NOTHING RETURNING event_id`,[fact.share_id,fact.community_id,fact.user_id,fact.role,fact.basis,fact.source_ref,fact.actor_user_id??null])).rows[0]?.event_id as string|undefined;
  if(id)await recordAgentChange(q,{community_id:fact.community_id,user_id:fact.user_id,kind:'share.credited',source_key:id,resource_id:fact.share_id});
  return id;
}
export async function reverseCredit(q:PoolClient,eventId:string) {
  await q.query(`INSERT INTO share_credit_events(share_id,community_id,user_id,role,basis,units,source_ref,actor_user_id,reverses_event_id)
    SELECT share_id,community_id,user_id,role,basis,-1,source_ref,actor_user_id,event_id FROM share_credit_events WHERE event_id=$1 AND units=1 ON CONFLICT DO NOTHING`,[eventId]);
}
