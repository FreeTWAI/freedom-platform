import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { createWorkerHandler, mountAssets, workerRuntime, type WorkerEnv } from '../../apps/platform-api/src/worker.js';
import { createPlatformApp, platformResponseHeaders } from '../../apps/platform-api/src/platform-app.js';
import { IMMUTABLE_ASSET_CACHE_CONTROL, isFastPathBuildAsset, isHashedBuildAsset } from '../../apps/platform-api/src/static-assets.js';
import { serveBuildAssets } from '../../apps/platform-api/src/static-assets-node.js';
import type { Pool } from 'pg';
import { FREETWAI_STICKERS } from '../../modules/member-communications/freetwai-stickers.js';
import { CHAT_STICKER_ATLAS } from '../../modules/member-communications/stickers.js';

const origin = 'http://127.0.0.1:8787', file = '/assets/app-AbCdEf12.js';
const security = ['content-security-policy', 'x-content-type-options', 'referrer-policy'];
test('Worker direct conditional and range responses retain cache policy in fast and mounted paths', async () => {
  for (const method of ['GET', 'HEAD']) for (const status of [200, 206, 304, 416]) {
    const assets: WorkerEnv['ASSETS'] = { async fetch(request) {
      assert.equal(request.headers.get('if-none-match'), '"fixture"');
      return new Response(method === 'HEAD' || status === 304 ? null : 'ab', { status, headers: {
        'Content-Type': 'text/javascript', ETag: '"fixture"', 'Cache-Control': 'untrusted',
        'Set-Cookie': 'bad=1', 'Content-Security-Policy': 'unsafe', 'X-Content-Type-Options': 'unsafe',
        'Referrer-Policy': 'unsafe', ...(status === 206 ? { 'Content-Range': 'bytes 0-1/14' } : {}),
      } });
    } };
    const env: WorkerEnv = { FREEDOM_ENV: 'local', APP_ORIGIN: origin, HYPERDRIVE: { connectionString: 'unused' }, ASSETS: assets };
    const handler = createWorkerHandler({ createPool: () => ({ async end() {} }) as Pool });
    const app = new Hono();
    app.use('*', async (c, next) => { for (const [k, v] of Object.entries(platformResponseHeaders(c.req.path))) c.header(k, v); await next(); });
    mountAssets(app, assets);
    const request = () => new Request(origin + file, { method, headers: { 'If-None-Match': '"fixture"' } });
    for (const response of [await handler.fetch(request(), env, { waitUntil() {} }), await app.fetch(request())]) {
      assert.equal(response.status, status);
      assert.equal(response.headers.get('cache-control'), status === 416 ? 'no-store' : IMMUTABLE_ASSET_CACHE_CONTROL);
      assert.equal(response.headers.get('etag'), '"fixture"');
      assert.equal(response.headers.get('set-cookie'), null);
      for (const name of security) assert.equal(response.headers.get(name), new Headers(platformResponseHeaders(file)).get(name));
      if (status === 206) assert.equal(response.headers.get('content-range'), 'bytes 0-1/14');
      if (method === 'HEAD' || status === 304) assert.equal(await response.text(), '');
    }
  }
});

test('Node immutable policy uses the completed direct response, preserving 416 and shell no-store', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fp-static-cache-'));
  try {
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, file), 'console.log(1)');
    await writeFile(join(root, 'assets', 'skill-social.js'), 'fixed');
    await writeFile(join(root, 'index.html'), '<html>shell</html>');
    const app = new Hono();
    app.use('*', async (c, next) => { for (const [k, v] of Object.entries(platformResponseHeaders(c.req.path))) c.header(k, v); await next(); });
    app.use('*', serveBuildAssets(root));
    app.get('*', serveStatic({ path: join(root, 'index.html') }));
    const encodedBuildFile = '/assets/app-%41bCdEf12.js';
    for (const method of ['GET', 'HEAD']) for (const path of [file, encodedBuildFile, '/assets/missing-AbCdEf12.js', '/assets/skill-social.js', '/']) {
      const response = await app.request(origin + path, { method });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), path === file || path === encodedBuildFile ? IMMUTABLE_ASSET_CACHE_CONTROL : 'no-store');
      for (const name of security) assert.equal(response.headers.get(name), new Headers(platformResponseHeaders(path)).get(name));
      if (method === 'HEAD') assert.equal(await response.text(), '');
    }
    for (const [range, status] of [['bytes=0-2', 206], ['bytes=999-1000', 416]] as const) {
      const response = await app.request(origin + file, { headers: { Range: range } });
      assert.equal(response.status, status);
      assert.equal(response.headers.get('cache-control'), status === 206 ? IMMUTABLE_ASSET_CACHE_CONTROL : 'no-store');
      assert.equal(response.headers.get('content-range'), status === 206 ? 'bytes 0-2/14' : 'bytes */14');
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

const stickerPaths = FREETWAI_STICKERS.flatMap(sticker => [sticker.image, sticker.thumbnail]);
const stickerVariants = [FREETWAI_STICKERS[0].image, FREETWAI_STICKERS[0].thumbnail];
const privateImage = '/api/v1/me/conversations/00000000-0000-4000-8000-000000000001/messages/00000000-0000-4000-8000-000000000002/image';
const unregisteredPaths = [
  CHAT_STICKER_ATLAS,
  stickerVariants[0].replace(/-[a-f0-9]{12}\.webp$/, '-000000000000.webp'),
  '/art/chat/freetwai-v2/unregistered-image-0123456789ab.webp',
  stickerVariants[0].replace('/art/chat/', '/art/other/'),
  stickerVariants[0].replace('freetwai-v2-lol', 'freetwai-v2-%6col'),
  stickerVariants[0] + '.bak',
  stickerVariants[0] + '/extra.webp',
  privateImage,
  '/assets/skill-social.js',
];

function mountedAssets(assets: WorkerEnv['ASSETS']) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    for (const [key, value] of Object.entries(platformResponseHeaders(c.req.path))) c.header(key, value);
    await next();
  });
  mountAssets(app, assets);
  return app;
}

