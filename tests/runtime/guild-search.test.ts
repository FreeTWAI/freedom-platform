import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import type { Actor } from '../../modules/identity-membership/service.js';
import { parseGuildSearchQuery, searchGuildDirectory } from '../../modules/positioning/guild-search.js';
import { communitySearchKinds, guildSearchPageSchema } from '../../packages/shared/community-search.js';

const actor: Actor = {user_id: 'member', community_id: 'community', session_hash: 'synthetic-session',
  email: '', display_name: '', profession_membership_ref: '', csrf_token: ''};
const params = (q = '資安', extra: Record<string, string> = {}) => new URLSearchParams({view: 'search', q, ...extra});
const failure = (code: string) => (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
const row = (guild_key: string) => ({guild_key, name: '資安公會', purpose: '保護系統'});

// Protocol doubles only: the adjacent access suite owns real PostgreSQL/HTTP
// authority and blocking-clock evidence. No SQL behavior is inferred here.
function fixture(rows = [row('guild_security')], options: {onboard?: boolean; current?: boolean; active?: boolean; session?: boolean} = {}) {
  const calls: {sql: string; values: unknown[]}[] = [];
  let released = false, connections = 0;
  const client = {
    async query(sql: string, values: unknown[] = []) {
      calls.push({sql, values});
      if (sql.includes('positioning_guild_catalog')) return {rows, rowCount: rows.length};
      const allowed = sql.includes('clock_timestamp()') ? options.current !== false
        : sql.includes('NOT onboarding_required') ? options.onboard !== false
        : sql.includes('FROM users') ? options.active !== false : options.session !== false;
      return {rows: [], rowCount: allowed ? 1 : 0};
    },
    release() { released = true; },
  };
  const pool = {async connect() {connections++; return client;}} as unknown as Pool;
  return {pool, calls, released: () => released, connections: () => connections};
}

test('guild search requires an explicit bounded query and closed single-value parameter set', () => {
  assert.deepEqual(parseGuildSearchQuery(params(' 資安 ')), {q: '資安', limit: 20, cursor: null});
  assert.equal(parseGuildSearchQuery(params('a'.repeat(80), {limit: '1'})).limit, 1);
  for (const invalid of [new URLSearchParams('view=search'), params(''), params(' '), params('a'.repeat(81)),
    params('x\n'), params('x\0'), params('x\x7f'), params('x', {view: 'other'}), params('x', {limit: '21'}),
    params('x', {limit: '0'}), params('x', {limit: '01'}), params('x', {limit: '1.0'}), params('x', {limit: ' 1'}),
    params('x', {kind: 'guild'}), new URLSearchParams('view=search&q=x&q=y'),
    new URLSearchParams('view=search&view=search&q=x'), new URLSearchParams('view=search&q=x&limit=1&limit=1')]) {
    assert.throws(() => parseGuildSearchQuery(invalid), failure('invalid_guild_search'), invalid.toString());
  }
  for (const cursor of ['', 'a'.repeat(513), 'a=', 'a b', 'é']) {
    assert.throws(() => parseGuildSearchQuery(params('x', {cursor})), failure('invalid_cursor'));
  }
});

test('guild projection is separate from content kinds and strictly excludes rich directory fields', async () => {
  assert.deepEqual(communitySearchKinds, ['post', 'work', 'skill_book', 'event']);
  const f = fixture([{...row('guild_security'), member_roles: ['private'], skill_books: ['private']} as ReturnType<typeof row>]);
  const result = await searchGuildDirectory(f.pool, actor, params('50%_\\'));
  assert.deepEqual(result, {items: [{kind: 'guild', ...row('guild_security'), path: '#guilds/guild_security'}], next_cursor: null});
  const query = f.calls.find(call => call.sql.includes('positioning_guild_catalog'))!;
  assert.deepEqual(query.values, ['%50\\%\\_\\\\%', null, 21]);
  assert.match(query.sql, /SELECT guild_key, name, left\(purpose,500\) AS purpose/);
  assert.match(query.sql, /ORDER BY guild_key LIMIT \$3/);
  assert.equal(f.connections(), 1); assert.equal(f.released(), true);
  assert.equal(f.calls.at(-1)?.sql, 'COMMIT');
  assert.match(f.calls.at(-2)!.sql, /clock_timestamp\(\)/);
  for (const extra of [{member_roles: []}, {skill_books: []}, {answers: []}, {author_id: 'private'}, {topics: []}]) {
    assert.equal(guildSearchPageSchema.safeParse({...result, items: [{...result.items[0], ...extra}]}).success, false);
  }
  assert.equal(guildSearchPageSchema.safeParse({...result, items: [{...result.items[0], path: 'https://example.com'}]}).success, false);
  assert.equal(guildSearchPageSchema.safeParse({...result, items: Array(21).fill(result.items[0])}).success, false);
  assert.equal(guildSearchPageSchema.safeParse({...result, items: [{...result.items[0], purpose: '😀'.repeat(500)}]}).success, true);
});

test('cursor is bounded, canonical and bound to normalized query, member, community and session', async () => {
  const first = fixture([row('guild_alpha'), row('guild_security')]);
  const page = await searchGuildDirectory(first.pool, actor, params(' 資安 ', {limit: '1'}));
  assert.equal(page.items.length, 1); assert.ok(page.next_cursor); assert.ok(page.next_cursor.length <= 512);
  const decoded = JSON.parse(Buffer.from(page.next_cursor, 'base64url').toString());
  assert.deepEqual(Object.keys(decoded), ['v', 'b', 'k']); assert.equal(decoded.k, 'guild_alpha');
  const text = Buffer.from(page.next_cursor, 'base64url').toString();
  for (const secret of [actor.user_id, actor.community_id, actor.session_hash, '資安']) assert.equal(text.includes(secret), false);
  const next = fixture();
  await searchGuildDirectory(next.pool, actor, params('資安', {limit: '20', cursor: page.next_cursor}));
  assert.equal(next.calls.find(call => call.sql.includes('positioning_guild_catalog'))!.values[1], 'guild_alpha');
  for (const changed of [{...actor, session_hash: 'new-session'}, {...actor, user_id: 'another-member'}, {...actor, community_id: 'another-community'}]) {
    await assert.rejects(searchGuildDirectory(fixture().pool, changed, params('資安', {cursor: page.next_cursor})), failure('invalid_cursor'));
  }
  await assert.rejects(searchGuildDirectory(fixture().pool, actor, params('另一查詢', {cursor: page.next_cursor})), failure('invalid_cursor'));
  for (const invalid of ['e30', Buffer.from(JSON.stringify({...decoded, extra: true})).toString('base64url'),
    Buffer.from(JSON.stringify({...decoded, v: 2})).toString('base64url'),
    Buffer.from(JSON.stringify({...decoded, k: '../private'})).toString('base64url'),
    Buffer.from(JSON.stringify({b: decoded.b, v: 1, k: decoded.k})).toString('base64url'),
    Buffer.from(JSON.stringify(decoded, null, 1)).toString('base64url'),
    Buffer.from(`{"v":1,"v":1,"b":"${decoded.b}","k":"${decoded.k}"}`).toString('base64url')]) {
    await assert.rejects(searchGuildDirectory(fixture().pool, actor, params('資安', {cursor: invalid})), failure('invalid_cursor'));
  }
});

test('current authority precedes cursor decode and final session fence covers empty and populated results', async () => {
  for (const options of [{active: false}, {session: false}, {onboard: false}]) {
    const f = fixture([], options);
    await assert.rejects(searchGuildDirectory(f.pool, actor, params('資安', {cursor: 'e30'})), failure(options.onboard === false ? 'onboarding_required' : 'session_expired'));
    assert.equal(f.calls.some(call => call.sql.includes('positioning_guild_catalog')), false);
    assert.equal(f.calls.at(-1)?.sql, 'ROLLBACK'); assert.equal(f.released(), true);
  }
  for (const rows of [[], [row('guild_security')]]) {
    const f = fixture(rows, {current: false});
    await assert.rejects(searchGuildDirectory(f.pool, actor, params()), failure('session_expired'));
    assert.match(f.calls.at(-2)!.sql, /clock_timestamp\(\)/);
    assert.equal(f.calls.at(-1)?.sql, 'ROLLBACK'); assert.equal(f.released(), true);
  }
});

test('actor and query are snapshotted before the first asynchronous connection', async () => {
  const f = fixture(); const input = {...actor}; const query = params();
  const pending = searchGuildDirectory(f.pool, input, query);
  input.user_id = 'changed'; input.session_hash = 'changed'; query.set('q', 'changed');
  await pending;
  assert.deepEqual(f.calls.find(call => call.sql.includes('FROM users'))!.values, [actor.user_id, actor.community_id]);
  assert.equal(f.calls.find(call => call.sql.includes('positioning_guild_catalog'))!.values[0], '%資安%');
  assert.deepEqual(f.calls.at(-2)!.values, [actor.session_hash, actor.user_id]);
});
