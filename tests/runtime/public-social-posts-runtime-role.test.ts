import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {before,after,test} from 'node:test';
import {Pool} from 'pg';
import {migrate} from '../../scripts/database.js';
import {createApp} from '../../apps/platform-api/src/app.js';
import {tokenHash} from '../../modules/identity-membership/service.js';

// Separate LOGIN pools, not SET ROLE on the schema-owning connection.
// The schema and roles are disposable and restricted to a local fp_* test DB.
const url=process.env.TEST_DATABASE_URL;
if(!url||!['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname)
  ||!/^\/fp_[a-z0-9_]+$/.test(new URL(url).pathname))
  throw new Error('Explicit disposable local fp_* TEST_DATABASE_URL required');
const id=`${process.pid}_${Date.now()}`;
const schema=`fp_post_acl_${id}`,migrator=`fp_post_m_${id}`,runtimeRole=`fp_post_a_${id}`;
const community=randomUUID(),origin='http://127.0.0.1:4334';
const admin=new Pool({connectionString:url,max:2});
function roleUrl(role:string){const parsed=new URL(url!);parsed.username=role;parsed.password='';return parsed.toString();}
const owner=new Pool({connectionString:roleUrl(migrator),options:`-c search_path=${schema} -c statement_timeout=20000`,max:2});
const runtime=new Pool({connectionString:roleUrl(runtimeRole),options:`-c search_path=${schema} -c statement_timeout=20000`,max:4});
const api=createApp(runtime,origin,'local',{registrationCommunityId:community});
type Session={cookie:string;csrf:string};
let created=false;

before(async()=>{
  assert.ok([schema,migrator,runtimeRole].every(value=>value.length<63));
  await admin.query(`CREATE ROLE ${migrator} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
    CREATE ROLE ${runtimeRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
    CREATE SCHEMA ${schema} AUTHORIZATION ${migrator};
    GRANT USAGE ON SCHEMA ${schema} TO ${runtimeRole}`);
  created=true;
  await migrate(owner);
  // Use the real runtime-grants source, scoped to this disposable schema.
  // This exercises general DML, migration-ledger exclusion and policy fences.
  // It is not a claim that production psql or production grants were applied.
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
  await owner.query('INSERT INTO communities VALUES($1,$2)',[community,'Synthetic restricted-role public sharing']);
});
after(async()=>{
  await runtime.end();await owner.end();
  try{if(created)await admin.query(`DROP SCHEMA ${schema} CASCADE; DROP ROLE ${runtimeRole},${migrator}`);}
  finally{await admin.end();}
});
const denied=(error:unknown)=>(error as {code?:string}).code==='42501';
async function member():Promise<Session>{
  const user=randomUUID(),token=randomBytes(32).toString('base64url');
  await owner.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,onboarding_required)
    VALUES($1,$2,$3,'Synthetic role author','not-a-login',$4,false)`,
    [user,community,`${user}@restricted.local.test`,randomUUID()]);
  await owner.query(`INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at)
    VALUES($1,$2,'synthetic',clock_timestamp()+interval '1 hour')`,[tokenHash(token),user]);
  return {cookie:`freedom_local_session=${token}`,csrf:'synthetic'};
}
async function call(path:string,session?:Session,body?:unknown,headers:Record<string,string>={}){
  const response=await api.request(origin+'/api/v1'+path,{
    method:body===undefined?'GET':'POST',
    headers:{Origin:origin,...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{}),
      ...(body===undefined?{}:{'Content-Type':'application/json','Idempotency-Key':randomUUID()}),...headers},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  return {status:response.status,data:await response.json() as Record<string,any>,headers:response.headers};
}

test('PUBLIC-SHARE-ACL app uses actual non-owner LOGIN sessions and can DML the opted-in publication table only with expected grants',async()=>{
  for(const [pool,role] of [[owner,migrator],[runtime,runtimeRole]] as const){
    const actual=(await pool.query(`SELECT current_user,session_user,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls
      FROM pg_catalog.pg_roles WHERE rolname=current_user`)).rows[0];
    assert.deepEqual(actual,{current_user:role,session_user:role,rolsuper:false,rolcreaterole:false,
      rolcreatedb:false,rolreplication:false,rolbypassrls:false});
  }
  const acl=(await runtime.query(`SELECT
    has_table_privilege(current_user,'community_social_publications','SELECT') AS read,
    has_table_privilege(current_user,'community_social_publications','INSERT') AS insert,
    has_table_privilege(current_user,'community_social_publications','UPDATE') AS update,
    has_table_privilege(current_user,'community_social_publications','DELETE') AS delete,
    has_table_privilege(current_user,'community_social_publications','TRUNCATE') AS truncate,
    has_schema_privilege(current_user,$1,'CREATE') AS ddl`,[schema])).rows[0];
  assert.deepEqual(acl,{read:true,insert:true,update:true,delete:true,truncate:false,ddl:false});
  await assert.rejects(runtime.query('DELETE FROM schema_migrations'),denied);
  await assert.rejects(runtime.query("UPDATE domain_media_storage_policy SET persistence_allowed=true"),denied);
  await assert.rejects(runtime.query('CREATE TABLE illegal_runtime_ddl(id int)'),denied);
});

test('PUBLIC-SHARE-ACL actual app role publishes and revokes only its author-approved current post through HTTP',async()=>{
  const author=await member();
  const made=await call('/social-posts/notes',author,{text:'Bounded synthetic public text'});
  assert.equal(made.status,201,JSON.stringify(made.data));
  const postId=String(made.data.post_id);
  assert.match(postId,/^[0-9a-f-]{36}$/);
  assert.equal((await call(`/public/shared-posts/${postId}`)).status,404);
  assert.equal((await call(`/social-posts/${postId}/public-sharing`)).status,401);
  const initial=await call(`/social-posts/${postId}/public-sharing`,author);
  assert.equal(initial.status,200,JSON.stringify(initial.data));
  assert.equal(initial.data.enabled,false);
  const input={enabled:true,post_revision:initial.data.post_revision,media_version:initial.data.media_version};
  const enabled=await call(`/social-posts/${postId}/public-sharing`,author,input,{'If-Match':`"${initial.data.version}"`});
  assert.equal(enabled.status,200,JSON.stringify(enabled.data));
  assert.equal(enabled.data.available,true);
  const guest=await call(`/public/shared-posts/${postId}`);
  assert.equal(guest.status,200,JSON.stringify(guest.data));
  assert.equal(guest.data.post.note,'Bounded synthetic public text');
  assert.deepEqual(Object.keys(guest.data.post.author),['display_name']);
  assert.ok(!JSON.stringify(guest.data).includes('restricted.local.test'));
  assert.equal(guest.headers.get('cache-control'),'no-store');
  assert.equal((await api.request(origin+`/api/v1/public/shared-posts/${postId}/image`)).status,404);
  assert.equal((await call('/social-posts')).status,401);
  const other=randomUUID(),foreign=createApp(runtime,origin,'local',{registrationCommunityId:other});
  assert.equal((await foreign.request(origin+`/api/v1/public/shared-posts/${postId}`)).status,404);
  const disabled=await call(`/social-posts/${postId}/public-sharing`,author,
    {...input,enabled:false},{'If-Match':`"${enabled.data.version}"`});
  assert.equal(disabled.status,200,JSON.stringify(disabled.data));
  assert.equal((await call(`/public/shared-posts/${postId}`)).status,404);
});
