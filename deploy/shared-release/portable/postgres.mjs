import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { open, lstat, mkdir, mkdtemp, rm, realpath, statfs } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { requireRelease as check } from '../admission.mjs';

const MAX_DUMP = 64 * 1024 * 1024;
const identifier = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(value);
const allowedEnvironment = new Set(['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSSLMODE', 'PGSSLROOTCERT']);
const error = code => Object.assign(new Error(code), { code });

export function remotePostgresEnvironment(connectionString, target) {
  check(identifier(target?.database) && identifier(target?.role), 'release_pg_target_invalid');
  // PlanetScale TLS login may append a branch ID. The SQL role remains plain;
  // accept only the exact independently configured login, never an inferred one.
  const login = target.login ?? target.role;
  check(typeof login === 'string' && (login === target.role
    || (login.startsWith(target.role + '.') && /^[a-z0-9_-]{1,128}$/.test(login.slice(target.role.length + 1)))),
  'release_pg_target_invalid');
  let url, database, role, password;
  try {
    url = new URL(connectionString); database = decodeURIComponent(url.pathname);
    role = decodeURIComponent(url.username); password = decodeURIComponent(url.password);
  } catch { throw error('release_pg_connection_invalid'); }
  check(['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname && !url.hash
    && database === '/' + target.database && role === login && password.length > 0 && !password.includes('\0'),
  'release_pg_connection_invalid');
  const parameters = [...url.searchParams];
  check(parameters.length === 1 && parameters[0][0] === 'sslmode' && parameters[0][1] === 'verify-full',
    'release_pg_tls_required');
  return Object.freeze({ PGHOST: url.hostname.replace(/^\[|\]$/g, ''), PGPORT: url.port || '5432',
    PGDATABASE: target.database, PGUSER: login, PGPASSWORD: password,
    PGSSLMODE: 'verify-full', PGSSLROOTCERT: 'system' });
}

function processEnvironment(connection) {
  check(connection && Object.keys(connection).every(key => allowedEnvironment.has(key))
    && Object.values(connection).every(value => typeof value === 'string' && !value.includes('\0')),
  'release_pg_environment_invalid');
  // No inherited PGOPTIONS, PGSERVICE, NODE_OPTIONS, cloud token or job token.
  return { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', ...connection };
}

/** A host-owned executable, bounded private stdout, discarded stderr. No shell. */
export async function runPostgresProcess(program, args, { connection = {}, output,
  maxBytes = MAX_DUMP, timeoutMs = 180_000, signal } = {}) {
  check(program.startsWith('/') && Array.isArray(args) && args.every(value => typeof value === 'string')
    && Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= MAX_DUMP
    && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 180_000,
  'release_pg_process_input_invalid');
  signal?.throwIfAborted();
  let file;
  if (output) file = await open(output, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  let child, timer, stopped = false, failure, size = 0, first = Buffer.alloc(0);
  const hash = createHash('sha256'), chunks = [];
  const stop = code => {
    failure ??= error(code);
    if (child?.pid && !stopped) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') failure = error('release_pg_process_cleanup_failed'); }
    }
  };
  const abort = () => stop('release_pg_aborted');
  try {
    child = spawn(program, args, { env: processEnvironment(connection), detached: true,
      stdio: ['ignore', 'pipe', 'ignore'] });
    const exited = new Promise(accept => {
      child.once('error', () => { failure ??= error('release_pg_process_failed'); });
      child.once('close', (code, sig) => { stopped = true; accept({ code, sig }); });
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    timer = setTimeout(() => stop('release_pg_process_timeout'), timeoutMs);
    try {
      for await (const chunk of child.stdout) {
        size += chunk.length;
        if (size > maxBytes) { stop('release_pg_output_limit'); break; }
        hash.update(chunk);
        if (first.length < 5) first = Buffer.concat([first, chunk]).subarray(0, 5);
        if (file) await file.writeFile(chunk); else chunks.push(chunk);
      }
    } catch { stop('release_pg_output_failed'); }
    const result = await exited;
    if (failure) throw failure;
    check(result.code === 0 && result.sig === null, 'release_pg_process_failed');
    await file?.sync();
    return { sha256: hash.digest('hex'), byteSize: size, prefix: first.toString('ascii'),
      ...(file ? {} : { text: Buffer.concat(chunks).toString('utf8') }) };
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort); await file?.close();
  }
}

/** Native pg_dump uses the coordinator's still-open exported snapshot. */
export async function writeSnapshotDump({ binDirectory, connection, output, input,
  signal, execute = runPostgresProcess }) {
  check(identifier(input?.database) && input.schema === 'public' && connection.PGDATABASE === input.database
    && typeof input.snapshotId === 'string' && /^[0-9A-Fa-f]{1,16}-[0-9A-Fa-f]{1,16}-[1-9][0-9]{0,9}$/.test(input.snapshotId),
  'release_pg_snapshot_invalid');
  const dump = join(resolve(binDirectory), 'pg_dump');
  const version = await execute(dump, ['--version'], { maxBytes: 1024, timeoutMs: 10_000, signal });
  check(/^pg_dump \(PostgreSQL\) 18\./.test(version.text), 'release_pg_version_invalid');
  const result = await execute(dump, ['--format=custom', '--schema=public', '--no-owner', '--no-privileges',
    '--snapshot=' + input.snapshotId], { connection, output, signal });
  check(result.prefix === 'PGDMP' && result.byteSize > 5, 'release_pg_dump_invalid');
  const directory = await open(dirname(output), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
  return Object.freeze({ sha256: result.sha256, byteSize: result.byteSize });
}

async function privateWorkRoot(root) {
  const path = resolve(root), st = await lstat(path);
  check(!/[\s'"\\]/.test(path) && st.isDirectory() && !st.isSymbolicLink() && (st.mode & 0o077) === 0
    && st.uid === process.getuid() && await realpath(path) === path, 'release_pg_work_directory_invalid');
  const fs = await statfs(path);
  check(![0x01021994, 0x858458f6].includes(fs.type >>> 0), 'release_pg_disk_required'); // tmpfs / ramfs
  return path;
}

/** A fresh, disk-backed, Unix-socket-only PG18 cluster. Never accepts a restore URL. */
export async function openIsolatedPostgres({ workRoot, binDirectory, Pool, signal,
  execute = runPostgresProcess }) {
  const parent = await privateWorkRoot(workRoot);
  const root = await mkdtemp(join(parent, 'pg-')), data = join(root, 'data'), socket = join(root, 'socket');
  const databaseName = 'fp_shared_recovery', user = 'fp_restore_owner';
  let admin, pool, startAttempted = false, disposed = false;
  const program = name => join(resolve(binDirectory), name);
  const connection = Object.freeze({ PGHOST: socket, PGPORT: '5432', PGUSER: user,
    PGDATABASE: databaseName, PGSSLMODE: 'disable' });
  const invoke = (name, args, options = {}) => execute(program(name), args, { maxBytes: 65_536, signal, ...options });
  const dispose = async () => {
    if (disposed) return;
    // Do not delete the cluster if shutdown could not be confirmed. The enclosing
    // owned operator container must then be stopped; its outcome remains failed.
    let cleanupTimer;
    const results = await Promise.race([
      Promise.allSettled([pool?.end(), admin?.end()]),
      new Promise(accept => { cleanupTimer = setTimeout(() => accept([{ status: 'rejected' }]), 10_000); }),
    ]);
    clearTimeout(cleanupTimer);
    if (startAttempted) {
      await invoke('pg_ctl', ['--pgdata=' + data, '--wait', '--timeout=30', '--mode=immediate', 'stop'],
        { signal: undefined, timeoutMs: 40_000 });
    }
    check(results.every(result => result.status === 'fulfilled'), 'release_pg_pool_cleanup_failed');
    await rm(root, { recursive: true, force: true }); disposed = true;
  };
  try {
    check(socket.length < 90, 'release_pg_socket_path_invalid');
    await mkdir(socket, { mode: 0o700 });
    const version = await invoke('initdb', ['--version']);
    check(/^initdb \(PostgreSQL\) 18\./.test(version.text), 'release_pg_version_invalid');
    await invoke('initdb', ['--pgdata=' + data, '--username=' + user, '--encoding=UTF8', '--no-locale',
      '--auth-local=trust', '--auth-host=reject']);
    startAttempted = true;
    // Every option/path is generated here, not supplied by the source or request.
    await invoke('pg_ctl', ['--pgdata=' + data, '--wait', '--timeout=30', '--log=' + join(root, 'postgres.private.log'),
      '--options=-c listen_addresses= -c unix_socket_directories=' + socket
      + ' -c unix_socket_permissions=0700 -c dynamic_shared_memory_type=mmap -c max_connections=20'
      + ' -c max_locks_per_transaction=256 -c shared_buffers=16MB -c fsync=on', 'start'], { timeoutMs: 40_000 });
    const poolConfig = { host: socket, port: 5432, user, database: 'postgres', max: 2,
      connectionTimeoutMillis: 5000, query_timeout: 30_000 };
    admin = new Pool(poolConfig);
    const actual = (await admin.query(`SELECT current_setting('data_directory') directory,
      current_setting('listen_addresses') addresses,current_setting('fsync') fsync,
      current_setting('server_version_num') version,current_user role,current_database() database`)).rows[0];
    check(actual?.directory === data && actual.addresses === '' && actual.fsync === 'on'
      && Number(actual.version) >= 180000 && Number(actual.version) < 190000
      && actual.role === user && actual.database === 'postgres', 'release_pg_isolation_invalid');
    await admin.query('CREATE DATABASE ' + databaseName + ' TEMPLATE template0');
    pool = new Pool({ ...poolConfig, database: databaseName });
    await pool.query('DROP SCHEMA public');
    let restoreAttempted = false;
    const database = { async restore(input) {
      check(!disposed && !restoreAttempted && input.database === databaseName && input.schema === 'public'
        && input.archive instanceof ReadableStream, 'release_pg_restore_target_invalid');
      restoreAttempted = true;
      const path = join(root, 'restore.dump'), handle = await open(path, 'wx', 0o600);
      const reader = input.archive.getReader(); let bytes = 0, prefix = Buffer.alloc(0);
      try {
        while (true) {
          signal?.throwIfAborted();
          const next = await reader.read(); if (next.done) break;
          check(next.value instanceof Uint8Array, 'release_pg_restore_input_invalid');
          bytes += next.value.length; check(bytes <= MAX_DUMP, 'release_pg_output_limit');
          if (prefix.length < 5) prefix = Buffer.concat([prefix, next.value]).subarray(0, 5);
          await handle.writeFile(next.value);
        }
        check(bytes > 5 && prefix.toString('ascii') === 'PGDMP', 'release_pg_dump_invalid');
        await handle.sync();
      } finally { try { await reader.cancel(); } finally { await handle.close(); } }
      // The outer recovery reader verifies the full stream hash before this command
      // is reached. Any checksum/stream failure therefore precedes database mutation.
      await invoke('pg_restore', ['--single-transaction', '--exit-on-error', '--no-owner', '--no-privileges',
        '--dbname=' + databaseName, path], { connection, maxBytes: 1024, timeoutMs: 180_000 });
    } };
    return Object.freeze({ pool, databaseName, database, connection, root, data, socket, dispose });
  } catch (cause) {
    try { await dispose(); }
    catch { throw error('release_pg_isolation_cleanup_failed'); }
    throw cause;
  }
}
