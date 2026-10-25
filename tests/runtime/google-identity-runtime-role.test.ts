import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Pool,type QueryResult} from 'pg';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {migrate} from '../../scripts/database.js';
import {readMigrationSources} from '../../packages/db/migration-files.mjs';
import {legacyMigrationProfile} from '../../packages/db/migration-plan.mjs';
import {runMigrationPlan} from '../../packages/db/migration-runner.mjs';
import {seedLocal,DEMO_USERS,DEMO_PASSWORD} from '../../packages/testing/seed.js';
import {login,tokenHash} from '../../modules/identity-membership/service.js';
import {startGoogleLogin,completeGoogleLogin,activateGoogleLogin,unlinkGoogleIdentity,type GoogleLoginOptions} from '../../modules/identity-membership/google/service.js';
import {pruneExpiredAuthRecords} from '../../modules/identity-membership/auth-pruning.js';

const url=process.env.TEST_DATABASE_URL;
if(!url||!['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname)||!/^\/fp_[a-z0-9_]+$/.test(new URL(url).pathname))throw Error('Explicit disposable local fp_* TEST_DATABASE_URL required');
const admin=new Pool({connectionString:url}),stamp=`${process.pid}_${Date.now()}`;
const tables=['member_login_identities','google_login_states','google_login_challenges','google_login_activations'] as const;
const denied=(error:unknown)=>(error as {code?:string}).code==='42501';
function fixture(mode:string){
 const schema=`fp_gacl_${mode}_${stamp}`,names={owner:`${schema}_m`,app:`${schema}_a`,broker:`${schema}_b`,executor:`${schema}_e`,untrusted:`${schema}_u`};
 const pools=Object.fromEntries(Object.entries(names).map(([key,name])=>{const parsed=new URL(url!);parsed.username=name;parsed.password='';return [key,new Pool({connectionString:parsed.toString(),options:`-c search_path=${schema} -c statement_timeout=20000`,max:3})];})) as Record<keyof typeof names,Pool>;
 return {schema,names,pools,created:false};
}
const fixtures=[fixture('defaults'),fixture('repair')];
// Execute every canonical SQL statement and every generated gexec row. Only
// fixture schema/role identifiers change; no psql/deployment execution is claimed.
async function grants(f:ReturnType<typeof fixture>,file:string,variable:string,role:string){
 const source=await readFile(new URL(`../../deploy/cloudflare/sql/${file}`,import.meta.url),'utf8');
 const sql=source.slice(source.indexOf('BEGIN;')).replaceAll('SCHEMA public',`SCHEMA ${f.schema}`).replaceAll("'public'",`'${f.schema}'`).replaceAll(`:"${variable}"`,`"${role}"`).replaceAll(`:'${variable}'`,`'${role}'`);
 const chunks=sql.split(/^\\gexec\s*$/m),q=await f.pools.owner.connect();
 try{for(let i=0;i<chunks.length;i++){
  const result=await q.query(chunks[i]);
  if(i<chunks.length-1){const last=(Array.isArray(result)?result.at(-1):result) as QueryResult;for(const row of last.rows){assert.equal(Object.keys(row).length,1);await q.query(Object.values(row)[0] as string);}}
 }}catch(error){await q.query('ROLLBACK');throw error;}finally{q.release();}
}
async function allGrants(f:ReturnType<typeof fixture>){await grants(f,'20-runtime-grants.psql','runtime',f.names.app);await grants(f,'40-credential-broker-grants.psql','broker',f.names.broker);await grants(f,'45-model-broker-execution-grants.psql','executor',f.names.executor);}
before(async()=>{
 for(const f of fixtures){
  for(const name of Object.values(f.names)){assert.ok(name.length<63);await admin.query(`CREATE ROLE ${name} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);}
  f.created=true;await admin.query(`CREATE SCHEMA ${f.schema} AUTHORIZATION ${f.names.owner}; GRANT USAGE ON SCHEMA ${f.schema} TO ${f.names.app},${f.names.broker},${f.names.executor},${f.names.untrusted}`);
  if(f===fixtures[0]){
   const sources=readMigrationSources(fileURLToPath(new URL('../../migrations',import.meta.url))).filter((s:{name:string})=>s.name<'190_');
   await runMigrationPlan(f.pools.owner,{sources,profile:legacyMigrationProfile({first:1,last:189,known_gaps:[22]})});
   await allGrants(f);await migrate(f.pools.owner); // No post-190 grant: prove migrator default privileges.
  }else{
   await migrate(f.pools.owner);
   for(const table of tables)await assert.rejects(f.pools.app.query(`SELECT * FROM ${table}`),denied);
   await allGrants(f);await allGrants(f); // Repair is complete and repeatable.
  }
  await seedLocal(f.pools.owner);
 }
});
after(async()=>{for(const f of fixtures){await Promise.all(Object.values(f.pools).map(p=>p.end()));if(f.created)await admin.query(`DROP SCHEMA ${f.schema} CASCADE; DROP ROLE ${Object.values(f.names).join(',')}`);}await admin.end();});

for(const f of fixtures){
 test(`${f.schema.includes('defaults')?'pre-190 defaults':'post-190 repair'}: real LOGIN role ACLs restrict Google tables to ordinary app`,async()=>{
  for(const [key,pool] of Object.entries(f.pools)){
   const actual=(await pool.query('SELECT current_user,session_user,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,rolinherit FROM pg_roles WHERE rolname=current_user')).rows[0];
   assert.deepEqual(actual,{current_user:f.names[key as keyof typeof f.names],session_user:f.names[key as keyof typeof f.names],rolsuper:false,rolcreaterole:false,rolcreatedb:false,rolreplication:false,rolbypassrls:false,rolinherit:false});
   assert.equal((await pool.query('SELECT count(*)::int n FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user)')).rows[0].n,0);
  }
  for(const table of tables){
   const acl=(await f.pools.app.query(`SELECT has_table_privilege(current_user,$1,'SELECT') r,has_table_privilege(current_user,$1,'INSERT') i,has_table_privilege(current_user,$1,'UPDATE') u,has_table_privilege(current_user,$1,'DELETE') d,has_table_privilege(current_user,$1,'TRUNCATE,REFERENCES,TRIGGER,SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION') unsafe`,[table])).rows[0];
   assert.deepEqual(acl,{r:true,i:true,u:true,d:true,unsafe:false});
   for(const pool of [f.pools.broker,f.pools.executor,f.pools.untrusted]){
    for(const sql of [`SELECT * FROM ${table}`,`INSERT INTO ${table} DEFAULT VALUES`,`DELETE FROM ${table}`,`UPDATE ${table} SET ${table==='member_login_identities'?'revoked_at':'expires_at'}=NULL`])await assert.rejects(pool.query(sql),denied);
   }
   await assert.rejects(f.pools.app.query(`TRUNCATE ${table}`),denied);
   await assert.rejects(f.pools.app.query(`ALTER TABLE ${table} ADD COLUMN forbidden text`),denied);
   // PostgreSQL may report non-owner GRANT as a warning rather than an error.
   // Prove it conveys no authority rather than weakening the expected SQLSTATE.
   await f.pools.app.query(`GRANT SELECT ON ${table} TO ${f.names.untrusted}`);
   await assert.rejects(f.pools.untrusted.query(`SELECT * FROM ${table}`),denied);
  }
  await assert.rejects(f.pools.app.query(`CREATE TABLE ${f.schema}.forbidden(id int)`),denied);
  await assert.rejects(f.pools.app.query('DELETE FROM schema_migrations'),denied);
  await assert.rejects(f.pools.app.query('SELECT * FROM broker_credential_vault'),denied);
  assert.deepEqual((await f.pools.owner.query('SELECT relrowsecurity FROM pg_class WHERE oid=ANY($1::regclass[])',[tables])).rows.map(r=>r.relrowsecurity),[false,false,false,false]);
  // Global auth tables are NOT tenant RLS tables. Tenant API authorization still
  // belongs to the existing app boundary; broker/executor roles gain no access.
 });
 test(`${f.schema.includes('defaults')?'pre-190 defaults':'post-190 repair'}: app role completes signup, dormant ACK, explicit link/unlink and pruning`,async()=>{
  const pool=f.pools.app,origin='http://127.0.0.1:4310',keys=await generateKeyPair('RS256'),jwk={...await exportJWK(keys.publicKey),kid:'restricted-fixture',alg:'RS256'};let idToken='';
  const options:GoogleLoginOptions={enabled:true,clientId:'restricted-fixture',clientSecret:'fixture-only',transport:async(url)=>Response.json(String(url).endsWith('/certs')?{keys:[jwk]}:{id_token:idToken})};
  const communityId=(await pool.query('SELECT community_id FROM users LIMIT 1')).rows[0].community_id;
  const registration={communityId,allowSingleCommunity:false,network:randomUUID()};
  async function flow(actor?:Awaited<ReturnType<typeof login>>['actor']){
   const start=await startGoogleLogin(pool,options,origin,undefined,actor,actor?DEMO_PASSWORD:undefined),params=new URL(start.url).searchParams;
   idToken=await new SignJWT({nonce:params.get('nonce'),email:`${randomUUID()}@gmail.com`,email_verified:true}).setProtectedHeader({alg:'RS256',kid:'restricted-fixture'}).setIssuer('https://accounts.google.com').setAudience(options.clientId).setSubject(randomUUID()).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
   return {state:params.get('state')!,code:'fixture-code',verifier:start.verifier};
  }
  const first=await flow(),pending=await completeGoogleLogin(pool,options,origin,first,registration);assert.ok('activation_required'in pending&&pending.activation_required);
  assert.equal((await pool.query('SELECT expires_at<=clock_timestamp() dormant FROM sessions WHERE token_hash=$1',[tokenHash(pending.token)])).rows[0].dormant,true);
  const active=await activateGoogleLogin(pool,options,{activation:pending.activation,verifier:first.verifier,rawSession:pending.token});assert.equal(active.registered,true);
  assert.equal((await pool.query('SELECT password_hash FROM users WHERE user_id=$1',[active.actor.user_id])).rows[0].password_hash,null);
  const existing=await login(pool,DEMO_USERS[0].email,DEMO_PASSWORD);assert.deepEqual(await completeGoogleLogin(pool,options,origin,await flow(existing.actor),registration,existing.actor),{linked:true});
  const generation=(await pool.query('SELECT identity_id FROM member_login_identities WHERE user_id=$1 AND revoked_at IS NULL',[existing.actor.user_id])).rows[0].identity_id;
  await unlinkGoogleIdentity(pool,existing.actor,DEMO_PASSWORD,generation);
  assert.equal((await pool.query('SELECT count(*)::int n FROM member_login_identities WHERE user_id=$1 AND revoked_at IS NOT NULL',[existing.actor.user_id])).rows[0].n,1);
  const abandoned=await flow(),expired=await completeGoogleLogin(pool,options,origin,abandoned,registration);assert.ok('activation_required'in expired&&expired.activation_required);
  await pool.query("UPDATE google_login_activations SET expires_at=clock_timestamp()-interval '1 second' WHERE session_hash=$1",[tokenHash(expired.token)]);
  await pruneExpiredAuthRecords(pool,{batch:10});assert.equal((await pool.query('SELECT 1 FROM sessions WHERE token_hash=$1',[tokenHash(expired.token)])).rowCount,0);
 });
}
