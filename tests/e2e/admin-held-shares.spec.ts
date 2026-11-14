import {test as base,expect} from './fixtures.js';
import {Pool} from 'pg';
import {serve} from '@hono/node-server';
import {serveStatic} from '@hono/node-server/serve-static';
import {randomBytes,randomUUID} from 'node:crypto';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_COMMUNITY,DEMO_USERS,DEMO_PASSWORD} from '../../packages/testing/seed.js';
import {createApp} from '../../apps/platform-api/src/app.js';
import {Problem} from '../../packages/shared/problem.js';

// Shares/credit are retained by design. Own every fixture row in a disposable schema,
// so finally cleanup also removes append-only facts without touching another spec's users.
const test=base.extend<{heldFixture:{origin:string;pool:Pool;adminHeaders:Record<string,string>;emails:string[]}}>({
 heldFixture:async({},use)=>{
  const url=process.env.TEST_DATABASE_URL;if(!url)throw Error('Explicit disposable TEST_DATABASE_URL required');
  const schema=`fp_held_browser_${randomUUID().replaceAll('-','')}`,root=new Pool({connectionString:url}),pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
  let server:ReturnType<typeof serve>|undefined;
  try{
   await root.query(`CREATE SCHEMA ${schema}`);await migrate(pool);await seedLocal(pool);
   const emails=[];
   for(let i=0;i<4;i++){
    const email=`held-browser-${i}@example.com`;emails.push(email);
    await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,active,onboarding_required,created_at)
     SELECT $1,community_id,$2,'合成檢舉會員',password_hash,$3,true,false,now()-interval '8 days' FROM users WHERE user_id=$4`,[randomUUID(),email,randomUUID(),DEMO_USERS[0].user_id]);
   }
   const email='held-browser-admin@example.com',credential=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
   await pool.query('INSERT INTO platform_admins(admin_id,community_id,email,display_name) VALUES($1,$2,$3,$4)',[randomUUID(),DEMO_COMMUNITY,email,'合成管理員']);
   let app:ReturnType<typeof createApp>|undefined;
   server=serve({hostname:'127.0.0.1',port:0,fetch:request=>app?app.fetch(request):new Response(null,{status:503})});
   if(!server.listening)await new Promise<void>(resolve=>server!.once('listening',resolve));
   const address=server.address();if(!address||typeof address==='string')throw Error('Missing owned listener');
   const origin=`http://127.0.0.1:${address.port}`;
   app=createApp(pool,origin,'local',{adminVerifier:async request=>{
    if(request.headers.get('X-Synthetic-Admin')!==credential)throw new Problem(401,'admin_identity_required','請先通過管理員驗證。');
    return {email,subject:'held-browser-admin',csrfToken:csrf};
   }});
   app.use('/*',serveStatic({root:'./apps/portal-web/dist'}));app.get('*',serveStatic({path:'./apps/portal-web/dist/index.html'}));
   await use({origin,pool,adminHeaders:{'X-Synthetic-Admin':credential},emails});
  }finally{
   if(server){if('closeAllConnections' in server)server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));}
   await pool.end();try{await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);}finally{await root.end();}
  }
 }
});

test('three eligible reports go to 檢舉處理; restore and confirm remove rows and move keyboard focus',async({page,browser,heldFixture},testInfo)=>{
 const {origin,pool,adminHeaders,emails}=heldFixture;
 const contexts:Awaited<ReturnType<typeof browser.newContext>>[]=[];
 try{
  const sessions:{context:Awaited<ReturnType<typeof browser.newContext>>;csrf:string}[]=[];
  for(const email of emails){
   const context=await browser.newContext({baseURL:origin});contexts.push(context);
   const login=await context.request.post('/api/v1/auth/login',{headers:{Origin:origin},data:{email,password:DEMO_PASSWORD}});
   expect(login.status()).toBe(200);sessions.push({context,csrf:(await login.json()).csrf_token});
  }
  const command=async(index:number,path:string,body:unknown)=>sessions[index].context.request.post(path,{headers:{Origin:origin,'X-CSRF-Token':sessions[index].csrf,'Idempotency-Key':randomUUID()},data:body});
  const events=[];
  for(const title of ['合成待恢復活動','合成待下架活動']){
   const created=await command(0,'/api/v1/events',{title,starts_at:'2099-01-01T10:00:00Z',location:'合成場地'});
   expect(created.ok()).toBe(true);const event=await created.json();events.push(event);
   for(let i=1;i<=3;i++)expect((await command(i,`/api/v1/shares/${event.share_id}/report`,{reason:`合成檢舉理由 ${i}`})).ok()).toBe(true);
   expect((await page.request.get(`${origin}/api/v1/public/events/${event.event_id}`)).status()).toBe(404);
  }
  await page.context().setExtraHTTPHeaders(adminHeaders);await page.goto(origin+'/admin?view=events');
  await expect(page.getByText('目前沒有待審核活動。',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'檢舉處理',exact:true}).click();
  const first=page.getByRole('article',{name:'合成待恢復活動',exact:true}),second=page.getByRole('article',{name:'合成待下架活動',exact:true});
  await expect(first.getByText('活動 · 3 則檢舉',{exact:true})).toBeVisible();
  await expect(first.getByRole('link',{name:'合成待恢復活動',exact:true})).toHaveAttribute('href',`/events/${events[0].event_id}`);
  for(let i=1;i<=3;i++)await expect(first.getByText(`合成檢舉理由 ${i}`,{exact:true})).toBeVisible();
  await expect(first.getByRole('button',{name:'恢復公開',exact:true})).toBeDisabled();
  await first.getByLabel('處理理由',{exact:true}).fill('兩字');await expect(first.getByRole('button',{name:'恢復公開',exact:true})).toBeDisabled();
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await page.screenshot({path:testInfo.outputPath(`held-shares-${width}.png`)});
  }
  await first.getByLabel('處理理由',{exact:true}).fill('內容符合規範');
  await first.getByRole('button',{name:'恢復公開',exact:true}).click();await expect(first).toHaveCount(0);
  await expect(second.getByRole('heading',{name:'合成待下架活動',exact:true})).toBeFocused();
  expect((await page.request.get(`${origin}/api/v1/public/events/${events[0].event_id}`)).status()).toBe(200);
  const publicPage=await contexts[0].newPage();await publicPage.goto(`${origin}/events/${events[0].event_id}`);
  await expect(publicPage.getByRole('heading',{name:'合成待恢復活動',exact:true})).toBeVisible();
  await second.getByLabel('處理理由',{exact:true}).fill('確認違反規範');await second.getByRole('button',{name:'確認下架',exact:true}).click();
  await expect(second).toHaveCount(0);await expect(page.getByRole('heading',{name:'檢舉處理',exact:true})).toBeFocused();
  await expect(page.getByText('目前沒有被檢舉暫停的內容。',{exact:true})).toBeVisible();
  expect((await page.request.get(`${origin}/api/v1/public/events/${events[1].event_id}`)).status()).toBe(404);
  expect((await pool.query('SELECT sum(units)::int n FROM share_credit_events WHERE share_id=$1',[events[1].share_id])).rows[0].n).toBe(0);
 }finally{for(const context of contexts)await context.close();}
});
