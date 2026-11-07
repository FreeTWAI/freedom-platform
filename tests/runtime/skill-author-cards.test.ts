import {test,before,after,beforeEach,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createPool,digest,LOCAL_DATABASE_URL} from '../../packages/db/index.js';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_COMMUNITY} from '../../packages/testing/seed.js';
import {createApp} from '../../apps/platform-api/src/app.js';
import {sampleGuildAnswers} from '../../modules/positioning/guild-questions.js';
import {publicMemberCard} from '../../modules/identity-membership/member-sharing.js';
import {GitHubSocialProvider} from '../../modules/github-social/provider.js';
import {failRepositoryMetrics,saveRepositoryMetrics} from '../../modules/github-social/service.js';

const database=process.env.TEST_DATABASE_URL??LOCAL_DATABASE_URL,schema=`fp_skill_author_${process.pid}_${Date.now()}`;
const admin=createPool(database),pool=new Pool({connectionString:database,options:`-c search_path=${schema}`,max:8});
const origin='http://127.0.0.1:4310',app=createApp(pool,origin),path='/skills/video-autopilot/author-card';
type Member={id:string;cookie:string;csrf:string;token?:string};
before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
beforeEach(async()=>{await pool.query('TRUNCATE repo_credit_claim_events,catalog_repo_identity_events,repo_credit_claims,catalog_repo_observations,canonical_repositories,communities,login_attempts,auth_rate_limits,github_repository_metrics CASCADE');await seedLocal(pool);});