function assertSecurity(response: Response, path: string) {
  for (const name of security) assert.equal(response.headers.get(name), new Headers(platformResponseHeaders(path)).get(name), name);
}

// Real Worker routing and middleware, with no database or network available to the fixture.
function stickerWorker(assets: WorkerEnv['ASSETS']) {
  let runtimes = 0, apps = 0, ended = 0, queries = 0;
  const pool = { async query() { queries++; throw new Error('fixture must not query a database'); }, async end() { ended++; } } as unknown as Pool;
  const env: WorkerEnv = { FREEDOM_ENV: 'local', APP_ORIGIN: origin, HYPERDRIVE: { connectionString: 'unused' }, ASSETS: assets };
  const handler = createWorkerHandler({
    createPool: () => pool,
    createRuntime: (...args) => { runtimes++; return workerRuntime(...args); },
    createApp: (...args) => { apps++; return createPlatformApp(...args); },
  });
  return {
    env, counts: () => ({ runtimes, apps, ended, queries }),
    async request(path: string, init?: RequestInit, requestOrigin = origin) {
      const pending: Promise<unknown>[] = [];
      const response = await handler.fetch(new Request(requestOrigin + path, init), env, { waitUntil: task => pending.push(task) });
      await Promise.all(pending);
      return response;
    },
  };
}

test('every registered sticker image and thumbnail has its exact content hash and stays outside the build fast path', async t => {
  assert.ok(stickerPaths.length > 0);
  assert.equal(new Set(stickerPaths).size, FREETWAI_STICKERS.length * 2);
  for (const path of stickerPaths) {
    const hash = path.match(/^\/art\/chat\/[^/]+\/[^/]+-([a-f0-9]{12})\.webp$/)?.[1];
    assert.ok(hash, path);
    const bytes = await readFile(new URL('../../apps/portal-web/public' + path, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex').slice(0, 12), hash, path);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', path);
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP', path);
    assert.equal(isHashedBuildAsset(path), false, path);
    assert.equal(isFastPathBuildAsset(path), false, path);
  }
  t.diagnostic(`${FREETWAI_STICKERS.length} registered stickers, ${stickerPaths.length} distinct image/thumbnail files verified`);
});

test('Worker mounted assets cache every registered sticker for GET and HEAD, including ordinary query strings', async () => {
  const app = mountedAssets({ async fetch(request) {
    return new Response(request.method === 'HEAD' ? null : new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'untrusted' } });
  } });
  for (const path of stickerPaths) for (const method of ['GET', 'HEAD']) {
    const response = await app.request(origin + path + '?v=fixture', { method });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), IMMUTABLE_ASSET_CACHE_CONTROL, `${method} ${path}`);
    assertSecurity(response, path);
    assert.equal((await response.arrayBuffer()).byteLength, method === 'HEAD' ? 0 : 3);
  }
});

