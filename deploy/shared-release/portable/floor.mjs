// Ordered release state outside PostgreSQL. A fresh runner cannot silently skip
// an unsettled intent. Original legacy authority remains pinned and readable.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { migrationDigest, migrationLedgerDigest } from '../../../packages/db/migration-plan.mjs';
import { requireRelease as check, isSha, isDigest } from '../admission.mjs';
import { validateCoordinateAuthority, verifyCoordinateFence } from './coordinate-fence.mjs';

const STAGES = ['backup-before', 'migration', 'deploy', 'health', 'backup-after', 'handoff'];
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const same = (a, b, code) => check(JSON.stringify(a) === JSON.stringify(b), code);
function ledger(rows) {
  check(Array.isArray(rows) && rows.length > 0 && rows.length <= 1000 && rows.every(row =>
    typeof row?.name === 'string' && /^[0-9]{3}_[A-Za-z0-9_]+\.sql$/.test(row.name) && isDigest(row.sha256)), 'release_floor_ledger_invalid');
  const names = rows.map(row => row.name);
  same([...new Set(names)].sort(), names, 'release_floor_ledger_invalid');
  return Math.max(...names.map(name => Number(name.slice(0, 3))));
}
function request(value) {
  check(Number.isSafeInteger(value?.runId) && value.runId > 0 && Number.isSafeInteger(value.runAttempt) && value.runAttempt > 0
    && isSha(value.sourceSha) && isSha(value.sourceTree) && isSha(value.controllerSha)
    && /^ghcr\.io\/freetwai\/freedom-release-operator@sha256:[a-f0-9]{64}$/.test(value.operatorImage)
    && isDigest(value.configSha256), 'release_floor_request_invalid');
}
function verifyBackup(proof, intent, capture, sourceSha) {
  check(intent && UUID.test(intent.setId) && isDigest(intent.archiveSha256)
    && capture?.revision === 'shared-backup-' + intent.setId
    && proof?.setId === intent.setId && proof.archiveSha256 === intent.archiveSha256 && proof.sourceSha === sourceSha
    && proof.remoteReadback === 'verified' && proof.restore === 'database_and_objects_restored'
    && proof.cleanupVerified === true && proof.exposure === 'quarantine', 'release_floor_backup_unverified');
}

/** Pure replay. The store authenticates all record bytes against its seed and
 * chain; isAncestor is the image's fixed Git graph check, never a config program.
 * Success proofs are produced by the installed operator, not caller booleans. */