async function api(path:string,member?:Member,body?:unknown,version?:number){
  const headers:Record<string,string>={Origin:origin,...(member?{Cookie:member.cookie,'X-CSRF-Token':member.csrf}:{})};
  if(body!==undefined){headers['Content-Type']='application/json';headers['Idempotency-Key']=randomUUID();if(version!==undefined)headers['If-Match']=`"${version}"`;}
  const response=await app.request(origin+'/api/v1'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,data:await response.json() as any,response};
}
async function member(name:string,login?:string,githubId=String(Math.floor(Math.random()*1e12)+1)){
  const registered=await api('/auth/register',undefined,{email:`${randomUUID()}@example.test`,nickname:name,password:'skill-author-card-password'});
  assert.equal(registered.status,201,JSON.stringify(registered.data));
  const result:Member={id:registered.data.user.user_id,cookie:registered.response.headers.get('set-cookie')!.split(';')[0],csrf:registered.data.csrf_token};
  const ready=await api('/me/onboarding/quick-start',result,{guild_keys:['guild_ai_vibe'],primary_guild_key:'guild_ai_vibe',confirmed:true,guild_answers:sampleGuildAnswers('guild_ai_vibe')});
  assert.equal(ready.status,200,JSON.stringify(ready.data));
  if(login)await pool.query('INSERT INTO github_social_connections(user_id,community_id,github_user_id,github_login,encrypted_tokens) VALUES($1,$2,$3,$4,$5)',[result.id,DEMO_COMMUNITY,githubId,login,'private-oauth-fixture-never-public']);
  return result;
}
async function share(member:Member){
  const opened=await api('/me/member-card-share',member,{enabled:true,include_avatar:false,design:'night',headline:'作者公開名片',links:[{label:'作品集',url:'https://example.com/work'}]});
  assert.equal(opened.status,200,JSON.stringify(opened.data));
  member.token=opened.data.share_path.split('/').at(-1);
  return opened.data;
}
async function pin(member:Member,coordinate='Hao0321/video-autopilot-kit',repositoryId='234567'){
  const connection=(await pool.query('SELECT github_user_id FROM github_social_connections WHERE user_id=$1',[member.id])).rows[0];
  const provider=new GitHubSocialProvider(async()=>Response.json({id:Number(repositoryId),full_name:coordinate,owner:{id:Number(connection.github_user_id)},private:false,
    stargazers_count:42,forks_count:7,open_issues_count:2,subscribers_count:1,pushed_at:null,language:'TypeScript',archived:false}));
  await saveRepositoryMetrics(pool,coordinate.toLowerCase(),await provider.metrics(coordinate));
}
async function observed(coordinate='Hao0321/video-autopilot-kit',book='video-autopilot',providerId='234567'){
  const repo=randomUUID();
  await pool.query(`INSERT INTO canonical_repositories(repo_id,provider,provider_repo_id,full_name,current_url) VALUES($1,'github',$2,$3,$4)`,[repo,providerId,coordinate,'https://github.com/'+coordinate]);
  if(book)await pool.query(`INSERT INTO catalog_repo_observations(book_id,provider,provider_repo_id,requested_full_name,full_name,current_url) VALUES($1,'github',$2,$3,$3,$4)`,[book,providerId,coordinate,'https://github.com/'+coordinate]);
  return repo;
}
async function claim(repo:string,member:Member,role='original_author',state='verified'){
  const connection=(await pool.query('SELECT github_user_id,github_login FROM github_social_connections WHERE user_id=$1',[member.id])).rows[0],id=randomUUID();
  await pool.query(`INSERT INTO repo_credit_claims(claim_id,community_id,repo_id,user_id,github_user_id,github_login,role,state,statement,source_snapshot)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,DEMO_COMMUNITY,repo,member.id,connection.github_user_id,connection.github_login,role,state,'private-claim-statement-must-not-leak',{book_id:'video-autopilot'}]);
  return id;
}
function assertPublic(data:unknown,members:Member[]=[]){
  const json=JSON.stringify(data);
  for(const secret of ['private-oauth-fixture','private-claim-statement','owner_ref','user_id','community_id','encrypted_tokens','github_user_id','statement','email','password',...members.map(member=>member.id)])assert.equal(json.includes(secret),false,secret);
}

test('public author cards ignore names and self-entered GitHub contacts; unknown books stay unavailable',async()=>{
  const impostor=await member('Hao');await share(impostor);
  await pool.query('UPDATE member_accounts SET contacts=$2::jsonb WHERE user_id=$1',[impostor.id,JSON.stringify({github:{value:'Hao0321',audiences:['public']}})]);
  assert.deepEqual((await api(path)).data,{items:[]});
  const missing=await api('/skills/does-not-exist/author-card');
  assert.equal(missing.status,404);assert.equal(missing.response.headers.get('cache-control'),'no-store');
});

test('an OAuth-linked source account exposes exactly its opted-in public card without creating authorship or changing state',async()=>{
  const author=await member('Hao 的工坊名片','hAo0321');
  await pin(author);
  assert.deepEqual((await api(path)).data,{items:[]});
  await share(author);
  const before=(await pool.query('SELECT count(*)::int AS n FROM transition_journal')).rows[0].n;
  const result=await api(path);
  assert.equal(result.status,200);assert.equal(result.response.headers.get('cache-control'),'no-store');
  assert.deepEqual(result.data,{items:[{name:'Hao 的工坊名片',role:'來源帳號',card_path:`/member-cards/${author.token}`,card:await publicMemberCard(pool,author.token!)}]});
  assertPublic(result.data,[author]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM repo_credit_claims')).rows[0].n,0);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM transition_journal')).rows[0].n,before);
});

test('card consent, token rotation, active membership, onboarding and test-account restrictions are live on every click',async()=>{
  const author=await member('作者','Hao0321');await share(author);await pin(author);
  assert.equal((await api(path)).data.items.length,1);
  const next=randomBytes(32).toString('base64url');
  await pool.query('UPDATE member_card_shares SET share_token=$2 WHERE user_id=$1',[author.id,next]);
  assert.equal((await api(path)).data.items[0].card_path,'/member-cards/'+next);
  for(const [set,restore] of [
    ['UPDATE member_card_shares SET enabled=false WHERE user_id=$1','UPDATE member_card_shares SET enabled=true WHERE user_id=$1'],
    ['UPDATE users SET active=false WHERE user_id=$1','UPDATE users SET active=true WHERE user_id=$1'],
    ['UPDATE users SET onboarding_required=true,onboarding_completed_at=NULL WHERE user_id=$1','UPDATE users SET onboarding_completed_at=now() WHERE user_id=$1'],
    ["UPDATE users SET email='author-hidden@example.invalid' WHERE user_id=$1","UPDATE users SET email='author-visible@example.test' WHERE user_id=$1"],
  ]){
    await pool.query(set,[author.id]);assert.deepEqual((await api(path)).data,{items:[]},set);
    await pool.query(restore,[author.id]);assert.equal((await api(path)).data.items.length,1,restore);
  }
  await pool.query('DELETE FROM github_social_connections WHERE user_id=$1',[author.id]);
  assert.deepEqual((await api(path)).data,{items:[]});
});

test('a reused GitHub login cannot select the previous account; only the pinned numeric owner can match',async()=>{
  const previous=await member('舊帳號','Hao0321','101');await share(previous);
  const owner=await member('目前來源帳號','hao0321','202');await pin(owner);
  await pool.query('DELETE FROM github_social_connections WHERE user_id=$1',[owner.id]);
  assert.deepEqual((await api(path)).data,{items:[]},'an unlinked current owner cannot borrow the old account with the same login');
  await pool.query('INSERT INTO github_social_connections(user_id,community_id,github_user_id,github_login,encrypted_tokens) VALUES($1,$2,$3,$4,$5)',[owner.id,DEMO_COMMUNITY,'202','hao0321','private-oauth-fixture-never-public']);
  assert.deepEqual((await api(path)).data,{items:[]},'the matching owner must also opt in');
  await share(owner);assert.deepEqual((await api(path)).data.items.map((item:any)=>item.name),['目前來源帳號']);
  await pool.query("UPDATE github_social_connections SET github_login='owner-new-login' WHERE user_id=$1",[owner.id]);
  assert.deepEqual((await api(path)).data.items.map((item:any)=>item.name),['目前來源帳號'],'a login update does not change the numeric identity');
});

test('owner fallback requires a complete matching and recent successful repository identity snapshot',async()=>{
  const author=await member('來源帳號','Hao0321');await share(author);
  assert.deepEqual((await api(path)).data,{items:[]},'a matching login alone is never evidence');
  await pin(author);
  const original=(await pool.query('SELECT snapshot FROM github_repository_metrics')).rows[0].snapshot;
  const key='hao0321/video-autopilot-kit';
  for(const identity of [undefined,{id:'234567',full_name:'Hao0321/video-autopilot-kit'},
    {...original.repository_identity,owner_id:'0'},{...original.repository_identity,owner_id:'9007199254740992'},
    {...original.repository_identity,full_name:'Hao0321/another-repo'}]){
    await pool.query('UPDATE github_repository_metrics SET snapshot=$2::jsonb WHERE repository_key=$1',[key,JSON.stringify({...original,repository_identity:identity})]);
    assert.deepEqual((await api(path)).data,{items:[]});
  }
  await pin(author);await pool.query("UPDATE github_repository_metrics SET checked_at=now()-interval '3 hours 1 second'");
  assert.deepEqual((await api(path)).data,{items:[]},'old ownership never becomes permanent evidence');
  await pin(author);await pool.query("UPDATE github_repository_metrics SET checked_at=now()+interval '1 minute'");
  assert.deepEqual((await api(path)).data,{items:[]},'future timestamps are not freshness evidence');
  await pin(author);await failRepositoryMetrics(pool,key,'github_unavailable');
  assert.deepEqual((await api(path)).data,{items:[]},'failed refresh can retain counts but cannot retain author authority');
  await pin(author);assert.equal((await api(path)).data.items.length,1);
  await observed();await pool.query("UPDATE github_repository_metrics SET snapshot=jsonb_set(snapshot,'{repository_identity,id}','\"999\"')");
  assert.deepEqual((await api(path)).data,{items:[]},'metrics cannot override an observed numeric repository pin');
  await pin(author);assert.equal((await api(path)).data.items.length,1);
});

test('verified original and co-original authors take priority over the source account and maintainers',async()=>{
  const owner=await member('來源帳號','Hao0321','101'),author=await member('真正作者','creator','202'),co=await member('共同作者','co-creator','303'),maintainer=await member('維護者','maintainer','404');
  for(const person of [owner,author,co,maintainer])await share(person);
  await pin(owner);
  const repo=await observed();await claim(repo,author);await claim(repo,co,'co_original_author');await claim(repo,maintainer,'maintainer');
  const result=await api(path);
  assert.deepEqual(result.data.items.map((item:any)=>[item.name,item.role]),[['真正作者','原創作者'],['共同作者','共同原創作者']]);
  assertPublic(result.data,[owner,author,co,maintainer]);
  await pool.query('UPDATE member_card_shares SET enabled=false WHERE user_id=ANY($1::uuid[])',[[author.id,co.id]]);
  assert.deepEqual((await api(path)).data,{items:[]});
});

test('a verified claim must still match the same OAuth identity, not a replacement account',async()=>{
  const author=await member('作者','author','202');await share(author);const repo=await observed();await claim(repo,author);
  assert.equal((await api(path)).data.items.length,1);
  await pool.query("UPDATE github_social_connections SET github_login='renamed-author' WHERE user_id=$1",[author.id]);
  assert.equal((await api(path)).data.items.length,1,'provider id preserves a legitimate rename');
  await pool.query("UPDATE github_social_connections SET github_user_id='999' WHERE user_id=$1",[author.id]);
  assert.deepEqual((await api(path)).data,{items:[]});
});

test('an obsolete original claim cannot suppress the same member’s valid co-original claim after relinking',async()=>{
  const author=await member('共同作者','original-login','101');await share(author);const repo=await observed();await claim(repo,author);
  await pool.query("UPDATE github_social_connections SET github_user_id='202',github_login='new-login' WHERE user_id=$1",[author.id]);
  await claim(repo,author,'co_original_author');
  assert.deepEqual((await api(path)).data.items.map((item:any)=>[item.name,item.role]),[['共同作者','共同原創作者']]);
});

test('disputed authorship, source identity rechecks and rejected owner claims fail closed',async()=>{
  const owner=await member('來源帳號','Hao0321');await share(owner);await pin(owner);const repo=await observed();
  const id=await claim(repo,owner);
  for(const state of ['disputed','revoked','rejected','withdrawn']){
    await pool.query('UPDATE repo_credit_claims SET state=$2 WHERE claim_id=$1',[id,state]);
    assert.deepEqual((await api(path)).data,{items:[]},state);
  }
  await pool.query("UPDATE repo_credit_claims SET state='verified' WHERE claim_id=$1",[id]);
  await pool.query("UPDATE catalog_repo_observations SET needs_recheck=true WHERE book_id='video-autopilot'");
  assert.deepEqual((await api(path)).data,{items:[]});
  await pool.query("UPDATE catalog_repo_observations SET needs_recheck=false,requested_full_name='elsewhere/reused' WHERE book_id='video-autopilot'");
  assert.deepEqual((await api(path)).data,{items:[]});
});

test('conflicting repository identities at the same catalog URL never select a source account',async()=>{
  const author=await member('作者','Hao0321');await share(author);await pin(author);await observed();
  await pool.query("UPDATE catalog_repo_observations SET provider_repo_id='987654' WHERE book_id='video-autopilot'");
  assert.deepEqual((await api(path)).data,{items:[]},'observation cannot borrow claims from the old repository id');
  await pool.query("UPDATE catalog_repo_observations SET provider_repo_id='234567' WHERE book_id='video-autopilot'");
  await observed('Hao0321/video-autopilot-kit','','987654');
  assert.deepEqual((await api(path)).data,{items:[]},'two canonical ids at one URL are ambiguous');
});

test('closing a card or disputing the author during a projection does not return the earlier selection',async()=>{
  const author=await member('作者','Hao0321');await share(author);const repo=await observed(),id=await claim(repo,author);
  const original=pool.query.bind(pool);
  for(const [statement,identity] of [["UPDATE repo_credit_claims SET state='disputed' WHERE claim_id=$1",id],['UPDATE member_card_shares SET enabled=false WHERE user_id=$1',author.id]]){
    await original("UPDATE repo_credit_claims SET state='verified' WHERE claim_id=$1",[id]);
    let changed=false;
    (pool as unknown as {query:(text:unknown,values?:unknown)=>Promise<unknown>}).query=async(text,values)=>{
      if(!changed&&typeof text==='string'&&text.includes('FROM member_card_shares s JOIN users u USING')){
        changed=true;await original(statement,[identity]);
      }
      return original(text as never,values as never);
    };
    try{assert.deepEqual((await api(path)).data,{items:[]});assert.equal(changed,true);}
    finally{(pool as unknown as {query:typeof original}).query=original;}
  }
});

test('an owner pin changed during public-card projection discards the earlier source account',async()=>{
  const author=await member('原來源帳號','Hao0321','101'),replacement=await member('新來源帳號','Hao0321','202');
  await share(author);await share(replacement);await pin(author);
  const original=pool.query.bind(pool);let changed=false;
  (pool as unknown as {query:(text:unknown,values?:unknown)=>Promise<unknown>}).query=async(text,values)=>{
    if(!changed&&typeof text==='string'&&text.includes('FROM member_card_shares s JOIN users u USING')){
      changed=true;await original("UPDATE github_repository_metrics SET snapshot=jsonb_set(snapshot,'{repository_identity,owner_id}','\"202\"')");
    }
    return original(text as never,values as never);
  };
  try{assert.deepEqual((await api(path)).data,{items:[]});assert.equal(changed,true);}
  finally{(pool as unknown as {query:typeof original}).query=original;}
  assert.deepEqual((await api(path)).data.items.map((item:any)=>item.name),['新來源帳號']);
});

async function published(t:TestContext,publisher:Member,ownerId:string|null='202'){
  const sha='b'.repeat(40),requests:string[]=[];
  t.mock.method(globalThis,'fetch',async(input:string|URL|Request)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    requests.push(url);
    if(url==='https://api.github.com/repos/example/project')return Response.json({id:777,full_name:'example/project',private:false,visibility:'public',default_branch:'main',fork:false,archived:false,...(ownerId?{owner:{id:Number(ownerId)}}:{})});
    if(url==='https://api.github.com/repos/example/project/commits/main')return Response.json({sha});
    if(url===`https://api.github.com/repos/example/project/license?ref=${sha}`)return Response.json({path:'LICENSE',license:{spdx_id:'MIT'}});
    throw new Error('Unexpected network request: '+url);
  });
  const saved=await api('/me/skill-submissions/manual',publisher,{repository_url:'https://github.com/example/project',title:'共讀工具',description:'一起整理讀書會筆記的工具。',relationship:'curator'});
  assert.equal(saved.status,201,JSON.stringify(saved.data));
  const id=saved.data.submission_id;
  assert.equal((await api(`/skill-submissions/${id}/author-card`)).status,404,'private draft is not discoverable');
  const result=await api(`/me/skill-submissions/${id}/publish`,publisher,{consent_to_share:true},saved.data.aggregate_version);
  assert.equal(result.status,200,JSON.stringify(result.data));
  assert.equal(requests.length,3,'owner identity reuses the existing metadata GET, commit GET and license GET');
  const snapshot=(await pool.query('SELECT v.source_snapshot FROM skill_submissions s JOIN oss_project_versions v ON v.version_id=s.project_version_id WHERE s.submission_id=$1',[id])).rows[0].source_snapshot;
  assert.equal(snapshot.repository_owner_id,ownerId??undefined,'the published source version stores only server-inspected ownership');
  return id;
}

