import assert from 'node:assert/strict';
import {test} from 'node:test';
import {activateHomeLink} from '../../apps/portal-web/src/brand-home-link.js';

type HomeLinkEvent = Parameters<typeof activateHomeLink>[0];

function linkEvent(overrides: Partial<HomeLinkEvent> = {}) {
  const calls: string[] = [];
  const event: HomeLinkEvent = {
    button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    defaultPrevented: false,
    preventDefault() {calls.push('preventDefault'); this.defaultPrevented = true;},
    ...overrides,
  };
  return {event, calls};
}

test('ordinary home-link activation prevents native navigation before consulting app navigation', () => {
  const {event, calls} = linkEvent();
  activateHomeLink(event, () => {
    assert.equal(event.defaultPrevented, true);
    calls.push('navigate');
  });
  assert.deepEqual(calls, ['preventDefault', 'navigate']);
});

for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const) {
  test(`home link preserves native ${modifier} activation without calling app navigation`, () => {
    const {event, calls} = linkEvent({[modifier]: true});
    activateHomeLink(event, () => calls.push('navigate'));
    assert.equal(event.defaultPrevented, false);
    assert.deepEqual(calls, []);
  });
}

for (const button of [1, 2]) {
  test(`home link preserves native mouse button ${button} activation`, () => {
    const {event, calls} = linkEvent({button});
    activateHomeLink(event, () => calls.push('navigate'));
    assert.equal(event.defaultPrevented, false);
    assert.deepEqual(calls, []);
  });
}

test('an already-cancelled home-link activation does not navigate or cancel again', () => {
  const {event, calls} = linkEvent({defaultPrevented: true});
  activateHomeLink(event, () => calls.push('navigate'));
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(calls, []);
});
