import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {transformSync} from 'esbuild';
import {ApiError} from '../../apps/portal-web/src/api';

const source=readFileSync(new URL('../../apps/portal-web/src/modules/SocialZone.tsx',import.meta.url),'utf8');
function between(start:string,end:string){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a+start.length,b);}
function harness(){
  const requests:any[]=[],initial:any={post_id:'p',kind:'note',revision:1,title:'before',note:'before',thumbnail_url:'image',tags:[],mentions:[]};
  const state:any={items:[initial],loading:false,more:false,cursor:'original-cursor',canHide:false,error:'',notice:''};
  const client={sessionGeneration:1,csrfToken:'synthetic',post:async()=>({}),get:(path:string)=>new Promise((resolve,reject)=>requests.push({path,resolve,reject}))};
  const c:any={Error,ApiError,crypto:webcrypto,URLSearchParams,client,currentClient:{current:client},feedSession:1,tag:'',directPost:null,
    feedScope:{current:{client,session:1,platform:'note',tag:'',directPost:null}},activeFeedLoad:{current:null},failedFeedLoad:{current:null},loadSequence:{current:0},refreshSequence:{current:0},confirmedWrites:{current:0},pendingFeedLoad:{current:false},newPosts:{current:[]},focusing:{current:null},
    setItems:(value:any)=>state.items=typeof value==='function'?value(state.items):value,setLoading:(v:boolean)=>state.loading=v,setMore:(v:boolean)=>state.more=v,setCursor:(v:unknown)=>state.cursor=v,setCanHide:(v:boolean)=>state.canHide=v,setError:(v:string)=>state.error=v,setNotice:(v:string)=>state.notice=v,
    accessAwareFetch:async()=>({ok:true}),setSaving(){},setDeleteError(){},setActionError(){},composerMessages:{uncertain:['unknown']},publishLock:{current:null},preparingImage:false,linkPreview:false,url:'',text:'new post',topic:'mood',checkIn:false,locationName:'',mentions:[],composeFile:null,setPublishing(){},setPublishError(){},selection:{current:{platform:'note',tag:'',version:0}},importedGame:{current:null},pending:{current:null},newTextHistory:()=>({}),setTextHistory(){},setMentions(){},setLocationName(){},setCheckIn(){},selectComposeImage:async()=>{},setOriginalDraft(){},setUrl(){},setTitle(){},setLinkPreview(){},composerVersion:{current:0},closeComposer(){},setPlatform(){},clearDirectPost(){},
    deleteDialog:{current:{close(){}}},setConfirming(){},composerTrigger:{current:{focus(){}}}};
  const load=between('const load = useCallback(', ', [client,feedSession,tag,directPost]);');
  const a=source.indexOf('onSaved={saved=>{'),b=source.indexOf('}}/>',a),saved=source.slice(a+'onSaved={'.length,b+1);
  const remove=between('async function remove(post: Post) {','\n  async function hide(');
  const hide=between('async function hide(post: Post) {','\n  // One-tap like');
  const finish=between('function finishPublication(created:Post,selectedVersion:number,interactionVersion:number,generation:number,confirmedThumbnail?:string) {','\n  async function publishLink(');
  const select=between('function selectPlatform(next: string) {','\n  function clearDirectPost(');
  const quiet=between('const refreshShorts = useCallback(', ', [client, feedSession, tag]);');
  const retry=between('function retryFeed() {','\n  function refreshAfterAction(');
  const publish=between('async function publish(event: FormEvent) {','\n  async function uploadLinkThumb(');
  // These are the production closures, not a model of their epoch/merge logic.
  runInNewContext(transformSync(`globalThis.load=${load};globalThis.saved=${saved};globalThis.remove=async function(post){${remove};globalThis.hide=async function(post){${hide};globalThis.finish=function(created,selectedVersion,interactionVersion,generation,confirmedThumbnail){${finish};globalThis.selectPlatform=function(next){${select};globalThis.quiet=${quiet};globalThis.retry=function(){${retry};globalThis.finishPublication=globalThis.finish;globalThis.publish=async function(event){${publish}`,{loader:'ts',format:'cjs'}).code,c);
  return {c,state,initial,requests};
}
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
const page=(items:unknown[],next_cursor:string|null='fresh-cursor')=>({items,next_cursor,can_hide:false});
async function mutate(h:ReturnType<typeof harness>,kind:string){
  if(kind==='edit')h.c.saved({...h.initial,revision:2,title:'after',note:'after'});
  if(kind==='delete')await h.c.remove(h.initial);
  if(kind==='hide')await h.c.hide(h.initial);
  if(kind==='create')h.c.finish({...h.initial,post_id:'new'},0,0,1);
  if(kind==='unknown-delete'){h.c.accessAwareFetch=async()=>{throw Error('unknown');};await h.c.remove(h.initial);}
}
for(const mode of ['replace','append'])for(const kind of ['edit','delete','hide','create','unknown-delete'])test(`${mode} read orders ${kind} without losing its original page`,async()=>{
  const h=harness(),read=h.c.load('note',mode==='append'?'original-cursor':undefined);await mutate(h,kind);
  h.requests[0].resolve(page([h.initial],'stale-cursor'));await tick();
  if(kind==='unknown-delete'){
    assert.equal(h.requests.length,1);assert.equal(h.c.confirmedWrites.current,0);assert.equal(h.state.items.length,1);
  }else{
    assert.equal(h.requests.length,2,'one same-query revalidation after confirmed mutation');assert.equal(h.requests[1].path,h.requests[0].path);assert.equal(h.state.cursor,'original-cursor');
    const fresh=kind==='edit'?[{...h.initial,revision:2,title:'after',note:'after'}]:kind==='create'?[{...h.initial,post_id:'new'},h.initial]:[];
    h.requests[1].resolve(page(fresh));await read;
    if(kind==='edit')assert.equal(h.state.items[0].revision,2);
    if(kind==='delete'||kind==='hide')assert.equal(h.state.items.length,0);
    if(kind==='create')assert.deepEqual(Array.from(h.state.items,(p:any)=>p.post_id),['new','p']);
    assert.equal(h.state.cursor,'fresh-cursor');
  }
  await read;assert.equal(h.state.loading,false);assert.equal(h.state.more,false);assert.equal(h.c.pendingFeedLoad.current,false);
});
for(const kind of ['edit','delete','hide','create'])test(`quiet Short cannot confirm a list older than ${kind}`,async()=>{
  const h=harness();h.initial.kind='link';h.initial.platform='youtube';h.c.feedScope.current.platform='shorts';h.c.selection.current.platform='shorts';
  const read=h.c.quiet(1);
  if(kind==='create')h.c.finish({...h.initial,post_id:'new'},0,0,1);else await mutate(h,kind);
  h.requests[0].resolve(page([h.initial],null));assert.equal(await read,null);assert.equal(h.requests.length,1);
  if(kind==='edit')assert.equal(h.state.items[0].revision,2);
  if(kind==='delete'||kind==='hide')assert.equal(h.state.items.length,0);
  if(kind==='create')assert.equal(h.state.items[0].post_id,'new');
});
test('created post retention uses its acknowledged edit fields, not the original creation snapshot',async()=>{
  const h=harness(),read=h.c.load('note');h.c.finish({...h.initial,post_id:'new'},0,0,1);
  h.c.saved({...h.initial,post_id:'new',revision:2,title:'after',note:'after'});
  h.requests[0].resolve(page([h.initial]));await tick();assert.equal(h.requests.length,2);h.requests[1].resolve(page([h.initial]));await read;
  assert.equal(h.state.items[0].post_id,'new');assert.equal(h.state.items[0].revision,2);assert.equal(h.c.newPosts.current[0].revision,2);
});
test('a second concurrent write stops automatic reads, settles busy state, and retries the original cursor explicitly',async()=>{
  const h=harness();h.c.tag='work';h.c.feedScope.current.tag='work';
  const read=h.c.load('note','original-cursor');await mutate(h,'edit');h.requests[0].resolve(page([h.initial]));await tick();assert.equal(h.requests.length,2);
  h.c.saved({...h.initial,revision:3,title:'latest',note:'latest'});h.requests[1].resolve(page([{...h.initial,revision:2}]));await read;
  assert.equal(h.requests.length,2);assert.equal(h.state.items[0].revision,3);assert.equal(h.state.cursor,'original-cursor');assert.ok(h.state.error);
  assert.equal(h.state.loading,false);assert.equal(h.state.more,false);assert.equal(h.c.pendingFeedLoad.current,false);
  h.c.retry();assert.equal(h.requests.length,3);assert.equal(h.requests[2].path,h.requests[0].path);assert.equal(h.requests[2].path,'/social-posts?kind=note&cursor=original-cursor&tag=work');h.requests[2].resolve(page([]));await tick();assert.equal(h.state.error,'');
});
for(const failedAttempt of [0,1])test(`read failure on attempt ${failedAttempt+1} remains actionable without automatic error retries`,async()=>{
  const h=harness(),read=h.c.load('note','original-cursor');await mutate(h,'edit');
  if(failedAttempt){h.requests[0].resolve(page([h.initial]));await tick();assert.equal(h.requests.length,2);}
  h.requests[failedAttempt].reject(Error('current read failed'));await read;
  assert.equal(h.state.error,'current read failed');assert.equal(h.state.cursor,'original-cursor');assert.equal(h.state.items[0].revision,2);assert.equal(h.requests.length,failedAttempt+1);assert.equal(h.state.more,false);assert.equal(h.c.failedFeedLoad.current.cursor,'original-cursor');
});
test('superseding load cannot let a cancelled old read start revalidation or clear the new busy state',async()=>{
  const h=harness(),old=h.c.load('note');await mutate(h,'edit');const current=h.c.load('note');assert.equal(h.requests.length,2);
  h.requests[0].resolve(page([h.initial]));await old;assert.equal(h.requests.length,2);assert.equal(h.state.loading,true);
  h.requests[1].resolve(page([{...h.initial,revision:2}]));await current;assert.equal(h.state.loading,false);assert.equal(h.state.items[0].revision,2);
});
test('replacement session blocks stale read revalidation',async()=>{
  const h=harness(),read=h.c.load('note');await mutate(h,'edit');h.c.client.sessionGeneration++;
  h.requests[0].resolve(page([h.initial]));await read;assert.equal(h.requests.length,1);assert.equal(h.state.items[0].revision,2);
});

