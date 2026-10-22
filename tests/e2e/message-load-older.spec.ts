import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {test,expect,type Browser,type BrowserContext,type Page} from './fixtures.js';
import {LOCAL_DATABASE_URL} from '../../packages/db/index.js';
import {e2eSchema} from '../../packages/testing/e2e-auth-isolation.js';
import {DEMO_USERS,DEMO_COMMUNITY,DEMO_PASSWORD} from '../../packages/testing/seed.js';

let db:Pool,contexts:BrowserContext[],accounts:{id:string;email:string;name:string}[],releaseHeld:(()=>void)[];
test.beforeEach(async()=>{
  db=new Pool({connectionString:process.env.TEST_DATABASE_URL??LOCAL_DATABASE_URL,options:`-c search_path=${e2eSchema(process.env.FREEDOM_E2E_SCHEMA)}`,max:4});
  contexts=[];accounts=[];releaseHeld=[];
  for(const name of ['甲','乙','丙']){
    const id=randomUUID(),email=`older-${id}@example.test`,display=`合成分頁${name} ${id.slice(0,8)}`;
    await db.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,onboarding_required,email_verified_at)
      SELECT $1,$2,$3,$4,password_hash,$5,false,now() FROM users WHERE user_id=$6`,[id,DEMO_COMMUNITY,email,display,randomUUID(),DEMO_USERS[0].user_id]);
    await db.query("INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state) VALUES($1,$2,$3,'guild_ai_vibe','active')",[randomUUID(),DEMO_COMMUNITY,id]);
    accounts.push({id,email,name:display});
  }
});
test.afterEach(async()=>{
  for(const release of releaseHeld)release();
  await Promise.all(contexts.map(context=>context.close()));
  const ids=accounts.map(account=>account.id),q=await db.connect();
  try{
    await q.query('BEGIN');
    await q.query('DELETE FROM member_direct_messages WHERE sender_ref=ANY($1::uuid[]) OR recipient_ref=ANY($1::uuid[])',[ids]);
    for(const table of ['positioning_profession_memberships','sessions','member_client_errors','command_receipts'])await q.query(`DELETE FROM ${table} WHERE user_id=ANY($1::uuid[])`,[ids]);
    await q.query('DELETE FROM member_notifications WHERE recipient_ref=ANY($1::uuid[])',[ids]);
    await q.query('DELETE FROM outbox WHERE transition_id IN (SELECT transition_id FROM transition_journal WHERE actor_ref=ANY($1::uuid[]))',[ids]);
    await q.query('DELETE FROM transition_journal WHERE actor_ref=ANY($1::uuid[])',[ids]);
    await q.query('DELETE FROM users WHERE user_id=ANY($1::uuid[])',[ids]);await q.query('COMMIT');
  }catch(error){await q.query('ROLLBACK');throw error;}finally{q.release();await db.end();}
});
async function history(start=1,count=25,peer=1){
  const result=await db.query(`INSERT INTO member_direct_messages(community_id,sender_ref,recipient_ref,body,created_at,read_at)
    SELECT $1,$2,$3,'合成分頁 '||n,timestamptz '2026-09-01T00:00:00Z'+n*interval '1 second',now()
    FROM generate_series($4::int,$5::int) n RETURNING message_id`,[DEMO_COMMUNITY,accounts[0].id,accounts[peer].id,start,start+count-1]);
  return result.rows.map(row=>row.message_id as string);
}
async function member(browser:Browser,baseURL:string){
  const context=await browser.newContext({baseURL,viewport:{width:1280,height:900}});contexts.push(context);
  await context.route(url=>!['localhost','127.0.0.1'].includes(url.hostname),route=>route.abort());
  const page=await context.newPage();await page.goto('/#messages');
  await page.getByLabel('電子郵件',{exact:true}).fill(accounts[0].email);await page.getByLabel('密碼',{exact:true}).fill(DEMO_PASSWORD);
  await page.getByRole('button',{name:'登入',exact:true}).click();await expect(page.locator('.messages-categories')).toBeVisible();return page;
}
async function openDirect(page:Page,peer=1){
  const panel=page.locator('#messages-panel-direct');await panel.getByLabel('搜尋會員',{exact:true}).fill(accounts[peer].name);
  await panel.getByRole('button',{name:'搜尋會員',exact:true}).click();await panel.getByRole('button',{name:`傳訊給 ${accounts[peer].name}`,exact:true}).click();
  await expect(panel.locator('.messages-compose')).toBeVisible();return panel;
}
function signal(){let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return {promise,resolve};}
async function watchThread(page:Page,peer=1){
  const requests:number[]=[],holds:{offset:number;status:number;entered:ReturnType<typeof signal>;released:ReturnType<typeof signal>;finished:ReturnType<typeof signal>}[]=[];
  await page.route(url=>url.pathname===`/api/v1/me/conversations/${accounts[peer].id}/messages`,async route=>{
    const offset=Number(new URL(route.request().url()).searchParams.get('offset'));requests.push(offset);
    const index=holds.findIndex(hold=>hold.offset===offset),hold=index<0?undefined:holds.splice(index,1)[0];
    if(hold){hold.entered.resolve();await hold.released.promise;}
    try{
      if(hold&&hold.status!==200)await route.fulfill({status:hold.status,contentType:'application/json',body:JSON.stringify({code:'conversation_not_available',message:'合成：對話讀取失敗'})});
      else await route.fulfill({response:await route.fetch()});
    }finally{hold?.finished.resolve();}
  });
  return {requests,hold(offset=0,status=200){
    const held={offset,status,entered:signal(),released:signal(),finished:signal()};holds.push(held);releaseHeld.push(held.released.resolve);
    return {entered:held.entered.promise,release:held.released.resolve,finished:held.finished.promise};
  }};
}
const older=(page:Page)=>page.locator('#messages-panel-direct').getByRole('button',{name:'載入較早訊息',exact:true});
const pending=(page:Page)=>page.locator('#messages-panel-direct').getByRole('button',{name:'正在讀取…',exact:true});
const reread=(page:Page)=>page.locator('#messages-panel-direct').getByRole('button',{name:'重新讀取訊息',exact:true});
async function orderedMessages(peer=1){
  const result=await db.query(`SELECT message_id FROM member_direct_messages WHERE community_id=$1
    AND ((sender_ref=$2 AND recipient_ref=$3) OR (sender_ref=$3 AND recipient_ref=$2)) ORDER BY created_at,message_id`,
    [DEMO_COMMUNITY,accounts[0].id,accounts[peer].id]);
  return result.rows.map(row=>row.message_id as string);
}
async function allMessages(page:Page,ids:string[],peer=1){
  const rows=page.locator('#messages-panel-direct .messages-bubbles [data-message-id]'),expected=await orderedMessages(peer);
  expect(expected).toHaveLength(ids.length);await expect(rows).toHaveCount(ids.length);
  await expect.poll(()=>rows.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-message-id')))).toEqual(expected);
}

test('R1: a held live refresh keeps an older-page click visible and runs it once after settling',async({browser,baseURL})=>{
  const ids=await history(),page=await member(browser,baseURL!),panel=await openDirect(page),watch=await watchThread(page),held=watch.hold();
  ids.push(...await history(26,1));
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await held.entered;
  await expect(reread(page)).toHaveAttribute('aria-disabled','true');await expect(older(page)).toBeEnabled();
  await older(page).click();await expect(pending(page)).toBeDisabled();expect(watch.requests).toEqual([0]);
  await page.evaluate(()=>{for(let i=0;i<3;i++)window.dispatchEvent(new Event('focus'));});
  expect(watch.requests).toEqual([0]);held.release();
  await expect(panel.locator('.messages-bubbles')).toContainText('合成分頁 1');await allMessages(page,ids);
  expect(watch.requests.filter(offset=>offset===20)).toHaveLength(1);
});

test('R2: a same-frame reread and older-page click preserves the handler intent',async({browser,baseURL})=>{
  const ids=await history(),page=await member(browser,baseURL!);await openDirect(page);
  const watch=await watchThread(page),held=watch.hold();
  const enabled=await page.evaluate(()=>{
    const panel=document.querySelector('#messages-panel-direct')!,buttons=[...panel.querySelectorAll<HTMLButtonElement>('button')];
    const refresh=buttons.find(button=>button.getAttribute('aria-label')==='重新讀取訊息')!,older=buttons.find(button=>button.textContent==='載入較早訊息')!;
    refresh.click();const enabled=!older.disabled;older.click();return enabled;
  });
  expect(enabled).toBe(true);await held.entered;expect(watch.requests).toEqual([0]);held.release();
  await allMessages(page,ids);expect(watch.requests.filter(offset=>offset===20)).toHaveLength(1);
});

test('R3: switching conversations cancels the queued intent and fences the late refresh',async({browser,baseURL})=>{
  await history();const second=await history(101,1,2),page=await member(browser,baseURL!);await openDirect(page);
  const watch=await watchThread(page),held=watch.hold();await reread(page).click();await held.entered;
  await older(page).click();await expect(pending(page)).toBeDisabled();await openDirect(page,2);await allMessages(page,second,2);
  held.release();await held.finished;
  const response=page.waitForResponse(url=>url.url().includes(`/conversations/${accounts[2].id}/messages?`));
  await reread(page).click();await response;await expect(reread(page)).toHaveAttribute('aria-disabled','false');
  await allMessages(page,second,2);expect(watch.requests).toEqual([0]);
});

test('R4: queued paging restarts at the refreshed cursor and fills every gap exactly once',async({browser,baseURL})=>{
  const ids=await history(1,45),page=await member(browser,baseURL!);await openDirect(page);
  await older(page).click();await expect(page.locator('#messages-panel-direct .messages-bubbles li')).toHaveCount(40);
  const watch=await watchThread(page),held=watch.hold();await reread(page).click();await held.entered;
  await older(page).click();await expect(pending(page)).toBeDisabled();ids.push(...await history(46,25));
  expect(watch.requests).toEqual([0]);held.release();
  await expect(older(page)).toBeEnabled();expect(watch.requests).toEqual([0,20]);
  await older(page).click();await expect(older(page)).toBeEnabled();await older(page).click();
  await allMessages(page,ids);await expect(older(page)).toHaveCount(0);expect(watch.requests).toEqual([0,20,40,60]);
});

test('R5: unmounting through hash navigation cancels the intent without reloading the document',async({browser,baseURL})=>{
  await history();const page=await member(browser,baseURL!),errors:Error[]=[];page.on('pageerror',error=>errors.push(error));
  const panel=await openDirect(page),watch=await watchThread(page),held=watch.hold(),documentHandle=await page.evaluateHandle(()=>document);
  await reread(page).click();await held.entered;await older(page).click();await expect(pending(page)).toBeDisabled();
  // Ordinary portal tabs and collapsing the dock preserve the thread; the reset view unmounts Workspace.
  await page.evaluate(()=>{location.hash='reset-password/'+'A'.repeat(43);});
  await expect(panel).toHaveCount(0);await expect(page.getByLabel('再次輸入新密碼',{exact:true})).toBeVisible();
  expect(await documentHandle.evaluate(value=>value===document)).toBe(true);held.release();await held.finished;
  expect(watch.requests).toEqual([0]);expect(errors).toEqual([]);
  await page.evaluate(()=>{location.hash='messages';});await expect(page.locator('.messages-categories')).toBeVisible();await openDirect(page);
  const shown=page.locator('#messages-panel-direct .messages-bubbles [data-message-id]'),expected=(await orderedMessages()).slice(-20);
  await expect(shown).toHaveCount(20);await expect.poll(()=>shown.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-message-id')))).toEqual(expected);
  await expect(older(page)).toBeEnabled();expect(watch.requests).toEqual([0,0]);expect(errors).toEqual([]);
  expect(await documentHandle.evaluate(value=>value===document)).toBe(true);await documentHandle.dispose();
});

for(const status of [500,403,404])test(`a queued click ${status===500?'survives':'is cancelled by'} a ${status} refresh response`,async({browser,baseURL})=>{
  const ids=await history(),page=await member(browser,baseURL!),panel=await openDirect(page),watch=await watchThread(page),held=watch.hold(0,status);
  await reread(page).click();await held.entered;await older(page).click();await expect(pending(page)).toBeDisabled();held.release();
  if(status===500){await allMessages(page,ids);expect(watch.requests.filter(offset=>offset===20)).toHaveLength(1);}
  else{await expect(panel.locator('.messages-thread [role="alert"]')).toContainText('訊息讀取失敗');expect(watch.requests).toEqual([0]);await expect(panel.locator('.messages-bubbles')).toHaveCount(0);}
});

test('a superseding quiet refresh keeps one intent until the newest refresh settles',async({browser,baseURL})=>{
  const ids=await history(),page=await member(browser,baseURL!);await openDirect(page);
  const watch=await watchThread(page),first=watch.hold();await reread(page).click();await first.entered;await older(page).click();
  const newest=watch.hold();await page.evaluate(()=>window.dispatchEvent(new Event('freedom-inbox-all-read')));await newest.entered;
  first.release();await first.finished;await expect(pending(page)).toBeDisabled();expect(watch.requests).toEqual([0,0]);
  newest.release();await allMessages(page,ids);expect(watch.requests).toEqual([0,0,20]);
});

test('re-selecting the same conversation cancels its intent before a non-quiet read',async({browser,baseURL})=>{
  await history();const page=await member(browser,baseURL!);await openDirect(page);
  const watch=await watchThread(page),held=watch.hold();await reread(page).click();await held.entered;await older(page).click();
  await openDirect(page);held.release();await held.finished;await expect(older(page)).toBeEnabled();
  expect(watch.requests).toEqual([0,0]);await expect(page.locator('#messages-panel-direct .messages-bubbles li')).toHaveCount(20);
});

test('a quiet reread waits for an older-page request already in flight',async({browser,baseURL})=>{
  const ids=await history(),page=await member(browser,baseURL!);await openDirect(page);
  const watch=await watchThread(page),held=watch.hold(20);await older(page).click();await held.entered;await reread(page).click();
  expect(watch.requests).toEqual([20]);held.release();await allMessages(page,ids);
  await expect.poll(()=>watch.requests).toEqual([20,0]);await expect(reread(page)).toHaveAttribute('aria-disabled','false');await allMessages(page,ids);
});

test('a superseded quiet response still in flight cannot overlap queued paging',async({browser,baseURL})=>{
  const ids=await history(),page=await member(browser,baseURL!);await openDirect(page);
  const watch=await watchThread(page),first=watch.hold();await reread(page).click();await first.entered;await older(page).click();
  const newest=watch.hold();await page.evaluate(()=>window.dispatchEvent(new Event('freedom-inbox-all-read')));await newest.entered;
  newest.release();await expect(reread(page)).toHaveAttribute('aria-disabled','false');
  await expect(pending(page)).toBeDisabled();expect(watch.requests).toEqual([0,0]);
  first.release();await allMessages(page,ids);expect(watch.requests).toEqual([0,0,20]);
});
