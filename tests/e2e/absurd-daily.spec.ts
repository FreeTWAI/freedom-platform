import sharp from 'sharp';
import {test,expect,type Page} from './fixtures.js';
import {navigate} from './navigation.js';
import {cashDeck,stampTarget} from '../../apps/portal-web/src/games/domain.js';
import {GAME_HANDOFF_EVENT,GAME_HANDOFF_KEY,type GameDraft} from '../../apps/portal-web/src/games/result-bridge.js';

async function openGame(page:Page,game:'photo'|'stamp'|'cash'){
  // Keep lazy Three startup on a running clock, then freeze gameplay time.
  // Continuous RAF + trace readback on software WebGL can consume a whole
  // photo round between clicks and starve keyboard actions on the other games.
  await page.clock.install({time:new Date('2026-10-23T00:00:00Z')});
  await page.goto(`/play?game=${game}&seed=42`);
  await expect(page.locator('[data-game-stage="ready"]')).toBeVisible();
  await page.clock.pauseAt(new Date('2026-10-23T00:01:00Z'));
  await page.getByRole('button',{name:game==='stamp'?'先蓋一張練習紙':'開始這一局',exact:true}).click();
}
async function login(page:Page){
  await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');
  await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  await page.getByRole('button',{name:'登入',exact:true}).click();
  await expect(page.locator('.shell')).toBeVisible();
}
async function artifact():Promise<GameDraft>{
  const image=await sharp({create:{width:1200,height:675,channels:3,background:'#ba9bdf'}}).jpeg().toBuffer();
  return {version:1,createdAt:Date.now(),game:'photo',seed:42,title:'這張能交嗎？',text:`背景出席，本人缺席。\n${Date.now()} #離譜日常`,image:`data:image/jpeg;base64,${image.toString('base64')}`};
}
async function putArtifact(page:Page,draft:GameDraft){
  await page.evaluate(({key,event,draft})=>{sessionStorage.setItem(key,JSON.stringify(draft));window.dispatchEvent(new Event(event));},{key:GAME_HANDOFF_KEY,event:GAME_HANDOFF_EVENT,draft});
}
async function socialEntries(page:Page,game:string){
  const requests:string[]=[];const record=(r:{url:()=>string})=>{if(/^https:\/\/(x\.com|www\.(threads\.com|facebook\.com|instagram\.com))\//.test(r.url()))requests.push(r.url());};page.on('request',record);
  for(const label of ['X','Threads','Facebook','Instagram']){
    const button=page.getByRole('button',{name:`分享到 ${label}`,exact:true});await button.click();await expect(button).toHaveAttribute('aria-pressed','true');await expect(page.locator('.ad-social-targets [aria-pressed=true]')).toHaveCount(1);
    const entry=page.getByRole('link',{name:new RegExp(`^開啟 ${label}`)}),url=new URL((await entry.getAttribute('href'))!);expect(url.protocol).toBe('https:');expect(await entry.getAttribute('rel')).toContain('noopener');
    if(label==='X'||label==='Threads')expect(url.searchParams.get('text')).toContain(`game=${game}`);
    if(label==='Facebook')expect(url.searchParams.get('u')).toContain(`game=${game}`);
    if(label==='Instagram')expect(url.href).toBe('https://www.instagram.com/');
  }
  expect(requests).toEqual([]);page.off('request',record);
}

test('AD-3 public photo studio captures real frames, enforces film, and exports a complete poster',async({page})=>{
  test.setTimeout(120_000);await page.setViewportSize({width:390,height:844});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await openGame(page,'photo');
  const shutter=page.getByRole('button',{name:'拍照快門',exact:true});
  await shutter.click();await shutter.click();await expect(shutter).toBeDisabled();
  await page.getByRole('button',{name:'下一位客人 →',exact:true}).click();
  for(let i=0;i<5;i++)await page.getByRole('button',{name:'鏡頭往上',exact:true}).click();
  await page.getByRole('slider').focus();await page.getByRole('slider').press('End');
  await page.clock.runFor(160);
  await shutter.click();await page.getByRole('button',{name:'下一位客人 →',exact:true}).click();
  await page.clock.fastForward(3500);await shutter.click();
  await page.getByRole('button',{name:'挑選照片',exact:true}).click();
  await expect(page.locator('.ad-photo-choices button')).toHaveCount(4);
  await socialEntries(page,'photo');
  await page.locator('.ad-photo-choices button').first().click();
  await expect(page.locator('.ad-photo-choices [aria-pressed="true"]')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeEnabled();
  const download=page.waitForEvent('download');await page.getByRole('link',{name:'下載完整成果 PNG'}).click();
  const file=await download,path=await file.path();expect(path).toBeTruthy();
  const info=await sharp(path!).metadata();expect([info.width,info.height]).toEqual([960,1200]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

test('AD-4 twelve real documents finish once after practice; blur pauses until explicit resume',async({page})=>{
  test.setTimeout(120_000);await page.setViewportSize({width:390,height:844});await openGame(page,'stamp');
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await expect(page.getByRole('button',{name:'繼續這一局',exact:true})).toBeVisible();
  await page.keyboard.press('Space');await expect(page.locator('.ad-counter')).toHaveText('練習中');
  await page.getByRole('button',{name:'繼續這一局',exact:true}).click();
  await page.keyboard.press('Space');await expect(page.getByText('練習完成。十二張正式公文，開始！',{exact:true})).toBeVisible();
  let point=stampTarget(42,0);
  for(let i=0;i<12;i++){
    const target=stampTarget(42,i),x=Math.round((target.x-point.x)/.06),y=Math.round((target.y-point.y)/.06);
    for(let k=0;k<Math.abs(x);k++)await page.keyboard.press(x>0?'ArrowRight':'ArrowLeft');
    for(let k=0;k<Math.abs(y);k++)await page.keyboard.press(y>0?'ArrowDown':'ArrowUp');
    point={x:point.x+x*.06,y:point.y+y*.06};await page.clock.fastForward(230);await page.keyboard.press('Space');
    if(i<11)await expect(page.locator('.ad-counter')).toHaveText(`${i+1}/12`);
  }
  await expect(page.locator('.ad-result-heading')).toContainText('完成 12 份文件');
  await socialEntries(page,'stamp');
  await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeEnabled();
});

test('AD-5 sort exact million, recover denied storage, cancel system share, and hand off without a post',async({page})=>{
  test.setTimeout(120_000);await openGame(page,'cash');const posts:string[]=[];
  page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
  const deck=cashDeck(42);await page.keyboard.press(deck[0].valid?'ArrowLeft':'ArrowRight');
  await expect(page.getByText('這張分錯了，退回來重新看看。',{exact:true})).toBeVisible();await page.clock.fastForward(180);
  for(const card of deck){await page.keyboard.press(card.valid?'ArrowRight':'ArrowLeft');await page.clock.fastForward(175);}
  await expect(page.locator('.ad-result-heading')).toContainText('100 萬道具鈔 · 退回 6 張票券');
  await socialEntries(page,'cash');
  await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeEnabled();
  await page.evaluate(()=>{
    Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
    Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{throw new DOMException('cancel','AbortError');}});
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied');}}});
  });
  await page.getByRole('button',{name:'系統分享圖片／連結',exact:true}).click();
  await expect(page.getByText('已取消分享，成果仍在這裡。',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'複製同題挑戰連結',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'同題連結',exact:true})).toHaveValue(/\/play\?game=cash&seed=42$/);
  await page.evaluate(key=>{
    const original=Storage.prototype.setItem;
    (window as unknown as {restoreStorage:()=>void}).restoreStorage=()=>{Storage.prototype.setItem=original;};
    Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('quota','QuotaExceededError');return original.call(this,k,v);};
  },GAME_HANDOFF_KEY);
  await page.getByRole('button',{name:'發到自由工坊',exact:true}).click();
  await expect(page.getByText('成果還沒保存，請重試「發到自由工坊」，或先下載圖片。',{exact:true})).toBeVisible();
  await page.evaluate(()=>(window as unknown as {restoreStorage:()=>void}).restoreStorage());
  await page.getByRole('button',{name:'發到自由工坊',exact:true}).click();
  await page.waitForURL('**/?game-share=1#home');
  const draft=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!),GAME_HANDOFF_KEY);
  expect(draft.game).toBe('cash');expect(draft.image).toMatch(/^data:image\/jpeg;base64,/);expect(draft.text).toContain('/play?game=cash&seed=42');
  expect(posts).toEqual([]);
});

