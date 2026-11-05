import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Pool,PoolClient} from 'pg';
import type {Actor} from '../identity-membership/service.js';
import {requireCondition} from '../../packages/shared/problem.js';
import {eventPrizePhotoUrl,type EventPrizePhoto} from './event-prize-photo-state.js';

/** Called only after the canonical user/session locks on this transaction. */
export async function requireEventPrizePhotoMember(q:PoolClient,actor:Actor){
  const row=(await q.query('SELECT onboarding_required,onboarding_completed_at FROM users WHERE user_id=$1 AND community_id=$2',[actor.user_id,actor.community_id])).rows[0];
  requireCondition(row&&(!row.onboarding_required||row.onboarding_completed_at),403,'onboarding_required','請先完成會員入門。');
}

/** Fixed server-owned UUIDv5 namespace. The tuple is not supplied by the client
 * and is not an Asset identity. This keeps receipt target routing identical on
 * concurrent preparations, without a transaction before receipt/quota locks. */
const namespace=Buffer.from('8d1ae6c64cfc5fb4a0d63857f04351bd','hex');
export function eventPrizePhotoTargetId(rawEventId:string,rawPrizeId:string):string {
  const eventId=z.uuid().parse(rawEventId).toLowerCase(),prizeId=z.uuidv4().parse(rawPrizeId).toLowerCase();
  const bytes=createHash('sha1').update(namespace).update(`${eventId}/${prizeId}`,'utf8').digest().subarray(0,16);
  bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
  const hex=bytes.toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
/** Use only after the caller's ordinary event authorization. Byte reads still
 * repeat current event/session authority around verified object I/O. */
export async function eventPrizePhotos(q:Pick<Pool,'query'>,eventId:string,publicRead=false):Promise<EventPrizePhoto[]> {
  const rows=(await q.query(`SELECT t.prize_id,t.linked_at_version::text AS photo_version
    FROM community_event_prize_photo_targets t JOIN community_events e ON e.event_id=t.event_id AND e.community_id=t.community_id AND e.organizer_ref=t.owner_user_id
    JOIN users owner ON owner.user_id=t.owner_user_id AND owner.community_id=t.community_id AND owner.active
    JOIN assets a ON a.asset_id=t.asset_id AND a.scope_id=t.scope_id AND a.owner_principal_id=t.owner_principal_id
      AND a.owner_user_id=t.owner_user_id AND a.community_ref=t.community_id AND a.scope_kind='community'
      AND a.purpose='community.event-prize-photo' AND a.state='ready' AND a.deletion_fence=0
    JOIN asset_objects o ON o.asset_id=a.asset_id AND o.scope_id=a.scope_id AND o.representation_id=a.representation_id AND o.purpose=a.purpose
      AND o.profile_id='community.event-prize-photo' AND o.variant='photo' AND o.content_type='image/webp' AND o.transform_version='community.event-prize-photo.webp.v1'
    JOIN resource_scopes s ON s.scope_id=t.scope_id AND s.kind='community' AND s.community_ref=t.community_id AND s.status='active'
    JOIN principals p ON p.principal_id=t.owner_principal_id AND p.user_ref=t.owner_user_id AND p.status='active'
    WHERE t.event_id=$1 AND t.linked_at_version<=e.aggregate_version
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(e.prize_details) prize WHERE prize->>'prize_id'=t.prize_id::text)
    ORDER BY t.prize_id`,[eventId])).rows;
  return rows.map(row=>({prize_id:row.prize_id,photo_version:Number(row.photo_version),url:eventPrizePhotoUrl(eventId,row.prize_id,Number(row.photo_version),publicRead)}));
}
/** Caller already holds the event. Lock every affected target then every Asset
 * before checking the final session/deadline clock and making any changes. */
export async function lockRemovedEventPrizePhotos(q:PoolClient,eventId:string,remaining:readonly {prize_id:string}[]) {
  const rows=(await q.query(`SELECT target_id,asset_id FROM community_event_prize_photo_targets
    WHERE event_id=$1 AND asset_id IS NOT NULL AND NOT(prize_id=ANY($2::uuid[])) ORDER BY target_id FOR UPDATE`,[eventId,remaining.map(p=>p.prize_id)])).rows as {target_id:string;asset_id:string}[];
  if(rows.length)await q.query('SELECT asset_id FROM assets WHERE asset_id=ANY($1::uuid[]) ORDER BY asset_id FOR UPDATE',[rows.map(r=>r.asset_id)]);
  return rows;
}
export async function detachEventPrizePhotos(q:PoolClient,rows:readonly {target_id:string;asset_id:string}[]) {
  if(!rows.length)return;
  await q.query('UPDATE community_event_prize_photo_targets SET asset_id=NULL,linked_at_version=NULL WHERE target_id=ANY($1::uuid[])',[rows.map(r=>r.target_id)]);
  await q.query("UPDATE assets SET state='retired',retired_at=clock_timestamp() WHERE asset_id=ANY($1::uuid[]) AND state='ready'",[rows.map(r=>r.asset_id)]);
}
