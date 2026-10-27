import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import type {Locator, Page} from '@playwright/test';
import {measureRouteReadiness,routePerformanceSample} from '../e2e/route-performance.js';

function fixture(){
  let time=20;const marks=new Map<string,number>(),measures=new Map<string,number>();
  const attachments:Record<string,unknown>[]=[];
  let click:(()=>void)|undefined;
  const performance={
    mark:(name:string,options?:{startTime:number})=>{marks.set(name,options?.startTime??time++);},
    clearMarks:(name:string)=>{marks.delete(name);},clearMeasures:(name:string)=>{measures.delete(name);},
    measure:(name:string,start:string,end:string)=>{
      if(!marks.has(start)||!marks.has(end))throw Error('missing mark');
      const duration=marks.get(end)!-marks.get(start)!;measures.set(name,duration);return {duration};
    },
    getEntriesByType:()=>[{startTime:0,requestStart:1,responseStart:5,responseEnd:8,name:'https://fixture.test/?token=SECRET'}],
    getEntriesByName:()=>[{startTime:10,name:'first-contentful-paint',payload:'SECRET'}],
  };
  const globals={performance,AbortController,requestAnimationFrame:(fn:()=>void)=>{time+=16;fn();}};
  const page={evaluate:async(fn:Function,arg?:unknown)=>runInNewContext(`(${fn.toString()})(arg)`,{...globals,arg})} as unknown as Page;
  const element={addEventListener:(_event:string,fn:()=>void,options:{signal:AbortSignal})=>{
    click=fn;options.signal.addEventListener('abort',()=>{click=undefined;});
  }};
  const target={evaluateHandle:async(fn:Function)=>{
    const value=runInNewContext(`(${fn.toString()})(element)`,{...globals,element});
    return {evaluate:async(callback:Function)=>callback(value),dispose:async()=>{}};
  }} as unknown as Locator;
  const info={attach:async(_name:string,attachment:{body?:string|Buffer})=>{attachments.push(JSON.parse(String(attachment.body)));}};
  return {page,target,info,attachments,marks,measures,click:()=>click?.(),hasClick:()=>!!click};
}

test('only bounded scalar fields survive serialization, including hostile extras and accessors',()=>{
  let invoked=false;
  const input={heading_ms:10,ready_frame_ms:20,cookie:'SECRET',url:'https://secret.test',payload:{secret:'SECRET'},toJSON(){throw Error('must not serialize input');}};
  Object.defineProperty(input,'fcp_ms',{get(){invoked=true;return 'SECRET';}});
  const sample=routePerformanceSample('cold_anonymous','ready',input);
  assert.equal(invoked,false);assert.equal(sample.fcp_ms,null);
  assert.deepEqual(Object.keys(sample),['format','scope','scenario','outcome','test_result','attempted','ready','failed','heading_ms','ready_frame_ms','request_start_ms','response_start_ms','response_end_ms','fcp_ms']);
  assert.doesNotMatch(JSON.stringify(sample),/SECRET|https:|cookie|payload/);
  assert.ok(JSON.stringify(sample).length<1024);
});

test('invalid timing primitives cannot become successful readiness samples',()=>{
  for(const value of [NaN,Infinity,-1,'12',null,{},undefined]){
    assert.throws(()=>routePerformanceSample('cold_anonymous','ready',{heading_ms:1,ready_frame_ms:value}),/missing performance/);
  }
  assert.throws(()=>routePerformanceSample('cold_anonymous','ready',{heading_ms:5,ready_frame_ms:4}));
  assert.throws(()=>routePerformanceSample('https://SECRET' as never,'ready',{}),/invalid performance/);
  assert.throws(()=>routePerformanceSample('cold_anonymous','SECRET' as never,{}),/invalid performance/);
});

test('cold marks include navigation startup and discard entry URLs and payloads',async()=>{
  const f=fixture();const sample=await measureRouteReadiness({...f,scenario:'cold_anonymous',action:async()=>{},heading:async()=>{},ready:async()=>{}});
  assert.equal(sample.outcome,'ready');assert.equal(sample.request_start_ms,1);assert.equal(sample.response_end_ms,8);
  assert.ok(sample.ready_frame_ms!>sample.heading_ms!);assert.equal(f.attachments.length,1);
  assert.doesNotMatch(JSON.stringify(f.attachments),/SECRET|https:|payload/);
  assert.equal(f.marks.size,0);assert.equal(f.measures.size,0);
});

test('warm marks start at the actual target click and clean observers and entries',async()=>{
  const f=fixture();const sample=await measureRouteReadiness({...f,scenario:'warm_home_social',clickTarget:f.target,action:async()=>f.click(),heading:async()=>{},ready:async()=>{}});
  assert.equal(sample.outcome,'ready');assert.equal(sample.request_start_ms,null);assert.equal(sample.fcp_ms,null);
  assert.equal(f.hasClick(),false);assert.equal(f.marks.size,0);assert.equal(f.measures.size,0);
});

