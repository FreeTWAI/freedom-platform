// Fixed local/CI fixture. No external database URLs, secrets or operator config.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

assert.equal(process.argv.length, 4); assert.equal(process.argv[2], '--source');
const sourceRoot = resolve(process.argv[3]);
const { Pool } = (await import(pathToFileURL(join(sourceRoot, 'node_modules/pg/lib/index.js')))).default;
const { runPostgresProcess, openIsolatedPostgres, writeSnapshotDump } = await import(
  pathToFileURL(join(sourceRoot, 'deploy/shared-release/portable/postgres.mjs')));
const { acquireReleaseLease } = await import(pathToFileURL(join(sourceRoot, 'deploy/shared-release/portable/lease.mjs')));
const image = 'mirror.gcr.io/library/postgres:18-alpine@sha256:6c538e7206ea40ff740ef27883529390a690b6ead6ba96b44c67a9f7c638e8fd';
const owner = randomUUID(), name = 'fp-shared-native-' + owner;
// /tmp is tmpfs on some development hosts. Restore evidence requires disk.
const root = await mkdtemp('/var/tmp/fp-native-');
let container, createAttempted = false; const clusters = [];
const docker = args => execFileSync('/usr/bin/docker', args, { encoding: 'utf8', timeout: 30_000,
  maxBuffer: 1_000_000, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin' } }).trim();
const execute = (program, args, options = {}) => runPostgresProcess('/usr/bin/docker', [
  'exec', ...Object.keys(options.connection ?? {}).flatMap(key => ['--env', key]), container, program, ...args,
], options);
const openCluster = async label => {
  const workRoot = join(root, label); await mkdir(workRoot, { mode: 0o700 });
  const cluster = await openIsolatedPostgres({ workRoot, binDirectory: '/usr/local/bin', Pool, execute });
  clusters.push(cluster); return cluster;
};
const stream = bytes => new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
try {
  const installed = JSON.parse(docker(['image', 'inspect', '--format', '{{json .}}', image]));
  assert(installed.RepoDigests.includes('mirror.gcr.io/library/postgres@' + image.split('@')[1]));
  // initdb needs getpwuid for the fixture UID; never mount the host passwd file.
  const passwd = join(root, 'fixture-passwd');
  await writeFile(passwd, `fixture:x:${process.getuid()}:${process.getgid()}:Fixture:/nonexistent:/bin/false\n`, { mode: 0o600 });
  await writeFile(join(root, 'intent.json'), JSON.stringify({ name, owner, image }), { mode: 0o600, flag: 'wx' });
  createAttempted = true;
  container = docker(['create', '--name', name, '--pull=never', '--network=none', '--read-only',
    '--user', `${process.getuid()}:${process.getgid()}`, '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--memory=512m', '--memory-swap=512m', '--pids-limit=128', '--cpus=1', '--log-driver=none',
    '--ulimit=core=0:0', '--label', 'freedom.shared-release-test=' + owner,
    '--mount', `type=bind,src=${root},dst=${root}`,
    '--mount', `type=bind,src=${passwd},dst=/etc/passwd,readonly`,
    '--entrypoint=/bin/sleep', image, 'infinity']);
  assert.match(container, /^[a-f0-9]{64}$/); docker(['start', container]);
  const actual = JSON.parse(docker(['inspect', '--format', '{{json .}}', container]));
  assert.equal(actual.Image, installed.Id); assert.equal(actual.HostConfig.NetworkMode, 'none');
  assert.equal(actual.HostConfig.ReadonlyRootfs, true); assert.equal(actual.Config.Labels['freedom.shared-release-test'], owner);
  assert.deepEqual(actual.HostConfig.Tmpfs ?? {}, {});
  const disk = docker(['exec', container, 'stat', '-f', '-c', '%T', root]); assert(!['tmpfs', 'ramfs'].includes(disk));

  const source = await openCluster('source');
  await source.pool.query('CREATE SCHEMA public; CREATE TABLE public.snapshot_rows(id integer PRIMARY KEY, value text NOT NULL)');
  await source.pool.query("INSERT INTO public.snapshot_rows VALUES(1,'before snapshot')");
  const leaseTarget = { database: source.databaseName, role: source.connection.PGUSER, heartbeatMs: 50 };
  const lease = await acquireReleaseLease(source.pool, leaseTarget); lease.assertHeld();
  await assert.rejects(acquireReleaseLease(source.pool, leaseTarget), { code: 'release_lease_busy' });
  const legacy = await source.pool.query("SELECT pg_try_advisory_lock(hashtextextended('freedom.daily.recovery.'||current_database(),0)) locked");
  assert.equal(legacy.rows[0].locked, false);
  await lease.release(); assert.throws(lease.assertHeld, { code: 'release_lease_not_held' });
  const lostLease = await acquireReleaseLease(source.pool, leaseTarget);
  await source.pool.query('SELECT pg_terminate_backend($1)', [lostLease.pid]);
  await new Promise((accept, reject) => {
    if (lostLease.signal.aborted) return accept();
    const deadline = setTimeout(() => reject(Error('lease loss was not observed')), 3000);
    lostLease.signal.addEventListener('abort', () => { clearTimeout(deadline); accept(); }, { once: true });
  });
  assert.throws(lostLease.assertHeld, { code: 'release_lease_not_held' });
  await assert.rejects(lostLease.release(), { code: 'release_lease_cleanup_failed' });
  const snapshot = await source.pool.connect(); let dump;
  try {
    await snapshot.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshotId = (await snapshot.query('SELECT pg_export_snapshot() snapshot')).rows[0].snapshot;
    await source.pool.query("INSERT INTO public.snapshot_rows VALUES(2,'after snapshot')");
    dump = await writeSnapshotDump({ binDirectory: '/usr/local/bin', connection: source.connection,
      output: join(root, 'database.dump'), input: { snapshotId, database: source.databaseName, schema: 'public' }, execute });
  } finally { await snapshot.query('ROLLBACK'); snapshot.release(); }
  const bytes = await readFile(join(root, 'database.dump'));
  assert.equal(dump.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(dump.byteSize, bytes.length); assert.equal((await stat(join(root, 'database.dump'))).mode & 0o777, 0o600);

  const restored = await openCluster('restored');
  assert.notEqual(restored.data, source.data); assert.notEqual(restored.socket, source.socket);
  await restored.database.restore({ database: restored.databaseName, schema: 'public', archive: stream(bytes) });
  assert.deepEqual((await restored.pool.query('SELECT * FROM public.snapshot_rows ORDER BY id')).rows,
    [{ id: 1, value: 'before snapshot' }]);
  assert.equal((await source.pool.query('SELECT count(*)::int count FROM public.snapshot_rows')).rows[0].count, 2);
  await assert.rejects(restored.database.restore({ database: source.databaseName, schema: 'public', archive: stream(bytes) }),
    { code: 'release_pg_restore_target_invalid' });
  await restored.dispose(); await assert.rejects(stat(restored.root), { code: 'ENOENT' });

  const broken = await openCluster('broken');
  await assert.rejects(broken.database.restore({ database: broken.databaseName, schema: 'public', archive: stream(bytes.subarray(0, 64)) }));
  assert.equal((await broken.pool.query("SELECT to_regclass('public.snapshot_rows') found")).rows[0].found, null);
  await broken.dispose(); await assert.rejects(stat(broken.root), { code: 'ENOENT' });

  const interrupted = await openCluster('interrupted');
  const badStream = new ReadableStream({ start(controller) { controller.enqueue(bytes.subarray(0, 64)); controller.error(Error('fixture stream failure')); } });
  await assert.rejects(interrupted.database.restore({ database: interrupted.databaseName, schema: 'public', archive: badStream }));
  assert.equal((await interrupted.pool.query("SELECT to_regclass('public.snapshot_rows') found")).rows[0].found, null);
  await interrupted.dispose(); await source.dispose();
  const { verifyBackup } = await import(pathToFileURL(join(sourceRoot, 'deploy/shared-release/test/backup-integration.mjs')));
  const backup = await verifyBackup({ root, openCluster, execute });
  await clusters.at(-1).dispose();
  for (const cluster of clusters) await assert.rejects(stat(cluster.root), { code: 'ENOENT' });
  console.log(JSON.stringify({ format: 'freedom.shared-release-postgres-fixture/v1', status: 'passed',
    evidence: 'real-local-postgres18', image, network: 'none', diskBacked: true,
    snapshotExcludesLaterWrite: true, dumpReadbackVerified: true, isolatedRestoreVerified: true,
    truncatedRestoreRejected: true, failedStreamBeforeRestore: true, ownedClustersRemoved: clusters.length,
    legacyLeaseExclusion: true, lostLeaseStopsWork: true,
    backup,
    cloudflare: 'not_run', offsiteBackup: 'not_run', production: 'not_run' }));
} finally {
  const results = await Promise.allSettled(clusters.map(cluster => cluster.dispose()));
  let stopped = !createAttempted;
  try {
    if (createAttempted) {
      const ids = docker(['ps', '-aq', '--filter', 'name=^/' + name + '$']).split('\n').filter(Boolean);
      assert(ids.length <= 1);
      for (const id of ids) {
        const item = JSON.parse(docker(['inspect', '--format', '{{json .}}', id]));
        assert.equal(item.Config.Labels['freedom.shared-release-test'], owner);
        assert.equal(item.Name, '/' + name); docker(['rm', '--force', '--volumes', id]);
      }
      assert.equal(docker(['ps', '-aq', '--filter', 'name=^/' + name + '$']), '');
      stopped = true;
    }
  } finally { if (stopped) await rm(root, { recursive: true, force: true }); }
  assert(results.every(result => result.status === 'fulfilled'), 'owned PostgreSQL cleanup failed');
}
