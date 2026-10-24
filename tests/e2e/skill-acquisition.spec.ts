import {randomUUID} from 'node:crypto';
import {test as base,expect,type Page} from './fixtures.js';
import {serve} from '@hono/node-server';
import {serveStatic} from '@hono/node-server/serve-static';
import type {Pool} from 'pg';
import {createApp} from '../../apps/platform-api/src/app.js';
import {createLocalGuideCatalog} from '../../packages/public-guide-assets/node.js';
import {DEMO_COMMUNITY,DEMO_USERS} from '../../packages/testing/seed.js';
import {TENANT_CURSOR_TEST_KEY} from '../runtime/tenant-cursor-fixture.js';
import {setupCartFixtureStore} from './storefront-cart-fixture.js';

// Per-test real discovery host: runs in the ordinary pinned default pass too.
const test=base.extend<{discoveryOn:boolean}>({
  discoveryOn:[false,{option:true}],
  baseURL:async({baseURL,e2eAuthPool,discoveryOn},use)=>{
    if(!discoveryOn){await use(baseURL);return;}
    let app:ReturnType<typeof createApp>|undefined;
    const server=serve({hostname:'127.0.0.1',port:0,fetch:request=>app?app.fetch(request):new Response(null,{status:503})});
    try{
      if(!server.listening)await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
      const address=server.address();if(!address||typeof address==='string')throw Error('Discovery listener unavailable');
      const origin=`http://127.0.0.1:${address.port}`;
      app=createApp(e2eAuthPool,origin,'local',{communityDiscoveryEnabled:true,registrationCommunityId:DEMO_COMMUNITY,
        publicGuideAssets:await createLocalGuideCatalog('local'),tenantCursorSigningKey:TENANT_CURSOR_TEST_KEY});
      app.use('/*',serveStatic({root:'./apps/portal-web/dist'}));
      app.get('*',serveStatic({path:'./apps/portal-web/dist/index.html'}));
      await use(origin);
    }finally{
      if('closeAllConnections' in server)server.closeAllConnections();
      await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    }
  },
});

const path='/development/skills/social-post';
const account=(register=true)=>`/?${register?'join=1&':''}skill_acquisition=1&return_to=${encodeURIComponent(path)}&skill_intro=7`;
const panel=(page:Page)=>page.getByRole('region',{name:'這本直接看，更多資源一起探索',exact:true});
async function siteWithoutDiscovery(page:Page,registration=true){
  await page.route('**/api/v1/site',async route=>{const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),registration_enabled:registration,community_discovery_enabled:false}});});
}
async function signIn(page:Page){
  await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');
  await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  await page.locator('.login-card form').getByRole('button',{name:'登入',exact:true}).click();
}

