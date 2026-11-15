import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerGuildToolFetch } from '../../apps/platform-api/src/worker-guild-tool-fetch.js';
import { inspectTool } from '../../modules/guild-tools/validation.js';
import { verifyOriginChallenge } from '../../modules/guild-tools/origin-proof.js';
import { BRIDGE_VERSION } from '../../modules/guild-tools/contract.js';
import type { Pool } from 'pg';
import type { Actor } from '../../modules/identity-membership/service.js';
import { randomUUID } from 'node:crypto';

const input = { tool_id: 'example', title: '工具', entry_url: 'https://tool.pages.dev/', bridge_version: BRIDGE_VERSION,
  profile: 'sandboxed', scopes: ['context:read'], permissions: [] };
const platform = 'https://platform.example.test';

test('Worker rejects hostile raw origins before any fetch', async () => {
  let calls = 0;
  const transport = createWorkerGuildToolFetch(async () => { calls++; return new Response(''); });
  for (const url of [
    'https://example.test/', 'https://github.io/', 'https://pages.dev/',
    'https://a.b.github.io/', 'https://a.b.c.pages.dev/', 'https://tool.pages.dev.evil.test/',
    'https://127.0.0.1/', 'https://2130706433/', 'https://0x7f000001/', 'https://[::1]/',
    'https://tool.pages.dev:443/', 'https://tool.pages.dev:8443/', 'https://tool.pages.dev:/',
    'https://user:pass@tool.pages.dev/', 'https://@tool.pages.dev/',
    'http://tool.pages.dev/', 'HTTPS://tool.pages.dev/', 'https://Tool.pages.dev/', 'https://tool.Pages.dev/',
    `https://${'a'.repeat(64)}.pages.dev/`, `https://${'a.'.repeat(130)}pages.dev/`,
    'https://-tool.pages.dev/', 'https://tool-.pages.dev/', 'https://tool_name.pages.dev/',
    'https://tool..pages.dev/', 'https://tool.pages.dev./', 'https://%74ool.pages.dev/',
    'https://工具.pages.dev/', 'https://tool.pages.dev\\@evil.test/', 'https://tool.pages.dev/\n',
    ' https://tool.pages.dev/', 'https://tool.pages.dev/?secret=value', 'https://tool.pages.dev/#secret',
  ]) await assert.rejects(transport(url), /tool_destination_rejected/, url);
  assert.equal(calls, 0);
});

test('Worker permits only hosting shapes, anonymous GET and the inspection headers', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const transport = createWorkerGuildToolFetch(async (url, init) => {
    calls.push({ url: String(url), init: init! }); return new Response('');
  });
  for (const host of ['tool.github.io', 'tool.pages.dev', 'a1b2c3.tool.pages.dev', 'a-b.pages.dev', 'a.pages.dev']) {
    await transport('https://' + host + '/Tool/', { headers: { Accept: 'text/plain', Cookie: 'private', Authorization: 'private', 'X-Secret': 'private' }, credentials: 'include', redirect: 'follow', body: 'ignored' });
  }
  for (const { init } of calls) {
    assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'manual');
    assert.equal(init.body, undefined);
    assert.deepEqual(Object.fromEntries(new Headers(init.headers)), { accept: 'text/plain', 'accept-encoding': 'identity' });
    assert.ok(init.signal);
  }
  const count = calls.length;
  await assert.rejects(transport(input.entry_url, { method: 'POST' }));
  await assert.rejects(transport(input.entry_url, { headers: { Accept: 'application/json' } }));
  const abort = new AbortController(); abort.abort();
  await assert.rejects(transport(input.entry_url, { signal: abort.signal }));
  assert.equal(calls.length, count);
});

test('Worker refuses every redirect without a second request and cancels its body', async () => {
  for (const status of [301, 302, 303, 304, 307, 308, 399]) {
    let calls = 0, cancelled = false;
    const transport = createWorkerGuildToolFetch(async () => {
      calls++;
      return new Response(status === 304 ? null : new ReadableStream({ cancel() { cancelled = true; } }),
        { status, headers: { location: 'http://127.0.0.1/' } });
    });
    await assert.rejects(transport(input.entry_url), /tool_redirect_rejected/);
    assert.equal(calls, 1); assert.equal(cancelled, status !== 304);
  }
});

test('shared HTML inspection still rejects non-HTML and all framing denials and cancels bodies', async () => {
  for (const headers of [
    { 'content-type': 'application/json' },
    { 'content-type': 'text/html', 'x-frame-options': 'SAMEORIGIN' },
    { 'content-type': 'text/html', 'content-security-policy': "frame-ancestors 'none'" },
  ] as Record<string,string>[]) {
    let cancelled = false;
    const transport = createWorkerGuildToolFetch(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers }));
    await assert.rejects(inspectTool(input, platform, transport));
    assert.equal(cancelled, true);
  }
  let cancelled = false;
  const transport = createWorkerGuildToolFetch(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/html' } }));
  assert.equal((await inspectTool(input, platform, transport)).origin, 'https://tool.pages.dev');
  assert.equal(cancelled, true);
});