test('published submissions map the pinned source account, never the curator or a self-declared author',async t=>{
  const publisher=await member('推薦這本的會員','curator','101'),author=await member('來源作者','example','202');
  await share(publisher);await share(author);
  const id=await published(t,publisher),endpoint=`/skill-submissions/${id}/author-card`;
  const result=await api(endpoint);
  assert.equal(result.status,200);assert.equal(result.response.headers.get('cache-control'),'no-store');
  assert.deepEqual(result.data.items.map((item:any)=>item.name),['來源作者']);assertPublic(result.data,[publisher,author]);
  assert.equal(result.data.items[0].role,'收錄來源帳號');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM github_repository_metrics')).rows[0].n,0,'new non-catalog submissions work without manually seeded metrics');
  await pool.query("UPDATE oss_project_versions SET inspected_at=now()-interval '1 year' WHERE version_id=(SELECT project_version_id FROM skill_submissions WHERE submission_id=$1)",[id]);
  assert.equal((await api(endpoint)).data.items.length,1,'the collected version retains its historical source account');
  await pool.query("UPDATE skill_submissions SET payload=jsonb_set(payload,'{relationship}','\"author\"') WHERE submission_id=$1",[id]);
  assert.deepEqual((await api(endpoint)).data.items.map((item:any)=>item.name),['來源作者']);
  await pool.query('UPDATE oss_projects SET sharing_withdrawn_at=now() WHERE project_id=(SELECT project_id FROM skill_submissions WHERE submission_id=$1)',[id]);
  const withdrawn=await api(endpoint);assert.equal(withdrawn.status,404);assert.equal(withdrawn.response.headers.get('cache-control'),'no-store');assertPublic(withdrawn.data,[publisher,author]);
});

