import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createConsistentAssetBackup, ConsistentBackupError } from '../../packages/media-migration/backup-coordinator.js';
import { backupDiagnosticCode } from '../../packages/media-migration/backup-diagnostics.js';
import { runDailyBackup, type DailyBackupAdapter, type DailyBackupContext } from '../../packages/media-migration/backup-daily.js';
import { runDailyBackupCli } from '../../scripts/media-backup-daily.js';
import type { MediaGcObservation } from '../../packages/media-migration/backup-gc-precondition.js';

const context = (): DailyBackupContext => ({ environment: 'local', database: 'fp_daily', schema: 'public',
  sourceRelease: 'a'.repeat(40), operatorSource: 'b'.repeat(40), setId: randomUUID(), createdAt: new Date().toISOString(),
  runDirectory: '/unused-synthetic', signal: new AbortController().signal });
const gc = (after = false): MediaGcObservation => ({ observedAt: after ? '2026-10-05T00:00:02.000Z' : '2026-10-05T00:00:01.000Z',
  database: 'fp_daily', schema: 'public', maintenanceEnabled: false, domainMaintenanceEnabled: false,
  policyRevision: 'synthetic', deletionFences: 0, tombstones: 0, tombstoneDigest: 'a'.repeat(64), openCaptures: 0 });
function fixture() {
  const calls: string[] = [];
  const adapter: DailyBackupAdapter = {
    async preflight() { calls.push('preflight'); return gc(); },
    async openCapture() { calls.push('capture'); throw Error('RAW_PRIVATE_PROVIDER_DETAIL'); },
    async publishAndOpen() { calls.push('offsite'); throw Error('must not run'); },
    async openRestore() { calls.push('restore'); throw Error('must not run'); },
    async cleanup() { calls.push('cleanup'); return { gc: gc(true), ownedResourcesRemaining: 0 }; },
  };
  return { calls, adapter };
}
test('daily capture failure always reconciles owned effects and never becomes completed or leaks provider text', async () => {
  const { calls, adapter } = fixture(); const result = await runDailyBackup(context(), adapter);
  assert.deepEqual(calls, ['preflight', 'capture', 'cleanup']); assert.equal(result.status, 'failed');
  assert.equal(result.stage, 'capture'); assert.equal(result.cleanupVerified, true);
  assert.equal(result.remoteReadback, 'not_verified'); assert.equal(result.sourcePins, 'retained');
  assert.equal(result.retentionExecuted, false); assert.equal(result.cutoverAuthorized, false);
  assert(!JSON.stringify(result).includes('RAW_PRIVATE'));
});
test('wrong target or enabled GC refuses capture and still runs cleanup', async () => {
  for (const changed of [{ database: 'another_database' }, { maintenanceEnabled: true }, { domainMaintenanceEnabled: true }]) {
    const { calls, adapter } = fixture(); adapter.preflight = async () => ({ ...gc(), ...changed });
    const result = await runDailyBackup(context(), adapter);
    assert.equal(result.status, 'failed'); assert.equal(result.stage, 'preflight'); assert.deepEqual(calls, ['cleanup']);
  }
});
test('cleanup failure, remaining owned resources, enabled GC or changed tombstones cannot claim cleanup success', async () => {
  for (const changed of [{ ownedResourcesRemaining: 1 }, { gc: { ...gc(true), maintenanceEnabled: true } },
    { gc: { ...gc(true), tombstones: 1 } }, { gc: { ...gc(true), tombstoneDigest: 'b'.repeat(64) } }]) {
    const { adapter } = fixture(); adapter.cleanup = async () => ({ gc: gc(true), ownedResourcesRemaining: 0, ...changed });
    const result = await runDailyBackup(context(), adapter);
    assert.equal(result.status, 'failed'); assert.equal(result.cleanupVerified, false); assert.equal(result.code, 'daily_backup_cleanup_failed');
  }
});
test('bound cleanup and immutable target survive adapter/caller mutation during an await', async () => {
  const { calls, adapter } = fixture(), input = context();
  adapter.preflight = async () => {
    Object.assign(input, { database: 'wrong_database' });
    adapter.cleanup = async () => { throw Error('replacement cleanup must not run'); };
    return gc();
  };
  const result = await runDailyBackup(input, adapter);
  assert.equal(result.database, 'fp_daily'); assert.equal(result.cleanupVerified, true); assert.deepEqual(calls, ['capture', 'cleanup']);
});
test('an aborted daily run does no capture but still reconciles, and CLI refuses implicit installation inputs', async () => {
  const { calls, adapter } = fixture(), controller = new AbortController(); controller.abort();
  const result = await runDailyBackup({ ...context(), signal: controller.signal }, adapter);
  assert.equal(result.status, 'failed'); assert.equal(result.code, 'daily_backup_aborted'); assert.deepEqual(calls, ['cleanup']);
  assert.equal((await runDailyBackupCli([])).exitCode, 1);
  assert.equal((await runDailyBackupCli(['--adapter', 'relative.mjs'])).exitCode, 1);
});
test('snapshot-pins is explicit and requires complete enabled policy identity before capture',async()=>{
  await assert.rejects(runDailyBackup({...context(),gcSafety:'automatic' as never},fixture().adapter),{code:'invalid_daily_backup_input'});
  const pinned=(after=false)=>({...gc(after),maintenanceEnabled:true,policySha256:'c'.repeat(64)});
  for(const changed of [{policySha256:undefined},{policySha256:'caller-label'},{policyRevision:null},{maintenanceEnabled:false},
    {domainMaintenanceEnabled:undefined},{observedAt:'not-a-clock'}]){
    const {calls,adapter}=fixture();adapter.preflight=async()=>({...pinned(),...changed} as MediaGcObservation);
    adapter.cleanup=async()=>({gc:pinned(true),ownedResourcesRemaining:0});
    const result=await runDailyBackup({...context(),gcSafety:'snapshot-pins'},adapter);
    assert.equal(result.status,'failed');assert.equal(result.stage,'preflight');assert.deepEqual(calls,[]);
    assert.equal(result.sourceProtection.status,'not_verified');assert.equal(result.sourceProtection.checks,0);
  }
});
test('snapshot-pins cleanup preserves exact policy even when the revision label is unchanged',async()=>{
  const pinned=(after=false)=>({...gc(after),maintenanceEnabled:true,policySha256:'c'.repeat(64)});
  for(const changed of [{policySha256:'d'.repeat(64)},{policyRevision:'another-policy'},{domainMaintenanceEnabled:true},
    {observedAt:gc().observedAt}]){
    const {adapter}=fixture();adapter.preflight=async()=>pinned();
    adapter.cleanup=async()=>({gc:{...pinned(true),...changed},ownedResourcesRemaining:0});
    const result=await runDailyBackup({...context(),gcSafety:'snapshot-pins'},adapter);
    assert.equal(result.status,'failed');assert.equal(result.cleanupVerified,false);assert.equal(result.code,'daily_backup_cleanup_failed');
    assert.equal(result.sourceProtection.status,'not_verified');assert.equal(result.retentionExecuted,false);
  }
});

