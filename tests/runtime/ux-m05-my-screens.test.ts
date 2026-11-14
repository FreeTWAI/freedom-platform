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

function loadComponent(relPath: string, mocks: Record<string, unknown> = {}) {
  const url = new URL(relPath, import.meta.url);
  const req = createRequire(url);
  const mod = {exports: {} as Record<string, unknown>};
  const code = transformSync(readFileSync(url, 'utf8'), {loader: 'tsx', format: 'cjs', jsx: 'automatic'}).code;
  runInNewContext(code, {
    module: mod,
    exports: mod.exports,
    require: (id: string) => {
      if (id in mocks) return mocks[id];
      if (id.endsWith('.css')) return {};
      return req(id);
    },
  });
  return mod.exports;
}

function countMatches(html: string, pattern: RegExp) {
  return (html.match(pattern) ?? []).length;
}

test('UX-M-05: AccountSecurity renders 更新密碼 as secondary by default when alongside 儲存修改', async () => {
  const {AccountSecurity} = await import('../../apps/portal-web/src/modules/AccountSecurity.js');
  const html = renderToStaticMarkup(React.createElement(AccountSecurity, {
    client: new PortalClient(),
    onAccountChanged: async () => {},
    hasPassword: true,
  }));
  assert.equal(countMatches(html, /class="[^"]*\bbtn-primary\b[^"]*"/g), 0);
  assert.match(html, /class="[^"]*\bbtn-secondary\b[^"]*"[^>]*>更新密碼</);
});

test('UX-M-05: MemberTasks renders exactly one btn-primary on top-priority incomplete task and btn-secondary on other todos', () => {
  const client = new PortalClient();
  const renderWithSources = (sourcesValue: unknown, githubValue: unknown) => {
    let stateCall = 0;
    const reactMock = {
      ...React,
      useState: (init: unknown) => {
        stateCall++;
        if (stateCall === 5) return [sourcesValue, () => {}];
        return [typeof init === 'function' ? (init as () => unknown)() : init, () => {}];
      },
    };
    const {MemberTasks} = loadComponent('../../apps/portal-web/src/modules/MemberTasks.tsx', {
      react: reactMock,
      './GitHubSocial': {
        useGitHubSocialStore: () => ({
          account: {value: githubValue, loading: false, error: ''},
          loadAccount: async () => {},
          refreshConnection: async () => {},
          connect: async () => '',
        }),
      },
    }) as {MemberTasks: React.ComponentType<{client: PortalClient; onNavigate: () => void}>};
    return renderToStaticMarkup(React.createElement(MemberTasks, {client, onNavigate: () => {}}));
  };

  // Case 1: required tasks done, 3 suggested tasks todo -> only avatar (first todo) is primary, others secondary.
  const suggestedHtml = renderWithSources({
    onboarding: {value: {completed: true, entryMode: 'assessment', assessmentCompleted: true, primaryGuildKey: 'ai', bookCount: 0, repoCount: 0}, loading: false, error: ''},
    directory: {value: [{key: 'ai', name: 'AI 公會', active: true}], loading: false, error: ''},
    avatar: {value: false, loading: false, error: ''},
    social: {value: false, loading: false, error: ''},
  }, {configured: true, connected: true, github_user: {login: 'demo'}});

  assert.equal(countMatches(suggestedHtml, /class="[^"]*\bbtn-primary\b[^"]*"/g), 1);
  assert.match(suggestedHtml, /class="[^"]*\bbtn-primary\b[^"]*"[^>]*>前往我的名片上傳頭像</);
  assert.match(suggestedHtml, /class="[^"]*\bbtn-secondary\b[^"]*"[^>]*>前往我的名片新增連結</);
  assert.match(suggestedHtml, /class="[^"]*\bbtn-secondary\b[^"]*"[^>]*>前往技能書架</);

  // Case 2: required primary-guild and github both todo -> only primary-guild is primary, github & suggested todos are secondary.
  const requiredHtml = renderWithSources({
    onboarding: {value: {completed: true, entryMode: 'assessment', assessmentCompleted: true, primaryGuildKey: null, bookCount: 0, repoCount: 0}, loading: false, error: ''},
    directory: {value: [], loading: false, error: ''},
    avatar: {value: false, loading: false, error: ''},
    social: {value: false, loading: false, error: ''},
  }, {configured: true, connected: false});

  assert.equal(countMatches(requiredHtml, /class="[^"]*\bbtn-primary\b[^"]*"/g), 1);
  assert.match(requiredHtml, /class="[^"]*\bbtn-primary\b[^"]*"[^>]*>前往職業公會</);
  assert.match(requiredHtml, /class="[^"]*\bbtn-secondary\b[^"]*"[^>]*>連結 GitHub</);
});

test('UX-M-05: PersonalSpace renders one primary action and moves filters behind 篩選 disclosure', () => {
  const client = new PortalClient();
  const owner = '20000000-0000-4000-8000-000000000001';
  const snapshot = {
    client,
    owner,
    generation: client.sessionGeneration,
    hero: {nickname: '示範夥伴', avatar_url: null, positioning_title: null, guilds: []},
    items: [],
    profileError: false,
    contentError: false,
  };
  let stateCall = 0;
  const reactMock = {
    ...React,
    useState: (init: unknown) => {
      stateCall++;
      if (stateCall === 1) return [snapshot, () => {}];
      if (stateCall === 3) return [false, () => {}];
      return [typeof init === 'function' ? (init as () => unknown)() : init, () => {}];
    },
  };
  const {PersonalSpace} = loadComponent('../../apps/portal-web/src/modules/PersonalSpace.tsx', {
    react: reactMock,
  }) as {PersonalSpace: React.ComponentType<{client: PortalClient; session: {user: {user_id: string}}; contentEnabled: boolean}>};

  const html = renderToStaticMarkup(React.createElement(PersonalSpace, {
    client,
    session: {user: {user_id: owner}},
    contentEnabled: true,
  }));

  assert.equal(countMatches(html, /class="[^"]*\bbtn-primary\b[^"]*"/g), 1);
  assert.match(html, /class="[^"]*\bbtn-primary\b[^"]*"[^>]*>新增作品草稿</);
  assert.match(html, /<details[^>]*><summary>篩選<\/summary>/);
  // Outside the filter disclosure, <=3 secondary buttons/links (編輯個人頁, 前往社群發文)
  const beforeFilter = html.split(/<details[^>]*><summary>篩選<\/summary>/)[0] ?? '';
  const afterFilter = html.split(/<\/details>/).slice(-1)[0] ?? '';
  assert.ok(countMatches(beforeFilter + afterFilter, /class="[^"]*\bbtn-secondary\b[^"]*"/g) <= 3);
});
