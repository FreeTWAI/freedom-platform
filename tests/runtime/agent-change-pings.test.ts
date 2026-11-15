import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createPool } from '../../packages/db/index.js';
import { migrate } from '../../scripts/database.js';
import { seedLocal, DEMO_USERS, DEMO_PASSWORD } from '../../packages/testing/seed.js';
import { createApp } from '../../apps/platform-api/src/app.js';
import {
  AGENT_PING_SUFFIXES,
  PROVIDER_HOSTING_SUFFIXES,
  isProviderHostedUrl,
} from '../../packages/shared/hosted-destination.js';
import {
  AGENT_PING_FORMAT,
  type AgentPingFetch,
  agentPingUrlAllowed,
  buildAgentPing,
  createAgentPingFetch,
  deliverAgentPing,
  signAgentPing,
  sweepAgentPings,
} from '../../modules/client-connections/agent-pings.js';

test('isProviderHostedUrl with AGENT_PING_SUFFIXES enforces provider-hosted HTTPS URLs', () => {
  assert.equal(PROVIDER_HOSTING_SUFFIXES.includes('github.io'), true);
  assert.equal(AGENT_PING_SUFFIXES.includes('github.io'), false);

  for (const accepted of [
    'https://my-agent.example-user.workers.dev/ping',
    'https://tool.pages.dev/hook/v1',
    'https://a.b.netlify.app/',
    'https://app.vercel.app/notify',
  ]) {
    assert.equal(isProviderHostedUrl(accepted, AGENT_PING_SUFFIXES), true, accepted);
  }

  for (const rejected of [
    'https://tool.github.io/ping',
    'https://tool.pages.dev:8443/ping',
    'https://tool.pages.dev:443/ping',
    'https://user:pass@tool.pages.dev/ping',
    'https://@tool.pages.dev/ping',
    'https://tool.pages.dev/ping?foo=1',
    'https://tool.pages.dev/ping#frag',
    'https://Tool.pages.dev/ping',
    'https://127.0.0.1/ping',
    'https://[::1]/ping',
    'https://a.b.c.pages.dev/ping',
    'http://tool.pages.dev/ping',
    'https://example.test/ping',
  ]) {
    assert.equal(isProviderHostedUrl(rejected, AGENT_PING_SUFFIXES), false, rejected);
  }
});

test('signAgentPing reproduces the §2 test vector and buildAgentPing formats §2 body and headers', () => {
  const tokenHash = '1635af5c9afb050b8e187930f09e9aa6838f5e9dc84b0bbd7fa0a5b1220bec02';
  const timestamp = 1794787200;
  const body =
    '{"format":"freedom.agent-ping/v1","ping_id":"00000000-0000-4000-8000-000000000001","connection_id":"00000000-0000-4000-8000-000000000002","test":false}';
  assert.equal(AGENT_PING_FORMAT, 'freedom.agent-ping/v1');
  assert.equal(
    signAgentPing(tokenHash, timestamp, body),
    'v1=9dd83cda92f3492dffbedd6b31314b28caae62e80d187e3cc7b3afc3f102ac62',
  );

  const built = buildAgentPing({
    connectionId: '00000000-0000-4000-8000-000000000002',
    tokenHash,
    test: true,
    now: () => 1794787200_999,
  });
  assert.equal(built.timestamp, 1794787200);
  assert.equal(
    built.body,
    JSON.stringify({
      format: 'freedom.agent-ping/v1',
      ping_id: built.pingId,
      connection_id: '00000000-0000-4000-8000-000000000002',
      test: true,
    }),
  );
  assert.deepEqual(Object.keys(built.headers), [
    'Content-Type',
    'User-Agent',
    'Freedom-Ping-Id',
    'Freedom-Ping-Timestamp',
    'Freedom-Ping-Signature',
  ]);
  assert.equal(built.headers['Content-Type'], 'application/json');
  assert.equal(built.headers['User-Agent'], 'FreedomWorkshop-AgentPing/1');
  assert.equal(built.headers['Freedom-Ping-Id'], built.pingId);
  assert.equal(built.headers['Freedom-Ping-Timestamp'], '1794787200');
  assert.equal(
    built.headers['Freedom-Ping-Signature'],
    signAgentPing(tokenHash, built.timestamp, built.body),
  );
});

