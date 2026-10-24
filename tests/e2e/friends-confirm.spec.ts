import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { navigate } from './navigation.js';
import { test, expect, type Page } from './fixtures.js';

type Member = { id: string; email: string; nickname: string };

async function member(pool: Pool, label: string): Promise<Member> {
  const id = randomUUID(), email = `friends-confirm-${id}@local.test`, nickname = `${label}${id.slice(0, 8)}`;
  await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,onboarding_required)
    SELECT $1,community_id,$2,$3,password_hash,$4,false FROM users WHERE email='maker@local.test'`, [id, email, nickname, randomUUID()]);
  return { id, email, nickname };
}

async function friendship(pool: Pool, requester: Member, other: Member, state: 'pending' | 'accepted') {
  const [low, high] = [requester.id, other.id].sort();
  await pool.query(`INSERT INTO member_friendships(community_id,low_ref,high_ref,requester_ref,state)
    SELECT community_id,$1,$2,$3,$4 FROM users WHERE user_id=$3`, [low, high, requester.id, state]);
}

async function login(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('電子郵件', { exact: true }).fill(email);
  await page.getByLabel('密碼', { exact: true }).fill('freedom-local-demo');
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page.getByRole('button', { name: '設定', exact: true })).toBeVisible();
}

const state = async (pool: Pool, a: Member, b: Member) => {
  const [low, high] = [a.id, b.id].sort();
  return (await pool.query('SELECT state, aggregate_version::int AS v FROM member_friendships WHERE low_ref=$1 AND high_ref=$2', [low, high])).rows[0] as { state: string; v: number };
};

test('removing a friend and declining a request ask first, and cancelling writes nothing', async ({ page, e2eAuthPool }) => {
  test.setTimeout(120_000);
  const [owner, friend, requester] = [await member(e2eAuthPool, '本人'), await member(e2eAuthPool, '好友'), await member(e2eAuthPool, '邀請者')];
  await friendship(e2eAuthPool, friend, owner, 'accepted');
  await friendship(e2eAuthPool, requester, owner, 'pending');
  const writes: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && /\/api\/v1\/friends\/[^/]+\/(remove|accept)$/.test(request.url())) writes.push(new URL(request.url()).pathname); });
  await login(page, owner.email);
  await navigate(page, '我的好友');
  const row = (person: Member) => page.locator('.friends-panel .directory-member').filter({ has: page.getByRole('heading', { name: person.nickname, exact: true }) });

  // Remove: the first press only opens the confirmation; cancelling returns focus and sends nothing.
  const remove = row(friend).getByRole('button', { name: '移除好友', exact: true });
  await remove.focus();
  await page.keyboard.press('Enter');
  await expect(remove).toHaveAttribute('aria-expanded', 'true');
  const removeGroup = row(friend).getByRole('group', { name: `移除好友「${friend.nickname}」`, exact: true });
  await expect(removeGroup).toContainText('移除後對方不會收到通知；之後要重新送出邀請並由對方接受，才能再成為好友。');
  await removeGroup.getByRole('button', { name: '取消', exact: true }).click();
  await expect(removeGroup).toBeHidden();
  await expect(remove).toBeFocused();
  await expect(remove).toHaveAttribute('aria-expanded', 'false');
  expect(writes).toEqual([]);
  expect(await state(e2eAuthPool, owner, friend)).toEqual({ state: 'accepted', v: 1 });

  // Confirming removes exactly once.
  await remove.click();
  await removeGroup.getByRole('button', { name: '確定移除', exact: true }).click();
  await expect(page.getByText('好友關係或邀請已移除。')).toBeVisible();
  expect(writes).toEqual([`/api/v1/friends/${friend.id}/remove`]);
  expect(await state(e2eAuthPool, owner, friend)).toEqual({ state: 'removed', v: 2 });
  await expect(row(friend)).toHaveCount(0);

  // Decline: same two steps; only the confirmed decline notifies the requester.
  await page.getByRole('button', { name: '收到的邀請', exact: true }).click();
  const decline = row(requester).getByRole('button', { name: '婉拒', exact: true });
  await decline.click();
  const declineGroup = row(requester).getByRole('group', { name: `婉拒「${requester.nickname}」`, exact: true });
  await expect(declineGroup).toContainText('婉拒後對方會收到通知，這則通知無法收回。');
  await declineGroup.getByRole('button', { name: '取消', exact: true }).click();
  await expect(decline).toBeFocused();
  expect(writes).toHaveLength(1);
  const notices = async () => (await e2eAuthPool.query(`SELECT count(*)::int AS n FROM member_notifications WHERE recipient_ref=$1 AND kind='friend_declined'`, [requester.id])).rows[0].n;
  expect(await notices()).toBe(0);
  await decline.click();
  await declineGroup.getByRole('button', { name: '確定婉拒', exact: true }).click();
  await expect(page.getByText('好友關係或邀請已移除。')).toBeVisible();
  expect(writes).toEqual([`/api/v1/friends/${friend.id}/remove`, `/api/v1/friends/${requester.id}/remove`]);
  expect(await state(e2eAuthPool, owner, requester)).toEqual({ state: 'removed', v: 2 });
  expect(await notices()).toBe(1);

  // Accepting stays a single step.
  const third = await member(e2eAuthPool, '新邀請');
  await friendship(e2eAuthPool, third, owner, 'pending');
  await page.getByRole('button', { name: '收到的邀請', exact: true }).click();
  await row(third).getByRole('button', { name: '接受邀請', exact: true }).click();
  await expect(page.getByText(`已和${third.nickname}成為好友。`)).toBeVisible();
  expect(await state(e2eAuthPool, owner, third)).toEqual({ state: 'accepted', v: 2 });

  for (const theme of ['light', 'dark', 'versefolk'] as const) {
    await page.evaluate(value => { localStorage.setItem('freedom-theme', value); document.documentElement.dataset.theme = value; }, theme);
    await page.getByRole('button', { name: '我的好友', exact: true }).click();
    const thirdRemove = row(third).getByRole('button', { name: '移除好友', exact: true });
    await thirdRemove.click();
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await row(third).screenshot({ path: `test-results/friends-confirm-${theme}-${width}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    }
    await row(third).getByRole('button', { name: '取消', exact: true }).click();
  }
  expect(await state(e2eAuthPool, owner, third)).toEqual({ state: 'accepted', v: 2 });
});