for(const change of ['tag','platform','directPost'])test(`changed ${change} prevents a stale read from starting another transport`,async()=>{
  const h=harness(),read=h.c.load('note');await mutate(h,'edit');h.c.feedScope.current[change]=change==='platform'?'link':'new-target';
  h.requests[0].resolve(page([h.initial]));await read;assert.equal(h.requests.length,1);assert.equal(h.state.items[0].revision,2);
});
test('quiet multi-page aggregation rejects a write between pages without committing its partial list',async()=>{
  const h=harness();h.initial.kind='link';h.initial.platform='youtube';h.c.feedScope.current.platform='shorts';
  const read=h.c.quiet(2);h.requests[0].resolve(page([h.initial],'page2'));await tick();assert.equal(h.requests.length,2);
  await mutate(h,'edit');h.requests[1].resolve(page([{...h.initial,post_id:'q'}],null));assert.equal(await read,null);
  assert.equal(h.state.items.length,1);assert.equal(h.state.items[0].revision,2);assert.equal(h.state.cursor,'original-cursor');
});
for(const operation of ['publish','hide'])for(const network of [false,true])test(`${operation} ${network?'unknown':'rejected'} write does not invalidate an otherwise current read`,async()=>{
  const h=harness(),read=h.c.load('note');h.c.client.post=async()=>{throw new ApiError({message:'not confirmed',network,status:network?0:422,code:'validation_failed'});};
  if(operation==='publish')await h.c.publish({preventDefault(){}});else await h.c.hide(h.initial);
  assert.equal(h.c.confirmedWrites.current,0);h.requests[0].resolve(page([h.initial]));await read;
  assert.equal(h.requests.length,1);assert.equal(h.state.items[0],h.initial);assert.equal(h.state.loading,false);
});

