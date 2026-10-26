import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {pageHelp} from '../../apps/portal-web/src/page-help.js';
import {PORTAL_FEATURE_METADATA} from '../../apps/portal-web/src/features/metadata.js';
import {HELPER_PAGE_IDS} from '../../apps/portal-web/src/modules/platform-helper/model.js';

async function loadHost(hooks?:object){
  const result=await build({entryPoints:['apps/portal-web/src/PlatformHelperHost.tsx'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',loader:{'.css':'empty'},jsx:'automatic'});
  const module={exports:{} as any},require=createRequire(import.meta.url);
  new Function('module','exports','require',result.outputFiles[0].text)(module,module.exports,(id:string)=>id==='react'&&hooks?hooks:require(id));
  return module.exports;
}
test('member host projects actual current canonical title/help and strictly filters stores',async()=>{
  const host=await loadHost();
  const snapshot=host.memberHelperKnowledge(HELPER_PAGE_IDS,true);
  assert.deepEqual(snapshot.availablePageIds,HELPER_PAGE_IDS);
  for(const id of HELPER_PAGE_IDS){assert.deepEqual(snapshot.knowledge[id],{id,title:PORTAL_FEATURE_METADATA[id].title,...pageHelp[id]});assert.notEqual(snapshot.knowledge[id].steps,pageHelp[id].steps);}
  for(const flag of [false,null,undefined])assert.equal(host.memberHelperKnowledge(HELPER_PAGE_IDS,flag).availablePageIds.includes('stores'),false);
  assert.deepEqual(host.memberHelperKnowledge(['skills','messages','admin'],false).availablePageIds,['skills']);
});
test('member host blocks known shell states and malformed session generations',async()=>{
  const {memberHelperBlocked}=await loadHost();
  const ready={sessionGeneration:1,mobileOpen:false,messagesOpen:false,pending:false,accessExpired:false};
  assert.equal(memberHelperBlocked(ready),false);
  for(const flag of ['mobileOpen','messagesOpen','pending','accessExpired'])assert.equal(memberHelperBlocked({...ready,[flag]:true}),true);
  for(const generation of [-1,NaN,Infinity,undefined])assert.equal(memberHelperBlocked({...ready,sessionGeneration:generation}),true);
});
test('member host modal monitor ignores own, hidden and zero-area surfaces',async()=>{
  const {hasForeignHelperBlocker}=await loadHost();
  const nodes:any[]=[];const doc={querySelectorAll:()=>nodes,defaultView:{getComputedStyle:(node:any)=>node.style}};
  const node=(extra={})=>({ownerDocument:doc,closest:()=>null,getClientRects:()=>[{}],style:{display:'block',visibility:'visible'},...extra});
  const own=node();const root={ownerDocument:doc,contains:(target:any)=>target===own};
  nodes.push(own,node({closest:()=>({})}),node({getClientRects:()=>[]}),node({style:{display:'none',visibility:'visible'}}));
  assert.equal(hasForeignHelperBlocker(root),false);
  nodes.push(node());assert.equal(hasForeignHelperBlocker(root),true);
});
test('member host forwards only allowed explicit navigation and keys route/session without DOM disclosure',async()=>{
  const hooks={useRef:()=>({current:null}),useState:()=>[false,()=>{}],useLayoutEffect:()=>{}};
  const {PlatformHelperHost}=await loadHost(hooks);
  let calls=0;const draft='retained';
  const props={pageId:'stores',routeIdentity:'#stores/a',sessionGeneration:3,mobileOpen:false,messagesOpen:false,pending:false,accessExpired:false,guildLaunchpadEnabled:false,availablePageIds:HELPER_PAGE_IDS,onNavigate:()=>{calls++;}};
  const first=PlatformHelperHost(props);const helper=first.props.children;
  helper.props.onNavigate('stores');helper.props.onNavigate('messages');assert.equal(calls,0);
  helper.props.onNavigate('skills');assert.equal(calls,1);assert.equal(draft,'retained');
  assert.equal(PlatformHelperHost(props).props.children.key,helper.key,'refused navigation leaves route identity unchanged');
  assert.notEqual(PlatformHelperHost({...props,routeIdentity:'#stores/b'}).props.children.key,helper.key);
  assert.notEqual(PlatformHelperHost({...props,sessionGeneration:4}).props.children.key,helper.key);
  assert.equal(first.props['data-route'],undefined);assert.equal(first.props['data-session'],undefined);
  PlatformHelperHost({...props,messagesOpen:true}).props.children.props.onNavigate('skills');assert.equal(calls,1);
});
test('member host monitor subscribes and cleans up without inspecting text or issuing requests',async()=>{
  let effect:()=>void|(()=>void)=()=>{};
  const ref={current:null as any};let refs=0;
  const {PlatformHelperHost}=await loadHost({useRef:(value:unknown)=>refs++===0?ref:{current:value},useState:()=>[false,()=>{}],useLayoutEffect:(callback:typeof effect)=>{effect=callback;}});
  let observed=0,disconnected=0;const attached:string[]=[],removed:string[]=[];
  const view={addEventListener:(name:string)=>attached.push(name),removeEventListener:(name:string)=>removed.push(name),MutationObserver:class{observe(){observed++;}disconnect(){disconnected++;}}};
  const doc={body:{},defaultView:view,querySelectorAll:()=>[],addEventListener:(name:string)=>attached.push(name),removeEventListener:(name:string)=>removed.push(name)};
  ref.current={ownerDocument:doc,contains:()=>false};
  PlatformHelperHost({pageId:'home',routeIdentity:'#home',sessionGeneration:1,mobileOpen:false,messagesOpen:false,pending:false,accessExpired:false,availablePageIds:HELPER_PAGE_IDS,guildLaunchpadEnabled:true,onNavigate:()=>{}});
  const cleanup=effect();assert.equal(observed,1);assert.deepEqual(attached.sort(),['focusin','resize','toggle']);
  assert.equal(typeof cleanup,'function');cleanup!();assert.equal(disconnected,1);assert.deepEqual(removed.sort(),attached.sort());
});
test('Workspace integrates only the member host through existing guarded selectTab',()=>{
  const source=readFileSync('apps/portal-web/src/App.tsx','utf8');
  const workspace=source.slice(source.indexOf('function Workspace('));
  assert.equal(source.slice(0,source.indexOf('function Workspace(')).includes('<PlatformHelperHost'),false);
  assert.match(workspace,/<PlatformHelperHost/);assert.match(workspace,/routeIdentity=\{locationHash\}/);assert.match(workspace,/onNavigate=\{navigateFromHelper\}/);
  assert.match(workspace,/selectTab\(next\)/);assert.match(workspace,/acceptedHash.current !== previousHash/);assert.match(workspace,/next === tab && acceptedHash.current !== previousHash/);assert.match(workspace,/expectedHash === locationHash && !document.querySelector/);
});

test('actual Workspace helper callback and post-commit effect focus only accepted same-tab routes',async()=>{
  const {transformSync}=await import('esbuild');const {runInNewContext}=await import('node:vm');
  const source=readFileSync('apps/portal-web/src/App.tsx','utf8');
  const select=source.match(/  const selectTab = useCallback\(\(next: TabId, destinationHash\?: string\) => \{[\s\S]*?\n  \}, \[openMessages,closeMessagesThen\]\)/)?.[0];
  const navigate=source.match(/  const navigateFromHelper = useCallback\([\s\S]*?\n  \}, \[selectTab, tab\]\)/)?.[0];
  const effect=source.match(/  useEffect\(\(\) => \{\n    const expectedHash = helperFocusPending.current[\s\S]*?\n  \}, \[locationHash\]\)/)?.[0];
  assert.ok(select);assert.ok(navigate);assert.ok(effect);
  for(const scenario of ['accepted','refused','same-hash','foreign-modal','unrelated-route','cross-tab'] as const){
    const initial=scenario==='same-hash'?'#stores':'#stores/supply';
    let route=initial,nextTab='stores',dialogOpen=true,focuses=0;
    const context:any={tab:'stores',locationHash:initial,acceptedHash:{current:initial},helperFocusPending:{current:null},pageLeaveGuard:{current:()=>scenario!=='refused'},
      useCallback:(callback:unknown)=>callback,useEffect:(callback:()=>void)=>callback(),openMessages:()=>{},closeMessagesThen:(callback:()=>void)=>callback(),
      setTab:(value:string)=>{nextTab=value;},setLocationHash:(value:string)=>{route=value;},setMobileOpen:()=>{},setFriendScope:()=>{},
      mainContent:{current:{focus(){if(!dialogOpen&&scenario!=='foreign-modal')focuses++;}}},
      document:{querySelector:()=>dialogOpen||scenario==='foreign-modal'?{}:null},
      window:{location:{pathname:'/',search:'',hash:initial},history:{replaceState(){throw Error('unexpected replace');}},dispatchEvent(){throw Error('unexpected event');}},
    };
    runInNewContext(transformSync(`${select};${navigate};globalThis.request=navigateFromHelper`,{loader:'ts',format:'cjs'}).code,context);
    context.request(scenario==='cross-tab'?'skills':'stores');assert.equal(focuses,0,'native helper is still open before commit');
    if(scenario==='refused'||scenario==='same-hash'){assert.equal(context.helperFocusPending.current,null);assert.equal(route,initial);}
    if(scenario==='unrelated-route')route='#stores/other';
    context.locationHash=route;context.tab=nextTab;dialogOpen=false; // Synthetic React commit; not native browser evidence.
    runInNewContext(transformSync(effect,{loader:'ts',format:'cjs'}).code,context);
    assert.equal(focuses,scenario==='accepted'?1:0,scenario);assert.equal(context.helperFocusPending.current,null);
  }
});

test('actual member helper bridge publishes one dialog state and revokes stale leases',async()=>{
  const {createMemberHelperBridge}=await loadHost();assert.equal(typeof createMemberHelperBridge,'function');
  const origin={} as HTMLElement;let current=true,blocked=false,opened=false,calls=0;const published:any[]=[],closed:string[]=[];
  const controller={dialogId:'same-dialog',get open(){return opened;},requestOpen(){calls++;if(opened)return false;opened=true;return true;}};
  const bridge=createMemberHelperBridge({controller,isCurrent:()=>current,isBlocked:()=>blocked,publish:(action:any)=>published.push(action)});
  const action=published.at(-1);assert.equal(action.dialogId,'same-dialog');assert.equal(action.open,false);
  assert.equal(action.requestOpen(origin,(reason:string)=>closed.push(reason)),true);
  bridge.change({dialogId:'same-dialog',origin,open:true});assert.equal(published.at(-1).open,true);
  assert.equal(action.requestOpen(origin,()=>closed.push('duplicate')),false);assert.equal(calls,1);
  opened=false;bridge.change({dialogId:'foreign-dialog',origin,open:false,reason:'dismiss'});assert.deepEqual(closed,[]);
  bridge.change({dialogId:'same-dialog',origin,open:false,reason:'dismiss'});assert.deepEqual(closed,['dismiss']);assert.equal(published.at(-1).open,false);
  blocked=true;assert.equal(action.requestOpen(origin,()=>{}),false);blocked=false;current=false;assert.equal(action.requestOpen(origin,()=>{}),false);
  current=true;bridge.dispose();assert.equal(published.at(-1),null);assert.equal(action.requestOpen(origin,()=>{}),false);
});
test('actual member helper bridge fails closed without queued callbacks and cancels only its own external origin',async()=>{
  const {createMemberHelperBridge}=await loadHost();assert.equal(typeof createMemberHelperBridge,'function');
  let accept=false,opened=false;const origin={} as HTMLElement,foreign={} as HTMLElement,published:any[]=[],closed:string[]=[];
  const bridge=createMemberHelperBridge({controller:{dialogId:'one',get open(){return opened;},requestOpen(){opened=accept;return accept;}},isCurrent:()=>true,isBlocked:()=>false,publish:(a:any)=>published.push(a)});
  const action=published.at(-1);assert.equal(action.requestOpen(origin,()=>closed.push('failed')),false);
  accept=true;assert.equal(action.requestOpen(origin,(reason:string)=>closed.push(reason)),true);
  bridge.change({dialogId:'one',origin:foreign,open:false,reason:'dismiss'});assert.deepEqual(closed,[]);
  bridge.dispose();assert.deepEqual(closed,['teardown']);bridge.dispose();assert.deepEqual(closed,['teardown']);
});
