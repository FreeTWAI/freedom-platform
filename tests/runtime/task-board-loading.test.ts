import assert from 'node:assert/strict';
import {test} from 'node:test';
import {appendTaskItems,createTaskRead} from '../../apps/portal-web/src/modules/task-board-loading.js';

function deferred<T>() {
  let resolve!: (value:T)=>void, reject!: (cause:unknown)=>void;
  const promise = new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
const tick = () => Promise.resolve();

test('idle snapshots are stable and contain no fabricated empty result', () => {
  const lane=createTaskRead<number[]>(()=>1);
  assert.equal(lane.getSnapshot(),lane.getSnapshot());
  assert.equal(lane.getSnapshot().status,'idle');
  assert.equal(lane.getSnapshot().value,null);
});

test('loading is immediate and successful reads publish exactly their result', async () => {
  const lane=createTaskRead<number[]>(()=>1), result=deferred<number[]>();
  let called=0;
  const done=lane.run('query',async signal=>{called++;assert.equal(signal.aborted,false);return result.promise;});
  assert.equal(lane.getSnapshot().status,'loading');
  await tick();assert.equal(called,1);
  result.resolve([1]);await done;
  assert.deepEqual(lane.getSnapshot(),{key:'query',status:'ready',value:[1],error:null});
});

test('same-key double clicks share only the pending read', async () => {
  const lane=createTaskRead<number>(()=>1), result=deferred<number>();let calls=0;
  const read=async()=>{calls++;return result.promise;};
  const a=lane.run('query',read),b=lane.run('query',read);
  assert.equal(a,b);await tick();assert.equal(calls,1);
  result.resolve(1);await a;
  await lane.run('query',async()=>{calls++;return 2;});
  assert.equal(calls,2);assert.equal(lane.getSnapshot().value,2);
});

test('a new filter aborts the old read and drops its late success', async () => {
  const lane=createTaskRead<string>(()=>1), old=deferred<string>();let signal!:AbortSignal;
  const a=lane.run('old',async value=>{signal=value;return old.promise;});await tick();
  const b=lane.run('new',async()=>'new result');assert.equal(signal.aborted,true);
  await b;old.resolve('late old result');await a;
  assert.equal(lane.getSnapshot().value,'new result');
});

test('a replaced read cannot overwrite success with a late failure', async () => {
  const lane=createTaskRead<string>(()=>1), old=deferred<string>();
  const a=lane.run('old',()=>old.promise);await tick();
  await lane.run('new',async()=>'new result');old.reject(new Error('old failure'));await a;
  assert.equal(lane.getSnapshot().status,'ready');assert.equal(lane.getSnapshot().value,'new result');
});

test('cancelling before dispatch avoids the HTTP call entirely', async () => {
  const lane=createTaskRead<number>(()=>1);let calls=0;
  const done=lane.run('query',async()=>{calls++;return 1;});lane.cancel();await done;
  assert.equal(calls,0);assert.equal(lane.getSnapshot().status,'idle');
});

test('a failed first page stays error, never a successful empty list', async () => {
  const lane=createTaskRead<number[]>(()=>1), failure=new Error('unavailable');
  await lane.run('query',async()=>{throw failure;});
  assert.equal(lane.getSnapshot().status,'error');assert.equal(lane.getSnapshot().value,null);
  assert.equal(lane.getSnapshot().error,failure);
});

test('synchronous reader throws are represented as failures', async () => {
  const lane=createTaskRead<number>(()=>1);
  await lane.run('query',()=>{throw new Error('invalid response');});
  assert.equal(lane.getSnapshot().status,'error');
});

test('a real successful empty list remains distinguishable from failure', async () => {
  const lane=createTaskRead<number[]>(()=>1);await lane.run('query',async()=>[]);
  assert.equal(lane.getSnapshot().status,'ready');assert.deepEqual(lane.getSnapshot().value,[]);
});

test('same-filter refresh can display old data while loading', async () => {
  const lane=createTaskRead<number[]>(()=>1), next=deferred<number[]>();
  await lane.run('query',async()=>[1]);
  const done=lane.run('query',()=>next.promise,{retain:true});
  assert.equal(lane.getSnapshot().status,'loading');assert.deepEqual(lane.getSnapshot().value,[1]);
  next.resolve([2]);await done;assert.deepEqual(lane.getSnapshot().value,[2]);
});

test('a failed refresh drops data unless error retention was explicitly requested', async () => {
  const lane=createTaskRead<number[]>(()=>1);await lane.run('query',async()=>[1]);
  await lane.run('query',async()=>{throw new Error('failed');},{retain:true});
  assert.equal(lane.getSnapshot().value,null);
});

test('a failed project refresh retains the project choices for retry', async () => {
  const projects=createTaskRead<string[]>(()=>1), choices=['selected project'];
  await projects.run('projects',async()=>choices);
  await projects.run('projects',async()=>{throw {status:503};},{retain:true,retainOnError:true});
  assert.equal(projects.getSnapshot().status,'error');assert.equal(projects.getSnapshot().value,choices);
  await projects.run('projects',async()=>choices,{retain:true,retainOnError:true});
  assert.equal(projects.getSnapshot().status,'ready');assert.equal(projects.getSnapshot().value,choices);
});

for (const failure of [{status:401},{status:403},{accessExpired:true}]) {
  test(`project refresh permission failure ${JSON.stringify(failure)} clears the project choices`, async () => {
    const projects=createTaskRead<string[]>(()=>1);
    await projects.run('projects',async()=>['selected project']);
    await projects.run('projects',async()=>{throw failure;},{retain:true,retainOnError:true});
    assert.equal(projects.getSnapshot().status,'error');assert.equal(projects.getSnapshot().value,null);
  });
}

test('a failed pagination read retains the confirmed page and can retry the same cursor', async () => {
  const lane=createTaskRead<number[]>(()=>1);await lane.run('query',async()=>[1]);
  await lane.run('cursor',async()=>{throw new Error('failed');},{retain:true,retainOnError:true});
  assert.equal(lane.getSnapshot().status,'error');assert.deepEqual(lane.getSnapshot().value,[1]);
  await lane.run('cursor',async()=>[1,2],{retain:true,retainOnError:true});
  assert.equal(lane.getSnapshot().status,'ready');assert.deepEqual(lane.getSnapshot().value,[1,2]);
});

for (const failure of [{status:401},{status:403},{accessExpired:true}]) {
  test(`permission failure ${JSON.stringify(failure)} cannot retain private page data`, async () => {
    const lane=createTaskRead<number[]>(()=>1);await lane.run('query',async()=>[1]);
    await lane.run('cursor',async()=>{throw failure;},{retain:true,retainOnError:true});
    assert.equal(lane.getSnapshot().value,null);assert.equal(lane.getSnapshot().status,'error');
  });
}

test('cancel restores the previously confirmed snapshot and aborts the signal', async () => {
  const lane=createTaskRead<number>(()=>1), next=deferred<number>();let signal!:AbortSignal;
  await lane.run('old',async()=>1);const previous=lane.getSnapshot();
  const done=lane.run('new',async value=>{signal=value;return next.promise;},{retain:true});await tick();
  lane.cancel();assert.equal(signal.aborted,true);assert.equal(lane.getSnapshot(),previous);
  next.resolve(2);await done;assert.equal(lane.getSnapshot(),previous);
});

test('reset clears all results and a setup-cleanup-setup cycle is reusable', async () => {
  const lane=createTaskRead<number>(()=>1), first=deferred<number>();
  const done=lane.run('query',()=>first.promise);await tick();lane.reset();
  assert.equal(lane.getSnapshot().status,'idle');
  await lane.run('query',async()=>2);first.resolve(1);await done;
  assert.equal(lane.getSnapshot().value,2);
});

test('reset during pagination prevents late appends', async () => {
  const lane=createTaskRead<number[]>(()=>1), next=deferred<number[]>();
  await lane.run('query',async()=>[1]);
  const done=lane.run('cursor',()=>next.promise,{retain:true});await tick();lane.reset();
  next.resolve([1,2]);await done;assert.equal(lane.getSnapshot().value,null);
});

test('changing the login generation fences existing snapshots and new requests', async () => {
  let generation=1,calls=0;const lane=createTaskRead<number>(()=>generation);
  await lane.run('query',async()=>1);generation=2;
  const empty=lane.getSnapshot();assert.equal(empty.value,null);assert.equal(empty,lane.getSnapshot());
  await lane.run('query',async()=>{calls++;return 2;});assert.equal(calls,0);
});

test('a response from the old session cannot publish into a new one', async () => {
  let generation=1;const lane=createTaskRead<string>(()=>generation), result=deferred<string>();
  const done=lane.run('query',()=>result.promise);await tick();generation=2;
  result.resolve('private');await done;assert.equal(lane.getSnapshot().value,null);
  const newLane=createTaskRead<string>(()=>generation);await newLane.run('query',async()=>'new');
  assert.equal(newLane.getSnapshot().value,'new');
});

test('subscribe notifications stop after unsubscribe', async () => {
  const lane=createTaskRead<number>(()=>1);let notifications=0;
  const remove=lane.subscribe(()=>{notifications++;});await lane.run('a',async()=>1);
  assert.equal(notifications,2);remove();await lane.run('b',async()=>2);assert.equal(notifications,2);
});

test('the work section completes while project choices are still pending', async () => {
  const works=createTaskRead<number[]>(()=>1),projects=createTaskRead<string[]>(()=>1), slow=deferred<string[]>();
  const pending=projects.run('projects',()=>slow.promise);
  await works.run('works',async()=>[1]);
  assert.equal(works.getSnapshot().status,'ready');assert.equal(projects.getSnapshot().status,'loading');
  slow.resolve(['project']);await pending;
});

test('a project failure does not turn a successful work list into an error', async () => {
  const works=createTaskRead<number[]>(()=>1),projects=createTaskRead<string[]>(()=>1);
  await Promise.all([works.run('works',async()=>[1]),projects.run('projects',async()=>{throw new Error('failed');})]);
  assert.equal(works.getSnapshot().status,'ready');assert.equal(projects.getSnapshot().status,'error');
});

test('changing work queries neither refetches projects nor cancels the activity read', async () => {
  const works=createTaskRead<string>(()=>1),projects=createTaskRead<string>(()=>1),activity=createTaskRead<string>(()=>1);
  let projectCalls=0,signal!:AbortSignal;const reply=deferred<string>();
  await projects.run('projects',async()=>{projectCalls++;return 'project';});
  const pending=activity.run('project',async value=>{signal=value;return reply.promise;});await tick();
  for(const query of ['a','ab','abc'])await works.run(query,async()=>query);
  assert.equal(projectCalls,1);assert.equal(signal.aborted,false);reply.resolve('issues');await pending;
});

test('a cancelled lane cannot affect a newer same-key operation', async () => {
  const lane=createTaskRead<number>(()=>1),old=deferred<number>(),fresh=deferred<number>();
  const first=lane.run('q',()=>old.promise);await tick();lane.cancel();
  const second=lane.run('q',()=>fresh.promise);await tick();old.resolve(1);await first;
  assert.equal(lane.getSnapshot().status,'loading');fresh.resolve(2);await second;assert.equal(lane.getSnapshot().value,2);
});

test('appending removes duplicate ids across pages and within the new page', () => {
  const a={work_item_id:'a'},b={work_item_id:'b'},c={work_item_id:'c'};
  assert.deepEqual(appendTaskItems([a],[a,b,b,c]),[a,b,c]);
});

test('appending does not mutate either input and preserves order', () => {
  const first=Object.freeze([{work_item_id:'b'}]),next=Object.freeze([{work_item_id:'a'},{work_item_id:'c'}]);
  const result=appendTaskItems([...first],[...next]);
  assert.deepEqual(result.map(x=>x.work_item_id),['b','a','c']);assert.equal(first.length,1);assert.equal(next.length,2);
});