for(const revision of [1,2])test(`late creation receipt preserves existing revision ${revision} and independent metadata`,()=>{
  const h=harness(),known={...h.initial,revision,note:'known',like_count:7,mine:false};h.state.items=[known];
  h.c.finish({...h.initial,like_count:0,mine:true},0,0,1);assert.equal(h.state.items[0],known);
});
test('creation cache never downgrades its known edit, including a later cache-only load',async()=>{
  const h=harness(),known={...h.initial,revision:3,note:'known',like_count:7};h.c.newPosts.current=[known];h.state.items=[];
  h.c.finish(h.initial,0,0,1);assert.equal(h.c.newPosts.current[0],known);assert.equal(h.state.items[0],known);
  const read=h.c.load('note');h.requests[0].resolve(page([]));await read;assert.equal(h.state.items[0],known);
});
test('fresh cache cannot overwrite a newer visible post when the page omits that ID',async()=>{
  const h=harness(),known={...h.initial,revision:2,note:'known',like_count:7};h.state.items=[known];h.c.newPosts.current=[h.initial];
  const read=h.c.load('note');h.requests[0].resolve(page([]));await read;assert.equal(h.state.items[0],known);
});
for(const operation of ['remove','hide'])test(`late creation ACK cannot revive a confirmed ${operation} in its own pending publication`,async()=>{
  const h=harness();h.c.pending.current={kind:'note',generation:1,key:'pending'};await h.c[operation](h.initial);h.c.finish(h.initial,0,0,1);
  assert.equal(h.state.items.length,0);assert.equal(h.c.newPosts.current.length,0);assert.equal(h.c.pending.current,null);
});
for(const operation of ['remove','hide'])test(`${operation} cannot mark a replacement pending publication or session`,async()=>{
  const h=harness();let resolve:any;const waiting=new Promise(r=>resolve=r);h.c.pending.current={kind:'note',generation:1,key:'first'};
  if(operation==='remove')h.c.accessAwareFetch=()=>waiting;else h.c.client.post=()=>waiting;
  const action=h.c[operation](h.initial);h.c.client.sessionGeneration=2;const next={kind:'note',generation:2,key:'next'};h.c.pending.current=next;
  resolve({ok:true});await action;assert.equal(h.state.items.length,1);assert.equal(h.c.pending.current,next);assert.equal((next as any).removed,undefined);assert.equal(h.c.confirmedWrites.current,0);
});
test('ordinary absence and a failed removal do not suppress a confirmed creation',async()=>{
  const h=harness();h.state.items=[];h.c.pending.current={kind:'note',generation:1,key:'pending'};h.c.accessAwareFetch=async()=>{throw Error('unknown');};
  await h.c.remove(h.initial);h.c.finish(h.initial,0,0,1);assert.equal(h.state.items.length,1);assert.equal(h.c.newPosts.current.length,1);
});
function publicationThumbnailHarness(){
  const h=harness();h.initial.kind='link';h.initial.platform='other';h.initial.url='https://example.org/p';h.initial.thumbnail_url=null;
  h.c.selection.current.platform='';h.c.composerMessages.thumbnailPending=['thumbnail unconfirmed'];
  h.c.pending.current={kind:'link',generation:1,key:'create-key',body:{url:h.initial.url},created:{...h.initial},photo:{type:'image/png'},thumbnailKey:'upload-key'};
  const publishLink=between('async function publishLink() {','\n  async function publish(event: FormEvent) {');
  runInNewContext(transformSync(`globalThis.publishLink=async function(){${publishLink}`,{loader:'ts',format:'cjs'}).code,h.c);return h;
}
for(const revision of [1,3])test(`publication thumbnail ACK updates existing revision ${revision} without downgrading other fields`,async()=>{
  const h=publicationThumbnailHarness();let resolve:any;h.c.accessAwareFetch=()=>new Promise(r=>resolve=r);const publishing=h.c.publishLink();await tick();
  const known={...h.initial,revision,note:'fresh text',like_count:7,comment_count:8,mine:false};h.state.items=[known];h.c.newPosts.current=[known];
  resolve({ok:true,json:async()=>({...h.initial,thumbnail_url:'/api/v1/social-posts/p/thumbnail'})});await publishing;
  for(const item of [h.state.items[0],h.c.newPosts.current[0]]){assert.match(item.thumbnail_url,/^\/api\/v1\/social-posts\/p\/thumbnail(?:\?v=\d+)?$/);assert.equal(item.revision,revision);assert.equal(item.note,'fresh text');assert.equal(item.like_count,7);assert.equal(item.comment_count,8);assert.equal(item.mine,false);}
});
for(const boundary of ['remove','hide','session'])test(`publication thumbnail ACK respects ${boundary}`,async()=>{
  const h=publicationThumbnailHarness();let resolve:any;h.c.accessAwareFetch=()=>new Promise(r=>resolve=r);const publishing=h.c.publishLink();await tick();
  if(boundary==='session')h.c.client.sessionGeneration++;else{h.c.accessAwareFetch=async()=>({ok:true});await h.c[boundary](h.initial);}
  resolve({ok:true,json:async()=>({...h.initial,thumbnail_url:'/api/v1/social-posts/p/thumbnail'})});await publishing;
  if(boundary==='session'){assert.equal(h.state.items[0].thumbnail_url,null);assert.equal(h.c.confirmedWrites.current,0);}else{assert.equal(h.state.items.length,0);assert.equal(h.c.newPosts.current.length,0);}
});
for(const invalid of [{post_id:'other'},{kind:'note'},{url:'https://example.org/other'},{thumbnail_url:'https://example.org/untrusted'}])test(`publication rejects invalid thumbnail ACK ${JSON.stringify(invalid)}`,async()=>{
  const h=publicationThumbnailHarness();h.c.accessAwareFetch=async()=>({ok:true,json:async()=>({...h.initial,thumbnail_url:'/api/v1/social-posts/p/thumbnail',...invalid})});await h.c.publishLink();
  assert.equal(h.state.items[0].thumbnail_url,null);assert.equal(h.c.confirmedWrites.current,0);assert.ok(h.c.pending.current,'unconfirmed upload remains retryable');
});
test('unknown publication upload retries its original key and photo before projection',async()=>{
  const h=publicationThumbnailHarness(),calls:any[]=[];h.c.accessAwareFetch=async(path:string,options:any)=>{calls.push({path,key:options.headers['Idempotency-Key'],body:options.body});if(calls.length===1)throw Error('unknown');return {ok:true,json:async()=>({...h.initial,thumbnail_url:'/api/v1/social-posts/p/thumbnail'})};};
  await h.c.publishLink();const pending=h.c.pending.current;assert.ok(pending);assert.equal(h.state.items[0].thumbnail_url,null);assert.equal(h.c.confirmedWrites.current,0);
  await h.c.publishLink();assert.equal(calls.length,2);assert.deepEqual(calls[1],calls[0]);assert.equal(calls[1].body,pending.photo);assert.equal(h.c.pending.current,null);assert.match(h.state.items[0].thumbnail_url,/thumbnail\?v=/);
});
test('publication thumbnail projection does not modify a different post',async()=>{
  const h=publicationThumbnailHarness(),other={...h.initial,post_id:'other',thumbnail_url:'other-image'};h.state.items.push(other);h.c.newPosts.current=[other];h.c.accessAwareFetch=async()=>({ok:true,json:async()=>({...h.initial,thumbnail_url:'/api/v1/social-posts/p/thumbnail'})});await h.c.publishLink();
  assert.equal(h.state.items.find((p:any)=>p.post_id==='other'),other);assert.equal(h.c.newPosts.current.find((p:any)=>p.post_id==='other'),other);
});
test('an old creation thumbnail is not fresh upload provenance',()=>{
  const h=harness(),known={...h.initial,thumbnail_url:'newer-image'};h.state.items=[known];h.c.newPosts.current=[known];h.c.finish({...h.initial,thumbnail_url:'old-image'},0,0,1);assert.equal(h.state.items[0],known);assert.equal(h.c.newPosts.current[0],known);
});
function thumbnailHarness(){
  const h=harness();h.initial.kind='link';h.c.saving=false;h.c.prepareSocialImage=async(f:unknown)=>f;h.c.setActionError=(v:string)=>h.state.actionError=v;
  const thumb=between('async function uploadLinkThumb(post: Post, next: File) {','\n  async function remove(');
  runInNewContext(transformSync(`globalThis.thumb=async function(post,next){${thumb}`,{loader:'ts',format:'cjs'}).code,h.c);return h;
}
test('thumbnail ACK projects only its thumbnail onto current and retained post metadata',async()=>{
  const h=thumbnailHarness();let resolve:any;h.c.accessAwareFetch=()=>new Promise(r=>resolve=r);const uploading=h.c.thumb(h.initial,{type:'image/png'});await tick();
  const known={...h.initial,revision:2,note:'known',like_count:7,mine:false};h.state.items=[known];h.c.newPosts.current=[known];
  resolve({ok:true,json:async()=>({...h.initial,thumbnail_url:'/api/v1/social-posts/p/thumbnail',like_count:0,mine:true})});await uploading;
  for(const item of [h.state.items[0],h.c.newPosts.current[0]]){assert.equal(item.revision,2);assert.equal(item.note,'known');assert.equal(item.like_count,7);assert.equal(item.mine,false);assert.match(item.thumbnail_url,/^\/api\/v1\/social-posts\/p\/thumbnail\?v=\d+$/);}
  assert.equal(h.c.confirmedWrites.current,1);
});
for(const invalid of [{post_id:'other'},{kind:'note'},{thumbnail_url:null},{thumbnail_url:'https://example.com/wrong'}])test(`invalid thumbnail receipt ${JSON.stringify(invalid)} remains unconfirmed`,async()=>{
  const h=thumbnailHarness();h.c.accessAwareFetch=async()=>({ok:true,json:async()=>({...h.initial,thumbnail_url:'/api/v1/social-posts/p/thumbnail',...invalid})});
  await h.c.thumb(h.initial,{type:'image/png'});assert.equal(h.state.items[0],h.initial);assert.equal(h.c.confirmedWrites.current,0);assert.ok(h.state.actionError);
});

