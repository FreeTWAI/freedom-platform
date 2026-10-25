import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { CompactSign, exportJWK, generateKeyPair, type JWK, type CompactJWSHeaderParameters, type JWTVerifyGetKey } from 'jose';
import { authorizationUrl, exchangeGoogleCode, verifyGoogleIdToken } from '../../modules/identity-membership/google/oidc.js';

const config = { clientId: 'synthetic-client.apps.googleusercontent.com', clientSecret: 'synthetic-secret-not-a-credential' };
const redirectUri = 'https://workshop.example/api/v1/auth/google/callback';
const nonce = 'synthetic-nonce-0123456789abcdef';
const state = 'synthetic-state-0123456789abcdef';
// RFC 7636 Appendix B, independent of the implementation's hashing operation.
const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const instant = new Date('2026-10-25T00:00:00Z'), seconds = instant.getTime() / 1000;
const tokenEndpoint = 'https://oauth2.googleapis.com/token', jwksEndpoint = 'https://www.googleapis.com/oauth2/v3/certs';
const failure = { name: 'Error', message: 'Google authentication failed.' };
let signing: Awaited<ReturnType<typeof generateKeyPair>>, unrelated: Awaited<ReturnType<typeof generateKeyPair>>, publicJwk: JWK;
const keys: JWTVerifyGetKey = async () => signing.publicKey;

before(async () => {
  signing = await generateKeyPair('RS256');
  unrelated = await generateKeyPair('RS256');
  publicJwk = { ...await exportJWK(signing.publicKey), kid: 'synthetic-google-key', use: 'sig', alg: 'RS256' };
});

function claims(overrides: Record<string, unknown> = {}, at = seconds): Record<string, unknown> {
  return {
    iss: 'https://accounts.google.com', aud: config.clientId, sub: 'Synthetic-Google-Subject-A',
    email: 'Synthetic.Member+Fixture@GMAIL.COM', email_verified: true, nonce, iat: at, exp: at + 3600,
    ...overrides,
  };
}
async function sign(payload = claims(), header: CompactJWSHeaderParameters = { alg: 'RS256', kid: 'synthetic-google-key' }, key = signing.privateKey): Promise<string> {
  return new CompactSign(new TextEncoder().encode(JSON.stringify(payload))).setProtectedHeader(header).sign(key);
}
async function verify(payload: Record<string, unknown>) {
  return verifyGoogleIdToken(await sign(payload), config.clientId, nonce, keys, instant);
}
const json = (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } });

test('authorization uses fixed code flow, minimal scopes, nonce/state and the independent PKCE S256 vector', () => {
  const url = new URL(authorizationUrl(config, redirectUri, { state, nonce, verifier }));
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    client_id: config.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email',
    state, nonce, code_challenge_method: 'S256', code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', prompt: 'select_account',
  });
  assert.equal(url.searchParams.has('client_secret'), false);
  assert.equal(url.searchParams.has('access_type'), false);
  assert.equal(url.href.includes(verifier), false);
});

test('authorization permits explicitly configured loopback development callbacks, not insecure remote callbacks', () => {
  for (const callback of ['http://localhost:4311/callback', 'http://127.0.0.1:4311/callback', 'http://[::1]:4311/callback']) {
    assert.equal(new URL(authorizationUrl(config, callback, { state, nonce, verifier })).searchParams.get('redirect_uri'), callback);
  }
  for (const callback of ['http://workshop.example/callback', 'https://user:password@workshop.example/callback', 'https://workshop.example/callback#fragment', 'https://workshop.example/callback\n', ' https://workshop.example/callback', 'not-a-url']) {
    assert.throws(() => authorizationUrl(config, callback, { state, nonce, verifier }), failure);
  }
});