test('agentPingUrlAllowed rejects own workshop host and createAgentPingFetch enforces redirect/credentials/cancel', async () => {
  assert.equal(
    agentPingUrlAllowed('https://my-agent.workers.dev/ping', 'https://my-agent.workers.dev'),
    false,
  );
  assert.equal(
    agentPingUrlAllowed('https://sub.freetwai.com/ping', 'https://platform.example.test'),
    false,
  );
  assert.equal(
    agentPingUrlAllowed('https://my-agent.workers.dev/ping', 'https://platform.example.test'),
    true,
  );

  let calls = 0;
  let cancelled = false;
  let capturedInit: RequestInit | undefined;
  const fetcher: typeof fetch = async (_url, init) => {
    calls++;
    capturedInit = init;
    const stream = new ReadableStream({
      cancel() {
        cancelled = true;
      },
    });
    return new Response(stream, { status: 302, headers: { Location: 'https://evil.example/' } });
  };

  const pingFetch = createAgentPingFetch(fetcher);
  await assert.rejects(
    pingFetch('https://tool.github.io/ping', {
      headers: {},
      body: '{}',
      signal: AbortSignal.timeout(1000),
    }),
    /rejected_url/,
  );
  assert.equal(calls, 0);

  const built = buildAgentPing({
    connectionId: '00000000-0000-4000-8000-000000000002',
    tokenHash: '1635af5c9afb050b8e187930f09e9aa6838f5e9dc84b0bbd7fa0a5b1220bec02',
    test: false,
  });
  const outcome302 = await deliverAgentPing(
    pingFetch,
    'https://my-agent.workers.dev/ping',
    built,
    1000,
  );
  assert.equal(calls, 1);
  assert.equal(cancelled, true);
  assert.equal(capturedInit?.method, 'POST');
  assert.equal(capturedInit?.credentials, 'omit');
  assert.equal(capturedInit?.redirect, 'manual');
  assert.equal(
    Object.keys((capturedInit?.headers as Record<string, string>) ?? {}).some(
      k => k.toLowerCase() === 'cookie',
    ),
    false,
  );
  assert.deepEqual(outcome302, { ok: false, status: 302, error: 'redirect' });

  const outcome204 = await deliverAgentPing(
    async () => ({ status: 204 }),
    'https://my-agent.workers.dev/ping',
    built,
    1000,
  );
  assert.deepEqual(outcome204, { ok: true, status: 204, error: null });

  const outcome500 = await deliverAgentPing(
    async () => ({ status: 500 }),
    'https://my-agent.workers.dev/ping',
    built,
    1000,
  );
  assert.deepEqual(outcome500, { ok: false, status: 500, error: 'http_status' });

  const outcomeTimeout = await deliverAgentPing(
    async (_url, init) =>
      new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      }),
    'https://my-agent.workers.dev/ping',
    built,
    10,
  );
  assert.deepEqual(outcomeTimeout, { ok: false, status: 0, error: 'timeout' });

  const outcomeNetwork = await deliverAgentPing(
    async () => {
      throw new TypeError('fetch failed');
    },
    'https://my-agent.workers.dev/ping',
    built,
    1000,
  );
  assert.deepEqual(outcomeNetwork, { ok: false, status: 0, error: 'network' });

  const outcomeRejected = await deliverAgentPing(
    pingFetch,
    'https://tool.github.io/ping',
    built,
    1000,
  );
  assert.deepEqual(outcomeRejected, { ok: false, status: 0, error: 'rejected_url' });
});

const origin = 'http://127.0.0.1:4310';
const dbUrl = process.env.TEST_DATABASE_URL!;
assert.ok(dbUrl?.includes('/fp_'), 'explicit isolated database required');
const schema = `fp_pings_${process.pid}_${Date.now()}`;
const admin = createPool(dbUrl);
const pool = new Pool({ connectionString: dbUrl, options: `-c search_path=${schema}`, max: 12 });
let pingFetchMock: AgentPingFetch = async () => ({ status: 200 });
const app = createApp(pool, origin, 'local', {
  eventParticipationEnabled: true,
  agentPingFetch: (target, init) => pingFetchMock(target, init),
});

before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
});

after(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE communities,login_attempts,auth_rate_limits CASCADE');
  await seedLocal(pool);
});

type Session = { cookie: string; csrf: string; user: any };

async function req(
  path: string,
  opts: { session?: Session; token?: string; body?: unknown; key?: string; method?: string; headers?: Record<string, string> } = {},
) {
  const { session, token, body, key = randomUUID(), method = body === undefined ? 'GET' : 'POST' } = opts;
  const headers: Record<string, string> = {
    ...(session ? { Origin: origin, Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}),
    ...(token ? { Authorization: 'Bearer ' + token } : {}),
    ...opts.headers,
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Idempotency-Key'] = key;
  }
  const response = await app.request(origin + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: (await response.json()) as any, response };
}

async function ready(index = 0): Promise<Session> {
  const r = await req('/api/v1/auth/login', {
    body: { email: DEMO_USERS[index].email, password: DEMO_PASSWORD },
    headers: { Origin: origin },
  });
  assert.equal(r.status, 200);
  const row = (
    await pool.query('UPDATE users SET onboarding_completed_at=now() WHERE user_id=$1 RETURNING community_id', [
      r.data.user.user_id,
    ])
  ).rows[0];
  return {
    cookie: r.response.headers.get('set-cookie')!.split(';')[0],
    csrf: r.data.csrf_token,
    user: { ...r.data.user, community_id: row.community_id },
  };
}

