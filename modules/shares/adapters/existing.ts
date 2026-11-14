import { z } from 'zod';
import type { PoolClient } from 'pg';
import type { Actor } from '../../identity-membership/service.js';
import { readEvent } from '../../community/events.js';
import { readMemberServiceShare } from '../../community/member-services.js';
import { requireCondition } from '../../../packages/shared/problem.js';
import type { PreparedShare, ShareAdapter, ShareKind } from '../types.js';
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
