import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { Pool, type PoolClient } from 'pg';
import { z } from 'zod';
import { migrate } from '../../scripts/database.js';
import { DEMO_PASSWORD, DEMO_USERS, seedLocal } from '../../packages/testing/seed.js';
import { createApp } from '../../apps/platform-api/src/app.js';
import { readSessionCookie } from '../../apps/platform-api/src/session-cookie.js';
import { authenticate, type Actor } from '../../modules/identity-membership/service.js';
import { searchGuildDirectory } from '../../modules/positioning/guild-search.js';
import { guildSearchPageSchema, type GuildSearchPage } from '../../packages/shared/community-search.js';
import { Problem } from '../../packages/shared/problem.js';
// @ts-expect-error The shared dependency-free URL admission helper is JavaScript.
import { isDisposableDatabaseUrl } from '../../packages/contribution-tools/runtime-databases.mjs';

// This suite deliberately has no LOCAL_DATABASE_URL/PG* fallback or server startup.
// The host must explicitly provide its disposable PostgreSQL test database.
const database = process.env.TEST_DATABASE_URL;
if (!isDisposableDatabaseUrl(database)) throw new Error('TEST_DATABASE_URL must explicitly name an isolated loopback fp_* database admitted by the runtime harness');
const schema = `fp_guild_search_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: database, connectionTimeoutMillis: 10_000 });
const pool = new Pool({ connectionString: database, options: `-c search_path=${schema}`, application_name: schema, max: 12, connectionTimeoutMillis: 10_000 });
// Hono's in-process HTTP interface does not listen on or discover a local port.
const origin = 'http://127.0.0.1';
const enabled = { communitySearchEnabled: true, guildLaunchpadEnabled: true, participationMetricsEnabled: true };
const app = createApp(pool, origin, 'local', enabled);
type App = ReturnType<typeof createApp>;
type Session = { cookie: string; actor: Actor };
let member: Session, secondLogin: Session, otherMember: Session, created = false;
let setupFailure: unknown;

const query = (q = '資安', extra: Record<string, string> = {}) => new URLSearchParams({ view: 'search', q, ...extra });
function request(params: URLSearchParams, session: Session | undefined = member, target = app, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (session) headers.set('Cookie', session.cookie);
  return target.request(`${origin}/api/v1/guilds/directory?${params}`, { ...init, headers });
}
async function signIn(index = 0): Promise<Session> {
  const response = await app.request(`${origin}/api/v1/auth/login`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: DEMO_USERS[index].email, password: DEMO_PASSWORD }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie);
  const cookie = setCookie.split(';')[0];
  const token = readSessionCookie(cookie, origin);
  assert.ok(token);
  return { cookie, actor: await authenticate(pool, token) };
}
before(async () => {
  try {
    await admin.query(`CREATE SCHEMA ${schema}`); created = true;
    await migrate(pool); await seedLocal(pool);
    member = await signIn(); secondLogin = await signIn(); otherMember = await signIn(1);
  } catch (error) { setupFailure = error; throw error; }
});
after(async () => {
  const errors: unknown[] = [];
  try { await pool.end(); } catch (error) { errors.push(error); }
  try { if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`); } catch (error) { errors.push(error); }
  try { await admin.end(); } catch (error) { errors.push(error); }
  // Teardown tries every owned cleanup step and retains any original setup failure.
  if (errors.length) throw new AggregateError(setupFailure ? [setupFailure, ...errors] : errors, 'Guild search fixture cleanup failed');
});

