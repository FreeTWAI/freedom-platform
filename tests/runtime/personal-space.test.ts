import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ApiError,PortalClient} from '../../apps/portal-web/src/api.js';
import {createPersonalPostPageReader,personalSpaceGuilds,isPersonalSpaceScope,personalPostPath,readPersonalPostPage,type PersonalPostResult} from '../../apps/portal-web/src/modules/personal-space-model.js';
import type {PersonalContentItem} from '../../apps/portal-web/src/modules/MyContent.js';
const owner='20000000-0000-4000-8000-000000000001';
const item=(n:number):PersonalContentItem=>({kind:'social_post',id:`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`,title:`post ${n}`,status:'active',version:null,path:'https://evil.invalid/',visibility:'community',actions:['view','withdraw']});
const post=(id:string)=>({post_id:id,title:'authorised title',note:'owner-only body',created_at:'2026-10-24T00:00:00Z',thumbnail_url:`/api/v1/social-posts/${id}/thumbnail`,mine:true,author:{user_id:owner}});
const result=(items:unknown[])=>new Response(JSON.stringify({items}),{headers:{'Content-Type':'application/json'}});

test('PERSONAL-SPACE-01: exact post links are constructed from canonical UUID and current view action only',()=>{
 assert.equal(personalPostPath(item(1)),`/?social-post=${item(1).id}#social`);
 for(const id of ['//evil.invalid','a#social','?post=1','00000000-0000-0000-0000-000000000000',item(1).id+'&x=1'])assert.equal(personalPostPath({...item(1),id}),null);
 for(const status of ['hidden','deleted','draft'])assert.equal(personalPostPath({...item(1),status}),null);
 assert.equal(personalPostPath({...item(1),actions:[]}),null);
});
test('PERSONAL-SPACE-02: actual PortalClient reads at most six displayed posts, deduplicates IDs and never follows inventory URL',async(t)=>{
 const paths:string[]=[],outputs:PersonalPostResult[]=[];const client=new PortalClient();client.csrfToken='synthetic-owner';
 t.mock.method(globalThis,'fetch',async(input:any)=>{const url=new URL(String(input),'https://workshop.test');paths.push(url.pathname+url.search);return result([post(url.searchParams.get('post_id')!)]);});
 await readPersonalPostPage(client,owner,Array.from({length:15},(_,i)=>item(i+1)),new AbortController().signal,(_,value)=>outputs.push(value));
 assert.equal(paths.length,6);assert.equal(outputs.length,6);assert.ok(paths.every(path=>/^\/api\/v1\/social-posts\?post_id=[\da-f-]+$/.test(path)));
 paths.length=0;await readPersonalPostPage(client,owner,[item(1),item(1),{...item(2),status:'hidden'},{...item(3),status:'deleted'}],new AbortController().signal,()=>{});assert.equal(paths.length,1);
});
test('PERSONAL-SPACE-03: partial failure and hidden/deleted/mismatched/other-author responses never become readable body or arbitrary image',async(t)=>{
 const outputs=new Map<string,PersonalPostResult>();const client=new PortalClient();client.csrfToken='synthetic';
 t.mock.method(globalThis,'fetch',async(input:any)=>{const id=new URL(String(input),'https://workshop.test').searchParams.get('post_id')!;const n=Number(id.slice(-2));if(n===1)return new Response('{}',{status:503});if(n===2)return result([]);if(n===3)return result([{...post(id),author:{user_id:'other'}}]);if(n===4)return result([{...post(id),mine:false}]);if(n===5)return result([post(item(99).id)]);return result([{...post(id),thumbnail_url:'https://evil.invalid/tracker'}]);});
 await readPersonalPostPage(client,owner,Array.from({length:6},(_,i)=>item(i+1)),new AbortController().signal,(id,value)=>outputs.set(id,value));
 assert.equal(outputs.get(item(1).id)?.state,'error');for(let i=2;i<=5;i++)assert.deepEqual(outputs.get(item(i).id),{state:'unavailable'});
 assert.deepEqual(outputs.get(item(6).id),{state:'ready',post:{post_id:item(6).id,title:'authorised title',note:'owner-only body',created_at:'2026-10-24T00:00:00Z',thumbnail_url:null}});
});
for(const cancellation of ['abort','session'] as const)test(`PERSONAL-SPACE-04: ${cancellation} drops late JSON and old owner body, without a shared retained cache`,async(t)=>{
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve});const outputs:PersonalPostResult[]=[];const client=new PortalClient();client.csrfToken='account-a';const abort=new AbortController();
 t.mock.method(globalThis,'fetch',async()=>{await pending;return result([post(item(1).id)]);});
 const read=readPersonalPostPage(client,owner,[item(1)],abort.signal,(_,value)=>outputs.push(value));
 if(cancellation==='abort')abort.abort();else client.csrfToken='account-b';release();await read;assert.deepEqual(outputs,[]);
});

