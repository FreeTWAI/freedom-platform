import type {Pool} from 'pg';
import {test, expect, type Page, type TestInfo} from './fixtures.js';
import {person, login, open, post, launchStore, captureOffer} from './hosted-store-fixture.js';
import {DEMO_COMMUNITY} from '../../packages/testing/seed.js';
import {TenantPageSchema} from '../../contracts/guild-launchpad/v1/tenant.js';
import {InstancePageSchema, LaunchPlanSchema, PlanInputSchema, InstallationPageSchema} from '../../contracts/guild-launchpad/v1/module-registry.js';
import {SupplyCatalogViewSchema, SupplyProductPageSchema} from '../../contracts/guild-launchpad/v1/hosted-supply-catalog.js';

const commerce = 'guild_commerce_sales';
const originalGuild = 'guild_commercial_production';
const setup = (page: Page) => page.getByRole('region', {name: '開始開店', exact: true});
const flow = (page: Page) => page.getByRole('region', {name: '啟動應用', exact: true});
const sharedScope = '將共用既有的商品與規格、庫存、訂單、商店設定與公開頁、供貨合作與選品，以及商品照片，不會複製一份。';
const blockedExplanation = '這個業務空間目前有純供貨商品庫，不能直接轉為零售商店。每個業務空間只能有一間商店；請按上方「另開獨立商店」，建立新的業務空間設定零售。原商品、庫存與供貨合作會維持不變。';

async function launchInventory(page: Page) {
  const response = await page.request.get('/api/v1/tenants?limit=100');
  expect(response.status()).toBe(200);
  const tenants = TenantPageSchema.parse(await response.json());
  expect(tenants.next_cursor).toBeNull();
  return Promise.all(tenants.items.map(async tenant => {
    const response = await page.request.get(`/api/v1/tenants/${tenant.tenant_id}/application-installations?limit=100`);
    expect(response.status()).toBe(200);
    const installations = InstallationPageSchema.parse(await response.json());
    expect(installations.next_cursor).toBeNull();
    return {tenant_id: tenant.tenant_id, installations: installations.items};
  }));
}

async function captureLaunch(page: Page, name: string, info: TestInfo) {
  for (const {theme, width} of [{theme: 'light', width: 390}, {theme: 'light', width: 768}, {theme: 'light', width: 1440}, {theme: 'dark', width: 390}] as const) {
    await page.emulateMedia({colorScheme: theme, reducedMotion: 'reduce'});
    await page.evaluate(value => {
      localStorage.setItem('freedom-theme', value);
      document.documentElement.dataset.theme = value;
      document.documentElement.dataset.experienceProfile = value;
      window.dispatchEvent(new Event('freedom-theme-changed'));
    }, theme);
    await page.setViewportSize({width, height: 900});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(theme === 'dark');
    const buttons = await flow(page).locator('.btn:visible').evaluateAll(elements => elements.map(element => ({
      text: element.textContent, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height,
      parentWidth: element.parentElement!.getBoundingClientRect().width,
    })));
    for (const button of buttons) {
      expect(button.width, button.text ?? '').toBeLessThanOrEqual(button.parentWidth);
      expect(button.height, button.text ?? '').toBeGreaterThanOrEqual(44);
    }
    expect(await flow(page).locator('.btn-primary:visible').count()).toBeLessThanOrEqual(1);
    const shot = `${name}-${theme}-${width}`;
    await info.attach(`${shot}-buttons`, {body: JSON.stringify(buttons, null, 2), contentType: 'application/json'});
    const path = info.outputPath(`${shot}.png`);
    await captureOffer(page, flow(page), path);
    await info.attach(shot, {path, contentType: 'image/png'});
  }
}
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
  await expect(flow(page).getByRole('link', {name: '建立或選擇業務空間', exact: true})).toHaveAttribute('href', '#business');
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

