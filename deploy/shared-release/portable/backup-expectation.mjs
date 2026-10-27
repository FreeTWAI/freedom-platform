import { migrationLedgerDigest } from '../../../packages/db/migration-plan.mjs';

// Kept separate because it is loaded by the plain-node deploy-preflight suite.
export function backupExpectation(state, sourceSha) {
  return { sourceSha, bindingsSha256: state.bindingsSha256, ledgerSha256: migrationLedgerDigest(state.schemaLedger),
    materialPolicySha256: state.materialPolicySha256, schemaVersion: state.schemaVersion };
}
