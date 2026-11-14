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
