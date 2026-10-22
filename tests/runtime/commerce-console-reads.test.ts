import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createConsoleReadRequests, type ConsoleReadContext} from '../../modules/agent-commerce/hosted-ui/read-requests.js';

function deferred<T>() {
  let resolve!: (value:T)=>void, reject!: (cause:unknown)=>void;
  const promise = new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
async function flush(){for(let i=0;i<8;i++)await Promise.resolve();}
function reader(){
  const response=deferred<boolean>();let context:ConsoleReadContext|undefined,calls=0;
  return {response,read:async(value:ConsoleReadContext)=>{calls++;context=value;return response.promise;},
    get context(){assert.ok(context);return context;},get calls(){return calls;}};
}

test('identical in-flight reads share one promise and one callback',async()=>{
  const queue=createConsoleReadRequests(),r=reader();
  const a=queue.run('products','/products',r.read),b=queue.run('products','/products',r.read);
  assert.strictEqual(a,b);await flush();assert.equal(r.calls,1);r.response.resolve(true);assert.equal(await a,true);
});
test('dispatch has no timer or extra typing delay',async()=>{
  const queue=createConsoleReadRequests(),r=reader();const result=queue.run('products','/products',r.read);
  assert.equal(r.calls,0);await Promise.resolve();assert.equal(r.calls,1);r.response.resolve(true);await result;
});
test('a completed read is never used as a cache',async()=>{
  const queue=createConsoleReadRequests();let calls=0;const read=async()=>{calls++;return true;};
  const a=queue.run('products','/products',read);await a;const b=queue.run('products','/products',read);
  assert.notStrictEqual(a,b);await b;assert.equal(calls,2);
});
test('separate regions finish independently',async()=>{
  const queue=createConsoleReadRequests(),slow=reader();
  const pending=queue.run('products','/products',slow.read);
  assert.equal(await queue.run('overview','/overview',async()=>true),true);
  assert.equal(slow.context.signal.aborted,false);slow.response.resolve(true);assert.equal(await pending,true);
});
test('replacing a query before its dispatch sends only the new read',async()=>{
  const queue=createConsoleReadRequests(),old=reader(),next=reader();
  const a=queue.run('orders','/orders?state=open',old.read),b=queue.run('orders','/orders?state=closed',next.read);
  assert.equal(await a,false);assert.equal(old.calls,0);assert.equal(next.calls,1);next.response.resolve(true);await b;
});
test('changing a resource under the same slot cancels the old transport',async()=>{
  const queue=createConsoleReadRequests(),old=reader(),next=reader();
  const a=queue.run('reservations','/reservations?cursor=first',old.read);await flush();
  const b=queue.run('reservations','/reservations?cursor=next',next.read);
  assert.equal(old.context.signal.aborted,true);assert.equal(old.context.isCurrent(),false);
  assert.equal(await a,false);next.response.resolve(true);assert.equal(await b,true);
});
test('confirmed-write refresh cannot coalesce with a pre-write read',async()=>{
  const queue=createConsoleReadRequests(),old=deferred<boolean>();let before:ConsoleReadContext|undefined,value='initial';
  const a=queue.run('orders','/orders',async c=>{before=c;await old.promise;if(c.isCurrent())value='pre-write';return true;});await flush();
  const b=queue.run('orders','/orders',async c=>{if(c.isCurrent())value='confirmed-write';return true;},{replace:true});
  assert.equal(await a,false);assert.equal(await b,true);assert.equal(before!.signal.aborted,true);
  old.resolve(true);await flush();assert.equal(value,'confirmed-write');
});
test('normal refresh during post-write read joins the newer read, not the old one',async()=>{
  const queue=createConsoleReadRequests(),old=reader(),next=reader();
  const a=queue.run('products','/products',old.read);await flush();
  const b=queue.run('products','/products',next.read,{replace:true});
  const c=queue.run('products','/products',async()=>{throw Error('must not dispatch');});
  assert.strictEqual(b,c);assert.equal(await a,false);next.response.resolve(true);assert.equal(await c,true);
});
test('two confirmed invalidations keep only the newest read authoritative',async()=>{
  const queue=createConsoleReadRequests(),first=reader(),second=reader();
  const a=queue.run('product','/product',first.read,{replace:true});await flush();
  const b=queue.run('product','/product',second.read,{replace:true});await flush();
  assert.equal(first.context.isCurrent(),false);first.response.resolve(true);assert.equal(await a,false);
  assert.equal(second.context.isCurrent(),true);second.response.resolve(true);assert.equal(await b,true);
});
test('late success cannot remove the newer in-flight slot',async()=>{
  const queue=createConsoleReadRequests(),old=reader(),next=reader();
  const a=queue.run('orders','/orders',old.read);await flush();
  const b=queue.run('orders','/orders',next.read,{replace:true});await flush();old.response.resolve(true);await flush();
  assert.equal(await a,false);assert.strictEqual(queue.run('orders','/orders',next.read),b);
  next.response.resolve(true);await b;
});
test('late rejection cannot remove or fail the newer read',async()=>{
  const queue=createConsoleReadRequests(),old=reader(),next=reader();
  const a=queue.run('orders','/orders',old.read);await flush();
  const b=queue.run('orders','/orders',next.read,{replace:true});await flush();old.response.reject(Error('late'));await flush();
  assert.equal(await a,false);assert.strictEqual(queue.run('orders','/orders',next.read),b);
  next.response.resolve(true);assert.equal(await b,true);
});
test('cancel before dispatch performs no network callback',async()=>{
  const queue=createConsoleReadRequests(),r=reader();const result=queue.run('contact','/contact',r.read);queue.cancel('contact');
  assert.equal(await result,false);assert.equal(r.calls,0);
});
test('cancel settles even when the transport never responds to abort',async()=>{
  const queue=createConsoleReadRequests(),r=reader();const result=queue.run('detail','/detail',r.read);await flush();queue.cancel('detail');
  assert.equal(await result,false);assert.equal(r.context.signal.aborted,true);
});
test('unregistering one page does not abort another page or store metadata',async()=>{
  const queue=createConsoleReadRequests(),a=reader(),b=reader();
  const first=queue.run('detail','/detail',a.read),second=queue.run('store','/',b.read);await flush();queue.cancel('detail');
  assert.equal(await first,false);assert.equal(b.context.signal.aborted,false);b.response.resolve(true);assert.equal(await second,true);
});
test('unmount cancels all regions without waiting for response bodies',async()=>{
  const queue=createConsoleReadRequests(),a=reader(),b=reader();
  const reads=[queue.run('a','/a',a.read),queue.run('b','/b',b.read)];await flush();queue.cancelAll();
  assert.deepEqual(await Promise.all(reads),[false,false]);assert.ok(a.context.signal.aborted&&b.context.signal.aborted);
});
test('cleanup/setup can use the same queue without retaining a cancelled read',async()=>{
  const queue=createConsoleReadRequests(),a=reader(),b=reader();const first=queue.run('store','/',a.read);await flush();queue.cancelAll();
  const second=queue.run('store','/',b.read);await flush();assert.equal(await first,false);assert.equal(b.calls,1);
  a.response.resolve(true);b.response.resolve(true);assert.equal(await second,true);
});
test('different console instances never share private reads',async()=>{
  const a=createConsoleReadRequests(),b=createConsoleReadRequests(),r=reader(),s=reader();
  const first=a.run('store','/',r.read),second=b.run('store','/',s.read);await flush();a.cancelAll();
  assert.equal(await first,false);assert.equal(s.context.signal.aborted,false);s.response.resolve(true);assert.equal(await second,true);
});
test('a current rejected read rejects and a later retry really dispatches',async()=>{
  const queue=createConsoleReadRequests(),error=new Error('schema mismatch');
  await assert.rejects(queue.run('store','/',async()=>{throw error;}),cause=>cause===error);
  assert.equal(await queue.run('store','/',async()=>true),true);
});
test('a failed read returning false is not treated as cached success',async()=>{
  const queue=createConsoleReadRequests();assert.equal(await queue.run('store','/',async()=>false),false);
  assert.equal(await queue.run('store','/',async()=>true),true);
});
test('isCurrent becomes false after completion and cannot publish a delayed callback',async()=>{
  const queue=createConsoleReadRequests(),r=reader();const result=queue.run('store','/',r.read);await flush();
  assert.equal(r.context.isCurrent(),true);r.response.resolve(true);await result;assert.equal(r.context.isCurrent(),false);
});
test('abort listeners observe the old slot already invalidated',async()=>{
  const queue=createConsoleReadRequests(),r=reader();let currentOnAbort:boolean|undefined;
  const result=queue.run('detail','/detail',r.read);await flush();
  r.context.signal.addEventListener('abort',()=>{currentOnAbort=r.context.isCurrent();});queue.cancel('detail');
  await result;assert.equal(currentOnAbort,false);
});
test('cancel is idempotent and missing slots are harmless',async()=>{
  const queue=createConsoleReadRequests();queue.cancel('missing');queue.cancelAll();
  assert.equal(await queue.run('store','/',async()=>true),true);queue.cancel('store');queue.cancelAll();
});
test('caller-owned session fence still rejects an otherwise-current late response',async()=>{
  const queue=createConsoleReadRequests(),gate=deferred<boolean>();let session=1,published=false;const original=session;
  const result=queue.run('store','/',async context=>{await gate.promise;if(!context.isCurrent()||session!==original)return false;published=true;return true;});
  await flush();session++;gate.resolve(true);assert.equal(await result,false);assert.equal(published,false);
});
