import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettingsLeaveRegistry} from '../../apps/portal-web/src/modules/account-settings-leave.js';

test('independent editor guards cannot replace or release another pending editor',()=>{
  const registry=createSettingsLeaveRegistry();let first=true,second=true;
  const removeFirst=registry.register(()=>!first),removeSecond=registry.register(()=>!second);
  assert.equal(registry.canLeave(),false);
  first=false;assert.equal(registry.canLeave(),false);
  removeFirst();removeFirst();assert.equal(registry.canLeave(),false);
  second=false;assert.equal(registry.canLeave(),true);
  second=true;assert.equal(registry.canLeave(),false);
  removeSecond();assert.equal(registry.canLeave(),true);
});
test('guards read synchronous live pending state, not the last render',()=>{
  const registry=createSettingsLeaveRegistry();const state={pending:false};
  registry.register(()=>!state.pending);assert.equal(registry.canLeave(),true);
  state.pending=true;assert.equal(registry.canLeave(),false);
  state.pending=false;assert.equal(registry.canLeave(),true);
});
test('duplicate callbacks have independent cleanup and broken guards fail closed',()=>{
  const registry=createSettingsLeaveRegistry(),same=()=>false;
  const a=registry.register(same),b=registry.register(same);a();assert.equal(registry.canLeave(),false);b();assert.equal(registry.canLeave(),true);
  const bad=registry.register(()=>{throw Error('guard unavailable');});assert.equal(registry.canLeave(),false);bad();assert.equal(registry.canLeave(),true);
});
test('a new account registry does not inherit the previous account pending state',()=>{
  const old=createSettingsLeaveRegistry(),next=createSettingsLeaveRegistry();old.register(()=>false);
  assert.equal(old.canLeave(),false);assert.equal(next.canLeave(),true);
});

test('actual command store blocks same-stack busy and post-rejection microtask navigation without a React render',async t=>{
  const {PortalClient,ApiError}=await import('../../apps/portal-web/src/api.js');
  const {performModuleMutation}=await import('../../apps/portal-web/src/modules/shared.js');
  const {sharingMutationState,setSharingDraftAccount}=await import('../../apps/portal-web/src/modules/authoring-drafts.js');
  const {settingsMutationBlocksLeave}=await import('../../apps/portal-web/src/modules/account-settings-leave.js');
  setSharingDraftAccount('settings-guard-test',100);
  const state=sharingMutationState({userId:'settings-guard-test',type:'account-settings'}),client=new PortalClient();
  let reject!:(reason:unknown)=>void;
  const blocked=new Promise<never>((_,fail)=>{reject=fail;});
  t.mock.method(client,'post',()=>blocked);
  const operation=performModuleMutation(client,state,'/me/account',{nickname:'test'},3);
  assert.equal(state.listeners.size,0,'no React subscribers or render participates in this test');
  assert.equal(settingsMutationBlocksLeave(state),true,'same synchronous stack sees busy');
  reject(new ApiError({message:'lost response',network:true}));
  assert.equal(await operation,undefined);
  assert.equal(state.snapshot.busy,false);
  assert.equal(settingsMutationBlocksLeave(state),true,'busy finally cleared, but unknown store still blocks in this microtask');
  const registry=createSettingsLeaveRegistry();registry.register(()=>!settingsMutationBlocksLeave(state));
  assert.equal(registry.canLeave(),false);
  setSharingDraftAccount(null,101);
  assert.equal(settingsMutationBlocksLeave(state),false,'invalidated session store no longer controls another account');
});

test('confirmed command failure is distinguished from an unknown response synchronously',async t=>{
  const {PortalClient,ApiError}=await import('../../apps/portal-web/src/api.js');
  const {performModuleMutation}=await import('../../apps/portal-web/src/modules/shared.js');
  const {sharingMutationState,setSharingDraftAccount}=await import('../../apps/portal-web/src/modules/authoring-drafts.js');
  const {settingsMutationBlocksLeave}=await import('../../apps/portal-web/src/modules/account-settings-leave.js');
  setSharingDraftAccount('settings-confirmed-test',102);
  const state=sharingMutationState({userId:'settings-confirmed-test',type:'account-settings'}),client=new PortalClient();
  t.mock.method(client,'post',async()=>{throw new ApiError({message:'conflict',status:412});});
  assert.equal(await performModuleMutation(client,state,'/me/account',{nickname:'test'},3),undefined);
  assert.equal(state.snapshot.lastFailureUnknown,false);
  assert.equal(settingsMutationBlocksLeave(state),false,'dirty draft confirmation remains a separate guard');
  setSharingDraftAccount(null,103);
});

