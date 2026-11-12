import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { test, expect, type Page, type Route } from './fixtures.js';
import { navigate, openChat, closeChat } from './navigation.js';

type Member = { id: string; email: string; nickname: string };
type Command = { url: string; body: string | null; key: string; version: string };
const directoryPath = '/api/v1/friends/directory';
const panel = (page: Page) => page.locator('.friends-panel');
const retry = (page: Page) => panel(page).getByRole('button', { name: '確認原操作結果', exact: true });
const home = (page: Page) => page.getByRole('link', { name: '自由工坊 · 會員首頁', exact: true });
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function member(pool: Pool, label: string): Promise<Member> {
  const id = randomUUID(), email = `friends-navigation-${id}@local.test`, nickname = `${label}${id.slice(0, 8)}`;
  await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,onboarding_required)
    SELECT $1,community_id,$2,$3,password_hash,$4,false FROM users WHERE email='maker@local.test'`, [id, email, nickname, randomUUID()]);
  return { id, email, nickname };
}
async function invitation(pool: Pool) {
  const owner = await member(pool, '離頁本人'), requester = await member(pool, '邀請夥伴');
  const [low, high] = [owner.id, requester.id].sort();
  await pool.query(`INSERT INTO member_friendships(community_id,low_ref,high_ref,requester_ref,state)
    SELECT community_id,$1,$2,$3,'pending' FROM users WHERE user_id=$3`, [low, high, requester.id]);
  return { owner, requester };
}
async function relation(pool: Pool, owner: Member, requester: Member) {
  const [low, high] = [owner.id, requester.id].sort();
  return (await pool.query('SELECT state, aggregate_version::int AS version FROM member_friendships WHERE low_ref=$1 AND high_ref=$2', [low, high])).rows[0];
}
async function openInvitation(page: Page, owner: Member, requester: Member) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('電子郵件', { exact: true }).fill(owner.email);
  await page.getByLabel('密碼', { exact: true }).fill('freedom-local-demo');
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page.getByRole('heading', { name: '動態', level: 1, exact: true })).toBeVisible();
  await navigate(page, '我的好友');
  await panel(page).getByRole('button', { name: '收到的邀請', exact: true }).click();
  const row = panel(page).locator('.directory-member').filter({ has: page.getByRole('heading', { name: requester.nickname, exact: true }) });
  await expect(row).toBeVisible();
  return row.getByRole('button', { name: '接受邀請', exact: true });
}
function record(route: Route): Command {
  const request = route.request(), headers = request.headers();
  return { url: request.url(), body: request.postData(), key: headers['idempotency-key'], version: headers['if-match'] };
}
function assertOriginal(commands: Command[]) {
  expect(commands).toHaveLength(2);
  expect(commands[0].key).toBeTruthy();
  expect(commands[0].version).toBe('"1"');
  expect(JSON.parse(commands[0].body!)).toEqual({});
  expect(commands[1]).toEqual(commands[0]);
}
async function canonical(route: Route) {
  const response = await route.fetch({ maxRetries: 0 });
  try {
    expect(response.ok()).toBe(true);
    expect(await response.json()).toMatchObject({ state: 'accepted', aggregate_version: expect.anything() });
    await route.fulfill({ response });
  } finally { await response.dispose(); }
}
// Only the exact same-origin POST is intercepted. The first request really
// commits, but its response is lost; recovery must replay its original command.
async function loseFirstAck(page: Page, requester: Member, commands: Command[]) {
  const url = new URL(`/api/v1/friends/${requester.id}/accept`, page.url()).href;
  await page.route(url, async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    commands.push(record(route));
    if (commands.length !== 1) return canonical(route);
    const response = await route.fetch({ maxRetries: 0 });
    try {
      expect(response.ok()).toBe(true);
      expect(await response.json()).toMatchObject({ state: 'accepted', aggregate_version: expect.anything() });
      await route.abort('failed');
    } finally { await response.dispose(); }
  });
}

// Fixtures own the disposable schema and page/context lifetime. Every route and
// held gate below is released in finally, including when an assertion fails.
test('mobile unknown invitation blocks find-partners navigation and canonical original retry releases it', async ({ page, e2eAuthPool }) => {
  const { owner, requester } = await invitation(e2eAuthPool), commands: Command[] = [];
  try {
    const accept = await openInvitation(page, owner, requester);
    await loseFirstAck(page, requester, commands);
    await accept.click();
    await expect(retry(page)).toBeEnabled();
    const originalUrl = page.url();
    await panel(page).getByRole('button', { name: '找新夥伴', exact: true }).click();
    await expect(page).toHaveURL(originalUrl);
    await expect(panel(page)).toBeVisible();
    await expect(retry(page)).toBeEnabled();
    await expect(accept).toBeDisabled();
    expect(commands).toHaveLength(1);
    expect(await relation(e2eAuthPool, owner, requester)).toEqual({ state: 'accepted', version: 2 });
    await retry(page).click();
    await expect(panel(page).getByText(`已和${requester.nickname}成為好友。`, { exact: true })).toBeVisible();
    await expect(retry(page)).toHaveCount(0);
    assertOriginal(commands);
    expect(await relation(e2eAuthPool, owner, requester)).toEqual({ state: 'accepted', version: 2 });
    await panel(page).getByRole('button', { name: '找新夥伴', exact: true }).click();
    await expect(page).toHaveURL(/#explore\/people$/);
    await expect(page.getByRole('heading', { name: '探索', level: 1, exact: true })).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
  } finally { await page.unrouteAll({ behavior: 'wait' }); }
});

test('pending invitation blocks global home until the original POST settles', async ({ page, e2eAuthPool }) => {
  const { owner, requester } = await invitation(e2eAuthPool), commands: Command[] = [], held = barrier();
  try {
    const accept = await openInvitation(page, owner, requester);
    const url = new URL(`/api/v1/friends/${requester.id}/accept`, page.url()).href;
    await page.route(url, async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      commands.push(record(route));
      await held.promise;
      await canonical(route);
    });
    await accept.click();
    await expect.poll(() => commands.length).toBe(1);
    const originalUrl = page.url();
    await home(page).click();
    await expect(page).toHaveURL(originalUrl);
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByText('正在接受邀請，請稍候…', { exact: true })).toBeVisible();
    expect(await relation(e2eAuthPool, owner, requester)).toEqual({ state: 'pending', version: 1 });
    expect(commands).toHaveLength(1);
    held.release();
    await expect(panel(page).getByText(`已和${requester.nickname}成為好友。`, { exact: true })).toBeVisible();
    await home(page).click();
    await expect(page).toHaveURL(/#home$/);
    await expect(page.getByRole('heading', { name: '動態', level: 1, exact: true })).toBeVisible();
    expect(commands).toHaveLength(1);
  } finally { held.release(); await page.unrouteAll({ behavior: 'wait' }); }
});

test('canonical ACK permits home navigation while only its directory refresh is held', async ({ page, e2eAuthPool }) => {
  const { owner, requester } = await invitation(e2eAuthPool), held = barrier();
  let readsHeld = 0;
  try {
    const accept = await openInvitation(page, owner, requester);
    const origin = new URL(page.url()).origin;
    await page.route(url => url.origin === origin && url.pathname === directoryPath, async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      readsHeld++;
      await held.promise;
      // Leaving the page intentionally cancels this pure read.
      try { await route.continue(); } catch (cause) { if (!route.request().failure()) throw cause; }
    });
    await accept.click();
    await expect(panel(page).getByText(`已和${requester.nickname}成為好友。`, { exact: true })).toBeVisible();
    await expect.poll(() => readsHeld).toBe(1);
    await expect(panel(page).getByRole('region', { name: '好友名單結果', exact: true })).toHaveAttribute('aria-busy', 'true');
    await expect(retry(page)).toHaveCount(0);
    expect(await relation(e2eAuthPool, owner, requester)).toEqual({ state: 'accepted', version: 2 });
    await home(page).click();
    await expect(page).toHaveURL(/#home$/);
    await expect(page.getByRole('heading', { name: '動態', level: 1, exact: true })).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
    held.release();
    await page.unrouteAll({ behavior: 'wait' });
    await expect(page).toHaveURL(/#home$/);
  } finally { held.release(); await page.unrouteAll({ behavior: 'wait' }); }
});

test('mobile chat overlay opens and closes without losing an unknown original invitation', async ({ page, e2eAuthPool }) => {
  const { owner, requester } = await invitation(e2eAuthPool), commands: Command[] = [];
  try {
    const accept = await openInvitation(page, owner, requester);
    await loseFirstAck(page, requester, commands);
    await accept.click();
    await expect(retry(page)).toBeEnabled();
    const originalUrl = page.url();
    await openChat(page);
    await expect(page.locator('#floating-message-panel')).toBeVisible();
    await expect(panel(page)).toHaveCount(1);
    expect(commands).toHaveLength(1);
    await closeChat(page);
    await expect(page).toHaveURL(originalUrl);
    await expect(retry(page)).toBeEnabled();
    await expect(accept).toBeDisabled();
    await home(page).click();
    await expect(page).toHaveURL(originalUrl);
    await expect(retry(page)).toBeEnabled();
    await retry(page).click();
    await expect(panel(page).getByText(`已和${requester.nickname}成為好友。`, { exact: true })).toBeVisible();
    assertOriginal(commands);
    await home(page).click();
    await expect(page.getByRole('heading', { name: '動態', level: 1, exact: true })).toBeVisible();
  } finally { await page.unrouteAll({ behavior: 'wait' }); }
});

test('known initial 422 does not lock navigation or carry a recovery command into the next visit', async ({ page, e2eAuthPool }) => {
  const { owner, requester } = await invitation(e2eAuthPool), commands: Command[] = [];
  try {
    const accept = await openInvitation(page, owner, requester);
    const url = new URL(`/api/v1/friends/${requester.id}/accept`, page.url()).href;
    await page.route(url, async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      commands.push(record(route));
      await route.fulfill({ status: 422, contentType: 'application/problem+json', json: { type: 'urn:freedom:problem:validation_failed', title: 'validation_failed', status: 422, code: 'validation_failed', detail: '測試：這次邀請無法接受。' } });
    });
    await accept.click();
    await expect(panel(page).getByRole('alert')).toContainText('測試：這次邀請無法接受。');
    await expect(retry(page)).toHaveCount(0);
    await expect(accept).toBeEnabled();
    await home(page).click();
    await expect(page.getByRole('heading', { name: '動態', level: 1, exact: true })).toBeVisible();
    await navigate(page, '我的好友');
    await panel(page).getByRole('button', { name: '收到的邀請', exact: true }).click();
    await expect(panel(page).getByRole('button', { name: '接受邀請', exact: true })).toBeEnabled();
    await expect(retry(page)).toHaveCount(0);
    expect(commands).toHaveLength(1);
    expect(await relation(e2eAuthPool, owner, requester)).toEqual({ state: 'pending', version: 1 });
    await panel(page).getByRole('button', { name: '找新夥伴', exact: true }).click();
    await expect(page).toHaveURL(/#explore\/people$/);
  } finally { await page.unrouteAll({ behavior: 'wait' }); }
});
