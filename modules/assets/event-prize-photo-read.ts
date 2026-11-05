import {z} from 'zod';
import type {Pool,PoolClient} from 'pg';
import type {Actor} from '../identity-membership/service.js';
import {withMemberScope} from '../../packages/resource-scopes/index.js';
import {assertCurrentSessionClock} from '../../packages/db/member-session.js';
import {objectKey,readVerifiedObject,type ObjectStore} from '../../packages/asset-storage/index.js';
import {Problem,requireCondition} from '../../packages/shared/problem.js';
import {assetVersion} from './engine.js';
import {requireEventPrizePhotoMember} from '../community/event-prize-photos.js';
export interface EventPrizePhotoSnapshot {event_id:string;prize_id:string;photo_version:string;asset_id:string;scope_id:string;representation_id:string;byte_size:number;content_sha256:string;policy_revision:string;authority:string}
const missing=()=>new Problem(404,'event_prize_photo_not_found','找不到可閱讀的獎品照片。');
const columns=`t.event_id,t.prize_id,t.linked_at_version::text AS photo_version,t.asset_id,t.scope_id,o.representation_id,o.byte_size,o.content_sha256,o.policy_revision,
 jsonb_build_array(e.community_id,e.organizer_ref,e.state,e.visibility,e.guild_key,e.review_guild_key,e.aggregate_version)::text AS authority`;
const joins=`FROM community_event_prize_photo_targets t JOIN community_events e ON e.event_id=t.event_id AND e.community_id=t.community_id AND e.organizer_ref=t.owner_user_id
 JOIN users owner ON owner.user_id=t.owner_user_id AND owner.community_id=t.community_id AND owner.active
 JOIN principals p ON p.principal_id=t.owner_principal_id AND p.user_ref=t.owner_user_id AND p.status='active'
 JOIN resource_scopes s ON s.scope_id=t.scope_id AND s.kind='community' AND s.community_ref=t.community_id AND s.status='active'
 JOIN assets a ON a.asset_id=t.asset_id AND a.scope_id=t.scope_id AND a.owner_principal_id=t.owner_principal_id AND a.owner_user_id=t.owner_user_id
  AND a.community_ref=t.community_id AND a.scope_kind='community' AND a.purpose='community.event-prize-photo' AND a.state='ready' AND a.deletion_fence=0
 JOIN asset_objects o ON o.asset_id=a.asset_id AND o.scope_id=a.scope_id AND o.representation_id=a.representation_id AND o.purpose=a.purpose
  AND o.profile_id='community.event-prize-photo' AND o.variant='photo' AND o.content_type='image/webp' AND o.transform_version='community.event-prize-photo.webp.v1'`;
const current=`t.event_id=$1 AND t.prize_id=$2 AND t.linked_at_version=$3 AND t.linked_at_version<=e.aggregate_version
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(e.prize_details) prize WHERE prize->>'prize_id'=t.prize_id::text)`;
/** Both snapshots bind the same exact current pointer and current authority. A
 * full verified GET always occurs; Range/ETag/HEAD cannot shortcut verification. */
export async function readAuthorizedEventPrizePhoto(snapshot:()=>Promise<EventPrizePhotoSnapshot|undefined>,store:ObjectStore|undefined,version:string){
 const row=await snapshot(),first=row?Object.freeze({...row}):undefined;if(!first||first.photo_version!==version)throw missing();
 requireCondition(store,503,'event_prize_photo_read_unavailable','照片暫時無法載入，請稍後重試。');let bytes:Uint8Array;
 try{bytes=(await readVerifiedObject(store!,objectKey({scopeId:first.scope_id,assetId:first.asset_id,representationId:first.representation_id}),{profileId:'community.event-prize-photo',contentType:'image/webp',byteSize:first.byte_size,sha256:first.content_sha256,transformVersion:'community.event-prize-photo.webp.v1',policyRevision:first.policy_revision})).bytes;}
 catch{throw new Problem(503,'event_prize_photo_read_unavailable','照片暫時無法載入，請稍後重試。');}
 const last=await snapshot();if(!last||JSON.stringify(last)!==JSON.stringify(first))throw missing();return bytes;
}
export function readPublicEventPrizePhoto(pool:Pool,rawEventId:string,rawPrizeId:string,rawVersion:string,store?:ObjectStore){
 const eventId=z.uuid().parse(rawEventId).toLowerCase(),prizeId=z.uuidv4().parse(rawPrizeId).toLowerCase(),version=assetVersion.parse(rawVersion);
 return readAuthorizedEventPrizePhoto(async()=> (await pool.query<EventPrizePhotoSnapshot>(`SELECT ${columns} ${joins} WHERE ${current}
  AND e.state='published' AND e.visibility IN ('referral','open') AND NOT is_verification_test_account(e.organizer_ref)`,[eventId,prizeId,version])).rows[0],store,version);
}
export function readMemberEventPrizePhoto(pool:Pool,rawActor:Actor,rawEventId:string,rawPrizeId:string,rawVersion:string,store?:ObjectStore){
 const actor=Object.freeze({...rawActor}),eventId=z.uuid().parse(rawEventId).toLowerCase(),prizeId=z.uuidv4().parse(rawPrizeId).toLowerCase(),version=assetVersion.parse(rawVersion);
 return readAuthorizedEventPrizePhoto(()=>withMemberScope(pool,{actor,scope:'community'},async()=>{},async(q:PoolClient,c)=>{
  await requireEventPrizePhotoMember(q,actor);
  const row=(await q.query<EventPrizePhotoSnapshot>(`SELECT ${columns} ${joins} WHERE ${current} AND t.community_id=$4 AND t.scope_id=$6
   AND (e.organizer_ref=$5 OR NOT is_verification_test_account(e.organizer_ref))
   AND (e.organizer_ref=$5 OR e.state='pending' AND EXISTS(SELECT 1 FROM positioning_guild_officers officer
     JOIN positioning_profession_memberships membership ON membership.community_id=officer.community_id AND membership.guild_key=officer.guild_key AND membership.user_id=officer.user_id AND membership.state='active'
     WHERE officer.community_id=e.community_id AND officer.guild_key=e.review_guild_key AND officer.user_id=$5)
    OR e.state='published' AND (e.visibility<>'guild' OR EXISTS(SELECT 1 FROM positioning_profession_memberships membership
     WHERE membership.community_id=e.community_id AND membership.guild_key=e.guild_key AND membership.user_id=$5 AND membership.state='active')))`,[eventId,prizeId,version,actor.community_id,actor.user_id,c.scope.scope_id])).rows[0];
  await assertCurrentSessionClock(q,actor);return row;
 }),store,version);
}
