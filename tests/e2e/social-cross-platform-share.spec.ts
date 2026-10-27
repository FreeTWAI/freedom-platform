import {openSettingsPanel,closeSettingsMenu} from './settings-menu-helpers.js';
import {test,expect,type Page} from './fixtures.js';

const image={name:'原始作品.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')};
async function login(page:Page){await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();}
async function composer(page:Page){await login(page);await page.getByRole('button',{name:'建立貼文',exact:true}).click();return page.getByRole('dialog',{name:'建立貼文',exact:true});}
async function sharing(page:Page){const dialog=await composer(page);await dialog.getByRole('button',{name:'↗ Social Post 分享',exact:true}).click();const panel=dialog.getByRole('region',{name:'多平台分享',exact:true});await panel.getByRole('button',{name:'了解並開啟',exact:true}).click();for(const name of ['X','Instagram','Facebook','Threads']){const button=panel.getByRole('button',{name,exact:true});await expect(button).toHaveAttribute('aria-pressed','true');await button.click();}return {dialog,panel};}
function writes(page:Page){const result:string[]=[];page.on('request',request=>{if(request.method()!=='GET'&&request.url().includes('/api/v1/')&&!request.url().includes('/auth/')&&!request.url().endsWith('/read'))result.push(request.url());});return result;}

// Browser auto-detection and explicit settings use the same localized composer.
const sharingLanguages=[
  {id:'zh-Hant',locale:'zh-TW',name:'繁體中文',login:'登入',title:'建立貼文',close:'關閉發文',content:'貼文內容',publish:'發布貼文',workshop:'發布到工坊',share:'↗ Social Post 分享',panel:'多平台分享',enable:'了解並開啟',decline:'先不要',collapse:'收合',selected:'已選 1 個平台'},
  {id:'en',locale:'en-US',name:'English',login:'Sign in',title:'Create post',close:'Close composer',content:'Post content',publish:'Publish post',workshop:'Publish to Workshop',share:'↗ Social Post share',panel:'Share to platforms',enable:'Understand and enable',decline:'Not now',collapse:'Collapse',selected:'1 platforms selected'},
  {id:'ja',locale:'ja-JP',name:'日本語',login:'ログイン',title:'投稿を作成',close:'投稿画面を閉じる',content:'投稿内容',publish:'投稿する',workshop:'工坊に投稿',share:'↗ Social Post 共有',panel:'複数のサービスに共有',enable:'確認して有効にする',decline:'今はしない',collapse:'閉じる',selected:'1件選択中'},
  {id:'ko',locale:'ko-KR',name:'한국어',login:'로그인',title:'게시물 작성',close:'게시 작성기 닫기',content:'게시물 내용',publish:'게시',workshop:'공방에 게시',share:'↗ Social Post 공유',panel:'여러 플랫폼에 공유',enable:'이해하고 사용하기',decline:'나중에',collapse:'접기',selected:'플랫폼 1개 선택'},
  {id:'es',locale:'es-ES',name:'Español',login:'Iniciar sesión',title:'Crear publicación',close:'Cerrar editor',content:'Contenido de la publicación',publish:'Publicar',workshop:'Publicar en Workshop',share:'↗ Social Post compartir',panel:'Compartir en plataformas',enable:'Entendido, activar',decline:'Ahora no',collapse:'Contraer',selected:'1 plataformas seleccionadas'},
] as const;
const textToolLabels={
  'zh-Hant':{emoji:'插入 emoji',mention:'標註會員',search:'搜尋標註會員'},
  en:{emoji:'Insert emoji',mention:'Mention a member',search:'Search members to mention'},
  ja:{emoji:'絵文字を挿入',mention:'メンバーをメンション',search:'メンションするメンバーを検索'},
  ko:{emoji:'이모지 삽입',mention:'회원 멘션',search:'멘션할 회원 검색'},
  es:{emoji:'Insertar emoji',mention:'Mencionar a un miembro',search:'Buscar miembros para mencionar'},
} as const;

