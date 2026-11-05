import {QUEST_STEP_IDS} from './quest.js';
import type {Pool} from 'pg';
import {command,checkVersion,journal,type Command} from '../../packages/db/index.js';
import {readWithMemberSession} from '../../packages/db/member-session.js';
import {requireCondition} from '../../packages/shared/problem.js';
import type {Actor} from '../identity-membership/service.js';
import {activeDevelopmentGuilds} from '../development-access/guild-eligibility.js';
import {testerCommandSchema,testerTriageSchema,mergeTesterProgress} from './account.js';
import {TESTER_MODULE_IDS} from './ownership.js';
import {normalizeProgress} from './progress.js';
import {readTesterAccount,readTesterReport,testerFeedbackVersion} from './repository.js';

export async function getTesterAccount(pool: Pool, actor: Actor) {
  return readWithMemberSession(pool, actor, async q => ({...await readTesterAccount(q,actor.user_id),
    can_report: (await activeDevelopmentGuilds(q,actor,'platform')).length > 0}));
}
export async function getTesterReport(pool: Pool, communityId: string|null, actor?: Actor, moduleId?:string) {
  requireCondition(moduleId===undefined||TESTER_MODULE_IDS.includes(moduleId),422,'invalid_tester_module','Unknown tester module.');
  const read=async(q:import('pg').PoolClient)=>{
    const can_triage=Boolean(actor&&actor.community_id===communityId&&(await activeDevelopmentGuilds(q,actor,'platform')).length);
    const features=communityId?(await readTesterReport(q,communityId)).filter(item=>moduleId===undefined||item.module_id===moduleId):[];
    return {can_triage,features,modules:TESTER_MODULE_IDS.filter(id=>moduleId===undefined||id===moduleId).map(module_id=>{
      const selected=features.filter(item=>item.module_id===module_id),steps=selected.flatMap(item=>item.steps??[]);
      return {module_id,features:selected,passed:steps.reduce((sum,step)=>sum+step.passed,0),problems:steps.reduce((sum,step)=>sum+step.problems,0)};
    })};
  };
  if(actor)return readWithMemberSession(pool,actor,read);
  const q=await pool.connect();try{return await read(q);}finally{q.release();}
}
export async function mutateTesterAccount(pool: Pool, raw: Command) {
  const body = testerCommandSchema.parse(raw.body), input = {...raw,body};
  if (body.action !== 'merge') requireCondition(input.expected,428,'version_required','請先重新讀取測試紀錄。');
  return command(pool,input,async q => {
    await q.query('INSERT INTO tester_map_accounts(user_id) VALUES($1) ON CONFLICT DO NOTHING',[input.actor.user_id]);
    await q.query('SELECT user_id FROM tester_map_accounts WHERE user_id=$1 FOR UPDATE',[input.actor.user_id]);
  },async q => {
    const current = await readTesterAccount(q,input.actor.user_id);
    if (body.action !== 'merge') checkVersion(current.version,input.expected);
    requireCondition(Number(current.version)<Number.MAX_SAFE_INTEGER,409,'version_exhausted','測試紀錄暫時無法更新。');
    if (body.action === 'feedback') {
      await q.query(`INSERT INTO tester_map_feedback(user_id,step_id,result,note) VALUES($1,$2,$3,$4)
        ON CONFLICT(user_id,step_id) DO UPDATE SET result=excluded.result,note=excluded.note,updated_at=clock_timestamp(),
          status=CASE WHEN tester_map_feedback.result IS DISTINCT FROM excluded.result OR tester_map_feedback.note IS DISTINCT FROM excluded.note THEN CASE WHEN excluded.result='pass' AND tester_map_feedback.result IS DISTINCT FROM excluded.result AND tester_map_feedback.status IN ('issue','fixed') THEN tester_map_feedback.status ELSE 'sent' END ELSE tester_map_feedback.status END,
          triaged_at=CASE WHEN tester_map_feedback.result IS DISTINCT FROM excluded.result OR tester_map_feedback.note IS DISTINCT FROM excluded.note THEN CASE WHEN excluded.result='pass' AND tester_map_feedback.result IS DISTINCT FROM excluded.result AND tester_map_feedback.status IN ('issue','fixed') THEN tester_map_feedback.triaged_at ELSE NULL END ELSE tester_map_feedback.triaged_at END`,
      [input.actor.user_id,body.step_id,body.result,body.note]);
    } else {
      const next = body.action === 'clear' ? {group:null,done:[]} : body.action === 'merge'
        ? mergeTesterProgress(current.progress,body) : normalizeProgress({v:1,...body});
      await q.query('UPDATE tester_map_accounts SET group_id=$2,done=$3 WHERE user_id=$1',[input.actor.user_id,next.group,next.done]);
      if (body.action === 'clear') await q.query('DELETE FROM tester_map_feedback WHERE user_id=$1',[input.actor.user_id]);
    }
    await q.query('UPDATE tester_map_accounts SET aggregate_version=aggregate_version+1 WHERE user_id=$1',[input.actor.user_id]);
    // Receipts retain only an ACK: no feedback text or old personal record to replay after clearing.
    return {acknowledged:true};
  });
}

export async function triageTesterFeedback(pool: Pool, raw: Command) {
  const body=testerTriageSchema.parse(raw.body), input={...raw,body};
  return command(pool,input,async q=>{
    requireCondition((await activeDevelopmentGuilds(q,input.actor,'platform')).length>0,403,'tester_report_forbidden','Builder permission required.');
    const row=await q.query(`SELECT f.feedback_id FROM tester_map_feedback f JOIN users u USING(user_id)
      WHERE f.feedback_id=$1 AND u.community_id=$2 AND u.active AND f.step_id=ANY($3::text[]) FOR UPDATE OF f`,
      [body.feedback_id,input.actor.community_id,QUEST_STEP_IDS]);
    requireCondition(row.rowCount===1,404,'tester_feedback_not_found','Feedback unavailable.');
  },async q=>{
    // Authorization locks the feedback before receipt lookup; compare only for a new
    // effect so a successful immutable retry can still return its original ACK.
    const row=(await q.query(`SELECT ${testerFeedbackVersion} AS version FROM tester_map_feedback f WHERE feedback_id=$1 FOR UPDATE`,[body.feedback_id])).rows[0];
    requireCondition(row.version===body.version,409,'tester_feedback_conflict','回饋已更新，請重新讀取報告。');
    await q.query(`UPDATE tester_map_feedback SET status=$2,issue_number=$3,triaged_at=clock_timestamp() WHERE feedback_id=$1`,
      [body.feedback_id,body.status,body.status==='seen'?null:body.issue_number]);
    const version=(await q.query(`SELECT coalesce(max(aggregate_version),0)+1 AS version FROM transition_journal WHERE aggregate_type='tester_map_feedback' AND aggregate_id=$1`,[body.feedback_id])).rows[0].version;
    await journal(q,input.actor,'tester_map_feedback',body.feedback_id,version,input.operation,{status:body.status,issue_number:body.status==='seen'?null:body.issue_number});
    return {acknowledged:true};
  });
}
