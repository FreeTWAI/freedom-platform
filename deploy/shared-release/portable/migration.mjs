// Transaction port over the existing installed migration runner. No private
// host imports, role creation, superuser connection, or automatic replay.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareMigrationInstallation, runInstalledMigrations } from '../../cloudflare/migration-operator.mjs';
import { readMigrationSources } from '../../../packages/db/migration-files.mjs';
import { resolveMigrationPlan, migrationLedgerDigest, LEGACY_MIGRATIONS } from '../../../packages/db/migration-plan.mjs';
import { requireRelease as check, isSha, isDigest } from '../admission.mjs';
import { privateBackupRoot } from './backup-storage.mjs';
import { readCanonicalSql, runCanonicalSql } from './canonical-sql.mjs';

const IDENTITY = 'SELECT current_database() database,current_user role,session_user session_role,current_schema() schema';
const LEDGER = 'SELECT name,sha256 FROM schema_migrations ORDER BY name LIMIT 1001';
const hash = value => createHash('sha256').update(value).digest('hex');
const same = (a, b, code) => check(JSON.stringify(a) === JSON.stringify(b), code);
const quote = value => { check(/^[a-z][a-z0-9_]{0,62}$/.test(value), 'release_migration_identifier_invalid'); return `"${value}"`; };

/** Preparation is not approval. The enclosing controller must bind this result
 * to its admitted source/tree, retained floor and reviewed verification contract. */
export function preparePortableMigration({ sourceRoot, sourceCommit, profile, installationParent, beforeLedger }) {
  check(profile?.format === LEGACY_MIGRATIONS && Array.isArray(beforeLedger) && beforeLedger.length > 0,
    'release_migration_profile_invalid');
  const installation = prepareMigrationInstallation({ sourceRoot, sourceCommit, profile, installationParent });
  const sources = readMigrationSources(join(sourceRoot, 'migrations'));
  const plan = resolveMigrationPlan(sources, profile, beforeLedger);
  return Object.freeze({ installation, canonical: readCanonicalSql(sourceRoot, sourceCommit),
    beforeLedger: structuredClone(beforeLedger), afterLedger: plan.ledger, pending: plan.pending,
    beforeDigest: migrationLedgerDigest(beforeLedger), afterDigest: plan.ledger_digest,
    schemaVersion: profile.last, sourceCommit, sourceTree: installation.source_tree });
}

async function journal(root, name, value) {
  await privateBackupRoot(root);
  const f = await open(join(root, name + '.json'), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await f.writeFile(JSON.stringify(value) + '\n'); await f.sync(); } finally { await f.close(); }
  const d = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await d.sync(); } finally { await d.close(); }
}

async function invariants(q) {
  const policies = (await q.query(`SELECT purpose,mode,policy_lock,policy_revision,persistence_allowed,
    retained_byte_limit::text AS retained_byte_limit FROM domain_media_storage_policy ORDER BY purpose`)).rows;
  check(policies.length > 0 && policies.length <= 100 && policies.every(row => row.policy_lock === 0), 'release_migration_policy_invalid');
  const gc = (await q.query(`SELECT (SELECT count(*)::int FROM asset_maintenance_policy) policies,
    (SELECT bool_or(enabled) FROM asset_maintenance_policy) enabled,
    (SELECT bool_or(domain_media_enabled) FROM asset_maintenance_policy) domain_enabled,
    (SELECT count(*)::int FROM assets WHERE deletion_fence<>0) fences,
    (SELECT count(*)::int FROM asset_deletion_tombstones) tombstones`)).rows[0];
  check(gc?.policies === 1 && gc.enabled === false && gc.domain_enabled === false && gc.fences === 0,
    'release_migration_gc_not_disabled');
  return { materialPolicySha256: hash(JSON.stringify(policies)), gc };
}

