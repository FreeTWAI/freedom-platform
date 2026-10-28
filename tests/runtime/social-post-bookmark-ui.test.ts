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

function optionsHarness(){
  const hooks:any[]=[],effects:(()=>void)[]=[],listeners=new Map<string,Set<()=>void>>();let index=0,observed=0,disconnected=0;
  const rect={top:474,bottom:518},viewport={offsetTop:0,height:720},header={getBoundingClientRect:()=>({bottom:106})};
  const eventTarget=(prefix:string)=>({addEventListener:(event:string,fn:()=>void)=>{const key=prefix+event;if(!listeners.has(key))listeners.set(key,new Set());listeners.get(key)!.add(fn);},removeEventListener:(event:string,fn:()=>void)=>listeners.get(prefix+event)?.delete(fn)});
  const window={...eventTarget('window:'),innerHeight:720,visualViewport:{...viewport,...eventTarget('visual:')}};
  const details={open:false,getBoundingClientRect:()=>rect,contains:()=>false,querySelector:()=>({focus(){}})};
  const effect=(fn:()=>unknown,deps:unknown[])=>{const i=index++;if(!hooks[i]||deps.some((v,n)=>v!==hooks[i].deps[n])){hooks[i]?.cleanup?.();hooks[i]={deps};effects.push(()=>{hooks[i].cleanup=fn();});}};
  const react={useRef:(value:unknown)=>{const i=index++;return hooks[i]??(hooks[i]={current:value});},useState:(value:unknown)=>{const i=index++;if(!(i in hooks))hooks[i]=value;return [hooks[i],(v:any)=>{hooks[i]=typeof v==='function'?v(hooks[i]):v;}];},useEffect:effect,useLayoutEffect:effect};
  const jsx=(type:string,props:unknown)=>({type,props}),module={exports:{} as any};
  runInNewContext(compiled,{module,exports:module.exports,window,document:{...eventTarget('document:'),querySelector:()=>header},ResizeObserver:class{observe(){observed++;}disconnect(){disconnected++;}},Node:class{},require:(name:string)=>{
    if(name==='react')return react;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};if(name==='../api')return {ApiError};if(name==='../language')return {useLanguage:()=>({language:'zh-Hant'})};throw Error(name);
  }});
  function render(){index=0;const tree=module.exports.SocialPostOptions({client:{},postId:'post-a',bookmarksEnabled:true,children:[]});tree.props.ref.current=details;while(effects.length)effects.shift()!();return tree;}
  function view(){render();return render();}
  function toggle(open:boolean){details.open=open;view().props.onToggle({target:details,currentTarget:details});return view();}
  return {view,toggle,rect,window,details,listeners,placement:module.exports.postOptionsPlacement,emit:(key:string)=>listeners.get(key)?.forEach(fn=>fn()),get observed(){return observed;},get disconnected(){return disconnected;}};
}
test('post options choose the visible side and cap the scrollport, including the failing 720px viewport',()=>{
  const h=optionsHarness();
  for(const [top,bottom,viewTop,viewBottom,above,height] of [[474,518,106,720,true,356],[150,194,106,720,false,420],[150,222,106,720,false,420],[200,244,65,420,false,164],[740,784,65,844,true,420],[30,74,65,100,false,14]]){
    const actual=h.placement(top,bottom,viewTop,viewBottom);assert.equal(actual.above,above);assert.equal(actual.maxHeight,height);
    const panelTop=above?top-height:bottom,panelBottom=above?top:bottom+height;
    assert.ok(panelTop>=viewTop);assert.ok(panelBottom<=viewBottom);
  }
});
test('open options reposition on viewport resize and ancestor scroll; close cleans all geometry subscriptions',()=>{
  const h=optionsHarness();h.view();assert.equal(h.observed,0);
  let panel=find(h.toggle(true),n=>n.props?.className==='social-post-menu-actions');assert.equal(panel.props.style.bottom,'100%');assert.equal(panel.props.style.maxHeight,356);assert.equal(h.observed,2);
  h.rect.top=150;h.rect.bottom=194;h.emit('window:scroll');panel=find(h.view(),n=>n.props?.className==='social-post-menu-actions');assert.equal(panel.props.style.top,'100%');assert.equal(panel.props.style.maxHeight,420);
  h.window.visualViewport.height=420;h.emit('visual:resize');panel=find(h.view(),n=>n.props?.className==='social-post-menu-actions');assert.equal(panel.props.style.maxHeight,214);
  h.rect.top=330;h.rect.bottom=374;h.emit('window:resize');panel=find(h.view(),n=>n.props?.className==='social-post-menu-actions');assert.equal(panel.props.style.bottom,'100%');assert.equal(panel.props.style.maxHeight,212);
  h.toggle(false);assert.equal(h.disconnected,1);for(const set of h.listeners.values())assert.equal(set.size,0);
});
test('scrolling the trigger fully behind the header or below viewport closes its menu',()=>{
  for(const rect of [{top:30,bottom:74},{top:730,bottom:774}]){
    const h=optionsHarness();h.toggle(true);Object.assign(h.rect,rect);h.emit('window:scroll');h.view();
    assert.equal(h.details.open,false);assert.equal(h.disconnected,1);for(const set of h.listeners.values())assert.equal(set.size,0);
  }
});
