import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire,registerHooks} from 'node:module';
import {runInNewContext} from 'node:vm';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformSync} from 'esbuild';
import {PortalClient} from '../../apps/portal-web/src/api.js';
import {resolvePortalRoute} from '../../apps/portal-web/src/portal-route.js';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return {format: 'module', source: 'export default {};', shortCircuit: true};
    return nextLoad(url, context);
  },
});

function loadGuilds(reactMock: Record<string, unknown>) {
  const url = new URL('../../apps/portal-web/src/features/guilds.tsx', import.meta.url);
  const req = createRequire(url);
  const mod = {exports: {} as {guildsFeatures: any}};
  const code = transformSync(readFileSync(url, 'utf8'), {loader: 'tsx', format: 'cjs', jsx: 'automatic'}).code;
  runInNewContext(code, {
    module: mod,
    exports: mod.exports,
    require: (id: string) => {
      if (id === 'react') return reactMock;
      if (id.endsWith('.css')) return {};
      return req(id);
    },
  });
  return mod.exports.guildsFeatures;
}

function makeReactMock(stateOverrides: unknown[] = [], effects: Array<() => void | (() => void)> = []) {
  let stateIndex = 0;
  return {
    ...React,
    lazy: (factory: () => Promise<unknown>) => {
      const tag = factory.toString().includes('SquadOutcomeDetail') ? 'SquadOutcomeDetail' : 'SquadsPanel';
      return () => React.createElement('div', {'data-stub': tag});
    },
    useState: (init: unknown) => {
      const idx = stateIndex++;
      if (idx in stateOverrides) return [stateOverrides[idx], () => {}];
      return [typeof init === 'function' ? (init as () => unknown)() : init, () => {}];
    },
    useEffect: (fn: () => void | (() => void)) => {
      effects.push(fn);
    },
  };
}

function makeContext(locationHash: string, squadOutcomesEnabled: boolean, client = new PortalClient()) {
  return {
    client,
    session: {user: {user_id: 'user-1'}},
    site: {squad_outcomes_enabled: squadOutcomesEnabled, event_outcomes_enabled: false},
    locationHash,
    selectTab: () => {},
    openHomeJournal: () => false,
    friendScope: 'accepted',
    notificationTarget: null,
    headerMember: null,
    registerPageLeave: () => {},
    replaceBuyerLocation: () => {},
    onSessionExpired: () => {},
    openMemberMessage: () => {},
    showIncomingFriends: () => {},
  };
}

test('UX-M-10: #me/teams/outcomes routes to squads tab with #squad-outcomes legacyHash and does not fall through to SquadsPanel', () => {
  const route = resolvePortalRoute('#me/teams/outcomes');
  assert.equal(route.tab, 'squads');
  assert.equal(route.legacyHash, '#squad-outcomes');

  for (const enabled of [false, true]) {
    for (const hash of [route.legacyHash, '#me/teams/outcomes', '#squad-outcomes?from=test']) {
      const guildsFeatures = loadGuilds(makeReactMock());
      const html = renderToStaticMarkup(guildsFeatures.squads.render(makeContext(hash, enabled)));
      assert.equal(html.includes('data-stub="SquadsPanel"'), false, `expected outcomes view instead of SquadsPanel for ${hash} (enabled=${enabled})`);
      assert.match(html, /<h2>小隊成果<\/h2>/);
    }
  }
});

test('UX-M-10: outcomes view renders items with single links and pagination, empty state with 1 primary, and disabled state without calling API', async () => {
  const outcomeId = '11111111-1111-4111-8111-111111111111';
  const item = {
    outcome_id: outcomeId,
    squad_id: '22222222-2222-4222-8222-222222222222',
    squad_name: '開源協作小隊',
    title: '第一份小隊成果',
    summary: '整理好的協作紀錄',
    artifact_url: null,
    author: {user_id: 'user-1', display_name: '林測試'},
    audience: 'community',
    state: 'published',
    aggregate_version: 1,
  };

  // State order in SquadOutcomesList: items, nextOffset, loading, loaded, error
  const populatedEffects: Array<() => void | (() => void)> = [];
  const requestedPaths: string[] = [];
  const fakeClient = Object.assign(new PortalClient(), {
    get: async (path: string) => {
      requestedPaths.push(path);
      return {items: [item], next_offset: 20};
    },
  });
  const populatedGuilds = loadGuilds(makeReactMock([[item], 20, false, true, ''], populatedEffects));
  const populatedHtml = renderToStaticMarkup(populatedGuilds.squads.render(makeContext('#squad-outcomes', true, fakeClient)));
  assert.match(populatedHtml, /第一份小隊成果/);
  assert.equal((populatedHtml.match(new RegExp(outcomeId, 'g')) ?? []).length, 1);
  assert.match(populatedHtml, /href="#me\/teams\/outcomes\/11111111-1111-4111-8111-111111111111"/);
  assert.match(populatedHtml, />更多</);
  assert.match(populatedHtml, />返回小隊</);
  assert.equal((populatedHtml.match(/class="[^"]*\bbtn-primary\b[^"]*"/g) ?? []).length, 0);
  assert.equal(populatedEffects.length > 0, true);
  populatedEffects[0]();
  await Promise.resolve();
  assert.equal(requestedPaths[0], '/me/squad-outcomes?limit=20&offset=0');

  // Empty state (enabled=true, items=[], loaded=true)
  const emptyGuilds = loadGuilds(makeReactMock([[], null, false, true, '']));
  const emptyHtml = renderToStaticMarkup(emptyGuilds.squads.render(makeContext('#squad-outcomes', true)));
  assert.match(emptyHtml, /目前沒有小隊成果/);
  assert.equal((emptyHtml.match(/class="[^"]*\bbtn-primary\b[^"]*"/g) ?? []).length, 1);
  assert.match(emptyHtml, />前往小隊</);

  // Disabled state (enabled=false) must not invoke API
  const disabledCalls: string[] = [];
  const disabledClient = Object.assign(new PortalClient(), {
    get: async (path: string) => {
      disabledCalls.push(path);
      return {items: [], next_offset: null};
    },
  });
  const disabledEffects: Array<() => void | (() => void)> = [];
  const disabledGuilds = loadGuilds(makeReactMock([], disabledEffects));
  const disabledHtml = renderToStaticMarkup(disabledGuilds.squads.render(makeContext('#squad-outcomes', false, disabledClient)));
  for (const fn of disabledEffects) fn();
  assert.equal(disabledCalls.length, 0);
  assert.match(disabledHtml, /目前沒有小隊成果/);
  assert.equal((disabledHtml.match(/class="[^"]*\bbtn-primary\b[^"]*"/g) ?? []).length, 1);

  // Regular #me/teams and detail #squad-outcomes/<uuid> keep existing components
  const regularGuilds = loadGuilds(makeReactMock());
  const squadsHtml = renderToStaticMarkup(regularGuilds.squads.render(makeContext('#squads', true)));
  assert.equal(squadsHtml.includes('data-stub="SquadsPanel"'), true);
  const detailHtml = renderToStaticMarkup(regularGuilds.squads.render(makeContext(`#squad-outcomes/${outcomeId}`, true)));
  assert.equal(detailHtml.includes('data-stub="SquadOutcomeDetail"'), true);
});
