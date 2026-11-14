import {randomUUID} from 'node:crypto';
import {test,expect,type Locator,type Page,type Request,type Route} from './fixtures.js';
import {navigate,openAccountSettings} from './navigation.js';
import {quickJoin} from './quick-join.js';

const SETTINGS='分享名片設定（免登入）';
const SAVED='已自動儲存，分享頁就是這個樣子。';
const PROFILE='自動放上我設為「平台公開」的聯絡方式和社群連結';
const SHARE_TEXT='一起加入自由工坊，找到夥伴、學習與創作。';
const CARD_PATH='/api/v1/me/member-card-share';
type ShareBody={enabled:boolean;rotate:boolean;headline:string|null;show_profile_links:boolean};
type LocalShares={copies:string[];shares:ShareData[]};

function apiUrl(page:Page,path:string){
  const origin=new URL(page.url()).origin;
  return (url:URL)=>url.origin===origin&&url.pathname===path&&url.search==='';
}
function isPost(request:Request,path:string,origin:string){
  const url=new URL(request.url());
  return request.method()==='POST'&&url.origin===origin&&url.pathname===path&&url.search==='';
}
async function localShares(page:Page){
  return page.evaluate(()=>(window as unknown as {__cardShares:LocalShares}).__cardShares);
}
// Every case registers a unique owner inside the runner-owned disposable E2E schema.
// The runner tears down that schema; case finally blocks clean routes/listeners only.
async function signup(page:Page,name:string,width=1280){
  // Never grant clipboard permissions or invoke the real OS share sheet.
  await page.addInitScript(()=>{
    const state:LocalShares={copies:[],shares:[]};
    Object.assign(window,{__cardShares:state});
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{state.copies.push(text);}}});
    Object.defineProperty(navigator,'share',{configurable:true,value:async(data:ShareData)=>{state.shares.push(data);}});
  });
  await page.setViewportSize({width,height:width===390?844:900});
  await page.goto('/');
  await page.getByRole('button',{name:'建立帳號',exact:true}).click();
  await page.getByLabel('社群顯示名稱',{exact:true}).fill(name);
  await page.getByLabel('電子郵件',{exact:true}).fill(`card-actions-${randomUUID()}@example.test`);
  await page.getByLabel('密碼',{exact:true}).fill('freedom-card-actions-password');
  await page.getByRole('button',{name:'建立帳號，先逛工坊',exact:true}).click();
  await expect(page.getByRole('heading',{name:`${name}，歡迎來到自由工坊。`,exact:true})).toBeVisible();
  await quickJoin(page);
  await expect(page.getByRole('heading',{name:'動態',level:1})).toBeVisible();
  const origin=new URL(page.url()).origin;
  const accountResponse=page.waitForResponse(response=>{const url=new URL(response.url());return response.request().method()==='GET'&&url.origin===origin&&url.pathname==='/api/v1/me/account'&&url.search==='';});
  await navigate(page,'我的名片');
  await openAccountSettings(page,SETTINGS);
  const account=await (await accountResponse).json() as {user_id:string};
  expect(account.user_id).toMatch(/^[0-9a-f-]{36}$/);
  const settings=page.getByRole('region',{name:'分享我的工坊名片',exact:true});
  // Account settings and its member-card editor may be lazy loaded independently.
  await expect(settings.getByLabel('一句話介紹',{exact:true})).toBeVisible();
  await settings.getByRole('button',{name:'建立分享連結',exact:true}).click();
  await expect(settings.locator('.ecard-save-status')).toHaveText(SAVED);
  await expect(settings.getByRole('button',{name:'分享名片',exact:true})).toBeEnabled();
  await expect(settings.getByRole('button',{name:'下載名片 PNG',exact:true})).toBeEnabled();
  const url=await settings.getByRole('link',{name:'開啟名片',exact:true}).getAttribute('href');
  expect(url).toMatch(/\/member-cards\/[A-Za-z0-9_-]{43}$/);
  return {settings,url:url!,ownerId:account.user_id};
}
async function blocked(settings:Locator,url:string,pending:boolean){
  // These positive assertions are the regression oracle, not a timeout waiting
  // for zero network traffic or a synthetic click on a disabled handler.
  const share=settings.getByRole('button',{name:'分享名片',exact:true});
  await expect(share).toBeVisible();
  await expect(share).toBeDisabled();
  await expect(settings.getByRole('button',{name:'下載名片 PNG',exact:true})).toBeDisabled();
  const open=settings.locator('.member-card-share-actions a');
  await expect(open).toHaveAttribute('href',url);
  await expect(open).toHaveAttribute('aria-disabled','true');
  await expect(open).toHaveText(pending?'儲存中…':'開啟名片');
}
async function copyCard(page:Page,settings:Locator,name:string){
  const before=await localShares(page);
  await settings.getByRole('button',{name:'分享名片',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:`分享「${name}的工坊名片」`,exact:true});
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.skill-share-url')).toHaveText(/\/go\/[A-Za-z0-9_-]{10}$/);
  const url=(await dialog.locator('.skill-share-url').innerText()).trim();
  expect(new URL(url).origin).toBe(new URL(page.url()).origin);
  await dialog.getByRole('button',{name:'複製連結',exact:true}).click();
  await expect(dialog.getByRole('status')).toHaveText('已複製連結');
  await expect.poll(async()=>(await localShares(page)).copies).toEqual([...before.copies,`${SHARE_TEXT}\n${url}`]);
  await dialog.getByRole('button',{name:'關閉分享',exact:true}).click();
  await expect(dialog).toBeHidden();
  await expect(settings.getByRole('button',{name:'分享名片',exact:true})).toBeFocused();
  return url;
}
function countPromotion(page:Page){
  const origin=new URL(page.url()).origin;
  const posts:{kind:string;target:string}[]=[];
  const listener=(request:Request)=>{if(isPost(request,'/api/v1/promotion/links',origin))posts.push(request.postDataJSON());};
  page.on('request',listener);
  return {posts,stop:()=>page.off('request',listener)};
}
async function holdSave(page:Page,afterCommit:boolean){
  const match=apiUrl(page,CARD_PATH);
  let release=()=>{};
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const state:{phase:'waiting'|'fetching'|'held'|'done';body:ShareBody|null;status:number|null}={phase:'waiting',body:null,status:null};
  const handler=async(route:Route)=>{
    if(route.request().method()!=='POST'||state.phase!=='waiting')return route.continue();
    state.phase='fetching';state.body=route.request().postDataJSON() as ShareBody;
    if(afterCommit){
      // Commit through the real local API first. Only its ACK is held back.
      const response=await route.fetch();
      state.status=response.status();state.phase='held';
      await gate;
      await route.fulfill({response});
    }else{
      state.phase='held';
      await gate;
      await route.continue();
    }
    state.phase='done';
  };
  await page.route(match,handler);
  return {state,release,async stop(){release();await page.unrouteAll({behavior:'wait'});}};
}

