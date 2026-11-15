import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import type { Pool } from 'pg';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { nodeRuntime } from '../../apps/platform-api/src/app.js';
import { createPlatformApp } from '../../apps/platform-api/src/platform-app.js';
import type { PortalFeatureContext } from '../../apps/portal-web/src/features/types.js';
import type { SiteConfig } from '../../apps/portal-web/src/modules/Community.js';

const origin = 'http://127.0.0.1:4310';
const placeUrl = new URL('../../apps/portal-web/src/features/PlaceView.tsx', import.meta.url);
const placeRequire = createRequire(placeUrl);

async function loadPlaceView() {
  const placeModule = { exports: {} as any };
  const pending: Promise<unknown>[] = [];
  const stub = (name: string) => () => createElement('section', { 'data-stub': name }, name);
  const reactStub = {
    ...React,
    lazy(loader: () => Promise<{ default: any }>) {
      let Loaded: any = null;
      pending.push(loader().then(mod => { Loaded = mod.default; }));
      return (props: any) => Loaded ? createElement(Loaded, props) : createElement('div', { 'data-lazy': 'pending' });
    },
  };
  const stubs: Record<string, unknown> = {
    react: reactStub,
    '../frame-tools/RegisteredTools': { RegisteredTools: () => null },
    './CommunitySaved': { CommunitySaved: stub('CommunitySaved') },
    '../games/AbsurdDaily': { AbsurdDaily: stub('AbsurdDaily') },
    '../modules/AgentTokens': { AgentTokens: stub('AgentTokens') },
    '../modules/ClientConnections': { ClientConnections: stub('ClientConnections') },
    '../modules/DeviceConnections': { DeviceConnections: stub('DeviceConnections') },
    '../modules/ModelSettings': { ModelSettings: stub('ModelSettings') },
  };
  const code = transformSync(readFileSync(placeUrl, 'utf8'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' })
    .code.replace(/\bimport\(/g, '__import(');
  runInNewContext(code, {
    module: placeModule,
    exports: placeModule.exports,
    __import: (specifier: string) => Promise.resolve(stubs[specifier]),
    require: (id: string) => Object.hasOwn(stubs, id) ? stubs[id] : placeRequire(id),
  });
  await Promise.all(pending);
  return placeModule.exports.PlaceView as (props: {
    context: PortalFeatureContext;
    defaultTab: 'private-ai';
    render: (tab: string, context: PortalFeatureContext) => React.ReactNode;
  }) => React.ReactElement;
}

function baseSite(privateAiEnabled?: boolean): SiteConfig {
  return {
    registration_enabled: true,
    demo_accounts_enabled: true,
    public_mode: false,
    member_blocking_enabled: true,
    ...(privateAiEnabled === undefined ? {} : { private_ai_enabled: privateAiEnabled }),
  };
}

function placeContext(locationHash: string, site: SiteConfig | null): PortalFeatureContext {
  return { locationHash, site, selectTab() {} } as unknown as PortalFeatureContext;
}

test('GET /api/v1/site reports private_ai_enabled without exposing provider names or secrets', async () => {
  const pool = { query() { throw new Error('site must not query SQL'); } } as unknown as Pool;
  const offApp = createPlatformApp(pool, origin, 'local', nodeRuntime('local', origin));
  const offRes = await offApp.request(origin + '/api/v1/site');
  assert.equal(offRes.status, 200);
  const offSite = await offRes.json() as Record<string, unknown>;
  assert.equal(offSite.private_ai_enabled, false);

  const onRuntime = {
    ...nodeRuntime('local', origin),
    privateAiProduct: async () => new Response('unused'),
    privateAiSetupOrigin: () => 'https://provider-broker.invalid',
  };
  const onApp = createPlatformApp(pool, origin, 'local', onRuntime);
  const onRes = await onApp.request(origin + '/api/v1/site');
  assert.equal(onRes.status, 200);
  const onSite = await onRes.json() as Record<string, unknown>;
  assert.equal(onSite.private_ai_enabled, true);
  assert.deepEqual(Object.keys(onSite).sort(), Object.keys(offSite).sort());
  assert.deepEqual(Object.keys(onSite).filter(k => /private_ai|provider|secret|api_key/i.test(k)), ['private_ai_enabled']);
  assert.equal(JSON.stringify(onSite).includes('provider-broker.invalid'), false);
});

test('PlaceView hides unavailable automation tabs and routes direct hidden hashes to automation home', async () => {
  const PlaceView = await loadPlaceView();
  const hiddenHashes = [
    '#automation/work',
    '#automation/work/11111111-1111-4111-8111-111111111111',
    '#private-ai',
    '#automation/devices',
    '#automation/models',
  ];

  for (const site of [null, baseSite(false)]) {
    const homeHtml = renderToStaticMarkup(createElement(PlaceView, {
      context: placeContext('#automation/agent', site),
      defaultTab: 'private-ai',
      render: () => { throw new Error('hidden private-ai tab should not render'); },
    }));
    assert.match(homeHtml, /<option value="#automation\/agent" selected="">我的 Agent<\/option>/);
    assert.match(homeHtml, /<option value="#automation\/connections">工具連線<\/option>/);
    for (const label of ['私人工作', '裝置連線', '模型設定']) {
      assert.equal(homeHtml.includes(label), false);
    }

    for (const hash of hiddenHashes) {
      let renderCalled = 0;
      const html = renderToStaticMarkup(createElement(PlaceView, {
        context: placeContext(hash, site),
        defaultTab: 'private-ai',
        render: () => { renderCalled++; return createElement('section', { 'data-stub': 'PrivateWorkAI' }); },
      }));
      assert.equal(renderCalled, 0, `${hash} must not render PrivateWorkAI when private_ai_enabled is false`);
      assert.match(html, /data-stub="AgentTokens"/);
      assert.equal(html.includes('data-stub="DeviceConnections"'), false);
      assert.equal(html.includes('data-stub="ModelSettings"'), false);
      assert.match(html, /<option value="#automation\/agent" selected="">我的 Agent<\/option>/);
    }

    const connectionsHtml = renderToStaticMarkup(createElement(PlaceView, {
      context: placeContext('#automation/connections', site),
      defaultTab: 'private-ai',
      render: () => { throw new Error('connections should render directly'); },
    }));
    assert.match(connectionsHtml, /data-stub="ClientConnections"/);
  }

  const enabledSite = baseSite(true);
  const enabledAgentHtml = renderToStaticMarkup(createElement(PlaceView, {
    context: placeContext('#automation/agent', enabledSite),
    defaultTab: 'private-ai',
    render: () => null,
  }));
  for (const label of ['我的 Agent', '私人工作', '裝置連線', '模型設定', '工具連線']) {
    assert.equal(enabledAgentHtml.includes(label), true, `enabled site should include ${label}`);
  }

  let enabledWorkCalls = 0;
  const enabledWorkHtml = renderToStaticMarkup(createElement(PlaceView, {
    context: placeContext('#automation/work', enabledSite),
    defaultTab: 'private-ai',
    render: (tab) => {
      enabledWorkCalls++;
      assert.equal(tab, 'private-ai');
      return createElement('section', { 'data-stub': 'PrivateWorkAI' });
    },
  }));
  assert.equal(enabledWorkCalls, 1);
  assert.match(enabledWorkHtml, /data-stub="PrivateWorkAI"/);
  assert.match(renderToStaticMarkup(createElement(PlaceView, {
    context: placeContext('#automation/devices', enabledSite),
    defaultTab: 'private-ai',
    render: () => null,
  })), /data-stub="DeviceConnections"/);
  assert.match(renderToStaticMarkup(createElement(PlaceView, {
    context: placeContext('#automation/models', enabledSite),
    defaultTab: 'private-ai',
    render: () => null,
  })), /data-stub="ModelSettings"/);
});
