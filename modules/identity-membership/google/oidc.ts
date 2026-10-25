import { createHash, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, customFetch, decodeProtectedHeader, jwtVerify, type JWTVerifyGetKey } from 'jose';

export type GoogleOidcConfig = { clientId: string; clientSecret: string };
export type GoogleIdentity = { subject: string; email: string; authoritativeEmail: boolean };

const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWKS_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/certs';
const REQUEST_TIMEOUT_MS = 5000, TOKEN_BYTES = 32768, JWKS_BYTES = 65536, MAX_CHUNKS = 256;
const MAX_ID_TOKEN_LENGTH = 16384, MAX_TOKEN_AGE_SECONDS = 3600, MAX_TOKEN_LIFETIME_SECONDS = 7200;
const FUTURE_IAT_TOLERANCE_SECONDS = 60;

// Never retain upstream diagnostics, claims, codes, credentials or raw responses in an error.
function invalid(): never { throw new Error('Google authentication failed.'); }
function requireValid(condition: unknown): asserts condition { if (!condition) invalid(); }
function opaque(value: unknown, maximum: number, minimum = 1): value is string {
  return typeof value === 'string' && value.length >= minimum && value.length <= maximum && /^[\x21-\x7e]+$(?![\s\S])/.test(value);
}
function validVerifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._~-]{43,128}$(?![\s\S])/.test(value);
}
function validateConfig(config: GoogleOidcConfig, redirectUri: string): void {
  requireValid(opaque(config.clientId, 512) && opaque(config.clientSecret, 4096));
  requireValid(opaque(redirectUri, 2048));
  const url = new URL(redirectUri);
  requireValid(!url.username && !url.password && !url.hash);
  requireValid(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
}

/** Host-configured redirect only; the route owns single-use state/browser binding.
 * No profile scopes, offline access or reusable Google API credentials are requested.
 */
export function authorizationUrl(config: GoogleOidcConfig, redirectUri: string, flow: { state: string; nonce: string; verifier: string }): string {
  try {
    validateConfig(config, redirectUri);
    requireValid(opaque(flow.state, 512, 16) && opaque(flow.nonce, 512, 16) && validVerifier(flow.verifier));
    const url = new URL(AUTHORIZATION_ENDPOINT);
    url.search = new URLSearchParams({
      client_id: config.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email',
      state: flow.state, nonce: flow.nonce, code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(flow.verifier).digest('base64url'),
      prompt: 'select_account',
    }).toString();
    return url.href;
  } catch { return invalid(); }
}

function validDomain(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 253 && value.includes('.') && /[A-Za-z]/.test(value.split('.').at(-1)!) && value.split('.').every(label =>
    label.length > 0 && label.length <= 63 && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$(?![\s\S])/.test(label));
}
function normalizedEmail(value: unknown): string {
  requireValid(typeof value === 'string' && value.length <= 200);
  const parts = value.split('@');
  requireValid(parts.length === 2 && parts[0].length <= 64 && validDomain(parts[1]));
  // Strict ASCII dot-atom, with neither whitespace normalization nor quoted local parts.
  requireValid(/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$(?![\s\S])/.test(parts[0]));
  return value.toLowerCase();
}
function sameNonce(actual: unknown, expected: string): boolean {
  if (!opaque(actual, 512, 16) || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

/** Pure verification port for real signed fixtures. The resolver is trusted host code,
 * never a token-selected URL/key. The optional clock is for pure tests only; the
 * production exchange does not accept or forward a clock override.
 *
 * Google protocol/claim rules:
 * https://developers.google.com/identity/openid-connect/openid-connect
 * https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
 */
export async function verifyGoogleIdToken(token: string, clientId: string, nonce: string, trustedKeyResolver: JWTVerifyGetKey, now?: Date): Promise<GoogleIdentity> {
  try {
    requireValid(typeof token === 'string' && token.length <= MAX_ID_TOKEN_LENGTH && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$(?![\s\S])/.test(token));
    const currentDate = now ?? new Date();
    requireValid(opaque(clientId, 512) && opaque(nonce, 512, 16) && Number.isFinite(currentDate.getTime()));
    const header = decodeProtectedHeader(token);
    requireValid(header.alg === 'RS256' && opaque(header.kid, 200));
    // Even though jose's fixed resolver ignores these, fail closed rather than
    // accepting a token that purports to select or supply its own signing key.
    requireValid(!['jku', 'x5u', 'jwk', 'x5c'].some(name => Object.hasOwn(header, name)));
    const { payload } = await jwtVerify(token, trustedKeyResolver, {
      algorithms: ['RS256'], issuer: ['accounts.google.com', 'https://accounts.google.com'], audience: clientId,
      requiredClaims: ['sub', 'exp', 'iat', 'nonce', 'email'], currentDate,
    });
    // Key retrieval may have waited on the network. In production, expiry must
    // still hold after that wait, not only at the start of token verification.
    const seconds = Math.floor((now ?? new Date()).getTime() / 1000), { iat, exp, aud, azp } = payload;
    requireValid(typeof iat === 'number' && Number.isSafeInteger(iat) && iat > 0);
    requireValid(typeof exp === 'number' && Number.isSafeInteger(exp) && exp > seconds && exp > iat);
    requireValid(iat <= seconds + FUTURE_IAT_TOLERANCE_SECONDS && seconds - iat <= MAX_TOKEN_AGE_SECONDS);
    requireValid(exp - iat <= MAX_TOKEN_LIFETIME_SECONDS);
    const audiences = typeof aud === 'string' ? [aud] : aud;
    requireValid(Array.isArray(audiences) && audiences.length > 0 && audiences.length <= 8 && audiences.every(value => opaque(value, 512)));
    requireValid(new Set(audiences).size === audiences.length);
    requireValid(azp === undefined ? audiences.length === 1 : azp === clientId);
    requireValid(sameNonce(payload.nonce, nonce));
    requireValid(typeof payload.sub === 'string' && /^[\x20-\x7e]{1,255}$(?![\s\S])/.test(payload.sub));
    const email = normalizedEmail(payload.email);
    requireValid(payload.email_verified === undefined || typeof payload.email_verified === 'boolean');
    requireValid(payload.hd === undefined || validDomain(payload.hd));
    return {
      // Email is a normalized signup candidate, never an identity or merge key.
      subject: payload.sub, email,
      authoritativeEmail: payload.email_verified === true && (email.split('@')[1] === 'gmail.com' || payload.hd !== undefined),
    };
  } catch { return invalid(); }
}

/** The injected fetch is a trusted host/test port, not a caller-selected transport.
 * Requests and decoded response bodies share one deadline. Cancellation is best
 * effort and cannot extend it, including for a stalled injected reader.
 */
async function boundedResponse(url: typeof TOKEN_ENDPOINT | typeof JWKS_ENDPOINT, init: RequestInit, transport: typeof fetch, maximum: number): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined, complete = false;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('Google authentication failed.')); }, REQUEST_TIMEOUT_MS);
  });
  try {
    const request = transport(url, { ...init, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal });
    // A late non-compliant transport result must not leave an unread response open.
    void request.then(value => { if (controller.signal.aborted) void value.body?.cancel().catch(() => {}); }, () => {});
    response = await Promise.race([request, deadline]);
    requireValid(response.status === 200 && !response.redirected && response.type !== 'opaqueredirect');
    requireValid(!response.url || response.url === url);
    const mediaType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    requireValid(mediaType === 'application/json' || (url === JWKS_ENDPOINT && mediaType === 'application/jwk-set+json'));
    const contentLength = response.headers.get('content-length');
    requireValid(contentLength === null || (/^(0|[1-9][0-9]*)$(?![\s\S])/.test(contentLength) && Number(contentLength) <= maximum));
    requireValid(response.body);
    reader = response.body.getReader();
    const buffer = new Uint8Array(maximum);
    let size = 0, chunks = 0;
    for (;;) {
      const next = await Promise.race([reader.read(), deadline]);
      if (next.done) { complete = true; break; }
      requireValid(++chunks <= MAX_CHUNKS && next.value instanceof Uint8Array && next.value.byteLength <= maximum - size);
      buffer.set(next.value, size); size += next.value.byteLength;
    }
    // Fetch can decode a compressed body while retaining the wire length header.
    if (!response.headers.get('content-encoding')) requireValid(contentLength === null || Number(contentLength) === size);
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size));
    const value: unknown = JSON.parse(raw);
    requireValid(value !== null && typeof value === 'object' && !Array.isArray(value));
    return new Response(raw, { status: 200, headers: { 'Content-Type': mediaType } });
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (!complete) {
      if (reader) void reader.cancel().catch(() => {});
      else if (response) void response.body?.cancel().catch(() => {});
    }
    reader?.releaseLock();
  }
}

