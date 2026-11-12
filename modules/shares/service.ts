import {requireSharePublicationQuota} from './publication-quota.js';
import {createEvent} from '../community/events.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Pool, PoolClient } from 'pg';
import { command, journal, type Command } from '../../packages/db/index.js';
import { memberReceiptOperation } from '../../packages/db/member-command.js';
import { readWithMemberSession } from '../../packages/db/member-session.js';
import { requireCondition } from '../../packages/shared/problem.js';
import { authRateLimit } from '../identity-membership/members.js';
import type { Actor } from '../identity-membership/service.js';
import { shareAdapter } from './adapters/registry.js';
import { existingTitle } from './adapters/existing.js';
import { appendCredit } from './credit.js';
import type { AdapterContext, PreparedShare, ShareRow } from './types.js';
export const shareInput=z.object({kind:z.enum(['repository','link','event','work','post','service']).optional(),url:z.string().trim().max(2048).optional(),ref_id:z.uuid().optional(),text:z.string().trim().max(500).optional(),guild_key:z.string().max(100).optional(),event:z.record(z.string(),z.unknown()).optional()}).strict();
async function lockEventSource(q:PoolClient,actor:Actor,id:string){
 await q.query(`SELECT e.event_id FROM community_events e JOIN shares s ON s.ref_id=e.event_id AND s.kind='event' WHERE s.share_id=$1 AND s.community_id=$2 FOR UPDATE OF e`,[id,actor.community_id]);
}
export async function readShare(q:PoolClient,actor:Actor,id:string,lock=false):Promise<ShareRow> {
  const s=(await q.query<ShareRow>(`SELECT * FROM shares WHERE share_id=$1 AND community_id=$2 AND ($3::uuid IS NULL OR first_sharer_user_id=$3) ${lock?'FOR UPDATE':''}`,[id,actor.community_id,actor.agent?actor.user_id:null])).rows[0];
  requireCondition(s,404,'not_found','找不到分享。');
  if(s.ref_id)requireCondition(await existingTitle(q,actor,s.kind,s.ref_id),404,'not_found','找不到分享。');
  return s;
}
export async function visibleShare(q:PoolClient,actor:Actor,id:string,lock=false) {
  const s=await readShare(q,actor,id,lock);requireCondition(s.state==='published',404,'not_found','分享已停止公開。');return s;
}
async function prepare(pool:Pool,input:Command,context:AdapterContext) {
  const body=shareInput.parse(input.body),adapter=shareAdapter(body);
  await readWithMemberSession(pool,input.actor,async()=>{});
  await authRateLimit(pool,'share-preview-member',input.actor.user_id,120,3600);
  const prepared=await adapter.prepare(body,context);
  if(adapter.authorize)await readWithMemberSession(pool,input.actor,q=>adapter.authorize!(q,input.actor,prepared));
  return prepared;
}
export async function previewShare(pool:Pool,input:Command,context:AdapterContext={}) {
  const p=await prepare(pool,input,context);
  return {kind:p.kind,title:p.title,url:p.canonical_url,description:p.repository?.description??'',original_author:p.repository?.owner_login??null,...(p.event?{event:p.event}:{})};
}
async function saveRepository(q:PoolClient,p:PreparedShare) {
  if(!p.repository)return null;
  const r=p.repository;
  return (await q.query(`INSERT INTO canonical_repositories(repo_id,provider,provider_repo_id,full_name,current_url,facts,description,topics,homepage,license_spdx)
    VALUES($1,'github',$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(provider,provider_repo_id) DO UPDATE SET full_name=EXCLUDED.full_name,current_url=EXCLUDED.current_url,observed_at=now()
    RETURNING repo_id`,[randomUUID(),r.id,r.full_name,r.url,JSON.stringify(r),r.description,r.topics,r.homepage,r.license_spdx])).rows[0].repo_id as string;
}
export async function createShare(pool:Pool,input:Command,context:AdapterContext={}) {
  const body=shareInput.parse(input.body);
  if(body.kind==='event'&&body.event){const e=await createEvent(pool,input,{...body.event,...(body.url?{source_url:body.url}:{})});return {...(input.actor.agent?{via_agent:true}:{}),share_id:e.share_id,created:true,url:`/events/${e.event_id}`};}
  requireCondition(body.kind!=='event'||body.ref_id,422,'event_details_required','請確認活動名稱、時間和地點。');
  // A completed retry never depends on upstream availability. command still validates the digest and current authority.
  const receipt=async(q:PoolClient)=>(await q.query('SELECT response FROM command_receipts WHERE user_id=$1 AND operation=$2 AND idempotency_key=$3',[input.actor.user_id,memberReceiptOperation(input),input.key])).rows[0]?.response as {share_id:string}|undefined;
  const prior=await readWithMemberSession(pool,input.actor,receipt);
  const p=prior?null:await prepare(pool,input,context);
  requireCondition(!p?.event,422,'event_details_required','請確認活動名稱、時間和地點。');
  return command(pool,input,async q=>{
    const current=await receipt(q);
    if(current)await readShare(q,input.actor,current.share_id,true);
    if(p)await shareAdapter(body).authorize?.(q,input.actor,p);
    if(body.guild_key)requireCondition((await q.query('SELECT 1 FROM positioning_guild_catalog WHERE guild_key=$1',[body.guild_key])).rowCount,422,'guild_not_found','找不到公會。');
  },async q=>{
    requireCondition(p,409,'share_retry_required','請重新載入。');
    await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`share/member/${input.actor.user_id}`]);
    await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`share/${input.actor.community_id}/${p.kind}/${p.canonical_key}`]);
    let s=(await q.query<ShareRow>('SELECT * FROM shares WHERE community_id=$1 AND kind=$2 AND canonical_key=$3 FOR UPDATE',[input.actor.community_id,p.kind,p.canonical_key])).rows[0];
    const created=!s;
    if(!s){
      await requireSharePublicationQuota(q,input.actor.user_id);
      const repoId=await saveRepository(q,p);
      s=(await q.query<ShareRow>(`INSERT INTO shares(community_id,kind,canonical_key,canonical_url,repo_id,ref_table,ref_id,title,first_sharer_user_id,guild_key,editor_notes)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[input.actor.community_id,p.kind,p.canonical_key,p.canonical_url,repoId,p.ref_table??null,p.ref_id??null,p.title,input.actor.user_id,body.guild_key??null,JSON.stringify(body.text?{intro:body.text}:{})])).rows[0];
    }
    requireCondition(!input.actor.agent||s.first_sharer_user_id===input.actor.user_id,404,'not_found','找不到分享。');
    requireCondition(s.state==='published',409,'share_unavailable','這份分享已停止公開。');
    await appendCredit(q,{share_id:s.share_id,community_id:s.community_id,user_id:input.actor.user_id,role:created?'sharer':'co_sharer',basis:created?'created':'shared_again',source_ref:`share:${s.share_id}:${input.actor.user_id}`,actor_user_id:input.actor.user_id});
    if(created)await journal(q,input.actor,'share',s.share_id,1,'publish',{kind:s.kind});
    return {share_id:s.share_id,created,url:`/#shares/${s.share_id}`};
  });
}
export async function retractShare(pool:Pool,input:Command,id:string) {
  z.object({}).strict().parse(input.body);
  return command(pool,input,async q=>{await lockEventSource(q,input.actor,id);const s=await readShare(q,input.actor,id,true);requireCondition(s.first_sharer_user_id===input.actor.user_id,403,'share_owner_required','只能撤回自己的分享。');},async q=>{
    await q.query("UPDATE shares SET state='retracted' WHERE share_id=$1 AND state<>'retracted'",[id]);
    return {share_id:id,state:'retracted' as const};
  });
}
export async function reportShare(pool:Pool,input:Command,id:string) {
  const body=z.object({reason:z.string().trim().min(1).max(500)}).strict().parse(input.body);
  return command(pool,input,async q=>{await lockEventSource(q,input.actor,id);const s=await readShare(q,input.actor,id,true);requireCondition(s.first_sharer_user_id!==input.actor.user_id,422,'self_report','不能檢舉自己的分享。');},async q=>{
    const test=(await q.query('SELECT is_verification_test_account($1) AS test',[input.actor.user_id])).rows[0].test;
    requireCondition(!test,403,'test_report','測試帳號不計入檢舉。');
    await q.query('INSERT INTO share_reports(share_id,user_id,reason) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[id,input.actor.user_id,body.reason]);
    await q.query("UPDATE shares SET state='hidden' WHERE share_id=$1 AND state='published' AND (SELECT count(*) FROM share_reports WHERE share_id=$1)>=3",[id]);
    return {recorded:true};
  });
}
export async function shareLink(pool:Pool,input:Command,id:string) {
  z.object({}).strict().parse(input.body);
  return command(pool,input,q=>visibleShare(q,input.actor,id,true),async q=>{
    // Restricted domain objects use their original sharing surface, not a public share projection.
    const s=await visibleShare(q,input.actor,id);requireCondition(['repository','link'].includes(s.kind),422,'use_original_share','請使用原頁面的分享。');
    const row=(await q.query(`INSERT INTO promotion_links(community_id,user_id,kind,target_key,code) VALUES($1,$2,'share',$3,$4)
      ON CONFLICT(community_id,user_id,kind,target_key) WHERE revoked_at IS NULL DO UPDATE SET target_key=EXCLUDED.target_key RETURNING code`,[input.actor.community_id,input.actor.user_id,id,randomBytes(7).toString('base64url')])).rows[0];
    return {path:`/go/${row.code}`,code:row.code};
  });
}
export async function listShares(q:PoolClient,actor:Actor,raw:unknown) {
  const query=z.object({limit:z.coerce.number().int().min(1).max(50).default(20),offset:z.coerce.number().int().min(0).max(10000).default(0)}).strict().parse(raw);
  const rows=(await q.query<ShareRow>(`SELECT * FROM shares WHERE community_id=$1 AND state='published' AND ($4::uuid IS NULL OR first_sharer_user_id=$4) AND (first_sharer_user_id IS NULL OR NOT is_verification_test_account(first_sharer_user_id)) ORDER BY created_at DESC,share_id LIMIT $2 OFFSET $3`,[actor.community_id,query.limit,query.offset,actor.agent?actor.user_id:null])).rows;
  const items=[];
  for(const s of rows){if(!s.ref_id||await existingTitle(q,actor,s.kind,s.ref_id))items.push({share_id:s.share_id,kind:s.kind,title:s.title,url:`/#shares/${s.share_id}`});}
  return {items,next_offset:rows.length===query.limit?query.offset+query.limit:null};
}
export async function myCredit(q:PoolClient,actor:Actor,raw:unknown={}) {
  const query=z.object({offset:z.coerce.number().int().min(0).max(10000).default(0)}).strict().parse(raw);
  const rows=(await q.query(`SELECT s.share_id,s.title,s.kind,s.state,s.ref_id,e.role,e.basis,sum(e.units)::int AS count
    FROM share_credit_events e JOIN shares s USING(share_id,community_id)
    WHERE e.community_id=$1 AND e.user_id=$2 GROUP BY s.share_id,e.role,e.basis ORDER BY s.share_id,e.role,e.basis LIMIT 100 OFFSET $3`,[actor.community_id,actor.user_id,query.offset])).rows;
  for(const s of rows)if(s.ref_id&&!await existingTitle(q,actor,s.kind,s.ref_id)){s.title='已停止分享';s.count=0;} 
  return {items:rows.map(({ref_id:_,...row})=>row),next_offset:rows.length===100?query.offset+100:null};
}