test('AD-7 guest result survives login, shows current author, and publishes only after confirmation',async({page,e2eAuthPool})=>{
  await page.goto('/?game-share=1#home');const draft=await artifact();await putArtifact(page,draft);
  try {
  const writes:string[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/social-posts/notes'))writes.push(r.url());});
  await login(page);
  const dialog=page.getByRole('dialog',{name:'建立貼文',exact:true});
  await expect(dialog).toBeVisible();await expect(dialog.getByLabel('貼文內容',{exact:true})).toHaveValue(draft.text);
  await expect(dialog.locator('.social-publish-identity')).toContainText('示範創作者');
  const preview=dialog.getByRole('img',{name:'待發布圖片預覽'});await expect(preview).toHaveJSProperty('naturalWidth',1200);
  await dialog.getByRole('button',{name:'關閉發文',exact:true}).click();expect(writes).toEqual([]);
  expect(await page.evaluate(key=>sessionStorage.getItem(key),GAME_HANDOFF_KEY)).not.toBeNull();
  await page.getByRole('button',{name:'建立貼文',exact:true}).click();
  await dialog.getByRole('button',{name:'發布貼文',exact:true}).click();await expect(dialog).toBeHidden();
  expect(writes).toHaveLength(1);
  expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM community_social_posts WHERE note=$1',[draft.text])).rows[0].n).toBe(1);
  expect(await page.evaluate(key=>sessionStorage.getItem(key),GAME_HANDOFF_KEY)).toBeNull();
  } finally {
    // AD-7: this alphabetically early test must not leave a post that later
    // synthetic chat members read, creating foreign keys into their fixtures.
    await page.close();
    await e2eAuthPool.query(`DELETE FROM community_social_posts WHERE note=$1
      AND author_user_id IN (SELECT user_id FROM users WHERE email='maker@local.test')`,[draft.text]);
  }
});

test('AD-6 render exception recovers paused, keeps progress and resumes action cooldowns only on Continue',async({page})=>{
  test.setTimeout(120_000);await openGame(page,'cash');
  const deck=cashDeck(42),progress=page.locator('.ad-controls .ad-meta');
  await page.keyboard.press(deck[0].valid?'ArrowRight':'ArrowLeft');
  await expect(progress).toContainText('已分類 1 / 30');
  // Expire the first action's cooldown so it cannot mask a broken pause guard.
  await page.clock.fastForward(180);
  // Throw from a real render call after initialization, rather than dispatching
  // contextlost (which has its own, already-paused callback).
  await page.evaluate(()=>{
    const prototype=WebGL2RenderingContext.prototype,original=prototype.drawElements;
    prototype.drawElements=function(...args){prototype.drawElements=original;throw Error('Synthetic active-render failure');};
  });
  await page.clock.fastForward(16);
  await expect(page.getByRole('alert')).toHaveText('3D 畫面暫時中斷。按重試恢復這一局。');
  await page.getByRole('button',{name:'重試場景',exact:true}).click();
  const resume=page.getByRole('button',{name:'繼續這一局',exact:true});
  await expect(resume).toBeVisible();await expect(page.locator('.ad-stage canvas')).toHaveCount(1);
  await page.keyboard.press(deck[1].valid?'ArrowRight':'ArrowLeft');
  await expect(progress).toContainText('已分類 1 / 30');
  await resume.click();
  for(let i=1;i<3;i++){
    await page.clock.fastForward(180);
    await page.keyboard.press(deck[i].valid?'ArrowRight':'ArrowLeft');
    await expect(progress).toContainText(`已分類 ${i+1} / 30`);
  }
});

test('AD-6 factory failure releases an unreturned stage and retry creates exactly one healthy canvas',async({page})=>{
  test.setTimeout(120_000);
  await page.addInitScript(()=>{
    const prototype=WebGL2RenderingContext.prototype,original=prototype.compileShader;
    prototype.compileShader=function(...args){
      if(document.querySelector('.ad-stage canvas')){
        prototype.compileShader=original;
        (window as unknown as {failedStageContext:WebGL2RenderingContext}).failedStageContext=this;
        throw Error('Synthetic pre-return environment failure');
      }
      return original.apply(this,args);
    };
  });
  await page.goto('/play?game=cash&seed=42');
  await expect(page.getByRole('alert')).toContainText('此瀏覽器暫時無法開啟 3D 場景');
  await expect(page.locator('.ad-stage canvas')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {failedStageContext:WebGL2RenderingContext}).failedStageContext.isContextLost())).toBe(true);
  await page.getByRole('button',{name:'重試場景',exact:true}).click();
  await expect(page.locator('[data-game-stage="ready"]')).toBeVisible();
  await expect(page.locator('.ad-stage canvas')).toHaveCount(1);
  await page.getByRole('button',{name:'開始這一局',exact:true}).click();
  await page.keyboard.press(cashDeck(42)[0].valid?'ArrowRight':'ArrowLeft');
  await expect(page.locator('.ad-controls .ad-meta')).toContainText('已分類 1 / 30');
});

