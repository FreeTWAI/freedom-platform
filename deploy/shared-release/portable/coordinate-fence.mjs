// Read-only port of the retained production migration166 coordinate fence.
// The immutable seed pins original legacy-floor/inventory/variant JSON objects.
// Nothing here accepts SQL to execute or installs/rewrites a constraint.
import { createHash } from 'node:crypto';
import { requireRelease as check, isDigest } from '../admission.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const keys = ['schema', 'table', 'name', 'type', 'validated', 'enforced', 'no_inherit', 'deferrable', 'deferred', 'definition'];
const variantTables = ['canonical_repositories', 'catalog_repo_observations', 'development_grants', 'maintainer_repositories', 'oss_projects'];
const tables = [...variantTables, 'github_items', 'github_repository_events', 'github_repository_metrics', 'github_sync_repositories', 'skill_star_support'].sort();
const same = (a, b, code) => check(JSON.stringify(a) === JSON.stringify(b), code);
const inventorySql = `SELECT n.nspname AS schema,t.relname AS table,c.conname AS name,
  c.contype AS type,c.convalidated AS validated,c.conenforced AS enforced,
  c.connoinherit AS no_inherit,c.condeferrable AS deferrable,c.condeferred AS deferred,
  pg_get_constraintdef(c.oid,false) AS definition
  FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
  WHERE n.nspname='public' AND left(c.conname,length($1))=$1
  ORDER BY t.relname COLLATE "C",c.conname COLLATE "C"`;

export function validateCoordinateAuthority({ target, legacy, inventory, variants, inventorySha256, variantsSha256 }) {
  check(['next', 'staging-next'].includes(target) && legacy?.restoreQuarantineRequired === true,
    'release_coordinate_authority_invalid');
  const retained = legacy.retained172, floor = retained?.floor, extension = floor?.operatorExtensions?.coordinateFence;
  check(floor?.floor?.environment === (target === 'next' ? 'production' : 'staging') && floor.floor.minimumSchema === 172,
    'release_coordinate_retained_floor_invalid');
  if (target === 'staging-next') {
    check(extension === undefined && inventory === undefined && variants === undefined,
      'release_coordinate_staging_scope_invalid'); return { target, constraints: [], variants: [] };
  }
  check(extension?.format === 'freedom.operator-coordinate-fence/v1' && extension.commit_status === 'confirmed'
    && extension.retain_after_admission_off === true && extension.restore_verification_required === true
    && extension.deployment_authorized === false && /^[1-9][0-9]*$/.test(extension.transaction_id),
  'release_coordinate_extension_invalid');
  check(isDigest(inventorySha256) && isDigest(variantsSha256) && extension.inventory_sha256 === inventorySha256
    && inventory?.format === 'freedom.operator-coordinate-fence-inventory/v1' && inventory.postgres_major === 18
    && inventory.sql_sha256 === extension.sql_sha256 && isDigest(extension.sql_sha256), 'release_coordinate_inventory_binding_invalid');
  const migration = extension.migration;
  check(migration?.name === '166_freetwai_repository_transfer.sql'
    && migration.raw_sha256 === '6d387e7fe02494056158aaa4365a960b06b3006f17b7147060d1b63d4204caca'
    && migration.ledger_sha256 === '1e72cf94952d42fe19f20bcf278d89be873b4a598dfb92adb41c109463abc188',
  'release_coordinate_migration_changed');
  const ledger = retained.binding?.schemaLedger?.filter(row => row.name === migration.name);
  same(ledger, [{ name: migration.name, sha256: migration.ledger_sha256 }], 'release_coordinate_ledger_changed');
  check(Array.isArray(inventory.constraints) && inventory.constraints.length === 10, 'release_coordinate_inventory_invalid');
  same(extension.constraints, inventory.constraints, 'release_coordinate_saved_inventory_changed');
  same(inventory.constraints.map(row => row.table), tables, 'release_coordinate_tables_changed');
  for (const row of inventory.constraints) {
    same(Object.keys(row).sort(), [...keys].sort(), 'release_coordinate_inventory_fields');
    check(row.schema === 'public' && row.name.startsWith('fp166_live_coordinate_fence') && row.type === 'c'
      && row.validated === true && row.enforced === true && row.no_inherit === false && row.deferrable === false
      && row.deferred === false && typeof row.definition === 'string' && row.definition.length <= 65536,
    'release_coordinate_inventory_invalid');
  }
  check(variants?.format === 'freedom.restore-exact-check-variants/v1'
    && variants.originalInventorySha256 === inventorySha256 && variants.originalFenceSqlSha256 === extension.sql_sha256
    && isDigest(variants.diagnosticSha256) && Array.isArray(variants.variants) && variants.variants.length === 5,
  'release_coordinate_variants_invalid');
  same(variants.variants.map(row => row.table), variantTables, 'release_coordinate_variants_invalid');
  for (const row of variants.variants) {
    const match = inventory.constraints.find(item => item.schema === row.schema && item.table === row.table && item.name === row.name);
    check(match && row.originalDefinitionSha256 === hash(match.definition)
      && typeof row.restoredDefinition === 'string' && row.restoredDefinition.length > 0 && row.restoredDefinition.length <= 65536
      && row.restoredDefinition !== match.definition, 'release_coordinate_variant_binding_invalid');
  }
  return { target, constraints: structuredClone(inventory.constraints), variants: structuredClone(variants.variants),
    inventorySha256, variantsSha256, sqlSha256: extension.sql_sha256 };
}

export async function verifyCoordinateFence(q, authority, { restored = false } = {}) {
  check(authority && ['next', 'staging-next'].includes(authority.target), 'release_coordinate_authority_required');
  const version = (await q.query("SELECT current_setting('server_version_num')::int/10000 major")).rows[0];
  check(version?.major === 18, 'release_coordinate_postgres_version');
  const rows = (await q.query(inventorySql, ['fp166_live_coordinate_fence'])).rows;
  check(rows.length === authority.constraints.length, 'release_coordinate_inventory_count');
  const accepted = [];
  for (let i = 0; i < rows.length; i++) {
    const actual = rows[i], expected = authority.constraints[i];
    for (const key of keys) if (key !== 'definition') same(actual[key], expected[key], 'release_coordinate_constraint_changed');
    if (actual.definition === expected.definition) { accepted.push('original'); continue; }
    const variant = authority.variants.find(row => row.schema === actual.schema && row.table === actual.table && row.name === actual.name);
    check(restored && variant && actual.definition === variant.restoredDefinition, 'release_coordinate_definition_changed');
    accepted.push('reviewed_pg18_roundtrip');
  }
  return { status: authority.target === 'next' ? 'verified' : 'not_applicable', target: authority.target,
    constraints: rows.length, restored, accepted };
}
