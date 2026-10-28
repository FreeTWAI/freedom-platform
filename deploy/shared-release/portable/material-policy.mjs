// A new media purpose is not permission to store bytes. Derive additions from
// admitted SQL in the isolated candidate database, then preserve every live row.
import { requireRelease as check } from '../admission.mjs';

export async function readMaterialPolicies(q) {
  return (await q.query(`SELECT purpose,mode,policy_lock,policy_revision,persistence_allowed,
    retained_byte_limit::text AS retained_byte_limit FROM domain_media_storage_policy ORDER BY purpose`)).rows;
}

function rows(value) {
  check(Array.isArray(value) && value.length <= 100 && value.every(row =>
    typeof row?.purpose === 'string' && /^[a-z][a-z0-9.-]{0,99}$/.test(row.purpose))
    && new Set(value.map(row => row.purpose)).size === value.length, 'release_migration_policy_invalid');
}

export function appendDisabledMaterialPolicies(before, additions) {
  rows(before); rows(additions);
  const existing = new Set(before.map(row => row.purpose));
  check(before.length + additions.length <= 100 && additions.every(row => !existing.has(row.purpose)
    && row.mode === 'legacy' && row.policy_lock === 0 && row.policy_revision === null
    && row.persistence_allowed === false && row.retained_byte_limit === null),
  'release_migration_policy_addition_invalid');
  return structuredClone([...before, ...additions]).sort((a, b) => a.purpose < b.purpose ? -1 : 1);
}

export function deriveDisabledMaterialPolicyAdditions(before, after) {
  rows(before); rows(after);
  const existing = new Map(before.map(row => [row.purpose, row]));
  const additions = after.filter(row => !existing.has(row.purpose));
  // Exact comparison also rejects removal or edits to previously declared rows.
  check(JSON.stringify(appendDisabledMaterialPolicies(before, additions)) === JSON.stringify(appendDisabledMaterialPolicies(after, [])),
    'release_migration_policy_changed');
  return structuredClone(additions);
}