test('creation and cache projection updaters are replayable without mutating refs or their input',async()=>{
  const h=harness(),known={...h.initial,revision:2,note:'known'};h.state.items=[known];const callbacks:any[]=[];
  h.c.setItems=(value:any)=>{assert.equal(typeof value,'function');callbacks.push(value);};h.c.finish(h.initial,0,0,1);
  const cache=h.c.newPosts.current,first=callbacks.shift(),input=Object.freeze([Object.freeze(known)]);
  assert.equal(first(input)[0],known);assert.equal(first(input)[0],known);assert.equal(h.c.newPosts.current,cache);
  const read=h.c.load('note');h.requests[0].resolve(page([]));await read;const freshCache=h.c.newPosts.current,next=callbacks.shift();
  assert.equal(next(input)[0],known);assert.equal(next(input)[0],known);assert.equal(h.c.newPosts.current,freshCache);
});
test('newer known tags do not leak a retained creation into an obsolete category',async()=>{
  const h=harness();h.c.tag='old';h.c.feedScope.current.tag='old';h.c.selection.current.tag='old';const known={...h.initial,revision:2,tags:['new']};h.state.items=[known];
  h.c.finish({...h.initial,tags:['old']},0,0,1);assert.equal(h.state.items.length,0);
  h.state.items=[known];const read=h.c.load('note');h.requests[0].resolve(page([]));await read;assert.equal(h.state.items.length,0);
});
for(const operation of ['remove','hide'])test(`${operation} started under another pending command never marks its successor`,async()=>{
  const h=harness();let resolve:any;const waiting=new Promise(r=>resolve=r);h.c.pending.current={kind:'note',generation:1,key:'first'};
  if(operation==='remove')h.c.accessAwareFetch=()=>waiting;else h.c.client.post=()=>waiting;
  const action=h.c[operation](h.initial),next={kind:'note',generation:1,key:'next'};h.c.pending.current=next;resolve({ok:true});await action;
  assert.equal((next as any).removed,undefined);h.c.finish(h.initial,0,0,1);assert.equal(h.state.items.length,1);
});
for(const change of ['removed','session'])test(`thumbnail late ACK respects ${change} without reviving items`,async()=>{
  const h=thumbnailHarness();let resolve:any;h.c.accessAwareFetch=()=>new Promise(r=>resolve=r);const uploading=h.c.thumb(h.initial,{type:'image/png'});await tick();
  h.state.items=[];h.c.newPosts.current=[];if(change==='session')h.c.client.sessionGeneration++;
  resolve({ok:true,json:async()=>({...h.initial,thumbnail_url:'/api/v1/social-posts/p/thumbnail'})});await uploading;
  assert.equal(h.state.items.length,0);assert.equal(h.c.newPosts.current.length,0);assert.equal(h.c.confirmedWrites.current,change==='session'?0:1);
});
test('thumbnail confirmation invalidates an older list read with one same-query revalidation',async()=>{
  const h=thumbnailHarness(),read=h.c.load('note');h.c.accessAwareFetch=async()=>({ok:true,json:async()=>({...h.initial,thumbnail_url:'/api/v1/social-posts/p/thumbnail'})});
  await h.c.thumb(h.initial,{type:'image/png'});h.requests[0].resolve(page([h.initial]));await tick();assert.equal(h.requests.length,2);assert.equal(h.requests[1].path,h.requests[0].path);
  h.requests[1].resolve(page([{...h.initial,thumbnail_url:'/api/v1/social-posts/p/thumbnail'}]));await read;assert.equal(h.state.loading,false);
});

