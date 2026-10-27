import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {developmentPages} from '../../modules/development/pages.js';
import {TAB_TITLES} from '../../apps/portal-web/src/Navigation.js';
import {EXPERIENCE_PROFILES,WORKSHOP_THEMES,resolveExperienceProfile,applyExperienceProfile} from '../../apps/portal-web/src/experience-profiles.js';
import {DRAGON_PAGE_SUPPORT,pageGuideSupport} from '../../apps/portal-web/src/modules/newcomer-guides/page-support.js';
import {canRequestGuide,acceptsGuideRelease} from '../../apps/portal-web/src/modules/newcomer-guides/gate.js';
import {DRAGON_RELEASE_PIN} from '../../apps/portal-web/src/modules/newcomer-guides/release-pin.js';
import {DRAGON_PACK} from '../../apps/portal-web/src/modules/newcomer-guides/packs/dragon/index.js';
import {AI_SISTER_PACK} from '../../apps/portal-web/src/modules/newcomer-guides/packs/ai-sister/index.js';
import manifest from '../../contracts/guide-packs/dragon-v1-20261004.json';

const enabled={...DRAGON_RELEASE_PIN,enabled:true};
test('one profile preserves every legacy theme and uses a dark-base opt-in skin without a second activation preference',()=>{
  assert.deepEqual(WORKSHOP_THEMES.map(([id])=>id),['light','dark','versefolk','guide-dragon','guide-ai-sister']);
  for(const id of ['light','dark','versefolk'] as const){
    assert.equal(EXPERIENCE_PROFILES[id].baseTheme,id);assert.equal(EXPERIENCE_PROFILES[id].skin,null);assert.equal(EXPERIENCE_PROFILES[id].guidePack,null);
  }
  const root={dataset:{}} as unknown as HTMLElement;
  assert.equal(applyExperienceProfile('guide-dragon',root),'guide-dragon');
  assert.deepEqual(root.dataset,{theme:'dark',experienceProfile:'guide-dragon',guideSkin:'dragon'});
  for(const id of ['light','dark','versefolk']){applyExperienceProfile(id,root);assert.equal(root.dataset.theme,id);assert.equal(root.dataset.guideSkin,undefined);}
  for(const value of [null,undefined,'dragon','unknown','__proto__','constructor',{},true])assert.equal(resolveExperienceProfile(value).id,'light');
});
test('page support exactly covers both actual development registry and all navigation pages',()=>{
  assert.deepEqual(Object.keys(DRAGON_PAGE_SUPPORT).sort(),developmentPages.map(page=>page.id).sort());
  for(const id of Object.keys(TAB_TITLES))assert.ok(Object.hasOwn(DRAGON_PAGE_SUPPORT,id),id);
  for(const [id,support] of Object.entries(DRAGON_PAGE_SUPPORT)){
    if(support.status==='disabled')assert.ok(support.reason.trim(),id);
    else {assert.equal(support.characterId,id);assert.equal(support.contentId,id);assert.equal(support.anchorContractVersion,1);assert.ok(support.guideIds.length,id);}
  }
  assert.equal(pageGuideSupport('private-ai')?.status,'disabled');
  for(const id of ['unknown','constructor','__proto__'])assert.equal(pageGuideSupport(id),null);
});
test('profile, access and explicit page gates run before any release, character or pack loading',()=>{
  for(const profile of ['light','dark','versefolk','unknown'])assert.equal(canRequestGuide(profile,'home',true,'member-1'),false);
  for(const page of ['unknown','__proto__','private-ai','messages','registration','onboarding','admin','skillbooks'])assert.equal(canRequestGuide('guide-dragon',page,true,'member-1'),false);
  assert.equal(canRequestGuide('guide-dragon','home',false,'member-1'),false);assert.equal(canRequestGuide('guide-dragon','home',true,''),false);
  assert.equal(canRequestGuide('guide-dragon','home',true,'member-1'),true);
  for(const value of [undefined,null,{},false,{...enabled,enabled:false},{...enabled,version:'old'},{...enabled,manifestSha256:'0'.repeat(64)},{...enabled,pack:'foreign'}])assert.equal(acceptsGuideRelease(value),false);
  assert.equal(acceptsGuideRelease(enabled),true);
});
test('all supported refs resolve to reviewed content and exact public digest assets; unknown runtime pages reject',async()=>{
  const allowed=new Set(manifest.assets.map(asset=>`/public/guide-packs/${manifest.pack}/${manifest.version}/${asset.sha256}.webp`));
  for(const [id,status] of Object.entries(DRAGON_PAGE_SUPPORT)){
    if(status.status!=='supported'){await assert.rejects(DRAGON_PACK.loadPage(id));continue;}
    const page=await DRAGON_PACK.loadPage(id),content=await page.loadContent();
    assert.equal(content.id,id);assert.equal(page.character.pageId,id);assert.equal(content.characterName,page.character.name);
    assert.deepEqual(Object.keys(page.guides).sort(),[...status.guideIds].sort());
    for(const guideId of status.guideIds)assert.ok(content.topics.some(topic=>topic.id===guideId),guideId);
    for(const asset of [page.character.portrait,page.character.hero,...page.character.frames,...page.character.views])assert.ok(allowed.has(asset),asset);
  }
  for(const id of ['unknown','constructor','__proto__'])await assert.rejects(DRAGON_PACK.loadPage(id));
});
test('frontend release pin binds exact manifest bytes and source author commit',()=>{
  const bytes=readFileSync(new URL('../../contracts/guide-packs/dragon-v1-20261004.json',import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),DRAGON_RELEASE_PIN.manifestSha256);
  assert.equal(manifest.source.repository,'https://github.com/mars-tw/freedom-platform');assert.equal(manifest.source.commit,'46a40342509a9278c3a7b8a940bce27b7f464227');
  assert.equal(manifest.assets.length,364);assert.equal(manifest.assets.reduce((total,asset)=>total+asset.byteLength,0),41016186);
});


