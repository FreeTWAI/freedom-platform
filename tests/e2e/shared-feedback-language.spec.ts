import {openSettingsPanel,closeSettingsMenu} from './settings-menu-helpers.js';
import {test,expect,type Page,type Locator} from './fixtures.js';
import {openChat,closeChat,navigate,openFeatureSearch} from './navigation.js';

// Expected copy is independent of the implementation's interface catalog.
const languages=[
  {id:'zh-Hant',locale:'zh-TW',name:'繁體中文',login:'登入',pending:'處理中…',home:'會員首頁',messages:'我的訊息',working:'正在處理…',reading:'正在讀取…',offline:'目前離線，連線恢復後再試。',opening:'正在開啟我的訊息…',failed:'我的訊息暫時無法開啟。',hint:'請確認網路後重新載入頁面。',reload:'重新載入頁面',back:'返回首頁'},
  {id:'en',locale:'en-US',name:'English',login:'Sign in',pending:'Working…',home:'Home',messages:'Messages',working:'Working…',reading:'Loading…',offline:'You are offline. Try again when connected.',opening:'Opening Messages…',failed:'Messages could not open.',hint:'Check your connection, then reload the page.',reload:'Reload page',back:'Back to home'},
  {id:'ja',locale:'ja-JP',name:'日本語',login:'ログイン',pending:'処理中…',home:'ホーム',messages:'メッセージ',working:'処理中…',reading:'読み込み中…',offline:'オフラインです。接続が戻ってからお試しください。',opening:'メッセージを開いています…',failed:'メッセージを開けません。',hint:'接続を確認してからページを再読み込みしてください。',reload:'ページを再読み込み',back:'ホームに戻る'},
  {id:'ko',locale:'ko-KR',name:'한국어',login:'로그인',pending:'처리 중…',home:'홈',messages:'메시지',working:'처리 중…',reading:'불러오는 중…',offline:'오프라인입니다. 연결이 복구되면 다시 시도해 주세요.',opening:'메시지 여는 중…',failed:'메시지 페이지를 열 수 없습니다.',hint:'연결을 확인한 다음 페이지를 새로고침해 주세요.',reload:'페이지 새로고침',back:'홈으로 돌아가기'},
  {id:'es',locale:'es-ES',name:'Español',login:'Iniciar sesión',pending:'Procesando…',home:'Inicio',messages:'Mensajes',working:'Procesando…',reading:'Cargando…',offline:'Sin conexión. Inténtalo de nuevo cuando se restablezca.',opening:'Abriendo Mensajes…',failed:'No se pudo abrir Mensajes.',hint:'Comprueba la conexión y vuelve a cargar la página.',reload:'Volver a cargar la página',back:'Volver al inicio'},
] as const;
type Language=typeof languages[number];
const contentSearchLabels=['用此關鍵字搜尋社群內容','Search community content with this keyword','このキーワードでコミュニティ内を検索','이 검색어로 커뮤니티 콘텐츠 검색','Buscar contenido de la comunidad con esta palabra clave'];

async function login(page:Page,language:Language=languages[0]){
  await page.goto('/');const form=page.locator('.login-card form');
  await form.locator('[name=email]').fill('maker@local.test');
  await form.locator('[name=password]').fill('freedom-local-demo');
  await form.getByRole('button',{name:language.login,exact:true}).click();
  await expect(page.getByRole('heading',{name:language.home,level:1,exact:true})).toBeVisible();
  await expect(page.locator('.social-write-trigger')).toBeVisible();
}

async function selectLanguage(page:Page,language:Language){
  await page.locator('.settings-menu-button').click();
  await openSettingsPanel(page,'language');await page.getByRole('menuitemradio',{name:language.name,exact:true}).click();
  await closeSettingsMenu(page);
  await expect(page.locator('html')).toHaveAttribute('lang',language.id);
}

async function contained(page:Page,element:Locator){
  const box=(await element.boundingBox())!;expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x+box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}