function deletionForwarder(){
  const fixture=readFileSync(new URL('../e2e/social-feed.spec.ts',import.meta.url),'utf8'),start=fixture.indexOf('async function forwardSocialDeletion('),end=fixture.indexOf('\n}\n',start)+2;assert.ok(start>=0&&end>start);
  const context:any={};runInNewContext(transformSync(`${fixture.slice(start,end)};globalThis.forward=forwardSocialDeletion`,{loader:'ts',format:'cjs'}).code,context);return context.forward;
}
test('held-publication deletion receipt reads the original server body before forwarding once',async()=>{
  const events:string[]=[],body={post_id:'p',state:'deleted'},response={status:()=>200,json:async()=>{events.push('body');return body;}},route={fetch:async()=>{events.push('fetch');return response;},fulfill:async(value:any)=>{events.push('fulfill');assert.equal(value.response,response);}};
  const receipt=await deletionForwarder()(route);assert.equal(receipt.status,200);assert.equal(receipt.body,body);assert.deepEqual(events,['fetch','body','fulfill']);
});
test('deletion forwarder never invents a successful receipt after body failure',async()=>{
  let fulfilled=false;await assert.rejects(()=>deletionForwarder()({fetch:async()=>({status:()=>200,json:async()=>{throw Error('body unavailable');}}),fulfill:async()=>{fulfilled=true;}}),/body unavailable/);assert.equal(fulfilled,false);
});
test('deletion forwarder preserves a server rejection for the original status assertion',async()=>{
  const body={code:'not_found'},receipt=await deletionForwarder()({fetch:async()=>({status:()=>404,json:async()=>body}),fulfill:async()=>{}});assert.equal(receipt.status,404);assert.equal(receipt.body,body);
});

