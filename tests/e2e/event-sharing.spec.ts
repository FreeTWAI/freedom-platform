import {readFile} from 'node:fs/promises';
import {test,expect} from './member-feature-fixture.js';
import {DEMO_USERS,DEMO_PASSWORD} from '../../packages/testing/seed.js';
const markup=await readFile(new URL('../fixtures/event-import/jsonld.html',import.meta.url),'utf8');
test.use({memberFeatures:{eventParticipationEnabled:true,eventEmailSender:async()=>{},linkPreviewFetch:async()=>new Response(markup,{headers:{'Content-Type':'text/html'}})}});
test('paste event link, confirm, publish, register signed out and credit its sharer',async({page,browser,baseURL,e2eAuthPool})=>{
 // The sharer needs a non-test address to earn credit. Restore it so later specs in this server can still sign in as the demo member.
 const original=(await e2eAuthPool.query<{email:string}>('SELECT email FROM users WHERE user_id=$1',[DEMO_USERS[0].user_id])).rows[0].email;
 await e2eAuthPool.query('UPDATE users SET email=$2 WHERE user_id=$1',[DEMO_USERS[0].user_id,'event-owner@example.com']);
 try{
 await page.context().route(url=>!['127.0.0.1','localhost'].includes(url.hostname),route=>route.abort());
 await page.setViewportSize({width:390,height:844});await page.goto('/#home');
 await page.getByLabel('電子郵件',{exact:true}).fill('event-owner@example.com');await page.getByLabel('密碼',{exact:true}).fill(DEMO_PASSWORD);await page.getByRole('button',{name:'登入',exact:true}).click();
 await page.getByRole('button',{name:'分享或提交',exact:true}).click();const box=page.getByRole('dialog',{name:'分享',exact:true});
 await box.getByLabel('貼上連結',{exact:true}).fill('https://www.accupass.com/event/synthetic');
 await expect(box.getByLabel('名稱',{exact:true})).toHaveValue('合成讀書會');await expect(box.getByLabel('時間',{exact:true})).not.toHaveValue('');
 await box.getByLabel('名稱',{exact:true}).fill('合成讀書會確認版');await box.getByRole('button',{name:'發布',exact:true}).click();
 await expect(page).toHaveURL(/\/events\/[0-9a-f-]+$/);const eventUrl=page.url(),id=new URL(eventUrl).pathname.split('/').pop()!;
 await expect(page.getByRole('heading',{name:'合成讀書會確認版',exact:true})).toBeVisible();
 await expect(page.getByText('主辦：合成主辦（未核實）',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'我也要分享',exact:true}).click();await expect(page.getByLabel('我的分享連結')).toBeVisible();
 const tracked=await page.getByLabel('我的分享連結').inputValue();
 const guest=await browser.newContext({baseURL,viewport:{width:390,height:844}});await guest.route(url=>!['127.0.0.1','localhost'].includes(url.hostname),route=>route.abort());
 try{const g=await guest.newPage();const attempts:string[]=[];await g.route('**/api/v1/public/events/*/register',async route=>{attempts.push(route.request().postData()!);if(attempts.length===1){await route.fetch();await route.fulfill({status:200,contentType:'application/json',body:'{}'});}else await route.continue();});await g.goto(tracked);await expect(g).toHaveURL(new RegExp('/events/'+id+'\\?ref='));
 await expect(g.locator('meta[property="og:title"]')).toHaveAttribute('content','合成讀書會確認版');
 await g.getByLabel('姓名',{exact:true}).fill('合成訪客');await g.getByLabel('Email',{exact:true}).fill('event-guest@example.com');await g.getByRole('button',{name:'報名',exact:true}).click();
 await expect(g.getByRole('status')).toContainText('尚未確認');await expect(g.getByLabel('Email',{exact:true})).toHaveJSProperty('readOnly',true);await g.getByRole('button',{name:'重試原報名',exact:true}).click();await expect(g.getByRole('status')).toContainText('報名已確認');expect(attempts).toHaveLength(2);expect(attempts[0]).toBe(attempts[1]);expect(await g.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{await guest.close();}
 await page.reload();await page.getByRole('button',{name:'我也要分享',exact:true}).click();await expect(page.getByText(/1 人報名/)).toBeVisible();
 const credit=await e2eAuthPool.query("SELECT sum(e.units)::int n FROM share_credit_events e JOIN shares s USING(share_id) WHERE s.ref_id=$1 AND e.basis='registration' AND e.user_id=$2",[id,DEMO_USERS[0].user_id]);expect(credit.rows[0].n).toBe(1);
 }finally{await e2eAuthPool.query('UPDATE users SET email=$2 WHERE user_id=$1',[DEMO_USERS[0].user_id,original]);}
});
