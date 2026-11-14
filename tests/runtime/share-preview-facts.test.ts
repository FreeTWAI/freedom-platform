import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { migrate } from '../../scripts/database.js';
import { seedLocal, DEMO_USERS, DEMO_COMMUNITY } from '../../packages/testing/seed.js';
import type { Actor } from '../../modules/identity-membership/service.js';
import { previewShare, createShare } from '../../modules/shares/service.js';
import { pruneExpiredAuthRecords } from '../../modules/identity-membership/auth-pruning.js';
import type { RepositoryFacts } from '../../modules/shares/types.js';

const url = process.env.TEST_DATABASE_URL;
assert.ok(url, 'Set an isolated TEST_DATABASE_URL');
const schema = `fp_share_preview_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: url });
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });

let actors: Actor[] = [];

const makeRepoPayload = (id: number, fullName: string, extra: Record<string, unknown> = {}) => ({
  id,
  full_name: fullName,
  private: false,
  visibility: 'public',
  archived: false,
  fork: false,
  owner: { id: 9900 + id, login: fullName.split('/')[0] },
  default_branch: 'main',
  description: `Description for ${fullName}`,
  stargazers_count: 42,
  forks_count: 5,
  open_issues_count: 1,
  subscribers_count: 3,
  pushed_at: '2026-10-01T00:00:00Z',
  language: 'TypeScript',
  topics: ['demo'],
  homepage: null,
  license: { spdx_id: 'MIT' },
  ...extra,
});

const cmd = (actor: Actor, body: unknown, operation = 'POST /shares', key = randomUUID()) => ({
  actor,
  body,
  operation,
  key,
});

before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
  await seedLocal(pool);
  for (let i = 0; i < 2; i++) {
    const id = i === 0 ? DEMO_USERS[0].user_id : randomUUID();
    const token = randomUUID();
    if (i > 0) {
      await pool.query(
        `INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,active,onboarding_required)
         SELECT $1,community_id,$2,'Synthetic sharer',password_hash,$3,true,false FROM users WHERE user_id=$4`,
        [id, `preview-facts-${i}@example.com`, randomUUID(), DEMO_USERS[0].user_id],
      );
    }
    await pool.query(
      `INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$1,now()+interval '1 day')`,
      [token, id],
    );
    actors.push({ user_id: id, community_id: DEMO_COMMUNITY, session_hash: token } as Actor);
  }
});

after(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

test('I1: share_preview_facts table exists with PK (user_id, url_key) and cascades on user delete', async () => {
  const cols = await pool.query(
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = 'share_preview_facts'
     ORDER BY ordinal_position`,
    [schema],
  );
  assert.deepEqual(
    cols.rows.map((r) => [r.column_name, r.data_type, r.is_nullable]),
    [
      ['user_id', 'uuid', 'NO'],
      ['url_key', 'text', 'NO'],
      ['facts', 'jsonb', 'NO'],
      ['created_at', 'timestamp with time zone', 'NO'],
    ],
  );

  const pk = await pool.query(
    `SELECT kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     WHERE tc.table_schema = $1 AND tc.table_name = 'share_preview_facts' AND tc.constraint_type = 'PRIMARY KEY'
     ORDER BY kcu.ordinal_position`,
    [schema],
  );
  assert.deepEqual(pk.rows.map((r) => r.column_name), ['user_id', 'url_key']);

  const mig = await pool.query(
    `SELECT name FROM schema_migrations WHERE name = '213_share_preview_facts.sql'`,
  );
  assert.equal(mig.rowCount, 1);

  const tempUser = randomUUID();
  await pool.query(
    `INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,active,onboarding_required)
     SELECT $1,community_id,$2,'Cascade user',password_hash,$3,true,false FROM users WHERE user_id=$4`,
    [tempUser, `cascade-${tempUser}@example.com`, randomUUID(), DEMO_USERS[0].user_id],
  );
  await pool.query(
    `INSERT INTO share_preview_facts(user_id, url_key, facts) VALUES($1, $2, '{"id":"1"}'::jsonb)`,
    [tempUser, 'a'.repeat(64)],
  );
  await pool.query(`DELETE FROM users WHERE user_id = $1`, [tempUser]);
  const remaining = await pool.query(
    `SELECT 1 FROM share_preview_facts WHERE user_id = $1`,
    [tempUser],
  );
  assert.equal(remaining.rowCount, 0);
});

test('I2: preview then create makes one GitHub repository request and reuses normalized URL', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (input) => {
    calls++;
    const path = new URL(String(input)).pathname;
    if (path === '/repos/fixture/fork-one') {
      return Response.json(makeRepoPayload(5002, 'fixture/fork-one', { fork: true, source: { full_name: 'fixture/upstream-one' } }));
    }
    return Response.json(makeRepoPayload(5001, 'fixture/upstream-one'));
  };

  const preview = await previewShare(
    pool,
    cmd(actors[0], { kind: 'repository', url: 'https://github.com/fixture/fork-one' }, 'POST /shares/preview'),
    { fetcher },
  );
  assert.equal(preview.kind, 'repository');
  assert.equal(preview.title, 'fixture/upstream-one');
  assert.equal(calls, 2); // 1 for fork, 1 for upstream during preview

  let prepared: RepositoryFacts | undefined;
  const created = await createShare(
    pool,
    cmd(actors[0], { kind: 'repository', url: 'https://github.com/Fixture/Fork-One/' }),
    { fetcher },
    (facts) => {
      prepared = facts;
    },
  );
  assert.equal(created.created, true);
  assert.equal(calls, 2); // zero extra GitHub requests on create
  assert.equal(prepared?.id, '5001');
  assert.equal(prepared?.full_name, 'fixture/upstream-one');
});

