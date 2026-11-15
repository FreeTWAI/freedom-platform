import { z } from 'zod';
import type { PoolClient } from 'pg';
import type { Actor } from '../../identity-membership/service.js';
import { readEvent } from '../../community/events.js';
import { readMemberServiceShare } from '../../community/member-services.js';
import { requireCondition } from '../../../packages/shared/problem.js';
import type { PreparedShare, ShareAdapter, ShareKind } from '../types.js';
/** Platform and member-card shares anchor click credit only; they are not feed items. */
export function feedShareSql(s:string) {
  return `NOT (${s}.kind='link' AND (${s}.canonical_key='platform' OR ${s}.canonical_key LIKE 'member-card:%'))`;
}
/** Batched form of existingTitle's audience checks. Alias and parameter are fixed by callers. */
export function existingReadableSql(s:'s',member:'$2') {
  const eventAudience=`(e.visibility<>'guild' OR e.organizer_ref=${member} OR EXISTS(
    SELECT 1 FROM positioning_profession_memberships m WHERE m.community_id=e.community_id
      AND m.guild_key=e.guild_key AND m.user_id=${member} AND m.state='active'))`;
  return `(${s}.ref_id IS NULL OR CASE ${s}.kind
    WHEN 'event' THEN EXISTS(SELECT 1 FROM community_events e WHERE e.event_id=${s}.ref_id AND e.community_id=${s}.community_id
      AND e.state='published' AND (e.organizer_ref=${member} OR NOT is_verification_test_account(e.organizer_ref)) AND ${eventAudience})
    WHEN 'work' THEN EXISTS(SELECT 1 FROM showcases w WHERE w.showcase_id=${s}.ref_id AND w.community_id=${s}.community_id
      AND w.status='published' AND w.visibility='community' AND NOT is_verification_test_account(w.owner_ref))
    WHEN 'post' THEN EXISTS(SELECT 1 FROM community_social_posts p WHERE p.post_id=${s}.ref_id AND p.community_id=${s}.community_id
      AND p.state='active' AND NOT is_verification_test_account(p.author_user_id))
    WHEN 'service' THEN EXISTS(SELECT 1 FROM member_services v JOIN users u ON u.user_id=v.owner_user_id
      WHERE v.service_id=${s}.ref_id AND v.community_id=${s}.community_id AND v.state='active' AND u.active AND NOT is_verification_test_account(u.user_id))
    ELSE false END)`;
}

/** Hidden events retain the historical credit view for people in their audience. */
export function hiddenEventReadableSql(s:'s',member:'$2') {
  return `(${s}.kind='event' AND ${s}.state='hidden' AND ${s}.ref_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM community_events e WHERE e.event_id=${s}.ref_id AND e.community_id=${s}.community_id
      AND NOT is_verification_test_account(e.organizer_ref) AND (e.visibility<>'guild' OR e.organizer_ref=${member} OR EXISTS(
        SELECT 1 FROM positioning_profession_memberships m WHERE m.community_id=e.community_id
          AND m.guild_key=e.guild_key AND m.user_id=${member} AND m.state='active'))))`;
}
/** Domain references retain their original audience; they are not new public publications. */
export async function existingTitle(q:PoolClient,actor:Actor,kind:ShareKind,id:string):Promise<string|null> {
  if(kind==='event') {
    try {const e=await readEvent(q,actor,id);return e.state==='published'?e.title:null;}catch(error){if((error as {status?:number}).status===404||(error as {status?:number}).status===403)return null;throw error;}
  }
  if(kind==='service')return (await readMemberServiceShare(q,actor.community_id,id))?.title??null;
  if(kind==='work')return (await q.query(`SELECT title FROM showcases WHERE showcase_id=$1 AND community_id=$2 AND status='published' AND visibility='community' AND NOT is_verification_test_account(owner_ref)`,[id,actor.community_id])).rows[0]?.title??null;
  if(kind==='post')return (await q.query(`SELECT title FROM community_social_posts WHERE post_id=$1 AND community_id=$2 AND state='active' AND NOT is_verification_test_account(author_user_id)`,[id,actor.community_id])).rows[0]?.title??null;
  return null;
}
export function existingAdapter(kind:ShareKind,table:string,path:string):ShareAdapter {
  return {kind,async prepare(input){const id=z.uuid().parse(input.ref_id);return {kind,canonical_key:`${kind}:${id}`,canonical_url:path.includes('{id}')?path.replace('{id}',id):`${path}${id}`,title:kind,ref_table:table,ref_id:id};},
    async authorize(q,actor,prepared:PreparedShare){const title=await existingTitle(q,actor,kind,prepared.ref_id!);requireCondition(title,404,'not_found','找不到可分享的內容。');prepared.title=title;}};
}
