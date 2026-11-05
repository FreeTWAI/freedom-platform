import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {communityCatalog} from '../../modules/community/catalog.js';
import {getSkillPageContent,skillPageContentIds,skillPageContentProblems,skillShareCardAlt,type SkillPageContent} from '../../modules/community/skill-page-content.js';
import {getSkillShareContent} from '../../modules/community/skill-share-content.js';
import {indexHtml,pageHtml,skillMarkdown,skillPageCss} from '../../modules/development/service.js';
import {SKILL_SHARE_CARD_SIZE,SKILL_SHARE_MANIFEST,skillShareCardSource} from '../../modules/development/skill-share-card.js';
import {wrapFlowText} from '../../modules/development/skill-flow.js';

const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const sha256=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const render=(id:string)=>pageHtml(communityCatalog.skill_books.find(book=>book.id===id)!.title,skillMarkdown(id)!,`/development/skills/${id}.md`);
const sample=():SkillPageContent=>structuredClone(getSkillPageContent('taiwanese-english-checker')!);

test('every catalog book has valid authored page content and no other ids do',async()=>{
 assert.deepEqual([...skillPageContentIds].sort(),communityCatalog.skill_books.map(book=>book.id).sort());
 for(const book of communityCatalog.skill_books){
  const raw=JSON.parse(await readFile(`modules/community/skill-pages/${book.id}.json`,'utf8'));
  assert.deepEqual(skillPageContentProblems(raw),[],book.id);assert.deepEqual(getSkillPageContent(book.id),raw,book.id);
 }
 assert.equal(getSkillPageContent('unknown'),null);
});

test('page content rejects anything the hero, the schematic or the share card could not show whole',()=>{
 const problems=(change:(value:any)=>void)=>{const value:any=sample();change(value);return skillPageContentProblems(value);};
 assert.deepEqual(skillPageContentProblems(sample()),[]);
 for(const [change,expected] of [
  [(value:any)=>{value.extra=1;},/unknown field extra/],
  [(value:any)=>{value.flow.steps[0].extra=1;},/unknown field flow\.steps\[0\]\.extra/],
  [(value:any)=>{value.headline='沒有句號的標語';},/headline must end/],
  [(value:any)=>{value.headline=' 前面有空白。';},/headline must be/],
  [(value:any)=>{value.outcomes.pop();},/exactly 3/],
  [(value:any)=>{value.outcomes[2]=value.outcomes[0];},/outcomes must differ/],
  [(value:any)=>{value.outcomes[1]='看 https://example.com 的說明';},/outcomes\[1\]/],
  [(value:any)=>{value.flow.lead='<b>粗體</b>引言要很長很長';},/flow\.lead/],
  [(value:any)=>{value.flow.loop='yes';},/flow\.loop/],
  [(value:any)=>{value.flow.steps.pop();},/exactly 3 steps/],
  [(value:any)=>{value.flow.steps[1].icon='rocket';},/icon must be one of/],
  [(value:any)=>{value.flow.steps[2].title='這是一個超過十四個字的步驟標題喔';},/flow\.steps\[2\]\.title/],
  [(value:any)=>{value.flow.steps[1].note='短';},/flow\.steps\[1\]\.note/],
 ] as const)assert.match(problems(change).join('\n'),expected);
 assert.deepEqual(skillPageContentProblems(null),['content must be an object']);
});

test('schematic text breaks after punctuation or between words before it splits a CJK run',()=>{
 assert.deepEqual(wrapFlowText('完成一筆測試銷售，再退回其中一項，看庫存、付款與報表怎麼變動。',12.5,272),['完成一筆測試銷售，再退回其中一項，','看庫存、付款與報表怎麼變動。']);
 assert.deepEqual(wrapFlowText('在副本執行 npm test，查看 CLI 如何呼叫共用 client；demo 查詢完成後登出。',12.5,272),['在副本執行 npm test，查看 CLI 如何呼叫共用','client；demo 查詢完成後登出。']);
 assert.deepEqual(wrapFlowText('執行 npm run connect 取得代碼，貼到「我的名片」，核對名稱與讀取範圍後核准。',12.5,272),['執行 npm run connect 取得代碼，貼到','「我的名片」，核對名稱與讀取範圍後核准。']);
 assert.deepEqual(wrapFlowText('跑測試與預覽',15,200),['跑測試與預覽']);
});

