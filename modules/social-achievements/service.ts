import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {command,checkVersion,journal,type Command} from '../../packages/db/index.js';
import {readWithMemberSession} from '../../packages/db/member-session.js';
import {requireCondition} from '../../packages/shared/problem.js';
import type {Actor} from '../identity-membership/service.js';
import {assertInteractionMember} from '../identity-membership/blocks.js';
import {requireMemberContentAdmin,canHideMemberContent} from '../community/moderation.js';
import {SOCIAL_POLICY,SOCIAL_TITLES,socialProgress,unlockedTitles,titleProjection} from './policy.js';
const ready=(u:string)=>`${u}.active AND (NOT ${u}.onboarding_required OR ${u}.onboarding_completed_at IS NOT NULL) AND NOT is_verification_test_account(${u}.user_id)`;
const barrier=(q:PoolClient,community:string)=>q.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`social-achievements/${community}`]);
async function authorize(q:PoolClient,actor:Actor){await assertInteractionMember(q,actor);await barrier(q,actor.community_id);}
async function counts(q:PoolClient,id:string){const rows=(await q.query('SELECT track,count(*)::int AS days FROM social_achievement_days WHERE user_id=$1 GROUP BY track',[id])).rows;return {chat:Number(rows.find(r=>r.track==='chat')?.days??0),participation:Number(rows.find(r=>r.track==='participation')?.days??0)};}
async function award(q:PoolClient,id:string){if(!(await q.query("SELECT 1 FROM social_achievement_settings WHERE user_id=$1 AND status='active'",[id])).rowCount)return;const n=await counts(q,id);for(const t of unlockedTitles(n.chat,n.participation))await q.query('INSERT INTO social_achievement_awards(user_id,title_id,policy_version) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[id,t.title_id,SOCIAL_POLICY]);}
async function credit(q:PoolClient,id:string,day:string,chat:boolean){for(const track of chat?['chat','participation']:['participation'])await q.query('INSERT INTO social_achievement_days(user_id,track,qualified_day) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[id,track,day]);await award(q,id);}
/** Within original successful command transaction ONLY; caller must explicitly enable capability.
 * Server metadata only. No client-supplied member, date, count, message body or time.
 * Channel writes already hold world channel barrier; work writers never acquire it.
 */
export async function recordSocialChat(q:PoolClient,community:string,messageId:string){
  // Read immutable references first; no raw message text is selected.
  const r=(await q.query(`SELECT a.sender_ref AS first,b.sender_ref AS second,a.message_id AS first_id,b.message_id AS reply_id,c.message_id AS source_id,
    a.created_at AS began,c.created_at AS completed,(c.created_at AT TIME ZONE 'Asia/Taipei')::date::text AS day
    FROM member_channel_messages c JOIN member_channel_messages b ON b.message_id=c.reply_to_message_id
    JOIN member_channel_messages a ON a.message_id=b.reply_to_message_id
    WHERE c.message_id=$1 AND c.community_id=$2 AND b.community_id=$2 AND a.community_id=$2
      AND c.kind='world' AND b.kind='world' AND a.kind='world'
      AND c.channel_key='world' AND b.channel_key='world' AND a.channel_key='world'
      AND c.sender_ref=a.sender_ref AND a.sender_ref<>b.sender_ref
      AND a.retracted_at IS NULL AND b.retracted_at IS NULL AND c.retracted_at IS NULL
      AND b.created_at>=a.created_at AND c.created_at>=b.created_at AND c.created_at<=a.created_at+interval '24 hours' FOR SHARE OF a,b,c`,[messageId,community])).rows[0];
  if(!r)return;
  const [low,high]=[String(r.first),String(r.second)].sort();
  // Same pair barrier as blocks. Never acquire it after the achievement barrier.
  await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`friend/${community}/${low}/${high}`]);
  await barrier(q,community);
  const members=(await q.query(`SELECT s.user_id FROM social_achievement_settings s JOIN users u USING(user_id)
    WHERE s.community_id=$1 AND u.community_id=$1 AND s.user_id=ANY($2::uuid[]) AND ${ready('u')}
      AND s.counting_enabled AND s.consent_since<=$3 FOR SHARE OF s,u`,[community,[low,high],r.began])).rows;
  if(members.length!==2)return;
  if((await q.query(`SELECT 1 FROM member_interaction_blocks WHERE community_id=$1 AND state='active'
    AND ((owner_ref=$2 AND target_ref=$3) OR (owner_ref=$3 AND target_ref=$2))`,[community,low,high])).rowCount)return;
  // Both reply IDs can be used only once; monthly cap is per unordered pair.
  if((await q.query(`SELECT 1 FROM social_achievement_pairs WHERE community_id=$1 AND source_kind='chat'
    AND (source_id=ANY($2::uuid[]) OR reply_id=ANY($2::uuid[]))`,[community,[r.reply_id,r.source_id]])).rowCount)return;
  await q.query('DELETE FROM social_achievement_pairs WHERE community_id=$1 AND expires_at<clock_timestamp()',[community]);
  const cap=(await q.query(`SELECT count(*)::int AS n FROM social_achievement_pairs WHERE community_id=$1 AND low_ref=$2 AND high_ref=$3 AND source_kind='chat'
    AND date_trunc('month',qualified_day::timestamp)=date_trunc('month',$4::date::timestamp)`,[community,low,high,r.day])).rows[0];
  if(cap.n>=8)return;
  const inserted=await q.query(`INSERT INTO social_achievement_pairs(community_id,low_ref,high_ref,qualified_day,source_id,reply_id,source_kind,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,'chat',clock_timestamp()+interval '35 days') ON CONFLICT DO NOTHING`,[community,low,high,r.day,r.source_id,r.reply_id]);
  if(inserted.rowCount){await credit(q,low,r.day,true);await credit(q,high,r.day,true);}
}
/** The existing acceptance authority already rejects self-review. Revalidate source metadata. */
export async function recordSocialWork(q:PoolClient,community:string,workId:string){
  const pair=(await q.query(`SELECT c.user_id,d.reviewer_ref FROM contributions c JOIN work_decisions d ON d.decision_id=c.decision_id
    WHERE c.work_item_id=$1 AND c.community_id=$2 AND d.decision='accept' AND c.user_id<>d.reviewer_ref`,[workId,community])).rows[0];
  if(!pair)return;
  const pairIds=[String(pair.user_id),String(pair.reviewer_ref)].sort();
  await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`friend/${community}/${pairIds[0]}/${pairIds[1]}`]);
  await barrier(q,community);
  await q.query('DELETE FROM social_achievement_pairs WHERE community_id=$1 AND expires_at<clock_timestamp()',[community]);
  const r=(await q.query(`SELECT c.user_id,c.contribution_id,d.reviewer_ref,(c.accepted_at AT TIME ZONE 'Asia/Taipei')::date::text AS day
    FROM contributions c JOIN work_items w ON w.work_item_id=c.work_item_id AND w.community_id=c.community_id
    JOIN work_decisions d ON d.decision_id=c.decision_id AND d.decision='accept'
    JOIN social_achievement_settings s ON s.user_id=c.user_id AND s.community_id=c.community_id
    JOIN users u ON u.user_id=c.user_id AND u.community_id=c.community_id
    JOIN users v ON v.user_id=d.reviewer_ref AND v.community_id=c.community_id
    WHERE c.work_item_id=$1 AND c.community_id=$2 AND w.work_mode='community_collaboration' AND w.state='accepted'
      AND c.user_id<>d.reviewer_ref AND ${ready('u')} AND ${ready('v')}
      AND s.counting_enabled AND c.accepted_at>=s.consent_since FOR SHARE OF s,u,v`,[workId,community])).rows[0];
  if(!r)return;
  const [low,high]=[r.user_id,r.reviewer_ref].sort();
  if((await q.query(`SELECT 1 FROM member_interaction_blocks WHERE community_id=$1 AND state='active'
    AND ((owner_ref=$2 AND target_ref=$3) OR (owner_ref=$3 AND target_ref=$2))`,[community,low,high])).rowCount)return;
  const cap=(await q.query(`SELECT count(DISTINCT qualified_day)::int AS n,bool_or(qualified_day=$4::date) AS same_day FROM social_achievement_pairs WHERE community_id=$1 AND low_ref=$2 AND high_ref=$3 AND source_kind='work'
    AND date_trunc('month',qualified_day::timestamp)=date_trunc('month',$4::date::timestamp)`,[community,low,high,r.day])).rows[0];
  if(cap.n>=8&&!cap.same_day)return;
  const inserted=await q.query(`INSERT INTO social_achievement_pairs(community_id,low_ref,high_ref,qualified_day,source_id,source_kind,credit_ref,expires_at)
    VALUES($1,$2,$3,$4,$5,'work',$6,clock_timestamp()+interval '35 days') ON CONFLICT DO NOTHING`,[community,low,high,r.day,r.contribution_id,r.user_id]);
  if(inserted.rowCount)await credit(q,r.user_id,r.day,false);
}
async function own(q:PoolClient,actor:Actor){
  await assertInteractionMember(q,actor);
  const r=(await q.query('SELECT counting_enabled,show_title,selected_title,status,moderation_reason,appeal_state,aggregate_version FROM social_achievement_settings WHERE user_id=$1 AND community_id=$2',[actor.user_id,actor.community_id])).rows[0];
  const n=await counts(q,actor.user_id),awards=(await q.query('SELECT title_id FROM social_achievement_awards WHERE user_id=$1',[actor.user_id])).rows.map(r=>String(r.title_id));
  return {policy_version:SOCIAL_POLICY,counting_enabled:r?.counting_enabled??false,show_title:r?.show_title??false,selected_title:r?.selected_title??null,
    status:r?.status??'active',moderation_reason:r?.moderation_reason??null,appeal_state:r?.appeal_state??'none',aggregate_version:r?String(r.aggregate_version):null,
    chat:socialProgress(n.chat),participation:socialProgress(n.participation),titles:SOCIAL_TITLES.map(t=>({...t,unlocked:awards.includes(t.title_id)})),can_moderate:await canHideMemberContent(q,actor),selected:r&&r.status!=='revoked'?titleProjection(r.selected_title):null};
}
export const readSocialAchievements=(pool:Pool,actor:Actor)=>readWithMemberSession(pool,actor,q=>own(q,actor));
const Settings=z.object({policy_version:z.literal(SOCIAL_POLICY),counting_enabled:z.boolean(),show_title:z.boolean(),selected_title:z.string().nullable()}).strict();
export async function saveSocialAchievements(pool:Pool,input:Command){
  const b=Settings.parse(input.body);await command(pool,input,q=>authorize(q,input.actor),async q=>{
    const r=(await q.query('SELECT aggregate_version,counting_enabled FROM social_achievement_settings WHERE user_id=$1 FOR UPDATE',[input.actor.user_id])).rows[0];
    if(r)checkVersion(String(r.aggregate_version),input.expected);else requireCondition(!input.expected,412,'version_conflict','請重新載入。');
    if(b.selected_title!==null)requireCondition((await q.query('SELECT 1 FROM social_achievement_awards WHERE user_id=$1 AND title_id=$2',[input.actor.user_id,b.selected_title])).rowCount,422,'title_locked','請選擇已獲得的稱號。');
    requireCondition(!b.show_title||b.selected_title!==null,422,'title_required','請先選擇稱號。');
    const row=(await q.query(`INSERT INTO social_achievement_settings(user_id,community_id,counting_enabled,show_title,selected_title,consent_since)
      VALUES($1,$2,$3,$4,$5,CASE WHEN $3 THEN clock_timestamp() ELSE NULL END)
      ON CONFLICT(user_id) DO UPDATE SET counting_enabled=$3,show_title=$4,selected_title=$5,
      consent_since=CASE WHEN $3 AND NOT social_achievement_settings.counting_enabled THEN clock_timestamp() ELSE social_achievement_settings.consent_since END,
      aggregate_version=social_achievement_settings.aggregate_version+1 RETURNING aggregate_version`,[input.actor.user_id,input.actor.community_id,b.counting_enabled,b.show_title,b.selected_title])).rows[0];
    await journal(q,input.actor,'social_achievement',input.actor.user_id,row.aggregate_version,'settings',{});return {updated:true};
  });return readSocialAchievements(pool,input.actor);
}
export async function eraseSocialAchievements(pool:Pool,input:Command){
  z.object({confirm:z.literal(true)}).strict().parse(input.body);
  await command(pool,input,q=>authorize(q,input.actor),async q=>{
    const r=(await q.query('SELECT aggregate_version FROM social_achievement_settings WHERE user_id=$1 FOR UPDATE',[input.actor.user_id])).rows[0];
    requireCondition(r,404,'not_found','找不到成就設定。');checkVersion(String(r.aggregate_version),input.expected);
    await q.query('DELETE FROM social_achievement_awards WHERE user_id=$1',[input.actor.user_id]);await q.query('DELETE FROM social_achievement_days WHERE user_id=$1',[input.actor.user_id]);
    await q.query('UPDATE social_achievement_settings SET counting_enabled=false,show_title=false,selected_title=NULL,consent_since=NULL,aggregate_version=aggregate_version+1 WHERE user_id=$1',[input.actor.user_id]);
    await journal(q,input.actor,'social_achievement',input.actor.user_id,BigInt(r.aggregate_version)+1n+'','erase',{});return {updated:true};
  });return readSocialAchievements(pool,input.actor);
}
export async function appealSocialAchievements(pool:Pool,input:Command){
  const b=z.object({reason:z.string().trim().min(1).max(1000)}).strict().parse(input.body);
  await command(pool,input,q=>authorize(q,input.actor),async q=>{
    const r=(await q.query('SELECT aggregate_version,status,appeal_state FROM social_achievement_settings WHERE user_id=$1 FOR UPDATE',[input.actor.user_id])).rows[0];
    requireCondition(r&&r.status!=='active',409,'appeal_unavailable','目前沒有待申訴的限制。');checkVersion(String(r.aggregate_version),input.expected);
    requireCondition(r.appeal_state!=='pending',409,'appeal_pending','申訴已送出，請等待處理。');
    const row=(await q.query("UPDATE social_achievement_settings SET appeal=$2,appeal_state='pending',aggregate_version=aggregate_version+1 WHERE user_id=$1 RETURNING aggregate_version",[input.actor.user_id,b.reason])).rows[0];await journal(q,input.actor,'social_achievement',input.actor.user_id,row.aggregate_version,'appeal',{});return {updated:true};
  });return readSocialAchievements(pool,input.actor);
}
export async function listSocialReview(pool:Pool,actor:Actor,raw:unknown={}){
 const {after}=z.object({after:z.uuid().optional()}).strict().parse(raw);
 return readWithMemberSession(pool,actor,async q=>{await requireMemberContentAdmin(q,actor);const rows=(await q.query(`SELECT s.user_id,u.display_name,s.status,s.moderation_reason,s.appeal,s.appeal_state,s.aggregate_version::text FROM social_achievement_settings s JOIN users u USING(user_id) WHERE s.community_id=$1 AND (s.status<>'active' OR s.appeal_state='pending') AND ($2::uuid IS NULL OR s.user_id>$2::uuid) ORDER BY s.user_id LIMIT 101`,[actor.community_id,after??null])).rows;return {items:rows.slice(0,100),next_after:rows.length>100?rows[99].user_id:null};});
}
export async function moderateSocialAchievements(pool:Pool,input:Command,id:string){
  id=z.uuid().parse(id).toLowerCase();const b=z.object({status:z.enum(['active','paused','revoked']),reason:z.string().trim().min(1).max(1000)}).strict().parse(input.body);
  await command(pool,input,async q=>{await requireMemberContentAdmin(q,input.actor);await barrier(q,input.actor.community_id);},async q=>{
    const r=(await q.query('SELECT aggregate_version FROM social_achievement_settings WHERE user_id=$1 AND community_id=$2 FOR UPDATE',[id,input.actor.community_id])).rows[0];requireCondition(r,404,'not_found','找不到成就設定。');checkVersion(String(r.aggregate_version),input.expected);
    const row=(await q.query(`UPDATE social_achievement_settings SET status=$2,moderation_reason=$3,appeal_state=CASE WHEN appeal_state='pending' THEN 'resolved' ELSE appeal_state END,aggregate_version=aggregate_version+1 WHERE user_id=$1 RETURNING aggregate_version`,[id,b.status,b.reason])).rows[0];
    if(b.status==='active')await award(q,id);
    await journal(q,input.actor,'social_achievement',id,row.aggregate_version,'moderation',{status:b.status,reason:b.reason});return {updated:true};
  });return {updated:true};
}

export async function readSocialReview(pool:Pool,actor:Actor,rawId:string){const id=z.uuid().parse(rawId).toLowerCase();return readWithMemberSession(pool,actor,async q=>{await requireMemberContentAdmin(q,actor);const row=(await q.query(`SELECT s.user_id,u.display_name,s.status,s.moderation_reason,s.appeal,s.appeal_state,s.aggregate_version::text FROM social_achievement_settings s JOIN users u USING(user_id) WHERE s.user_id=$1 AND s.community_id=$2`,[id,actor.community_id])).rows[0];requireCondition(row,404,'not_found','找不到成就設定。');return row;});}
