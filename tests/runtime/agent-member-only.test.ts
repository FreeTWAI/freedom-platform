import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createApp } from '../../apps/platform-api/src/app.js';
import { readShowcaseSharing, setShowcaseSharing } from '../../modules/opportunity-project-work/public-sharing.js';
import { migrate } from '../../scripts/database.js';
import { DEMO_PASSWORD, DEMO_USERS, seedLocal } from '../../packages/testing/seed.js';
import { Problem } from '../../packages/shared/problem.js';

const origin = 'http://127.0.0.1:4310';
const url = process.env.TEST_DATABASE_URL!;
assert.ok(url?.includes('/fp_'), 'explicit isolated database required');
const schema = `fp_member_only_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: url });
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 12 });
const app = createApp(pool, origin, 'local', {
  personalContentEnabled: true,
  eventParticipationEnabled: true,
  socialAchievementsEnabled: true,
});

before(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await migrate(pool); });
after(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
beforeEach(async () => { await pool.query('TRUNCATE communities,login_attempts,auth_rate_limits CASCADE'); await seedLocal(pool); });

type Session = { cookie: string; csrf: string; user: any };

async function req(path: string, opts: {
  session?: Session; token?: string; body?: unknown; rawBody?: Uint8Array;
  method?: string; headers?: Record<string, string>;
} = {}) {
  const { session, token, body, rawBody, method = body === undefined && rawBody === undefined ? 'GET' : 'POST' } = opts;
  const headers: Record<string, string> = {
    ...(session ? { Origin: origin, Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...opts.headers,
  };
  if (body !== undefined) {
    headers['Content-Type'] ??= 'application/json';
    headers['Idempotency-Key'] ??= randomUUID();
  } else if (rawBody !== undefined) {
    headers['Idempotency-Key'] ??= randomUUID();
  }
  const requestBody = rawBody !== undefined ? Buffer.from(rawBody) : body === undefined ? undefined : JSON.stringify(body);
  const response = await app.request(origin + path, { method, headers, body: requestBody });
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function loginWithCookie(index = 0): Promise<Session> {
  const response = await app.request(origin + '/api/v1/auth/login', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ email: DEMO_USERS[index].email, password: DEMO_PASSWORD }),
  });
  assert.equal(response.status, 200);
  const data = await response.json() as any;
  await pool.query('UPDATE users SET onboarding_completed_at=now() WHERE user_id=$1', [data.user.user_id]);
  return { cookie: response.headers.get('set-cookie')!.split(';')[0], csrf: data.csrf_token, user: data.user };
}

async function issueAllScopes(session: Session): Promise<string> {
  const r = await req('/api/v1/me/agent-tokens', {
    session,
    body: { name: '全權限測試 Agent', scopes: ['read', 'share', 'rsvp', 'react'] },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.access_token as string;
}

test('member-only routes and private message routes return 403 scope_required for all-scopes agent tokens without modifying the database', async () => {
  const owner = await loginWithCookie(0);
  const peer = await loginWithCookie(1);

  const showcaseRes = await req('/api/v1/showcases', {
    session: owner,
    body: { title: '本人作品', description: '作品介紹', public_url: 'https://example.com/work', consent_to_share: true },
  });
  assert.equal(showcaseRes.status, 201, JSON.stringify(showcaseRes.data));
  const showcaseId = showcaseRes.data.showcase_id as string;

  const postRes = await req('/api/v1/social-posts/notes', { session: owner, body: { text: '本人貼文' } });
  assert.equal(postRes.status, 201, JSON.stringify(postRes.data));
  const postId = postRes.data.post_id as string;

  const serviceRes = await req('/api/v1/member-services', {
    session: owner,
    body: {
      title: '本人服務', category: 'tech', summary: '服務摘要', service_mode: 'online',
      contacts: [{ label: '網站', url: 'https://example.com/svc' }],
    },
  });
  assert.equal(serviceRes.status, 201, JSON.stringify(serviceRes.data));
  const serviceId = serviceRes.data.service_id as string;

  const dmRes = await req(`/api/v1/me/conversations/${peer.user.user_id}/messages`, {
    session: owner,
    body: { body: '本人私訊內容' },
  });
  assert.equal(dmRes.status, 201, JSON.stringify(dmRes.data));
  const dmId = dmRes.data.message_id as string;

  const joinGuild = await req('/api/v1/guilds/guild_ai_vibe/join', { session: owner, body: {} });
  assert.equal(joinGuild.status, 200, JSON.stringify(joinGuild.data));
  const chanRes = await req('/api/v1/me/channels/guild/guild_ai_vibe/messages', {
    session: owner,
    body: { body: '本人頻道訊息' },
  });
  assert.equal(chanRes.status, 201, JSON.stringify(chanRes.data));
  const chanMsgId = chanRes.data.message_id as string;

  const snapshot = async () => (await pool.query(`
    SELECT
      (SELECT count(*)::int FROM showcases) AS showcases,
      (SELECT count(*)::int FROM work_public_publications) AS work_sharing,
      (SELECT count(*)::int FROM community_social_publications) AS post_sharing,
      (SELECT count(*)::int FROM community_social_thumbnail_asset_targets) AS post_thumbs,
      (SELECT count(*)::int FROM member_service_cover_asset_targets) AS service_covers,
      (SELECT count(*)::int FROM asset_objects) AS asset_objects,
      (SELECT count(*)::int FROM positioning_profiles) AS positioning_profiles,
      (SELECT count(*)::int FROM member_profile_publications) AS member_profiles,
      (SELECT count(*)::int FROM member_direct_messages) AS direct_messages,
      (SELECT count(*)::int FROM member_channel_messages) AS channel_messages,
      (SELECT count(*)::int FROM member_channel_reads) AS channel_reads,
      (SELECT count(*)::int FROM transition_journal) AS journals,
      (SELECT count(*)::int FROM command_receipts) AS receipts,
      (SELECT count(*)::int FROM agent_publications) AS agent_pubs,
      (SELECT count(*)::int FROM member_accounts) AS member_accounts,
      (SELECT display_name FROM users WHERE user_id = $1) AS user_sig,
      (SELECT state || ':' || edit_revision::text FROM community_social_posts WHERE post_id = $2) AS post_sig,
      (SELECT state || ':' || aggregate_version::text FROM member_services WHERE service_id = $3) AS service_sig,
      (SELECT read_at::text || ':' || COALESCE(retracted_at::text, '') FROM member_direct_messages WHERE message_id = $4) AS dm_sig,
      (SELECT retracted_at::text FROM member_channel_messages WHERE message_id = $5) AS chan_retracted
  `, [owner.user.user_id, postId, serviceId, dmId, chanMsgId])).rows[0];

  const beforeSnap = await snapshot();
  const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const cases: Array<{ label: string; method: string; path: string; body?: unknown; rawBody?: Uint8Array; headers?: Record<string, string> }> = [
    { label: 'GET work sharing', method: 'GET', path: `/api/v1/me/showcases/${showcaseId}/sharing` },
    { label: 'PUT work sharing', method: 'PUT', path: `/api/v1/me/showcases/${showcaseId}/sharing`, body: { enabled: true }, headers: { 'If-Match': '"1"' } },
    { label: 'POST social post public-sharing', method: 'POST', path: `/api/v1/social-posts/${postId}/public-sharing`, body: { enabled: true }, headers: { 'If-Match': `"${postRes.data.revision}"` } },
    { label: 'GET account', method: 'GET', path: '/api/v1/me/account' },
    { label: 'POST account', method: 'POST', path: '/api/v1/me/account', body: { nickname: '被改名', identity_label: null, contacts: { discord: '', github: '', line: '', email: { audiences: [] } } }, headers: { 'If-Match': '"1"' } },
    { label: 'POST positioning', method: 'POST', path: '/api/v1/me/positioning', body: { real_world_occupations: ['工程師'], background: '背景', strengths: ['開發'], goals: '目標', weekly_minutes: 60, desired_roles: ['creator'], selected_tracks: ['open_source_developer'], confirmed: true } },
    { label: 'POST profile-publication', method: 'POST', path: '/api/v1/me/profile-publication', body: { visibility: 'private', display_name: '公開名', bio: '', links: [] } },
    { label: 'PUT social post thumbnail', method: 'PUT', path: `/api/v1/social-posts/${postId}/thumbnail`, rawBody: fakePng, headers: { 'Content-Type': 'image/png' } },
    { label: 'PUT member service cover', method: 'PUT', path: `/api/v1/member-services/${serviceId}/cover`, rawBody: fakePng, headers: { 'Content-Type': 'image/png' } },
    { label: 'POST comment-images', method: 'POST', path: `/api/v1/social-posts/${postId}/comment-images`, rawBody: fakePng, headers: { 'Content-Type': 'image/png' } },
    { label: 'POST social post hide', method: 'POST', path: `/api/v1/social-posts/${postId}/hide`, body: {} },
    { label: 'POST member service hide', method: 'POST', path: `/api/v1/member-services/${serviceId}/hide`, body: {} },
    { label: 'GET conversations', method: 'GET', path: '/api/v1/me/conversations' },
    { label: 'GET conversation activity', method: 'GET', path: `/api/v1/me/conversations/${peer.user.user_id}/activity` },
    { label: 'GET conversation messages', method: 'GET', path: `/api/v1/me/conversations/${peer.user.user_id}/messages` },
    { label: 'GET conversation receipts', method: 'GET', path: `/api/v1/me/conversations/${peer.user.user_id}/receipts?message_ids=${dmId}` },
    { label: 'GET conversation search', method: 'GET', path: `/api/v1/me/conversations/${peer.user.user_id}/messages/search?q=本人` },
    { label: 'POST conversation message', method: 'POST', path: `/api/v1/me/conversations/${peer.user.user_id}/messages`, body: { body: 'Agent 試發私訊' } },
    { label: 'POST conversation images', method: 'POST', path: `/api/v1/me/conversations/${peer.user.user_id}/images`, rawBody: fakePng, headers: { 'Content-Type': 'image/png' } },
    { label: 'GET conversation message image', method: 'GET', path: `/api/v1/me/conversations/${peer.user.user_id}/messages/${dmId}/image` },
    { label: 'POST conversation message retract', method: 'POST', path: `/api/v1/me/conversations/${peer.user.user_id}/messages/${dmId}/retract`, body: {} },
    { label: 'POST conversation read', method: 'POST', path: `/api/v1/me/conversations/${peer.user.user_id}/read`, body: {} },
    { label: 'GET channels', method: 'GET', path: '/api/v1/me/channels' },
    { label: 'GET channel activity', method: 'GET', path: '/api/v1/me/channels/guild/guild_ai_vibe/activity' },
    { label: 'GET channel messages', method: 'GET', path: '/api/v1/me/channels/guild/guild_ai_vibe/messages' },
    { label: 'GET channel search', method: 'GET', path: '/api/v1/me/channels/guild/guild_ai_vibe/messages/search?q=本人' },
    { label: 'POST channel message', method: 'POST', path: '/api/v1/me/channels/guild/guild_ai_vibe/messages', body: { body: 'Agent 試發頻道訊息' } },
    { label: 'POST channel message retract', method: 'POST', path: `/api/v1/me/channels/guild/guild_ai_vibe/messages/${chanMsgId}/retract`, body: {} },
    { label: 'POST channel read', method: 'POST', path: '/api/v1/me/channels/guild/guild_ai_vibe/read', body: {} },
  ];

  // Rotate tokens every 5 failures so auto-suspension at failure_count >= 9 never turns 403 into 401.
  let token = '';
  for (let i = 0; i < cases.length; i++) {
    if (i % 5 === 0) token = await issueAllScopes(owner);
    const tc = cases[i]!;
    const res = await req(tc.path, { token, method: tc.method, body: tc.body, rawBody: tc.rawBody, headers: tc.headers });
    assert.equal(res.status, 403, `${tc.label}: expected 403, got ${res.status} ${JSON.stringify(res.data)}`);
    assert.equal(res.data?.code, 'scope_required', `${tc.label}: ${JSON.stringify(res.data)}`);
  }

  const afterSnap = await snapshot();
  assert.deepEqual(afterSnap, beforeSnap);
});

test('setShowcaseSharing and readShowcaseSharing retain the !actor.agent domain guard', async () => {
  const owner = await loginWithCookie(0);
  const showcaseRes = await req('/api/v1/showcases', {
    session: owner,
    body: { title: '領域保護作品', description: '作品介紹', consent_to_share: true },
  });
  assert.equal(showcaseRes.status, 201);
  const showcaseId = showcaseRes.data.showcase_id as string;

  const userRow = (await pool.query('SELECT * FROM users WHERE user_id = $1', [owner.user.user_id])).rows[0];
  const agentActor = {
    user_id: userRow.user_id,
    community_id: userRow.community_id,
    display_name: userRow.display_name,
    role: userRow.role,
    onboarding_required: false,
    onboarding_completed_at: userRow.onboarding_completed_at,
    agent: {
      connection_id: randomUUID(),
      scopes: ['read', 'share', 'rsvp', 'react'],
      scope: 'share',
      operation: 'PUT /api/v1/me/showcases/:id/sharing',
      public_item: false,
    },
  } as any;

  await assert.rejects(
    () => readShowcaseSharing(pool, agentActor, showcaseId),
    (err: unknown) => err instanceof Problem && err.status === 403 && err.code === 'scope_required',
  );
  await assert.rejects(
    () => setShowcaseSharing(pool, { actor: agentActor, operation: 'PUT /api/v1/me/showcases/:id/sharing', key: randomUUID(), body: { enabled: true }, expected: '1' }, showcaseId),
    (err: unknown) => err instanceof Problem && err.status === 403 && err.code === 'scope_required',
  );
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM work_public_publications')).rows[0].n, 0);
});
