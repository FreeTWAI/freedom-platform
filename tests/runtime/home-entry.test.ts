import assert from 'node:assert/strict';
import {test} from 'node:test';
import {activateHomeLink} from '../../apps/portal-web/src/brand-home-link.js';

type HomeLinkEvent = Parameters<typeof activateHomeLink>[0];

function linkEvent(overrides: Partial<HomeLinkEvent> = {}) {
  const calls: string[] = [];
  const event: HomeLinkEvent = {
    button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    defaultPrevented: false,
    preventDefault() {calls.push('preventDefault'); this.defaultPrevented = true;},
    ...overrides,
  };
  return {event, calls};
}

test('ordinary home-link activation prevents native navigation before consulting app navigation', () => {
  const {event, calls} = linkEvent();
  activateHomeLink(event, () => {
    assert.equal(event.defaultPrevented, true);
    calls.push('navigate');
  });
  assert.deepEqual(calls, ['preventDefault', 'navigate']);
});

for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const) {
  test(`home link preserves native ${modifier} activation without calling app navigation`, () => {
    const {event, calls} = linkEvent({[modifier]: true});
    activateHomeLink(event, () => calls.push('navigate'));
    assert.equal(event.defaultPrevented, false);
    assert.deepEqual(calls, []);
  });
}

for (const button of [1, 2]) {
  test(`home link preserves native mouse button ${button} activation`, () => {
    const {event, calls} = linkEvent({button});
    activateHomeLink(event, () => calls.push('navigate'));
    assert.equal(event.defaultPrevented, false);
    assert.deepEqual(calls, []);
  });
}

test('an already-cancelled home-link activation does not navigate or cancel again', () => {
  const {event, calls} = linkEvent({defaultPrevented: true});
  activateHomeLink(event, () => calls.push('navigate'));
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(calls, []);
});

// Render the real shared navigation without a browser or any member data.
// Browser focus, viewport fitting and history have separate E2E coverage.
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Navigation} from '../../apps/portal-web/src/Navigation.js';
import {interfaceText} from '../../apps/portal-web/src/language.js';
import {TAB_TITLES} from '../../apps/portal-web/src/features/metadata.js';

for (const personalContentEnabled of [false, true]) test(`personal space is the single primary personal entry, content capability ${personalContentEnabled}`, () => {
  const html=renderToStaticMarkup(createElement(Navigation, {
    current:'my-content',onSelect:()=>{},canManageGuild:false,guildLaunchpadEnabled:false,
    communitySearchEnabled:false,personalContentEnabled,mobileOpen:false,
  }));
  const primary=html.split('<div class="nav-primary">')[1].split('</div>')[0];
  assert.match(primary,/我的個人空間/);
  assert.doesNotMatch(primary,/我的內容/);
  assert.equal((primary.match(/aria-current="page"/g)??[]).length,1);
  assert.match(primary,/aria-current="page"[^>]*>.*?我的個人空間/);
  assert.doesNotMatch(html,/mobile-nav-backdrop/);
});

test('getting-started display label retains the todos route key in all interface languages',()=>{
  assert.equal(TAB_TITLES.todos,'入門指南');
  for(const language of ['zh-Hant','en','ja','ko','es'] as const)assert.ok(interfaceText(language,'nav.todos'));
  assert.equal(interfaceText('zh-Hant','nav.todos'),'入門指南');
});

// Execute the actual App history handler and navigation effect. This controls
// React dependency scheduling and DOM focus only; it is not browser acceptance.
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';

function navigationHistoryHarness(initialHash='#stores/supply') {
  const source=readFileSync(new URL('../../apps/portal-web/src/App.tsx',import.meta.url),'utf8');
  const history=source.match(/  useEffect\(\(\) => \{\n    const changed = \(event:Event\) => \{[\s\S]*?\n  \}, \[launchpadEnabled,openMessages\]\)/);
  const navigation=source.match(/const previousTab = useRef\(tab\)\n(  useEffect\(\(\) => \{[\s\S]*?\n  \}, \[([^\]]+)\]\))/);
  const route=source.match(/function tabFromHash\(launchpadEnabled: boolean\): TabId \{[\s\S]*?\n\}/);
  assert.ok(history,'actual App history effect');assert.ok(navigation,'actual App navigation effect');assert.ok(route,'actual App route parser');
  const listeners=new Map<string,(event:{type:string})=>void>();
  let href=`https://platform.test/${initialHash}`;
  const state={mobileOpen:true,focus:'menu',focused:0,scrolled:0,logs:0,replaced:0,blocked:false};
  const location={get href(){return href},get hash(){return new URL(href).hash},pathname:'/',search:''};
  const context:any={window:{location,history:{state:null,replaceState(_state:unknown,_title:string,url:string){href=new URL(url,href).href;state.replaced++;},pushState(){throw Error('Unexpected history push')},go(){throw Error('Unexpected history traversal')}}},document:{activeElement:{closest:(selector:string)=>state.focus==='menu'&&selector==='#workspace-navigation'?{}:null}},
    launchpadEnabled:true,TAB_TITLES,eventIdFromLocation:()=>null,isMessagesHash:(hash:string)=>hash.split('?')[0]==='#messages',isMessagesHistoryEntry:()=>false,
    acceptedHash:{current:initialHash},messageLocation:{current:{href,state:null}},messageHistoryTransition:{current:null},pageLeaveGuard:{current:()=>!state.blocked},previousTab:{current:'stores'},tab:'stores',locationHash:initialHash,
    mainContent:{current:{focus(){state.focus='main';state.focused++;}}},workspaceTopbar:{current:{scrollIntoView(){state.scrolled++;}}},
    setMobileOpen:(value:boolean)=>{state.mobileOpen=value;},setLocationHash:(value:string)=>{context.locationHash=value;},setTab:(value:string)=>{context.tab=value;},setNotificationTarget:()=>{},setMessagesOpen:()=>{},openMessages:()=>{},consoleChannel:(x:string)=>x,tabTitle:(x:string)=>x,TAB_GUIDANCE:{},logConsoleEvent:()=>{state.logs++;},
    useEffect:(effect:()=>void)=>effect(),
  };
  context.window.addEventListener=(type:string,listener:(event:{type:string})=>void)=>listeners.set(type,listener);
  context.window.removeEventListener=(type:string)=>listeners.delete(type);
  const evaluate=(code:string)=>runInNewContext(transformSync(code,{loader:'ts',format:'cjs'}).code,context);
  evaluate(`${route[0]};globalThis.tabFromHash=tabFromHash;${history[0]}`);
  const dependencies=navigation[2].split(',').map(x=>x.trim());
  let last=dependencies.map(key=>context[key]);
  return {state,context,move(hash:string,type='popstate'){
    href=`https://platform.test/${hash}`;listeners.get(type)!({type});
    const next=dependencies.map(key=>context[key]);
    if(next.some((value,index)=>value!==last[index]))evaluate(navigation[1]);
    last=next;
  }};
}