test('external readers can read and reach signup without running JavaScript',async({browser,baseURL})=>{
  const context=await browser.newContext({baseURL,javaScriptEnabled:false,viewport:{width:320,height:844}});
  try{
    const page=await context.newPage();await page.goto(path+'?intro=7');
    await expect(page.getByRole('heading',{name:'Hao 社群貼文技能書',exact:true})).toBeVisible();
    await expect(page.getByRole('heading',{name:'用途與適用範圍',exact:true})).toBeVisible();
    await expect(panel(page).getByRole('link',{name:'免費加入，探索更多資源',exact:true})).toHaveAttribute('href',account());
    await expect(page.getByRole('link',{name:'到 GitHub 看原始碼 ↗',exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const box=await panel(page).getByRole('link',{name:'免費加入，探索更多資源',exact:true}).boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);
  }finally{await context.close();}
});

test('join opens the registration form even when general discovery is off, with a reading exit',async({page})=>{
  await siteWithoutDiscovery(page);await page.goto(path+'?intro=7');
  await panel(page).getByRole('link',{name:'免費加入，探索更多資源',exact:true}).click();
  await expect(page.getByRole('heading',{name:'加入自由工坊',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'返回技能書繼續閱讀',exact:true})).toHaveAttribute('href',path+'?intro=7#skill-use-title');
  await page.getByRole('link',{name:'返回技能書繼續閱讀',exact:true}).click();
  await expect(page).toHaveURL(new RegExp('/development/skills/social-post\\?intro=7#skill-use-title$'));
  // The return navigation starts a site read; finish its handler before context teardown.
  await page.unrouteAll({behavior:'wait'});
});

test('successful registration returns to the same public book without forcing guild selection',async({page})=>{
  await siteWithoutDiscovery(page);await page.goto(account());
  await expect(page.getByRole('heading',{name:'加入自由工坊',exact:true})).toBeVisible();
  await page.getByLabel('電子郵件',{exact:true}).fill(`skill-${randomUUID()}@local.test`);
  await page.getByLabel('密碼',{exact:true}).fill('synthetic-skill-reader-password');
  await page.locator('.login-card form button[type="submit"]').click();
  await expect(page).toHaveURL(new RegExp('/development/skills/social-post\\?intro=7#skill-use-title$'));
  await expect(panel(page).getByRole('link',{name:'前往技能書架',exact:true})).toBeVisible();
  await expect(panel(page).getByRole('link',{name:'免費加入，探索更多資源',exact:true})).toBeHidden();
});

test('existing-account login retains the book and introduction too',async({page})=>{
  await siteWithoutDiscovery(page);await page.goto(account(false));await signIn(page);
  await expect(page).toHaveURL(new RegExp('/development/skills/social-post\\?intro=7#skill-use-title$'));
  await expect(panel(page).getByRole('link',{name:'前往技能書架',exact:true})).toHaveAttribute('href','/#skills');
});

test('an already authenticated reader can follow an old account link without landing on the home page',async({page})=>{
  await siteWithoutDiscovery(page);await page.goto('/');await signIn(page);
  await expect(page.getByRole('heading',{name:'會員首頁',exact:true})).toBeVisible();
  await page.goto(account());await expect(page).toHaveURL(new RegExp('/development/skills/social-post\\?intro=7#skill-use-title$'));
});

test('closed registration leaves public reading and existing-account login available',async({page})=>{
  await siteWithoutDiscovery(page,false);await page.goto(path);
  await expect(panel(page).getByText(/目前暫停新帳號註冊/)).toBeVisible();
  await expect(panel(page).getByRole('link',{name:'免費加入，探索更多資源',exact:true})).toBeHidden();
  await expect(panel(page).getByRole('link',{name:'已有帳號，登入',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'用途與適用範圍',exact:true})).toBeVisible();
});

test('unavailable original content does not turn successful login into a repeat registration',async({page})=>{
  await siteWithoutDiscovery(page);await page.goto(account(false));
  let reads=0;await page.route(url=>url.pathname===path,route=>{reads++;return route.fulfill({status:404,body:'not published'});});
  await signIn(page);await expect(page.getByText('登入成功。原本的技能書目前無法確認或已停止公開，你仍可繼續探索工坊。',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'會員首頁',exact:true})).toBeVisible();expect(reads).toBe(1);
});

test('a broken enhancement script never hides the reading content or plain account links',async({page})=>{
  await page.route('**/skill-acquisition.js',route=>route.abort());await page.goto(path+'?intro=7');
  await expect(page.getByRole('heading',{name:'用途與適用範圍',exact:true})).toBeVisible();
  await expect(panel(page).getByRole('link',{name:'免費加入，探索更多資源',exact:true})).toHaveAttribute('href',account());
  await panel(page).getByRole('link',{name:'繼續閱讀這本技能書',exact:true}).click();
  await expect(page).toHaveURL(new RegExp('#skill-use-title$'));
});

async function signUp(page:Page){
  await page.getByLabel('電子郵件',{exact:true}).fill(`skill-${randomUUID()}@local.test`);
  await page.getByLabel('密碼',{exact:true}).fill('synthetic-skill-reader-password');
  const registered=page.waitForResponse(response=>response.url().endsWith('/api/v1/auth/register')&&response.request().method()==='POST');
  await page.locator('.login-card form button[type="submit"]').click();
  expect((await registered).status()).toBe(201);
}
async function publishedSubmission(db:Pool){
  const id=randomUUID(),project=randomUUID(),version=randomUUID(),digest='e'.repeat(64);
  await db.query(`INSERT INTO oss_projects(project_id,community_id,owner_ref,title,description,use_notes,repository_id,repository_full_name,repository_url,relationship)
    VALUES($1,$2,$3,'回流驗證技能','公開用法介紹','先閱讀 README','964001','example/acquisition-return','https://github.com/example/acquisition-return','curator')`,[project,DEMO_COMMUNITY,DEMO_USERS[0].user_id]);
  await db.query(`INSERT INTO oss_project_versions(version_id,project_id,repository_id,commit_sha,default_branch,repository_full_name,repository_url,readme_url,license_spdx,is_fork,archived,source_snapshot,source_sha256,facts_sha256,inspected_at)
    VALUES($1,$2,'964001',$3,'main','example/acquisition-return','https://github.com/example/acquisition-return','https://github.com/example/acquisition-return#readme','MIT',false,false,'{}',$4,$4,now())`,[version,project,'a'.repeat(40),digest]);
  await db.query('UPDATE oss_projects SET current_version_id=$2 WHERE project_id=$1',[project,version]);
  await db.query(`INSERT INTO skill_submissions(submission_id,community_id,owner_ref,status,payload,payload_sha256,consent_to_share,project_id,project_version_id,published_at,grant_consumed_at)
    VALUES($1,$2,$3,'published',$4,$5,true,$6,$7,now(),now())`,[id,DEMO_COMMUNITY,DEMO_USERS[0].user_id,JSON.stringify({title:'回流驗證技能',description:'公開用法介紹',relationship:'curator',share_introductions:['回流驗證介紹'],use_notes:'先閱讀 README'}),digest,project,version]);
  return {path:`/development/submissions/${id}`,withdraw:()=>db.query('UPDATE oss_projects SET sharing_withdrawn_at=now() WHERE project_id=$1',[project]),close:async()=>{
    await db.query('DELETE FROM skill_submissions WHERE submission_id=$1',[id]);
    await db.query('UPDATE oss_projects SET current_version_id=NULL WHERE project_id=$1',[project]);
    await db.query('DELETE FROM oss_project_versions WHERE project_id=$1',[project]);
    await db.query('DELETE FROM oss_projects WHERE project_id=$1',[project]);
  }};
}

test.describe('discovery ON Star entries',()=>{
  test.use({discoveryOn:true});
  for(const authenticated of [false,true])test(`Star preserves the member destination for ${authenticated?'an authenticated':'an anonymous'} reader`,async({page})=>{
    expect((await (await page.request.get('/api/v1/site')).json()).community_discovery_enabled).toBe(true);
    if(authenticated){await page.goto('/');await signIn(page);await expect(page.getByRole('heading',{name:'會員首頁',exact:true})).toBeVisible();}
    await page.goto(path);
    const star=page.getByRole('link',{name:'登入工坊 Star',exact:true});
    await expect(star).toHaveAttribute('href','/?return_to='+encodeURIComponent(path));
    let validations=0;await page.route(url=>url.pathname===path,route=>{validations++;return route.continue();});
    await star.click();if(!authenticated)await signIn(page);
    await expect(page.getByRole('heading',{name:'會員首頁',exact:true})).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');expect(validations).toBe(0);
  });
});

test('published submission signup returns to the real published page and selected introduction',async({page,e2eAuthPool})=>{
  const skill=await publishedSubmission(e2eAuthPool);
  try{
    await siteWithoutDiscovery(page);await page.goto(skill.path+'?intro=1');
    await panel(page).getByRole('link',{name:'免費加入，探索更多資源',exact:true}).click();
    await signUp(page);await expect(page).toHaveURL(new URL(skill.path+'?intro=1#skill-use-title',page.url()).href);
    await expect(page.getByRole('heading',{name:'回流驗證技能',exact:true})).toBeVisible();
    await expect(panel(page).getByRole('link',{name:'前往技能書架',exact:true})).toBeVisible();
  }finally{await skill.close();}
});

for(const unavailable of ['withdrawn','timeout'] as const)test(`successful signup reaches the safe member fallback when the book is ${unavailable}`,async({page,e2eAuthPool})=>{
  const skill=await publishedSubmission(e2eAuthPool);let release=()=>{};
  try{
    await siteWithoutDiscovery(page);await page.goto(skill.path);
    await panel(page).getByRole('link',{name:'免費加入，探索更多資源',exact:true}).click();
    let validations=0;
    if(unavailable==='withdrawn'){
      // The server creates the account first, then the publication is really withdrawn.
      await page.route('**/api/v1/auth/register',async route=>{
        const response=await route.fetch();expect(response.status()).toBe(201);await skill.withdraw();await route.fulfill({response});
      });
      await page.route(url=>url.pathname===skill.path,async route=>{
        validations++;const response=await route.fetch();expect(response.status()).toBe(404);await route.fulfill({response});
      });
    }else{
      // Hold a real browser fetch; product's unchanged eight-second deadline must finish signup.
      const gate=new Promise<void>(resolve=>{release=resolve;});
      await page.route(url=>url.pathname===skill.path,async route=>{
        validations++;await gate;await route.abort().catch(()=>{});
      });
    }
    await signUp(page);
    await expect(page.getByText('登入成功。原本的技能書目前無法確認或已停止公開，你仍可繼續探索工坊。',{exact:true})).toBeVisible({timeout:15_000});
    // New accounts retain main's welcome / guild onboarding boundary on fallback.
    await expect(page.getByRole('region',{name:'快速加入公會',exact:true})).toBeVisible();
    await expect(page.locator('.login-card')).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/');expect(validations).toBe(1);
    expect((await page.request.get('/api/v1/session')).status()).toBe(200);
  }finally{release();await page.unrouteAll({behavior:'wait'});await skill.close();}
});

test('closed registration blocks a direct acquisition signup URL in the actual form',async({page})=>{
  await siteWithoutDiscovery(page,false);await page.goto(account());
  await expect(page.locator('.login-card form button[type="submit"]')).toBeVisible();
  await expect(page.getByRole('button',{name:'建立帳號，先逛工坊',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'建立帳號',exact:true})).toHaveCount(0);
  await expect(page.locator('.login-card form button[type="submit"]')).toHaveText('登入');
});

test('checkout return_to still returns an authenticated buyer to the checkout',async({browser,e2eAuthPool})=>{
  const store=await setupCartFixtureStore(e2eAuthPool,browser,true,true);
  const context=await browser.newContext({baseURL:store.origin});
  try{
    const page=await context.newPage(),destination=`/shops/${store.slug}/checkout`;
    await page.goto('/?return_to='+encodeURIComponent(destination));await signIn(page);
    await expect(page).toHaveURL(store.origin+destination);
    await expect(page.getByRole('heading',{name:'結帳',exact:true})).toBeVisible();
  }finally{await context.close();await store.close();}
});

test.describe('discovery ON event return',()=>{
  test.use({discoveryOn:true});
  test('event return_to still returns registration to the open event',async({page,e2eAuthPool})=>{
    const id=randomUUID(),destination=`/events/${id}`,title='回流驗證公開活動';
    await e2eAuthPool.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,state,visibility,event_kind)
      VALUES($1,$2,$3,$4,'合成公開活動',now()+interval '2 days',now()+interval '2 days 1 hour','online','線上','published','open','other')`,[id,DEMO_COMMUNITY,DEMO_USERS[0].user_id,title]);
    try{
      await page.goto('/?join=1&return_to='+encodeURIComponent(destination));await signUp(page);
      await expect(page).toHaveURL(new URL(destination,page.url()).href);
      await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
    }finally{await e2eAuthPool.query('DELETE FROM community_events WHERE event_id=$1',[id]);}
  });
});

for(const pending of ['auth','content'] as const)for(const direction of ['Back','Forward'] as const)test(`${direction} to a newer entry during pending ${pending} never applies the captured skill return`,async({page})=>{
  await siteWithoutDiscovery(page);await page.goto(account(false));
  await expect(page.locator('.login-card form button[type="submit"]')).toBeVisible();
  await page.evaluate(({entry,direction})=>{
    history.replaceState(null,'','/?entry=older');history.pushState(null,'',entry);
    if(direction==='Forward')history.pushState(null,'','/?entry=newer');
  },{entry:account(false),direction});
  if(direction==='Forward')await page.goBack();
  let release!:()=>void,entered!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;});
  let validations=0;
  await page.route(url=>url.pathname===path,async route=>{
    validations++;if(pending==='content'){entered();await gate;}await route.continue();
  });
  if(pending==='auth')await page.route('**/api/v1/auth/login',async route=>{
    const response=await route.fetch();expect(response.status()).toBe(200);entered();await gate;await route.fulfill({response});
  });
  await signIn(page);await ready;
  if(direction==='Back')await page.goBack();else await page.goForward();
  const current=new URL(direction==='Back'?'/?entry=older':'/?entry=newer',page.url()).href;
  await expect(page).toHaveURL(current);release();
  await expect(page.getByRole('heading',{name:'會員首頁',exact:true})).toBeVisible();
  await expect(page).toHaveURL(current);expect(validations).toBe(pending==='auth'?0:1);
});


test('registration disabled on the server hides signup and rejects a direct registration POST',async({page,e2eAuthPool})=>{
  const canonical='https://closed-registration.example.test',email=`closed-${randomUUID()}@local.test`;
  const app=createApp(e2eAuthPool,canonical,'staging',{registrationCommunityId:''});
  app.use('/*',serveStatic({root:'./apps/portal-web/dist'}));
  app.get('*',serveStatic({path:'./apps/portal-web/dist/index.html'}));
  const server=serve({hostname:'127.0.0.1',port:0,fetch:request=>app.fetch(request)});
  try{
    if(!server.listening)await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
    const address=server.address();if(!address||typeof address==='string')throw Error('Closed registration listener unavailable');
    const origin=`http://127.0.0.1:${address.port}`;
    const site=await page.request.get(origin+'/api/v1/site');expect(site.status()).toBe(200);expect((await site.json()).registration_enabled).toBe(false);
    await page.goto(origin+path);
    await expect(panel(page).getByText(/目前暫停新帳號註冊/)).toBeVisible();
    await expect(panel(page).getByRole('link',{name:'免費加入，探索更多資源',exact:true})).toBeHidden();
    await page.goto(origin+account());
    await expect(page.locator('.login-card form button[type="submit"]')).toHaveText('登入');
    const response=await page.request.post(origin+'/api/v1/auth/register',{headers:{Origin:canonical},data:{email,password:'synthetic-skill-reader-password',nickname:''}});
    expect(response.status()).toBe(503);expect((await response.json()).code).toBe('registration_unavailable');
    expect((await e2eAuthPool.query('SELECT 1 FROM users WHERE email=$1',[email])).rowCount).toBe(0);
  }finally{
    if('closeAllConnections' in server)server.closeAllConnections();
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
});
