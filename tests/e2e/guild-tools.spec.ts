import {test,expect} from './fixtures.js';
import {randomUUID} from 'node:crypto';
import {createServer,type Server} from 'node:http';
import {DEMO_USERS,DEMO_PASSWORD,DEMO_COMMUNITY} from '../../packages/testing/seed.js';
import {readFile} from 'node:fs/promises';
let server:Server,originProof='';
test.beforeAll(async()=>{server=createServer(async(q,r)=>{const name=new URL(q.url!,'http://localhost').pathname.slice(1)||'index.html';if(name==='.well-known/freedom-guild-tool.txt'){r.setHeader('Content-Type','text/plain');r.end(originProof);return;}if(!['index.html','main.js','bridge.js','style.css'].includes(name)){r.writeHead(404);r.end();return;}r.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');r.end(await readFile('templates/guild-tool/'+name));});await new Promise<void>(resolve=>server.listen(46455,'127.0.0.1',resolve));});
test.afterAll(async({e2eAuthPool})=>{
 try{await new Promise<void>(resolve=>server.close(()=>resolve()));}
 finally{
  // Disabled records still own their routes; leave later native specs with no registered arcade.
  await e2eAuthPool.query('TRUNCATE guild_tools CASCADE');
 }
});
test('legacy /play hands game, recipe, practice and seed to the registered guild_games arcade',async({page,e2eAuthPool})=>{
 await page.route('https://guild-tool.example.test/**',async route=>{
  const response=await fetch('http://127.0.0.1:46455'+new URL(route.request().url()).pathname);
  await route.fulfill({status:response.status,contentType:response.headers.get('content-type')!,body:await response.text(),headers:{'access-control-allow-origin':'*'}});
 });
 await e2eAuthPool.query("INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state,member_tier) VALUES($1,$2,$3,'guild_games','active','full') ON CONFLICT(community_id,user_id,guild_key) DO UPDATE SET state='active'",[randomUUID(),DEMO_COMMUNITY,DEMO_USERS[0].user_id]);
 await e2eAuthPool.query("INSERT INTO positioning_guild_officers(community_id,guild_key,user_id) VALUES($1,'guild_games',$2) ON CONFLICT(community_id,guild_key) DO UPDATE SET user_id=$2",[DEMO_COMMUNITY,DEMO_USERS[0].user_id]);
 const {e2eOrigin}=await import('../../packages/testing/e2e-origin.js');const origin=e2eOrigin();
 const login=await page.request.post('/api/v1/auth/login',{headers:{Origin:origin},data:{email:DEMO_USERS[0].email,password:DEMO_PASSWORD}});
 expect(login.status()).toBe(200);const session=await login.json();
 const headers={Origin:origin,'X-CSRF-Token':session.csrf_token};
 const registered=await page.request.post('/api/v1/guilds/guild_games/tools',{headers:{...headers,'Idempotency-Key':randomUUID()},data:{tool_id:'arcade',title:'路由測試',entry_url:'https://guild-tool.example.test/',profile:'sandboxed',bridge_version:'freedom.guild-launchpad/v2',scopes:['context:read'],permissions:[]}});
 expect(registered.status(),await registered.text()).toBe(201);
 expect((await page.request.post('/api/v1/guilds/guild_games/tools/arcade/accept',{headers:{...headers,'Idempotency-Key':randomUUID(),'If-Match':'"1"'},data:{}})).status()).toBe(200);
 try{
  // Serve the in-repo conformance template, then observe the query inside the real frame.
  const query='game=kitchen&recipe=egg-fried-rice&practice=1&seed=42';
  await page.goto('/play?'+query);
  await expect(page).toHaveURL(origin+'/play?'+query+'#guilds/guild_games/tools/arcade');
  const frame=page.locator('iframe[title="路由測試"]');
  await expect(frame).toHaveAttribute('src','https://guild-tool.example.test/?'+query);
  await expect(page.frameLocator('iframe[title="路由測試"]').locator('#status')).toHaveText('公會：guild_games');
  const content=await (await frame.elementHandle())!.contentFrame();
  expect(await content!.evaluate(()=>Object.fromEntries(new URLSearchParams(location.search)))).toEqual({game:'kitchen',recipe:'egg-fried-rice',practice:'1',seed:'42'});
 }finally{
  expect((await page.request.post('/api/v1/guilds/guild_games/tools/arcade/disable',{headers:{...headers,'Idempotency-Key':randomUUID(),'If-Match':'"1"'},data:{}})).status()).toBe(200);
 }
});
test('master previews and registers an opaque tool, real bridge operations and hostile frame boundary',async({page,e2eAuthPool},testInfo)=>{
 await page.route('https://guild-tool.example.test/**',async route=>{const response=await fetch('http://127.0.0.1:46455'+new URL(route.request().url()).pathname);await route.fulfill({status:200,contentType:response.headers.get('content-type')!,body:await response.text(),headers:{'access-control-allow-origin':'*'}});});
 await e2eAuthPool.query("INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state,member_tier) VALUES($1,$2,$3,'guild_games','active','full') ON CONFLICT(community_id,user_id,guild_key) DO UPDATE SET state='active'",[randomUUID(),DEMO_COMMUNITY,DEMO_USERS[0].user_id]);
 await e2eAuthPool.query("INSERT INTO positioning_guild_officers(community_id,guild_key,user_id) VALUES($1,'guild_games',$2) ON CONFLICT(community_id,guild_key) DO UPDATE SET user_id=$2",[DEMO_COMMUNITY,DEMO_USERS[0].user_id]);
 await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill(DEMO_USERS[0].email);await page.getByLabel('密碼',{exact:true}).fill(DEMO_PASSWORD);await page.getByRole('button',{name:'登入',exact:true}).click();
 await expect(page.getByRole('button',{name:'分享或提交',exact:true})).toBeVisible();
 await page.goto('/#guilds/guild_games/tools');await page.getByRole('button',{name:'新增工具',exact:true}).click();await page.getByLabel('名稱',{exact:true}).fill('獨立工具');await page.getByLabel('網址',{exact:true}).fill('https://guild-tool.example.test/');await page.getByRole('button',{name:'預覽',exact:true}).click();
 await expect(page.getByRole('button',{name:'加入啟動台',exact:true})).toBeEnabled();
 const previewErrors:string[]=[];page.on('pageerror',error=>previewErrors.push(error.message));const preview=page.frames().find(f=>f.url().startsWith('https://guild-tool.example.test/'))!;
 expect(await preview.evaluate(`(async()=>{const cycle={};cycle.self=cycle;parent.postMessage(cycle,'*');const {tool}=await import('./main.js');return (await tool.request('context.get',{})).preview})()`)).toBe(true);expect(previewErrors).toEqual([]);
 await page.getByRole('button',{name:'加入啟動台',exact:true}).click();
 const f=page.frameLocator('iframe[title="獨立工具"]');await expect(f.locator('output')).toContainText('signed_in');
 const frame=await (await page.locator('iframe[title="獨立工具"]').elementHandle())!.contentFrame();
 expect(await frame!.evaluate(()=>{const blocked=(f:()=>unknown)=>{try{f();return false;}catch{return true;}};return [blocked(()=>parent.document),blocked(()=>document.cookie),blocked(()=>localStorage)];})).toEqual([true,true,true]);
 await f.getByLabel('筆記').fill('preserved');await f.getByRole('button',{name:'存檔',exact:true}).click();await expect(f.locator('output')).toContainText('saved');await f.getByRole('button',{name:'讀檔',exact:true}).click();await expect(f.locator('output')).toContainText('preserved');
 await f.getByRole('button',{name:'大小',exact:true}).click();await expect(page.locator('iframe[title="獨立工具"]')).toHaveAttribute('height','700');
 await f.getByRole('button',{name:'上傳',exact:true}).click();await expect(page.getByRole('region',{name:'遊戲上傳',exact:true})).toBeVisible();await page.getByRole('button',{name:'關閉上傳',exact:true}).click();
 await f.getByRole('button',{name:'分享',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'發布',exact:true}).click();await expect(f.locator('output')).toContainText('published');await expect(f.locator('output')).toContainText('share_id');
 const sdk=await page.request.get('/guild-tool/v2/client.js');expect(sdk.status()).toBe(200);expect(sdk.headers()['access-control-allow-origin']).toBe('*');expect(await sdk.text()).toContain('createGuildTool');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:testInfo.outputPath('tool-mobile.png'),fullPage:true});
 const before=page.url();await frame!.evaluate(()=>parent.postMessage({version:'freedom.guild-launchpad/v2',type:'request',operation:'navigate',payload:{action:'https://evil.example'},nonce:crypto.randomUUID(),tool_id:'forged',guild_key:'guild_ar',request_id:'evil'},'*'));expect(page.url()).toBe(before);
 await page.reload();await f.getByRole('button',{name:'讀檔',exact:true}).click();await expect(f.locator('output')).toContainText('preserved');
 await f.getByRole('button',{name:'返回',exact:true}).click();await expect(page).toHaveURL(/#guilds\/guild_games\/tools$/);await page.goto(before);await page.getByRole('button',{name:'停用工具',exact:true}).click();await expect(page.locator('iframe[title="獨立工具"]')).toHaveCount(0);await expect(page.getByText('工具已停用或等待會長確認。',{exact:true})).toBeVisible();
});
test('origin profile proves the root, preserves own storage and exchanges through exact-origin SDK',async({page,e2eAuthPool})=>{
 await page.route('https://guild-tool.example.test/**',async route=>{const response=await fetch('http://127.0.0.1:46455'+new URL(route.request().url()).pathname);await route.fulfill({status:response.status,contentType:response.headers.get('content-type')!,body:await response.text(),headers:{'access-control-allow-origin':'*'}});});
 await e2eAuthPool.query("INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state,member_tier) VALUES($1,$2,$3,'guild_games','active','full') ON CONFLICT(community_id,user_id,guild_key) DO UPDATE SET state='active'",[randomUUID(),DEMO_COMMUNITY,DEMO_USERS[0].user_id]);await e2eAuthPool.query("INSERT INTO positioning_guild_officers(community_id,guild_key,user_id) VALUES($1,'guild_games',$2) ON CONFLICT(community_id,guild_key) DO UPDATE SET user_id=$2",[DEMO_COMMUNITY,DEMO_USERS[0].user_id]);
 await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill(DEMO_USERS[0].email);await page.getByLabel('密碼',{exact:true}).fill(DEMO_PASSWORD);await page.getByRole('button',{name:'登入',exact:true}).click();await expect(page.getByRole('button',{name:'分享或提交',exact:true})).toBeVisible();
 await page.goto('/#guilds/guild_games/tools');await page.getByRole('button',{name:'新增工具',exact:true}).click();await page.getByLabel('名稱',{exact:true}).fill('來源工具');await page.getByLabel('網址',{exact:true}).fill('https://guild-tool.example.test/');await page.getByText('進階設定',{exact:true}).click();await page.getByLabel('隔離模式',{exact:true}).selectOption('origin');await page.getByLabel('工具身分',{exact:true}).check();
 const pending=page.waitForResponse(r=>r.url().endsWith('/tools/origin-challenges'));await page.getByRole('button',{name:'建立來源驗證',exact:true}).click();const challenge=await (await pending).json();originProof=challenge.contents;
 await page.getByRole('button',{name:'預覽',exact:true}).click();await expect(page.getByRole('button',{name:'加入啟動台',exact:true})).toBeEnabled();await page.getByRole('button',{name:'加入啟動台',exact:true}).click();const f=page.frameLocator('iframe[title="來源工具"]');await expect(f.locator('output')).toContainText('subject');
 const frame=await (await page.locator('iframe[title="來源工具"]').elementHandle())!.contentFrame();const result=await frame!.evaluate(async()=>{const path='/main.js';const {tool}=await import(path);const context=await tool.request('context.get');const exchanged=await tool.request('session.exchange');const c=JSON.parse(atob(exchanged.access_token.split('.')[1].replaceAll('-','+').replaceAll('_','/')));localStorage.setItem('own-origin','works');let parentBlocked=false;try{void parent.document;}catch{parentBlocked=true;}return {expires:exchanged.expires_in,purpose:c.purpose,sameSubject:context.subject===c.sub,privateFields:!!(c.email||c.name),ownStorage:localStorage.getItem('own-origin'),parentBlocked};});
 expect(result).toEqual({expires:600,purpose:'guild-tool-identity',sameSubject:true,privateFields:false,ownStorage:'works',parentBlocked:true});
 // Release the enabled fixture through the API-backed control, including CSP cache invalidation.
 await page.getByRole('button',{name:'停用工具',exact:true}).click();await expect(page.locator('iframe[title="來源工具"]')).toHaveCount(0);
});
test('guest share resumes after login, publication stays explicit, admin disables the tool',async({page,e2eAuthPool})=>{
 await page.route('https://guild-tool.example.test/**',async route=>{const response=await fetch('http://127.0.0.1:46455'+new URL(route.request().url()).pathname);await route.fulfill({status:response.status,contentType:response.headers.get('content-type')!,body:await response.text(),headers:{'access-control-allow-origin':'*'}});});
 await e2eAuthPool.query("INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state,member_tier) VALUES($1,$2,$3,'guild_games','active','full') ON CONFLICT(community_id,user_id,guild_key) DO UPDATE SET state='active'",[randomUUID(),DEMO_COMMUNITY,DEMO_USERS[0].user_id]);await e2eAuthPool.query("INSERT INTO positioning_guild_officers(community_id,guild_key,user_id) VALUES($1,'guild_games',$2) ON CONFLICT(community_id,guild_key) DO UPDATE SET user_id=$2",[DEMO_COMMUNITY,DEMO_USERS[0].user_id]);
 const {e2eOrigin}=await import('../../packages/testing/e2e-origin.js');const origin=e2eOrigin();const login=await page.request.post('/api/v1/auth/login',{headers:{Origin:origin},data:{email:DEMO_USERS[0].email,password:DEMO_PASSWORD}});expect(login.status()).toBe(200);const session=await login.json();const headers={Origin:origin,'X-CSRF-Token':session.csrf_token,'Idempotency-Key':randomUUID()};
 const response=await page.request.post('/api/v1/guilds/guild_games/tools',{headers,data:{tool_id:'guest-draft',title:'訪客工具',entry_url:'https://guild-tool.example.test/',profile:'sandboxed',bridge_version:'freedom.guild-launchpad/v2',scopes:['context:read','share:compose'],permissions:[]}});expect(response.status()).toBe(201);const record=await response.json();expect((await page.request.post('/api/v1/guilds/guild_games/tools/guest-draft/accept',{headers:{...headers,'Idempotency-Key':randomUUID(),'If-Match':'"1"'},data:{}})).status()).toBe(200);
 await page.context().clearCookies();await page.goto('/#guilds/guild_games/tools/guest-draft');const f=page.frameLocator('iframe[title="訪客工具"]');await expect(f.locator('output')).toContainText('signed_in');await f.getByLabel('筆記').fill('登入草稿');await f.getByRole('button',{name:'分享',exact:true}).click();await page.getByRole('link',{name:'登入後分享',exact:true}).click();
 await page.getByLabel('電子郵件',{exact:true}).fill(DEMO_USERS[0].email);await page.getByLabel('密碼',{exact:true}).fill(DEMO_PASSWORD);await page.getByRole('button',{name:'登入',exact:true}).click();await expect(page.getByRole('dialog',{name:'分享',exact:true})).toBeVisible();await expect(page.locator('dialog textarea')).toHaveValue('登入草稿');await expect(page).toHaveURL(/#guilds\/guild_games\/tools\/guest-draft$/);
 expect(Number((await e2eAuthPool.query('SELECT count(*) FROM guild_tool_share_sources WHERE tool=$1',[record.id])).rows[0].count)).toBe(0);await page.getByRole('button',{name:'發布',exact:true}).click();await expect(page.getByRole('dialog',{name:'分享',exact:true})).toHaveCount(0);expect(Number((await e2eAuthPool.query('SELECT count(*) FROM guild_tool_share_sources WHERE tool=$1',[record.id])).rows[0].count)).toBe(1);
 const {E2E_AUTHOR_CLAIM_ADMIN_TOKEN,E2E_AUTHOR_CLAIM_ADMIN_EMAIL}=await import('../../packages/testing/e2e-admin.js');
 await e2eAuthPool.query("INSERT INTO platform_admins(admin_id,community_id,email,display_name,role,active) VALUES($1,$2,$3,'工具管理測試','super_admin',true) ON CONFLICT(email) DO NOTHING",[randomUUID(),DEMO_COMMUNITY,E2E_AUTHOR_CLAIM_ADMIN_EMAIL]);
 await page.route('**/admin/api/**',route=>route.continue({headers:{...route.request().headers(),'Cf-Access-Jwt-Assertion':E2E_AUTHOR_CLAIM_ADMIN_TOKEN}}));await page.goto('/admin?view=guilds');await page.getByText('外部工具',{exact:true}).click();const row=page.locator('article').filter({hasText:'訪客工具'});await row.getByRole('button',{name:'停用工具',exact:true}).click();await row.getByLabel('停用原因',{exact:true}).fill('合成安全檢查');await row.getByRole('button',{name:'停用',exact:true}).click();await expect(row.getByText('已停用',{exact:true})).toBeVisible();
 expect(Number((await e2eAuthPool.query("SELECT count(*) FROM guild_tool_audit WHERE tool=$1 AND action='admin-disable'",[record.id])).rows[0].count)).toBe(1);

});
