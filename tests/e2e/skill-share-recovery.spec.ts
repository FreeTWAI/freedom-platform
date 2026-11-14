import {navigate} from './navigation.js';
import {test,expect,type Page,type Route} from './fixtures.js';

const content={introductions:['合成分享介紹一','合成分享介紹二'],illustration_url:'/brand/skill-illustrations/social-post.webp',illustration_alt:'合成技能書插畫'};
const title='Hao 社群貼文技能書';
async function prepare(page:Page){
  await page.route('**/api/v1/me/skill-books',route=>route.fulfill({json:{items:[]}}));
  await page.route('**/api/v1/me/github',route=>route.fulfill({json:{configured:false,connected:false,github_user:null}}));
  await page.route('**/api/v1/skills/*/share-content',route=>route.fulfill({json:content}));
  await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(value:string)=>{(window as any).__recoveryCopy=value;}}});});
  await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();
  await navigate(page,'技能書架');await page.getByRole('button',{name:'未解鎖',exact:true}).click();
  const library=page.locator('.community-library');await library.getByLabel('搜尋技能書',{exact:true}).fill('社群貼文');
  const card=library.locator('article[data-book-id="social-post"]');await expect(card).toBeVisible();
  await page.clock.install();return card;
}

for(const target of ['introduction','session','promotion'] as const)test(`skill share recovers from stalled ${target} with a public URL and no automatic tracking replay`,async({page,baseURL})=>{
  const card=await prepare(page),held:Route[]=[];let writes=0;
  const path=target==='introduction'?'**/api/v1/skills/social-post/share-content':target==='session'?'**/api/v1/session':'**/api/v1/promotion/links';
  await page.route(path,route=>{held.push(route);});
  page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/v1/promotion/links')writes++;});
  try{
    await card.getByRole('button',{name:'分享技能',exact:true}).click();await expect.poll(()=>held.length).toBe(1);
    const dialog=page.getByRole('dialog',{name:`分享「${title}」`,exact:true});
    await expect(dialog).toBeVisible();
    await page.clock.fastForward(8001);
    await expect(dialog).toBeVisible();
    const copy=dialog.getByRole('button',{name:'複製連結',exact:true});await expect(copy).toBeEnabled();
    if(target==='introduction'){
      await expect(dialog.locator('.share-intros')).toHaveCount(0);
      await expect(dialog.locator('.skill-share-url')).toHaveText(/\/go\/[A-Za-z0-9_-]{10}$/);
    }else{
      await expect(dialog.locator('.skill-share-url')).toHaveText(/\/development\/skills\/social-post$/);
      await dialog.locator('.share-intros > summary').click();
      await dialog.getByRole('radio').first().check();
      await expect(dialog.locator('.skill-share-url')).toHaveText(/\/development\/skills\/social-post\?intro=1$/);
    }
    await copy.click();const copied=await page.evaluate(()=>(window as any).__recoveryCopy as string);expect(copied).toContain(new URL(baseURL!).origin);
    const writesBefore=writes;await page.clock.fastForward(16000);expect(writes).toBe(writesBefore);
    await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(card.getByRole('button',{name:'分享技能',exact:true})).toBeFocused();
  }finally{for(const route of held)await route.abort().catch(()=>{});await page.unrouteAll({behavior:'wait'});}
});

test('closing the reading dialog cancels its pending nested share and does not reopen after the deadline',async({page})=>{
  const card=await prepare(page),held:Route[]=[];
  await card.getByRole('button',{name:'預覽技能書',exact:true}).click();
  const reading=page.getByRole('dialog',{name:title,exact:true});await expect(reading).toBeVisible();
  await expect(page.locator('.skill-share-dialog[open]')).toHaveCount(0);
  await page.route('**/api/v1/skills/social-post/share-content',route=>{held.push(route);});
  try{
    await reading.getByRole('button',{name:'分享技能',exact:true}).click();await expect.poll(()=>held.length).toBeGreaterThan(0);
    // Sharing opens a modal immediately, so dismiss it before closing its parent.
    await page.getByRole('dialog',{name:`分享「${title}」`,exact:true}).getByRole('button',{name:'關閉分享',exact:true}).click();
    await reading.getByRole('button',{name:'關閉技能書介紹',exact:true}).click();await expect(reading).toBeHidden();
    await page.clock.fastForward(8001);await expect(page.locator('.skill-share-dialog[open]')).toHaveCount(0);
    await expect(card.getByRole('button',{name:'預覽技能書',exact:true})).toBeFocused();
    for(const route of held)await route.fulfill({json:content}).catch(()=>{});
    await expect(page.locator('.skill-share-dialog[open]')).toHaveCount(0);
    await card.getByRole('button',{name:'預覽技能書',exact:true}).click();await expect(reading).toBeVisible();
    await expect(page.locator('.skill-share-dialog[open]')).toHaveCount(0);await expect(reading.getByRole('button',{name:'分享技能',exact:true})).toBeEnabled();
  }finally{for(const route of held)await route.abort().catch(()=>{});await page.unrouteAll({behavior:'wait'});}
});