test('Worker sticker 200/206/304 responses retain validators and security through the full app, without using the fast path', async () => {
  for (const path of stickerVariants) for (const method of ['GET', 'HEAD']) for (const status of [200, 206, 304]) {
    const worker = stickerWorker({ async fetch(request) {
      assert.equal(new URL(request.url).pathname, path);
      assert.equal(request.headers.get('if-none-match'), '"sticker"');
      assert.equal(request.headers.get('range'), 'bytes=0-1');
      return new Response(method === 'HEAD' || status === 304 ? null : new Uint8Array([1, 2]), { status, headers: {
        'Content-Type': 'IMAGE/WEBP; charset=binary', ETag: '"sticker"', 'Last-Modified': 'Wed, 21 Oct 2015 07:28:00 GMT',
        'Cache-Control': 'untrusted', 'Set-Cookie': 'bad=1', 'Content-Security-Policy': 'unsafe',
        'X-Content-Type-Options': 'unsafe', 'Referrer-Policy': 'unsafe',
        ...(status === 206 ? { 'Content-Range': 'bytes 0-1/3', 'Accept-Ranges': 'bytes' } : {}),
      } });
    } });
    const response = await worker.request(path, { method, headers: { 'If-None-Match': '"sticker"', Range: 'bytes=0-1' } });
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), IMMUTABLE_ASSET_CACHE_CONTROL, `${method} ${status} ${path}`);
    assert.equal(response.headers.get('etag'), '"sticker"');
    assert.equal(response.headers.get('last-modified'), 'Wed, 21 Oct 2015 07:28:00 GMT');
    assert.equal(response.headers.get('set-cookie'), null);
    assertSecurity(response, path);
    if (status === 206) assert.equal(response.headers.get('content-range'), 'bytes 0-1/3');
    assert.equal((await response.arrayBuffer()).byteLength, method === 'HEAD' || status === 304 ? 0 : 2);
    assert.deepEqual(worker.counts(), { runtimes: 1, apps: 1, ended: 1, queries: 0 });
  }
});

test('Worker known sticker URLs reject non-WebP MIME, unsuccessful statuses and shell fallback for immutable caching', async () => {
  for (const path of stickerVariants) for (const method of ['GET', 'HEAD']) {
    for (const contentType of [undefined, 'text/html', 'text/plain', 'application/json', 'image/png', 'image/webp-unsafe', 'image/webp, text/html']) {
      for (const status of [200, 206, 304]) {
        const app = mountedAssets({ async fetch() {
          return new Response(method === 'HEAD' || status === 304 ? null : new Uint8Array([1]), { status, headers: {
            ...(contentType ? { 'Content-Type': contentType } : {}), 'Cache-Control': IMMUTABLE_ASSET_CACHE_CONTROL,
          } });
        } });
        const response = await app.request(origin + path, { method });
        assert.equal(response.status, status);
        assert.equal(response.headers.get('cache-control'), 'no-store', `${method} ${status} ${contentType}`);
        await response.arrayBuffer();
      }
    }
    for (const status of [201, 204, 301, 302, 400, 403, 404, 416, 500, 503]) {
      const app = mountedAssets({ async fetch() {
        return new Response(null, { status, headers: { 'Content-Type': 'image/webp', 'Cache-Control': IMMUTABLE_ASSET_CACHE_CONTROL } });
      } });
      const response = await app.request(origin + path, { method });
      assert.equal(response.status, status);
      assert.equal(response.headers.get('cache-control'), 'no-store', `${method} ${status}`);
    }
    // Even a successful WebP-looking shell is not the directly requested file.
    for (const shellType of ['text/html', 'image/webp']) {
      const seen: string[] = [];
      const app = mountedAssets({ async fetch(request) {
        const requested = new URL(request.url).pathname;
        seen.push(requested);
        return new Response(null, { status: requested === '/' ? 200 : 404, headers: {
          'Content-Type': shellType, 'Cache-Control': IMMUTABLE_ASSET_CACHE_CONTROL,
        } });
      } });
      const response = await app.request(origin + path, { method });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(seen, [path, '/']);
    }
  }
});

test('Worker exact sticker allowlist excludes lookalikes, fixed atlas, private image paths and non-read methods', async () => {
  let fetched = 0;
  const app = mountedAssets({ async fetch() {
    fetched++;
    return new Response(null, { headers: { 'Content-Type': 'image/webp', 'Cache-Control': IMMUTABLE_ASSET_CACHE_CONTROL } });
  } });
  for (const path of unregisteredPaths) for (const method of ['GET', 'HEAD']) {
    const response = await app.request(origin + path, { method });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store', path);
  }
  const reads = fetched;
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = await app.request(origin + stickerVariants[0], { method });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'no-store', method);
  }
  assert.equal(fetched, reads);
});