test('authorization rejects malformed or unbounded correlation/PKCE values without exposing them', () => {
  for (const flow of [
    { state: '', nonce, verifier }, { state: 's'.repeat(513), nonce, verifier }, { state: state + '\n', nonce, verifier },
    { state, nonce: '', verifier }, { state, nonce: nonce + '\n', verifier },
    { state, nonce, verifier: 'v'.repeat(42) }, { state, nonce, verifier: 'v'.repeat(129) },
    { state, nonce, verifier: verifier + '\n' }, { state, nonce, verifier: verifier + '/' },
  ]) assert.throws(() => authorizationUrl(config, redirectUri, flow), failure);
  assert.throws(() => authorizationUrl({ ...config, clientId: '' }, redirectUri, { state, nonce, verifier }), failure);
  assert.throws(() => authorizationUrl({ ...config, clientSecret: '' }, redirectUri, { state, nonce, verifier }), failure);
});

test('real RS256 verification returns stable case-sensitive sub and only a normalized candidate email', async () => {
  const result = await verify(claims());
  assert.deepEqual(result, { subject: 'Synthetic-Google-Subject-A', email: 'synthetic.member+fixture@gmail.com', authoritativeEmail: true });
  assert.deepEqual(Object.keys(result).sort(), ['authoritativeEmail', 'email', 'subject']);
  const changedEmail = await verify(claims({ email: 'changed@example.org', hd: undefined }));
  assert.equal(changedEmail.subject, result.subject);
  assert.equal(changedEmail.authoritativeEmail, false);
  const sameEmailOtherSubject = await verify(claims({ sub: 'Synthetic-Google-Subject-B' }));
  assert.notEqual(sameEmailOtherSubject.subject, result.subject);
});

test('both documented issuer spellings and matching azp/multi-audience tokens are supported', async () => {
  for (const iss of ['accounts.google.com', 'https://accounts.google.com']) {
    assert.equal((await verify(claims({ iss, azp: config.clientId }))).authoritativeEmail, true);
  }
  assert.equal((await verify(claims({ aud: [config.clientId, 'another-client'], azp: config.clientId }))).subject, 'Synthetic-Google-Subject-A');
  assert.equal((await verify(claims({ aud: [config.clientId] }))).subject, 'Synthetic-Google-Subject-A');
});

test('bad signatures and payload tampering are rejected using actual RSA keys', async () => {
  await assert.rejects(verifyGoogleIdToken(await sign(claims(), undefined, unrelated.privateKey), config.clientId, nonce, keys, instant), failure);
  const token = (await sign()).split('.');
  token[1] = Buffer.from(JSON.stringify(claims({ sub: 'attacker' }))).toString('base64url');
  await assert.rejects(verifyGoogleIdToken(token.join('.'), config.clientId, nonce, keys, instant), failure);
});

for (const [label, overrides] of [
  ['wrong issuer', { iss: 'https://accounts.google.com.evil.example' }], ['issuer with trailing slash', { iss: 'https://accounts.google.com/' }],
  ['missing issuer', { iss: undefined }], ['missing audience', { aud: undefined }], ['wrong audience', { aud: 'other-client' }],
  ['wrong azp', { azp: 'other-client' }], ['null azp', { azp: null }], ['numeric azp', { azp: 1 }],
  ['multiple audiences without azp', { aud: [config.clientId, 'other-client'] }],
  ['multiple audiences with wrong azp', { aud: [config.clientId, 'other-client'], azp: 'other-client' }],
  ['invalid audience type in array', { aud: [config.clientId, 1], azp: config.clientId }],
  ['duplicate audience', { aud: [config.clientId, config.clientId], azp: config.clientId }],
  ['missing nonce', { nonce: undefined }], ['wrong nonce', { nonce: 'different-nonce-0123456789abcdef' }],
  ['nonce with newline', { nonce: nonce + '\n' }], ['nonce with nonstring type', { nonce: [nonce] }],
] as [string, Record<string, unknown>][]) {
  test(`signed token rejects ${label}`, async () => { await assert.rejects(verify(claims(overrides)), failure); });
}

