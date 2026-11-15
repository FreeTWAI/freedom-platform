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
  const shares=(await q.query(`SELECT s.share_id FROM shares s JOIN community_events e ON e.event_id=s.ref_id
    WHERE e.event_id=$1 AND e.state='published' AND e.registration_mode='platform'
      AND s.kind='event' AND s.state='published' ORDER BY s.share_id FOR UPDATE OF s`,[eventId])).rows;
  if(!shares.length)return 0;
  // Compute the exact pre-existing JavaScript normalization and SHA-256 once
  // per address. PostgreSQL collations need not implement JS Unicode casing.
  const addresses=(await q.query(`SELECT u.email FROM community_event_rsvps r JOIN users u ON u.user_id=r.user_id
    WHERE r.event_id=$1 AND r.state='going' AND r.referred_by_user_id IS NOT NULL
    UNION SELECT g.email FROM community_event_guest_rsvps g WHERE g.event_id=$1 AND g.state='going'
      AND g.confirmed_at IS NOT NULL AND g.referred_by_user_id IS NOT NULL`,[eventId])).rows;
  if(!addresses.length)return 0;
  const identities=addresses.map(({email})=>({email,identity:createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}));
  const result=await q.query(`WITH identities AS (
    SELECT * FROM jsonb_to_recordset($3::jsonb) AS i(email text,identity text)
   ), referrals AS (
    SELECT r.user_id AS actor_id,r.referred_by_user_id AS recipient,u.email,r.created_at,r.rsvp_id::text AS identity_order,u.community_id AS actor_community
    FROM community_event_rsvps r JOIN users u ON u.user_id=r.user_id
    WHERE r.event_id=$1 AND r.state='going' AND r.referred_by_user_id IS NOT NULL
    UNION ALL SELECT NULL::uuid,g.referred_by_user_id,g.email,g.created_at,g.email,NULL::uuid
    FROM community_event_guest_rsvps g WHERE g.event_id=$1 AND g.state='going' AND g.confirmed_at IS NOT NULL AND g.referred_by_user_id IS NOT NULL
   ), candidates AS (
    SELECT s.share_id,s.community_id,r.recipient,coalesce(r.actor_id,p.user_id) AS actor_id,r.created_at,r.identity_order,
      'registration:'||s.share_id::text||':'||i.identity AS source_ref,
      (recipient.active AND NOT is_verification_test_account(recipient.user_id)
       AND (coalesce(r.actor_id,p.user_id) IS NULL OR (actor.community_id=s.community_id AND actor.active
         AND NOT is_verification_test_account(actor.user_id) AND actor.user_id<>recipient.user_id))) AS may_insert,
      EXISTS(SELECT 1 FROM share_credit_events e WHERE e.community_id=s.community_id AND e.share_id=s.share_id
        AND e.basis='registration' AND e.units=1 AND e.source_ref='registration:'||s.share_id::text||':'||i.identity) AS has_fact
    FROM shares s JOIN referrals r ON r.actor_community IS NULL OR r.actor_community=s.community_id
    JOIN identities i ON i.email=r.email
    JOIN users recipient ON recipient.user_id=r.recipient AND recipient.community_id=s.community_id
    LEFT JOIN LATERAL (SELECT user_id FROM users WHERE community_id=s.community_id AND lower(trim(email))=lower(trim(r.email)) LIMIT 1) p ON true
    LEFT JOIN users actor ON actor.user_id=coalesce(r.actor_id,p.user_id)
    WHERE s.share_id=ANY($2::uuid[]) AND s.state='published'
      AND lower(trim(recipient.email))<>lower(trim(r.email)) AND NOT is_verification_test_email(r.email)
      AND NOT EXISTS(SELECT 1 FROM community_event_registration_credit_people seen WHERE seen.event_id=$1 AND seen.user_id=coalesce(r.actor_id,p.user_id))
   ), viable AS (
    -- A previously stored fact still marks the person even if the guard would
    -- reject a new fact today. Rejected attempts without a fact do not stop a
    -- later eligible referral for the same person.
    SELECT * FROM candidates WHERE may_insert OR has_fact
   ), ranked AS (
    SELECT *,row_number() OVER(PARTITION BY actor_id ORDER BY share_id,created_at,identity_order) AS person_order FROM viable
   ), chosen AS (SELECT * FROM ranked WHERE actor_id IS NULL OR person_order=1), inserted AS (
    INSERT INTO share_credit_events(share_id,community_id,user_id,role,basis,units,source_ref,actor_user_id)
    SELECT share_id,community_id,recipient,'spreader','registration',1,source_ref,actor_id FROM chosen WHERE may_insert
    ORDER BY share_id,created_at,identity_order ON CONFLICT DO NOTHING
    RETURNING event_id,community_id,share_id,user_id,source_ref
   ), changes AS (
    INSERT INTO agent_change_events(community_id,user_id,kind,source_key,resource_id)
    SELECT community_id,user_id,'share.credited',event_id::text,share_id::text FROM inserted
    ON CONFLICT(user_id,source_key) DO NOTHING RETURNING event_id
   ), markers AS (
    INSERT INTO community_event_registration_credit_people(event_id,user_id)
    SELECT DISTINCT $1,c.actor_id FROM chosen c WHERE c.actor_id IS NOT NULL AND (
      EXISTS(SELECT 1 FROM inserted i WHERE i.share_id=c.share_id AND i.source_ref=c.source_ref)
      OR EXISTS(SELECT 1 FROM share_credit_events e WHERE e.share_id=c.share_id AND e.basis='registration' AND e.units=1 AND e.source_ref=c.source_ref))
    ON CONFLICT DO NOTHING RETURNING user_id
   ) SELECT (SELECT count(*)::int FROM inserted) AS credited,(SELECT count(*) FROM changes) AS changes,(SELECT count(*) FROM markers) AS markers`,
   [eventId,shares.map(s=>s.share_id),JSON.stringify(identities)]);
  return result.rows[0].credited as number;
}
