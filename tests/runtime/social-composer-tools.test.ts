import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';
import * as textHistory from '../../apps/portal-web/src/modules/text-edit-history';

// Execute the complete production component, including its effects and handlers.
// This is a source-bound hook/element-tree fixture, not ReactDOM, browser focus,
// computed visibility, layout, optional-module internals, or real-API evidence.
const source=readFileSync(new URL('../../apps/portal-web/src/modules/SocialZone.tsx',import.meta.url),'utf8');
const compiled=transformSync(source,{loader:'tsx',format:'cjs',jsx:'automatic',supported:{'dynamic-import':false}}).code;
type Element={type:any;props:Record<string,any>;key?:unknown};
type Entry={node:Element;path:string;ancestors:Element[]};
function entries(tree:unknown,path='root',ancestors:Element[]=[]):Entry[]{
  if(Array.isArray(tree))return tree.flatMap((child,index)=>entries(child,`${path}.${index}`,ancestors));
  if(!tree||typeof tree!=='object'||!('props' in tree))return [];
  const node=tree as Element;
  return [{node,path,ancestors},...entries(node.props.children,`${path}.children`,[...ancestors,node])];
}
function find(tree:unknown,predicate:(node:Element)=>boolean):Element|undefined{return entries(tree).find(({node})=>predicate(node))?.node;}
function required(tree:unknown,predicate:(node:Element)=>boolean):Element{const node=find(tree,predicate);assert.ok(node,'expected production element');return node;}
function button(tree:unknown,label:string):Element|undefined{return find(tree,node=>node.type==='button'&&(node.props['aria-label']??node.props.children)===label);}
const tools=(tree:unknown)=>required(tree,node=>node.type==='fieldset'&&node.props.className==='social-composer-optional-tools stack');
const disclosure=(tree:unknown)=>required(tree,node=>node.type==='button'&&node.props['aria-controls']===tools(tree).props.id);
const textarea=(tree:unknown)=>required(tree,node=>node.type==='textarea');

