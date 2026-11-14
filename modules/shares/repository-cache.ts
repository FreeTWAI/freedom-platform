import { saveRepositoryMetrics } from '../github-social/service.js';
import { createHash } from 'node:crypto';
import type { Pool,PoolClient } from 'pg';
import { z } from 'zod';
import { transaction } from '../../packages/db/index.js';
import { Problem,requireCondition } from '../../packages/shared/problem.js';
import { concealedRepository, githubCoordinate, publicRepositoryJson } from '../opensource-marketing/github.js';
import { repositoryRedirectReader,shareRepositoryJson } from './github.js';
import { repositoryFacts } from './adapters/repository.js';
import { sanitizeReadme,readmeQuickStart } from './sanitize.js';
import type { AdapterContext,RepositoryFacts } from './types.js';
const releaseSchema=z.object({tag_name:z.string().max(200),name:z.string().max(300).nullable(),html_url:z.string().max(2048),published_at:z.string().nullable()});
export type BookReleaseSummary={tag_name:string;name:string|null;html_url:string;published_at:string|null};
export type BookOriginalCache={
  repository_id?:string|null;
  social_metrics?:{forks_count:number|null;open_issues_count:number|null;subscribers_count:number|null;pushed_at:string|null};
  full_name:string|null;
  url:string|null;
  original_author:string|null;
  description:string|null;
  topics:string[];
  license_spdx:string|null;
  default_branch:string|null;
  stars:number|null;
  readme_html:string|null;
  quick_start:string|null;
  latest_release:BookReleaseSummary|null;
  head_sha:string|null;
  ahead_of_pin:boolean;
  latest_version_url:string|null;
  latest_version_label:string|null;
  fetched_at:string|null;
  fetch_state:string|null;
  stale:boolean;
};
export type BookOriginalCacheSummary=Omit<BookOriginalCache,'readme_html'>;
export type BookOriginalLookupInput={id:string;repository_url:string;upstream_url?:string;source_commit?:string;reviewed_at?:string;description?:string};
export const PUBLIC_BOOK_CACHE_SQL=`WITH requested AS (
  SELECT * FROM unnest($1::text[], $2::text[]) AS b(book_id, full_name)
), bindings AS (
  SELECT o.book_id, o.provider_repo_id, o.requested_full_name, o.needs_recheck
  FROM catalog_repo_observations o JOIN requested b USING(book_id) WHERE o.provider='github'
  UNION
  SELECT b.book_id, cr.provider_repo_id, b.full_name, false
  FROM requested b JOIN shares s ON s.legacy_ref @> jsonb_build_array(jsonb_build_object('kind','book','id',b.book_id))
  JOIN canonical_repositories cr ON cr.repo_id=s.repo_id AND cr.provider='github'
  WHERE NOT EXISTS (SELECT 1 FROM catalog_repo_observations o WHERE o.book_id=b.book_id)
)
SELECT cr.repo_id, cr.provider_repo_id, cr.full_name, cr.current_url, cr.description, cr.topics,
  cr.license_spdx, cr.readme_html, cr.latest_release, cr.facts, cr.fetched_at, cr.fetch_state,
  b.book_id AS observed_book_id, b.requested_full_name AS observed_requested_full_name,
  b.provider_repo_id AS established_provider_repo_id, b.needs_recheck AS observed_needs_recheck,
  m.snapshot AS metric_snapshot, m.checked_at AS metric_checked_at
FROM bindings b
LEFT JOIN canonical_repositories cr ON cr.provider='github' AND cr.provider_repo_id=b.provider_repo_id
LEFT JOIN github_repository_metrics m ON m.repository_key=lower(cr.full_name)`;
export const PUBLIC_BOOK_SUMMARY_SQL=PUBLIC_BOOK_CACHE_SQL.replace('cr.readme_html, ','');
export const PUBLIC_BOOK_METRICS_SQL=`SELECT repository_key, snapshot, checked_at FROM github_repository_metrics WHERE repository_key = ANY($1::text[])`;
function githubCoordinateOrNull(url:string|null|undefined):string|null{
  if(!url)return null;
  try{return githubCoordinate(url).toLowerCase();}catch{return null;}
}
function validCommitSha(value:unknown):string|null{
  return typeof value==='string'&&/^[0-9a-f]{40}$/i.test(value)?value.toLowerCase():null;
}
async function defaultBranchHeadSha(facts:RepositoryFacts,context:AdapterContext):Promise<string|null>{
  if(!facts.default_branch)return null;
  try{
    const raw=await publicRepositoryJson(`/repos/${facts.full_name}/commits/${encodeURIComponent(facts.default_branch)}`,AbortSignal.timeout(8000),context.fetcher??fetch,true,196608,context.token);
    if(!raw||typeof raw!=='object')return null;
    const record=raw as Record<string,unknown>;
    // Test fixtures may echo repository JSON on unmatched endpoints; ignore non-commit payloads.
    if(typeof record.full_name==='string')return null;
    return validCommitSha(record.sha);
  }catch{return null;}
}
async function readme(repository:RepositoryFacts,context:AdapterContext,etag?:string|null) {
  const fetcher=context.fetcher??fetch;
  const path=`/repos/${githubCoordinate(repository.url)}/readme`;
  const response=await repositoryRedirectReader(path,fetcher).read(`https://api.github.com${path}`,{redirect:'manual',signal:AbortSignal.timeout(8000),headers:{Accept:'application/vnd.github.html+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'Freedom-Platform-shares',...(context.token?{Authorization:`Bearer ${context.token}`}:{ }),...(etag?{'If-None-Match':etag}:{})}});
  if(response.status===304||response.status===404){await response.body?.cancel();return {status:response.status,html:'',etag:response.headers.get('etag')};}
  requireCondition(response.status===200&&!response.redirected&&response.type!=='opaqueredirect',503,'readme_unavailable','README 暫時無法更新。');
  const reader=response.body?.getReader();requireCondition(reader,503,'readme_unavailable','README 暫時無法更新。');let size=0;const parts:Uint8Array[]=[];
  try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;requireCondition(size<=1048576,503,'readme_too_large','README 過大。');parts.push(value);}}
  finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
  return {status:200,html:sanitizeReadme(Buffer.concat(parts).toString('utf8'),repository.full_name,repository.default_branch),etag:response.headers.get('etag')};
}
const locationShape=z.object({id:z.number().int().positive().safe(),full_name:z.string()});
export async function currentRepositoryLocation(providerRepoId:string,context:AdapterContext={}):Promise<{kind:'current';url:string}|{kind:'unavailable'}|{kind:'unknown'}>{
  let raw:unknown;
  try{
    raw=await publicRepositoryJson('/repositories/'+providerRepoId,AbortSignal.timeout(8000),context.fetcher??fetch,false,196608,context.token);
  }catch(error){
    if(error instanceof Problem&&error.code==='github_repository_unavailable')return {kind:'unavailable'};
    return {kind:'unknown'};
  }
  const parsed=locationShape.safeParse(raw);
  if(!parsed.success)return concealedRepository(raw)?{kind:'unavailable'}:{kind:'unknown'};
  if(String(parsed.data.id)!==providerRepoId||concealedRepository(raw))return {kind:'unavailable'};
  try{
    return {kind:'current',url:`https://github.com/${githubCoordinate(`https://github.com/${parsed.data.full_name}`)}`};
  }catch{
    return {kind:'unknown'};
  }
}
export async function refreshRepository(pool:Pool,repoId:string,context:AdapterContext={},force=false,preparedFacts?:RepositoryFacts) {
  // A DB lease prevents each viewer/worker from issuing its own fetch. It also bounds failure retries.
  const prior=(await pool.query(`UPDATE canonical_repositories SET refresh_after=now()+interval '10 minutes'
    WHERE repo_id=$1 AND ($2 OR refresh_after<=now()) RETURNING *`,[repoId,force])).rows[0];if(!prior)return;
  try {
    // A concurrent idempotent replay may return another request's share.
    // Never treat its unrelated prepared facts as proof that this repo vanished.
    let facts=preparedFacts?.id===prior.provider_repo_id?preparedFacts:undefined;
    if(!facts){
      const location=await currentRepositoryLocation(prior.provider_repo_id,context);
      if(location.kind==='unavailable')throw new Problem(422,'github_repository_unavailable','原作已不公開。');
      if(location.kind==='unknown')throw new Problem(503,'github_unavailable','暫時無法讀取 GitHub。');
      facts=await repositoryFacts(location.url,context);
    }
    requireCondition(facts.id===prior.provider_repo_id,422,'repository_identity_changed','原作身分已變更。');
    if(facts.metrics)await saveRepositoryMetrics(pool,facts.full_name.toLowerCase(),facts.metrics);
    const html=await readme(facts,context,prior.etag);
    const rawRelease=await shareRepositoryJson(`/repos/${facts.full_name}/releases/latest`,AbortSignal.timeout(8000),context.fetcher??fetch,true,196608,context.token);
    const release=rawRelease===null?null:releaseSchema.parse(rawRelease);
    if(release){const target=new URL(release.html_url);requireCondition(target.origin==='https://github.com'&&target.pathname.startsWith(`/${facts.full_name}/releases/`),503,'release_invalid','版本資料不完整。');}
    const headSha=await defaultBranchHeadSha(facts,context);
    const cachedHtml=html.status===304?(prior.readme_html??''):html.html;
    const oldQuickStart=prior.facts?.quick_start;
    const quickStart=html.status===304&&prior.facts?.full_name===facts.full_name&&typeof oldQuickStart==='string'?oldQuickStart:readmeQuickStart(cachedHtml,facts.full_name);
    const storedFacts:RepositoryFacts&{quick_start:string}={...facts,...(headSha?{head_sha:headSha}:{}),quick_start:quickStart};
    await pool.query(`UPDATE canonical_repositories SET full_name=$2,current_url=$3,description=$4,topics=$5,homepage=$6,license_spdx=$7,
      readme_html=$8,readme_sha=$9,latest_release=$10,etag=$11,facts=$12,fetched_at=now(),observed_at=now(),fetch_state='ready',refresh_after=now()+interval '24 hours' WHERE repo_id=$1`,[repoId,facts.full_name,facts.url,facts.description,facts.topics,facts.homepage,facts.license_spdx,html.status===304?prior.readme_html:html.html,html.status===304?prior.readme_sha:createHash('sha256').update(html.html).digest('hex'),release?JSON.stringify(release):null,html.status===304?prior.etag:html.etag,JSON.stringify(storedFacts)]);
    await pool.query("UPDATE shares SET title=$2,canonical_url=$3 WHERE repo_id=$1",[repoId,facts.full_name,facts.url]);
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
  // Old catalog-only caches may never have a published share to trigger a refresh.
  // Upgrade a small amount of existing cached HTML in the background, never on a list read.
  const legacy=(await pool.query(`SELECT repo_id,full_name,readme_html FROM canonical_repositories
    WHERE fetch_state<>'unavailable' AND readme_html IS NOT NULL AND jsonb_typeof(facts)='object' AND facts->>'quick_start' IS NULL
      AND octet_length(readme_html)<=8388608 ORDER BY repo_id LIMIT 2`)).rows;
  for(const row of legacy)await pool.query(`UPDATE canonical_repositories SET facts=jsonb_set(facts,'{quick_start}',to_jsonb($2::text),true)
    WHERE repo_id=$1 AND full_name=$3 AND readme_html=$4 AND fetch_state<>'unavailable' AND jsonb_typeof(facts)='object' AND facts->>'quick_start' IS NULL`,
    [row.repo_id,readmeQuickStart(row.readme_html,row.full_name),row.full_name,row.readme_html]);
  return rows.length;
}
export async function repositoryPage(q:PoolClient,repoId:string) {
  const row=(await q.query('SELECT * FROM canonical_repositories WHERE repo_id=$1',[repoId])).rows[0];
  requireCondition(row&&row.fetch_state!=='unavailable',404,'not_found','原作已不公開。');
  const f=(row.facts??{}) as Partial<RepositoryFacts>&{quick_start?:unknown};
  const metrics=(await q.query('SELECT snapshot,checked_at FROM github_repository_metrics WHERE repository_key=$1',[row.full_name.toLowerCase()])).rows[0];
  const currentMetrics=metrics?.snapshot?.repository_identity?.id===row.provider_repo_id&&(!row.fetched_at||new Date(metrics.checked_at)>=new Date(row.fetched_at));
  const social=currentMetrics?metrics.snapshot:f.metrics;
  const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
  let homepage:string|null=null;
  try{const url=new URL(row.homepage);if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)homepage=url.href;}catch{}
  return {full_name:row.full_name,url:row.current_url,description:row.description,topics:Array.isArray(row.topics)?row.topics.slice(0,5):[],license_spdx:row.license_spdx,homepage,
    forks_count:count(social?.forks_count),open_issues_count:count(social?.open_issues_count),subscribers_count:count(social?.subscribers_count),
    pushed_at:typeof social?.pushed_at==='string'&&!Number.isNaN(Date.parse(social.pushed_at))?social.pushed_at:null,
    readme_html:row.readme_html??'',quick_start:typeof f.quick_start==='string'?f.quick_start:`git clone https://github.com/${row.full_name}.git`,latest_release:row.latest_release,stars:currentMetrics?metrics.snapshot.stargazers_count:f.stars??null,original_author:f.owner_login??row.full_name.split('/')[0],fetched_at:row.fetched_at,fetch_state:row.fetch_state,stale:!row.fetched_at||Date.now()-new Date(row.fetched_at).getTime()>86400000};
}
type CachedRepoRow={
  provider_repo_id:string;
  established_provider_repo_id:string;
  observed_needs_recheck:boolean;
  full_name:string;
  current_url:string;
  description:string|null;
  topics:string[]|null;
  license_spdx:string|null;
  readme_html:string|null;
  latest_release:BookReleaseSummary|null;
  facts:(Partial<RepositoryFacts>&{quick_start?:unknown})|null;
  fetched_at:Date|string|null;
  fetch_state:string|null;
  observed_book_id:string|null;
  observed_requested_full_name:string|null;
  metric_snapshot:{stargazers_count?:number;forks_count?:number;open_issues_count?:number;subscribers_count?:number;pushed_at?:string|null;repository_identity?:{id?:string}}|null;
  metric_checked_at:Date|string|null;
};
export function buildBookOriginalCache(book:BookOriginalLookupInput,row?:CachedRepoRow|null):BookOriginalCache{
  const fullName=row?.full_name??null;
  const url=row?.current_url??(book.upstream_url?.trim()||book.repository_url);
  const facts=(row?.facts??{}) as Partial<RepositoryFacts>&{quick_start?:unknown};
  const defaultBranch=typeof facts.default_branch==='string'&&facts.default_branch?facts.default_branch:null;
  const release=row?.latest_release??null;
  const headSha=validCommitSha(facts.head_sha);
  const pinnedSha=validCommitSha(book.source_commit);
  const fetchedAtIso=row?.fetched_at?new Date(row.fetched_at).toISOString():null;
  const metricFresh=Boolean(row&&row.metric_snapshot?.repository_identity?.id===row.provider_repo_id&&(!row.fetched_at||new Date(row.metric_checked_at??0)>=new Date(row.fetched_at)));
  const socialSnapshot=metricFresh?row?.metric_snapshot:facts.metrics;
  const numeric=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
  const stars=metricFresh&&typeof row?.metric_snapshot?.stargazers_count==='number'
    ?row.metric_snapshot.stargazers_count
    :typeof facts.stars==='number'
      ?facts.stars
      :null;
  const releaseDateMs=release?.published_at?Date.parse(release.published_at):Number.NaN;
  const reviewedAtMs=book.reviewed_at?Date.parse(book.reviewed_at):Number.NaN;
  const releaseAfterReview=Number.isFinite(releaseDateMs)&&Number.isFinite(reviewedAtMs)&&releaseDateMs>reviewedAtMs;
  const aheadOfPin=Boolean((headSha&&pinnedSha&&headSha!==pinnedSha)||releaseAfterReview);
  let latestVersionUrl:string|null=null;
  let latestVersionLabel:string|null=null;
  if(aheadOfPin){
    if(release?.html_url){
      latestVersionUrl=release.html_url;
      latestVersionLabel=release.tag_name;
    }else if(url){
      latestVersionUrl=defaultBranch?`${url.replace(/\/$/,'')}/commits/${encodeURIComponent(defaultBranch)}`:url;
      latestVersionLabel=headSha?headSha.slice(0,7):(defaultBranch??'latest');
    }
  }
  const readmeHtml=row?.readme_html??null;
  return {
    full_name:fullName,
    url,
    original_author:facts.owner_login??(fullName?fullName.split('/')[0]:null),
    description:row?.description??book.description??null,
    topics:Array.isArray(row?.topics)?row.topics:[],
    license_spdx:row?.license_spdx??null,
    default_branch:defaultBranch,
    stars,
    ...(socialSnapshot?{social_metrics:{forks_count:numeric(socialSnapshot.forks_count),open_issues_count:numeric(socialSnapshot.open_issues_count),subscribers_count:numeric(socialSnapshot.subscribers_count),pushed_at:typeof socialSnapshot.pushed_at==='string'?socialSnapshot.pushed_at:null}}:{}),
    readme_html:readmeHtml,
    quick_start:typeof facts.quick_start==='string'?facts.quick_start:null,
    latest_release:release,
    head_sha:headSha,
    ahead_of_pin:aheadOfPin,
    latest_version_url:latestVersionUrl,
    latest_version_label:latestVersionLabel,
    fetched_at:fetchedAtIso,
    fetch_state:row?.fetch_state??null,
    stale:!row?.fetched_at||Date.now()-new Date(row.fetched_at).getTime()>86400000
  };
}
export function summarizeBookOriginalCache(cache:BookOriginalCache):BookOriginalCacheSummary{
  const {readme_html:_omitted,...summary}=cache;
  return summary;
}
function boundRows(book:BookOriginalLookupInput,rows:CachedRepoRow[]):CachedRepoRow[]{
  const coordinate=githubCoordinateOrNull(book.upstream_url||book.repository_url);
  const candidates=rows.filter(row=>row.observed_book_id===book.id);
  if(!candidates.length||candidates.some(row=>row.observed_needs_recheck
    ||row.observed_requested_full_name?.toLowerCase()!==coordinate
    ||!/^\d{1,20}$/.test(row.established_provider_repo_id)))return [];
  if(new Set(candidates.map(row=>row.established_provider_repo_id)).size!==1)return [];
  return candidates;
}
export async function readBookOriginalCaches(pool:Pool,books:readonly BookOriginalLookupInput[],options:{includeReadme?:boolean}={}):Promise<Map<string,BookOriginalCache>>{
  const result=new Map<string,BookOriginalCache>();
  if(books.length===0)return result;
  let repoRows:CachedRepoRow[]=[];
  try{
    repoRows=(await pool.query(options.includeReadme===false?PUBLIC_BOOK_SUMMARY_SQL:PUBLIC_BOOK_CACHE_SQL,[books.map(book=>book.id),books.map(book=>githubCoordinateOrNull(book.upstream_url||book.repository_url))])).rows as CachedRepoRow[];
  }catch{ /* Unavailable identity evidence uses only the reviewed catalog copy. */ }
  for(const book of books){
    const bound=boundRows(book,repoRows);
    const repositoryId=bound[0]?.established_provider_repo_id??null;
    const cached=bound.filter(row=>row.provider_repo_id===repositoryId&&row.full_name&&row.fetch_state!=='unavailable');
    // SQL deduplicates bindings; never choose between conflicting cache candidates by row order.
    const row=cached.length===1?cached[0]:null;
    result.set(book.id,{...buildBookOriginalCache(book,row),repository_id:repositoryId});
  }
  return result;
}
export async function readBookOriginalCache(pool:Pool,book:BookOriginalLookupInput):Promise<BookOriginalCache>{
  return (await readBookOriginalCaches(pool,[book])).get(book.id)??buildBookOriginalCache(book);
}
