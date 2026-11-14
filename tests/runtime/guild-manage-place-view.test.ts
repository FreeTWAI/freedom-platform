import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createRequire} from 'node:module';
import {transformSync as transformPlace} from 'esbuild';
import {runInNewContext as runPlace} from 'node:vm';
import {readFileSync as readPlace} from 'node:fs';
import type {PortalFeatureContext} from '../../apps/portal-web/src/features/types.js';

const placeUrl = new URL('../../apps/portal-web/src/features/PlaceView.tsx', import.meta.url);
const placeRequire = createRequire(placeUrl);
const placeModule = {exports: {} as any};
runPlace(transformPlace(readPlace(placeUrl, 'utf8'), {loader: 'tsx', format: 'cjs', jsx: 'automatic'}).code, {
  module: placeModule,
  exports: placeModule.exports,
  require: (id: string) => id === '../frame-tools/RegisteredTools' ? {RegisteredTools: () => null} : placeRequire(id),
});
const PlaceView = placeModule.exports.PlaceView;

test('PlaceView renders guild management button and tool directory on #guilds but not on #guilds/manage (UX-G-05)', () => {
  const manageContext = {
    locationHash: '#guilds/manage',
    site: null,
    canManageGuild: true,
    canManagePlatform: false,
    selectTab() {},
  } as unknown as PortalFeatureContext;

  let manageTab = '';
  const manageHtml = renderToStaticMarkup(createElement(PlaceView, {
    context: manageContext,
    defaultTab: 'guild-workspace',
    render: (tab: string) => {
      manageTab = tab;
      return createElement('div', {'data-tab': tab}, 'guild-workspace-body');
    },
  }));
  assert.equal(manageTab, 'guild-workspace');
  assert.match(manageHtml, /guild-workspace-body/);
  assert.doesNotMatch(manageHtml, /公會管理/);
  assert.doesNotMatch(manageHtml, /公會工具/);
  assert.doesNotMatch(manageHtml, /選擇公會/);

  const guildsContext = {
    locationHash: '#guilds',
    site: null,
    canManageGuild: true,
    canManagePlatform: false,
    selectTab() {},
  } as unknown as PortalFeatureContext;

  let guildsTab = '';
  const guildsHtml = renderToStaticMarkup(createElement(PlaceView, {
    context: guildsContext,
    defaultTab: 'guilds',
    render: (tab: string) => {
      guildsTab = tab;
      return createElement('div', {'data-tab': tab}, 'guilds-body');
    },
  }));
  assert.equal(guildsTab, 'guilds');
  assert.match(guildsHtml, /guilds-body/);
  assert.match(guildsHtml, />公會管理<\/button>/);
  assert.match(guildsHtml, /aria-label="公會工具"/);
  assert.match(guildsHtml, />社群<\/button>/);

  const memberGuildsContext = {
    ...guildsContext,
    canManageGuild: false,
  } as unknown as PortalFeatureContext;
  const memberGuildsHtml = renderToStaticMarkup(createElement(PlaceView, {
    context: memberGuildsContext,
    defaultTab: 'guilds',
    render: (tab: string) => createElement('div', {'data-tab': tab}, 'guilds-body'),
  }));
  assert.doesNotMatch(memberGuildsHtml, /公會管理/);
  assert.match(memberGuildsHtml, /aria-label="公會工具"/);
});