test('AD-7 importing preserves an existing draft and refuses to overwrite its image',async({page})=>{
  await page.goto('/');await login(page);await navigate(page,'社群分享');
  await page.getByRole('button',{name:'建立貼文',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'建立貼文',exact:true});await dialog.getByLabel('貼文內容',{exact:true}).fill('原本的作品草稿');
  const image=await sharp({create:{width:24,height:24,channels:3,background:'#ed624a'}}).png().toBuffer();
  await dialog.getByLabel('貼文圖片（選填）').setInputFiles({name:'原圖.png',mimeType:'image/png',buffer:image});
  await expect(dialog.getByRole('img',{name:'待發布圖片預覽'})).toHaveJSProperty('naturalWidth',24);
  const draft=await artifact();await putArtifact(page,draft);await dialog.getByRole('button',{name:'關閉發文',exact:true}).click();
  const notice=page.getByRole('complementary',{name:'剛才的遊戲成果'});
  await expect(notice.getByRole('button',{name:'帶圖建立貼文',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'建立貼文',exact:true}).click();
  await expect(dialog.getByLabel('貼文內容',{exact:true})).toHaveValue('原本的作品草稿');
  await dialog.getByRole('button',{name:'移除圖片',exact:true}).click();await dialog.getByRole('button',{name:'關閉發文',exact:true}).click();
  await notice.getByRole('button',{name:'帶圖建立貼文',exact:true}).click();
  await expect(dialog.getByLabel('貼文內容',{exact:true})).toHaveValue(`原本的作品草稿\n\n${draft.text}`);
  await expect(dialog.getByRole('img',{name:'待發布圖片預覽'})).toHaveJSProperty('naturalWidth',1200);
});

test('AD-6 WebGL loss has a recoverable boundary and public layouts fit narrow, wide and landscape viewports',async({page})=>{
  await openGame(page,'cash');
  for(const [width,height] of [[320,568],[667,375],[768,1024],[1440,900]]){
    await page.setViewportSize({width,height});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.locator('.ad-stage canvas').evaluate(c=>c.dispatchEvent(new Event('webglcontextlost',{cancelable:true})));
  await expect(page.getByRole('button',{name:'重試場景',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'重試場景',exact:true}).click();
  await expect(page.getByRole('button',{name:'繼續這一局',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'繼續這一局',exact:true}).click();
  await page.getByRole('button',{name:'← 遊樂場',exact:true}).click();await expect(page.locator('.ad-stage canvas')).toHaveCount(0);
  await expect(page.locator('.ad-game-card')).toHaveCount(3);
});

import {recipeOf,type Recipe} from '../../apps/portal-web/src/games/cooking/catalog.js';
import {COOKBOOK_KEY,COOKING_RUN_KEY} from '../../apps/portal-web/src/games/cooking/storage.js';
async function openKitchen(page:Page,id:string){
  await page.clock.install({time:new Date('2026-10-25T02:00:00Z')});await page.goto(`/play?game=kitchen&recipe=${id}&seed=42`);
  await expect(page.getByRole('button',{name:'開始料理',exact:true})).toBeVisible();
  await page.clock.pauseAt(new Date('2026-10-25T02:01:00Z'));await page.getByRole('button',{name:'開始料理',exact:true}).click();
}
async function scenePoint(page:Page,x:number,y:number){const box=await page.locator('.ck-scene').boundingBox();expect(box).toBeTruthy();return {x:box!.x+x*box!.width,y:box!.y+y*box!.height};}
async function playRecipe(page:Page,recipe:Recipe){
  for(let index=0;index<recipe.steps.length;index++){
    const s=recipe.steps[index];await expect(page.locator('[data-cooking-scene]')).toHaveAttribute('data-cooking-scene',s.kind);
    if(s.kind==='slice')for(let i=0;i<s.goal;i++){await page.clock.runFor(160);const x=.22+.56*(i+1)/(s.goal+1),from=await scenePoint(page,x,.23),to=await scenePoint(page,x,.78);await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:5});await page.mouse.up();}
    if(s.kind==='mix'){const first=await scenePoint(page,.8,.52);await page.mouse.move(first.x,first.y);await page.mouse.down();for(let i=1;i<=s.goal*32;i++){const angle=i*Math.PI/16,p=await scenePoint(page,.5+.3*Math.cos(angle),.52+.3*Math.sin(angle));await page.mouse.move(p.x,p.y);}await page.mouse.up();}
    if(s.kind==='knead')for(let i=0;i<s.goal;i++){await page.locator('.ck-game').focus();await page.keyboard.down('Space');await page.clock.runFor(s.holdMs);await page.keyboard.up('Space');await page.clock.runFor(160);}
    if(s.kind==='pan'||s.kind==='boil'||s.kind==='bake'){const slider=page.getByRole('slider'),box=await slider.boundingBox();await slider.click({position:{x:8+(box!.width-16)*s.heat/100,y:box!.height/2}});
      if(s.kind==='pan'){await page.clock.runFor(s.durationMs*.55);await page.getByRole('button',{name:'翻面！',exact:true}).click();await page.clock.runFor(s.durationMs*.65);}
      if(s.kind==='boil'){for(let i=0;i<3;i++){await page.clock.runFor(2300);const skim=page.getByRole('button',{name:/撈掉泡沫/});if(await skim.isEnabled())await skim.click();}await page.clock.runFor(3000);}
      if(s.kind==='bake'){await page.clock.runFor(s.durationMs*.8);await page.getByRole('button',{name:'出爐！',exact:true}).click();}}
    if(s.kind==='pour'){await page.locator('.ck-game').focus();await page.keyboard.down('Space');await page.clock.runFor(s.durationMs*s.target);await page.keyboard.up('Space');}
    if(s.kind==='fold')for(const direction of s.directions){await page.clock.runFor(160);await page.locator('.ck-game').focus();await page.keyboard.press(`Arrow${direction[0].toUpperCase()+direction.slice(1)}`);}
    if(s.kind==='plate')for(let i=0;i<s.goal;i++){await page.clock.runFor(160);const start=await scenePoint(page,.1275,.535),angle=-Math.PI/2+i*2*Math.PI/s.goal,target=await scenePoint(page,.5+.23*Math.cos(angle),.53+.18*Math.sin(angle));await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(target.x,target.y,{steps:6});await page.mouse.up();}
    if(index<recipe.steps.length-1){await expect(page.getByRole('button',{name:/^下一步：/})).toBeVisible();await page.getByRole('button',{name:/^下一步：/}).click();}
  }
  await expect(page.locator('.ad-result')).toBeVisible();await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeEnabled();await expect(page.locator('.ad-result-heading')).toContainText(recipe.name);
}
for(const id of ['egg-fried-rice','rice-balls','chocolate-brownie','pearl-milk-tea'])test(`CK-5: ${id} completes through real scene gestures and keyboard cooking controls`,async({page})=>{
  test.setTimeout(120_000);await page.setViewportSize({width:390,height:844});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await openKitchen(page,id);await playRecipe(page,recipeOf(id)!);
  await socialEntries(page,'kitchen');
  const book=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),COOKBOOK_KEY);expect(book.best[id].score).toBeGreaterThanOrEqual(60);expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('CK-3/7: categories, favorites, empty results, history and a real paused checkpoint survive reload',async({page})=>{
  await page.goto('/play');await expect(page.locator('.ck-recipe-card')).toHaveCount(8);await page.getByRole('button',{name:/日式料理/}).click();await expect(page.locator('.ck-recipe-card')).toHaveCount(8);await page.getByRole('button',{name:'收藏海苔飯糰',exact:true}).click();await page.getByRole('combobox',{name:'食譜篩選',exact:true}).selectOption('favorite');await expect(page.locator('.ck-recipe-card')).toHaveCount(1);
  await page.getByRole('searchbox').fill('不存在的料理');await expect(page.getByRole('heading',{name:'把喜歡的菜，留在這一頁。'})).toBeVisible();await page.getByRole('searchbox').fill('');await page.getByRole('button',{name:'開始製作海苔飯糰',exact:true}).click();await page.getByRole('button',{name:'開始料理',exact:true}).click();await page.getByRole('button',{name:'攪拌一圈 ↻',exact:true}).click();await expect(page.locator('.ck-meter-copy')).toContainText('1.0 / 2 圈');await page.getByRole('button',{name:'暫停',exact:true}).click();
  const before=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!),COOKING_RUN_KEY);await page.reload();await expect(page.getByRole('button',{name:'繼續料理',exact:true})).toBeVisible();expect(await page.locator('.ck-meter-copy').innerText()).toContain('1.0 / 2 圈');await page.getByRole('button',{name:'← 遊戲大廳',exact:true}).click();await expect(page.locator('.ck-recipe-card')).toHaveCount(8);await page.goBack();await expect(page.getByRole('button',{name:'繼續料理',exact:true})).toBeVisible();const after=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!),COOKING_RUN_KEY);expect(after.run.id).toBe(before.run.id);
});
test('CK-6: a real cooking result opens a confirmed platform draft without automatically publishing',async({page})=>{
  test.setTimeout(120_000);let writes=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/social-posts/notes'))writes++;});await openKitchen(page,'egg-fried-rice');await playRecipe(page,recipeOf('egg-fried-rice')!);await page.getByRole('button',{name:'發到自由工坊',exact:true}).click();await page.clock.resume();await expect(page).toHaveURL(/game-share=1/);await login(page);const draft=page.getByRole('dialog',{name:'建立貼文',exact:true});await expect(draft.getByRole('img',{name:'待發布圖片預覽'})).toHaveJSProperty('naturalWidth',1200);expect(await draft.getByLabel('貼文內容',{exact:true}).inputValue()).toContain('recipe=egg-fried-rice');expect(writes).toBe(0);await draft.getByRole('button',{name:'關閉發文',exact:true}).click();
});

