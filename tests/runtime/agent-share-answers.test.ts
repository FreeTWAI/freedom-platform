import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createPool} from '../../packages/db/index.js';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_USERS,DEMO_PASSWORD} from '../../packages/testing/seed.js';
import {createApp} from '../../apps/platform-api/src/app.js';
import {agentBodySchemas,agentPendingSchema,agentResponseSchemas} from '../../apps/platform-api/src/agent-schemas.js';
import {agentContract} from '../../modules/client-connections/agent-contract.js';
import {agentGuide} from '../../modules/client-connections/agent-guide.js';

const origin='http://127.0.0.1:4310';
const url=process.env.TEST_DATABASE_URL!;
assert.ok(url?.includes('/fp_'),'explicit isolated database required');
const schema=`fp_shans_${process.pid}_${Date.now()}`,admin=createPool(url),pool=new Pool({connectionString:url,options:`-c search_path=${schema}`,max:12});
const app=createApp(pool,origin,'local',{
 eventParticipationEnabled:true,
 socialAchievementsEnabled:true,
 linkPreviewFetch:async targetUrl=>new Response('<title>Synthetic '+new URL(String(targetUrl)).pathname+'</title>',{headers:{'Content-Type':'text/html'}}),
});

before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
beforeEach(async()=>{await pool.query('TRUNCATE communities,login_attempts,auth_rate_limits CASCADE');await seedLocal(pool);});

type Session={cookie:string;csrf:string;user:{user_id:string}};
const uuidSchema=z.string().uuid();

