import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_USERS,DEMO_COMMUNITY} from '../../packages/testing/seed.js';
import {communityCatalog} from '../../modules/community/catalog.js';
import {planShareBackfill,applyShareBackfill} from '../../modules/shares/backfill.js';
const url=process.env.TEST_DATABASE_URL;assert.ok(url,'Set an isolated TEST_DATABASE_URL');
const schema=`fp_sharefill_${randomUUID().replaceAll('-','')}`;
const admin=new Pool({connectionString:url}),pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
const owners=[DEMO_USERS[0].user_id,randomUUID(),randomUUID()],projects=[randomUUID(),randomUUID()],version=randomUUID(),submission=randomUUID(),event=randomUUID(),draft=randomUUID();
const book={...communityCatalog.skill_books[0],upstream_url:'https://github.com/fixture/original'};
const original={id:921,full_name:'fixture/original',private:false,visibility:'public',archived:false,fork:false,owner:{id:992,login:'fixture'},default_branch:'main',description:'Original',stargazers_count:17};
const fetcher:typeof fetch=async input=>Response.json(new URL(String(input)).pathname.endsWith('/fork')?{...original,id:922,full_name:'fixture/fork',fork:true,source:{full_name:'fixture/original'}}:original);
before(async()=>{
 await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);await seedLocal(pool);
 await pool.query('UPDATE users SET email=$2 WHERE user_id=$1',[owners[0],'fill-0@example.com']);
 for(let i=1;i<owners.length;i++)await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,active,onboarding_required)
 SELECT $1,community_id,$2,'Synthetic backfill',password_hash,$3,true,false FROM users WHERE user_id=$4`,[owners[i],`fill-${i}@example.com`,randomUUID(),owners[0]]);
 for(let i=0;i<projects.length;i++)await pool.query(`INSERT INTO oss_projects(project_id,community_id,owner_ref,title,description,use_notes,repository_id,repository_full_name,repository_url,relationship,created_at)
 VALUES($1,$2,$3,'Synthetic legacy','Description','Keep guide',$4,$5,$6,'curator',now()+$7*interval '1 second')`,[projects[i],DEMO_COMMUNITY,owners[i],String(921+i),i?'fixture/fork':'fixture/original',`https://github.com/fixture/${i?'fork':'original'}`,i]);
 await pool.query(`INSERT INTO oss_project_versions(version_id,project_id,repository_id,commit_sha,default_branch,repository_full_name,repository_url,readme_url,license_spdx,is_fork,archived,source_snapshot,source_sha256,facts_sha256,inspected_at)
 VALUES($1,$2,'921',$3,'main','fixture/original','https://github.com/fixture/original','https://github.com/fixture/original/blob/main/README.md','MIT',false,false,'{}',$4,$4,now())`,[version,projects[0],'a'.repeat(40),'b'.repeat(64)]);
 await pool.query(`INSERT INTO skill_submissions(submission_id,community_id,owner_ref,status,payload,payload_sha256,grant_consumed_at,project_id,project_version_id,published_at,consent_to_share)
 VALUES($1,$2,$3,'published',$4,$5,now(),$6,$7,now(),true)`,[submission,DEMO_COMMUNITY,owners[0],JSON.stringify({guide:'Preserve original guide',introductions:['Keep intro'],cover_url:'/legacy-art.png'}),'c'.repeat(64),projects[0],version]);
 for(const id of [event,draft])await pool.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,state,visibility)
 VALUES($1,$2,$3,'Synthetic event','Event',now()+interval '2 days',now()+interval '3 days','online','Online',$4,'workshop')`,[id,DEMO_COMMUNITY,owners[0],id===event?'published':'pending']);
 const link=(await pool.query(`INSERT INTO promotion_links(community_id,user_id,kind,target_key,code) VALUES($1,$2,'skill_book',$3,'fillbook01') RETURNING link_id`,[DEMO_COMMUNITY,owners[1],`book:${book.id}`])).rows[0].link_id;
 for(let i=0;i<2;i++)await pool.query(`INSERT INTO promotion_clicks(link_id,click_day,visitor_key,network_key,community_id,user_id,kind,created_at)
 VALUES($1,'2026-11-10',$2,$3,$4,$5,'skill_book','2026-11-10T12:00:00Z')`,[link,`v:${String(i).repeat(64)}`,'a'.repeat(64),DEMO_COMMUNITY,owners[1]]);
 await pool.query(`INSERT INTO community_event_rsvps(rsvp_id,event_id,user_id,state,referred_by_user_id) VALUES($1,$2,$3,'going',$4)`,[randomUUID(),event,owners[2],owners[1]]);
 // Same conversion through guest and member channels counts once. Pending mail and self-referral do not count.
 for(const email of ['fill-2@example.com','unconfirmed@example.com','fill-1@example.com'])await pool.query(`INSERT INTO community_event_guest_rsvps(event_id,email,name,state,referred_by_user_id,email_sent_at) VALUES($1,$2,'Synthetic guest','going',$3,$4)`,[event,email,owners[1],email.startsWith('unconfirmed')?null:new Date()]);
});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
test('backfill consolidates originals, preserves legacy sources, matches dry-run and has zero second-run changes',async()=>{
 const plan=await planShareBackfill(pool,{fetcher},[book]);assert.equal(plan.repositories.length,1);assert.equal(plan.events.length,1);
 const dry=await applyShareBackfill(pool,plan);assert.equal(dry.shares,2);assert.equal(dry.repositories,1);assert.equal(dry.credits,5);
 assert.equal((await pool.query('SELECT count(*)::int n FROM shares')).rows[0].n,0);
 const applied=await applyShareBackfill(pool,plan,true);assert.deepEqual(applied,dry);
 const next=await planShareBackfill(pool,{fetcher:async()=>{throw Error('repeat must reuse original identity');}},[book]);
 assert.deepEqual(await applyShareBackfill(pool,next,true),{repositories:0,shares:0,credits:0,notes:0,links:0});
 const shares=(await pool.query('SELECT * FROM shares ORDER BY kind')).rows;const repo=shares.find(s=>s.kind==='repository');
 assert.equal(repo.first_sharer_user_id,owners[0]);assert.equal(repo.legacy_ref.length,4);
 assert.equal(repo.editor_notes[`skill_submission:${submission}`].guide,'Preserve original guide');
 assert.equal((await pool.query('SELECT count(*)::int n FROM oss_projects WHERE share_id=$1',[repo.share_id])).rows[0].n,2);
 assert.equal((await pool.query('SELECT status,payload FROM skill_submissions WHERE submission_id=$1',[submission])).rows[0].status,'published');
 assert.equal((await pool.query("SELECT count(*)::int n FROM share_credit_events WHERE basis='registration'")).rows[0].n,1);
 assert.equal((await pool.query('SELECT count(*)::int n FROM community_events WHERE event_id IN ($1,$2)',[event,draft])).rows[0].n,2);
});

test('backfill reports an unresolved source, applies the rest and remains repeatable',async()=>{
 const broken=randomUUID();
 await pool.query(`INSERT INTO oss_projects(project_id,community_id,owner_ref,title,description,use_notes,repository_id,repository_full_name,repository_url,relationship)
 VALUES($1,$2,$3,'Unresolved synthetic','Description','Keep original','999','fixture/unresolved','https://github.com/fixture/unresolved','curator')`,[broken,DEMO_COMMUNITY,owners[2]]);
 const nextBook={...book,id:'synthetic-moved-book',upstream_url:'https://github.com/fixture/old-next'};
 const nextFacts={...original,id:923,full_name:'fixture/next'};
 const fixture:typeof fetch=async input=>{
  const path=new URL(String(input)).pathname;
  if(path==='/repos/fixture/unresolved')return new Response(null,{status:301,headers:{Location:'https://elsewhere.example/repository'}});
  if(path==='/repos/fixture/old-next')return new Response(null,{status:301,headers:{Location:'https://api.github.com/repositories/923'}});
  assert.equal(path,'/repositories/923');return Response.json(nextFacts);
 };
 const plan=await planShareBackfill(pool,{fetcher:fixture},[book,nextBook]);
 const unresolved=[{url:'https://github.com/fixture/unresolved',code:'github_repository_moved',legacy:{kind:'oss_project',id:broken}}];
 assert.deepEqual(plan.unresolved,unresolved);
 const before=(await pool.query('SELECT count(*)::int n FROM share_credit_events')).rows[0].n;
 const dry=await applyShareBackfill(pool,plan);assert.equal(dry.shares,1);assert.equal(dry.repositories,1);assert.equal(dry.credits,0);
 assert.deepEqual(await applyShareBackfill(pool,plan,true),dry);
 assert.equal((await pool.query('SELECT share_id FROM oss_projects WHERE project_id=$1',[broken])).rows[0].share_id,null);
 assert.equal((await pool.query("SELECT count(*)::int n FROM shares WHERE canonical_key='github:999' OR legacy_ref @> $1::jsonb",[JSON.stringify([unresolved[0].legacy])])).rows[0].n,0);
 assert.equal((await pool.query('SELECT count(*)::int n FROM share_credit_events')).rows[0].n,before);
 assert.equal((await pool.query("SELECT title FROM shares WHERE canonical_key='github:923'")).rows[0].title,'fixture/next');
 const again=await planShareBackfill(pool,{fetcher:fixture},[book,nextBook]);assert.deepEqual(again.unresolved,unresolved);
 assert.deepEqual(await applyShareBackfill(pool,again,true),{repositories:0,shares:0,credits:0,notes:0,links:0});
});

test('backfill CLI prints unresolved sources in dry-run and apply JSON using recorded fetches',async()=>{
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 const fixture=`globalThis.fetch=async input=>{
  const url=new URL(String(input));
  if(url.origin!=='https://api.github.com')throw Error('Unexpected host');
  if(url.pathname==='/repos/fixture/unresolved')return new Response(null,{status:301,headers:{Location:'https://elsewhere.example/repository'}});
  return Response.json(${JSON.stringify(original)});
 };`;
 const run=async(apply:boolean)=>{
  const result=await promisify(execFile)(process.execPath,['--import','tsx','--import',`data:text/javascript,${encodeURIComponent(fixture)}`,'scripts/backfill-shares.ts',...(apply?['--apply']:[])],{
   env:{...process.env,PGOPTIONS:`-c search_path=${schema}`,SHARES_BACKFILL_GITHUB_TOKEN:''},
  });
  return result.stdout.trim().split('\n').map(line=>JSON.parse(line));
 };
 const dry=await run(false);assert.equal(dry.length,1);assert.equal(dry[0].mode,'dry-run');
 assert.equal(dry[0].unresolved.length,1);assert.equal(dry[0].unresolved[0].code,'github_repository_moved');
 const applied=await run(true);assert.equal(applied.length,2);assert.equal(applied[1].mode,'apply');
 assert.deepEqual(applied[0],dry[0]);assert.deepEqual(applied[1].counts,dry[0].counts);assert.deepEqual(applied[1].unresolved,dry[0].unresolved);
 const repeated=await run(true);assert.deepEqual(repeated[1].counts,{repositories:0,shares:0,credits:0,notes:0,links:0});assert.deepEqual(repeated[1].unresolved,dry[0].unresolved);
});
