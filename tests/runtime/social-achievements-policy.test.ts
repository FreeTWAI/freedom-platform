import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SOCIAL_THRESHOLDS,SOCIAL_TITLES,socialProgress,unlockedTitles,titleProjection} from '../../modules/social-achievements/policy.js';
import {recordSocialChat,recordSocialWork} from '../../modules/social-achievements/service.js';
import type {PoolClient} from 'pg';
test('progressive cumulative thresholds do not add hidden age/streak gates',()=>{
 assert.deepEqual(SOCIAL_THRESHOLDS,[1,7,30,90,365]);
 for(const n of SOCIAL_THRESHOLDS){assert.equal(unlockedTitles(n,n).length,(SOCIAL_THRESHOLDS.indexOf(n)+1)*2);assert.equal(socialProgress(n).remaining,(SOCIAL_THRESHOLDS.find(t=>t>n)??n)-n);}
 assert.deepEqual(socialProgress(365),{days:365,next_days:null,remaining:0});assert.equal(unlockedTitles(0,0).length,0);
 assert.equal(SOCIAL_TITLES.length,10);assert.equal(new Set(SOCIAL_TITLES.map(t=>t.title_id)).size,10);
});
test('public title projection is allowlisted and omits progress, peers and dates',()=>{
 for(const t of SOCIAL_TITLES){const dto=titleProjection(t.title_id)!;assert.deepEqual(Object.keys(dto).sort(),['description','label','policy_version','title_id']);assert.match(dto.description,/不代表內容品質/);}
 assert.equal(titleProjection('forged_title'),null);assert.equal(titleProjection(null),null);
});
function fake(rows:unknown[][]){const calls:{sql:string;args:unknown[]}[]=[];let i=0;return {calls,q:{query:async(sql:string,args:unknown[]=[])=>{calls.push({sql,args});const result=rows[i++]??[];return {rows:result,rowCount:result.length};}} as unknown as PoolClient};}
test('non-reply/non-world/ineligible metadata never produces writes',async()=>{
 const f=fake([[]]);await recordSocialChat(f.q,'community','message');assert.equal(f.calls.length,1);assert.match(f.calls[0].sql,/c.kind='world'/);assert.match(f.calls[0].sql,/retracted_at IS NULL/);assert.doesNotMatch(f.calls[0].sql,/\.body|last_seen|heartbeat/);
});
test('both current members must opt in before any paired interaction is retained',async()=>{
 const f=fake([[{first:'a',second:'b',reply_id:'r',source_id:'s',began:'2026-01-01',day:'2026-01-01'}],[],[],[{user_id:'a'}]]);
 await recordSocialChat(f.q,'c','s');assert.equal(f.calls.some(c=>c.sql.startsWith('INSERT')),false);assert.match(f.calls[3].sql,/s.consent_since<=\$3/);assert.match(f.calls[3].sql,/is_verification_test_account/);
});
test('reciprocal block prevents credit without revealing direction',async()=>{
 const f=fake([[{first:'a',second:'b'}],[],[],[{user_id:'a'},{user_id:'b'}],[{blocked:true}]]);await recordSocialChat(f.q,'c','s');assert.equal(f.calls.some(c=>c.sql.startsWith('INSERT')),false);
});
test('monthly pair cap is separate from message send rate limit',async()=>{
 const f=fake([[{first:'a',second:'b'}],[],[],[{},{}],[],[],[],[{n:8}]]);await recordSocialChat(f.q,'c','s');assert.equal(f.calls.some(c=>c.sql.startsWith('INSERT')),false);
});
test('accepted Work remains source-verified community-only, no private body/count mutation',async()=>{
 const f=fake([[{user_id:'a',reviewer_ref:'b'}],[],[],[],[]]);await recordSocialWork(f.q,'c','w');const sql=f.calls.at(-1)!.sql;assert.match(sql,/work_mode='community_collaboration'/);assert.match(sql,/d.decision='accept'/);assert.match(sql,/c.user_id<>d.reviewer_ref/);assert.match(sql,/c.accepted_at>=s.consent_since/);assert.doesNotMatch(sql,/summary|artifact_ref|accepted_count|\.title/);
});