test('submission withdrawal during public-card projection is rechecked before returning any author',async t=>{
  const publisher=await member('投稿者','curator','101'),author=await member('作者','example','202');await share(author);
  const id=await published(t,publisher),original=pool.query.bind(pool);let withdrawn=false;
  (pool as unknown as {query:(text:unknown,values?:unknown)=>Promise<unknown>}).query=async(text,values)=>{
    if(!withdrawn&&typeof text==='string'&&text.includes('FROM member_card_shares s JOIN users u USING')){
      withdrawn=true;await original('UPDATE oss_projects SET sharing_withdrawn_at=now() WHERE project_id=(SELECT project_id FROM skill_submissions WHERE submission_id=$1)',[id]);
    }
    return original(text as never,values as never);
  };
  try{const result=await api(`/skill-submissions/${id}/author-card`);assert.equal(result.status,404);assert.equal(withdrawn,true);assert.equal(result.data.items,undefined);}
  finally{(pool as unknown as {query:typeof original}).query=original;}
});

test('legacy collected versions without an owner pin need a recent cache and cannot fall back to login',async t=>{
  const publisher=await member('投稿者'),author=await member('來源帳號','example','202');await share(author);
  const id=await published(t,publisher,null),endpoint=`/skill-submissions/${id}/author-card`;
  assert.deepEqual((await api(endpoint)).data,{items:[]});
  await pin(author,'example/project','777');
  assert.equal((await api(endpoint)).data.items[0].role,'來源帳號','a current cache is not mislabeled as the historical collected owner');
  await pin(author,'example/project','888');assert.deepEqual((await api(endpoint)).data,{items:[]});
});