for(const phase of ['action','heading','ready'] as const)test(`failure at ${phase} is counted and the exact original error is rethrown`,async()=>{
  const f=fixture(),original=new Error('SECRET credentials https://private.test body');
  const callbacks={action:async()=>f.click(),heading:async()=>{},ready:async()=>{}};
  callbacks[phase]=async()=>{throw original;};
  await assert.rejects(measureRouteReadiness({...f,scenario:'warm_home_social',clickTarget:f.target,...callbacks}),error=>error===original);
  assert.equal(f.attachments[0].failed,1);assert.equal(f.attachments[0].ready,0);assert.equal(f.attachments[0].ready_frame_ms,null);
  assert.doesNotMatch(JSON.stringify(f.attachments),/SECRET|https:|credentials/);assert.equal(f.hasClick(),false);
});

test('timeouts count as failure, never a zero-duration success',async()=>{
  const f=fixture(),original=new Error('SECRET');original.name='TimeoutError';
  await assert.rejects(measureRouteReadiness({...f,scenario:'cold_anonymous',action:async()=>{throw original;},heading:async()=>{},ready:async()=>{}}),error=>error===original);
  assert.equal(f.attachments[0].outcome,'timeout');assert.equal(f.attachments[0].failed,1);
});

test('missing click marks fail rather than measuring from stale state',async()=>{
  const f=fixture();
  await assert.rejects(measureRouteReadiness({...f,scenario:'warm_home_social',clickTarget:f.target,action:async()=>{},heading:async()=>{},ready:async()=>{}}),/missing mark/);
  assert.equal(f.attachments[0].failed,1);assert.equal(f.marks.size,0);assert.equal(f.hasClick(),false);
});

test('closed-page cleanup and attachment failures do not hide an original readiness error',async()=>{
  const f=fixture(),original=new Error('original');
  const page={evaluate:async()=>{throw Error('page closed');}} as unknown as Page;
  await assert.rejects(measureRouteReadiness({...f,page,scenario:'cold_anonymous',info:{attach:async()=>{throw Error('attachment failed');}},
    action:async()=>{throw original;},heading:async()=>{},ready:async()=>{}}),error=>error===original);
});

test('attachment failure cannot turn a successful action into a passing test',async()=>{
  const f=fixture();
  await assert.rejects(measureRouteReadiness({...f,scenario:'cold_anonymous',info:{attach:async()=>{throw Error('attachment failed');}},
    action:async()=>{},heading:async()=>{},ready:async()=>{}}),/attachment failed/);
});

test('hung cleanup is bounded and preserves the original failure',async()=>{
  const f=fixture(),original=new Error('original');
  const page={evaluate:async()=>new Promise(()=>{})} as unknown as Page;
  await assert.rejects(measureRouteReadiness({...f,page,scenario:'cold_anonymous',
    action:async()=>{throw original;},heading:async()=>{},ready:async()=>{}}),error=>error===original);
  assert.equal(f.attachments[0].failed,1);
});

test('hung attachment is bounded and cannot produce a passing test',async()=>{
  const f=fixture();
  await assert.rejects(measureRouteReadiness({...f,scenario:'cold_anonymous',info:{attach:async()=>new Promise(()=>{})},
    action:async()=>{},heading:async()=>{},ready:async()=>{}}),/performance diagnostic deadline/);
});

test('ready evidence explicitly does not assert the test result if delivery later fails',async()=>{
  const f=fixture();
  await assert.rejects(measureRouteReadiness({...f,scenario:'cold_anonymous',info:{attach:async(name,attachment)=>{
    await f.info.attach(name,attachment??{});throw Error('late delivery failure');
  }},action:async()=>{},heading:async()=>{},ready:async()=>{}}),/late delivery failure/);
  assert.equal(f.attachments[0].outcome,'ready');assert.equal(f.attachments[0].test_result,'not_reported');
  assert.equal('passed' in f.attachments[0],false);
});

test('repeat measurements keep no previous marks or click listener',async()=>{
  const f=fixture();
  for(const scenario of ['warm_home_social','warm_home_social_repeat'] as const){
    await measureRouteReadiness({...f,scenario,clickTarget:f.target,action:async()=>f.click(),heading:async()=>{},ready:async()=>{}});
    assert.equal(f.hasClick(),false);assert.equal(f.marks.size,0);assert.equal(f.measures.size,0);
  }
  assert.equal(f.attachments.length,2);assert.equal(f.attachments[0].heading_ms,f.attachments[1].heading_ms);
});
