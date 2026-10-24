import {test as browserTest} from '@playwright/test';
import {journalMedia} from '../../modules/community-journal/media.js';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {test,expect} from './fixtures.js';
const shots='test-results/community-journal';mkdirSync(shots,{recursive:true});
const person={slug:'demo',display_name:'合成測試人物',intro:'這是瀏覽器驗證用的合成人物介紹。',kind:'person',color:'#c9ded6',avatar:{url:null,display_fit:'contain',object_position:'50% 50%'},role:'測試協作者',category:'共創',tags:['測試']};
const journal=(date:string)=>({date,title:'把想法留在同一張桌上，一起接著做',excerpt:'合成測試內容，用來驗證原版型、閱讀與導覽。',version:1,coverage:{is_partial:true},blocks:[{type:'heading',text:'今天的討論'},{type:'paragraph',text:'我們整理了需要繼續確認的事情。'.repeat(20)},{type:'list',items:['合成測試項目一','合成測試項目二']}],development_items:[{id:'demo',title:'合成開發項目',next_step:'下一步仍待確認',status:'proposed'}],decisions:[],people:[person],hero:null});
const sources=Array.from({length:6},(_,i)=>({time:`2026-10-22T12:0${i}:00+08:00`,text:`合成原話 ${i+1}${i===0?' https://github.com/example/demo.git?tracking=fixture#readme':''}`,sender_name:person.display_name,sender_avatar:{url:'/media/public/'+[...journalMedia][0],display_fit:'contain',object_position:'50% 50%'},source_key:String(i).repeat(64),person_slug:'demo'}));
const enriched=(date:string)=>({...journal(date),reading_note:{conclusion:'這是本篇合成結論',priority_todo:'先驗證來源與連結',discussion_question:''},blocks:[{type:'heading',text:'今天的討論',source_messages:sources.map(m=>({...m,time:m.time.replace('2026-10-22',date)}))},{type:'paragraph',text:'這是合成研究來源 https://example.org/reference ，保持可點。'},{type:'quote',text:'合成引文 https://example.org/quote'},{type:'list',items:['列表來源 https://example.org/list']}],development_items:[0,1,2].map(i=>({id:'demo-'+i,title:'合成開發項目'+i,next_step:'下一步仍待確認',status:'proposed'}))});
const snapshot={data:{people:[person],journals:[enriched('2026-10-22'),enriched('2026-10-21')]}};
const activity={data:{scope:'published_sources',range:{start:'2026-10-16',end:'2026-10-22',time_zone:'Asia/Taipei'},people:[{slug:'demo',count:6}],messages:sources.map((m,i)=>({key:m.source_key,person_slug:m.person_slug,time:m.time,text:m.text,journal_date:'2026-10-22',chapter_id:'section-0',topic:i<5?'今天的討論':'另一個話題'})),unattributed_count:0}};
test.use({timezoneId:'America/Los_Angeles'});
for(const [width,height] of [[1440,1000],[360,780],[375,667],[390,844],[430,932],[390,420]]){
 test(`native journal layout, calendar, article and complete member page ${width}x${height}`,async({page})=>{
  await page.setViewportSize({width,height});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/v1/public/journal',r=>r.fulfill({json:snapshot}));await page.route('**/api/v1/public/journal/activity?*',r=>r.fulfill({json:activity}));
  await page.goto('/journal');await expect(page.getByRole('heading',{name:/讓好點子，\s*在這裡繼續。/})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.locator('.project-card')).toHaveCount(2);await expect(page.locator('.activity-rank')).toHaveCount(1);
  await page.getByRole('button',{name:'日期索引'}).click();await expect(page.getByRole('button',{name:'收起月曆'})).toBeVisible();
  await page.locator('#journal-calendar').getByRole('button',{name:'2026-10-21日誌',exact:true}).click();
  await page.getByRole('link',{name:'走進這一天'}).click();await expect(page).toHaveURL(/\/journal\/entries\/2026-10-21$/);
  await expect(page.getByRole('heading',{name:'今天的討論'})).toBeVisible();
  await expect(page.getByRole('region',{name:'整理便箋'})).toContainText('這是本篇合成結論');await expect(page.getByText('待討論問題',{exact:true})).toHaveCount(0);
  await expect(page.locator('.source-messages')).not.toHaveAttribute('open','');await page.getByRole('button',{name:'第 01 段原始訊息'}).click();await expect(page.locator('.source-messages')).toHaveAttribute('open','');
  await expect(page.locator('.source-chat-row')).toHaveCount(6);await expect(page.locator('.source-chat-content time').first()).toContainText('2026-10-20 21:00 GMT-7');
  await expect(page.getByRole('navigation',{name:'相關倉庫'}).getByRole('link')).toHaveAttribute('href','https://github.com/example/demo');
  for(const link of await page.locator('.chapter a[target="_blank"]').all()){await expect(link).toHaveAttribute('rel','noopener noreferrer');await expect(link).toHaveAttribute('referrerpolicy','no-referrer');}
  await page.locator('.source-messages summary').click();await expect(page.getByRole('button',{name:'第 01 段原始訊息'})).toHaveAttribute('aria-expanded','false');
  await expect(page.locator('.date-section')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`${shots}/article-${width}-${height}.png`,fullPage:true});
  await page.goto('/journal/people');await expect(page.getByRole('heading',{name:/不同的我們，\s*一起把事情做好。/})).toBeVisible();
  await page.getByRole('link',{name:'看成員資料'}).click();await expect(page.getByRole('heading',{name:'合成測試人物',exact:true})).toBeVisible();await expect(page.locator('.member-quote')).toHaveCount(5);
  await page.getByRole('button',{name:'下一頁',exact:true}).click();await expect(page.locator('.member-quote')).toHaveCount(1);await expect(page.getByRole('navigation',{name:'原話分頁'})).toContainText('第 2 / 2 頁');
  await page.getByRole('button',{name:/今天的討論 5/}).click();await expect(page.locator('.member-quote')).toHaveCount(5);await expect(page.getByRole('navigation',{name:'原話分頁'})).toHaveCount(0);
  await page.getByRole('button',{name:'近 30 天',exact:true}).click();await expect(page.locator('.member-quote')).toHaveCount(5);await expect(page.getByRole('navigation',{name:'原話分頁'})).toContainText('第 1 / 2 頁');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`${shots}/profile-${width}-${height}.png`,fullPage:true});
  await page.getByRole('link',{name:'← 所有夥伴'}).click();await expect(page).toHaveURL(/\/journal\/people$/);
  await page.getByRole('textbox',{name:'搜尋共創者'}).fill('沒有這位');await expect(page.getByRole('heading',{name:'暫時沒找到這位夥伴。'})).toBeVisible();
  await page.getByRole('button',{name:'顯示所有人'}).click();await expect(page.getByRole('link',{name:'看成員資料'})).toBeVisible();
  await page.screenshot({path:`${shots}/people-${width}-${height}.png`,fullPage:true});
  expect(errors).toEqual([]);await expect(page.locator('iframe')).toHaveCount(0);
 });
}
test('native journal error can retry, empty publication is explicit, unknown routes stay inside journal',async({page})=>{
 let fail=true;await page.route('**/api/v1/public/journal',r=>fail?r.fulfill({status:503,json:{error:'unavailable'}}):r.fulfill({json:{data:{people:[],journals:[]}}}));
 await page.goto('/journal');await expect(page.getByRole('alert')).toContainText('暫時讀不到資料');fail=false;await page.getByRole('button',{name:'重新讀取'}).click();await expect(page.getByRole('heading',{name:'還沒有日誌。'})).toBeVisible();
 await page.goto('/journal/missing');await expect(page.getByRole('heading',{name:'找不到這個頁面。'})).toBeVisible();
});
test('text remains readable at 200 percent without clipping the reading column',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.route('**/api/v1/public/journal',r=>r.fulfill({json:snapshot}));await page.goto('/journal/entries/2026-10-22');await expect(page.getByRole('heading',{name:'今天的討論'})).toBeVisible();await page.locator('.article-content p,.article-content li').evaluateAll(elements=>{for(const element of elements)(element as HTMLElement).style.fontSize=(parseFloat(getComputedStyle(element).fontSize)*2)+'px';});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('assigned editor can issue a key, review, publish and withdraw an API submission',async({page,e2eAuthPool})=>{
 const base=String(test.info().project.use.baseURL||'http://127.0.0.1:'+ (process.env.FREEDOM_E2E_PORT||'4311'));
 const login=await page.request.post('/api/v1/auth/login',{headers:{Origin:base,'Idempotency-Key':randomUUID()},data:{email:'maker@local.test',password:'freedom-local-demo'}});expect(login.status()).toBe(200);const session=await login.json();
 const owner=(await e2eAuthPool.query('SELECT user_id,community_id FROM users WHERE user_id=$1',[session.user.user_id])).rows[0];
 await e2eAuthPool.query('DELETE FROM community_journal_publisher');
 await e2eAuthPool.query('INSERT INTO community_journal_publisher(community_id,owner_ref) VALUES($1,$2)',[owner.community_id,owner.user_id]);
 try{
  await page.goto('/journal/manage');await page.getByRole('button',{name:'建立 30 天投稿金鑰'}).click();
  const secret=await page.locator('code').filter({hasText:/^fjp_/}).innerText();expect(secret).toMatch(/^fjp_/);
  await page.getByRole('button',{name:'已保存，隱藏金鑰'}).click();await expect(page.getByText(secret,{exact:true})).toHaveCount(0);
  const p={...person,avatar:{...person.avatar,url:'/media/public/'+[...journalMedia][0],alt:'合成人物',width:null,height:null}};
  const body={schema_version:1,source_revision:'a'.repeat(64),people:[p],journals:[{...enriched('2026-10-22'),people:[p]},{...enriched('2026-10-21'),people:[p],blocks:enriched('2026-10-21').blocks.map(b=>b.type==='heading'?{...b,source_messages:sources.map((m,i)=>({...m,time:m.time.replace('2026-10-22','2026-10-21'),source_key:String(i+6).padStart(64,'0')}))}:b)}]};
  const sent=await page.request.post('/agent-api/v1/journal-submissions',{headers:{Authorization:'Bearer '+secret,'Idempotency-Key':randomUUID()},data:body});expect(sent.status()).toBe(201);
  await page.reload();await page.getByRole('button',{name:'查看內容',exact:true}).click();await expect(page.getByRole('heading',{name:'今天的討論'})).toBeVisible();
  await expect(page.getByRole('region',{name:'整理便箋'})).toContainText('這是本篇合成結論');
  await page.getByRole('button',{name:'2026-10-21日誌',exact:true}).click();await expect(page).toHaveURL(/\/journal\/manage$/);await expect(page.locator('.source-messages')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'發布這個版本'})).toBeDisabled();await page.getByRole('checkbox').check();await page.getByRole('button',{name:'發布這個版本'}).click();
  await expect(page.getByRole('button',{name:'撤回目前公開版本'})).toBeVisible();
  const published=await page.request.get('/api/v1/public/journal');expect((await published.json()).data.journals).toHaveLength(2);
  await page.getByRole('button',{name:'撤回目前公開版本'}).click();await expect(page.getByRole('button',{name:'撤回目前公開版本'})).toHaveCount(0);
  expect((await (await page.request.get('/api/v1/public/journal')).json()).data.journals).toHaveLength(0);
 }finally{await e2eAuthPool.query('DELETE FROM community_journal_publisher');}
});

