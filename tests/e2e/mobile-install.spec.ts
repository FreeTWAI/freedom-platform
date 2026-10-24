import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test,expect,type Page} from './fixtures.js';
import {navigate,closeChat} from './navigation.js';

async function login(page:Page){
  await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  await page.getByRole('button',{name:'登入',exact:true}).click();await expect(page.getByRole('heading',{name:'會員首頁',level:1,exact:true})).toBeVisible();
}

test('real manifest and square brand icons have stable public launch URLs and no registered offline worker',async({playwright,browserName,baseURL},info)=>{
  // Native installability rejects incognito contexts. Use only this case's empty
  // profile, while preserving the project's configured browser executable/options.
  const profile=await mkdtemp(join(tmpdir(),'freedom-pwa-installability-'));
  try{
    const browserType=playwright[browserName];
    const context=await browserType.launchPersistentContext(profile,{...info.project.use.launchOptions,baseURL});
    try{
      const page=context.pages()[0]??await context.newPage();
      await page.goto('/#reset-password/'+ 'a'.repeat(43));
      const manifest=await page.request.get('/manifest.webmanifest');expect(manifest.status()).toBe(200);expect(manifest.headers()['content-type']).toContain('application/manifest+json');
      const data=await manifest.json();expect(data.id).toBe('/');expect(data.start_url).toBe('/');expect(data.scope).toBe('/');expect(data.display).toBe('standalone');
      expect(data.icons.map((icon:{sizes:string})=>icon.sizes)).toEqual(['192x192','512x512']);
      for(const icon of [...data.icons,{src:'/brand/app-icon-180.png',sizes:'180x180'}]){
        const image=await page.request.get(icon.src);expect(image.status()).toBe(200);expect(image.headers()['content-type']).toContain('image/png');
        const png=await image.body(),size=Number(icon.sizes.split('x')[0]);expect(png.subarray(1,4).toString()).toBe('PNG');expect(png.readUInt32BE(16)).toBe(size);expect(png.readUInt32BE(20)).toBe(size);
      }
      const cdp=await context.newCDPSession(page),native=await cdp.send('Page.getAppManifest'),installability=await cdp.send('Page.getInstallabilityErrors');
      expect(native.errors).toEqual([]);if(!native.data)throw Error('Chromium did not load the app manifest');expect(JSON.parse(native.data).start_url).toBe('/');
      await info.attach('chromium-installability',{body:JSON.stringify(installability),contentType:'application/json'});
      expect(installability.installabilityErrors).toEqual([]);
      expect(await page.evaluate(async()=>({workers:(await navigator.serviceWorker.getRegistrations()).length,caches:await caches.keys()}))).toEqual({workers:0,caches:[]});
    }finally{await context.close();}
  }finally{await rm(profile,{recursive:true,force:true});}
});

test('five-language iPhone installation guidance fits 320px and preserves account inputs and keyboard focus',async({browser})=>{
  const context=await browser.newContext({viewport:{width:320,height:844},userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1'});
  try{
    const page=await context.newPage();await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill('pwa-draft@example.test');await page.getByLabel('密碼',{exact:true}).fill('pwa-password-draft');
    for(const [language,title] of [['zh-Hant','加入主畫面'],['en','Add to home screen'],['ja','ホーム画面に追加'],['ko','홈 화면에 추가'],['es','Añadir a la pantalla de inicio']]){
      await page.getByRole('combobox',{name:'Language',exact:true}).selectOption(language);
      const button=page.locator('.app-install-trigger');await expect(button).toContainText(title);expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await button.click();const dialog=page.getByRole('dialog',{name:title,exact:true});await expect(dialog).toBeVisible();await expect(dialog.locator('ol')).toContainText('Safari');
      expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:`test-results/mobile-install-${language}-320.png`});await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(button).toBeFocused();
      await expect(page.locator('.login-card input[name=email]')).toHaveValue('pwa-draft@example.test');await expect(page.locator('.login-card input[name=password]')).toHaveValue('pwa-password-draft');
    }
  }finally{await context.close();}
});

