import { requireRelease as check, isDigest } from '../admission.mjs';
import { remotePostgresEnvironment } from './postgres.mjs';

const resources = Object.freeze({
  'staging-next': { database: 'freedom_staging_next', environment: 'staging', worker: 'freedom-platform-staging-next', origin: 'https://staging.freetwai.com' },
  next: { database: 'freedom_next', environment: 'production', worker: 'freedom-platform-next', origin: 'https://freetwai.com' },
});
const keys = (value, expected) => check(value && typeof value === 'object' && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), 'release_config_fields_invalid');

/** Configuration identifies resources and retained authority, never programs or
 * feature decisions. Both the Environment and request pin its exact bytes. */
export function validatePortableConfig(value, target) {
  keys(value, ['format', 'target', 'accountId', 'zoneId', 'mediaBucket', 'backupBucket', 'database', 'floor', 'migrationProfile']);
  check(Object.hasOwn(resources, target) && value.format === 'freedom.shared-release-config/v1' && value.target === target,
    'release_config_target_invalid');
  check(/^[a-f0-9]{32}$/.test(value.accountId) && /^[a-f0-9]{32}$/.test(value.zoneId)
    && [value.mediaBucket, value.backupBucket].every(v => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(v))
    && value.mediaBucket !== value.backupBucket, 'release_config_resources_invalid');
  keys(value.database, ['name', 'host', 'port', 'loginSuffix']);
  check(value.database.name === resources[target].database && /^[a-z0-9.-]+\.pg\.psdb\.cloud$/.test(value.database.host)
    && value.database.port === '5432' && /^[a-z0-9_-]{1,128}$/.test(value.database.loginSuffix), 'release_config_database_invalid');
  keys(value.floor, ['epoch', 'seedSha256']);
  check(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.floor.epoch)
    && isDigest(value.floor.seedSha256), 'release_config_floor_invalid');
  keys(value.migrationProfile, ['format', 'first', 'last', 'known_gaps']);
  const p = value.migrationProfile;
  check(p.format === 'freedom.migrations/legacy-v1' && p.first === 1 && Number.isSafeInteger(p.last)
    && p.last >= 189 && p.last <= 999 && JSON.stringify(p.known_gaps) === '[22]', 'release_config_profile_invalid');
  return Object.freeze({ ...structuredClone(value), fixed: resources[target] });
}

export function portableConnections(config, credentials, { includeBackup = true } = {}) {
  const result = {};
  for (const [name, suffix, field] of [['migrator', '_migrator', 'migrationDatabaseUrl'], ['runtime', '_app', 'runtimeDatabaseUrl'], ['backup', '_backup', 'backupDatabaseUrl']]) {
    if (name === 'backup' && !includeBackup) continue;
    const role = config.database.name + suffix, login = role + '.' + config.database.loginSuffix;
    const env = remotePostgresEnvironment(credentials[field], { database: config.database.name, role, login });
    check(env.PGHOST === config.database.host && env.PGPORT === config.database.port, 'release_config_database_host_changed');
    result[name] = { role, env, options: { host: env.PGHOST, port: Number(env.PGPORT), database: env.PGDATABASE,
      user: env.PGUSER, password: env.PGPASSWORD, ssl: { rejectUnauthorized: true, servername: env.PGHOST },
      max: name === 'backup' ? 8 : 4, connectionTimeoutMillis: 15000, query_timeout: 135000,
      application_name: 'freedom-shared-release' } };
  }
  return result;
}