for(const stage of ['state','key','detail'] as const){
 browserTest(`private editor ignores delayed ${stage} response after session denial`,async({page})=>{
  const submission={submission_id:'old-draft',source_revision:'a'.repeat(64),payload_sha256:'b'.repeat(64),status:'ready_for_review',created_at:'OLD-PRIVATE-DRAFT'};
  const oldState={aggregate_version:'1',published_submission_id:null,keys:[{key_id:'old-key',label:'OLD-PRIVATE-KEY',expires_at:'2099-01-01',revoked_at:null}],submissions:[submission]};
  let denied=false,stateReads=0;let release!:()=>void,started!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),waiting=new Promise<void>(resolve=>{started=resolve;});
  await page.route('**/api/v1/session',route=>denied?route.fulfill({status:401,json:{detail:'SESSION-DENIED'}}):route.fulfill({json:{user:{user_id:'old-actor'},csrf_token:'old-csrf'}}));
  await page.route('**/api/v1/me/community-journal**',async route=>{
   const path=new URL(route.request().url()).pathname;
   const delayed=stage==='detail'?path.endsWith('/submissions/old-draft'):stage==='key'?path.endsWith('/keys'):path.endsWith('/community-journal')&&++stateReads===2;
   if(delayed){started();await gate;}
   if(path.endsWith('/keys'))return route.fulfill({json:{token:'fjp_LATE_PRIVATE_SECRET'}});
   if(path.endsWith('/submissions/old-draft'))return route.fulfill({json:{...submission,payload:{...snapshot.data,journals:[{...journal('2026-10-22'),title:'LATE-PRIVATE-ARTICLE'}]}}});
   return route.fulfill({json:oldState});
  });
  await page.goto('/journal/manage');await expect(page.getByText('OLD-PRIVATE-KEY',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:stage==='detail'?'查看內容':'建立 30 天投稿金鑰',exact:true}).click();await waiting;
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  denied=true;
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(page.getByRole('alert')).toContainText('SESSION-DENIED');
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/me/community-journal'+(stage==='key'?'/keys':stage==='detail'?'/submissions/old-draft':''));
  release();await (await response).finished();
  // Wait for React's render after the held response, not a fixed timeout.
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await expect(page.getByText('OLD-PRIVATE-KEY',{exact:false})).toHaveCount(0);await expect(page.getByText('OLD-PRIVATE-DRAFT',{exact:false})).toHaveCount(0);
  await expect(page.getByText('fjp_LATE_PRIVATE_SECRET',{exact:false})).toHaveCount(0);await expect(page.getByRole('heading',{name:'LATE-PRIVATE-ARTICLE'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'建立 30 天投稿金鑰',exact:true})).toHaveCount(0);await expect(page.getByRole('alert')).toContainText('SESSION-DENIED');
 });
}

