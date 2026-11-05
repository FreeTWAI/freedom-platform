import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import ts from '@typescript/typescript6';

const entry=await readFile(new URL('../../apps/portal-web/src/skill-social.tsx',import.meta.url),'utf8');
const widget=await readFile(new URL('../../apps/portal-web/src/skill-social-widget.tsx',import.meta.url),'utf8');
const compile=(source:string)=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
async function flush(){for(let n=0;n<30;n++)await Promise.resolve();}
class Node extends EventTarget {
  isConnected=true;
  dataset={skillSocial:'social-post',repository:'https://github.com/example/book'};
  child={};
  contains(value:unknown){return value===this||value===this.child;}
}
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function loader(options:{nodes?:number;observer?:boolean;importer?:()=>unknown;renderer?:(node:Node,signal:AbortSignal)=>Promise<boolean>}={}){
  const nodes=Array.from({length:options.nodes??1},()=>new Node());
  const document=Object.assign(new EventTarget(),{visibilityState:'visible',activeElement:null as unknown,querySelectorAll:()=>nodes});
  const window=new EventTarget();let notify!:(entries:{target:Node;isIntersecting:boolean}[])=>void;
  const observed:Node[]=[],unobserved:Node[]=[],renders:{node:Node;signal:AbortSignal}[]=[];let imports=0,observerOptions:unknown;
  class Observer{constructor(callback:typeof notify,settings:unknown){notify=callback;observerOptions=settings;}observe(node:Node){observed.push(node);}unobserve(node:Node){unobserved.push(node);}}
  runInNewContext(compile(entry),{document,window,AbortController,queueMicrotask,IntersectionObserver:options.observer===false?undefined:Observer,
    require(path:string){assert.equal(path,'./skill-social-widget');imports++;if(options.importer)return options.importer();return {enhanceSkillSocial:async(node:Node,signal:AbortSignal)=>{renders.push({node,signal});return options.renderer?options.renderer(node,signal):true;}};}});
  return {nodes,document,window,observed,unobserved,renders,get imports(){return imports;},get observerOptions(){return observerOptions;},intersect(near=true,node=nodes[0]){notify([{target:node,isIntersecting:near}]);}};
}
test('public entry has no static runtime imports or JSX before the visibility boundary',()=>{
  const ast=ts.createSourceFile('skill-social.tsx',entry,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  assert.equal(ast.statements.filter(ts.isImportDeclaration).length,0);
  const calls:ts.CallExpression[]=[];function visit(node:ts.Node){if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword)calls.push(node);ts.forEachChild(node,visit);}visit(ast);
  assert.equal(calls.length,1);assert.equal(calls[0].arguments[0].getText(ast),"'./skill-social-widget'");
});
test('offscreen public reading imports nothing; visible entries enhance exactly once',async()=>{
  const h=loader();await flush();assert.equal(h.imports,0);assert.equal(h.observed.length,1);assert.equal(JSON.stringify(h.observerOptions),JSON.stringify({rootMargin:'300px 0px'}));
  h.intersect(false);await flush();assert.equal(h.imports,0);
  h.intersect();h.intersect();await flush();assert.equal(h.imports,1);assert.equal(h.renders.length,1);assert.deepEqual(h.unobserved,h.nodes);
  h.intersect();h.nodes[0].dispatchEvent(new Event('focusin'));h.window.dispatchEvent(new Event('pageshow'));await flush();assert.equal(h.imports,1);
});
test('documents without a social block import nothing',async()=>{const h=loader({nodes:0});h.window.dispatchEvent(new Event('pageshow'));await flush();assert.equal(h.imports,0);assert.equal(h.observed.length,0);});
test('browsers without IntersectionObserver retain eager enhancement',async()=>{const h=loader({observer:false});await flush();assert.equal(h.renders.length,1);});
test('keyboard focus can load the same enhancement without intercepting link activation',async()=>{
  const h=loader();const focus=new Event('focusin',{cancelable:true});h.nodes[0].dispatchEvent(focus);await flush();assert.equal(h.renders.length,1);assert.equal(focus.defaultPrevented,false);
  const click=new Event('click',{cancelable:true});h.nodes[0].dispatchEvent(click);assert.equal(click.defaultPrevented,false);
});
test('a failed import leaves public links intact and a later focus can retry',async()=>{
  let failed=true,renders=0;const h=loader({importer:()=>{if(failed)throw Error('offline chunk');return {enhanceSkillSocial:async()=>{renders++;return true;}};}});
  h.intersect();await flush();assert.equal(renders,0);assert.equal(h.unobserved.length,0);failed=false;
  h.nodes[0].dispatchEvent(new Event('focusin'));await flush();assert.equal(renders,1);assert.equal(h.imports,2);
});
test('unavailable session enhancement can be retried on a later visible entry',async()=>{
  let available=false;const h=loader({renderer:async()=>available});h.intersect();await flush();assert.equal(h.unobserved.length,0);
  available=true;h.intersect(false);h.intersect();await flush();assert.equal(h.renders.length,2);assert.equal(h.unobserved.length,1);
});
test('hidden pages do not begin an import and restore a visible entry on return',async()=>{
  const h=loader();h.document.visibilityState='hidden';h.intersect();await flush();assert.equal(h.imports,0);
  h.document.visibilityState='visible';h.document.dispatchEvent(new Event('visibilitychange'));await flush();assert.equal(h.renders.length,1);
});
test('a pagehide during a pending session read aborts it; pageshow uses a fresh attempt',async()=>{
  const pending=deferred<boolean>();let calls=0;const h=loader({renderer:async()=>++calls===1?pending.promise:true});h.intersect();await flush();
  h.window.dispatchEvent(new Event('pagehide'));assert.equal(h.renders[0].signal.aborted,true);h.window.dispatchEvent(new Event('pageshow'));pending.resolve(false);await flush();
  assert.equal(h.renders.length,2);assert.equal(h.renders[1].signal.aborted,false);assert.equal(h.unobserved.length,1);
});
test('leaving while the dynamic import is queued prevents a session read',async()=>{
  const h=loader();h.intersect();h.window.dispatchEvent(new Event('pagehide'));await flush();assert.equal(h.renders.length,0);
  h.window.dispatchEvent(new Event('pageshow'));await flush();assert.equal(h.renders.length,1);
});
test('removed blocks never import or render',async()=>{const h=loader();h.nodes[0].isConnected=false;h.intersect();await flush();assert.equal(h.imports,0);});
test('focusout waits for the next focused element and does not replace another link in the same block',async()=>{
  const h=loader();h.document.activeElement=h.nodes[0].child;h.nodes[0].dispatchEvent(new Event('focusout'));await flush();assert.equal(h.imports,0);
  h.document.activeElement=null;h.nodes[0].dispatchEvent(new Event('focusout'));await flush();assert.equal(h.renders.length,1);
});

