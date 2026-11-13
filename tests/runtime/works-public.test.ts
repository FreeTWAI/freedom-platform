import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { migrate } from '../../scripts/database.js';
import { DEMO_COMMUNITY, DEMO_PASSWORD, DEMO_USERS, seedLocal } from '../../packages/testing/seed.js';
import { createApp } from '../../apps/platform-api/src/app.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL must name a disposable database');
const schema = `fp_works_public_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: url });
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 12 });
const origin = 'http://127.0.0.1:4310';
const adminEmail = 'ops@local.test';
const verifier = async (req: Request) => {
  assert.equal(req.headers.get('cf-access-jwt-assertion'), 'verified-admin-jwt');
  return { email: adminEmail, subject: 'sub-admin', csrfToken: 'admin-csrf' };
};
const app = createApp(pool, origin, 'local', { personalContentEnabled: true, adminVerifier: verifier });
const defaultApp = createApp(pool, origin, 'local');

before(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await migrate(pool); });
after(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
beforeEach(async () => { await pool.query('TRUNCATE communities,login_attempts,auth_rate_limits CASCADE'); await seedLocal(pool); });

type Member = {
  cookie: string;
  csrf: string;
  user: { user_id: string; display_name: string };
  req: (path: string, opts?: { method?: string; body?: unknown; version?: string; key?: string; headers?: Record<string, string> }) => Promise<Response>;
};

async function member(index: number, completeOnboarding = true): Promise<Member> {
  const res = await app.request(`${origin}/api/v1/auth/login`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: DEMO_USERS[index].email, password: DEMO_PASSWORD }),
  });
  assert.equal(res.status, 200);
  const data = await res.json() as { csrf_token: string; user: { user_id: string; display_name: string } };
  if (completeOnboarding) {
    await pool.query('UPDATE users SET onboarding_completed_at = now() WHERE user_id = $1', [data.user.user_id]);
  }
  const cookie = res.headers.get('set-cookie')!.split(';')[0];
  return {
    cookie,
    csrf: data.csrf_token,
    user: data.user,
    req: async (path, opts = {}) => {
      const { method = opts.body === undefined ? 'GET' : 'POST', body, version, key = randomUUID(), headers = {} } = opts;
      return app.request(`${origin}/api/v1/${path}`, {
        method,
        headers: {
          Origin: origin,
          Cookie: cookie,
          'X-CSRF-Token': data.csrf_token,
          ...(body !== undefined ? { 'Content-Type': 'application/json', 'Idempotency-Key': key } : {}),
          ...(version ? { 'If-Match': `"${version}"` } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    },
  };
}

async function createPublishedWork(m: Member, overrides: Partial<{ title: string; description: string; artifact_ref: string; public_url: string | null }> = {}) {
  const res = await m.req('showcases', {
    body: {
      title: overrides.title ?? '公開閱讀測試作品 <script>alert(1)</script>',
      description: overrides.description ?? '這是作品摘要，說明設計與實作重點。',
      artifact_ref: overrides.artifact_ref ?? 'artifact:private-internal-key-999',
      consent_to_share: true,
      ...(overrides.public_url !== undefined ? { public_url: overrides.public_url } : { public_url: 'https://example.com/demo-work' }),
    },
  });
  assert.equal(res.status, 201, await res.clone().text());
  return await res.json() as { showcase_id: string; aggregate_version: string; title: string };
}

test('attacker checks: another member, admin without ownership, another community, agent token, and stale versions are rejected', async () => {
  const owner = await member(0);
  const other = await member(1);
  const incomplete = await member(2, false);
  await pool.query('UPDATE users SET onboarding_required = true, onboarding_completed_at = NULL WHERE user_id = $1', [incomplete.user.user_id]);

  const work = await createPublishedWork(owner);
  const sharingPath = `me/showcases/${work.showcase_id}/sharing`;

  // Existing work starts member-only; no public page or API exposure.
  const initialGet = await owner.req(sharingPath);
  assert.equal(initialGet.status, 200);
  const initialState = await initialGet.json() as { enabled: boolean; available: boolean; version: string; work_version: string };
  assert.equal(initialState.enabled, false);
  assert.equal(initialState.available, false);
  assert.equal(initialGet.headers.get('etag'), `"${initialState.version}"`);

  // Same 404 response for missing, non-opted-in, and invalid UUID.
  const notOptedInPage = await app.request(`${origin}/works/${work.showcase_id}`);
  const missingPage = await app.request(`${origin}/works/${randomUUID()}`);
  const badIdPage = await app.request(`${origin}/works/not-a-uuid`);
  assert.equal(notOptedInPage.status, 404);
  assert.equal(missingPage.status, 404);
  assert.equal(badIdPage.status, 404);
  const baseline404Html = await missingPage.text();
  assert.equal(await notOptedInPage.text(), baseline404Html);
  assert.equal(await badIdPage.text(), baseline404Html);
  assert.equal((await app.request(`${origin}/api/v1/public/works/${work.showcase_id}`)).status, 404);

  // Unauthenticated caller -> 401
  assert.equal((await app.request(`${origin}/api/v1/${sharingPath}`)).status, 401);

  // Incomplete onboarding member -> 403
  assert.equal((await incomplete.req(sharingPath)).status, 403);

  // Another member -> 404 on both GET and PUT
  assert.equal((await other.req(sharingPath)).status, 404);
  assert.equal((await other.req(sharingPath, { method: 'PUT', body: { enabled: true }, version: initialState.version })).status, 404);

  // Admin without ownership (admin JWT header alone without member session -> 401; admin header + other member -> 404)
  assert.equal((await app.request(`${origin}/api/v1/${sharingPath}`, {
    headers: { 'Cf-Access-Jwt-Assertion': 'verified-admin-jwt' },
  })).status, 401);
  assert.equal((await other.req(sharingPath, {
    method: 'PUT',
    body: { enabled: true },
    version: initialState.version,
    headers: { 'Cf-Access-Jwt-Assertion': 'verified-admin-jwt' },
  })).status, 404);

  // Another community member -> 404
  const secondCommunityId = randomUUID();
  const outsiderId = randomUUID();
  await pool.query('INSERT INTO communities VALUES($1, $2)', [secondCommunityId, '外部社群']);
  await pool.query(`INSERT INTO users(user_id, community_id, email, display_name, password_hash, profession_membership_ref)
    SELECT $1, $2, 'outsider@local.test', '外部成員', password_hash, $3 FROM users WHERE user_id = $4`,
  [outsiderId, secondCommunityId, randomUUID(), owner.user.user_id]);
  const outsiderLogin = await app.request(`${origin}/api/v1/auth/login`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'outsider@local.test', password: DEMO_PASSWORD }),
  });
  assert.equal(outsiderLogin.status, 200);
  const outsiderData = await outsiderLogin.json() as { csrf_token: string };
  const outsiderCookie = outsiderLogin.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await app.request(`${origin}/api/v1/${sharingPath}`, {
    method: 'PUT',
    headers: { Origin: origin, Cookie: outsiderCookie, 'X-CSRF-Token': outsiderData.csrf_token, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(), 'If-Match': `"${initialState.version}"` },
    body: JSON.stringify({ enabled: true }),
  })).status, 404);

  // Agent token without owner scope -> 403 scope_required on both GET and PUT
  const issued = await owner.req('me/agent-tokens', { body: { name: 'Works Agent', scopes: ['read', 'share', 'rsvp'] } });
  assert.equal(issued.status, 201, await issued.clone().text());
  const agentToken = (await issued.json() as { access_token: string }).access_token;
  assert.equal((await app.request(`${origin}/api/v1/${sharingPath}`, {
    headers: { Authorization: `Bearer ${agentToken}` },
  })).status, 403);
  assert.equal((await app.request(`${origin}/api/v1/${sharingPath}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${agentToken}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(), 'If-Match': `"${initialState.version}"` },
    body: JSON.stringify({ enabled: true }),
  })).status, 403);

  // Missing If-Match -> 428; Stale If-Match -> 412; Stale work_version -> 412; Missing CSRF -> 403
  assert.equal((await owner.req(sharingPath, { method: 'PUT', body: { enabled: true }, headers: { 'X-CSRF-Token': 'wrong-csrf' } })).status, 403);
  assert.equal((await owner.req(sharingPath, { method: 'PUT', body: { enabled: true } })).status, 428);
  assert.equal((await owner.req(sharingPath, { method: 'PUT', body: { enabled: true }, version: '999' })).status, 412);
  assert.equal((await owner.req(sharingPath, { method: 'PUT', body: { enabled: true, work_version: '999' }, version: initialState.version })).status, 412);

  // Unpublished draft cannot be opted in -> 409
  const draftRes = await owner.req('me/showcases', { body: { title: '未發布草稿', description: '草稿內容不可公開' } });
  assert.equal(draftRes.status, 201);
  const draft = await draftRes.json() as { showcase_id: string; aggregate_version: string };
  assert.equal((await owner.req(`me/showcases/${draft.showcase_id}/sharing`, {
    method: 'PUT',
    body: { enabled: true, work_version: draft.aggregate_version },
    version: draft.aggregate_version,
  })).status, 409);
  assert.equal(await (await app.request(`${origin}/works/${draft.showcase_id}`)).text(), baseline404Html);
});

