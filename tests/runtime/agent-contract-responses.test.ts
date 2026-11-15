import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {agentOperations} from '../../apps/platform-api/src/agent-allowlist.js';
import {agentBodySchemas,agentJsonSchema,agentPendingSchema,agentResponseSchemas} from '../../apps/platform-api/src/agent-schemas.js';
import {agentContract} from '../../modules/client-connections/agent-contract.js';
import {z} from 'zod';
import {randomUUID,randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {createPool} from '../../packages/db/index.js';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_USERS,DEMO_PASSWORD} from '../../packages/testing/seed.js';
import {createApp} from '../../apps/platform-api/src/app.js';
const origin='http://127.0.0.1:4310';
const url=process.env.TEST_DATABASE_URL!;
assert.ok(url?.includes('/fp_'),'explicit isolated database required');
const schema=`fp_resp_${process.pid}_${Date.now()}`,admin=createPool(url),pool=new Pool({connectionString:url,options:`-c search_path=${schema}`,max:12});
const app=createApp(pool,origin,'local',{eventParticipationEnabled:true,socialAchievementsEnabled:true,linkPreviewFetch:async url=>new Response('<title>Synthetic '+new URL(String(url)).pathname+'</title>',{headers:{'Content-Type':'text/html'}})});
before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
beforeEach(async()=>{await pool.query('TRUNCATE communities,login_attempts,auth_rate_limits CASCADE');await seedLocal(pool);});
type Session={cookie:string;csrf:string;user:any};
async function req(path:string,opts:{session?:Session;token?:string;body?:unknown;key?:string;method?:string;headers?:Record<string,string>;app?:typeof app}={}){
 const {session,token,body,key=randomUUID(),method=body===undefined?'GET':'POST',app:targetApp=app}=opts;
 const headers:Record<string,string>={...(session?{Origin:origin,Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{}),...(token?{Authorization:'Bearer '+token}:{}),...opts.headers};
 if(body!==undefined){headers['Content-Type']='application/json';headers['Idempotency-Key']=key;}
 const response=await targetApp.request(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json() as any;
 if(token&&response.status>=200&&response.status<202){
  const op=agentOperations.find(op=>op.granted!==false&&op.method===method&&new RegExp('^'+op.route.replace(/:[a-z_]+/g,'[^/]+')+'$').test(path.split('?')[0]));
  if(op)assert.ok(z.fromJSONSchema(agentJsonSchema(agentBodySchemas[op.id])).safeParse(body??{}).success,`contract rejected runtime fixture for ${op.id}`);
 }
 return {status:response.status,data,response};
}
async function ready(index=0):Promise<Session>{
 const r=await req('/api/v1/auth/login',{body:{email:DEMO_USERS[index].email,password:DEMO_PASSWORD},headers:{Origin:origin}});assert.equal(r.status,200);
 await pool.query('UPDATE users SET onboarding_completed_at=now() WHERE user_id=$1',[r.data.user.user_id]);
 return {cookie:r.response.headers.get('set-cookie')!.split(';')[0],csrf:r.data.csrf_token,user:r.data.user};
}
async function issue(session:Session,scopes=['read','share','rsvp']){
 const r=await req('/api/v1/me/agent-tokens',{session,body:{name:'測試 Agent',scopes}});
 assert.equal(r.status,201,JSON.stringify(r.data));
 return r.data;
}

const contractDefs=()=>Object.values(agentContract.paths).flatMap((p:any)=>Object.values(p)) as any[];
function verifyContractResponse(opId:string,status:number,data:unknown,expectedStatus=200){
 assert.equal(status,expectedStatus,`${opId}: ${JSON.stringify(data)}`);
 const parsed=agentResponseSchemas[opId].safeParse(data);
 assert.equal(parsed.success,true,`${opId} schema failed: ${parsed.success?'':JSON.stringify(parsed.error.issues)}`);
 const def=contractDefs().find(d=>d.operationId===opId)!;
 const jsonSchema=def.responses[String(expectedStatus)]?.content?.['application/json']?.schema;
 assert.ok(jsonSchema,`${opId} contract json schema missing`);
 const jsonParsed=z.fromJSONSchema(jsonSchema).safeParse(data);
 assert.equal(jsonParsed.success,true,`${opId} contract json schema failed: ${jsonParsed.success?'':JSON.stringify(jsonParsed.error.issues)}`);
}
async function confirmFirstPublicItem(session:Session,connectionId:string){
 const list=await req('/api/v1/me/agent-tokens',{session});
 assert.equal(list.status,200,JSON.stringify(list.data));
 const pending=list.data.items.find((i:any)=>i.connection_id===connectionId)?.pending_publication;
 assert.ok(pending,`missing pending_publication for ${connectionId}`);
 const confirmed=await req(`/api/v1/me/agent-tokens/${connectionId}/confirm`,{session,body:{request_sha256:pending.request_sha256}});
 assert.equal(confirmed.status,200,JSON.stringify(confirmed.data));
}
async function runPublicItem(session:Session,opId:string,path:string,body:unknown,expectedStatus:number,seen:Set<string>,scopes=['read','share','rsvp']){
 const issued=await issue(session,scopes),key=randomUUID();
 const pending=await req(path,{token:issued.access_token,body,key});
 assert.equal(pending.status,202,`${opId} expected 202: ${JSON.stringify(pending.data)}`);
 assert.equal(agentPendingSchema.safeParse(pending.data).success,true,`${opId} pending schema failed`);
 const pendingSchema=contractDefs().find(d=>d.operationId===opId)!.responses['202']?.content?.['application/json']?.schema;
 assert.ok(pendingSchema,`${opId} 202 contract json schema missing`);
 assert.equal(z.fromJSONSchema(pendingSchema).safeParse(pending.data).success,true,`${opId} 202 contract json schema failed`);
 await confirmFirstPublicItem(session,issued.connection_id);
 const done=await req(path,{token:issued.access_token,body,key});
 verifyContractResponse(opId,done.status,done.data,expectedStatus);
 seen.add(opId);
 return done.data;
}

test('every operation with a response schema parses its live REST agent answer on the seeded database',async()=>{
 const session=await ready(),token=(await issue(session)).access_token;
 const eventsList=await req('/api/v1/events',{token});
 assert.equal(eventsList.status,200,JSON.stringify(eventsList.data));
 const eventId=eventsList.data.items?.[0]?.event_id??(await req('/api/v1/events',{session,body:{title:'測試活動',description:'交流',starts_at:new Date(Date.now()+86400000).toISOString(),ends_at:new Date(Date.now()+90000000).toISOString(),mode:'online',location:'線上',capacity:30,visibility:'open'}})).data.event_id;
 const sharesList=await req('/api/v1/shares',{token});
 assert.equal(sharesList.status,200,JSON.stringify(sharesList.data));
 const shareId=sharesList.data.items?.[0]?.share_id??(await req('/api/v1/shares',{session,body:{kind:'link',url:'https://example.com/seeded'}})).data.share_id;
 const {notifyMember}=await import('../../modules/member-communications/notifications.js');
 const communityId=(await pool.query('SELECT community_id FROM users WHERE user_id=$1',[session.user.user_id])).rows[0].community_id;
 await notifyMember(pool,{community_id:communityId,recipient_ref:session.user.user_id,kind:'friend_request',source_key:randomUUID(),title:'測試通知',body:'通知內容',action:null});
 await pool.query(`INSERT INTO guild_tools(id,community_id,guild_key,tool_id,state,title,entry_url,origin,bridge_version,profile,scopes,permissions,registered_by)
  VALUES($1,$2,'guild_games','list-tool','enabled','列表工具','https://tools.example.com/','https://tools.example.com','freedom.guild-launchpad/v2','origin','["context:read"]','[]',$3)`,[randomUUID(),communityId,session.user.user_id]);
 const notePost=await req('/api/v1/social-posts/notes',{session,body:{text:'測試貼文'}});
 assert.equal(notePost.status,201,JSON.stringify(notePost.data));
 const postId=notePost.data.post_id as string;
 const commentPost=await req(`/api/v1/social-posts/${postId}/comments`,{session,body:{text:'測試留言'}});
 assert.equal(commentPost.status,201,JSON.stringify(commentPost.data));
 const serviceDraft={title:'技術顧問服務',category:'tech',summary:'提供架構設計與效能檢視',description:'一對一線上討論。',price_text:'面議',area_text:'線上',service_mode:'online',contacts:[{label:'預約連結',url:'https://example.com/book'}]};
 const seededService=await req('/api/v1/member-services',{session,body:serviceDraft});
 assert.equal(seededService.status,201,JSON.stringify(seededService.data));
 const posCheck=await req('/api/v1/me/positioning',{session});
 if(!posCheck.data.profile){
  const savedPos=await req('/api/v1/me/positioning',{session,body:{real_world_occupations:['軟體工程師'],background:'十年系統開發',strengths:['TypeScript'],goals:'打造開源協作工具',weekly_minutes:180,desired_roles:['creator'],selected_tracks:['open_source_developer'],confirmed:true}});
  assert.equal(savedPos.status,201,JSON.stringify(savedPos.data));
 }
 const seededDraft=await req('/api/v1/me/skill-submissions/manual',{session,body:{repository_url:'https://github.com/example/project',title:'列表測試技能書',description:'列表測試技能書介紹',use_notes:'先讀 README',relationship:'curator'}});
 assert.equal(seededDraft.status,201,JSON.stringify(seededDraft.data));
 const routes:Record<string,string>={
  'guilds.list':'/api/v1/guilds',
  'tools.list':'/api/v1/public/guilds/guild_games/tools',
  'events.list':'/api/v1/events',
  'events.read':`/api/v1/events/${eventId}`,
  'credit.records':'/api/v1/me/contribution-records',
  'credit.outcomes':'/api/v1/me/contribution-outcomes',
  'credit.achievements':'/api/v1/me/social-achievements',
  'notifications.list':'/api/v1/me/notifications',
  'agent.events':'/api/v1/agent/events',
  'shares.list':'/api/v1/shares',
  'shares.read':`/api/v1/shares/${shareId}`,
  'credit.read':'/api/v1/me/credit',
  'credit.results':'/api/v1/me/share-results',
  'posts.list':'/api/v1/social-posts',
  'posts.comments':`/api/v1/social-posts/${postId}/comments`,
  'services.mine':'/api/v1/member-services/mine',
  'skills.drafts':'/api/v1/me/skill-submissions',
  'skills.draft_read':`/api/v1/me/skill-submissions/${seededDraft.data.submission_id}`,
  'development.status':'/api/v1/me/development/skill/video-autopilot',
  'profile.read':'/api/v1/me/positioning',
 };
 for(const op of agentOperations.filter(op=>op.granted!==false&&op.method==='GET'&&agentResponseSchemas[op.id])){
  const path=routes[op.id];
  assert.ok(path,`missing route mapping for ${op.id}`);
  const r=await req(path,{token});
  verifyContractResponse(op.id,r.status,r.data,200);
  if(op.id==='posts.list'||op.id==='posts.comments'||op.id==='services.mine'||op.id==='skills.drafts')assert.ok(r.data.items.length>=1,`expected seeded item for ${op.id}`);
 }
 const filteredPosts=await req(`/api/v1/social-posts?kind=note&post_id=${postId}`,{token});
 verifyContractResponse('posts.list',filteredPosts.status,filteredPosts.data,200);
 assert.equal(filteredPosts.data.items.length,1);
 assert.ok(agentOperations.some(op=>op.id==='guilds.list'&&op.granted!==false));
 assert.ok(agentOperations.some(op=>op.id==='tools.list'&&op.granted!==false));
 assert.ok(agentOperations.some(op=>op.id==='posts.list'&&op.granted!==false));
 assert.ok(agentOperations.some(op=>op.id==='posts.comments'&&op.granted!==false));
 assert.ok(agentOperations.some(op=>op.id==='services.mine'&&op.granted!==false));
});

test('every write operation with a response schema parses its live REST agent answer on the seeded database',async t=>{
 const session=await ready(),token=(await issue(session)).access_token;
 const seen=new Set<string>();
 const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const signedApp=createApp(pool,origin,'local',{eventParticipationEnabled:true,socialAchievementsEnabled:true,guildToolSigner:{privateKey:keys.privateKey,publicJwk:await crypto.subtle.exportKey('jwk',keys.publicKey),kid:randomUUID()}});
 await pool.query(`INSERT INTO guild_tools(id,community_id,guild_key,tool_id,state,title,entry_url,origin,bridge_version,profile,scopes,permissions,registered_by)
  SELECT $1,community_id,'guild_games','budget-tool','enabled','合成工具','https://tools.example.com/','https://tools.example.com','freedom.guild-launchpad/v2','origin','["context:read","session:exchange"]','[]',user_id FROM users WHERE user_id=$2`,[randomUUID(),session.user.user_id]);
 const toolIdentity=await req('/api/v1/guilds/guild_games/tools/budget-tool/token',{token,body:{},app:signedApp});
 verifyContractResponse('tools.identity',toolIdentity.status,toolIdentity.data,200);seen.add('tools.identity');

 const startsAt=new Date(Date.now()+86400000).toISOString(),endsAt=new Date(Date.now()+90000000).toISOString();
 const eventInput={title:'測試活動',description:'一起交流',starts_at:startsAt,ends_at:endsAt,mode:'online',location:'線上',capacity:30,visibility:'open'};
 const createdEvent=await runPublicItem(session,'events.share','/api/v1/events',eventInput,201,seen);
 const eventId=createdEvent.event_id as string;
 const latestVersion=async()=>{const e=await req(`/api/v1/events/${eventId}`,{token});assert.equal(e.status,200);return e.data.aggregate_version;};

 const eventLinks=await req(`/api/v1/events/${eventId}/share`,{token,body:{}});
 verifyContractResponse('events.links',eventLinks.status,eventLinks.data,200);seen.add('events.links');

 const eventUpdate=await req(`/api/v1/events/${eventId}/update`,{token,body:{...eventInput,title:'測試活動（更新）'},headers:{'If-Match':`"${await latestVersion()}"`}});
 verifyContractResponse('events.update',eventUpdate.status,eventUpdate.data,200);seen.add('events.update');

 const eventAnnounce=await req(`/api/v1/events/${eventId}/announcements`,{token,body:{message:'活動通知'},headers:{'If-Match':`"${await latestVersion()}"`}});
 verifyContractResponse('events.announce',eventAnnounce.status,eventAnnounce.data,200);seen.add('events.announce');

 const eventWaitlist=await req(`/api/v1/events/${eventId}/waitlist`,{token,body:{action:'join'},headers:{'If-Match':`"${await latestVersion()}"`}});
 verifyContractResponse('events.waitlist',eventWaitlist.status,eventWaitlist.data,200);seen.add('events.waitlist');

 const eventRsvp=await req(`/api/v1/events/${eventId}/rsvp`,{token,body:{going:true}});
 verifyContractResponse('events.rsvp',eventRsvp.status,eventRsvp.data,200);seen.add('events.rsvp');

 const eventCancel=await req(`/api/v1/events/${eventId}/cancel`,{token,body:{},headers:{'If-Match':`"${await latestVersion()}"`}});
 verifyContractResponse('events.cancel',eventCancel.status,eventCancel.data,200);seen.add('events.cancel');

 const externalEvent=await req('/api/v1/events',{session,body:{title:'外部報名活動',description:'外部活動',starts_at:startsAt,ends_at:endsAt,mode:'online',location:'線上',capacity:null,visibility:'open',registration_mode:'external',external_registration_url:'https://example.com/register'}});
 assert.equal(externalEvent.status,201,JSON.stringify(externalEvent.data));
 const eventInterest=await req(`/api/v1/events/${externalEvent.data.event_id}/interest`,{token,body:{}});
 verifyContractResponse('events.interest',eventInterest.status,eventInterest.data,200);seen.add('events.interest');

 t.mock.method(globalThis,'fetch',async(input:string|URL|Request)=>{
  const url=String(input);assert.equal(new URL(url).hostname,'api.github.com');
  if(url.endsWith('/repos/example/project'))return Response.json({id:12345,full_name:'example/project',private:false,visibility:'public',default_branch:'main',fork:false,archived:false});
  if(url.endsWith('/commits/main'))return Response.json({sha:'a'.repeat(40)});
  if(url.includes('/license?ref='))return Response.json({path:'LICENSE',license:{spdx_id:'MIT'}});
  throw new Error('unexpected fixture request: '+url);
 });
 await runPublicItem(session,'repositories.share','/api/v1/opensource/projects',{repository_url:'https://github.com/example/project',title:'範例專案',description:'專案介紹',use_notes:'讀取 README',relationship:'curator',consent_to_share:true},201,seen);

 const sharesPreview=await req('/api/v1/shares/preview',{token,body:{kind:'link',url:'https://example.com/preview-test'}});
 verifyContractResponse('shares.preview',sharesPreview.status,sharesPreview.data,200);seen.add('shares.preview');

 const createdShare=await runPublicItem(session,'shares.create','/api/v1/shares',{kind:'link',url:'https://example.com/agent-share'},200,seen);
 const createdShareId=createdShare.share_id as string;

 const sharesLinks=await req(`/api/v1/shares/${createdShareId}/links`,{token,body:{}});
 verifyContractResponse('shares.links',sharesLinks.status,sharesLinks.data,200);seen.add('shares.links');

 const sharesRetract=await req(`/api/v1/shares/${createdShareId}/retract`,{token,body:{}});
 verifyContractResponse('shares.retract',sharesRetract.status,sharesRetract.data,200);seen.add('shares.retract');

 const {notifyMember}=await import('../../modules/member-communications/notifications.js');
 const communityId=(await pool.query('SELECT community_id FROM users WHERE user_id=$1',[session.user.user_id])).rows[0].community_id;
 const firstNotice=await notifyMember(pool,{community_id:communityId,recipient_ref:session.user.user_id,kind:'friend_request',source_key:randomUUID(),title:'通知一',body:'內容一',action:null});
 const secondNotice=await notifyMember(pool,{community_id:communityId,recipient_ref:session.user.user_id,kind:'friend_request',source_key:randomUUID(),title:'通知二',body:'內容二',action:null});
 assert.ok(firstNotice?.notification_id&&secondNotice?.notification_id);
 const markOne=await req(`/api/v1/me/notifications/${firstNotice.notification_id}/read`,{token,body:{}});
 verifyContractResponse('notifications.mark_read',markOne.status,markOne.data,200);seen.add('notifications.mark_read');
 const markAll=await req('/api/v1/me/inbox/read-all',{token,body:{scope:'notifications'}});
 verifyContractResponse('notifications.mark_all_read',markAll.status,markAll.data,200);seen.add('notifications.mark_all_read');
 assert.ok(agentOperations.some(op=>op.id==='notifications.mark_read'&&op.granted!==false));
 assert.ok(agentOperations.some(op=>op.id==='notifications.mark_all_read'&&op.granted!==false));

 const reactToken=(await issue(session,['read','share','rsvp','react'])).access_token;
 const createdNote=await runPublicItem(session,'posts.note','/api/v1/social-posts/notes',{text:'測試短文 #心得'},201,seen);
 const noteId=createdNote.post_id as string;
 const createdLink=await runPublicItem(session,'posts.link','/api/v1/social-posts',{url:'https://example.com/agent-social-link',title:'分享連結',note:'連結說明'},201,seen);
 const linkId=createdLink.post_id as string;
 const editedPost=await req(`/api/v1/social-posts/${noteId}/edit`,{token,body:{text:'更新後的短文'},headers:{'If-Match':`"${createdNote.revision}"`}});
 verifyContractResponse('posts.edit',editedPost.status,editedPost.data,200);seen.add('posts.edit');
 const likedPost=await req(`/api/v1/social-posts/${linkId}/like`,{token:reactToken,body:{liked:true}});
 verifyContractResponse('posts.like',likedPost.status,likedPost.data,200);seen.add('posts.like');
 await runPublicItem(session,'posts.comment',`/api/v1/social-posts/${linkId}/comments`,{text:'測試留言'},201,seen,['read','share','rsvp','react']);
 const deletedPost=await req(`/api/v1/social-posts/${noteId}`,{token,method:'DELETE',body:{}});
 verifyContractResponse('posts.delete',deletedPost.status,deletedPost.data,200);seen.add('posts.delete');

 const serviceDraft={title:'網站架構諮詢',category:'tech',summary:'提供網站健檢與開發指導',description:'線上諮詢一小時。',price_text:'面議',area_text:'線上',service_mode:'online',contacts:[{label:'預約表單',url:'https://example.com/service'}]};
 const createdService=await runPublicItem(session,'services.create','/api/v1/member-services',serviceDraft,201,seen);
 const serviceId=createdService.service_id as string;
 const editedService=await req(`/api/v1/member-services/${serviceId}`,{token,method:'PUT',body:{...serviceDraft,title:'更新後網站諮詢',service_mode:'both'},headers:{'If-Match':`"${createdService.aggregate_version}"`}});
 verifyContractResponse('services.edit',editedService.status,editedService.data,200);seen.add('services.edit');
 const pausedService=await req(`/api/v1/member-services/${serviceId}/pause`,{token,body:{},headers:{'If-Match':`"${editedService.data.aggregate_version}"`}});
 verifyContractResponse('services.pause',pausedService.status,pausedService.data,200);seen.add('services.pause');
 const resumedService=await req(`/api/v1/member-services/${serviceId}/resume`,{token,body:{},headers:{'If-Match':`"${pausedService.data.aggregate_version}"`}});
 verifyContractResponse('services.resume',resumedService.status,resumedService.data,200);seen.add('services.resume');
 const deletedService=await req(`/api/v1/member-services/${serviceId}`,{token,method:'DELETE',body:{},headers:{'If-Match':`"${resumedService.data.aggregate_version}"`}});
 verifyContractResponse('services.delete',deletedService.status,deletedService.data,200);seen.add('services.delete');
 await runPublicItem(session,'works.create','/api/v1/showcases',{title:'測試分享作品',description:'完整作品介紹與使用方法',public_url:'https://example.com/work',consent_to_share:true},201,seen);

 const draftBody={repository_url:'https://github.com/example/project',title:'測試技能書草稿',description:'技能書草稿介紹',use_notes:'先讀 README',relationship:'curator'};
 const createdDraft=await req('/api/v1/me/skill-submissions/manual',{token,body:draftBody});
 verifyContractResponse('skills.draft',createdDraft.status,createdDraft.data,201);seen.add('skills.draft');
 const revisedDraft=await req(`/api/v1/me/skill-submissions/${createdDraft.data.submission_id}/manual`,{token,body:{...draftBody,title:'更新後技能書草稿'},headers:{'If-Match':`"${createdDraft.data.aggregate_version}"`}});
 verifyContractResponse('skills.revise',revisedDraft.status,revisedDraft.data,200);seen.add('skills.revise');

 const devGithubFetch:typeof fetch=async input=>{
  const u=String(input);
  if(u==='https://github.com/login/oauth/access_token')return Response.json({access_token:'ghu_synthetic',token_type:'bearer',scope:''});
  if(u==='https://api.github.com/user')return Response.json({id:42,login:'contributor'});
  if(u.startsWith('https://api.github.com/applications/'))return new Response(null,{status:204});
  if(u.startsWith('https://api.github.com/user/installations?'))return Response.json({installations:[{id:77,app_id:9,account:{id:42},suspended_at:null,permissions:{metadata:'read'}}]});
  if(u.includes('/repositories?'))return Response.json({repositories:[{id:200,full_name:'contributor/video-autopilot-kit',private:false,permissions:{push:true}}]});
  if(u.includes('/repos/')){
   const name=u.split('/repos/')[1],own=name.startsWith('contributor/');
   return Response.json({id:own?200:100,full_name:name,private:false,archived:false,owner:{id:own?42:7},permissions:{push:true},...(own?{source:{id:100}}:{})});
  }
  throw new Error('Unexpected dev GitHub fixture: '+u);
 };
 const devApp=createApp(pool,origin,'local',{eventParticipationEnabled:true,socialAchievementsEnabled:true,githubSocial:{config:{clientId:'Iv1.synthetic',clientSecret:'synthetic-secret',tokenKey:randomBytes(32).toString('base64'),redirectUri:origin+'/github/callback',appId:'9',appSlug:'synthetic-app'},fetcher:devGithubFetch}});
 const guildCheck=(await pool.query("SELECT aggregate_version,state FROM positioning_profession_memberships WHERE user_id=$1 AND guild_key='guild_ai_vibe'",[session.user.user_id])).rows[0];
 if(guildCheck?.state!=='active'){
  const joined=await req('/api/v1/guilds/guild_ai_vibe/join',{app:devApp,session,body:{},...(guildCheck?{headers:{'If-Match':`"${guildCheck.aggregate_version}"`}}:{})});
  assert.equal(joined.status,200,JSON.stringify(joined.data));
 }
 await pool.query("UPDATE positioning_profession_memberships SET member_tier='full' WHERE user_id=$1 AND guild_key='guild_ai_vibe'",[session.user.user_id]);
 const ghStart=await req('/api/v1/me/github/connect',{app:devApp,session,body:{return_to:'#skills'}});
 assert.equal(ghStart.status,200,JSON.stringify(ghStart.data));
 const ghComplete=await req('/api/v1/me/github/complete',{app:devApp,session,body:{state:new URL(ghStart.data.authorization_url).searchParams.get('state')!,code:'synthetic-code'}});
 assert.equal(ghComplete.status,200,JSON.stringify(ghComplete.data));
 const devConsent=await req('/api/v1/me/development/skill/video-autopilot/consent',{app:devApp,session,body:{policy_version:'development-proposal-v1',accepted:true}});
 assert.equal(devConsent.status,200,JSON.stringify(devConsent.data));
 const devActivate=await req('/api/v1/me/development/skill/video-autopilot/activate',{app:devApp,session,body:{working_repository_url:'https://github.com/contributor/video-autopilot-kit'}});
 assert.equal(devActivate.status,200,JSON.stringify(devActivate.data));
 const devProposal=await req('/api/v1/me/development/skill/video-autopilot/proposals',{app:devApp,token,body:{title:'改善開發說明測試',summary:'補充測試步驟與指引。',pr_url:null}});
 verifyContractResponse('development.propose',devProposal.status,devProposal.data,200);seen.add('development.propose');
 const populatedDevStatus=await req('/api/v1/me/development/skill/video-autopilot',{app:devApp,token});
 verifyContractResponse('development.status',populatedDevStatus.status,populatedDevStatus.data,200);

 const expectedWrites=agentOperations.filter(op=>op.granted!==false&&op.method!=='GET'&&agentResponseSchemas[op.id]).map(op=>op.id).sort();
 assert.deepEqual([...seen].sort(),expectedWrites);
});

test('granted operations without a response schema are none',()=>{
 const withoutSchema=agentOperations.filter(op=>op.granted!==false&&!agentResponseSchemas[op.id]).map(op=>op.id).sort();
 assert.deepEqual(withoutSchema,[]);
});
