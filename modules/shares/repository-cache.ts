import { saveRepositoryMetrics } from '../github-social/service.js';
import { createHash } from 'node:crypto';
import type { Pool,PoolClient } from 'pg';
import { z } from 'zod';
import { transaction } from '../../packages/db/index.js';
import { Problem,requireCondition } from '../../packages/shared/problem.js';
import { publicRepositoryJson,githubCoordinate } from '../opensource-marketing/github.js';
import { repositoryFacts } from './adapters/repository.js';
import { sanitizeReadme,readmeQuickStart } from './sanitize.js';
import type { AdapterContext,RepositoryFacts } from './types.js';
const releaseSchema=z.object({tag_name:z.string().max(200),name:z.string().max(300).nullable(),html_url:z.string().max(2048),published_at:z.string().nullable()});
async function readme(repository:RepositoryFacts,context:AdapterContext,etag?:string|null) {
  const fetcher=context.fetcher??fetch;
  // Fixed provider origin and validated coordinate. Redirects never receive credentials.
  const response=await fetcher(`https://api.github.com/repos/${githubCoordinate(repository.url)}/readme`,{redirect:'manual',signal:AbortSignal.timeout(8000),headers:{Accept:'application/vnd.github.html+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'Freedom-Platform-shares',...(context.token?{Authorization:`Bearer ${context.token}`}:{ }),...(etag?{'If-None-Match':etag}:{})}});
  if(response.status===304||response.status===404){await response.body?.cancel();return {status:response.status,html:'',etag:response.headers.get('etag')};}
  requireCondition(response.status===200&&!response.redirected&&response.type!=='opaqueredirect',503,'readme_unavailable','README 暫時無法更新。');
  const reader=response.body?.getReader();requireCondition(reader,503,'readme_unavailable','README 暫時無法更新。');let size=0;const parts:Uint8Array[]=[];
  try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;requireCondition(size<=1048576,503,'readme_too_large','README 過大。');parts.push(value);}}
  finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
  return {status:200,html:sanitizeReadme(Buffer.concat(parts).toString('utf8'),repository.full_name,repository.default_branch),etag:response.headers.get('etag')};
}
export async function refreshRepository(pool:Pool,repoId:string,context:AdapterContext={},force=false) {
  // A DB lease prevents each viewer/worker from issuing its own fetch. It also bounds failure retries.
  const prior=(await pool.query(`UPDATE canonical_repositories SET refresh_after=now()+interval '10 minutes'
    WHERE repo_id=$1 AND ($2 OR refresh_after<=now()) RETURNING *`,[repoId,force])).rows[0];if(!prior)return;
  try {
    const facts=await repositoryFacts(prior.current_url,context);
    requireCondition(facts.id===prior.provider_repo_id,422,'repository_identity_changed','原作身分已變更。');
    if(facts.metrics)await saveRepositoryMetrics(pool,facts.full_name.toLowerCase(),facts.metrics);
    const html=await readme(facts,context,prior.etag);
    const rawRelease=await publicRepositoryJson(`/repos/${facts.full_name}/releases/latest`,AbortSignal.timeout(8000),context.fetcher??fetch,true,196608,context.token);
    const release=rawRelease===null?null:releaseSchema.parse(rawRelease);
    if(release){const target=new URL(release.html_url);requireCondition(target.origin==='https://github.com'&&target.pathname.startsWith(`/${facts.full_name}/releases/`),503,'release_invalid','版本資料不完整。');}
    await pool.query(`UPDATE canonical_repositories SET full_name=$2,current_url=$3,description=$4,topics=$5,homepage=$6,license_spdx=$7,
      readme_html=$8,readme_sha=$9,latest_release=$10,etag=$11,facts=$12,fetched_at=now(),observed_at=now(),fetch_state='ready',refresh_after=now()+interval '24 hours' WHERE repo_id=$1`,[repoId,facts.full_name,facts.url,facts.description,facts.topics,facts.homepage,facts.license_spdx,html.status===304?prior.readme_html:html.html,html.status===304?prior.readme_sha:createHash('sha256').update(html.html).digest('hex'),release?JSON.stringify(release):null,html.status===304?prior.etag:html.etag,JSON.stringify(facts)]);
  }catch(error){
    const unavailable=error instanceof Problem&&['github_repository_unavailable','repository_identity_changed'].includes(error.code);
    await transaction(pool,async q=>{
      await q.query("UPDATE canonical_repositories SET fetch_state=$2,refresh_after=now()+interval '1 hour' WHERE repo_id=$1",[repoId,unavailable?'unavailable':'error']);
      if(unavailable)await q.query("UPDATE shares SET state='hidden' WHERE repo_id=$1 AND state='published'",[repoId]);
    });
    if(force&&!unavailable)throw error;
  }
}
export async function refreshDueRepositories(pool:Pool,context:AdapterContext={},limit=20) {
  const rows=(await pool.query(`SELECT repo_id FROM canonical_repositories WHERE refresh_after<=now()
    AND EXISTS(SELECT 1 FROM shares WHERE shares.repo_id=canonical_repositories.repo_id AND state='published') ORDER BY fetched_at NULLS FIRST,repo_id LIMIT $1`,[Math.min(Math.max(limit,1),50)])).rows;
  for(const row of rows)await refreshRepository(pool,row.repo_id,context);
  return rows.length;
}
export async function repositoryPage(q:PoolClient,repoId:string) {
  const row=(await q.query('SELECT * FROM canonical_repositories WHERE repo_id=$1',[repoId])).rows[0];
  requireCondition(row&&row.fetch_state!=='unavailable',404,'not_found','原作已不公開。');
  const f=row.facts as RepositoryFacts;
  const metrics=(await q.query('SELECT snapshot,checked_at FROM github_repository_metrics WHERE repository_key=$1',[row.full_name.toLowerCase()])).rows[0];
  const currentMetrics=metrics?.snapshot?.repository_identity?.id===row.provider_repo_id&&(!row.fetched_at||new Date(metrics.checked_at)>=new Date(row.fetched_at));
  return {full_name:row.full_name,url:row.current_url,description:row.description,topics:row.topics,license_spdx:row.license_spdx,readme_html:row.readme_html??'',quick_start:readmeQuickStart(row.readme_html??'',row.full_name),latest_release:row.latest_release,stars:currentMetrics?metrics.snapshot.stargazers_count:f.stars??null,original_author:f.owner_login??row.full_name.split('/')[0],fetched_at:row.fetched_at,fetch_state:row.fetch_state,stale:!row.fetched_at||Date.now()-new Date(row.fetched_at).getTime()>86400000};
}
