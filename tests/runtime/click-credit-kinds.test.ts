import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { migrate } from '../../scripts/database.js';
import { seedLocal, DEMO_COMMUNITY, DEMO_USERS, DEMO_PASSWORD } from '../../packages/testing/seed.js';
import type { Actor } from '../../modules/identity-membership/service.js';
import { createPromotionLink, creditPromotionClick } from '../../modules/community/promotion.js';
import { saveMemberShare } from '../../modules/identity-membership/member-sharing.js';
import { accountView, emptyContacts, saveAccount } from '../../modules/identity-membership/members.js';
import { createShare } from '../../modules/shares/service.js';

const url = process.env.TEST_DATABASE_URL;
assert.ok(url, 'An explicitly provisioned disposable TEST_DATABASE_URL is required');
const schema = `fp_click_credit_kinds_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: url });
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
const actors: Actor[] = [];
const day1 = new Date('2026-11-14T04:00:00Z');
const day2 = new Date('2026-11-15T04:00:00Z');

async function creditUnits(shareId: string, userId: string) {
  const row = (await pool.query(
    `SELECT coalesce(sum(units),0)::int AS n FROM share_credit_events
     WHERE share_id=$1 AND user_id=$2 AND role='spreader' AND basis='qualified_click_day'`,
    [shareId, userId],
  )).rows[0];
  return row.n as number;
}

before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
  await seedLocal(pool);
  for (let i = 0; i < 3; i++) {
    const id = randomUUID();
    const session = randomUUID();
    await pool.query(
      `INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,active,onboarding_required)
       SELECT $1,community_id,$2,$3,password_hash,$4,true,false FROM users WHERE user_id=$5`,
      [id, `click-kinds-${i}@example.com`, `測試夥伴${i}`, randomUUID(), DEMO_USERS[0].user_id],
    );
    await pool.query(
      `INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$1,now()+interval '1 day')`,
      [session, id],
    );
    actors.push({ user_id: id, community_id: DEMO_COMMUNITY, session_hash: session } as Actor);
  }
});

after(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

test('platform link click creates community platform share and grants one spreader credit per Taipei day', async () => {
  const owner = actors[0];
  const visitor = actors[1];
  const workshopLink = await createPromotionLink(pool, owner, { kind: 'platform', target: 'workshop' });
  const testerMapLink = await createPromotionLink(pool, owner, { kind: 'platform', target: 'tester-map' });

  // Self-click and bot click must grant nothing and not credit.
  await creditPromotionClick(pool, { code: workshopLink.code, userAgent: 'Mozilla/5.0', network: 'net-self', sessionUserId: owner.user_id, now: day1 });
  await creditPromotionClick(pool, { code: workshopLink.code, userAgent: 'Googlebot/2.1', network: 'net-bot', sessionUserId: null, now: day1 });
  assert.equal((await pool.query(`SELECT 1 FROM shares WHERE community_id=$1 AND kind='link' AND canonical_key='platform'`, [DEMO_COMMUNITY])).rowCount, 0);

  // First qualified click creates the platform share and grants 1 credit.
  await creditPromotionClick(pool, { code: workshopLink.code, userAgent: 'Mozilla/5.0', network: 'net-1', sessionUserId: visitor.user_id, now: day1 });
  const share = (await pool.query(
    `SELECT share_id,kind,canonical_key,canonical_url,title,first_sharer_user_id,state
     FROM shares WHERE community_id=$1 AND kind='link' AND canonical_key='platform'`,
    [DEMO_COMMUNITY],
  )).rows[0];
  assert.ok(share);
  assert.equal(share.kind, 'link');
  assert.equal(share.canonical_key, 'platform');
  assert.equal(share.canonical_url, '/');
  assert.equal(share.title, '自由工坊');
  assert.equal(share.first_sharer_user_id, null);
  assert.equal(share.state, 'published');
  assert.equal(await creditUnits(share.share_id, owner.user_id), 1);

  const event = (await pool.query(
    `SELECT role,basis,units,source_ref,actor_user_id FROM share_credit_events WHERE share_id=$1 AND user_id=$2`,
    [share.share_id, owner.user_id],
  )).rows[0];
  assert.equal(event.role, 'spreader');
  assert.equal(event.basis, 'qualified_click_day');
  assert.equal(event.units, 1);
  assert.equal(event.source_ref, `click:${share.share_id}:${owner.user_id}:2026-11-14`);
  assert.equal(event.actor_user_id, visitor.user_id);

  // Second qualified click on the same Taipei day (even via tester-map link and different visitor) grants nothing more.
  await creditPromotionClick(pool, { code: testerMapLink.code, userAgent: 'Mozilla/5.0', network: 'net-2', sessionUserId: actors[2].user_id, now: day1 });
  assert.equal(await creditUnits(share.share_id, owner.user_id), 1);

  // Next Taipei day grants 1 more credit.
  await creditPromotionClick(pool, { code: workshopLink.code, userAgent: 'Mozilla/5.0', network: 'net-1', sessionUserId: visitor.user_id, now: day2 });
  assert.equal(await creditUnits(share.share_id, owner.user_id), 2);
});

test('member_card link click creates owner card share and grants one spreader credit per Taipei day', async () => {
  const owner = actors[0];
  const visitor = actors[1];
  const saved = await saveMemberShare(pool, {
    actor: owner,
    operation: 'member.share.save',
    key: randomUUID(),
    body: { enabled: true, include_avatar: true },
  });
  assert.ok(saved.share_path);
  const cardLink = await createPromotionLink(pool, owner, { kind: 'member_card', target: owner.user_id });

  // Self-click and bot click must grant nothing.
  await creditPromotionClick(pool, { code: cardLink.code, userAgent: 'Mozilla/5.0', network: 'net-self', sessionUserId: owner.user_id, now: day1 });
  await creditPromotionClick(pool, { code: cardLink.code, userAgent: 'Slackbot-LinkExpanding 1.0', network: 'net-bot', sessionUserId: null, now: day1 });
  assert.equal((await pool.query(`SELECT 1 FROM shares WHERE community_id=$1 AND kind='link' AND canonical_key=$2`, [DEMO_COMMUNITY, `member-card:${owner.user_id}`])).rowCount, 0);

  // First qualified click creates the card share and grants 1 credit.
  await creditPromotionClick(pool, { code: cardLink.code, userAgent: 'Mozilla/5.0', network: 'net-1', sessionUserId: visitor.user_id, now: day1 });
  const share = (await pool.query(
    `SELECT share_id,kind,canonical_key,canonical_url,title,first_sharer_user_id,state
     FROM shares WHERE community_id=$1 AND kind='link' AND canonical_key=$2`,
    [DEMO_COMMUNITY, `member-card:${owner.user_id}`],
  )).rows[0];
  assert.ok(share);
  assert.equal(share.kind, 'link');
  assert.equal(share.canonical_key, `member-card:${owner.user_id}`);
  assert.equal(share.canonical_url, saved.share_path);
  assert.equal(share.title, '測試夥伴0');
  assert.equal(share.first_sharer_user_id, owner.user_id);
  assert.equal(share.state, 'published');
  assert.equal(await creditUnits(share.share_id, owner.user_id), 1);

  const event = (await pool.query(
    `SELECT role,basis,units,source_ref,actor_user_id FROM share_credit_events WHERE share_id=$1 AND user_id=$2`,
    [share.share_id, owner.user_id],
  )).rows[0];
  assert.equal(event.role, 'spreader');
  assert.equal(event.basis, 'qualified_click_day');
  assert.equal(event.units, 1);
  assert.equal(event.source_ref, `click:${share.share_id}:${owner.user_id}:2026-11-14`);
  assert.equal(event.actor_user_id, visitor.user_id);

  // Second click same Taipei day gives nothing more.
  await creditPromotionClick(pool, { code: cardLink.code, userAgent: 'Mozilla/5.0', network: 'net-2', sessionUserId: actors[2].user_id, now: day1 });
  assert.equal(await creditUnits(share.share_id, owner.user_id), 1);

  // Next Taipei day gives 1 more credit.
  await creditPromotionClick(pool, { code: cardLink.code, userAgent: 'Mozilla/5.0', network: 'net-1', sessionUserId: visitor.user_id, now: day2 });
  assert.equal(await creditUnits(share.share_id, owner.user_id), 2);
});

test('rotating card token and changing nickname update existing card share canonical_url and title only when share exists', async () => {
  const owner = actors[2];
  const visitor = actors[1];
  const key = `member-card:${owner.user_id}`;

  const firstSave = await saveMemberShare(pool, {
    actor: owner,
    operation: 'member.share.save',
    key: randomUUID(),
    body: { enabled: true, include_avatar: true },
  });
  const acc0 = await accountView(pool, owner);
  const acc1 = await saveAccount(pool, {
    actor: owner,
    operation: 'member.account.save',
    key: randomUUID(),
    expected: acc0.aggregate_version,
    body: { nickname: '未建立分享前暱稱', contacts: emptyContacts() },
  });
  const rotatedBeforeClick = await saveMemberShare(pool, {
    actor: owner,
    operation: 'member.share.save',
    key: randomUUID(),
    expected: firstSave.aggregate_version,
    body: { enabled: true, include_avatar: true, rotate: true },
  });
  assert.equal((await pool.query(`SELECT 1 FROM shares WHERE community_id=$1 AND kind='link' AND canonical_key=$2`, [DEMO_COMMUNITY, key])).rowCount, 0);

  const link = await createPromotionLink(pool, owner, { kind: 'member_card', target: owner.user_id });
  await creditPromotionClick(pool, { code: link.code, userAgent: 'Mozilla/5.0', network: 'net-i2', sessionUserId: visitor.user_id, now: day1 });
  const initialShare = (await pool.query(
    `SELECT share_id, canonical_url, title FROM shares WHERE community_id=$1 AND kind='link' AND canonical_key=$2`,
    [DEMO_COMMUNITY, key],
  )).rows[0];
  assert.equal(initialShare.canonical_url, rotatedBeforeClick.share_path);
  assert.equal(initialShare.title, '未建立分享前暱稱');

  const rotatedAfterClick = await saveMemberShare(pool, {
    actor: owner,
    operation: 'member.share.save',
    key: randomUUID(),
    expected: rotatedBeforeClick.aggregate_version,
    body: { enabled: true, include_avatar: true, rotate: true },
  });
  assert.notEqual(rotatedAfterClick.share_path, rotatedBeforeClick.share_path);
  await saveAccount(pool, {
    actor: owner,
    operation: 'member.account.save',
    key: randomUUID(),
    expected: acc1.aggregate_version,
    body: { nickname: '已改名工坊夥伴', contacts: emptyContacts() },
  });

  const updatedShare = (await pool.query(
    `SELECT canonical_url, title FROM shares WHERE share_id=$1`,
    [initialShare.share_id],
  )).rows[0];
  assert.equal(updatedShare.canonical_url, rotatedAfterClick.share_path);
  assert.equal(updatedShare.title, '已改名工坊夥伴');
});

test('platform and member_card shares never appear in GET /api/v1/shares', async () => {
  const { createApp } = await import('../../apps/platform-api/src/app.js');
  const normalShare = await createShare(
    pool,
    { actor: actors[0], operation: 'POST /shares', key: randomUUID(), body: { url: 'https://example.com/feed-item' } },
    { previewFetch: async () => new Response('<title>公開連結分享</title>', { headers: { 'content-type': 'text/html' } }) },
  );
  const origin = 'http://127.0.0.1:46502';
  const app = createApp(pool, origin, 'local');
  const login = await app.request(`${origin}/api/v1/auth/login`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: DEMO_USERS[0].email, password: DEMO_PASSWORD }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];

  const feedRes = await app.request(`${origin}/api/v1/shares?limit=50`, { headers: { Cookie: cookie } });
  assert.equal(feedRes.status, 200);
  const feed = await feedRes.json() as { items: Array<{ share_id: string; title: string }> };
  const ids = new Set(feed.items.map(item => item.share_id));
  assert.ok(ids.has(normalShare.share_id));

  const hiddenIds = (await pool.query(
    `SELECT share_id FROM shares WHERE community_id=$1 AND kind='link' AND (canonical_key='platform' OR canonical_key LIKE 'member-card:%')`,
    [DEMO_COMMUNITY],
  )).rows.map(r => r.share_id as string);
  assert.ok(hiddenIds.length >= 2);
  for (const id of hiddenIds) {
    assert.equal(ids.has(id), false, `share ${id} must not appear in /api/v1/shares`);
  }
});