test('CK-6: native file/link payloads, denied clipboard and external intent preserve the actual cooking result',async({page,context})=>{
  test.setTimeout(120_000);await openKitchen(page,'egg-fried-rice');await playRecipe(page,recipeOf('egg-fried-rice')!);
  await page.evaluate(()=>{
    Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
    Object.defineProperty(navigator,'share',{configurable:true,value:async(data:ShareData)=>{(window as any).shared={text:data.text,url:data.url,files:data.files?.map(f=>({name:f.name,type:f.type,size:f.size}))};}});
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied');}}});
  });
  await page.getByRole('button',{name:'分享到 Instagram',exact:true}).click();await page.getByRole('button',{name:'用系統選單選 Instagram',exact:true}).click();await expect(page.getByText('已交給系統分享選單。',{exact:true})).toBeVisible();
  const file=await page.evaluate(()=>(window as any).shared);expect(file.text).toContain('recipe=egg-fried-rice');expect(file.files).toHaveLength(1);expect(file.files[0].type).toBe('image/png');expect(file.files[0].size).toBeGreaterThan(10000);
  await page.getByRole('button',{name:'複製分享文案',exact:true}).click();await expect(page.getByRole('textbox',{name:'分享文案',exact:true})).toHaveValue(/recipe=egg-fried-rice/);
  await page.evaluate(()=>Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>false}));await page.getByRole('button',{name:'系統分享圖片／連結',exact:true}).click();
  const link=await page.evaluate(()=>(window as any).shared);expect(link.url).toContain('recipe=egg-fried-rice');expect(link.files).toBeUndefined();
  await context.route('https://x.com/**',route=>route.fulfill({status:200,contentType:'text/plain',body:'Isolated share destination fixture'}));await page.getByRole('button',{name:'分享到 X',exact:true}).click();
  const popupPromise=context.waitForEvent('page');await page.getByRole('link',{name:'開啟 X 分享 ↗',exact:true}).click();const popup=await popupPromise;await popup.waitForURL('https://x.com/intent/tweet?**');expect(new URL(popup.url()).searchParams.get('text')).toContain('recipe=egg-fried-rice');await popup.close();await expect(page.locator('.ad-result')).toBeVisible();
  await page.evaluate(()=>Object.defineProperty(navigator,'share',{configurable:true,value:undefined}));await page.getByRole('button',{name:'系統分享圖片／連結',exact:true}).click();await expect(page.getByRole('textbox',{name:'同題連結',exact:true})).toHaveValue(/recipe=egg-fried-rice/);await expect(page.getByRole('link',{name:'下載完整成果 PNG',exact:true})).toBeVisible();
});