test('skill pages use the light layout: hero outcomes, the three-step schematic, then usage and the dark start band',()=>{
 for(const book of communityCatalog.skill_books){
  const html=render(book.id),content=getSkillPageContent(book.id)!;
  assert.ok(html.startsWith('<!doctype html><html lang="zh-Hant" class="skill-page">'),book.id);
  assert.ok(html.includes('<p class="sp-headline"><span>'+escape(content.headline)+'</span></p>'),book.id);
  for(const outcome of content.outcomes)assert.ok(html.includes('<span>'+escape(outcome)+'</span></li>'),book.id+': '+outcome);
  assert.ok(html.includes('<h2 id="skill-flow-title">'+escape(content.flow.title)+'</h2>'),book.id);
  for(const step of content.flow.steps)assert.ok(html.includes('<h3 class="sf-title">'+escape(step.title)+'</h3><p class="sf-note">'+escape(step.note)+'</p>'),book.id+': '+step.title);
  assert.match(html,/<svg class="sf-svg" viewBox="0 0 960 \d+" width="960" height="\d+" aria-hidden="true" focusable="false">/,book.id);
  const order=['class="public-skill-entry"','id="skill-flow-title"','id="skill-use-title"','<h2>開始使用</h2>','class="public-skill-next"','data-share-root','id="join-workshop"','class="public-github-social"'].map(marker=>html.indexOf(marker));
  assert.ok(order.every((index,position)=>index>0&&(position===0||index>order[position-1]!)),book.id+': '+order.join(','));
 }
 assert.doesNotMatch(indexHtml(),/class="skill-page"/);
 assert.doesNotMatch(pageHtml('管理頁','# 管理頁','/development/admin.md'),/class="skill-page"|sp-hero/);
});

test('skill page styles only touch shared elements under html.skill-page and otherwise use sp-/sf- classes',()=>{
 const css=skillPageCss.replace(/\/\*[\s\S]*?\*\//g,''),unscoped:string[]=[];
 const selectors=(list:string)=>{const out:string[]=[];let depth=0,start=0;for(let index=0;index<list.length;index++){const char=list[index];if(char==='(')depth++;else if(char===')')depth--;else if(char===','&&!depth){out.push(list.slice(start,index).trim());start=index+1;}}return [...out,list.slice(start).trim()];};
 let cursor=0;
 const block=(keyframes:boolean):void=>{
  while(cursor<css.length){
   const open=css.indexOf('{',cursor),close=css.indexOf('}',cursor);
   if(close>=0&&(open<0||close<open)){cursor=close+1;return;}
   if(open<0)return;
   const prelude=css.slice(cursor,open).trim();cursor=open+1;
   if(prelude.startsWith('@')){block(/^@(?:-webkit-)?keyframes/.test(prelude));continue;}
   if(!keyframes)unscoped.push(...selectors(prelude).filter(selector=>!selector.startsWith('html.skill-page')&&!/^\.s[pf](?:-|$|[ .:[])/.test(selector)));
   cursor=css.indexOf('}',cursor)+1;
  }
 };
 block(false);assert.deepEqual(unscoped,[]);
});

test('share images are rendered cards whose alt text repeats the name, headline and step titles on them',async()=>{
 const manifest=JSON.parse(await readFile(SKILL_SHARE_MANIFEST,'utf8')),hashes=new Set<string>();
 assert.equal(manifest.assets.length,communityCatalog.skill_books.length);
 for(const book of communityCatalog.skill_books){
  const content=getSkillPageContent(book.id)!,share=getSkillShareContent(book.id)!,source=skillShareCardSource(book.id)!;
  assert.equal(share.illustration_alt,skillShareCardAlt(book.title,content),book.id);
  for(const words of [book.title.split('：')[0]!,content.headline,...content.flow.steps.map(step=>step.title)])assert.ok(share.illustration_alt.includes(words),book.id+': '+words);
  // Step titles on the card may be split by <br>, so compare the text without line breaks or spaces.
  const shown=source.html.replaceAll('<br>','').replace(/\s+/g,'');
  for(const words of [content.headline,...content.flow.steps.map(step=>step.title)])assert.ok(shown.includes(escape(words).replace(/\s+/g,'')),book.id+': '+words);
  const entries=manifest.assets.filter((entry:{id:string})=>entry.id===book.id);assert.equal(entries.length,1,book.id);
  const entry=entries[0],bytes=await readFile(entry.path),metadata=await sharp(bytes).metadata();
  assert.equal(entry.path,'apps/portal-web/public'+share.illustration_url,book.id);assert.equal(source.url,share.illustration_url,book.id);
  assert.equal(entry.mode,'rendered-share-card',book.id);assert.equal(entry.source_sha256,sha256(source.html),book.id+': rerun scripts/render-skill-share-cards.ts');
  assert.equal(metadata.format,'webp');assert.equal(metadata.width,SKILL_SHARE_CARD_SIZE.width);assert.equal(metadata.height,SKILL_SHARE_CARD_SIZE.height);
  assert.equal(entry.bytes,bytes.length,book.id);assert.equal(entry.sha256,sha256(bytes),book.id);
  assert.ok(!hashes.has(entry.sha256),book.id);hashes.add(entry.sha256);
 }
});