function harness(){
  const hooks:any[]=[],effects:(()=>void)[]=[],requests:{method:string;path:string}[]=[],sideEffects:string[]=[],lazyImports:string[]=[];
  const hosts=new Map<string,any>(),lazyOwners=new Map<string,{type:any;identity:object}>();
  let index=0,dirty=false,language='zh-Hant',tree:Element,activeElement:any=null,focusCalls=0,lazyInitializations=0;
  const client={sessionGeneration:1,csrfToken:'synthetic',get:(path:string)=>{requests.push({method:'GET',path});return new Promise(()=>{});},
    post:(path:string)=>{requests.push({method:'POST',path});return new Promise(()=>{});}};
  const idle={phase:'idle'},job={subscribe:()=>()=>{},snapshot:()=>idle,adopt:()=>sideEffects.push('job.adopt'),start:()=>sideEffects.push('job.start')};
  const changed=(before:unknown[]|undefined,after:unknown[]|undefined)=>!before||!after||before.length!==after.length||after.some((value,i)=>!Object.is(value,before[i]));
  const effect=(fn:()=>unknown,deps?:unknown[])=>{
    const i=index++,previous=hooks[i];
    if(changed(previous?.deps,deps)){hooks[i]={deps};effects.push(()=>{previous?.cleanup?.();hooks[i].cleanup=fn();});}
  };
  const react={
    Component:class{},Fragment:Symbol('Fragment'),Suspense:Symbol('Suspense'),
    useRef:(value:unknown)=>{const i=index++;return hooks[i]??(hooks[i]={current:value});},
    useState:(initial:any)=>{const i=index++;if(!(i in hooks))hooks[i]=typeof initial==='function'?initial():initial;return [hooks[i],(next:any)=>{const value=typeof next==='function'?next(hooks[i]):next;if(!Object.is(value,hooks[i])){hooks[i]=value;dirty=true;}}];},
    useId:()=>{const i=index++;return hooks[i]??(hooks[i]=`composer-${i}`);},
    useCallback:(fn:unknown,deps:unknown[])=>{const i=index++;if(changed(hooks[i]?.deps,deps))hooks[i]={deps,value:fn};return hooks[i].value;},
    useEffect:effect,
    // The task store is fixed idle; external subscriptions and optional children
    // are outside this fixture. All SocialZone useEffect callbacks still execute.
    useSyncExternalStore:(_subscribe:unknown,snapshot:()=>unknown)=>{index++;return snapshot();},
    lazy:(load:()=>Promise<unknown>)=>({lazy:true,load,promise:null as Promise<unknown>|null}),
  };
  const location={hash:'#social',search:'',href:'https://example.test/#social',origin:'https://example.test'};
  const document={querySelector:()=>null,getElementById:()=>null};
  const window={location,addEventListener(){},removeEventListener(){},history:{replaceState:()=>sideEffects.push('history.replaceState')},open:()=>sideEffects.push('window.open')};
  const storage={getItem:()=>null,setItem:()=>sideEffects.push('storage.setItem'),removeItem:()=>sideEffects.push('storage.removeItem')};
  const jsx=(type:any,props:Record<string,any>,key?:unknown)=>({type,props,key}),module={exports:{} as any};
  const childModules:Record<string,string[]>={
    './SocialPostBookmark':['SocialPostOptions'],'./SocialTools':['SocialIcon','SocialTextTools','SocialRichText'],
    './MemberAvatar':['MemberAvatar'],'./PromotionShare':['PromotionShare'],'./SocialInteractions':['SocialInteractions'],
    './SocialPostEditor':['SocialPostEditor'],'./ShortVideoFeed':['ShortVideoFeed'],'./InlineVideo':['InlineVideo'],'./SocialPostShare':['SocialPostShare'],
  };
  const children=Object.fromEntries(Object.entries(childModules).map(([path,names])=>[path,Object.fromEntries(names.map(name=>[name,()=>null]))]));
  const routeModule={exports:{} as any};
  runInNewContext(transformSync(readFileSync(new URL('../../apps/portal-web/src/portal-route.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code,{module:routeModule,exports:routeModule.exports,window,URLSearchParams});
  runInNewContext(compiled,{module,exports:module.exports,URL,URLSearchParams,location,document,window,sessionStorage:storage,localStorage:storage,require:(name:string)=>{
    if(name==='../portal-route')return routeModule.exports;
    if(name==='react')return react;
    if(name==='react/jsx-runtime')return {jsx,jsxs:jsx,Fragment:react.Fragment};
    if(name==='./text-edit-history')return textHistory;
    if(name==='../language')return {useLanguage:()=>({language})};
    if(name==='../social-post-task')return {socialPostJobForSession:()=>job};
    if(name==='../games/GameDraftInbox')return {GameDraftNotice:()=>null,useGameDraftInbox:()=>({draft:null})};
    if(name==='../games/result-bridge')return {clearGameDraft:()=>sideEffects.push('clearGameDraft'),gameDraftFile:()=>{throw Error('unexpected game import');}};
    if(name==='../access-fetch')return {accessAwareFetch:()=>{sideEffects.push('accessAwareFetch');return new Promise(()=>{});}};
    if(name==='../api')return {ApiError:class extends Error{}};
    if(name==='../format')return {formatIsoLocal:(value:string)=>value};
    if(name==='../../../../packages/shared/share-url')return {PLATFORM_LABELS:{}};
    if(name==='./short-video-embed')return {youtubeLinkHint:()=>null};
    if(name==='./social-image')return {prepareSocialImage:()=>{sideEffects.push('prepareSocialImage');return new Promise(()=>{});}};
    if(name==='../share-module-loader')return {shareModuleRetryUrl:()=>null};
    if(name==='./SocialPostOptimizer'||name==='./SocialCrossPlatformShare'){
      lazyImports.push(name);return name==='./SocialPostOptimizer'?{SocialPostOptimizer:()=>null}:{SocialCrossPlatformShare:()=>null};
    }
    if(name==='./SocialZone.css'||name==='./SocialPostOptimizer.css')return {};
    if(name==='./SocialTools')return {...children[name],SOCIAL_TOPICS:{mood:'近況心情',event:'社群活動',work:'作品分享'}};
    if(children[name])return children[name];
    throw Error(`Unexpected dependency: ${name}`);
  }});
  function commit(next:Element){
    const rendered=entries(next),present=new Set<string>();
    for(const {node,path} of rendered){
      if(typeof node.type==='string'){
        let host=hosts.get(path);
        if(!host||host.type!==node.type){host={type:node.type,open:false,style:{setProperty(){}},focus(options?:unknown){activeElement=host;host.lastFocusOptions=options;focusCalls++;},showModal(){host.open=true;},close(){host.open=false;}};hosts.set(path,host);}
        host.querySelector=()=>{const target=entries(tree).find(({node})=>node.type==='textarea');return target&&hosts.get(target.path);};
        host.value=node.props.value;
        if(node.props.ref)node.props.ref.current=host;
      }
      if(node.type?.lazy){
        // Model presence by the actual production position, type and key. This
        // detects conditional removal; it does not claim React mount evidence.
        const ownerPath=`${path}:${String(node.key)}`;present.add(ownerPath);
        if(lazyOwners.get(ownerPath)?.type!==node.type)lazyOwners.set(ownerPath,{type:node.type,identity:{}});
        if(!node.type.promise){lazyInitializations++;node.type.promise=node.type.load();}
      }
    }
    for(const path of lazyOwners.keys())if(!present.has(path))lazyOwners.delete(path);
  }
  function view():Element{
    let passes=0;
    do{assert.ok(passes++<20,'hook fixture must settle');dirty=false;index=0;tree=module.exports.SocialZone({client});commit(tree);while(effects.length)effects.shift()!();}while(dirty);
    return tree;
  }
  function click(node:Element){assert.notEqual(node.props.disabled,true,'cannot invoke disabled control');node.props.onClick();return view();}
  function open(){return click(required(view(),node=>node.type==='button'&&node.props.className==='social-write-trigger'));}
  function type(value:string){textarea(view()).props.onChange({target:{value},nativeEvent:{inputType:'insertText'}});return view();}
  return {client,requests,sideEffects,lazyImports,view,click,open,type,job,
    setLanguage(value:string){language=value;return view();},
    toggle(){return click(disclosure(view()));},
    lazyEntries(){return [...lazyOwners.entries()];},
    get activeElement(){return activeElement;},get focusCalls(){return focusCalls;},get lazyInitializations(){return lazyInitializations;},
  };
}
const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('composer tools default closed; disclosure alone neither imports optional modules nor performs work',async()=>{
  const h=harness();let tree=h.open();
  assert.equal(disclosure(tree).props['aria-expanded'],false);assert.equal(tools(tree).props.hidden,true);assert.equal(tools(tree).props.disabled,true);
  assert.equal(tools(tree).props['aria-label'],'文案與分享');
  assert.equal(disclosure(tree).props.children[0],'文案與分享');
  assert.equal(button(tree,'復原上一步'),undefined);assert.equal(button(tree,'重做'),undefined);
  assert.equal(h.lazyEntries().length,0);assert.equal(h.lazyInitializations,0);
  const initialRequests=[...h.requests];assert.deepEqual(initialRequests,[{method:'GET',path:'/social-posts?kind=note'}]);
  for(const expanded of [true,false,true,false]){tree=h.toggle();assert.equal(disclosure(tree).props['aria-expanded'],expanded);assert.equal(tools(tree).props.hidden,!expanded);assert.equal(tools(tree).props.disabled,!expanded);}
  await settle();assert.equal(h.lazyInitializations,0);assert.deepEqual(h.lazyImports,[]);
  assert.deepEqual(h.requests,initialRequests);assert.deepEqual(h.sideEffects,[]);
  assert.equal(textarea(tree).props.value,'');assert.equal(button(tree,'復原上一步'),undefined);
});

test('enabled optional panels retain their production tree positions and types while collapsed',async()=>{
  const h=harness();h.open();h.type('我的原稿');h.toggle();
  h.click(required(h.view(),node=>node.type==='button'&&node.props.children==='✦ Social Post 優化'));
  h.click(required(h.view(),node=>node.type==='button'&&node.props.children==='↗ Social Post 分享'));
  await settle();assert.deepEqual(h.lazyImports,['./SocialPostOptimizer','./SocialCrossPlatformShare']);assert.equal(h.lazyInitializations,2);
  const owners=h.lazyEntries();assert.equal(owners.length,2);
  for(const expanded of [false,true,false]){
    const tree=h.toggle();assert.equal(tools(tree).props.hidden,!expanded);assert.equal(tools(tree).props.disabled,!expanded);
    const current=h.lazyEntries();assert.equal(current.length,2);
    current.forEach(([path,owner],i)=>{assert.equal(path,owners[i][0]);assert.equal(owner.type,owners[i][1].type);assert.equal(owner.identity,owners[i][1].identity);});
    const optional=entries(tools(tree)).filter(({node})=>node.type?.lazy);
    assert.equal(optional.length,2);assert.equal(optional[0].node.props.job,h.job);
    for(const {node} of optional)assert.equal(node.props.draft,'我的原稿');
  }
  await settle();assert.equal(h.lazyInitializations,2);assert.equal(h.lazyImports.length,2);
  assert.deepEqual(h.sideEffects,[]);assert.equal(h.requests.filter(request=>request.method!=='GET').length,0);
});

test('typing exposes Undo and Redo outside collapsed tools and handlers return focus to the textarea',()=>{
  const h=harness();h.open();let tree=h.type('保留輸入');
  assert.equal(tools(tree).props.hidden,true);
  const undo=button(tree,'復原上一步')!,redo=button(tree,'重做')!;assert.ok(undo);assert.ok(redo);
  assert.equal(undo.props.disabled,false);assert.equal(redo.props.disabled,true);
  for(const control of [undo,redo])assert.equal(entries(tree).find(({node})=>node===control)!.ancestors.some(node=>node.props.hidden||node.props.disabled),false);
  const focused=h.activeElement,focusCount=h.focusCalls;
  tree=h.click(undo);assert.equal(textarea(tree).props.value,'');assert.equal(button(tree,'復原上一步')!.props.disabled,true);assert.equal(button(tree,'重做')!.props.disabled,false);
  assert.equal(h.activeElement,focused);assert.equal(h.focusCalls,focusCount+1);assert.equal(h.activeElement.lastFocusOptions.preventScroll,true);
  tree=h.click(button(tree,'重做')!);assert.equal(textarea(tree).props.value,'保留輸入');assert.equal(h.activeElement,focused);assert.equal(h.focusCalls,focusCount+2);
  let prevented=0;
  textarea(tree).props.onKeyDown({key:'z',ctrlKey:true,metaKey:false,altKey:false,shiftKey:false,nativeEvent:{isComposing:false},preventDefault(){prevented++;}});
  tree=h.view();assert.equal(textarea(tree).props.value,'');assert.equal(prevented,1);assert.equal(tools(tree).props.hidden,true);
  tree=h.type('新的文字');assert.equal(button(tree,'重做')!.props.disabled,true);assert.deepEqual(h.sideEffects,[]);
});

test('language changes preserve disclosure, draft and optional identities; a replacement session resets tools closed',async()=>{
  const h=harness();h.open();h.type('不翻譯我的草稿');h.toggle();
  h.click(required(h.view(),node=>node.type==='button'&&node.props.children==='✦ Social Post 優化'));
  h.click(required(h.view(),node=>node.type==='button'&&node.props.children==='↗ Social Post 分享'));
  await settle();const owners=h.lazyEntries(),requests=h.requests.length;
  for(const [language,label] of [['en','Writing and sharing'],['ja','文章と共有'],['ko','글쓰기 및 공유'],['es','Redacción y compartir'],['zh-Hant','文案與分享']]){
    const tree=h.setLanguage(language);assert.equal(disclosure(tree).props.children[0],label);assert.equal(disclosure(tree).props['aria-expanded'],true);assert.equal(tools(tree).props['aria-label'],label);
    assert.equal(textarea(tree).props.value,'不翻譯我的草稿');h.lazyEntries().forEach(([,owner],i)=>assert.equal(owner.identity,owners[i][1].identity));
  }
  h.toggle();let tree=h.setLanguage('en');assert.equal(disclosure(tree).props['aria-expanded'],false);assert.equal(tools(tree).props.hidden,true);
  assert.ok(button(tree,'Undo'));assert.equal(h.requests.length,requests);assert.deepEqual(h.sideEffects,[]);
  h.toggle();h.client.sessionGeneration++;tree=h.view();
  assert.equal(disclosure(tree).props['aria-expanded'],false);assert.equal(tools(tree).props.hidden,true);assert.equal(tools(tree).props.disabled,true);
  assert.equal(textarea(tree).props.value,'');assert.equal(button(tree,'Undo'),undefined);assert.equal(button(tree,'Redo'),undefined);
  assert.equal(h.requests.length,requests+1,'session change may reload the feed, unlike disclosure or language changes');
  assert.deepEqual(h.sideEffects,[]);assert.equal(h.requests.filter(request=>request.method!=='GET').length,0);
});
