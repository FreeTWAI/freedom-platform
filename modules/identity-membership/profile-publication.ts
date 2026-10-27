import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {command,checkVersion,journal,type Command} from '../../packages/db/index.js';
import {readWithMemberSession} from '../../packages/db/member-session.js';
import {requireCondition} from '../../packages/shared/problem.js';
import {ProfilePublicationInput,visitorProfile,MemberVisitorProfile} from '../../packages/shared/member-profile.js';
import type {Actor} from './service.js';
import {assertInteractionMember} from './blocks.js';

type Query=Pick<Pool,'query'>;
const ready=(alias:string)=>`${alias}.active AND (NOT ${alias}.onboarding_required OR ${alias}.onboarding_completed_at IS NOT NULL) AND NOT is_verification_test_account(${alias}.user_id)`;
const fields='p.display_name,p.bio,p.links';
export async function profilePublicationSettings(q:Query,actor:Actor){
  await assertInteractionMember(q,actor);
  const row=(await q.query(`SELECT p.visibility,p.display_name,p.bio,p.links,p.aggregate_version FROM member_profile_publications p WHERE p.user_id=$1 AND p.community_id=$2`,[actor.user_id,actor.community_id])).rows[0];
  return row?{visibility:row.visibility,...visitorProfile(row),aggregate_version:String(row.aggregate_version)}:{visibility:'private',display_name:'',bio:'',links:[],avatar_url:null,aggregate_version:null};
}
export async function saveProfilePublication(pool:Pool,input:Command){
  const body=ProfilePublicationInput.parse(input.body);
  const authorize=async(q:PoolClient)=>{
    const row=await q.query(`SELECT 1 FROM users u WHERE u.user_id=$1 AND u.community_id=$2 AND ${ready('u')}`,[input.actor.user_id,input.actor.community_id]);
    requireCondition(row.rowCount===1,403,'profile_unavailable','完成加入流程的會員才能設定個人空間。');
    await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`profile-publication/${input.actor.user_id}`]);
  };
  await command(pool,input,authorize,async q=>{
    const current=(await q.query('SELECT aggregate_version FROM member_profile_publications WHERE user_id=$1 AND community_id=$2 FOR UPDATE',[input.actor.user_id,input.actor.community_id])).rows[0];
    if(current)checkVersion(String(current.aggregate_version),input.expected);
    else requireCondition(!input.expected,412,'version_conflict','設定已變更，請重新載入。');
    const row=(await q.query(`INSERT INTO member_profile_publications(user_id,community_id,visibility,display_name,bio,links)
      VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(user_id) DO UPDATE SET visibility=$3,display_name=$4,bio=$5,links=$6::jsonb,
      aggregate_version=member_profile_publications.aggregate_version+1,updated_at=clock_timestamp() RETURNING aggregate_version`,
      [input.actor.user_id,input.actor.community_id,body.visibility,body.display_name,body.bio,JSON.stringify(body.links)])).rows[0];
    await journal(q,input.actor,'member_profile_publication',input.actor.user_id,row.aggregate_version,'save_profile_publication',{visibility:body.visibility});
    // Never retain publication text/links in replayable receipts.
    return {updated:true};
  });
  // Replay returns current settings, not the contents of an old publication.
  return readWithMemberSession(pool,input.actor,q=>profilePublicationSettings(q,input.actor));
}
export async function memberVisitorProfile(q:Query,actor:Actor,rawId:string){
  const id=z.uuid().parse(rawId).toLowerCase();
  // Fields and authority are selected together; no separately fetched private DTO.
  const row=(await q.query(`SELECT ${fields},(p.user_id=$2) AS is_self,
      f.state AS friendship_state,f.requester_ref,f.aggregate_version AS friendship_version
    FROM member_profile_publications p
    LEFT JOIN member_friendships f ON f.community_id=p.community_id AND f.low_ref=least(p.user_id,$2::uuid) AND f.high_ref=greatest(p.user_id,$2::uuid)
    JOIN users u ON u.user_id=p.user_id AND u.community_id=p.community_id
    JOIN users v ON v.user_id=$2 AND v.community_id=p.community_id
    WHERE p.user_id=$3 AND p.community_id=$1 AND ${ready('u')} AND ${ready('v')}
      AND (p.user_id=$2 OR (p.visibility IN ('members','public') AND NOT EXISTS(
        SELECT 1 FROM member_interaction_blocks b WHERE b.community_id=$1 AND b.state='active'
        AND ((b.owner_ref=$2 AND b.target_ref=p.user_id) OR (b.owner_ref=p.user_id AND b.target_ref=$2)))))`,[actor.community_id,actor.user_id,id])).rows[0];
  requireCondition(row,404,'profile_not_found','找不到可閱讀的個人空間。');
  const self=Boolean(row.is_self),state=row.friendship_state??'none';
  return MemberVisitorProfile.parse({profile:visitorProfile(row),actions:{is_self:self,
    friendship:{state,requester_ref:row.requester_ref??null,aggregate_version:row.friendship_version===null||row.friendship_version===undefined?null:String(row.friendship_version)},
    can_request:!self&&(state==='none'||state==='removed'),can_accept:!self&&state==='pending'&&row.requester_ref===id,can_message:!self}});
}
/** Always anonymous authority, even when the request contains a Cookie. */
export async function publicVisitorProfile(q:Query,rawId:string){
  const id=z.uuid().parse(rawId).toLowerCase();
  const row=(await q.query(`SELECT ${fields} FROM member_profile_publications p JOIN users u ON u.user_id=p.user_id AND u.community_id=p.community_id
    WHERE p.user_id=$1 AND p.visibility='public' AND ${ready('u')}`,[id])).rows[0];
  requireCondition(row,404,'profile_not_found','找不到可閱讀的個人空間。');
  return visitorProfile(row);
}
