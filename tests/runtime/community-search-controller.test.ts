import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createCommunitySearch,changeSearchQuery} from '../../apps/portal-web/src/modules/community-search-controller.js';

type Page = {items: string[]; next_cursor: string | null};
const page = (value='found'):Page => ({items:[value],next_cursor:null});
const tick = async () => {for(let i=0;i<6;i++) await Promise.resolve();};
function deferred<T>() {
  let resolve!: (value:T)=>void, reject!: (error:unknown)=>void;
  const promise = new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
function harness(query='') {
  let generation=1,clock=0;
  const timers = new Set<{at:number; callback:()=>void}>();
  const requests:{query:string;signal:AbortSignal;response:ReturnType<typeof deferred<Page>>}[]=[];
  const history:{query:string;mode:'replace'|'push'}[]=[];
  const controller=createCommunitySearch<Page>({query,generation:()=>generation,
    read:(query,signal)=>{const response=deferred<Page>();requests.push({query,signal,response});return response.promise;},
    writeQuery:(query,mode)=>{history.push({query,mode});},
    schedule:(callback,ms)=>{const timer={at:clock+ms,callback};timers.add(timer);return()=>{timers.delete(timer);};},
  });
  return {controller,requests,history,timers,
    generation:()=>{generation++;},
    advance:async(ms:number)=>{clock+=ms;for(const timer of [...timers])if(timer.at<=clock){timers.delete(timer);timer.callback();}await tick();},
    start:async()=>{controller.start();await tick();},
    finish:async(value=page())=>{requests.at(-1)!.response.resolve(value);await tick();},
  };
}

test('query edits preserve filters/limit, reset cursor and escape reserved characters',()=>{
  const value=changeSearchQuery('q=old&kinds=work&limit=2&cursor=old','q','設計&100%');
  const query=new URLSearchParams(value);
  assert.equal(query.get('q'),'設計&100%');assert.equal(query.get('kinds'),'work');
  assert.equal(query.get('limit'),'2');assert.equal(query.has('cursor'),false);
});

test('snapshots are stable and constructing a controller performs no I/O',()=>{
  const h=harness('q=old');assert.equal(h.requests.length,0);
  assert.equal(h.controller.getSnapshot(),h.controller.getSnapshot());
  assert.equal(h.controller.getSnapshot().draft,'old');assert.equal(h.history.length,0);
});

test('initial reads start immediately without a debounce timer',async()=>{
  const h=harness('q=hello');await h.start();
  assert.equal(h.requests.length,1);assert.equal(h.timers.size,0);
  assert.equal(h.controller.getSnapshot().status,'loading');
  await h.finish();assert.equal(h.controller.getSnapshot().status,'ready');
});

test('typing waits 180ms and only sends the latest query',async()=>{
  const h=harness();await h.start();await h.finish();
  h.controller.edit('a');await h.advance(100);h.controller.edit('ab');
  await h.advance(179);assert.equal(h.requests.length,1);
  await h.advance(1);assert.equal(h.requests.length,2);
  assert.equal(new URLSearchParams(h.requests[1].query).get('q'),'ab');
  assert.ok(h.history.every(entry=>entry.mode==='replace'));
});

test('text edits immediately remove previous results and cancel the previous request',async()=>{
  const h=harness();await h.start();h.controller.edit('new');
  assert.equal(h.requests[0].signal.aborted,true);
  assert.equal(h.controller.getSnapshot().page,null);
  assert.equal(h.controller.getSnapshot().status,'waiting');
});

test('Enter flushes debounce without resending after the timer',async()=>{
  const h=harness();await h.start();await h.finish();h.controller.edit('fast');
  h.controller.submit();await tick();assert.equal(h.requests.length,2);
  assert.equal(h.timers.size,0);await h.advance(500);assert.equal(h.requests.length,2);
});

test('repeated submit and foreground events share the pending read',async()=>{
  const h=harness();await h.start();
  h.controller.submit();h.controller.refresh();h.controller.submit();await tick();
  assert.equal(h.requests.length,1);
});

test('explicit submit after completion really re-reads, without retaining old results',async()=>{
  const h=harness();await h.start();await h.finish();h.controller.submit();
  assert.equal(h.controller.getSnapshot().page,null);await tick();assert.equal(h.requests.length,2);
});

test('foreground refresh cannot shorten an unfinished typing debounce',async()=>{
  const h=harness();await h.start();await h.finish();h.controller.edit('slow');
  h.controller.refresh();await tick();assert.equal(h.requests.length,1);
  await h.advance(180);assert.equal(h.requests.length,2);
});

test('IME drafts never enter the URL or HTTP until composition ends',async()=>{
  const h=harness('q=old&kinds=work&cursor=p2');await h.start();await h.finish();
  h.controller.beginComposition();h.controller.edit('ㄕ');await h.advance(500);
  h.controller.edit('設計');h.controller.refresh();h.controller.submit();await h.advance(500);
  assert.equal(h.requests.length,1);assert.equal(h.history.length,0);
  assert.equal(h.controller.getSnapshot().draft,'設計');assert.equal(h.controller.getSnapshot().composing,true);
  h.controller.endComposition('設計');await h.advance(180);
  assert.equal(h.requests.length,2);assert.equal(h.history.length,1);
  const query=new URLSearchParams(h.requests[1].query);
  assert.equal(query.get('q'),'設計');assert.equal(query.get('kinds'),'work');assert.equal(query.has('cursor'),false);
});

test('trailing input event after compositionend does not restart or duplicate search',async()=>{
  const h=harness();await h.start();h.controller.beginComposition();h.controller.edit('設');
  h.controller.endComposition('設計');h.controller.edit('設計');await h.advance(180);
  assert.equal(h.requests.length,2);assert.equal(h.history.length,1);assert.equal(h.timers.size,0);
});

test('cancelled composition revalidates the committed page without losing its cursor',async()=>{
  const h=harness('q=old&cursor=p2');await h.start();await h.finish();
  h.controller.beginComposition();h.controller.edit('temporary');h.controller.endComposition('old');
  await h.advance(180);assert.equal(h.requests.length,2);assert.equal(h.requests[1].query,'q=old&cursor=p2');
  assert.equal(h.history.length,0);
});

test('composition cancels both pending HTTP and debounce work',async()=>{
  const h=harness();await h.start();h.controller.beginComposition();assert.equal(h.requests[0].signal.aborted,true);
  h.controller.endComposition('first');h.controller.beginComposition();await h.advance(500);
  assert.equal(h.requests.length,1);assert.equal(h.timers.size,0);
});

test('filters, paging and clear do not commit partial composition',async()=>{
  const h=harness('q=old');await h.start();await h.finish();h.controller.beginComposition();h.controller.edit('半');
  h.controller.toggle('kinds','work');h.controller.next('next');h.controller.first();h.controller.clear();await tick();
  assert.equal(h.controller.getSnapshot().query,'q=old');assert.equal(h.history.length,0);
});

test('filter toggle cancels debounce, keeps the latest text, and sends immediately',async()=>{
  const h=harness('q=old&cursor=p2');await h.start();h.controller.edit('new');h.controller.toggle('kinds','work');await tick();
  const query=new URLSearchParams(h.requests.at(-1)!.query);
  assert.equal(query.get('q'),'new');assert.equal(query.get('kinds'),'work');assert.equal(query.has('cursor'),false);
  assert.equal(h.timers.size,0);assert.equal(h.requests.length,2);
});

test('multiple kind/topic toggles preserve both dimensions and remove deselected values',async()=>{
  const h=harness();await h.start();h.controller.toggle('kinds','work');h.controller.toggle('topics','tools');h.controller.toggle('kinds','event');h.controller.toggle('kinds','work');await tick();
  const query=new URLSearchParams(h.controller.getSnapshot().query);
  assert.equal(query.get('kinds'),'event');assert.equal(query.get('topics'),'tools');
  h.controller.toggle('topics','tools');assert.equal(new URLSearchParams(h.controller.getSnapshot().query).has('topics'),false);
});

test('clear removes search conditions and cursor but does not create a history entry per field',async()=>{
  const h=harness('q=hi&topics=tools&kinds=work&cursor=next');await h.start();await h.finish();
  h.controller.clear();await tick();assert.equal(h.controller.getSnapshot().draft,'');
  assert.equal(h.requests[1].query,'');assert.deepEqual(h.history,[{query:'',mode:'replace'}]);
});

test('paging creates exactly one history entry and request despite a double click',async()=>{
  const h=harness('q=hi');await h.start();await h.finish({items:['one'],next_cursor:'next'});
  h.controller.next('next');h.controller.next('next');await tick();
  assert.equal(h.requests.length,2);assert.deepEqual(h.history,[{query:'q=hi&cursor=next',mode:'push'}]);
});

test('first-page navigation removes only cursor and pushes history',async()=>{
  const h=harness('q=hi&kinds=work&cursor=next');await h.start();h.controller.first();await tick();
  assert.deepEqual(h.history,[{query:'q=hi&kinds=work',mode:'push'}]);assert.equal(h.requests[0].signal.aborted,true);
});

test('Back/Forward restore filters and text, cancel old reads, and never write history',async()=>{
  const h=harness('q=first');await h.start();h.controller.restore('q=second&topics=tools&cursor=next');await tick();
  assert.equal(h.requests[0].signal.aborted,true);assert.equal(h.controller.getSnapshot().draft,'second');
  assert.equal(h.history.length,0);assert.equal(h.requests.length,2);
  h.controller.restore('q=first');await tick();assert.equal(h.requests.length,3);
});

test('duplicate popstate/hashchange notifications do not repeat the restored request',async()=>{
  const h=harness('q=first');await h.start();h.controller.restore('q=second');h.controller.restore('q=second');await tick();
  assert.equal(h.requests.length,2);
});

test('restoring browser history cancels an unfinished composition',async()=>{
  const h=harness('q=first');await h.start();h.controller.beginComposition();h.controller.edit('temporary');
  h.controller.restore('q=first');await tick();assert.equal(h.controller.getSnapshot().composing,false);
  assert.equal(h.controller.getSnapshot().draft,'first');assert.equal(h.requests.length,2);
});

for(const failure of [false,true])test(`late ${failure?'failure':'success'} from a cancelled read cannot replace current results`,async()=>{
  const h=harness();await h.start();h.controller.edit('new');h.controller.submit();await tick();await h.finish(page('current'));
  if(failure)h.requests[0].response.reject(new Error('old'));else h.requests[0].response.resolve(page('old'));
  await tick();assert.deepEqual(h.controller.getSnapshot().page,page('current'));assert.equal(h.controller.getSnapshot().status,'ready');
});

test('failed reads have no result, and explicit retry starts immediately',async()=>{
  const h=harness();await h.start();h.requests[0].response.reject(new Error('offline'));await tick();
  assert.equal(h.controller.getSnapshot().status,'error');assert.equal(h.controller.getSnapshot().page,null);
  h.controller.submit();await tick();assert.equal(h.requests.length,2);await h.finish({items:[],next_cursor:null});
  assert.equal(h.controller.getSnapshot().status,'ready');assert.deepEqual(h.controller.getSnapshot().page?.items,[]);
});

test('return revalidation clears revoked results rather than showing retained content on failure',async()=>{
  const h=harness();await h.start();await h.finish(page('private'));h.controller.refresh();
  assert.equal(h.controller.getSnapshot().page,null);await tick();
  h.requests[1].response.reject({status:403});await tick();assert.equal(h.controller.getSnapshot().page,null);
  assert.equal(h.controller.getSnapshot().status,'error');
});

test('saving topics forces a fresh read even if the same query was already pending',async()=>{
  const h=harness();await h.start();h.controller.refresh(true);await tick();
  assert.equal(h.requests.length,2);assert.equal(h.requests[0].signal.aborted,true);
  h.requests[0].response.resolve(page('before save'));await tick();assert.equal(h.controller.getSnapshot().page,null);
  await h.finish(page('after save'));assert.deepEqual(h.controller.getSnapshot().page,page('after save'));
});

test('identity changes immediately return a stable empty snapshot and reject late responses',async()=>{
  const h=harness('q=private');await h.start();h.generation();
  assert.equal(h.controller.getSnapshot().page,null);assert.equal(h.controller.getSnapshot().query,'');
  assert.equal(h.controller.getSnapshot(),h.controller.getSnapshot());
  h.requests[0].response.resolve(page('private'));await tick();assert.equal(h.controller.getSnapshot().page,null);
  h.controller.edit('leak');h.controller.submit();h.controller.refresh(true);await tick();
  assert.equal(h.requests.length,1);assert.equal(h.history.length,0);
});

test('same-tick cleanup prevents an HTTP read and start/stop/start is reusable',async()=>{
  const h=harness();h.controller.start();h.controller.stop();h.controller.start();await tick();
  assert.equal(h.requests.length,1);await h.finish();assert.equal(h.controller.getSnapshot().status,'ready');
});

test('unmount cancels timer and in-flight reads and prevents later edits',async()=>{
  const h=harness();await h.start();h.controller.edit('next');h.controller.stop();await h.advance(500);
  assert.equal(h.requests[0].signal.aborted,true);assert.equal(h.requests.length,1);assert.equal(h.timers.size,0);
  h.controller.edit('after');h.controller.submit();await tick();assert.equal(h.requests.length,1);
});

test('subscribers receive actual changes and unsubscribe stops notifications',async()=>{
  const h=harness();let count=0;const unsubscribe=h.controller.subscribe(()=>{count++;});
  await h.start();assert.ok(count>0);const before=count;unsubscribe();await h.finish();assert.equal(count,before);
});

test('synchronous read exceptions become recoverable errors',async()=>{
  const c=createCommunitySearch({query:'',generation:()=>0,read:()=>{throw new Error('bad response');},writeQuery:()=>{}});
  c.start();await tick();assert.equal(c.getSnapshot().status,'error');assert.match(String(c.getSnapshot().error),/bad response/);
});