export function replayReleaseFloor(chain, { isAncestor }) {
  check(Array.isArray(chain) && chain.length > 0 && typeof isAncestor === 'function', 'release_floor_history_invalid');
  const seed = chain[0].record.data;
  check(['freedom.shared-floor-seed/v1', 'freedom.shared-floor-seed/v2'].includes(seed?.format)
    && seed.authority && isDigest(seed.authority.legacyFloorSha256),
    'release_floor_seed_invalid');
  const state = structuredClone(seed.state);
  check(state && isSha(state.sourceSha) && isSha(state.sourceTree) && state.deployedSourceSha === state.sourceSha
    && isDigest(state.bindingsSha256) && isDigest(state.materialPolicySha256) && state.pending === null,
  'release_floor_seed_state_invalid');
  check(ledger(state.schemaLedger) === state.schemaVersion, 'release_floor_schema_invalid');
  for (const item of chain.slice(1)) {
    const event = item.record.data;
    check(event?.format === 'freedom.shared-floor-event/v1', 'release_floor_event_invalid');
    if (event.kind === 'begin' || event.kind === 'backup-begin' || event.kind === 'code-begin') {
      check(state.pending === null, 'release_floor_unsettled'); request(event.request);
      const backup = event.kind === 'backup-begin';
      if (backup) check(event.request.sourceSha === state.sourceSha && state.deployedSourceSha === state.sourceSha
        && event.request.sourceTree === state.sourceTree, 'release_floor_backup_source_changed');
      const candidate = backup ? { sourceSha: state.sourceSha, sourceTree: state.sourceTree, schemaLedger: state.schemaLedger } : event.candidate;
      check(candidate?.sourceSha === event.request.sourceSha && candidate.sourceTree === event.request.sourceTree
        && ledger(candidate.schemaLedger) >= state.schemaVersion, 'release_floor_candidate_invalid');
      same(candidate.schemaLedger.slice(0, state.schemaLedger.length), state.schemaLedger, 'release_floor_ledger_rewind');
      check(isAncestor(state.sourceSha, candidate.sourceSha), 'release_floor_source_rewind');
      const codeOnly = event.kind === 'code-begin';
      if (codeOnly) {
        check(event.request.releaseKind === 'code-only', 'release_floor_code_request_invalid');
        same(candidate.schemaLedger, state.schemaLedger, 'release_floor_code_schema_changed');
      }
      state.pending = { kind: backup ? 'backup' : codeOnly ? 'code' : 'release', request: structuredClone(event.request), candidate: structuredClone(candidate),
        previousSourceSha: state.deployedSourceSha, stage: 0, intents: {} };
      continue;
    }
    const pending = state.pending;
    const stages = pending?.kind === 'backup' ? ['backup'] : pending?.kind === 'code' ? ['migration', 'deploy', 'health', 'handoff'] : STAGES;
    check(pending && event.runId === pending.request.runId && event.runAttempt === pending.request.runAttempt
      && event.stage === stages[pending.stage], 'release_floor_stage_mismatch');
    if (event.kind === 'backup-abandoned') {
      const proof = event.proof, capture = pending.intents['backup:capture-policy'], recovery = proof?.recovery;
      const beginOnly = !capture && Object.keys(pending.intents).length === 0
        && recovery?.failureBoundary === 'before_capture' && proof?.failureBoundary === 'before_capture';
      check(pending.kind === 'backup' && pending.stage === 0 && (beginOnly || (capture && Object.keys(pending.intents).length === 1))
        && proof?.format === 'freedom.abandoned-backup/v1' && recovery?.format === 'freedom.verified-failed-backup/v1'
        && ['runId', 'runAttempt', 'sourceSha', 'sourceTree', 'controllerSha', 'operatorImage', 'configSha256']
          .every(key => recovery[key] === pending.request[key])
        && isDigest(recovery.receiptSha256) && /^sha256:[a-f0-9]{64}$/.test(recovery.artifactDigest ?? '')
        && Number.isSafeInteger(recovery.artifactId) && recovery.artifactId > 0
        && Number.isFinite(Date.parse(recovery.completedAt)) && Number.isFinite(Date.parse(proof.observedAt))
        && Date.parse(proof.observedAt) >= Date.parse(recovery.completedAt)
        && proof.sourceSha === state.sourceSha && proof.sourceTree === state.sourceTree
        && proof.bindingsSha256 === state.bindingsSha256 && proof.ledgerSha256 === migrationLedgerDigest(state.schemaLedger)
        && proof.materialPolicySha256 === state.materialPolicySha256
        && proof.maintenanceEnabled === false && proof.domainMaintenanceEnabled === false && proof.deletionFences === 0
        && proof.captureBackendAbsent === true && (beginOnly || proof.captureRevision === capture.revision)
        && proof.sourcePins === 'retained' && proof.archiveIntent === 'absent', 'release_floor_backup_recovery_invalid');
      request({ ...proof.settledBy, sourceSha: state.sourceSha, sourceTree: state.sourceTree });
      check(proof.settledBy.runId !== pending.request.runId && proof.settledBy.configSha256 === pending.request.configSha256,
        'release_floor_backup_recovery_invalid');
      state.pending = null; continue;
    }
    if (event.kind === 'intent') {
      const allowed = { 'backup-before': ['capture-policy', 'archive'], migration: ['commit'], deploy: ['publish'],
        health: [], 'backup-after': ['capture-policy', 'archive'], handoff: [], backup: ['capture-policy', 'archive'] }[event.stage];
      const key = event.stage + ':' + event.operation;
      check(!(pending.kind === 'code' && event.stage === 'migration') && allowed.includes(event.operation) && !Object.hasOwn(pending.intents, key)
        && event.proof && typeof event.proof === 'object' && !Array.isArray(event.proof), 'release_floor_intent_invalid');
      const value = event.proof;
      check(value.automaticRetry === false, 'release_floor_intent_retry_forbidden');
      if (event.operation === 'capture-policy') {
        check(value.format === 'freedom.shared-capture-policy-intent/v1' && Number.isSafeInteger(value.pid) && value.pid > 0
          && /^fp-capture-[a-f0-9-]{36}$/.test(value.application) && /^shared-backup-[a-f0-9-]{36}$/.test(value.revision)
          && isDigest(value.before), 'release_floor_capture_intent_invalid');
      } else if (event.operation === 'archive') {
        check(UUID.test(value.setId) && isDigest(value.archiveSha256) && Number.isSafeInteger(value.bytes) && value.bytes > 0,
          'release_floor_archive_intent_invalid');
      } else if (event.operation === 'commit') {
        check(value.source === pending.candidate.sourceSha && value.tree === pending.candidate.sourceTree
          && /^[1-9][0-9]*$/.test(value.transactionId) && value.beforeDigest === migrationLedgerDigest(state.schemaLedger)
          && value.afterDigest === migrationLedgerDigest(pending.candidate.schemaLedger), 'release_floor_commit_intent_invalid');
      } else if (event.operation === 'publish') {
        check(value.sourceSha === pending.candidate.sourceSha && value.previousSourceSha === pending.previousSourceSha
          && UUID.test(value.previousVersion) && isDigest(value.configSha256), 'release_floor_publish_intent_invalid');
      }
      pending.intents[key] = structuredClone(value); continue;
    }
    if (event.kind === 'committed') {
      const commit = pending.intents['migration:commit'], proof = event.proof;
      check(pending.kind !== 'code' && event.stage === 'migration' && !pending.committed && commit && /^[1-9][0-9]*$/.test(commit.transactionId)
        && proof?.transactionId === commit.transactionId && proof.source === pending.candidate.sourceSha
        && proof.tree === pending.candidate.sourceTree && proof.afterDigest === migrationLedgerDigest(pending.candidate.schemaLedger),
      'release_floor_commit_unverified');
      same(proof.ledger, pending.candidate.schemaLedger, 'release_floor_commit_ledger_changed');
      // Raise the rollback floor as soon as COMMIT is confirmed, before later
      // probes can fail. This event does not mark the migration phase passed.
      state.schemaLedger = structuredClone(pending.candidate.schemaLedger); state.schemaVersion = ledger(state.schemaLedger);
      state.sourceSha = pending.candidate.sourceSha; state.sourceTree = pending.candidate.sourceTree;
      pending.committed = structuredClone(proof); continue;
    }
    check(event.kind === 'passed', 'release_floor_event_invalid');
    const proof = event.proof;
    if (['backup-before', 'backup-after', 'backup'].includes(event.stage)) {
      check(pending.intents[event.stage + ':capture-policy'], 'release_floor_capture_intent_missing');
      verifyBackup(proof, pending.intents[event.stage + ':archive'], pending.intents[event.stage + ':capture-policy'],
        event.stage === 'backup-before' ? pending.previousSourceSha : pending.candidate.sourceSha);
    } else if (event.stage === 'migration' && pending.kind === 'code') {
      check(pending.kind === 'code' && proof?.outcome === 'unchanged' && proof.readOnly === true
        && proof.ledgerVerified === true && proof.runtimeGrantsVerified === true
        && proof.ledgerSha256 === migrationLedgerDigest(state.schemaLedger), 'release_floor_schema_unverified');
    } else if (event.stage === 'migration') {
      const commit = pending.intents['migration:commit'];
      check(pending.committed && commit && /^[1-9][0-9]*$/.test(commit.transactionId) && proof?.transactionId === commit.transactionId
        && proof.commitStatus === 'confirmed' && proof.ledgerVerified === true && proof.runtimeGrantsVerified === true
        && proof.ledgerSha256 === migrationLedgerDigest(pending.candidate.schemaLedger), 'release_floor_commit_unverified');
    } else if (event.stage === 'deploy') {
      check(pending.intents['deploy:publish'] && proof?.sourceSha === pending.candidate.sourceSha
        && proof.providerConfirmed === true && UUID.test(proof.versionId), 'release_floor_deploy_unverified');
      state.deployedSourceSha = proof.sourceSha;
    } else if (event.stage === 'health') {
      check(proof?.sourceSha === pending.candidate.sourceSha && proof.statusCode === 200
        && proof.schemaVerified === true && proof.smokePassed === true, 'release_floor_health_unverified');
    } else if (event.stage === 'handoff') {
      if (pending.kind === 'code') {
        check(proof?.cleanupVerified === true && proof.schemaUnchanged === true, 'release_floor_code_handoff_invalid');
        state.sourceSha = pending.candidate.sourceSha; state.sourceTree = pending.candidate.sourceTree;
      } else {
        const schedule = proof?.schedule;
        check(proof?.cleanupVerified === true && schedule?.format === 'freedom.verified-scheduled-backup/v1'
          && Number.isSafeInteger(schedule.runId) && schedule.runId > 0
          && schedule.operatorImage === pending.request.operatorImage && schedule.configSha256 === pending.request.configSha256
          && isDigest(schedule.receiptSha256) && Number.isFinite(Date.parse(schedule.completedAt)),
        'release_floor_schedule_unverified');
      }
    }
    pending.stage++;
    if (pending.stage === stages.length) state.pending = null;
  }
  return { seed, state, head: chain.at(-1) };
}