function privateResponse(response: Response) {
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.ok(response.headers.get('vary')?.split(',').map(value => value.trim().toLowerCase()).includes('cookie'));
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(response.headers.get('etag'), null);
  assert.equal(response.headers.get('last-modified'), null);
}
async function page(response: Response): Promise<GuildSearchPage> {
  assert.equal(response.status, 200, await response.clone().text());
  privateResponse(response);
  const body: unknown = await response.json();
  const parsed = guildSearchPageSchema.parse(body);
  assert.deepEqual(Object.keys(parsed).sort(), ['items', 'next_cursor']);
  for (const item of parsed.items) {
    assert.deepEqual(Object.keys(item).sort(), ['guild_key', 'kind', 'name', 'path', 'purpose']);
    assert.equal(item.kind, 'guild');
    assert.equal(item.path, `#guilds/${item.guild_key}`);
  }
  return parsed;
}
async function rejected(response: Response, status: number, code?: string, handlerReached = true) {
  assert.equal(response.status, status, await response.clone().text());
  if (handlerReached) privateResponse(response);
  else {
    // The existing pre-route member boundary has its own no-store policy.
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('etag'), null);
  }
  const body = z.record(z.string(), z.unknown()).parse(await response.json());
  if (code) assert.equal(body.code, code);
  for (const key of ['items', 'next_cursor', 'operation_id', 'membership', 'skill_books', 'csrf_token']) assert.equal(key in body, false);
  assert.equal(JSON.stringify(body).includes('guild_security'), false);
}
const snapshotTables = [
  'community_search_operations', 'positioning_profession_memberships', 'member_skill_book_grants',
  'guild_member_preferences', 'guild_preference_sets', 'guild_category_preferences',
  'command_receipts', 'transition_journal', 'outbox',
] as const;
async function writeFacts() {
  const facts: Record<string, unknown> = {};
  for (const table of snapshotTables) facts[table] = (await pool.query(`
    SELECT coalesce(jsonb_agg(row_data ORDER BY row_data::text), '[]'::jsonb) AS rows
    FROM (SELECT to_jsonb(t) AS row_data FROM ${table} t) snapshot`)).rows[0].rows;
  return facts;
}
async function insertGuild(guildKey: string, name: string, purpose = '搜尋測試的公開用途') {
  await pool.query(`INSERT INTO positioning_guild_catalog(guild_key,profession_key,name,purpose,first_step,module_key)
    VALUES($1,$2,$3,$4,'不應出現在搜尋結果的第一步','positioning')`, [guildKey, guildKey.slice(6), name, purpose]);
}

test('member search returns the real Chinese catalog metadata, exact launchpad paths and no authority or metric writes', async () => {
  const before = await writeFacts();
  const expected = (await pool.query<{ guild_key: string; name: string; purpose: string }>(`
    SELECT guild_key,name,left(purpose,500) AS purpose FROM positioning_guild_catalog
    WHERE strpos(name,$1)>0 OR strpos(purpose,$1)>0 ORDER BY guild_key`, ['資安'])).rows;
  assert.ok(expected.some(row => row.guild_key === 'guild_security'));
  const found = await page(await request(query()));
  assert.deepEqual(found, { items: expected.map(row => ({ kind: 'guild', ...row, path: `#guilds/${row.guild_key}` })), next_cursor: null });
  assert.deepEqual(await page(await request(query(' 資安 '))), found);
  assert.deepEqual(await writeFacts(), before, 'reading a guild does not join, grant books, record search metrics or create command facts');
});

test('both feature flags must be exactly true; the no-view onboarding directory keeps its existing response', async () => {
  const flags: unknown[] = [undefined, false, 'true', 1];
  for (const flag of flags) for (const missing of ['communitySearchEnabled', 'guildLaunchpadEnabled'] as const) {
    // Deliberately invalid runtime values test exact booleans at the host boundary.
    const target = createApp(pool, origin, 'local', { ...enabled, [missing]: flag } as Parameters<typeof createApp>[3]);
    await rejected(await request(query(), member, target), 404, 'not_found');
    const legacy = await target.request(`${origin}/api/v1/guilds/directory`, { headers: { Cookie: member.cookie } });
    assert.equal(legacy.status, 200);
    const result = z.object({ items: z.array(z.object({ guild_key: z.string(), skill_books: z.array(z.unknown()) }).passthrough()) }).parse(await legacy.json());
    assert.ok(result.items.some(row => row.guild_key === 'guild_security'));
    assert.equal('next_cursor' in result, false);
  }
});

