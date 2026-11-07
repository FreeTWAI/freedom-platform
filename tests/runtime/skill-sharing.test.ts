import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {communityCatalog} from '../../modules/community/catalog.js';
import {getSkillShareContent} from '../../modules/community/skill-share-content.js';
import {developmentShareJs,pageHtml,publicSkillShareMarkup,publicSkillDestinations,shareIntroNumber,sharePlatformUrl,skillMarkdown} from '../../modules/development/service.js';

const id='video-autopilot',base='https://freetwai.com/development/skills/'+id;
const book=communityCatalog.skill_books.find(value=>value.id===id)!;
const content=getSkillShareContent(id)!;
const unescape=(value:string)=>value.replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const render=(intro?:string,bookId=id)=>{const value=communityCatalog.skill_books.find(item=>item.id===bookId)!;return pageHtml(value.title,skillMarkdown(bookId)!,`/development/skills/${bookId}.md`,undefined,null,undefined,intro);};
const meta=(html:string,key:string)=>new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)">`).exec(html)?.[1];
const attribute=(html:string,name:string)=>unescape(new RegExp(`${name}="([^"]*)"`).exec(html)![1]);

test('every catalog book has 100 authored introductions and a landscape illustration in its public page',()=>{
 for(const item of communityCatalog.skill_books){
  const data=getSkillShareContent(item.id);assert.ok(data,item.id);assert.equal(data.introductions.length,100,item.id);
  const html=render(undefined,item.id);
  assert.equal(meta(html,'og:image'),'https://freetwai.com'+data.illustration_url,item.id);
  assert.deepEqual(JSON.parse(attribute(html,'data-share-content')),data.introductions,item.id);
 }
 assert.equal(getSkillShareContent('unknown'),null);
});

test('a valid intro query selects exactly that introduction for description, OG and the visible quote',()=>{
 const html=render('7'),intro=content.introductions[6];
 assert.equal(unescape(meta(html,'description')!),intro);assert.equal(unescape(meta(html,'og:description')!),intro);
 assert.ok(html.includes('<blockquote class="public-share-intro"><p>'+escape(intro)+'</p>'));
 assert.equal(meta(html,'og:url'),base+'?intro=7');
 assert.match(html,new RegExp(`<link rel="canonical" href="${base}">`));
 assert.equal(attribute(html,'data-share-selected'),'7');
 assert.equal(unescape(meta(render('100'),'og:description')!),content.introductions[99]);
});

test('invalid intro queries fall back to the book summary without selecting anything',()=>{
 for(const raw of [undefined,'','0','101','07','+7',' 7','7 ','7.0','1e1','0x7','abc','-1','99999999999','７']){
  const html=render(raw);
  assert.equal(unescape(meta(html,'description')!),book.guide!.beginner.purpose,String(raw));
  assert.equal(meta(html,'og:url'),base,String(raw));assert.equal(attribute(html,'data-share-selected'),'',String(raw));
  assert.ok(!html.includes('public-share-intro'),String(raw));
 }
 assert.equal(shareIntroNumber('1',100),1);assert.equal(shareIntroNumber('100',100),100);assert.equal(shareIntroNumber('100',99),null);assert.equal(shareIntroNumber('3',0),null);
});

test('OG and Twitter retain the 1200×630 share card while the page uses its readable flow',()=>{
 const html=render();const image='https://freetwai.com'+content.illustration_url;
 assert.match(content.illustration_url,/^\/brand\/skill-illustrations\/video-autopilot\.webp$/);
 assert.equal(meta(html,'og:image'),image);assert.equal(meta(html,'og:image:width'),'1200');assert.equal(meta(html,'og:image:height'),'630');
 assert.equal(unescape(meta(html,'og:image:alt')!),content.illustration_alt);assert.ok(content.illustration_alt.trim().length>0);
 assert.equal(meta(html,'twitter:card'),'summary_large_image');assert.equal(meta(html,'twitter:image'),image);assert.equal(unescape(meta(html,'twitter:image:alt')!),content.illustration_alt);
 assert.ok(html.includes(`src="${book.cover_url}"`));
 assert.ok(html.includes('class="sf-legend"'));assert.doesNotMatch(html,/<figure class="public-skill-illustration"/);
 assert.match(html,/<script src="\/development-share\.js" defer><\/script>/);assert.doesNotMatch(html,/<script(?! src=)|onclick=|onerror=/);
 assert.ok(html.includes('<dialog class="public-share-dialog"'));assert.ok(html.includes('換一句'));assert.ok(html.includes('複製介紹與連結'));
});