for (const [label, overrides] of [
  ['missing expiry', { exp: undefined }], ['expiry at now', { exp: seconds }], ['past expiry', { exp: seconds - 1 }],
  ['fractional expiry', { exp: seconds + 60.1 }], ['string expiry', { exp: String(seconds + 60) }],
  ['missing iat', { iat: undefined }], ['string iat', { iat: String(seconds) }], ['fractional iat', { iat: seconds - 0.5 }],
  ['zero iat', { iat: 0 }], ['future iat', { iat: seconds + 61 }], ['old iat', { iat: seconds - 3601 }],
  ['unsafe integer iat', { iat: Number.MAX_SAFE_INTEGER + 1 }], ['overlong lifetime', { exp: seconds + 7201 }],
  ['expiry before issue', { iat: seconds + 30, exp: seconds + 20 }], ['future not-before', { nbf: seconds + 1 }],
] as [string, Record<string, unknown>][]) {
  test(`signed token rejects ${label}`, async () => { await assert.rejects(verify(claims(overrides)), failure); });
}

test('iat tolerates at most sixty future seconds; age and lifetime bounds include their exact edges', async () => {
  for (const overrides of [{ iat: seconds + 60 }, { iat: seconds - 3600 }, { exp: seconds + 7200 }]) {
    assert.equal((await verify(claims(overrides))).subject, 'Synthetic-Google-Subject-A');
  }
});

test('production clock rechecks expiry after the trusted resolver has waited', async context => {
  context.mock.timers.enable({ apis: ['Date'], now: instant });
  const token = await sign(claims({ exp: seconds + 1 }));
  const delayed: JWTVerifyGetKey = async () => { context.mock.timers.tick(1000); return signing.publicKey; };
  await assert.rejects(verifyGoogleIdToken(token, config.clientId, nonce, delayed), failure);
});

for (const [label, sub] of [
  ['missing', undefined], ['empty', ''], ['numeric', 123], ['null', null], ['overlong', 'a'.repeat(256)],
  ['Unicode', '會員'], ['NUL', 'subject\0'], ['DEL', 'subject\u007f'], ['newline', 'subject\n'],
] as [string, unknown][]) {
  test(`signed token rejects ${label} sub`, async () => { await assert.rejects(verify(claims({ sub })), failure); });
}

test('subject bounds preserve printable ASCII and exact case, without trimming or email substitution', async () => {
  for (const sub of ['A', 'AbC aBc', 'a'.repeat(255)]) assert.equal((await verify(claims({ sub }))).subject, sub);
});

for (const [label, email] of [
  ['missing', undefined], ['empty', ''], ['numeric', 1], ['display name', 'Member <member@gmail.com>'],
  ['leading whitespace', ' member@gmail.com'], ['trailing newline', 'member@gmail.com\n'],
  ['multiple at signs', 'member@other@gmail.com'], ['leading local dot', '.member@gmail.com'],
  ['consecutive local dots', 'member..name@gmail.com'], ['trailing local dot', 'member.@gmail.com'],
  ['oversized local part', 'a'.repeat(65) + '@gmail.com'], ['oversized domain label', 'a@' + 'b'.repeat(64) + '.com'],
  ['single-label domain', 'member@localhost'], ['IPv4 domain', 'member@127.0.0.1'], ['Unicode local part', '會員@gmail.com'],
  ['Unicode domain', 'member@會員.example'], ['trailing DNS root dot', 'member@gmail.com.'],
  ['domain underscore', 'member@bad_domain.example'], ['domain leading dash', 'member@-domain.example'],
  ['over 200 characters', 'a'.repeat(64) + '@' + ['b'.repeat(63), 'c'.repeat(63), 'examples'].join('.')],
] as [string, unknown][]) {
  test(`signed token rejects ${label} email`, async () => { await assert.rejects(verify(claims({ email })), failure); });
}

