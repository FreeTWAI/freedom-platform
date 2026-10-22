import sharp from 'sharp';
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {expect,type Page,type Locator} from './fixtures.js';
import {DEMO_COMMUNITY,DEMO_PASSWORD} from '../../packages/testing/seed.js';
import {hashPassword} from '../../modules/identity-membership/service.js';
import {CreateResultSchema} from '../../contracts/guild-launchpad/v1/tenant.js';
import {InstallationViewSchema,LaunchPlanSchema,RegistryOperationSchema} from '../../contracts/guild-launchpad/v1/module-registry.js';
const commerce='guild_commerce_sales',production='guild_commercial_production';
const storePage=(page:Page)=>page.locator('.hosted-store');
export async function storeArea(page:Page,area:'商品'|'供貨合作'|'店面與發布'|'商店資料'){
  await page.getByRole('navigation',{name:'商店工作區',exact:true}).getByRole('button',{name:area,exact:true}).click();
}
export async function person(db: Pool) {
  const id = randomUUID(), email = `store-${id}@example.test`;
  await db.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,onboarding_required)
    VALUES($1,$2,$3,'商店測試會員',$4,$5,false)`, [id, DEMO_COMMUNITY, email, hashPassword(DEMO_PASSWORD), randomUUID()]);
  for (const key of [commerce, production]) await db.query(`INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state,member_tier)
    VALUES($1,$2,$3,$4,'active','full')`, [randomUUID(), DEMO_COMMUNITY, id, key]);
  await db.query('INSERT INTO guild_member_preferences(community_id,user_id,primary_guild_key) VALUES($1,$2,$3)', [DEMO_COMMUNITY, id, commerce]);
  return {id, email};
}
export async function login(page: Page, email: string) {
  await page.route(url => !['127.0.0.1', 'localhost'].includes(url.hostname), route => route.abort());
  await page.goto('/');
  await page.getByLabel('電子郵件', {exact: true}).fill(email);
  await page.getByLabel('密碼', {exact: true}).fill(DEMO_PASSWORD);
  await page.getByRole('button', {name: '登入', exact: true}).click();
  await expect(page.getByRole('button', {name: '設定', exact: true})).toBeVisible();
}
export async function open(page: Page, hash: string) {
  await page.evaluate(value => {window.location.hash = value;}, hash);
  if (hash.startsWith('guilds/')) await expect(page.locator('.guild-launchpad-content > .guild-launchpad-block')).toHaveCount(7);
  else await expect(storePage(page)).toBeVisible();
}
export async function post(page: Page, path: string, body: unknown, status: number, version?: string) {
  const session = await (await page.request.get('/api/v1/session')).json();
  const response = await page.request.post(`/api/v1${path}`, {data: body, headers: {
    Origin: new URL(page.url()).origin, 'X-CSRF-Token': session.csrf_token, 'Idempotency-Key': randomUUID(), ...(version ? {'If-Match': `"${version}"`} : {}),
  }});
  const result = await response.json(); expect(response.status(), JSON.stringify(result)).toBe(status); return result;
}
export async function launchStore(page: Page, name: string) {
  const space = CreateResultSchema.parse(await post(page, '/tenants', {display_name: name}, 201));
  const tenant = space.tenant.tenant_id;
  const plan = LaunchPlanSchema.parse(await post(page, `/tenants/${tenant}/application-launch-plans`, {
    guild_key: commerce, workspace_id: space.workspace.workspace_id, application_key: 'hosted-store', release_ref: 'hosted-store@1.1.0',
    installation_choice: 'create_new', dependencies: [{requirement_key: 'storefront', choice: 'create', configuration: {}}], configuration: {},
  }, 201));
  const operation = RegistryOperationSchema.parse(await post(page, `/tenants/${tenant}/application-installations`, {
    plan_id: plan.plan_id, expected_plan_version: plan.version, configuration_digest: plan.configuration_digest,
  }, 200));
  expect(operation.state).toBe('succeeded');
  const installation = InstallationViewSchema.parse(await (await page.request.get(`/api/v1/tenants/${tenant}/application-installations/by-operation/${operation.operation_id}`)).json());
  const instance = installation.modules.find(link => link.requirement_key === 'storefront')!.instance_id;
  return {root: `/tenants/${tenant}/storefronts/${instance}`, hash: `stores/${tenant}/${instance}`};
}

/** Synthetic raster shared by product-photo browser journeys. */
export async function photoSource(name:string,color:string){return {name,mimeType:'image/png',buffer:await sharp({create:{width:120,height:80,channels:3,background:color}}).png().toBuffer()};}

export async function captureOffer(page:Page,target:Locator,path:string){
  // Tall element captures scroll beneath the fixed portal chrome. Hide only
  // that chrome for the capture, then restore its exact original inline style.
  const chrome=page.locator('.community-header,.floating-messages');
  const styles=await chrome.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('style')));
  try{
    await chrome.evaluateAll(nodes=>nodes.forEach(node=>(node as HTMLElement).style.setProperty('visibility','hidden','important')));
    await target.screenshot({path});
  }finally{
    await chrome.evaluateAll((nodes,styles)=>nodes.forEach((node,i)=>styles[i]===null?node.removeAttribute('style'):node.setAttribute('style',styles[i]!)),styles);
  }
}

/** Gallery uses the existing photo pass's schema and restricted role. The main
 * server stays gallery-OFF, so its 32 original journeys retain their baseline. */
export async function startGalleryBrowserServer(options:{variants?:boolean;appearance?:boolean;categories?:boolean}={}){
 if(process.env.FREEDOM_E2E_STORE_PHOTO_FIXTURE!=='1'||process.env.NODE_ENV==='production')throw Error('Gallery browser fixture requires the local photo pass');
 const {e2eSchema}=await import('../../packages/testing/e2e-auth-isolation.js');
 const schema=e2eSchema(process.env.FREEDOM_E2E_SCHEMA),connectionString=process.env.TEST_DATABASE_URL;
 if(!connectionString)throw Error('Explicit disposable TEST_DATABASE_URL required');
 const {Pool}=await import('pg'),{serve}=await import('@hono/node-server'),{serveStatic}=await import('@hono/node-server/serve-static');
 const {createApp}=await import('../../apps/platform-api/src/app.js');
 const {collaborationGitHubFixture}=await import('../../packages/testing/github-collaboration.js');
 const {FakeObjectStore}=await import('../../packages/asset-storage/fake-store.js');
 const {createStorefrontGalleryLifecycle}=await import('../../modules/assets/storefront-gallery.js');
 const {createStorefrontProductPhotoLifecycle}=await import('../../modules/assets/storefront-product-photo.js');
 const {TENANT_CURSOR_TEST_KEY}=await import('../runtime/tenant-cursor-fixture.js');
 const url=new URL(connectionString);url.username=schema+'_app';url.password='';
 const pool=new Pool({connectionString:url.toString(),options:`-c search_path=${schema}`});
 const authority=(await pool.query("SELECT r.rolsuper,r.rolbypassrls,has_table_privilege(current_user,'commerce_publication_galleries','UPDATE,DELETE') unsafe FROM pg_roles r WHERE r.rolname=current_user")).rows[0];
 expect(authority).toEqual({rolsuper:false,rolbypassrls:false,unsafe:false});
 let app:ReturnType<typeof createApp>|undefined;
 const server=serve({fetch:request=>{if(!app)throw Error('Gallery fixture is not ready');return app.fetch(request);},hostname:'127.0.0.1',port:0});
 try{
  if(!server.listening)await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('Gallery fixture needs a loopback port');
  const origin=`http://127.0.0.1:${address.port}`,store=new FakeObjectStore();
  app=createApp(pool,origin,'local',{registrationCommunityId:DEMO_COMMUNITY,guildLaunchpadEnabled:true,supplierConsoleEnabled:true,storeGalleryEnabled:true,storeVariantsEnabled:options.variants===true,storeCategoriesEnabled:options.categories===true,storeAppearanceEnabled:options.appearance===true,
   ...(options.variants?{githubSocial:{fetcher:async input=>collaborationGitHubFixture(input)}}:{}),tenantCursorSigningKey:TENANT_CURSOR_TEST_KEY,
   storePhotoAssetStore:store,storePhotoAssets:createStorefrontProductPhotoLifecycle(pool,{store}),storeGalleryAssets:createStorefrontGalleryLifecycle(pool,{store}),storePhotoUploadsEnabled:true,
   linkPreviewFetch:async()=>{throw Error('Gallery fixture forbids outbound previews');}});
  app.use('/*',serveStatic({root:'./apps/portal-web/dist'}));app.get('*',serveStatic({path:'./apps/portal-web/dist/index.html'}));
  return {origin,async stop(){await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await pool.end();}};
 }catch(e){await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();throw e;}
}
