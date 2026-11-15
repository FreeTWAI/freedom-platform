import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {transaction} from '../../packages/db/index.js';
import {Problem} from '../../packages/shared/problem.js';
import type {SkillBook} from '../community/catalog.js';
import {communitySkillArt} from '../skill-submissions/public.js';
import {getSkillShareContent} from '../community/skill-share-content.js';
import {repositoryFacts} from './adapters/repository.js';
import {endorseShare} from './credit.js';
import type {AdapterContext,RepositoryFacts} from './types.js';

type Queryable=Pool|PoolClient;
export type LegacyRef={kind:'oss_project'|'skill_submission'|'book';id:string};
export type RepositorySource={community:string;url:string;owner:string|null;created:string;legacy:LegacyRef;notes:unknown};
export type RepositoryGroup={community:string;facts:RepositoryFacts;sources:RepositorySource[]};
export type BackfillCounts={repositories:number;shares:number;credits:number;notes:number;links:number};

export async function projectRows(q:Queryable,filter:{project_id?:string}={}){
  if(filter.project_id!==undefined){
    return (await q.query(
      `SELECT p.*,v.source_snapshot FROM oss_projects p LEFT JOIN oss_project_versions v ON v.version_id=p.current_version_id WHERE p.sharing_withdrawn_at IS NULL AND p.project_id=$1 ORDER BY p.created_at,p.project_id`,
      [filter.project_id]
    )).rows;
  }
  return (await q.query(
    `SELECT p.*,v.source_snapshot FROM oss_projects p LEFT JOIN oss_project_versions v ON v.version_id=p.current_version_id WHERE p.sharing_withdrawn_at IS NULL ORDER BY p.created_at,p.project_id`
  )).rows;
}

export async function submissionRows(q:Queryable,filter:{submission_id?:string}={}){
  if(filter.submission_id!==undefined){
    return (await q.query(
      `SELECT s.*,p.repository_url,p.repository_full_name,(s.image_bytes IS NOT NULL OR s.storage_source='asset') AS has_image FROM skill_submissions s JOIN oss_projects p USING(project_id) WHERE s.status='published' AND s.consent_to_share AND NOT (s.payload ? 'page_content_draft') AND p.sharing_withdrawn_at IS NULL AND s.submission_id=$1 ORDER BY s.published_at,s.submission_id`,
      [filter.submission_id]
    )).rows;
  }
  return (await q.query(
    `SELECT s.*,p.repository_url,p.repository_full_name,(s.image_bytes IS NOT NULL OR s.storage_source='asset') AS has_image FROM skill_submissions s JOIN oss_projects p USING(project_id) WHERE s.status='published' AND s.consent_to_share AND NOT (s.payload ? 'page_content_draft') AND p.sharing_withdrawn_at IS NULL ORDER BY s.published_at,s.submission_id`
  )).rows;
}

export function projectSource(p:any):RepositorySource{
  return {
    community:p.community_id,
    url:p.repository_url,
    owner:p.owner_ref,
    created:new Date(p.created_at).toISOString(),
    legacy:{kind:'oss_project',id:p.project_id},
    notes:{title:p.title,description:p.description,use_notes:p.use_notes,relationship:p.relationship},
  };
}

export function submissionSource(s:any):RepositorySource{
  return {
    community:s.community_id,
    url:s.repository_url,
    owner:s.owner_ref,
    created:new Date(s.published_at).toISOString(),
    legacy:{kind:'skill_submission',id:s.submission_id},
    notes:{
      ...s.payload,
      ...communitySkillArt(s.repository_full_name),
      ...(s.has_image?{illustration_url:`/api/v1/skill-submissions/${s.submission_id}/illustration`}:{}),
    },
  };
}

export function bookSource(communityId:string,b:SkillBook):RepositorySource{
  return {
    community:communityId,
    url:b.upstream_url,
    owner:null,
    created:'9999',
    legacy:{kind:'book',id:b.id},
    notes:{
      title:b.title,
      guide:b.guide??null,
      cover_url:b.cover_url??null,
      share_content:getSkillShareContent(b.id),
      attribution:'catalog_self_declared',
      source_commit:b.source_commit,
    },
  };
}

export async function addOwner(q:PoolClient,id:string,owner:string,counts:BackfillCounts){
  const share=(await q.query('SELECT * FROM shares WHERE share_id=$1 FOR UPDATE',[id])).rows[0];
  if(await endorseShare(q,share,owner,true))counts.credits++;
}

