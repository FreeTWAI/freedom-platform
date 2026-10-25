// One provider publish; only bounded GETs may repeat for propagation. This module
// receives an already built, admitted application tree from the image controller.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { requireRelease as check, isSha } from '../admission.mjs';
import { boundedResponseBytes } from './cloudflare.mjs';
import { privateBackupRoot } from './backup-storage.mjs';

const TARGETS = {
  'staging-next': { worker: 'freedom-platform-staging-next', origin: 'https://staging.freetwai.com', env: 'staging', database: 'freedom_staging_next' },
  next: { worker: 'freedom-platform-next', origin: 'https://freetwai.com', env: 'public', database: 'freedom_next' },
};
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const serialized = value => JSON.stringify(canonical(value));
const same = (a, b, code) => check(serialized(a) === serialized(b), code);
const hash = value => createHash('sha256').update(serialized(value)).digest('hex');
const retained = bindings => bindings.filter(binding => binding.name !== 'FREEDOM_RELEASE_SHA').map(canonical).sort((a, b) => a.name.localeCompare(b.name, 'en'));
const sortedBindings = bindings => [...bindings].sort((a, b) => a.name.localeCompare(b.name, 'en'));

async function persist(root, name, value) {
  await privateBackupRoot(root);
  const f = await open(join(root, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await f.writeFile(JSON.stringify(value) + '\n'); await f.sync(); } finally { await f.close(); }
  const d = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await d.sync(); } finally { await d.close(); }
}

function bindingSet(bindings) {
  check(Array.isArray(bindings) && bindings.length > 0 && bindings.length <= 256
    && bindings.every(b => b && /^[A-Z][A-Z0-9_]*$/.test(b.name))
    && new Set(bindings.map(b => b.name)).size === bindings.length, 'release_deploy_bindings_invalid');
  const fields = { plain_text: ['name', 'type', 'text'], secret_text: ['name', 'type'],
    assets: ['name', 'type'], hyperdrive: ['name', 'type', 'id'], images: ['name', 'type'],
    r2_bucket: ['name', 'type', 'bucket_name'], send_email: ['name', 'type', 'allowed_sender_addresses'] };
  for (const b of bindings) {
    check(Object.hasOwn(fields, b.type), 'release_deploy_binding_unsupported');
    same(Object.keys(b).sort(), fields[b.type].sort(), 'release_deploy_binding_fields');
    if (b.type === 'plain_text') check(typeof b.text === 'string' && b.text.length <= 16384, 'release_deploy_variable_invalid');
    if (b.type === 'hyperdrive') check(/^[a-f0-9]{32}$/.test(b.id), 'release_deploy_hyperdrive_invalid');
    if (b.type === 'r2_bucket') check(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(b.bucket_name), 'release_deploy_bucket_invalid');
  }
  for (const [type, names] of Object.entries({ assets: ['ASSETS'], hyperdrive: ['HYPERDRIVE'], images: ['IMAGES'],
    r2_bucket: ['GUIDE_STATIC', 'MEDIA'], send_email: ['EMAIL'] })) {
    same(bindings.filter(b => b.type === type).map(b => b.name).sort(), names, 'release_deploy_binding_inventory');
  }
}

/** Values come from the observed active Worker, whose digest the enclosing
 * controller compares with the approved retained state. No input can add a flag,
 * secret, route, binding, build command or arbitrary executable. */