for(const [index,language] of languages.entries()){
  test(`${language.id}: pending ACK updates its language without remounting the form or resending login`,async({browser})=>{
    const context=await browser.newContext({locale:language.locale,viewport:{width:320,height:844},reducedMotion:'reduce'});
    let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve});let attempts=0;
    try{
      const page=await context.newPage();await page.goto('/');
      const form=page.locator('.login-card form');
      await form.locator('[name=email]').fill('maker@local.test');
      await form.locator('[name=password]').fill('freedom-local-demo');
      await expect(page.locator('.request-feedback')).toHaveCount(0);
      await page.route('**/api/v1/auth/login',async route=>{attempts++;const response=await route.fetch();await gate;await route.fulfill({response});});
      await form.getByRole('button',{name:language.login,exact:true}).click();
      const feedback=page.locator('.request-feedback');
      await expect(feedback).toHaveText(language.working);
      await expect(feedback).toHaveAttribute('role','status');
      await expect(feedback).toHaveAttribute('aria-live','polite');
      await expect(feedback).toHaveAttribute('aria-atomic','true');
      await expect(form.getByRole('button',{name:language.pending,exact:true})).toBeDisabled();
      await expect.poll(()=>attempts).toBe(1);
      const next=languages[(index+1)%languages.length];
      await page.getByRole('combobox',{name:'Language',exact:true}).selectOption(next.id);
      await expect(feedback).toHaveText(next.working);
      await expect(form.getByRole('button',{name:next.pending,exact:true})).toBeDisabled();
      await expect(form.locator('[name=email]')).toHaveValue('maker@local.test');
      await expect(form.locator('[name=password]')).toHaveValue('freedom-local-demo');
      await contained(page,feedback);expect(attempts).toBe(1);
      release();await expect(page.getByRole('heading',{name:next.home,level:1,exact:true})).toBeVisible();
      await expect(feedback).toHaveCount(0);expect(attempts).toBe(1);
    }finally{release();await context.close();}
  });

  test(`${language.id}: a real pending read follows language changes and keeps typed input`,async({browser})=>{
    const context=await browser.newContext({locale:language.locale,viewport:{width:320,height:844}});
    let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve});let reads=0;
    try{
      const page=await context.newPage();
      await page.route('**/api/v1/site',async route=>{reads++;const response=await route.fetch();await gate;await route.fulfill({response});});
      await page.goto('/');const feedback=page.locator('.request-feedback');
      await expect(feedback).toHaveText(language.reading);await expect.poll(()=>reads).toBe(1);
      const input=page.locator('.login-card form [name=email]');await input.fill('kept-feedback@example.test');
      const next=languages[(index+1)%languages.length];
      await page.getByRole('combobox',{name:'Language',exact:true}).selectOption(next.id);
      await expect(feedback).toHaveText(next.reading);await expect(input).toHaveValue('kept-feedback@example.test');
      for(const width of [320,390,1280]){await page.setViewportSize({width,height:844});await contained(page,feedback);}
      expect(reads).toBe(1);release();await expect(feedback).toHaveCount(0);expect(reads).toBe(1);
    }finally{release();await context.close();}
  });

  test(`${language.id}: offline feedback remains readable in all themes and device widths`,async({browser},info)=>{
    const context=await browser.newContext({locale:language.locale,viewport:{width:320,height:844},reducedMotion:'reduce'});
    try{
      const page=await context.newPage();await login(page,language);await expect(page.locator('.request-feedback')).toHaveCount(0);
      await context.setOffline(true);const feedback=page.locator('.request-feedback');await expect(feedback).toHaveText(language.offline);
      for(const [theme,name] of ['自由工坊－明亮','自由工坊－夜航','自由工坊－敘生'].entries()){
        await page.locator('.settings-menu-button').click();await openSettingsPanel(page,'appearance');await page.getByRole('menuitemradio',{name,exact:true}).click();await closeSettingsMenu(page);
        for(const width of [320,390,1280]){
          await page.setViewportSize({width,height:844});await contained(page,feedback);
          const style=await feedback.evaluate(element=>({background:getComputedStyle(element).backgroundColor,pointerEvents:getComputedStyle(element).pointerEvents}));
          expect(style.background).not.toBe('rgba(0, 0, 0, 0)');expect(style.pointerEvents).toBe('none');
          const settings=(await page.locator('.settings-menu-button').boundingBox())!;
          expect(settings.width).toBeGreaterThanOrEqual(44);expect(settings.height).toBeGreaterThanOrEqual(44);
          if(language.id==='es'&&width===320)await page.screenshot({path:info.outputPath(`offline-es-theme-${theme}-320.png`),fullPage:true});
        }
      }
      await context.setOffline(false);await expect(feedback).toHaveCount(0);
    }finally{await context.setOffline(false);await context.close();}
  });
}