test('actual profile-extra reveal effect opens ancestors on late availability without dependency on render-function identity',async()=>{
 const {readFileSync}=await import('node:fs');const {runInNewContext}=await import('node:vm');
 const source=readFileSync(new URL('../../apps/portal-web/src/modules/AccountSettingsPanel.tsx',import.meta.url),'utf8');
 const effect=source.match(/useEffect\(\(\)=>\{\n    const details=profileExtrasRef.current;[\s\S]*?\},\[focusProfileExtras,hasProfileExtras\]\);/);assert.ok(effect);
 class Details{open=false;parentElement:Details|null=null;focused=false;querySelector(){return {focus:()=>{this.focused=true;}};}}
 const parent=new Details(),child=new Details();child.parentElement=parent;
 let captured:(()=>void)|undefined,deps:unknown[]=[];
 const run=(available:boolean)=>{runInNewContext(effect[0],{profileExtrasRef:{current:available?child:null},focusProfileExtras:true,hasProfileExtras:available,HTMLDetailsElement:Details,useEffect:(callback:()=>void,dependencies:unknown[])=>{captured=callback;deps=dependencies;}});captured!();};
 run(false);assert.deepEqual(Array.from(deps),[true,false]);assert.equal(parent.open,false);
 run(true);assert.deepEqual(Array.from(deps),[true,true]);assert.equal(parent.open,true);assert.equal(child.open,true);assert.equal(child.focused,true);
 // The dependency array has only booleans; ordinary draft renders do not rerun
 // React's effect or reopen a disclosure the member manually collapsed.
 assert.equal(effect[0].includes('[focusProfileExtras,profileExtras]'),false);
});

