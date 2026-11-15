import { agentOperations } from './agent-operations.mjs';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const TOKEN_RE = /^fw_agent_[A-Za-z0-9_-]{43}$/;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;
const MAX_JSON_BYTES = 2_000_000;
const MAX_PING_BYTES = 4096;
const PING_FORMAT = 'freedom.agent-ping/v1';
const PING_TIMESTAMP_RE = /^(0|[1-9]\d*)$/;
const PING_SIGNATURE_RE = /^v1=([0-9a-f]{64})$/;
const operations = Object.freeze(agentOperations.map((op) => Object.freeze({ ...op })));
const operationById = new Map(operations.map((op) => [op.id, op]));

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function parseBaseUrl(baseUrl) {
  if (typeof baseUrl !== 'string') throw new TypeError('baseUrl must be a string');
  const url = new URL(baseUrl);
  if (url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/api/v1')) {
    throw new TypeError('baseUrl must end with /api/v1 without credentials, query, or hash');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))) {
    throw new TypeError('baseUrl must use https:, or http: only on localhost, 127.0.0.1, or [::1]');
  }
  return url.href;
}

async function readJson(response) {
  const contentType = response.headers?.get?.('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    if (response.body) await response.body.cancel().catch(() => {});
    throw new TypeError('Platform response is not JSON');
  }
  const reader = response.body?.getReader?.();
  if (!reader) throw new TypeError('Platform response is not JSON');
  let bytes = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_JSON_BYTES) {
      await reader.cancel();
      throw new TypeError('Platform response is too large');
    }
    chunks.push(value);
  }
  const bytesValue = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytesValue.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytesValue));
  } catch {
    throw new TypeError('Platform response is not JSON');
  }
}

/** HTTP error returned by the Freedom agent API. */
export class AgentError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.name = 'AgentError';
    this.status = status;
    this.code = code;
  }
}

/** Generate a fresh UUIDv4 idempotency key for a write operation. */
export function newIdempotencyKey() {
  return crypto.randomUUID();
}

/** Create a dependency-free client for a member's fw_agent_ token. */
export function createAgentClient(config) {
  if (!isPlainObject(config)) throw new TypeError('Client options must be a plain object');
  const { baseUrl, token, fetcher = (...args) => globalThis.fetch(...args), timeoutMs = 15000 } = config;
  const base = parseBaseUrl(baseUrl);
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) throw new TypeError('Invalid agent token');
  if (typeof fetcher !== 'function') throw new TypeError('fetcher must be a function');
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('timeoutMs must be a positive number');
  }

  async function call(operationId, options = {}) {
    const op = operationById.get(operationId);
    if (!op) throw new TypeError(`Unknown operation: ${String(operationId)}`);
    if (!isPlainObject(options)) throw new TypeError('Call options must be a plain object');
    const { params, query, body, ifMatch, idempotencyKey } = options;
    if (params !== undefined && !isPlainObject(params)) throw new TypeError('params must be a plain object');
    const path = op.path.replace(/\{([^}]+)\}/g, (_, key) => {
      const value = params && Object.hasOwn(params, key) ? params[key] : undefined;
      if (typeof value !== 'string' || !value) throw new TypeError(`Missing path parameter: ${key}`);
      return encodeURIComponent(value);
    });
    let suffix = '';
    if (query !== undefined) {
      if (!isPlainObject(query)) throw new TypeError('query must be a plain object');
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) search.append(key, String(value));
      }
      const qs = search.toString();
      if (qs) suffix = `?${qs}`;
    }
    if (op.if_match && (typeof ifMatch !== 'string' || !ifMatch)) throw new TypeError(`If-Match required for ${operationId}`);
    if (ifMatch !== undefined && (typeof ifMatch !== 'string' || !ifMatch)) throw new TypeError('Invalid If-Match');
    if (op.method !== 'GET' && (idempotencyKey === undefined || idempotencyKey === null)) {
      throw new TypeError('idempotencyKey is required for every write; reuse the same key when you retry');
    }
    if (idempotencyKey !== undefined && (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_KEY_RE.test(idempotencyKey))) {
      throw new TypeError('idempotencyKey must be 8-128 letters, digits, - or _');
    }
    if (op.method === 'GET' && body !== undefined) throw new TypeError('GET operation cannot have a body');

    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (ifMatch !== undefined) headers['If-Match'] = ifMatch;
    if (idempotencyKey !== undefined) headers['Idempotency-Key'] = idempotencyKey;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs);
    try {
      const response = await fetcher(base + path + suffix, {
        method: op.method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal,
      });
      if (response.ok) return response.status === 204 ? null : await readJson(response);
      // A failed answer keeps its status even when its body is not a JSON Problem (an HTML 502 from a
      // proxy, or a body over the cap), so the caller can still decide whether to retry.
      let payload = null;
      try { payload = await readJson(response); } catch { payload = null; }
      const code = (payload && typeof payload.code === 'string' && payload.code)
        || (payload && typeof payload.error === 'string' && payload.error)
        || `http_${response.status}`;
      const message = (payload && typeof payload.message === 'string' && payload.message)
        || (payload && typeof payload.detail === 'string' && payload.detail)
        || code;
      throw new AgentError(response.status, code, message);
    } finally {
      clearTimeout(timer);
    }
  }

  return { operations, call, events: ({ after } = {}) => call('agent.events', { query: { after } }) };
}