test('a held deferred page translates in place and navigation can still leave it',async({page},info)=>{
  await login(page);let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve});let assets=0;
  await page.route(/\/assets\/MemberMessages-[^/]+\.js$/,async route=>{assets++;await gate;await route.continue();});
  try{
    await openChat(page);
    for(const language of languages){
      await closeChat(page);await selectLanguage(page,language);await openChat(page);await expect(page.locator('.page-loading')).toContainText(language.opening);
      await expect(page.locator('#workspace-navigation')).toBeVisible();expect(assets).toBe(1);
    }
    await page.setViewportSize({width:320,height:844});await page.emulateMedia({reducedMotion:'reduce'});
    await contained(page,page.locator('.page-loading'));
    expect(await page.locator('.page-loading .request-feedback-progress').evaluate(element=>getComputedStyle(element).animationName)).toBe('none');
    await page.screenshot({path:info.outputPath('loading-es-320.png'),fullPage:true});
    await page.setViewportSize({width:1280,height:844});
    await closeChat(page);await page.locator('#workspace-navigation').getByRole('button',{name:'Inicio',exact:true}).click();
    await expect(page.locator('.social-write-trigger')).toBeVisible();
  }finally{release();}
  expect(assets).toBe(1);
  await openChat(page);
  await expect(page.getByRole('tab',{name:/^私人訊息/})).toBeVisible();expect(assets).toBe(1);
});

test('a failed deferred page keeps its failure and translated recovery controls on language changes',async({page},info)=>{
  await login(page);let assets=0;
  await page.route(/\/assets\/MemberMessages-[^/]+\.js$/,route=>{assets++;return route.abort();});
  await openChat(page);
  for(const language of languages){
    await closeChat(page);await selectLanguage(page,language);await openChat(page);const alert=page.getByRole('alert');
    await expect(alert).toContainText(language.failed);await expect(alert).toContainText(language.hint);
    await expect(alert.getByRole('button',{name:language.reload,exact:true})).toBeVisible();
    await expect(alert.getByRole('link',{name:language.back,exact:true})).toHaveAttribute('href','/#home');
    for(const width of [320,390,1280]){
      await page.setViewportSize({width,height:844});await contained(page,alert);
      for(const action of [alert.getByRole('button',{name:language.reload,exact:true}),alert.getByRole('link',{name:language.back,exact:true})]){
        const box=(await action.boundingBox())!;expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);
        await contained(page,action);
      }
    }
    expect(assets).toBe(1);
  }
  await page.setViewportSize({width:320,height:844});await page.screenshot({path:info.outputPath('recovery-es-320.png'),fullPage:true});
  await page.getByRole('link',{name:'Volver al inicio',exact:true}).click();
  await expect(page.locator('.floating-message-panel')).toBeHidden();
  await expect(page.locator('.social-write-trigger')).toBeVisible();expect(assets).toBe(1);
});