test('retired message page rejects both packs before loading guide content',async()=>{
  const support=pageGuideSupport('messages');
  assert.equal(support?.status,'disabled');
  if(support?.status==='disabled')assert.match(support.reason,/常駐聊天室/);
  for(const profile of ['guide-dragon','guide-ai-sister'])assert.equal(canRequestGuide(profile,'messages',true,'member-1'),false);
  await assert.rejects(DRAGON_PACK.loadPage('messages'),/Unsupported guide page/);
  await assert.rejects(AI_SISTER_PACK.loadPage('messages'),/Unsupported guide page/);
});

// Run the actual helper bodies with controlled locators, without a database or
// browser. The old code fails when natural completion removes the skip button
// between isVisible() and click(); no wall-clock delay is needed to reproduce it.
for(const [file,name] of [['newcomer-guides.spec.ts','finishLine'],['ai-sister-guides.spec.ts','openGuide']]){
  const source=readFileSync(new URL(`../e2e/${file}`,import.meta.url),'utf8');
  const match=source.match(new RegExp(`async function ${name}\\(page: ?Page\\) ?\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match,`${name} helper must be present`);
  const run=new Function('page','panel','expect','widget',`return (async()=>{${match[1]}})();`);
  const widget=()=>({getByRole:()=>({click:async()=>{}})});
  test(`${name} accepts natural completion without clicking a disappearing skip button`,async()=>{
    let typing=true,clicked=false,checked=false;
    const line={};
    const panel=()=>({
      getByRole:()=>({isVisible:async()=>{typing=false;return true;},click:async()=>{clicked=true;throw new Error('skip button disappeared');}}),
      locator:(selector:string)=>{assert.equal(selector,'.page-spirit-line');return line;}
    });
    await run({},panel,(target:unknown)=>({toHaveAttribute:async(attribute:string,value:string,options?:{timeout:number})=>{
      if(attribute==='data-load-state'){assert.equal(value,'ready');return;}
      assert.equal(target,line);assert.equal(attribute,'data-typing');assert.equal(value,'false');assert.equal(options?.timeout,4000);
      // Model natural completion during Playwright's retrying assertion.
      typing=false;assert.equal(typing,false);checked=true;
    }}),widget);
    assert.equal(clicked,false);assert.equal(checked,true);
  });
  test(`${name} does not suppress incomplete or missing-line assertion failures`,async()=>{
    for(const failure of [new Error('still typing'),new Error('line missing')]){
      await assert.rejects(run({},()=>({getByRole:()=>({isVisible:async()=>false}),locator:()=>({})}),()=>({toHaveAttribute:async(attribute:string)=>{if(attribute==='data-typing')throw failure;}}),widget),error=>error===failure);
    }
  });
}

/** Actual Engine TSX with synthetic hooks/DOM: not React scheduling or native focus proof. */
async function withHelperEngine(check:(s:any)=>void|Promise<void>){
  const {transformSync}=await import('esbuild');
  const source=readFileSync('apps/portal-web/src/modules/newcomer-guides/engine/GuideEngine.tsx','utf8');
  const slots:any[]=[];let cursor=0,effects:(()=>any)[]=[],layouts:(()=>any)[]=[],nodes:any[]=[];
  const hooks={useCallback:(f:any)=>f,useId:()=> 'engine',useRef:(v:any)=>{const i=cursor++;return slots[i]??(slots[i]={current:v});},useState:(v:any)=>{const i=cursor++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return [slots[i],(next:any)=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},useEffect:(f:any)=>effects.push(f),useLayoutEffect:(f:any)=>layouts.push(f)};
  const jsx=(type:any,props:any)=>({type,props});const module={exports:{} as any};
  new Function('module','exports','require',transformSync(source,{loader:'tsx',format:'cjs',jsx:'automatic'}).code)(module,module.exports,(id:string)=>{
    if(id==='react')return hooks;if(id==='react/jsx-runtime')return {jsx,jsxs:jsx};if(id.endsWith('page-spirit.css'))return {};
    if(id==='./preferences')return {readSpiritPreferences:()=>({energy:true,instantText:true}),writeSpiritPreferences:()=>{}};
    if(id==='./core')return {createPageSession:()=>({clear(){}})};if(id==='./guides')return {};if(id==='./GuideGallery')return {};throw Error(id);
  });
  let focuses=0,foreign=false,allow=true,opens=0,closed:((reason:string)=>void)|undefined;
  const body={};const origin:any={isConnected:true,disabled:false,matches:()=>false,closest:()=>null,getBoundingClientRect:()=>({width:10,height:10}),focus(){focuses++;doc.activeElement=origin;},scrollIntoView(){},scrollTo(){}};
  const wrapper={contains:(node:any)=>node===origin};
  const doc:any={hidden:false,body,activeElement:body,querySelectorAll:()=>foreign?[origin]:[],getElementById:()=>null};
  origin.ownerDocument=doc;
  const props:any={pageId:'home',scopeKey:'scope-a',page:{character:{name:'測試角色',title:'首頁',hero:'/synthetic.webp',frames:[],pageId:'home'},guides:{},loadContent:async()=>({id:'home',entryLine:'本頁說明',topics:[]})},label:'導覽',gallery:[],galleryInfo:{title:'畫廊'},helperAction:{dialogId:'same-dialog',open:false,requestOpen:(_origin:any,onClose:any)=>{opens++;if(allow)closed=onClose;return allow;}}};
  const flatten=(node:any):any[]=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(flatten)];
  function render(){cursor=0;effects=[];layouts=[];nodes=flatten(module.exports.GuideEngine(props));for(const n of nodes)if(n.props.ref)n.props.ref.current=n.type==='div'?wrapper:origin;}
  const globals={document:doc,getComputedStyle:()=>({display:'block',visibility:'visible'}),requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{},HTMLElement:class{},Element:class{}};
  const previous=Object.fromEntries(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  for(const [k,v] of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true});
  try{render();const mount=effects.find(f=>String(f).includes('mounted.current = true'));assert.ok(mount);const cleanup=mount();render();
    const button=()=>nodes.find(n=>n.type==='button'&&n.props['aria-label']==='問路助手');
    await check({props,origin,doc,render,button,focuses:()=>focuses,opens:()=>opens,allow:(v:boolean)=>allow=v,foreign:(v:boolean)=>foreign=v,
      mode:()=>nodes.find(n=>n.props?.['data-mode'])?.props['data-mode'],
      begin(){nodes.find(n=>n.type==='button'&&n.props.children==='問本頁').props.onClick({currentTarget:origin});render();},
      input(value:string){nodes.find(n=>n.type==='input').props.onChange({target:{value}});nodes.find(n=>n.type==='input').props.onCompositionStart();render();},
      value:()=>nodes.find(n=>n.type==='input')?.props.value,
      click(){assert.ok(button(),'verified-ready Engine has a helper shortcut');button().props.onClick({currentTarget:origin});render();},
      close(reason:string){assert.ok(closed);closed!(reason);render();},flush(){for(const f of layouts)f();},cleanup});
    cleanup();
  }finally{for(const [k,v] of Object.entries(previous))if(v)Object.defineProperty(globalThis,k,v);else Reflect.deleteProperty(globalThis,k);}
}
test('actual character helper shortcut uses the shared dialog and restores only manual same-scope dismissal',async()=>{
  await withHelperEngine(s=>{
    assert.ok(s.button(),'shared helper action exists');assert.equal(s.button().props.children,'問路');assert.equal(s.button().props['aria-controls'],'same-dialog');
    s.click();assert.equal(s.opens(),1);s.close('dismiss');s.flush();assert.equal(s.focuses(),1);
    s.click();s.close('native');s.flush();assert.equal(s.focuses(),1);
    s.click();s.close('teardown');s.flush();assert.equal(s.focuses(),1);
    s.props.helperAction={...s.props.helperAction,open:true};s.render();assert.equal(s.button().props['aria-expanded'],true);
  });
});
test('actual character helper callback cancels focus for foreign modal, account/route/theme scope and failed opening',async()=>{
  await withHelperEngine(s=>{
    s.allow(false);s.click();s.flush();assert.equal(s.focuses(),0);
    s.allow(true);s.click();s.foreign(true);s.close('dismiss');s.flush();assert.equal(s.focuses(),0);s.foreign(false);
    s.click();s.props.scopeKey='scope-after-account-route-or-theme';s.render();s.close('dismiss');s.flush();assert.equal(s.focuses(),0);
    s.props.helperAction=undefined;s.render();assert.equal(s.button(),undefined);
  });
});

test('actual helper return layout effect waits for committed suppression and yields to newer focus or modal',async()=>{
  const {transformSync}=await import('esbuild');const {runInNewContext}=await import('node:vm');
  const source=readFileSync('apps/portal-web/src/modules/newcomer-guides/engine/GuideEngine.tsx','utf8');
  const effect=source.match(/  useLayoutEffect\(\(\)=>\{\n    const pending=helperReturn.current[\s\S]*?\n  \},\[helperReturnRevision,hardSuppressed,suppressed,disabled,identity,helperAction\?\.open\]\)/)?.[0];assert.ok(effect);
  for(const scenario of ['manual','hard-suppressed','soft-suppressed','new-modal','new-focus','new-route','disabled','detached','reopened','unmounted'] as const){
    let focuses=0;const origin={isConnected:scenario!=='detached',matches:()=>false,closest:()=>null,focus:()=>focuses++};const body={};
    const context:any={helperReturn:{current:{identity:'same',origin,dialogId:'helper'}},helperReturnRevision:1,mounted:{current:scenario!=='unmounted'},identity:scenario==='new-route'?'other':'same',disabled:scenario==='disabled',helperAction:{open:scenario==='reopened'},hardSuppressed:scenario==='hard-suppressed',suppressed:scenario==='soft-suppressed',active:{current:{suppressed:scenario==='soft-suppressed'}},wrapper:{current:{}},blockingSurface:()=>scenario==='new-modal',visible:()=>true,HTMLDialogElement:class{},document:{hidden:false,body,activeElement:scenario==='new-focus'?{}:body,getElementById:()=>null},useLayoutEffect:(f:any)=>f()};
    const code=transformSync(effect,{loader:'ts',format:'cjs'}).code;runInNewContext(code,context);
    assert.equal(focuses,scenario==='manual'?1:0,scenario);
    if(scenario==='hard-suppressed'||scenario==='soft-suppressed'){
      assert.ok(context.helperReturn.current,'waits without focusing disabled trigger');context.hardSuppressed=false;context.suppressed=false;context.active.current.suppressed=false;runInNewContext(code,context);assert.equal(focuses,1);assert.equal(context.helperReturn.current,null);
    }else assert.equal(context.helperReturn.current,null,'completed or cancelled, never retried');
  }
});
test('failed character helper opening preserves original page explanation and composing draft',async()=>{
  await withHelperEngine(async s=>{
    s.begin();await Promise.resolve();s.render();assert.equal(s.mode(),'expanded');s.input('尚在組字');
    s.allow(false);s.click();assert.equal(s.mode(),'expanded');assert.equal(s.value(),'尚在組字');
    s.allow(true);s.click();assert.equal(s.mode(),'closed');
  });
});
test('explicit helper shortcut after business-input focus rechecks live blockers rather than stale soft suppression',async()=>{
  const {transformSync}=await import('esbuild');const {runInNewContext}=await import('node:vm');
  const source=readFileSync('apps/portal-web/src/modules/newcomer-guides/engine/GuideEngine.tsx','utf8');
  const handler=source.match(/  const requestHelper = \(origin:HTMLElement\) => \{[\s\S]*?\n    if\(opened\)close\(false\)\n  \}/)?.[0];assert.ok(handler);
  let calls=0,closes=0;const context:any={helperAction:{dialogId:'one',requestOpen(){calls++;return true;}},mounted:{current:true},active:{current:{identity:'scope',disabled:false,suppressed:true}},document:{hidden:false},blockingSurface:()=>false,wrapper:{current:{}},helperReturn:{current:null},setHelperReturnRevision:()=>{},close:()=>closes++};
  runInNewContext(transformSync(`${handler};requestHelper({})`,{loader:'ts',format:'cjs'}).code,context);assert.equal(calls,1);assert.equal(closes,1);
  context.blockingSurface=()=>true;runInNewContext(transformSync(`${handler};requestHelper({})`,{loader:'ts',format:'cjs'}).code,{...context});assert.equal(calls,1);
});

test('actual modal observer and return layout agree about closed own-helper input without exempting newer focus',async()=>{
  const {transformSync}=await import('esbuild');const {runInNewContext}=await import('node:vm');
  const source=readFileSync('apps/portal-web/src/modules/newcomer-guides/engine/GuideEngine.tsx','utf8');
  const request=source.match(/  const requestHelper = \(origin:HTMLElement\) => \{[\s\S]*?\n    if\(opened\)close\(false\)\n  \}/)?.[0];
  const layout=source.match(/  useLayoutEffect\(\(\)=>\{\n    const pending=helperReturn.current[\s\S]*?\n  \},\[helperReturnRevision,hardSuppressed,suppressed,disabled,identity,helperAction\?\.open\]\)/)?.[0];
  const observer=source.match(/  useEffect\(\(\) => \{\n    let layoutRequest = 0[\s\S]*?\n  \}, \[close, unavailableGuideTarget\]\)/)?.[0];assert.ok(request&&layout&&observer);
  const compile=(text:string)=>transformSync(text,{loader:'ts',format:'cjs'}).code;
  for(const kind of ['body','closed-input','foreign-modal','new-focus','new-input','wrong-dialog','stale-scope']){
    class Element{closest(){return null;}matches(){return false;}contains(node:unknown){return this===node;}querySelector(){return null;}}
    class HTMLElement extends Element{isConnected=true;focus(){};}
    class HTMLDialogElement extends HTMLElement{open=false;contains(node:unknown){return node===input;}}
    const body=new HTMLElement(),origin=new HTMLElement(),input=new HTMLElement(),other=new HTMLElement(),foreign=new HTMLElement(),dialog=new HTMLDialogElement(),own=new HTMLElement();
    let focuses=0,foreignOpen=false,closeCallback:(reason:string)=>void=()=>{throw Error('not opened');};const listeners:Record<string,any>={},frames:(()=>void)[]=[];
    own.contains=node=>node===origin;origin.focus=()=>{focuses++;doc.activeElement=origin;};
    const doc:any={body,hidden:false,activeElement:body,getElementById:(id:string)=>id==='shared-helper'?dialog:null,querySelectorAll:(selector:string)=>selector.includes('dialog')?[...(dialog.open?[dialog]:[]),...(foreignOpen?[foreign]:[])]:[],addEventListener:(key:string,callback:any)=>listeners[key]=callback,removeEventListener(){}};
    const ctx:any={MODAL_SELECTOR:'dialog[open],[aria-modal=true],[role=dialog]',ENVIRONMENT_SELECTOR:'dialog[open],.game-console,.floating-message-panel',Element,HTMLElement,HTMLDialogElement,document:doc,window:{addEventListener(){},removeEventListener(){}},MutationObserver:class{observe(){}disconnect(){}},requestAnimationFrame:(f:()=>void)=>(frames.push(f),frames.length),cancelAnimationFrame(){},useEffect:(f:()=>void)=>{ctx.cleanup=f();},useLayoutEffect:(f:()=>void)=>f(),
      helperAction:{dialogId:'shared-helper',open:false,requestOpen:(_origin:any,callback:any)=>(closeCallback=callback,true)},helperReturn:{current:null},helperReturnRevision:0,mounted:{current:true},active:{current:{identity:'same',disabled:false,suppressed:false,mode:'closed'}},identity:'same',disabled:false,suppressed:false,hardSuppressed:false,wrapper:{current:own},guideIdentity:{current:''},guideTarget:{current:null},guideState:{current:null},visible:()=>true,editing:(node:any)=>node===input||(kind==='new-input'&&node===other),blockingSurface:()=>dialog.open||foreignOpen,setHelperReturnRevision:(f:any)=>ctx.helperReturnRevision=f(ctx.helperReturnRevision),setSuppressed:(f:any)=>ctx.suppressed=f(ctx.suppressed),setHardSuppressed:(f:any)=>ctx.hardSuppressed=f(ctx.hardSuppressed),close(){},unavailableGuideTarget(){}};
    runInNewContext(compile(request+';globalThis.request=requestHelper'),ctx);ctx.request(origin);
    dialog.open=true;doc.activeElement=input;runInNewContext(compile(observer),ctx);assert.equal(ctx.hardSuppressed,true);
    dialog.open=false;doc.activeElement=kind==='closed-input'?input:body;closeCallback('dismiss');assert.ok(ctx.helperReturn.current);
    runInNewContext(compile(layout),ctx);assert.equal(focuses,0);assert.ok(ctx.helperReturn.current,'waits while the control is suppressed');
    if(kind==='wrong-dialog'){ctx.helperReturn.current.dialogId='other-dialog';doc.activeElement=input;}
    if(kind==='stale-scope'){ctx.helperReturn.current.identity='old-scope';doc.activeElement=input;}
    if(kind==='foreign-modal')foreignOpen=true;
    if(kind==='new-focus'||kind==='new-input'){doc.activeElement=other;listeners.focusin({target:other});}else listeners.focusout({target:input});
    while(frames.length)frames.shift()!();runInNewContext(compile(layout),ctx);
    assert.equal(focuses,kind==='body'||kind==='closed-input'?1:0,kind);assert.equal(ctx.helperReturn.current,null);ctx.cleanup();
  }
});