test('PERSONAL-SPACE-05: render-time scope rejects another owner, a replacement client with the same generation, and a changed session',()=>{
 const first=new PortalClient(),replacement=new PortalClient();first.csrfToken='first';replacement.csrfToken='other';
 const snapshot={client:first,owner,generation:first.sessionGeneration};
 assert.equal(first.sessionGeneration,replacement.sessionGeneration);
 assert.equal(isPersonalSpaceScope(snapshot,first,owner),true);
 assert.equal(isPersonalSpaceScope(snapshot,replacement,owner),false);
 assert.equal(isPersonalSpaceScope(snapshot,first,'another-owner'),false);
 first.csrfToken='next-session';assert.equal(isPersonalSpaceScope(snapshot,first,owner),false);
});


test('PERSONAL-SPACE-06: manual retry recovers only the failed card; double click cannot duplicate its request',async(t)=>{
 const client=new PortalClient();client.csrfToken='owner';const outputs=new Map<string,PersonalPostResult>(),reads:string[]=[];
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});let attempts=0;
 t.mock.method(client,'get',async(path:string)=>{
  const id=new URL(path,'https://workshop.test').searchParams.get('post_id')!;reads.push(id);
  if(id===item(7).id){if(++attempts===1)throw new ApiError({message:'temporary',status:503});await gate;}
  return {items:[post(id)]};
 });
 const reader=createPersonalPostPageReader(client,owner,[item(7),item(8)],new AbortController().signal,(id,value)=>outputs.set(id,value));
 await reader.load();const sibling=outputs.get(item(8).id);
 const first=reader.retry(item(7).id),second=reader.retry(item(7).id);
 assert.deepEqual(outputs.get(item(7).id),{state:'retrying'});assert.deepEqual(reads,[item(7).id,item(8).id,item(7).id]);
 assert.equal(outputs.get(item(8).id),sibling);release();await Promise.all([first,second]);
 assert.equal(outputs.get(item(7).id)?.state,'ready');assert.equal(outputs.get(item(8).id),sibling);
 await reader.retry(item(7).id);await reader.retry(item(99).id);await reader.load();assert.equal(reads.length,3);
});

