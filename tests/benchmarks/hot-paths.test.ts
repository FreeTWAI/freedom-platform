import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createPlatformApp } from '../../apps/platform-api/src/platform-app.js';
import { createPool } from '../../packages/db/index.js';

test('createPlatformApp performance benchmark', async (t) => {
  const pool = createPool();
  const runtime = {
    commerceQueryTransport: undefined,
    commercePayments: { gateway: undefined },
    commerceSettings: { checkoutEnabled: false },
    allowedHosts: new Set(['127.0.0.1']),
    githubMetricsToken: () => 'token',
    githubTokenKey: () => 'token_key',
    publicGuideAssets: { find: () => null },
    tenantListCursors: { encode: () => '', decode: () => null }
  } as any;
  const iterations = 100;

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    createPlatformApp(pool, 'http://127.0.0.1:4310', 'local', runtime);
  }
  const end = performance.now();
  const elapsed = end - start;

  t.diagnostic(`createPlatformApp x ${iterations} took ${elapsed.toFixed(2)}ms (${(elapsed / iterations).toFixed(2)}ms per iter)`);
  assert.ok(elapsed / iterations < 50, 'createPlatformApp should be fast');

  await pool.end();
});