/** Code exchange only. No refresh/access token is returned, logged or persisted.
 * Fetching the fixed JWKS on each exchange deliberately avoids a persistent key
 * cache outliving Google's cache policy. No discovery/token/header URL is used.
 */
export async function exchangeGoogleCode(config: GoogleOidcConfig, redirectUri: string, code: string, verifier: string, nonce: string, transport: typeof fetch = fetch): Promise<GoogleIdentity> {
  try {
    validateConfig(config, redirectUri);
    requireValid(opaque(code, 4096) && validVerifier(verifier) && opaque(nonce, 512, 16));
    const response = await boundedResponse(TOKEN_ENDPOINT, {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', client_id: config.clientId, client_secret: config.clientSecret,
        code, code_verifier: verifier, redirect_uri: redirectUri,
      }),
    }, transport, TOKEN_BYTES);
    const tokens: unknown = await response.json();
    requireValid(tokens !== null && typeof tokens === 'object' && !Array.isArray(tokens));
    const token = (tokens as Record<string, unknown>).id_token;
    requireValid(typeof token === 'string' && token.length <= MAX_ID_TOKEN_LENGTH);
    const keys = createRemoteJWKSet(new URL(JWKS_ENDPOINT), {
      timeoutDuration: REQUEST_TIMEOUT_MS, cacheMaxAge: 0,
      [customFetch]: async (url, options) => {
        requireValid(url === JWKS_ENDPOINT);
        return boundedResponse(JWKS_ENDPOINT, { method: 'GET', headers: options.headers }, transport, JWKS_BYTES);
      },
    });
    return await verifyGoogleIdToken(token, config.clientId, nonce, keys);
  } catch { return invalid(); }
}