test('only boolean verified exact gmail.com or a valid hosted-domain claim is authoritative', async () => {
  for (const email of ['member@gmail.com.evil.example', 'member@googlemail.com', 'member@example.org']) {
    assert.equal((await verify(claims({ email }))).authoritativeEmail, false);
  }
  for (const email_verified of [false, undefined]) {
    assert.equal((await verify(claims({ email_verified }))).authoritativeEmail, false);
    assert.equal((await verify(claims({ email: 'member@example.org', hd: 'workspace.example', email_verified }))).authoritativeEmail, false);
  }
  assert.equal((await verify(claims({ email: 'member@alias.example', hd: 'workspace.example' }))).authoritativeEmail, true);
  assert.equal((await verify(claims({ email: 'member@example.org', hd: 'WORKSPACE.EXAMPLE' }))).authoritativeEmail, true);
  for (const email_verified of ['true', 1, null, {}]) await assert.rejects(verify(claims({ email_verified })), failure);
});

test('the 200-character email boundary and 63-character domain label remain usable', async () => {
  const email = 'a'.repeat(64) + '@' + ['b'.repeat(63), 'c'.repeat(63), 'example'].join('.');
  assert.equal(email.length, 200);
  assert.equal((await verify(claims({ email, hd: 'w'.repeat(63) + '.example' }))).email, email);
});

for (const [label, hd] of [
  ['empty', ''], ['null', null], ['boolean', true], ['array', ['workspace.example']], ['URL', 'https://workspace.example'],
  ['whitespace', ' workspace.example'], ['newline', 'workspace.example\n'], ['single-label', 'workspace'],
  ['IPv4', '127.0.0.1'], ['Unicode', '會員.example'], ['underscore', 'bad_domain.example'],
  ['terminal root dot', 'workspace.example.'], ['oversized label', 'w'.repeat(64) + '.example'],
] as [string, unknown][]) {
  test(`signed token rejects ${label} hosted domain`, async () => { await assert.rejects(verify(claims({ hd })), failure); });
}

test('header-selected keys/URLs are rejected before the trusted key resolver is called', async () => {
  let calls = 0;
  const resolver: JWTVerifyGetKey = async () => { calls++; return signing.publicKey; };
  for (const extra of [{ jku: 'https://attacker.example/jwks' }, { x5u: 'https://attacker.example/cert' }, { jwk: publicJwk }, { x5c: ['untrusted'] }]) {
    const token = await sign(claims(), { alg: 'RS256', kid: 'synthetic-google-key', ...extra });
    await assert.rejects(verifyGoogleIdToken(token, config.clientId, nonce, resolver, instant), failure);
  }
  for (const kid of ['', undefined, 'k'.repeat(201), 'key\n']) {
    await assert.rejects(verifyGoogleIdToken(await sign(claims(), { alg: 'RS256', kid }), config.clientId, nonce, resolver, instant), failure);
  }
  const symmetric = await new CompactSign(new TextEncoder().encode(JSON.stringify(claims())))
    .setProtectedHeader({ alg: 'HS256', kid: 'synthetic-google-key' }).sign(new Uint8Array(32).fill(42));
  await assert.rejects(verifyGoogleIdToken(symmetric, config.clientId, nonce, resolver, instant), failure);
  assert.equal(calls, 0);
});

test('malformed and oversized tokens fail closed without invoking any resolver', async () => {
  let calls = 0;
  const resolver: JWTVerifyGetKey = async () => { calls++; return signing.publicKey; };
  for (const token of ['', 'not.a.token', 'a.b.c\n', 'a'.repeat(16385), 'e30.e30.', 'a.b.c.d']) {
    await assert.rejects(verifyGoogleIdToken(token, config.clientId, nonce, resolver, instant), failure);
  }
  assert.equal(calls, 0);
  await assert.rejects(verifyGoogleIdToken(await sign(), config.clientId, nonce, async () => { throw new Error('secret-key-details'); }, instant), failure);
});

