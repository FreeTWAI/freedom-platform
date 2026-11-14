import {test as base,expect} from './fixtures.js';
import {Pool} from 'pg';
import {serve} from '@hono/node-server';
import {serveStatic} from '@hono/node-server/serve-static';
import {randomBytes,randomUUID} from 'node:crypto';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_COMMUNITY,DEMO_USERS,DEMO_PASSWORD} from '../../packages/testing/seed.js';
import {createApp} from '../../apps/platform-api/src/app.js';

// Shares/credit are retained by design. Own every fixture row in a disposable schema,
// so finally cleanup also removes append-only facts without touching another spec's users.
const test=base.extend<{manageFixture:{origin:string;pool:Pool;emails:string[]}}>({
 manageFixture:async({},use)=>{
  const url=process.env.TEST_DATABASE_URL;if(!url)throw Error('Explicit disposable TEST_DATABASE_URL required');
  const schema=`fp_manage_browser_${randomUUID().replaceAll('-','')}`,root=new Pool({connectionString:url}),pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
  let server:ReturnType<typeof serve>|undefined;
  try{
   await root.query(`CREATE SCHEMA ${schema}`);await migrate(pool);await seedLocal(pool);
   const emails=[];
   for(let i=0;i<2;i++){
    const email=`manage-browser-${i}@example.com`;emails.push(email);
    await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,active,onboarding_required,created_at)
     SELECT $1,community_id,$2,'合成檢舉會員',password_hash,$3,true,false,now()-interval '8 days' FROM users WHERE user_id=$4`,[randomUUID(),email,randomUUID(),DEMO_USERS[0].user_id]);
   }
   let app:ReturnType<typeof createApp>|undefined;
   server=serve({hostname:'127.0.0.1',port:0,fetch:request=>app?app.fetch(request):new Response(null,{status:503})});
   if(!server.listening)await new Promise<void>(resolve=>server!.once('listening',resolve));
   const address=server.address();if(!address||typeof address==='string')throw Error('Missing owned listener');
   const origin=`http://127.0.0.1:${address.port}`;
   app=createApp(pool,origin,'local',{eventParticipationEnabled:true,notificationPreferencesEnabled:true,eventEmailSender:async()=>{}});
   app.use('/*',serveStatic({root:'./apps/portal-web/dist'}));app.get('*',serveStatic({path:'./apps/portal-web/dist/index.html'}));
   await use({origin,pool,emails});
  }finally{
   if(server){if('closeAllConnections' in server)server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));}
   await pool.end();try{await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);}finally{await root.end();}
  }
 }
});

test('organizer publishes, edits time and place, notifies a registrant, announces and cancels',async({page,browser,manageFixture},info)=>{
 const {origin,pool,emails}=manageFixture;
 const memberContext=await browser.newContext({baseURL:origin});
 try{
  await page.goto(origin);await page.getByLabel('電子郵件',{exact:true}).fill(emails[0]);await page.getByLabel('密碼',{exact:true}).fill(DEMO_PASSWORD);await page.getByRole('button',{name:'登入',exact:true}).click();await expect(page.getByRole('heading',{name:'動態',exact:true})).toBeVisible();
  await page.goto(origin+'/#explore/events');await page.getByRole('button',{name:'辦活動',exact:true}).click();
  const form=page.locator('form').filter({has:page.getByRole('heading',{name:'辦一場活動',exact:true})});
  await form.getByLabel('活動名稱',{exact:true}).fill('合成活動管理旅程');await form.getByLabel('開始時間',{exact:true}).fill('2099-03-01T10:00');await form.getByLabel('地點',{exact:true}).fill('原場地');await form.getByRole('button',{name:'發布',exact:true}).click();
  await expect(page.getByText('活動已發布。',{exact:true})).toBeVisible();
  const event=(await pool.query("SELECT event_id FROM community_events WHERE title='合成活動管理旅程'")).rows[0];
  await page.goto(`${origin}/#events/${event.event_id}`);await expect(page.getByRole('link',{name:'活動專頁',exact:true})).toHaveAttribute('href',`/events/${event.event_id}`);
  await page.goto(`${origin}/#events/${event.event_id}/attendees`);await expect(page).toHaveURL(new RegExp(`${event.event_id}/manage$`));
  const member=await memberContext.newPage();await member.goto('/');await member.getByLabel('電子郵件',{exact:true}).fill(emails[1]);await member.getByLabel('密碼',{exact:true}).fill(DEMO_PASSWORD);await member.getByRole('button',{name:'登入',exact:true}).click();await expect(member.getByRole('heading',{name:'動態',exact:true})).toBeVisible();
  await member.goto(`/events/${event.event_id}`);await member.getByRole('button',{name:'報名',exact:true}).click();await expect(member.getByText('已報名',{exact:true})).toBeVisible();
  await page.goto(`${origin}/events/${event.event_id}`);await page.getByRole('link',{name:'活動管理',exact:true}).click();await expect(page).toHaveURL(new RegExp(`/manage$`));
  const manage=page.getByRole('region',{name:'管理活動',exact:true});
  await expect(manage.getByRole('button',{name:'編輯活動',exact:true})).toBeVisible();
  for(const width of [1440,390]){await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`event-manage-${width}.png`)});}
  await manage.getByRole('button',{name:'編輯活動',exact:true}).click();await manage.getByLabel('開始時間',{exact:true}).fill('2099-03-02T10:00');await manage.getByLabel('結束時間',{exact:true}).fill('2099-03-02T11:00');await manage.getByLabel('實體地點',{exact:true}).fill('新場地');await manage.getByRole('button',{name:'儲存修改',exact:true}).click();await expect(manage.getByText('活動已更新。',{exact:true})).toBeVisible();
  await member.goto('/#home');await member.getByRole('button',{name:/通知/}).first().click();await member.getByRole('button',{name:'查看所有通知',exact:true}).click();await expect(member.getByRole('list',{name:'通知',exact:true})).toContainText('新場地');
  await manage.getByText('更多',{exact:true}).click();await manage.getByRole('button',{name:'通知參加者',exact:true}).click();await manage.getByLabel('通知內容',{exact:true}).fill('請帶水與筆記。https://example.com/extra');await manage.getByRole('button',{name:'送出通知',exact:true}).click();await expect(manage.getByRole('status').filter({hasText:'通知已記錄'})).toBeVisible();await manage.getByRole('button',{name:'返回',exact:true}).click();
  await manage.getByText('更多',{exact:true}).click();await manage.getByRole('button',{name:'取消活動',exact:true}).click();await manage.getByRole('button',{name:'確認取消活動',exact:true}).click();await expect(manage).toContainText('已取消');
  const notices=(await pool.query('SELECT kind,body FROM member_notifications WHERE action_resource_id=$1 ORDER BY created_at',[event.event_id])).rows;
  expect(notices.map(row=>row.kind)).toEqual(['event_schedule_changed','event_announcement','event_cancelled']);expect(JSON.stringify(notices)).not.toContain(emails[1]);
  await member.goto(`/events/${event.event_id}`);await expect(member.getByText('活動已取消',{exact:true})).toBeVisible();
 }finally{await memberContext.close();}
});
