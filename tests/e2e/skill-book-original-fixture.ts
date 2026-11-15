import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {communityCatalog} from '../../modules/community/catalog.js';

/** Synthetic identity evidence for journeys that explicitly exercise original metadata. */
export async function seedBookOriginals(pool:Pool){
 for(const [index,book] of communityCatalog.skill_books.entries()){
  const fullName=new URL(book.upstream_url||book.repository_url).pathname.slice(1);
  const providerId=String(810000+index);
  await pool.query(`INSERT INTO canonical_repositories(repo_id,provider,provider_repo_id,full_name,current_url,description,facts,fetch_state,fetched_at)
    VALUES($1,'github',$2,$3,$4,$5,$6,'ready',now()) ON CONFLICT(provider,provider_repo_id) DO NOTHING`,
   [randomUUID(),providerId,fullName,'https://github.com/'+fullName,book.guide?.beginner.purpose??book.description,JSON.stringify({id:providerId,owner_login:fullName.split('/')[0]})]);
  await pool.query(`INSERT INTO catalog_repo_observations(book_id,provider,provider_repo_id,requested_full_name,full_name,current_url)
    VALUES($1,'github',$2,$3,$3,$4) ON CONFLICT(book_id) DO UPDATE SET provider_repo_id=EXCLUDED.provider_repo_id,
    requested_full_name=EXCLUDED.requested_full_name,full_name=EXCLUDED.full_name,current_url=EXCLUDED.current_url,needs_recheck=false`,
   [book.id,providerId,fullName,'https://github.com/'+fullName]);
 }
}