test('CK-7: previewing another recipe preserves the unfinished dish and returning keeps lobby filters',async({page})=>{
  await page.goto('/play');await page.getByRole('button',{name:/日式料理/}).click();await page.getByRole('button',{name:'開始製作海苔飯糰',exact:true}).click();await page.getByRole('button',{name:'開始料理',exact:true}).click();await page.getByRole('button',{name:'攪拌一圈 ↻',exact:true}).click();await page.getByRole('button',{name:'← 遊戲大廳',exact:true}).click();await expect(page.locator('.ck-recipe-card')).toHaveCount(8);
  const before=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!),COOKING_RUN_KEY);await page.getByRole('button',{name:'開始製作蝦子天婦羅',exact:true}).click();await expect(page.getByRole('button',{name:'開始料理',exact:true})).toBeVisible();await page.getByRole('button',{name:'← 遊戲大廳',exact:true}).click();
  const after=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!),COOKING_RUN_KEY);expect(after.run.id).toBe(before.run.id);await page.getByRole('button',{name:'開始製作海苔飯糰',exact:true}).click();await expect(page.getByRole('button',{name:'繼續料理',exact:true})).toBeVisible();await expect(page.locator('.ck-meter-copy')).toContainText('1.0 / 2 圈');
});
test('CK-2/7: unavailable artwork and storage have usable fallbacks, while an unknown recipe returns the lobby',async({page})=>{
  await page.addInitScript(()=>{Storage.prototype.setItem=function(){throw new DOMException('Synthetic quota','QuotaExceededError');};});await page.route('**/games/absurd-daily/cooking/*.webp',route=>route.abort());await page.goto('/play?game=kitchen&recipe=unknown&seed=42');await expect(page.getByRole('status').filter({hasText:'這道料理連結無法辨識'})).toBeVisible();const fallback=await page.locator('.ck-recipe-card').first().locator('.ck-art-fallback').boundingBox(),owner=await page.locator('.ck-recipe-card').first().locator('.ck-recipe-visual').boundingBox();expect(fallback!.y+fallback!.height).toBeLessThanOrEqual(owner!.y+owner!.height);await page.getByRole('button',{name:'收藏黃金蛋炒飯',exact:true}).click();await expect(page.getByRole('button',{name:'重試保存食譜本',exact:true})).toBeVisible();await page.getByRole('button',{name:'開始製作黃金蛋炒飯',exact:true}).click();await expect(page.locator('.ck-art-fallback')).toBeVisible();await page.getByRole('button',{name:'開始料理',exact:true}).click();await expect(page.getByRole('button',{name:'重試保存',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'沿線切一刀',exact:true})).toBeEnabled();
});

