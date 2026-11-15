import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';

const require=createRequire(resolve(process.cwd(),'package.json'));
const {transformSync}=require('esbuild');
const compiled=transformSync(readFileSync('apps/portal-web/src/modules/EventOutcomeBacklinks.tsx','utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'}).code;
const api=readFileSync('apps/portal-web/src/api.ts','utf8');
const apiClass=api.slice(api.indexOf('export class ApiError'),api.indexOf('export type InstanceSelectionCandidate')).replace('export ','');
const ApiError=runInNewContext(transformSync(apiClass+';globalThis.ApiError=ApiError',{loader:'ts'}).code+';ApiError',{Error});

type Element={type:any;props:any};
function text(value:any):string{return Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):typeof value==='string'||typeof value==='number'?String(value):'';}
function findAll(value:any,predicate:(node:Element)=>boolean,out:Element[]=[]):Element[]{
  if(!value||typeof value!=='object')return out;
  if(Array.isArray(value)){for(const child of value)findAll(child,predicate,out);return out;}
  if(predicate(value))out.push(value);
  return findAll(value.props?.children,predicate,out);
}
const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));

function moduleHarness(){
  const jsx=(type:any,props:any)=>({type,props});
  const scopes=new Map<string,{hooks:any[];index:number;effects:(()=>void)[]}>();
  let activeKey='default';
  const scope=()=>scopes.get(activeKey)??(()=>{const s={hooks:[],index:0,effects:[]};scopes.set(activeKey,s);return s;})();
  const depsEqual=(a:any[],b:any[])=>a.length===b.length&&a.every((value,index)=>value===b[index]);
  const react={
    useState:(value:any)=>{const s=scope(),at=s.index++;if(!(at in s.hooks))s.hooks[at]=typeof value==='function'?value():value;return [s.hooks[at],(next:any)=>s.hooks[at]=typeof next==='function'?next(s.hooks[at]):next];},
    useEffect:(fn:()=>any,deps:any[])=>{const s=scope(),at=s.index++;if(!s.hooks[at]||!depsEqual(s.hooks[at].deps,deps)){s.hooks[at]?.cleanup?.();s.hooks[at]={deps};s.effects.push(()=>s.hooks[at].cleanup=fn());}},
  };
  const module={exports:{} as any};
  runInNewContext(compiled,{module,exports:module.exports,WeakMap,Promise,encodeURIComponent,Error,
    require:(name:string)=>{if(name==='react')return react;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};if(name==='../api')return {ApiError};throw Error(name);},
  });
  function render(props:any,instanceKey='default'){
    activeKey=instanceKey;
    const s=scope();s.index=0;
    const tree=module.exports.EventOutcomeBacklinks(props);
    while(s.effects.length)s.effects.shift()!();
    return tree;
  }
  function unmount(instanceKey='default'){
    const s=scopes.get(instanceKey);if(!s)return;
    for(const hook of s.hooks)hook?.cleanup?.();
    scopes.delete(instanceKey);
  }
  return {render,unmount};
}

test('skips backlinks request when /site reports event_outcomes_enabled is false',async()=>{
  const {render}=moduleHarness();
  const requests:{path:string;options:any}[]=[];
  const client={get:(path:string,options:any)=>{requests.push({path,options});if(path==='/site')return Promise.resolve({event_outcomes_enabled:false});return Promise.reject(new ApiError({message:'Not found',status:404,code:'not_found'}));}};
  assert.equal(render({client,kind:'work',sourceId:'work-1'}),null);
  await settle();await settle();
  assert.equal(render({client,kind:'work',sourceId:'work-1'}),null);
  assert.deepEqual(requests.map(r=>r.path),['/site']);
  assert.equal(render({client,kind:'skill_book',sourceId:'video-autopilot',publicRead:true},'second'),null);
  await settle();await settle();
  assert.deepEqual(requests.map(r=>r.path),['/site']);
});