function counterHarness(){
  const h=harness();Object.assign(h.initial,{kind:'link',platform:'youtube',like_count:0,liked:false,comment_count:1,read_count:1});
  Object.assign(h.c,{items:h.state.items,post:h.initial,shortLiking:null,shortLikeCommands:{current:new Map()},setShortLiking(){}});
  const like=between('async function likeShort(postId: string) {','\n  const feedText=');
  const a=source.indexOf('onUpdate={update =>'),b=source.indexOf('}/>',a);assert.ok(a>=0&&b>a);
  runInNewContext(transformSync(`globalThis.like=async function(postId){${like};globalThis.interaction=${source.slice(a+'onUpdate={'.length,b)};`,{loader:'ts',format:'cjs'}).code,h.c);
  return h;
}
for(const operation of ['short-like','card-like','comment','read'])for(const mode of ['replace','append','quiet'])test(`${operation} confirmation fences a pending ${mode} feed read without an extra independent GET`,async()=>{
  const h=counterHarness();h.c.feedScope.current.platform=mode==='quiet'?'shorts':'note';
  const read=mode==='quiet'?h.c.quiet(1):h.c.load('note',mode==='append'?'original-cursor':undefined);
  const update=operation.includes('like')?{liked:true,like_count:1}:operation==='comment'?{comment_count:2}:{read_count:2};
  if(operation==='short-like'){h.c.client.post=async()=>update;await h.c.like('p');}else h.c.interaction(update);
  assert.equal(h.c.confirmedWrites.current,1);assert.equal(h.requests.length,1,'confirmation starts no independent read');
  h.requests[0].resolve(page([h.initial]));await tick();
  if(mode==='quiet'){assert.equal(await read,null);assert.equal(h.requests.length,1);}else{
    assert.equal(h.requests.length,2);assert.equal(h.requests[1].path,h.requests[0].path);h.requests[1].resolve(page([{...h.initial,...update}]));await read;
    assert.equal(h.state.loading,false);assert.equal(h.state.more,false);
  }
  for(const [key,value] of Object.entries(update))assert.equal(h.state.items[0][key],value);
});
for(const network of [false,true])test(`Short like ${network?'unknown':'rejected'} result never advances the confirmed epoch`,async()=>{
  const h=counterHarness(),read=h.c.load('note');h.c.client.post=async()=>{throw new ApiError({message:'not confirmed',network,status:network?0:422});};await h.c.like('p');
  assert.equal(h.c.confirmedWrites.current,0);h.requests[0].resolve(page([h.initial]));await read;assert.equal(h.requests.length,1);
});
test('ordinary list and quiet reads never advance the mutation epoch or start correction loops',async()=>{
  const h=counterHarness(),read=h.c.load('note');h.requests[0].resolve(page([h.initial]));await read;assert.equal(h.c.confirmedWrites.current,0);
  h.c.feedScope.current.platform='shorts';const quiet=h.c.quiet(1);h.requests[1].resolve(page([h.initial],null));await quiet;assert.equal(h.c.confirmedWrites.current,0);assert.equal(h.requests.length,2);
});
for(const operation of ['short-like','callback'])test(`old-session ${operation} completion cannot invalidate or replace the new feed`,async()=>{
  const h=counterHarness();let resolve:any;
  if(operation==='short-like'){h.c.client.post=()=>new Promise(r=>resolve=r);const pending=h.c.like('p');h.c.client.sessionGeneration++;resolve({liked:true,like_count:1});await pending;}
  else{h.c.client.sessionGeneration++;h.c.interaction({comment_count:2});}
  assert.equal(h.c.confirmedWrites.current,0);assert.equal(h.state.items[0],h.initial);
});