for(const language of sharingLanguages)test(`${language.id}: browser-selected composer and collapsed, expanded and declined sharing keep one language without writes or opt-in`,async({browser})=>{
  const context=await browser.newContext({locale:language.locale,viewport:{width:390,height:844}});
  try{
    const page=await context.newPage();await page.goto('/');
    const form=page.locator('.login-card form');
    await form.locator('[name=email]').fill('maker@local.test');
    await form.locator('[name=password]').fill('freedom-local-demo');
    await form.getByRole('button',{name:language.login,exact:true}).click();
    await expect(page.locator('html')).toHaveAttribute('lang',language.id);
    await page.getByRole('button',{name:language.title,exact:true}).click();
    const dialog=page.getByRole('dialog',{name:language.title,exact:true}),outbound=writes(page);
    await expect(dialog.getByRole('heading',{name:language.title,exact:true})).toBeVisible();
    await expect(dialog.getByRole('button',{name:language.close,exact:true})).toBeVisible();
    await expect(dialog.getByRole('button',{name:language.publish,exact:true})).toBeDisabled();
    const checkLayout=async(publishLabel:string)=>{
      for(const width of [320,390,1280]){
        await page.setViewportSize({width,height:844});
        expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth),`${language.id} ${width}: composer has no horizontal overflow`).toBe(true);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${language.id} ${width}: document has no horizontal overflow`).toBe(true);
        const dialogBox=(await dialog.boundingBox())!;expect(dialogBox).not.toBeNull();
        expect(dialogBox.x).toBeGreaterThanOrEqual(0);expect(dialogBox.x+dialogBox.width).toBeLessThanOrEqual(width);
        for(const label of [language.close,publishLabel]){
          const control=dialog.getByRole('button',{name:label,exact:true});await control.scrollIntoViewIfNeeded();
          const box=(await control.boundingBox())!;expect(box).not.toBeNull();
          expect(box.height,`${language.id} ${width}: ${label} touch target`).toBeGreaterThanOrEqual(44);
          expect(box.x).toBeGreaterThanOrEqual(dialogBox.x);expect(box.x+box.width).toBeLessThanOrEqual(dialogBox.x+dialogBox.width);
        }
      }
    };
    const draft='原文 stays unchanged 🎨\nhttps://example.test/?a=1&b=2',source=dialog.getByLabel(language.content,{exact:true}),trigger=dialog.getByRole('button',{name:language.share,exact:true});
    await source.fill(draft);
    const labels=textToolLabels[language.id],emoji=dialog.getByRole('button',{name:labels.emoji,exact:true}),mention=dialog.getByRole('button',{name:labels.mention,exact:true});
    await expect(emoji).toBeEnabled();await expect(emoji).toHaveAttribute('title',labels.emoji);
    await expect(mention).toBeEnabled();await expect(mention).toHaveAttribute('title',labels.mention);
    if(language.id==='en'){
      await emoji.click();
      await dialog.getByRole('region',{name:'emoji',exact:true}).getByRole('button',{name:'Insert 🎉',exact:true}).click();
      await expect(source).toHaveValue(`${draft}🎉`);await expect(source).toBeFocused();
      expect(await source.evaluate((input:HTMLTextAreaElement)=>[input.selectionStart,input.selectionEnd])).toEqual([draft.length+2,draft.length+2]);
      await source.fill(draft);
    }
    await mention.click();
    const picker=dialog.getByRole('region',{name:labels.mention,exact:true}),search=picker.getByRole('searchbox',{name:labels.search,exact:true});
    await expect(search).toBeVisible();await search.press('Escape');
    await expect(picker).toHaveCount(0);await expect(dialog).toBeVisible();
    // Dismissing the mention picker returns to its shared emoji toolbar anchor.
    await expect(emoji).toBeFocused();await expect(source).toHaveValue(draft);
    await expect(dialog.getByRole('button',{name:language.publish,exact:true})).toBeEnabled();
    await expect(trigger).toHaveAttribute('aria-expanded','false');
    await checkLayout(language.publish);
    await trigger.click();
    const panel=dialog.getByRole('region',{name:language.panel,exact:true});
    await expect(panel.getByRole('button',{name:language.enable,exact:true})).toBeVisible();
    await expect(panel.getByRole('button',{name:'X',exact:true})).toHaveCount(0);
    await expect(dialog.getByRole('button',{name:language.workshop,exact:true})).toBeEnabled();
    await expect(dialog.getByRole('button',{name:language.publish,exact:true})).toHaveCount(0);
    await checkLayout(language.workshop);
    await panel.getByRole('button',{name:language.collapse,exact:true}).click();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded','false');
    await expect(dialog.getByRole('button',{name:language.publish,exact:true})).toBeEnabled();
    await trigger.click();
    await panel.getByRole('button',{name:language.decline,exact:true}).click();
    await expect(trigger).toBeFocused();await expect(source).toHaveValue(draft);
    await expect(dialog.getByRole('button',{name:language.publish,exact:true})).toBeEnabled();
    await dialog.getByRole('button',{name:language.close,exact:true}).click();
    await page.getByRole('button',{name:language.title,exact:true}).click();
    await expect(source).toHaveValue(draft);await trigger.click();
    await expect(panel.getByRole('button',{name:language.enable,exact:true})).toBeVisible();
    for(const name of ['X','Instagram','Facebook','Threads'])await expect(panel.getByRole('button',{name,exact:true})).toHaveCount(0);
    await expect(panel.getByRole('link')).toHaveCount(0);
    expect(outbound).toHaveLength(0);
    expect(await page.evaluate(()=>localStorage.getItem('freedom-interface-language-v1'))).toBeNull();
  }finally{await context.close();}
});

test('sharing loads only on demand, consent cancellation preserves copy and returns keyboard focus with zero post writes',async({page})=>{
  const outbound=writes(page);let loads=0,release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve});
  await page.route('**/assets/SocialCrossPlatformShare-*.js',async route=>{loads++;await gate;await route.continue();});
  const dialog=await composer(page),source=dialog.getByLabel('貼文內容',{exact:true}),trigger=dialog.getByRole('button',{name:'↗ Social Post 分享',exact:true});
  await source.fill('我的原始草稿，取消後還要保留。');expect(loads).toBe(0);await expect(trigger).toHaveAttribute('aria-expanded','false');
  await trigger.click();await expect(dialog.getByRole('status').filter({hasText:'正在開啟分享工具'})).toBeVisible();release();
  const panel=dialog.getByRole('region',{name:'多平台分享',exact:true});await expect(panel).toContainText('限制帳號或停權');await expect(panel.getByRole('button',{name:'X',exact:true})).toHaveCount(0);
  await panel.getByRole('button',{name:'先不要',exact:true}).click();await expect(trigger).toBeFocused();await expect(source).toHaveValue('我的原始草稿，取消後還要保留。');expect(outbound).toHaveLength(0);expect(loads).toBe(1);
  await trigger.click();await expect(panel.getByRole('button',{name:'了解並開啟',exact:true})).toBeVisible();expect(loads).toBe(1);
});

test('four clickable logos light up; official intent copy and explicit per-platform progress never publish automatically',async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);await context.route('https://twitter.com/**',route=>route.fulfill({contentType:'text/html',body:'<title>Controlled official composer handoff</title>'}));
  const {dialog,panel}=await sharing(page),outbound=writes(page),caption='同一份作品\nhttps://example.test/?a=1&b=2 #設計';await dialog.getByLabel('貼文內容',{exact:true}).fill(caption);
  for(const name of ['X','Instagram','Facebook','Threads']){const logo=panel.getByRole('button',{name,exact:true});await expect(logo).toHaveAttribute('aria-pressed','false');await logo.click();await expect(logo).toHaveAttribute('aria-pressed','true');}
  await expect(panel.locator('.social-share-selection')).toHaveText('已選 4 個平台');await panel.getByLabel('分享素材',{exact:true}).setInputFiles(image);await expect(panel.getByRole('status').filter({hasText:'素材已加入'})).toBeVisible();
  await panel.getByRole('button',{name:'準備分享',exact:true}).click();await panel.getByRole('button',{name:'複製文案',exact:true}).click();expect((await page.evaluate(()=>navigator.clipboard.readText())).replace(/\r\n/g,'\n')).toBe(caption);
  const link=panel.getByRole('link',{name:'開啟 X ↗',exact:true}),url=new URL((await link.getAttribute('href'))!);expect(url.origin).toBe('https://twitter.com');expect(url.searchParams.get('text')).toBe(caption);
  const opened=page.waitForEvent('popup');await link.click();const popup=await opened;await popup.waitForLoadState('domcontentloaded');expect(new URL(popup.url()).searchParams.get('text')).toBe(caption);await popup.close();
  await expect(panel.locator('.social-share-progress')).toHaveText('本人確認完成 0/4');await expect(panel).toContainText('已請求開啟');
  await panel.getByRole('button',{name:'我已完成發布',exact:true}).click();await expect(panel.locator('.social-share-progress')).toHaveText('本人確認完成 1/4');await expect(panel.locator('.social-share-step-toggle').nth(1)).toBeFocused();await expect(panel.getByRole('link',{name:'開啟 Instagram ↗',exact:true})).toHaveAttribute('href','https://www.instagram.com/');
  await panel.getByRole('button',{name:'我已完成發布',exact:true}).click();await expect(panel.getByRole('link',{name:'開啟 Facebook ↗',exact:true})).toHaveAttribute('href','https://www.facebook.com/');
  await panel.getByRole('button',{name:'我已完成發布',exact:true}).click();const threads=new URL((await panel.getByRole('link',{name:'開啟 Threads ↗',exact:true}).getAttribute('href'))!);expect(threads.origin).toBe('https://www.threads.com');expect(threads.searchParams.get('text')).toBe(caption);
  await panel.getByRole('button',{name:'我已完成發布',exact:true}).click();await expect(panel).toContainText('你已確認所有選擇的平台');expect(outbound).toHaveLength(0);
});

test('editing a prepared draft and closing the composer preserve the exact original handoff until explicit re-preparation',async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);const {dialog,panel}=await sharing(page),source=dialog.getByLabel('貼文內容',{exact:true});await source.fill('週一，台北的原始作品。');await panel.getByRole('button',{name:'X',exact:true}).click();await panel.getByRole('button',{name:'Threads',exact:true}).click();
  await panel.getByLabel('分享素材',{exact:true}).setInputFiles(image);await panel.getByRole('button',{name:'準備分享',exact:true}).click();await panel.getByRole('button',{name:'我已完成發布',exact:true}).click();await source.fill('週二，台中的新作品。');await expect(panel.getByRole('status').filter({hasText:'文案、平台或素材已變更'})).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'建立貼文',exact:true})).toBeFocused();await page.getByRole('button',{name:'建立貼文',exact:true}).click();await expect(source).toHaveValue('週二，台中的新作品。');
  await expect(panel.locator('.social-share-progress')).toHaveText('本人確認完成 1/2');await expect(panel.locator('.social-share-files')).toContainText('原始作品.png');await panel.getByRole('button',{name:'複製文案',exact:true}).click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('週一，台北的原始作品。');
  await panel.getByRole('button',{name:'使用目前內容重新準備',exact:true}).click();await expect(panel.locator('.social-share-progress')).toHaveText('本人確認完成 0/2');await panel.getByRole('button',{name:'複製文案',exact:true}).click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('週二，台中的新作品。');
  const storage=await page.evaluate(()=>JSON.stringify(Object.entries(localStorage).concat(Object.entries(sessionStorage))));for(const privateValue of ['週一，台北','週二，台中','原始作品.png'])expect(storage).not.toContain(privateValue);
});

test('Instagram requires originals; bad media retains existing files and unsupported devices offer a real download fallback',async({page})=>{
  await page.addInitScript(()=>{Object.defineProperty(navigator,'share',{configurable:true,value:undefined});Object.defineProperty(navigator,'canShare',{configurable:true,value:undefined});});
  const {dialog,panel}=await sharing(page),outbound=writes(page);await dialog.getByLabel('貼文內容',{exact:true}).fill('這是原始素材。');await panel.getByRole('button',{name:'Instagram',exact:true}).click();await panel.getByRole('button',{name:'準備分享',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('Instagram 需要照片或影片');
  const files=panel.getByLabel('分享素材',{exact:true});await files.setInputFiles(image);await expect(panel.locator('.social-share-files li')).toHaveCount(1);
  await files.setInputFiles({name:'偽裝.png',mimeType:'image/png',buffer:Buffer.from('not a real PNG')});await expect(panel.getByRole('alert')).toContainText('檔案內容不符合格式');await expect(panel.locator('.social-share-files li')).toHaveCount(1);
  await files.setInputFiles({name:'太大.png',mimeType:'image/png',buffer:Buffer.alloc(10*1024*1024+1)});await expect(panel.getByRole('alert')).toContainText('照片需在 10 MB 內');await expect(panel.locator('.social-share-files li')).toHaveCount(1);
  await panel.getByRole('button',{name:'準備分享',exact:true}).click();await expect(panel).toContainText('此裝置未提供素材分享');await expect(panel.getByRole('button',{name:/^分享素材（請選/})).toHaveCount(0);
  const downloaded=page.waitForEvent('download');await panel.getByRole('button',{name:'下載 原始作品.png',exact:true}).click();expect((await downloaded).suggestedFilename()).toBe('原始作品.png');expect(outbound).toHaveLength(0);
});

test('OS cancellation, device delivery and failure have distinct feedback without invented publication status',async({page})=>{
  await page.addInitScript(()=>{
    const control={mode:'cancel',calls:0,names:[] as string[],release:()=>{}};Object.assign(window,{shareControl:control});
    Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:(data:ShareData)=>{control.calls++;control.names=data.files!.map(file=>file.name);return control.mode==='cancel'?Promise.reject(new DOMException('cancel','AbortError')):control.mode==='fail'?Promise.reject(new DOMException('denied','NotAllowedError')):new Promise<void>(resolve=>{control.release=resolve;});}});
  });
  const {dialog,panel}=await sharing(page);await dialog.getByLabel('貼文內容',{exact:true}).fill('系統分享不等於發布完成。');await panel.getByRole('button',{name:'Instagram',exact:true}).click();await panel.getByLabel('分享素材',{exact:true}).setInputFiles(image);await panel.getByRole('button',{name:'準備分享',exact:true}).click();
  const button=panel.getByRole('button',{name:'分享素材（請選 Instagram）',exact:true});await button.click();await expect(panel.getByRole('alert')).toContainText('已取消系統分享');await expect(panel.locator('.social-share-progress')).toHaveText('本人確認完成 0/1');
  await page.evaluate(()=>{(window as unknown as {shareControl:{mode:string}}).shareControl.mode='success';});await button.click();await expect(panel.getByRole('button',{name:'等待系統分享…',exact:true})).toBeDisabled();
  await page.evaluate(()=>{(window as unknown as {shareControl:{release:()=>void}}).shareControl.release();});await expect(panel.getByRole('status').filter({hasText:'已交給系統分享，目的地與發布結果尚未確認'})).toBeVisible();await expect(panel.locator('.social-share-progress')).toHaveText('本人確認完成 0/1');
  await page.evaluate(()=>{(window as unknown as {shareControl:{mode:string}}).shareControl.mode='fail';});await button.click();await expect(panel.getByRole('alert')).toContainText('系統分享未完成');await expect(panel.locator('.social-share-files')).toContainText('原始作品.png');
  expect(await page.evaluate(()=>(window as unknown as {shareControl:{calls:number;names:string[]}}).shareControl)).toMatchObject({calls:3,names:['原始作品.png']});
});

test('clipboard denial opens selectable caption; disabling preserves draft and blocks all handoff controls',async({page})=>{
  await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new DOMException('blocked','NotAllowedError'))}});});
  const {dialog,panel}=await sharing(page),source=dialog.getByLabel('貼文內容',{exact:true});await source.fill('手動複製也要保留這份原稿。');await panel.getByRole('button',{name:'X',exact:true}).click();await panel.getByRole('button',{name:'準備分享',exact:true}).click();await panel.getByRole('button',{name:'複製文案',exact:true}).click();
  await expect(panel.getByRole('alert')).toContainText('請選取下方文案手動複製');await expect(panel.getByLabel('分享文案',{exact:true})).toHaveValue('手動複製也要保留這份原稿。');
  await panel.getByRole('button',{name:'關閉功能',exact:true}).click();await expect(source).toHaveValue('手動複製也要保留這份原稿。');await expect(panel.getByRole('link')).toHaveCount(0);await expect(panel.getByRole('button',{name:'複製文案',exact:true})).toHaveCount(0);
  await panel.getByRole('button',{name:'了解並開啟',exact:true}).click();await expect(panel.getByLabel('分享文案',{exact:true})).toHaveValue('手動複製也要保留這份原稿。');
});

test('phone and desktop logo selection fits all themes, shows focus and honors reduced motion',async({page})=>{
  await page.setViewportSize({width:320,height:800});await page.emulateMedia({reducedMotion:'reduce'});const {dialog,panel}=await sharing(page);await panel.getByRole('button',{name:'X',exact:true}).click();await panel.getByRole('button',{name:'Threads',exact:true}).click();
  for(const theme of ['light','rpg','versefolk']){
    await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);await panel.getByRole('button',{name:'X',exact:true}).scrollIntoViewIfNeeded();
    expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    for(const name of ['X','Instagram','Facebook','Threads']){const button=panel.getByRole('button',{name,exact:true}),box=(await button.boundingBox())!;expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);expect(await button.evaluate(element=>getComputedStyle(element).transitionDuration)).toBe('0s');}
    await expect(dialog.getByRole('button',{name:'關閉發文',exact:true})).toBeInViewport();await page.screenshot({path:`test-results/social-share-${theme}-320.png`});
  }
  await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.screenshot({path:'test-results/social-share-light-desktop.png'});
  await panel.getByRole('button',{name:'X',exact:true}).focus();await page.keyboard.press('Space');await expect(panel.getByRole('button',{name:'X',exact:true})).toHaveAttribute('aria-pressed','false');await expect(panel.getByRole('status').filter({hasText:'已選 1 個平台'})).toBeVisible();
  await dialog.getByLabel('貼文內容',{exact:true}).fill('手機也能接著完成同一份分享。');await panel.getByLabel('分享素材',{exact:true}).setInputFiles(image);await panel.getByRole('button',{name:'準備分享',exact:true}).click();await expect(panel.locator('.social-share-step-toggle').first()).toBeFocused();
  for(const width of [320,1280])for(const theme of ['light','rpg','versefolk']){
    await page.setViewportSize({width,height:900});await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);await panel.getByRole('link',{name:'開啟 Threads ↗',exact:true}).scrollIntoViewIfNeeded();
    expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    for(const control of await panel.locator('.social-share-step-body').getByRole('button').all()){const box=(await control.boundingBox())!;expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);}
    const linkBox=(await panel.getByRole('link',{name:'開啟 Threads ↗',exact:true}).boundingBox())!;expect(linkBox.height).toBeGreaterThanOrEqual(44);await expect(dialog.getByRole('button',{name:'關閉發文',exact:true})).toBeInViewport();await page.screenshot({path:`test-results/social-share-prepared-${theme}-${width}.png`});
  }
  await panel.getByRole('button',{name:'收合',exact:true}).click();await expect(dialog.getByRole('button',{name:'↗ Social Post 分享',exact:true})).toBeFocused();
});

test('five sharing languages preserve selected logos and original captions across actual settings changes',async({page})=>{
  const initial=await sharing(page);let dialog=initial.dialog;const outbound=writes(page);
  await dialog.getByLabel('貼文內容',{exact:true}).fill('不翻譯會員自己的文字。');await initial.panel.getByRole('button',{name:'X',exact:true}).click();
  let current:typeof sharingLanguages[number]=sharingLanguages[0];
  for(const language of [...sharingLanguages.slice(1),sharingLanguages[0]]){
    await dialog.getByRole('button',{name:current.close,exact:true}).click();await page.locator('.settings-menu-button').click();await openSettingsPanel(page,'language');await page.getByRole('menuitemradio',{name:language.name,exact:true}).click();await closeSettingsMenu(page);
    await expect(page.locator('html')).toHaveAttribute('lang',language.id);
    await page.getByRole('button',{name:language.title,exact:true}).click();dialog=page.getByRole('dialog',{name:language.title,exact:true});
    const translated=dialog.getByRole('region',{name:language.panel,exact:true});
    await expect(translated.locator('.social-share-selection')).toHaveText(language.selected);
    await expect(translated.getByRole('button',{name:'X',exact:true})).toHaveAttribute('aria-pressed','true');
    for(const name of ['Instagram','Facebook','Threads'])await expect(translated.getByRole('button',{name,exact:true})).toHaveAttribute('aria-pressed','false');
    await expect(dialog.getByLabel(language.content,{exact:true})).toHaveValue('不翻譯會員自己的文字。');
    await expect(dialog.getByRole('button',{name:language.workshop,exact:true})).toBeEnabled();
    await expect(dialog.getByRole('button',{name:language.share,exact:true})).toHaveAttribute('aria-expanded','true');
    await expect(translated.getByRole('button',{name:language.enable,exact:true})).toHaveCount(0);
    current=language;
  }
  expect(outbound).toHaveLength(0);
});

test('real logout and another login clear opt-in, prepared private caption, original media and progress',async({page})=>{
  const {dialog,panel}=await sharing(page);await dialog.getByLabel('貼文內容',{exact:true}).fill('PRIVATE-MEMBER-DRAFT-ONLY');await panel.getByRole('button',{name:'Instagram',exact:true}).click();await panel.getByLabel('分享素材',{exact:true}).setInputFiles(image);await panel.getByRole('button',{name:'準備分享',exact:true}).click();
  await dialog.getByRole('button',{name:'關閉發文',exact:true}).click();await page.getByRole('button',{name:'設定',exact:true}).click();await page.getByRole('menuitem',{name:'登出',exact:true}).click();await expect(page.getByRole('button',{name:'登入',exact:true})).toBeVisible();
  await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();await page.getByRole('button',{name:'建立貼文',exact:true}).click();await expect(dialog.getByLabel('貼文內容',{exact:true})).toHaveValue('');
  await dialog.getByRole('button',{name:'↗ Social Post 分享',exact:true}).click();await expect(panel.getByRole('button',{name:'了解並開啟',exact:true})).toBeVisible();await expect(panel).not.toContainText('PRIVATE-MEMBER-DRAFT-ONLY');await expect(panel).not.toContainText('原始作品.png');
});

test('a failed optional chunk leaves the composer usable and an explicit retry recovers',async({page})=>{
  let attempts=0;await page.route(/\/assets\/SocialCrossPlatformShare-[^/]+\.js(?:\?.*)?$/,async route=>{attempts++;if(attempts===1)await route.abort('failed');else await route.continue();});
  const dialog=await composer(page);await dialog.getByLabel('貼文內容',{exact:true}).fill('載入失敗也不能丟掉草稿。');await dialog.getByRole('button',{name:'↗ Social Post 分享',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('分享工具未能開啟');await expect(dialog.getByLabel('貼文內容',{exact:true})).toHaveValue('載入失敗也不能丟掉草稿。');
  await dialog.getByRole('button',{name:'重試開啟分享',exact:true}).click();await expect(dialog.getByRole('region',{name:'多平台分享',exact:true})).toBeVisible();expect(attempts).toBe(2);
});