test('mobile committed headline save blocks share until ACK, then close and reopen copies normally',async({page})=>{
  const name='名片回應等待作者';
  const {settings,url}=await signup(page,name,390);
  const promotion=countPromotion(page);
  let trap:Awaited<ReturnType<typeof holdSave>>|undefined;
  try{
    const first=await copyCard(page,settings,name);
    expect(promotion.posts).toHaveLength(1);
    expect(promotion.posts[0]).toMatchObject({kind:'member_card',target:expect.stringMatching(/^[0-9a-f-]{36}$/)});
    trap=await holdSave(page,true);
    const headline=settings.getByLabel('一句話介紹',{exact:true});
    await headline.fill('已提交，等待這一頁確認');
    await headline.blur();
    await expect.poll(()=>trap!.state.phase).toBe('held');
    expect(trap.state.status).toBe(200);
    expect(trap.state.body).toMatchObject({headline:'已提交，等待這一頁確認',enabled:true,rotate:false});
    await expect(settings.locator('.ecard-save-status')).toHaveText('儲存中…');
    await blocked(settings,url,true);
    expect(promotion.posts).toHaveLength(1);
    expect(await localShares(page)).toEqual({copies:[`${SHARE_TEXT}\n${first}`],shares:[]});
    trap.release();
    await expect(settings.locator('.ecard-save-status')).toHaveText(SAVED);
    await expect(settings.getByRole('button',{name:'下載名片 PNG',exact:true})).toBeEnabled();
    await expect(settings.getByRole('link',{name:'開啟名片',exact:true})).not.toHaveAttribute('aria-disabled','true');
    expect(await copyCard(page,settings,name)).toBe(first);
    expect(promotion.posts).toHaveLength(2);
    expect(promotion.posts[1]).toEqual(promotion.posts[0]);
  }finally{promotion.stop();await trap?.stop();}
});

test('pending profile visibility save stays blocked when the settings disclosure is closed and reopened',async({page})=>{
  const name='名片顯示等待作者';
  const {settings,url}=await signup(page,name);
  const promotion=countPromotion(page);
  const trap=await holdSave(page,false);
  try{
    const profile=settings.getByRole('checkbox',{name:PROFILE,exact:true});
    await expect(profile).toBeChecked();
    await profile.uncheck();
    await expect.poll(()=>trap.state.phase).toBe('held');
    expect(trap.state.body).toMatchObject({show_profile_links:false,enabled:true,rotate:false});
    await blocked(settings,url,true);
    // This is a native settings disclosure, not the PromotionShare modal. No
    // background editor is operated while a modal blocks member interaction.
    const disclosure=page.locator('.account-panel').getByText(SETTINGS,{exact:true}).locator('xpath=ancestor::summary/parent::details');
    await disclosure.locator(':scope > summary').click();
    await expect(disclosure).toHaveJSProperty('open',false);
    await openAccountSettings(page,SETTINGS);
    await expect(profile).not.toBeChecked();
    await blocked(settings,url,true);
    expect(promotion.posts).toEqual([]);
    expect(await localShares(page)).toEqual({copies:[],shares:[]});
    trap.release();
    await expect(settings.locator('.ecard-save-status')).toHaveText(SAVED);
    await copyCard(page,settings,name);
    expect(promotion.posts).toHaveLength(1);
  }finally{promotion.stop();await trap.stop();}
});

