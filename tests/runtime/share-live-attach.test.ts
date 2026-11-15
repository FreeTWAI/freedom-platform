import {test,before,after,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createApp} from '../../apps/platform-api/src/app.js';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_USERS,DEMO_PASSWORD,DEMO_COMMUNITY} from '../../packages/testing/seed.js';
import {transaction} from '../../packages/db/index.js';
import {login,type Actor} from '../../modules/identity-membership/service.js';
import {importProject} from '../../modules/opensource-marketing/service.js';
import {prepareProjectSkillSubmission,publishSubmission,withdrawProjectPublication} from '../../modules/skill-submissions/service.js';
import {planShareBackfill,applyShareBackfill} from '../../modules/shares/backfill.js';
import {
  attachMemberRepositoryShare,
  attachRepositorySources,
  bookSource,
  projectRows,
  projectSource,
  submissionRows,
  submissionSource,
} from '../../modules/shares/repository-sources.js';

const url=process.env.TEST_DATABASE_URL;
assert.ok(url,'Set an isolated TEST_DATABASE_URL');
const schema=`fp_sharelive_${randomUUID().replaceAll('-','')}`;
const admin=new Pool({connectionString:url});
const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});

const SHA='a'.repeat(40);
const repos:Record<string,{id:number;full_name:string;fork:boolean;source?:{full_name:string}}>={
  'fixture/s1':{id:9001,full_name:'fixture/s1',fork:false},
  'fixture/original':{id:921,full_name:'fixture/original',fork:false},
  'fixture/fork':{id:922,full_name:'fixture/fork',fork:true,source:{full_name:'fixture/original'}},
  'fixture/deferred-original':{id:931,full_name:'fixture/deferred-original',fork:false},
  'fixture/deferred-fork':{id:932,full_name:'fixture/deferred-fork',fork:true,source:{full_name:'fixture/deferred-original'}},
  'fixture/withdrawn-original':{id:941,full_name:'fixture/withdrawn-original',fork:false},
  'fixture/withdrawn-fork':{id:942,full_name:'fixture/withdrawn-fork',fork:true,source:{full_name:'fixture/withdrawn-original'}},
  'fixture/noconsent-original':{id:951,full_name:'fixture/noconsent-original',fork:false},
  'fixture/noconsent-fork':{id:952,full_name:'fixture/noconsent-fork',fork:true,source:{full_name:'fixture/noconsent-original'}},
  'fixture/r3a-original':{id:961,full_name:'fixture/r3a-original',fork:false},
  'fixture/r3a-fork':{id:962,full_name:'fixture/r3a-fork',fork:true,source:{full_name:'fixture/r3a-original'}},
  'fixture/r3d-rest':{id:971,full_name:'fixture/r3d-rest',fork:false},
  'fixture/r3d-mcp':{id:972,full_name:'fixture/r3d-mcp',fork:false},
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
      owner:{id:990+entry.id%100,login:'fixture'},
      default_branch:'main',
      description:`Repo ${entry.full_name}`,
      stargazers_count:17,
    });
  }
  if(/^\/repos\/fixture\/[^/]+\/commits\/main$/.test(pathname))return Response.json({sha:SHA});
  if(/^\/repos\/fixture\/[^/]+\/license$/.test(pathname))return Response.json({path:'LICENSE',license:{spdx_id:'MIT'}});
  return new Response(`unexpected ${pathname}`,{status:404});
};

let actorA:Actor;
let actorB:Actor;
let projectA:any;
let shareAId:string;
let submissionAId:string;

before(async()=>{
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
  await seedLocal(pool);
  await pool.query('UPDATE users SET onboarding_required=false');
  actorA=(await login(pool,DEMO_USERS[0].email,DEMO_PASSWORD)).actor;
  actorB=(await login(pool,DEMO_USERS[1].email,DEMO_PASSWORD)).actor;
});

