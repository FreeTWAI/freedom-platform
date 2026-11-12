import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Pool } from 'pg';
import { command,type Command } from '../../packages/db/index.js';
import { readWithMemberSession } from '../../packages/db/member-session.js';
import { requireCondition } from '../../packages/shared/problem.js';
import type { GitHubSocial } from '../github-social/service.js';
import { visibleShare } from './service.js';
import { appendCredit } from './credit.js';
export async function starShare(pool:Pool,input:Command,id:string,social:GitHubSocial) {
  const body=z.object({via:z.string().regex(/^[A-Za-z0-9_-]{10}$/).optional()}).strict().parse(input.body);
  const source=await readWithMemberSession(pool,input.actor,async q=>{
    const s=await visibleShare(q,input.actor,id);requireCondition(s.repo_id,422,'not_repository','這不是 GitHub 分享。');
    const repo=(await q.query('SELECT * FROM canonical_repositories WHERE repo_id=$1',[s.repo_id])).rows[0];
    const prior=(await q.query('SELECT response FROM command_receipts WHERE user_id=$1 AND operation=$2 AND idempotency_key=$3',[input.actor.user_id,input.operation,input.key])).rows[0];
    return {share:s,repo,prior};
  });
  // Validate key before an external effect. Provider PUT is also safe to retry after an uncertain outcome.
  requireCondition(/^[A-Za-z0-9_-]{8,128}$/.test(input.key),400,'idempotency_required','請提供有效的 Idempotency-Key。');
  if(!source.prior)await social.starRepository(input.actor,source.repo.full_name,source.repo.provider_repo_id,async(q,githubId,first)=>{
    const current=await visibleShare(q,input.actor,id,true);
    let user=current.first_sharer_user_id,role:'sharer'|'spreader'='sharer';
    if(body.via){const link=(await q.query("SELECT user_id FROM promotion_links WHERE code=$1 AND kind='share' AND target_key=$2 AND community_id=$3 AND revoked_at IS NULL",[body.via,id,input.actor.community_id])).rows[0];if(link){user=link.user_id;role='spreader';}}
    const owner=source.repo.facts?.owner_id;
    if(user&&first&&owner!==githubId){
      const credited=await appendCredit(q,{share_id:id,community_id:input.actor.community_id,user_id:user,role,basis:'star_confirmed',source_ref:`star:${source.repo.provider_repo_id}:${githubId}`,actor_user_id:input.actor.user_id});
      if(credited)await q.query('UPDATE skill_star_support SET via_share_id=$3,via_user_id=$4 WHERE github_user_id=$1 AND repository_key=$2 AND via_share_id IS NULL',[githubId,source.repo.full_name.toLowerCase(),id,user]);
    }
  });
  return command(pool,input,q=>visibleShare(q,input.actor,id),async()=>({share_id:id,starred:true,confirmed:true}));
}

export async function claimShareAuthor(pool:Pool,input:Command,id:string,social:GitHubSocial) {
  const body=z.object({statement:z.string().trim().min(10).max(1000)}).strict().parse(input.body);
  return command(pool,input,q=>visibleShare(q,input.actor,id),async q=>{
    const s=await visibleShare(q,input.actor,id);requireCondition(s.repo_id,422,'not_repository','這不是 GitHub 分享。');
    const repo=(await q.query('SELECT * FROM canonical_repositories WHERE repo_id=$1',[s.repo_id])).rows[0];
    // Uses the existing credential lifecycle and current admin/maintain check; no slug inference.
    const allowed=await social.repositoryManager(q,input.actor,repo.full_name,repo.provider_repo_id);
    await visibleShare(q,input.actor,id,true);
    const github=(await q.query('SELECT github_user_id,github_login FROM github_social_connections WHERE user_id=$1 AND community_id=$2 FOR SHARE',[input.actor.user_id,input.actor.community_id])).rows[0];
    requireCondition(github,409,'github_connect_required','請先連結 GitHub。');
    const prior=(await q.query("SELECT claim_id,state FROM repo_credit_claims WHERE repo_id=$1 AND user_id=$2 AND role='original_author' AND state IN ('pending','verified','disputed')",[s.repo_id,input.actor.user_id])).rows[0];
    if(prior)return prior;
    const claimId=randomUUID(),state=allowed?'verified':'pending';
    await q.query(`INSERT INTO repo_credit_claims(claim_id,community_id,repo_id,user_id,github_user_id,github_login,role,state,statement,source_snapshot)
      VALUES($1,$2,$3,$4,$5,$6,'original_author',$7,$8,$9)`,[claimId,input.actor.community_id,s.repo_id,input.actor.user_id,github.github_user_id,github.github_login,state,body.statement,JSON.stringify({provider:'github',provider_repo_id:repo.provider_repo_id,full_name:repo.full_name,verification:allowed?'repository_manager':'pending'})]);
    await q.query(`INSERT INTO repo_credit_claim_events(event_id,claim_id,community_id,actor_user_id,action,previous_state,new_state,reason)
      VALUES($1,$2,$3,$4,'submit',NULL,$5,$6)`,[randomUUID(),claimId,input.actor.community_id,input.actor.user_id,state,allowed?'GitHub repository admin/maintain verified':null]);
    if(allowed)await appendCredit(q,{share_id:id,community_id:input.actor.community_id,user_id:input.actor.user_id,role:'original_author',basis:'claim_verified',source_ref:`claim:${claimId}`});
    return {claim_id:claimId,state};
  });
}
