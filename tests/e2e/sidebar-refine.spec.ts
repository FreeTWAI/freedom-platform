import { test, expect, type Page } from './fixtures.js';

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('電子郵件', { exact: true }).fill('maker@local.test');
  await page.getByLabel('密碼', { exact: true }).fill('freedom-local-demo');
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page.locator('.shell')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/me/github', route => route.fulfill({ json: { configured: false, connected: false, github_user: null } }));
});

// Five places stay visible; feature choices live inside each place.
for (const width of [1280, 390]) {
  for (const theme of ['light', 'versefolk']) {
    test(`navigation is quiet and still touch-sized at ${width}px in ${theme} theme`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await login(page);
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      const menu = page.getByRole('button', { name: '開啟選單', exact: true });
      if (await menu.isVisible()) await menu.click();
      const nav = page.getByRole('navigation', { name: '主要工作區' });
      await expect(nav).toBeVisible();
      await expect(nav.locator('.nav-primary').getByRole('button')).toHaveText(['動態', '探索', '公會', '自動化', '我的']);
      await expect(nav.locator('.nav-more, .nav-search')).toHaveCount(0);

      const active = nav.locator('.nav-item.is-active');
      await expect(active).toHaveCount(1);
      const style = (selector: string, prop: string) => nav.locator(selector).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

      // Active state: heavier text and no left bar. Inactive items stay medium weight.
      expect(await active.evaluate(el => getComputedStyle(el).fontWeight)).toBe('700');
      expect(await active.evaluate(el => getComputedStyle(el).boxShadow)).toBe('none');
      expect(await style('.nav-item:not(.is-active)', 'font-weight')).toBe('500');

      // Each visible place label fits without clipping in both themes and widths.
      for (const item of await nav.locator('.nav-item').all()) {
        const fit = await item.evaluate(el => {
          const css = getComputedStyle(el), ctx = document.createElement('canvas').getContext('2d')!;
          ctx.font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
          return { text: ctx.measureText((el.textContent ?? '').trim()).width,
            room: el.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight) };
        });
        expect(fit.text, `${theme} ${width}px place label width`).toBeLessThanOrEqual(fit.room);
      }

      // Every visible target is at least 44px tall.
      for (const selector of ['.nav-item']) {
        for (const box of await nav.locator(selector).evaluateAll(els => els.filter(el => (el as HTMLElement).offsetParent).map(el => el.getBoundingClientRect().height))) {
          expect(box, `${theme} ${width}px ${selector} height`).toBeGreaterThanOrEqual(44);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
}