test('anonymous search and HEAD cannot expose guild metadata, including conditional requests', async () => {
  // Pass an explicit absent cookie instead of request()'s member default.
  const url = `${origin}/api/v1/guilds/directory?${query()}`;
  await rejected(await app.request(url), 401, 'login_required', false);
  const head = await app.request(url, { method: 'HEAD', headers: { 'If-None-Match': '*', 'If-Modified-Since': 'Thu, 01 Jan 2099 00:00:00 GMT' } });
  assert.equal(head.status, 401); assert.equal(head.headers.get('cache-control'), 'no-store'); assert.equal(await head.text(), '');
});

for (const state of ['revoked', 'expired', 'inactive'] as const) test(`current ${state} authority rejects HTTP and captured Actor search`, async () => {
  try {
    if (state === 'revoked') await pool.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1', [member.actor.session_hash]);
    if (state === 'expired') await pool.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1", [member.actor.session_hash]);
    if (state === 'inactive') await pool.query('UPDATE users SET active=false WHERE user_id=$1', [member.actor.user_id]);
    for (const q of ['資安', 'GuildSearchNoSuchCatalogEntry']) {
      await rejected(await request(query(q)), 401, 'session_expired', false);
      await assert.rejects(searchGuildDirectory(pool, member.actor, query(q)),
        (error: unknown) => error instanceof Problem && error.status === 401 && error.code === 'session_expired');
    }
    const head = await request(query(), member, app, { method: 'HEAD', headers: { 'If-None-Match': '*' } });
    assert.equal(head.status, 401); assert.equal(head.headers.get('cache-control'), 'no-store'); assert.equal(await head.text(), '');
  } finally {
    await pool.query('UPDATE users SET active=true WHERE user_id=$1', [member.actor.user_id]);
    await pool.query("UPDATE sessions SET revoked_at=NULL,expires_at=clock_timestamp()+interval '1 hour' WHERE token_hash=$1", [member.actor.session_hash]);
  }
});

test('a current onboarding reset defeats a stale completed Actor without removing legacy directory access', async () => {
  assert.ok(!member.actor.onboarding_required || member.actor.onboarding_completed_at);
  const saved = (await pool.query('SELECT onboarding_required,onboarding_completed_at FROM users WHERE user_id=$1', [member.actor.user_id])).rows[0];
  try {
    await pool.query('UPDATE users SET onboarding_required=true,onboarding_completed_at=NULL WHERE user_id=$1', [member.actor.user_id]);
    await rejected(await request(query()), 403, 'onboarding_required');
    await assert.rejects(searchGuildDirectory(pool, member.actor, query()),
      (error: unknown) => error instanceof Problem && error.status === 403 && error.code === 'onboarding_required');
    const legacy = await app.request(`${origin}/api/v1/guilds/directory`, { headers: { Cookie: member.cookie } });
    assert.equal(legacy.status, 200);
    assert.ok(z.object({ items: z.array(z.object({ guild_key: z.string() }).passthrough()) }).parse(await legacy.json()).items.some(row => row.guild_key === 'guild_security'));
  } finally {
    await pool.query('UPDATE users SET onboarding_required=$2,onboarding_completed_at=$3 WHERE user_id=$1', [member.actor.user_id, saved.onboarding_required, saved.onboarding_completed_at]);
  }
});

test('search GET and HEAD remain private and never become a conditional 304', async () => {
  const before = await writeFacts();
  const headers = { 'If-None-Match': '*', 'If-Modified-Since': 'Thu, 01 Jan 2099 00:00:00 GMT' };
  assert.ok((await page(await request(query(), member, app, { headers }))).items.length > 0);
  const head = await request(query(), member, app, { method: 'HEAD', headers });
  assert.equal(head.status, 200); privateResponse(head); assert.equal(await head.text(), '');
  assert.deepEqual(await writeFacts(), before);
});