async function issue(session: Session, scopes = ['read', 'share', 'rsvp']) {
  const r = await req('/api/v1/me/agent-tokens', { session, body: { name: '通知測試', scopes } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
}

test('F5: member saves, validates, clears, resets and renews agent ping address while agent token is denied', async () => {
  const owner = await ready(0);
  const other = await ready(1);
  const issued = await issue(owner, ['read']);
  const noRead = await issue(owner, ['share']);
  const revoked = await issue(owner, ['read']);
  await req(`/api/v1/me/agent-tokens/${revoked.connection_id}/revoke`, { session: owner, body: {} });

  // List starts with ping: null
  const list0 = await req('/api/v1/me/agent-tokens', { session: owner });
  assert.equal(list0.status, 200);
  assert.equal(list0.data.items.find((i: any) => i.connection_id === issued.connection_id).ping, null);

  // Agent token gets 403 on the ping endpoint
  const agentDenied = await req(`/api/v1/me/agent-tokens/${issued.connection_id}/ping`, {
    token: issued.access_token,
    body: { notify_url: 'https://my-agent.example-user.workers.dev/ping' },
  });
  assert.equal(agentDenied.status, 403);

  // Another member gets 404
  const foreign = await req(`/api/v1/me/agent-tokens/${issued.connection_id}/ping`, {
    session: other,
    body: { notify_url: 'https://my-agent.example-user.workers.dev/ping' },
  });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.data.code, 'connection_not_found');

  // Key without read gets 409 read_scope_required
  const missingScope = await req(`/api/v1/me/agent-tokens/${noRead.connection_id}/ping`, {
    session: owner,
    body: { notify_url: 'https://my-agent.example-user.workers.dev/ping' },
  });
  assert.equal(missingScope.status, 409);
  assert.equal(missingScope.data.code, 'read_scope_required');

  // Revoked key gets 409 connection_inactive
  const inactive = await req(`/api/v1/me/agent-tokens/${revoked.connection_id}/ping`, {
    session: owner,
    body: { notify_url: 'https://my-agent.example-user.workers.dev/ping' },
  });
  assert.equal(inactive.status, 409);
  assert.equal(inactive.data.code, 'connection_inactive');

  // Rejected URLs (§7 item 2), including own host
  const ownOrigin = 'https://freedom-own.example.workers.dev';
  const ownApp = createApp(pool, ownOrigin, 'staging');
  const ownHostRes = await ownApp.request(`${ownOrigin}/api/v1/me/agent-tokens/${issued.connection_id}/ping`, {
    method: 'POST',
    headers: {
      Origin: ownOrigin,
      Cookie: owner.cookie.replace('freedom_local_session=', '__Host-freedom_session='),
      'X-CSRF-Token': owner.csrf,
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
    },
    body: JSON.stringify({ notify_url: `${ownOrigin}/ping` }),
  });
  assert.equal(ownHostRes.status, 400);
  assert.equal(((await ownHostRes.json()) as any).code, 'ping_url_rejected');
  for (const badUrl of [
    'http://my-agent.example-user.workers.dev/ping',
    'https://127.0.0.1/ping',
    'https://localhost/ping',
    'https://my-agent.example-user.workers.dev/ping?a=1',
    'https://my-agent.example-user.workers.dev/ping#frag',
    'https://my-agent.example-user.workers.dev:8443/ping',
    'https://user:pass@my-agent.example-user.workers.dev/ping',
    'https://evil.example/ping',
    'https://my-agent.github.io/ping',
    'https://sub.freetwai.com/ping',
  ]) {
    const bad = await req(`/api/v1/me/agent-tokens/${issued.connection_id}/ping`, {
      session: owner,
      body: { notify_url: badUrl },
    });
    assert.equal(bad.status, 400, badUrl);
    assert.equal(bad.data.code, 'ping_url_rejected', badUrl);
  }

  // Accepted URL
  const goodUrl = 'https://my-agent.example-user.workers.dev/ping';
  const saved = await req(`/api/v1/me/agent-tokens/${issued.connection_id}/ping`, {
    session: owner,
    body: { notify_url: goodUrl },
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.ping, {
    notify_url: goodUrl,
    last_attempt_at: null,
    last_success_at: null,
    last_status: null,
    last_error: null,
    paused_at: null,
    attempts: 0,
  });

  // List matches view and never exposes token_hash or lease_token
  const list1 = await req('/api/v1/me/agent-tokens', { session: owner });
  const item1 = list1.data.items.find((i: any) => i.connection_id === issued.connection_id);
  assert.deepEqual(item1.ping, saved.data.ping);
  assert.equal('token_hash' in item1.ping, false);
  assert.equal('lease_token' in item1.ping, false);

  // Saving again resets every status field
  await pool.query(
    `UPDATE agent_change_pings SET attempts=5, paused_at=now(), next_attempt_at=now()+interval '1 hour',
     last_attempt_at=now(), last_success_at=now(), last_status=500, last_error='http_status',
     lease_until=now()+interval '2 minutes', lease_token=$2 WHERE connection_id=$1`,
    [issued.connection_id, randomUUID()],
  );
  const resaved = await req(`/api/v1/me/agent-tokens/${issued.connection_id}/ping`, {
    session: owner,
    body: { notify_url: 'https://other-agent.pages.dev/hook' },
  });
  assert.equal(resaved.status, 200);
  assert.deepEqual(resaved.data.ping, {
    notify_url: 'https://other-agent.pages.dev/hook',
    last_attempt_at: null,
    last_success_at: null,
    last_status: null,
    last_error: null,
    paused_at: null,
    attempts: 0,
  });

  // Renewal with read moves the address to the new key and deletes the old row
  const renewed = await req(`/api/v1/me/agent-tokens/${issued.connection_id}/renew`, {
    session: owner,
    body: { name: '續期後', scopes: ['read'] },
  });
  assert.equal(renewed.status, 201);
  const oldRows = await pool.query('SELECT 1 FROM agent_change_pings WHERE connection_id=$1', [
    issued.connection_id,
  ]);
  assert.equal(oldRows.rowCount, 0);
  const list2 = await req('/api/v1/me/agent-tokens', { session: owner });
  assert.equal(
    list2.data.items.find((i: any) => i.connection_id === renewed.data.connection_id).ping?.notify_url,
    'https://other-agent.pages.dev/hook',
  );

  // Renewal without read drops the address
  const renewedNoRead = await req(`/api/v1/me/agent-tokens/${renewed.data.connection_id}/renew`, {
    session: owner,
    body: { name: '僅分享', scopes: ['share'] },
  });
  assert.equal(renewedNoRead.status, 201);
  const afterDrop = await pool.query('SELECT 1 FROM agent_change_pings WHERE connection_id IN ($1,$2)', [
    renewed.data.connection_id,
    renewedNoRead.data.connection_id,
  ]);
  assert.equal(afterDrop.rowCount, 0);

  // Null clears the address
  const fresh = await issue(owner, ['read']);
  await req(`/api/v1/me/agent-tokens/${fresh.connection_id}/ping`, {
    session: owner,
    body: { notify_url: goodUrl },
  });
  const cleared = await req(`/api/v1/me/agent-tokens/${fresh.connection_id}/ping`, {
    session: owner,
    body: { notify_url: null },
  });
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.data, { ping: null });
  const list3 = await req('/api/v1/me/agent-tokens', { session: owner });
  assert.equal(list3.data.items.find((i: any) => i.connection_id === fresh.connection_id).ping, null);
});

test('F6: test ping uses DB URL, resumes on success, keeps backoff on failure, enforces 429 and 503 switch', async () => {
  const owner = await ready(0);
  const other = await ready(1);
  const issued = await issue(owner, ['read']);
  const noRead = await issue(owner, ['share']);
  const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  pingFetchMock = async (target, init) => {
    calls.push({ url: target, headers: init.headers, body: init.body });
    return { status: 200 };
  };

  // Agent token gets 403
  const asAgent = await req(`/api/v1/me/agent-tokens/${issued.connection_id}/ping/test`, {
    token: issued.access_token,
    body: {},
  });
  assert.equal(asAgent.status, 403);

  // Another member gets 404
  const foreign = await req(`/api/v1/me/agent-tokens/${issued.connection_id}/ping/test`, {
    session: other,
    body: {},
  });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.data.code, 'connection_not_found');

  // Key without read gets 409 read_scope_required
  const missingRead = await req(`/api/v1/me/agent-tokens/${noRead.connection_id}/ping/test`, {
    session: owner,
    body: {},
  });
  assert.equal(missingRead.status, 409);
  assert.equal(missingRead.data.code, 'read_scope_required');

  // No saved address -> 409 ping_not_set
  const unset = await req(`/api/v1/me/agent-tokens/${issued.connection_id}/ping/test`, {
    session: owner,
    body: {},
  });
  assert.equal(unset.status, 409);
  assert.equal(unset.data.code, 'ping_not_set');
  assert.equal(calls.length, 0);

  // Save a ping URL and simulate a paused row with prior backoff
  const savedUrl = 'https://my-agent.example-user.workers.dev/ping';
  await req(`/api/v1/me/agent-tokens/${issued.connection_id}/ping`, {
    session: owner,
    body: { notify_url: savedUrl },
  });
  await pool.query(
    `UPDATE agent_change_pings SET attempts=8, paused_at=clock_timestamp()-interval '10 minutes',
     next_attempt_at=clock_timestamp()+interval '1 hour', last_attempt_at=clock_timestamp()-interval '10 minutes',
     last_status=500, last_error='http_status' WHERE connection_id=$1`,
    [issued.connection_id],
  );

  // Strict {} rejects extra fields (like a request-supplied URL)
  const extraBody = await req(`/api/v1/me/agent-tokens/${issued.connection_id}/ping/test`, {
    session: owner,
    body: { notify_url: 'https://evil.workers.dev/steal' },
  });
  assert.equal(extraBody.status, 422);
  assert.equal(calls.length, 0);

  // Failure records only last_* fields and leaves attempts/paused_at/next_attempt_at/last_success_at intact
  pingFetchMock = async (target, init) => {
    calls.push({ url: target, headers: init.headers, body: init.body });
    return { status: 502 };
  };
  const failRes = await req(`/api/v1/me/agent-tokens/${issued.connection_id}/ping/test`, {
    session: owner,
    body: {},
  });
  assert.equal(failRes.status, 200);
  assert.equal(failRes.data.ok, false);
  assert.equal(failRes.data.status, 502);
  assert.equal(failRes.data.error, 'http_status');
  assert.equal(failRes.data.ping.attempts, 8);
  assert.ok(failRes.data.ping.paused_at);
  assert.equal(failRes.data.ping.last_success_at, null);
  assert.equal(failRes.data.ping.last_status, 502);
  assert.equal(failRes.data.ping.last_error, 'http_status');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, savedUrl);
  const parsedFail = JSON.parse(calls[0].body);
  assert.equal(parsedFail.test, true);
  assert.equal(parsedFail.connection_id, issued.connection_id);
  const storedHash = (
    await pool.query('SELECT token_hash FROM agent_token_connections WHERE connection_id=$1', [issued.connection_id])
  ).rows[0].token_hash;
  assert.equal(
    calls[0].headers['freedom-ping-signature'] ?? calls[0].headers['Freedom-Ping-Signature'],
    signAgentPing(storedHash, calls[0].headers['freedom-ping-timestamp'] ?? calls[0].headers['Freedom-Ping-Timestamp'], calls[0].body),
  );

  // Success records last_success_at and resumes the paused row (and repeats work without idempotency replay)
  pingFetchMock = async (target, init) => {
    calls.push({ url: target, headers: init.headers, body: init.body });
    return { status: 204 };
  };
  const okRes = await req(`/api/v1/me/agent-tokens/${issued.connection_id}/ping/test`, {
    session: owner,
    body: {},
  });
  assert.equal(okRes.status, 200);
  assert.equal(okRes.data.ok, true);
  assert.equal(okRes.data.status, 204);
  assert.equal(okRes.data.error, null);
  assert.equal(okRes.data.ping.attempts, 0);
  assert.equal(okRes.data.ping.paused_at, null);
  assert.equal(okRes.data.ping.last_status, 204);
  assert.equal(okRes.data.ping.last_error, null);
  assert.ok(okRes.data.ping.last_success_at);
  assert.ok(okRes.data.ping.last_attempt_at);
  const rowAfter = (
    await pool.query('SELECT next_attempt_at, paused_at, attempts FROM agent_change_pings WHERE connection_id=$1', [
      issued.connection_id,
    ])
  ).rows[0];
  assert.equal(rowAfter.next_attempt_at, null);
  assert.equal(rowAfter.paused_at, null);
  assert.equal(rowAfter.attempts, 0);

  // Disabled switch gives 503 and does not call fetcher
  let disabledCalls = 0;
  const disabledApp = createApp(pool, origin, 'local', {
    agentPingsDisabled: true,
    agentPingFetch: async () => {
      disabledCalls++;
      return { status: 200 };
    },
  });
  const disabledRes = await disabledApp.request(`${origin}/api/v1/me/agent-tokens/${issued.connection_id}/ping/test`, {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: owner.cookie,
      'X-CSRF-Token': owner.csrf,
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
    },
    body: JSON.stringify({}),
  });
  assert.equal(disabledRes.status, 503);
  assert.equal(((await disabledRes.json()) as any).code, 'agent_pings_unavailable');
  assert.equal(disabledCalls, 0);

  // 11th call in an hour gets 429 (owner calls so far: missingRead=1, unset=2, failRes=3, okRes=4; calls 5..10 succeed, 11th -> 429)
  for (let i = 5; i <= 10; i++) {
    const r = await req(`/api/v1/me/agent-tokens/${issued.connection_id}/ping/test`, {
      session: owner,
      body: {},
    });
    assert.equal(r.status, 200, `call ${i}`);
  }
  const rateLimited = await req(`/api/v1/me/agent-tokens/${issued.connection_id}/ping/test`, {
    session: owner,
    body: {},
  });
  assert.equal(rateLimited.status, 429);
});

