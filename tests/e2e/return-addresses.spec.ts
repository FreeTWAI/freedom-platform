import {randomUUID} from 'node:crypto';
import {test,expect} from './fixtures';
import {canonicalHash} from '../../apps/portal-web/src/portal-route';
import {quickJoin} from './quick-join';

const id='12345678-1234-4234-8234-123456789abc';
const addresses=['#home','#skills','#explore/resources','#account','#automation/connections',
 `#shares/${id}?via=abcdefghij`,`#events/${id}?ref=abcdefghijklmnop`,
 `#explore/events/${id}?ref=abcdefghijklmnop`,'#guilds/community/hub',
 '#guilds/guild_ai_vibe/tools/cocreation',`#workbench/${id}`,`#showcase/${id}`,
 `#highlights/${id}`,`#squad-outcomes/${id}`,`#private-ai/${id}`];

test('guest address classes retain their intended destination',async({page})=>{
 for(const hash of addresses){
  await page.goto('/'+hash);
  await expect.poll(()=>new URL(page.url()).hash,{message:hash}).toBe(canonicalHash(hash));
  if(hash.startsWith('#events/')||hash.startsWith('#explore/events/'))await expect(page.getByRole('heading',{name:'活動目前無法公開查看',exact:true})).toBeVisible();
  else if(hash==='#guilds/community/hub')await expect(page.getByRole('heading',{name:'社群入口總覽',exact:true})).toBeVisible();
  else await expect(page.locator('.login-card')).toBeVisible();
 }
});

test('signed-in address classes resolve without being redirected home',async({page})=>{
 await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');
 await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();
 await expect(page.getByRole('navigation',{name:'主要工作區'})).toBeVisible();
 const places=['動態','探索','探索','我的','自動化','探索','探索','探索','公會','公會','公會','探索','探索','我的','自動化'];
 for(const [index,hash] of addresses.entries()){
  await page.goto('/'+hash);
  await expect.poll(()=>new URL(page.url()).hash,{message:hash}).toBe(canonicalHash(hash));
  const navigation=page.getByRole('navigation',{name:'主要工作區'});await expect(navigation).toBeVisible();
  await expect(navigation.getByRole('button',{name:places[index],exact:true}),hash).toHaveAttribute('aria-current','page');
  if(hash.startsWith('#shares/'))await expect(page.getByRole('heading',{name:'分享',exact:true})).toBeVisible();
 }
});

test('guest village and tester-map aliases and canonical tool addresses show their public screens',async({page})=>{
 for(const [alias,canonical,title] of [
  ['#newbie-village','#guilds/guild_talent_direction/tools/village','新手村任務'],
  ['#tester-map','#guilds/guild_custom_032fd02e754549e9b1e056e2b95b8d50/tools/tester-map','測試員地圖'],
 ] as const){
  for(const hash of [alias,canonical]){await page.goto('/'+hash);await expect(page).toHaveURL(new RegExp(canonical+'$'));await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();}
 }
});

test('a guest signs in, completes onboarding and resumes the shared object',async({page})=>{
 const hash=`#shares/${id}?via=abcdefghij`,email=`route-${randomUUID()}@example.test`,password='synthetic-route-password';
 await page.goto('/'+hash);await page.getByRole('button',{name:'建立帳號',exact:true}).click();
 const form=page.locator('.login-card form');await form.getByLabel('電子郵件',{exact:true}).fill(email);await form.getByLabel('密碼',{exact:true}).fill(password);
 await form.getByRole('button',{name:'建立帳號，先逛工坊',exact:true}).click();await expect(page.locator('.welcome-preview')).toBeVisible();
 await page.context().clearCookies();await page.reload();
 await page.getByLabel('電子郵件',{exact:true}).fill(email);await page.getByLabel('密碼',{exact:true}).fill(password);await page.getByRole('button',{name:'登入',exact:true}).click();
 await expect(page.locator('.welcome-preview')).toBeVisible();await quickJoin(page);
 await expect(page.getByRole('heading',{name:'分享',exact:true})).toBeVisible();
 expect(new URL(page.url()).hash).toBe(hash);
});
