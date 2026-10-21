import {storeArea} from './hosted-store-fixture.js';
import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from './fixtures.js';
import { signOut, openGuildSection } from './navigation.js';
import { quickJoin } from './quick-join.js';
import { DEMO_COMMUNITY, DEMO_PASSWORD } from '../../packages/testing/seed.js';

const guild = 'guild_commerce_sales';
async function register(page: Page, nickname: string) {
  const email = `merchant-journey-${randomUUID()}@example.test`;
  await page.goto('/');
  await page.getByRole('button', {name: '建立帳號', exact: true}).click();
  await page.getByLabel('社群顯示名稱', {exact: true}).fill(nickname);
  await page.getByLabel('電子郵件', {exact: true}).fill(email);
  await page.getByLabel('密碼', {exact: true}).fill(DEMO_PASSWORD);
  await page.getByRole('button', {name: '建立帳號，先逛工坊', exact: true}).click();
  await quickJoin(page, guild);
  await expect(page.getByRole('heading', {name: '會員首頁', level: 1})).toBeVisible();
  return email;
}
async function login(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('電子郵件', {exact: true}).fill(email);
  await page.getByLabel('密碼', {exact: true}).fill(DEMO_PASSWORD);
  await page.getByRole('button', {name: '登入', exact: true}).click();
  await expect(page.getByRole('button', {name: '設定', exact: true})).toBeVisible();
}
async function guildHome(page: Page) {
  await page.goto('/#guilds/' + guild);
  await expect(page.getByRole('region', {name: '主要動作', exact: true})).toBeVisible();
}