async function verify(q, { database, plan, expected }) {
  const runtime = database + '_app', migrator = database + '_migrator', backup = database + '_backup';
  const rows = await runCanonicalSql(q, plan.canonical, '30-verify-readonly.psql', { runtime, migrator });
  check(rows.some(row => row.pg_major === 18) && rows.filter(row => 'private_policy_unsafe' in row).length === 2
    && rows.filter(row => 'media_policy_unsafe' in row).length === 1
    && rows.some(row => row.operator_media_tables === 4 && row.operator_media_functions === 24), 'release_migration_checks_missing');
  for (const row of rows) for (const [key, value] of Object.entries(row)) {
    if (key.endsWith('_unsafe') || key === 'runtime_can_create_in_public') check(value === false, 'release_migration_unsafe_grants');
    if (['objects_owned_by_runtime', 'objects_not_owned_by_migrator', 'runtime_ledger_write'].includes(key)) {
      check(Number(value) === 0, 'release_migration_unsafe_ownership');
    }
  }
  same((await q.query(LEDGER)).rows, plan.afterLedger, 'release_migration_final_ledger_changed');
  const roles = (await q.query(`SELECT rolname,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,
    EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) member FROM pg_roles r WHERE rolname=ANY($1::text[])`,
  [[runtime, migrator, backup]])).rows;
  check(roles.length === 3 && roles.every(row => !row.rolsuper && !row.rolcreaterole && !row.rolcreatedb
    && !row.rolreplication && !row.member && row.rolbypassrls === (row.rolname === backup)), 'release_migration_role_unsafe');
  const tables = (await q.query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,
    has_table_privilege($1,c.oid,'SELECT') readable,has_table_privilege($2,c.oid,'SELECT') backup_readable
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname`, [runtime, backup])).rows;
  check(tables.length > 0 && tables.every(row => row.backup_readable && !row.relforcerowsecurity), 'release_migration_backup_permissions');
  const publicAcl = (await q.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE n.nspname='public' AND c.relkind='r' AND a.grantee=0`)).rows;
  check(publicAcl.length === 0, 'release_migration_public_table_privileges');
  const rls = tables.filter(row => row.relrowsecurity).map(row => row.relname);
  same(rls, expected.rlsTables, 'release_migration_rls_changed');
  same(tables.filter(row => !row.readable).map(row => row.relname), expected.runtimeUnreadable, 'release_migration_runtime_read_changed');
  const defs = (await q.query(`SELECT pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef`)).rows;
  for (const row of defs) for (const table of rls) check(!new RegExp('\\b' + table + '\\b', 'i').test(row.definition), 'release_migration_definer_rls');
  const sequences = (await q.query(`WITH sequences AS MATERIALIZED (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='S') SELECT count(*)::int unsafe FROM sequences WHERE has_sequence_privilege($1,oid,'UPDATE')`, [runtime])).rows;
  check(sequences[0]?.unsafe === 0, 'release_migration_sequence_writer');
  for (const item of expected.tablePrivileges) {
    const actual = (await q.query(`SELECT has_table_privilege($1,$2,'SELECT') s,has_table_privilege($1,$2,'INSERT') i,
      has_table_privilege($1,$2,'UPDATE') u,has_table_privilege($1,$2,'DELETE') d,
      has_table_privilege($1,$2,'TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') extra,
      has_table_privilege($1,$2,'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION') grantable`,
    [database + item.roleSuffix, 'public.' + item.table])).rows[0];
    same(actual, item.privileges, 'release_migration_table_privileges');
  }
  return tables;
}

async function probe(pool, database, suffix, tables) {
  const q = await pool.connect(); let broken = true;
  try {
    await q.query('BEGIN READ ONLY');
    same((await q.query(IDENTITY)).rows[0], { database, role: database + suffix, session_role: database + suffix, schema: 'public' }, 'release_migration_probe_identity');
    for (const table of tables) await q.query('SELECT 1 FROM public.' + quote(table) + ' LIMIT 0');
    await q.query('ROLLBACK'); broken = false;
    return { role: database + suffix, readOnly: true, tables: tables.length };
  } finally { q.release(broken); }
}

/** assertFloor, retainCommitIntent and retainCommittedFloor are mandatory external
 * control ports. No self-observed digest or no-op default is release authority.
 * journalRoot must persist privately after an uncertain COMMIT; never replay it. */