export function renderWorkerConfig({ target, source, sourceRoot, sourceSha, before }) {
  check(Object.hasOwn(TARGETS, target) && isSha(sourceSha) && before.target === target, 'release_deploy_target_invalid');
  const spec = TARGETS[target], root = resolve(sourceRoot), env = source.env?.[target];
  check(root === sourceRoot && source.main === 'apps/platform-api/src/worker.ts'
    && source.assets?.directory === 'apps/portal-web/dist' && source.assets.binding === 'ASSETS'
    && source.assets.run_worker_first === true && env?.name === spec.worker
    && source.workers_dev === false && source.preview_urls === false
    && env.workers_dev === false && env.preview_urls === false, 'release_deploy_source_config_invalid');
  same(Object.keys(source.assets).sort(), ['binding', 'directory', 'html_handling', 'not_found_handling', 'run_worker_first'],
    'release_deploy_asset_options_changed');
  same(env.routes, [{ pattern: spec.origin.slice(8) + '/*', zone_name: 'freetwai.com' }], 'release_deploy_source_routes_changed');
  same(source.compatibility_date, before.runtime.compatibility_date, 'release_deploy_runtime_changed');
  same(source.compatibility_flags, before.runtime.compatibility_flags, 'release_deploy_runtime_changed');
  same(source.triggers?.crons, before.crons, 'release_deploy_crons_changed');
  same(env.triggers?.crons, before.crons, 'release_deploy_crons_changed');
  same({ html_handling: source.assets.html_handling, not_found_handling: source.assets.not_found_handling,
    serve_directly: false, raw_run_worker_first: true, base_path: '/' }, before.runtime.assets, 'release_deploy_assets_changed');
  const alias = {};
  check(source.alias && Object.keys(source.alias).length > 0 && Object.keys(source.alias).length <= 16, 'release_deploy_alias_invalid');
  for (const [name, path] of Object.entries(source.alias)) {
    check(typeof path === 'string' && path.startsWith('./'), 'release_deploy_alias_invalid');
    const absolute = resolve(root, path), rel = relative(root, absolute);
    check(rel && !rel.startsWith('../') && !rel.startsWith('/'), 'release_deploy_alias_invalid'); alias[name] = absolute;
  }
  bindingSet(before.bindings);
  const vars = Object.fromEntries(before.bindings.filter(b => b.type === 'plain_text').map(b => [b.name, b.text]));
  check(vars.APP_ORIGIN === spec.origin && vars.FREEDOM_ENV === spec.env && vars.FREEDOM_DATABASE_NAME === spec.database
    && vars.FREEDOM_RELEASE_SHA === before.sourceSha && vars.FREEDOM_TRUST_CF_CONNECTING_IP === 'true', 'release_deploy_live_variables_invalid');
  vars.FREEDOM_RELEASE_SHA = sourceSha;
  return {
    name: spec.worker, main: join(root, source.main), compatibility_date: source.compatibility_date,
    compatibility_flags: source.compatibility_flags, alias, workers_dev: false, preview_urls: false,
    // Preserve routes already owned by this Worker. Never alter DNS or Access.
    routes: [], triggers: { crons: before.crons }, keep_vars: true,
    placement: { region: 'aws:ap-northeast-1' },
    assets: { ...source.assets, directory: join(root, source.assets.directory) },
    hyperdrive: before.bindings.filter(b => b.type === 'hyperdrive').map(b => ({ binding: b.name, id: b.id })),
    images: { binding: 'IMAGES' },
    r2_buckets: before.bindings.filter(b => b.type === 'r2_bucket').map(b => ({ binding: b.name, bucket_name: b.bucket_name })),
    send_email: before.bindings.filter(b => b.type === 'send_email').map(b => ({ name: b.name, allowed_sender_addresses: b.allowed_sender_addresses })),
    vars,
  };
}

/** Fixed image-owned Wrangler, bounded output/time, no shell or inherited env.
 * Any timeout/signal is failure even if the program eventually exits zero. */