test('code exchange uses only fixed endpoints and trusted bounded transport, verifies real JWKS signature and discards all API tokens', async () => {
  const token = await sign(claims({}, Math.floor(Date.now() / 1000)));
  const calls: { url: string; init: RequestInit }[] = [];
  const transport: typeof fetch = async (input, init) => {
    const url = String(input); calls.push({ url, init: init! });
    assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit'); assert.equal(init?.referrerPolicy, 'no-referrer');
    assert.ok(init?.signal instanceof AbortSignal);
    if (url === tokenEndpoint) {
      assert.equal(init?.method, 'POST');
      assert.deepEqual(Object.fromEntries(new URLSearchParams(String(init?.body))), {
        grant_type: 'authorization_code', client_id: config.clientId, client_secret: config.clientSecret,
        code: 'synthetic-code', code_verifier: verifier, redirect_uri: redirectUri,
      });
      return json({ id_token: token, access_token: 'must-not-escape', refresh_token: 'must-not-persist' });
    }
    assert.equal(url, jwksEndpoint); assert.equal(init?.method, 'GET'); assert.equal(init?.body, undefined);
    return json({ keys: [publicJwk] });
  };
  assert.deepEqual(await exchangeGoogleCode(config, redirectUri, 'synthetic-code', verifier, nonce, transport), {
    subject: 'Synthetic-Google-Subject-A', email: 'synthetic.member+fixture@gmail.com', authoritativeEmail: true,
  });
  assert.deepEqual(calls.map(call => call.url), [tokenEndpoint, jwksEndpoint]);
});

test('exchange rejects malformed input before transmitting credentials or making any call', async () => {
  let calls = 0;
  const transport: typeof fetch = async () => { calls++; throw new Error('must-not-call'); };
  for (const code of ['', 'c'.repeat(4097), 'code\n']) await assert.rejects(exchangeGoogleCode(config, redirectUri, code, verifier, nonce, transport), failure);
  await assert.rejects(exchangeGoogleCode(config, redirectUri, 'code', 'short', nonce, transport), failure);
  await assert.rejects(exchangeGoogleCode(config, redirectUri, 'code', verifier, '', transport), failure);
  assert.equal(calls, 0);
});

test('exchange rejects missing, malformed or overlong ID tokens, failed status and secret-bearing upstream errors', async () => {
  for (const response of [
    json({}), json({ id_token: 1 }), json({ id_token: 'a'.repeat(16385) }), json([]), json(null),
    json({ error: config.clientSecret }, { status: 400 }), new Response('{secret-invalid-json'),
    new Response('<html>not JSON</html>', { headers: { 'Content-Type': 'text/html' } }),
    json({ id_token: 'unused' }, { status: 302, headers: { Location: 'https://attacker.example' } }),
  ]) {
    let calls = 0;
    const transport: typeof fetch = async () => { calls++; return response; };
    await assert.rejects(exchangeGoogleCode(config, redirectUri, 'code', verifier, nonce, transport), failure);
    assert.equal(calls, 1);
  }
  await assert.rejects(exchangeGoogleCode(config, redirectUri, 'code', verifier, nonce, async () => { throw new Error(config.clientSecret); }), failure);
});

test('exchange rejects redirected or wrong-endpoint responses even from a noncompliant host transport', async () => {
  for (const metadata of [{ redirected: true }, { url: 'https://attacker.example/token' }]) {
    const response = json({ id_token: 'not-used' });
    for (const [name, value] of Object.entries(metadata)) Object.defineProperty(response, name, { value });
    await assert.rejects(exchangeGoogleCode(config, redirectUri, 'code', verifier, nonce, async () => response), failure);
  }
});