test('an open confirmation closes when the visible result set changes by search or paging', async ({ page, e2eAuthPool }) => {
  test.setTimeout(120_000);
  const owner = await member(e2eAuthPool, '本人');
  const friends: Member[] = [];
  for (let n = 0; n < 21; n++) {
    const friend = await member(e2eAuthPool, `分頁好友${String(n).padStart(2, '0')}`);
    await friendship(e2eAuthPool, friend, owner, 'accepted');
    friends.push(friend);
  }
  const writes: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && /\/api\/v1\/friends\//.test(request.url())) writes.push(request.url()); });
  await login(page, owner.email);
  await navigate(page, '我的好友');
  const rows = page.locator('.friends-panel .directory-member');
  await expect(rows.first()).toBeVisible();
  const openConfirmation = async () => {
    const remove = rows.first().getByRole('button', { name: '移除好友', exact: true });
    await remove.click();
    await expect(remove).toHaveAttribute('aria-expanded', 'true');
    return (await rows.first().getByRole('heading').first().textContent())!.trim();
  };
  const anyOpen = () => page.locator('.friends-panel [aria-expanded="true"]');

  // Paging away and back: the confirmation does not reappear on the same person.
  const first = await openConfirmation();
  await page.getByRole('button', { name: '下一頁好友', exact: true }).click();
  await expect(page.getByText('第 2 頁')).toBeVisible();
  await expect(anyOpen()).toHaveCount(0);
  await page.getByRole('button', { name: '上一頁好友', exact: true }).click();
  await expect(page.getByText('第 1 頁')).toBeVisible();
  await expect(rows.filter({ has: page.getByRole('heading', { name: first, exact: true }) })).toBeVisible();
  await expect(anyOpen()).toHaveCount(0);

  // A search that still shows the same person also starts closed.
  const named = await openConfirmation();
  await page.getByLabel('搜尋好友名稱', { exact: true }).fill(named);
  await page.getByRole('button', { name: '搜尋好友', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(anyOpen()).toHaveCount(0);
  expect(writes).toEqual([]);
  const [low, high] = [owner.id, friends[0].id].sort();
  expect((await e2eAuthPool.query('SELECT state FROM member_friendships WHERE low_ref=$1 AND high_ref=$2', [low, high])).rows[0].state).toBe('accepted');
});