const interactionSource=readFileSync(new URL('../../apps/portal-web/src/modules/SocialInteractions.tsx',import.meta.url),'utf8');
for(const operation of ['comment-send','comment-remove','read-mark'])for(const network of [false,true])test(`actual ${operation} ${network?'unknown':'rejected'} path never calls the confirmed parent callback`,async()=>{
  const h=counterHarness();Object.assign(h.c,{sending:false,preparing:false,pendingComment:{current:null},file:null,onUpdate:h.c.interaction,setSending(){},current:(generation:number)=>h.c.client.sessionGeneration===generation});
  let attempts=0;const failure=async()=>{attempts++;throw new ApiError({message:'not confirmed',network,status:network?0:422});};h.c.client.post=failure;h.c.client.delete=failure;
  if(operation==='read-mark'){
    let scheduled!:()=>void;Object.assign(h.c,{document:{hidden:false},clearTimeout(){},setTimeout:(fn:()=>void)=>{scheduled=fn;return 1;}});
    const a=interactionSource.indexOf('    const schedule=()=>'),b=interactionSource.indexOf('    const observer=',a);assert.ok(a>=0&&b>a);
    runInNewContext(transformSync(`let timer,visible=true,done=false;const generation=client.sessionGeneration,key='synthetic-read';${interactionSource.slice(a,b)};schedule();`,{loader:'ts',format:'cjs'}).code,h.c);scheduled();await tick();
  }else{
    const a=interactionSource.indexOf(operation==='comment-send'?'  async function send(':'  async function remove('),b=interactionSource.indexOf(operation==='comment-send'?'  async function remove(':'  async function saveEdit(',a);assert.ok(a>=0&&b>a);
    runInNewContext(transformSync(interactionSource.slice(a,b)+`;globalThis.action=${operation==='comment-send'?'send':'remove'};`,{loader:'ts',format:'cjs'}).code,h.c);
    await h.c.action(operation==='comment-send'?{preventDefault(){}}:{comment_id:'comment'});
  }
  assert.equal(attempts,1);assert.equal(h.c.confirmedWrites.current,0);assert.equal(h.state.items[0],h.initial);assert.equal(h.requests.length,0);
});
