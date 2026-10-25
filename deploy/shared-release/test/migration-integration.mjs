// Real PG18 transactions and canonical grants, with synthetic source/roles.
// No external database, provider writes, release approval or production evidence.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { git, coreFiles } from '../../cloudflare/test/migration-fixtures.mjs';
import { readMigrationSources } from '../../../packages/db/migration-files.mjs';
import { runMigrationPlan } from '../../../packages/db/migration-runner.mjs';
import { LEGACY_MIGRATIONS } from '../../../packages/db/migration-plan.mjs';
import { observeBackupControl } from '../portable/backup.mjs';
import { preparePortableMigration, runPortableMigration, observeMigrationOutcome } from '../portable/migration.mjs';
import { runCanonicalSql } from '../portable/canonical-sql.mjs';
import { acquireReleaseLease } from '../portable/lease.mjs';

export async function verifyMigration({ root, openCluster }) {
  const repo = fileURLToPath(new URL('../../../', import.meta.url));
  const cluster = await openCluster('migration-source'), database = cluster.databaseName;
  const source = join(root, 'migration-source-tree'), host = join(root, 'migration-tools');
  await mkdir(source, { mode: 0o700 }); await mkdir(host, { mode: 0o700 });
  git(source, ['init', '-q', '-b', 'main']);
  const put = async (path, bytes) => { await mkdir(dirname(join(source, path)), { recursive: true, mode: 0o700 }); await writeFile(join(source, path), bytes); };
  for (const path of [...coreFiles, 'deploy/cloudflare/sql/20-runtime-grants.psql', 'deploy/cloudflare/sql/30-verify-readonly.psql']) {
    await put(path, await readFile(join(repo, path)));
  }
  const sources = readMigrationSources(join(repo, 'migrations'));
  for (const item of sources) await put('migrations/' + item.name, item.sql);
  const last = Math.max(...sources.map(item => Number(item.name.slice(0, 3))));
  const profile = { format: LEGACY_MIGRATIONS, first: 1, last, known_gaps: [22] };
  const pending = `${String(last + 1).padStart(3, '0')}_shared_release_fixture.sql`;
  await put('migrations/' + pending, `CREATE TABLE shared_release_fixture(id integer PRIMARY KEY);
ALTER TABLE shared_release_fixture ENABLE ROW LEVEL SECURITY;
INSERT INTO shared_release_fixture VALUES(1);
`);
  git(source, ['add', '.']); git(source, ['commit', '-qm', 'Synthetic shared migration source']);
  const sourceCommit = git(source, ['rev-parse', 'HEAD']);
  const migrator = database + '_migrator', runtime = database + '_app', backup = database + '_backup';
  await cluster.pool.query(`CREATE ROLE ${migrator} LOGIN; CREATE ROLE ${runtime} LOGIN; CREATE ROLE ${backup} LOGIN BYPASSRLS;
    CREATE SCHEMA public AUTHORIZATION ${migrator}; GRANT USAGE ON SCHEMA public TO ${runtime},${backup};`);
  const connect = user => new Pool({ host: cluster.socket, port: 5432, user, database, max: 4,
    connectionTimeoutMillis: 5000, query_timeout: 135000 });
  const pool = connect(migrator), runtimePool = connect(runtime), backupPool = connect(backup);
  let lease, floorCalls = 0;
  try {
    await runMigrationPlan(pool, { sources, profile, target: { database, role: migrator, schema: 'public' } });
    await pool.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${backup};
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${backup};`);
    const beforeLedger = (await pool.query('SELECT name,sha256 FROM schema_migrations ORDER BY name')).rows;
    const prepare = ledger => preparePortableMigration({ sourceRoot: source, sourceCommit,
      profile: { ...profile, last: last + 1 }, installationParent: host, beforeLedger: ledger });
    const plan = prepare(beforeLedger);
    // The already-existing live contract is sampled only in this fixture. A
    // production controller must obtain its contract from reviewed authority.
    await pool.query('BEGIN'); await runCanonicalSql(pool, plan.canonical, '20-runtime-grants.psql', { runtime, migrator }); await pool.query('COMMIT');
    const rlsTables = (await pool.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relrowsecurity ORDER BY c.relname`)).rows.map(row => row.relname);
    const runtimeUnreadable = (await pool.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' AND NOT has_table_privilege($1,c.oid,'SELECT') ORDER BY c.relname`, [runtime])).rows.map(row => row.relname);
    const expected = { materialPolicySha256: (await observeBackupControl(pool)).materialPolicySha256,
      rlsTables: [...rlsTables, 'shared_release_fixture'].sort(), runtimeUnreadable,
      tablePrivileges: [
        { table: 'shared_release_fixture', roleSuffix: '_app', privileges: { s: true, i: true, u: true, d: true, extra: false, grantable: false } },
        { table: 'shared_release_fixture', roleSuffix: '_backup', privileges: { s: true, i: false, u: false, d: false, extra: false, grantable: false } },
      ] };
    lease = await acquireReleaseLease(pool, { database, role: migrator, heartbeatMs: 50 });
    const beforeBackup = { status: 'passed', database, sourceRelease: 'a'.repeat(40), createdAt: new Date().toISOString(),
      restore: 'database_and_objects_restored', remoteReadback: 'verified', cleanupVerified: true,
      archiveSha256: 'b'.repeat(64), setId: 'synthetic-before-backup' };
    const journalRoot = async label => { const path = join(root, label); await mkdir(path, { mode: 0o700 }); return path; };
    const args = { pool, runtimePool, backupPool, database, plan, expected, beforeBackup, previousSourceSha: 'a'.repeat(40), lease,
      assertFloor: async () => { lease.assertHeld(); },
      retainCommittedFloor: async value => { assert.equal(value.afterDigest, plan.afterDigest); floorCalls++; } };

    const wrong = await journalRoot('migration-wrong-policy');
    await assert.rejects(runPortableMigration({ ...args, journalRoot: wrong,
      expected: { ...expected, materialPolicySha256: 'f'.repeat(64) } }), { code: 'release_migration_policy_changed' });
    assert.equal((await pool.query("SELECT to_regclass('public.shared_release_fixture') relation")).rows[0].relation, null);
    const rejected = await journalRoot('migration-grants-rejected');
    // Canonical grants cannot remove PUBLIC authority; its guard must abort all
    // the DDL and ledger writes in this same transaction.
    await pool.query('GRANT UPDATE ON domain_media_storage_policy TO PUBLIC');
    await assert.rejects(runPortableMigration({ ...args, journalRoot: rejected }), /Unsafe runtime domain media policy privileges/);
    assert.equal((await pool.query("SELECT to_regclass('public.shared_release_fixture') relation")).rows[0].relation, null);
    assert.deepEqual((await pool.query('SELECT name,sha256 FROM schema_migrations ORDER BY name')).rows, beforeLedger);
    assert.equal(floorCalls, 0); await pool.query('REVOKE UPDATE ON domain_media_storage_policy FROM PUBLIC');
    await assert.rejects(runPortableMigration({ ...args, journalRoot: rejected }), { code: 'EEXIST' });

    const goodRoot = await journalRoot('migration-confirmed');
    const result = await runPortableMigration({ ...args, journalRoot: goodRoot });
    assert.equal(result.outcome, 'committed'); assert.equal(result.commitStatus, 'confirmed');
    assert.deepEqual(result.applied, [pending]); assert.equal(floorCalls, 1);
    assert(result.probes.every(value => value.readOnly && value.tables > 300));
    assert.equal((await pool.query('SELECT count(*)::int count FROM shared_release_fixture')).rows[0].count, 1);
    const nextPlan = prepare(plan.afterLedger); let commits = 0;
    const lostReply = { async connect() {
      const client = await pool.connect();
      return { on: (...items) => client.on(...items), removeListener: (...items) => client.removeListener(...items),
        release: destroy => client.release(destroy), async query(input, values) {
          const result = await client.query(input, values);
          if ((typeof input === 'string' ? input : input.text) === 'COMMIT') { commits++; throw Error('synthetic lost COMMIT reply'); }
          return result;
        } };
    } };
    const unknownRoot = await journalRoot('migration-unknown');
    await assert.rejects(runPortableMigration({ ...args, pool: lostReply, plan: nextPlan, journalRoot: unknownRoot }), /synthetic lost COMMIT reply/);
    assert.equal(commits, 1); assert.equal(floorCalls, 1);
    const failure = JSON.parse(await readFile(join(unknownRoot, 'failed.json'))); assert.equal(failure.commitStatus, 'unknown');
    const attempt = JSON.parse(await readFile(join(unknownRoot, 'attempt.json')));
    assert.deepEqual(await observeMigrationOutcome(pool, attempt), {
      outcome: 'committed_ledger_verified', postCommitVerification: 'required', resumeAuthorized: false, automaticRetry: false,
    });
    await assert.rejects(runPortableMigration({ ...args, plan: nextPlan, journalRoot: unknownRoot }), { code: 'EEXIST' });
    assert.equal(commits, 1); lease.assertHeld();
    return { status: 'passed', realMigratorRole: true, migrationAndGrantsAtomic: true, existingIntentRefusesReplay: true,
      actualRuntimeAndBackupProbes: true, unknownCommitObservedWithoutReplay: true,
      sourceInstallationVerified: true, retainedFloor: 'synthetic-callback', remote: 'not_run' };
  } finally {
    if (lease) await lease.release();
    await Promise.all([pool.end(), runtimePool.end(), backupPool.end()]);
    await cluster.dispose();
  }
}