test('preflight and cleanup preserve distinct bounded causes without provider text', async () => {
  const { adapter } = fixture();
  adapter.preflight = async () => { throw Object.assign(Error('private database detail'), { code: '42501' }); };
  adapter.cleanup = async () => { throw Error('release_backup_worker_changed'); };
  const result = await runDailyBackup(context(), adapter);
  assert.equal(result.stage, 'preflight'); assert.equal(result.code, 'daily_backup_cleanup_failed');
  assert.equal(result.phaseCode, 'backup_database_permission_denied');
  assert.equal(result.cleanupCode, 'release_backup_worker_changed');
  assert.equal(result.cleanupVerified, false); assert(!JSON.stringify(result).includes('private'));
  adapter.preflight = async () => { throw Object.assign(Error('private message'), { code: 'release_backup_private_secret' }); };
  adapter.cleanup = async () => { throw Error('private cleanup'); };
  const unknown = await runDailyBackup(context(), adapter);
  assert.equal(unknown.phaseCode, 'daily_backup_phase_failed');
  assert.equal(unknown.cleanupCode, 'daily_backup_cleanup_failed');
  assert(!JSON.stringify(unknown).includes('private'));
});


test('coordinator retains private connection causes while daily receipts publish only fixed diagnostics', async () => {
  for (const original of [Object.assign(new Error('PRIVATE_DATABASE_URL'), { code: 'ECONNRESET' }),
    Object.assign(new Error('PRIVATE_SQL_DETAIL'), { code: '55P03' })]) {
    const pool = { options: { max: 2 }, async connect() { throw original; } };
    const options = { enabled: true, target: { database: 'fp_daily', sourceSchema: 'public', sourceRelease: 'a'.repeat(40) },
      maintenance: {}, source: {}, destination: {}, databaseSnapshot: {} };
    let wrapper: unknown;
    await assert.rejects(createConsistentAssetBackup(pool as never, options as never), error => {
      assert(error instanceof ConsistentBackupError); assert.equal(error.code, 'backup_capture_failed');
      assert.equal(error.cause, original); assert(!JSON.stringify(error).includes('PRIVATE'));
      wrapper = error; return true;
    });
    const { adapter } = fixture(); adapter.openCapture = async () => { throw wrapper; };
    const result = await runDailyBackup(context(), adapter);
    assert.equal(result.status, 'failed'); assert.equal(result.phaseCode, backupDiagnosticCode(original, 'fallback'));
    assert(!JSON.stringify(result).includes('PRIVATE')); assert(!JSON.stringify(result).includes('cause'));
  }
});