test('consent idempotency, concurrency, default app without personalContent flag, SSR headers/OG/no-leaks, edit invalidation, and withdrawal', async () => {
  const owner = await member(0);
  const sharer = await member(1);
  const work = await createPublishedWork(owner, {
    title: '作品「光影」<img src=x onerror=alert(1)>',
    description: '只有核准版本會出現在公開頁面中。',
    artifact_ref: 'artifact:SECRET-DRAFT-PATH',
    public_url: 'https://example.com/public-showcase',
  });
  const path = `me/showcases/${work.showcase_id}/sharing`;

  // Default built app (personalContentEnabled=false) still allows owner to manage /me/showcases/:id/sharing.
  const defGet = await defaultApp.request(`${origin}/api/v1/${path}`, {
    headers: { Origin: origin, Cookie: owner.cookie, 'X-CSRF-Token': owner.csrf },
  });
  assert.equal(defGet.status, 200);
  const s0 = await defGet.json() as { version: string; work_version: string };

  // Concurrent writes with same If-Match: one succeeds, one gets 412.
  const idempKey = randomUUID();
  const [c1, c2] = await Promise.all([
    defaultApp.request(`${origin}/api/v1/${path}`, {
      method: 'PUT',
      headers: { Origin: origin, Cookie: owner.cookie, 'X-CSRF-Token': owner.csrf, 'Content-Type': 'application/json', 'Idempotency-Key': idempKey, 'If-Match': `"${s0.version}"` },
      body: JSON.stringify({ enabled: true, work_version: s0.work_version }),
    }),
    defaultApp.request(`${origin}/api/v1/${path}`, {
      method: 'PUT',
      headers: { Origin: origin, Cookie: owner.cookie, 'X-CSRF-Token': owner.csrf, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(), 'If-Match': `"${s0.version}"` },
      body: JSON.stringify({ enabled: true, work_version: s0.work_version }),
    }),
  ]);
  const statuses = [c1.status, c2.status].sort();
  assert.deepEqual(statuses, [200, 412]);

  // Idempotent replay with same key & body succeeds with 200, conflict with different body returns 409.
  const replay = await defaultApp.request(`${origin}/api/v1/${path}`, {
    method: 'PUT',
    headers: { Origin: origin, Cookie: owner.cookie, 'X-CSRF-Token': owner.csrf, 'Content-Type': 'application/json', 'Idempotency-Key': idempKey, 'If-Match': `"${s0.version}"` },
    body: JSON.stringify({ enabled: true, work_version: s0.work_version }),
  });
  assert.equal(replay.status, 200);
  const conflictBody = await defaultApp.request(`${origin}/api/v1/${path}`, {
    method: 'PUT',
    headers: { Origin: origin, Cookie: owner.cookie, 'X-CSRF-Token': owner.csrf, 'Content-Type': 'application/json', 'Idempotency-Key': idempKey, 'If-Match': `"${s0.version}"` },
    body: JSON.stringify({ enabled: false, work_version: s0.work_version }),
  });
  assert.equal(conflictBody.status, 409);

  // Check SSR /works/:id and public projection JSON.
  const pageRes = await defaultApp.request(`${origin}/works/${work.showcase_id}`);
  assert.equal(pageRes.status, 200);
  assert.equal(pageRes.headers.get('cache-control'), 'no-store');
  assert.equal(pageRes.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(pageRes.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.match(pageRes.headers.get('content-security-policy') ?? '', /script-src 'self'/);
  const html = await pageRes.text();
  assert.match(html, /property="og:type" content="article"/);
  assert.match(html, /property="og:title" content="作品「光影」&lt;img src=x onerror=alert\(1\)&gt;｜自由工坊"/);
  assert.match(html, /property="og:url" content="https:\/\/[^"]+\/works\//);
  assert.match(html, /property="og:image"/);
  assert.match(html, /https:\/\/example\.com\/public-showcase/);
  assert.match(html, new RegExp(DEMO_USERS[0].display_name));
  // Never leak private fields, internal artifact_ref, owner email, or unescaped script.
  assert.equal(html.includes('SECRET-DRAFT-PATH'), false);
  assert.equal(html.includes(DEMO_USERS[0].email), false);
  assert.equal(html.includes('<img src=x'), false);

  // Sharer credit (?via=) shows only for valid active share link pointing to THIS work.
  const shareRes = await sharer.req('shares', { body: { kind: 'work', ref_id: work.showcase_id } });
  assert.equal(shareRes.status, 200, await shareRes.clone().text());
  const workShareId = (await shareRes.json() as { share_id: string }).share_id;
  const linkCode = 'worksharer';
  await pool.query(
    `INSERT INTO promotion_links(link_id, community_id, user_id, kind, target_key, code)
     VALUES($1, $2, $3, 'share', $4, $5)`,
    [randomUUID(), DEMO_COMMUNITY, sharer.user.user_id, workShareId, linkCode],
  );
  const viaHtml = await (await defaultApp.request(`${origin}/works/${work.showcase_id}?via=${linkCode}`)).text();
  assert.match(viaHtml, new RegExp(`由 ${DEMO_USERS[1].display_name} 推薦分享`));
  assert.equal(viaHtml.includes(DEMO_USERS[1].email), false);
  const badViaHtml = await (await defaultApp.request(`${origin}/works/${work.showcase_id}?via=nonexistentcode`)).text();
  assert.equal(badViaHtml.includes('推薦分享'), false);

  // Withdrawing and editing the work immediately hides /works/:id until re-published AND re-confirmed.
  const baseline404 = await (await defaultApp.request(`${origin}/works/${randomUUID()}`)).text();
  const wdRes = await owner.req(`me/showcases/${work.showcase_id}/withdraw`, {
    body: {},
    version: work.aggregate_version,
  });
  assert.equal(wdRes.status, 200, await wdRes.clone().text());
  const withdrawn = await wdRes.json() as { aggregate_version: string };
  assert.equal(await (await defaultApp.request(`${origin}/works/${work.showcase_id}`)).text(), baseline404);
  assert.equal((await defaultApp.request(`${origin}/api/v1/public/works/${work.showcase_id}`)).status, 404);

  const editRes = await owner.req(`me/showcases/${work.showcase_id}`, {
    method: 'PATCH',
    body: { title: '改版作品標題', description: '改版摘要內容', artifact_ref: 'artifact:v2', public_url: 'https://example.com/public-v2' },
    version: withdrawn.aggregate_version,
  });
  assert.equal(editRes.status, 200, await editRes.clone().text());
  const edited = await editRes.json() as { aggregate_version: string };
  assert.equal(await (await defaultApp.request(`${origin}/works/${work.showcase_id}`)).text(), baseline404);

  // Re-publishing alone does NOT make /works/:id public again.
  const repub = await owner.req(`me/showcases/${work.showcase_id}/publish`, {
    body: { consent_to_share: true },
    version: edited.aggregate_version,
  });
  assert.equal(repub.status, 200);
  const republished = await repub.json() as { aggregate_version: string };
  assert.equal((await defaultApp.request(`${origin}/works/${work.showcase_id}`)).status, 404);

  // Owner reads fresh sharing state and confirms the new version.
  const freshState = await (await owner.req(path)).json() as { enabled: boolean; needs_reconfirmation: boolean; version: string; work_version: string };
  assert.equal(freshState.enabled, false);
  assert.equal(freshState.needs_reconfirmation, true);
  assert.equal(String(freshState.work_version), String(republished.aggregate_version));

  const reconfirmed = await owner.req(path, {
    method: 'PUT',
    body: { enabled: true, work_version: freshState.work_version },
    version: freshState.version,
  });
  assert.equal(reconfirmed.status, 200);
  const reconfirmedState = await reconfirmed.json() as { enabled: boolean; available: boolean; version: string };
  assert.equal(reconfirmedState.enabled, true);
  assert.equal(reconfirmedState.available, true);

  // Revised work renders updated content, and unsafe scheme stored in DB is omitted from href.
  const reHtml = await (await defaultApp.request(`${origin}/works/${work.showcase_id}`)).text();
  assert.match(reHtml, /改版作品標題/);
  assert.match(reHtml, /https:\/\/example\.com\/public-v2/);
  await pool.query("UPDATE showcases SET public_url = 'javascript:alert(1)' WHERE showcase_id = $1", [work.showcase_id]);
  // Trigger also hid it automatically on raw DB edit.
  assert.equal((await defaultApp.request(`${origin}/works/${work.showcase_id}`)).status, 404);
  const afterDbEdit = await (await owner.req(path)).json() as { enabled: boolean; version: string; work_version: string };
  assert.equal(afterDbEdit.enabled, false);
  const reconfirmedAgain = await owner.req(path, {
    method: 'PUT',
    body: { enabled: true, work_version: afterDbEdit.work_version },
    version: afterDbEdit.version,
  });
  assert.equal(reconfirmedAgain.status, 200);
  const unsafeFilteredHtml = await (await defaultApp.request(`${origin}/works/${work.showcase_id}`)).text();
  assert.equal(unsafeFilteredHtml.includes('javascript:'), false);
  const afterUnsafeReconfirm = await reconfirmedAgain.json() as { version: string };

  // Withdrawing consent takes effect immediately with exact same 404 HTML.
  const withdrawRes = await owner.req(path, {
    method: 'PUT',
    body: { enabled: false },
    version: afterUnsafeReconfirm.version,
  });
  assert.equal(withdrawRes.status, 200);
  const afterWithdraw = await defaultApp.request(`${origin}/works/${work.showcase_id}`);
  assert.equal(afterWithdraw.status, 404);
  assert.equal(await afterWithdraw.text(), baseline404);
});