export async function runPortableMigration({ pool, runtimePool, backupPool, database, plan, expected,
  beforeBackup, previousSourceSha, journalRoot, lease, assertFloor, verifyRetainedConstraints, retainCommitIntent, retainCommittedFloor }) {
  check(/^[a-z][a-z0-9_]{0,45}$/.test(database) && isSha(previousSourceSha)
    && plan?.canonical?.sourceCommit === plan.sourceCommit && isSha(plan.sourceCommit) && isSha(plan.sourceTree)
    && isDigest(expected?.materialPolicySha256) && Array.isArray(expected.rlsTables) && expected.rlsTables.length > 0
    && Array.isArray(expected.runtimeUnreadable) && Array.isArray(expected.tablePrivileges)
    && typeof assertFloor === 'function' && typeof verifyRetainedConstraints === 'function' && typeof retainCommitIntent === 'function'
    && typeof retainCommittedFloor === 'function', 'release_migration_input_invalid');
  plan = structuredClone(plan); expected = structuredClone(expected); beforeBackup = structuredClone(beforeBackup);
  const role = database + '_migrator';
  const assertHeld = () => { lease.signal.throwIfAborted(); lease.assertHeld(); };
  const freshBackup = () => {
    const age = Date.now() - Date.parse(beforeBackup?.createdAt);
    check(beforeBackup?.status === 'passed' && beforeBackup.database === database && beforeBackup.sourceRelease === previousSourceSha
      && beforeBackup.restore === 'database_and_objects_restored' && beforeBackup.remoteReadback === 'verified'
      && beforeBackup.cleanupVerified === true && isDigest(beforeBackup.archiveSha256)
      && Number.isFinite(age) && age >= 0 && age < 7200000, 'release_migration_before_backup_invalid');
  };
  assertHeld(); freshBackup(); await assertFloor(); await privateBackupRoot(journalRoot);
  const client = await pool.connect(); let outcome = 'not_attempted', transactionId = null, broken = false, failed = false;
  const onError = () => { broken = true; }; client.on('error', onError);
  const q = { async query(text, values) {
    assertHeld(); check(!broken, 'release_migration_connection_lost');
    return client.query({ text, values, query_timeout: 135000 });
  } };
  try {
    await q.query('BEGIN READ ONLY');
    same((await q.query(IDENTITY)).rows[0], { database, role, session_role: role, schema: 'public' }, 'release_migration_identity');
    same((await q.query(LEDGER)).rows, plan.beforeLedger, 'release_migration_before_ledger_changed');
    const baseline = await invariants(q);
    check(baseline.materialPolicySha256 === expected.materialPolicySha256, 'release_migration_policy_changed');
    await q.query('ROLLBACK');
    await journal(journalRoot, 'intent', { source: plan.sourceCommit, tree: plan.sourceTree, database,
      beforeDigest: plan.beforeDigest, afterDigest: plan.afterDigest, backupSetId: beforeBackup.setId, automaticRetry: false });
    const port = { async connect() { return { async query(text, values) {
      if (text === 'BEGIN') { await q.query(text); await q.query("SET LOCAL lock_timeout='10000'; SET LOCAL statement_timeout='120000'"); return { command: 'BEGIN', rows: [] }; }
      if (text.startsWith('CREATE TABLE IF NOT EXISTS schema_migrations')) {
        same((await q.query(LEDGER)).rows, plan.beforeLedger, 'release_migration_before_ledger_changed');
        return { rows: [] }; // Existing production ledger only, never bootstrap.
      }
      if (text === 'COMMIT') {
        same((await q.query(LEDGER)).rows, plan.afterLedger, 'release_migration_after_ledger_changed');
        same(await invariants(q), baseline, 'release_migration_invariants_changed');
        await runCanonicalSql(q, plan.canonical, '20-runtime-grants.psql', { runtime: database + '_app', migrator: role });
        await verify(q, { database, plan, expected });
        await verifyRetainedConstraints(q);
        freshBackup(); await assertFloor(); assertHeld();
        transactionId = (await q.query('SELECT pg_current_xact_id()::text id')).rows[0].id;
        check(/^[1-9][0-9]*$/.test(transactionId), 'release_migration_xid_invalid');
        const binding = { source: plan.sourceCommit, tree: plan.sourceTree, database, transactionId,
          beforeDigest: plan.beforeDigest, afterDigest: plan.afterDigest, automaticRetry: false };
        await journal(journalRoot, 'attempt', binding);
        // A fresh runner must be able to observe this transaction even when the
        // local disk and COMMIT reply are lost. Failure here rolls back the DDL.
        await retainCommitIntent(structuredClone(binding));
        freshBackup(); assertHeld();
        outcome = 'unknown';
        const result = await q.query('COMMIT');
        check(result.command === 'COMMIT', 'release_migration_commit_unconfirmed'); outcome = 'confirmed';
        await journal(journalRoot, 'committed', binding);
        await retainCommittedFloor({ ...binding, schemaVersion: plan.schemaVersion, ledger: plan.afterLedger });
        return result;
      }
      if (text === 'ROLLBACK' && outcome !== 'not_attempted') return { command: 'ROLLBACK_SUPPRESSED', rows: [] };
      return q.query(text, values);
    }, release() {} }; } };
    const i = plan.installation;
    const result = await runInstalledMigrations(port, { installationDirectory: i.installation_directory,
      expectedInstallationDigest: i.installation_digest, expectedSourceCommit: plan.sourceCommit,
      expectedProfileDigest: i.profile_digest, target: { database, role, schema: 'public' } });
    same(result.applied, plan.pending, 'release_migration_plan_changed');
    await q.query('BEGIN READ ONLY'); const tables = await verify(q, { database, plan, expected });
    await verifyRetainedConstraints(q);
    same(await invariants(q), baseline, 'release_migration_post_commit_changed'); await q.query('ROLLBACK');
    const probes = [await probe(runtimePool, database, '_app', tables.filter(row => row.readable).map(row => row.relname)),
      await probe(backupPool, database, '_backup', tables.map(row => row.relname))];
    assertHeld();
    const receipt = { source: plan.sourceCommit, database, transactionId, applied: result.applied,
      outcome: plan.pending.length ? 'committed' : 'unchanged', commitStatus: outcome,
      ledgerVerified: true, runtimeGrantsVerified: true, probes, automaticRetry: false };
    await journal(journalRoot, 'completed', receipt); return receipt;
  } catch (error) {
    failed = true;
    if (outcome === 'not_attempted') await client.query('ROLLBACK').catch(() => { broken = true; });
    // Do not manufacture a rollback result for a possibly committed transaction.
    await journal(journalRoot, 'failed', { source: plan.sourceCommit, database, transactionId,
      commitStatus: outcome, automaticRetry: false }).catch(() => {});
    throw error;
  } finally { client.removeListener('error', onError); client.release(failed || broken || outcome === 'unknown'); }
}

