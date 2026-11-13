import { saveRepositoryMetrics } from '../github-social/service.js';
import { createHash } from 'node:crypto';
import type { Pool,PoolClient } from 'pg';
import { z } from 'zod';
import { transaction } from '../../packages/db/index.js';
import { Problem,requireCondition } from '../../packages/shared/problem.js';
import { githubCoordinate, publicRepositoryJson } from '../opensource-marketing/github.js';
import { repositoryRedirectReader,shareRepositoryJson } from './github.js';
import { repositoryFacts } from './adapters/repository.js';
import { sanitizeReadme,readmeQuickStart } from './sanitize.js';
import type { AdapterContext,RepositoryFacts } from './types.js';
const releaseSchema=z.object({tag_name:z.string().max(200),name:z.string().max(300).nullable(),html_url:z.string().max(2048),published_at:z.string().nullable()});
export type BookReleaseSummary={tag_name:string;name:string|null;html_url:string;published_at:string|null};
export type BookOriginalCache={
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
export type BookOriginalLookupInput={id:string;repository_url:string;upstream_url?:string;source_commit?:string;reviewed_at?:string};
export const PUBLIC_BOOK_CACHE_SQL=`SELECT cr.repo_id, cr.provider_repo_id, cr.full_name, cr.current_url, cr.description, cr.topics,
  cr.license_spdx, cr.readme_html, cr.latest_release, cr.facts, cr.fetched_at, cr.fetch_state,
  obs.book_id AS observed_book_id, obs.requested_full_name AS observed_requested_full_name,
  m.snapshot AS metric_snapshot, m.checked_at AS metric_checked_at
FROM canonical_repositories cr
LEFT JOIN catalog_repo_observations obs
  ON obs.provider = cr.provider AND obs.provider_repo_id = cr.provider_repo_id AND obs.book_id = ANY($1::text[])
LEFT JOIN github_repository_metrics m
  ON m.repository_key = lower(cr.full_name)
WHERE cr.provider = 'github'
  AND cr.fetch_state <> 'unavailable'
  AND (obs.book_id IS NOT NULL OR lower(cr.full_name) = ANY($2::text[]))`;
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
export async function refreshRepository(pool:Pool,repoId:string,context:AdapterContext={},force=false) {
  // A DB lease prevents each viewer/worker from issuing its own fetch. It also bounds failure retries.
  const prior=(await pool.query(`UPDATE canonical_repositories SET refresh_after=now()+interval '10 minutes'
    WHERE repo_id=$1 AND ($2 OR refresh_after<=now()) RETURNING *`,[repoId,force])).rows[0];if(!prior)return;
  try {
    const facts=await repositoryFacts(prior.current_url,context);
    requireCondition(facts.id===prior.provider_repo_id,422,'repository_identity_changed','原作身分已變更。');
    if(facts.metrics)await saveRepositoryMetrics(pool,facts.full_name.toLowerCase(),facts.metrics);
    const html=await readme(facts,context,prior.etag);
    const rawRelease=await shareRepositoryJson(`/repos/${facts.full_name}/releases/latest`,AbortSignal.timeout(8000),context.fetcher??fetch,true,196608,context.token);
    const release=rawRelease===null?null:releaseSchema.parse(rawRelease);
    if(release){const target=new URL(release.html_url);requireCondition(target.origin==='https://github.com'&&target.pathname.startsWith(`/${facts.full_name}/releases/`),503,'release_invalid','版本資料不完整。');}
    const headSha=await defaultBranchHeadSha(facts,context);
    const storedFacts:RepositoryFacts=headSha?{...facts,head_sha:headSha}:facts;
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
type CachedRepoRow={
  provider_repo_id:string;
  full_name:string;
  current_url:string;
  description:string|null;
  topics:string[]|null;
  license_spdx:string|null;
  readme_html:string|null;
  latest_release:BookReleaseSummary|null;
  facts:Partial<RepositoryFacts>|null;
  fetched_at:Date|string|null;
  fetch_state:string|null;
  observed_book_id:string|null;
  observed_requested_full_name:string|null;
  metric_snapshot:{stargazers_count?:number;repository_identity?:{id?:string}}|null;
  metric_checked_at:Date|string|null;
};
type CachedMetricRow={
  repository_key:string;
  snapshot:{stargazers_count?:number}|null;
  checked_at:Date|string|null;
};
export function buildBookOriginalCache(book:BookOriginalLookupInput,row?:CachedRepoRow|null,metric?:CachedMetricRow|null):BookOriginalCache{
  const originalUrl=book.upstream_url??book.repository_url;
  const originalCoord=githubCoordinateOrNull(originalUrl);
  const fullName=row?.full_name??originalCoord;
  const url=row?.current_url??originalUrl;
  const facts=(row?.facts??{}) as Partial<RepositoryFacts>;
  const defaultBranch=typeof facts.default_branch==='string'&&facts.default_branch?facts.default_branch:null;
  const release=row?.latest_release??null;
  const headSha=validCommitSha(facts.head_sha);
  const pinnedSha=validCommitSha(book.source_commit);
  const fetchedAtIso=row?.fetched_at?new Date(row.fetched_at).toISOString():null;
  const metricFresh=Boolean(row&&row.metric_snapshot?.repository_identity?.id===row.provider_repo_id&&(!row.fetched_at||new Date(row.metric_checked_at??0)>=new Date(row.fetched_at)));
  const stars=metricFresh&&typeof row?.metric_snapshot?.stargazers_count==='number'
    ?row.metric_snapshot.stargazers_count
    :typeof facts.stars==='number'
      ?facts.stars
      :typeof metric?.snapshot?.stargazers_count==='number'
        ?metric.snapshot.stargazers_count
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
    description:row?.description??null,
    topics:Array.isArray(row?.topics)?row.topics:[],
    license_spdx:row?.license_spdx??null,
    default_branch:defaultBranch,
    stars,
    readme_html:readmeHtml,
    quick_start:readmeHtml&&fullName?readmeQuickStart(readmeHtml,fullName):null,
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
function matchesOriginalRow(book:BookOriginalLookupInput,row:CachedRepoRow):boolean{
  const originalUrl=book.upstream_url??book.repository_url;
  const originalCoord=githubCoordinateOrNull(originalUrl);
  const copyCoord=githubCoordinateOrNull(book.repository_url);
  if(!originalCoord)return false;
  const rowCoord=row.full_name.toLowerCase();
  if(rowCoord===originalCoord)return true;
  // Accept a renamed original observed under its previous coordinate as long as it is not the distinct integration copy.
  return row.observed_book_id===book.id
    &&row.observed_requested_full_name?.toLowerCase()===originalCoord
    &&(!copyCoord||copyCoord===originalCoord||rowCoord!==copyCoord);
}
export async function readBookOriginalCaches(pool:Pool,books:readonly BookOriginalLookupInput[]):Promise<Map<string,BookOriginalCache>>{
  const result=new Map<string,BookOriginalCache>();
  if(books.length===0)return result;
  const bookIds=books.map(book=>book.id);
  const coords=[...new Set(books.map(book=>githubCoordinateOrNull(book.upstream_url??book.repository_url)).filter((v):v is string=>Boolean(v)))];
  let repoRows:CachedRepoRow[]=[];
  let metricRows:CachedMetricRow[]=[];
  try{
    repoRows=(await pool.query(PUBLIC_BOOK_CACHE_SQL,[bookIds,coords])).rows as CachedRepoRow[];
    if(coords.length>0){
      metricRows=(await pool.query(PUBLIC_BOOK_METRICS_SQL,[coords])).rows as CachedMetricRow[];
    }
  }catch{
    repoRows=[];
    metricRows=[];
  }
  const metricsByCoord=new Map(metricRows.map(m=>[m.repository_key.toLowerCase(),m]));
  for(const book of books){
    const originalCoord=githubCoordinateOrNull(book.upstream_url??book.repository_url);
    const matchedRow=repoRows.find(row=>matchesOriginalRow(book,row))??null;
    const metric=originalCoord?metricsByCoord.get(originalCoord)??null:null;
    result.set(book.id,buildBookOriginalCache(book,matchedRow,metric));
  }
  return result;
}
export async function readBookOriginalCache(pool:Pool,book:BookOriginalLookupInput):Promise<BookOriginalCache>{
  return (await readBookOriginalCaches(pool,[book])).get(book.id)??buildBookOriginalCache(book);
}