test('literal percent, underscore and backslash match only their stored characters, including a trailing backslash', async () => {
  const prefix = '字面搜尋專用';
  const rows = [
    ['guild_search_literal_percent', `${prefix}%標記`],
    ['guild_search_literal_underscore', `${prefix}_標記`],
    ['guild_search_literal_backslash', `${prefix}\\`],
    ['guild_search_literal_decoy', `${prefix}普通標記`],
  ];
  for (const [key, name] of rows) await insertGuild(key, name);
  for (const [literal, expected] of [['%', rows[0][0]], ['_', rows[1][0]], ['\\', rows[2][0]]]) {
    assert.deepEqual((await page(await request(query(`${prefix}${literal}`)))).items.map(row => row.guild_key), [expected]);
  }
  assert.deepEqual((await page(await request(query(`${prefix}\\`)))).items.map(row => row.guild_key), [rows[2][0]]);
});

test('purpose-only matches use the current bounded catalog excerpt, not rich directory fields', async () => {
  const purpose = `用途專屬搜尋${'😀'.repeat(600)}`;
  await insertGuild('guild_search_purpose_only', '只查用途的公會', purpose);
  const result = await page(await request(query('用途專屬搜尋')));
  assert.deepEqual(result, { items: [{ kind: 'guild', guild_key: 'guild_search_purpose_only', name: '只查用途的公會', purpose: Array.from(purpose).slice(0, 500).join(''), path: '#guilds/guild_search_purpose_only' }], next_cursor: null });
});

test('keyset pages are bounded at 20, stable across insertion order and bound to query and login session', async () => {
  const keyword = '分頁專屬搜尋';
  const expected = Array.from({ length: 25 }, (_, index) => `guild_search_page_${String(index).padStart(2, '0')}`);
  for (const key of [...expected].reverse()) await insertGuild(key, keyword, '相同名稱仍以真實公會鍵排序');
  const before = await writeFacts();
  const first = await page(await request(query(keyword)));
  assert.deepEqual(first.items.map(row => row.guild_key), expected.slice(0, 20));
  assert.ok(first.next_cursor);
  assert.deepEqual((await page(await request(query(keyword)))).items, first.items);
  const last = await page(await request(query(keyword, { cursor: first.next_cursor })));
  assert.deepEqual(last.items.map(row => row.guild_key), expected.slice(20));
  assert.equal(last.next_cursor, null);
  const seen: string[] = []; let cursor: string | null = null;
  do {
    const result: GuildSearchPage = await page(await request(query(keyword, { limit: '1', ...(cursor ? { cursor } : {}) })));
    assert.equal(result.items.length, 1); seen.push(result.items[0].guild_key); cursor = result.next_cursor;
    assert.ok(seen.length <= expected.length, 'a cursor cannot repeat or cycle');
  } while (cursor);
  assert.deepEqual(seen, expected);
  // Trimming is the query identity; changing page size does not change it.
  assert.deepEqual((await page(await request(query(` ${keyword} `, { cursor: first.next_cursor, limit: '2' })))).items.map(row => row.guild_key), expected.slice(20, 22));
  await rejected(await request(query(`${keyword}不同`, { cursor: first.next_cursor })), 422, 'invalid_cursor');
  for (const session of [secondLogin, otherMember]) await rejected(await request(query(keyword, { cursor: first.next_cursor }), session), 422, 'invalid_cursor');
  const decoded = Buffer.from(first.next_cursor, 'base64url').toString('utf8');
  const decodedValue = z.object({ v: z.literal(1), b: z.string(), k: z.string() }).strict().parse(JSON.parse(decoded));
  for (const value of [{ ...decodedValue, extra: true }, { ...decodedValue, k: '../private' }, { ...decodedValue, k: 'guild_security\nprivate' }, { ...decodedValue, v: 2 }]) {
    await rejected(await request(query(keyword, { cursor: Buffer.from(JSON.stringify(value)).toString('base64url') })), 422, 'invalid_cursor');
  }
  for (const secret of [keyword, member.actor.session_hash, member.actor.user_id, member.actor.community_id]) assert.equal(decoded.includes(secret), false);
  assert.deepEqual(await writeFacts(), before);
});

