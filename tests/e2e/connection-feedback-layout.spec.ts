import {openSettingsPanel,closeSettingsMenu} from './settings-menu-helpers.js';
import {test,expect} from './fixtures.js';

for(const width of [320,1280])test(`offline ${width}px has one announcement at the top without covering content`,async({page,context},info)=>{
  await page.setViewportSize({width,height:844});await page.goto('/');
  await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');
  await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  await page.getByRole('button',{name:'登入',exact:true}).click();
  await expect(page.getByRole('button',{name:'建立貼文',exact:true})).toBeVisible();
  await expect(page.locator('.request-feedback')).toHaveCount(0);await context.setOffline(true);
  try{
    const banner=page.locator('.app-connection-status'),feedback=page.locator('.request-feedback.is-offline');
    await expect(banner).toBeVisible();await expect(feedback).toBeVisible();
    for(const name of ['自由工坊－明亮','自由工坊－夜航','自由工坊－敘生']){
      await page.getByRole('button',{name:'設定',exact:true}).click();
      await openSettingsPanel(page,'appearance');await page.getByRole('menuitemradio',{name,exact:true}).click();await closeSettingsMenu(page);
      await expect(page.locator('.app-connection-status[role=status], .request-feedback.is-offline[role=status]')).toHaveCount(1);
      await expect(banner).toContainText('草稿保留在此頁。');
      await expect(banner).toHaveAttribute('aria-live','polite');await expect(banner).toHaveAttribute('aria-atomic','true');
      const top=(await banner.boundingBox())!,message=(await feedback.boundingBox())!;
      expect(message.y).toBeGreaterThanOrEqual(top.y);expect(message.y+message.height).toBeLessThanOrEqual(top.y+top.height);
      expect(message.x).toBeGreaterThanOrEqual(0);expect(message.x+message.width).toBeLessThanOrEqual(width);
      expect(await feedback.evaluate(element=>getComputedStyle(element).position)).toBe('static');
      await expect(page.getByRole('button',{name:'建立貼文',exact:true})).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    await page.screenshot({path:info.outputPath(`offline-single-${width}.png`),fullPage:true});
  }finally{await context.setOffline(false);}
  await expect(page.locator('.app-connection-status')).toHaveCount(0);await expect(page.locator('.request-feedback')).toHaveCount(0);
});

// Deliberately omit online/offline notifications to model restoration after a
// missed event. These synthetic signals are not physical iOS/PWA suspension.
for(const width of [320,1280])for(const event of ['focus','pageshow','visibilitychange'] as const)test(`connection status reconciles simulated missed events on ${event} at ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:844});
  await page.addInitScript(()=>{
    const state={online:true,visible:true};
    Object.assign(window,{__connectionResume:state});
    Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>state.online});
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>state.visible?'visible':'hidden'});
  });
  const writes:string[]=[];page.on('request',request=>{if(!['GET','HEAD','OPTIONS'].includes(request.method()))writes.push(request.method()+' '+new URL(request.url()).pathname);});
  await page.goto('/');const email=page.getByLabel('電子郵件',{exact:true}),password=page.getByLabel('密碼',{exact:true});
  await email.fill('resume-draft@example.test');await password.fill('synthetic-unsent-draft');
  const banner=page.locator('.app-connection-status');await expect(banner).toHaveCount(0);
  async function resume(online:boolean,visible=true){
    await page.evaluate(({event,online,visible})=>{
      const state=(window as typeof window&{__connectionResume:{online:boolean;visible:boolean}}).__connectionResume;
      state.online=online;state.visible=visible;
      (event==='visibilitychange'?document:window).dispatchEvent(new Event(event));
    },{event,online,visible});
  }
  for(const theme of ['light','dark','versefolk']){
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
    await resume(false,false);await expect(banner).toHaveCount(0);
    await resume(false);await expect(banner).toBeVisible();await resume(false);await expect(banner).toHaveCount(1);
    await expect(banner).toHaveAttribute('aria-live','polite');await expect(banner).toHaveAttribute('aria-atomic','true');
    await expect.poll(()=>page.evaluate(()=>Number.parseFloat(document.documentElement.style.getPropertyValue('--connection-status-height')))).toBeGreaterThan(0);
    await expect(page.locator('html')).toHaveAttribute('data-device-offline','true');
    expect(await banner.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`connection-resume-${event}-${theme}-${width}.png`)});
    await resume(true);await expect(banner).toHaveCount(0);await resume(true);await expect(banner).toHaveCount(0);
    await expect.poll(()=>page.evaluate(()=>({height:document.documentElement.style.getPropertyValue('--connection-status-height'),offline:document.documentElement.dataset.deviceOffline??null}))).toEqual({height:'',offline:null});
    await expect(email).toHaveValue('resume-draft@example.test');await expect(password).toHaveValue('synthetic-unsent-draft');expect(writes).toEqual([]);
  }
});