test('AccountPanel opens only the requested deep-link section and inner tools render no second primary button',async()=>{
 const esbuild=await import('esbuild');
 const {createElement}=await import('react');
 const {renderToStaticMarkup}=await import('react-dom/server');
 const {runInNewContext}=await import('node:vm');
 const {createRequire}=await import('node:module');
 const path=await import('node:path');
 const bundle=await esbuild.build({
  entryPoints:['apps/portal-web/src/modules/AccountSettingsPanel.tsx','apps/portal-web/src/modules/AvatarEditor.tsx','apps/portal-web/src/modules/MemberSocialLinks.tsx','apps/portal-web/src/modules/AccountSecurity.tsx'],
  bundle:true,format:'cjs',platform:'node',write:false,outdir:'out-test',jsx:'automatic',
  external:['react','react-dom','react/jsx-runtime','zod'],
  plugins:[{name:'ignore-css',setup(build){build.onResolve({filter:/\.css$/},args=>({path:args.path,namespace:'css'}));build.onLoad({filter:/.*/,namespace:'css'},()=>({contents:''}));}}],
 });
 const require=createRequire(import.meta.url);
 const reactMod=require('react');
 const reactPatched={...reactMod,useSyncExternalStore:(sub:any,get:any,getServer?:any)=>reactMod.useSyncExternalStore(sub,get,getServer??get)};
 const loadModule=(name:string)=>{
  const file=bundle.outputFiles.find(f=>f.path.endsWith(`/${name}.js`));assert.ok(file,`missing ${name}`);
  const mod={exports:{} as Record<string,any>};
  runInNewContext(file.text,{module:mod,exports:mod.exports,require:(id:string)=>id==='react'?reactPatched:require(id.startsWith('.')?path.resolve(id):id),process,console,URL,URLSearchParams,TextEncoder,TextDecoder,crypto,setTimeout,clearTimeout,window:{location:{hash:'#account'},addEventListener(){},removeEventListener(){}},document:undefined});
  return mod.exports;
 };
 const {AccountPanel}=loadModule('AccountSettingsPanel');
 const {AvatarEditor}=loadModule('AvatarEditor');
 const {MemberSocialLinks}=loadModule('MemberSocialLinks');
 const {AccountSecurity}=loadModule('AccountSecurity');
 const client={sessionGeneration:1,get:async()=>({}),post:async()=>({})};
 const session={user:{user_id:'u1',email:'u@local.test',nickname:'u',role:'member'}};
 const countOpenSections=(html:string)=>(html.match(/<details[^>]*class="card account-settings-section"[^>]*\bopen(?:\b|=)/g)??[]).length;
 const openSectionTitles=(html:string)=>[...html.matchAll(/<details[^>]*class="card account-settings-section"[^>]*\bopen(?:\b|=)[^>]*>[\s\S]*?<summary[^>]*><strong>([^<]+)<\/strong>/g)].map(m=>m[1]);

 const defaultHtml=renderToStaticMarkup(createElement(AccountPanel,{client,session,publicPage:()=>createElement('div',null,'pub')}));
 assert.equal(countOpenSections(defaultHtml),1);
 assert.deepEqual(openSectionTitles(defaultHtml),['個人資料']);

 const pageHtml=renderToStaticMarkup(createElement(AccountPanel,{client,session,publicPage:()=>createElement('div',null,'pub'),focusPublicPage:true}));
 assert.equal(countOpenSections(pageHtml),1,'?view=page should leave only 公開個人頁 open');
 assert.deepEqual(openSectionTitles(pageHtml),['公開個人頁']);

 const connHtml=renderToStaticMarkup(createElement(AccountPanel,{client,session,publicPage:()=>createElement('div',null,'pub'),focusConnections:true}));
 assert.equal(countOpenSections(connHtml),1,'?view=connections should leave only 帳號與安全 open');
 assert.deepEqual(openSectionTitles(connHtml),['帳號與安全']);

 const avatarHtml=renderToStaticMarkup(createElement(AvatarEditor,{client,nickname:'n',initial:{avatar_url:null,avatar_version:null,has_avatar:false},onSaved:()=>{}}));
 assert.equal(/btn-primary/.test(avatarHtml),false,'AvatarEditor inside 個人資料 must not add a second btn-primary');

 const socialHtml=renderToStaticMarkup(createElement(MemberSocialLinks,{client,memberId:'u1'}));
 assert.equal(/btn-primary/.test(socialHtml),false,'MemberSocialLinks inside 個人資料 must not add a second btn-primary');
 const socialSource=(await import('node:fs')).readFileSync('apps/portal-web/src/modules/MemberSocialLinks.tsx','utf8');
 assert.equal(/btn-primary/.test(socialSource),false,'MemberSocialLinks draft form inside 個人資料 must not add a second btn-primary');

 const certSource=(await import('node:fs')).readFileSync('apps/portal-web/src/modules/CommunityCertification.tsx','utf8');
 assert.equal(/btn-primary/.test(certSource),false,'CommunityCertificationPanel inside 個人資料 must not add a second btn-primary');

 const secFailedHtml=renderToStaticMarkup(createElement(AccountSecurity,{client,hasPassword:true,secondary:true,onAccountChanged:async()=>{}}));
 assert.equal(/btn-primary/.test(secFailedHtml),false,'AccountSecurity must render no btn-primary when parent account load failed');

 const notifSource=(await import('node:fs')).readFileSync('apps/portal-web/src/modules/NotificationPreferences.tsx','utf8');
 assert.equal(/btn-primary/.test(notifSource),false,'NotificationPreferences inside 帳號與安全 must not add a second btn-primary');
});

