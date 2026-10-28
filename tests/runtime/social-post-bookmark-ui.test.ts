import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {transformSync} from 'esbuild';
import {ApiError} from '../../apps/portal-web/src/api';

// Source-bound hook fixture, not a browser/layout or real-API acceptance claim.
const source=readFileSync(new URL('../../apps/portal-web/src/modules/SocialPostBookmark.tsx',import.meta.url),'utf8');
const compiled=transformSync(source,{loader:'tsx',format:'cjs',jsx:'automatic'}).code;
function find(tree:any,predicate:(node:any)=>boolean):any{
  if(!tree||typeof tree!=='object')return;
  if(predicate(tree))return tree;
  for(const child of [tree.props?.children].flat(Infinity)){const found=find(child,predicate);if(found)return found;}
}
function harness(){
  const hooks:any[]=[],effects:(()=>void)[]=[],requests:any[]=[];let index=0,focused=0;
  const client={sessionGeneration:1,get:(path:string,options:unknown)=>new Promise((resolve,reject)=>requests.push({method:'GET',path,options,resolve,reject})),post:(path:string,body:unknown,options:unknown)=>new Promise((resolve,reject)=>requests.push({method:'POST',path,body,options,resolve,reject}))};
  const props={client,postId:'post-a',menuOpen:true};
  const effect=(fn:()=>unknown,deps:unknown[])=>{const i=index++;if(!hooks[i]||deps.some((v,n)=>v!==hooks[i].deps[n])){hooks[i]?.cleanup?.();hooks[i]={deps};effects.push(()=>{hooks[i].cleanup=fn();});}};
  const react={useRef:(value:unknown)=>{const i=index++;return hooks[i]??(hooks[i]={current:value});},
    useState:(value:unknown)=>{const i=index++;if(!(i in hooks))hooks[i]=typeof value==='function'?value():value;return [hooks[i],(v:any)=>{hooks[i]=typeof v==='function'?v(hooks[i]):v;}];},
    useMemo:(fn:()=>unknown,deps:unknown[])=>{const i=index++;if(!hooks[i]||deps.some((v,n)=>v!==hooks[i].deps[n]))hooks[i]={deps,value:fn()};return hooks[i].value;},useEffect:effect,useLayoutEffect:effect};
  const jsx=(type:string,props:unknown)=>({type,props}),module={exports:{} as any};
  runInNewContext(compiled,{module,exports:module.exports,crypto:webcrypto,AbortController,require:(name:string)=>{
    if(name==='react')return react;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};if(name==='../api')return {ApiError};if(name==='../language')return {useLanguage:()=>({language:'zh-Hant'})};throw Error(name);
  }});
  const details={open:false,querySelector:()=>({focus(){focused++;}})};
  function render(){index=0;const tree=module.exports.SocialPostBookmark(props);tree.props.ref.current=details;while(effects.length)effects.shift()!();return tree;}
  function view(){render();return render();}
  function toggle(){find(view(),n=>n.type==='summary').props.onClick({preventDefault(){}});}
  function save(){find(view(),n=>n.type==='button').props.onClick();}
  return {props,client,requests,details,view,toggle,save,get focused(){return focused;}};
}
const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
async function loaded(h:ReturnType<typeof harness>){h.view();assert.equal(h.requests.length,0);h.toggle();h.requests[0].resolve({kind:'post',id:'post-a',selected:false,available:true});await settle();}

test('bookmark disclosure reads one post only; closing outer options aborts reads without writes',async()=>{
  const h=harness();h.view();assert.equal(h.requests.length,0);h.toggle();assert.equal(h.requests.length,1);
  h.props.menuOpen=false;h.view();assert.equal(h.details.open,false);assert.equal(h.requests[0].options.signal.aborted,true);
  h.requests[0].resolve({kind:'post',id:'post-a',selected:true,available:true});await settle();
  assert.equal(find(h.view(),n=>n.type==='button'),undefined);assert.equal(h.requests.filter(r=>r.method==='POST').length,0);
});
test('duplicate click cannot write twice; close/reopen retains unknown intent and retry identity',async()=>{
  const h=harness();await loaded(h);h.save();h.save();assert.equal(h.requests.length,2);
  const original=h.requests[1];h.props.menuOpen=false;h.view();original.reject(new ApiError({message:'lost',network:true}));await settle();
  h.props.menuOpen=true;h.view();h.toggle();const retry=find(h.view(),n=>n.type==='button');assert.equal(retry.props.children,'重試儲存私人書籤');h.save();
  assert.equal(h.requests.length,3);assert.equal(h.requests[2].options.idempotencyKey,original.options.idempotencyKey);
  assert.deepEqual(h.requests[2].body,original.body);assert.equal(h.requests[2].body.selected,true);
});
test('pending write stays disabled across close/reopen and a new session cannot reuse old result',async()=>{
  const h=harness();await loaded(h);h.save();h.props.menuOpen=false;h.view();h.props.menuOpen=true;h.view();h.toggle();
  assert.equal(find(h.view(),n=>n.type==='button').props.disabled,true);h.save();assert.equal(h.requests.length,2);
  h.client.sessionGeneration++;h.view();h.requests[1].resolve({kind:'post',id:'post-a',selected:true});await settle();
  assert.equal(h.details.open,false);assert.equal(find(h.view(),n=>n.type==='button'),undefined);
});
test('Escape closes only the expanded bookmark and returns its focus; next Escape can reach outer options',async()=>{
  const h=harness();await loaded(h);let stopped=0;
  const event={key:'Escape',preventDefault(){},stopPropagation(){stopped++;},currentTarget:h.details};
  h.view().props.onKeyDown(event);assert.equal(h.details.open,false);assert.equal(h.focused,1);assert.equal(stopped,1);
  h.view().props.onKeyDown(event);assert.equal(stopped,1);
});