test('F7: sweeper sends on new change, skips idle/late-commit until committed, and leaves feed intact', async () => {
  const owner = await ready(0);
  const issued = await issue(owner, ['read']);
  const savedUrl = 'https://my-agent.example-user.workers.dev/ping';
  await req(`/api/v1/me/agent-tokens/${issued.connection_id}/ping`, {
    session: owner,
    body: { notify_url: savedUrl },
  });

  const sentRequests: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const fakeSend: AgentPingFetch = async (target, init) => {
    sentRequests.push({ url: target, headers: init.headers, body: init.body });
    return { status: 200 };
  };

  // No change -> no request
  assert.deepEqual(await sweepAgentPings(pool, fakeSend), { claimed: 0, sent: 0, failed: 0 });
  assert.equal(sentRequests.length, 0);

  // One message.received -> one signed ping, pinged_cursor advances
  await pool.query("SELECT record_agent_change($1,$2,'message.received',$3,$4)", [
    owner.user.community_id,
    owner.user.user_id,
    `msg:${randomUUID()}`,
    randomUUID(),
  ]);
  assert.deepEqual(await sweepAgentPings(pool, fakeSend), { claimed: 1, sent: 1, failed: 0 });
  assert.equal(sentRequests.length, 1);
  assert.equal(sentRequests[0].url, savedUrl);
  const body1 = JSON.parse(sentRequests[0].body);
  assert.equal(body1.format, AGENT_PING_FORMAT);
  assert.equal(body1.connection_id, issued.connection_id);
  assert.equal(body1.test, false);
  const storedHash = (
    await pool.query('SELECT token_hash FROM agent_token_connections WHERE connection_id=$1', [issued.connection_id])
  ).rows[0].token_hash;
  assert.equal(
    sentRequests[0].headers['Freedom-Ping-Signature'],
    signAgentPing(storedHash, sentRequests[0].headers['Freedom-Ping-Timestamp'], sentRequests[0].body),
  );
  const after1 = (
    await pool.query('SELECT pinged_cursor::text FROM agent_change_pings WHERE connection_id=$1', [issued.connection_id])
  ).rows[0].pinged_cursor;
  assert.equal(after1, '1');

  // Next sweep sends nothing
  assert.deepEqual(await sweepAgentPings(pool, fakeSend), { claimed: 0, sent: 0, failed: 0 });
  assert.equal(sentRequests.length, 1);

  // Late commit: uncommitted change is invisible to sweep, then visible once committed
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    await tx.query("SELECT record_agent_change($1,$2,'message.received',$3,$4)", [
      owner.user.community_id,
      owner.user.user_id,
      `msg:${randomUUID()}`,
      randomUUID(),
    ]);
    assert.deepEqual(await sweepAgentPings(pool, fakeSend), { claimed: 0, sent: 0, failed: 0 });
    await tx.query('COMMIT');
  } finally {
    tx.release();
  }
  assert.deepEqual(await sweepAgentPings(pool, fakeSend), { claimed: 1, sent: 1, failed: 0 });
  assert.equal(sentRequests.length, 2);
  const after2 = (
    await pool.query('SELECT pinged_cursor::text FROM agent_change_pings WHERE connection_id=$1', [issued.connection_id])
  ).rows[0].pinged_cursor;
  assert.equal(after2, '2');

  // Feed afterwards returns both changes once, in cursor order
  const feed = await req(`/api/v1/agent/events?after=${owner.user.user_id}:0`, { token: issued.access_token });
  assert.equal(feed.status, 200);
  assert.deepEqual(
    feed.data.items.map((item: any) => item.cursor),
    [`${owner.user.user_id}:1`, `${owner.user.user_id}:2`],
  );
});

