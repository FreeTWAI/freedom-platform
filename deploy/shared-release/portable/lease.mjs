import { requireRelease as check } from '../admission.mjs';

// Same lock namespace as the installed daily/legacy recovery operators.
const key = "hashtextextended('freedom.daily.recovery.'||current_database(),0)";
const identity = 'SELECT current_database() database,current_user role,session_user session_role,pg_backend_pid() pid';
// bigint advisory keys use the unsigned high/low 32 bits, even for negative hashes.
const ownership = `SELECT current_database() database,current_user role,session_user session_role,pg_backend_pid() pid,
  EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid() AND granted
    AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
    AND classid::bigint=((${key} >> 32) & 4294967295)
    AND objid::bigint=(${key} & 4294967295) AND objsubid=1) locked`;
export const LEASE_LOSS_CAUSES = Object.freeze(['heartbeat_timeout', 'heartbeat_failed', 'identity_changed',
  'lock_not_held', 'connection_error', 'connection_ended']);
export const isLeaseErrorClass = value => typeof value === 'string' &&
  (/^(?:[0-9][0-9A-Z]|F0|HV|P0|XX)[0-9A-Z]{3}$/.test(value)
    || ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH',
      'EAI_AGAIN', 'ENOTFOUND', 'ECONNABORTED'].includes(value));
const fail = code => Object.assign(new Error(code), { code });

/** A dedicated database session spans backup, migration, deployment and cleanup. */
export async function acquireReleaseLease(pool, { database, role, signal, heartbeatMs = 20_000 }) {
  check([database, role].every(value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(value))
    && Number.isSafeInteger(heartbeatMs) && heartbeatMs >= 50 && heartbeatMs <= 20_000,
  'release_lease_target_invalid');
  signal?.throwIfAborted();
  const client = await pool.connect(), controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let timer, active = false, released = false, pending, pid, loss, acquiredAt, lastHeartbeatAt, lockAttempted = false, heartbeats = 0;
  const query = (text, timeout = 5000) => client.query({ text, query_timeout: timeout });
  const lost = (cause, error) => {
    if (loss) return;
    const now = performance.now();
    const elapsed = start => Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(now - (start ?? now))));
    loss = Object.freeze({ cause, heldMs: elapsed(acquiredAt), sinceHeartbeatMs: elapsed(lastHeartbeatAt), heartbeats,
      ...(isLeaseErrorClass(error?.code) ? { errorClass: error.code } : {}) });
    controller.abort(Object.assign(fail('release_lease_lost'), { leaseLoss: loss }));
  };
  const connectionError = error => lost('connection_error', error), connectionEnded = () => lost('connection_ended');
  client.on('error', connectionError); client.on('end', connectionEnded);
  const assertHeld = () => {
    check(active && !released && !combined.aborted, 'release_lease_not_held');
  };
  try {
    const actual = (await query(identity)).rows[0];
    check(actual?.database === database && actual.role === role && actual.session_role === role
      && Number.isSafeInteger(actual.pid) && actual.pid > 0, 'release_lease_identity_invalid');
    pid = actual.pid;
    lockAttempted = true;
    check((await query(`SELECT pg_try_advisory_lock(${key}) locked`)).rows[0]?.locked === true,
      'release_lease_busy');
    acquiredAt = lastHeartbeatAt = performance.now(); active = true; assertHeld();
    timer = setInterval(() => {
      if (pending || released || combined.aborted) return;
      // The old 5 s client timer could beat a ready socket reply after a
      // synchronous Git stall. Allow multi-second stalls; connection events
      // still abort immediately, independently of this query budget.
      pending = query(ownership, 30_000).then(result => {
        const current = result.rows[0];
        if (current?.pid !== pid || current.database !== database || current.role !== role || current.session_role !== role) lost('identity_changed');
        else if (current.locked !== true) lost('lock_not_held');
        else { lastHeartbeatAt = performance.now(); heartbeats++; }
      }).catch(error => lost(error?.message === 'Query read timeout' ? 'heartbeat_timeout' : 'heartbeat_failed', error)).finally(() => { pending = undefined; });
    }, heartbeatMs);
    timer.unref();
    return Object.freeze({ signal: combined, assertHeld, pid, loss: () => loss, async release() {
      if (released) return;
      released = true; clearInterval(timer); await pending;
      try {
        // A cancelled release can still unlock a known healthy session. A lost
        // ownership connection cannot report a confirmed handoff.
        check(!controller.signal.aborted, 'release_lease_lost');
        check((await query(`SELECT pg_advisory_unlock(${key}) unlocked`)).rows[0]?.unlocked === true,
          'release_lease_unlock_failed');
        active = false;
      } catch { controller.abort(fail('release_lease_lost')); throw fail('release_lease_cleanup_failed'); }
      finally {
        client.removeListener('error', connectionError); client.removeListener('end', connectionEnded);
        client.release(controller.signal.aborted);
      }
    } });
  } catch (error) {
    clearInterval(timer);
    // A missing acquisition reply may still have acquired the lock. Destroy
    // every attempted lock session on failure; never return unknown ownership.
    client.removeListener('error', connectionError); client.removeListener('end', connectionEnded);
    client.release(lockAttempted || active || controller.signal.aborted);
    throw error;
  }
}