async function executeWrangler({ configPath, sourceSha, accountId, token, cwd, signal }) {
  const args = ['/opt/freedom/node_modules/wrangler/bin/wrangler.js', 'deploy', '--config', configPath,
    '--strict', '--keep-vars', '--message', 'freedom release ' + sourceSha];
  const child = spawn(process.execPath, args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'ignore'],
    env: { PATH: '/usr/local/bin:/usr/bin:/bin', XDG_CONFIG_HOME: cwd,
      CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: token, CI: 'true',
      WRANGLER_WRITE_LOGS: 'false', WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' } });
  let stopped = false, size = 0; const chunks = [];
  const stop = () => { stopped = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
  child.stdout.on('data', bytes => { size += bytes.length; if (size > 32 * 1024 * 1024) stop(); else chunks.push(bytes); });
  signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop();
  const timer = setTimeout(stop, 15 * 60_000);
  try {
    const result = await new Promise(resolve => {
      child.once('error', () => { stopped = true; });
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    check(!stopped && result.code === 0 && result.signal === null, 'release_deploy_outcome_unknown');
    const matches = [...Buffer.concat(chunks).toString('utf8').matchAll(/Current Version ID:\s*([a-f0-9-]{36})/g)];
    check(matches.length === 1 && UUID.test(matches[0][1]), 'release_deploy_provider_receipt_missing');
    return { versionId: matches[0][1] };
  } finally { clearTimeout(timer); signal.removeEventListener('abort', stop); }
}

export function createWorkerDeployer({ accountId, zoneId, target, token, signal, fetchImpl = fetch }) {
  check(/^[a-f0-9]{32}$/.test(accountId) && /^[a-f0-9]{32}$/.test(zoneId) && Object.hasOwn(TARGETS, target)
    && typeof token === 'string' && token.length > 0 && !/[\r\n]/.test(token) && signal instanceof AbortSignal,
  'release_deploy_input_invalid');
  const spec = TARGETS[target], account = '/accounts/' + accountId, base = account + '/workers/scripts/' + spec.worker;
  const get = async path => {
    signal.throwIfAborted(); let response, value;
    try {
      response = await fetchImpl('https://api.cloudflare.com/client/v4' + path, { method: 'GET', redirect: 'error',
        headers: { Authorization: 'Bearer ' + token, 'Cache-Control': 'no-store' },
        signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
      check(response.status === 200, 'release_deploy_provider_read_failed');
      value = JSON.parse((await boundedResponseBytes(response, 2_000_000)).toString('utf8'));
    } catch { await response?.body?.cancel().catch(() => {}); throw Error('release_deploy_provider_read_failed'); }
    check(value?.success === true && value.result !== undefined, 'release_deploy_provider_read_failed'); return value.result;
  };
  const active = async () => {
    const deployments = await get(base + '/deployments'), latest = (deployments.deployments ?? deployments)[0];
    check(latest?.versions?.length === 1 && latest.versions[0].percentage === 100 && UUID.test(latest.versions[0].version_id),
      'release_deploy_split_or_missing_version');
    const versionId = latest.versions[0].version_id, version = await get(base + '/versions/' + versionId);
    const bindings = version.resources?.bindings; bindingSet(bindings);
    const sourceSha = bindings.find(b => b.name === 'FREEDOM_RELEASE_SHA')?.text;
    check(isSha(sourceSha), 'release_deploy_source_missing');
    return { versionId, sourceSha, bindings, runtime: version.resources.script_runtime,
      placement: version.resources.script?.placement };
  };
  const inspect = async () => {
    const current = await active();
    const [settings, schedules, domains, subdomain, routes] = await Promise.all([
      get(base + '/settings'), get(base + '/schedules'), get(account + '/workers/domains?service=' + spec.worker),
      get(base + '/subdomain'), get('/zones/' + zoneId + '/workers/routes'),
    ]);
    same(sortedBindings(settings.bindings), sortedBindings(current.bindings), 'release_deploy_settings_inconsistent');
    check(Array.isArray(domains) && domains.length === 0 && subdomain.enabled === false && subdomain.previews_enabled === false,
      'release_deploy_public_topology_changed');
    const owned = routes.filter(route => route.script === spec.worker);
    check(owned.length === 1 && owned[0].pattern === spec.origin.slice(8) + '/*', 'release_deploy_route_changed');
    const crons = schedules.schedules?.map(row => row.cron).sort(); same(crons, ['*/10 * * * *'], 'release_deploy_crons_changed');
    check(current.placement?.mode === 'targeted' && current.placement.target?.length === 1
      && current.placement.target[0].region === 'aws:ap-northeast-1', 'release_deploy_placement_changed');
    check(settings.logpush === false && Array.isArray(settings.tail_consumers) && settings.tail_consumers.length === 0,
      'release_deploy_observability_unsupported');
    const hd = current.bindings.find(b => b.type === 'hyperdrive');
    check((await get(account + '/hyperdrive/configs/' + hd.id)).caching?.disabled === true, 'release_deploy_hyperdrive_cache_enabled');
    const last = await active(); same(last, current, 'release_deploy_version_changed_during_read');
    return { target, ...current, crons, bindingsSha256: hash(retained(current.bindings)),
      topologySha256: hash({ owned, domains, subdomain, crons }), runtimeSha256: hash({ runtime: current.runtime, placement: current.placement }) };
  };
  return Object.freeze({ inspect, async publish({ sourceSha, before, source, sourceRoot, workRoot, lease,
    execute = executeWrangler, sleep = ms => delay(ms, undefined, { signal }) }) {
    check(isSha(sourceSha) && before?.target === target && lease?.signal === signal, 'release_deploy_request_invalid');
    before = structuredClone(before); source = structuredClone(source);
    const assertHeld = () => { signal.throwIfAborted(); lease.assertHeld(); };
    assertHeld(); await privateBackupRoot(workRoot);
    const config = renderWorkerConfig({ target, sourceSha, before, source, sourceRoot });
    same(await inspect(), before, 'release_deploy_predecessor_changed');
    await persist(workRoot, 'wrangler.publish.json', config);
    await persist(workRoot, 'deploy-intent.json', { sourceSha, previousSourceSha: before.sourceSha, previousVersion: before.versionId,
      target, configSha256: hash(config), automaticRetry: false, outcome: 'unknown' });
    assertHeld();
    const result = await execute({ configPath: join(workRoot, 'wrangler.publish.json'), sourceSha, accountId, token, cwd: workRoot, signal });
    check(UUID.test(result?.versionId), 'release_deploy_provider_receipt_missing');
    await persist(workRoot, 'deploy-provider.json', { sourceSha, target, versionId: result.versionId });
    for (let attempt = 1; attempt <= 10; attempt++) {
      assertHeld();
      let observed;
      try { observed = await active(); }
      catch (error) {
        await persist(workRoot, `deploy-observation-${attempt}.json`, { attempt, matched: false, error: 'provider_observation_failed' });
        if (error.message !== 'release_deploy_provider_read_failed' || attempt === 10) throw error;
        assertHeld(); await sleep(3000); continue;
      }
      const matched = observed.sourceSha === sourceSha && observed.versionId === result.versionId;
      await persist(workRoot, `deploy-observation-${attempt}.json`, { attempt, sourceSha: observed.sourceSha, versionId: observed.versionId, matched });
      check(hash(retained(observed.bindings)) === before.bindingsSha256, 'release_deploy_bindings_changed');
      if (matched) {
        const after = await inspect();
        check(after.sourceSha === sourceSha && after.versionId === result.versionId
          && after.bindingsSha256 === before.bindingsSha256 && after.topologySha256 === before.topologySha256
          && after.runtimeSha256 === before.runtimeSha256, 'release_deploy_preservation_failed');
        assertHeld(); await persist(workRoot, 'deploy-completed.json', { sourceSha, versionId: result.versionId, observations: attempt });
        return { sourceSha, providerConfirmed: true, versionId: result.versionId, observations: attempt };
      }
      check(observed.sourceSha === before.sourceSha && observed.versionId === before.versionId, 'release_deploy_unexpected_active_version');
      if (attempt < 10) await sleep(3000);
    }
    throw Error('release_deploy_source_not_propagated');
  } });
}
