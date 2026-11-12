import {z} from 'zod';
import type {Pool,PoolClient} from 'pg';
import {adminCommand,audit,type AdminCommand} from '../platform-admin/service.js';
import {requireCondition} from '../../packages/shared/problem.js';
import {reverseCredit} from './credit.js';

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
