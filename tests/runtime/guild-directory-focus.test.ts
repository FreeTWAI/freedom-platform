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

test('public verifier opens the search form advanced filters before selecting them, matching the markup', () => {
  const membership = readFileSync(new URL('../../apps/portal-web/src/modules/Membership.tsx', import.meta.url), 'utf8');
  const forms = [...membership.matchAll(/<form className="directory-filters" role="search" aria-label="尋找工坊夥伴"[^>]*>[\s\S]*?<\/form>/g)];
  assert.equal(forms.length, 1, 'fail closed when the member search form boundary changes');
  const form = forms[0][0];
  const details = [...form.matchAll(/<details className="directory-advanced">[\s\S]*?<\/details>/g)];
  assert.equal(details.length, 1, 'the search form contains one advanced-filter disclosure');
  assert.match(details[0][0], /<summary>[\s\S]*?<\/summary>/, 'the disclosure has a summary');
  for (const name of ['依公會篩選', '排序方式']) {
    assert.match(details[0][0], new RegExp(`<label\\b[^>]*>${name}<select\\b`), `${name} is labelled inside the disclosure`);
  }
  assert.doesNotMatch(form, /className="member-directory/, 'the results container is outside the search form');

  const verifier = readFileSync(new URL('../../scripts/verify-public.mjs', import.meta.url), 'utf8');
  const sections = [...verifier.matchAll(/await navigate\(page, '工坊夥伴'\);([\s\S]*?)await screenshot\('public-member-directory-mobile\.png'\);/g)];
  assert.equal(sections.length, 1, 'fail closed when the member-directory section boundary changes');
  const section = sections[0][1];
  const locators = [...section.matchAll(/const (\w+)=page\.getByRole\('search',\{name:'尋找工坊夥伴',exact:true\}\);/g)];
  assert.equal(locators.length, 1, 'locate the unique member search form by role and accessible name');
  const locator = locators[0][1];
  const click = section.indexOf(`await ${locator}.locator('.directory-advanced > summary').click();`);
  const opened = section.indexOf(`await expect(${locator}.locator('.directory-advanced')).toHaveAttribute('open','');`);
  assert.ok(click > locators[0].index!, 'click the advanced-filter summary within the search form');
  assert.ok(opened > click, 'assert the disclosure is open after clicking its summary');
  for (const name of ['依公會篩選', '排序方式']) {
    const selection = section.search(new RegExp(`await\\s+\\w+\\.getByRole\\('combobox',\\{name:'${name}',exact:true\\}\\)\\.selectOption\\(`));
    assert.ok(selection > opened, `${name} selection must follow the open assertion`);
  }
  assert.doesNotMatch(section, /\.member-directory\s+\.directory-advanced/, 'advanced filters are not descendants of the results container');
});
