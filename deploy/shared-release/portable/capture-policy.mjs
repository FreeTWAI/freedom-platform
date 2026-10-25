import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { requireRelease as check } from '../admission.mjs';
import { bytesStream } from './backup-storage.mjs';

/** Owned temporary capture policy. A timed-out UPDATE may still commit: settle
 * that exact backend before attempting conditional GC-off cleanup. The enclosing
 * release keeps its separate advisory-lock session throughout this operation. */
export async function openCapturePolicy({ pool, database, role, revision, before, intent }) {
  check(/^[a-z][a-z0-9_]{0,62}$/.test(database) && /^[a-z][a-z0-9_]{0,62}$/.test(role)
    && /^shared-backup-[a-f0-9-]{36}$/.test(revision) && /^[a-f0-9]{64}$/.test(before ?? ''),
  'release_capture_policy_input_invalid');
  const client = await pool.connect(), application = 'fp-capture-' + randomUUID();
  let pid, attempted = false, settled = false, released = false, cleaned = false, broken = false;
  const onError = () => { broken = true; };
  client.on('error', onError);
  const query = (text, values = []) => client.query({ text, values, query_timeout: 45_000 });
  const release = destroy => {
    if (released) return; released = true;
    client.removeListener('error', onError); client.release(destroy || broken);
  };
  const settle = async () => {
    release(true);
    const lookup = `SELECT pid FROM pg_stat_activity WHERE pid=$1 AND datname=$2 AND usename=$3 AND application_name=$4`;
    const values = [pid, database, role, application];
    if ((await pool.query(lookup, values)).rows.length) {
      // Never terminate by role/name alone, nor the shared lease backend.
      const result = await pool.query(`SELECT pg_terminate_backend(pid) stopped FROM pg_stat_activity
        WHERE pid=$1 AND datname=$2 AND usename=$3 AND application_name=$4`, values);
      check(result.rows.every(row => row.stopped === true), 'release_capture_policy_unsettled');
    }
    for (let i = 0; i < 25; i++) {
      if (!(await pool.query(lookup, values)).rows.length) { settled = true; return; }
      await delay(200);
    }
    throw new Error('release_capture_policy_unsettled');
  };
  try {
    await query("SELECT set_config('application_name',$1,false),set_config('statement_timeout','30000',false),set_config('lock_timeout','5000',false)", [application]);
    const row = (await query(`SELECT current_database() database,current_user role,session_user session_role,pg_backend_pid() pid`)).rows[0];
    check(row?.database === database && row.role === role && row.session_role === role
      && Number.isSafeInteger(row.pid) && row.pid > 0, 'release_capture_policy_identity_invalid'); pid = row.pid;
    check(await intent.putIfAbsent('capture-policy.json', bytesStream(Buffer.from(JSON.stringify({
      format: 'freedom.shared-capture-policy-intent/v1', pid, application, database, role, revision,
      before, automaticRetry: false, outcome: 'unconfirmed',
    })))) === 'created', 'release_capture_policy_intent_exists');
  } catch (error) { release(true); throw error; }
  return Object.freeze({
    async enable() {
      check(!attempted && !released, 'release_capture_policy_retry_forbidden'); attempted = true;
      try {
        const result = await query(`UPDATE asset_maintenance_policy p SET enabled=true,revision=$1,
          orphan_retention_seconds=2592000,retired_retention_seconds=2592000,delete_lease_seconds=60,
          capture_seconds=600,pin_seconds=86400,max_capture_objects=1000
          WHERE singleton AND NOT enabled AND NOT domain_media_enabled
          AND encode(pg_catalog.sha256(convert_to((to_jsonb(p)-'generation')::text,'UTF8')),'hex')=$2 RETURNING revision`, [revision, before]);
        settled = true;
        check(!broken && result.rowCount === 1 && result.rows[0]?.revision === revision, 'release_capture_policy_changed');
      } finally { release(!settled); }
    },
    async cleanup() {
      if (cleaned) return;
      if (attempted && !settled) await settle(); else release(false);
      if (attempted) {
        await pool.query({ text: `UPDATE asset_maintenance_policy SET enabled=false,domain_media_enabled=false
          WHERE singleton AND revision=$1`, values: [revision], query_timeout: 45_000 });
      }
      const rows = (await pool.query('SELECT enabled,domain_media_enabled FROM asset_maintenance_policy WHERE singleton')).rows;
      check(rows.length === 1 && rows[0].enabled === false && rows[0].domain_media_enabled === false,
        'release_capture_policy_cleanup_failed'); cleaned = true;
    },
  });
}