test('F7: failure classification, backoff, 8-failure pause, test-ping resume, and changed URL no-op', async () => {
  const owner = await ready(0);
  const issued = await issue(owner, ['read']);
  await req(`/api/v1/me/agent-tokens/${issued.connection_id}/ping`, {
    session: owner,
    body: { notify_url: 'https://my-agent.example-user.workers.dev/ping' },
  });
  await pool.query("SELECT record_agent_change($1,$2,'message.received',$3,$4)", [
    owner.user.community_id,
    owner.user.user_id,
    `msg:${randomUUID()}`,
    randomUUID(),
  ]);

  // 1st failure: 500 -> http_status, +1 min backoff
  assert.deepEqual(await sweepAgentPings(pool, async () => ({ status: 500 })), { claimed: 1, sent: 0, failed: 1 });
  let row = (
    await pool.query(
      `SELECT attempts, last_status, last_error, paused_at,
              EXTRACT(EPOCH FROM (next_attempt_at - last_attempt_at)) AS wait_sec
       FROM agent_change_pings WHERE connection_id=$1`,
      [issued.connection_id],
    )
  ).rows[0];
  assert.equal(row.attempts, 1);
  assert.equal(row.last_status, 500);
  assert.equal(row.last_error, 'http_status');
  assert.equal(row.paused_at, null);
  assert.ok(row.wait_sec >= 55 && row.wait_sec <= 65, `1st wait ${row.wait_sec}`);

  // Immediate sweep skips backed-off row
  assert.deepEqual(await sweepAgentPings(pool, async () => ({ status: 200 })), { claimed: 0, sent: 0, failed: 0 });

  // 2nd failure: 302 -> redirect, +5 min backoff
  await pool.query("UPDATE agent_change_pings SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE connection_id=$1", [
    issued.connection_id,
  ]);
  assert.deepEqual(await sweepAgentPings(pool, async () => ({ status: 302 })), { claimed: 1, sent: 0, failed: 1 });
  row = (
    await pool.query(
      `SELECT attempts, last_status, last_error, EXTRACT(EPOCH FROM (next_attempt_at - last_attempt_at)) AS wait_sec
       FROM agent_change_pings WHERE connection_id=$1`,
      [issued.connection_id],
    )
  ).rows[0];
  assert.equal(row.attempts, 2);
  assert.equal(row.last_status, 302);
  assert.equal(row.last_error, 'redirect');
  assert.ok(row.wait_sec >= 295 && row.wait_sec <= 305, `2nd wait ${row.wait_sec}`);

  // 3rd failure: timeout -> status 0, timeout, +15 min backoff
  await pool.query("UPDATE agent_change_pings SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE connection_id=$1", [
    issued.connection_id,
  ]);
  const timeoutSend: AgentPingFetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
  assert.deepEqual(await sweepAgentPings(pool, timeoutSend, { timeoutMs: 25 }), { claimed: 1, sent: 0, failed: 1 });
  row = (
    await pool.query(
      `SELECT attempts, last_status, last_error, EXTRACT(EPOCH FROM (next_attempt_at - last_attempt_at)) AS wait_sec
       FROM agent_change_pings WHERE connection_id=$1`,
      [issued.connection_id],
    )
  ).rows[0];
  assert.equal(row.attempts, 3);
  assert.equal(row.last_status, 0);
  assert.equal(row.last_error, 'timeout');
  assert.ok(row.wait_sec >= 895 && row.wait_sec <= 905, `3rd wait ${row.wait_sec}`);

  // 4th failure: +60 min backoff; 8th failure pauses row
  await pool.query("UPDATE agent_change_pings SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE connection_id=$1", [
    issued.connection_id,
  ]);
  assert.deepEqual(await sweepAgentPings(pool, async () => ({ status: 503 })), { claimed: 1, sent: 0, failed: 1 });
  row = (
    await pool.query(
      `SELECT attempts, EXTRACT(EPOCH FROM (next_attempt_at - last_attempt_at)) AS wait_sec
       FROM agent_change_pings WHERE connection_id=$1`,
      [issued.connection_id],
    )
  ).rows[0];
  assert.equal(row.attempts, 4);
  assert.ok(row.wait_sec >= 3595 && row.wait_sec <= 3605, `4th wait ${row.wait_sec}`);

  await pool.query("UPDATE agent_change_pings SET attempts=7, next_attempt_at=clock_timestamp()-interval '1 second' WHERE connection_id=$1", [
    issued.connection_id,
  ]);
  assert.deepEqual(await sweepAgentPings(pool, async () => ({ status: 500 })), { claimed: 1, sent: 0, failed: 1 });
  row = (
    await pool.query('SELECT attempts, paused_at FROM agent_change_pings WHERE connection_id=$1', [issued.connection_id])
  ).rows[0];
  assert.equal(row.attempts, 8);
  assert.ok(row.paused_at);

  // Paused row is skipped
  await pool.query("UPDATE agent_change_pings SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE connection_id=$1", [
    issued.connection_id,
  ]);
  assert.deepEqual(await sweepAgentPings(pool, async () => ({ status: 200 })), { claimed: 0, sent: 0, failed: 0 });

  // Successful test ping resumes and subsequent sweep delivers the pending change
  pingFetchMock = async () => ({ status: 200 });
  const resumed = await req(`/api/v1/me/agent-tokens/${issued.connection_id}/ping/test`, {
    session: owner,
    body: {},
  });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.data.ping.paused_at, null);
  assert.equal(resumed.data.ping.attempts, 0);
  assert.deepEqual(await sweepAgentPings(pool, async () => ({ status: 200 })), { claimed: 1, sent: 1, failed: 0 });

  // Changed URL while sweep is in flight makes in-flight record a no-op
  await pool.query("SELECT record_agent_change($1,$2,'message.received',$3,$4)", [
    owner.user.community_id,
    owner.user.user_id,
    `msg:${randomUUID()}`,
    randomUUID(),
  ]);
  let inFlightEntered!: () => void;
  let releaseInFlight!: () => void;
  const enteredPromise = new Promise<void>(r => {
    inFlightEntered = r;
  });
  const gatePromise = new Promise<void>(r => {
    releaseInFlight = r;
  });
  const sweepPromise = sweepAgentPings(pool, async () => {
    inFlightEntered();
    await gatePromise;
    return { status: 500 };
  });
  await enteredPromise;
  const changed = await req(`/api/v1/me/agent-tokens/${issued.connection_id}/ping`, {
    session: owner,
    body: { notify_url: 'https://new-agent.vercel.app/hook' },
  });
  assert.equal(changed.status, 200);
  releaseInFlight();
  await sweepPromise;
  const afterChange = (
    await pool.query(
      'SELECT notify_url, attempts, last_status, last_error, lease_token FROM agent_change_pings WHERE connection_id=$1',
      [issued.connection_id],
    )
  ).rows[0];
  assert.equal(afterChange.notify_url, 'https://new-agent.vercel.app/hook');
  assert.equal(afterChange.attempts, 0);
  assert.equal(afterChange.last_status, null);
  assert.equal(afterChange.last_error, null);
  assert.equal(afterChange.lease_token, null);
});