after(async()=>{
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

test('S1: repository-sources helpers filter rows, omit optional counts and hold canonical advisory lock',async()=>{
  const projectId=randomUUID();
  await pool.query(
    `INSERT INTO oss_projects(project_id,community_id,owner_ref,title,description,use_notes,repository_id,repository_full_name,repository_url,relationship)
     VALUES($1,$2,$3,'S1 Project','Desc','Notes','9001','fixture/s1','https://github.com/fixture/s1','curator')`,
    [projectId,DEMO_COMMUNITY,actorA.user_id]
  );
  const rows=await projectRows(pool,{project_id:projectId});
  assert.equal(rows.length,1);
  assert.equal(rows[0].project_id,projectId);
  assert.equal((await submissionRows(pool,{submission_id:randomUUID()})).length,0);
  const bSource=bookSource(DEMO_COMMUNITY,{
    id:'s1-book',title:'S1 Book',repository_url:'https://github.com/fixture/s1',description:'',kind:'skill',
    fork_url:'https://github.com/fixture/s1',license_status:'open',upstream_url:'https://github.com/fixture/s1',
    source_commit:SHA,introduction_points:[],guide:null,cover_url:null,
  } as any);
  assert.equal(bSource.legacy.kind,'book');
  assert.equal(typeof submissionSource,'function');
  const facts={
    id:'9001',full_name:'fixture/s1',url:'https://github.com/fixture/s1',description:'Desc',archived:false,
    fork:false,owner_id:'990',owner_login:'fixture',default_branch:'main',topics:[],homepage:null,
    license_spdx:'MIT',stars:0,
  };
  let lockFreeInside:boolean|null=null;
  const shareId=await transaction(pool,async q=>{
    const id=await attachRepositorySources(q,{community:DEMO_COMMUNITY,facts,sources:[projectSource(rows[0])]});
    const probe=await pool.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS free',[`share/${DEMO_COMMUNITY}/repository/github:9001`]);
    lockFreeInside=probe.rows[0].free;
    return id;
  });
  assert.ok(shareId);
  assert.equal(lockFreeInside,false);
  const afterProbe=await pool.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS free',[`share/${DEMO_COMMUNITY}/repository/github:9001`]);
  assert.equal(afterProbe.rows[0].free,true);
});

test('a. fork project attaches to one original repository share and credits sharer once',async()=>{
  projectA=await importProject(pool,{
    actor:actorA,
    operation:'POST /api/v1/opensource/projects',
    key:randomUUID(),
    body:{
      repository_url:'https://github.com/fixture/fork',
      title:'Fork Skill Project',
      description:'Project description',
      use_notes:'How to use this fork',
      demo_url:null,
      relationship:'curator',
      consent_to_share:true,
    },
  },{fetcher});
  const attached=await attachMemberRepositoryShare(pool,{project_id:projectA.project_id},{fetcher});
  assert.ok(attached);
  shareAId=attached;
  const shareRow=(await pool.query("SELECT share_id,kind,canonical_key,legacy_ref FROM shares WHERE community_id=$1 AND kind='repository' AND canonical_key='github:921'",[DEMO_COMMUNITY])).rows[0];
  assert.equal(shareRow.share_id,shareAId);
  assert.deepEqual(shareRow.legacy_ref,[{kind:'oss_project',id:projectA.project_id}]);
  const projRow=(await pool.query('SELECT share_id FROM oss_projects WHERE project_id=$1',[projectA.project_id])).rows[0];
  assert.equal(projRow.share_id,shareAId);
  const credits=(await pool.query("SELECT role,basis,user_id FROM share_credit_events WHERE share_id=$1 AND user_id=$2",[shareAId,actorA.user_id])).rows;
  assert.equal(credits.length,1);
  assert.equal(credits[0].role,'sharer');
  assert.equal(credits[0].basis,'created');
});

test('b. published consented submission joins the same share without second sharer credit and credits qualified click',async()=>{
  const prepared:any=await prepareProjectSkillSubmission(pool,{
    actor:actorA,
    operation:'POST /api/v1/opensource/projects/:id/skill-submission',
    key:randomUUID(),
    body:{},
    expected:projectA.aggregate_version,
  },projectA.project_id);
  const published=await publishSubmission(pool,{
    actor:actorA,
    operation:'POST /api/v1/me/skill-submissions/:id/publish',
    key:randomUUID(),
    body:{consent_to_share:true},
    expected:prepared.submission.aggregate_version,
  },prepared.submission.submission_id,{fetcher});
  submissionAId=published.submission_id;
  const attached=await attachMemberRepositoryShare(pool,{project_id:projectA.project_id,submission_id:submissionAId},{fetcher});
  assert.equal(attached,shareAId);
  const shareRow=(await pool.query('SELECT legacy_ref FROM shares WHERE share_id=$1',[shareAId])).rows[0];
  assert.equal(shareRow.legacy_ref.length,2);
  assert.ok(shareRow.legacy_ref.some((r:any)=>r.kind==='oss_project'&&r.id===projectA.project_id));
  assert.ok(shareRow.legacy_ref.some((r:any)=>r.kind==='skill_submission'&&r.id===submissionAId));
  const subRow=(await pool.query('SELECT share_id FROM skill_submissions WHERE submission_id=$1',[submissionAId])).rows[0];
  assert.equal(subRow.share_id,shareAId);
  const sharerCredits=(await pool.query("SELECT count(*)::int AS n FROM share_credit_events WHERE share_id=$1 AND user_id=$2 AND role='sharer'",[shareAId,actorA.user_id])).rows[0].n;
  assert.equal(sharerCredits,1);

  const linkId=(await pool.query(
    `INSERT INTO promotion_links(community_id,user_id,kind,target_key,code) VALUES($1,$2,'skill_book',$3,$4) RETURNING link_id`,
    [DEMO_COMMUNITY,actorA.user_id,`submission:${submissionAId}`,randomBytes(7).toString('base64url')]
  )).rows[0].link_id;
  await pool.query(
    `INSERT INTO promotion_clicks(link_id,click_day,visitor_key,network_key,community_id,user_id,kind,created_at)
     VALUES($1,'2026-11-14',$2,$3,$4,$5,'skill_book','2026-11-14T12:00:00Z')`,
    [linkId,`m:${actorB.user_id}`,'a'.repeat(64),DEMO_COMMUNITY,actorA.user_id]
  );
  const clickCredits=(await pool.query(
    "SELECT role,basis,actor_user_id FROM share_credit_events WHERE share_id=$1 AND user_id=$2 AND basis='qualified_click_day'",
    [shareAId,actorA.user_id]
  )).rows;
  assert.equal(clickCredits.length,1);
  assert.equal(clickCredits[0].role,'spreader');
  assert.equal(clickCredits[0].actor_user_id,actorB.user_id);
});

test('c. repeat attach and subsequent share backfill change nothing',async()=>{
  const repeat=await attachMemberRepositoryShare(pool,{project_id:projectA.project_id,submission_id:submissionAId},{fetcher:async()=>{throw new Error('must not hit GitHub when already attached');}});
  assert.equal(repeat,shareAId);
  const plan=await planShareBackfill(pool,{fetcher},[]);
  const counts=await applyShareBackfill(pool,plan,true);
  assert.deepEqual(counts,{repositories:0,shares:0,credits:0,notes:0,links:0});
  const shareRow=(await pool.query('SELECT share_id,legacy_ref FROM shares WHERE share_id=$1',[shareAId])).rows[0];
  assert.equal(shareRow.legacy_ref.length,2);
  assert.equal((await pool.query('SELECT share_id FROM oss_projects WHERE project_id=$1',[projectA.project_id])).rows[0].share_id,shareAId);
  assert.equal((await pool.query('SELECT share_id FROM skill_submissions WHERE submission_id=$1',[submissionAId])).rows[0].share_id,shareAId);
  const creditCount=(await pool.query('SELECT count(*)::int AS n FROM share_credit_events WHERE share_id=$1',[shareAId])).rows[0].n;
  assert.equal(creditCount,2);
});

test('d. rejecting fetcher returns null, writes nothing, logs share_attach_deferred, and later backfill attaches',async()=>{
  const deferred=await importProject(pool,{
    actor:actorA,
    operation:'POST /api/v1/opensource/projects',
    key:randomUUID(),
    body:{
      repository_url:'https://github.com/fixture/deferred-fork',
      title:'Deferred Project',
      description:'Deferred description',
      use_notes:'Deferred notes',
      demo_url:null,
      relationship:'curator',
      consent_to_share:true,
    },
  },{fetcher});
  const beforeShares=(await pool.query('SELECT count(*)::int AS n FROM shares')).rows[0].n;
  const beforeCredits=(await pool.query('SELECT count(*)::int AS n FROM share_credit_events')).rows[0].n;
  const originalWarn=console.warn;
  const warnings:unknown[][]=[];
  console.warn=(...args:unknown[])=>{warnings.push(args);};
  let result:string|null='unexpected';
  try{
    result=await attachMemberRepositoryShare(pool,{project_id:deferred.project_id},{fetcher:async()=>{throw new Error('network down');}});
  }finally{
    console.warn=originalWarn;
  }
  assert.equal(result,null);
  assert.equal((await pool.query('SELECT share_id FROM oss_projects WHERE project_id=$1',[deferred.project_id])).rows[0].share_id,null);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM shares')).rows[0].n,beforeShares);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM share_credit_events')).rows[0].n,beforeCredits);
  assert.equal(warnings.length,1);
  assert.equal(warnings[0].length,1);
  const logged=JSON.parse(String(warnings[0][0]));
  assert.deepEqual(Object.keys(logged).sort(),['code','event','project_id','submission_id']);
  assert.equal(logged.event,'share_attach_deferred');
  assert.equal(logged.project_id,deferred.project_id);
  assert.equal(logged.submission_id,null);
  assert.equal(logged.code,'github_unavailable');

  const plan=await planShareBackfill(pool,{fetcher},[]);
  const counts=await applyShareBackfill(pool,plan,true);
  assert.equal(counts.shares,1);
  const attachedShareId=(await pool.query('SELECT share_id FROM oss_projects WHERE project_id=$1',[deferred.project_id])).rows[0].share_id;
  assert.ok(attachedShareId);
  assert.equal((await pool.query("SELECT canonical_key FROM shares WHERE share_id=$1",[attachedShareId])).rows[0].canonical_key,'github:931');
});

