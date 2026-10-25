// Installed controller code. Run with the pinned tsx loader for the existing TS
// backup/asset modules; never load a dispatch-supplied adapter or executable.
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { Pool } from 'pg';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { runDailyBackup } from '../../../packages/media-migration/backup-daily.ts';
import { createFileArchiveStore } from '../../../packages/media-migration/backup-archive-fs.ts';
import { observeMediaGcState } from '../../../packages/media-migration/backup-gc-precondition.ts';
import { createAssetMaintenance } from '../../../modules/assets/maintenance.ts';
import { assertObjectKey, validateMetadata } from '../../../packages/asset-storage/index.ts';
import { createR2ObjectStore } from '../../../packages/asset-storage/r2.ts';
import { migrationLedgerDigest } from '../../../packages/db/migration-plan.mjs';
import { requireRelease as check, isSha, isDigest } from '../admission.mjs';
import { openIsolatedPostgres, writeSnapshotDump, runPostgresProcess } from './postgres.mjs';
import { openCapturePolicy } from './capture-policy.mjs';
import { backupObjectStore, backupTar, bytesStream, privateBackupRoot, newBackupDirectories } from './backup-storage.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const POLICY_SQL = `SELECT purpose,mode,policy_lock,policy_revision,persistence_allowed,
  retained_byte_limit::text AS retained_byte_limit FROM domain_media_storage_policy ORDER BY purpose`;

/** Read fixed SQL facts, never supplied success booleans. Expected digests must
 * come from the installed release's approved policy/floor inputs. This reader
 * does not authenticate or advance an external retained floor. */
export async function observeBackupControl(pool) {
  const q = await pool.connect();
  try {
    await q.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await q.query("SET LOCAL statement_timeout='30000'; SET LOCAL lock_timeout='3000'");
    const ledger = (await q.query('SELECT name,sha256 FROM schema_migrations ORDER BY name LIMIT 1001')).rows;
    check(ledger.length > 0 && ledger.length <= 1000, 'release_backup_ledger_invalid');
    const policies = (await q.query(POLICY_SQL)).rows;
    check(policies.length > 0 && policies.length <= 100 && policies.every(row => row.policy_lock === 0),
      'release_backup_policy_invalid');
    const version = Math.max(...ledger.map(row => Number(row.name.match(/^(\d+)_/)?.[1])));
    check(Number.isSafeInteger(version) && version > 0, 'release_backup_ledger_invalid');
    await q.query('COMMIT');
    return Object.freeze({ ledgerSha256: migrationLedgerDigest(ledger), materialPolicySha256: hash(JSON.stringify(policies)), schemaVersion: version });
  } catch (error) { await q.query('ROLLBACK').catch(() => {}); throw error; }
  finally { q.release(); }
}

/** A complete daily capture/seal/readback/isolated-restore adapter, under a lease
 * acquired by the enclosing release. It does not release that lease between
 * backup-before and migration. It retains private dumps/archives and all pins. */
export async function runPortableBackup({ context, workRoot, pool, role, runtimeRole, lease, transport,
  expected, connection, binDirectory, execute = runPostgresProcess }) {
  check(context?.schema === 'public' && context.gcSafety === undefined
    && context.signal === lease?.signal && isSha(context.sourceRelease)
    && ['staging', 'production'].includes(context.environment)
    && transport?.target === (context.environment === 'production' ? 'next' : 'staging-next')
    && expected?.sourceSha === context.sourceRelease && isDigest(expected.bindingsSha256)
    && isDigest(expected.ledgerSha256) && isDigest(expected.materialPolicySha256)
    && Number.isSafeInteger(expected.schemaVersion) && expected.schemaVersion > 0
    && /^[a-z][a-z0-9_]{0,62}$/.test(role) && /^[a-z][a-z0-9_]{0,62}$/.test(runtimeRole)
    && role !== runtimeRole && pool.options.max >= 4 && connection.PGDATABASE === context.database,
  'release_backup_input_invalid');
  expected = Object.freeze(structuredClone(expected));
  context = Object.freeze({ ...context });
  await privateBackupRoot(workRoot);
  let root, archive, objects, policy, restored, mf, restoreRoot, before;
  let archiveSha256, outbound = 0;
  const assertHeld = () => { context.signal.throwIfAborted(); lease.assertHeld(); };
  const verifyControl = async target => {
    const actual = await observeBackupControl(target);
    check(['ledgerSha256', 'materialPolicySha256', 'schemaVersion'].every(key => actual[key] === expected[key]),
      'release_backup_control_mismatch'); return actual;
  };
  const verifySource = async () => {
    assertHeld();
    const worker = await transport.readWorkerState();
    check(worker.sourceSha === expected.sourceSha && worker.bindingsSha256 === expected.bindingsSha256,
      'release_backup_worker_changed');
    await verifyControl(pool);
  };
  const result = await runDailyBackup(context, {
    async preflight() {
      assertHeld();
      const actual = (await pool.query('SELECT current_database() database,current_user role,session_user session_role,current_schema() schema')).rows[0];
      check(actual?.database === context.database && actual.schema === 'public' && actual.role === role && actual.session_role === role,
        'release_backup_target_mismatch');
      await verifySource();
      // A runtime writer with setval/UPDATE authority could rewind captured
      // sequence lower bounds. Role is a parameter, never an SQL identifier.
      const sequences = (await pool.query(`WITH sequences AS MATERIALIZED (
        SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S')
        SELECT count(*)::int count FROM sequences WHERE has_sequence_privilege($1,oid,'UPDATE')`, [runtimeRole])).rows[0];
      check(sequences?.count === 0, 'release_backup_sequence_writer_unfenced');
      before = await observeMediaGcState(pool);
      check(before.maintenanceEnabled === false && before.domainMaintenanceEnabled === false && before.deletionFences === 0,
        'release_backup_gc_not_disabled'); return before;
    },
    async openCapture() {
      await verifySource();
      root = await mkdtemp(join(workRoot, 'backup-'));
      const local = join(root, 'local'); await mkdir(local, { mode: 0o700 }); await newBackupDirectories(local);
      const intents = join(root, 'intents'); await mkdir(intents, { mode: 0o700 });
      archive = await createFileArchiveStore(join(local, 'sealed'));
      objects = backupObjectStore(await createFileArchiveStore(join(local, 'objects')), { assertObjectKey, validateMetadata });
      const control = await createFileArchiveStore(local);
      check(await control.putIfAbsent('control.json', bytesStream(Buffer.from(JSON.stringify({
        format: 'freedom.shared-backup-control/v1', ...expected, setId: context.setId,
        environment: context.environment, database: context.database, schema: 'public', exposure: 'quarantine',
      })))) === 'created', 'release_backup_control_exists');
      policy = await openCapturePolicy({ pool, database: context.database, role, before: before.policySha256,
        revision: 'shared-backup-' + context.setId, intent: await createFileArchiveStore(intents) });
      await policy.enable(); assertHeld();
      const source = transport.sourceObjects({ assertObjectKey, validateMetadata });
      const dump = join(root, 'database.dump');
      return { pool, archive, dump: { async open() { return Readable.toWeb(createReadStream(dump)); } },
        options: { maintenance: createAssetMaintenance(pool, { store: source, enabled: true }), source, destination: objects,
          maxObjects: 1000, maxBytes: 64 * 1024 * 1024,
          databaseSnapshot: { async write(input) {
            assertHeld(); const value = await writeSnapshotDump({ binDirectory, connection, output: dump, input, execute, signal: context.signal });
            assertHeld(); return value;
          } } } };
    },
    async publishAndOpen() {
      await verifySource();
      const bytes = await backupTar('pack', join(root, 'local'), undefined, context.signal);
      const published = await transport.publishArchive({ setId: context.setId, bytes, intentDirectory: join(root, 'intents') });
      check(hash(published.bytes) === hash(bytes) && published.archiveSha256 === hash(bytes), 'release_backup_transport_mismatch');
      archiveSha256 = published.archiveSha256;
      const remote = join(root, 'readback'); await mkdir(remote, { mode: 0o700 });
      await backupTar('unpack', remote, published.bytes, context.signal);
      // An empty media set has no TAR members below objects/.
      await mkdir(join(remote, 'objects'), { mode: 0o700, recursive: true });
      check((await readFile(join(remote, 'control.json'))).equals(await readFile(join(root, 'local/control.json'))),
        'release_backup_control_mismatch');
      assertHeld();
      return { archive: await createFileArchiveStore(join(remote, 'sealed')),
        backupObjects: backupObjectStore(await createFileArchiveStore(join(remote, 'objects')), { assertObjectKey, validateMetadata }),
        publication: published.publication };
    },
    async openRestore() {
      await verifySource();
      restoreRoot = await mkdtemp(join(workRoot, 'r2-'));
      // No upstream binding. Workerd outbound requests are denied, and even an
      // attempted request makes cleanup fail. Local R2 only; never expose it.
      mf = new Miniflare(convertV4MiniflareOptions({ modules: true,
        script: 'export default {fetch(){return new Response(null,{status:503})}}',
        compatibilityDate: '2026-09-21', r2Buckets: ['RECOVERY'], r2Persist: restoreRoot,
        outboundService: () => { outbound++; return new Response(null, { status: 503 }); } }));
      await mf.ready;
      const restoreObjects = createR2ObjectStore(await mf.getR2Bucket('RECOVERY'));
      restored = await openIsolatedPostgres({ workRoot, binDirectory, Pool, execute, signal: context.signal });
      return { pool: restored.pool, databaseName: restored.databaseName, objects: restoreObjects,
        database: { async restore(input) {
          await restored.database.restore(input); await verifyControl(restored.pool); assertHeld();
        } } };
    },
    async cleanup() {
      const tasks = [];
      if (policy) tasks.push(policy.cleanup());
      if (restored) tasks.push(restored.dispose());
      if (mf) tasks.push(mf.dispose().then(async () => { await rm(restoreRoot, { recursive: true }); }));
      else if (restoreRoot) tasks.push(rm(restoreRoot, { recursive: true }));
      const cleaned = await Promise.allSettled(tasks);
      check(cleaned.every(value => value.status === 'fulfilled') && outbound === 0, 'release_backup_cleanup_failed');
      // The enclosing release owns pool/lease and retains both, even on failure.
      await verifySource();
      return { gc: await observeMediaGcState(pool), ownedResourcesRemaining: 0 };
    },
  });
  return Object.freeze({ ...result, archiveSha256: archiveSha256 ?? null });
}