for (const [index, language] of languages.entries()) {
  test(`${language.id}: feature search recovers from no results and keeps keyboard focus`, async ({browser}) => {
    const context=await browser.newContext({locale:language.locale,viewport:{width:1280,height:844}});
    try {
      const page=await context.newPage();await login(page,language);
      const mobile=page.locator('.mobile-menu-toggle');
      if(await mobile.isVisible())await mobile.click();
      const menu=page.locator('.nav-more'),trigger=menu.locator(':scope > summary');
      await trigger.click();
      const search=menu.locator('input[type=search]');await expect(search).toBeFocused();
      const contentSearch=menu.getByRole('button',{name:contentSearchLabels[index],exact:true});
      await expect(contentSearch).toHaveCount(0);
      const status=menu.getByRole('status');await expect(status).toHaveCount(1);await expect(status).toBeEmpty();
      await search.fill('zz-no-feature-93275');
      await expect(status).toBeVisible();
      const results=['功能搜尋結果','Feature search results','機能の検索結果','기능 검색 결과','Resultados de funciones'];
      await expect(status).toContainText(results[index]);
      await expect(status).toContainText('0');
      await expect(status).not.toContainText('沒有符合的功能');
      await expect(contentSearch).toBeVisible();
      await search.dispatchEvent('keydown',{key:'Escape',isComposing:true,keyCode:229});
      await expect(search).toHaveValue('zz-no-feature-93275');
      await expect(trigger).toHaveAttribute('aria-expanded','true');
      await search.press('Escape');await expect(search).toHaveValue('');
      await expect(status).toHaveCount(1);await expect(status).toBeEmpty();
      await expect(search).toBeFocused();await expect(trigger).toHaveAttribute('aria-expanded','true');
      await search.press('Escape');await expect(trigger).toHaveAttribute('aria-expanded','false');
      await expect(trigger).toBeFocused();
      await trigger.press('Enter');await expect(search).toBeFocused();await expect(search).toHaveValue('');
      await search.fill('zz-no-feature-93275');
      const panel=(await menu.locator('.nav-more-content').boundingBox())!;expect(panel).not.toBeNull();
      const heading=page.getByRole('heading',{name:language.home,level:1,exact:true});
      const title=(await heading.boundingBox())!;expect(title).not.toBeNull();
      // Click the heading's uncovered left portion, outside the panel's horizontal bounds.
      expect(title.x).toBeLessThan(panel.x);
      await heading.click({position:{x:Math.min(title.width,panel.x-title.x)/2,y:title.height/2}});
      await expect(trigger).toHaveAttribute('aria-expanded','false');
      await trigger.click();await expect(search).toHaveValue('');
      await expect(contentSearch).toHaveCount(0);
      await search.fill('   ');await expect(contentSearch).toHaveCount(0);
      await search.fill(language.home);
      await expect(menu.getByRole('region',{name:results[index]}).getByRole('button',{name:language.home,exact:true})).toBeVisible();
      await expect(contentSearch).toBeVisible();
      const original='  資安 GitHub & C++ #?= / 🛠  ';
      let contentReads=0;page.on('request',request=>{if(new URL(request.url()).pathname==='/api/v1/community-search')contentReads++;});
      await search.fill(original);
      const before=page.url();
      for(const composition of [{isComposing:true,keyCode:13},{isComposing:false,keyCode:229}]){
        await search.dispatchEvent('keydown',{key:'Enter',...composition});
        await expect(search).toHaveValue(original);await expect(search).toBeFocused();
        await expect(trigger).toHaveAttribute('aria-expanded','true');
        expect(page.url()).toBe(before);expect(contentReads).toBe(0);
      }
      await search.press('Enter');
      await expect(search).toHaveValue(original);await expect(search).toBeFocused();
      await expect(trigger).toHaveAttribute('aria-expanded','true');
      expect(page.url()).toBe(before);expect(contentReads).toBe(0);
      const request=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/v1/community-search'&&new URL(request.url()).searchParams.get('q')===original);
      // The explicit secondary action, not Enter in feature search, starts content search.
      await contentSearch.focus();await contentSearch.press('Enter');await request;
      await expect(page.getByRole('searchbox',{name:'關鍵字',exact:true})).toHaveValue(original);
      await expect.poll(()=>new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('q')).toBe(original);
      await expect(trigger).toHaveAttribute('aria-expanded','false');
    } finally {await context.close();}
  });
}