test('Worker sticker requests retain host, readiness, cookie and private-route guards before asset delivery', async () => {
  for (const mode of ['host', 'readiness', 'cookie', 'private'] as const) {
    let fetched = 0;
    const worker = stickerWorker({ async fetch() { fetched++; return new Response(null, { headers: { 'Content-Type': 'image/webp' } }); } });
    if (mode === 'host') worker.env.APP_ORIGIN = 'http://localhost:8787';
    if (mode === 'readiness') {
      worker.env.FREEDOM_ENV = 'staging';
      worker.env.APP_ORIGIN = 'https://staging-next.freetwai.com';
      worker.env.FREEDOM_RELEASE_SHA = 'a'.repeat(40);
      worker.env.FREEDOM_DATABASE_NAME = 'fixture';
    }
    const response = await worker.request(mode === 'private' ? privateImage : stickerVariants[0], mode === 'cookie'
      ? { headers: { Cookie: 'freedom_local_session=a; freedom_local_session=b' } } : undefined, mode === 'readiness' ? worker.env.APP_ORIGIN : origin);
    assert.equal(response.status, mode === 'readiness' ? 503 : mode === 'private' ? 401 : 403, mode);
    assert.match(response.headers.get('cache-control') ?? '', /no-store/, mode);
    assert.equal(fetched, 0, mode);
    assert.equal(worker.counts().queries, mode === 'readiness' ? 1 : 0, mode);
  }
});

function nodeAssets(root: string) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    for (const [key, value] of Object.entries(platformResponseHeaders(c.req.path))) c.header(key, value);
    await next();
  });
  app.use('*', serveBuildAssets(root));
  app.get('*', serveStatic({ path: join(root, 'index.html') }));
  return app;
}

test('Node serves every registered image and thumbnail with immutable GET/HEAD responses and exact bytes', async () => {
  const app = nodeAssets(new URL('../../apps/portal-web/public/', import.meta.url).pathname);
  for (const path of stickerPaths) for (const method of ['GET', 'HEAD']) {
    const response = await app.request(origin + path + '?v=fixture', { method });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/webp');
    assert.equal(response.headers.get('cache-control'), IMMUTABLE_ASSET_CACHE_CONTROL, `${method} ${path}`);
    assertSecurity(response, path);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(bytes, method === 'HEAD' ? Buffer.alloc(0) : await readFile(new URL('../../apps/portal-web/public' + path, import.meta.url)));
  }
});

test('Node sticker ranges, conditional requests, non-read methods and nonregistered files retain their response rules', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fp-sticker-cache-'));
  try {
    for (const path of [...stickerVariants, ...unregisteredPaths.filter(path => !path.startsWith(stickerVariants[0] + '/'))]) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), 'fixture-image');
    }
    await writeFile(join(root, 'index.html'), '<html>shell</html>');
    const app = nodeAssets(root);
    for (const path of stickerVariants) {
      for (const [range, status] of [['bytes=0-2', 206], ['bytes=999-1000', 416]] as const) {
        const response = await app.request(origin + path, { headers: { Range: range } });
        assert.equal(response.status, status);
        assert.equal(response.headers.get('cache-control'), status === 206 ? IMMUTABLE_ASSET_CACHE_CONTROL : 'no-store');
        assert.equal(response.headers.get('content-range'), status === 206 ? 'bytes 0-2/13' : 'bytes */13');
        assert.equal(await response.text(), status === 206 ? 'fix' : '');
      }
      for (const method of ['GET', 'HEAD']) {
        // The installed Node static adapter does not implement 304; retain its 200 behavior.
        const response = await app.request(origin + path, { method, headers: { 'If-Modified-Since': new Date().toUTCString() } });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), IMMUTABLE_ASSET_CACHE_CONTROL);
        assert.ok(response.headers.get('last-modified'));
        await response.arrayBuffer();
      }
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
        const response = await app.request(origin + path, { method });
        assert.equal(response.headers.get('cache-control'), 'no-store', method);
        await response.arrayBuffer();
      }
    }
    for (const path of unregisteredPaths) for (const method of ['GET', 'HEAD']) {
      const response = await app.request(origin + path, { method });
      assert.equal(response.headers.get('cache-control'), 'no-store', `${method} ${path}`);
      await response.arrayBuffer();
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Node known sticker URLs cannot cache a missing-file shell or a directory index HTML response', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fp-sticker-fallback-'));
  try {
    await writeFile(join(root, 'index.html'), '<html>shell</html>');
    // A directory with a registered .webp name resolves to an HTML index in the real adapter.
    await mkdir(join(root, stickerVariants[0]), { recursive: true });
    await writeFile(join(root, stickerVariants[0], 'index.html'), '<html>directory</html>');
    const app = nodeAssets(root);
    for (const path of stickerVariants) for (const method of ['GET', 'HEAD']) {
      const response = await app.request(origin + path, { method });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /text\/html/);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(await response.text(), method === 'HEAD' ? '' : path === stickerVariants[0] ? '<html>directory</html>' : '<html>shell</html>');
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
