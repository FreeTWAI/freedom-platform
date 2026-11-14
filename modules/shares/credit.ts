import {createHash} from 'node:crypto';
import {recordAgentChange} from '../client-connections/agent-feed.js';
import type { PoolClient } from 'pg';
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

/** Caller holds the share row lock. Backfill must never renew a withdrawn endorsement. */
export async function endorseShare(q:PoolClient,share:{share_id:string;community_id:string;first_sharer_user_id:string|null;state:string},userId:string,backfill=false) {
  if(share.state!=='published')return;
  if(backfill&&(await q.query('SELECT 1 FROM share_endorsements WHERE share_id=$1 AND user_id=$2',[share.share_id,userId])).rowCount)return;
  const endorsement=(await q.query(`INSERT INTO share_endorsements(share_id,user_id) VALUES($1,$2)
    ON CONFLICT (share_id,user_id) WHERE withdrawn_at IS NULL DO NOTHING RETURNING endorsement_id`,[share.share_id,userId])).rows[0];
  if(!endorsement)return;
  const first=share.first_sharer_user_id===userId;
  return appendCredit(q,{share_id:share.share_id,community_id:share.community_id,user_id:userId,role:first?'sharer':'co_sharer',basis:first?'created':'shared_again',source_ref:`endorsement:${endorsement.endorsement_id}`,actor_user_id:userId});
}

/** Call inside the event write transaction AFTER storing a member RSVP or guest confirmation.
 * Reads authoritative rows; guests need confirmed_at. Safe to repeat and to run during backfill.
 */
export async function creditEventRegistrations(q:PoolClient,eventId:string):Promise<number> {
  if(!(await q.query("SELECT 1 FROM community_events WHERE event_id=$1 AND state='published' AND registration_mode='platform'",[eventId])).rowCount)return 0;
  const shares=(await q.query("SELECT share_id,community_id FROM shares WHERE kind='event' AND ref_id=$1 AND state='published' ORDER BY share_id FOR UPDATE",[eventId])).rows;
  let credited=0;
  for(const share of shares){
    const referrals=(await q.query(`SELECT r.user_id AS actor_id,r.referred_by_user_id AS recipient,u.email,r.created_at,r.rsvp_id::text AS identity_order
      FROM community_event_rsvps r JOIN users u ON u.user_id=r.user_id
      WHERE r.event_id=$1 AND r.state='going' AND r.referred_by_user_id IS NOT NULL AND u.community_id=$2
      UNION ALL SELECT NULL,g.referred_by_user_id,g.email,g.created_at,g.email
      FROM community_event_guest_rsvps g WHERE g.event_id=$1 AND g.state='going' AND g.confirmed_at IS NOT NULL AND g.referred_by_user_id IS NOT NULL
      ORDER BY created_at,identity_order`,[eventId,share.community_id])).rows;
    for(const r of referrals){
      const eligible=(await q.query(`SELECT 1 FROM users WHERE user_id=$1 AND community_id=$3
        AND lower(trim(email))<>lower(trim($2)) AND NOT is_verification_test_email($2)`,[r.recipient,r.email,share.community_id])).rowCount;
      if(!eligible)continue;
      const person=(await q.query('SELECT user_id FROM users WHERE community_id=$1 AND lower(trim(email))=lower(trim($2))',[share.community_id,r.email])).rows[0];
      const actorId=r.actor_id??person?.user_id??null;
      if(actorId&&(await q.query('SELECT 1 FROM community_event_registration_credit_people WHERE event_id=$1 AND user_id=$2',[eventId,actorId])).rowCount)continue;
      const identity=createHash('sha256').update(r.email.trim().toLowerCase()).digest('hex');
      const source=`registration:${share.share_id}:${identity}`;
      if(await appendCredit(q,{...share,user_id:r.recipient,role:'spreader',basis:'registration',source_ref:source,actor_user_id:actorId}))credited++;
      // Retain member identity even when the email fact was first recorded as a guest.
      // Mark only an actual positive fact, never an unconfirmed or rejected attempt.
      if(actorId)await q.query(`INSERT INTO community_event_registration_credit_people(event_id,user_id)
        SELECT $1,$2 WHERE EXISTS(SELECT 1 FROM share_credit_events WHERE share_id=$3 AND basis='registration' AND units=1 AND source_ref=$4)
        ON CONFLICT DO NOTHING`,[eventId,actorId,share.share_id,source]);
    }
  }
  return credited;
}
