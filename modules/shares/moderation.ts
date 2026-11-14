import {z} from 'zod';
import type {Pool,PoolClient} from 'pg';
import {adminCommand,audit,type AdminCommand,type AdminActor} from '../platform-admin/service.js';
import {requireCondition} from '../../packages/shared/problem.js';
import {reverseCredit} from './credit.js';

/** A decision queue, not a report/user export. Titles are the published share snapshot. */
export async function listHeldShares(pool:Pool,admin:AdminActor) {
  return (await pool.query(`SELECT s.share_id,s.kind,s.title,
    CASE WHEN s.kind IN ('repository','link') THEN s.canonical_url
      WHEN s.kind='event' AND e.visibility IN ('open','referral') THEN '/events/'||e.event_id
      WHEN s.kind='service' THEN '/services/'||s.ref_id
      WHEN s.kind='post' AND EXISTS(SELECT 1 FROM community_social_publications p WHERE p.post_id=s.ref_id AND p.enabled) THEN '/posts/'||s.ref_id
      ELSE NULL END AS public_url,
    reports.open_reports,reports.reasons,
    -- The schema retains report times, not a separate state-transition timestamp.
    -- The third eligible report is the threshold that caused this hold.
    (SELECT r.created_at FROM share_reports r WHERE r.share_id=s.share_id
      AND r.eligible AND r.dismissed_at IS NULL AND r.confirmed_at IS NULL
      AND NOT is_verification_test_account(r.user_id)
      AND NOT EXISTS(SELECT 1 FROM share_endorsements x WHERE x.share_id=s.share_id AND x.user_id=r.user_id AND x.withdrawn_at IS NULL)
      ORDER BY r.created_at,r.user_id OFFSET 2 LIMIT 1) AS hidden_at
    FROM shares s
    LEFT JOIN community_events e ON s.kind='event' AND e.event_id=s.ref_id AND e.community_id=s.community_id
    CROSS JOIN LATERAL (SELECT count(*)::int AS open_reports,
      (array_agg(r.reason ORDER BY r.created_at,r.user_id))[1:3] AS reasons
      FROM share_reports r WHERE r.share_id=s.share_id AND r.dismissed_at IS NULL AND r.confirmed_at IS NULL) reports
    WHERE s.community_id=$1 AND s.state='hidden' AND s.reports_confirmed_at IS NULL
      AND reports.open_reports>0 AND NOT is_verification_test_account(s.first_sharer_user_id)
      AND (e.event_id IS NULL OR NOT is_verification_test_account(e.organizer_ref))
    ORDER BY hidden_at ASC NULLS LAST,s.share_id LIMIT 100`,[admin.community_id])).rows;
}

/** Existing verified platform-admin authority and receipts; never a member/agent command. */
export async function moderateShare(pool:Pool,input:AdminCommand,id:string,decision:'restore'|'confirm') {
  z.uuid().parse(id);
  const body=z.object({reason:z.string().trim().min(3).max(1000)}).strict().parse(input.body);
  const scoped=async(q:PoolClient)=>{
    await q.query("SELECT e.event_id FROM community_events e JOIN shares s ON s.ref_id=e.event_id AND s.kind='event' WHERE s.share_id=$1 AND s.community_id=$2 FOR UPDATE OF e",[id,input.admin.community_id]);
    const share=(await q.query('SELECT * FROM shares WHERE share_id=$1 AND community_id=$2 FOR UPDATE',[id,input.admin.community_id])).rows[0];
    requireCondition(share,404,'not_found','找不到分享。');return share;
  };
  return adminCommand(pool,input,scoped,async q=>{
    const before=await scoped(q);
    if(decision==='restore'){
      await q.query('UPDATE share_reports SET dismissed_at=coalesce(dismissed_at,now()) WHERE share_id=$1',[id]);
      // A restored share with no remaining endorsement is still personally retracted.
      await q.query(`UPDATE shares SET state=CASE WHEN EXISTS(SELECT 1 FROM share_endorsements WHERE share_id=$1 AND withdrawn_at IS NULL)
        THEN 'published' ELSE 'retracted' END,reports_confirmed_at=NULL WHERE share_id=$1`,[id]);
    }else{
      requireCondition(before.state==='hidden',409,'share_not_hidden','分享尚未暫停公開。');
      requireCondition((await q.query('SELECT 1 FROM share_reports WHERE share_id=$1 AND dismissed_at IS NULL',[id])).rowCount,409,'share_reports_required','沒有待確認的檢舉。');
      await q.query('UPDATE shares SET reports_confirmed_at=coalesce(reports_confirmed_at,now()) WHERE share_id=$1',[id]);
      await q.query('UPDATE share_reports SET confirmed_at=coalesce(confirmed_at,now()) WHERE share_id=$1 AND dismissed_at IS NULL',[id]);
      const facts=(await q.query('SELECT event_id FROM share_credit_events WHERE share_id=$1 AND units=1',[id])).rows;
      for(const fact of facts)await reverseCredit(q,fact.event_id);
    }
    const after=await scoped(q);
    await audit(q,input.admin,`share_${decision}`,'share',id,body.reason,{state:before.state,reports_confirmed_at:before.reports_confirmed_at},{state:after.state,reports_confirmed_at:after.reports_confirmed_at});
    return {share_id:id,state:after.state};
  });
}
