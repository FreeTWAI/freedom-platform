import type {Pool} from 'pg';
import {z} from 'zod';
import {command,checkVersion,journal,type Command} from '../../packages/db/index.js';
import {adminCommand,audit,type AdminCommand,type AdminActor} from '../platform-admin/service.js';
import {requireCondition} from '../../packages/shared/problem.js';
import {normalizeShareUrl} from '../../packages/shared/share-url.js';
import {readEvent} from './events.js';
import {appendCredit,reverseCredit} from '../shares/credit.js';
export async function claimEventOrganizer(pool:Pool,input:Command,id:string){
 const body=z.object({statement:z.string().trim().min(10).max(1000),evidence_url:z.string().max(2048),declared:z.literal(true)}).strict().parse(input.body);
 const safe=normalizeShareUrl(body.evidence_url);requireCondition(safe.ok,422,'invalid_evidence','請提供安全的來源佐證網址。');
 return command(pool,input,async q=>{requireCondition(!input.actor.agent,403,'browser_required','請由本人提出認領。');const e=await readEvent(q,input.actor,id);requireCondition(e.imported&&e.state==='published',422,'imported_event_required','僅能認領匯入活動。');requireCondition(new URL(safe.url).hostname===e.source_host,422,'source_evidence_required','佐證須來自原活動網站。');},async q=>{
  const claim=(await q.query(`INSERT INTO community_event_organizer_claims(event_id,community_id,user_id,statement,evidence_url) VALUES($1,$2,$3,$4,$5)
   ON CONFLICT(event_id,user_id) DO UPDATE SET event_id=EXCLUDED.event_id RETURNING claim_id,state,version`,[id,input.actor.community_id,input.actor.user_id,body.statement,safe.url])).rows[0];
  await journal(q,input.actor,'event_organizer_claim',claim.claim_id,claim.version,'submit',{});return claim;
 });
}
export async function eventOrganizerClaims(pool:Pool,admin:AdminActor){return {items:(await pool.query('SELECT * FROM community_event_organizer_claims WHERE community_id=$1 ORDER BY created_at DESC LIMIT 100',[admin.community_id])).rows};}
export async function reviewEventOrganizer(pool:Pool,input:AdminCommand,id:string){
 const body=z.object({decision:z.enum(['verify','reject','revoke']),reason:z.string().trim().min(3).max(1000)}).strict().parse(input.body);
 return adminCommand(pool,input,async q=>{requireCondition((await q.query('SELECT 1 FROM community_event_organizer_claims WHERE claim_id=$1 AND community_id=$2',[id,input.admin.community_id])).rowCount,404,'not_found','找不到認領。');},async q=>{
  const prior=(await q.query('SELECT * FROM community_event_organizer_claims WHERE claim_id=$1 FOR UPDATE',[id])).rows[0];checkVersion(String(prior.version),input.expected);
  requireCondition(body.decision==='revoke'?prior.state==='verified':prior.state==='pending',409,'claim_resolved','認領狀態已變更。');
  const state=body.decision==='verify'?'verified':body.decision==='reject'?'rejected':'revoked';
  const claim=(await q.query('UPDATE community_event_organizer_claims SET state=$2,version=version+1 WHERE claim_id=$1 RETURNING *',[id,state])).rows[0];
  const share=(await q.query("SELECT * FROM shares WHERE kind='event' AND ref_id=$1 AND community_id=$2",[claim.event_id,claim.community_id])).rows[0];
  if(share&&state==='verified')await appendCredit(q,{community_id:claim.community_id,share_id:share.share_id,user_id:claim.user_id,role:'organizer',basis:'claim_verified',source_ref:`event-claim:${id}`,actor_user_id:claim.user_id});
  if(state==='revoked'){const rows=(await q.query("SELECT event_id FROM share_credit_events WHERE source_ref=$1 AND units=1",[`event-claim:${id}`])).rows;for(const row of rows)await reverseCredit(q,row.event_id);}
  await audit(q,input.admin,'event_organizer_claim','event_organizer_claim',id,body.reason,{state:prior.state},{state});return {claim_id:id,state,version:claim.version};
 });
}
