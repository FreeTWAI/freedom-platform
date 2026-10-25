import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {test} from 'node:test';
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

test('optimizer CSS is eager so a stylesheet download cannot reject the deferred JavaScript import',async()=>{
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
 const module={exports:{} as {gameChallengeLink:(token:string,origin:string)=>null|{prefix:string;label:string;suffix:string;href:string};SocialRichText:React.ComponentType<any>}};
 const hooks={...React,useState:(initial:unknown)=>{if(origin!==undefined&&!injected){injected=true;return [origin,()=>{}];}return React.useState(initial);}};
 const source=readFileSync(new URL('../../apps/portal-web/src/modules/SocialTools.tsx',import.meta.url),'utf8');
 runInNewContext(transformSync(source,{loader:'tsx',format:'cjs',jsx:'automatic'}).code,{module,exports:module.exports,URL,require:(name:string)=>{
  if(name==='react')return hooks;if(name==='react/jsx-runtime')return requireJsx;
  if(name==='../language')return {useLanguage:()=>({language:'zh-Hant'})};
  if(name==='./MemberAvatar')return {MemberAvatar:()=>null};throw Error('Unexpected import '+name);
 }});
 function render(text:string,hydratedOrigin?:string,mentions:unknown[]=[]){origin=hydratedOrigin;injected=false;return renderToStaticMarkup(React.createElement(module.exports.SocialRichText,{client:{},text,mentions,onTag:()=>{}}));}
 return {...module.exports,render};
}
import * as requireJsx from 'react/jsx-runtime';

test('game challenge links accept only exact current-origin canonical games and uint32 seeds',async()=>{
 const {gameChallengeLink:parse}=await gameTextHarness(),origin='https://workshop.example.test';
 for(const game of ['photo','stamp','cash'])for(const seed of ['1','42','4294967295']){
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
 assert(html.includes('）。\n'));assert(html.includes(url.replace('&','&amp;')+'&amp;seed=7'));
 const server=render(url);assert(!server.includes('<a '));assert.equal(render(url),server,'server render is deterministic without window');
});


test('URL-shaped text inside an existing multi-word mention remains one member link',async()=>{
 const {render}=await gameTextHarness(),origin='https://freetwai.com',url=origin+'/play?game=cash&seed=1',name='A '+url;
 const html=render('@'+name+'\n'+url,origin,[{user_id:'synthetic-member',display_name:name}]);
 assert(html.includes('>@A '+url.replace('&','&amp;')+'</button>'));
 assert.equal((html.match(/<a /g)??[]).length,1,'only the standalone challenge is linked');
});
