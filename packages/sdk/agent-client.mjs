import { agentOperations } from './agent-operations.mjs';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const TOKEN_RE = /^fw_agent_[A-Za-z0-9_-]{43}$/;
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

async function parseJson(response) {
  if (typeof response.text === 'function') {
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  return typeof response.json === 'function' ? await response.json() : null;
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
    if (idempotencyKey !== undefined && (typeof idempotencyKey !== 'string' || !idempotencyKey)) {
      throw new TypeError('Invalid Idempotency-Key');
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
      if (response.ok) return response.status === 204 ? null : await parseJson(response);
      let payload = null;
      try { payload = await parseJson(response); } catch { payload = null; }
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
