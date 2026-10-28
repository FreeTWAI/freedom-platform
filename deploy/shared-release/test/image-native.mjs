// Run inside the actual operator image as UID 1001, read-only root, no network,
// no Docker socket. Uses synthetic data and the image's own native PG18/workerd.
import assert from 'node:assert/strict';
import { mkdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Pool } from 'pg';
import { openIsolatedPostgres, runPostgresProcess } from '../portable/postgres.mjs';
import { deriveCandidateContract } from '../portable/candidate-contract.mjs';
import { readMigrationSources } from '../../../packages/db/migration-files.mjs';
import { resolveMigrationPlan } from '../../../packages/db/migration-plan.mjs';
import { verifyBackup } from './backup-integration.mjs';
import { verifyMigration } from './migration-integration.mjs';
import { verifySmoke } from './smoke-integration.mjs';

assert.equal(process.getuid(), 1001);
await import('../portable/entry.mjs'); // Validate the actual entry's full static closure.
const root = '/release/work', binDirectory = '/usr/lib/postgresql/18/bin', clusters = [];
const execute = (program, args, options) => runPostgresProcess(join(binDirectory, basename(program)), args, options);
const openCluster = async label => {
  const workRoot = join(root, label); await mkdir(workRoot, { mode: 0o700 });
  const cluster = await openIsolatedPostgres({ workRoot, binDirectory, Pool }); clusters.push(cluster); return cluster;
};
try {
  const smokeRoot = join(root, 'smoke'); await mkdir(smokeRoot, { mode: 0o700 });
  const smoke = await verifySmoke({ root: smokeRoot, sourceRoot: '/opt/freedom' });
  const backup = await verifyBackup({ root, openCluster, execute });
  await clusters.at(-1).dispose();
  const migration = await verifyMigration({ root, openCluster });
  const sourceRoot = join(root, 'migration-source-tree');
  const git = args => execFileSync('/usr/bin/git', args, { cwd: sourceRoot, encoding: 'utf8' }).trim();
  const workRoot = join(root, 'contract'); await mkdir(workRoot, { mode: 0o700 });
  const names = git(['ls-tree', '--name-only', 'HEAD:migrations']).split('\n');
  const profile = { format: 'freedom.migrations/legacy-v1', first: 1, last: Math.max(...names.map(name => Number(name.slice(0, 3)))), known_gaps: [22] };
  const contract = await deriveCandidateContract({ sourceRoot, sourceSha: git(['rev-parse', 'HEAD']),
    sourceTree: git(['rev-parse', 'HEAD^{tree}']), workRoot, binDirectory, materialPolicySha256: 'a'.repeat(64),
    profile, beforeLedger: resolveMigrationPlan(readMigrationSources(join(sourceRoot, 'migrations')), profile).ledger,
    signal: new AbortController().signal });
  assert(contract.rlsTables.includes('shared_release_fixture'));
  assert.equal(contract.tablePrivileges.find(row => row.table === 'shared_release_fixture' && row.roleSuffix === '_app').privileges.u, true);
  assert(contract.tablePrivileges.length > 600);
  assert.deepEqual(contract.materialPolicyAdditions, []);
  for (const cluster of clusters) await assert.rejects(stat(cluster.root), { code: 'ENOENT' });
  console.log(JSON.stringify({ status: 'passed', imageNativePostgres18: true, imageNativeR2: true, uid: 1001,
    network: 'none', readonlyRoot: true, backup, migration, smoke, candidateContractFromIsolatedDatabase: true,
    remoteDeployment: 'not_run' }));
} finally { for (const cluster of clusters) await cluster.dispose(); }
