import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withSendLimit } from '../../apps/platform-api/src/mail-send-limit.js';
import { readWorkerConfig, workerRuntime, type WorkerEnv } from '../../apps/platform-api/src/worker.js';
import {
  isPermanentCommerceEmailError,
  mapCommerceEmailErrorCode,
} from '../../modules/agent-commerce/operations/notifications/email-port.js';

test('withSendLimit rejects a hanging send with code mail_send_timeout after ms', async () => {
  const limited = withSendLimit(async () => new Promise<void>(() => {}), 50);
  await assert.rejects(
    () => limited(),
    (err: unknown) => err instanceof Error && (err as Error & { code?: unknown }).code === 'mail_send_timeout',
  );
});

test('withSendLimit preserves fulfilled values and immediate errors', async () => {
  const ok = withSendLimit(async (value: string) => `ok:${value}`, 50);
  assert.equal(await ok('a'), 'ok:a');

  const boom = new Error('provider down');
  const fail = withSendLimit(async () => { throw boom; }, 50);
  await assert.rejects(() => fail(), (err: unknown) => err === boom);
});

test('mail_send_timeout maps to a temporary commerce email error', () => {
  const code = mapCommerceEmailErrorCode({ code: 'mail_send_timeout' });
  assert.equal(code, 'mail_send_timeout');
  assert.equal(isPermanentCommerceEmailError(code), false);
});

test('workerRuntime wraps password, event, and commerce senders with a 10s send limit', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const env: WorkerEnv = {
    HYPERDRIVE: { connectionString: 'postgres://user:pass@127.0.0.1:5432/db' },
    ASSETS: { async fetch() { return new Response('', { status: 404 }); } },
    FREEDOM_ENV: 'local',
    APP_ORIGIN: 'http://127.0.0.1:8787',
    FREEDOM_PASSWORD_RESET_EMAIL_ENABLED: 'true',
    FREEDOM_COMMERCE_EMAIL_ENABLED: 'true',
    EMAIL: { send: () => new Promise(() => {}) },
    COMMERCE_JOURNAL: {
      async get() { return null; },
      async put() { return null as any; },
    },
  } as any;
  const runtime = workerRuntime(env, readWorkerConfig(env));
  assert.ok(runtime.passwordEmailSender);
  assert.ok(runtime.eventEmailSender);
  assert.ok(runtime.commerceEmailSender);

  const p1 = runtime.passwordEmailSender('a@example.test', 'https://example.test/reset');
  const p2 = runtime.eventEmailSender('b@example.test', 'Subject', 'Body');
  const p3 = runtime.commerceEmailSender.send({ to: 'c@example.test', subject: 'S', text: 'T', replyTo: null });

  t.mock.timers.tick(10_000);

  await assert.rejects(p1, (e: unknown) => e instanceof Error && (e as { code?: unknown }).code === 'mail_send_timeout');
  await assert.rejects(p2, (e: unknown) => e instanceof Error && (e as { code?: unknown }).code === 'mail_send_timeout');
  await assert.rejects(p3, (e: unknown) => e instanceof Error && (e as { code?: unknown }).code === 'mail_send_timeout');
});