test('e. withdrawn project returns null and unconsented submission is left out while project attaches alone',async()=>{
  const withdrawn=await importProject(pool,{
    actor:actorA,
    operation:'POST /api/v1/opensource/projects',
    key:randomUUID(),
    body:{
      repository_url:'https://github.com/fixture/withdrawn-fork',
      title:'Withdrawn Project',
      description:'Withdrawn desc',
      use_notes:'Withdrawn notes',
      demo_url:null,
      relationship:'curator',
      consent_to_share:true,
    },
  },{fetcher});
  await withdrawProjectPublication(pool,{
    actor:actorA,
    operation:'POST /api/v1/opensource/projects/:id/withdraw',
    key:randomUUID(),
    body:{},
    expected:withdrawn.aggregate_version,
  },withdrawn.project_id);
  const sharesBefore=(await pool.query('SELECT count(*)::int AS n FROM shares')).rows[0].n;
  const withdrawnResult=await attachMemberRepositoryShare(pool,{project_id:withdrawn.project_id},{fetcher});
  assert.equal(withdrawnResult,null);
  assert.equal((await pool.query('SELECT share_id FROM oss_projects WHERE project_id=$1',[withdrawn.project_id])).rows[0].share_id,null);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM shares')).rows[0].n,sharesBefore);

  const noconsentProj=await importProject(pool,{
    actor:actorA,
    operation:'POST /api/v1/opensource/projects',
    key:randomUUID(),
    body:{
      repository_url:'https://github.com/fixture/noconsent-fork',
      title:'No Consent Project',
      description:'No consent desc',
      use_notes:'No consent notes',
      demo_url:null,
      relationship:'curator',
      consent_to_share:true,
    },
  },{fetcher});
  const unconsented:any=await prepareProjectSkillSubmission(pool,{
    actor:actorA,
    operation:'POST /api/v1/opensource/projects/:id/skill-submission',
    key:randomUUID(),
    body:{},
    expected:noconsentProj.aggregate_version,
  },noconsentProj.project_id);
  const attachedShareId=await attachMemberRepositoryShare(pool,{project_id:noconsentProj.project_id,submission_id:unconsented.submission.submission_id},{fetcher});
  assert.ok(attachedShareId);
  assert.equal((await pool.query('SELECT share_id FROM oss_projects WHERE project_id=$1',[noconsentProj.project_id])).rows[0].share_id,attachedShareId);
  assert.equal((await pool.query('SELECT share_id FROM skill_submissions WHERE submission_id=$1',[unconsented.submission.submission_id])).rows[0].share_id,null);
  const legacy=(await pool.query('SELECT legacy_ref FROM shares WHERE share_id=$1',[attachedShareId])).rows[0].legacy_ref;
  assert.deepEqual(legacy,[{kind:'oss_project',id:noconsentProj.project_id}]);

  const wrongSubResult=await attachMemberRepositoryShare(pool,{project_id:noconsentProj.project_id,submission_id:submissionAId},{fetcher});
  assert.equal(wrongSubResult,attachedShareId);
  assert.deepEqual((await pool.query('SELECT legacy_ref FROM shares WHERE share_id=$1',[attachedShareId])).rows[0].legacy_ref,[{kind:'oss_project',id:noconsentProj.project_id}]);
  assert.equal((await pool.query('SELECT share_id FROM skill_submissions WHERE submission_id=$1',[submissionAId])).rows[0].share_id,shareAId);
});

