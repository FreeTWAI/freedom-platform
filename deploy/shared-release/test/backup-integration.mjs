// Actual public backup coordinator and native R2/PG18. Cloudflare's HTTP boundary
// is synthetic and disk-backed; this does not claim a real offsite publication.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import sharp from 'sharp';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { migrate } from '../../../scripts/database.ts';
import { withMemberScope } from '../../../packages/resource-scopes/index.ts';
import { objectKey, writeVerifiedObject } from '../../../packages/asset-storage/index.ts';
import { createR2ObjectStore } from '../../../packages/asset-storage/r2.ts';
import { observeMediaGcState } from '../../../packages/media-migration/backup-gc-precondition.ts';
import { runPortableBackup, observeBackupControl } from '../portable/backup.mjs';
import { acquireReleaseLease } from '../portable/lease.mjs';
import { createCloudflareRecoveryTransport } from '../portable/cloudflare.mjs';
import { reconcileFailedBackup } from '../portable/backup-recovery.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export async function verifyBackup({ root, openCluster, execute }) {
  const source = await openCluster('backup-source');
  await source.pool.query('CREATE ROLE fp_fixture_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT');
  await source.pool.query('CREATE ROLE fp_fixture_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS NOINHERIT');
  await source.pool.query('CREATE SCHEMA public AUTHORIZATION fp_fixture_migrator');
  await source.pool.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  await source.pool.query('CREATE ROLE fp_fixture_runtime NOLOGIN');
  const pool = new Pool({ host: source.socket, port: 5432, user: 'fp_fixture_migrator',
    database: source.databaseName, max: 6, connectionTimeoutMillis: 5000, query_timeout: 45_000 });
  const backupPool = new Pool({ ...pool.options, user: 'fp_fixture_backup' });
  const backupConnection = { ...source.connection, PGUSER: 'fp_fixture_backup' };
  const sourceObjects = new Miniflare(convertV4MiniflareOptions({ modules: true,
    script: 'export default {fetch(){return new Response(null,{status:503})}}', compatibilityDate: '2026-09-21',
    r2Buckets: ['SOURCE'], outboundService: () => { throw new Error('fixture network forbidden'); } }));
  let lease;
  try {
    await migrate(pool);
    await pool.query('GRANT USAGE ON SCHEMA public TO fp_fixture_backup');
    await pool.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO fp_fixture_backup');
    await pool.query('GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO fp_fixture_backup');
    const assertBackupReadOnly = async () => {
      const rows = (await backupPool.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r'
        AND has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')`)).rows;
      assert.deepEqual(rows, []);
      await assert.rejects(backupPool.query('UPDATE asset_maintenance_policy SET enabled=true WHERE false'), { code: '42501' });
      await assert.rejects(backupPool.query('DELETE FROM asset_backup_pins WHERE false'), { code: '42501' });
    };
    await assertBackupReadOnly();
    await sourceObjects.ready;
    const bucket = await sourceObjects.getR2Bucket('SOURCE'), store = createR2ObjectStore(bucket);
    async function asset(retired = false) {
      const community = randomUUID(), userId = randomUUID(), session = randomUUID(), assetId = randomUUID(), representationId = randomUUID();
      await pool.query("INSERT INTO communities VALUES($1,'Synthetic shared backup')", [community]);
      const user = (await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref)
        VALUES($1,$2,$3,'Synthetic backup','not-a-login-hash',$4) RETURNING *`, [userId, community, userId + '@example.invalid', randomUUID()])).rows[0];
      await pool.query("INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,'synthetic',clock_timestamp()+interval '1 hour')", [session, userId]);
      const actor = { ...user, session_hash: session, csrf_token: 'synthetic' };
      const context = await withMemberScope(pool, { actor, scope: 'personal' }, async () => {}, async (_q, c) => c);
      const scopeId = context.scope.scope_id;
      await pool.query(`INSERT INTO assets(asset_id,scope_id,owner_principal_id,owner_user_id,policy_revision,representation_id,created_at)
        VALUES($1,$2,$3,$4,'synthetic-content',$5,clock_timestamp()-interval '1 hour')`,
      [assetId, scopeId, context.subject_principal.principal_id, userId, representationId]);
      const bytes = new Uint8Array(await sharp({ create: { width: 256, height: 256, channels: 3, background: retired ? 'green' : 'red' } }).webp().toBuffer());
      const metadata = { contentType: 'image/webp', byteSize: bytes.length, sha256: hash(bytes), transformVersion: 'avatar.webp.v1', policyRevision: 'synthetic-content' };
      const key = objectKey({ scopeId, assetId, representationId });
      await writeVerifiedObject(store, key, { bytes, metadata }, { revision: metadata.policyRevision, platformPersistenceAllowed: true });
      await pool.query(`INSERT INTO asset_objects(asset_id,scope_id,representation_id,content_type,byte_size,content_sha256,transform_version,policy_revision)
        VALUES($1,$2,$3,'image/webp',$4,$5,'avatar.webp.v1','synthetic-content')`, [assetId, scopeId, representationId, bytes.length, metadata.sha256]);
      await pool.query("UPDATE assets SET state='ready',ready_at=clock_timestamp()-interval '1 hour' WHERE asset_id=$1", [assetId]);
      if (retired) await pool.query("UPDATE assets SET state='retired',retired_at=clock_timestamp()-interval '1 hour' WHERE asset_id=$1", [assetId]);
      return { assetId, key };
    }
    await asset(); await asset(true);
    lease = await acquireReleaseLease(pool, { database: source.databaseName, role: 'fp_fixture_migrator', heartbeatMs: 50 });
    const remote = join(root, 'synthetic-cloudflare'); await mkdir(remote, { mode: 0o700 });
    let uploads = 0, restores = 0, late, mode = 'normal';
    const fetchImpl = async (address, options) => {
      const url = new URL(address); assert.equal(url.origin, 'https://api.cloudflare.com');
      assert.equal(options.redirect, 'error');
      const json = result => new Response(JSON.stringify({ success: true, result }));
      if (url.pathname.endsWith('/settings')) return json({ bindings: [
        { name: 'FREEDOM_RELEASE_SHA', type: 'plain_text', text: 'a'.repeat(40) },
        { name: 'FREEDOM_ASSET_MAINTENANCE_ENABLED', type: 'plain_text', text: 'false' },
      ] });
      if (url.pathname.includes('/fixture-media/objects')) {
        const key = url.searchParams.get('prefix') ?? decodeURIComponent(url.pathname.split('/objects/')[1]);
        const object = await bucket.get(key); if (!object) return new Response(null, { status: 404 });
        if (url.searchParams.has('prefix')) return json([{ key, size: object.size, etag: object.etag,
          custom_metadata: object.customMetadata, http_metadata: object.httpMetadata }]);
        return new Response(await object.arrayBuffer());
      }
      assert(url.pathname.includes('/fixture-backups/objects/daily-v2/staging/'));
      const filename = url.pathname.split('/').at(-1); assert.match(filename, /^[a-f0-9-]{36}\.tar$/);
      const path = join(remote, filename);
      if (options.method === 'PUT') {
        uploads++; await writeFile(path, options.body, { flag: 'wx', mode: 0o600 });
        if (mode === 'lost-put') throw new Error('synthetic lost provider response');
        return new Response(null, { status: 200 });
      }
      try {
        const bytes = await readFile(path); if (mode === 'corrupt') bytes[64] ^= 1;
        return new Response(bytes);
      } catch (error) { if (error.code === 'ENOENT') return new Response(null, { status: 404 }); throw error; }
    };
    const transport = createCloudflareRecoveryTransport({ accountId: 'a'.repeat(32), target: 'staging-next',
      mediaBucket: 'fixture-media', backupBucket: 'fixture-backups', token: 'synthetic-service-token', signal: lease.signal, fetchImpl });
    const expected = { sourceSha: 'a'.repeat(40), bindingsSha256: (await transport.readWorkerState()).bindingsSha256,
      ...await observeBackupControl(pool) };
    const run = async (override = {}) => runPortableBackup({
      context: { environment: 'staging', database: source.databaseName, schema: 'public', sourceRelease: expected.sourceSha,
        operatorSource: 'b'.repeat(40), setId: randomUUID(), createdAt: new Date().toISOString(), runDirectory: root, signal: lease.signal },
      workRoot: root, pool: backupPool, role: 'fp_fixture_backup',
      maintenancePool: pool, maintenanceRole: 'fp_fixture_migrator', runtimeRole: 'fp_fixture_runtime', lease, transport, expected,
      connection: backupConnection, binDirectory: '/usr/local/bin',
      // Fixture-only control ports. The installed entry supplies the R2 floor.
      async retainIntent(operation, value) {
        assert(['capture-policy', 'archive'].includes(operation)); assert.equal(value.automaticRetry, false);
      },
      async verifyRetainedFloor(target) { assert.equal((await observeBackupControl(target)).ledgerSha256, expected.ledgerSha256); },
      execute: async (program, args, options) => {
        if (program.endsWith('/pg_dump') && args.includes('--format=custom') && !late) late = await asset();
        if (program.endsWith('/pg_restore')) restores++;
        return execute(program, args, options);
      }, ...override,
    });
    assert.deepEqual((await pool.query('SELECT current_database() database,current_user role,session_user session_role,current_schema() schema')).rows[0],
      { database: source.databaseName, role: 'fp_fixture_migrator', session_role: 'fp_fixture_migrator', schema: 'public' });
    assert.equal((await pool.query(`WITH sequences AS MATERIALIZED (
      SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S')
      SELECT count(*)::int count FROM sequences WHERE has_sequence_privilege($1,oid,'UPDATE')`, ['fp_fixture_runtime'])).rows[0].count, 0);
    const gc = await observeMediaGcState(pool); assert.equal(gc.maintenanceEnabled, false); assert.equal(gc.domainMaintenanceEnabled, false); assert.equal(gc.deletionFences, 0);
    await assert.rejects(run({ maintenancePool: undefined }), { code: 'release_backup_input_invalid' });
    await assert.rejects(run({ maintenancePool: backupPool, maintenanceRole: 'fp_fixture_backup' }), { code: 'release_backup_input_invalid' });
    await assert.rejects(run({ transport: { ...transport, target: 'next' } }), { code: 'release_backup_input_invalid' });
    const good = await run(); assert.equal(good.status, 'passed', JSON.stringify(good));
    assert.equal(good.objects.count, 2); assert(late); assert.equal(good.restore, 'database_and_objects_restored');
    assert.equal(good.remoteReadback, 'verified'); assert.equal(good.cleanupVerified, true);
    assert.equal(good.exposure, 'quarantine_not_approved_for_exposure'); assert.equal(restores, 1); assert.equal(uploads, 1);
    assert.equal((await pool.query('SELECT count(*)::int count FROM assets')).rows[0].count, 3);
    assert.equal((await pool.query("SELECT count(*)::int count FROM asset_backup_pins WHERE asset_id=$1", [late.assetId])).rows[0].count, 0);
    assert.equal((await pool.query('SELECT count(*)::int count FROM asset_backup_pins')).rows[0].count, 2);
    lease.assertHeld();

    const dumpFailed = await run({ execute: async (program, args, options) => {
      if (program.endsWith('/pg_dump') && args.includes('--format=custom')) throw new Error('private synthetic dump failure');
      return execute(program, args, options);
    } });
    assert.equal(dumpFailed.stage, 'capture'); assert.equal(dumpFailed.snapshotDump, 'failed');
    assert.equal(dumpFailed.cleanupVerified, true); assert.equal(uploads, 1);

    for (const failure of ['corrupt', 'lost-put']) {
      mode = failure; const count = uploads;
      const bad = await run(); assert.equal(bad.status, 'failed'); assert.equal(bad.stage, 'offsite');
      assert.equal(bad.cleanupVerified, true); assert.equal(restores, 1); assert.equal(uploads, count + 1);
      lease.assertHeld();
    }
    mode = 'normal';
    const count = uploads;
    const wrong = await run({ expected: { ...expected, materialPolicySha256: 'f'.repeat(64) } });
    assert.equal(wrong.status, 'failed'); assert.equal(uploads, count); assert.equal(restores, 1);

    // The UPDATE committed but its response was lost. Production cleanup must
    // settle that exact policy backend, then disable only this run's revision.
    let lost = false;
    const uncertainPool = { options: pool.options, query: pool.query.bind(pool), async connect() {
      const client = await pool.connect();
      return { on: client.on.bind(client), removeListener: client.removeListener.bind(client), release: client.release.bind(client),
        async query(input, values) {
          const result = await client.query(input, values);
          if (!lost && (input.text ?? input).startsWith('UPDATE asset_maintenance_policy p SET enabled=true')) {
            lost = true; throw new Error('synthetic committed response loss');
          }
          return result;
        } };
    } };
    let failedCapture;
    const uncertain = await run({ maintenancePool: uncertainPool, retainIntent: async (operation, proof) => {
      assert.equal(operation, 'capture-policy'); failedCapture = proof;
    } });
    assert(lost); assert.equal(uncertain.status, 'failed'); assert.equal(uncertain.stage, 'capture');
    assert.equal(uncertain.cleanupVerified, true); assert.equal(uploads, count); assert.equal(restores, 1);
    assert.equal((await pool.query('SELECT enabled FROM asset_maintenance_policy')).rows[0].enabled, false);
    const schemaLedger = (await pool.query('SELECT name,sha256 FROM schema_migrations ORDER BY name')).rows;
    const pinCount = (await pool.query('SELECT count(*)::int count FROM asset_backup_pins')).rows[0].count;
    const old = { runId: 10, runAttempt: 1, sourceSha: expected.sourceSha, sourceTree: 'c'.repeat(40),
      controllerSha: 'b'.repeat(40), operatorImage: 'ghcr.io/freetwai/freedom-release-operator@sha256:' + 'd'.repeat(64),
      configSha256: 'e'.repeat(64) };
    const state = { ...expected, sourceTree: old.sourceTree, deployedSourceSha: expected.sourceSha, schemaLedger,
      pending: { kind: 'backup', stage: 0, request: old, intents: { 'backup:capture-policy': failedCapture } } };
    let abandoned = 0;
    const floor = { state: () => structuredClone(state), assertCurrent: async () => {},
      verifyDatabase: async q => assert.deepEqual((await q.query('SELECT name,sha256 FROM schema_migrations ORDER BY name')).rows, schemaLedger),
      abandonBackup: async proof => { assert.equal(proof.captureBackendAbsent, true); assert.equal(proof.sourcePins, 'retained'); abandoned++; } };
    // Fixed image port over a synthetic GitHub proof; actual DB observations run
    // against the non-superuser owner and must not mutate policy or release pins.
    const recovery = { floor, pool, deployer: { inspect: () => transport.readWorkerState() }, lease,
      request: { ...old, runId: 11, mode: 'backup', event: 'workflow_dispatch', target: 'staging-next', recoverRunId: 10,
        recoveryEvidence: { ...old, format: 'freedom.verified-failed-backup/v1', target: 'staging-next' } } };
    const recovered = await reconcileFailedBackup(recovery);
    assert.equal(recovered.status, 'abandoned_after_readback'); assert.equal(abandoned, 1);
    assert.equal((await pool.query('SELECT count(*)::int count FROM asset_backup_pins')).rows[0].count, pinCount);
    await pool.query('UPDATE asset_maintenance_policy SET enabled=true WHERE singleton');
    await assert.rejects(reconcileFailedBackup(recovery), /release_backup_recovery_cleanup_unconfirmed/);
    await pool.query('UPDATE asset_maintenance_policy SET enabled=false WHERE singleton');
    const backend = await pool.connect();
    try {
      const row = (await backend.query("SELECT pg_backend_pid() pid,set_config('application_name',$1,false)", [failedCapture.application])).rows[0];
      state.pending.intents['backup:capture-policy'].pid = row.pid;
      await assert.rejects(reconcileFailedBackup(recovery), /release_backup_recovery_cleanup_unconfirmed/);
    } finally { backend.release(true); }
    assert.equal(abandoned, 1);
    const remaining = (await readdir(root)).filter(name => /^(pg-|r2-)/.test(name));
    assert.deepEqual(remaining, []); lease.assertHeld();
    await assertBackupReadOnly();
    return { backupRoleRemainsSelectOnly: true, maintenanceUsesNonSuperuserOwner: true, databaseAndNativeR2Restored: true, sameSnapshotExcludesLateMedia: true,
      remoteTarReadback: 'synthetic-provider', corruptionStopsBeforeRestore: true, lostPutIsNotRetried: true,
      wrongPolicyRefused: true, committedPolicyResponseLossCleaned: true, sourcePinsRetained: true,
      failedBackupReadbackBeforeAbandon: true, activeCaptureAndEnabledPolicyRefuseRecovery: true,
      crossEnvironmentTransportRefused: true,
      ownedRecoveryResourcesRemoved: true, releaseLeaseRetained: true };
  } finally {
    const cleanup = await Promise.allSettled([lease?.release(), sourceObjects.dispose(), pool.end(), backupPool.end()]);
    assert(cleanup.every(value => value.status === 'fulfilled'), 'backup fixture cleanup failed');
  }
}
