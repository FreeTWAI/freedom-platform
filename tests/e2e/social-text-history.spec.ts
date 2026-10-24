import {test,expect,type Page} from './fixtures.js';
import {signOut} from './navigation.js';
import {randomUUID} from 'node:crypto';
import {DEMO_COMMUNITY,DEMO_PASSWORD} from '../../packages/testing/seed.js';
import {hashPassword} from '../../modules/identity-membership/service.js';

async function composer(page:Page,email='maker@local.test'){
  await page.goto('/');
  await page.getByLabel('電子郵件',{exact:true}).fill(email);
  await page.getByLabel('密碼',{exact:true}).fill(DEMO_PASSWORD);
  await page.getByRole('button',{name:'登入',exact:true}).click();
  await page.getByRole('button',{name:'建立貼文',exact:true}).click();
  return page.getByRole('dialog',{name:'建立貼文',exact:true});
}

// Keep expected accessible names independent of the product's translation catalog.
const composerLanguages=[
  {id:'en',name:'English',title:'Create post',close:'Close composer',content:'Post content',topic:'Post topic',location:'Location',undo:'Undo',redo:'Redo'},
  {id:'zh-Hant',name:'繁體中文',title:'建立貼文',close:'關閉發文',content:'貼文內容',topic:'貼文主題',location:'打卡地點',undo:'復原上一步',redo:'重做'},
  {id:'ja',name:'日本語',title:'投稿を作成',close:'投稿画面を閉じる',content:'投稿内容',topic:'投稿のテーマ',location:'場所',undo:'元に戻す',redo:'やり直す'},
  {id:'ko',name:'한국어',title:'게시물 작성',close:'게시 작성기 닫기',content:'게시물 내용',topic:'게시물 주제',location:'장소',undo:'실행 취소',redo:'다시 실행'},
  {id:'es',name:'Español',title:'Crear publicación',close:'Cerrar editor',content:'Contenido de la publicación',topic:'Tema de la publicación',location:'Ubicación',undo:'Deshacer',redo:'Rehacer'},
] as const;
async function selectComposerLanguage(page:Page,language:typeof composerLanguages[number]){
  await page.locator('.settings-menu-button').click();
  await page.getByRole('menuitemradio',{name:language.name,exact:true}).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveAttribute('lang',language.id);
}
async function composerImage(page:Page){
  // A real browser-generated raster exercises the normal image preparation path.
  const data=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;const context=canvas.getContext('2d')!;context.fillStyle='#e79a35';context.fillRect(0,0,8,8);return canvas.toDataURL('image/png').split(',')[1];});
  return {name:'原始作品.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')};
}

test('browser language changes translate an open composer in place without replacing its textarea or history',async({page})=>{
  const originalDialog=await composer(page),area=originalDialog.getByLabel('貼文內容',{exact:true});
  let writes=0;page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/v1/social-posts/notes')writes++;});
  const first='第一稿：保持原文 🎨',second='Second draft with https://example.test/?a=1&b=2',third='第三稿\nNever translate member content';
  await area.fill(first);await area.press('Tab');await area.fill(second);await area.press('Tab');await area.fill(third);
  await originalDialog.getByRole('button',{name:'復原上一步',exact:true}).click();await expect(area).toHaveValue(second);
  const textarea=await area.elementHandle();expect(textarea).not.toBeNull();
  expect(await page.evaluate(()=>localStorage.getItem('freedom-interface-language-v1'))).toBeNull();
  await page.evaluate(()=>{Object.defineProperty(navigator,'languages',{configurable:true,value:['en-US']});window.dispatchEvent(new Event('languagechange'));});
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  const translated=page.getByRole('dialog',{name:'Create post',exact:true}),translatedArea=translated.getByLabel('Post content',{exact:true});
  await expect(translated).toBeVisible();await expect(translatedArea).toHaveValue(second);
  expect(await textarea!.evaluate(element=>element.isConnected&&element===document.querySelector('.social-native-composer textarea'))).toBe(true);
  await translated.getByRole('button',{name:'Undo',exact:true}).click();await expect(translatedArea).toHaveValue(first);
  await translated.getByRole('button',{name:'Redo',exact:true}).click();await expect(translatedArea).toHaveValue(second);
  await translated.getByRole('button',{name:'Redo',exact:true}).click();await expect(translatedArea).toHaveValue(third);
  await expect(translated.getByRole('button',{name:'Publish post',exact:true})).toBeEnabled();
  expect(writes).toBe(0);
});