test('Work eighth pair-day credits an independent reverse deliverer, ninth day does not',async()=>{
 const base=[[{user_id:'b',reviewer_ref:'a'}],[],[],[],[{user_id:'b',reviewer_ref:'a',contribution_id:'second',day:'2026-01-08'}],[]];
 const same=fake([...base,[{n:8,same_day:true}],[{}],[],[]]);await recordSocialWork(same.q,'c','w');
 assert.match(same.calls[6].sql,/count\(DISTINCT qualified_day\)/);assert.equal(same.calls.find(c=>c.sql.startsWith('INSERT INTO social_achievement_pairs'))!.args[5],'b');
 assert.ok(same.calls.some(c=>c.sql.startsWith('INSERT INTO social_achievement_days')));
 const ninth=fake([...base,[{n:8,same_day:false}]]);await recordSocialWork(ninth.q,'c','w');assert.equal(ninth.calls.some(c=>c.sql.startsWith('INSERT')),false);
});
test('duplicate Work source or already credited pair/day/deliverer cannot restore erased days',async()=>{
 const f=fake([[{user_id:'a',reviewer_ref:'b'}],[],[],[],[{user_id:'a',reviewer_ref:'b',contribution_id:'old',day:'2026-01-01'}],[],[{n:1,same_day:true}],[]]);
 await recordSocialWork(f.q,'c','w');assert.equal(f.calls.some(c=>c.sql.startsWith('INSERT INTO social_achievement_days')),false);
 assert.match(f.calls[7].sql,/ON CONFLICT DO NOTHING/);
});
test('moderation visibility does not disqualify opted-in partners; awards require active status',async()=>{
 const f=fake([[{first:'a',second:'b',day:'2026-01-01'}],[],[],[{},{}],[],[],[],[{n:0}],[{}],[],[],[],[],[],[]]);
 await recordSocialChat(f.q,'c','s');assert.doesNotMatch(f.calls[3].sql,/s\.status/);
 assert.equal(f.calls.filter(c=>c.sql.startsWith('INSERT INTO social_achievement_days')).length,4);
 assert.equal(f.calls.filter(c=>c.sql.includes("status='active'")).length,2);
 assert.equal(f.calls.some(c=>c.sql.startsWith('INSERT INTO social_achievement_awards')),false);
});

// Composition checks: service-only fixtures cannot prove a mounted opt-out route
// or the runtime flag passed into the existing messaging factory.
import {createApp} from '../../apps/platform-api/src/app.js';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
for(const enabled of [undefined,false,true])test(`composed social settings, withdrawal and review routes follow explicit flag ${enabled}`,async()=>{
 let queries=0;const fail=async()=>{queries++;throw Error('unexpected DB access');};
 const app=createApp({query:fail,connect:fail} as any,'http://127.0.0.1:4310','local',{socialAchievementsEnabled:enabled});
 const paths=app.routes.map(r=>`${r.method} ${r.path}`);
 for(const path of ['GET /api/v1/me/social-achievements','POST /api/v1/me/social-achievements','POST /api/v1/me/social-achievements/erase','POST /api/v1/me/social-achievements/appeal','GET /api/v1/admin/social-achievements','GET /api/v1/admin/social-achievements/:id','POST /api/v1/admin/social-achievements/:id'])assert.equal(paths.includes(path),enabled===true,path);
 const response=await app.request('http://127.0.0.1:4310/api/v1/site');assert.equal((await response.json() as any).social_achievements_enabled,enabled===true);assert.equal(queries,0);
 if(enabled){const denied=await app.request('http://127.0.0.1:4310/api/v1/me/social-achievements/erase',{method:'POST',headers:{Origin:'http://127.0.0.1:4310','Content-Type':'application/json'},body:'{}'});assert.equal(denied.status,401);assert.equal(queries,0);}
});
test('actual composition call passes the explicit social flag to world-chat factory without activating defaults',()=>{
 const source=readFileSync(new URL('../../apps/platform-api/src/platform-app.ts',import.meta.url),'utf8');
 const calls=source.split('\n').filter(line=>line.includes("app.route('/api/v1',createMemberCommunicationRoutes("));assert.equal(calls.length,1);
 for(const enabled of [undefined,false,true,'true',1]){
  let args:unknown[]=[];const pool={},runtime={socialAchievementsEnabled:enabled,memberBlockingEnabled:false};
  runInNewContext(calls[0],{pool,runtime,commerceOrderNotificationsInstalled:()=>false,createMemberCommunicationRoutes:(...values:unknown[])=>{args=values;return {};},app:{route:()=>{}}});
  assert.equal(args.length,5);assert.equal(args[0],pool);assert.equal(args[1],runtime);assert.equal(args[4],enabled===true);
 }
});

test('nonprivileged milestone queries keep member eligibility and consent without an undocumented mailbox gate',async()=>{
 const chat=fake([[{first:'a',second:'b',began:'2026-01-01',day:'2026-01-01'}],[],[],[]]);await recordSocialChat(chat.q,'c','s');
 const chatSql=chat.calls[3].sql;assert.doesNotMatch(chatSql,/email_verified_at/);
 for(const pattern of [/u\.active/,/NOT u\.onboarding_required OR u\.onboarding_completed_at IS NOT NULL/,/NOT is_verification_test_account\(u.user_id\)/,/s.counting_enabled/,/s.consent_since<=\$3/])assert.match(chatSql,pattern);
 const work=fake([[{user_id:'a',reviewer_ref:'b'}],[],[],[],[]]);await recordSocialWork(work.q,'c','w');const workSql=work.calls[4].sql;assert.doesNotMatch(workSql,/email_verified_at/);
 for(const alias of ['u','v']){assert(workSql.includes(`${alias}.active`));assert(workSql.includes(`NOT ${alias}.onboarding_required OR ${alias}.onboarding_completed_at IS NOT NULL`));assert(workSql.includes(`NOT is_verification_test_account(${alias}.user_id)`));}
 assert.match(workSql,/s.counting_enabled/);assert.match(workSql,/c.accepted_at>=s.consent_since/);
});
