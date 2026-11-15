import {normalizeShareUrl} from '../../packages/shared/share-url';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {test} from 'node:test';
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {newTextHistory,recordText,breakTextGroup,undoText,redoText,TEXT_HISTORY_LIMIT} from '../../apps/portal-web/src/modules/text-edit-history';
import {shareModuleRetryUrl} from '../../apps/portal-web/src/share-module-loader';

test('typing coalesces until a pause or blur while replacements always keep their original draft',()=>{
  let history=recordText(newTextHistory(),'原', 'typing',1000);
  history=recordText(history,'原稿', 'typing',1200);
  assert.equal(undoText(history).value,'');
  history=recordText(history,'原稿第二段', 'typing',2000);
  assert.equal(undoText(history).value,'原稿');
  history=recordText(breakTextGroup(history),'原稿第二段！','typing',2100);
  assert.equal(undoText(history).value,'原稿第二段');
  history=recordText(history,'採用的替換文案','replace',2101);
  assert.equal(undoText(history).value,'原稿第二段！');
  assert.equal(redoText(undoText(history)).value,'採用的替換文案');
});

test('editing after undo drops the abandoned redo branch, including fast typing after undo',()=>{
  let history=recordText(recordText(newTextHistory('A'),'B','replace',1000),'C','replace',1001);
  history=undoText(history);
  history=recordText(history,'D','typing',1002);
  assert.equal(undoText(history).value,'B');
  assert.equal(history.future.length,0);
  assert.equal(redoText(history),history);
});

test('no-op changes do not consume history and the bounded history resets for a fresh composer',()=>{
  const empty=newTextHistory();
  assert.equal(undoText(empty),empty);assert.equal(redoText(empty),empty);assert.equal(recordText(empty,''),empty);
  let history=empty;
  for(let i=1;i<=100;i++)history=recordText(history,String(i),'replace');
  assert.equal(history.past.length,TEXT_HISTORY_LIMIT);
  for(let i=0;i<TEXT_HISTORY_LIMIT;i++)history=undoText(history);
  assert.equal(history.value,'40');
  assert.deepEqual(newTextHistory(),{value:'',past:[],future:[],typedAt:null});
});

test('optimizer retry admits only its same-origin JavaScript chunk with bounded fresh keys',()=>{
  const origin='https://workshop.example.test',path='/assets/SocialPostOptimizer-abc123.js';
  const error=(url:string)=>new TypeError('Failed to fetch dynamically imported module: '+url);
  assert.equal(shareModuleRetryUrl(error(origin+path),origin,1,'SocialPostOptimizer'),origin+path+'?share-retry=1');
  assert.equal(shareModuleRetryUrl(error(origin+path+'?share-retry=1'),origin,2,'SocialPostOptimizer'),origin+path+'?share-retry=2');
  assert.equal(shareModuleRetryUrl(error(origin+path),origin,1),null);
  for(const url of ['https://other.test'+path,origin+'/assets/SocialCrossPlatformShare-abc123.js',origin+path+'?secret=private',origin+path+'#fragment','https://user:secret@workshop.example.test'+path])assert.equal(shareModuleRetryUrl(error(url),origin,1,'SocialPostOptimizer'),null);
  for(const attempt of [0,4,1.5])assert.equal(shareModuleRetryUrl(error(origin+path),origin,attempt,'SocialPostOptimizer'),null);
  assert.equal(shareModuleRetryUrl(error(origin+path+'?share-retry=2'),origin,2,'SocialPostOptimizer'),null);
});

