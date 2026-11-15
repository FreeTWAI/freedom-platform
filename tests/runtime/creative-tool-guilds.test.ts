import {seedLocal} from '../../packages/testing/seed';
import {migrate} from '../../scripts/database';
import {createApp} from '../../apps/platform-api/src/app';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {readMigrationSources} from '../../packages/db/migration-files.mjs';
import {runMigrationPlan} from '../../packages/db/migration-runner.mjs';
import {legacyMigrationProfile} from '../../packages/db/migration-plan.mjs';
import {resolve} from 'node:path';
import {entryQuestionsForGuild,BUILTIN_GUILD_QUESTION_KEYS,sampleGuildAnswers} from '../../modules/positioning/guild-questions';

for(const integrated of [false,true])test(`206 adds two built-in guilds without requiring books, repositories or category approval (${integrated?'integrated runner':'isolated upgrade'})`,async()=>{
 const url=process.env.TEST_DATABASE_URL;
 assert.ok(url&&new URL(url).hostname==='127.0.0.1'&&new URL(url).pathname.startsWith('/fp_'),'explicit disposable database required');
 const schema='fp_shell_'+randomUUID().replaceAll('-','');
 const admin=new Pool({connectionString:url}),pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
 try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  if(integrated)await migrate(pool);
  else {
   const sources=readMigrationSources(resolve('migrations')).filter(source=>Number(source.name.slice(0,3))<=203);
   await runMigrationPlan(pool,{sources,profile:legacyMigrationProfile({first:1,last:203,known_gaps:[22]})});
   await pool.query(readFileSync(new URL('../../migrations/206_creative_tool_guilds.sql',import.meta.url),'utf8'));
  }
  const rows=(await pool.query("SELECT guild_key,name,module_key FROM positioning_guild_catalog WHERE guild_key IN ('guild_games','guild_ar') ORDER BY guild_key")).rows;
  assert.deepEqual(rows,[{guild_key:'guild_ar',name:'AR 互動公會',module_key:'ar'},{guild_key:'guild_games',name:'小遊戲公會',module_key:'guilds'}]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM positioning_guild_catalog')).rows[0].n,20);
  const states=(await pool.query("SELECT category_review,active FROM guild_catalog_categories WHERE guild_key IN ('guild_games','guild_ar')")).rows;
  assert.equal(states.length,2);for(const state of states){assert.equal(state.category_review,'pending');assert.equal(state.active,true)}
  await seedLocal(pool);
  const origin='http://127.0.0.1:4341',app=createApp(pool,origin);
  for(const key of ['guild_games','guild_ar']){
    assert.ok(BUILTIN_GUILD_QUESTION_KEYS.includes(key));
    const questions=entryQuestionsForGuild(key).questions;assert.equal(questions.length,3);
    const ids=questions.flatMap(q=>q.options.map(o=>o.id));assert.equal(new Set(ids).size,ids.length);
    const registered=await app.request(origin+'/api/v1/auth/register',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify({email:`${randomUUID()}@example.test`,nickname:'合成創作者',password:randomUUID()+randomUUID()})});
    assert.equal(registered.status,201);
    const session=await registered.json() as {csrf_token:string};
    const joined=await app.request(origin+'/api/v1/me/onboarding/quick-start',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:registered.headers.get('set-cookie')!.split(';')[0],'X-CSRF-Token':session.csrf_token,'Idempotency-Key':randomUUID()},body:JSON.stringify({guild_keys:[key],primary_guild_key:key,confirmed:true,guild_answers:sampleGuildAnswers(key)})});
    assert.equal(joined.status,200,await joined.text());
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM positioning_profession_memberships WHERE guild_key=$1',[key])).rows[0].n,1);
  }
 }finally{await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
});