function renderer(read:()=>Promise<unknown>){
  const node=new Node(),document={activeElement:null as unknown},calls:{path:string;options:any}[]=[],renders:any[]=[];
  class ApiError extends Error{constructor(readonly status:number){super('synthetic failure');}}
  class PortalClient{csrfToken:string|null=null;async get(path:string,options:any){calls.push({path,options});return read();}}
  let flushing=false;
  const modules:Record<string,unknown>={
    './zod-csp':{},'react-dom':{flushSync:(callback:()=>void)=>{flushing=true;try{callback();}finally{flushing=false;}}},'react-dom/client':{createRoot:(target:unknown)=>{assert.equal(target,node);return {render:(value:unknown)=>{assert.equal(flushing,true,'the SSR replacement commits inside the same focus fence');renders.push(value);}};}},
    './api':{ApiError,PortalClient},'./modules/GitHubSocial':{GitHubBookSocial:'book',GitHubSocialProvider:'provider'},
    './modules/SkillBookCover':{skillBookStarUrl:()=>node.dataset.repository},'react/jsx-runtime':{jsx:(type:unknown,props:unknown)=>({type,props})},
  };
  const exports:any={};runInNewContext(compile(widget),{exports,document,require:(path:string)=>{assert.ok(path in modules,path);return modules[path];}});
  return {node,document,calls,renders,ApiError,enhance:(signal=new AbortController().signal)=>exports.enhanceSkillSocial(node,signal) as Promise<boolean>};
}
const session={user:{user_id:'synthetic-reader'},csrf_token:'synthetic-csrf'};
test('deferred member rendering retains the same session provider, widget and book return destination',async()=>{
  const h=renderer(async()=>session),controller=new AbortController();assert.equal(await h.enhance(controller.signal),true);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/session');assert.equal(h.calls[0].options.skipAuthHandler,true);assert.equal(h.calls[0].options.signal,controller.signal);
  assert.equal(h.renders[0].type,'provider');assert.equal(h.renders[0].props.session,session);assert.equal(h.renders[0].props.client.csrfToken,session.csrf_token);
  assert.equal(h.renders[0].props.children.type,'book');assert.equal(h.renders[0].props.children.props.returnTo,'/development/skills/social-post');
});
test('anonymous 401 still renders the existing public GitHub widget',async()=>{const h=renderer(async()=>{throw new h.ApiError(401);});assert.equal(await h.enhance(),true);assert.equal(h.renders[0].type,'book');});
for(const kind of [403,500,'network'] as const)test(`session failure ${kind} leaves the SSR fallback intact`,async()=>{
  const h=renderer(async()=>{throw kind==='network'?Error('offline'):new h.ApiError(kind);});assert.equal(await h.enhance(),false);assert.equal(h.renders.length,0);
});
test('focusing an SSR link during session discovery preserves it until focus leaves',async()=>{
  const h=renderer(async()=>session);h.document.activeElement=h.node.child;assert.equal(await h.enhance(),false);assert.equal(h.renders.length,0);assert.equal(h.calls.length,0);
  h.document.activeElement=null;assert.equal(await h.enhance(),true);assert.equal(h.renders.length,1);
});
test('aborted or detached late session results cannot replace the public fallback',async()=>{
  for(const mode of ['abort','detach']){const pending=deferred<unknown>(),h=renderer(()=>pending.promise),controller=new AbortController();const result=h.enhance(controller.signal);
    if(mode==='abort')controller.abort();else h.node.isConnected=false;pending.resolve(session);assert.equal(await result,false);assert.equal(h.renders.length,0);}
});
test('already cancelled enhancement never reads a session',async()=>{const h=renderer(async()=>session),controller=new AbortController();controller.abort();assert.equal(await h.enhance(controller.signal),false);assert.equal(h.calls.length,0);});

test('focus acquired while a session is pending postpones replacement until a fresh attempt',async()=>{
  const pending=deferred<unknown>(),h=renderer(()=>pending.promise);const result=h.enhance();
  h.document.activeElement=h.node.child;pending.resolve(session);assert.equal(await result,false);assert.equal(h.renders.length,0);
  h.document.activeElement=null;assert.equal(await h.enhance(),true);assert.equal(h.calls.length,2);
});