test('a known unsubmitted 422 blocks sharing until the member explicitly retries the profile save',async({page})=>{
  const name='名片拒絕恢復作者';
  const {settings,url}=await signup(page,name);
  const promotion=countPromotion(page);
  const match=apiUrl(page,CARD_PATH);
  const bodies:ShareBody[]=[];
  let rejected=0;
  await page.route(match,async route=>{
    if(route.request().method()!=='POST')return route.continue();
    bodies.push(route.request().postDataJSON() as ShareBody);
    if(bodies.length!==1)return route.continue();
    // A definitive rejection, never forwarded: not a lost committed response.
    rejected++;
    await route.fulfill({status:422,contentType:'application/problem+json',json:{type:'about:blank',status:422,title:'member_card_profile_links_invalid',code:'member_card_profile_links_invalid',detail:'合成拒絕：名片顯示設定未儲存。'}});
  });
  try{
    await settings.getByRole('checkbox',{name:PROFILE,exact:true}).uncheck();
    await expect(settings.locator('.ecard-save-status')).toContainText('合成拒絕：名片顯示設定未儲存。');
    expect(rejected).toBe(1);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({show_profile_links:false,enabled:true,rotate:false});
    await blocked(settings,url,false);
    expect(promotion.posts).toEqual([]);
    expect(await localShares(page)).toEqual({copies:[],shares:[]});
    await settings.getByRole('button',{name:'重試',exact:true}).click();
    await expect(settings.locator('.ecard-save-status')).toHaveText(SAVED);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    await copyCard(page,settings,name);
    expect(promotion.posts).toHaveLength(1);
  }finally{promotion.stop();await page.unrouteAll({behavior:'wait'});}
});

test('invalid headline disables sharing and correcting it restores copy after autosave',async({page})=>{
  const name='名片介紹修正作者';
  const {settings,url}=await signup(page,name);
  const promotion=countPromotion(page);
  try{
    const headline=settings.getByLabel('一句話介紹',{exact:true});
    await headline.fill('字'.repeat(61));
    await headline.blur();
    await expect(settings.getByRole('alert')).toHaveText('一句話介紹最多 60 個字。');
    await expect(headline).toHaveValue('字'.repeat(61));
    await blocked(settings,url,false);
    expect(promotion.posts).toEqual([]);
    expect(await localShares(page)).toEqual({copies:[],shares:[]});
    await headline.fill('修正後的名片介紹');
    await headline.blur();
    await expect(settings.locator('.ecard-save-status')).toHaveText(SAVED);
    await expect(headline).toHaveValue('修正後的名片介紹');
    await copyCard(page,settings,name);
    expect(promotion.posts).toHaveLength(1);
  }finally{promotion.stop();}
});

test('missing preview target keeps the saved card share disabled and a normal reload restores it',async({page})=>{
  const name='名片預覽恢復作者';
  const {url,ownerId}=await signup(page,name);
  const origin=new URL(page.url()).origin;
  const promotion=countPromotion(page);
  let failedReads=0;
  const match=(url:URL)=>url.origin===origin&&url.pathname===`/api/v1/members/${ownerId}`&&url.search==='';
  const handler=async(route:Route)=>{
    if(route.request().method()!=='GET')return route.continue();
    failedReads++;
    await route.fulfill({status:503,contentType:'application/problem+json',json:{type:'about:blank',status:503,title:'preview_unavailable',code:'preview_unavailable'}});
  };
  await page.route(match,handler);
  try{
    await page.reload();
    await openAccountSettings(page,SETTINGS);
    const settings=page.getByRole('region',{name:'分享我的工坊名片',exact:true});
    await expect(settings.getByLabel('一句話介紹',{exact:true})).toBeVisible();
    // Both the account panel and MemberShare independently read the owner card.
    await expect.poll(()=>failedReads).toBeGreaterThanOrEqual(2);
    await expect(page.locator('.account-panel')).toContainText('服務暫時無法回應（503）');
    await expect(settings.getByRole('button',{name:'分享名片',exact:true})).toBeDisabled();
    await expect(settings.getByRole('button',{name:'下載名片 PNG',exact:true})).toBeDisabled();
    await expect(settings.getByRole('link',{name:'開啟名片',exact:true})).toHaveAttribute('href',url);
    // Missing preview disables share/download, not the existing saved-card URL.
    await expect(settings.getByRole('link',{name:'開啟名片',exact:true})).not.toHaveAttribute('aria-disabled','true');
    expect(promotion.posts).toEqual([]);
    expect(await localShares(page)).toEqual({copies:[],shares:[]});
    await page.unroute(match,handler);
    await page.reload();
    await openAccountSettings(page,SETTINGS);
    await expect(settings.getByRole('button',{name:'分享名片',exact:true})).toBeEnabled();
    await copyCard(page,settings,name);
    expect(promotion.posts).toHaveLength(1);
  }finally{promotion.stop();await page.unrouteAll({behavior:'wait'});}
});
