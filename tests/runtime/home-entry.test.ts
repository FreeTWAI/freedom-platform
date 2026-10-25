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

// Render the real shared navigation without a browser or any member data.
// Browser focus, viewport fitting and history have separate E2E coverage.
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Navigation} from '../../apps/portal-web/src/Navigation.js';
import {interfaceText} from '../../apps/portal-web/src/language.js';
import {TAB_TITLES} from '../../apps/portal-web/src/features/metadata.js';

for (const personalContentEnabled of [false, true]) test(`personal space is the single primary personal entry, content capability ${personalContentEnabled}`, () => {
  const html=renderToStaticMarkup(createElement(Navigation, {
    current:'my-content',onSelect:()=>{},canManageGuild:false,guildLaunchpadEnabled:false,
    communitySearchEnabled:false,personalContentEnabled,mobileOpen:false,
  }));
  const primary=html.split('<div class="nav-primary">')[1].split('</div>')[0];
  assert.match(primary,/我的個人空間/);
  assert.doesNotMatch(primary,/我的內容/);
  assert.equal((primary.match(/aria-current="page"/g)??[]).length,1);
  assert.match(primary,/aria-current="page"[^>]*>.*?我的個人空間/);
  assert.doesNotMatch(html,/mobile-nav-backdrop/);
});

test('getting-started display label retains the todos route key in all interface languages',()=>{
  assert.equal(TAB_TITLES.todos,'入門指南');
  for(const language of ['zh-Hant','en','ja','ko','es'] as const)assert.ok(interfaceText(language,'nav.todos'));
  assert.equal(interfaceText('zh-Hant','nav.todos'),'入門指南');
});
