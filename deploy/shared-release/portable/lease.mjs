import { requireRelease as check } from '../admission.mjs';

// Same lock namespace as the installed daily/legacy recovery operators.
const key = "hashtextextended('freedom.daily.recovery.'||current_database(),0)";
const identity = 'SELECT current_database() database,current_user role,session_user session_role,pg_backend_pid() pid';
const fail = code => Object.assign(new Error(code), { code });

/** A dedicated database session spans backup, migration, deployment and cleanup. */
export async function acquireReleaseLease(pool, { database, role, signal, heartbeatMs = 20_000 }) {
  check([database, role].every(value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(value))
    && Number.isSafeInteger(heartbeatMs) && heartbeatMs >= 50 && heartbeatMs <= 20_000,
  'release_lease_target_invalid');
  signal?.throwIfAborted();
  const client = await pool.connect(), controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let timer, active = false, released = false, pending, pid;
  const query = text => client.query({ text, query_timeout: 5000 });
  const lost = () => { controller.abort(fail('release_lease_lost')); };
  client.on('error', lost); client.on('end', lost);
  const assertHeld = () => {
    check(active && !released && !combined.aborted, 'release_lease_not_held');
  };
  try {
    const actual = (await query(identity)).rows[0];
    check(actual?.database === database && actual.role === role && actual.session_role === role
      && Number.isSafeInteger(actual.pid) && actual.pid > 0, 'release_lease_identity_invalid');
    pid = actual.pid;
    check((await query(`SELECT pg_try_advisory_lock(${key}) locked`)).rows[0]?.locked === true,
      'release_lease_busy');
    active = true; assertHeld();
    timer = setInterval(() => {
      if (pending || released || combined.aborted) return;
      pending = query(identity).then(result => {
        const current = result.rows[0];
        if (current?.pid !== pid || current.database !== database || current.role !== role || current.session_role !== role) lost();
      }).catch(lost).finally(() => { pending = undefined; });
    }, heartbeatMs);
    timer.unref();
    return Object.freeze({ signal: combined, assertHeld, pid, async release() {
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
        client.removeListener('error', lost); client.removeListener('end', lost);
        client.release(controller.signal.aborted);
      }
    } });
  } catch (error) {
    clearInterval(timer);
    // If cancellation followed successful lock acquisition, destroy this session
    // rather than returning a session-level advisory lock to the pool.
    client.removeListener('error', lost); client.removeListener('end', lost);
    client.release(active || controller.signal.aborted);
    throw error;
  }
}