test('Safari Escape with keyCode 229 alone keeps the feature query and menu open',async({page})=>{
  await page.setViewportSize({width:1280,height:844});await login(page);
  const menu=page.locator('.nav-more'),trigger=menu.locator(':scope > summary');
  await trigger.click();
  const search=menu.getByRole('searchbox',{name:'搜尋功能'});await expect(search).toBeFocused();
  await search.fill('zz-no-feature-93275');
  await search.dispatchEvent('keydown',{key:'Escape',keyCode:229,isComposing:false});
  await expect(search).toHaveValue('zz-no-feature-93275');
  await expect(trigger).toHaveAttribute('aria-expanded','true');await expect(search).toBeFocused();
  // The empty-query branch must also ignore Safari's composition key code.
  await search.fill('');
  await search.dispatchEvent('keydown',{key:'Escape',keyCode:229,isComposing:false});
  await expect(search).toHaveValue('');
  await expect(trigger).toHaveAttribute('aria-expanded','true');await expect(search).toBeFocused();
});

for(const [index,width] of [320,390,1280].entries())test(`${width}px content search handoff closes navigation and retains query history`,async({page})=>{
  await page.setViewportSize({width,height:844});await login(page);
  await page.locator('.settings-menu-button').click();await openSettingsPanel(page,'appearance');
  await page.getByRole('menuitemradio',{name:['自由工坊－明亮','自由工坊－夜航','自由工坊－敘生'][index],exact:true}).click();
  await closeSettingsMenu(page);
  const menu=page.locator('.nav-more'),trigger=menu.locator(':scope > summary');
  const search=menu.getByRole('searchbox',{name:'搜尋功能',exact:true});
  const handoff=menu.getByRole('button',{name:contentSearchLabels[0],exact:true});
  const original='  資安 GitHub & C++ #?= / 🛠  ';
  for(const query of [original,'作品']){
    await openFeatureSearch(page);await expect(search).toHaveValue('');await search.fill(query);
    await expect(handoff).toBeVisible();await contained(page,handoff);
    const box=(await handoff.boundingBox())!;expect(box.height).toBeGreaterThanOrEqual(44);
    await handoff.click();
    await expect(page.getByRole('searchbox',{name:'關鍵字',exact:true})).toHaveValue(query);
    await expect(page.getByRole('region',{name:'社群內容搜尋結果',exact:true})).toHaveAttribute('aria-busy','false');
    await expect(trigger).toHaveAttribute('aria-expanded','false');
    if(width<861){
      await expect(page.locator('.mobile-menu-toggle')).toHaveAttribute('aria-expanded','false');
      await expect(page.locator('#workspace-navigation')).toBeHidden();
    }
  }
  // A second handoff while already on the content page updates its existing controller.
  await page.goBack();await expect(page.getByRole('searchbox',{name:'關鍵字',exact:true})).toHaveValue(original);
  await page.goForward();await expect(page.getByRole('searchbox',{name:'關鍵字',exact:true})).toHaveValue('作品');
});

for(const capability of ['disabled','missing'] as const)test(`feature search has no content handoff when capability is ${capability}`,async({page})=>{
  // Only the advertised capability is varied; no product flag or server policy changes.
  await page.route('**/api/v1/site',async route=>{
    const response=await route.fetch(),site=await response.json();
    if(capability==='missing')delete site.community_search_enabled;else site.community_search_enabled=false;
    await route.fulfill({response,json:site});
  });
  let contentReads=0;page.on('request',request=>{if(new URL(request.url()).pathname==='/api/v1/community-search')contentReads++;});
  await login(page);await openFeatureSearch(page);
  const menu=page.locator('.nav-more'),search=menu.getByRole('searchbox',{name:'搜尋功能',exact:true});
  await search.fill('zz-no-feature-93275');
  await expect(menu.getByRole('status')).toContainText('0');
  await expect(menu.getByRole('button',{name:contentSearchLabels[0],exact:true})).toHaveCount(0);
  await search.fill('會員首頁');
  await expect(menu.getByRole('region',{name:'功能搜尋結果'}).getByRole('button',{name:'會員首頁',exact:true})).toBeVisible();
  await expect(menu.getByRole('button',{name:contentSearchLabels[0],exact:true})).toHaveCount(0);
  expect(contentReads).toBe(0);
});

