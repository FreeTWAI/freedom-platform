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
  const finish=between('function finishPublication(created:Post,selectedVersion:number,interactionVersion:number,generation:number) {','\n  async function publishLink(');
  const select=between('function selectPlatform(next: string) {','\n  function clearDirectPost(');
  const quiet=between('const refreshShorts = useCallback(', ', [client, feedSession, tag]);');
  const retry=between('function retryFeed() {','\n  function refreshAfterAction(');
  const publish=between('async function publish(event: FormEvent) {','\n  async function uploadLinkThumb(');
  // These are the production closures, not a model of their epoch/merge logic.
  runInNewContext(transformSync(`globalThis.load=${load};globalThis.saved=${saved};globalThis.remove=async function(post){${remove};globalThis.hide=async function(post){${hide};globalThis.finish=function(created,selectedVersion,interactionVersion,generation){${finish};globalThis.selectPlatform=function(next){${select};globalThis.quiet=${quiet};globalThis.retry=function(){${retry};globalThis.finishPublication=globalThis.finish;globalThis.publish=async function(event){${publish}`,{loader:'ts',format:'cjs'}).code,c);
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