export async function attachRepositorySources(
  q:PoolClient,
  g:RepositoryGroup,
  counts:BackfillCounts={repositories:0,shares:0,credits:0,notes:0,links:0}
):Promise<string>{
  const f=g.facts;
  const inserted=(await q.query(
    `INSERT INTO canonical_repositories(repo_id,provider,provider_repo_id,full_name,current_url,facts,description,topics,homepage,license_spdx)
     VALUES($1,'github',$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(provider,provider_repo_id) DO NOTHING RETURNING repo_id`,
    [randomUUID(),f.id,f.full_name,f.url,JSON.stringify(f),f.description,f.topics,f.homepage,f.license_spdx]
  )).rows[0];
  if(inserted)counts.repositories++;
  const repoId=inserted?.repo_id??(await q.query("SELECT repo_id FROM canonical_repositories WHERE provider='github' AND provider_repo_id=$1",[f.id])).rows[0].repo_id;
  const ordered=g.sources.toSorted((a,b)=>a.created.localeCompare(b.created)||a.legacy.id.localeCompare(b.legacy.id));
  const first=ordered.find(s=>s.owner)?.owner??null;
  await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`share/${g.community}/repository/github:${f.id}`]);
  const created=(await q.query(
    `INSERT INTO shares(community_id,kind,canonical_key,canonical_url,repo_id,title,first_sharer_user_id) VALUES($1,'repository',$2,$3,$4,$5,$6)
     ON CONFLICT(community_id,kind,canonical_key) DO NOTHING RETURNING share_id`,
    [g.community,`github:${f.id}`,f.url,repoId,f.full_name,first]
  )).rows[0];
  if(created)counts.shares++;
  const share=(await q.query("SELECT * FROM shares WHERE community_id=$1 AND kind='repository' AND canonical_key=$2 FOR UPDATE",[g.community,`github:${f.id}`])).rows[0];
  const notes={...share.editor_notes},refs=[...share.legacy_ref] as LegacyRef[];
  for(const s of ordered){
    const key=`${s.legacy.kind}:${s.legacy.id}`;
    if(!(key in notes))notes[key]=s.notes;
    if(!refs.some(r=>r.kind===s.legacy.kind&&r.id===s.legacy.id))refs.push(s.legacy);
    if(s.owner)await addOwner(q,share.share_id,s.owner,counts);
    if(s.legacy.kind==='oss_project')counts.links+=(await q.query('UPDATE oss_projects SET share_id=$2 WHERE project_id=$1 AND share_id IS NULL',[s.legacy.id,share.share_id])).rowCount??0;
    if(s.legacy.kind==='skill_submission')counts.links+=(await q.query('UPDATE skill_submissions SET share_id=$2 WHERE submission_id=$1 AND share_id IS NULL',[s.legacy.id,share.share_id])).rowCount??0;
    if(s.legacy.kind==='book'){
      counts.links+=(await q.query('UPDATE guild_skill_book_bindings SET share_id=$3 WHERE community_id=$1 AND book_id=$2 AND share_id IS NULL',[g.community,s.legacy.id,share.share_id])).rowCount??0;
      counts.links+=(await q.query('UPDATE member_skill_book_grants SET share_id=$3 WHERE community_id=$1 AND book_id=$2 AND share_id IS NULL',[g.community,s.legacy.id,share.share_id])).rowCount??0;
    }
  }
  counts.notes+=(await q.query(
    'UPDATE shares SET editor_notes=$2,legacy_ref=$3 WHERE share_id=$1 AND (editor_notes IS DISTINCT FROM $2::jsonb OR legacy_ref IS DISTINCT FROM $3::jsonb)',
    [share.share_id,JSON.stringify(notes),JSON.stringify(refs)]
  )).rowCount??0;
  return share.share_id as string;
}

/**
 * Called by the opensource project and skill publication routes after sending the response.
 * A GitHub resolution failure only defers: the share backfill attaches later and credits clicks made meanwhile.
 * Safe to repeat concurrently or after partial attachment via canonical share locking and idempotent updates.
 */
export async function attachMemberRepositoryShare(
  pool:Pool,
  ref:{project_id:string;submission_id?:string},
  context:AdapterContext={}
):Promise<string|null>{
  const {project_id,submission_id}=ref;
  const project=(await projectRows(pool,{project_id}))[0];
  if(!project)return null;
  const candidate=submission_id?(await submissionRows(pool,{submission_id}))[0]:undefined;
  const submission=candidate&&candidate.project_id===project.project_id?candidate:undefined;
  if(project.share_id&&(!submission||submission.share_id))return project.share_id as string;
  let facts:RepositoryFacts|undefined;
  if(project.share_id){
    const retained=(await pool.query(
      'SELECT c.* FROM canonical_repositories c JOIN shares s USING(repo_id) WHERE s.share_id=$1',
      [project.share_id]
    )).rows[0];
    // Only reuse an identity previously resolved by this backfill/share path, including original-fork resolution.
    if(retained?.facts?.id&&!retained.source_repo_id)facts=retained.facts as RepositoryFacts;
  }
  if(!facts){
    try{
      facts=await repositoryFacts(project.repository_url,context);
    }catch(error){
      const code=error instanceof Problem?error.code:'repository_resolution_failed';
      console.warn(JSON.stringify({event:'share_attach_deferred',project_id,submission_id:submission_id??null,code}));
      return null;
    }
  }
  return transaction(pool,q=>attachRepositorySources(q,{
    community:project.community_id,
    facts,
    sources:[projectSource(project),...(submission?[submissionSource(submission)]:[])],
  }));
}