test('origin proof cuts off streaming bodies above the existing 256-byte limit', async () => {
  let cancelled = false, pulls = 0;
  const transport = createWorkerGuildToolFetch(async () => new Response(new ReadableStream({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(257)); },
    cancel() { cancelled = true; },
  })));
  const pool = { query: async () => ({ rows: [{ token: 'expected' }] }) } as unknown as Pool;
  const actor = { user_id: randomUUID(), community_id: randomUUID() } as Actor;
  await assert.rejects(verifyOriginChallenge(pool, actor, 'guild_games', 'https://tool.pages.dev', randomUUID(), transport),
    (error: any) => error.code === 'origin_proof_failed');
  assert.equal(cancelled, true); assert.ok(pulls <= 2);
});

test('Worker carries the shared inspection deadline into fetch and body reads', async () => {
  let signal: AbortSignal | null | undefined;
  const transport = createWorkerGuildToolFetch(async (_url, init) => {
    signal = init?.signal;
    return new Response('', { headers: { 'content-type': 'text/html' } });
  });
  await inspectTool(input, platform, transport);
  assert.ok(signal); assert.equal(signal.aborted, false);
  const controller = new AbortController();
  const waiting = createWorkerGuildToolFetch(async (_url, init) => new Response(new ReadableStream({
    start(stream) { init!.signal!.addEventListener('abort', () => stream.error(new Error('aborted')), { once: true }); },
  })));
  const response = await waiting(input.entry_url, { signal: controller.signal });
  const read = response.text(); controller.abort(); await assert.rejects(read, /aborted/);
});

test('I3: Worker follows up to 3 same-origin redirects and rejects cross-origin, unsafe hops, and 4th redirect', async () => {
  const seen: { url: string; redirect?: string }[] = [];
  let cancelled = 0;
  const body = () => new ReadableStream({ cancel() { cancelled++; } });
  const appFetch = createWorkerGuildToolFetch(async (url, init) => {
    seen.push({ url: String(url), redirect: init?.redirect });
    if (seen.length === 1) return new Response(body(), { status: 301, headers: { location: '/app/' } });
    return new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
  });
  const ok = await inspectTool({ ...input, entry_url: 'https://tool.pages.dev/app' }, platform, appFetch);
  assert.equal(ok.origin, 'https://tool.pages.dev');
  assert.equal(seen.length, 2);
  assert.deepEqual(seen, [
    { url: 'https://tool.pages.dev/app', redirect: 'manual' },
    { url: 'https://tool.pages.dev/app/', redirect: 'manual' },
  ]);
  assert.equal(cancelled, 1);

  let hops3Calls = 0, hops3Cancelled = 0;
  const threeHops = createWorkerGuildToolFetch(async () => {
    hops3Calls++;
    if (hops3Calls <= 3) return new Response(new ReadableStream({ cancel() { hops3Cancelled++; } }), { status: 302, headers: { location: `/step-${hops3Calls}` } });
    return new Response('ok');
  });
  assert.equal(await (await threeHops('https://tool.pages.dev/app')).text(), 'ok');
  assert.equal(hops3Calls, 4);
  assert.equal(hops3Cancelled, 3);

  let hops4Calls = 0, hops4Cancelled = 0;
  const fourHops = createWorkerGuildToolFetch(async () => {
    hops4Calls++;
    return new Response(new ReadableStream({ cancel() { hops4Cancelled++; } }), { status: 302, headers: { location: `/step-${hops4Calls}` } });
  });
  await assert.rejects(fourHops('https://tool.pages.dev/app'), /tool_redirect_rejected/);
  assert.equal(hops4Calls, 4);
  assert.equal(hops4Cancelled, 4);

  for (const location of ['https://other.pages.dev/app/', '/app/?secret=1', 'https://Tool.pages.dev/app/', 'http://127.0.0.1/']) {
    let calls = 0, closed = false;
    const rejected = createWorkerGuildToolFetch(async () => {
      calls++;
      return new Response(new ReadableStream({ cancel() { closed = true; } }), { status: 302, headers: { location } });
    });
    await assert.rejects(rejected('https://tool.pages.dev/app'), /tool_redirect_rejected/, location);
    assert.equal(calls, 1, location);
    assert.equal(closed, true, location);
  }
});

test('I4: Worker accepts 1-2 labels under netlify.app, vercel.app, workers.dev and rejects apex, 3 labels, and prefix spoofs', async () => {
  let calls = 0;
  const transport = createWorkerGuildToolFetch(async () => {
    calls++;
    return new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
  });
  const accepted = [
    'https://a.netlify.app/', 'https://a.b.netlify.app/',
    'https://a.vercel.app/', 'https://a.b.vercel.app/',
    'https://a.workers.dev/', 'https://a.b.workers.dev/',
  ];
  for (const url of accepted) {
    assert.equal((await transport(url)).status, 200, url);
  }
  assert.equal(calls, accepted.length);

  for (const url of [
    'https://a.b.c.vercel.app/', 'https://a.b.c.netlify.app/', 'https://a.b.c.workers.dev/',
    'https://netlify.app/', 'https://vercel.app/', 'https://workers.dev/',
    'https://evil-netlify.app/', 'https://evil-vercel.app/', 'https://evil-workers.dev/',
  ]) {
    await assert.rejects(transport(url), /tool_destination_rejected/, url);
  }
  assert.equal(calls, accepted.length);
});
