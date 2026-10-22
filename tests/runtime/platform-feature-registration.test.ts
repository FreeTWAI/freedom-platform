import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { createApp } from '../../apps/platform-api/src/app.js';

const origin = 'http://127.0.0.1:4310';
type Options = NonNullable<Parameters<typeof createApp>[3]>;

function isolatedApp(options: Options = {}) {
  let databaseCalls = 0;
  const unexpectedDatabaseCall = async () => {
    databaseCalls++;
    throw new Error('Request must stop at the shared boundary before database access');
  };
  const pool = { query: unexpectedDatabaseCall, connect: unexpectedDatabaseCall } as unknown as Pool;
  return { app: createApp(pool, origin, 'local', options), databaseCalls: () => databaseCalls };
}

const enabled: Options = {
  communitySearchEnabled: true, communityRelationsEnabled: true,
  personalContentEnabled: true, firstParticipationEnabled: true,
  notificationPreferencesEnabled: true, eventParticipationEnabled: true,
  guildLaunchpadEnabled: true, supplierConsoleEnabled: true,
};

test('feature composition preserves explicit dependency flags instead of enabling sibling features', () => {
  const registered = (options: Options, method: string, path: string) =>
    isolatedApp(options).app.routes.some(route => route.method === method && route.path === path);
  assert.equal(registered({}, 'GET', '/api/v1/community-search/mine'), false);
  assert.equal(registered({ communitySearchEnabled: true }, 'GET', '/api/v1/community-search/mine'), true);
  assert.equal(registered({ communityRelationsEnabled: true }, 'GET', '/api/v1/community-relations/bookmarks'), false);
  assert.equal(registered({ communitySearchEnabled: true }, 'GET', '/api/v1/community-relations/bookmarks'), false);
  assert.equal(registered(enabled, 'GET', '/api/v1/community-relations/bookmarks'), true);
  assert.equal(registered({}, 'GET', '/api/v1/public/events/:id/calendar'), false);
  assert.equal(registered({ eventParticipationEnabled: true }, 'GET', '/api/v1/public/events/:id/calendar'), true);
  assert.equal(registered({}, 'GET', '/api/v1/me/orders'), false);
  assert.equal(registered({ commerceSettings: { checkoutEnabled: true, quarantine: false, providerProfiles: [] } }, 'GET', '/api/v1/me/orders'), true);
});

test('anonymous member requests cannot reach extracted services, with features enabled or disabled', async () => {
  for (const options of [{}, enabled]) {
    const { app, databaseCalls } = isolatedApp(options);
    for (const path of ['/api/v1/session', '/api/v1/me/totp', '/api/v1/community-search/mine',
      '/api/v1/community-relations/bookmarks', '/api/v1/work-items', '/api/v1/showcases']) {
      const response = await app.request(origin + path);
      const disabled = options !== enabled && (path.startsWith('/api/v1/community-search/') || path.startsWith('/api/v1/community-relations/'));
      assert.equal(response.status, disabled ? 404 : 401, path);
      assert.equal((await response.json()).code, disabled ? 'not_found' : 'login_required', path);
    }
    const logout = await app.request(origin + '/api/v1/auth/logout', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(logout.status, 401);
    assert.equal(databaseCalls(), 0);
  }
});

test('public service availability responses still run without requiring a member session', async () => {
  const { app, databaseCalls } = isolatedApp(enabled);
  for (const [path, code] of [
    ['/api/v1/auth/reset/request', 'password_recovery_unavailable'],
    ['/api/v1/auth/email-change/confirm', 'email_change_unavailable'],
    ['/api/v1/public/events/00000000-0000-4000-8000-000000000000/register', 'event_email_unavailable'],
  ]) {
    const response = await app.request(origin + path, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(response.status, 503, path);
    assert.equal((await response.json()).code, code, path);
  }
  assert.equal(databaseCalls(), 0);
});

test('shared origin and JSON guards precede both public and member feature handlers', async () => {
  const { app, databaseCalls } = isolatedApp(enabled);
  for (const path of ['/api/v1/auth/login', '/api/v1/work-items']) {
    const crossOrigin = await app.request(origin + path, {
      method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(crossOrigin.status, 403, path);
    const malformed = await app.request(origin + path, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{',
    });
    assert.equal(malformed.status, 400, path);
    assert.equal((await malformed.json()).code, 'invalid_json', path);
    const oversized = await app.request(origin + path, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: ' '.repeat(32769),
    });
    assert.equal(oversized.status, 413, path);
  }
  assert.equal(databaseCalls(), 0);
});

test('unknown machine endpoints keep JSON errors and security headers after feature registration', async () => {
  const { app, databaseCalls } = isolatedApp(enabled);
  for (const prefix of ['/api', '/client-api', '/agent-api', '/development-agent', '/shop-api']) {
    const response = await app.request(origin + prefix + '/unregistered-feature');
    assert.equal(response.status, 404, prefix);
    assert.match(response.headers.get('Content-Type') ?? '', /application\/json/);
    assert.equal((await response.json()).code, 'not_found', prefix);
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.match(response.headers.get('Content-Security-Policy') ?? '', /default-src 'self'/);
  }
  assert.equal(databaseCalls(), 0);
});
