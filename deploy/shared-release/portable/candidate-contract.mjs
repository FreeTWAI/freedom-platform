// Derive the expected schema in a fresh owned local PG18, from admitted main
// source. Never use the live database's current privileges as their own approval.
import { Pool } from 'pg';
import { join } from 'node:path';
import { runMigrationPlan } from '../../../packages/db/migration-runner.mjs';
import { readMigrationSources } from '../../../packages/db/migration-files.mjs';
import { resolveMigrationPlan } from '../../../packages/db/migration-plan.mjs';
import { requireRelease as check } from '../admission.mjs';
import { verifyApplicationSource } from './build.mjs';
import { readCanonicalSql, runCanonicalSql } from './canonical-sql.mjs';
import { openIsolatedPostgres } from './postgres.mjs';
import { readMaterialPolicies, deriveDisabledMaterialPolicyAdditions } from './material-policy.mjs';

export async function deriveCandidateContract({ sourceRoot, sourceSha, sourceTree, profile, workRoot, binDirectory,
  materialPolicySha256, beforeLedger, signal }, { openDatabase = openIsolatedPostgres } = {}) {
  await verifyApplicationSource(sourceRoot, sourceSha, sourceTree); signal.throwIfAborted();
  const canonical = readCanonicalSql(sourceRoot, sourceSha);
  const sources = readMigrationSources(join(sourceRoot, 'migrations'));
  check(Array.isArray(beforeLedger) && beforeLedger.length > 0, 'release_migration_profile_invalid');
  resolveMigrationPlan(sources, profile, beforeLedger);
  const beforeSources = sources.slice(0, beforeLedger.length);
  const beforeLast = Number(beforeSources.at(-1).name.slice(0, 3));
  const beforeProfile = { ...profile, last: beforeLast, known_gaps: profile.known_gaps.filter(n => n <= beforeLast) };
  const cluster = await openDatabase({ workRoot, binDirectory, Pool, signal });
  const database = cluster.databaseName, migrator = database + '_migrator', runtime = database + '_app', backup = database + '_backup';
  let pool;
  try {
    await cluster.pool.query(`CREATE ROLE ${migrator} LOGIN; CREATE ROLE ${runtime} LOGIN; CREATE ROLE ${backup} LOGIN BYPASSRLS;
      CREATE SCHEMA public AUTHORIZATION ${migrator}; GRANT USAGE ON SCHEMA public TO ${runtime},${backup};`);
    pool = new Pool({ host: cluster.socket, port: 5432, user: migrator, database, max: 1, connectionTimeoutMillis: 5000, query_timeout: 135000 });
    await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${backup}`);
    await runMigrationPlan(pool, { sources: beforeSources, profile: beforeProfile, target: { database, role: migrator, schema: 'public' } });
    const beforePolicies = await readMaterialPolicies(pool);
    await runMigrationPlan(pool, { sources, profile, target: { database, role: migrator, schema: 'public' } });
    const materialPolicyAdditions = deriveDisabledMaterialPolicyAdditions(beforePolicies, await readMaterialPolicies(pool));
    await pool.query('BEGIN');
    await runCanonicalSql(pool, canonical, '20-runtime-grants.psql', { runtime, migrator });
    await pool.query('COMMIT');
    const tables = (await pool.query(`SELECT c.relname,c.relrowsecurity,has_table_privilege($1,c.oid,'SELECT') readable
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname`, [runtime])).rows;
    const privileges = (await pool.query(`SELECT c.relname AS table,r.suffix AS "roleSuffix",
      json_build_object('s',has_table_privilege(r.role,c.oid,'SELECT'),'i',has_table_privilege(r.role,c.oid,'INSERT'),
      'u',has_table_privilege(r.role,c.oid,'UPDATE'),'d',has_table_privilege(r.role,c.oid,'DELETE'),
      'extra',has_table_privilege(r.role,c.oid,'TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'),
      'grantable',has_table_privilege(r.role,c.oid,'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION')) privileges
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN (VALUES($1::text,'_app'),($2::text,'_backup')) r(role,suffix)
      WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname,r.suffix`, [runtime, backup])).rows;
    await verifyApplicationSource(sourceRoot, sourceSha, sourceTree); signal.throwIfAborted();
    return { materialPolicySha256, materialPolicyAdditions, rlsTables: tables.filter(row => row.relrowsecurity).map(row => row.relname),
      runtimeUnreadable: tables.filter(row => !row.readable).map(row => row.relname), tablePrivileges: privileges };
  } finally {
    await pool?.end(); await cluster.dispose();
  }
}