test('PERSONAL-SPACE-07: failures remain local; no automatic retries; only transient failures offer manual retry',async(t)=>{
 const client=new PortalClient();client.csrfToken='owner';let reads=0;const outputs=new Map<string,PersonalPostResult>();
 for(const [error,retryable,state] of [
  [new ApiError({message:'network',network:true}),true,'error'],
  [new ApiError({message:'timeout',network:true,timedOut:true}),true,'error'],
  [new ApiError({message:'busy',status:429}),true,'error'],
  [new ApiError({message:'timeout',status:408}),true,'error'],
  [new ApiError({message:'forbidden',status:403}),false,'unavailable'],
  [new ApiError({message:'missing',status:404}),false,'unavailable'],
  [new ApiError({message:'gone',status:410}),false,'unavailable'],
  [new ApiError({message:'invalid',status:422}),false,'error'],
  [new ApiError({message:'access',network:true,accessExpired:true}),false,'error'],
  [new Error('malformed envelope'),false,'error'],
 ] as const){
  const mock=t.mock.method(client,'get',async()=>{reads++;throw error;});const start=reads;
  const reader=createPersonalPostPageReader(client,owner,[item(1)],new AbortController().signal,(id,value)=>outputs.set(id,value));
  await reader.load();assert.deepEqual(outputs.get(item(1).id),state==='error'?{state,retryable}:{state});assert.equal(reads,start+1);
  await reader.retry(item(1).id);assert.equal(reads,start+(retryable?2:1));mock.mock.restore();
 }
});
for(const cancellation of ['page','session','replacement-client'] as const)test(`PERSONAL-SPACE-08: ${cancellation} fences an in-flight retry and prevents reuse of the old reader`,async(t)=>{
 const client=new PortalClient();client.csrfToken='old';const abort=new AbortController(),outputs:PersonalPostResult[]=[];
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});let reads=0;
 t.mock.method(client,'get',async()=>{if(++reads===1)throw new ApiError({message:'temporary',status:503});await gate;return {items:[post(item(1).id)]};});
 const reader=createPersonalPostPageReader(client,owner,[item(1)],abort.signal,(_,value)=>outputs.push(value));await reader.load();const retry=reader.retry(item(1).id);
 if(cancellation==='session')client.csrfToken='new';else abort.abort();
 // Replacement clients/pages get a fresh lifetime and cannot receive the old callback.
 const fresh=new PortalClient();fresh.csrfToken='fresh';const freshOutputs:PersonalPostResult[]=[];
 t.mock.method(fresh,'get',async()=>({items:[post(item(2).id)]}));
 const next=createPersonalPostPageReader(fresh,owner,[item(2)],new AbortController().signal,(_,value)=>freshOutputs.push(value));await next.load();
 release();await retry;await reader.retry(item(1).id);
 assert.deepEqual(outputs,[{state:'error',retryable:true},{state:'retrying'}]);assert.equal(reads,2);assert.equal(freshOutputs.length,1);assert.equal(freshOutputs[0].state,'ready');
});

test('PERSONAL-SPACE-09: retry still rejects other-owner, deleted/missing and mismatched responses',async(t)=>{
 const client=new PortalClient();client.csrfToken='owner';
 for(const rows of [[],[{...post(item(1).id),mine:false}],[{...post(item(1).id),author:{user_id:'other'}}],[post(item(9).id)]]){
  let reads=0;const outputs:PersonalPostResult[]=[];const mock=t.mock.method(client,'get',async()=>{if(++reads===1)throw new ApiError({message:'temporary',status:503});return {items:rows};});
  const reader=createPersonalPostPageReader(client,owner,[item(1)],new AbortController().signal,(_,value)=>outputs.push(value));await reader.load();await reader.retry(item(1).id);await reader.retry(item(1).id);
  assert.deepEqual(outputs.at(-1),{state:'unavailable'});assert.equal(reads,2);mock.mock.restore();
 }
});


test('PERSONAL-SPACE-10: summary includes primary, secondary and remaining memberships even when remaining is empty',()=>{
 const primary={guild_key:'a',name:'主要公會',alias:'private alias'},secondary={guild_key:'b',name:'次要公會'},other={guild_key:'c',name:'其他公會'};
 assert.deepEqual(personalSpaceGuilds({primary_guild:primary,secondary_guilds:[secondary],joined_guilds:[]}),[{guild_key:'a',name:'主要公會'},{guild_key:'b',name:'次要公會'}]);
 assert.deepEqual(personalSpaceGuilds({primary_guild:primary,secondary_guilds:[secondary],joined_guilds:[other,primary]}),[{guild_key:'a',name:'主要公會'},{guild_key:'b',name:'次要公會'},{guild_key:'c',name:'其他公會'}]);
 assert.deepEqual(personalSpaceGuilds({primary_guild:null,secondary_guilds:[]}),[]);
});
test('PERSONAL-SPACE-11: category primaries keep order, deduplicate keys, retain distinct guilds with equal names, and project only key/name',()=>{
 const a={guild_key:'a',name:'共同名稱',joined_at:'2026-01-01'},b={guild_key:'b',name:'共同名稱'},c={guild_key:'c',name:'其他公會'};
 assert.deepEqual(personalSpaceGuilds({category_primaries:[{category:'internal',label:'內部',guild:a},{category:'external',label:'外部',guild:null},{category:'professional_industry',label:'專業',guild:b}],primary_guild:b,secondary_guilds:[],joined_guilds:[c,a]}),[{guild_key:'a',name:'共同名稱'},{guild_key:'b',name:'共同名稱'},{guild_key:'c',name:'其他公會'}]);
});