test('F7: revoked, expired, suspended, no-read, inactive user and onboarding-pending are never pinged; renewal re-signs', async () => {
  const owner = await ready(0);
  const kRevoked = await issue(owner, ['read']);
  const kExpired = await issue(owner, ['read']);
  const kSuspended = await issue(owner, ['read']);
  const kNoRead = await issue(owner, ['read']);
  const kLive = await issue(owner, ['read']);

  for (const k of [kRevoked, kExpired, kSuspended, kNoRead, kLive]) {
    await req(`/api/v1/me/agent-tokens/${k.connection_id}/ping`, {
      session: owner,
      body: { notify_url: `https://agent-${k.connection_id.slice(0, 8)}.workers.dev/ping` },
    });
  }
  await req(`/api/v1/me/agent-tokens/${kRevoked.connection_id}/revoke`, { session: owner, body: {} });
  await pool.query("UPDATE agent_token_connections SET expires_at=clock_timestamp()-interval '1 minute' WHERE connection_id=$1", [
    kExpired.connection_id,
  ]);
  await pool.query('UPDATE agent_token_connections SET suspended_at=clock_timestamp() WHERE connection_id=$1', [
    kSuspended.connection_id,
  ]);
  await pool.query("UPDATE agent_token_connections SET scopes='{share}' WHERE connection_id=$1", [kNoRead.connection_id]);

  // Onboarding-pending user blocks live key
  await pool.query('UPDATE users SET onboarding_required=true, onboarding_completed_at=NULL WHERE user_id=$1', [
    owner.user.user_id,
  ]);
  await pool.query("SELECT record_agent_change($1,$2,'message.received',$3,$4)", [
    owner.user.community_id,
    owner.user.user_id,
    `msg:${randomUUID()}`,
    randomUUID(),
  ]);
  assert.deepEqual(await sweepAgentPings(pool, async () => ({ status: 200 })), { claimed: 0, sent: 0, failed: 0 });

  // Restoring onboarding lets only kLive run; renew kLive first and prove new hash signs
  await pool.query('UPDATE users SET onboarding_completed_at=now() WHERE user_id=$1', [owner.user.user_id]);
  const renewed = await req(`/api/v1/me/agent-tokens/${kLive.connection_id}/renew`, {
    session: owner,
    body: { name: '續期後', scopes: ['read'] },
  });
  assert.equal(renewed.status, 201);

  const seen: Array<{ headers: Record<string, string>; body: string }> = [];
  const res = await sweepAgentPings(pool, async (_url, init) => {
    seen.push({ headers: init.headers, body: init.body });
    return { status: 200 };
  });
  assert.deepEqual(res, { claimed: 1, sent: 1, failed: 0 });
  assert.equal(seen.length, 1);
  assert.equal(JSON.parse(seen[0].body).connection_id, renewed.data.connection_id);
  const hashes = (
    await pool.query('SELECT connection_id, token_hash FROM agent_token_connections WHERE connection_id IN ($1,$2)', [
      kLive.connection_id,
      renewed.data.connection_id,
    ])
  ).rows;
  const newHash = hashes.find(r => r.connection_id === renewed.data.connection_id).token_hash;
  const oldHash = hashes.find(r => r.connection_id === kLive.connection_id).token_hash;
  assert.equal(
    seen[0].headers['Freedom-Ping-Signature'],
    signAgentPing(newHash, seen[0].headers['Freedom-Ping-Timestamp'], seen[0].body),
  );
  assert.notEqual(
    seen[0].headers['Freedom-Ping-Signature'],
    signAgentPing(oldHash, seen[0].headers['Freedom-Ping-Timestamp'], seen[0].body),
  );

  // Inactive user blocks live key
  const other = await ready(1);
  const kOther = await issue(other, ['read']);
  await req(`/api/v1/me/agent-tokens/${kOther.connection_id}/ping`, {
    session: other,
    body: { notify_url: 'https://inactive-agent.workers.dev/ping' },
  });
  await pool.query('UPDATE users SET active=false WHERE user_id=$1', [other.user.user_id]);
  await pool.query("SELECT record_agent_change($1,$2,'message.received',$3,$4)", [
    other.user.community_id,
    other.user.user_id,
    `msg:${randomUUID()}`,
    randomUUID(),
  ]);
  assert.deepEqual(await sweepAgentPings(pool, async () => ({ status: 200 })), { claimed: 0, sent: 0, failed: 0 });
});

