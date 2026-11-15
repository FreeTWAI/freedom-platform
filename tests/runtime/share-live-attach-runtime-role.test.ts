import {setFixtureRolePasswords} from './fixture-role-password.js';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {before,after,test} from 'node:test';
import {Pool} from 'pg';
import {migrate} from '../../scripts/database.js';
import {attachMemberRepositoryShare} from '../../modules/shares/repository-sources.js';

// Separate LOGIN pools, not SET ROLE on the schema-owning connection.
// The schema and roles are disposable and restricted to a local fp_* test DB.
const url=process.env.TEST_DATABASE_URL;
if(!url||!['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname)
  ||!/^\/fp_[a-z0-9_]+$/.test(new URL(url).pathname))
  throw new Error('Explicit disposable local fp_* TEST_DATABASE_URL required');
const id=`${process.pid}_${Date.now()}`;
const schema=`fp_share_acl_${id}`,migrator=`fp_share_m_${id}`,runtimeRole=`fp_share_a_${id}`;
const community=randomUUID(),userId=randomUUID(),projectId=randomUUID(),versionId=randomUUID(),submissionId=randomUUID();
const admin=new Pool({connectionString:url,max:2});
function roleUrl(role:string){const parsed=new URL(url!);parsed.username=role;parsed.password='';return parsed.toString();}
const owner=new Pool({connectionString:roleUrl(migrator),options:`-c search_path=${schema} -c statement_timeout=20000`,max:2});
const runtime=new Pool({connectionString:roleUrl(runtimeRole),options:`-c search_path=${schema} -c statement_timeout=20000`,max:4});
let created=false;

const SHA='a'.repeat(40);
const HASH='b'.repeat(64);
const repos:Record<string,{id:number;full_name:string;fork:boolean;source?:{full_name:string}}>={
  'fixture/acl-original':{id:981,full_name:'fixture/acl-original',fork:false},
  'fixture/acl-fork':{id:982,full_name:'fixture/acl-fork',fork:true,source:{full_name:'fixture/acl-original'}},
};
const fetcher:typeof fetch=async input=>{
  const pathname=new URL(String(input)).pathname;
  const repoMatch=/^\/repos\/(fixture\/[^/]+)$/.exec(pathname);
  if(repoMatch){
    const entry=repos[repoMatch[1]];
    if(!entry)return new Response('not found',{status:404});
    return Response.json({
      ...entry,
      private:false,
      visibility:'public',
      archived:false,
      owner:{id:980,login:'fixture'},
      default_branch:'main',
      description:`Repo ${entry.full_name}`,
      stargazers_count:17,
    });
  }
  if(/^\/repos\/fixture\/[^/]+\/commits\/main$/.test(pathname))return Response.json({sha:SHA});
  if(/^\/repos\/fixture\/[^/]+\/license$/.test(pathname))return Response.json({path:'LICENSE',license:{spdx_id:'MIT'}});
  return new Response(`unexpected ${pathname}`,{status:404});
};

before(async()=>{
  assert.ok([schema,migrator,runtimeRole].every(value=>value.length<63));
  await admin.query(`CREATE ROLE ${migrator} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
    CREATE ROLE ${runtimeRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
    CREATE SCHEMA ${schema} AUTHORIZATION ${migrator};
    GRANT USAGE ON SCHEMA ${schema} TO ${runtimeRole}`);
  await setFixtureRolePasswords(admin,[migrator,runtimeRole]);
  created=true;
  await migrate(owner);
  const source=await readFile(new URL('../../deploy/cloudflare/sql/20-runtime-grants.psql',import.meta.url),'utf8');
  const general=source.slice(source.indexOf('BEGIN;'),source.indexOf('-- BEGIN PRIVATE POLICY GRANTS'))
    .replaceAll('SCHEMA public',`SCHEMA ${schema}`).replaceAll(':"runtime"',`"${runtimeRole}"`);
  const section=(name:string)=>source.split(`-- BEGIN ${name}\n`)[1].split('\n\\gexec')[0]
    .replaceAll(":'runtime'",`'${runtimeRole}'`).replaceAll("n.nspname='public'",`n.nspname='${schema}'`);
  const q=await owner.connect();
  try{
    await q.query(general);
    for(const [name,count] of [['PRIVATE POLICY GRANTS',2],['DOMAIN MEDIA POLICY GRANTS',1]] as const){
      const statements=await q.query(section(name));
      assert.equal(statements.rows.length,count,name);
      for(const row of statements.rows)await q.query(Object.values(row)[0] as string);
    }
    await q.query('COMMIT');
  }catch(error){await q.query('ROLLBACK');throw error;}finally{q.release();}

  await owner.query('INSERT INTO communities VALUES($1,$2)',[community,'Synthetic restricted-role share attach']);
  await owner.query(
    `INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,onboarding_required)
     VALUES($1,$2,$3,'Synthetic role sharer','not-a-login',$4,false)`,
    [userId,community,`${userId}@restricted.local.test`,randomUUID()]
  );
  await owner.query(
    `INSERT INTO oss_projects(project_id,community_id,owner_ref,title,description,use_notes,repository_id,repository_full_name,repository_url,relationship)
     VALUES($1,$2,$3,'ACL Fork Project','ACL Desc','ACL Notes','982','fixture/acl-fork','https://github.com/fixture/acl-fork','curator')`,
    [projectId,community,userId]
  );
  await owner.query(
    `INSERT INTO oss_project_versions(version_id,project_id,repository_id,commit_sha,default_branch,repository_full_name,repository_url,readme_url,license_spdx,is_fork,archived,source_snapshot,source_sha256,facts_sha256,inspected_at)
     VALUES($1,$2,'982',$3,'main','fixture/acl-fork','https://github.com/fixture/acl-fork','https://github.com/fixture/acl-fork/blob/main/README.md','MIT',true,false,'{}'::jsonb,$4,$4,now())`,
    [versionId,projectId,SHA,HASH]
  );
  await owner.query('UPDATE oss_projects SET current_version_id=$2 WHERE project_id=$1',[projectId,versionId]);
  const payload={
    repository_url:'https://github.com/fixture/acl-fork',
    title:'ACL Skill Book',
    description:'ACL Skill Description',
    use_notes:'ACL Skill Use Notes',
    relationship:'curator',
  };
  await owner.query(
    `INSERT INTO skill_submissions(submission_id,community_id,owner_ref,status,grant_consumed_at,payload,payload_sha256,consent_to_share,project_id,project_version_id,published_at)
     VALUES($1,$2,$3,'published',now(),$4,$5,true,$6,$7,now())`,
    [submissionId,community,userId,JSON.stringify(payload),HASH,projectId,versionId]
  );
});

after(async()=>{
  await runtime.end();await owner.end();
  try{if(created)await admin.query(`DROP SCHEMA ${schema} CASCADE; DROP ROLE ${runtimeRole},${migrator}`);}
  finally{await admin.end();}
});

test('SHARE-ATTACH-ACL runtime role attaches project then published consented submission',async()=>{
  const actual=(await runtime.query(`SELECT current_user,session_user,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls
    FROM pg_catalog.pg_roles WHERE rolname=current_user`)).rows[0];
  assert.deepEqual(actual,{current_user:runtimeRole,session_user:runtimeRole,rolsuper:false,rolcreaterole:false,
    rolcreatedb:false,rolreplication:false,rolbypassrls:false});

  const projectShareId=await attachMemberRepositoryShare(runtime,{project_id:projectId},{fetcher});
  assert.ok(projectShareId);
  const afterProject=(await owner.query('SELECT share_id,kind,canonical_key,legacy_ref FROM shares WHERE share_id=$1',[projectShareId])).rows[0];
  assert.equal(afterProject.share_id,projectShareId);
  assert.equal(afterProject.kind,'repository');
  assert.equal(afterProject.canonical_key,'github:981');
  assert.deepEqual(afterProject.legacy_ref,[{kind:'oss_project',id:projectId}]);
  assert.equal((await owner.query('SELECT share_id FROM oss_projects WHERE project_id=$1',[projectId])).rows[0].share_id,projectShareId);

  const subShareId=await attachMemberRepositoryShare(runtime,{project_id:projectId,submission_id:submissionId},{fetcher});
  assert.equal(subShareId,projectShareId);
  const afterSub=(await owner.query('SELECT legacy_ref FROM shares WHERE share_id=$1',[projectShareId])).rows[0];
  assert.equal(afterSub.legacy_ref.length,2);
  assert.ok(afterSub.legacy_ref.some((r:any)=>r.kind==='oss_project'&&r.id===projectId));
  assert.ok(afterSub.legacy_ref.some((r:any)=>r.kind==='skill_submission'&&r.id===submissionId));
  assert.equal((await owner.query('SELECT share_id FROM oss_projects WHERE project_id=$1',[projectId])).rows[0].share_id,projectShareId);
  assert.equal((await owner.query('SELECT share_id FROM skill_submissions WHERE submission_id=$1',[submissionId])).rows[0].share_id,projectShareId);
});