const ORIGIN='http://127.0.0.1:4310';
type Session={cookie:string;csrf:string;user:any};

function createLiveApp(scheduled:Array<()=>Promise<void>>){
  return createApp(pool,ORIGIN,'local',{
    githubSocial:{fetcher},
    afterResponse:work=>{scheduled.push(work);},
  });
}

async function httpJson(
  app:ReturnType<typeof createApp>,
  path:string,
  opts:{session?:Session;token?:string;body?:unknown;version?:string|number;key?:string;method?:string;headers?:Record<string,string>}={}
){
  const {session,token,body,version,key=randomUUID(),method=body===undefined?'GET':'POST'}=opts;
  const headers:Record<string,string>={
    ...(!token?{Origin:ORIGIN}:{}),
    ...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{}),
    ...(token?{Authorization:`Bearer ${token}`}:{}),
    ...opts.headers,
  };
  if(body!==undefined){
    headers['Content-Type']='application/json';
    if(!opts.headers?.['Idempotency-Key']&&path!=='/api/v1/auth/login'&&path!=='/api/v1/mcp'){
      headers['Idempotency-Key']=key;
    }
    if(version!==undefined)headers['If-Match']=`"${version}"`;
  }
  const response=await app.request(ORIGIN+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const type=response.headers.get('Content-Type')??'';
  return {status:response.status,data:type.includes('json')?await response.json() as any:null,response};
}

