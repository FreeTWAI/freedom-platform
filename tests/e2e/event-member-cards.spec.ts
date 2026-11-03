import {randomUUID} from 'node:crypto';
import {test,expect,type Page} from './fixtures.js';

const token='Q'.repeat(43),sharePath='/member-cards/'+token;
const card={nickname:'合成活動公開名片',primary_guild:null,capabilities:[],avatar_url:null,design:'calm',headline:'只分享我選擇的內容',links:[],profile_links:[]};
async function login(page:Page){await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();await expect(page.locator('.shell')).toBeVisible();}
const meetup=test.extend<{meetupId:string}>({meetupId:async({e2eAuthPool},use)=>{
  const id=randomUUID();
  await e2eAuthPool.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,state,visibility,event_kind)
    SELECT $1,community_id,user_id,'合成見面活動','合成測試',now()+interval '3 days',now()+interval '3 days 2 hours','in_person','合成場地','published','workshop','other' FROM users WHERE email='maker@local.test'`,[id]);
  try{await use(id);}finally{await e2eAuthPool.query('DELETE FROM community_events WHERE event_id=$1',[id]);}
}});
// Author cases require the integrated EventsPanel wire and a fresh canonical build.
// They have not been run in the cloud's no-DB/no-native-browser task scope.
meetup('onsite card is read-only, keyboard dismissible and fits narrow phones',async({page,meetupId})=>{
  const writes:string[]=[];let revoked=false;
  page.on('request',r=>{if(r.method()==='POST'&&(/member-card-share|\/friends\//).test(r.url()))writes.push(r.url());});
  await page.route('**/api/v1/me/member-card-share',r=>r.fulfill({json:{enabled:true,share_path:sharePath}}));
  await page.route('**/api/v1/public/member-cards/'+token,r=>r.fulfill(revoked?{status:404,json:{error:{code:'member_card_unavailable',message:'已關閉'}}}:{json:card}));
  await login(page);await page.goto('/#events/'+meetupId);
  const trigger=page.getByRole('button',{name:'出示我的名片',exact:true}),dialog=page.getByRole('dialog',{name:'出示我的名片',exact:true});
  for(const width of [320,390,820]){
    await page.setViewportSize({width,height:844});await trigger.click();await expect(dialog.getByRole('img',{name:'這張名片的專屬 QR Code'})).toBeVisible();
    await expect(dialog.getByRole('button',{name:'關閉名片'})).toBeFocused();
    expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(trigger).toBeFocused();
  }
  await trigger.click();await expect(dialog.getByRole('img',{name:'這張名片的專屬 QR Code'})).toBeVisible();revoked=true;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(dialog.getByRole('alert')).toBeVisible();await expect(dialog.getByRole('img')).toHaveCount(0);
  expect(writes).toEqual([]);
});
meetup('closing a held read ignores delivery and setup is explicit with a normal Back return',async({page,meetupId})=>{
  let release!:()=>void,seen!:()=>void;const gate=new Promise<void>(r=>{release=r}),started=new Promise<void>(r=>{seen=r});let held=true;
  const writes:string[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/member-card-share'))writes.push(r.url());});
  await page.route('**/api/v1/me/member-card-share',async r=>{if(held){seen();await gate;}await r.fulfill({json:{enabled:false,share_path:null,include_avatar:false,aggregate_version:null,design:'calm',headline:null,links:[],show_profile_links:true,profile_link_prefs:{},profile_links:[]}});});
  try{
    await login(page);await page.goto('/#events/'+meetupId);
    const trigger=page.getByRole('button',{name:'出示我的名片',exact:true}),dialog=page.getByRole('dialog',{name:'出示我的名片',exact:true});
    await trigger.click();await started;await dialog.getByRole('button',{name:'關閉名片'}).click();release();held=false;
    await expect(dialog).toBeHidden();await expect(trigger).toBeFocused();
    await trigger.click();await expect(dialog.getByRole('heading',{name:'你的名片還沒有開放分享'})).toBeVisible();await expect(dialog.getByRole('img')).toHaveCount(0);
    await dialog.getByRole('link',{name:'前往名片設定'}).click();await expect(page).toHaveURL(/#account$/);
    const entry=page.locator('.account-panel > details').first();await expect(entry).toContainText('分享名片設定（免登入）');
    expect(writes).toEqual([]);await page.goBack();await expect(page).toHaveURL(new RegExp('#events/'+meetupId+'$'));await expect(trigger).toBeVisible();await expect(dialog).toBeHidden();
  }finally{release();await page.unrouteAll({behavior:'wait'});}
});