test('focusPublicPage opens only public page with one primary button and intra-settings links keep dirty drafts without prompting',async()=>{
 const {readFileSync}=await import('node:fs');
 const path=await import('node:path');
 const {fileURLToPath}=await import('node:url');
 const {runInNewContext}=await import('node:vm');
 const {createRequire}=await import('node:module');
 const {transformSync}=await import('esbuild');
 const React=(await import('react')).default;
 const {PortalClient}=await import('../../apps/portal-web/src/api.js');
 const portalRoute=await import('../../apps/portal-web/src/portal-route.js');
 const shared=await import('../../apps/portal-web/src/modules/shared.js');
 const authoringDrafts=await import('../../apps/portal-web/src/modules/authoring-drafts.js');
 const leaveMod=await import('../../apps/portal-web/src/modules/account-settings-leave.js');
 class NodeEl{
  [key:string]:any;
  parentNode:NodeEl|null=null;childNodes:NodeEl[]=[];attributes:Record<string,string>={};style={setProperty(){},removeProperty(){}};namespaceURI='http://www.w3.org/1999/xhtml';
  tagName:string;open?:boolean;
  constructor(public nodeType:number,public nodeName:string,public ownerDocument:any){this.tagName=nodeName;}
  appendChild(n:NodeEl){n.parentNode?.removeChild(n);this.childNodes.push(n);n.parentNode=this;return n;}
  removeChild(n:NodeEl){const i=this.childNodes.indexOf(n);this.childNodes.splice(i,1);n.parentNode=null;return n;}
  insertBefore(n:NodeEl,b:NodeEl){n.parentNode?.removeChild(n);const i=this.childNodes.indexOf(b);this.childNodes.splice(i,0,n);n.parentNode=this;return n;}
  setAttribute(k:string,v:unknown){this.attributes[k]=String(v);if(k==='open')this.open=true;}
  removeAttribute(k:string){delete this.attributes[k];if(k==='open')this.open=false;}
  getAttribute(k:string){return this.attributes[k]??null;}
  addEventListener(){}removeEventListener(){}
  get firstChild():NodeEl|null{return this.childNodes[0]??null;}get lastChild():NodeEl|null{return this.childNodes.at(-1)??null;}
  get nextSibling():NodeEl|null{return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this)+1]??null;}
  get textContent():string{return this.nodeType===3?(this as any).nodeValue:this.childNodes.map(c=>c.textContent).join('');}
  set textContent(v:string){this.childNodes=[];if(v)this.appendChild(this.ownerDocument.createTextNode(String(v)));}
  get isConnected(){return true;}
  get options(){return [];}
  querySelector(){return null;}
  focus(){}
 }
 const doc:any={nodeType:9,nodeName:'#document',ownerDocument:null,addEventListener(){},removeEventListener(){},createElement:(n:string)=>new NodeEl(1,n.toUpperCase(),doc),createElementNS:(_:string,n:string)=>new NodeEl(1,n.toUpperCase(),doc),createTextNode:(v:string)=>Object.assign(new NodeEl(3,'#text',doc),{nodeValue:v})};
 doc.ownerDocument=doc;doc.documentElement=new NodeEl(1,'HTML',doc);doc.body=new NodeEl(1,'BODY',doc);doc.documentElement.appendChild(doc.body);doc.activeElement=doc.body;
 let confirms=0;
 const win:any={location:{hash:'#me/settings'},document:doc,HTMLElement:NodeEl,HTMLDetailsElement:NodeEl,HTMLIFrameElement:class{},confirm:()=>{confirms++;return false;},addEventListener(){},removeEventListener(){}};
 doc.defaultView=win;
 const saved={document:globalThis.document,window:globalThis.window,HTMLElement:globalThis.HTMLElement,HTMLDetailsElement:globalThis.HTMLDetailsElement,HTMLIFrameElement:globalThis.HTMLIFrameElement,Node:globalThis.Node,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame,IS_REACT_ACT_ENVIRONMENT:(globalThis as any).IS_REACT_ACT_ENVIRONMENT};
 Object.assign(globalThis,{document:doc,window:win,HTMLElement:NodeEl,HTMLDetailsElement:NodeEl,HTMLIFrameElement:win.HTMLIFrameElement,Node:NodeEl,requestAnimationFrame:()=>1,cancelAnimationFrame(){},IS_REACT_ACT_ENVIRONMENT:true});
 const require=createRequire(import.meta.url);
 const {createRoot}=require('react-dom/client') as typeof import('react-dom/client');
 const {flushSync}=require('react-dom') as typeof import('react-dom');
 try{
  const base=fileURLToPath(new URL('../../',import.meta.url));
  const raw=readFileSync(path.resolve(base,'apps/portal-web/src/modules/AccountSettingsPanel.tsx'),'utf8');
  const mod={exports:{} as any};
  const stub=(names:string[])=>Object.fromEntries(names.map(n=>[n,()=>null]));
  const stubMap:Record<string,any>={
   '../portal-route':portalRoute,'./shared':shared,'./account-settings-leave':leaveMod,'./authoring-drafts':authoringDrafts,
   './AccountDeactivation':stub(['AccountDeactivation']),'./EmailChange':stub(['EmailChangePanel']),'./AvatarEditor':stub(['AvatarEditor']),
   './GitHubSocial':stub(['GitHubConnectionPanel']),'./TotpSettings':stub(['TotpSettings']),'./MemberSocialLinks':stub(['MemberSocialLinks']),
   './MemberShare':stub(['MemberShare']),'./EmailVerification':stub(['EmailVerificationPanel']),'./AccountSecurity':stub(['AccountSecurity']),
   './GoogleAccount':stub(['GoogleAccount']),'./PasswordSetup':stub(['PasswordSetup']),'./MemberReporting':stub(['OwnReports']),
   './Membership':{MemberCard:()=>null,Status:()=>null,loadLabels:async()=>({}),identityLabels:{},contactLabels:{email:'聯絡 E-mail',discord:'Discord',github:'GitHub',line:'LINE'}},
  };
  runInNewContext(transformSync(raw,{loader:'tsx',format:'cjs',jsx:'automatic'}).code,{module:mod,exports:mod.exports,JSON,Math,Object,Array,Boolean,String,Number,Promise,Error,URLSearchParams,requestAnimationFrame:()=>1,cancelAnimationFrame(){},window:win,document:doc,console,require(name:string){
   if(name==='react')return React;
   if(name==='react/jsx-runtime')return require(name);
   if(name.endsWith('.css'))return {};
   return stubMap[name]??{};
  }});
  const {AccountPanel}=mod.exports;
  const client=new PortalClient();
  const account={user_id:'10000000-0000-4000-8000-000000000001',avatar:{avatar_url:null,variant_version:null},nickname:'原本名字',identity_label:null,login_email:'a@local.test',email_verified:true,has_password:true,contacts:{email:{value:'a@local.test',audiences:[]},discord:{value:'',audiences:[]},github:{value:'',audiences:[]},line:{value:'',audiences:[]}},aggregate_version:1};
  client.get=(async(p:string)=>p==='/me/account'?account:{user_id:account.user_id,nickname:account.nickname,avatar_url:null,primary_guild:null,capabilities:[]}) as typeof client.get;
  const descendants=(n:NodeEl):NodeEl[]=>[n,...n.childNodes.flatMap(descendants)];
  const rProps=(n:NodeEl)=>n[Object.keys(n).find(k=>k.startsWith('__reactProps$'))!];
  const container=doc.createElement('div');doc.body.appendChild(container);
  let leaveGuard:((hash:string|null)=>boolean)|null=null;
  const root=createRoot(container);
  const renderPanel=(focusPublicPage:boolean)=>React.act(()=>flushSync(()=>{
   root.render(React.createElement(AccountPanel,{client,session:{user:{user_id:account.user_id,display_name:'原本名字'},csrf_token:'t'} as any,onNavigate:()=>{},registerLeave:(g:any)=>{leaveGuard=g;},focusPublicPage,publicPage:()=>React.createElement('button',{type:'submit',className:'btn btn-primary'},'儲存')}));
  }));
  await renderPanel(true);
  await React.act(async()=>{await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));});
  const sections=descendants(container).filter(n=>n.nodeName==='DETAILS'&&(n.getAttribute('class')??'').includes('account-settings-section'));
  const byTitle=(title:string)=>sections.find(s=>s.childNodes[0]?.textContent.startsWith(title))!;
  assert.equal(Boolean(byTitle('個人資料').open),false);
  assert.equal(Boolean(byTitle('公開個人頁').open),true);
  const shown=(n:NodeEl)=>{for(let c:NodeEl=n,p=n.parentNode;p;c=p,p=p.parentNode)if(p.nodeName==='DETAILS'&&!p.open&&c!==p.childNodes[0])return false;return true;};
  assert.equal(descendants(container).filter(n=>n.nodeName==='BUTTON'&&(n.getAttribute('class')??'').includes('btn-primary')&&shown(n)).length,1,'one visible primary button; closed sections hide theirs');
  await renderPanel(false);
  assert.equal(Boolean(byTitle('個人資料').open),true);
  assert.equal(Boolean(byTitle('公開個人頁').open),false);
  const nameInput=descendants(byTitle('個人資料')).find(n=>n.nodeName==='INPUT')!;
  React.act(()=>flushSync(()=>{rProps(nameInput).onChange({target:{value:'修改過的名字'}});}));
  assert.equal(leaveGuard!('#account?view=page'),true);
  assert.equal(confirms,0);
  assert.equal(leaveGuard!('#home'),false);
  assert.equal(confirms,1);
  React.act(()=>root.unmount());
 }finally{
  Object.assign(globalThis,saved);
 }
});