browserTest('private editor refuses an action result belonging to the previous actor',async({page})=>{
 let actor='old-actor';
 await page.route('**/api/v1/session',r=>r.fulfill({json:{user:{user_id:actor},csrf_token:actor+'-csrf'}}));
 await page.route('**/api/v1/me/community-journal',r=>r.fulfill({json:{aggregate_version:'1',published_submission_id:null,keys:[],submissions:[]}}));
 await page.route('**/api/v1/me/community-journal/keys',async r=>{actor='new-actor';await r.fulfill({json:{token:'fjp_PREVIOUS_ACTOR_SECRET'}});});
 await page.goto('/journal/manage');await page.getByRole('button',{name:'建立 30 天投稿金鑰',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('登入狀態已變更');await expect(page.getByText('fjp_PREVIOUS_ACTOR_SECRET',{exact:false})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'建立 30 天投稿金鑰',exact:true})).toHaveCount(0);
});

test('activity clears stale counts while a different period loads and fails',async({page})=>{
 await page.route('**/api/v1/public/journal',r=>r.fulfill({json:snapshot}));
 let release!:()=>void;const delayed=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/v1/public/journal/activity?*',async r=>{if(r.request().url().endsWith('period=month')){await delayed;await r.fulfill({status:503,json:{error:'unavailable'}});}else await r.fulfill({json:activity});});
 await page.goto('/journal/people/demo');await expect(page.locator('.member-quote')).toHaveCount(5);
 await page.getByRole('button',{name:'近 30 天',exact:true}).click();await expect(page.getByRole('status')).toContainText('正在讀取發言');await expect(page.locator('.member-quote')).toHaveCount(0);await expect(page.locator('.member-numbers')).toContainText('—');
 release();await expect(page.getByRole('alert')).toContainText('暫時讀不到發言');await expect(page.locator('.member-quote')).toHaveCount(0);
 await page.getByRole('button',{name:'近 7 天',exact:true}).click();await expect(page.locator('.member-quote')).toHaveCount(5);await expect(page.getByRole('alert')).toHaveCount(0);
});


