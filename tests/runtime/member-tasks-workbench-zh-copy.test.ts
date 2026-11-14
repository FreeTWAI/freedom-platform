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

test('UX-M-09: MemberTasks translates Issue to 問題回報 and WorkbenchPanel drops English YOUR QUESTS eyebrow', () => {
  // MemberTasks with configured GitHub todo
  const mtUrl = new URL('../../apps/portal-web/src/modules/MemberTasks.tsx', import.meta.url);
  const mtReq = createRequire(mtUrl);
  const mtMod = {exports: {} as Record<string, unknown>};
  const mtCode = transformSync(readFileSync(mtUrl, 'utf8'), {loader: 'tsx', format: 'cjs', jsx: 'automatic'}).code;
  const sourcesValue = {
    onboarding: {value: {completed: true, entryMode: 'assessment', assessmentCompleted: true, primaryGuildKey: 'ai', bookCount: 0, repoCount: 0}, loading: false, error: ''},
    directory: {value: [{key: 'ai', name: 'AI 公會', active: true}], loading: false, error: ''},
    avatar: {value: true, loading: false, error: ''},
    social: {value: true, loading: false, error: ''},
  };
  let mtState = 0;
  const mtReact = {
    ...React,
    useState: (init: unknown) => {
      mtState++;
      if (mtState === 5) return [sourcesValue, () => {}];
      return [typeof init === 'function' ? (init as () => unknown)() : init, () => {}];
    },
  };
  runInNewContext(mtCode, {
    module: mtMod,
    exports: mtMod.exports,
    require: (id: string) => {
      if (id === 'react') return mtReact;
      if (id.endsWith('.css')) return {};
      if (id === './GitHubSocial') {
        return {
          useGitHubSocialStore: () => ({
            account: {value: {configured: true, connected: false, github_user: null}, loading: false, error: ''},
            loadAccount: async () => {},
            refreshConnection: async () => {},
            connect: async () => '',
          }),
        };
      }
      return mtReq(id);
    },
  });
  const MemberTasks = mtMod.exports.MemberTasks as React.ComponentType<{client: PortalClient; onNavigate: () => void}>;
  const mtHtml = renderToStaticMarkup(React.createElement(MemberTasks, {client: new PortalClient(), onNavigate: () => {}}));
  assert.doesNotMatch(mtHtml, /\bIssue\b/);
  assert.match(mtHtml, /問題回報/);

  // WorkbenchPanel
  const wbUrl = new URL('../../apps/portal-web/src/modules/WorkbenchPanel.tsx', import.meta.url);
  const wbReq = createRequire(wbUrl);
  const wbMod = {exports: {} as Record<string, unknown>};
  const wbCode = transformSync(readFileSync(wbUrl, 'utf8'), {loader: 'tsx', format: 'cjs', jsx: 'automatic'}).code;
  const dashboard = {summary: {accepted_count: 0}, now: [], next: [], review_queue: [], gained: []};
  let wbState = 0;
  const wbReact = {
    ...React,
    useState: (init: unknown) => {
      wbState++;
      if (wbState === 1) return [false, () => {}];
      if (wbState === 5) return [dashboard, () => {}];
      if (wbState === 6) return [[], () => {}];
      return [typeof init === 'function' ? (init as () => unknown)() : init, () => {}];
    },
  };
  runInNewContext(wbCode, {
    module: wbMod,
    exports: wbMod.exports,
    require: (id: string) => {
      if (id === 'react') return wbReact;
      if (id.endsWith('.css')) return {};
      if (id === '../portal-session') {
        return {
          client: {get: async () => ({}), post: async () => ({})},
          usePortal: () => ({session: {user: {user_id: 'owner-1'}}, pending: null, mutate: async () => true}),
          describeError: () => ({title: '錯誤', detail: '錯誤'}),
          isOwnRef: () => false,
        };
      }
      return wbReq(id);
    },
  });
  const WorkbenchPanel = wbMod.exports.WorkbenchPanel as React.ComponentType<{selectedId?: string}>;
  const wbHtml = renderToStaticMarkup(React.createElement(WorkbenchPanel));
  assert.doesNotMatch(wbHtml, /YOUR QUESTS/);
  assert.match(wbHtml, /認領與交付/);
  assert.doesNotMatch(readFileSync(wbUrl, 'utf8'), /YOUR QUESTS/);
});
