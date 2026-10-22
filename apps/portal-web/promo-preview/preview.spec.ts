import {test, expect} from '../../../tests/e2e/fixtures.js';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';

test('PROMO-B01 edit a single page and download the exact displayed PNG', async ({page}, testInfo) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('/');
  await page.getByLabel('主標題', {exact: true}).fill('我的作品\n從這裡開始');
  await page.getByLabel('內文', {exact: true}).fill('以實際內容介紹創作方法。\n保留每一句想說的話。');
  const image = page.getByRole('img', {name: '圖片預覽', exact: true});
  await expect(image).toBeVisible();
  const preparedHash = await image.evaluate(async element => {
    const bytes = await (await fetch((element as HTMLImageElement).src)).arrayBuffer();
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      byte => byte.toString(16).padStart(2, '0')).join('');
  });
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', {name: '下載 PNG', exact: true}).click();
  const downloaded = await downloading;
  const bytes = await readFile((await downloaded.path())!);
  const metadata = await sharp(bytes).metadata();
  expect(metadata.format).toBe('png');
  expect([metadata.width, metadata.height]).toEqual([1080, 1350]);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(preparedHash);
  const {data, info} = await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject: true});
  expect([...data.subarray(0, 4)]).toEqual([48, 68, 255, 255]);
  let ink = 0;
  for (let y = 190; y < 600; y++) for (let x = 80; x < 1000; x++) {
    const offset = (y * info.width + x) * 4;
    if (data[offset] < 70 && data[offset + 1] < 70 && data[offset + 2] < 70) ink++;
  }
  expect(ink).toBeGreaterThan(5000);
  expect(requests.filter(url => /^https?:/.test(url)).every(url => new URL(url).origin === 'http://127.0.0.1:4492')).toBe(true);
  expect(requests.some(url => url.includes('/api/'))).toBe(false);
  await page.screenshot({path: testInfo.outputPath('desktop.png'), fullPage: true});
});

test('PROMO-B02 square output replaces the previous revision and retains all text', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: '下載 PNG', exact: true}).waitFor({state: 'visible'});
  await expect(page.getByRole('img', {name: '圖片預覽', exact: true})).toBeVisible();
  const before = await page.getByRole('img', {name: '圖片預覽', exact: true}).getAttribute('data-source-fingerprint');
  await page.getByLabel('圖片比例', {exact: true}).selectOption('1:1');
  await page.getByLabel('主標題', {exact: true}).fill('新版本');
  await expect(page.getByRole('img', {name: '圖片預覽', exact: true})).not.toHaveAttribute('data-source-fingerprint', before!);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', {name: '下載 PNG', exact: true}).click();
  const outputPath = await (await downloading).path();
  const metadata = await sharp(outputPath!).metadata();
  expect([metadata.width, metadata.height]).toEqual([1080, 1080]);
  await expect(page.getByLabel('主標題', {exact: true})).toHaveValue('新版本');
});

test('PROMO-B03 overflow and empty headlines block downloads and recover after editing', async ({page}) => {
  await page.goto('/');
  await page.getByLabel('內文', {exact: true}).fill('不能漏掉的文字\n'.repeat(65));
  await expect(page.getByRole('alert')).toContainText('放不下');
  await expect(page.getByRole('button', {name: '下載 PNG', exact: true})).toBeDisabled();
  await expect(page.getByRole('img', {name: '圖片預覽', exact: true})).toHaveCount(0);
  await page.getByLabel('內文', {exact: true}).fill('修正後的完整內容');
  await expect(page.getByRole('button', {name: '下載 PNG', exact: true})).toBeEnabled();
  await page.getByLabel('主標題', {exact: true}).fill('');
  await expect(page.getByRole('alert')).toContainText('主標題不可空白');
  await expect(page.getByRole('button', {name: '下載 PNG', exact: true})).toBeDisabled();
  await page.getByLabel('主標題', {exact: true}).fill('繼續創作');
  await expect(page.getByRole('button', {name: '下載 PNG', exact: true})).toBeEnabled();
});

for (const [language, headlineLabel, button, title] of [
  ['en', 'Headline', 'Download PNG', 'Make something worth sharing'],
  ['ja', '見出し', 'PNG をダウンロード', 'アイデアを作品にする'],
  ['ko', '제목', 'PNG 다운로드', '아이디어를 작품으로'],
  ['es', 'Título', 'Descargar PNG', 'Una idea hecha realidad'],
] as const) {
  test('PROMO-B04 interface ' + language + ' retains edited content and exports', async ({page}) => {
    await page.goto('/');
    await page.getByLabel('主標題', {exact: true}).fill(title);
    await page.getByLabel('Language', {exact: true}).selectOption(language);
    await expect(page.getByLabel(headlineLabel, {exact: true})).toHaveValue(title);
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', {name: button, exact: true}).click();
    const output = await (await downloading).path();
    expect((await sharp(output!).metadata()).width).toBe(1080);
  });
}

test('PROMO-B05 320px and all three themes retain usable fields and focus', async ({page}, testInfo) => {
  await page.setViewportSize({width: 320, height: 740});
  await page.goto('/');
  for (const theme of ['light', 'dark', 'versefolk']) {
    await page.getByLabel('介面外觀', {exact: true}).selectOption(theme);
    const headline = page.getByLabel('主標題', {exact: true});
    await headline.fill('手機也能編輯');
    await headline.focus();
    await expect(headline).toBeFocused();
    await expect(page.getByRole('button', {name: '下載 PNG', exact: true})).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({path: testInfo.outputPath('mobile.png'), fullPage: true});
});

test('PROMO-B06 font load failure blocks download and retry recovers', async ({page}) => {
  await page.addInitScript(() => Object.defineProperty(document.fonts, 'load', {
    value: () => Promise.reject(new Error('synthetic font failure')), configurable: true,
  }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('字型尚未準備好');
  await expect(page.getByRole('button', {name: '下載 PNG', exact: true})).toBeDisabled();
  await page.evaluate(() => Reflect.deleteProperty(document.fonts, 'load'));
  await page.getByRole('button', {name: '重新產生預覽', exact: true}).click();
  await expect(page.getByRole('button', {name: '下載 PNG', exact: true})).toBeEnabled();
});

test('PROMO-B07 null PNG encoding cannot create a ready or downloadable image', async ({page}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(callback) {callback(null);};
    window.addEventListener('promo-test:restore-encoder', () => {HTMLCanvasElement.prototype.toBlob = original;}, {once: true});
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('圖片未能完成');
  await expect(page.getByRole('button', {name: '下載 PNG', exact: true})).toBeDisabled();
  await expect(page.getByRole('img', {name: '圖片預覽', exact: true})).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('promo-test:restore-encoder')));
  await page.getByRole('button', {name: '重新產生預覽', exact: true}).click();
  await expect(page.getByRole('button', {name: '下載 PNG', exact: true})).toBeEnabled();
});
