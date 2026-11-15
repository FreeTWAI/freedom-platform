import {clearMemberAgentEvents} from './navigation.js';
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {test,expect,type Page} from './fixtures.js';
import {openChat,closeChat} from './navigation.js';
import {DEMO_COMMUNITY,DEMO_PASSWORD} from '../../packages/testing/seed.js';
import {CHAT_STICKERS,CHAT_STICKER_ATLAS} from '../../modules/member-communications/stickers.js';

const guild='guild_ai_vibe';
const supplied=CHAT_STICKERS.find(sticker=>'image' in sticker)!,legacy=CHAT_STICKERS.find(sticker=>!('image' in sticker))!;
async function setup(db:Pool,kind:'direct'|'guild',sticker:typeof CHAT_STICKERS[number],ids:string[]){
 const messageId=randomUUID(),email=`sticker-retry-${ids[0]}@example.test`,peerName=`貼圖來源 ${ids[1].slice(0,8)}`;
 for(const [index,id] of ids.entries()){
  expect((await db.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,onboarding_required)
   SELECT $1,$2,$3,$4,password_hash,$5,false FROM users WHERE email='maker@local.test'`,[id,DEMO_COMMUNITY,index===0?email:`sticker-peer-${id}@example.test`,index===0?'貼圖重試會員':peerName,randomUUID()])).rowCount).toBe(1);
  await db.query("INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state) VALUES($1,$2,$3,$4,'active')",[randomUUID(),DEMO_COMMUNITY,id,guild]);
  await db.query('INSERT INTO guild_member_preferences(community_id,user_id,primary_guild_key) VALUES($1,$2,$3)',[DEMO_COMMUNITY,id,guild]);
 }
 // The fixture creates one stored incoming message. Rendering and manual history
 // refresh use the real authorized API; this is not a send/receipt simulation.
 if(kind==='direct')await db.query('INSERT INTO member_direct_messages(message_id,community_id,sender_ref,recipient_ref,body,sticker_id) VALUES($1,$2,$3,$4,$5,$6)',[messageId,DEMO_COMMUNITY,ids[1],ids[0],`[貼圖] ${sticker.label}`,sticker.id]);
 else{
  await db.query("INSERT INTO member_chat_channels(community_id,kind,channel_key) VALUES($1,'guild',$2) ON CONFLICT DO NOTHING",[DEMO_COMMUNITY,guild]);
  await db.query(`WITH sequence AS (UPDATE member_chat_channels SET last_sequence=last_sequence+1 WHERE community_id=$1 AND kind='guild' AND channel_key=$2 RETURNING last_sequence)
   INSERT INTO member_channel_messages(message_id,community_id,kind,channel_key,sequence,sender_ref,body,sticker_id)
   SELECT $3,$1,'guild',$2,last_sequence,$4,$5,$6 FROM sequence`,[DEMO_COMMUNITY,guild,messageId,ids[1],`[貼圖] ${sticker.label}`,sticker.id]);
 }
 return {messageId,email,peerName,peer:ids[1]};
}
async function cleanup(db:Pool,ids:string[]){
 const q=await db.connect();
 try{
  await q.query('BEGIN');await clearMemberAgentEvents(q,ids);
  for(const query of [
   'DELETE FROM member_channel_reads WHERE user_id=ANY($1::uuid[])',
   'DELETE FROM guild_member_preferences WHERE user_id=ANY($1::uuid[])',
   'DELETE FROM positioning_profession_memberships WHERE user_id=ANY($1::uuid[])',
   'DELETE FROM sessions WHERE user_id=ANY($1::uuid[])',
   'DELETE FROM member_client_errors WHERE user_id=ANY($1::uuid[])',
   'DELETE FROM command_receipts WHERE user_id=ANY($1::uuid[])',
   'DELETE FROM member_channel_messages WHERE sender_ref=ANY($1::uuid[])',
   'DELETE FROM member_direct_messages WHERE sender_ref=ANY($1::uuid[]) OR recipient_ref=ANY($1::uuid[])',
   'DELETE FROM member_notifications WHERE recipient_ref=ANY($1::uuid[])',
   'DELETE FROM outbox WHERE transition_id IN (SELECT transition_id FROM transition_journal WHERE actor_ref=ANY($1::uuid[]))',
   'DELETE FROM transition_journal WHERE actor_ref=ANY($1::uuid[])',
   'DELETE FROM users WHERE user_id=ANY($1::uuid[])',
  ])await q.query(query,[ids]);
  // Keep the shared guild sequence monotonic; only remove this case's members/messages.
  await q.query('COMMIT');
 }catch(error){await q.query('ROLLBACK');throw error;}finally{q.release();}
}
async function openThread(page:Page,kind:'direct'|'guild',h:Awaited<ReturnType<typeof setup>>){
 await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill(h.email);await page.getByLabel('密碼',{exact:true}).fill(DEMO_PASSWORD);await page.getByRole('button',{name:'登入',exact:true}).click();await expect(page.locator('.shell')).toBeVisible();
 await page.goto('/#messages');await openChat(page);await page.getByRole('tab',{name:kind==='direct'?/^私人訊息/:/^公會閒聊/}).click();const panel=page.locator(`#messages-panel-${kind}`);
 if(kind==='direct'){
  await panel.getByRole('button',{name:'開始新對話',exact:true}).click();
  await panel.getByLabel('搜尋會員',{exact:true}).fill(h.peerName);await panel.getByRole('button',{name:'搜尋會員',exact:true}).click();await panel.getByRole('button',{name:`傳訊給 ${h.peerName}`,exact:true}).click();
 }else await panel.locator(`[data-channel-key="${guild}"]`).click();
 await expect(panel.locator('.messages-compose')).toBeVisible();return panel;
}
for(const kind of ['direct','guild'] as const)for(const [sticker,width] of [[supplied,390],[legacy,1440]] as const)test(`${kind} ${sticker.id} retries only the failed image at ${width}px`,async({page,e2eAuthPool})=>{
 const ids=[randomUUID(),randomUUID()];
 try{
 await page.setViewportSize({width,height:900});const h=await setup(e2eAuthPool,kind,sticker,ids),asset='image' in sticker?sticker.image:CHAT_STICKER_ATLAS;
 const imageRequests:string[]=[],messagePosts:string[]=[],writePath=kind==='direct'?`/api/v1/me/conversations/${h.peer}/messages`:`/api/v1/me/channels/guild/${guild}/messages`;
 page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname===writePath)messagePosts.push(request.url());});
 await page.route(`**${asset}`,async route=>{imageRequests.push(route.request().url());if(imageRequests.length<=2)await route.fulfill({status:503,contentType:'text/plain',headers:{'Cache-Control':'no-store'},body:'temporary image fixture failure'});else await route.continue();});
 const panel=await openThread(page,kind,h),row=panel.locator(`[data-message-id="${h.messageId}"]`),retry=row.getByRole('button',{name:'重試貼圖',exact:true}),draft=`未送出草稿 ${randomUUID()}`;
 await expect(retry).toBeVisible();await expect(row).toContainText(`[貼圖] ${sticker.label}`);await panel.locator('.messages-compose textarea').fill(draft);
 await panel.getByRole('button',{name:'重新讀取訊息',exact:true}).click();await expect(panel.getByRole('button',{name:'重新讀取訊息',exact:true})).toHaveAttribute('aria-disabled','false');await expect(retry).toBeVisible();expect(imageRequests).toHaveLength(1);
 await closeChat(page);await openChat(page);await expect(retry).toBeVisible();expect(imageRequests).toHaveLength(1);
 await retry.click();await expect.poll(()=>imageRequests.length).toBe(2);await expect(retry).toBeVisible();await expect(retry).toHaveAttribute('type','button');
 await retry.press('Enter');const image=row.locator('.chat-sticker img');await expect(image).toBeVisible();await expect.poll(()=>image.evaluate((node:HTMLImageElement)=>node.naturalWidth)).toBeGreaterThan(0);await expect(retry).toHaveCount(0);
 expect(imageRequests).toHaveLength(3);expect(new Set(imageRequests).size).toBe(1);expect(new URL(imageRequests[0]).pathname).toBe(asset);expect(new URL(imageRequests[0]).search).toBe('');expect(messagePosts).toEqual([]);
 await expect(panel.locator('.messages-compose textarea')).toHaveValue(draft);const query=kind==='direct'?'SELECT count(*)::int AS n FROM member_direct_messages WHERE message_id=$1 AND sticker_id=$2':'SELECT count(*)::int AS n FROM member_channel_messages WHERE message_id=$1 AND sticker_id=$2';expect((await e2eAuthPool.query(query,[h.messageId,sticker.id])).rows[0].n).toBe(1);
 }finally{try{await page.close();}finally{await cleanup(e2eAuthPool,ids);}}
});