test('a same-commit published version change during projection cannot return the old collected owner',async t=>{
  const publisher=await member('投稿者'),author=await member('收錄時帳號','example','202'),nextOwner=await member('後來收錄帳號','example','303');
  await share(author);await share(nextOwner);
  const id=await published(t,publisher),endpoint=`/skill-submissions/${id}/author-card`;
  const old=(await pool.query('SELECT v.* FROM skill_submissions s JOIN oss_project_versions v ON v.version_id=s.project_version_id WHERE s.submission_id=$1',[id])).rows[0];
  const snapshot={...old.source_snapshot,repository_owner_id:'303'},next=randomUUID(),{inspected_at:_,...facts}=snapshot;
  await pool.query(`INSERT INTO oss_project_versions(version_id,project_id,repository_id,commit_sha,default_branch,repository_full_name,repository_url,
    readme_url,license_spdx,license_evidence_url,is_fork,archived,source_snapshot,source_sha256,facts_sha256,inspected_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,[next,old.project_id,old.repository_id,old.commit_sha,old.default_branch,
    old.repository_full_name,old.repository_url,old.readme_url,old.license_spdx,old.license_evidence_url,old.is_fork,old.archived,JSON.stringify(snapshot),digest(snapshot),digest(facts),old.inspected_at]);
  const original=pool.query.bind(pool);let changed=false;
  (pool as unknown as {query:(text:unknown,values?:unknown)=>Promise<unknown>}).query=async(text,values)=>{
    if(!changed&&typeof text==='string'&&text.includes('FROM member_card_shares s JOIN users u USING')){
      changed=true;await original('UPDATE skill_submissions SET project_version_id=$2 WHERE submission_id=$1',[id,next]);
    }
    return original(text as never,values as never);
  };
  try{const result=await api(endpoint);assert.equal(result.status,404);assert.equal(changed,true);assert.equal(result.data.items,undefined);}
  finally{(pool as unknown as {query:typeof original}).query=original;}
  assert.deepEqual((await api(endpoint)).data.items.map((item:any)=>item.name),['後來收錄帳號']);
});

test('published source repository ids cannot inherit authorship from a different repository at the same URL',async t=>{
  const publisher=await member('投稿者'),author=await member('來源帳號','example','202');await share(author);
  const id=await published(t,publisher),endpoint=`/skill-submissions/${id}/author-card`;
  assert.equal((await api(endpoint)).data.items.length,1);
  await observed('example/project','','888');
  assert.deepEqual((await api(endpoint)).data,{items:[]});
});
