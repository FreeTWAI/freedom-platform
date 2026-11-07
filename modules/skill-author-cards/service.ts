import type {Pool} from 'pg';
import {Problem,requireCondition} from '../../packages/shared/problem.js';
import {publicMemberCard} from '../identity-membership/member-sharing.js';
import {githubCoordinate} from '../opensource-marketing/github.js';
import {PUBLISHED,readPublishedSkillSubmission} from '../skill-submissions/public.js';
import {communityCatalog} from '../community/catalog.js';
import {cachedRepositoryIdentity,repositoryIdentity} from '../github-social/service.js';
import type {RepositoryIdentity} from '../github-social/provider.js';

type Card=Awaited<ReturnType<typeof publicMemberCard>>;
export type PublicSkillAuthorCard={name:string;role:string;card_path:string;card:Card};
type Source={coordinate:string;bookId?:string;repositoryId?:string;recordedIdentity?:RepositoryIdentity};
type Candidate={share_token:string;role:string};
type Claim={user_id:string;community_id:string;github_user_id:string;role:string;state:string};
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const original=(role:string)=>role==='original_author'||role==='co_original_author';
const visible=`s.enabled AND u.active AND (NOT u.onboarding_required OR u.onboarding_completed_at IS NOT NULL)
  AND NOT is_verification_test_account(u.user_id)`;

/** Resolve identity without reading private profiles, OAuth tokens or claim evidence.
 * OAuth establishes the linked GitHub account, not a new verified authorship claim.
 */
async function candidates(pool:Pool,source:Source):Promise<Candidate[]>{
  let repositoryId=source.repositoryId,observed=false;
  if(source.bookId){
    const observation=(await pool.query(`SELECT provider_repo_id,requested_full_name,full_name,needs_recheck
      FROM catalog_repo_observations WHERE book_id=$1 AND provider='github'`,[source.bookId])).rows[0];
    if(observation){
      observed=true;
      if(observation.needs_recheck||!same(observation.requested_full_name,source.coordinate)||!same(observation.full_name,source.coordinate))return [];
      repositoryId=observation.provider_repo_id;
    }
  }
  const repositories=(await pool.query(`SELECT repo_id,provider_repo_id,full_name FROM canonical_repositories
    WHERE provider='github' AND (provider_repo_id=$1 OR lower(full_name)=lower($2))`,[repositoryId??null,source.coordinate])).rows;
  if(repositories.length>1)return [];
  const repo=repositories[0];
  if(observed&&!repo)return [];
  if(repo&&(!same(repo.full_name,source.coordinate)||(repositoryId&&repo.provider_repo_id!==repositoryId)))return [];
  if(repositoryId||repo){
    const unsafe=(await pool.query(`SELECT 1 FROM catalog_repo_observations WHERE provider='github'
      AND (provider_repo_id=$1 OR lower(requested_full_name)=lower($2))
      AND (needs_recheck OR provider_repo_id<>$1) LIMIT 1`,[repositoryId??repo.provider_repo_id,source.coordinate])).rowCount;
    if(unsafe)return [];
  }
  const claims:Claim[]=repo?(await pool.query<Claim>(`SELECT user_id,community_id,github_user_id,role,state
    FROM repo_credit_claims WHERE repo_id=$1`,[repo.repo_id])).rows:[];
  if(claims.some(claim=>claim.state==='disputed'))return [];
  const authors=claims.filter(claim=>claim.state==='verified'&&original(claim.role));
  if(authors.length){
    const result:Candidate[]=[],seen=new Set<string>();
    for(const claim of authors.sort((a,b)=>Number(a.role==='co_original_author')-Number(b.role==='co_original_author')||a.user_id.localeCompare(b.user_id))){
      if(seen.has(claim.user_id))continue;
      const row=(await pool.query(`SELECT s.share_token FROM github_social_connections g
        JOIN users u ON u.user_id=g.user_id AND u.community_id=g.community_id
        JOIN member_card_shares s ON s.user_id=u.user_id AND s.community_id=u.community_id
        WHERE g.user_id=$1 AND g.community_id=$2 AND g.github_user_id=$3 AND ${visible}`,
      [claim.user_id,claim.community_id,claim.github_user_id])).rows[0];
      if(row){seen.add(claim.user_id);result.push({share_token:row.share_token,role:claim.role==='original_author'?'原創作者':'共同原創作者'});}
    }
    // An author who closed their card is not replaced by a repository owner.
    return result;
  }
  const identity=source.recordedIdentity??await cachedRepositoryIdentity(pool,source.coordinate,repositoryId??repo?.provider_repo_id);
  if(!identity)return [];
  const conflicting=(await pool.query(`SELECT 1 FROM canonical_repositories WHERE provider='github'
      AND provider_repo_id=$1 AND lower(full_name)<>lower($2)
    UNION ALL SELECT 1 FROM catalog_repo_observations WHERE provider='github'
      AND (provider_repo_id=$1 OR lower(requested_full_name)=lower($2)) AND (needs_recheck OR provider_repo_id<>$1)
    LIMIT 1`,[identity.id,source.coordinate])).rowCount;
  if(conflicting)return [];
  // GitHub logins can be renamed and reused. Only the current source snapshot's
  // immutable owner ID can select an OAuth-linked account.
  const matches=(await pool.query(`SELECT g.user_id,g.github_user_id,s.share_token,(${visible}) AS visible
    FROM github_social_connections g JOIN users u ON u.user_id=g.user_id AND u.community_id=g.community_id
    LEFT JOIN member_card_shares s ON s.user_id=u.user_id AND s.community_id=u.community_id
    WHERE g.github_user_id=$1`,[identity.owner_id])).rows;
  if(matches.length!==1||!matches[0].visible)return [];
  const match=matches[0];
  if(claims.some(claim=>claim.user_id===match.user_id&&original(claim.role)&&['rejected','revoked','withdrawn'].includes(claim.state)))return [];
  return [{share_token:match.share_token,role:source.recordedIdentity?'收錄來源帳號':'來源帳號'}];
}

