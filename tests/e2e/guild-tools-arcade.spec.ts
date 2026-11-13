import {test,expect,type Page} from './fixtures.js';
import {createServer,type Server} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DEMO_USERS,DEMO_PASSWORD,DEMO_COMMUNITY} from '../../packages/testing/seed.js';
import {e2eOrigin} from '../../packages/testing/e2e-origin.js';
import {GAMES} from '../../apps/portal-web/src/games/domain.js';
import {RECIPES} from '../../apps/portal-web/src/games/cooking/catalog.js';
import {PARTY_GAMES} from '../../apps/portal-web/src/games/party/catalog.js';
const root=resolve(process.env.FREEDOM_ARCADE_DIST??'../guild-games-draft-20261112/dist');let server:Server;
const mime:Record<string,string>={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.jpg':'image/jpeg','.json':'application/json'};
test.beforeAll(async({e2eAuthPool,browser})=>{
 // CI must supply the independently built arcade, not a synthetic replacement page.
 await readFile(resolve(root,'index.html')).catch(()=>{throw new Error('Arcade build missing: set FREEDOM_ARCADE_DIST to the built standalone arcade directory.');});
 server=createServer(async(q,r)=>{try{const path=resolve(root,'.'+decodeURIComponent(new URL(q.url!,'http://localhost').pathname));if(path!==root&&!path.startsWith(root+'/'))throw Error();const body=await readFile(path===root||path===root+'/'?root+'/index.html':path);r.setHeader('Content-Type',mime[extname(path)]??'text/html');r.end(body);}catch{r.writeHead(404);r.end();}});await new Promise<void>(r=>server.listen(46455,'127.0.0.1',r));
 await e2eAuthPool.query("INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state,member_tier) VALUES($1,$2,$3,'guild_games','active','full') ON CONFLICT(community_id,user_id,guild_key) DO UPDATE SET state='active'",[randomUUID(),DEMO_COMMUNITY,DEMO_USERS[0].user_id]);
 await e2eAuthPool.query("INSERT INTO positioning_guild_officers(community_id,guild_key,user_id) VALUES($1,'guild_games',$2) ON CONFLICT(community_id,guild_key) DO UPDATE SET user_id=$2",[DEMO_COMMUNITY,DEMO_USERS[0].user_id]);
 const origin=e2eOrigin();const login=await fetch(origin+'/api/v1/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:DEMO_USERS[0].email,password:DEMO_PASSWORD})});expect(login.status).toBe(200);const session=await login.json();const headers={Origin:origin,Cookie:login.headers.get('set-cookie')!.split(';')[0],'X-CSRF-Token':session.csrf_token,'Content-Type':'application/json'};
 const registered=await fetch(origin+'/api/v1/guilds/guild_games/tools',{method:'POST',headers:{...headers,'Idempotency-Key':randomUUID()},body:JSON.stringify({tool_id:'arcade',title:'遊戲大廳',entry_url:'https://guild-tool.example.test/',bridge_version:'freedom.guild-launchpad/v2',profile:'sandboxed',scopes:['context:read','share:compose','device-state:own','ui:open','navigate','resize'],permissions:['downloads','fullscreen']})});expect(registered.status,await registered.clone().text()).toBe(201);
 const pending=await registered.json();const preview=await browser.newPage();try{
  await preview.route('https://guild-tool.example.test/**',async route=>{const response=await fetch('http://127.0.0.1:46455'+new URL(route.request().url()).pathname);await route.fulfill({status:response.status,contentType:response.headers.get('content-type')!,body:Buffer.from(await response.arrayBuffer()),headers:{'access-control-allow-origin':'*'}});});
  await preview.goto(origin+'/guild-tool-preview/'+pending.id);await expect(preview.frameLocator('iframe[title="工具預覽"]').locator('.fw-arcade-root')).toBeVisible();await expect(preview.frameLocator('iframe[title="工具預覽"]').locator('#status')).toHaveText('預覽 · 不保存進度');
 }finally{await preview.close();}
 const accepted=await fetch(origin+'/api/v1/guilds/guild_games/tools/arcade/accept',{method:'POST',headers:{...headers,'Idempotency-Key':randomUUID(),'If-Match':'"1"'},body:'{}'});expect(accepted.status).toBe(200);
});
test.afterAll(async({e2eAuthPool})=>{await new Promise<void>(r=>server?.close(()=>r()));await e2eAuthPool.query('TRUNCATE guild_tools CASCADE');});
test.beforeEach(async({page})=>{await page.route('https://guild-tool.example.test/**',async route=>{const response=await fetch('http://127.0.0.1:46455'+new URL(route.request().url()).pathname);await route.fulfill({status:response.status,contentType:response.headers.get('content-type')!,body:Buffer.from(await response.arrayBuffer()),headers:{'access-control-allow-origin':'*'}});});});
for(const game of [...GAMES,...PARTY_GAMES])test(`opaque arcade legacy link: ${game.id}`,async({page})=>{
 await page.goto('/play?game='+game.id+'&seed=42');const f=page.frameLocator('iframe[title="遊戲大廳"]');await expect(f.locator('[data-game-stage="ready"],[data-party-stage="ready"]')).toBeVisible();await expect(page.locator('iframe[title="遊戲大廳"]')).toHaveAttribute('src',/game=.*&seed=42/);
});
for(const recipe of RECIPES)test(`opaque arcade recipe: ${recipe.id}`,async({page})=>{
 await page.goto('/play?game=kitchen&recipe='+recipe.id+'&practice=1&seed=42');const f=page.frameLocator('iframe[title="遊戲大廳"]');await expect(f.locator('[data-cooking-state],[data-market-stage]')).toBeVisible();await expect(page.locator('iframe[title="遊戲大廳"]')).toHaveAttribute('src',new RegExp('recipe='+recipe.id+'&practice=1&seed=42'));
});
test('opaque arcade preserves five original saves, supports fullscreen, export and confirmed share',async({page,e2eAuthPool})=>{
 const {newCookingRun}=await import('../../apps/portal-web/src/games/cooking/domain.js');const {newMarket}=await import('../../apps/portal-web/src/games/cooking/market-domain.js');const now=Date.now();
 const book=JSON.stringify({version:1,savedAt:now,favorites:['egg-fried-rice'],best:{}});
 const values:Record<string,string>={'freedom.cooking.cookbook.v1':book,'freedom.cooking.cookbook.backup.v1':book,'freedom.cooking.run.v1':JSON.stringify({version:1,savedAt:now,run:newCookingRun(RECIPES[0],42,'legacy')}),'freedom.cooking.market.v1':JSON.stringify({savedAt:now,run:newMarket('egg-fried-rice',42)}),'freedom.absurd-daily.pending.v1':JSON.stringify({version:1,createdAt:now,game:'cash',seed:42,title:'舊成果',text:'保留',image:'data:image/jpeg;base64,AAAA'})};
 await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill(DEMO_USERS[0].email);await page.getByLabel('密碼',{exact:true}).fill(DEMO_PASSWORD);await page.getByRole('button',{name:'登入',exact:true}).click();await expect(page.getByRole('button',{name:'分享或提交',exact:true})).toBeVisible();
 await page.evaluate(values=>{for(const [key,value]of Object.entries(values))(key.includes('cookbook')?localStorage:sessionStorage).setItem(key,value);},values);
 await page.goto('/play?game=cash&seed=42');const f=page.frameLocator('iframe[title="遊戲大廳"]');await expect(f.locator('[data-game-stage="ready"]')).toBeVisible();
 const id=(await e2eAuthPool.query("SELECT id FROM guild_tools WHERE tool_id='arcade'")).rows[0].id;
 expect(await page.evaluate(({values,id,user})=>{const stored=JSON.parse(localStorage.getItem('freedom.tool.v2.'+id+':'+user)!);return Object.entries(values).every(([key,value])=>stored[key]===value&&(key.includes('cookbook')?localStorage:sessionStorage).getItem(key)===value);},{values,id,user:DEMO_USERS[0].user_id})).toBe(true);
 await f.getByRole('button',{name:'⛶ 全螢幕',exact:true}).click();expect(await f.locator('.fullscreen-game').evaluate(el=>document.fullscreenElement===el)).toBe(true);await f.getByRole('button',{name:'退出全螢幕',exact:true}).click();
 await f.getByRole('button',{name:'開始這一局',exact:true}).click();const {cashDeck}=await import('../../apps/portal-web/src/games/domain.js');
 for(const card of cashDeck(42)){await f.locator('[data-daily-game="cash"]').press(card.valid?'ArrowRight':'ArrowLeft');await page.waitForTimeout(180);}
 await expect(f.locator('[data-daily-result]')).toBeVisible();const download=f.getByRole('link',{name:'下載完整成果 PNG',exact:true});await expect(download).toBeVisible();const event=page.waitForEvent('download');await download.click();const file=await (await event).path();expect((await readFile(file!)).subarray(1,4).toString()).toBe('PNG');
 await f.getByRole('button',{name:'發到自由工坊',exact:true}).click();await expect(page.getByRole('dialog',{name:'分享',exact:true})).toBeVisible();await page.getByRole('button',{name:'發布',exact:true}).click();await expect(page.getByRole('dialog',{name:'分享',exact:true})).toHaveCount(0);
 expect(Number((await e2eAuthPool.query('SELECT count(*) FROM guild_tool_share_sources WHERE tool=$1',[id])).rows[0].count)).toBe(1);
});
for(const recipe of ['egg-fried-rice','steak-dinner','shawarma','corn-dog'])test(`opaque market mode: ${recipe}`,async({page})=>{await page.goto('/play?game=kitchen&recipe='+recipe+'&seed=42');await expect(page.frameLocator('iframe[title="遊戲大廳"]').locator('[data-market-stage]')).toBeVisible();});
test('opaque arcade completed dish starts the real inline worker',async({page})=>{
 const {newMarket,applyMarket}=await import('../../apps/portal-web/src/games/cooking/market-domain.js');let run=applyMarket(newMarket('egg-fried-rice',42),{kind:'start'}).run;run=applyMarket(run,{kind:'add',ingredient:'rice'}).run;run=applyMarket(run,{kind:'serve'}).run;
 await page.goto('/');await page.evaluate(run=>sessionStorage.setItem('freedom.cooking.market.v1',JSON.stringify({savedAt:Date.now(),run})),run);await page.goto('/play?game=kitchen&recipe=egg-fried-rice&seed=42');const f=page.frameLocator('iframe[title="遊戲大廳"]');await expect(f.locator('.fw-arcade-root')).toBeVisible();await expect(f.getByRole('button',{name:'分享成果',exact:true})).toBeEnabled();await expect(f.locator('[aria-label="遊戲成果"]')).toBeVisible();await expect(f.locator('[data-dish-view="ready"]')).toBeVisible();await f.getByRole('button',{name:'向左旋轉料理',exact:true}).click();await expect(f.locator('[data-dish-view="ready"] canvas')).toBeVisible();
});
test('canonical guild challenge route preserves practice and seed',async({page})=>{await page.goto('/#guilds/guild_games/tools/arcade?game=kitchen&recipe=egg-fried-rice&practice=1&seed=42');const frame=page.locator('iframe[title="遊戲大廳"]');await expect(frame).toHaveAttribute('src','https://guild-tool.example.test/?game=kitchen&recipe=egg-fried-rice&practice=1&seed=42');await expect(page.frameLocator('iframe[title="遊戲大廳"]').locator('[data-cooking-state]')).toBeVisible();});
