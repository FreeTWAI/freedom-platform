import sharp from 'sharp';
import {test,expect,type Page} from './fixtures.js';
import {navigate} from './navigation.js';
import {cashDeck,stampTarget} from '../../apps/portal-web/src/games/domain.js';
import {GAME_HANDOFF_EVENT,GAME_HANDOFF_KEY,type GameDraft} from '../../apps/portal-web/src/games/result-bridge.js';

async function openGame(page:Page,game:'photo'|'stamp'|'cash'){
  await page.goto(`/play?game=${game}&seed=42`);
  await expect(page.locator('[data-game-stage="ready"]')).toBeVisible();
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

test('AD-3 public photo studio captures real frames, enforces film, and exports a complete poster',async({page})=>{
  test.setTimeout(120_000);await page.setViewportSize({width:390,height:844});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await openGame(page,'photo');
  const shutter=page.getByRole('button',{name:'拍照快門',exact:true});
  await shutter.click();await shutter.click();await expect(shutter).toBeDisabled();
  await page.getByRole('button',{name:'下一位客人 →',exact:true}).click();
  for(let i=0;i<5;i++)await page.getByRole('button',{name:'鏡頭往上',exact:true}).click();
  await page.getByRole('slider').focus();await page.getByRole('slider').press('End');
  await shutter.click();await page.getByRole('button',{name:'下一位客人 →',exact:true}).click();
  await page.waitForTimeout(3500);await shutter.click();
  await page.getByRole('button',{name:'挑選照片',exact:true}).click();
  await expect(page.locator('.ad-photo-choices button')).toHaveCount(4);
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
    point={x:point.x+x*.06,y:point.y+y*.06};await page.waitForTimeout(230);await page.keyboard.press('Space');
    if(i<11)await expect(page.locator('.ad-counter')).toHaveText(`${i+1}/12`);
  }
  await expect(page.locator('.ad-result-heading')).toContainText('完成 12 份文件');
  await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeEnabled();
});

test('AD-5 sort exact million, recover denied storage, cancel system share, and hand off without a post',async({page})=>{
  test.setTimeout(120_000);await openGame(page,'cash');const posts:string[]=[];
  page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
  const deck=cashDeck(42);await page.keyboard.press(deck[0].valid?'ArrowLeft':'ArrowRight');
  await expect(page.getByText('這張分錯了，退回來重新看看。',{exact:true})).toBeVisible();await page.waitForTimeout(180);
  for(const card of deck){await page.keyboard.press(card.valid?'ArrowRight':'ArrowLeft');await page.waitForTimeout(175);}
  await expect(page.locator('.ad-result-heading')).toContainText('100 萬道具鈔 · 退回 6 張票券');
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
