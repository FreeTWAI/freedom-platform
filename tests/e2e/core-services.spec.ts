import { test, expect } from './fixtures.js';
import { serve } from '@hono/node-server';
import { createPlatformApp } from '../../apps/platform-api/src/platform-app.js';
import { nodeRuntime } from '../../apps/platform-api/src/app.js';
import { readFile } from 'node:fs/promises';

let server: ReturnType<typeof serve>;
let port: number;
let ephemeralOrigin: string;

test.describe.serial('freedom-platform core services', () => {
  // Test 1: In-process App initialization
  test.beforeAll(async ({ e2eAuthPool }) => {
    // Spin up the app in-process on an ephemeral port
    const origin = 'http://127.0.0.1:0';
    const runtime = nodeRuntime('local', origin, {});
    const app = createPlatformApp(e2eAuthPool, origin, 'local', runtime, {});
    server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    // wait for it to listen
    await new Promise<void>((resolve, reject) => {
       server.on('listening', () => resolve());
    });
    const address = server.address() as import('node:net').AddressInfo;
    port = address.port;
    ephemeralOrigin = `http://127.0.0.1:${port}`;
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
    expect(data.mode).toBeDefined();
    expect(data.version).toBeDefined();
  });

  test('routing: /api/v1/protocol returns valid metadata', async ({ request }) => {
    const response = await request.get(`${ephemeralOrigin}/api/v1/protocol`);
    expect(response.status()).toBe(200);
    const data = await response.json();
    const metadata = JSON.parse(await readFile('contracts/preview/v1/metadata.json', 'utf8'));
    expect(data.protocol).toBe(metadata.protocol);
    expect(data.revision).toBe(metadata.revision);
  });

  test('routing: /api/v1/site returns site configuration', async ({ request }) => {
    const response = await request.get(`${ephemeralOrigin}/api/v1/site`);
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.brand).toBe('自由工坊');
  });

  test('routing: unknown api routes return 401 login_required and 404 with custom payload', async ({ request }) => {
    // Protected member boundaries return 401 when missing auth
    const response401 = await request.get(`${ephemeralOrigin}/api/v1/unknown-route-12345`);
    expect(response401.status()).toBe(401);
    const data401 = await response401.json();
    expect(data401.code).toBe('login_required');

    // Completely unknown fallback
    const response404 = await request.get(`${ephemeralOrigin}/api/unknown-route-12345`);
    expect(response404.status()).toBe(404);
    const data = await response404.json();
    expect(data.code).toBe('not_found');
    expect(data.detail).toContain('此版本尚未提供這個 API');
  });

  test('lifecycle events: gracefully shutdown app is successful', async () => {
     expect(server).toBeDefined();
     await new Promise<void>((resolve, reject) => {
       server.close((err: any) => (err ? reject(err) : resolve()));
     });
     server = null as any; // Clear so afterAll doesn't try to close it again.
  });
});
