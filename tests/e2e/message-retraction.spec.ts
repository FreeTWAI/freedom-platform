import {clearMemberAgentEvents} from './navigation.js';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {test,expect,type Browser,type BrowserContext,type Page,type Route,type APIResponse} from './fixtures.js';
import {LOCAL_DATABASE_URL} from '../../packages/db/index.js';
import {e2eSchema} from '../../packages/testing/e2e-auth-isolation.js';
import {DEMO_USERS,DEMO_COMMUNITY,DEMO_PASSWORD} from '../../packages/testing/seed.js';

// #398 with the real API and two synthetic members; rows are removed afterwards.
let db:Pool,contexts:BrowserContext[],accounts:{id:string;email:string;name:string}[];
test.beforeEach(async()=>{
  db=new Pool({connectionString:process.env.TEST_DATABASE_URL??LOCAL_DATABASE_URL,options:`-c search_path=${e2eSchema(process.env.FREEDOM_E2E_SCHEMA)}`,max:4});
  contexts=[];accounts=[];
  for(const name of ['甲','乙']){
    const id=randomUUID(),email=`retract-${id}@example.test`,display=`合成收回${name} ${id.slice(0,8)}`;
    await db.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,onboarding_required,email_verified_at)
      SELECT $1,$2,$3,$4,password_hash,$5,false,now() FROM users WHERE user_id=$6`,[id,DEMO_COMMUNITY,email,display,randomUUID(),DEMO_USERS[0].user_id]);
    await db.query("INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state) VALUES($1,$2,$3,'guild_ai_vibe','active')",[randomUUID(),DEMO_COMMUNITY,id]);
    accounts.push({id,email,name:display});
  }
});
test.afterEach(async()=>{
  await Promise.all(contexts.map(context=>context.close()));
  const ids=accounts.map(account=>account.id),q=await db.connect();
  try{
    await q.query('BEGIN');
    await q.query('DELETE FROM member_channel_reads WHERE user_id=ANY($1::uuid[])',[ids]);
    await q.query('DELETE FROM member_channel_messages WHERE sender_ref=ANY($1::uuid[])',[ids]);
    await q.query('DELETE FROM member_direct_messages WHERE sender_ref=ANY($1::uuid[]) OR recipient_ref=ANY($1::uuid[])',[ids]);
    for(const table of ['community_social_reads','positioning_profession_memberships','sessions','member_client_errors','command_receipts'])await q.query(`DELETE FROM ${table} WHERE user_id=ANY($1::uuid[])`,[ids]);
    await q.query('DELETE FROM member_notifications WHERE recipient_ref=ANY($1::uuid[])',[ids]);
    await q.query('DELETE FROM outbox WHERE transition_id IN (SELECT transition_id FROM transition_journal WHERE actor_ref=ANY($1::uuid[]))',[ids]);
    await q.query('DELETE FROM transition_journal WHERE actor_ref=ANY($1::uuid[])',[ids]);
    await clearMemberAgentEvents(q,ids);
    await q.query('DELETE FROM users WHERE user_id=ANY($1::uuid[])',[ids]);await q.query('COMMIT');
  }catch(error){await q.query('ROLLBACK');throw error;}finally{q.release();await db.end();}
});
async function member(browser:Browser,baseURL:string,index:number,width=1280){
  const context=await browser.newContext({baseURL,viewport:{width,height:900}});contexts.push(context);
  await context.route(url=>!['localhost','127.0.0.1'].includes(url.hostname),route=>route.abort());
  const page=await context.newPage();await page.goto('/#messages');
  await page.getByLabel('電子郵件',{exact:true}).fill(accounts[index].email);await page.getByLabel('密碼',{exact:true}).fill(DEMO_PASSWORD);
  await page.getByRole('button',{name:'登入',exact:true}).click();await expect(page.locator('.messages-categories')).toBeVisible();return page;
}
async function openDirect(page:Page,peer:string){
  const panel=page.locator('#messages-panel-direct');await panel.locator('.chat-list-toolbar').getByRole('button',{name:'開始新對話',exact:true}).click();await panel.getByLabel('搜尋會員',{exact:true}).fill(peer);
  await panel.getByRole('button',{name:'搜尋會員',exact:true}).click();await panel.getByRole('button',{name:`傳訊給 ${peer}`,exact:true}).click();
  await expect(panel.locator('.messages-compose')).toBeVisible();return panel;
}

test('a sender retracts a private message through the site dialog and the recipient sees only a placeholder',async({browser,baseURL})=>{
  await db.query(`INSERT INTO member_direct_messages(community_id,sender_ref,recipient_ref,body,created_at) VALUES($1,$2,$3,$4,now()),($1,$3,$2,$5,now()-interval '1 minute')`,
    [DEMO_COMMUNITY,accounts[0].id,accounts[1].id,'合成：電話 0912-000-000','合成：對方的訊息']);
  const sender=await member(browser,baseURL!,0),panel=await openDirect(sender,accounts[1].name);
  const mine=panel.locator('.messages-bubbles li.is-mine',{hasText:'0912'});
  await expect(mine).toBeVisible();
  // Only my own message offers 收回.
  await expect(panel.locator('.messages-bubbles li:not(.is-mine)').getByRole('button',{name:'收回你的訊息'})).toHaveCount(0);
  // Keep the recipient open before retraction. Opening afterwards only tests GET projection,
  // and cannot detect an unchanged activity token or stale cached history.
  const recipient=await member(browser,baseURL!,1,390),other=await openDirect(recipient,accounts[0].name);
  await expect(other.locator('.messages-bubbles')).toContainText('0912');
  await expect.poll(async()=>Number((await db.query('SELECT count(*)::int AS n FROM member_direct_messages WHERE sender_ref=$1 AND recipient_ref=$2 AND read_at IS NULL',[accounts[0].id,accounts[1].id])).rows[0].n)).toBe(0);
  const preview=panel.getByRole('list',{name:'對話列表'}).locator('.chat-peer-preview');
  await expect(preview).toContainText('0912');
  // A local confirmed retraction must clear the cached preview even if list refresh fails.
  await sender.route(url=>url.pathname==='/api/v1/me/conversations',route=>route.abort());
  const trigger=mine.getByRole('button',{name:'收回你的訊息'});
  await trigger.click();
  const dialog=sender.getByRole('dialog',{name:'收回這則訊息？'});
  await expect(dialog).toBeVisible();await expect(dialog).toContainText('0912');
  await sender.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(trigger).toBeFocused();
  await trigger.click();await sender.screenshot({path:'test-results/message-retract-dialog.png'});
  await dialog.getByRole('button',{name:'確定收回'}).click();
  await expect(dialog).toBeHidden();
  await expect(panel.locator('.messages-bubbles')).not.toContainText('0912');
  await expect(panel.locator('.messages-bubbles .chat-retracted')).toHaveText('你已收回這則訊息。');
  await expect(preview).toHaveText('你：訊息已收回');

  await recipient.bringToFront();
  // More than two maximum idle polling intervals; no refresh/navigation is allowed.
  await expect(other.locator('.messages-bubbles .chat-retracted')).toHaveText('這則訊息已收回。',{timeout:15000});
  await expect(other.locator('.messages-bubbles')).not.toContainText('0912');
  await expect(other.locator('.messages-bubbles li',{has:recipient.locator('.chat-retracted')}).locator('.messages-meta')).not.toContainText('未讀');
  await expect(other.getByRole('button',{name:'收回你的訊息'})).toHaveCount(1);
  await recipient.screenshot({path:'test-results/message-retract-390.png'});
  expect((await db.query('SELECT count(*)::int AS n FROM member_direct_messages WHERE retracted_at IS NOT NULL AND sender_ref=$1',[accounts[0].id])).rows[0].n).toBe(1);
});

test('an already-open channel replaces a read message after another member retracts it',async({browser,baseURL})=>{
  const sender=await member(browser,baseURL!,0),recipient=await member(browser,baseURL!,1);
  for(const page of [sender,recipient])await page.getByRole('tab',{name:/^世界聊天/}).click();
  const own=sender.locator('#messages-panel-world'),other=recipient.locator('#messages-panel-world');
  const body=`合成：開啟中的頻道收回 ${randomUUID()}`;
  await own.getByRole('textbox',{name:'世界聊天訊息',exact:true}).fill(body);
  await own.getByRole('button',{name:'傳送',exact:true}).click();
  await expect(other.locator('.messages-bubbles')).toContainText(body,{timeout:15000});
  const sent=(await db.query('SELECT message_id,sequence FROM member_channel_messages WHERE sender_ref=$1 AND body=$2',[accounts[0].id,body])).rows[0];
  await expect.poll(async()=>{
    const row=(await db.query("SELECT last_read_sequence FROM member_channel_reads WHERE community_id=$1 AND kind='world' AND channel_key='world' AND user_id=$2",[DEMO_COMMUNITY,accounts[1].id])).rows[0];
    return row&&BigInt(row.last_read_sequence)>=BigInt(sent.sequence);
  }).toBe(true);
  await own.locator(`[data-message-id="${sent.message_id}"]`).getByRole('button',{name:'收回你的訊息'}).click();
  await sender.getByRole('dialog',{name:'收回這則訊息？'}).getByRole('button',{name:'確定收回'}).click();
  await recipient.bringToFront();
  // No reload or new message: neither sequence nor unread count changes.
  await expect(other.locator(`[data-message-id="${sent.message_id}"] .chat-retracted`)).toHaveText('這則訊息已收回。',{timeout:15000});
  await expect(other.locator('.messages-bubbles')).not.toContainText(body);
});

test('an open recipient refreshes a loaded older page and its quote when the latest page does not change',async({browser,baseURL})=>{
  const original=randomUUID(),reply=randomUUID(),body='合成：較早訊息內的私人聯絡資訊';
  await db.query(`INSERT INTO member_direct_messages(message_id,community_id,sender_ref,recipient_ref,body,created_at)
    VALUES($1,$2,$3,$4,$5,now()-interval '2 hours')`,[original,DEMO_COMMUNITY,accounts[0].id,accounts[1].id,body]);
  await db.query(`INSERT INTO member_direct_messages(message_id,community_id,sender_ref,recipient_ref,body,reply_to_message_id,created_at)
    VALUES($1,$2,$3,$4,'合成：保留這則回覆',$5,now()-interval '119 minutes')`,[reply,DEMO_COMMUNITY,accounts[1].id,accounts[0].id,original]);
  await db.query(`INSERT INTO member_direct_messages(community_id,sender_ref,recipient_ref,body,created_at)
    SELECT $1,$2,$3,'合成：後續訊息 '||n,now()-interval '60 minutes'+n*interval '1 second' FROM generate_series(1,25) n`,
    [DEMO_COMMUNITY,accounts[0].id,accounts[1].id]);
  const sender=await member(browser,baseURL!,0),own=await openDirect(sender,accounts[1].name);
  const recipient=await member(browser,baseURL!,1,390),other=await openDirect(recipient,accounts[0].name);
  for(const panel of [own,other]){
    await expect(panel.locator('.messages-bubbles')).not.toContainText(body);
    await panel.getByRole('button',{name:'載入較早訊息',exact:true}).click();
    await expect(panel.locator(`[data-message-id="${original}"]`)).toContainText(body);
    await expect(panel.locator(`[data-message-id="${reply}"]`)).toContainText(body);
  }
  await own.locator(`[data-message-id="${original}"]`).getByRole('button',{name:'收回你的訊息'}).click();
  await sender.getByRole('dialog',{name:'收回這則訊息？'}).getByRole('button',{name:'確定收回'}).click();
  await recipient.bringToFront();
  await expect(other.locator(`[data-message-id="${original}"] .chat-retracted`)).toHaveText('這則訊息已收回。',{timeout:15000});
  await expect(other.locator(`[data-message-id="${reply}"]`)).toContainText('合成：保留這則回覆');
  await expect(other.locator('.messages-bubbles')).not.toContainText(body);
  await expect(other.locator('.messages-bubbles li')).toHaveCount(27);
});

for(const width of [390,1280])for(const failRefresh of [false,true])test(`a confirmed channel retraction survives a stale history response at ${width}px, refresh failure=${failRefresh}`,async({browser,baseURL})=>{
  const page=await member(browser,baseURL!,0,width);
  await page.getByRole('tab',{name:/^世界聊天/}).click();
  const panel=page.locator('#messages-panel-world'),body=`合成：不得復原的內容 ${randomUUID()}`;
  // On phones the category opens a room list; enter the room before composing.
  if(width===390)await panel.getByRole('button',{name:'世界聊天',exact:true}).click();
  await expect(panel.locator('.messages-compose')).toBeVisible();
  await panel.getByRole('textbox',{name:'世界聊天訊息',exact:true}).fill(body);
  await panel.getByRole('button',{name:'傳送',exact:true}).click();
  const row=panel.locator('.messages-bubbles li',{hasText:body});await expect(row).toBeVisible();
  const messageId=await row.getAttribute('data-message-id');expect(messageId).toBeTruthy();
  let old:{route:Route;response:APIResponse}|undefined,fresh:{route:Route;response:APIResponse}|undefined,reads=0;
  await page.route(url=>url.pathname==='/api/v1/me/channels/world/world/messages'&&url.searchParams.get('offset')==='0',async route=>{
    const response=await route.fetch();expect(response.status()).toBe(200);
    reads++;
    if(reads===1){expect((await response.json()).items.find((item:any)=>item.message_id===messageId).body).toBe(body);old={route,response};return;}
    if(reads===2){fresh={route,response};return;}
    await route.fulfill({response});
  });
  try{
    await panel.getByRole('button',{name:'重新讀取訊息',exact:true}).click();await expect.poll(()=>Boolean(old)).toBe(true);
    await row.getByRole('button',{name:'收回你的訊息'}).click();
    const dialog=page.getByRole('dialog',{name:'收回這則訊息？'});
    await dialog.getByRole('button',{name:'確定收回'}).click();await expect(dialog).toBeHidden();
    const tombstone=panel.locator(`[data-message-id="${messageId}"] .chat-retracted`);
    await expect(tombstone).toHaveText('你已收回這則訊息。');await expect.poll(()=>Boolean(fresh)).toBe(true);
    const oldResponse=page.waitForResponse(response=>response.url()===old!.route.request().url());
    const prior=old!;await prior.route.fulfill({response:prior.response});await (await oldResponse).finished();old=undefined;
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    await expect(tombstone).toHaveText('你已收回這則訊息。');await expect(panel.locator('.messages-bubbles')).not.toContainText(body);
    const replacement=fresh!;fresh=undefined;
    if(failRefresh){
      await replacement.route.abort();await expect(panel).toContainText('訊息重新讀取失敗：');
      await expect(tombstone).toHaveText('你已收回這則訊息。');
      await panel.getByRole('button',{name:'重新讀取訊息',exact:true}).click();
    }else await replacement.route.fulfill({response:replacement.response});
    await expect(panel.getByRole('button',{name:'重新讀取訊息',exact:true})).toHaveText('重新讀取訊息');
    await expect(tombstone).toHaveText('你已收回這則訊息。');await expect(panel.locator('.messages-bubbles')).not.toContainText(body);
    expect((await db.query('SELECT retracted_at FROM member_channel_messages WHERE message_id=$1',[messageId])).rows[0].retracted_at).not.toBeNull();
    const next=`合成：收回後繼續聊天 ${randomUUID()}`;
    await panel.getByRole('textbox',{name:'世界聊天訊息',exact:true}).fill(next);await panel.getByRole('button',{name:'傳送',exact:true}).click();
    await expect(panel.locator('.messages-bubbles')).toContainText(next);await expect(tombstone).toHaveText('你已收回這則訊息。');
  }finally{if(old)await old.route.abort().catch(()=>{});if(fresh)await fresh.route.abort().catch(()=>{});}
});

for(const mode of ['foreground','hidden','offline'] as const){
  test(`open guild refreshes 102 loaded messages without losing the viewport (${mode})`,async({browser,baseURL})=>{
    const guild='guild_ai_vibe',original=randomUUID(),reply=randomUUID(),anchor=randomUUID();
    const marker='合成：已收回內容',body=marker+' '+('tall synthetic content '.repeat(55));
    await db.query(`INSERT INTO member_chat_channels(community_id,kind,channel_key,last_sequence) VALUES($1,'guild',$2,102)
      ON CONFLICT(community_id,kind,channel_key) DO UPDATE SET last_sequence=102`,[DEMO_COMMUNITY,guild]);
    await db.query(`INSERT INTO member_channel_messages(message_id,community_id,kind,channel_key,sequence,sender_ref,body,created_at)
      VALUES($1,$2,'guild',$3,1,$4,$5,now()-interval '3 min')`,[original,DEMO_COMMUNITY,guild,accounts[0].id,body]);
    await db.query(`INSERT INTO member_channel_messages(message_id,community_id,kind,channel_key,sequence,sender_ref,body,reply_to_message_id,created_at)
      VALUES($1,$2,'guild',$3,2,$4,'合成：保留回覆',$5,now()-interval '179 sec')`,[reply,DEMO_COMMUNITY,guild,accounts[0].id,original]);
    await db.query(`INSERT INTO member_channel_messages(message_id,community_id,kind,channel_key,sequence,sender_ref,body,created_at)
      SELECT CASE WHEN n=4 THEN $4::uuid ELSE gen_random_uuid() END,$1,'guild',$2,n,$3,'合成：歷史訊息 '||n,now()-(180-n)*interval '1 second'
      FROM generate_series(3,102) AS n`,[DEMO_COMMUNITY,guild,accounts[0].id,anchor]);

    const sender=await member(browser,baseURL!,0),page=await member(browser,baseURL!,1,390);
    // Synthetic lifecycle events exercise the real browser app and HTTP responses,
    // without treating headless browser focus or offline state as phone OS behavior.
    await page.evaluate(()=>{
      let hidden=false,online=true;
      Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>hidden?'hidden':'visible'});
      Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>online});
      (window as Window&{setTestAvailability?:(mode:string)=>void}).setTestAvailability=mode=>{
        const nextHidden=mode==='hidden',nextOnline=mode!=='offline';
        if(nextHidden!==hidden){hidden=nextHidden;document.dispatchEvent(new Event('visibilitychange'));}
        if(nextOnline!==online){online=nextOnline;window.dispatchEvent(new Event(online?'online':'offline'));}
        if(mode==='foreground')window.dispatchEvent(new Event('focus'));
      };
    });
    const transition=(next:string)=>page.evaluate(value=>
      (window as Window&{setTestAvailability?:(mode:string)=>void}).setTestAvailability!(value),next);

    await page.getByRole('tab',{name:/^公會閒聊/}).click();
    const panel=page.locator('#messages-panel-guild');
    await panel.locator(`[data-channel-key="${guild}"]`).click();
    const rows=panel.locator('.messages-bubbles li'),more=panel.getByRole('button',{name:'載入較早訊息',exact:true});
    for(const count of [40,60,80,100,102]){await more.click();await expect(rows).toHaveCount(count);}
    const row=(id:string)=>panel.locator(`[data-message-id="${id}"]`);
    await expect(row(reply)).toContainText(marker);
    const draft=panel.locator('.messages-compose').getByRole('textbox');
    await draft.fill('草稿還沒送出');
    const stable=row(anchor);
    const relativeTop=()=>stable.evaluate(node=>node.getBoundingClientRect().top-node.closest('.messages-scroll')!.getBoundingClientRect().top);
    const oldHeight=await row(original).evaluate(node=>node.getBoundingClientRect().height);
    await stable.evaluate(node=>{
      const container=node.closest('.messages-scroll')!;
      container.scrollTop+=node.getBoundingClientRect().top-container.getBoundingClientRect().top-90;
    });
    const before=await relativeTop();
    expect(before).toBeGreaterThan(30);expect(before).toBeLessThan(140);

    const channel=`/api/v1/me/channels/guild/${guild}`,offsets:string[]=[];
    let release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    let held=false,settled=false;
    await page.route(url=>url.pathname===channel+'/messages'&&url.searchParams.get('limit')==='50'&&url.searchParams.has('offset'),async route=>{
      const offset=new URL(route.request().url()).searchParams.get('offset')!;
      offsets.push(offset);
      if(offset!=='50'||held){await route.continue();return;}
      const response=await route.fetch();expect(response.ok()).toBe(true);
      held=true;
      await gate;await route.fulfill({response});settled=true;
    });
    try{
      const session=await (await sender.request.get('/api/v1/session')).json();
      const retract=await sender.request.post(`${channel}/messages/${original}/retract`,{data:{},headers:{
        Origin:new URL(sender.url()).origin,'X-CSRF-Token':session.csrf_token,'Idempotency-Key':randomUUID(),
      }});
      expect(retract.ok()).toBe(true);
      await expect.poll(()=>held,{timeout:13000}).toBe(true);
      if(mode!=='foreground')await transition(mode);
      release();
      await expect.poll(()=>settled).toBe(true);
      const tombstone=row(original).locator('.chat-retracted');
      if(mode!=='foreground'){
        // Hold the unavailable state across the next timer tick to catch any follow-on.
        await page.waitForTimeout(1100);
        expect.soft(offsets.slice()).toEqual(['0','50']);
        await expect.soft(tombstone).toHaveCount(0);
        await transition('foreground');
      }
      await expect(tombstone).toHaveText('這則訊息已收回。',{timeout:12000});
      await expect(row(reply)).toContainText('合成：保留回覆');
      await expect(row(reply)).not.toContainText(marker);
      await expect(rows).toHaveCount(102);
      await expect(draft).toHaveValue('草稿還沒送出');
      await expect.poll(()=>row(original).evaluate(node=>node.getBoundingClientRect().height)).toBeLessThan(oldHeight-30);
      expect(Math.abs(await relativeTop()-before)).toBeLessThanOrEqual(4);
      await page.waitForTimeout(1300);
      expect(offsets).toEqual(mode==='foreground'?['0','50','100']:['0','50','0','50','100']);
      const refresh=panel.getByRole('button',{name:'重新讀取訊息'});
      await refresh.click();
      await expect(refresh).toHaveAttribute('aria-disabled','false');
      await expect(tombstone).toHaveCount(1);
      await expect(draft).toHaveValue('草稿還沒送出');
    }finally{release();}
  });
}
