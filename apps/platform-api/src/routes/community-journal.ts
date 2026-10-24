import {journalActivity} from '../../../../modules/community-journal/activity.js';
import {journalMedia} from '../../../../modules/community-journal/media.js';
import {createHash} from 'node:crypto';
import {Hono,type Context} from 'hono';
import type {Pool} from 'pg';
import {Problem,requireCondition} from '../../../../packages/shared/problem.js';
import {readWithMemberSession} from '../../../../packages/db/member-session.js';
import {moduleCommand,type PlatformEnv} from '../module-context.js';
import {authRateLimit} from '../../../../modules/identity-membership/members.js';
import {snapshotSchema} from '../../../../modules/community-journal/payload.js';
import {communitySnapshot,journalCommunities,type JournalCommunity} from '../../../../modules/community-journal/community.js';
import * as journal from '../../../../modules/community-journal/service.js';
const base='/agent-api/v1/journal-submissions';
export const isAgentJournalPath=(method:string,path:string)=>method==='POST'&&path===base;
async function body(request:Request){
 requireCondition(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()==='application/json',415,'json_required','請傳送 JSON。');
 const length=request.headers.get('content-length');requireCondition(length===null||(/^\d+$/.test(length)&&Number(length)<=journal.MAX_BYTES),413,'body_too_large','日誌快照最多 2 MiB。');
 const reader=request.body?.getReader();requireCondition(reader,400,'invalid_json','缺少 JSON。');let size=0;const chunks:Uint8Array[]=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>journal.MAX_BYTES)throw new Problem(413,'body_too_large','日誌快照最多 2 MiB。');chunks.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
 const bytes=Buffer.concat(chunks,size);let raw:unknown;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Problem(400,'invalid_json','JSON 格式不正確。');}
 return {payload:snapshotSchema.parse(raw),sha256:createHash('sha256').update(bytes).digest('hex')};
}
export function createJournalAgentRoutes(pool:Pool,network:(c:Context)=>string){
 const app=new Hono();
 app.use('/journal-submissions*',async(c,next)=>{c.header('Cache-Control','no-store');requireCondition(!new URL(c.req.url).search,422,'query_unsupported','投稿端點不接受查詢參數。');await authRateLimit(pool,'journal-agent-network',network(c),120,3600);await next();});
 app.post('/journal-submissions',async c=>{const hash=journal.credentialHash(c.req.header('Authorization'));const key=await journal.findKey(pool,hash);await authRateLimit(pool,'journal-agent-owner',key.user_id,60,3600);const idem=journal.idempotency(c.req.header('Idempotency-Key'));const data=await body(c.req.raw);return c.json(await journal.submit(pool,hash,idem,data.payload,data.sha256),201);});
 app.get('/journal-submissions/receipts/:key',async c=>c.json(await journal.receipt(pool,journal.credentialHash(c.req.header('Authorization')),journal.idempotency(c.req.param('key')))));
 return app;
}
export function createJournalMemberRoutes(pool:Pool){
 const app=new Hono<PlatformEnv>();const path='/me/community-journal';
 app.use(path+'*',async(c,next)=>{c.header('Cache-Control','private, no-store');c.header('Vary','Cookie');await next();});
 app.get(path,async c=>c.json(await readWithMemberSession(pool,c.get('actor'),q=>journal.editorState(q,c.get('actor')))));
 app.post(path+'/keys',async c=>{await authRateLimit(pool,'journal-key-issue',c.get('actor').user_id,20,3600);return c.json(await journal.createKey(pool,await moduleCommand(c)),201);});
 app.post(path+'/keys/:id/revoke',async c=>c.json(await journal.revokeKey(pool,await moduleCommand(c),c.req.param('id')!)));
 app.get(path+'/submissions/:id',async c=>c.json(await readWithMemberSession(pool,c.get('actor'),q=>journal.readSubmission(q,c.get('actor'),c.req.param('id')!))));
 app.post(path+'/submissions/:id/publish',async c=>c.json(await journal.publish(pool,await moduleCommand(c),c.req.param('id')!)));
 app.post(path+'/submissions/:id/discard',async c=>c.json(await journal.discard(pool,await moduleCommand(c),c.req.param('id')!)));
 app.post(path+'/withdraw',async c=>c.json(await journal.withdraw(pool,await moduleCommand(c))));return app;
}
const shell='<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>自由工坊共創誌</title><link rel="stylesheet" href="/journal-assets/journal.css"><script type="module" src="/assets/journal.js"></script></head><body><div id="journal-root"></div></body></html>';
function publicQuery(c:Context,activity=false){
 const params=new URL(c.req.url).searchParams,community=params.get('community'),period=params.get('period')??'week';
 requireCondition([...params.keys()].every(k=>k==='community'||activity&&k==='period')&&params.getAll('community').length<=1&&params.getAll('period').length<=1,422,'invalid_query','查詢參數不正確。');
 requireCondition(community===null||journalCommunities.includes(community as JournalCommunity),422,'invalid_community','請選擇自由工坊、Claude 或 Codex。');
 requireCondition(!activity||period==='week'||period==='month',422,'invalid_period','請選擇近 7 天或近 30 天。');
 return {community:community as JournalCommunity|null,period:period as 'week'|'month'};
}
export function createJournalPublicRoutes(pool:Pool){
 const app=new Hono();
 app.get('/api/v1/public/journal/media-manifest',c=>c.json({filenames:[...journalMedia],communities:journalCommunities}));
 app.get('/api/v1/public/journal/activity',async c=>{
  const {community,period}=publicQuery(c,true);c.header('Cache-Control','no-store');
  const snapshot=await journal.publicSnapshot(pool);
  return c.json({data:journalActivity(snapshot.data,period,new Date(),community??'freedom')});
 });
 app.get('/api/v1/public/journal',async c=>{
  const {community}=publicQuery(c);c.header('Cache-Control','no-store');
  const snapshot=await journal.publicSnapshot(pool);
  return c.json(community?{...snapshot,data:communitySnapshot(snapshot.data,community)}:snapshot);
 });
 app.get('/journal',c=>c.html(shell));app.get('/journal/*',c=>c.html(shell));return app;
}