async function req(path:string,opts:{session?:Session;token?:string;body?:unknown;key?:string;method?:string;headers?:Record<string,string>}={}){
 const {session,token,body,key=randomUUID(),method=body===undefined?'GET':'POST'}=opts;
 const headers:Record<string,string>={
  ...(session?{Origin:origin,Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{}),
  ...(token?{Authorization:'Bearer '+token}:{}),
  ...opts.headers,
 };
 if(body!==undefined){
  headers['Content-Type']='application/json';
  headers['Idempotency-Key']=key;
 }
 const response=await app.request(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json() as any;
 return {status:response.status,data,response};
}

async function ready(index=0):Promise<Session>{
 const r=await req('/api/v1/auth/login',{body:{email:DEMO_USERS[index].email,password:DEMO_PASSWORD},headers:{Origin:origin}});
 assert.equal(r.status,200);
 await pool.query('UPDATE users SET onboarding_completed_at=now() WHERE user_id=$1',[r.data.user.user_id]);
 return {cookie:r.response.headers.get('set-cookie')!.split(';')[0],csrf:r.data.csrf_token,user:r.data.user};
}

async function issue(session:Session,scopes=['read','share','rsvp']){
 const r=await req('/api/v1/me/agent-tokens',{session,body:{name:'測試 Agent',scopes}});
 assert.equal(r.status,201);
 return r.data as {connection_id:string;access_token:string};
}

async function confirmFirstPublicItem(session:Session,connectionId:string){
 const list=await req('/api/v1/me/agent-tokens',{session});
 assert.equal(list.status,200);
 const pending=list.data.items.find((i:any)=>i.connection_id===connectionId)?.pending_publication;
 assert.ok(Boolean(pending),'missing pending_publication');
 const confirmed=await req(`/api/v1/me/agent-tokens/${connectionId}/confirm`,{session,body:{request_sha256:pending.request_sha256}});
 assert.equal(confirmed.status,200);
}

async function runPublicItem(session:Session,path:string,body:unknown,expectedStatus:number,scopes=['read','share','rsvp']){
 const issued=await issue(session,scopes),key=randomUUID();
 const pending=await req(path,{token:issued.access_token,body,key});
 assert.equal(pending.status,202);
 assert.equal(agentPendingSchema.safeParse(pending.data).success,true);
 await confirmFirstPublicItem(session,issued.connection_id);
 const done=await req(path,{token:issued.access_token,body,key});
 assert.equal(done.status,expectedStatus);
 return {data:done.data,token:issued.access_token};
}

async function verifyShareRead(token:string,shareId:unknown){
 assert.equal(typeof shareId,'string');
 assert.equal(uuidSchema.safeParse(shareId).success,true);
 const readRes=await req(`/api/v1/shares/${shareId}`,{token});
 assert.equal(readRes.status,200);
 assert.equal(readRes.data.share_id,shareId);
}

async function verifyPromotionLinkOwnedBy(token:string,userId:string,shareId:string){
 const linkRes=await req(`/api/v1/shares/${shareId}/links`,{token,body:{}});
 assert.equal(linkRes.status>=200&&linkRes.status<300,true);
 assert.equal(typeof linkRes.data.path,'string');
 assert.equal(linkRes.data.path.startsWith('/go/'),true);
 assert.equal(typeof linkRes.data.code,'string');

 const rows=(await pool.query('SELECT user_id FROM promotion_links WHERE code=$1 AND revoked_at IS NULL',[linkRes.data.code])).rows;
 assert.equal(rows.length,1);
 assert.equal(rows[0].user_id,userId);
}

const contractDefs=()=>Object.values(agentContract.paths).flatMap((p:any)=>Object.values(p)) as any[];
function responseJsonSchema(opId:string,status:number):Record<string,any>{
 const def=contractDefs().find(d=>d.operationId===opId);
 assert.ok(Boolean(def),`missing operation ${opId}`);
 return def.responses[String(status)]?.content?.['application/json']?.schema??{};
}

test('posts.note answer carries UUID share_id; shares.read answers 200 and shares.links answers 404 without public note page',async()=>{
 const session=await ready(0);
 const {data,token}=await runPublicItem(session,'/api/v1/social-posts/notes',{text:'測試短文 #心得'},201);
 assert.equal('share_id' in data,true);
 await verifyShareRead(token,data.share_id);
 const linkRes=await req(`/api/v1/shares/${data.share_id}/links`,{token,body:{}});
 assert.equal(linkRes.status,404);
 assert.equal(agentResponseSchemas['posts.note'].safeParse(data).success,true);
 assert.equal(responseJsonSchema('posts.note',201).properties?.share_id?.type,'string');
 assert.equal(responseJsonSchema('posts.note',201).required?.includes('share_id'),true);
});

test('posts.link answer carries UUID share_id; shares.read answers 200 and shares.links creates member A /go/ link',async()=>{
 const session=await ready(0);
 const {data,token}=await runPublicItem(session,'/api/v1/social-posts',{url:'https://example.com/agent-social-link',title:'分享連結',note:'連結說明'},201);
 assert.equal('share_id' in data,true);
 await verifyShareRead(token,data.share_id);
 await verifyPromotionLinkOwnedBy(token,session.user.user_id,data.share_id);
 assert.equal(agentResponseSchemas['posts.link'].safeParse(data).success,true);
 assert.equal(responseJsonSchema('posts.link',201).properties?.share_id?.type,'string');
 assert.equal(responseJsonSchema('posts.link',201).required?.includes('share_id'),true);
 const guide=agentGuide(origin);
 assert.equal(guide.includes('## 貼文與作品的分享'),true);
 assert.equal(guide.includes('發布連結貼文（posts.link）的回應帶 share_id。以這個 share_id 呼叫 shares.links，取得記在會員名下的推廣連結。文字貼文（posts.note）和公開作品（works.create）的回應也帶 share_id；它們預設沒有對外公開頁；會員在瀏覽器開啟公開頁之前，shares.links 會拒絕（貼文回 404，作品回 422 work_not_public）。'),true);
});

test('posts.edit of the note carries UUID share_id; shares.read answers 200 and shares.links answers 404 without public note page',async()=>{
 const session=await ready(0);
 const {data:createdNote,token}=await runPublicItem(session,'/api/v1/social-posts/notes',{text:'測試短文 #心得'},201);
 const edited=await req(`/api/v1/social-posts/${createdNote.post_id}/edit`,{
  token,
  body:{text:'更新後的短文'},
  headers:{'If-Match':`"${createdNote.revision}"`},
 });
 assert.equal(edited.status,200);
 assert.equal('share_id' in edited.data,true);
 assert.equal(edited.data.share_id,createdNote.share_id);
 await verifyShareRead(token,edited.data.share_id);
 const linkRes=await req(`/api/v1/shares/${edited.data.share_id}/links`,{token,body:{}});
 assert.equal(linkRes.status,404);
 assert.equal(agentResponseSchemas['posts.edit'].safeParse(edited.data).success,true);
 assert.equal(responseJsonSchema('posts.edit',200).properties?.share_id?.type,'string');
 // An edited post may predate the share ledger, so the edit answer documents share_id as optional.
 assert.equal(responseJsonSchema('posts.edit',200).required?.includes('share_id')??false,false);
});

test('works.create answer carries UUID share_id; shares.links answers 404 until the member opens the public page, then makes member A a /go/ link; no private variant',async()=>{
 const session=await ready(0);
 assert.equal(agentBodySchemas['works.create'].safeParse({title:'無公開同意作品',description:'說明'}).success,false);
 assert.equal(agentBodySchemas['works.create'].safeParse({title:'無公開同意作品',description:'說明',consent_to_share:false}).success,false);

 const {data,token}=await runPublicItem(
  session,
  '/api/v1/showcases',
  {title:'測試分享作品',description:'完整作品介紹與使用方法',public_url:'https://example.com/work',consent_to_share:true},
  201,
 );
 assert.equal('share_id' in data,true);
 await verifyShareRead(token,data.share_id);
 const beforePage=await req(`/api/v1/shares/${data.share_id}/links`,{token,body:{}});
 assert.equal(beforePage.status,422);
 assert.equal(JSON.stringify(beforePage.data).includes('work_not_public'),true);
 // The member opens the work's public page in the browser; an agent cannot.
 const sharing=await req(`/api/v1/me/showcases/${data.showcase_id}/sharing`,{session});
 assert.equal(sharing.status,200);
 const opened=await req(`/api/v1/me/showcases/${data.showcase_id}/sharing`,{session,method:'PUT',body:{enabled:true,work_version:sharing.data.work_version},headers:{'If-Match':`"${sharing.data.version}"`}});
 assert.equal(opened.status,200);
 await verifyPromotionLinkOwnedBy(token,session.user.user_id,data.share_id);
 assert.equal(agentResponseSchemas['works.create'].safeParse(data).success,true);
 assert.equal(responseJsonSchema('works.create',201).properties?.share_id?.type,'string');
 assert.equal(responseJsonSchema('works.create',201).required?.includes('share_id'),true);

 const noConsent=await req('/api/v1/showcases',{token,body:{title:'未同意公開',description:'私密測試'}});
 assert.equal(noConsent.status,422);
});

test('posts.list items carry UUID share_id when the post has its share; an older post without one still matches the schema',async()=>{
 const session=await ready(0);
 const {data:createdNote}=await runPublicItem(session,'/api/v1/social-posts/notes',{text:'測試短文 #心得'},201);
 const {data:createdLink,token}=await runPublicItem(session,'/api/v1/social-posts',{url:'https://example.com/agent-list-link',title:'清單連結',note:'連結說明'},201);
 // A post written straight to the table stands for one made before the share ledger: it has no share.
 const older=(await pool.query(`INSERT INTO community_social_posts(community_id,author_user_id,url,platform,title,note,state,created_at,updated_at)
  SELECT community_id,author_user_id,'https://example.com/agent-older-post',platform,'較早的貼文',note,'active',now(),now() FROM community_social_posts WHERE post_id=$1 RETURNING post_id`,[createdLink.post_id])).rows[0].post_id as string;
 const listRes=await req('/api/v1/social-posts',{token});
 assert.equal(listRes.status,200);
 assert.equal('share_id' in listRes.data,false);
 assert.equal(Array.isArray(listRes.data.items),true);
 assert.equal(listRes.data.items.length>=3,true);
 for(const item of listRes.data.items){
  if(item.post_id===older){assert.equal('share_id' in item,false);continue;}
  assert.equal('share_id' in item,true);
  await verifyShareRead(token,item.share_id);
 }
 const noteItem=listRes.data.items.find((i:any)=>i.post_id===createdNote.post_id);
 const linkItem=listRes.data.items.find((i:any)=>i.post_id===createdLink.post_id);
 assert.equal(noteItem?.share_id,createdNote.share_id);
 assert.equal(linkItem?.share_id,createdLink.share_id);
 await verifyPromotionLinkOwnedBy(token,session.user.user_id,linkItem.share_id);
 assert.equal(agentResponseSchemas['posts.list'].safeParse(listRes.data).success,true);
 assert.equal(responseJsonSchema('posts.list',200).properties?.items?.items?.properties?.share_id?.type,'string');
 assert.equal(responseJsonSchema('posts.list',200).properties?.items?.items?.required?.includes('share_id')??false,false);
});