test('CK-8: enlarged real recipe text keeps the start/resume action inside its owner on compact and landscape screens',async({page})=>{
  for(const viewport of [{width:320,height:568},{width:667,height:375}]){
    await page.setViewportSize(viewport);await page.goto('/play?game=kitchen&recipe=strawberry-cake&seed=42');await expect(page.getByRole('button',{name:'開始料理',exact:true})).toBeVisible();
    await page.evaluate(()=>{const styles=[...document.querySelectorAll('.ad-root,.ad-root *')].filter(e=>e instanceof HTMLElement).map(e=>({e:e as HTMLElement,font:parseFloat(getComputedStyle(e).fontSize),line:parseFloat(getComputedStyle(e).lineHeight)}));for(const {e,font,line}of styles){e.style.fontSize=`${font*2}px`;if(Number.isFinite(line))e.style.lineHeight=`${line*2}px`;}});
    const contained=()=>page.locator('.ck-scene-overlay').evaluate(e=>{const button=e.querySelector('button')!.getBoundingClientRect(),owner=e.getBoundingClientRect();return button.top>=owner.top&&button.bottom<=owner.bottom&&button.left>=owner.left&&button.right<=owner.right;});
    expect(await contained()).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByRole('button',{name:'開始料理',exact:true}).click();await page.getByRole('button',{name:'暫停',exact:true}).click();expect(await contained()).toBe(true);await page.getByRole('button',{name:'繼續料理',exact:true}).click();await page.getByRole('button',{name:'← 遊戲大廳',exact:true}).click();await page.evaluate(()=>sessionStorage.removeItem('freedom.cooking.run.v1'));
  }
});

