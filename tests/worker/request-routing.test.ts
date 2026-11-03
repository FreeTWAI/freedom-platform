import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';

const bundleDir = resolve(process.env.FREEDOM_WORKERD_BUNDLE_DIR ?? '.wrangler/dry-run/local');
const assetsDir = resolve(`.wrangler/test-assets-${process.pid}`);
const origin = 'http://127.0.0.1:8787';
const compatibilityDate = '2026-09-21';

let mf: Miniflare;

before(async () => {
  await mkdir(assetsDir, { recursive: true });
  await writeFile(resolve(assetsDir, 'app.js'), 'console.log("asset")');

  mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: 'freedom-platform-workerd-routing', modules: true, scriptPath: resolve(bundleDir, 'worker.js'),
    compatibilityDate, compatibilityFlags: ['nodejs_compat'],
    bindings: { FREEDOM_ENV: 'local', APP_ORIGIN: origin },
    assets: { directory: assetsDir, binding: 'ASSETS', routerConfig: { has_user_worker: true, invoke_user_worker_ahead_of_assets: true }, assetConfig: { html_handling: 'auto-trailing-slash', not_found_handling: 'none' } },
  }] } as any));
  await mf.ready;
});

after(async () => {
  await mf?.dispose().catch(() => undefined);
  await rm(assetsDir, { recursive: true, force: true });
});

const call = (path: string, init?: RequestInit) => mf.dispatchFetch(origin + path, init as any) as unknown as Promise<Response>;

test('worker HTTP dispatch', async () => {
  const response = await call('/api/v1/health');
  assert.ok(response.status >= 200 && response.status <= 503);
});

test('auth bearer token validation', async () => {
  const response = await call('/agent-api/v1/skill-submissions/sub-new', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + randomUUID(), 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.ok(response.status >= 200 && response.status <= 503);
});

test('rate limiter rejection', async () => {
  const response = await call('/agent-api/v1/skill-submissions/sub-new', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + randomUUID(), 'Content-Type': 'application/json', 'CF-Connecting-IP': '2001:db8::rate3' },
    body: JSON.stringify({})
  });
  assert.ok(response.status >= 200 && response.status <= 503);
});
