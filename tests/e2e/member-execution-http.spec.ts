import { test, expect } from './fixtures.js';
import { serve } from '@hono/node-server';
import { createPlatformApp } from '../../apps/platform-api/src/platform-app.js';
import { nodeRuntime } from '../../apps/platform-api/src/app.js';
import { randomUUID } from 'node:crypto';

let server: ReturnType<typeof serve> | undefined;
let ephemeralOrigin: string;

// The default host does not install the member execution transport. These checks
// cover global cross-site rejection and health, not registration or dispatch.
// Closed metadata creation/replay is covered by tests/runtime/member-execution-http.test.ts.
test.describe.serial('default host health and cross-site member execution boundaries', () => {
  test.beforeAll(async ({ e2eAuthPool }) => {
    const origin = 'http://127.0.0.1:0';
    const runtime = nodeRuntime('local', origin, {});
    const app = createPlatformApp(e2eAuthPool, origin, 'local', runtime, {});

    await new Promise<void>((resolve, reject) => {
      server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, address => {
        ephemeralOrigin = `http://127.0.0.1:${address.port}`;
        resolve();
      });
      server.once('error', reject);
    });
  });

  test.afterAll(async () => {
    if (server) {
      await new Promise<void>(resolve => server!.close(() => resolve()));
    }
  });

  test('cross-site model connection request is rejected by the host', async ({ request }) => {
    const response = await request.post(`${ephemeralOrigin}/api/v1/me/model-connections`, {
      headers: {
        'Idempotency-Key': randomUUID(),
        'If-Match': '"1"',
        'Sec-Fetch-Site': 'cross-site'
      },
      data: {
        connectionId: 'not-an-opaque-id',
        selection: {
          providerRef: 'openrouter',
          modelRef: 'anthropic/claude-3-haiku',
          processingLocation: 'provider_remote',
          credentialCustody: 'local_keychain',
          engineLocation: 'runtime_local',
          billingSource: 'user_byok'
        }
      }
    });

    const data = await response.json();
    expect(response.status()).toBe(403);
    expect(data.code).toBe('origin_rejected');
    expect(response.headers()['cache-control']).toBe('no-store');
  });

  test('serves real local host health', async ({ request }) => {
    const response = await request.get(`${ephemeralOrigin}/api/v1/health`);
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('ok');
    expect(data.mode).toBe('local');
  });

  test('cross-site execution run request is rejected by the host', async ({ request }) => {
    const response = await request.post(`${ephemeralOrigin}/api/v1/me/execution-runs`, {
      headers: {
        'Idempotency-Key': randomUUID(),
        'If-Match': '"1"',
        'Sec-Fetch-Site': 'cross-site'
      },
      data: {
        workId: 'invalid-id-format'
      }
    });

    const data = await response.json();
    expect(response.status()).toBe(403);
    expect(data.code).toBe('origin_rejected');
    expect(response.headers()['cache-control']).toBe('no-store');
  });
});
