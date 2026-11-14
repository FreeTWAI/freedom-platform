import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire,registerHooks} from 'node:module';
import {runInNewContext} from 'node:vm';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformSync} from 'esbuild';
import {PortalClient} from '../../apps/portal-web/src/api.js';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return {format: 'module', source: 'export default {};', shortCircuit: true};
    return nextLoad(url, context);
  },
});

function renderMemberTasks(githubValue: {configured: boolean; connected: boolean; github_user?: {login: string} | null} | null) {
  const url = new URL('../../apps/portal-web/src/modules/MemberTasks.tsx', import.meta.url);
  const req = createRequire(url);
  const mod = {exports: {} as Record<string, unknown>};
  const code = transformSync(readFileSync(url, 'utf8'), {loader: 'tsx', format: 'cjs', jsx: 'automatic'}).code;
  const sourcesValue = {
    onboarding: {value: {completed: true, entryMode: 'assessment', assessmentCompleted: true, primaryGuildKey: 'ai', bookCount: 0, repoCount: 0}, loading: false, error: ''},
    directory: {value: [{key: 'ai', name: 'AI 公會', active: true}], loading: false, error: ''},
    avatar: {value: false, loading: false, error: ''},
    social: {value: false, loading: false, error: ''},
  };
  let stateCall = 0;
  const reactMock = {
    ...React,
    useState: (init: unknown) => {
      stateCall++;
      if (stateCall === 5) return [sourcesValue, () => {}];
      return [typeof init === 'function' ? (init as () => unknown)() : init, () => {}];
    },
  };
  runInNewContext(code, {
    module: mod,
    exports: mod.exports,
    require: (id: string) => {
      if (id === 'react') return reactMock;
      if (id.endsWith('.css')) return {};
      if (id === './GitHubSocial') {
        return {
          useGitHubSocialStore: () => ({
            account: {value: githubValue, loading: false, error: ''},
            loadAccount: async () => {},
            refreshConnection: async () => {},
            connect: async () => '',
          }),
        };
      }
      return req(id);
    },
  });
  const MemberTasks = mod.exports.MemberTasks as React.ComponentType<{client: PortalClient; onNavigate: () => void}>;
  return renderToStaticMarkup(React.createElement(MemberTasks, {client: new PortalClient(), onNavigate: () => {}}));
}

test('UX-M-07: MemberTasks hides the GitHub card completely when GitHub linking is not configured', () => {
  const unconfiguredHtml = renderMemberTasks({configured: false, connected: false, github_user: null});
  assert.doesNotMatch(unconfiguredHtml, /data-task="github"/);
  assert.doesNotMatch(unconfiguredHtml, /尚未啟用/);
  assert.doesNotMatch(unconfiguredHtml, /重新讀取 GitHub 連結/);

  const configuredHtml = renderMemberTasks({configured: true, connected: false, github_user: null});
  assert.match(configuredHtml, /data-task="github"/);
  assert.match(configuredHtml, /連結 GitHub/);
});
