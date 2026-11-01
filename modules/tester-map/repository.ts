import type {PoolClient} from 'pg';
import type {TesterFeatureReport, TesterFeedback} from './account.js';
import {testerFeatureSteps} from './account.js';
import {normalizeProgress} from './progress.js';

export async function readTesterAccount(q: PoolClient, userId: string) {
  const row = (await q.query('SELECT group_id,done,aggregate_version FROM tester_map_accounts WHERE user_id=$1', [userId])).rows[0];
  const feedback = (await q.query<TesterFeedback>(`SELECT step_id,result,note,updated_at::text FROM tester_map_feedback WHERE user_id=$1 ORDER BY step_id`, [userId])).rows;
  return {version: String(row?.aggregate_version ?? 1), progress: normalizeProgress({v:1, group:row?.group_id, done:row?.done}), feedback};
}

/** Bounded projection: at most one row per known feature and five issue notes per row. */
export async function readTesterReport(q: PoolClient, communityId: string): Promise<TesterFeatureReport[]> {
  const result = await q.query(`WITH mapping AS (
    SELECT * FROM jsonb_to_recordset($2::jsonb) AS m(feature_id text,step_id text)
  ), feedback AS (
    SELECT m.feature_id,f.* FROM tester_map_feedback f JOIN users u USING(user_id)
    JOIN mapping m USING(step_id) WHERE u.community_id=$1 AND u.active
  ), testers AS (
    SELECT feature_id,user_id,bool_and(result='pass') AS passed FROM feedback GROUP BY feature_id,user_id
  ), totals AS (
    SELECT feature_id,count(*)::int AS testers,count(*) FILTER(WHERE passed)::int AS passed FROM testers GROUP BY feature_id
  ), problems AS (
    SELECT feature_id,step_id,note,updated_at,row_number() OVER(PARTITION BY feature_id ORDER BY updated_at DESC,step_id,user_id) AS n
    FROM feedback WHERE result='problem'
  ), issues AS (
    SELECT feature_id,jsonb_agg(jsonb_build_object('step_id',step_id,'note',note,'updated_at',updated_at) ORDER BY n) AS issues
    FROM problems WHERE n<=5 GROUP BY feature_id
  ) SELECT m.feature_id,coalesce(t.testers,0) AS testers,coalesce(t.passed,0) AS passed,
    CASE WHEN t.testers>0 THEN t.passed::float8/t.testers ELSE NULL END AS pass_rate,coalesce(i.issues,'[]'::jsonb) AS issues
    FROM (SELECT DISTINCT feature_id FROM mapping) m LEFT JOIN totals t USING(feature_id) LEFT JOIN issues i USING(feature_id)
    ORDER BY m.feature_id`, [communityId, JSON.stringify(testerFeatureSteps)]);
  return result.rows;
}
