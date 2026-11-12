import {requireSharePublicationQuota} from './publication-quota.js';
import {randomBytes} from 'node:crypto';
import type {PoolClient} from 'pg';
import {appendCredit} from './credit.js';
/** Internal domain port: called in the event's publication transaction, never from client facts. */
export async function publishEventShare(q:PoolClient,event:any,newPublication=false){
 if(newPublication)await requireSharePublicationQuota(q,event.organizer_ref);
 const share=(await q.query(`INSERT INTO shares(community_id,kind,canonical_key,canonical_url,ref_table,ref_id,title,first_sharer_user_id,guild_key,created_at)
 VALUES($1,'event',$2,$3,'community_events',$4,$5,$6,$7,$8) ON CONFLICT(community_id,kind,canonical_key) DO UPDATE SET title=EXCLUDED.title RETURNING *`,
 [event.community_id,`event:${event.event_id}`,`/events/${event.event_id}`,event.event_id,event.title,event.organizer_ref,event.guild_key,event.created_at])).rows[0];
 await appendCredit(q,{community_id:event.community_id,share_id:share.share_id,user_id:event.organizer_ref,role:'sharer',basis:'created',source_ref:`share:${share.share_id}:${event.organizer_ref}`,actor_user_id:event.organizer_ref});
 await q.query(`INSERT INTO community_event_share_codes(event_id,user_id,code) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[event.event_id,event.organizer_ref,randomBytes(18).toString('base64url')]);
 await q.query(`INSERT INTO promotion_links(community_id,user_id,kind,target_key,code) VALUES($1,$2,'event',$3,$4) ON CONFLICT DO NOTHING`,[event.community_id,event.organizer_ref,event.event_id,randomBytes(7).toString('base64url')]);
 return share;
}

/** Count only confirmed domain registrations. Email identity dedupes guest/member lanes. */
export async function creditEventRegistration(q:PoolClient,eventId:string,identity:{member_ref?:string;guest_email?:string}){
 const event=(await q.query("SELECT * FROM community_events WHERE event_id=$1 AND state='published' AND registration_mode='platform'",[eventId])).rows[0];if(!event)return;
 const row=identity.member_ref?(await q.query("SELECT r.*,lower(trim(u.email)) email,u.user_id FROM community_event_rsvps r JOIN users u USING(user_id) WHERE event_id=$1 AND user_id=$2 AND r.state='going'",[eventId,identity.member_ref])).rows[0]:(await q.query("SELECT * FROM community_event_guest_rsvps WHERE event_id=$1 AND email=$2 AND state='going' AND (confirmed_at IS NOT NULL OR email_sent_at IS NOT NULL)",[eventId,identity.guest_email])).rows[0];if(!row)return;
 const email=String(row.email).trim().toLowerCase(),recipient=row.referred_by_user_id??event.organizer_ref;
 const person=(await q.query('SELECT user_id,is_verification_test_account(user_id) test FROM users WHERE community_id=$1 AND lower(trim(email))=$2',[event.community_id,email])).rows[0];
 if(person?.test||person?.user_id===recipient||(await q.query('SELECT is_verification_test_email($1) test',[email])).rows[0].test)return;
 const share=(await q.query("SELECT * FROM shares WHERE kind='event' AND ref_id=$1 AND community_id=$2 AND state='published'",[eventId,event.community_id])).rows[0];if(!share)return;
 if(person){
  const identity=(await q.query('INSERT INTO community_event_registration_credit_people(event_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING user_id',[eventId,person.user_id])).rowCount;
  if(!identity||(await q.query("SELECT 1 FROM share_credit_events WHERE share_id=$1 AND basis='registration' AND units=1 AND actor_user_id=$2",[share.share_id,person.user_id])).rowCount)return;
 }
 const {createHash}=await import('node:crypto');
 await appendCredit(q,{community_id:event.community_id,share_id:share.share_id,user_id:recipient,role:recipient===share.first_sharer_user_id?'sharer':'spreader',basis:'registration',source_ref:`registration:${share.share_id}:${createHash('sha256').update(email).digest('hex')}`,actor_user_id:person?.user_id??null});
}