test('strict HTTP parameters reject empty, duplicate, unknown and out-of-bound inputs without search facts', async () => {
  const before = await writeFacts();
  const invalid = [
    new URLSearchParams('view=search'), query(''), query(' '), query('x'.repeat(81)), query('資安\n'), query('資安\u007f'),
    query('資安', { view: '' }), query('資安', { view: 'other' }), query('資安', { extra: 'private' }),
    query('資安', { kinds: 'guild' }), query('資安', { limit: '' }),
    ...['0', '-1', '21', '100', '1.5', '01', '1e1', ' 1', 'NaN'].map(limit => query('資安', { limit })),
    ...['view', 'q', 'limit', 'cursor'].map(key => { const params = query('資安', { limit: '1', cursor: 'e30' }); params.append(key, params.get(key)!); return params; }),
  ];
  for (const params of invalid) await rejected(await request(params), 422, 'invalid_guild_search');
  for (const cursor of ['', 'a'.repeat(513), 'a=', 'a b', 'é', 'e30', Buffer.from('{"v":1,"b":"wrong","k":"guild_security"}').toString('base64url')]) {
    await rejected(await request(query('資安', { cursor })), 422, 'invalid_cursor');
  }
  const nul = await request(query('資安\0'));
  assert.equal(nul.status, 422); // The shared API envelope rejects NUL before route/auth middleware.
  assert.equal((await nul.json() as { code: string }).code, 'validation_failed');
  assert.deepEqual((await page(await request(query('x'.repeat(80), { limit: '20' })))).items, []);
  assert.deepEqual(await writeFacts(), before);
});

/** Arm a short fixture deadline only after the real member locks are held. The
 * UPDATE and all product queries use the SAME native pg transaction/client; no
 * synthetic query result or production clock override is used. The subsequent
 * catalog SELECT still blocks in PostgreSQL, observed separately below. */
function deadlinePool(session: Session, seconds: number) {
  const state: { pid?: number; expiresAt?: string; trace: string[]; armed: boolean } = { trace: [], armed: false };
  const observeClient = (client: PoolClient): PoolClient => new Proxy(client, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (key !== 'query') return typeof value === 'function' ? value.bind(target) : value;
      return async (...args: unknown[]) => {
        const sql = typeof args[0] === 'string' ? args[0] : '';
        state.trace.push(sql);
        if (!state.armed && /FROM positioning_guild_catalog\b/.test(sql)) {
          assert.ok(state.trace.some(text => /FROM users\b/.test(text) && /FOR SHARE/.test(text)), 'current user must be locked first');
          assert.ok(state.trace.some(text => /FROM sessions\b/.test(text) && /FOR SHARE/.test(text)), 'current session must be locked first');
          const armed = await target.query<{ pid: number; expires_at: string; active: boolean }>(`
            UPDATE sessions SET expires_at=clock_timestamp()+make_interval(secs=>$2)
            WHERE token_hash=$1 RETURNING pg_backend_pid() AS pid,expires_at::text,expires_at>clock_timestamp() AS active`,
          [session.actor.session_hash, seconds]);
          assert.equal(armed.rowCount, 1); assert.equal(armed.rows[0].active, true);
          state.pid = armed.rows[0].pid; state.expiresAt = armed.rows[0].expires_at; state.armed = true;
        }
        return Reflect.apply(value, target, args);
      };
    },
  });
  const wrapped = new Proxy(pool, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (key === 'connect') return async () => observeClient(await target.connect());
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { pool: wrapped, state };
}