test('fetches backlinks once /site confirms event_outcomes_enabled is true and handles empty and populated responses',async()=>{
  const {render}=moduleHarness();
  const requests:string[]=[];
  const emptyClient={get:(path:string)=>{requests.push(path);if(path==='/site')return Promise.resolve({event_outcomes_enabled:true});return Promise.resolve({items:[]});}};
  assert.equal(render({client:emptyClient,kind:'work',sourceId:'work-empty'}),null);
  await settle();await settle();
  assert.equal(render({client:emptyClient,kind:'work',sourceId:'work-empty'}),null);
  assert.deepEqual(requests,['/site','/event-outcome-backlinks/work/work-empty']);

  const linkedClient={get:(path:string)=>{requests.push(path);if(path==='/site')return Promise.resolve({event_outcomes_enabled:true});return Promise.resolve({items:[{outcome_id:'out-1',event_id:'evt-1',event_title:'黑客松',title:'分享成果',path:'/highlights/evt-1'}]});}};
  render({client:linkedClient,kind:'skill_book',sourceId:'video-autopilot',publicRead:true},'linked');
  await settle();await settle();
  const tree=render({client:linkedClient,kind:'skill_book',sourceId:'video-autopilot',publicRead:true},'linked');
  assert.ok(tree);
  assert.equal(findAll(tree,n=>n.type==='a')[0]?.props.href,'/highlights/evt-1');
  assert.match(text(tree),/黑客松 · 分享成果/);
  assert.deepEqual(requests.slice(2),['/site','/public/event-outcome-backlinks/skill_book/video-autopilot']);
});

test('retries /site after transient error and respects explicit enabled prop without fetching /site',async()=>{
  const {render}=moduleHarness();
  let failSite=true;
  const requests:string[]=[];
  const client={get:(path:string)=>{requests.push(path);if(path==='/site')return failSite?Promise.reject(new Error('network')):Promise.resolve({event_outcomes_enabled:true});return Promise.resolve({items:[]});}};
  render({client,kind:'work',sourceId:'work-1'},'first');
  await settle();await settle();
  assert.equal(render({client,kind:'work',sourceId:'work-1'},'first'),null);
  assert.deepEqual(requests,['/site']);

  failSite=false;
  render({client,kind:'work',sourceId:'work-2'},'second');
  await settle();await settle();
  assert.deepEqual(requests,['/site','/site','/event-outcome-backlinks/work/work-2']);

  const directCalls:string[]=[];
  const directClient={get:(path:string)=>{directCalls.push(path);return Promise.resolve({items:[]});}};
  render({client:directClient,kind:'squad_outcome',sourceId:'sq-1',enabled:false},'off');
  await settle();
  assert.deepEqual(directCalls,[]);
  render({client:directClient,kind:'squad_outcome',sourceId:'sq-1',enabled:true},'on');
  await settle();
  assert.deepEqual(directCalls,['/event-outcome-backlinks/squad_outcome/sq-1']);
});

test('shows retry button on 500 when enabled and suppresses 404 alert without leaving an error state',async()=>{
  const {render}=moduleHarness();
  let failBacklinks=true;
  const client={get:(path:string)=>{if(path==='/site')return Promise.resolve({event_outcomes_enabled:true});return failBacklinks?Promise.reject(new ApiError({message:'Server error',status:500,code:'server_error'})):Promise.resolve({items:[{outcome_id:'out-2',event_id:'evt-2',event_title:'工作坊',title:'共創筆記',path:'#highlights/evt-2'}]});}};
  render({client,kind:'work',sourceId:'work-err'});
  await settle();await settle();
  const errored=render({client,kind:'work',sourceId:'work-err'});
  const retry=findAll(errored,n=>n.type==='button'&&text(n)==='重新載入活動來源')[0];
  assert.ok(retry);
  failBacklinks=false;
  retry.props.onClick();
  render({client,kind:'work',sourceId:'work-err'});
  await settle();await settle();
  const recovered=render({client,kind:'work',sourceId:'work-err'});
  assert.equal(findAll(recovered,n=>n.type==='a')[0]?.props.href,'#highlights/evt-2');

  const notFoundClient={get:(path:string)=>{if(path==='/site')return Promise.resolve({event_outcomes_enabled:true});return Promise.reject(new ApiError({message:'Not found',status:404,code:'not_found'}));}};
  render({client:notFoundClient,kind:'work',sourceId:'work-404'},'nf');
  await settle();await settle();
  assert.equal(render({client:notFoundClient,kind:'work',sourceId:'work-404'},'nf'),null);
});