test('explicit composer language changes preserve text, image, topic, location and both history directions',async({page})=>{
  let dialog=await composer(page);
  await dialog.getByRole('button',{name:'關閉發文',exact:true}).click();
  await selectComposerLanguage(page,composerLanguages[0]);
  await page.getByRole('button',{name:'Create post',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Create post',exact:true});
  const original='第一稿：my own words 🎨\nhttps://example.test/?a=1&b=2',revised='第二稿：user-authored text stays verbatim',location='台北松菸 / online';
  await dialog.getByLabel('Post content',{exact:true}).fill(original);
  await dialog.getByLabel('Post content',{exact:true}).press('Tab');
  await dialog.getByLabel('Post content',{exact:true}).fill(revised);
  await dialog.getByLabel('Post topic',{exact:true}).selectOption('work');
  await dialog.getByRole('button',{name:'Check in',exact:true}).click();
  await dialog.getByLabel('Location',{exact:true}).fill(location);
  await dialog.getByLabel('Post image (optional)',{exact:true}).setInputFiles(await composerImage(page));
  const preview=dialog.locator('.social-compose-preview');await expect(preview).toBeVisible();
  const imageUrl=await preview.getAttribute('src');expect(imageUrl).toMatch(/^blob:/);
  await dialog.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(dialog.getByLabel('Post content',{exact:true})).toHaveValue(original);
  let current:typeof composerLanguages[number]=composerLanguages[0];
  for(const language of [...composerLanguages.slice(1),composerLanguages[0]]){
    await dialog.getByRole('button',{name:current.close,exact:true}).click();
    await selectComposerLanguage(page,language);
    await page.getByRole('button',{name:language.title,exact:true}).click();
    dialog=page.getByRole('dialog',{name:language.title,exact:true});
    await expect(dialog.getByRole('heading',{name:language.title,exact:true})).toBeVisible();
    await expect(dialog.getByLabel(language.content,{exact:true})).toHaveValue(original);
    await expect(dialog.getByLabel(language.topic,{exact:true})).toHaveValue('work');
    await expect(dialog.getByLabel(language.location,{exact:true})).toHaveValue(location);
    await expect(dialog.locator('.social-compose-preview')).toHaveAttribute('src',imageUrl!);
    await expect(dialog.locator('.social-compose-attachment')).toContainText('原始作品.png');
    await dialog.getByRole('button',{name:language.redo,exact:true}).click();
    await expect(dialog.getByLabel(language.content,{exact:true})).toHaveValue(revised);
    await dialog.getByRole('button',{name:language.undo,exact:true}).click();
    await expect(dialog.getByLabel(language.content,{exact:true})).toHaveValue(original);
    await expect(dialog.getByRole('button',{name:language.redo,exact:true})).toBeEnabled();
    current=language;
  }
});

test('English to Chinese unknown publication keeps the exact key and payload until the retry acknowledgement',async({page})=>{
  let dialog=await composer(page);
  await dialog.getByRole('button',{name:'關閉發文',exact:true}).click();
  await selectComposerLanguage(page,composerLanguages[0]);
  await page.getByRole('button',{name:'Create post',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Create post',exact:true});
  const text='這是原文，不因語言切換而翻譯。 🎨\nhttps://example.test/?a=1&b=2',location='台北松菸';
  await dialog.getByLabel('Post content',{exact:true}).fill('Previous draft');
  await dialog.getByLabel('Post content',{exact:true}).press('Tab');
  await dialog.getByLabel('Post content',{exact:true}).fill(text);
  await dialog.getByLabel('Post topic',{exact:true}).selectOption('event');
  await dialog.getByRole('button',{name:'Check in',exact:true}).click();
  await dialog.getByLabel('Location',{exact:true}).fill(location);
  await dialog.getByLabel('Post image (optional)',{exact:true}).setInputFiles(await composerImage(page));
  await expect(dialog.locator('.social-compose-preview')).toBeVisible();
  const imageUrl=await dialog.locator('.social-compose-preview').getAttribute('src');
  const commands:{key:string|null;body:string|null}[]=[];
  let releaseFailure=()=>{},releaseAcknowledgement=()=>{};
  const failure=new Promise<void>(resolve=>{releaseFailure=resolve}),acknowledgement=new Promise<void>(resolve=>{releaseAcknowledgement=resolve});
  // Neither attempt reaches the API: no shared maker posting quota is consumed.
  await page.route('**/api/v1/social-posts/notes',async route=>{
    const request=route.request();
    commands.push({key:await request.headerValue('Idempotency-Key'),body:request.postData()});
    if(commands.length===1){await failure;await route.abort('failed');return;}
    await acknowledgement;
    await route.fulfill({status:201,json:{post_id:randomUUID(),url:null,kind:'note',platform:'other',platform_label:'',title:text,note:text,created_at:new Date().toISOString(),edited_at:null,revision:1,topic:'event',location_name:location,tags:[],mentions:[],author:{user_id:randomUUID(),display_name:'Synthetic acknowledgement',avatar_url:null},thumbnail_url:null,total_points:0,my_points:0,mine:true,like_count:0,comment_count:0,liked:false}});
  });
  try{
    await dialog.getByRole('button',{name:'Publish post',exact:true}).click();
    await expect.poll(()=>commands.length).toBe(1);
    await expect(dialog.getByRole('button',{name:'Publishing…',exact:true})).toBeDisabled();
    releaseFailure();
    await expect(dialog.getByRole('button',{name:'Retry publish',exact:true})).toBeEnabled();
    await expect(dialog.getByLabel('Post content',{exact:true})).toBeDisabled();
    await expect(dialog.getByRole('button',{name:'Undo',exact:true})).toBeDisabled();
    await expect(dialog.getByRole('button',{name:'Redo',exact:true})).toBeDisabled();
    expect(commands[0].key).toMatch(/^[0-9a-f-]{36}$/i);
    expect(JSON.parse(commands[0].body!)).toMatchObject({text,topic:'event',location_name:location,mention_ids:[],image:{mime_type:expect.stringMatching(/^image\/(webp|png)$/),data_base64:expect.any(String)}});
    await dialog.getByRole('button',{name:'Close composer',exact:true}).click();
    await selectComposerLanguage(page,composerLanguages[1]);
    await page.getByRole('button',{name:'建立貼文',exact:true}).click();
    dialog=page.getByRole('dialog',{name:'建立貼文',exact:true});
    await expect(dialog.getByLabel('貼文內容',{exact:true})).toHaveValue(text);
    await expect(dialog.getByLabel('貼文內容',{exact:true})).toBeDisabled();
    await expect(dialog.getByLabel('貼文主題',{exact:true})).toHaveValue('event');
    await expect(dialog.getByLabel('貼文主題',{exact:true})).toBeDisabled();
    await expect(dialog.getByLabel('打卡地點',{exact:true})).toHaveValue(location);
    await expect(dialog.getByLabel('打卡地點',{exact:true})).toBeDisabled();
    await expect(dialog.locator('.social-compose-preview')).toHaveAttribute('src',imageUrl!);
    await expect(dialog.getByRole('button',{name:'移除圖片',exact:true})).toBeDisabled();
    await expect(dialog.getByRole('button',{name:'復原上一步',exact:true})).toBeDisabled();
    await expect(dialog.getByRole('button',{name:'重做',exact:true})).toBeDisabled();
    expect(commands).toHaveLength(1);
    await dialog.getByRole('button',{name:'重試發布',exact:true}).click();
    await expect.poll(()=>commands.length).toBe(2);
    expect(commands[1]).toEqual(commands[0]);
    await expect(dialog.getByRole('button',{name:'發布中…',exact:true})).toBeDisabled();
    releaseAcknowledgement();await expect(dialog).not.toBeVisible();
    await page.getByRole('button',{name:'建立貼文',exact:true}).click();
    await expect(dialog.getByLabel('貼文內容',{exact:true})).toHaveValue('');
    await expect(dialog.locator('.social-compose-preview')).toHaveCount(0);
    await expect(dialog.getByRole('button',{name:'復原上一步',exact:true})).toBeDisabled();
    await expect(dialog.getByRole('button',{name:'重做',exact:true})).toBeDisabled();
    expect(commands).toHaveLength(2);
  }finally{releaseFailure();releaseAcknowledgement();}
});

test('buttons and keyboard traverse multiple drafts, close retains history, and editing clears redo',async({page})=>{
  const dialog=await composer(page),area=dialog.getByLabel('貼文內容',{exact:true});
  const undo=dialog.getByRole('button',{name:'復原上一步',exact:true}),redo=dialog.getByRole('button',{name:'重做',exact:true});
  await expect(undo).toBeDisabled();await expect(redo).toBeDisabled();
  await area.fill('第一稿：原始資訊與 https://example.test/?a=1&b=2');await area.press('Tab');
  await area.fill('第二稿：保留原本的連結與數字 42');await area.press('Tab');
  await area.fill('第三稿：繁中、emoji 🎨 與換行\n都要保留');
  await undo.click();await expect(area).toHaveValue('第二稿：保留原本的連結與數字 42');
  await area.press('Control+z');await expect(area).toHaveValue('第一稿：原始資訊與 https://example.test/?a=1&b=2');
  await area.press('Control+Shift+z');await expect(area).toHaveValue('第二稿：保留原本的連結與數字 42');
  await redo.click();await expect(area).toHaveValue('第三稿：繁中、emoji 🎨 與換行\n都要保留');
  await dialog.getByRole('button',{name:'關閉發文',exact:true}).click();
  await page.getByRole('button',{name:'建立貼文',exact:true}).click();
  await undo.click();await area.fill('新的分支');await expect(redo).toBeDisabled();
  await undo.click();await expect(area).toHaveValue('第二稿：保留原本的連結與數字 42');
});

test('optimizer loads on demand, failed download retains editable history and explicit retry recovers',async({page})=>{
  let loads=0;
  await page.route('**/assets/SocialPostOptimizer-*.js*',async route=>{loads++;if(loads===1)await route.abort('failed');else await route.continue();});
  const dialog=await composer(page),area=dialog.getByLabel('貼文內容',{exact:true});
  await area.fill('工具失敗前的原稿');await area.press('Tab');await area.fill('工具失敗也要保留的修改');
  expect(loads).toBe(0);
  await dialog.getByRole('button',{name:'✦ Social Post 優化',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('文案優化未能開啟，草稿仍保留');
  await dialog.getByRole('button',{name:'復原上一步',exact:true}).click();await expect(area).toHaveValue('工具失敗前的原稿');
  await dialog.getByRole('button',{name:'重試開啟文案優化',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Social Post 文案優化',exact:true})).toBeVisible();expect(loads).toBe(2);
  await expect(area).toHaveValue('工具失敗前的原稿');
  await dialog.getByRole('button',{name:'重做',exact:true}).click();await expect(area).toHaveValue('工具失敗也要保留的修改');
});

test('unknown publication locks history, retry confirms the original command and clears history after acknowledgement',async({page,e2eAuthPool})=>{
  const id=randomUUID(),email=`social-history-${id}@example.test`;
  // Publishing must not consume the shared maker account's daily posting quota.
  await e2eAuthPool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,onboarding_required)
    VALUES($1,$2,$3,'貼文歷程測試會員',$4,$5,false)`,[id,DEMO_COMMUNITY,email,hashPassword(DEMO_PASSWORD),randomUUID()]);
  const dialog=await composer(page,email),area=dialog.getByLabel('貼文內容',{exact:true});
  await area.fill('本機驗證：發布確認後才清除草稿歷程');
  await page.route('**/api/v1/social-posts/notes',route=>route.abort('failed'),{times:1});
  await dialog.getByRole('button',{name:'發布貼文',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'重試發布',exact:true})).toBeEnabled();
  await expect(area).toBeDisabled();await expect(dialog.getByRole('button',{name:'復原上一步',exact:true})).toBeDisabled();await expect(dialog.getByRole('button',{name:'重做',exact:true})).toBeDisabled();
  await dialog.getByRole('button',{name:'重試發布',exact:true}).click();await expect(dialog).not.toBeVisible();
  await page.getByRole('button',{name:'建立貼文',exact:true}).click();await expect(area).toHaveValue('');
  await expect(dialog.getByRole('button',{name:'復原上一步',exact:true})).toBeDisabled();await area.press('Control+z');await expect(area).toHaveValue('');
});

test('signing out and signing in again cannot recover the previous session draft',async({page})=>{
  const dialog=await composer(page);
  await dialog.getByLabel('貼文內容',{exact:true}).fill('上一個登入階段的私人草稿');
  await dialog.getByRole('button',{name:'關閉發文',exact:true}).click();await signOut(page);
  await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();
  await page.getByRole('button',{name:'建立貼文',exact:true}).click();
  await expect(dialog.getByLabel('貼文內容',{exact:true})).toHaveValue('');
  await expect(dialog.getByRole('button',{name:'復原上一步',exact:true})).toBeDisabled();
});

test('history controls fit a 320px composer and remain keyboard accessible',async({page})=>{
  await page.setViewportSize({width:320,height:844});
  const dialog=await composer(page),area=dialog.getByLabel('貼文內容',{exact:true});
  await area.fill('把一個想法，慢慢打磨成作品。');await area.press('Tab');await area.fill('第二版：保留創作的每一步。');
  const undo=dialog.getByRole('button',{name:'復原上一步',exact:true});await undo.click();await expect(area).toBeFocused();
  await expect(dialog.getByRole('button',{name:'重做',exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'.freedom/creator-evidence/social-history-mobile.png',fullPage:true});
  await page.setViewportSize({width:1280,height:900});
  await page.screenshot({path:'.freedom/creator-evidence/social-history-desktop.png',fullPage:true});
});
