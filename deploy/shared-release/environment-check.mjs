// Read-only installation diagnostics. No image, floor installation, deployment
// switch or natural backup is needed to check the newly stored credentials.
import { createHash } from 'node:crypto';
import { requireRelease as check, isDigest, isSha } from './admission.mjs';
import { validatePortableConfig } from './portable/config.mjs';
import { boundedResponseBytes } from './portable/cloudflare.mjs';
import { createWorkerDeployer } from './portable/deploy.mjs';
import { applyFlagDecisions } from './portable/flag-decisions.mjs';

const secret = value => typeof value === 'string' && value.length > 0
  && value.length <= 4096 && !/[\r\n\0]/.test(value);

export async function checkEnvironment(env, target, { fetchImpl = fetch, flagDecisions } = {}) {
  check(typeof env.RELEASE_CONFIG_JSON === 'string' && Buffer.byteLength(env.RELEASE_CONFIG_JSON) <= 262144
    && isDigest(env.RELEASE_CONFIG_SHA256)
    && createHash('sha256').update(env.RELEASE_CONFIG_JSON).digest('hex') === env.RELEASE_CONFIG_SHA256,
  'release_config_pin_mismatch');
  let value;
  try { value = JSON.parse(env.RELEASE_CONFIG_JSON); } catch { check(false, 'release_config_json_invalid'); }
  const config = validatePortableConfig(value, target), results = [];
  const report = { format: 'freedom.shared-environment-check/v1', target, configSha256: env.RELEASE_CONFIG_SHA256,
    readOnly: true, checks: results, databaseCredentials: 'not_checked', writePermissions: 'not_checked',
    backupAndRestore: 'not_run', deployment: 'not_run' };
  const signal = AbortSignal.timeout(180_000);
  const run = async (name, operation) => {
    const result = { name, status: 'failed' }; results.push(result);
    try { await operation(); result.status = 'passed'; return true; }
    catch (error) {
      // Explicit projection: never publish provider bodies, headers, URLs,
      // credential values or exception messages (including malformed inputs).
      result.error = /^release_[a-z_]+$/.test(error?.code ?? '') ? error.code : 'release_environment_check_failed';
      if (Number.isInteger(error?.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599) result.httpStatus = error.httpStatus;
      return false;
    }
  };
  const read = async (url, headers) => {
    // Manual mode exposes the status without following Location or sending
    // credentials to a second origin. redirect:error hides this useful result.
    let response;
    try {
      response = await fetchImpl(url, { method: 'GET', redirect: 'manual', headers,
        signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
    } catch { check(false, 'release_environment_transport_failed'); }
    if (response.status !== 200) {
      await response.body?.cancel();
      const code = response.status >= 300 && response.status < 400
        ? 'release_environment_redirect_rejected' : 'release_environment_http_failed';
      throw Object.assign(Error(code), { code, httpStatus: response.status });
    }
    let body;
    try { body = JSON.parse((await boundedResponseBytes(response, 2_000_000)).toString('utf8')); }
    catch { check(false, 'release_environment_response_invalid'); }
    return body;
  };
  const api = async (path, scope = `/accounts/${config.accountId}`) => {
    check(secret(env.CLOUDFLARE_API_TOKEN), 'release_cloudflare_credentials_missing');
    const body = await read(`https://api.cloudflare.com/client/v4${scope}${path}`,
      { Authorization: 'Bearer ' + env.CLOUDFLARE_API_TOKEN, 'Cache-Control': 'no-store' });
    check(body.success === true && body.result !== undefined, 'release_environment_response_invalid'); return body.result;
  };
  await run('cloudflare_account_token', async () => {
    try {
      check((await api('/tokens/verify')).status === 'active', 'release_account_token_inactive');
      report.cloudflareTokenKind = 'account';
    } catch (error) {
      if (error.code !== 'release_environment_http_failed' || ![401, 403].includes(error.httpStatus)) throw error;
      // Diagnose an accidentally installed personal token; do not accept it as
      // an account-owned service credential or disclose its identifier.
      let userToken;
      try { userToken = await api('/tokens/verify', '/user'); } catch { throw error; }
      if (userToken.status !== 'active') throw error;
      report.cloudflareTokenKind = 'user';
      throw Object.assign(Error('release_account_owned_token_required'), {
        code: 'release_account_owned_token_required', httpStatus: error.httpStatus,
      });
    }
  });
  let live;
  await run('worker_routes_and_hyperdrive', async () => {
    check(secret(env.CLOUDFLARE_API_TOKEN), 'release_cloudflare_credentials_missing');
    live = await createWorkerDeployer({ accountId: config.accountId, zoneId: config.zoneId, target,
      token: env.CLOUDFLARE_API_TOKEN, signal, fetchImpl }).inspect();
    check(live.bindings.find(row => row.name === 'MEDIA')?.bucket_name === config.mediaBucket,
      'release_environment_media_mismatch');
    report.observedSourceSha = live.sourceSha;
    if (flagDecisions) {
      report.flagChanges = applyFlagDecisions({ target, bindings: live.bindings, decisions: flagDecisions }).flagChanges;
      report.flagChangesObservation = 'live';
    }
  });
  for (const [name, bucket] of [['media_object_listing', config.mediaBucket], ['backup_object_listing', config.backupBucket]]) {
    await run(name, async () => {
      const rows = await api(`/r2/buckets/${bucket}/objects?per_page=1`);
      check(Array.isArray(rows) && rows.length <= 1, 'release_environment_response_invalid');
    });
  }
  await run(target === 'staging-next' ? 'staging_access_health' : 'public_health', async () => {
    const headers = { 'Cache-Control': 'no-store' };
    if (target === 'staging-next') {
      check(secret(env.CF_ACCESS_CLIENT_ID) && secret(env.CF_ACCESS_CLIENT_SECRET), 'release_staging_access_required');
      headers['CF-Access-Client-Id'] = env.CF_ACCESS_CLIENT_ID;
      headers['CF-Access-Client-Secret'] = env.CF_ACCESS_CLIENT_SECRET;
    }
    // Origin comes from fixed target constants, never a workflow input/config URL.
    // Access credentials are sent only to staging. Redirects are never followed.
    const health = await read(config.fixed.origin + '/api/v1/health', headers);
    check(health.status === 'ok' && isSha(health.release_sha), 'release_environment_health_invalid');
    if (live) check(health.release_sha === live.sourceSha, 'release_environment_health_source_mismatch');
    report.healthSourceSha = health.release_sha;
  });
  report.status = results.every(item => item.status === 'passed') ? 'passed' : 'failed';
  return report;
}
