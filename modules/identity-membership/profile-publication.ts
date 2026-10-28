import {certificationBadge} from '../../packages/shared/community-certification.js';
import {titleProjection} from '../social-achievements/policy.js';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {command,checkVersion,journal,type Command} from '../../packages/db/index.js';
import {readWithMemberSession} from '../../packages/db/member-session.js';
import {requireCondition} from '../../packages/shared/problem.js';
import {ProfilePublicationInput,visitorProfile,ownerPublicationProfile,profileBlockVisible,MemberVisitorProfile,defaultProfileLayout} from '../../packages/shared/member-profile.js';
import type {Actor} from './service.js';
import {assertInteractionMember} from './blocks.js';

import {profileReadySql as ready,memberProfileAuthoritySql,publicProfileAuthoritySql} from '../../packages/shared/profile-authority.js';
import {lockProfileCoverSelection} from '../assets/profile-cover.js';
import {profileCoverProjectionSql} from '../assets/profile-cover-read.js';

type Query=Pick<Pool,'query'>;
const fields=`p.display_name,p.bio,p.links,p.layout,${profileCoverProjectionSql}`;
export async function profilePublicationSettings(q:Query,actor:Actor){
  await assertInteractionMember(q,actor);
  const row=(await q.query(`SELECT p.visibility,${fields},p.include_cover,p.cover_version::text AS cover_version,p.aggregate_version FROM member_profile_publications p WHERE p.user_id=$1 AND p.community_id=$2`,[actor.user_id,actor.community_id])).rows[0];
  return row?{visibility:row.visibility,...ownerPublicationProfile(row),include_cover:row.include_cover,cover_version:row.cover_version,aggregate_version:String(row.aggregate_version)}:{visibility:'private',display_name:'',bio:'',links:[],avatar_url:null,layout:structuredClone(defaultProfileLayout),cover:null,include_cover:false,cover_version:null,aggregate_version:null};
}
export async function saveProfilePublication(pool:Pool,input:Command){
  const body=ProfilePublicationInput.parse(input.body);
  const authorize=async(q:PoolClient)=>{
    const row=await q.query(`SELECT 1 FROM users u WHERE u.user_id=$1 AND u.community_id=$2 AND ${ready('u')}`,[input.actor.user_id,input.actor.community_id]);
    requireCondition(row.rowCount===1,403,'profile_unavailable','完成加入流程的會員才能設定個人空間。');
    await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`profile-publication/${input.actor.user_id}`]);
  };
  await command(pool,input,authorize,async q=>{
    // Lock immutable selected cover before the publication row, matching removal.
    if(body.include_cover)await lockProfileCoverSelection(q,input.actor,body.cover_version!);
    const current=(await q.query('SELECT aggregate_version FROM member_profile_publications WHERE user_id=$1 AND community_id=$2 FOR UPDATE',[input.actor.user_id,input.actor.community_id])).rows[0];
    if(current)checkVersion(String(current.aggregate_version),input.expected);
    else requireCondition(!input.expected,412,'version_conflict','設定已變更，請重新載入。');
    const row=(await q.query(`INSERT INTO member_profile_publications(user_id,community_id,visibility,display_name,bio,links,layout,include_cover,cover_version)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9) ON CONFLICT(user_id) DO UPDATE SET visibility=$3,display_name=$4,bio=$5,links=$6::jsonb,layout=$7::jsonb,include_cover=$8,cover_version=$9,
      aggregate_version=member_profile_publications.aggregate_version+1,updated_at=clock_timestamp() RETURNING aggregate_version`,
      [input.actor.user_id,input.actor.community_id,body.visibility,body.display_name,body.bio,JSON.stringify(body.links),JSON.stringify(body.layout),body.include_cover,body.include_cover?body.cover_version:null])).rows[0];
    await journal(q,input.actor,'member_profile_publication',input.actor.user_id,row.aggregate_version,'save_profile_publication',{visibility:body.visibility});
    // Never retain publication text/links in replayable receipts.
    return {updated:true};
  });
  // Replay returns current settings, not the contents of an old publication.
  return readWithMemberSession(pool,input.actor,q=>profilePublicationSettings(q,input.actor));
}
export type ProfileRecognitionOptions={communityCertificationEnabled?:boolean;socialAchievementsEnabled?:boolean};
export async function memberVisitorProfile(q:Query,actor:Actor,rawId:string,options:ProfileRecognitionOptions={}){
  const certificationEnabled=options.communityCertificationEnabled===true,socialEnabled=options.socialAchievementsEnabled===true;
  const socialTitle=socialEnabled?`(SELECT a.title_id FROM social_achievement_settings s JOIN social_achievement_awards a ON a.user_id=s.user_id AND a.title_id=s.selected_title WHERE s.user_id=p.user_id AND s.community_id=p.community_id AND s.show_title AND s.status<>'revoked' AND a.policy_version='social_days_v1')`:'NULL';
  const id=z.uuid().parse(rawId).toLowerCase();
  // Fields and authority are selected together; no separately fetched private DTO.
  const row=(await q.query(`SELECT ${fields},${socialTitle} AS social_title_id,${certificationEnabled?'c.state AS certification_state,c.show_community_certification':'NULL::text AS certification_state,false AS show_community_certification'},(p.user_id=$2) AS is_self,
      f.state AS friendship_state,f.requester_ref,f.aggregate_version AS friendship_version
    FROM member_profile_publications p
    ${certificationEnabled?'LEFT JOIN member_community_certifications c ON c.user_id=p.user_id AND c.community_id=p.community_id':''}
    LEFT JOIN member_friendships f ON f.community_id=p.community_id AND f.low_ref=least(p.user_id,$2::uuid) AND f.high_ref=greatest(p.user_id,$2::uuid)
    JOIN users u ON u.user_id=p.user_id AND u.community_id=p.community_id
    JOIN users v ON v.user_id=$2 AND v.community_id=p.community_id
    WHERE ${memberProfileAuthoritySql()}`,[actor.community_id,actor.user_id,id])).rows[0];
  requireCondition(row,404,'profile_not_found','找不到可閱讀的個人空間。');
  const self=Boolean(row.is_self),state=row.friendship_state??'none';
  const profile=visitorProfile(row),showRecognition=profileBlockVisible(profile,'recognition');
  const badge=certificationEnabled&&showRecognition?certificationBadge(row.certification_state,row.show_community_certification):undefined,title=socialEnabled&&showRecognition?titleProjection(row.social_title_id):null;
  return MemberVisitorProfile.parse({profile,...(badge?{community_certification:badge}:{}),...(title?{social_achievement:title}:{}),actions:{is_self:self,
    friendship:{state,requester_ref:row.requester_ref??null,aggregate_version:row.friendship_version===null||row.friendship_version===undefined?null:String(row.friendship_version)},
    can_request:!self&&(state==='none'||state==='removed'),can_accept:!self&&state==='pending'&&row.requester_ref===id,can_message:!self}});
}
/** Always anonymous authority, even when the request contains a Cookie. */
export async function publicVisitorProfile(q:Query,rawId:string){
  const id=z.uuid().parse(rawId).toLowerCase();
  const row=(await q.query(`SELECT ${fields} FROM member_profile_publications p JOIN users u ON u.user_id=p.user_id AND u.community_id=p.community_id
    WHERE ${publicProfileAuthoritySql()}`,[id])).rows[0];
  requireCondition(row,404,'profile_not_found','找不到可閱讀的個人空間。');
  return visitorProfile(row);
}
