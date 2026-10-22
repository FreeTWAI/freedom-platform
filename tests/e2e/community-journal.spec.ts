import {test as browserTest} from '@playwright/test';
import {journalMedia} from '../../modules/community-journal/media.js';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {test,expect} from './fixtures.js';
const shots='test-results/community-journal';mkdirSync(shots,{recursive:true});
const person={slug:'demo',display_name:'合成測試人物',intro:'這是瀏覽器驗證用的合成人物介紹。',kind:'person',color:'#c9ded6',avatar:{url:null,display_fit:'contain',object_position:'50% 50%'},role:'測試協作者',category:'共創',tags:['測試']};
const journal=(date:string)=>({date,title:'把想法留在同一張桌上，一起接著做',excerpt:'合成測試內容，用來驗證原版型、閱讀與導覽。',version:1,coverage:{is_partial:true},blocks:[{type:'heading',text:'今天的討論'},{type:'paragraph',text:'我們整理了需要繼續確認的事情。'.repeat(20)},{type:'list',items:['合成測試項目一','合成測試項目二']}],development_items:[{id:'demo',title:'合成開發項目',next_step:'下一步仍待確認',status:'proposed'}],decisions:[],people:[person],hero:null});
const snapshot={data:{people:[person],journals:[journal('2026-10-22'),journal('2026-10-21')]}};
for(const [width,height] of [[1440,1000],[360,780],[375,667],[390,844],[430,932],[390,420]]){
 test(`native journal layout, calendar, article and person dialog ${width}x${height}`,async({page})=>{
  await page.setViewportSize({width,height});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/v1/public/journal',r=>r.fulfill({json:snapshot}));
  await page.goto('/journal');await expect(page.getByRole('heading',{name:/讓好點子，\s*在這裡繼續。/})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'日期索引'}).click();await expect(page.getByRole('button',{name:'收起月曆'})).toBeVisible();
  await page.locator('#journal-calendar').getByRole('button',{name:'2026-10-21日誌',exact:true}).click();
  await page.getByRole('link',{name:'走進這一天'}).click();await expect(page).toHaveURL(/\/journal\/entries\/2026-10-21$/);
  await expect(page.getByRole('heading',{name:'今天的討論'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`${shots}/article-${width}-${height}.png`,fullPage:true});
  await page.goto('/journal/people');await expect(page.getByRole('heading',{name:/不同的我們，\s*一起把事情做好。/})).toBeVisible();
  await page.getByRole('link',{name:'看成員資料'}).click();await expect(page.getByRole('dialog',{name:'合成測試人物的成員資料'})).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page).toHaveURL(/\/journal\/people$/);
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
  const body={schema_version:1,source_revision:'a'.repeat(64),people:[p],journals:[{...journal('2026-10-22'),people:[p]}]};
  const sent=await page.request.post('/agent-api/v1/journal-submissions',{headers:{Authorization:'Bearer '+secret,'Idempotency-Key':randomUUID()},data:body});expect(sent.status()).toBe(201);
  await page.reload();await page.getByRole('button',{name:'查看內容',exact:true}).click();await expect(page.getByRole('heading',{name:'今天的討論'})).toBeVisible();
  await expect(page.getByRole('button',{name:'發布這個版本'})).toBeDisabled();await page.getByRole('checkbox').check();await page.getByRole('button',{name:'發布這個版本'}).click();
  await expect(page.getByRole('button',{name:'撤回目前公開版本'})).toBeVisible();
  const published=await page.request.get('/api/v1/public/journal');expect((await published.json()).data.journals).toHaveLength(1);
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