function gitAncestor(sourceRoot, before, after) {
  check(isSha(before) && isSha(after), 'release_floor_source_invalid');
  try {
    execFileSync('/usr/bin/git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null',
      '-c', 'protocol.allow=never', 'merge-base', '--is-ancestor', before, after], { cwd: sourceRoot, timeout: 15000,
      maxBuffer: 1024, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' } });
    return true;
  } catch { return false; }
}

// A legacy schema floor can predate code-only releases. A separately provisioned
// v2 seed may adopt that already deployed descendant, but never new schema bytes.
// Read the immutable Git object, not the current checkout or live DB as authority.
function verifyAdoptedSource(sourceRoot, legacy, baseline) {
  const previous = legacy.migration.release;
  check(isSha(previous) && isSha(legacy.migration.tree) && gitAncestor(sourceRoot, previous, baseline.sourceSha),
    'release_floor_adoption_source_invalid');
  const git = (args, maxBuffer = 1_000_000) => execFileSync('/usr/bin/git', ['--no-optional-locks',
    '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.allow=never', ...args],
  { cwd: sourceRoot, timeout: 15000, maxBuffer, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' } });
  try {
    check(git(['rev-parse', previous + '^{tree}']).toString().trim() === legacy.migration.tree
      && git(['rev-parse', baseline.sourceSha + '^{tree}']).toString().trim() === baseline.sourceTree,
    'release_floor_adoption_tree_invalid');
    const entries = git(['ls-tree', '-r', '-z', baseline.sourceSha, '--', 'migrations/']).toString().split('\0').filter(Boolean);
    const rows = []; let total = 0;
    for (const entry of entries) {
      const path = entry.slice(entry.indexOf('\t') + 1);
      if (!path.endsWith('.sql')) continue;
      const match = /^(100644|100755) blob ([a-f0-9]{40})\tmigrations\/([0-9]{3}_[A-Za-z0-9_]+\.sql)$/.exec(entry);
      check(match && rows.length < 1000, 'release_floor_adoption_catalog_invalid');
      const bytes = git(['cat-file', 'blob', match[2]], 4 * 1024 * 1024);
      total += bytes.length; check(total <= 64 * 1024 * 1024, 'release_floor_adoption_catalog_invalid');
      const sql = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      rows.push({ name: match[3], sha256: migrationDigest(sql) });
    }
    rows.sort((a, b) => a.name < b.name ? -1 : 1);
    same(rows, baseline.schemaLedger, 'release_floor_adoption_catalog_changed');
  } catch (error) {
    if (error?.code?.startsWith('release_floor_')) throw error;
    check(false, 'release_floor_adoption_source_unavailable');
  }
}

/** sourceRoot is the immutable, full-history application checkout. The seed and
 * legacy bytes are provisioned independently after review; this function cannot
 * bless the current database as a new rollback floor. */
export async function openReleaseFloor({ store, sourceRoot, intentDirectory }) {
  let chain = await store.load();
  const replay = values => replayReleaseFloor(values, { isAncestor: (a, b) => gitAncestor(sourceRoot, a, b) });
  let current = replay(chain);
  const refs = current.seed.authority, legacy = await store.readAuthority(refs.legacyFloorSha256);
  const baseline = current.seed.state, schema = ledger(baseline.schemaLedger);
  check(legacy.format === `freedom.schema${schema}-committed-floor/v1`
    && legacy.floor?.environment === (store.target === 'next' ? 'production' : 'staging')
    && legacy.floor.minimumSchema === schema
    && legacy.migration?.commitStatus === 'confirmed' && legacy.migration.release === legacy.floor.candidateRelease
    && legacy.restoreQuarantineRequired === true,
  'release_floor_legacy_authority_invalid');
  if (current.seed.format === 'freedom.shared-floor-seed/v1') {
    check(legacy.floor.candidateRelease === baseline.sourceSha && legacy.migration.tree === baseline.sourceTree,
      'release_floor_legacy_authority_invalid');
  } else verifyAdoptedSource(sourceRoot, legacy, baseline);
  same(legacy.schemaLedger, baseline.schemaLedger, 'release_floor_legacy_ledger_changed');
  const policy = legacy.retained172?.materialPolicy;
  check(policy?.format === 'freedom.backup-material-policy-observation/v1' && Array.isArray(policy.policies)
    && policy.policies.length > 0 && policy.policies.length <= 100
    && createHash('sha256').update(JSON.stringify(policy.policies)).digest('hex') === baseline.materialPolicySha256,
  'release_floor_legacy_policy_changed');
  const extra = store.target === 'next' ? {
    inventory: await store.readAuthority(refs.coordinateInventorySha256), inventorySha256: refs.coordinateInventorySha256,
    variants: await store.readAuthority(refs.coordinateVariantsSha256), variantsSha256: refs.coordinateVariantsSha256,
  } : {};
  const coordinates = validateCoordinateAuthority({ target: store.target, legacy, ...extra });
  const append = async event => {
    const data = { format: 'freedom.shared-floor-event/v1', ...structuredClone(event) };
    // Validate the transition before any remote mutation.
    replay([...chain, { record: { data } }]);
    const next = await store.append({ previous: current.head, data, intentDirectory });
    chain = [...chain, next]; current = replay(chain); return structuredClone(current.state);
  };
  return Object.freeze({
    state() { return structuredClone(current.state); },
    async assertCurrent() {
      const actual = await store.load();
      check(actual.at(-1).sha256 === current.head.sha256, 'release_floor_external_state_changed');
    },
    async verifyDatabase(q, { restored = false } = {}) {
      same((await q.query('SELECT name,sha256 FROM schema_migrations ORDER BY name LIMIT 1001')).rows,
        current.state.schemaLedger, 'release_floor_database_ledger_changed');
      return verifyCoordinateFence(q, coordinates, { restored });
    },
    verifyConstraints(q, options) { return verifyCoordinateFence(q, coordinates, options); },
    async beginCode(request, candidate) { return append({ kind: 'code-begin', request, candidate }); },
    async begin(request, candidate) { return append({ kind: 'begin', request, candidate }); },
    async beginBackup(request) { return append({ kind: 'backup-begin', request }); },
    async abandonBackup(proof) {
      check(current.state.pending?.kind === 'backup', 'release_floor_not_started');
      const { runId, runAttempt } = current.state.pending.request;
      return append({ kind: 'backup-abandoned', runId, runAttempt, stage: 'backup', proof });
    },
    async intent(stage, operation, proof) {
      check(current.state.pending, 'release_floor_not_started');
      const { runId, runAttempt } = current.state.pending.request;
      return append({ kind: 'intent', runId, runAttempt, stage, operation, proof });
    },
    async passed(stage, proof) {
      check(current.state.pending, 'release_floor_not_started');
      const { runId, runAttempt } = current.state.pending.request;
      return append({ kind: 'passed', runId, runAttempt, stage, proof });
    },
    async committed(proof) {
      check(current.state.pending, 'release_floor_not_started');
      const { runId, runAttempt } = current.state.pending.request;
      return append({ kind: 'committed', runId, runAttempt, stage: 'migration', proof });
    },
  });
}
