import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseOptions, scalarSample, collectSample, makeReport, main} from './measure-route-readiness.mjs';

const args = ['--base-url', 'https://example.test', '--output', 'sample.json', '--authorized'];

test('requires explicit target, new output and operator intent; no environment defaults', async () => {
  for (const input of [[], args.slice(0, -1), ['--authorized'], ['--base-url', '--authorized'], [...args, '--unknown'], [...args, '--authorized']]) {
    assert.throws(() => parseOptions(input));
  }
  await assert.rejects(main([])); // Returns before importing/launching a browser.
});

test('accepts HTTPS or HTTP loopback origins only, without credentials or URL payloads', () => {
  for (const url of ['https://example.test', 'http://localhost:4311', 'http://127.0.0.1:4311', 'http://[::1]:4311']) {
    assert.equal(parseOptions([args[0], url, ...args.slice(2)]).baseUrl, new URL(url).origin);
  }
  for (const url of ['http://example.test', 'https://name:secret@example.test', 'https://@example.test', 'https://example.test/path', 'https://example.test/?token=secret', 'https://example.test/#private', 'https://example.test/?', 'https://example.test/#', 'file:///tmp/page', 'not-a-url']) {
    assert.throws(() => parseOptions([args[0], url, ...args.slice(2)]), /invalid_target/);
  }
  assert.equal(parseOptions(args).warm, false);
  assert.equal(parseOptions([...args, '--warm-interactive']).warm, true);
});

test('copies fixed scalar fields without getters, toJSON, URLs or payloads', () => {
  const input = {heading_ms: 5, ready_frame_ms: 12, response_start_ms: 2, url: 'https://secret.test', cookie: 'credential', payload: 'private', toJSON() {throw Error('must not run');}};
  Object.defineProperty(input, 'request_start_ms', {get() {throw Error('must not run');}});
  const sample = scalarSample('cold_anonymous', 'ready', input);
  assert.deepEqual(sample, {scenario: 'cold_anonymous', outcome: 'ready', heading_ms: 5, ready_frame_ms: 12, request_start_ms: null, response_start_ms: 2, response_end_ms: null, fcp_ms: null});
  assert.doesNotMatch(JSON.stringify(makeReport([sample])), /secret|credential|private|url|cookie|payload/);
});

test('rejects invalid readiness and nonfixed outcomes; invalid numeric fields become null', () => {
  for (const input of [null, {heading_ms: 10, ready_frame_ms: 9}, {heading_ms: NaN, ready_frame_ms: 10}]) assert.throws(() => scalarSample('cold_anonymous', 'ready', input));
  assert.throws(() => scalarSample('secret', 'ready', {}));
  assert.throws(() => scalarSample('cold_anonymous', 'secret', {}));
  assert.equal(scalarSample('cold_anonymous', 'failed', {fcp_ms: Infinity, response_end_ms: -1}).fcp_ms, null);
});

test('failure and timeout remain counted, without original error message leakage', async () => {
  const failed = await collectSample('cold_anonymous', async () => {throw Error('credential-private-url');});
  const timed = await collectSample('warm_home_social', async () => {throw Object.assign(Error('private payload'), {name: 'TimeoutError'});});
  const report = makeReport([failed, timed], 'ready');
  assert.equal(report.outcome, 'failed');
  assert.equal(report.attempted, 2);
  assert.equal(report.failed, 2);
  assert.equal(report.ready, 0);
  assert.equal(timed.outcome, 'timeout');
  assert.doesNotMatch(JSON.stringify(report), /credential|private|payload/);
});

test('successful operation retains measurements; failed warm setup cannot appear successful', async () => {
  const sample = await collectSample('cold_anonymous', async () => ({heading_ms: 4, ready_frame_ms: 8}));
  assert.equal(makeReport([sample]).outcome, 'ready');
  assert.equal(makeReport([sample], 'timeout').outcome, 'failed');
  assert.equal(makeReport([sample], 'timeout').warm_setup, 'timeout');
  assert.throws(() => makeReport(Array(5).fill(sample)));
});