/** Verification error thrown by verifyAgentPing. */
export class AgentPingError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'AgentPingError';
    this.code = code;
  }
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function readPingHeader(headers, targetName) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    throw new AgentPingError('ping_malformed', 'headers must be a Headers instance or plain object');
  }
  if (typeof headers.get === 'function') {
    const value = headers.get(targetName);
    return value === null ? undefined : value;
  }
  if (!isPlainObject(headers)) {
    throw new AgentPingError('ping_malformed', 'headers must be a Headers instance or plain object');
  }
  const lowerTarget = targetName.toLowerCase();
  let found;
  let count = 0;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerTarget) {
      count += 1;
      found = value;
    }
  }
  if (count > 1) throw new AgentPingError('ping_malformed', `Duplicate header: ${targetName}`);
  if (found !== undefined && typeof found !== 'string') {
    throw new AgentPingError('ping_malformed', `Invalid header: ${targetName}`);
  }
  return found;
}

function parsePingPayload(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new AgentPingError('ping_malformed', 'Ping body is not valid JSON');
  }
  if (!isPlainObject(parsed)) {
    throw new AgentPingError('ping_malformed', 'Ping body must be a JSON object');
  }
  const keys = Object.keys(parsed);
  if (
    keys.length !== 4
    || parsed.format !== PING_FORMAT
    || typeof parsed.ping_id !== 'string' || !parsed.ping_id
    || typeof parsed.connection_id !== 'string' || !parsed.connection_id
    || typeof parsed.test !== 'boolean'
  ) {
    throw new AgentPingError('ping_malformed', 'Invalid ping payload');
  }
  return {
    ping_id: parsed.ping_id,
    connection_id: parsed.connection_id,
    test: parsed.test,
  };
}

/** Verify an incoming Freedom agent change ping using WebCrypto HMAC-SHA256. */
export async function verifyAgentPing(options) {
  if (!isPlainObject(options)) {
    throw new AgentPingError('ping_malformed', 'Ping verification options must be a plain object');
  }
  const { token, body, headers, now = Date.now(), toleranceSeconds = 300 } = options;
  if (
    typeof now !== 'number' || !Number.isFinite(now)
    || typeof toleranceSeconds !== 'number' || !Number.isFinite(toleranceSeconds) || toleranceSeconds < 0
  ) {
    throw new AgentPingError('ping_malformed', 'Invalid ping verification time window');
  }
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) {
    throw new AgentPingError('ping_malformed', 'Invalid agent token');
  }
  if (typeof body !== 'string') {
    throw new AgentPingError('ping_malformed', 'Ping body must be a string');
  }
  const encoder = new TextEncoder();
  if (encoder.encode(body).byteLength > MAX_PING_BYTES) {
    throw new AgentPingError('ping_malformed', 'Ping body exceeds 4096 bytes');
  }
  const tsRaw = readPingHeader(headers, 'freedom-ping-timestamp');
  const sigRaw = readPingHeader(headers, 'freedom-ping-signature');
  if (typeof tsRaw !== 'string' || !PING_TIMESTAMP_RE.test(tsRaw)) {
    throw new AgentPingError('ping_malformed', 'Missing or invalid Freedom-Ping-Timestamp header');
  }
  const timestamp = Number(tsRaw);
  if (!Number.isSafeInteger(timestamp)) {
    throw new AgentPingError('ping_malformed', 'Invalid Freedom-Ping-Timestamp header');
  }
  const sigMatch = typeof sigRaw === 'string' ? PING_SIGNATURE_RE.exec(sigRaw) : null;
  if (!sigMatch) {
    throw new AgentPingError('ping_malformed', 'Missing or invalid Freedom-Ping-Signature header');
  }

  if (Math.abs(now / 1000 - timestamp) > toleranceSeconds) {
    throw new AgentPingError('ping_expired', 'Ping timestamp is outside tolerance');
  }

  const tokenDigest = await crypto.subtle.digest('SHA-256', encoder.encode(token));
  const tokenHashHex = toHex(tokenDigest);
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(tokenHashHex),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const messageBytes = encoder.encode(`${PING_FORMAT}\n${tsRaw}\n${body}`);
  const verified = await crypto.subtle.verify('HMAC', hmacKey, hexToBytes(sigMatch[1]), messageBytes);
  if (!verified) {
    throw new AgentPingError('ping_signature_invalid', 'Invalid ping signature');
  }

  return { ...parsePingPayload(body), timestamp };
}