async function loginMember(app:ReturnType<typeof createApp>,email=DEMO_USERS[0].email):Promise<Session>{
  const r=await httpJson(app,'/api/v1/auth/login',{body:{email,password:DEMO_PASSWORD}});
  assert.equal(r.status,200,JSON.stringify(r.data));
  return {cookie:r.response.headers.get('set-cookie')!.split(';')[0],csrf:r.data.csrf_token,user:r.data.user};
}

let r3aProject:any;
let r3aShareId:string;

test('R3a. POST /api/v1/opensource/projects schedules attach after response and credits sharer',async t=>{
  t.mock.method(globalThis,'fetch',fetcher);
  const scheduled:Array<()=>Promise<void>>=[];
  const app=createLiveApp(scheduled);
  const session=await loginMember(app,DEMO_USERS[0].email);
  const res=await httpJson(app,'/api/v1/opensource/projects',{
    session,
    body:{
      repository_url:'https://github.com/fixture/r3a-fork',
      title:'R3a Live Fork Project',
      description:'Live attach project description',
      use_notes:'Live attach use notes',
      demo_url:null,
      relationship:'curator',
      consent_to_share:true,
    },
  });
  assert.equal(res.status,201,JSON.stringify(res.data));
  assert.deepEqual(Object.keys(res.data).sort(),Object.keys(JSON.parse(JSON.stringify(projectA))).sort());
  assert.equal(scheduled.length,1);
  assert.equal((await pool.query('SELECT share_id FROM oss_projects WHERE project_id=$1',[res.data.project_id])).rows[0].share_id,null);

  await scheduled[0]();
  r3aProject=res.data;
  const shareRow=(await pool.query("SELECT share_id,kind,canonical_key,legacy_ref FROM shares WHERE community_id=$1 AND kind='repository' AND canonical_key='github:961'",[DEMO_COMMUNITY])).rows[0];
  assert.ok(shareRow);
  r3aShareId=shareRow.share_id;
  assert.deepEqual(shareRow.legacy_ref,[{kind:'oss_project',id:r3aProject.project_id}]);
  assert.equal((await pool.query('SELECT share_id FROM oss_projects WHERE project_id=$1',[r3aProject.project_id])).rows[0].share_id,r3aShareId);
  const credits=(await pool.query('SELECT role,basis,user_id FROM share_credit_events WHERE share_id=$1 AND user_id=$2',[r3aShareId,actorA.user_id])).rows;
  assert.equal(credits.length,1);
  assert.equal(credits[0].role,'sharer');
  assert.equal(credits[0].basis,'created');
});

