import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {communityCatalog,type SkillBook} from '../community/catalog.js';
import {communitySkillArt} from '../skill-submissions/public.js';
import {getSkillShareContent} from '../community/skill-share-content.js';
import {repositoryFacts} from './adapters/repository.js';
import {appendCredit,endorseShare,creditEventRegistrations} from './credit.js';
import type {AdapterContext,RepositoryFacts} from './types.js';
type Legacy={kind:'oss_project'|'skill_submission'|'book';id:string};
type Source={community:string;url:string;owner:string|null;created:string;legacy:Legacy;notes:unknown};
type Group={community:string;facts:RepositoryFacts;sources:Source[]};
export type BackfillPlan={repositories:Group[];events:{event_id:string;community_id:string;organizer_ref:string;title:string;created_at:Date}[]};
export async function planShareBackfill(pool:Pool,context:AdapterContext={},books:readonly SkillBook[]=communityCatalog.skill_books):Promise<BackfillPlan>{
 const projects=(await pool.query(`SELECT p.*,v.source_snapshot FROM oss_projects p LEFT JOIN oss_project_versions v ON v.version_id=p.current_version_id WHERE p.sharing_withdrawn_at IS NULL ORDER BY p.created_at,p.project_id`)).rows;
 const submissions=(await pool.query(`SELECT s.*,p.repository_url,p.repository_full_name,(s.image_bytes IS NOT NULL OR s.storage_source='asset') AS has_image FROM skill_submissions s JOIN oss_projects p USING(project_id) WHERE s.status='published' AND s.consent_to_share AND NOT (s.payload ? 'page_content_draft') AND p.sharing_withdrawn_at IS NULL ORDER BY s.published_at,s.submission_id`)).rows;
 const communities=(await pool.query('SELECT community_id FROM communities ORDER BY community_id')).rows;
 const sources:Source[]=projects.map(p=>({community:p.community_id,url:p.repository_url,owner:p.owner_ref,created:new Date(p.created_at).toISOString(),legacy:{kind:'oss_project',id:p.project_id},notes:{title:p.title,description:p.description,use_notes:p.use_notes,relationship:p.relationship}}));
 for(const s of submissions)sources.push({community:s.community_id,url:s.repository_url,owner:s.owner_ref,created:new Date(s.published_at).toISOString(),legacy:{kind:'skill_submission',id:s.submission_id},notes:{...s.payload,...communitySkillArt(s.repository_full_name),...(s.has_image?{illustration_url:`/api/v1/skill-submissions/${s.submission_id}/illustration`}:{})}});
 for(const c of communities)for(const b of books)sources.push({community:c.community_id,url:b.upstream_url,owner:null,created:'9999',legacy:{kind:'book',id:b.id},notes:{title:b.title,guide:b.guide??null,cover_url:b.cover_url??null,share_content:getSkillShareContent(b.id),attribution:'catalog_self_declared',source_commit:b.source_commit}});
 const resolved=new Map<string,RepositoryFacts>(),groups=new Map<string,Group>();
 for(const source of sources){
  const key=source.url.toLowerCase().replace(/\/$/,'');let facts=resolved.get(key);
  if(!facts){
   const retained=(await pool.query(`SELECT c.* FROM canonical_repositories c JOIN shares s USING(repo_id) WHERE s.community_id=$1 AND s.legacy_ref @> $2::jsonb`,[source.community,JSON.stringify([source.legacy])])).rows[0];
   // Only reuse an identity previously resolved by this backfill/share path, including original-fork resolution.
   if(retained?.facts?.id&&!retained.source_repo_id)facts=retained.facts as RepositoryFacts;
   else facts=await repositoryFacts(source.url,context);
   resolved.set(key,facts);
  }
  const groupKey=`${source.community}/${facts.id}`;let group=groups.get(groupKey);if(!group){group={community:source.community,facts,sources:[]};groups.set(groupKey,group);}group.sources.push(source);
 }
 return {repositories:[...groups.values()],events:(await pool.query("SELECT event_id,community_id,organizer_ref,title,created_at FROM community_events WHERE state='published' ORDER BY created_at,event_id")).rows};
}
export type BackfillCounts={repositories:number;shares:number;credits:number;notes:number;links:number};
async function addOwner(q:PoolClient,id:string,owner:string,counts:BackfillCounts){
 const share=(await q.query('SELECT * FROM shares WHERE share_id=$1 FOR UPDATE',[id])).rows[0];
 if(await endorseShare(q,share,owner,true))counts.credits++;
}
/** The same transaction executes both modes. Dry run rolls back every write (including trigger effects). */
export async function applyShareBackfill(pool:Pool,plan:BackfillPlan,apply=false):Promise<BackfillCounts>{
 const q=await pool.connect();const counts:BackfillCounts={repositories:0,shares:0,credits:0,notes:0,links:0};
 try{
  await q.query('BEGIN');await q.query("SELECT pg_advisory_xact_lock(hashtextextended('shares/backfill/v1',0))");
  for(const g of plan.repositories){
   const f=g.facts;
   const inserted=(await q.query(`INSERT INTO canonical_repositories(repo_id,provider,provider_repo_id,full_name,current_url,facts,description,topics,homepage,license_spdx)
     VALUES($1,'github',$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(provider,provider_repo_id) DO NOTHING RETURNING repo_id`,[randomUUID(),f.id,f.full_name,f.url,JSON.stringify(f),f.description,f.topics,f.homepage,f.license_spdx])).rows[0];
   if(inserted)counts.repositories++;
   const repoId=inserted?.repo_id??(await q.query("SELECT repo_id FROM canonical_repositories WHERE provider='github' AND provider_repo_id=$1",[f.id])).rows[0].repo_id;
   const ordered=g.sources.toSorted((a,b)=>a.created.localeCompare(b.created)||a.legacy.id.localeCompare(b.legacy.id));
   const first=ordered.find(s=>s.owner)?.owner??null;
   const created=(await q.query(`INSERT INTO shares(community_id,kind,canonical_key,canonical_url,repo_id,title,first_sharer_user_id) VALUES($1,'repository',$2,$3,$4,$5,$6)
     ON CONFLICT(community_id,kind,canonical_key) DO NOTHING RETURNING share_id`,[g.community,`github:${f.id}`,f.url,repoId,f.full_name,first])).rows[0];if(created)counts.shares++;
   const share=(await q.query("SELECT * FROM shares WHERE community_id=$1 AND kind='repository' AND canonical_key=$2 FOR UPDATE",[g.community,`github:${f.id}`])).rows[0];
   const notes={...share.editor_notes},refs=[...share.legacy_ref] as Legacy[];
   for(const s of ordered){
    const key=`${s.legacy.kind}:${s.legacy.id}`;if(!(key in notes))notes[key]=s.notes;
    if(!refs.some(r=>r.kind===s.legacy.kind&&r.id===s.legacy.id))refs.push(s.legacy);
    if(s.owner)await addOwner(q,share.share_id,s.owner,counts);
    if(s.legacy.kind==='oss_project')counts.links+=(await q.query('UPDATE oss_projects SET share_id=$2 WHERE project_id=$1 AND share_id IS NULL',[s.legacy.id,share.share_id])).rowCount??0;
    if(s.legacy.kind==='skill_submission')counts.links+=(await q.query('UPDATE skill_submissions SET share_id=$2 WHERE submission_id=$1 AND share_id IS NULL',[s.legacy.id,share.share_id])).rowCount??0;
    if(s.legacy.kind==='book'){
      counts.links+=(await q.query('UPDATE guild_skill_book_bindings SET share_id=$3 WHERE community_id=$1 AND book_id=$2 AND share_id IS NULL',[g.community,s.legacy.id,share.share_id])).rowCount??0;
      counts.links+=(await q.query('UPDATE member_skill_book_grants SET share_id=$3 WHERE community_id=$1 AND book_id=$2 AND share_id IS NULL',[g.community,s.legacy.id,share.share_id])).rowCount??0;
    }
   }
   counts.notes+=(await q.query('UPDATE shares SET editor_notes=$2,legacy_ref=$3 WHERE share_id=$1 AND (editor_notes IS DISTINCT FROM $2::jsonb OR legacy_ref IS DISTINCT FROM $3::jsonb)',[share.share_id,JSON.stringify(notes),JSON.stringify(refs)])).rowCount??0;
  }
  for(const e of plan.events){
   const r=(await q.query(`INSERT INTO shares(community_id,kind,canonical_key,canonical_url,ref_table,ref_id,title,first_sharer_user_id,created_at)
    VALUES($1,'event',$2,$3,'community_events',$4,$5,$6,$7) ON CONFLICT(community_id,kind,canonical_key) DO NOTHING RETURNING share_id`,[e.community_id,`event:${e.event_id}`,`/events/${e.event_id}`,e.event_id,e.title,e.organizer_ref,e.created_at])).rows[0];if(r)counts.shares++;
   const id=r?.share_id??(await q.query("SELECT share_id FROM shares WHERE community_id=$1 AND kind='event' AND canonical_key=$2",[e.community_id,`event:${e.event_id}`])).rows[0].share_id;
   await addOwner(q,id,e.organizer_ref,counts);
  }
  const claims=(await q.query(`SELECT c.*,s.share_id FROM repo_credit_claims c JOIN shares s USING(repo_id,community_id)
    WHERE c.state='verified' AND c.role IN ('original_author','co_original_author') AND s.state='published'`)).rows;
  for(const c of claims)if(await appendCredit(q,{share_id:c.share_id,community_id:c.community_id,user_id:c.user_id,role:'original_author',basis:'claim_verified',source_ref:`claim:${c.claim_id}`}))counts.credits++;
  // Per-link/day facts reuse the already-filtered promotion source. No copied URL or manual report earns credit.
  const clicks=(await q.query(`SELECT DISTINCT ON(c.link_id,c.click_day) c.*,s.share_id FROM promotion_clicks c JOIN promotion_links l USING(link_id)
    JOIN shares s ON s.community_id=c.community_id AND (l.kind='share' AND l.target_key=s.share_id::text
      OR l.kind='event' AND s.kind='event' AND s.ref_id::text=l.target_key
      OR l.kind='skill_book' AND EXISTS(SELECT 1 FROM jsonb_array_elements(s.legacy_ref) r WHERE
       (r->>'kind'='book' AND l.target_key='book:'||(r->>'id')) OR (r->>'kind'='skill_submission' AND l.target_key='submission:'||(r->>'id'))))
    WHERE s.state='published' AND c.visitor_key<>'m:'||c.user_id::text
      AND (c.visitor_key NOT LIKE 'm:%' OR NOT is_verification_test_account(substring(c.visitor_key FROM 3)::uuid))
    ORDER BY c.link_id,c.click_day,c.created_at`)).rows;
  for(const c of clicks)if(await appendCredit(q,{share_id:c.share_id,community_id:c.community_id,user_id:c.user_id,role:'spreader',basis:'qualified_click_day',source_ref:`click:${c.link_id}:${new Date(c.click_day).toISOString().slice(0,10)}`,actor_user_id:c.visitor_key.startsWith('m:')?c.visitor_key.slice(2):null}))counts.credits++;
  const events=(await q.query("SELECT DISTINCT ref_id FROM shares WHERE kind='event' AND state='published' ORDER BY ref_id")).rows;
  for(const event of events)counts.credits+=await creditEventRegistrations(q,event.ref_id);
  await q.query(apply?'COMMIT':'ROLLBACK');return counts;
 }catch(error){await q.query('ROLLBACK');throw error;}finally{q.release();}
}
