import { test, expect } from './fixtures.js';
import { serve } from '@hono/node-server';
import { readFileSync } from 'node:fs';
import { createPlatformApp } from '../../apps/platform-api/src/platform-app.js';
import { nodeRuntime } from '../../apps/platform-api/src/app.js';

let server: ReturnType<typeof serve> | undefined;
let ephemeralOrigin: string;

test.describe.serial('freedom-platform core services', () => {
  // Test 1: In-process App initialization
  test.beforeAll(async ({ e2eAuthPool }) => {
    // Spin up the app in-process on an ephemeral port
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
    // Ensure shutdown is always called even if the shutdown test itself was skipped/failed
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });

  test('core service initialization: /api/v1/health returns status ok', async ({ request }) => {
    const response = await request.get(`${ephemeralOrigin}/api/v1/health`);
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('ok');
    expect(data.mode).toBe('local');
    const packageMetadata = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(data.version).toBe(packageMetadata.version);
  });

  test('routing: /api/v1/protocol returns valid metadata', async ({ request }) => {
    const response = await request.get(`${ephemeralOrigin}/api/v1/protocol`);
    expect(response.status()).toBe(200);
    const data = await response.json();
    const metadata = JSON.parse(readFileSync(new URL('../../contracts/preview/v1/metadata.json', import.meta.url), 'utf8'));
    expect(data.protocol).toBe(metadata.protocol);
    expect(data.revision).toBe(metadata.revision);
  });

  test('routing: /api/v1/site returns site configuration', async ({ request }) => {
    const response = await request.get(`${ephemeralOrigin}/api/v1/site`);
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.brand).toBe('自由工坊');
  });

  test('routing: unknown api routes retain the member boundary and custom 404 payload', async ({ request }) => {
    const memberResponse = await request.get(`${ephemeralOrigin}/api/v1/unknown-route-12345`);
    expect(memberResponse.status()).toBe(401);
    expect((await memberResponse.json()).code).toBe('login_required');

    // An unknown API path outside the member prefix reaches the JSON fallback.
    const response = await request.get(`${ephemeralOrigin}/api/unknown-route-12345`);
    expect(response.status()).toBe(404);
    const data = await response.json();
    expect(data.code).toBe('not_found');
    expect(data.detail).toContain('此版本尚未提供這個 API');
  });

  test('lifecycle events: gracefully shutdown app is successful', async () => {
    expect(server).toBeDefined();
    const listener = server!;
    await new Promise<void>((resolve, reject) => {
      listener.close(error => error ? reject(error) : resolve());
    });
    expect(listener.listening).toBe(false);
    server = undefined; // Clear so afterAll doesn't try to close it again.
  });
});