test('optimizer CSS is eager so a stylesheet download cannot reject the deferred JavaScript import',async t=>{
  // Vite sets NODE_ENV for its build. Restore the caller's mode before the
  // mounted tests load ReactDOM, so React and its renderer use the same mode.
  const nodeEnv=process.env.NODE_ENV;
  t.after(()=>{if(nodeEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=nodeEnv;});
  const {build}=await import('vite');
  const result=await build({configFile:'apps/portal-web/vite.config.ts',logLevel:'silent',build:{write:false,manifest:true}});
  assert(!Array.isArray(result)&&'output' in result);
  const manifestAsset=result.output.find(asset=>asset.type==='asset'&&asset.fileName==='.vite/manifest.json');
  assert(manifestAsset?.type==='asset');
  const manifest=JSON.parse(String(manifestAsset.source)) as Record<string,{file:string;imports?:string[];css?:string[];isDynamicEntry?:boolean}>;
  const optimizer=manifest['src/modules/SocialPostOptimizer.tsx'];
  assert(optimizer?.isDynamicEntry,'optimizer JavaScript must stay deferred');
  assert.deepEqual(optimizer.css??[],[],'the deferred optimizer must not request a separate stylesheet');
  const eager=new Set<string>();
  function visit(key:string){if(eager.has(key))return;eager.add(key);for(const dependency of manifest[key].imports??[])visit(dependency);}
  visit('index.html');
  assert(!eager.has('src/modules/SocialPostOptimizer.tsx'),'optimizer JavaScript must not enter the initial module graph');
  const css=new Set([...eager].flatMap(key=>manifest[key].css??[]));
  assert(result.output.some(asset=>asset.type==='asset'&&css.has(asset.fileName)&&String(asset.source).includes('.social-post-optimizer')),'optimizer styles must be in the initial stylesheet graph');
});

// Execute the real TSX with only imported UI dependencies and the hydrated origin
// hook supplied. This is component/unit evidence, not a browser or hydration test.
async function gameTextHarness(){

 const {readFileSync}=await import('node:fs'),{runInNewContext}=await import('node:vm'),{transformSync}=await import('esbuild');
 let origin:string|undefined,injected=false;
 const module={exports:{} as {gameChallengeLink:(token:string,origin:string)=>null|{prefix:string;label:string;suffix:string;href:string};externalShareLink:(token:string,origin:string)=>null|{prefix:string;label:string;suffix:string;href:string};SocialRichText:React.ComponentType<any>}};
 const hooks={...React,useState:(initial:unknown)=>{if(origin!==undefined&&!injected){injected=true;return [origin,()=>{}];}return React.useState(initial);}};
 const source=readFileSync(new URL('../../apps/portal-web/src/modules/SocialTools.tsx',import.meta.url),'utf8');
 runInNewContext(transformSync(source,{loader:'tsx',format:'cjs',jsx:'automatic'}).code,{module,exports:module.exports,URL,require:(name:string)=>{
  if(name==='react')return hooks;if(name==='react/jsx-runtime')return requireJsx;
  if(name==='../../../../packages/shared/share-url')return {normalizeShareUrl};
  if(name==='../language')return {useLanguage:()=>({language:'zh-Hant'})};
  if(name==='./MemberAvatar')return {MemberAvatar:()=>null};throw Error('Unexpected import '+name);
 }});
 function render(text:string,hydratedOrigin?:string,mentions:unknown[]=[]){origin=hydratedOrigin;injected=false;return renderToStaticMarkup(React.createElement(module.exports.SocialRichText,{client:{},text,mentions,onTag:()=>{}}));}
 return {...module.exports,render};
}
import * as requireJsx from 'react/jsx-runtime';

test('game challenge links accept only exact current-origin canonical games and uint32 seeds',async()=>{
 const {gameChallengeLink:parse}=await gameTextHarness(),origin='https://workshop.example.test';
 for(const game of ['photo','stamp','cash','chair','tofu','holiday'])for(const seed of ['1','42','4294967295']){
  const href=`/play?game=${game}&seed=${seed}`,label=origin+href;
  assert.equal(parse(label,origin)?.href,href);
  const punctuated=parse('（'+label+'）。',origin);assert(punctuated);assert.equal(punctuated.prefix,'（');assert.equal(punctuated.label,label);assert.equal(punctuated.suffix,'）。');
 }
 const route='/play?game=cash&seed=42',valid=origin+route;
 for(const token of [
  'https://evil.test'+route,'http://workshop.example.test'+route,origin+':443'+route,origin+'.evil.test'+route,
  'https://user@workshop.example.test'+route,'https://evil.test/?next='+valid,'prefix'+valid,'//workshop.example.test'+route,'javascript:'+valid,
  valid+'#tag',valid+'?',valid+'&seed=7',valid+'&extra=1',valid+'/suffix',valid+'.evil',valid+'\\',valid+'\u200b',valid+'\u0000',valid+'\n',valid+'\t',valid+'\u0085',valid+'\u202e',
  origin+'/play?seed=42&game=cash',origin+'/play?game=cash&seed=0',origin+'/play?game=cash&seed=01',origin+'/play?game=cash&seed=-1',origin+'/play?game=cash&seed=4294967296',origin+'/play?game=cash&seed=1.5',origin+'/play?game=cash&seed=1e2',origin+'/play?game=other&seed=42',
  origin+'/pl%61y?game=cash&seed=42',origin+'/play?game=%63ash&seed=42',origin+'/play?game=cash&seed=%34%32',origin+'/play/../play?game=cash&seed=42',
 ])assert.equal(parse(token,origin),null,JSON.stringify(token));
 for(const current of ['', 'null',origin+'/',origin+'/path','file://',origin+'?x=1'])assert.equal(parse(valid,current),null);
 const local='http://localhost:4311';assert.equal(parse(local+route,local)?.href,route);
});

test('real rich text preserves escaped text, mentions, hashtags and newlines with safe manual challenge anchors',async()=>{
 const {render}=await gameTextHarness(),origin='https://workshop.example.test',url=origin+'/play?game=cash&seed=42';
 const text=`<img src=x onerror=alert(1)>\n@Alice Smith #離譜日常\n（${url}）。\n${url}&seed=7`;
 const html=render(text,origin,[{user_id:'synthetic-member',display_name:'Alice Smith'}]);
 assert.equal((html.match(/<a /g)??[]).length,1);assert(html.includes('href="/play?game=cash&amp;seed=42"'));
 for(const attribute of ['target="_blank"','rel="noopener noreferrer"','referrerPolicy="no-referrer"','在新分頁開啟'])assert(html.includes(attribute),attribute);
 assert(!html.includes('<img'));assert(html.includes('&lt;img src=x onerror=alert(1)&gt;\n'));
 assert(html.includes('>@Alice Smith</button>'));assert(html.includes('>#離譜日常</button>'));
 assert(html.includes('）。\n'));assert(html.includes(url.replaceAll('&','&amp;')+'&amp;seed=7'));
 const server=render(url);assert(!server.includes('<a '));assert.equal(render(url),server,'server render is deterministic without window');
});


test('URL-shaped text inside an existing multi-word mention remains one member link',async()=>{
 const {render}=await gameTextHarness(),origin='https://freetwai.com',url=origin+'/play?game=cash&seed=1',name='A '+url;
 const html=render('@'+name+'\n'+url,origin,[{user_id:'synthetic-member',display_name:name}]);
 assert(html.includes('>@A '+url.replaceAll('&','&amp;')+'</button>'));
 assert.equal((html.match(/<a /g)??[]).length,1,'only the standalone challenge is linked');
});

test('external links preserve the original HTTPS destination and declared prose punctuation',async()=>{
 const {externalShareLink:parse}=await gameTextHarness(),origin='https://workshop.example.test';
 for(const url of [
  'https://example.com/docs?b=2&utm_source=workshop&a=1&a=3#section-2',
  'HTTPS://WWW.Example.COM/path?x=%2f&x=two+words#part%202',
  'https://example.com/中文/%E6%96%87%E7%AB%A0?q=hello%20world#段落',
  'https://example.com/wiki/Test_(example)',
  'https://example.com/file%2E?literal=%2C#end%21',
 ]){const link=parse(url,origin);assert(link,url);assert.equal(link.href,url);assert.equal(link.label,url);assert.equal(link.suffix,'');}
 for(const punctuation of ['.',',','!',';','。','，','！','？','、','；','：']){
  const url='https://example.com/docs',link=parse(url+punctuation,origin);assert(link);assert.equal(link.href,url);assert.equal(link.suffix,punctuation);
 }
 const wrapped=parse('（https://example.com/wiki/Test_(example)）。',origin);assert(wrapped);assert.equal(wrapped.prefix,'（');assert.equal(wrapped.href,'https://example.com/wiki/Test_(example)');assert.equal(wrapped.suffix,'）。');
 const nested=parse('(https://example.com/a_(b_(c))).',origin);assert(nested);assert.equal(nested.href,'https://example.com/a_(b_(c))');assert.equal(nested.suffix,').');
});

test('external link validation rejects whole unsafe tokens and cannot bypass same-origin game checks',async()=>{
 const {externalShareLink:parse,render}=await gameTextHarness(),origin='https://workshop.example.test',valid='https://example.com/docs';
 const rejected=[
  'javascript:alert(1)','data:text/html,test','http://example.com/docs','//example.com/docs','prefix'+valid,
  'https://user@example.com/docs','https://user:pass@example.com/docs','https://example.com:443/docs','https://example.com:8443/docs',
  'https://127.0.0.1/docs','https://192.168.0.1/docs','https://10.0.0.1/docs','https://169.254.169.254/docs','https://[::1]/docs','https://[2001:db8::1]/docs',
  'https://2130706433/docs','https://0x7f000001/docs','https://0177.0.0.1/docs','https://localhost/docs','https://app.localhost/docs','https://printer.local/docs','https://svc.internal/docs','https://nas.lan/docs','https://intranet/docs',
  'https://%65xample.com/docs','https://example.com%40evil.test/docs','https://example.com&#64;evil.test/docs','https://ｅxample.com/docs',
  '\u0001'+valid,'\u200b'+valid,valid+'\u00a0suffix',valid+'\u3000suffix',valid+'\\@evil.test',valid+'\u200b',valid+'\u202e',valid+'\u0085',valid+'\n',valid+'\t',valid+'<img>',valid+'"onclick=alert(1)',valid+"'onclick=alert(1)",
  valid+'%ZZ',valid+'%',valid+'%0a',valid+'%00',valid+'%5c',valid+'%C2%85',valid+'%E2%80%8B',valid+'%E2%80%AE',valid+'%FF',
  origin+':443/play?game=cash&seed=42','https://%77orkshop.example.test/play?game=cash&seed=42',origin+'./play?game=cash&seed=42','http://workshop.example.test/play?game=cash&seed=42',
  origin+'/private',origin+'/play?game=cash&seed=0',origin+'/play?game=cash&seed=42&seed=7',origin+'/pl%61y?game=cash&seed=42',origin.toUpperCase()+'/play?game=cash&seed=42',
 ];
 for(const token of rejected){assert.equal(parse(token,origin),null,JSON.stringify(token));if(!/[\t\n]/.test(token))assert(!render(token,origin).includes('<a '),JSON.stringify(token));}
 assert.equal(parse(valid,''),null);assert.equal(parse(valid,'null'),null);assert.equal(parse('https://example.com/'+ 'a'.repeat(2048),origin),null);
 // An embedded URL is not extracted from a rejected outer scheme/authority.
 for(const token of ['javascript:'+valid,'https://localhost/?next='+valid,'https://user@evil.test/?next='+valid])assert(!render(token,origin).includes('<a '));
 const url=origin+'/play?game=cash&seed=42',html=render(url,origin);assert(html.includes('href="/play?game=cash&amp;seed=42"'),'strict game branch still wins');
});

test('external rich text keeps mentions, hashtags and escaped text while creating only manual links',async()=>{
 const {render}=await gameTextHarness(),origin='https://workshop.example.test',url='https://example.com/docs?a=1&a=2&utm_source=test#part-2';
 const name='A https://example.com/docs',text=`<b>原文</b>\n@${name} #話題\n${url}。`;
 const html=render(text,origin,[{user_id:'synthetic-member',display_name:name}]);
 assert.equal((html.match(/<a /g)??[]).length,1);assert(html.includes(`href="${url.replaceAll('&','&amp;')}"`));
 assert(html.includes('>@'+name+'</button>'));assert(html.includes('>#話題</button>'));assert(html.includes('&lt;b&gt;原文&lt;/b&gt;\n'));assert(html.includes('</a><span>。</span>'));
 for(const attribute of ['target="_blank"','rel="noopener noreferrer"','referrerPolicy="no-referrer"','在新分頁開啟'])assert(html.includes(attribute));
 assert(!render(url).includes('<a '),'SSR remains deterministic and does not read window');
});


test('kitchen challenges accept only canonical same-origin recipe and uint32 seed triples',async()=>{
 const {gameChallengeLink:parse,render}=await gameTextHarness(),origin='https://workshop.example.test';
 for(const recipe of ['egg-fried-rice','ab','a'+'b'.repeat(40),'unknown-recipe'])for(const seed of ['1','42','4294967295']){
  const href=`/play?game=kitchen&recipe=${recipe}&seed=${seed}`,url=origin+href,link=parse('（'+url+'）。',origin);
  assert(link);assert.equal(link.href,href);assert.equal(link.label,url);assert.equal(link.prefix,'（');assert.equal(link.suffix,'）。');
  const html=render(url,origin);assert.equal((html.match(/<a /g)??[]).length,1);assert(html.includes(`href="${href.replaceAll('&','&amp;')}"`));
  for(const attribute of ['target="_blank"','rel="noopener noreferrer"','referrerPolicy="no-referrer"','在新分頁開啟'])assert(html.includes(attribute));
  assert(!render(url).includes('<a '),'SSR does not read browser origin');
 }
 const route='/play?game=kitchen&recipe=egg-fried-rice&seed=42',url=origin+route;
 for(const token of [
  ...['','a','A-recipe','1-recipe','-recipe','recipe_egg','egg2','a'+'b'.repeat(41),'蛋炒飯','egg%2Dfried-rice','egg/fried','egg.fried'].map(recipe=>origin+`/play?game=kitchen&recipe=${recipe}&seed=42`),
  ...['0','01','-1','4294967296','1.5','1e2','%34%32'].map(seed=>origin+`/play?game=kitchen&recipe=egg-fried-rice&seed=${seed}`),
  origin+'/play?game=kitchen&seed=42',origin+'/play?game=kitchen&seed=42&recipe=egg-fried-rice',origin+'/play?recipe=egg-fried-rice&game=kitchen&seed=42',
  url+'&recipe=other',url+'&seed=7',url+'&extra=1',url+'#tag',url+'?',url+'/suffix',url+'.evil',url+'\\',url+'\u200b',url+'\u0000',
  origin+':443'+route,'https://user@workshop.example.test'+route,'http://workshop.example.test'+route,'https://%77orkshop.example.test'+route,
  'prefix'+url,'javascript:'+url,origin+'/pl%61y?game=kitchen&recipe=egg-fried-rice&seed=42',
  ...['photo','stamp','cash'].map(game=>origin+`/play?game=${game}&recipe=egg-fried-rice&seed=42`),
 ]){assert.equal(parse(token,origin),null,JSON.stringify(token));assert(!render(token,origin).includes('<a '),JSON.stringify(token));}
 // External HTTPS may remain an ordinary external link, never a local challenge.
 assert.equal(parse('https://other.example.test'+route,origin),null);
 const external=render('https://other.example.test'+route,origin);assert(!external.includes('href="/play?'));
});


test('party challenges retain the exact two-key contract without a generic local fallback',async()=>{
 const {gameChallengeLink:parse,render}=await gameTextHarness(),origin='https://workshop.example.test';
 for(const game of ['chair','tofu','holiday']){
  const route=`/play?game=${game}&seed=42`,url=origin+route,html=render(url,origin);
  assert.equal((html.match(/<a /g)??[]).length,1);assert(html.includes(`href="${route.replaceAll('&','&amp;')}"`));
  for(const token of [
   ...['0','01','-1','4294967296','1.5','1e2','%34%32'].map(seed=>origin+`/play?game=${game}&seed=${seed}`),
   origin+`/play?game=${game}&recipe=egg-fried-rice&seed=42`,url+'&recipe=egg-fried-rice',url+'&seed=7',url+'&extra=1',url+'#tag',url+'?',
   origin+`/play?seed=42&game=${game}`,origin+`/play?game=${game.toUpperCase()}&seed=42`,origin+`/play?game=${game}%00&seed=42`,
   origin+':443'+route,'https://user@workshop.example.test'+route,'http://workshop.example.test'+route,'https://%77orkshop.example.test'+route,
   url+'\\',url+'\u200b',url+'\u0000',url+'\u0085','prefix'+url,'javascript:'+url,
  ]){assert.equal(parse(token,origin),null,JSON.stringify(token));assert(!render(token,origin).includes('<a '),JSON.stringify(token));}
  assert.equal(parse('https://other.example.test'+route,origin),null);
  assert(!render('https://other.example.test'+route,origin).includes('href="/play?'));
 }
 for(const game of ['unknown','party','chairs']){const url=origin+`/play?game=${game}&seed=42`;assert.equal(parse(url,origin),null);assert(!render(url,origin).includes('<a '));}
});

test('mounted SocialTextTools mention disclosure',async t=>{
 // Real ReactDOM and the whole production component, with only DOM, clock and
 // transport ports controlled. This is not browser layout or native IME evidence.
 const {readFileSync}=await import('node:fs'),{runInNewContext}=await import('node:vm');
 const {createRequire}=await import('node:module'),{transformSync}=await import('esbuild');
 class HostNode {
  [key:string]:any;
  parentNode:HostNode|null=null;childNodes:HostNode[]=[];attributes:Record<string,string>={};
  style={setProperty(){},removeProperty(){}};
  listeners:Record<string,{fn:Function;capture:boolean}[]>={};
  namespaceURI='http://www.w3.org/1999/xhtml';
  private inputValue='';
  get value(){return this.inputValue;}
  set value(value:string){this.inputValue=String(value);}
  get type(){return this.attributes.type??'text';}
  set type(value:string){this.attributes.type=String(value);}
  constructor(public nodeType:number,public nodeName:string,public ownerDocument:any){if(nodeType===1)this.tagName=nodeName;}
  appendChild(node:HostNode){node.parentNode?.removeChild(node);this.childNodes.push(node);node.parentNode=this;return node;}
  removeChild(node:HostNode){const index=this.childNodes.indexOf(node);assert.notEqual(index,-1);this.childNodes.splice(index,1);node.parentNode=null;return node;}
  insertBefore(node:HostNode,before:HostNode){node.parentNode?.removeChild(node);const index=this.childNodes.indexOf(before);assert.notEqual(index,-1);this.childNodes.splice(index,0,node);node.parentNode=this;return node;}
  setAttribute(key:string,value:unknown){this.attributes[key]=String(value);}
  removeAttribute(key:string){delete this.attributes[key];}
  getAttribute(key:string){return this.attributes[key]??null;}
  setAttributeNS(_namespace:string,key:string,value:unknown){this.setAttribute(key,value);}
  addEventListener(type:string,fn:Function,options?:any){(this.listeners[type]??=[]).push({fn,capture:options===true||!!options?.capture});}
  removeEventListener(type:string,fn:Function){this.listeners[type]=(this.listeners[type]??[]).filter(item=>item.fn!==fn);}
  get firstChild():HostNode|null{return this.childNodes[0]??null;}
  get lastChild():HostNode|null{return this.childNodes.at(-1)??null;}
  get nextSibling():HostNode|null{return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this)+1]??null;}
  get textContent():string{return this.nodeType===3?this.nodeValue:this.childNodes.map(node=>node.textContent).join('');}
  set textContent(value:string){this.childNodes.forEach(node=>{node.parentNode=null;});this.childNodes=[];if(value)this.appendChild(this.ownerDocument.createTextNode(String(value)));}
  contains(node:HostNode):boolean{return node===this||this.childNodes.some(child=>child.contains(node));}
  closest(selector:string):HostNode|null{return this.nodeName===selector.toUpperCase()?this:this.parentNode?.closest(selector)??null;}
  querySelector(selector:string):HostNode|null{return descendants(this).find(node=>node.nodeName===selector.toUpperCase())??null;}
  focus(){this.ownerDocument.activeElement=this;}
  setSelectionRange(start:number,end:number){this.selectionStart=start;this.selectionEnd=end;}
  dispatchEvent(event:any){
   event.target??=this;event.bubbles??=true;event.cancelBubble=false;event.defaultPrevented=false;
   event.preventDefault=()=>{event.defaultPrevented=true;};event.stopPropagation=()=>{event.cancelBubble=true;};
   const chain:HostNode[]=[];for(let node:HostNode|null=this;node;node=node.parentNode)chain.push(node);
   for(const node of [...chain].reverse()){event.currentTarget=node;for(const listener of node.listeners[event.type]??[])if(listener.capture)listener.fn(event);if(event.cancelBubble)return !event.defaultPrevented;}
   for(const node of chain){event.currentTarget=node;for(const listener of node.listeners[event.type]??[])if(!listener.capture)listener.fn(event);if(event.cancelBubble||!event.bubbles)break;}
   event.currentTarget=null;return !event.defaultPrevented;
  }
 }
 function descendants(node:HostNode):HostNode[]{return [node,...node.childNodes.flatMap(descendants)];}
 class HostDocument extends HostNode {
  constructor(){super(9,'#document',null);this.ownerDocument=this;this.documentElement=new HostNode(1,'HTML',this);this.body=new HostNode(1,'BODY',this);this.appendChild(this.documentElement);this.documentElement.appendChild(this.body);this.activeElement=this.body;}
  createElement(name:string){return new HostNode(1,name.toUpperCase(),this);}
  createElementNS(namespace:string,name:string){const node=this.createElement(name);node.namespaceURI=namespace;return node;}
  createTextNode(value:string){const node=new HostNode(3,'#text',this);node.nodeValue=value;return node;}
 }
 const document=new HostDocument(),window={document,HTMLElement:HostNode,HTMLIFrameElement:class{},get event(){return undefined;}};
 document.defaultView=window;document.oninput=null;
 const globals={document,window,HTMLElement:HostNode,Node:HostNode,IS_REACT_ACT_ENVIRONMENT:true};
 const previous=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 Object.assign(globalThis,globals);
 t.after(()=>{for(const [key,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}});
 const require=createRequire(import.meta.url);
 const {createRoot}=require('react-dom/client') as typeof import('react-dom/client');
 const {flushSync}=require('react-dom') as typeof import('react-dom');
 const flush=(fn:()=>void)=>React.act(()=>flushSync(fn));
 let clock=0,nextTimer=0;
 const timers=new Map<number,{due:number;fn:()=>void}>();
 const setTimer=(fn:()=>void,delay:number)=>{const id=++nextTimer;timers.set(id,{due:clock+delay,fn});return id;};
 const advance=(ms:number)=>flush(()=>{clock+=ms;for(const [id,timer] of [...timers])if(timer.due<=clock){timers.delete(id);timer.fn();}});
 const source=readFileSync(new URL('../../apps/portal-web/src/modules/SocialTools.tsx',import.meta.url),'utf8');
 const module={exports:{} as {SocialTextTools:React.ComponentType<any>}};
 runInNewContext(transformSync(source,{loader:'tsx',format:'cjs',jsx:'automatic'}).code,{
  module,exports:module.exports,Error,URL,window,document,setTimeout:setTimer,clearTimeout:(id:number)=>timers.delete(id),
  require(name:string){
   if(name==='react')return React;if(name==='react/jsx-runtime')return requireJsx;
   if(name==='../../../../packages/shared/share-url')return {normalizeShareUrl};
   if(name==='../language')return {useLanguage:()=>({language:'zh-Hant'})};
   if(name==='./MemberAvatar')return {MemberAvatar:()=>null};
   throw Error('Unexpected import '+name);
  },
 });
 function fixture(context:TestContext,strict=false){
  const requests:{path:string;resolve:(value:any)=>void;reject:(cause:unknown)=>void}[]=[];
  const client={sessionGeneration:1,get:(path:string)=>new Promise((resolve,reject)=>requests.push({path,resolve,reject}))};
  const container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container as any);
  const options={disabled:false};let currentText='',currentMentions:unknown[]=[];
  function Editor(){
   const [text,setText]=React.useState(''),[mentions,setMentions]=React.useState([]);
   currentText=text;currentMentions=mentions;
   return React.createElement('form',null,
    // The parent owns the textarea; input events deliver its value as real props.
    React.createElement('textarea',{value:text,onInput:(event:any)=>setText(event.currentTarget.value)}),
    React.createElement(module.exports.SocialTextTools,{client,text,onChange:setText,mentions,onMentions:setMentions,...options}));
  }
  const render=()=>flush(()=>root.render(React.createElement(strict?React.StrictMode:React.Fragment,null,React.createElement(Editor))));
  let mounted=true;const unmount=()=>{if(mounted){flush(()=>root.unmount());document.body.removeChild(container);mounted=false;}};
  context.after(unmount);render();
  const nodes=()=>descendants(container),area=()=>nodes().find(node=>node.nodeName==='TEXTAREA')!;
  const button=(label:string)=>nodes().find(node=>node.nodeName==='BUTTON'&&node.getAttribute('aria-label')===label)!;
  const picker=()=>nodes().find(node=>node.nodeName==='SECTION');
  const click=(node:HostNode)=>{assert(node,'mounted control');assert(container.contains(node));assert(!node.disabled,'control enabled');flush(()=>node.dispatchEvent({type:'click',button:0}));};
  const input=(node:HostNode,value:string)=>flush(()=>{Object.getOwnPropertyDescriptor(HostNode.prototype,'value')!.set!.call(node,value);node.setSelectionRange(value.length,value.length);node.dispatchEvent({type:'input'});});
  const type=(value:string)=>input(area(),value);
  const settle=async(index:number,value:any,reject=false)=>{assert(requests[index]);await React.act(async()=>{requests[index][reject?'reject':'resolve'](value);await new Promise(resolve=>setImmediate(resolve));});};
  return {requests,options,render,nodes,area,button,picker,click,input,type,settle,unmount,text:()=>currentText,mentions:()=>currentMentions};
 }
 await t.test('expanded automatic mention button closes without changing the draft or selection',context=>{
  const h=fixture(context);h.type('Hello @Alice');h.area().setSelectionRange(2,5);
  assert.equal(h.button('標註會員').getAttribute('aria-expanded'),'true');assert(h.picker());
  advance(199);assert.equal(h.requests.length,0);
  h.click(h.button('標註會員'));
  assert.equal(h.button('標註會員').getAttribute('aria-expanded'),'false');assert.equal(Boolean(h.picker()),false);
  assert.equal(h.text(),'Hello @Alice');assert.deepEqual([h.area().selectionStart,h.area().selectionEnd],[2,5]);
  advance(1);assert.equal(h.requests.length,0,'closing cancels the scheduled search');
 });
 await t.test('manual open, close and explicit reopen retain the 200ms search delay',context=>{
  const h=fixture(context);h.type('Draft');assert.equal(Boolean(h.picker()),false);
  h.click(h.button('標註會員'));assert.equal(h.button('標註會員').getAttribute('aria-expanded'),'true');
  advance(199);assert.equal(h.requests.length,0);advance(1);assert.equal(h.requests[0].path,'/members?limit=6&search=');
  h.click(h.button('標註會員'));assert.equal(Boolean(h.picker()),false);
  h.click(h.button('標註會員'));advance(199);assert.equal(h.requests.length,1);advance(1);assert.equal(h.requests.length,2);
  assert.equal(h.text(),'Draft');
 });
 for(const failure of [false,true])await t.test(`closed lookup ${failure?'rejection':'response'} cannot reopen the picker`,async context=>{
  const h=fixture(context);h.type('@Alice');advance(200);assert.equal(h.requests[0].path,'/members?limit=6&search=Alice');
  h.click(h.button('標註會員'));
  await h.settle(0,failure?Error('old lookup failed'):{items:[{user_id:'old',nickname:'Old member'}]},failure);
  assert.equal(Boolean(h.picker()),false);assert.equal(h.button('標註會員').getAttribute('aria-expanded'),'false');
  assert.equal(h.text(),'@Alice');advance(1000);assert.equal(h.requests.length,1,'no automatic retry');
 });
 for(const failure of [false,true])await t.test(`late old lookup ${failure?'rejection':'response'} does not replace an explicit reopened search`,async context=>{
  const h=fixture(context);h.type('@Alice');advance(200);h.click(h.button('標註會員'));h.click(h.button('標註會員'));advance(200);
  await h.settle(1,{items:[{user_id:'current',nickname:'Current member'}]});
  await h.settle(0,failure?Error('old lookup failed'):{items:[{user_id:'old',nickname:'Old member'}]},failure);
  assert.match(h.picker()!.textContent,/Current member/);assert.doesNotMatch(h.picker()!.textContent,/Old member|無法載入|old lookup/);
  assert.equal(h.requests.length,2);
 });
 for(const failure of ['Error','non-Error'])await t.test(`closing a failed ${failure} lookup and explicitly reopening permits a same-query retry`,async context=>{
  const h=fixture(context);h.click(h.button('標註會員'));advance(200);await h.settle(0,failure==='Error'?Error('offline'):'offline',true);
  assert.match(h.picker()!.textContent,failure==='Error'?/offline/:/會員暫時無法載入/);h.click(h.button('標註會員'));assert.equal(Boolean(h.picker()),false);
  h.click(h.button('標註會員'));advance(200);assert.equal(h.requests[1].path,h.requests[0].path);
  await h.settle(1,{items:[{user_id:'member-a',nickname:'Alice'}]});assert.match(h.picker()!.textContent,/Alice/);assert.doesNotMatch(h.picker()!.textContent,/offline|無法載入/);
 });
 await t.test('search edits debounce, and choosing a member preserves mention insertion',async context=>{
  const h=fixture(context);h.type('Hello @Al');advance(100);h.type('Hello @Alice');advance(199);assert.equal(h.requests.length,0);advance(1);
  assert.equal(h.requests[0].path,'/members?limit=6&search=Alice');
  await h.settle(0,{items:[{user_id:'member-a',nickname:'Alice Smith'}]});
  const choice=h.nodes().find(node=>node.nodeName==='BUTTON'&&node.getAttribute('class')==='social-mention-choice')!;
  h.click(choice);assert.equal(h.text(),'Hello @Alice Smith ');assert.deepEqual(JSON.parse(JSON.stringify(h.mentions())),[{user_id:'member-a',display_name:'Alice Smith'}]);
  assert.equal(Boolean(h.picker()),false);assert.equal(document.activeElement,h.area());
 });
 await t.test('manual search input remains editable after reopening',async context=>{
  const h=fixture(context);h.type('@Alice');h.click(h.button('標註會員'));h.click(h.button('標註會員'));
  const search=h.nodes().find(node=>node.nodeName==='INPUT')!;h.input(search,'Bob & Co');advance(200);
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].path,'/members?limit=6&search=Bob%20%26%20Co');
  assert.equal(h.text(),'@Alice');
 });
 await t.test('Escape dismisses the unchanged draft; later editing back is a new automatic disclosure',context=>{
  const h=fixture(context);h.type('@Alice');
  const event={type:'keydown',key:'Escape',keyCode:27};flush(()=>h.picker()!.dispatchEvent(event));
  assert.equal(Boolean(h.picker()),false);assert.equal(document.activeElement,h.button('插入 emoji'));
  h.render();assert.equal(Boolean(h.picker()),false,'unchanged rerender stays dismissed');
  h.type('@Alic');assert(h.picker());h.type('@Alice');assert(h.picker());
  h.click(h.button('標註會員'));assert.equal(Boolean(h.picker()),false);advance(200);assert.equal(h.requests.length,0);
 });
 await t.test('emoji and mention disclose only their visible picker and cancel hidden lookups',context=>{
  const h=fixture(context);h.type('@Alice');advance(199);h.click(h.button('插入 emoji'));
  assert.equal(h.picker()!.getAttribute('aria-label'),'emoji');assert.equal(h.button('標註會員').getAttribute('aria-expanded'),'false');
  advance(1);assert.equal(h.requests.length,0);
  h.click(h.button('標註會員'));assert.equal(h.picker()!.getAttribute('aria-label'),'標註會員');assert.equal(h.button('插入 emoji').getAttribute('aria-expanded'),'false');
  h.click(h.button('標註會員'));assert.equal(Boolean(h.picker()),false);assert.equal(h.text(),'@Alice');
 });
 await t.test('composition guard and emoji selection replacement remain intact',context=>{
  const h=fixture(context);h.type('Hello');h.area().setSelectionRange(1,4);
  flush(()=>h.area().dispatchEvent({type:'compositionstart'}));h.click(h.button('插入 emoji'));assert.equal(Boolean(h.picker()),false);
  flush(()=>h.area().dispatchEvent({type:'compositionend'}));h.click(h.button('插入 emoji'));h.click(h.button('插入 😀'));
  assert.equal(h.text(),'H😀o');assert.deepEqual([h.area().selectionStart,h.area().selectionEnd],[3,3]);assert.equal(Boolean(h.picker()),false);
  assert.equal(h.requests.length,0);
 });
 await t.test('disabled state and unmount invalidate queued or in-flight lookup work',async context=>{
  const h=fixture(context);h.type('@Alice');h.options.disabled=true;h.render();advance(200);assert.equal(h.requests.length,0);assert.equal(Boolean(h.picker()),false);
  h.options.disabled=false;h.render();advance(200);assert.equal(h.requests.length,1);h.unmount();
  await h.settle(0,{items:[{user_id:'late',nickname:'Late member'}]});assert.equal(timers.size,0);
 });
 await t.test('StrictMode replay retains automatic close and explicit reopen',async context=>{
  const h=fixture(context,true);h.type('@Alice');h.click(h.button('標註會員'));advance(200);assert.equal(h.requests.length,0);assert.equal(Boolean(h.picker()),false);
  h.click(h.button('標註會員'));advance(200);assert.equal(h.requests.length,1);await h.settle(0,{items:[]});assert.match(h.picker()!.textContent,/沒有符合的會員/);
 });
});

test('registered arcade canonical links and guided legacy links retain bounded challenge semantics',async()=>{
 const {gameChallengeLink:parse}=await gameTextHarness(),origin='https://workshop.example.test',base='/#guilds/guild_games/tools/arcade';
 for(const path of [base+'?game=cash&seed=42',base+'?game=kitchen&recipe=egg-fried-rice&practice=1&seed=42','/play?game=kitchen&recipe=egg-fried-rice&practice=1&seed=42'])assert.equal(parse(origin+path,origin)?.href,path);
 for(const tail of ['?game=cash&seed=0','?game=cash&seed=42&url=https://evil.test','?game=kitchen&recipe=egg-fried-rice&practice=2&seed=42','?game=kitchen&recipe=egg-fried-rice&seed=42&practice=1'])assert.equal(parse(origin+base+tail,origin),null);
 assert.equal(parse(origin+'/#guilds/guild_ar/tools/arcade?game=cash&seed=42',origin),null);
});