/** Read-only reconciliation never authorizes replay, even for a proven abort. */
export async function observeMigrationOutcome(pool, attempt) {
  check(isSha(attempt?.source) && isSha(attempt?.tree) && /^[1-9][0-9]*$/.test(attempt.transactionId)
    && isDigest(attempt.beforeDigest) && isDigest(attempt.afterDigest), 'release_migration_attempt_invalid');
  const q = await pool.connect(); let broken = true;
  try {
    await q.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    same((await q.query(IDENTITY)).rows[0], { database: attempt.database, role: attempt.database + '_migrator',
      session_role: attempt.database + '_migrator', schema: 'public' }, 'release_migration_observe_identity');
    const status = (await q.query('SELECT pg_xact_status($1::xid8) status', [attempt.transactionId])).rows[0]?.status;
    const ledger = migrationLedgerDigest((await q.query(LEDGER)).rows);
    const outcome = status === 'committed' && ledger === attempt.afterDigest ? 'committed_ledger_verified'
      : status === 'aborted' && ledger === attempt.beforeDigest ? 'aborted_ledger_verified' : 'unresolved';
    await q.query('ROLLBACK'); broken = false;
    return { outcome, postCommitVerification: 'required', resumeAuthorized: false, automaticRetry: false };
  } finally { q.release(broken); }
}

/** Ordinary code release: prove the existing schema/grants without DDL, grant
 * repair, migration COMMIT, capture, dump or restore. Schema changes use the
 * separately reviewed migration operation with its existing recovery guards. */
export async function verifyUnchangedSchema({ pool, runtimePool, database, plan, expected, lease, floor }) {
  check(plan.pending.length === 0 && plan.beforeDigest === plan.afterDigest,
    'release_schema_change_requires_migration');
  const held = () => { lease.signal.throwIfAborted(); lease.assertHeld(); };
  held(); await floor.assertCurrent();
  const q = await pool.connect(); let healthy = false, tables;
  try {
    await q.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await q.query("SET LOCAL statement_timeout='30000'; SET LOCAL lock_timeout='3000'");
    same((await q.query(IDENTITY)).rows[0], { database, role: database + '_migrator',
      session_role: database + '_migrator', schema: 'public' }, 'release_migration_identity');
    check((await invariants(q)).materialPolicySha256 === expected.materialPolicySha256, 'release_migration_policy_changed');
    tables = await verify(q, { database, plan, expected }); await floor.verifyDatabase(q);
    held(); await q.query('ROLLBACK'); healthy = true;
  } finally { q.release(!healthy); }
  await probe(runtimePool, database, '_app', tables.filter(row => row.readable).map(row => row.relname));
  held(); await floor.assertCurrent();
  return { outcome: 'unchanged', ledgerVerified: true, runtimeGrantsVerified: true, readOnly: true,
    ledgerSha256: plan.afterDigest };
}
