import { createHmac, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { command, type Command } from '../../packages/db/index.js';
import { readWithMemberSession } from '../../packages/db/member-session.js';
import { transaction } from '../../packages/db/transaction.js';
import { AGENT_PING_SUFFIXES, isProviderHostedUrl } from '../../packages/shared/hosted-destination.js';
import { requireCondition } from '../../packages/shared/problem.js';
import { isOwnWorkshopHost } from '../../packages/shared/share-url.js';
import { authRateLimit } from '../identity-membership/members.js';
import type { Actor } from '../identity-membership/service.js';
import { assignAgentChangeCursors, lockAgentChangeCursor } from './agent-feed.js';

/**
 * Signed wake-up pings for member agent connections (protocol `freedom.agent-ping/v1`).
 *
 * D2: The HMAC-SHA256 signing key is the ASCII text of the stored `token_hash`
 * (the 64-character lowercase hex SHA-256 of the member's `fw_agent_` token).
 * A database reader could forge a ping, which carries no member data and grants
 * nothing: it can only cause the agent to poll the feed with its own key.
 */
export const AGENT_PING_FORMAT = 'freedom.agent-ping/v1';

/** Shared JSONB view projection so list, save, and test ping formats stay identical. */
export const AGENT_PING_VIEW_SQL = `jsonb_build_object('notify_url',p.notify_url,'last_attempt_at',p.last_attempt_at,'last_success_at',p.last_success_at,'last_status',p.last_status,'last_error',p.last_error,'paused_at',p.paused_at,'attempts',p.attempts)`;

export type AgentPingError = 'timeout' | 'network' | 'redirect' | 'http_status' | 'rejected_url';

export type AgentPingFetch = (
  url: string,
  init: { headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ status: number }>;

export interface BuiltAgentPing {
  url?: string;
  headers: Record<string, string>;
  body: string;
  pingId: string;
  timestamp: number;
}

export interface AgentPingSendOutcome {
  ok: boolean;
  status: number;
  error: AgentPingError | null;
}

/** Sign `freedom.agent-ping/v1\n<timestamp>\n<body>` with HMAC-SHA256 using `tokenHash`. */
export function signAgentPing(
  tokenHash: string,
  timestamp: number | string,
  body: string,
): string {
  const mac = createHmac('sha256', tokenHash)
    .update(`${AGENT_PING_FORMAT}\n${timestamp}\n${body}`)
    .digest('hex');
  return `v1=${mac}`;
}

/** Validate an agent wake-up ping URL against provider-hosted HTTPS rules and the platform host. */
export function agentPingUrlAllowed(raw: string, publicOrigin = ''): boolean {
  if (typeof raw !== 'string' || raw.length < 12 || raw.length > 2048) return false;
  if (!isProviderHostedUrl(raw, AGENT_PING_SUFFIXES)) return false;
  return !isOwnWorkshopHost(new URL(raw).hostname, publicOrigin);
}

/** Build the JSON body and signed headers for one wake-up ping request. */
export function buildAgentPing(input: {
  url?: string;
  connectionId: string;
  tokenHash: string;
  test: boolean;
  now?: () => number;
}): BuiltAgentPing {
  const pingId = randomUUID();
  const timestamp = Math.floor((input.now ?? Date.now)() / 1000);
  const body = JSON.stringify({
    format: AGENT_PING_FORMAT,
    ping_id: pingId,
    connection_id: input.connectionId,
    test: Boolean(input.test),
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'FreedomWorkshop-AgentPing/1',
    'Freedom-Ping-Id': pingId,
    'Freedom-Ping-Timestamp': String(timestamp),
    'Freedom-Ping-Signature': signAgentPing(input.tokenHash, timestamp, body),
  };
  return input.url !== undefined
    ? { url: input.url, headers, body, pingId, timestamp }
    : { headers, body, pingId, timestamp };
}

/** Wrap a Fetch implementation to enforce ping URL checks, manual redirects, and no credentials. */
export function createAgentPingFetch(
  fetcher: typeof fetch = globalThis.fetch,
  publicOrigin = '',
): AgentPingFetch {
  return async (url, init) => {
    if (!agentPingUrlAllowed(url, publicOrigin)) throw new Error('rejected_url');
    const response = await fetcher(url, {
      method: 'POST',
      headers: init.headers,
      body: init.body,
      credentials: 'omit',
      redirect: 'manual',
      signal: init.signal,
    });
    try {
      await response.body?.cancel();
    } catch {
      // Ignore stream cancellation failures after receiving status.
    }
    return { status: response.status };
  };
}

function isTimeoutAbort(err: unknown, signal: AbortSignal): boolean {
  if (err instanceof Error && err.name === 'TimeoutError') return true;
  return signal.aborted && (signal.reason as { name?: string } | undefined)?.name === 'TimeoutError';
}

/** Send one built ping and classify the outcome into `freedom.agent-ping/v1` result codes. */
export async function deliverAgentPing(
  send: AgentPingFetch,
  url: string,
  ping: { headers: Record<string, string>; body: string },
  timeoutMs = 5000,
  publicOrigin = '',
): Promise<AgentPingSendOutcome> {
  if (!agentPingUrlAllowed(url, publicOrigin)) {
    return { ok: false, status: 0, error: 'rejected_url' };
  }
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const { status } = await send(url, {
      headers: ping.headers,
      body: ping.body,
      signal,
    });
    if (status >= 200 && status <= 299) return { ok: true, status, error: null };
    if (status >= 300 && status <= 399) return { ok: false, status, error: 'redirect' };
    const clamped = Number.isInteger(status) && status >= 0 && status <= 599 ? status : 0;
    return { ok: false, status: clamped, error: 'http_status' };
  } catch (err) {
    if (err instanceof Error && err.message === 'rejected_url') {
      return { ok: false, status: 0, error: 'rejected_url' };
    }
    if (isTimeoutAbort(err, signal)) {
      return { ok: false, status: 0, error: 'timeout' };
    }
    return { ok: false, status: 0, error: 'network' };
  }
}

const setPingBodySchema = z.object({ notify_url: z.string().nullable() }).strict();

/** Save or clear a member agent key's optional wake-up ping URL. */
export async function setAgentPing(
  pool: Pool,
  input: Command,
  id: string,
  publicOrigin = '',
) {
  requireCondition(!input.actor.agent, 403, 'browser_required', '請在瀏覽器管理 Agent 金鑰。');
  z.uuid().parse(id);
  const body = setPingBodySchema.parse(input.body);
  let conn: {
    scopes: string[];
    revoked_at: Date | null;
    suspended_at: Date | null;
    expired: boolean;
  } | undefined;
  return command(
    pool,
    input,
    async q => {
      conn = (
        await q.query(
          `SELECT scopes,revoked_at,suspended_at,expires_at<=clock_timestamp() AS expired
           FROM agent_token_connections
           WHERE connection_id=$1 AND user_id=$2 AND community_id=$3 AND kind='agent'
           FOR UPDATE`,
          [id, input.actor.user_id, input.actor.community_id],
        )
      ).rows[0];
      requireCondition(conn, 404, 'connection_not_found', '找不到這個連線。');
    },
    async q => {
      if (body.notify_url === null) {
        await q.query('DELETE FROM agent_change_pings WHERE connection_id=$1', [id]);
        return { ping: null };
      }
      requireCondition(
        !conn!.revoked_at && !conn!.suspended_at && !conn!.expired,
        409,
        'connection_inactive',
        '這把金鑰已撤銷、停用或到期。',
      );
      requireCondition(
        Array.isArray(conn!.scopes) && conn!.scopes.includes('read'),
        409,
        'read_scope_required',
        '這把金鑰需要「讀取」權限才能接收通知。',
      );
      requireCondition(
        agentPingUrlAllowed(body.notify_url, publicOrigin),
        400,
        'ping_url_rejected',
        '請使用 workers.dev、pages.dev、netlify.app 或 vercel.app 的 HTTPS 網址（不含 ? 或 #）。',
      );
      const row = (
        await q.query(
          `INSERT INTO agent_change_pings AS p(connection_id,community_id,user_id,notify_url,pinged_cursor)
           VALUES($1,$2,$3,$4,COALESCE((SELECT last_cursor FROM agent_change_cursors WHERE user_id=$3),0))
           ON CONFLICT(connection_id) DO UPDATE SET
            notify_url=EXCLUDED.notify_url,
            attempts=0,
            next_attempt_at=NULL,
            paused_at=NULL,
            lease_until=NULL,
            lease_token=NULL,
            last_attempt_at=NULL,
            last_success_at=NULL,
            last_status=NULL,
            last_error=NULL,
            updated_at=clock_timestamp()
           RETURNING ${AGENT_PING_VIEW_SQL} AS ping`,
          [id, input.actor.community_id, input.actor.user_id, body.notify_url],
        )
      ).rows[0];
      return { ping: row.ping };
    },
  );
}

export interface TestAgentPingOptions {
  publicOrigin?: string;
  disabled?: boolean;
  timeoutMs?: number;
  now?: () => number;
}

/** Send one synchronous test ping to the saved DB notify_url, rate-limited per member. */
export async function testAgentPing(
  pool: Pool,
  actor: Actor,
  id: string,
  send: AgentPingFetch,
  options: TestAgentPingOptions = {},
) {
  requireCondition(!actor.agent, 403, 'browser_required', '請在瀏覽器管理 Agent 金鑰。');
  z.uuid().parse(id);
  requireCondition(!options.disabled, 503, 'agent_pings_unavailable', '變更通知暫停服務，請稍後再試。');
  await authRateLimit(pool, 'agent-ping-test', actor.user_id, 10, 3600);
  const target = await readWithMemberSession(pool, actor, async q => {
    const row = (
      await q.query(
        `SELECT c.scopes, c.revoked_at, c.suspended_at, c.expires_at<=clock_timestamp() AS expired,
                c.token_hash, p.notify_url
         FROM agent_token_connections c
         LEFT JOIN agent_change_pings p ON p.connection_id=c.connection_id
         WHERE c.connection_id=$1 AND c.user_id=$2 AND c.community_id=$3 AND c.kind='agent'`,
        [id, actor.user_id, actor.community_id],
      )
    ).rows[0];
    requireCondition(row, 404, 'connection_not_found', '找不到這個連線。');
    requireCondition(
      !row.revoked_at && !row.suspended_at && !row.expired,
      409,
      'connection_inactive',
      '這把金鑰已撤銷、停用或到期。',
    );
    requireCondition(
      Array.isArray(row.scopes) && row.scopes.includes('read'),
      409,
      'read_scope_required',
      '這把金鑰需要「讀取」權限才能接收通知。',
    );
    requireCondition(row.notify_url, 409, 'ping_not_set', '請先儲存通知網址。');
    return { notify_url: row.notify_url as string, token_hash: row.token_hash as string };
  });

  const built = buildAgentPing({
    connectionId: id,
    tokenHash: target.token_hash,
    test: true,
    now: options.now,
  });
  const outcome = await deliverAgentPing(
    send,
    target.notify_url,
    built,
    options.timeoutMs ?? 5000,
    options.publicOrigin ?? '',
  );

  const updated = outcome.ok
    ? await pool.query(
        `UPDATE agent_change_pings AS p
         SET last_attempt_at=clock_timestamp(),
             last_success_at=clock_timestamp(),
             last_status=$3,
             last_error=NULL,
             attempts=0,
             next_attempt_at=NULL,
             paused_at=NULL,
             updated_at=clock_timestamp()
         WHERE p.connection_id=$1 AND p.notify_url=$2
         RETURNING ${AGENT_PING_VIEW_SQL} AS ping`,
        [id, target.notify_url, outcome.status],
      )
    : await pool.query(
        `UPDATE agent_change_pings AS p
         SET last_attempt_at=clock_timestamp(),
             last_status=$3,
             last_error=$4,
             updated_at=clock_timestamp()
         WHERE p.connection_id=$1 AND p.notify_url=$2
         RETURNING ${AGENT_PING_VIEW_SQL} AS ping`,
        [id, target.notify_url, outcome.status, outcome.error],
      );
  const ping =
    updated.rows[0]?.ping ??
    (
      await pool.query(
        `SELECT ${AGENT_PING_VIEW_SQL} AS ping FROM agent_change_pings p WHERE p.connection_id=$1`,
        [id],
      )
    ).rows[0]?.ping ??
    null;
  return { ok: outcome.ok, status: outcome.status, error: outcome.error, ping };
}

export interface SweepAgentPingsOptions {
  limit?: number;
  timeoutMs?: number;
  now?: () => number;
  publicOrigin?: string;
}

/** Claim due ping subscriptions, assign pending feed cursors, send concurrently, and record fenced outcomes. */
export async function sweepAgentPings(
  pool: Pool,
  send: AgentPingFetch,
  { limit = 10, timeoutMs = 5000, now = Date.now, publicOrigin = '' }: SweepAgentPingsOptions = {},
): Promise<{ claimed: number; sent: number; failed: number }> {
  const leaseToken = randomUUID();
  const claimedRows = (
    await pool.query<{
      connection_id: string;
      user_id: string;
      community_id: string;
      notify_url: string;
      pinged_cursor: string;
      token_hash: string;
    }>(
      `UPDATE agent_change_pings p SET lease_until=clock_timestamp()+interval '2 minutes',lease_token=$1
       FROM (
        SELECT d.connection_id,c.token_hash FROM agent_change_pings d
        JOIN agent_token_connections c ON c.connection_id=d.connection_id AND c.user_id=d.user_id AND c.community_id=d.community_id
        JOIN users u ON u.user_id=c.user_id AND u.community_id=c.community_id
        WHERE d.paused_at IS NULL AND (d.next_attempt_at IS NULL OR d.next_attempt_at<=clock_timestamp())
         AND (d.lease_until IS NULL OR d.lease_until<=clock_timestamp())
         AND c.kind='agent' AND c.revoked_at IS NULL AND c.suspended_at IS NULL AND c.expires_at>clock_timestamp() AND 'read'=ANY(c.scopes)
         AND u.active AND (NOT u.onboarding_required OR u.onboarding_completed_at IS NOT NULL)
         AND (EXISTS(SELECT 1 FROM agent_change_events e WHERE e.user_id=d.user_id AND e.community_id=d.community_id AND e.cursor IS NULL)
          OR EXISTS(SELECT 1 FROM agent_change_events e WHERE e.user_id=d.user_id AND e.community_id=d.community_id AND e.cursor>d.pinged_cursor))
        ORDER BY d.next_attempt_at NULLS FIRST,d.connection_id LIMIT $2
        FOR UPDATE OF d SKIP LOCKED
       ) due WHERE p.connection_id=due.connection_id
       RETURNING p.connection_id,p.user_id,p.community_id,p.notify_url,p.pinged_cursor::text AS pinged_cursor,due.token_hash`,
      [leaseToken, limit],
    )
  ).rows;
  if (claimedRows.length === 0) return { claimed: 0, sent: 0, failed: 0 };

  const ready: Array<{
    connection_id: string;
    notify_url: string;
    end: string;
    built: BuiltAgentPing;
  }> = [];
  for (const row of claimedRows) {
    const { end } = await transaction(pool, async q => {
      const last = await lockAgentChangeCursor(q, row.user_id);
      return assignAgentChangeCursors(q, row.user_id, row.community_id, last);
    });
    if (BigInt(end) <= BigInt(row.pinged_cursor)) {
      await pool.query(
        'UPDATE agent_change_pings SET lease_until=NULL,lease_token=NULL WHERE connection_id=$1 AND lease_token=$2',
        [row.connection_id, leaseToken],
      );
      continue;
    }
    ready.push({
      connection_id: row.connection_id,
      notify_url: row.notify_url,
      end,
      built: buildAgentPing({
        connectionId: row.connection_id,
        tokenHash: row.token_hash,
        test: false,
        now,
      }),
    });
  }

  let sent = 0;
  let failed = 0;
  const settled = await Promise.allSettled(
    ready.map(async item => {
      const outcome = await deliverAgentPing(send, item.notify_url, item.built, timeoutMs, publicOrigin);
      if (outcome.ok) {
        await pool.query(
          `UPDATE agent_change_pings SET pinged_cursor=GREATEST(pinged_cursor,$3::bigint),attempts=0,next_attempt_at=NULL,
            last_attempt_at=clock_timestamp(),last_success_at=clock_timestamp(),last_status=$4,last_error=NULL,
            lease_until=NULL,lease_token=NULL,updated_at=clock_timestamp() WHERE connection_id=$1 AND lease_token=$2`,
          [item.connection_id, leaseToken, item.end, outcome.status],
        );
        sent++;
      } else {
        await pool.query(
          `UPDATE agent_change_pings SET attempts=attempts+1,
            next_attempt_at=clock_timestamp()+make_interval(mins=>(ARRAY[1,5,15,60])[LEAST(attempts+1,4)]),
            paused_at=CASE WHEN attempts+1>=8 THEN clock_timestamp() ELSE paused_at END,
            last_attempt_at=clock_timestamp(),last_status=$3,last_error=$4,lease_until=NULL,lease_token=NULL,updated_at=clock_timestamp()
            WHERE connection_id=$1 AND lease_token=$2`,
          [item.connection_id, leaseToken, outcome.status, outcome.error],
        );
        failed++;
      }
    }),
  );
  for (const result of settled) {
    if (result.status === 'rejected') throw result.reason;
  }
  return { claimed: claimedRows.length, sent, failed };
}
