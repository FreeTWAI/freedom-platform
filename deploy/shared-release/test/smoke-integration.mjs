// Synthetic HTTP responses, real existing candidate acceptance checks. This is
// not remote evidence; the image test runs with network=none.
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { verifyPublicSmoke } from '../portable/smoke.mjs';

export async function verifySmoke({ root, sourceRoot }) {
  const sourceSha = 'a'.repeat(40), contract = JSON.parse(await readFile(join(sourceRoot, 'contracts/preview/v1/metadata.json')));
  const { version } = JSON.parse(await readFile(join(sourceRoot, 'package.json')));
  const access = { clientId: 'synthetic-access-id', clientSecret: 'synthetic-access-secret' };
  let calls = 0;
  const response = (body, status = 200, type = 'application/json') => new Response(
    type === 'application/json' ? JSON.stringify(body) : body,
    { status, headers: { 'content-type': type, 'cache-control': 'no-store' } });
  const transport = (target, healthOverrides = () => ({})) => async (url, options) => {
    calls++;
    const expectedOrigin = target === 'next' ? 'https://freetwai.com' : 'https://staging.freetwai.com';
    const path = new URL(url).pathname;
    assert.equal(new URL(url).origin, expectedOrigin); assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Authorization, undefined); assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.headers['CF-Access-Client-Secret'], target === 'staging-next' && path !== '/' ? access.clientSecret : undefined);
    if (options.method === 'POST') {
      assert.equal(path, '/api/v1/auth/login'); assert.equal(options.body, '{}');
      assert.notEqual(options.headers.Origin, expectedOrigin); return response({ code: 'origin_rejected' }, 403);
    }
    assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
    if (path === '/api/v1/health') return response({ status: 'ok', mode: target === 'next' ? 'public' : 'staging',
      version, money_movement_enabled: false, official: false, runtime: 'cloudflare-workers', release_sha: sourceSha,
      shop_key_policy: 'purpose-bound-only', shop_key_issuer_profile: 'freedom.shop-service-key/v1', ...healthOverrides() });
    if (path === '/api/v1/protocol') return response(contract);
    if (path.endsWith('.webp')) return response(Buffer.alloc(1001), 200, 'image/webp');
    if (path === '/') return response('', target === 'next' ? 200 : 403, 'text/html');
    assert(['/api/v1/session', '/api/v1/me/guild-preferences', '/api/v1/me/development/skill/video-autopilot'].includes(path));
    return response({ code: 'login_required' }, 401);
  };
  const run = async (name, target, fetchImpl, extras = {}) => {
    const workRoot = join(root, name); await mkdir(workRoot, { mode: 0o700 });
    return verifyPublicSmoke({ target, sourceSha, sourceRoot, workRoot, signal: new AbortController().signal,
      ...(target === 'staging-next' ? { access } : {}), fetchImpl, sleep: async () => {}, ...extras });
  };
  for (const target of ['staging-next', 'next']) {
    const result = await run(target, target, transport(target)); assert.equal(result.smokePassed, true); assert.equal(result.attempts, 1);
    const report = await readFile(join(root, target, 'smoke-1.json'), 'utf8');
    assert(!report.includes(access.clientSecret)); assert(!report.includes(access.clientId));
  }
  let healthReads = 0;
  const retry = await run('stale', 'next', transport('next', () => ++healthReads === 1 ? { release_sha: 'b'.repeat(40) } : {}));
  assert.equal(retry.attempts, 2);
  assert.equal(JSON.parse(await readFile(join(root, 'stale/smoke-1.json'))).overall, 'fail');
  await assert.rejects(run('wrong', 'next', transport('next', () => ({ release_sha: 'b'.repeat(40) }))), /release_smoke_not_passed/);
  assert.equal((await readdir(join(root, 'wrong'))).length, 5);
  await assert.rejects(run('redirect', 'staging-next', async () => new Response(null, { status: 302,
    headers: { location: 'https://foreign.invalid/' } })), /release_smoke_not_passed/);
  await assert.rejects(run('public-access', 'next', transport('next'), { access }), { code: 'release_smoke_access_invalid' });
  const interrupted = new AbortController(); interrupted.abort(Error('fixture-interrupted')); const before = calls;
  await assert.rejects(run('abort', 'next', transport('next'), { signal: interrupted.signal }), /fixture-interrupted/);
  assert.equal(calls, before);
  return { syntheticHttp: true, bothTargets: true, staleEvidenceRetained: true, boundedRetry: true, noRedirect: true, remote: 'not_run' };
}