async function blockedCatalogRead(q: string, expires: boolean) {
  const watched = deadlinePool(member, expires ? 1 : 300);
  const target: App = createApp(watched.pool, origin, 'local', enabled);
  const gate = await pool.connect(); let pending: Promise<Response> | undefined, failure: unknown;
  try {
    await gate.query('BEGIN'); await gate.query('LOCK TABLE positioning_guild_catalog IN ACCESS EXCLUSIVE MODE');
    const holder = (await gate.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    pending = Promise.resolve(request(query(q), member, target));
    // Observe early transport rejection now; the original promise is still awaited below.
    void pending.catch(() => {});
    const deadline = Date.now() + 4000;
    for (;;) {
      const waiting = watched.state.pid !== undefined && (await admin.query<{ waiting: boolean }>(`
        SELECT EXISTS(SELECT 1 FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid
          WHERE a.pid=$1 AND a.application_name=$2 AND $3::int=ANY(pg_blocking_pids(a.pid))
            AND a.wait_event_type='Lock' AND NOT l.granted
            AND l.relation=$4::regclass) AS waiting`, [watched.state.pid, schema, holder, `${schema}.positioning_guild_catalog`])).rows[0].waiting;
      if (waiting) break;
      assert.ok(Date.now() < deadline, 'the actual catalog SELECT must wait on the native table barrier');
      await setImmediate();
    }
    assert.ok(watched.state.expiresAt);
    // Establish a still-live session AFTER the database-observed lock wait.
    assert.equal((await admin.query<{ active: boolean }>('SELECT clock_timestamp()<$1::timestamptz AS active', [watched.state.expiresAt])).rows[0].active, true);
    if (expires) {
      await admin.query('SELECT pg_sleep(greatest(0,extract(epoch FROM $1::timestamptz-clock_timestamp())::double precision)+0.02)', [watched.state.expiresAt]);
      const expired = await admin.query<{ expired: boolean; waiting: boolean }>(`
        SELECT clock_timestamp()>=$1::timestamptz AS expired,$3::int=ANY(pg_blocking_pids($2)) AS waiting`, [watched.state.expiresAt, watched.state.pid, holder]);
      assert.equal(expired.rows[0].expired, true); assert.equal(expired.rows[0].waiting, true);
    }
    await gate.query('ROLLBACK');
    const response = await pending;
    const catalogIndex = watched.state.trace.findIndex(sql => /FROM positioning_guild_catalog\b/.test(sql));
    assert.ok(watched.state.trace.slice(catalogIndex + 1).some(sql => /FROM sessions\b/.test(sql) && /clock_timestamp\(\)/.test(sql)), 'decision clock must run after the final domain query');
    assert.equal(watched.state.trace.at(-1), expires ? 'ROLLBACK' : 'COMMIT');
    return response;
  } catch (error) { failure = error; throw error; }
  finally {
    const errors: unknown[] = []; let discard = false;
    try { await gate.query('ROLLBACK'); } catch (error) { discard = true; errors.push(error); }
    finally { gate.release(discard); }
    // Releasing/destroying the native blocker precedes awaiting the reader, even
    // when synchronization failed; no pending query or checked-out gate is left.
    try { if (pending) await pending; } catch (error) { errors.push(error); }
    try { await pool.query("UPDATE sessions SET expires_at=clock_timestamp()+interval '1 hour' WHERE token_hash=$1", [member.actor.session_hash]); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(failure ? [failure, ...errors] : errors, 'Guild search barrier cleanup failed');
  }
}

for (const q of ['資安', 'GuildSearchNoSuchCatalogEntry']) test(`session expiry during a real catalog lock wait rejects ${q === '資安' ? 'populated' : 'empty'} search`, async () => {
  const before = await writeFacts();
  await rejected(await blockedCatalogRead(q, true), 401, 'session_expired');
  assert.deepEqual(await writeFacts(), before);
});

test('a still-valid member succeeds after the identical native catalog barrier', async () => {
  const result = await page(await blockedCatalogRead('資安', false));
  assert.ok(result.items.some(row => row.guild_key === 'guild_security'));
  assert.deepEqual(await page(await blockedCatalogRead('GuildSearchNoSuchCatalogEntry', false)), { items: [], next_cursor: null });
});