test('registered commerce intern opens a store, publishes a template and returns privately', async ({page, browser, baseURL, e2eAuthPool}, info) => {
  test.setTimeout(120_000);
  const stranger = await browser.newContext({baseURL}), publicContext = await browser.newContext({baseURL});
  try {
    const nickname = `新店主 ${randomUUID().slice(0, 8)}`, email = await register(page, nickname);
    await guildHome(page);
    const primary = page.getByRole('region', {name: '主要動作', exact: true});
    await expect(primary).not.toContainText('你是這個公會的實習成員');
    await expect(primary.getByRole('heading', {level: 2})).toHaveText('線上商店');
    await expect(primary.getByRole('button', {name: '建立我的商店', exact: true})).toBeEnabled();
    await expect(primary.getByRole('button')).toHaveCount(1);
    for (const width of [1280, 390]) {
      await page.setViewportSize({width, height: 900});
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await primary.screenshot({path: info.outputPath(`commerce-intern-primary-${width}.png`)});
      await page.screenshot({path: info.outputPath(`commerce-intern-page-${width}.png`), fullPage: true});
    }
    await openGuildSection(page, '工具目錄');
    await expect(page.getByRole('article').filter({has: page.getByRole('heading', {name: '線上商店', exact: true})})
      .getByRole('button', {name: '啟動應用', exact: true})).toBeEnabled();
    await openGuildSection(page, '線上商店');
    await primary.getByRole('button', {name: '建立我的商店', exact: true}).click();
    const flow = page.getByRole('region', {name: '啟動應用', exact: true});
    await flow.getByLabel('業務空間名稱', {exact: true}).fill('新會員選物工作室');
    await flow.getByRole('button', {name: '建立業務空間', exact: true}).click();
    await flow.getByRole('button', {name: '產生啟動方案', exact: true}).click();
    await flow.getByRole('button', {name: '確認啟動', exact: true}).click();
    await flow.getByRole('button', {name: '設定我的商店', exact: true}).click();
    await expect(page).toHaveURL(/#stores\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    const storeHash = new URL(page.url()).hash, slug = 'member-' + randomUUID().slice(0, 8);
    const setup = page.getByRole('form', {name: '建立商店', exact: true});
    await setup.getByLabel('商店名稱', {exact: true}).fill('新會員選物店');
    await setup.getByLabel('商店網址', {exact: true}).fill(slug);
    await setup.getByLabel('商店介紹', {exact: true}).fill('新會員親手挑選的生活器物');
    await setup.getByRole('button', {name: '建立商店', exact: true}).click();
    expect((await e2eAuthPool.query(`SELECT m.state,m.member_tier FROM positioning_profession_memberships m
      JOIN users u ON u.user_id=m.user_id AND u.community_id=m.community_id
      WHERE u.email=$1 AND m.community_id=$2 AND m.guild_key=$3`, [email, DEMO_COMMUNITY, guild])).rows)
      .toEqual([{state: 'active', member_tier: 'intern'}]);
    const product = page.getByRole('form', {name: '新增商品', exact: true});
    await product.getByLabel('商品名稱', {exact: true}).fill('手作茶杯');
    await product.getByLabel('商品介紹', {exact: true}).fill('手工製作，適合日常品茶');
    await product.getByLabel('價格（新臺幣 TWD）', {exact: true}).fill('350');
    await product.getByLabel('庫存', {exact: true}).fill('10');
    await product.getByRole('button', {name: '新增商品', exact: true}).click();
    await expect(page.locator('.hosted-store-product')).toContainText('手作茶杯');
    await storeArea(page,'店面與發布');
    await page.getByRole('radio', {name: /^直列目錄/}).check();
    await storeArea(page,'店面與發布');
    await page.getByRole('button', {name: '儲存版型', exact: true}).click();
    await expect(page.locator('.hosted-store').getByRole('status')).toContainText('已儲存版型');
    await storeArea(page,'店面與發布');
    const popup = page.waitForEvent('popup'); await page.getByRole('link', {name: '預覽已儲存的展示頁', exact: true}).click();
    const preview = await popup;
    await expect(preview.locator('.shop-products-list article')).toHaveCount(1);
    const publicPage = await publicContext.newPage(); await publicPage.goto('/shops/' + slug);
    await expect(publicPage.getByRole('heading', {name: '新會員選物店', exact: true})).toHaveCount(0);
    await storeArea(page,'店面與發布');
    await page.getByRole('button', {name: '發布展示頁', exact: true}).click();
    await expect(page.locator('.hosted-store').getByRole('status')).toContainText('已發布・第 1 版');
    await publicPage.reload(); await expect(publicPage.locator('.shop-products-list article')).toHaveCount(1);
    // Publication preserves the saved catalog content, while preview-only
    // notices/details and public navigation intentionally use different markup.
    const catalogContent = (target: Page) => target.locator('main').evaluate(main => ({
      name: main.querySelector('h1')?.textContent,
      brand: main.querySelector('.shop-eyebrow')?.textContent,
      introduction: main.querySelector('.shop-introduction')?.textContent,
      count: main.querySelector('.shop-section-heading p')?.textContent,
      products: [...main.querySelectorAll('.shop-products-list article')].map(article => ({
        title: article.querySelector('h3')?.textContent,
        price: article.querySelector('.shop-price')?.textContent,
        description: article.querySelector('.shop-product-summary')?.textContent,
        placeholder: article.querySelector('.shop-photo-placeholder')?.textContent,
      })),
    }));
    const savedCatalog = await catalogContent(preview);
    expect(savedCatalog).toEqual({
      name: '新會員選物店', brand: '獨立商店', introduction: '新會員親手挑選的生活器物', count: '1 件商品',
      products: [{title: '手作茶杯', price: '$350.00',
        description: '手工製作，適合日常品茶', placeholder: '尚未提供商品照片'}],
    });
    expect(await catalogContent(publicPage)).toEqual(savedCatalog);
    await expect(preview.locator('.shop-preview-notice')).toContainText('這是未發布的預覽');
    await expect(preview.locator('.shop-preview-description')).toContainText('手工製作，適合日常品茶');
    await expect(preview.locator('main a[href^="/shops/"], main a[href^="/#reservations/"]')).toHaveCount(0);
    await expect(preview.locator('link[rel="canonical"], meta[property^="og:"]')).toHaveCount(0);
    await expect(publicPage.locator('.shop-preview-notice, .shop-preview-description')).toHaveCount(0);
    await expect(publicPage.getByRole('link', {name: '查看商品：手作茶杯', exact: true}))
      .toHaveAttribute('href', new RegExp(`^/shops/${slug}/products/P[0-9]{4,23}$`));
    await expect(publicPage.getByRole('complementary', {name: '預留與交易說明'})).toBeVisible();
    await expect(publicPage.getByRole('link', {name: '登入查看預留狀態', exact: true}))
      .toHaveAttribute('href', '/#reservations/' + slug);
    await expect(publicPage.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`/shops/${slug}$`));
    await expect(publicPage.locator('meta[property="og:title"]')).toHaveAttribute('content', '新會員選物店');
    await preview.close();
    await signOut(page); await login(page, email); await guildHome(page);
    await primary.getByRole('button', {name: '進入我的商店', exact: true}).click();
    await expect(page).toHaveURL(new RegExp(storeHash + '$'));
    await storeArea(page,'店面與發布');
    await expect(page.getByRole('radio', {name: /^直列目錄/})).toBeChecked();
    await storeArea(page,'商品');
    await expect(page.locator('.hosted-store-product')).toContainText('手作茶杯');
    const strangerPage = await stranger.newPage(); await register(strangerPage, '另一位新會員');
    await strangerPage.goto('/' + storeHash);
    await expect(strangerPage.locator('.hosted-store')).toContainText('找不到這間商店');
    await expect(strangerPage.getByRole('form', {name: '新增商品', exact: true})).toHaveCount(0);
    await page.screenshot({path: info.outputPath('registered-merchant-return.png'), fullPage: true});
    await publicPage.screenshot({path: info.outputPath('registered-merchant-public.png'), fullPage: true});
  } finally {
    await stranger.close(); await publicContext.close();
  }
});
