import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, writeFile, lstat, realpath } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { requireRelease as check, isSha } from '../admission.mjs';
import { privateBackupRoot } from './backup-storage.mjs';
import { renderWorkerConfig } from './deploy.mjs';
import { parseJsonc } from '../../cloudflare/lib/wrangler.mjs';

const gitEnv = { PATH: '/usr/local/bin:/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' };
const git = (root, args) => execFileSync('/usr/bin/git', ['--no-optional-locks', '-c', 'core.fsmonitor=false',
  '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.allow=never', ...args], {
  cwd: root, env: gitEnv, timeout: 30000, maxBuffer: 1_000_000, stdio: ['ignore', 'pipe', 'pipe'],
}).toString('utf8').trim();

export async function verifyApplicationSource(sourceRoot, sourceSha, sourceTree, { untracked = true } = {}) {
  check(isSha(sourceSha) && isSha(sourceTree) && resolve(sourceRoot) === sourceRoot && await realpath(sourceRoot) === sourceRoot,
    'release_build_source_invalid');
  check(git(sourceRoot, ['rev-parse', '--show-prefix']) === '' && git(sourceRoot, ['rev-parse', 'HEAD']) === sourceSha
    && git(sourceRoot, ['rev-parse', 'HEAD^{tree}']) === sourceTree
    && git(sourceRoot, ['status', '--porcelain=v1', '--untracked-files=' + (untracked ? 'all' : 'no')]) === '',
  'release_build_source_changed');
  for (const path of ['objects/info/alternates', 'objects/info/http-alternates', 'info/grafts']) {
    check(!existsSync(resolve(sourceRoot, git(sourceRoot, ['rev-parse', '--git-path', path]))), 'release_build_source_indirection');
  }
}

/** Only invoked with fixed programs/args below. Build processes receive neither
 * provider/DB credentials nor inherited preload, npm config or GitHub tokens. */
export async function executeBuild(program, args, { cwd, cache, signal }) {
  signal.throwIfAborted();
  const child = spawn(program, args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...gitEnv, LANG: 'C.UTF-8', CI: 'true', XDG_CONFIG_HOME: cache,
      npm_config_cache: cache, npm_config_userconfig: '/dev/null', npm_config_audit: 'false', npm_config_fund: 'false',
      WRANGLER_WRITE_LOGS: 'false', WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' } });
  let failed = false, bytes = 0;
  const stop = () => { failed = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
  const consume = chunk => { bytes += chunk.length; if (bytes > 32 * 1024 * 1024) stop(); };
  child.stdout.on('data', consume); child.stderr.on('data', consume);
  signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop();
  const timer = setTimeout(stop, 15 * 60_000);
  try {
    const result = await new Promise(resolve => {
      child.once('error', () => { failed = true; }); child.once('close', (code, signal) => resolve({ code, signal }));
    });
    check(!failed && result.code === 0 && result.signal === null, 'release_build_process_failed');
  } finally { clearTimeout(timer); signal.removeEventListener('abort', stop); }
}

export async function directoryDigest(root) {
  check(await realpath(root) === root && (await lstat(root)).isDirectory(), 'release_build_output_invalid');
  const records = []; let bytes = 0;
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name), rel = relative(root, file);
      check(!entry.isSymbolicLink() && !/[\r\n]/.test(rel), 'release_build_output_invalid');
      if (entry.isDirectory()) await walk(file);
      else {
        check(entry.isFile(), 'release_build_output_invalid');
        const size = (await lstat(file)).size; bytes += size;
        check(size <= 64 * 1024 * 1024 && bytes <= 512 * 1024 * 1024 && records.length < 20000, 'release_build_output_limit');
        const data = await readFile(file); check(data.length === size, 'release_build_output_changed');
        records.push({ path: rel, bytes: size, sha256: createHash('sha256').update(data).digest('hex') });
      }
    }
  }
  await walk(root); records.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  check(records.length > 0, 'release_build_output_missing');
  return { sha256: createHash('sha256').update(JSON.stringify(records)).digest('hex'), files: records.length, bytes, records };
}

/** Independent source copy with a single selected commit and its lockfile.
 * No source npm lifecycle/build runs until the caller's main/CI admission.
 * The immutable original checkout remains available for migration installation. */
export async function buildApplication({ sourceRoot, sourceSha, sourceTree, workRoot, target, before, signal,
  execute = executeBuild }) {
  await privateBackupRoot(workRoot); await verifyApplicationSource(sourceRoot, sourceSha, sourceTree); signal.throwIfAborted();
  const root = await mkdtemp(join(workRoot, 'build-')), app = join(root, 'application'), cache = join(root, 'cache');
  await mkdir(app, { mode: 0o700 }); await mkdir(cache, { mode: 0o700 });
  const options = { cwd: app, cache, signal };
  const invoke = async (program, args) => { signal.throwIfAborted(); await execute(program, args, options); signal.throwIfAborted(); };
  // Fetch only from the validated read-only checkout, never a URL supplied in a
  // workflow input. A fresh repository has no inherited hooks or config.
  await invoke('/usr/bin/git', ['-c', 'init.templateDir=', 'init', '--quiet', '--initial-branch=main']);
  await invoke('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.file.allow=always',
    'fetch', '--depth=1', '--no-tags', '--', sourceRoot, sourceSha]);
  await invoke('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', 'checkout', '--quiet', '--detach', sourceSha]);
  await verifyApplicationSource(app, sourceSha, sourceTree);
  await invoke('/usr/local/bin/npm', ['ci', '--no-audit', '--no-fund']);
  await invoke('/usr/local/bin/npm', ['run', 'build']);
  await verifyApplicationSource(app, sourceSha, sourceTree, { untracked: false });
  const assets = await directoryDigest(join(app, 'apps/portal-web/dist'));
  check(assets.records.some(row => row.path === 'index.html'), 'release_build_index_missing');
  const source = parseJsonc(await readFile(join(app, 'wrangler.jsonc'), 'utf8'));
  const config = renderWorkerConfig({ target, source, sourceRoot: app, sourceSha, before });
  const configPath = join(root, 'wrangler.dry-run.json'), bundle = join(root, 'worker');
  await writeFile(configPath, JSON.stringify(config) + '\n', { mode: 0o600, flag: 'wx' });
  await invoke(process.execPath, ['/opt/freedom/node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run',
    '--config', configPath, '--outdir', bundle]);
  await verifyApplicationSource(app, sourceSha, sourceTree, { untracked: false });
  const worker = await directoryDigest(bundle);
  check(worker.records.some(row => row.path.endsWith('.js')), 'release_build_worker_missing');
  const receipt = { sourceSha, sourceTree, assetsSha256: assets.sha256, workerSha256: worker.sha256,
    packageLockSha256: createHash('sha256').update(await readFile(join(app, 'package-lock.json'))).digest('hex'),
    builtAt: new Date().toISOString(), providerMutation: false };
  await writeFile(join(root, 'built.json'), JSON.stringify(receipt) + '\n', { mode: 0o600, flag: 'wx' });
  return { ...receipt, root: app, source, async assertUnchanged() {
    signal.throwIfAborted(); await verifyApplicationSource(app, sourceSha, sourceTree, { untracked: false });
    check((await directoryDigest(join(app, 'apps/portal-web/dist'))).sha256 === assets.sha256
      && (await directoryDigest(bundle)).sha256 === worker.sha256, 'release_build_outputs_changed');
  } };
}
