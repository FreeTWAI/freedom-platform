import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';

// Execute the actual Host and its effect/capture handlers with synthetic hooks,
// DOM and frame delivery. Counts are not browser batching, layout or latency.
async function fixture(){
  const bundle=await build({entryPoints:['apps/portal-web/src/PlatformHelperHost.tsx'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',loader:{'.css':'empty'},jsx:'automatic'});
  let scans=0,sets=0,disconnected=0,nextFrame=0,refIndex=0,stateIndex=0;
  let mutation:(records?:unknown[])=>void=()=>{};
  const effects:Array<()=>void|(()=>void)>=[],effectDependencies:unknown[][]=[],refs:any[]=[],states:any[]=[];
  const frames=new Map<number,()=>void>(),cancelled:number[]=[],listeners=new Map<string,()=>void>();
  const nodes:any[]=[];
  const view={requestAnimationFrame:(fn:()=>void)=>{frames.set(++nextFrame,fn);return nextFrame;},cancelAnimationFrame:(id:number)=>{cancelled.push(id);frames.delete(id);},
    getComputedStyle:(node:any)=>node.style,addEventListener:(name:string,fn:()=>void)=>listeners.set(name,fn),removeEventListener:(name:string)=>listeners.delete(name),
    MutationObserver:class{constructor(fn:typeof mutation){mutation=fn;}observe(_target:unknown,options:any){assert.equal(options.subtree,true);assert.equal(options.childList,true);assert.ok(options.attributeFilter.includes('style'));}disconnect(){disconnected++;}}};
  const doc={body:{},defaultView:view,querySelectorAll:(selector:string)=>{scans++;return nodes.filter(node=>selector.split(',').includes(node.selector));},addEventListener:(name:string,fn:()=>void)=>listeners.set(name,fn),removeEventListener:(name:string)=>listeners.delete(name)};
  const launcher:any={expanded:'false',contains:(target:any)=>target===launcher||target===icon};
  const icon={};const other={},dialogControl={};
  const root:any={ownerDocument:doc,contains:(target:any)=>[launcher,icon,dialogControl].includes(target),querySelector:(selector:string)=>{
    // Fail closed on unsupported selectors; do not pretend to implement CSS syntax.
    assert.equal(selector,':scope > .platform-helper > button[aria-haspopup="dialog"][aria-expanded="false"]','unexpected launcher selector');
    return launcher.expanded==='false'?launcher:null;
  }};
  const hooks={useRef:(value:unknown)=>refs[refIndex++]??(refs[refIndex-1]={current:value}),useState:(value:unknown)=>{const i=stateIndex++;if(!(i in states))states[i]=value;return[states[i],(next:unknown)=>{sets++;states[i]=typeof next==='function'?(next as Function)(states[i]):next;}];},useLayoutEffect:(fn:()=>void|(()=>void),dependencies:unknown[])=>{effects.push(fn);effectDependencies.push(dependencies);}};
  const module={exports:{} as any},require=createRequire(import.meta.url);
  new Function('module','exports','require',bundle.outputFiles[0].text)(module,module.exports,(id:string)=>id==='react'?hooks:require(id));
  let props={pageId:'home',routeIdentity:'#home',sessionGeneration:1,mobileOpen:false,messagesOpen:false,pending:false,accessExpired:false,availablePageIds:['home','skills'],guildLaunchpadEnabled:true,onNavigate:()=>{}};
  const render=(patch={})=>{props={...props,...patch};refIndex=0;stateIndex=0;effects.length=0;effectDependencies.length=0;const element=module.exports.PlatformHelperHost(props);refs[0].current=root;return element;};
  let element=render();const capture=element.props.onClickCapture;const setup=()=>effects[1]() as ()=>void;let cleanup=setup();
  const flush=()=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn());};
  const node=(extra={}):any=>({selector:'dialog[open]',ownerDocument:doc,closest:()=>null,getClientRects:()=>[{}],style:{display:'block',visibility:'visible'},...extra});
  const click=(target:any=launcher,handler=capture)=>{let prevented=0,stopped=0;element=render();handler?.({currentTarget:root,target,preventDefault(){prevented++;},stopPropagation(){stopped++;}});return{prevented,stopped};};
  return{nodes,node,frames,cancelled,listeners,launcher,icon,other,dialogControl,root,capture,click,flush,render,
    mutate:()=>mutation([{type:'attributes',attributeName:'style',target:other}]),
    replay:()=>{cleanup();element=render();cleanup=setup();},
    cleanup:()=>cleanup(),get scopeDependencies(){return effectDependencies[1];},get counts(){return{scans,sets,disconnected};},get blocked(){return states[0];}};
}

test('100 mutation deliveries within one frame add one scan, not 100; later frames still inspect',async()=>{
  const f=await fixture();assert.equal(f.counts.scans,1,'initial inspection stays synchronous');
  for(let i=0;i<100;i++)f.mutate();
  assert.equal(f.counts.scans,1);assert.equal(f.frames.size,1);
  f.flush();assert.equal(f.counts.scans,2);assert.equal(f.frames.size,0);
  for(let i=0;i<3;i++){f.mutate();f.flush();}assert.equal(f.counts.scans,5,'not a claim that changes in separate frames disappear');f.cleanup();
});

test('all mutation deliveries retain blocker visibility, ancestor and removal semantics',async()=>{
  const f=await fixture();const modal=f.node();f.nodes.push(modal);f.mutate();f.flush();assert.equal(f.blocked,true);
  const blockedChild=f.render().props.children;assert.equal(blockedChild.type(blockedChild.props),null,'actual helper unmounts its session while blocked');
  modal.closest=()=>({});f.mutate();f.flush();assert.equal(f.blocked,false,'hidden ancestor');
  modal.closest=()=>null;modal.style.visibility='hidden';f.mutate();f.flush();assert.equal(f.blocked,false);
  modal.style.visibility='visible';f.mutate();f.flush();assert.equal(f.blocked,true);
  modal.style.display='none';f.mutate();f.flush();assert.equal(f.blocked,false);
  modal.style.display='block';f.mutate();f.flush();assert.equal(f.blocked,true);
  f.nodes.length=0;f.mutate();f.flush();assert.equal(f.blocked,false,'removal or loss of selector membership');
  const releasedChild=f.render().props.children;assert.ok(releasedChild.type(releasedChild.props),'release permits a new session, not a queued open');f.cleanup();
});

test('focus, toggle and resize inspect immediately and consume a queued mutation scan',async()=>{
  for(const event of ['focusin','toggle','resize']){
    const f=await fixture();f.nodes.push(f.node());f.mutate();const before=f.counts.scans;
    f.listeners.get(event)!();assert.equal(f.blocked,true);assert.equal(f.counts.scans,before+1);assert.equal(f.frames.size,0);f.flush();assert.equal(f.counts.scans,before+1);f.cleanup();
  }
});

test('cleanup cancels pending work and rejects captured stale callbacks and observer delivery',async()=>{
  const f=await fixture();f.mutate();const stale=[...f.frames.values()][0];assert.ok(stale);
  f.cleanup();assert.equal(f.frames.size,0);assert.equal(f.counts.disconnected,1);assert.equal(f.cancelled.length,1);assert.equal(f.listeners.size,0);
  const before=f.counts;stale();f.mutate();assert.deepEqual(f.counts,before);assert.equal(f.frames.size,0);
});

test('replayed effect and route/session replacement do not let old frames write into the next scope',async()=>{
  const f=await fixture();f.mutate();const stale=[...f.frames.values()][0];assert.ok(stale);
  const prior=f.scopeDependencies;f.render({routeIdentity:'#skills',sessionGeneration:2});assert.notDeepEqual(f.scopeDependencies,prior,'real effect declares the route/session dependency');f.replay();const before=f.counts;stale();assert.deepEqual(f.counts,before);
  f.nodes.push(f.node());f.mutate();f.flush();assert.equal(f.blocked,true);f.cleanup();
});

test('closed toolbar admission checks live blockers before deferred inspection, for all click sources',async()=>{
  // A React click capture handles pointer, keyboard-generated and .click() events
  // identically. This invokes that handler, not a native input/browser simulation.
  for(const source of ['pointer','keyboard Enter','keyboard Space','programmatic'])for(const selector of ['.settings-menu-list','.notification-bell-popover','.floating-message-panel','dialog[open]','[aria-modal="true"]','[role="dialog"]']){
    const f=await fixture();f.nodes.push(f.node({selector}));f.mutate();
    assert.deepEqual(f.click(source==='pointer'?f.icon:f.launcher),{prevented:1,stopped:1},`${source}: ${selector}`);
    assert.equal(f.blocked,true);f.cleanup();
  }
});

test('capture leaves allowed launcher, foreign targets and open dialog controls alone',async()=>{
  const f=await fixture();assert.deepEqual(f.click(),{prevented:0,stopped:0});
  f.nodes.push(f.node());assert.deepEqual(f.click(f.other),{prevented:0,stopped:0});assert.deepEqual(f.click(f.dialogControl),{prevented:0,stopped:0});
  f.launcher.expanded='true';assert.deepEqual(f.click(),{prevented:0,stopped:0});f.cleanup();
});

test('capture consults current shell state without waiting for an old render',async()=>{
  for(const state of [{mobileOpen:true},{messagesOpen:true},{pending:true},{accessExpired:true},{sessionGeneration:-1}]){
    const f=await fixture();const retained=f.capture;assert.equal(typeof retained,'function');f.render(state);assert.deepEqual(f.click(f.launcher,retained),{prevented:1,stopped:1});assert.equal(f.blocked,false,'shell blocking must not latch a nonexistent foreign surface');f.cleanup();
  }
});

test('launcher query double rejects wrong or invalid selectors instead of silently returning a button',async()=>{
  const f=await fixture();
  const selector=':scope > .platform-helper > button[aria-haspopup="dialog"][aria-expanded="false"]';
  assert.equal(f.root.querySelector(selector),f.launcher);
  // This is an exact selector-contract double, not a browser CSS parser.
  // Unexpected selectors must fail the test, including valid but wrong selectors.
  for(const wrong of [':scope > .wrong-helper > button[aria-haspopup="dialog"][aria-expanded="false"]',
    ':scope > .platform-helper > button[aria-haspopup="dialog"][aria-expanded="true"]',
    '.platform-helper button', '[']){
    assert.throws(()=>f.root.querySelector(wrong),/unexpected launcher selector/);
  }
  f.launcher.expanded='true';assert.equal(f.root.querySelector(selector),null);
  f.cleanup();
});
