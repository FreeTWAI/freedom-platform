import type {Pool} from 'pg';
import {command,checkVersion,type Command} from '../../packages/db/index.js';
import {readWithMemberSession} from '../../packages/db/member-session.js';
import {requireCondition} from '../../packages/shared/problem.js';
import type {Actor} from '../identity-membership/service.js';
import {activeDevelopmentGuilds} from '../development-access/guild-eligibility.js';
import {testerCommandSchema,mergeTesterProgress} from './account.js';
import {normalizeProgress} from './progress.js';
import {readTesterAccount,readTesterReport} from './repository.js';

export async function getTesterAccount(pool: Pool, actor: Actor) {
  return readWithMemberSession(pool, actor, async q => ({...await readTesterAccount(q,actor.user_id),
    can_report: (await activeDevelopmentGuilds(q,actor,'platform')).length > 0}));
}
export async function getTesterReport(pool: Pool, actor: Actor) {
  return readWithMemberSession(pool,actor,async q => {
    requireCondition((await activeDevelopmentGuilds(q,actor,'platform')).length > 0,403,'tester_report_forbidden','測試報告限目前具有平台開發公會正式會員資格的建造者。');
    return {features: await readTesterReport(q,actor.community_id)};
  });
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
        ON CONFLICT(user_id,step_id) DO UPDATE SET result=excluded.result,note=excluded.note,updated_at=clock_timestamp()`,
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