test('CK-3: the playroom browses all game types, pages dishes and separates favorite hit areas from starting a game',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/play');await expect(page.locator('.ck-recipe-card')).toHaveCount(8);await page.getByRole('button',{name:'再看看 8 道料理',exact:true}).click();await expect(page.locator('.ck-recipe-card')).toHaveCount(16);
  const open=await page.getByRole('button',{name:'開始製作黃金蛋炒飯',exact:true}).boundingBox(),favorite=await page.getByRole('button',{name:'收藏黃金蛋炒飯',exact:true}).boundingBox();expect(open!.y+open!.height).toBeLessThanOrEqual(favorite!.y);await page.getByRole('button',{name:'收藏黃金蛋炒飯',exact:true}).click();await expect(page).toHaveURL(/\/play$/);
  await page.getByRole('button',{name:'觀察攝影 1',exact:true}).click();await expect(page.locator('.ad-game-card')).toHaveCount(1);await expect(page.locator('.ck-recipe-card')).toHaveCount(0);
  await page.getByRole('button',{name:'反應手速 2',exact:true}).click();await expect(page.locator('.ad-game-card')).toHaveCount(2);await page.getByRole('button',{name:'料理小遊戲 64',exact:true}).click();await expect(page.locator('.ck-recipe-card')).toHaveCount(16);
  await page.getByRole('button',{name:/♡ 我的收藏/}).click();await expect(page.locator('.ck-recipe-card')).toHaveCount(1);await page.getByRole('button',{name:'這道我來做',exact:true}).click();await expect(page.getByRole('button',{name:'開始料理',exact:true})).toBeVisible();await page.getByRole('button',{name:'← 遊戲大廳',exact:true}).click();await expect(page.getByRole('combobox',{name:'食譜篩選',exact:true})).toHaveValue('favorite');await expect(page.locator('.ck-recipe-card')).toHaveCount(1);
});