test('content search handoff respects unsaved page departure protection',async({page})=>{
  await login(page);await navigate(page,'社群活動');
  await page.getByRole('button',{name:'＋ 提交活動',exact:true}).click();
  const form=page.locator('form').filter({has:page.getByRole('heading',{name:'提交活動',exact:true})});
  await form.getByLabel('活動名稱',{exact:true}).fill('必須保留的搜尋測試草稿');
  let discard=false,prompts=0,writes=0;
  page.on('dialog',async dialog=>{prompts++;await(discard?dialog.accept():dialog.dismiss());});
  page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/v1/events')writes++;});
  const menu=page.locator('.nav-more');
  for(const accepted of [false,true]){
    discard=accepted;await openFeatureSearch(page);
    await menu.getByRole('searchbox',{name:'搜尋功能',exact:true}).fill('資安');
    await menu.getByRole('button',{name:contentSearchLabels[0],exact:true}).click();
    if(!accepted){
      await expect(page).toHaveURL(/#events$/);
      await expect(form.getByLabel('活動名稱',{exact:true})).toHaveValue('必須保留的搜尋測試草稿');
      expect(prompts).toBe(1);
    }
  }
  await expect(page.getByRole('searchbox',{name:'關鍵字',exact:true})).toHaveValue('資安');
  expect(prompts).toBe(2);expect(writes).toBe(0);
});

test('390px feature search consumes two Escapes before the phone menu closes',async({page})=>{
  await page.setViewportSize({width:390,height:844});await login(page);
  const toggle=page.locator('.mobile-menu-toggle');await toggle.click();
  const nav=page.locator('#workspace-navigation');await expect(nav).toBeVisible();
  const menu=nav.locator('.nav-more'),trigger=menu.locator(':scope > summary');
  await trigger.click();
  const search=menu.getByRole('searchbox',{name:'搜尋功能'});await expect(search).toBeFocused();
  await search.fill('zz-no-feature-93275');
  await search.press('Escape');await expect(search).toHaveValue('');await expect(search).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded','true');await expect(toggle).toHaveAttribute('aria-expanded','true');
  await search.press('Escape');await expect(trigger).toHaveAttribute('aria-expanded','false');await expect(trigger).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded','true');await expect(nav).toBeVisible();
  await trigger.press('Escape');await expect(toggle).toHaveAttribute('aria-expanded','false');
  await expect(nav).toBeHidden();await expect(toggle).toBeFocused();
});

test('failed lazy import recovers by loading a new document after the network returns',async({page})=>{
  await login(page);
  const asset=/\/assets\/MemberMessages-[^/]+\.js$/;
  let failed=0;await page.route(asset,route=>{failed++;return route.abort();});
  await openChat(page);
  const alert=page.getByRole('alert').filter({hasText:languages[0].failed});
  await expect(alert).toBeVisible();expect(failed).toBe(1);
  await page.unroute(asset);
  const documentLoaded=page.waitForEvent('load');
  await alert.getByRole('button',{name:languages[0].reload,exact:true}).click();
  await documentLoaded;
  await expect(page.getByRole('heading',{name:languages[0].home,level:1,exact:true})).toBeVisible();
  await openChat(page);
  await expect(page.getByRole('tab',{name:/^私人訊息/})).toBeVisible();
  await expect(page.getByRole('alert').filter({hasText:languages[0].failed})).toHaveCount(0);
});
