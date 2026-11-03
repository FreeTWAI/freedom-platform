// Renders every catalog book's 1200×630 share image from its authored page content.
// `tsx scripts/render-skill-share-cards.ts [book-id ...]` rewrites those images and their manifest entries;
// with no ids it renders all books. Needs Playwright Chromium and the Noto Sans CJK TC font.
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {communityCatalog} from '../modules/community/catalog.js';
import {SKILL_SHARE_CARD_SIZE,SKILL_SHARE_MANIFEST,skillShareCardSource} from '../modules/development/skill-share-card.js';

type Entry={id:string;path:string;width:number;height:number;bytes:number;sha256:string;source_sha256:string;generated_at:string;mode:string};
const sha256=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
// Plain strings: tsx would wrap inline functions in a __name helper the page does not have.
// document.fonts.check() ignores system fonts, so the probe compares Latin widths with the generic fallback.
const FONT_PROBE=`(()=>{const probe=document.createElement('span');probe.textContent='freetwai.com Skill Book 0123';
 probe.style.cssText='position:absolute;white-space:nowrap;font:700 40px monospace';document.body.append(probe);
 const fallback=probe.getBoundingClientRect().width;probe.style.fontFamily='"Noto Sans CJK TC",monospace';
 const width=probe.getBoundingClientRect().width;probe.remove();return width!==fallback;})()`;
// Shrinks each data-fit element one pixel at a time until it fits its line budget, never below data-min.
const FIT_TEXT=`(()=>{const failures=[];
 for(const element of document.querySelectorAll('[data-fit]')){
  const lines=Number(element.dataset.fit),min=Number(element.dataset.min);let size=parseFloat(getComputedStyle(element).fontSize);
  const tall=()=>element.getBoundingClientRect().height>lines*parseFloat(getComputedStyle(element).lineHeight)+1;
  while(tall()&&size>min){size-=1;element.style.fontSize=size+'px';}
  if(tall())failures.push(element.textContent);
 }
 const card=document.querySelector('.card');
 if(card.scrollHeight>card.clientHeight||card.scrollWidth>card.clientWidth)failures.push('card overflow');
 return failures;})()`;
const requested=process.argv.slice(2);
const books=communityCatalog.skill_books.filter(book=>!requested.length||requested.includes(book.id));
if(requested.length&&books.length!==requested.length)throw new Error('unknown book id in: '+requested.join(', '));
const manifest=JSON.parse(await readFile(SKILL_SHARE_MANIFEST,'utf8')) as {assets:Entry[]}&Record<string,unknown>;
const today=new Date().toISOString().slice(0,10);
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{...SKILL_SHARE_CARD_SIZE},deviceScaleFactor:1});
 for(const book of books){
  const source=skillShareCardSource(book.id);
  if(!source)throw new Error(book.id+': no valid page content');
  await page.setContent(source.html,{waitUntil:'load'});
  await page.evaluate('document.fonts.ready');
  // A fallback font would change every card's glyph widths and look; refuse instead of guessing.
  if(!await page.evaluate(FONT_PROBE))throw new Error('Noto Sans CJK TC is not installed');
  const fit=await page.evaluate(FIT_TEXT) as string[];
  if(fit.length)throw new Error(book.id+': text does not fit: '+fit.join(' | '));
  const png=await page.screenshot({type:'png',clip:{x:0,y:0,...SKILL_SHARE_CARD_SIZE}});
  const webp=await sharp(png).webp({quality:90,effort:6,smartSubsample:true}).toBuffer();
  const path=`apps/portal-web/public${source.url}`;
  await writeFile(path,webp);
  const entry:Entry={id:book.id,path,...SKILL_SHARE_CARD_SIZE,bytes:webp.length,sha256:sha256(webp),source_sha256:sha256(source.html),generated_at:today,mode:'rendered-share-card'};
  const index=manifest.assets.findIndex(item=>item.id===book.id);
  if(index<0)manifest.assets.push(entry);else manifest.assets[index]=entry;
  console.log(book.id,webp.length);
 }
}finally{await browser.close();}
manifest.assets.sort((a,b)=>communityCatalog.skill_books.findIndex(book=>book.id===a.id)-communityCatalog.skill_books.findIndex(book=>book.id===b.id));
await writeFile(SKILL_SHARE_MANIFEST,JSON.stringify({...manifest,updated_at:today},null,2)+'\n');