test('R3b. POST /api/v1/me/skill-submissions/:id/publish schedules attach and joins project share',async t=>{
  t.mock.method(globalThis,'fetch',fetcher);
  const scheduled:Array<()=>Promise<void>>=[];
  const app=createLiveApp(scheduled);
  const session=await loginMember(app,DEMO_USERS[0].email);
  const prepared=await httpJson(app,`/api/v1/opensource/projects/${r3aProject.project_id}/skill-submission`,{
    session,
    body:{},
    version:r3aProject.aggregate_version,
  });
  assert.equal(prepared.status,201,JSON.stringify(prepared.data));
  assert.equal(scheduled.length,0);

  const sub=prepared.data.submission;
  // An upper-case id in the path still publishes the same submission, so the observer compares ids case-insensitively.
  const published=await httpJson(app,`/api/v1/me/skill-submissions/${sub.submission_id.toUpperCase()}/publish`,{
    session,
    body:{consent_to_share:true},
    version:sub.aggregate_version,
  });
  assert.equal(published.status,200,JSON.stringify(published.data));
  assert.equal(published.data.status,'published');
  assert.equal(published.data.submission_id,sub.submission_id);
  assert.equal(published.data.project_id,r3aProject.project_id);
  assert.equal(scheduled.length,1);
  assert.equal((await pool.query('SELECT share_id FROM skill_submissions WHERE submission_id=$1',[sub.submission_id])).rows[0].share_id,null);

  await scheduled[0]();
  const shareRow=(await pool.query('SELECT legacy_ref FROM shares WHERE share_id=$1',[r3aShareId])).rows[0];
  assert.equal(shareRow.legacy_ref.length,2);
  assert.ok(shareRow.legacy_ref.some((r:any)=>r.kind==='oss_project'&&r.id===r3aProject.project_id));
  assert.ok(shareRow.legacy_ref.some((r:any)=>r.kind==='skill_submission'&&r.id===sub.submission_id));
  assert.equal((await pool.query('SELECT share_id FROM skill_submissions WHERE submission_id=$1',[sub.submission_id])).rows[0].share_id,r3aShareId);
  const sharerCredits=(await pool.query("SELECT count(*)::int AS n FROM share_credit_events WHERE share_id=$1 AND user_id=$2 AND role='sharer'",[r3aShareId,actorA.user_id])).rows[0].n;
  assert.equal(sharerCredits,1);
});

test('R3c. failed POST (409 duplicate import) and GET /api/v1/opensource/projects schedule nothing',async t=>{
  t.mock.method(globalThis,'fetch',fetcher);
  const scheduled:Array<()=>Promise<void>>=[];
  const app=createLiveApp(scheduled);
  const session=await loginMember(app,DEMO_USERS[0].email);
  const dup=await httpJson(app,'/api/v1/opensource/projects',{
    session,
    body:{
      repository_url:'https://github.com/fixture/r3a-fork',
      title:'Duplicate Fork Project',
      description:'Duplicate import should return 409',
      use_notes:'Duplicate notes',
      demo_url:null,
      relationship:'curator',
      consent_to_share:true,
    },
  });
  assert.equal(dup.status,409,JSON.stringify(dup.data));
  const list=await httpJson(app,'/api/v1/opensource/projects',{session});
  assert.equal(list.status,200);
  assert.equal(scheduled.length,0);
});