browserTest('article anchors omit enclosing parentheses and preserve balanced URL parentheses',async({page})=>{
 const content='參考 (https://example.org/reference). 詳情 (https://example.org/wiki/Topic_(detail)).';
 const entry={...journal('2026-10-22'),blocks:[{type:'heading',text:'連結測試'},{type:'paragraph',text:content},{type:'quote',text:content},{type:'list',items:[content]}]};
 await page.route('**/api/v1/public/journal',r=>r.fulfill({json:{data:{people:[person],journals:[entry]}}}));
 await page.goto('/journal/entries/2026-10-22');
 const links=page.locator('.chapter a.source-link');await expect(links).toHaveCount(6);
 for(let i=0;i<6;i++)await expect(links.nth(i)).toHaveAttribute('href',i%2?'https://example.org/wiki/Topic_(detail)':'https://example.org/reference');
 for(const selector of ['.chapter p:not(.eyebrow)','.chapter blockquote','.chapter li'])await expect(page.locator(selector)).toHaveText(content);
 for(const link of await links.all()){await expect(link).toHaveAttribute('target','_blank');await expect(link).toHaveAttribute('rel','noopener noreferrer');await expect(link).toHaveAttribute('referrerpolicy','no-referrer');}
});


const streamSnapshot={data:{people:['claude','codex'].map(community=>({...person,community,display_name:community+' 合成人物'})),journals:['claude','codex'].map(community=>({...enriched('2026-10-22'),community,title:community+' 同日合成日誌',people:[{...person,community,display_name:community+' 合成人物'}]}))}};
for(const [width,height] of [[1440,1000],[360,780],[375,667],[390,844],[430,932],[390,420]]){
 test(`community navigation keeps same-date articles and same-slug people isolated ${width}x${height}`,async({page})=>{
  await page.setViewportSize({width,height});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/v1/public/journal',r=>r.fulfill({json:streamSnapshot}));
  await page.route('**/api/v1/public/journal/activity?*',r=>{const community=new URL(r.request().url()).searchParams.get('community');return r.fulfill({json:{data:{...activity.data,messages:activity.data.messages.map(m=>({...m,text:community+' 合成原話'}))}}});});
  await page.goto('/journal/claude');await expect(page.locator('.story-feature h2')).toHaveText('claude 同日合成日誌');await expect(page.locator('.activity-rank')).toContainText('claude 合成人物');
  await page.getByRole('link',{name:'走進這一天'}).click();await expect(page).toHaveURL(/\/journal\/claude\/entries\/2026-10-22$/);
  await expect(page.locator('h1')).toHaveText('claude 同日合成日誌');await expect(page.locator('.article-members a')).toHaveAttribute('href','/journal/claude/people/demo');
  await page.locator('.article-members a').click();await expect(page.locator('h1')).toHaveText('claude 合成人物');await expect(page.locator('.member-quote').first()).toContainText('claude 合成原話');
  await expect(page.locator('.member-quote a').last()).toHaveAttribute('href','/journal/claude/entries/2026-10-22#section-0');
  const menu=page.getByRole('button',{name:'展開導覽'});if(await menu.isVisible())await menu.click();
  await page.getByRole('navigation',{name:'主導覽'}).getByRole('link',{name:'Codex',exact:true}).click();
  await expect(page.locator('.story-feature h2')).toHaveText('codex 同日合成日誌');await expect(page.locator('.activity-rank')).toContainText('codex 合成人物');
  await expect(page.getByText('claude 合成人物',{exact:true})).toHaveCount(0);
  await page.goBack();await expect(page).toHaveURL(/\/journal\/claude\/people\/demo$/);await expect(page.locator('h1')).toHaveText('claude 合成人物');
  await page.goto('/journal/codex/entries/2026-10-22#section-0');await expect(page.locator('h1')).toHaveText('codex 同日合成日誌');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`${shots}/community-${width}-${height}.png`,fullPage:true});
  await page.goto('/journal');await expect(page.getByRole('heading',{name:'還沒有日誌。'})).toBeVisible();expect(errors).toEqual([]);
 });
}
test('editor reviews both same-date communities before publishing the full snapshot',async({page,e2eAuthPool})=>{
 const base=String(test.info().project.use.baseURL);
 const login=await page.request.post('/api/v1/auth/login',{headers:{Origin:base,'Idempotency-Key':randomUUID()},data:{email:'maker@local.test',password:'freedom-local-demo'}});expect(login.status()).toBe(200);
 const session=await login.json(),owner=(await e2eAuthPool.query('SELECT user_id,community_id FROM users WHERE user_id=$1',[session.user.user_id])).rows[0];
 await e2eAuthPool.query('DELETE FROM community_journal_publisher');await e2eAuthPool.query('INSERT INTO community_journal_publisher(community_id,owner_ref) VALUES($1,$2)',[owner.community_id,owner.user_id]);
 try{
  await page.goto('/journal/manage');await page.getByRole('button',{name:'建立 30 天投稿金鑰'}).click();
  const secret=await page.locator('code').filter({hasText:/^fjp_/}).innerText();await page.getByRole('button',{name:'已保存，隱藏金鑰'}).click();
  const people=streamSnapshot.data.people.map(p=>({...p,avatar:{...p.avatar,url:'/media/public/'+[...journalMedia][0],alt:'合成人物',width:null,height:null}}));
  const body={schema_version:1,source_revision:'c'.repeat(64),people,journals:streamSnapshot.data.journals.map(j=>({...j,people:people.filter(p=>p.community===j.community)}))};
  const sent=await page.request.post('/agent-api/v1/journal-submissions',{headers:{Authorization:'Bearer '+secret,'Idempotency-Key':randomUUID()},data:body});expect(sent.status()).toBe(201);const receipt=await sent.json();
  expect((await(await page.request.get('/api/v1/public/journal')).json()).data.journals).toHaveLength(0);
  await page.reload();await page.getByRole('listitem').filter({hasText:receipt.created_at}).getByRole('button',{name:'查看內容',exact:true}).click();
  await expect(page.locator('.article-head h1')).toHaveText('claude 同日合成日誌');
  await page.getByRole('combobox',{name:'文章'}).selectOption('codex:2026-10-22');await expect(page.locator('.article-head h1')).toHaveText('codex 同日合成日誌');
  await expect(page.getByRole('button',{name:'發布這個版本'})).toBeDisabled();
  await page.getByRole('checkbox').check();await page.getByRole('button',{name:'發布這個版本'}).click();await expect(page.getByRole('button',{name:'撤回目前公開版本'})).toBeVisible();
  expect((await(await page.request.get('/api/v1/public/journal')).json()).data.journals).toHaveLength(2);
  for(const community of ['claude','codex']){await page.goto('/journal/'+community+'/entries/2026-10-22');await expect(page.locator('h1')).toHaveText(community+' 同日合成日誌');}
 }finally{await e2eAuthPool.query('DELETE FROM community_journal_publisher');}
});
test('switching community ignores an old pending snapshot response',async({page})=>{
 let release!:()=>void,started!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;}),waiting=new Promise<void>(resolve=>{started=resolve;});let reads=0;
 await page.route('**/api/v1/public/journal',async r=>{if(++reads===1){started();await pending;await r.fulfill({json:snapshot});}else await r.fulfill({json:streamSnapshot});});
 await page.route('**/api/v1/public/journal/activity?*',r=>r.fulfill({json:activity}));
 await page.goto('/journal/claude');await waiting;await page.getByRole('navigation',{name:'主導覽'}).getByRole('link',{name:'Codex',exact:true}).click();
 await expect(page.locator('.story-feature h2')).toHaveText('codex 同日合成日誌');release();
 await expect(page.locator('.story-feature h2')).toHaveText('codex 同日合成日誌');await expect(page.getByText('合成測試人物',{exact:true})).toHaveCount(0);
});