test('pure supply stays visibly distinct and an independent store can be created in the same journey', async ({page, e2eAuthPool}, info) => {
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
  await flow(page).getByRole('button', {name: '確認供貨空間', exact: true}).click();
  const confirmation = flow(page).getByRole('region', {name: '確認啟動方案', exact: true});
  await expect(confirmation.getByRole('heading', {name: '確認沿用供貨空間', exact: true})).toBeVisible();
  await expect(confirmation.getByRole('listitem').filter({hasText: sharedScope})).toHaveText(`供貨商品庫：${sharedScope}`);
  await captureLaunch(page, 'g3-supply-reuse', info);
  await confirmation.getByRole('button', {name: '修改選擇', exact: true}).click();
  await openSetup(page);
  const pureSupply = flow(page).getByRole('radio', {name: /保留既有的純供貨商品庫/});
  await expect(pureSupply).toBeDisabled();
  await expect(pureSupply).not.toBeChecked();
  await expect(flow(page).getByRole('radio', {name: /沿用這個安裝/})).toHaveCount(0);
  await expect(flow(page).getByText(blockedExplanation, {exact: true})).toHaveCount(1);
  await expect(flow(page).getByRole('button', {name: '確認開店空間', exact: true})).toBeDisabled();
  await expect(flow(page)).toContainText('不能直接轉為零售商店');
  await expect(flow(page)).not.toContainText('下一步再設定零售');
  const before = await (await page.request.get('/api/v1/tenants?limit=100')).json();
  await flow(page).getByRole('button', {name: '另開獨立商店', exact: true}).click();
  await expect(flow(page).getByLabel('業務空間名稱', {exact: true})).toBeFocused();
  await expect(flow(page).getByRole('link', {name: '建立或選擇業務空間', exact: true})).toHaveCount(0);
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

test('commerce guild keeps a supply-only catalog unchanged while opening an independent store inline', async ({page, e2eAuthPool}, info) => {
  await member(e2eAuthPool, page, 'active');
  const supply = await launchStore(page, '公會純供貨空間 A');
  await post(page, supply.root + '/supply-profile', {name: '公會原供貨商品庫', currency: 'TWD'}, 201);
  await post(page, supply.root + '/supply-products', {title: '公會原供貨商品', cost_minor: 12000, stock: 5}, 201);
  const catalogBefore = SupplyCatalogViewSchema.parse(await (await page.request.get('/api/v1' + supply.root + '/supply-profile')).json());
  const productsBefore = SupplyProductPageSchema.parse(await (await page.request.get('/api/v1' + supply.root + '/supply-products')).json());
  expect(catalogBefore).toMatchObject({setup_state: 'ready', retail_enabled: false, catalog: {name: '公會原供貨商品庫'}, product_count: 1});
  expect(productsBefore.items).toHaveLength(1);
  expect(productsBefore.items[0]).toMatchObject({title: '公會原供貨商品', stock: 5});
  const before = await launchInventory(page);
  expect(before).toHaveLength(1);
  expect(before[0].installations).toHaveLength(1);

  await open(page, `guilds/${commerce}`);
  await page.getByRole('region', {name: '主要動作', exact: true}).getByRole('button', {name: '建立我的商店', exact: true}).click();
  await expect(flow(page)).toContainText('目前業務空間：公會純供貨空間 A');
  const installation = flow(page).getByRole('group', {name: '安裝選擇', exact: true});
  await expect(installation.getByRole('radio')).toHaveCount(0);
  await expect(installation).toHaveText(`安裝選擇這個安裝已連結純供貨商品庫，會保持不變（${before[0].installations[0].release_ref}，ID 尾碼 ${before[0].installations[0].installation_id.slice(-6)}，版本 ${before[0].installations[0].version}，使用中）。`);
  await expect(flow(page).getByRole('radio', {name: /保留既有的純供貨商品庫/})).toBeDisabled();
  await expect(flow(page).getByRole('radio', {name: /保留既有的純供貨商品庫/})).not.toBeChecked();
  await expect(flow(page).getByText(blockedExplanation, {exact: true})).toHaveCount(1);
  await expect(flow(page).locator('p.field-hint')).toHaveCount(1);
  await expect(flow(page)).not.toContainText('選擇另一個工作區');
  await expect(flow(page).getByRole('button', {name: '產生啟動方案', exact: true})).toBeDisabled();
  await expect(flow(page).getByRole('button', {name: '另建新的安裝', exact: true})).toHaveCount(0);
  await expect(flow(page).getByRole('button', {name: '另開獨立商店', exact: true})).toHaveCount(1);
  await captureLaunch(page, 'g2-guild-supply-blocked', info);

  await flow(page).getByRole('button', {name: '另開獨立商店', exact: true}).click();
  await expect(flow(page).getByLabel('業務空間名稱', {exact: true})).toBeFocused();
  await expect(flow(page).locator('a[href="#business"]')).toHaveCount(0);
  await expect(flow(page).getByRole('button', {name: '返回原業務空間', exact: true})).toBeVisible();
  expect(await launchInventory(page)).toEqual(before);
  await createSpace(page, '公會獨立商店空間 B');
  await expect(page).toHaveURL(new RegExp(`#guilds/${commerce}$`));
  await expect(flow(page).getByRole('group', {name: '業務空間', exact: true}).getByRole('button', {name: /^公會獨立商店空間 B・/})).toHaveAttribute('aria-current', 'true');
  const afterSpace = await launchInventory(page);
  expect(afterSpace).toHaveLength(2);
  const independent = afterSpace.find(row => row.tenant_id !== before[0].tenant_id)!;
  expect(independent.installations).toEqual([]);
  expect(afterSpace.find(row => row.tenant_id === before[0].tenant_id)).toEqual(before[0]);

  await flow(page).getByRole('button', {name: '產生啟動方案', exact: true}).click();
  const confirmation = flow(page).getByRole('region', {name: '確認啟動方案', exact: true});
  await expect(confirmation.getByRole('heading', {name: '確認啟動方案', exact: true})).toBeVisible();
  await expect(confirmation).toContainText('將建立獨立空白資料，使用額外容量。');
  await confirmation.getByRole('button', {name: '修改選擇', exact: true}).click();
  await expect(confirmation).toHaveCount(0);
  expect(await launchInventory(page)).toEqual(afterSpace);
  await flow(page).getByRole('button', {name: '產生啟動方案', exact: true}).click();
  await confirmation.getByRole('button', {name: '確認啟動', exact: true}).click();
  await expect(flow(page).getByRole('region', {name: '啟動進度', exact: true})).toContainText('已啟用');
  const afterLaunch = await launchInventory(page);
  expect(afterLaunch).toHaveLength(2);
  const created = afterLaunch.find(row => row.tenant_id === independent.tenant_id)!;
  expect(created.installations).toHaveLength(1);
  expect(created.installations[0].application_key).toBe('hosted-store');
  const store = created.installations[0].modules.find(link => link.requirement_key === 'storefront')!;
  expect(store.instance_id).not.toBe(catalogBefore.instance_id);
  expect(afterLaunch.find(row => row.tenant_id === before[0].tenant_id)).toEqual(before[0]);
  await flow(page).getByRole('button', {name: '設定我的商店', exact: true}).click();
  await expect(page).toHaveURL(new RegExp(`#stores/${independent.tenant_id}/${store.instance_id}$`));
  const storeSetup = page.getByRole('form', {name: '建立商店', exact: true});
  await storeSetup.getByLabel('商店名稱', {exact: true}).fill('公會獨立零售店');
  await storeSetup.getByLabel('商店網址', {exact: true}).fill('guild-' + independent.tenant_id.replaceAll('-', '').replace(/[0-9]/g, digit => String.fromCharCode(97 + Number(digit))));
  await storeSetup.getByRole('button', {name: '建立商店', exact: true}).click();
  await expect(page.locator('.hosted-store').getByRole('heading', {level: 2, name: '公會獨立零售店', exact: true})).toBeVisible();
  const retail = SupplyCatalogViewSchema.parse(await (await page.request.get(`/api/v1/tenants/${independent.tenant_id}/storefronts/${store.instance_id}/supply-profile`)).json());
  expect(retail).toMatchObject({tenant_id: independent.tenant_id, instance_id: store.instance_id, retail_enabled: true});
  const retained = SupplyCatalogViewSchema.parse(await (await page.request.get('/api/v1' + supply.root + '/supply-profile')).json());
  expect(retained).toEqual(catalogBefore);
  expect(SupplyProductPageSchema.parse(await (await page.request.get('/api/v1' + supply.root + '/supply-products')).json())).toEqual(productsBefore);
});

test('hosted-store plan conflicts keep the next step inside the retail or supply wizard', async ({page, e2eAuthPool}) => {
  await member(e2eAuthPool, page, 'active');
  const existing = await launchStore(page, '衝突提示測試空間');
  await post(page, existing.root + '/setup', {name: '既有零售店', slug: 'conflict-' + existing.hash.split('/')[1].replaceAll('-', '').slice(0, 24), currency: 'TWD'}, 201);
  await post(page, '/guilds/guild_product_quality_supply/join', {}, 200);
  let code = 'installation_selection_required';
  await page.route('**/api/v1/tenants/*/application-launch-plans', route => route.fulfill({
    status: 409, contentType: 'application/problem+json', json: {code, detail: '合成方案衝突。'},
  }));
  for (const purpose of ['retail', 'supply'] as const) {
    if (purpose === 'retail') await openSetup(page);
    else await page.evaluate(() => {window.location.hash = '#stores/supply/setup';});
    const plan = flow(page).getByRole('button', {name: purpose === 'retail' ? '確認開店空間' : '確認供貨空間', exact: true});
    const action = purpose === 'retail' ? '另開獨立商店' : '建立另一個獨立商品庫';
    await expect(flow(page)).toContainText(purpose === 'retail'
      ? '每個業務空間只能有一間商店。要另外開店，請按「另開獨立商店」建立新的業務空間。'
      : '每個業務空間只能有一個商品庫。要分開管理，請按「建立另一個獨立商品庫」建立新的業務空間。');
    await expect(flow(page).getByRole('radio', {name: /沿用這個安裝/})).toBeChecked();
    for (code of ['installation_selection_required', 'workspace_binding_conflict']) {
      await expect(plan).toBeEnabled();
      await plan.click();
      await expect(flow(page).getByRole('alert')).toContainText(`請按「${action}」建立新的業務空間。`);
      await expect(flow(page).getByRole('alert')).toContainText(code === 'installation_selection_required'
        ? '請沿用這個工作區的現有安裝；' : '這個工作區已綁定其他實例；');
      await expect(flow(page)).not.toContainText('選擇另一個工作區');
    }
  }
  await page.route('**/api/v1/tenants/*/module-instances?*', async route => {
    const response = await route.fetch();
    await route.fulfill({response, json: {...await response.json(), items: []}});
  });
  for (const purpose of ['retail', 'supply'] as const) {
    if (purpose === 'retail') await openSetup(page);
    else await page.evaluate(() => {window.location.hash = '#stores/supply/setup';});
    await expect(flow(page)).toContainText(`這個安裝連結的${purpose === 'retail' ? '商店' : '供貨商品庫'}目前無法使用`);
    await expect(flow(page)).toContainText(purpose === 'retail'
      ? '請按上方「另開獨立商店」建立新的業務空間。'
      : '請按上方「建立另一個獨立商品庫」建立新的業務空間。');
    await expect(flow(page)).not.toContainText('選擇另一個工作區');
    await expect(flow(page).getByRole('button', {name: purpose === 'retail' ? '確認開店空間' : '確認供貨空間', exact: true})).toBeDisabled();
  }
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


test('cross-account store setup hides foreign spaces and rejects foreign launch identifiers', async ({page, browser, baseURL, e2eAuthPool}) => {
  // Two cookie jars remain alive throughout: checking the owner again must not log out the stranger.
  await member(e2eAuthPool, page, 'active');
  const supply = await launchStore(page, '甲的純供貨 A');
  await post(page, supply.root + '/supply-profile', {name: '甲的私人商品庫', currency: 'TWD'}, 201);
  await post(page, supply.root + '/supply-products', {title: '甲的私人商品', cost_minor: 12000, stock: 5}, 201);
  const retail = await launchStore(page, '甲的獨立零售 B');
  await post(page, retail.root + '/setup', {name: '甲的零售店', slug: 'iso-' + retail.hash.split('/')[1].replaceAll('-', ''), currency: 'TWD'}, 201);
  const ownerInventory = await launchInventory(page);
  expect(ownerInventory).toHaveLength(2);
  const catalog = async (target: typeof supply) => {
    const response = await page.request.get('/api/v1' + target.root + '/supply-profile');
    expect(response.status()).toBe(200);
    return SupplyCatalogViewSchema.parse(await response.json());
  };
  const products = async () => {
    const response = await page.request.get('/api/v1' + supply.root + '/supply-products');
    expect(response.status()).toBe(200);
    return SupplyProductPageSchema.parse(await response.json());
  };
  const supplyBefore = await catalog(supply), retailBefore = await catalog(retail), productsBefore = await products();
  expect(supplyBefore).toMatchObject({retail_enabled: false, product_count: 1});
  expect(retailBefore.retail_enabled).toBe(true);
  expect(productsBefore.items).toHaveLength(1);
  expect(productsBefore.items[0]).toMatchObject({title: '甲的私人商品', stock: 5});
  const foreign = await Promise.all(ownerInventory.map(async row => {
    expect(row.installations).toHaveLength(1);
    const installation = row.installations[0];
    const response = await page.request.get(`/api/v1/tenants/${row.tenant_id}/module-instances?limit=100`);
    expect(response.status()).toBe(200);
    const instances = InstancePageSchema.parse(await response.json());
    expect(instances.next_cursor).toBeNull();
    const instance = instances.items.find(item => item.instance_id === installation.modules[0].instance_id)!;
    expect(instance).toBeDefined();
    const input = PlanInputSchema.parse({guild_key: commerce, workspace_id: installation.workspace_id,
      application_key: 'hosted-store', release_ref: installation.release_ref,
      installation_choice: 'reuse_existing', existing_installation_id: installation.installation_id,
      dependencies: [{requirement_key: 'storefront', choice: 'reuse', instance_id: instance.instance_id, expected_version: instance.version}], configuration: {}});
    // A real, unexecuted owner plan avoids mistaking an invalid payload for authorization denial.
    const plan = LaunchPlanSchema.parse(await post(page, `/tenants/${row.tenant_id}/application-launch-plans`, input, 201));
    return {installation, instance, input, plan};
  }));
  const strangerContext = await browser.newContext({baseURL});
  try {
    const stranger = await strangerContext.newPage();
    await member(e2eAuthPool, stranger, 'active');
    expect(await launchInventory(stranger)).toEqual([]);
    await openSetup(stranger);
    await expect(flow(stranger).getByLabel('業務空間名稱', {exact: true})).toBeVisible();
    const expectForeignAbsent = async () => {
      for (const text of ['甲的純供貨 A', '甲的獨立零售 B', '甲的私人商品庫', '甲的零售店']) await expect(flow(stranger)).not.toContainText(text);
      for (const {installation, instance} of foreign) {
        for (const id of [installation.tenant_id, installation.installation_id, instance.instance_id]) {
          await expect(flow(stranger)).not.toContainText(id);
          expect(await flow(stranger).locator('input, option, button, a').evaluateAll(nodes => nodes.map(node => node.outerHTML).join(''))).not.toContain(id);
        }
        await expect(flow(stranger)).not.toContainText(installation.installation_id.slice(-6));
      }
      await expect(flow(stranger).getByRole('radio', {name: /沿用這個安裝/})).toHaveCount(0);
    };
    await expectForeignAbsent();
    await createSpace(stranger, '乙的獨立空間');
    const ownInventory = await launchInventory(stranger);
    expect(ownInventory).toHaveLength(1);
    expect(ownInventory[0].installations).toEqual([]);
    await expectForeignAbsent();
    // Capture a valid own plan via the ordinary wizard; cancellation may retain this plan.
    const planned = stranger.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/application-launch-plans'));
    await flow(stranger).getByRole('button', {name: '確認開店空間', exact: true}).click();
    const planResponse = await planned;
    expect(planResponse.status()).toBe(201);
    const ownInput = PlanInputSchema.parse(planResponse.request().postDataJSON());
    const confirmation = flow(stranger).getByRole('region', {name: '確認啟動方案', exact: true});
    await confirmation.getByRole('button', {name: '修改選擇', exact: true}).click();
    await expect(confirmation).toHaveCount(0);
    expect(await launchInventory(stranger)).toEqual(ownInventory);
    const ownTenant = ownInventory[0].tenant_id;
    for (const {installation, instance, input, plan} of foreign) {
      const tenant = installation.tenant_id;
      for (const path of [
        `/tenants/${tenant}`, `/tenants/${tenant}/workspaces`,
        `/tenants/${tenant}/application-installations`, `/tenants/${tenant}/module-instances`,
        `/tenants/${tenant}/module-instances/${instance.instance_id}`,
        `/tenants/${tenant}/workspaces/${installation.workspace_id}/launchpad-context?guild_key=${commerce}`,
        `/tenants/${tenant}/storefronts/${instance.instance_id}/supply-profile`,
        `/tenants/${tenant}/storefronts/${instance.instance_id}/supply-products`,
        `/tenants/${ownTenant}/module-instances/${instance.instance_id}`,
        `/tenants/${ownTenant}/storefronts/${instance.instance_id}/supply-profile`,
      ]) {
        const response = await stranger.request.get('/api/v1' + path);
        expect(response.status(), path).toBe(404);
        const body = await response.text();
        for (const value of ['甲的私人商品', '甲的零售店', tenant, instance.instance_id, installation.installation_id]) expect(body, path).not.toContain(value);
      }
      expect(await post(stranger, `/tenants/${tenant}/application-launch-plans`, input, 404)).toMatchObject({code: 'tenant_not_found'});
      expect(await post(stranger, `/tenants/${ownTenant}/application-launch-plans`, {...ownInput, workspace_id: installation.workspace_id}, 404)).toMatchObject({code: 'not_found'});
      expect(await post(stranger, `/tenants/${ownTenant}/application-launch-plans`, {...ownInput,
        installation_choice: 'reuse_existing', existing_installation_id: installation.installation_id}, 409)).toMatchObject({code: 'installation_selection_required'});
      expect(await post(stranger, `/tenants/${ownTenant}/application-launch-plans`, {...ownInput, dependencies: input.dependencies}, 404)).toMatchObject({code: 'not_found'});
      const launchInput = {plan_id: plan.plan_id, expected_plan_version: plan.version, configuration_digest: plan.configuration_digest};
      expect(await post(stranger, `/tenants/${tenant}/application-installations`, launchInput, 404)).toMatchObject({code: 'tenant_not_found'});
      expect(await post(stranger, `/tenants/${ownTenant}/application-installations`, launchInput, 404)).toMatchObject({code: 'not_found'});
    }
    expect(await launchInventory(stranger)).toEqual(ownInventory);
    await launch(stranger);
    const ownStore = stranger.getByRole('form', {name: '建立商店', exact: true});
    await ownStore.getByLabel('商店名稱', {exact: true}).fill('乙的零售店');
    await ownStore.getByLabel('商店網址', {exact: true}).fill('own-' + ownTenant.replaceAll('-', ''));
    await ownStore.getByRole('button', {name: '建立商店', exact: true}).click();
    await expect(stranger.locator('.hosted-store').getByRole('heading', {level: 2, name: '乙的零售店', exact: true})).toBeVisible();
    const completed = await launchInventory(stranger);
    expect(completed).toHaveLength(1);
    expect(completed[0].tenant_id).toBe(ownTenant);
    expect(completed[0].installations).toHaveLength(1);
    expect(foreign.map(item => item.instance.instance_id)).not.toContain(completed[0].installations[0].modules[0].instance_id);
    // Read back through the still-authenticated owner session, after every foreign attempt and own launch.
    expect(await launchInventory(page)).toEqual(ownerInventory);
    expect(await catalog(supply)).toEqual(supplyBefore);
    expect(await catalog(retail)).toEqual(retailBefore);
    expect(await products()).toEqual(productsBefore);
  } finally {
    await strangerContext.close();
  }
});
