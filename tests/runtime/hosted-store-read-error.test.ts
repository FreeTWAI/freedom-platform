import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ApiError, type PortalClient} from '../../apps/portal-web/src/api';
import {isMissingStoreRead, readStoreRoot, StoreRootReadError} from '../../apps/portal-web/src/modules/hosted-store-read-error';

function client(get: (path: string, options?: {signal?: AbortSignal}) => Promise<unknown>) {
  return {get} as Pick<PortalClient, 'get'>;
}

test('root success followed by each required child 404 stays recoverable', async () => {
  for (const child of ['/products', '/preview', '/appearance', '/product-media', '/product-galleries', '/publication-review']) {
    const failure = new ApiError({message: 'Child unavailable', status: 404});
    const signal = new AbortController().signal;
    const calls: string[] = [];
    const api = client(async (path, options) => {
      calls.push(path); assert.equal(options?.signal, signal);
      if (path === '/store') return {setup_state: 'ready'};
      throw failure;
    });
    assert.deepEqual(await readStoreRoot(api, '/store', signal), {setup_state: 'ready'});
    await assert.rejects(api.get('/store' + child, {signal}), cause => {
      assert.equal(cause, failure);
      assert.equal(isMissingStoreRead(cause, false), false);
      return true;
    });
    assert.deepEqual(calls, ['/store', '/store' + child]);
  }
});

test('root 404 alone means missing, unless a photo operation is unresolved', async () => {
  const failure = new ApiError({message: 'Missing', status: 404});
  await assert.rejects(readStoreRoot(client(async () => {throw failure;}), '/store', new AbortController().signal), cause => {
    assert.ok(cause instanceof StoreRootReadError);
    assert.equal(cause.cause, failure);
    assert.equal(isMissingStoreRead(cause, false), true);
    assert.equal(isMissingStoreRead(cause, true), false);
    return true;
  });
});

test('other root failures preserve original cause and never mean missing', async () => {
  for (const failure of [new ApiError({message: 'Unavailable', status: 503}), new ApiError({message: 'Forbidden', status: 403}), new Error('Invalid data'), new DOMException('Aborted', 'AbortError')]) {
    await assert.rejects(readStoreRoot(client(async () => {throw failure;}), '/store', new AbortController().signal), cause => {
      assert.ok(cause instanceof StoreRootReadError);
      assert.equal(cause.cause, failure);
      assert.equal(isMissingStoreRead(cause, false), false);
      return true;
    });
  }
  assert.equal(isMissingStoreRead({status: 404}, false), false);
});