test('simulated native prompt needs a click, consumes each event once and never treats browser acceptance as installed',async({page})=>{
  await page.goto('/');await expect(page.locator('.app-install-trigger')).toBeVisible();
  for(const outcome of ['accepted','dismissed','throw'] as const){
    await page.evaluate(outcome=>{
      const state=window as typeof window&{installPromptCalls?:number};state.installPromptCalls=0;
      const event=new Event('beforeinstallprompt',{cancelable:true});
      Object.assign(event,{prompt:async()=>{state.installPromptCalls!++;if(outcome==='throw')throw Error('synthetic browser refusal');},userChoice:Promise.resolve({outcome:outcome==='accepted'?'accepted':'dismissed'})});window.dispatchEvent(event);
    },outcome);
    expect(await page.evaluate(()=>(window as typeof window&{installPromptCalls:number}).installPromptCalls)).toBe(0);
    await page.locator('.app-install-trigger').click();const dialog=page.getByRole('dialog',{name:'加入主畫面',exact:true}),install=dialog.getByRole('button',{name:'安裝自由工坊',exact:true});
    await expect(install).toBeVisible();await install.click();await expect.poll(()=>page.evaluate(()=>(window as typeof window&{installPromptCalls:number}).installPromptCalls)).toBe(1);
    await expect(dialog.getByRole('status')).toContainText(outcome==='accepted'?'請依系統提示完成安裝':outcome==='dismissed'?'已取消安裝':'安裝視窗無法開啟');
    await expect(page.locator('.app-install-trigger')).toBeVisible();await page.keyboard.press('Escape');await page.locator('.app-install-trigger').click();await expect(install).toHaveCount(0);
    expect(await page.evaluate(()=>(window as typeof window&{installPromptCalls:number}).installPromptCalls)).toBe(1);await page.keyboard.press('Escape');
  }
  await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled')));await expect(page.locator('.app-install-trigger')).toHaveCount(0);
});

