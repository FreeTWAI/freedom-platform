import {Problem} from '../../packages/shared/problem.js';
import type {Pool} from 'pg';
import {communityCatalog,type SkillBook} from '../community/catalog.js';
import {repositoryFacts} from './adapters/repository.js';
import {appendCredit,creditEventRegistrations} from './credit.js';
import {
  addOwner,
  attachRepositorySources,
  bookSource,
  projectRows,
  projectSource,
  submissionRows,
  submissionSource,
  type BackfillCounts,
  type LegacyRef,
  type RepositoryGroup,
  type RepositorySource,
} from './repository-sources.js';
import type {AdapterContext,RepositoryFacts} from './types.js';
export type {BackfillCounts};
export type BackfillPlan={unresolved:{url:string;code:string;legacy:LegacyRef}[];repositories:RepositoryGroup[];events:{event_id:string;community_id:string;organizer_ref:string;title:string;created_at:Date}[]};
export async function planShareBackfill(pool:Pool,context:AdapterContext={},books:readonly SkillBook[]=communityCatalog.skill_books):Promise<BackfillPlan>{
 const projects=await projectRows(pool);
 const submissions=await submissionRows(pool);
 const communities=(await pool.query('SELECT community_id FROM communities ORDER BY community_id')).rows;
 const sources:RepositorySource[]=projects.map(projectSource);
 for(const s of submissions)sources.push(submissionSource(s));
 for(const c of communities)for(const b of books)sources.push(bookSource(c.community_id,b));
 const resolved=new Map<string,RepositoryFacts>(),groups=new Map<string,RepositoryGroup>();
 const unresolved:BackfillPlan['unresolved']=[],failures=new Map<string,string>();
 for(const source of sources){
  const key=source.url.toLowerCase().replace(/\/$/,'');let facts=resolved.get(key);
  if(failures.has(key)){unresolved.push({url:source.url,code:failures.get(key)!,legacy:source.legacy});continue;}
  if(!facts){
   const retained=(await pool.query(`SELECT c.* FROM canonical_repositories c JOIN shares s USING(repo_id) WHERE s.community_id=$1 AND s.legacy_ref @> $2::jsonb`,[source.community,JSON.stringify([source.legacy])])).rows[0];
   // Only reuse an identity previously resolved by this backfill/share path, including original-fork resolution.
   if(retained?.facts?.id&&!retained.source_repo_id)facts=retained.facts as RepositoryFacts;
   else {
    try {facts=await repositoryFacts(source.url,context);}
    catch(error){
     const code=error instanceof Problem?error.code:'repository_resolution_failed';
     failures.set(key,code);unresolved.push({url:source.url,code,legacy:source.legacy});continue;
    }
   }
   resolved.set(key,facts);
  }
  const groupKey=`${source.community}/${facts.id}`;let group=groups.get(groupKey);if(!group){group={community:source.community,facts,sources:[]};groups.set(groupKey,group);}group.sources.push(source);
 }
 return {unresolved,repositories:[...groups.values()],events:(await pool.query("SELECT event_id,community_id,organizer_ref,title,created_at FROM community_events WHERE state='published' ORDER BY created_at,event_id")).rows};
}
/** The same transaction executes both modes. Dry run rolls back every write (including trigger effects). */
export async function applyShareBackfill(pool:Pool,plan:Pick<BackfillPlan,'repositories'|'events'>,apply=false):Promise<BackfillCounts>{
 const q=await pool.connect();const counts:BackfillCounts={repositories:0,shares:0,credits:0,notes:0,links:0};
 try{
  await q.query('BEGIN');await q.query("SELECT pg_advisory_xact_lock(hashtextextended('shares/backfill/v1',0))");
  for(const g of plan.repositories)await attachRepositorySources(q,g,counts);
  for(const e of plan.events){
   const r=(await q.query(`INSERT INTO shares(community_id,kind,canonical_key,canonical_url,ref_table,ref_id,title,first_sharer_user_id,created_at)
    VALUES($1,'event',$2,$3,'community_events',$4,$5,$6,$7) ON CONFLICT(community_id,kind,canonical_key) DO NOTHING RETURNING share_id`,[e.community_id,`event:${e.event_id}`,`/events/${e.event_id}`,e.event_id,e.title,e.organizer_ref,e.created_at])).rows[0];if(r)counts.shares++;
   const id=r?.share_id??(await q.query("SELECT share_id FROM shares WHERE community_id=$1 AND kind='event' AND canonical_key=$2",[e.community_id,`event:${e.event_id}`])).rows[0].share_id;
   await addOwner(q,id,e.organizer_ref,counts);
  }
  const claims=(await q.query(`SELECT c.*,s.share_id FROM repo_credit_claims c JOIN shares s USING(repo_id,community_id)
    WHERE c.state='verified' AND c.role IN ('original_author','co_original_author') AND s.state='published'`)).rows;
  for(const c of claims)if(await appendCredit(q,{share_id:c.share_id,community_id:c.community_id,user_id:c.user_id,role:'original_author',basis:'claim_verified',source_ref:`claim:${c.claim_id}`}))counts.credits++;
  // Resolve each filtered promotion source to its canonical share; one fact per sharer and day.
  const clicks=(await q.query(`SELECT DISTINCT ON(s.share_id,c.user_id,c.click_day) c.*,to_char(c.click_day,'YYYY-MM-DD') AS click_day_text,s.share_id FROM promotion_clicks c JOIN promotion_links l USING(link_id)
    JOIN LATERAL (SELECT s.* FROM shares s WHERE s.community_id=l.community_id AND s.state='published' AND (l.kind='share' AND l.target_key=s.share_id::text
      OR l.kind='event' AND s.kind='event' AND s.ref_id::text=l.target_key
      OR l.kind='social_post' AND s.kind='post' AND s.ref_id::text=l.target_key
      OR l.kind='member_service' AND s.kind='service' AND s.ref_id::text=l.target_key
      OR l.kind='skill_book' AND EXISTS(SELECT 1 FROM jsonb_array_elements(s.legacy_ref) r WHERE
       (r->>'kind'='book' AND l.target_key='book:'||(r->>'id')) OR (r->>'kind'='skill_submission' AND l.target_key='submission:'||(r->>'id')))) ORDER BY s.share_id LIMIT 1) s ON true
    WHERE c.visitor_key<>'m:'||c.user_id::text
      AND (c.visitor_key NOT LIKE 'm:%' OR NOT is_verification_test_account(substring(c.visitor_key FROM 3)::uuid))
    ORDER BY s.share_id,c.user_id,c.click_day,c.created_at,c.link_id`)).rows;
  for(const c of clicks)if(await appendCredit(q,{share_id:c.share_id,community_id:c.community_id,user_id:c.user_id,role:'spreader',basis:'qualified_click_day',source_ref:`click:${c.share_id}:${c.user_id}:${c.click_day_text}`,actor_user_id:c.visitor_key.startsWith('m:')?c.visitor_key.slice(2):null}))counts.credits++;
  const events=(await q.query("SELECT DISTINCT ref_id FROM shares WHERE kind='event' AND state='published' ORDER BY ref_id")).rows;
  for(const event of events)counts.credits+=await creditEventRegistrations(q,event.ref_id);
  await q.query(apply?'COMMIT':'ROLLBACK');return counts;
 }catch(error){await q.query('ROLLBACK');throw error;}finally{q.release();}
}
