import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PortalClient} from '../../apps/portal-web/src/api.js';
import {isPersonalSpaceScope,personalPostPath,readPersonalPostPage,type PersonalPostResult} from '../../apps/portal-web/src/modules/personal-space-model.js';
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