test('simulated standalone chat closes with browser Back and reopens with Forward without losing its draft',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  try{
    await context.addInitScript(()=>Object.defineProperty(navigator,'standalone',{value:true,configurable:true}));
    const page=await context.newPage();await login(page);await expect(page.locator('.app-install-trigger')).toHaveCount(0);
    const settings=page.getByRole('button',{name:'設定',exact:true});await settings.click();const menu=page.getByRole('menu');await expect(menu.getByRole('menuitem',{name:'加入主畫面',exact:true})).toHaveCount(0);
    await page.keyboard.press('End');await expect(menu.getByRole('menuitem',{name:'登出',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(settings).toBeFocused();
    const home=page.url(),chat=page.locator('#floating-message-panel');
    await navigate(page,'我的訊息');await expect(page.locator('.messages-categories')).toBeVisible();
    await page.getByRole('tab',{name:/^世界聊天/}).click();
    const world=page.locator('#messages-panel-world');await world.getByRole('button',{name:'世界聊天',exact:true}).click();
    const draft=world.getByRole('textbox',{name:'世界聊天訊息',exact:true});await draft.fill('上一頁與下一頁保留的聊天草稿');
    await page.goBack();await expect(chat).toBeHidden();await expect(page).toHaveURL(home);
    await expect(page.getByRole('heading',{name:'會員首頁',level:1,exact:true})).toBeVisible();
    await page.goForward();await expect(chat).toBeVisible();await expect(draft).toHaveValue('上一頁與下一頁保留的聊天草稿');
    await expect(page.locator('.floating-messages')).toBeHidden();
    await closeChat(page);await expect(page.locator('.floating-messages')).toBeVisible();
    await navigate(page,'技能書架');await page.goBack();await expect(chat).toBeHidden();
    await expect(page.getByRole('heading',{name:'會員首頁',level:1,exact:true})).toBeVisible();
  }finally{await context.close();}
});

test('authenticated cold launch and in-page guild hashes open the requested chat in the same phone panel',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  // Synthetic channel DTOs isolate URL routing from shared demo memberships.
  // Authentication and both full-document and same-document navigation are real.
  const guilds=[{channel_key:'pwa-cold-guild',name:'冷啟動測試公會'},{channel_key:'pwa-hash-guild',name:'站內導覽測試公會'}];
  await page.route(url=>url.pathname==='/api/v1/me/channels'&&url.searchParams.get('kind')==='guild',route=>route.fulfill({json:{
    items:guilds.map(guild=>({...guild,kind:'guild',unread_count:0,last_message_at:null})),unread_count:0,next_offset:null,
  }}));
  await page.route(url=>guilds.some(guild=>url.pathname===`/api/v1/me/channels/guild/${guild.channel_key}/messages`||url.pathname===`/api/v1/me/channels/guild/${guild.channel_key}/activity`),route=>{
    if(route.request().method()!=='GET')return route.fallback();
    const url=new URL(route.request().url()),guild=guilds.find(guild=>url.pathname.startsWith(`/api/v1/me/channels/guild/${guild.channel_key}/`))!;
    return route.fulfill({json:url.pathname.endsWith('/activity')?{latest_sequence:'0',unread_count:0,retraction_count:'0'}:
      {channel:{kind:'guild',...guild},items:[],unread_count:0,next_offset:null,retraction_count:'0'}});
  });
  await login(page);
  const chat=page.locator('#floating-message-panel');
  for(const [index,guild] of guilds.entries()){
    const hash=`#messages?guild=${encodeURIComponent(guild.channel_key)}`;
    if(index===0)await page.goto('/'+hash);
    else{
      await closeChat(page);await navigate(page,'技能書架');await expect(page).toHaveURL(/#skills$/);
      await page.evaluate(hash=>{window.location.hash=hash;},hash);
    }
    await expect(chat).toHaveCount(1);await expect(chat).toBeVisible();
    await expect(chat.getByRole('heading',{name:`${guild.name}・公會閒聊`,exact:true})).toBeVisible();
    const draft=chat.getByRole('textbox',{name:`在 ${guild.name} 發言`,exact:true});
    await expect(draft).toBeEditable();await expect(draft).toHaveValue('');await draft.fill(`${guild.name}的未傳送草稿`);
    await expect(page.locator('.floating-messages')).toBeHidden();
  }
});

test('real offline and reconnect preserve a post draft and reconnect never silently publishes it',async({page,context})=>{
  await page.setViewportSize({width:390,height:844});await login(page);await page.getByRole('button',{name:'建立貼文',exact:true}).click();
  const text=`PWA 留在此頁 ${Date.now()}`,box=page.getByLabel('貼文內容',{exact:true});await box.fill(text);
  let writes=0;page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/v1/social-posts/notes')writes++;});
  try{
    await context.setOffline(true);await expect(page.locator('.app-connection-status')).toBeVisible();await expect(box).toHaveValue(text);expect(writes).toBe(0);
    await context.setOffline(false);await expect(page.locator('.app-connection-status')).toHaveCount(0);await expect(box).toHaveValue(text);expect(writes).toBe(0);
    const saved=page.waitForResponse(response=>response.url().endsWith('/api/v1/social-posts/notes')&&response.request().method()==='POST');await page.getByRole('button',{name:'發布貼文',exact:true}).click();expect((await saved).status()).toBe(201);expect(writes).toBe(1);
    await expect(page.locator('.social-card').filter({hasText:text})).toHaveCount(1);
  }finally{await context.setOffline(false);}
});

test('phone chat keeps its outer close control and composer usable through simulated keyboard, safe areas and real offline status',async({page,context})=>{
  await page.setViewportSize({width:390,height:844});
  // A software keyboard can resize/pan only the visual viewport. Changing the
  // Playwright layout viewport would miss this browser event path entirely.
  await page.addInitScript(()=>{
    const viewport=Object.assign(new EventTarget(),{width:innerWidth,height:innerHeight,offsetLeft:0,offsetTop:0,pageLeft:0,pageTop:0,scale:1});
    Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});
  });
  await login(page);const settings=page.getByRole('button',{name:'設定',exact:true});await settings.click();
  await page.getByRole('menuitem',{name:'加入主畫面',exact:true}).click();await expect(page.getByRole('dialog',{name:'加入主畫面',exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(settings).toBeFocused();
  await navigate(page,'我的訊息');await page.getByRole('tab',{name:/^世界聊天/}).click();const panel=page.locator('#messages-panel-world');await panel.getByRole('button',{name:'世界聊天',exact:true}).click();await expect(panel.locator('.messages-thread[data-chat-open=true]')).toBeVisible();
  const insets={top:30,bottom:24,left:12,right:12};
  await page.evaluate(insets=>{for(const [side,pixels] of Object.entries(insets))document.documentElement.style.setProperty(`--app-safe-${side}`,`${pixels}px`);},insets);
  const chat=page.locator('#floating-message-panel'),header=chat.locator('.floating-message-header');
  const close=header.getByRole('button',{name:'收合聊天室',exact:true}),title=header.getByRole('heading',{name:'我的訊息',exact:true});
  const box=panel.getByRole('textbox',{name:'世界聊天訊息',exact:true}),send=panel.getByRole('button',{name:'傳送',exact:true});
  await box.fill('PWA 聊天草稿');
  let writes=0;page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/v1/me/channels/world/world/messages')writes++;});
  async function usableBounds(height:number,offsetTop:number){
    expect(await page.evaluate(()=>({width:innerWidth,height:innerHeight}))).toEqual({width:390,height:844});
    const bottom=offsetTop+height,status=page.locator('.app-connection-status');
    const banner=await status.isVisible()?await status.boundingBox():null;
    const headerTop=Math.max(offsetTop,banner?banner.y+banner.height:0),safeTop=Math.max(offsetTop+insets.top,headerTop);
    await expect.poll(async()=>{const bounds=(await chat.boundingBox())!;return bounds.y+bounds.height;}).toBeLessThanOrEqual(bottom+1);
    await expect.poll(async()=>(await header.boundingBox())!.y).toBeGreaterThanOrEqual(headerTop-1);
    for(const control of [title,close,box,send]){
      await expect(control).toBeInViewport({ratio:1});const bounds=(await control.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(insets.left-1);expect(bounds.x+bounds.width).toBeLessThanOrEqual(390-insets.right+1);
      expect(bounds.y).toBeGreaterThanOrEqual(safeTop-1);expect(bounds.y+bounds.height).toBeLessThanOrEqual(bottom-insets.bottom+1);
    }
    const touch=(await close.boundingBox())!;expect(touch.width).toBeGreaterThanOrEqual(44);expect(touch.height).toBeGreaterThanOrEqual(44);
    await close.click({trial:true});await expect(box).toBeEditable();await expect(send).toBeEnabled();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  try{
    for(const [height,offsetTop,event] of [[844,0,'resize'],[480,0,'resize'],[480,36,'scroll']] as const){
      await page.evaluate(({height,offsetTop,event})=>{
        const viewport=window.visualViewport!;Object.assign(viewport,{height,offsetTop,pageTop:offsetTop});viewport.dispatchEvent(new Event(event));
      },{height,offsetTop,event});
      await usableBounds(height,offsetTop);
    }
    await box.click();await page.keyboard.press('End');await page.keyboard.press('Enter');await page.keyboard.insertText('鍵盤仍可輸入');
    const draft='PWA 聊天草稿\n鍵盤仍可輸入';await expect(box).toHaveValue(draft);expect(writes).toBe(0);
    await context.setOffline(true);await expect(page.locator('.app-connection-status')).toBeVisible();await expect(box).toHaveValue(draft);await usableBounds(480,36);
    await page.screenshot({path:'test-results/mobile-install-chat-offline-keyboard-390x844.png'});
    await context.setOffline(false);await expect(page.locator('.app-connection-status')).toHaveCount(0);await expect(box).toHaveValue(draft);await usableBounds(480,36);expect(writes).toBe(0);
    await closeChat(page);await expect(chat).toBeHidden();await expect(page.locator('.floating-messages')).toBeVisible();
  }finally{await context.setOffline(false);}
});
