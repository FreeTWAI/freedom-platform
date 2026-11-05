import {randomUUID} from 'node:crypto';
import {test,expect,type APIResponse,type Page,type Route} from './fixtures.js';
import {DEMO_COMMUNITY,DEMO_PASSWORD,DEMO_USERS} from '../../packages/testing/seed.js';

// Real app/API/SQL journey with two disposable member-owned notifications.
// Only delivery of the real read ACK is held or lost; this is controlled HTTP
// ordering, not a claim about native network races or PWA suspension.
async function login(page:Page,email:string){
  await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill(email);
  await page.getByLabel('密碼',{exact:true}).fill(DEMO_PASSWORD);
  await page.getByRole('button',{name:'登入',exact:true}).click();
  await expect(page.getByRole('heading',{name:'會員首頁',exact:true})).toBeVisible();
}
const frameBarrier=(page:Page)=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));

for(const width of [390,1440])for(const recovery of [false,true])test(`preview rows stay unavailable during ${recovery?'unknown-read retry':'read acknowledgement'} at ${width}px`,async({page,e2eAuthPool},info)=>{
  const user=randomUUID(),a=randomUUID(),b=randomUUID(),email=`notice-busy-${user}@example.test`;
  const ids:string[]=[a,b];
  const titleA=`忙碌通知 A ${a.slice(0,8)}`,titleB=`忙碌通知 B ${b.slice(0,8)}`;
  const pending:Array<{route:Route;response:APIResponse}>=[],writes:Array<{id:string;key:string}>=[];
  let hold=true;
  try{
    await e2eAuthPool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,onboarding_required)
      SELECT $1,$2,$3,'通知忙碌測試',password_hash,$4,false FROM users WHERE user_id=$5`,[user,DEMO_COMMUNITY,email,randomUUID(),DEMO_USERS[0].user_id]);
    await e2eAuthPool.query("INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state) VALUES($1,$2,$3,'guild_ai_vibe','active')",[randomUUID(),DEMO_COMMUNITY,user]);
    for(const [id,title,tab] of [[a,titleA,'guilds'],[b,titleB,'squads']])await e2eAuthPool.query(`INSERT INTO member_notifications(notification_id,community_id,recipient_ref,kind,source_key,title,body,action_tab)
      VALUES($1,$2,$3,'guild_expert_appointed',$4,$5,'隔離測試通知',$6)`,[id,DEMO_COMMUNITY,user,`busy-preview/${id}`,title,tab]);
    await page.route(/\/api\/v1\/me\/notifications\/[^/]+\/read$/,async route=>{
      const request=route.request(),id=new URL(request.url()).pathname.split('/').at(-2)!;
      if(request.method()!=='POST'||!ids.includes(id))return route.continue();
      writes.push({id,key:request.headers()['idempotency-key']});
      if(id!==a||!hold)return route.continue();
      const response=await route.fetch();expect(response.status()).toBe(200);pending.push({route,response});
    });
    await page.setViewportSize({width,height:900});await login(page,email);
    const bell=page.locator('.notification-bell-trigger'),panel=page.getByRole('region',{name:'最近通知'});
    await expect(bell).toHaveAccessibleName('通知，2 則未讀');await bell.click();
    const rowA=panel.locator('.notification-bell-item').filter({hasText:titleA}),rowB=panel.locator('.notification-bell-item').filter({hasText:titleB});
    await expect(rowA).toBeEnabled();await expect(rowB).toBeEnabled();expect(writes).toEqual([]);
    await rowA.click();await expect.poll(()=>pending.length).toBe(1);
    await expect(rowA).toBeDisabled();await expect(rowA.locator('small')).toContainText('標記中…');
    await expect(rowB).toBeDisabled();await expect(rowB.locator('small')).toContainText('未讀');
    await expect(panel.getByRole('button',{name:'全部標為已讀',exact:true})).toBeDisabled();
    await frameBarrier(page);expect(writes.map(item=>item.id)).toEqual([a]);await expect(page).not.toHaveURL(/#squads$/);
    const firstRead=(await e2eAuthPool.query('SELECT notification_id,read_at FROM member_notifications WHERE notification_id=ANY($1::uuid[]) ORDER BY notification_id',[ids])).rows;
    expect(firstRead.find(row=>row.notification_id===a).read_at).not.toBeNull();expect(firstRead.find(row=>row.notification_id===b).read_at).toBeNull();
    const originalTime=firstRead.find(row=>row.notification_id===a).read_at.toISOString();
    if(recovery){
      await pending.shift()!.route.abort();await expect(page).toHaveURL(/#guilds$/);
      const alert=page.locator('.notification-bell-read-error');await expect(alert).toContainText('尚未確認這則通知已讀');
      // Retry before reopening: it retains the original command even though SQL
      // committed. Opening then supplies fresh proof without ending its transport.
      await alert.getByRole('button',{name:'再試一次',exact:true}).click();await expect.poll(()=>pending.length).toBe(1);
      expect(writes.map(item=>item.id)).toEqual([a,a]);expect(writes[1].key).toBe(writes[0].key);
      await bell.click();await expect(rowA).toBeDisabled();await expect(rowB).toBeDisabled();
      await expect(alert).toHaveCount(0);await expect(bell).toHaveAccessibleName('通知，1 則未讀');
      await expect(rowA.locator('small')).toContainText('標記中…');await frameBarrier(page);await expect(page).toHaveURL(/#guilds$/);
      const held=pending.shift()!;await held.route.fulfill({response:held.response});
    }else{
      const held=pending.shift()!;await held.route.fulfill({response:held.response});
      await expect(page).toHaveURL(/#guilds$/);await expect(panel).toBeHidden();
      await expect(bell).toHaveAccessibleName('通知，1 則未讀');await bell.click();
    }
    await expect(rowB).toBeEnabled();await expect(rowB).toHaveClass(/is-unread/);
    await frameBarrier(page);expect(writes.map(item=>item.id)).toEqual(recovery?[a,a]:[a]);await expect(page).toHaveURL(/#guilds$/);
    // A new, explicit B activation is required; no queued or automatic B write.
    hold=false;await rowB.click();await expect(page).toHaveURL(/#squads$/);await expect(panel).toBeHidden();await expect(bell).toHaveAccessibleName('通知');
    expect(writes.map(item=>item.id)).toEqual(recovery?[a,a,b]:[a,b]);expect(writes.at(-1)!.key).not.toBe(writes[0].key);
    const final=(await e2eAuthPool.query('SELECT notification_id,read_at FROM member_notifications WHERE notification_id=ANY($1::uuid[])',[ids])).rows;
    expect(final.find(row=>row.notification_id===a).read_at.toISOString()).toBe(originalTime);expect(final.find(row=>row.notification_id===b).read_at).not.toBeNull();
    expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM command_receipts WHERE user_id=$1 AND idempotency_key=$2',[user,writes[0].key])).rows[0].n).toBe(1);
    await info.attach('notification-preview-busy',{body:JSON.stringify({width,recovery,controlled_real_ack:true,posted_ids:writes.map(item=>item.id),same_retry_key:recovery?writes[0].key===writes[1].key:undefined}),contentType:'application/json'});
  }finally{
    hold=false;for(const item of pending)await item.route.abort().catch(()=>{});
    try{await page.close();}finally{
    const q=await e2eAuthPool.connect();
    try{
      await q.query('BEGIN');
      for(const table of ['member_channel_reads','positioning_profession_memberships','sessions','member_client_errors','command_receipts'])await q.query(`DELETE FROM ${table} WHERE user_id=$1`,[user]);
      await q.query('DELETE FROM member_notifications WHERE recipient_ref=$1',[user]);
      await q.query('DELETE FROM outbox WHERE transition_id IN (SELECT transition_id FROM transition_journal WHERE actor_ref=$1)',[user]);
      await q.query('DELETE FROM transition_journal WHERE actor_ref=$1',[user]);
      await q.query('DELETE FROM users WHERE user_id=$1',[user]);await q.query('COMMIT');
    }catch(error){await q.query('ROLLBACK');throw error;}finally{q.release();}
    }
  }
});