type Fake=Record<string,any>;
const platforms=['line','facebook','x','threads'] as const;
const platformLinks=(html:string)=>[...html.matchAll(/<a href="([^"]*)" target="_blank" rel="noopener noreferrer" data-share-platform="([a-z]+)"/g)].map(match=>[match[2],unescape(match[1]!)]);
function element(extra:Fake={}):Fake{
 return {hidden:false,disabled:false,textContent:'',value:'',focused:false,selected:false,listeners:{} as Record<string,()=>void>,
  addEventListener(name:string,fn:()=>void){this.listeners[name]=fn;},focus(){this.focused=true;},select(){this.selected=true;},click(){this.listeners.click({preventDefault(){}});},...extra};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(html:string,navigator:Fake,random?:number[]){
 const draws:number[]=[],hero=element();
 const dialog=element({open:false,showModal(){this.open=true;},close(){this.open=false;this.listeners.close?.();}});
 const nodes:Record<string,Fake>={'[data-share-dialog]':dialog};
 for(const name of ['open','text','count','url','error','status','manual','manual-label','reroll','send','copy','close'])nodes[`[data-share-${name}]`]??=element();
 nodes['[data-share-manual-label]'].hidden=true;
 const links=platforms.map(platform=>element({dataset:{sharePlatform:platform},href:''}));
 const root={dataset:{shareBase:attribute(html,'data-share-base'),shareTitle:attribute(html,'data-share-title'),shareSelected:attribute(html,'data-share-selected'),shareContent:attribute(html,'data-share-content')},querySelector:(selector:string)=>nodes[selector],
  querySelectorAll:(selector:string)=>selector==='[data-share-dialog] [data-share-platform]'?links:[]};
 const crypto={getRandomValues(buffer:Uint32Array){const value=random?.length?random.shift()!:Math.floor(Math.random()*0x100000000);draws.push(value);buffer[0]=value;return buffer;}};
 runInNewContext(developmentShareJs,{document:{querySelectorAll:(selector:string)=>selector==='[data-share-root]'?[root]:selector==='[data-share-launch]'?[hero]:[]},navigator,window:{crypto},Uint32Array,Promise,JSON,Number,Array,Math});
 const get=(name:string)=>nodes[`[data-share-${name}]`];
 return {get,dialog,draws,hero,links:()=>links.map(link=>link.href as string),intro:()=>get('text').textContent as string,url:()=>get('url').textContent as string};
}

test('opening the public preview never sends, uses rejection-sampled crypto randomness and rerolls without repeating',async()=>{
 let sent=0,copied=0;
 const page=harness(render(),{share:async()=>{sent++;},clipboard:{writeText:async()=>{copied++;}}},[0xffffffff,5,5]);
 page.get('open').click();await flush();
 assert.equal(page.dialog.open,true);assert.equal(sent,0);assert.equal(copied,0);
 assert.deepEqual(page.draws,[0xffffffff,5]);assert.equal(page.intro(),content.introductions[5]);assert.equal(page.url(),base+'?intro=6');
 page.get('reroll').click();assert.equal(page.intro(),content.introductions[6]);assert.equal(page.url(),base+'?intro=7');
 for(let index=0;index<300;index++){const before=page.url();page.get('reroll').click();assert.notEqual(page.url(),before);assert.ok(page.url().startsWith(base+'?intro='));}
 assert.equal(sent,0);assert.equal(copied,0);
 page.get('close').click();assert.equal(page.dialog.open,false);assert.equal(page.get('open').focused,true);
});

test('a selected intro query is the initial preview; copy and native share send that exact text and URL',async()=>{
 let shared:any,copied='';
 const page=harness(render('42'),{share:async(value:any)=>{shared=value;},clipboard:{writeText:async(value:string)=>{copied=value;}}});
 page.get('open').click();assert.equal(page.draws.length,0);assert.equal(page.intro(),content.introductions[41]);
 page.get('copy').click();await flush();
 assert.equal(copied,content.introductions[41]+'\n'+base+'?intro=42');assert.equal(page.get('status').textContent,'已複製介紹與連結');
 page.get('send').click();await flush();
 assert.deepEqual({...shared},{title:book.title+' · 自由工坊',url:base+'?intro=42',text:content.introductions[41]});assert.equal(page.get('status').textContent,'分享已送出');
});

test('LINE, Facebook, X and Threads links share the visible introduction and URL, and the preview links follow each reroll',async()=>{
 const url=base+'?intro=42',text=content.introductions[41]!,enc=encodeURIComponent;
 assert.equal(sharePlatformUrl('line',url,text),'https://social-plugins.line.me/lineit/share?url='+enc(url)+'&text='+enc(text));
 assert.equal(sharePlatformUrl('facebook',url,text),'https://www.facebook.com/sharer/sharer.php?u='+enc(url));
 assert.equal(sharePlatformUrl('x',url,text),'https://twitter.com/intent/tweet?text='+enc(text+'\n'+url));
 assert.equal(sharePlatformUrl('threads',url,text),'https://www.threads.com/intent/post?text='+enc(text+'\n'+url));
 const expected=(link:string,words:string)=>platforms.map(platform=>[platform,sharePlatformUrl(platform,link,words)]);
 // The page row and the preview row start from the same selected payload.
 assert.deepEqual(platformLinks(render('42')),[...expected(url,text),...expected(url,text)]);
 assert.deepEqual(platformLinks(render()),[...expected(base,book.title+' · 自由工坊'),...expected(base,book.title+' · 自由工坊')]);
 const page=harness(render('42'),{});
 page.get('open').click();assert.deepEqual(page.links(),expected(url,text).map(([,href])=>href));
 page.get('reroll').click();const rolled=page.url(),intro=page.intro();assert.notEqual(rolled,url);
 assert.deepEqual(page.links(),expected(rolled,intro).map(([,href])=>href));
 const empty=harness(render().replace(/data-share-content="[^"]*"/,'data-share-content="[]"'),{});
 empty.get('open').click();assert.deepEqual(empty.links(),expected(base,book.title+' · 自由工坊').map(([,href])=>href));
});

test('native cancel stays quiet without copying; other failures and denied clipboard expose the selected manual payload',async()=>{
 let copied=0;
 const canceled=harness(render('3'),{share:async()=>{throw {name:'AbortError'};},clipboard:{writeText:async()=>{copied++;}}});
 canceled.get('open').click();canceled.get('send').click();await flush();
 assert.equal(canceled.get('status').textContent,'');assert.equal(copied,0);assert.equal(canceled.get('manual-label').hidden,true);assert.equal(canceled.get('send').disabled,false);
 const failed=harness(render('3'),{share:async()=>{throw new Error('blocked');},clipboard:{writeText:async()=>{copied++;}}});
 failed.get('open').click();failed.get('send').click();await flush();
 const payload=content.introductions[2]+'\n'+base+'?intro=3';
 assert.equal(copied,0);assert.equal(failed.get('manual-label').hidden,false);assert.equal(failed.get('manual').value,payload);
 assert.equal(failed.get('manual').focused,true);assert.equal(failed.get('manual').selected,true);assert.doesNotMatch(failed.get('status').textContent,/已/);
 failed.get('reroll').click();assert.equal(failed.get('manual-label').hidden,true);assert.equal(failed.get('status').textContent,'');
 let written='';const noShare=harness(render('3'),{clipboard:{writeText:async(value:string)=>{written=value;}}});
 noShare.get('open').click();noShare.get('send').click();await flush();assert.equal(written,payload);
 const denied=harness(render('3'),{clipboard:{writeText:async()=>{throw new Error('denied');}}});
 denied.get('open').click();denied.get('copy').click();await flush();
 assert.equal(denied.get('manual').value,payload);assert.equal(denied.get('manual').selected,true);assert.equal(denied.get('manual-label').hidden,false);
 const missing=harness(render('3'),{});missing.get('open').click();missing.get('copy').click();await flush();assert.equal(missing.get('manual').value,payload);
});

test('pages without usable introductions still share the plain link and show a readable error',async()=>{
 const html=render().replace(/data-share-content="[^"]*"/,'data-share-content="[]"');
 let shared:any;const page=harness(html,{share:async(value:any)=>{shared=value;}});
 page.get('open').click();
 assert.equal(page.get('error').hidden,false);assert.equal(page.get('reroll').hidden,true);assert.equal(page.url(),base);assert.equal(page.get('send').textContent,'分享連結');
 page.get('send').click();await flush();assert.deepEqual({...shared},{title:book.title+' · 自由工坊',url:base});
 assert.ok(render().includes('這本技能書的介紹暫時無法載入'));
});

test('published submissions reuse the same preview with escaped content and their own public path',async()=>{
 const path='/development/submissions/11d6f096-a7c3-4ddf-a2e4-5e19744937d0',intro='介紹 "單一技能" <script>window.wrong=true</script> & 保留原文';
 const html=publicSkillShareMarkup({title:'工具 <img src=x> "介紹"',path,introductions:[intro],selected:1});
 assert.doesNotMatch(html,/<script|<img/);assert.equal(attribute(html,'data-share-title'),'工具 <img src=x> "介紹"');
 assert.deepEqual(JSON.parse(attribute(html,'data-share-content')),[intro]);
 let written='';const page=harness(html,{clipboard:{writeText:async(value:string)=>{written=value;}}});
 page.get('open').click();assert.equal(page.get('reroll').hidden,true);assert.equal(page.intro(),intro);
 page.get('copy').click();await flush();assert.equal(written,intro+'\nhttps://freetwai.com'+path+'?intro=1');
});

test('late share completion cannot restore status after the preview closes; synchronous clipboard failures remain selectable',async()=>{
 let finish!:()=>void;const page=harness(render('2'),{share:()=>new Promise<void>(resolve=>{finish=resolve;})});
 page.get('open').click();page.get('send').click();page.get('close').click();finish();await flush();
 assert.equal(page.dialog.open,false);assert.equal(page.get('status').textContent,'');assert.equal(page.get('manual-label').hidden,true);
 const denied=harness(render('2'),{clipboard:{writeText:()=>{throw new Error('denied');}}});
 denied.get('open').click();denied.get('copy').click();await flush();
 assert.equal(denied.get('manual').value,content.introductions[1]+'\n'+base+'?intro=2');assert.equal(denied.get('manual').selected,true);assert.equal(denied.get('copy').disabled,false);
});


test('all catalog introductions show authored usage and source before collaboration, with explicit destinations',()=>{
 for(const item of communityCatalog.skill_books){
  const html=render(undefined,item.id),guide=item.guide!;
  const introduction=html.slice(html.indexOf('<section class="public-skill-introduction"'),html.indexOf('<section class="public-skill-next"'));
  for(const value of [...guide.audience,guide.status,...guide.features,...guide.prerequisites,...guide.first_steps,guide.first_result])assert.ok(introduction.includes(escape(value)),item.id+': '+value);
  assert.ok(html.indexOf('<h2>開始使用</h2>')<html.indexOf('<h2 id="collaboration-title">'),item.id);
  assert.ok(html.includes('到 GitHub 看原始碼 ↗'),item.id);
  assert.ok(html.includes('<bdi>'+escape(new URL(item.upstream_url).host+new URL(item.upstream_url).pathname)+'</bdi>'),item.id);
  assert.ok(html.includes('class="sf-legend"'),item.id);
  assert.ok(html.includes('<dt>指南核對版本</dt><dd><code>'+escape(guide.source_commit)),item.id);
 }
});

test('destination cards reject executable/credential URLs and display the parsed host, not a claimed label',()=>{
 for(const url of ['javascript:alert(1)','data:text/html,hello','//example.com/','https://github.com@attacker.example/','not a URL'])assert.equal(publicSkillDestinations([{url,kind:'source'}]),'');
 const html=publicSkillDestinations([{url:'https://github.com.attacker.example/owner/repo?x=%22%3E#readme',kind:'source'}]);
 assert.ok(html.includes('查看原作原始碼'));assert.ok(!html.includes('到 GitHub 看原始碼'));
 assert.ok(html.includes('<bdi>github.com.attacker.example/owner/repo</bdi>'));
 assert.ok(html.includes('rel="noopener noreferrer"'));assert.ok(!html.includes('http-equiv="refresh"'));
});


test('catalog skill CTA follows readable content and preserves the selected introduction without discovery',()=>{
 const html=render('7');
 assert.ok(html.indexOf('id="skill-use-title"')<html.indexOf('id="join-workshop"'));
 assert.ok(html.includes('不用註冊就能閱讀'));assert.ok(html.includes('免費加入，探索更多資源'));
 assert.ok(html.includes('return_to=%2Fdevelopment%2Fskills%2F'+id+'&amp;skill_intro=7'));
 assert.ok(html.includes('<script src="/skill-acquisition.js" defer></script>'));
 assert.ok(html.includes('href="/#skills">登入工坊 Star'), 'original author-support entry remains available');
 assert.ok(html.includes('到 GitHub 看原始碼'));assert.equal(meta(html,'og:url'),base+'?intro=7');
});


test('every public skill offers author, Star, Fork and share in the hero while retaining instructions and destinations',()=>{
 for(const item of communityCatalog.skill_books){
  const html=render(undefined,item.id);
  const reading=html.indexOf('<section class="public-skill-introduction"');
  const destinations=html.indexOf('<section class="public-skill-next"');
  const share=html.indexOf('data-share-root');
  const social=html.indexOf('<section class="public-github-social"');
  assert.ok(reading>0&&destinations>reading,item.id);
  assert.ok(share>destinations&&social>0&&social<reading,item.id);
  assert.ok(html.indexOf('data-skill-author')<social,item.id);
  assert.ok(html.indexOf('data-share-launch')<reading,item.id);
  assert.ok(html.indexOf('href="#skill-start"')<reading,item.id);
  assert.ok(html.includes('href="/#skills">登入工坊 Star'),item.id);
  assert.ok(html.includes(escape(item.guide!.first_result)),item.id);
 }
});

test('hero sharing uses the same selected introduction and returns focus to the hero trigger',()=>{
 const page=harness(render('63'),{});
 page.hero.click();assert.equal(page.dialog.open,true);assert.equal(page.intro(),content.introductions[62]);
 page.get('close').click();assert.equal(page.hero.focused,true);
 page.get('open').click();assert.equal(page.intro(),content.introductions[62]);
 page.get('close').click();assert.equal(page.get('open').focused,true);
});