for(const [from,to] of [['#stores/supply','#stores'],['#stores','#stores/supply']])test(`same-tab history ${from} -> ${to} closes mobile navigation and transfers hidden-menu focus`,()=>{
  const h=navigationHistoryHarness(from);h.move(to);
  assert.equal(h.context.tab,'stores');assert.equal(h.state.mobileOpen,false);
  assert.equal(h.state.focus,'main');assert.equal(h.state.focused,1);
  assert.equal(h.state.scrolled,0);assert.equal(h.state.logs,0);assert.equal(h.state.replaced,0);
  h.move(to,'hashchange');assert.equal(h.state.focused,1);
});

test('same-tab history does not steal focus from an unrelated control',()=>{
  const h=navigationHistoryHarness();h.state.focus='settings';h.move('#stores');
  assert.equal(h.state.mobileOpen,false);assert.equal(h.state.focus,'settings');assert.equal(h.state.focused,0);
});

test('a rejected history navigation retains the open menu and accepted location',()=>{
  const h=navigationHistoryHarness();h.state.blocked=true;h.move('#stores');
  assert.equal(h.state.mobileOpen,true);assert.equal(h.state.focus,'menu');assert.equal(h.context.locationHash,'#stores/supply');assert.equal(h.state.replaced,1);
});

test('duplicate history events do not dismiss a newly reopened menu',()=>{
  const h=navigationHistoryHarness();h.move('#stores');h.state.mobileOpen=true;h.state.focus='menu';h.move('#stores','hashchange');
  assert.equal(h.state.mobileOpen,true);assert.equal(h.state.focus,'menu');
});

test('cross-tab history retains main focus, scroll and one navigation announcement',()=>{
  const h=navigationHistoryHarness();h.move('#skills');
  assert.equal(h.context.tab,'skills');assert.equal(h.state.mobileOpen,false);assert.equal(h.state.focus,'main');assert.equal(h.state.scrolled,1);assert.equal(h.state.logs,1);
});

// Evaluate the actual shared entry without its CSS side effect in Node. Layout is E2E-only.
const sharingSource=readFileSync(new URL('../../apps/portal-web/src/modules/WorkSharingEntry.tsx',import.meta.url),'utf8').replace("import './WorkSharing.css';",'').replace('export function','function');
const WorkSharingEntry=runInNewContext(transformSync(`${sharingSource};globalThis.entry=WorkSharingEntry`,{loader:'tsx',jsxFactory:'createElement'}).code,{createElement});

for(const current of ['showcase','opensource','engagement'] as const)test(`creation navigation groups ${current} under one reachable shared-work entry`,()=>{
  const html=renderToStaticMarkup(createElement(Navigation,{
    current,onSelect:()=>{},canManageGuild:false,guildLaunchpadEnabled:false,
    communitySearchEnabled:false,personalContentEnabled:true,mobileOpen:false,
  }));
  const creation=html.match(/<details class="nav-section"[^>]*><summary[^>]*>創作與合作[\s\S]*?<\/summary>([\s\S]*?)<\/details>/)?.[1];
  assert.ok(creation,'creation group exists');
  assert.equal((creation.match(/<button /g)??[]).length,3);
  assert.match(creation,/任務協作/);assert.match(creation,/作品與合作/);assert.match(creation,/私人 AI 工作室/);
  assert.doesNotMatch(creation,/開源投稿|合作紀錄/);
  assert.equal((creation.match(/aria-current="page"/g)??[]).length,1);
  assert.match(creation,/aria-current="page"[^>]*>.*?作品與合作/);
  const links=renderToStaticMarkup(createElement(WorkSharingEntry,{current}));
  for(const route of ['showcase','opensource','engagement'])assert.match(links,new RegExp(`href="#${route}"`));
  assert.equal((links.match(/aria-current="page"/g)??[]).length,1);
  assert.match(links,new RegExp(`href="#${current}" aria-current="page"`));
  assert.doesNotMatch(links,/private-ai/);
});

test('task collaboration and community tasks keep distinct names in every language',()=>{
  assert.equal(TAB_TITLES.workbench,'任務協作');assert.equal(TAB_TITLES.tasks,'社群任務');
  for(const language of ['zh-Hant','en','ja','ko','es'] as const){
    assert.notEqual(interfaceText(language,'nav.workbench'),interfaceText(language,'nav.tasks'));
    assert.ok(interfaceText(language,'nav.private-ai'));
  }
});