test('decoded compressed responses are bounded by decoded bytes, not compared to retained wire length', async () => {
  const token = await sign(claims({}, Math.floor(Date.now() / 1000)));
  const transport: typeof fetch = async input => json(String(input) === tokenEndpoint ? { id_token: token } : { keys: [publicJwk] }, {
    headers: { 'Content-Encoding': 'gzip', 'Content-Length': '1' },
  });
  assert.equal((await exchangeGoogleCode(config, redirectUri, 'code', verifier, nonce, transport)).subject, 'Synthetic-Google-Subject-A');
});

test('exchange bounds declared/streamed sizes and chunk counts and cancels rejected bodies', async () => {
  for (const mode of ['declared', 'streamed', 'chunks', 'length-mismatch', 'invalid-utf8']) {
    let cancelled = false, emitted = false;
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (mode === 'chunks') { controller.enqueue(new Uint8Array()); return; }
        if (emitted) { controller.close(); return; }
        emitted = true;
        controller.enqueue(mode === 'invalid-utf8' ? new Uint8Array([0xff]) : mode === 'length-mismatch' ? new TextEncoder().encode('{}') : new Uint8Array(32769));
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 }), { headers: { 'Content-Type': 'application/json', ...(mode === 'declared' ? { 'Content-Length': '32769' } : mode === 'length-mismatch' ? { 'Content-Length': '3' } : {}) } });
    await assert.rejects(exchangeGoogleCode(config, redirectUri, 'code', verifier, nonce, async () => response), failure);
    if (['declared', 'streamed', 'chunks'].includes(mode)) assert.equal(cancelled, true);
  }
});

test('JWKS errors, unknown kid, bad signing key and oversized key responses never yield identity', async () => {
  const token = await sign(claims({}, Math.floor(Date.now() / 1000)));
  const otherJwk = { ...await exportJWK(unrelated.publicKey), kid: publicJwk.kid, alg: 'RS256' };
  for (const response of [
    json({ keys: [] }), json({ keys: [{ ...publicJwk, kid: 'other-key' }] }), json({ keys: [otherJwk] }),
    json({ keys: [publicJwk, publicJwk] }), json({ keys: 'invalid' }), json({ keys: [publicJwk] }, { status: 302, headers: { Location: 'https://attacker.example' } }),
    new Response(' '.repeat(65537), { headers: { 'Content-Type': 'application/json' } }),
  ]) {
    const calls: string[] = [];
    const transport: typeof fetch = async input => { const url = String(input); calls.push(url); return url === tokenEndpoint ? json({ id_token: token }) : response; };
    await assert.rejects(exchangeGoogleCode(config, redirectUri, 'code', verifier, nonce, transport), failure);
    assert.deepEqual(calls, [tokenEndpoint, jwksEndpoint]);
  }
});

test('a stalled transport is bounded even if it ignores abort, and a late response is cancelled', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let deliver!: (value: Response) => void, signal: AbortSignal | null | undefined, cancelled = false;
  const transport: typeof fetch = async (_url, init) => { signal = init?.signal; return new Promise<Response>(resolve => { deliver = resolve; }); };
  const result = exchangeGoogleCode(config, redirectUri, 'code', verifier, nonce, transport);
  const rejected = assert.rejects(result, failure);
  context.mock.timers.tick(5000);
  await rejected;
  assert.equal(signal?.aborted, true);
  deliver(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(cancelled, true);
});

test('a stalled response body and cancellation cannot extend the request deadline', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let pulling!: () => void, cancelled = false;
  const started = new Promise<void>(resolve => { pulling = resolve; });
  const transport: typeof fetch = async () => new Response(new ReadableStream<Uint8Array>({
    pull() { pulling(); return new Promise<void>(() => {}); },
    cancel() { cancelled = true; return new Promise<void>(() => {}); },
  }), { headers: { 'Content-Type': 'application/json' } });
  const result = exchangeGoogleCode(config, redirectUri, 'code', verifier, nonce, transport);
  const rejected = assert.rejects(result, failure);
  await started;
  context.mock.timers.tick(5000);
  await rejected;
  assert.equal(cancelled, true);
});