test('I2: create 16 minutes after preview resolves again and re-preview refreshes created_at', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return Response.json(makeRepoPayload(5003, 'fixture/stale-repo'));
  };

  await previewShare(
    pool,
    cmd(actors[0], { url: 'https://github.com/fixture/stale-repo' }, 'POST /shares/preview'),
    { fetcher },
  );
  assert.equal(calls, 1);

  await pool.query(
    `UPDATE share_preview_facts SET created_at = now() - interval '16 minutes' WHERE user_id = $1`,
    [actors[0].user_id],
  );

  const created = await createShare(
    pool,
    cmd(actors[0], { url: 'https://github.com/fixture/stale-repo' }),
    { fetcher },
  );
  assert.equal(created.created, true);
  assert.equal(calls, 2);

  // Upsert on second preview resets created_at = now(), so a second create within 15m hits cache
  await previewShare(
    pool,
    cmd(actors[0], { url: 'https://github.com/fixture/stale-repo' }, 'POST /shares/preview'),
    { fetcher },
  );
  assert.equal(calls, 3);
  await createShare(
    pool,
    cmd(actors[0], { url: 'https://github.com/fixture/stale-repo' }),
    { fetcher },
  );
  assert.equal(calls, 3);
});

test('I2: another member preview is not reused', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return Response.json(makeRepoPayload(5004, 'fixture/other-member-repo'));
  };

  await previewShare(
    pool,
    cmd(actors[0], { url: 'https://github.com/fixture/other-member-repo' }, 'POST /shares/preview'),
    { fetcher },
  );
  assert.equal(calls, 1);

  await createShare(
    pool,
    cmd(actors[1], { url: 'https://github.com/fixture/other-member-repo' }),
    { fetcher },
  );
  assert.equal(calls, 2);
});

test('I2: failed preview stores nothing and request body cannot supply facts', async () => {
  await pool.query(`DELETE FROM share_preview_facts WHERE user_id = $1`, [actors[1].user_id]);
  let calls = 0;
  const failingFetcher: typeof fetch = async () => {
    calls++;
    return Response.json({ id: 5005, full_name: 'fixture/private-repo', private: true, visibility: 'private', archived: false, fork: false });
  };

  await assert.rejects(
    previewShare(
      pool,
      cmd(actors[1], { url: 'https://github.com/fixture/private-repo' }, 'POST /shares/preview'),
      { fetcher: failingFetcher },
    ),
  );
  assert.equal(calls, 1);

  await assert.rejects(
    previewShare(
      pool,
      cmd(actors[1], { url: 'https://github.com/fixture/private-repo', facts: { id: '999' } }, 'POST /shares/preview'),
      { fetcher: failingFetcher },
    ),
  );

  const rows = await pool.query(`SELECT 1 FROM share_preview_facts WHERE user_id = $1`, [actors[1].user_id]);
  assert.equal(rows.rowCount, 0);
});

test('I2: agent lane preview then create makes one GitHub repository request', async () => {
  const connId = randomUUID();
  const rawToken = `fw_agent_${'a'.repeat(43)}`;
  const tHash = createHash('sha256').update(rawToken).digest('hex');
  await pool.query(
    `INSERT INTO agent_token_connections(connection_id, community_id, user_id, client_name, kind, scope, scopes, token_hash, expires_at, public_confirmed_at)
     VALUES($1, $2, $3, 'test-agent', 'agent', 'agent', ARRAY['share'], $4, now() + interval '1 day', now())`,
    [connId, DEMO_COMMUNITY, actors[1].user_id, tHash],
  );
  const agentActor: Actor = {
    ...actors[1],
    session_hash: '',
    csrf_token: '',
    agent: { connection_id: connId, token_hash: tHash, scopes: ['share'], scope: 'share', public_item: true },
  };

  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return Response.json(makeRepoPayload(5006, 'fixture/agent-repo'));
  };

  await previewShare(
    pool,
    cmd(agentActor, { kind: 'repository', url: 'https://github.com/fixture/agent-repo' }, 'POST /shares/preview'),
    { fetcher },
  );
  assert.equal(calls, 1);

  const created = await createShare(
    pool,
    cmd(
      { ...agentActor, agent: { ...agentActor.agent!, operation: 'POST /shares' } },
      { kind: 'repository', url: 'https://github.com/fixture/agent-repo' },
    ),
    { fetcher },
  );
  assert.equal(created.created, true);
  assert.equal(calls, 1);
});

test('I3: pruneExpiredAuthRecords removes rows older than 1 hour and keeps fresh rows', async () => {
  const oldKey = 'b'.repeat(64);
  const freshKey = 'c'.repeat(64);
  await pool.query(
    `INSERT INTO share_preview_facts(user_id, url_key, facts, created_at)
     VALUES ($1, $2, '{"id":"old"}'::jsonb, now() - interval '2 hours'),
            ($1, $3, '{"id":"fresh"}'::jsonb, now())
     ON CONFLICT (user_id, url_key) DO UPDATE SET facts = EXCLUDED.facts, created_at = EXCLUDED.created_at`,
    [actors[0].user_id, oldKey, freshKey],
  );

  await pruneExpiredAuthRecords(pool);

  const remaining = await pool.query<{ url_key: string }>(
    `SELECT url_key FROM share_preview_facts WHERE user_id = $1 AND url_key = ANY($2::text[]) ORDER BY url_key`,
    [actors[0].user_id, [oldKey, freshKey]],
  );
  assert.deepEqual(
    remaining.rows.map((r) => r.url_key),
    [freshKey],
  );
});
