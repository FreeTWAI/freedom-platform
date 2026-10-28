import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('../e2e/storefront-payment.spec.ts', import.meta.url), 'utf8');
const b07 = source.slice(source.indexOf("test('7. B07"), source.indexOf("test('9, 11, 12"));
const orderApiUrl = 'http://127.0.0.1:4311/api/v1/public/stores/synthetic/orders/order-1';

type Response = { url(): string; request(): { method(): string }; finished(): Promise<Error | null> };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

// Execute the spec's actual waiter, without importing its browser/DB fixtures.
function observerHarness(waiterSource = b07) {
  const start = waiterSource.indexOf('const waitForOrderReread = async () => {');
  assert.notEqual(start, -1);
  const end = waiterSource.indexOf('\n  };', start);
  assert.notEqual(end, -1);
  const responseReady = deferred<Response>();
  let predicate: ((response: Response) => boolean) | undefined;
  const page = {
    waitForResponse(match: (response: Response) => boolean) {
      assert.equal(predicate, undefined, 'one subscription per action');
      predicate = match;
      return responseReady.promise;
    },
  };
  const expect = (value: unknown) => ({ toBeNull: () => assert.equal(value, null) });
  const wait = new Function('page', 'orderApiUrl', 'expect',
    `${waiterSource.slice(start, end + '\n  };'.length)}; return waitForOrderReread;`,
  )(page, orderApiUrl, expect) as () => Promise<void>;
  return {
    wait,
    emit(response: Response) {
      assert.ok(predicate, 'subscription must exist before the action emits its response');
      if (!predicate(response)) return false;
      responseReady.resolve(response);
      return true;
    },
  };
}

function response(url: string, method: string, finished: Promise<Error | null>): Response {
  return { url: () => url, request: () => ({ method: () => method }), finished: () => finished };
}

async function completionBarrier(waiterSource = b07) {
  const harness = observerHarness(waiterSource);
  const finished = deferred<Error | null>();
  let completed = false;
  const waiting = harness.wait().then(() => { completed = true; });
  // Alert visibility alone does not supply a response, nor complete its body.
  await Promise.resolve();
  assert.equal(completed, false);
  for (const [url, method] of [
    [orderApiUrl, 'POST'], [orderApiUrl + '/payment-handoffs', 'POST'],
    [orderApiUrl + '/payment-queries', 'POST'], [orderApiUrl + '-other', 'GET'],
    [orderApiUrl + '?unrelated=1', 'GET'], [orderApiUrl.replace('127.0.0.1', 'localhost'), 'GET'],
  ]) assert.equal(harness.emit(response(url, method, Promise.resolve(null))), false);
  assert.equal(harness.emit(response(orderApiUrl, 'GET', finished.promise)), true);
  // Drain promise continuations, not wall-clock time or a count polling loop.
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(completed, false, 'response headers are not reread completion');
  finished.resolve(null);
  await waiting;
  assert.equal(completed, true);
}

test('B07 exact order GET waiter ignores unrelated traffic and awaits response completion', async () => {
  await completionBarrier();
});

test('B07 failed response completion is not accepted as a completed reread', async () => {
  const harness = observerHarness();
  const waiting = harness.wait();
  const rejected = assert.rejects(waiting, /Expected values to be strictly equal/);
  harness.emit(response(orderApiUrl, 'GET', Promise.resolve(new Error('synthetic transfer failure'))));
  await rejected;
});

test('negative control: removing response.finished await exposes the completion race', async () => {
  const mutant = b07.replace('expect(await response.finished()).toBeNull();', '');
  assert.notEqual(mutant, b07);
  await assert.rejects(completionBarrier(mutant), /response headers are not reread completion/);
});

const outcomes = [
  ['// 1. refused: checkout_hold_expired', 'repayBtn', '2'],
  ['// 2–6. refused codes that re-read the order', 'repayBtn', 'beforeGets + 1'],
  ['// 7. pending: hides', 'repayBtn', 'beforeGets + 1'],
  ['// 1. pending on queryPayment', 'queryBtn', 'beforeGets + 1'],
  ['// 2. refused checkout_not_enabled on queryPayment', 'queryBtn', 'beforeGets + 1'],
] as const;

for (const [marker, button, count] of outcomes) {
  const start = b07.indexOf(marker);
  assert.notEqual(start, -1);
  const end = b07.indexOf('\n  // ', start + marker.length);
  const block = b07.slice(start, end);
  function assertWiring(candidate: string) {
    const arm = candidate.indexOf('const orderReread = waitForOrderReread();');
    const click = candidate.indexOf(`await ${button}.click();`);
    const alert = candidate.indexOf("getByRole('alert')", click);
    const complete = candidate.indexOf('await orderReread;');
    const exactCount = candidate.indexOf(`expect(getOrderCount).toBe(${count});`);
    assert.ok(arm >= 0 && click > arm && alert > click && complete > alert && exactCount > complete,
      'arm before click; retain alert; complete reread before unchanged exact count');
  }
  test(`B07 observer wiring and negative controls: ${marker}`, () => {
    assertWiring(block);
    assert.throws(() => assertWiring(block.replace('await orderReread;', '')), /arm before click/);
    const late = block.replace('const orderReread = waitForOrderReread();', '')
      .replace(`await ${button}.click();`, `await ${button}.click(); const orderReread = waitForOrderReread();`);
    assert.throws(() => assertWiring(late), /arm before click/);
    assert.throws(() => assertWiring(block.replace(`toBe(${count})`, `toBeGreaterThanOrEqual(${count})`)), /arm before click/);
  });
}
