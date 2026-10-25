import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
// Execute the actual editor cancel handler, with explicit layout/focus ports.
// These are not jsdom geometry or browser accessibility assertions; E2E covers
// the native details/summary layout and focus behavior separately.
const source = readFileSync('apps/portal-web/src/modules/PositioningPanels.tsx', 'utf8');
const editors = [...source.matchAll(/<form id="secondary-guild-editor"[\s\S]*?<\/form>/g)];
assert.equal(editors.length, 1, 'fail closed when the editor source boundary changes');
const handlers = [...editors[0][0].matchAll(/onClick=\{(cancelSecondaryEditor|\(\)=>setEditing\(false\))\}>取消<\/button>/g)];
assert.equal(handlers.length, 1, 'fail closed when the cancel handler boundary changes');
const declarations = [...source.matchAll(/  function cancelSecondaryEditor\(\)\{[\s\S]*?\n  \}/g)];
assert.equal(declarations.length, handlers[0][1] === 'cancelSecondaryEditor' ? 1 : 0);
const compiled = `${declarations[0]?.[0] ?? ''}\nreturn (${handlers[0][1]});`;
type FocusPort = { isConnected: boolean; visibility: string; getClientRects(): unknown[]; closest(selector: string): { open: boolean }; focus(): void };
function run(triggerState: 'visible' | 'closed' | 'collapsed-with-rect' | 'missing' | 'disconnected', summaryState = 'visible') {
  const events: string[] = [];
  const element = (name: string, state: string): FocusPort => ({ isConnected: state !== 'disconnected', visibility: state === 'hidden' ? 'hidden' : 'visible', getClientRects: () => state === 'closed' ? [] : [{}], closest: (selector: string) => { assert.equal(selector, 'details'); return { open: state !== 'closed' && state !== 'collapsed-with-rect' }; }, focus: () => events.push(name) });
  const trigger = triggerState === 'missing' ? null : element('trigger', triggerState);
  const summary = element('summary', summaryState);
  const handler = new Function('setEditing', 'secondaryTriggerRef', 'toolsSummaryRef', 'getComputedStyle', compiled)(
    (editing: boolean) => { assert.equal(editing, false); events.push('close'); },
    { current: trigger }, { current: summary }, (node: FocusPort) => ({ visibility: node.visibility }),
  );
  handler();
  return events;
}

test('secondary editor cancel restores its visible settings trigger', () => {
  assert.deepEqual(run('visible'), ['close', 'trigger']);
});
test('secondary editor cancel uses the visible summary when tools are collapsed or the trigger disappeared', () => {
  for (const state of ['closed', 'collapsed-with-rect', 'missing', 'disconnected'] as const) assert.deepEqual(run(state), ['close', 'summary']);
});
test('secondary editor cancel never focuses a hidden or disconnected fallback', () => {
  for (const state of ['closed', 'hidden', 'disconnected']) assert.deepEqual(run('missing', state), ['close']);
});
