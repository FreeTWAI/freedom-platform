import {z} from 'zod';
import type {Pool,PoolClient} from 'pg';
import {command,checkVersion,journal,transaction,type Command} from '../../packages/db/index.js';
import {readWithMemberSession,lockMemberSession,assertCurrentSessionClock} from '../../packages/db/member-session.js';
import {requireCondition} from '../../packages/shared/problem.js';
import type {Actor} from '../identity-membership/service.js';
import {authRateLimitInTransaction} from '../identity-membership/members.js';
import {adminCommand,audit,type AdminActor,type AdminCommand} from '../platform-admin/service.js';
import {ApplicationInput,DisplayInput,WithdrawInput,ReviewInput,CERTIFICATION_POLICY,nextCertificationState,type CertificationSettings,type CertificationState} from '../../packages/shared/community-certification.js';

type Row={state:CertificationState;aggregate_version:string;statement:string;show_community_certification:boolean};
const columns='state,aggregate_version,statement,show_community_certification';
const empty:Row={state:'unrequested',aggregate_version:'1',statement:'',show_community_certification:false};
function settings(row:Row=empty):CertificationSettings{
 const version=Number(row.aggregate_version);requireCondition(Number.isSafeInteger(version)&&version>0,500,'version_overflow','資料版本超出範圍。');
 return {state:row.state,aggregate_version:version,statement:row.statement,show_community_certification:row.show_community_certification,policy_version:CERTIFICATION_POLICY};
}
async function eligible(q:PoolClient,community:string,id:string,readyRequired=true){
 const row=(await q.query(`SELECT user_id,email FROM users WHERE user_id=$1 AND community_id=$2
  AND (NOT $3 OR (active AND (NOT onboarding_required OR onboarding_completed_at IS NOT NULL))) AND NOT is_verification_test_account(user_id) FOR SHARE`,[id,community,readyRequired])).rows[0];
 requireCondition(row,404,'certification_member_unavailable','找不到可申請認證的會員。');return row as {user_id:string;email:string};
}
async function lockCertification(q:PoolClient,community:string,id:string){
 await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`community-certification/${community}/${id}`]);
 return (await q.query<Row>(`SELECT ${columns} FROM member_community_certifications WHERE user_id=$1 AND community_id=$2 FOR UPDATE`,[id,community])).rows[0]??empty;
}
export async function ownCertification(pool:Pool,actor:Actor){return readWithMemberSession(pool,actor,async q=>{
 await eligible(q,actor.community_id,actor.user_id);
 return settings((await q.query<Row>(`SELECT ${columns} FROM member_community_certifications WHERE user_id=$1 AND community_id=$2`,[actor.user_id,actor.community_id])).rows[0]);
});}
export async function changeOwnCertification(pool:Pool,input:Command,action:'apply'|'withdraw'|'display'){
 const body=action==='apply'?ApplicationInput.parse(input.body):action==='display'?DisplayInput.parse(input.body):WithdrawInput.parse(input.body);
 let previous:Row=empty;
 await command(pool,input,async q=>{await eligible(q,input.actor.community_id,input.actor.user_id);previous=await lockCertification(q,input.actor.community_id,input.actor.user_id);},async q=>{
  checkVersion(String(previous.aggregate_version),input.expected);
  const state=action==='display'?previous.state:nextCertificationState(previous.state,action);
  requireCondition(state,409,'certification_state_conflict','認證狀態已變更，請重新載入後再操作。');
  if(action==='apply')await authRateLimitInTransaction(q,'community-certification-application',input.actor.user_id,3,86400);
  const statement=action==='apply'?(body as z.infer<typeof ApplicationInput>).statement:previous.statement;
  const display=action==='display'?(body as z.infer<typeof DisplayInput>).show_community_certification:previous.show_community_certification;
  const row=(await q.query<Row>(`INSERT INTO member_community_certifications(user_id,community_id,state,statement,show_community_certification,aggregate_version)
   VALUES($1,$2,$3,$4,$5,2) ON CONFLICT(user_id) DO UPDATE SET state=$3,statement=$4,show_community_certification=$5,
   aggregate_version=member_community_certifications.aggregate_version+1,updated_at=clock_timestamp(),
   reviewed_by=CASE WHEN $6 THEN NULL ELSE member_community_certifications.reviewed_by END,
   reviewer_user_id=CASE WHEN $6 THEN NULL ELSE member_community_certifications.reviewer_user_id END,
   reviewed_at=CASE WHEN $6 THEN NULL ELSE member_community_certifications.reviewed_at END RETURNING ${columns}`,
   [input.actor.user_id,input.actor.community_id,state,statement,display,action==='apply'])).rows[0];
  await journal(q,input.actor,'community_certification',input.actor.user_id,row.aggregate_version,`certification_${action}`,{state,show_community_certification:display});
  // No private application text or stale badge assertion in replayable receipts.
  return {updated:true};
 });
 return ownCertification(pool,input.actor);
}
export type AccessRevalidation=()=>Promise<void>;
/** Uses an actual simultaneous member session, not an email-to-admin role grant. */
async function reviewer(q:PoolClient,admin:AdminActor,member:Actor){
 requireCondition(member.community_id===admin.community_id,403,'certification_reviewer_identity','請登入管理員本人所屬社群的會員帳號。');
 await lockMemberSession(q,member);
 const rows=await q.query('SELECT user_id FROM users WHERE community_id=$1 AND lower(email)=$2 AND active FOR SHARE',[admin.community_id,admin.email]);
 requireCondition(rows.rowCount===1&&rows.rows[0].user_id===member.user_id,403,'certification_reviewer_identity','請先登入與 Access 管理員驗證信箱相同的會員帳號。');
}
export async function reviewCertification(pool:Pool,input:AdminCommand,member:Actor,rawId:string,revalidate:AccessRevalidation){
 const id=z.uuid().parse(rawId).toLowerCase(),body=ReviewInput.parse(input.body);let previous:Row=empty;
 return adminCommand(pool,input,async q=>{
  await reviewer(q,input.admin,member);
  requireCondition(id!==member.user_id,403,'certification_self_review','不能審核或核發自己的社群認證，請由另一位管理員處理。');
  const target=await eligible(q,input.admin.community_id,id,body.decision==='approve');
  requireCondition(target.email.toLowerCase()!==input.admin.email,403,'certification_self_review','不能審核自己的社群認證。');
  previous=await lockCertification(q,input.admin.community_id,id);
  await assertCurrentSessionClock(q,member);await revalidate();
 },async q=>{
  checkVersion(String(previous.aggregate_version),input.expected);
  const state=nextCertificationState(previous.state,body.decision);
  requireCondition(state,409,'certification_state_conflict','認證狀態已變更，請重新載入後再操作。');
  const row=(await q.query<Row>(`UPDATE member_community_certifications SET state=$3,reviewed_by=$4,reviewer_user_id=$5,
   reviewed_at=clock_timestamp(),updated_at=clock_timestamp(),aggregate_version=aggregate_version+1
   WHERE user_id=$1 AND community_id=$2 RETURNING ${columns}`,[id,input.admin.community_id,state,input.admin.admin_id,member.user_id])).rows[0];
  await audit(q,input.admin,`community_certification_${body.decision}`,'community_certification',id,body.reason,
   {state:previous.state,aggregate_version:String(previous.aggregate_version)}, {state,aggregate_version:String(row.aggregate_version),reviewer_user_id:member.user_id});
  return {updated:true};
 },false,async q=>{await assertCurrentSessionClock(q,member);await revalidate();});
}
export async function certificationQueue(pool:Pool,admin:AdminActor,query:Record<string,string>,revalidate:AccessRevalidation){
 const input=z.object({state:z.enum(['pending','active','rejected','revoked','withdrawn','all']).default('pending'),limit:z.coerce.number().int().min(1).max(50).default(25),offset:z.coerce.number().int().min(0).max(100000).default(0)}).strict().parse(query);
 return transaction(pool,async q=>{
  requireCondition((await q.query('SELECT 1 FROM platform_admins WHERE admin_id=$1 AND community_id=$2 AND active FOR SHARE',[admin.admin_id,admin.community_id])).rowCount===1,403,'admin_required','管理權限已變更。');
  const rows=(await q.query(`SELECT c.user_id,u.display_name,c.${columns.replaceAll(',',',c.')} FROM member_community_certifications c
   JOIN users u ON u.user_id=c.user_id AND u.community_id=c.community_id WHERE c.community_id=$1
   AND ($2='all' OR c.state=$2) AND c.state<>'unrequested' AND NOT is_verification_test_account(u.user_id)
   ORDER BY c.updated_at,c.user_id LIMIT $3 OFFSET $4`,[admin.community_id,input.state,input.limit+1,input.offset])).rows;
  await revalidate();return {items:rows.slice(0,input.limit).map(row=>({user_id:row.user_id,display_name:row.display_name,...settings(row)})),next_offset:rows.length>input.limit?input.offset+input.limit:null};
 });
}