async function cards(pool:Pool,source:Source):Promise<{items:PublicSkillAuthorCard[]}>{
  const selected=await candidates(pool,source),items:PublicSkillAuthorCard[]=[];
  for(const author of selected){
    try{
      // Reuse the complete public-card projection, including its live consent,
      // account, onboarding, test-account and public-contact predicates.
      const card=await publicMemberCard(pool,author.share_token);
      items.push({name:card.nickname,role:author.role,card_path:`/member-cards/${author.share_token}`,card});
    }catch(error){if(!(error instanceof Problem&&error.code==='member_card_unavailable'))throw error;}
  }
  // Identity/claim/card changes while the projection was waiting must not expose
  // an earlier selection. No writes, remote lookups or member sessions are used.
  const current=await candidates(pool,source);
  return {items:items.filter(item=>current.some(author=>item.card_path===`/member-cards/${author.share_token}`&&item.role===author.role))};
}

export async function publicSkillAuthorCards(pool:Pool,bookId:string){
  const book=communityCatalog.skill_books.find(item=>item.id===bookId);
  requireCondition(book,404,'skill_book_not_found','找不到這本技能書。');
  let coordinate:string;
  try{coordinate=githubCoordinate(book.upstream_url);}catch{return {items:[]};}
  return cards(pool,{coordinate,bookId});
}

export async function publicSubmittedSkillAuthorCards(pool:Pool,id:string){
  const skill=await readPublishedSkillSubmission(pool,id);
  if(!skill)return null;
  // Keep repository identity pinned to the published project version. The
  // submitter's self-declared relationship and private owner id are not authorship.
  const readPin=async()=> (await pool.query(`SELECT v.version_id,v.repository_id,v.repository_full_name,v.commit_sha,v.source_sha256,
    jsonb_build_object('id',v.source_snapshot->>'repository_id','full_name',v.source_snapshot->>'repository_full_name',
      'owner_id',v.source_snapshot->>'repository_owner_id') AS recorded_identity ${PUBLISHED} AND s.submission_id=$1`,[skill.submission_id])).rows[0];
  const pin=await readPin();
  if(!pin||pin.repository_full_name!==skill.source.repository_full_name||pin.commit_sha!==skill.source.commit_sha)return null;
  // This is the account that owned the collected version when it was inspected,
  // not a claim about today's repository owner or original authorship. The
  // immutable published version keeps its historical pin without a cache TTL.
  const recorded=pin.recorded_identity.owner_id===null?undefined:repositoryIdentity(pin.recorded_identity,pin.repository_full_name,pin.repository_id);
  if(recorded===null)return {items:[]};
  const result=await cards(pool,{coordinate:pin.repository_full_name,repositoryId:pin.repository_id,recordedIdentity:recorded});
  const current=await readPin();
  // Same commit can have a different inspected owner or metadata version.
  return current&&JSON.stringify(current)===JSON.stringify(pin)?result:null;
}