test('F7: limits 10 pings per sweep for 12 due rows and concurrent sweeps ping each row once', async () => {
  const owner = await ready(0);
  const keys = [];
  for (let i = 0; i < 12; i++) {
    const k = await issue(owner, ['read']);
    await req(`/api/v1/me/agent-tokens/${k.connection_id}/ping`, {
      session: owner,
      body: { notify_url: `https://agent-${i}.example-user.workers.dev/ping` },
    });
    keys.push(k);
  }
  await pool.query("SELECT record_agent_change($1,$2,'message.received',$3,$4)", [
    owner.user.community_id,
    owner.user.user_id,
    `msg:${randomUUID()}`,
    randomUUID(),
  ]);

  const batch1 = await sweepAgentPings(pool, async () => ({ status: 200 }));
  assert.deepEqual(batch1, { claimed: 10, sent: 10, failed: 0 });
  const batch2 = await sweepAgentPings(pool, async () => ({ status: 200 }));
  assert.deepEqual(batch2, { claimed: 2, sent: 2, failed: 0 });
  const batch3 = await sweepAgentPings(pool, async () => ({ status: 200 }));
  assert.deepEqual(batch3, { claimed: 0, sent: 0, failed: 0 });

  // Concurrent sweeps with 50ms delay ping one due row exactly once
  await pool.query('DELETE FROM agent_change_pings WHERE connection_id <> $1', [keys[0].connection_id]);
  await pool.query("SELECT record_agent_change($1,$2,'message.received',$3,$4)", [
    owner.user.community_id,
    owner.user.user_id,
    `msg:${randomUUID()}`,
    randomUUID(),
  ]);
  let slowCalls = 0;
  const slowSend: AgentPingFetch = async () => {
    slowCalls++;
    await new Promise(r => setTimeout(r, 50));
    return { status: 200 };
  };
  const [r1, r2] = await Promise.all([sweepAgentPings(pool, slowSend), sweepAgentPings(pool, slowSend)]);
  assert.equal(slowCalls, 1);
  assert.equal(r1.claimed + r2.claimed, 1);
  assert.equal(r1.sent + r2.sent, 1);
});
