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
