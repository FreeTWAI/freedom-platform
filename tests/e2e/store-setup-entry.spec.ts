import type {Pool} from 'pg';
import {test, expect, type Page} from './fixtures.js';
import {person, login, post, launchStore} from './hosted-store-fixture.js';
import {DEMO_COMMUNITY} from '../../packages/testing/seed.js';

const commerce = 'guild_commerce_sales';
const originalGuild = 'guild_commercial_production';
const setup = (page: Page) => page.getByRole('region', {name: '開始開店', exact: true});
const flow = (page: Page) => page.getByRole('region', {name: '啟動應用', exact: true});
async function member(db: Pool, page: Page, membership: 'active' | 'none' | 'left' = 'none') {
  const user = await person(db);
  await db.query('UPDATE guild_member_preferences SET primary_guild_key=$3 WHERE community_id=$1 AND user_id=$2', [DEMO_COMMUNITY, user.id, originalGuild]);
  if (membership === 'none') await db.query('DELETE FROM positioning_profession_memberships WHERE community_id=$1 AND user_id=$2 AND guild_key=$3', [DEMO_COMMUNITY, user.id, commerce]);
  if (membership === 'left') await db.query("UPDATE positioning_profession_memberships SET state='left',aggregate_version=3 WHERE community_id=$1 AND user_id=$2 AND guild_key=$3", [DEMO_COMMUNITY, user.id, commerce]);
  await login(page, user.email);
  return user;
}
async function openSetup(page: Page) {
  await page.evaluate(() => {window.location.hash = '#stores';});
  await page.getByRole('link', {name: '建立我的商店', exact: true}).click();
  await expect(page).toHaveURL(/#stores\/setup$/);
  await expect(setup(page)).toBeVisible();
}
async function createSpace(page: Page, name: string) {
  await flow(page).getByLabel('業務空間名稱', {exact: true}).fill(name);
  await flow(page).getByRole('button', {name: '建立業務空間', exact: true}).click();
  await expect(flow(page)).toContainText(`目前業務空間：${name}`);
}
async function launch(page: Page) {
  await flow(page).getByRole('button', {name: '確認開店空間', exact: true}).click();
  await flow(page).getByRole('button', {name: '確認建立商店空間', exact: true}).click();
  await expect(flow(page).getByRole('region', {name: '啟動進度', exact: true})).toContainText('開店工具已啟用');
  await expect(flow(page)).toContainText('這不代表已可接單');
  await flow(page).getByRole('button', {name: '繼續商店設定', exact: true}).click();
  await expect(page).toHaveURL(/#stores\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
}

test('member starts from stores, explicitly joins inline and continues into the existing setup', async ({page, e2eAuthPool}, info) => {
  const user = await member(e2eAuthPool, page);
  let joins = 0, plans = 0;
  page.on('request', request => {
    if (request.method() !== 'POST') return;
    if (new URL(request.url()).pathname.endsWith(`/guilds/${commerce}/join`)) joins++;
    if (new URL(request.url()).pathname.endsWith('/application-launch-plans')) plans++;
  });
  await openSetup(page);
  const join = setup(page).getByRole('button', {name: /加入.*並繼續/});
  await expect(join).toBeEnabled();
  expect(joins).toBe(0); expect(plans).toBe(0);
  for (const theme of ['light', 'dark', 'versefolk']) {
    await page.evaluate(value => {document.documentElement.dataset.theme = value; document.documentElement.dataset.experienceProfile = value;}, theme);
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({width, height: 900});
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const box = await join.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44);
      if (width === 390) await setup(page).screenshot({path: info.outputPath(`store-setup-${theme}-${width}.png`)});
    }
  }
  await setup(page).getByRole('link', {name: '返回我的商店', exact: true}).click();
  expect(joins).toBe(0); expect(plans).toBe(0);
  await openSetup(page);
  await join.focus(); await page.keyboard.press('Enter');
  await expect(flow(page).getByRole('heading', {name: '設定商店空間', exact: true})).toBeFocused();
  await expect(page).toHaveURL(/#stores\/setup$/);
  expect(joins).toBe(1);
  const preference = await e2eAuthPool.query('SELECT primary_guild_key FROM guild_member_preferences WHERE community_id=$1 AND user_id=$2', [DEMO_COMMUNITY, user.id]);
  expect(preference.rows[0].primary_guild_key).toBe(originalGuild);
  await createSpace(page, '直接開店測試');
  await launch(page);
  expect(plans).toBe(1);
  await expect(page.getByRole('form', {name: '建立商店', exact: true})).toBeVisible();
});

test('unknown inline join retains the original key and membership version until explicit retry', async ({page, e2eAuthPool}) => {
  const user = await member(e2eAuthPool, page, 'left');
  const attempts: {key: string | undefined; version: string | undefined; body: string | null}[] = [];
  await page.route(`**/api/v1/guilds/${commerce}/join`, async route => {
    const request = route.request();
    attempts.push({key: request.headers()['idempotency-key'], version: request.headers()['if-match'], body: request.postData()});
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    if (attempts.length === 1) await route.abort('failed');
    else await route.fulfill({response});
  });
  await openSetup(page);
  await setup(page).getByRole('button', {name: /加入.*並繼續/}).click();
  await expect(setup(page).getByRole('alert')).toContainText('加入結果尚未確認');
  await setup(page).getByRole('link', {name: '返回我的商店', exact: true}).click();
  await expect(page).toHaveURL(/#stores\/setup$/);
  expect(attempts).toHaveLength(1);
  expect(attempts[0].version).toBe('"3"');
  await setup(page).getByRole('button', {name: '重試加入', exact: true}).click();
  await expect(flow(page)).toBeVisible();
  expect(attempts).toHaveLength(2); expect(attempts[1]).toEqual(attempts[0]);
  const membership = await e2eAuthPool.query('SELECT state,aggregate_version::text FROM positioning_profession_memberships WHERE community_id=$1 AND user_id=$2 AND guild_key=$3', [DEMO_COMMUNITY, user.id, commerce]);
  expect(membership.rows).toEqual([{state: 'active', aggregate_version: '4'}]);
});

test('member qualification and launch eligibility remain separate and can recover without leaving setup', async ({page, e2eAuthPool}) => {
  await member(e2eAuthPool, page, 'active');
  let blocked = true;
  await page.route('**/api/v1/applications?*', async route => {
    const response = await route.fetch(); const body = await response.json();
    await route.fulfill({response, json: {...body, items: body.items.map((item: Record<string, unknown>) => item.application_key === 'hosted-store' && blocked
      ? {...item, eligibility: {...item.eligibility as object, can_launch: false, tenant_action: 'denied', reason_codes: ['policy_unconfigured']}}
      : item)}});
  });
  await openSetup(page);
  await expect(setup(page)).toContainText('公會成員身分已確認');
  await expect(setup(page)).toContainText('尚未設定容量政策');
  await expect(setup(page).getByRole('button', {name: /加入.*並繼續/})).toHaveCount(0);
  await expect(flow(page)).toHaveCount(0);
  blocked = false;
  await setup(page).getByRole('button', {name: '重新確認資格', exact: true}).click();
  await expect(flow(page)).toBeVisible();
  await expect(page).toHaveURL(/#stores\/setup$/);
});

test('pure supply stays visibly distinct and an independent store can be created in the same journey', async ({page, e2eAuthPool}) => {
  await member(e2eAuthPool, page, 'active');
  const supply = await launchStore(page, '保留純供貨空間');
  await post(page, supply.root + '/supply-profile', {name: '原供貨商品庫', currency: 'TWD'}, 201);
  await post(page, supply.root + '/supply-products', {title: '原供貨商品', cost_minor: 12000, stock: 5}, 201);
  await post(page, '/guilds/guild_product_quality_supply/join', {}, 200);
  await page.evaluate(() => {window.location.hash = '#stores/supply/setup';});
  const supplyReuse = flow(page).getByRole('radio', {name: /將共用既有的純供貨商品庫/});
  await expect(supplyReuse).toBeChecked();
  await expect(supplyReuse).toBeEnabled();
  await expect(flow(page).getByRole('button', {name: '確認供貨空間', exact: true})).toBeEnabled();
  await openSetup(page);
  const pureSupply = flow(page).getByRole('radio', {name: /保留既有的純供貨商品庫/});
  await expect(pureSupply).toBeDisabled();
  await expect(pureSupply).not.toBeChecked();
  await expect(flow(page).getByRole('button', {name: '確認開店空間', exact: true})).toBeDisabled();
  await expect(flow(page)).toContainText('不能直接轉為零售商店');
  await expect(flow(page)).not.toContainText('下一步再設定零售');
  const before = await (await page.request.get('/api/v1/tenants?limit=100')).json();
  await flow(page).getByRole('button', {name: '另開獨立商店', exact: true}).click();
  await expect(flow(page).getByLabel('業務空間名稱', {exact: true})).toBeFocused();
  await flow(page).getByLabel('業務空間名稱', {exact: true}).fill('暫時取消的名稱');
  await flow(page).getByRole('button', {name: '返回原業務空間', exact: true}).click();
  await expect(flow(page).getByRole('button', {name: '另開獨立商店', exact: true})).toBeFocused();
  expect((await (await page.request.get('/api/v1/tenants?limit=100')).json()).items).toHaveLength(before.items.length);
  await flow(page).getByRole('button', {name: '另開獨立商店', exact: true}).click();
  await createSpace(page, '獨立的新零售店');
  await expect(flow(page)).not.toContainText('保留既有的純供貨商品庫');
  await launch(page);
  expect(new URL(page.url()).hash).not.toBe('#' + supply.hash);
  expect((await (await page.request.get('/api/v1/tenants?limit=100')).json()).items).toHaveLength(before.items.length + 1);
  const retained = await (await page.request.get('/api/v1' + supply.root + '/supply-profile')).json();
  expect(retained.retail_enabled).toBe(false); expect(retained.product_count).toBe(1);
  expect((await (await page.request.get('/api/v1' + supply.root + '/supply-products')).json()).items[0]).toMatchObject({title: '原供貨商品', stock: 5});
});

test('eligibility read failure is retryable and does not invent a join or a new space', async ({page, e2eAuthPool}) => {
  await member(e2eAuthPool, page);
  let blocked = true;
  await page.route('**/api/v1/guilds/directory', async route => {
    if (blocked) await route.fulfill({status: 503, contentType: 'application/problem+json', json: {code: 'dependency_unavailable', detail: '資格讀取暫時無法完成。'}});
    else await route.continue();
  });
  await openSetup(page);
  await expect(setup(page).getByRole('alert')).toBeVisible();
  await expect(setup(page).getByRole('button', {name: /加入.*並繼續/})).toHaveCount(0);
  await expect(flow(page)).toHaveCount(0);
  blocked = false;
  await setup(page).getByRole('button', {name: '重新確認資格', exact: true}).click();
  await expect(setup(page).getByRole('button', {name: /加入.*並繼續/})).toBeEnabled();
});
