import sharp from 'sharp';
import {randomUUID} from 'node:crypto';
import {test, expect} from './fixtures.js';
import {navigate, selectSocialFeed} from './navigation.js';

for (const width of [390, 1440]) test(`replacing a failed thumbnail restores its image without losing the comment draft at ${width}px`, async ({page}) => {
  await page.setViewportSize({width, height: 900});
  const id = randomUUID(), title = `E2E 縮圖恢復 ${id}`;
  const thumbnail = `/api/v1/social-posts/${id}/thumbnail`;
  const post = {
    post_id: id, kind: 'link', url: `https://example.org/${id}`, platform: 'other', platform_label: '其他',
    title, note: null, created_at: new Date().toISOString(), edited_at: null, revision: 1,
    author: {user_id: randomUUID(), display_name: '縮圖測試作者', avatar_url: null},
    thumbnail_url: `${thumbnail}?v=old`, total_points: 0, my_points: 0, mine: true,
    like_count: 0, liked: false, comment_count: 0, read_count: 0,
  };
  const photo = await sharp({create: {width: 640, height: 360, channels: 3, background: '#2a6f4b'}}).png().toBuffer();
  let oldReads = 0, newReads = 0;
  const uploads: {headers: Record<string, string>; bytes: number}[] = [], unexpectedWrites: string[] = [];
  // Keep the real application, session, React and image preparation. Only this
  // synthetic feed's read/write boundary is mocked; no real post is published.
  await page.route('**/api/v1/social-posts**', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (url.pathname === '/api/v1/social-posts' && method === 'GET') {
      await route.fulfill({json: {items: url.searchParams.get('kind') === 'note' ? [] : [post], next_cursor: null, can_hide: false}}); return;
    }
    if (url.pathname === thumbnail && method === 'GET') {
      if (url.searchParams.get('v') === 'old') {oldReads++; await route.fulfill({status: 503, contentType: 'text/plain', body: 'synthetic unavailable image'});}
      else {newReads++; await route.fulfill({contentType: 'image/png', body: photo});}
      return;
    }
    if (url.pathname === thumbnail && method === 'PUT') {
      uploads.push({headers: request.headers(), bytes: request.postDataBuffer()?.length ?? 0});
      await route.fulfill({json: {...post, thumbnail_url: thumbnail}}); return;
    }
    if (url.pathname === `/api/v1/social-posts/${id}/comments` && method === 'GET') {
      await route.fulfill({json: {items: [], next_cursor: null}}); return;
    }
    // The existing visible-post read receipt is legitimate, not a publication.
    if (url.pathname === `/api/v1/social-posts/${id}/read` && method === 'POST') {
      await route.fulfill({json: {read_count: 1}}); return;
    }
    if (method !== 'GET') {
      unexpectedWrites.push(`${method} ${url.pathname}`);
      await route.fulfill({status: 422, json: {detail: 'Unexpected synthetic social write'}}); return;
    }
    await route.continue();
  });
  await page.goto('/');
  await page.getByLabel('電子郵件', {exact: true}).fill('maker@local.test');
  await page.getByLabel('密碼', {exact: true}).fill('freedom-local-demo');
  await page.getByRole('button', {name: '登入', exact: true}).click();
  await expect(page.locator('.shell')).toBeVisible();
  await navigate(page, '社群分享'); await selectSocialFeed(page, '全部動態');
  const card = page.locator(`#social-post-${id}`), image = card.locator('img.social-thumb');
  await expect(card.getByRole('heading', {name: title, exact: true})).toBeVisible();
  // Deliberately bring the thumbnail into the viewport.
  await card.scrollIntoViewIfNeeded();
  await expect.poll(() => oldReads).toBe(1);
  await expect(card.locator('.social-placeholder')).toBeVisible();
  await expect(image).toHaveCount(0);
  await card.getByRole('button', {name: '留言 · 0', exact: true}).click();
  const draft = card.getByRole('textbox', {name: '寫留言', exact: true});
  await draft.fill('更換縮圖時也要保留的留言草稿');
  await card.evaluate(element => {(window as any).__thumbnailRecoveryCard = element;});
  await card.getByText('⋯', {exact: true}).click();
  await card.getByLabel('更換縮圖', {exact: true}).setInputFiles({name: 'replacement.png', mimeType: 'image/png', buffer: photo});
  await expect(page.getByText('縮圖已更新。', {exact: true})).toBeVisible();
  await image.scrollIntoViewIfNeeded();
  await expect(image).toBeVisible(); await expect(image).toHaveJSProperty('naturalWidth', 640);
  await expect(image).toHaveJSProperty('naturalHeight', 360);
  expect(await image.getAttribute('src')).toMatch(new RegExp(`${thumbnail}\\?v=\\d+$`));
  await expect(card.locator('.social-placeholder')).toHaveCount(0);
  await expect(draft).toHaveValue('更換縮圖時也要保留的留言草稿');
  expect(await card.evaluate(element => (window as any).__thumbnailRecoveryCard === element)).toBe(true);
  expect(uploads).toHaveLength(1); expect(uploads[0].bytes).toBeGreaterThan(0); expect(uploads[0].bytes).toBeLessThanOrEqual(512 * 1024);
  expect(uploads[0].headers['x-csrf-token']).toBeTruthy(); expect(uploads[0].headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  expect(uploads[0].headers['content-type']).toMatch(/^image\/(png|webp|jpeg)$/);
  expect(oldReads).toBe(1); expect(newReads).toBe(1); expect(unexpectedWrites).toEqual([]);
});