test('R3d. agent repositories.share through agent door and MCP schedules attach after confirmation',async t=>{
  t.mock.method(globalThis,'fetch',fetcher);
  const scheduled:Array<()=>Promise<void>>=[];
  const app=createLiveApp(scheduled);
  const session=await loginMember(app,DEMO_USERS[0].email);
  const issued=await httpJson(app,'/api/v1/me/agent-tokens',{session,body:{name:'R3d Agent',scopes:['read','share']}});
  assert.equal(issued.status,201,JSON.stringify(issued.data));
  const token=issued.data.access_token as string;
  const body={
    repository_url:'https://github.com/fixture/r3d-rest',
    title:'Agent REST Project',
    description:'Shared through agent REST door',
    use_notes:'Use notes for agent REST project',
    relationship:'curator',
    consent_to_share:true,
  };
  const key=randomUUID();
  const pending=await httpJson(app,'/api/v1/opensource/projects',{token,body,key});
  assert.equal(pending.status,202,JSON.stringify(pending.data));
  assert.equal(scheduled.length,0);

  const tokensList=await httpJson(app,'/api/v1/me/agent-tokens',{session});
  const pendingSha=tokensList.data.items.find((i:any)=>i.connection_id===issued.data.connection_id)?.pending_publication?.request_sha256;
  assert.ok(pendingSha);
  const confirmed=await httpJson(app,`/api/v1/me/agent-tokens/${issued.data.connection_id}/confirm`,{session,body:{request_sha256:pendingSha}});
  assert.equal(confirmed.status,200,JSON.stringify(confirmed.data));
  assert.equal(scheduled.length,0);

  const created=await httpJson(app,'/api/v1/opensource/projects',{token,body,key});
  assert.equal(created.status,201,JSON.stringify(created.data));
  assert.equal(created.data.via_agent,true);
  assert.equal(scheduled.length,1);
  assert.equal((await pool.query('SELECT share_id FROM oss_projects WHERE project_id=$1',[created.data.project_id])).rows[0].share_id,null);

  await scheduled[0]();
  const restShareId=(await pool.query('SELECT share_id FROM oss_projects WHERE project_id=$1',[created.data.project_id])).rows[0].share_id;
  assert.ok(restShareId);
  assert.equal((await pool.query('SELECT canonical_key FROM shares WHERE share_id=$1',[restShareId])).rows[0].canonical_key,'github:971');

  const issuedMcp=await httpJson(app,'/api/v1/me/agent-tokens',{session,body:{name:'R3d MCP Agent',scopes:['read','share']}});
  assert.equal(issuedMcp.status,201,JSON.stringify(issuedMcp.data));
  const mcpToken=issuedMcp.data.access_token as string;
  const mcpKey=randomUUID();
  const mcpBody={
    repository_url:'https://github.com/fixture/r3d-mcp',
    title:'Agent MCP Project',
    description:'Shared through MCP dispatch',
    use_notes:'Use notes for agent MCP project',
    relationship:'curator',
    consent_to_share:true,
  };
  const mcpHeaders={Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'};
  const mcpPending=await httpJson(app,'/api/v1/mcp',{
    token:mcpToken,
    headers:mcpHeaders,
    body:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'repositories.share',arguments:{idempotency_key:mcpKey,body:mcpBody}}},
  });
  assert.equal(mcpPending.status,200,JSON.stringify(mcpPending.data));
  assert.equal(scheduled.length,1);

  const mcpList=await httpJson(app,'/api/v1/me/agent-tokens',{session});
  const mcpSha=mcpList.data.items.find((i:any)=>i.connection_id===issuedMcp.data.connection_id)?.pending_publication?.request_sha256;
  assert.ok(mcpSha);
  const mcpConfirm=await httpJson(app,`/api/v1/me/agent-tokens/${issuedMcp.data.connection_id}/confirm`,{session,body:{request_sha256:mcpSha}});
  assert.equal(mcpConfirm.status,200);

  const mcpCreated=await httpJson(app,'/api/v1/mcp',{
    token:mcpToken,
    headers:mcpHeaders,
    body:{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'repositories.share',arguments:{idempotency_key:mcpKey,body:mcpBody}}},
  });
  assert.equal(mcpCreated.status,200,JSON.stringify(mcpCreated.data));
  const mcpProjectId=mcpCreated.data?.result?.structuredContent?.project_id;
  assert.ok(mcpProjectId,JSON.stringify(mcpCreated.data));
  assert.equal(scheduled.length,2);
  assert.equal((await pool.query('SELECT share_id FROM oss_projects WHERE project_id=$1',[mcpProjectId])).rows[0].share_id,null);

  await scheduled[1]();
  const mcpShareId=(await pool.query('SELECT share_id FROM oss_projects WHERE project_id=$1',[mcpProjectId])).rows[0].share_id;
  assert.ok(mcpShareId);
  assert.equal((await pool.query('SELECT canonical_key FROM shares WHERE share_id=$1',[mcpShareId])).rows[0].canonical_key,'github:972');
});
