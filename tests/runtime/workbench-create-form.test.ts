import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire,registerHooks} from 'node:module';
import {runInNewContext} from 'node:vm';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformSync} from 'esbuild';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return {format: 'module', source: 'export default {};', shortCircuit: true};
    return nextLoad(url, context);
  },
});

function countMatches(html: string, pattern: RegExp) {
  return (html.match(pattern) ?? []).length;
}

function renderWorkbench(options: {openCreate?: boolean; items?: unknown[]} = {}) {
  const url = new URL('../../apps/portal-web/src/modules/WorkbenchPanel.tsx', import.meta.url);
  const req = createRequire(url);
  const mod = {exports: {} as Record<string, unknown>};
  const code = transformSync(readFileSync(url, 'utf8'), {loader: 'tsx', format: 'cjs', jsx: 'automatic'}).code;
  const dashboard = {summary: {accepted_count: 0}, now: [], next: [], review_queue: [], gained: []};
  let stateCall = 0;
  const reactMock = {
    ...React,
    useState: (init: unknown) => {
      stateCall++;
      if (stateCall === 1) return [false, () => {}]; // loading
      if (stateCall === 5) return [dashboard, () => {}]; // dashboard
      if (stateCall === 6) return [options.items ?? [], () => {}]; // items
      if (options.openCreate && stateCall === 8) return [true, () => {}]; // CreateWorkForm open
      return [typeof init === 'function' ? (init as () => unknown)() : init, () => {}];
    },
    useSyncExternalStore: (_sub: unknown, getSnap: () => unknown, getServerSnap?: () => unknown) => (getServerSnap ?? getSnap)(),
  };
  runInNewContext(code, {
    module: mod,
    exports: mod.exports,
    require: (id: string) => {
      if (id === 'react') return reactMock;
      if (id.endsWith('.css')) return {};
      if (id === './ContributionOutcomes') return {WorkContributionRoles: () => null};
      if (id === './BenefitObservations') return {BenefitObservations: () => null};
      if (id === '../portal-session') {
        return {
          client: {get: async () => ({}), post: async () => ({})},
          usePortal: () => ({
            session: {user: {user_id: 'owner-1', profession_membership_ref: 'guild_ai_project'}},
            pending: null,
            mutate: async () => true,
          }),
          describeError: () => ({title: '錯誤', detail: '錯誤'}),
          isOwnRef: () => false,
        };
      }
      return req(id);
    },
  });
  const WorkbenchPanel = mod.exports.WorkbenchPanel as React.ComponentType<{selectedId?: string}>;
  return renderToStaticMarkup(React.createElement(WorkbenchPanel));
}

test('UX-M-06: WorkbenchPanel collapses the 9-field creation form behind one primary + 新增工作卡 button', () => {
  const closedHtml = renderWorkbench();
  assert.equal(countMatches(closedHtml, /class="[^"]*\bbtn-primary\b[^"]*"/g), 1);
  assert.match(closedHtml, /class="[^"]*\bbtn-primary\b[^"]*"[^>]*>\+ 新增工作卡</);
  assert.doesNotMatch(closedHtml, /<form\b/);
  assert.doesNotMatch(closedHtml, /發布工作卡/);
  assert.doesNotMatch(closedHtml, /要解決的問題/);
});

test('UX-M-06: WorkbenchPanel keeps one primary button when creation form is open or catalog items exist', () => {
  const openItem = {
    work_item_id: 'work-1',
    title: '示範工作',
    objective: '目標',
    acceptance_criteria: '驗收',
    gain: '收穫',
    estimated_minutes: 30,
    maximum_minutes: 60,
    claim_window_expires_at: '2099-01-01T00:00:00Z',
    finish_window_expires_at: '2099-01-02T00:00:00Z',
    state: 'open',
    owner_ref: 'other-owner',
    owner_name: '其他夥伴',
    owner_participation_mode: 'volunteer',
    will_review: false,
    my_claim: null,
  };
  const withItemHtml = renderWorkbench({items: [openItem]});
  assert.equal(countMatches(withItemHtml, /class="[^"]*\bbtn-primary\b[^"]*"/g), 1);
  assert.match(withItemHtml, /class="[^"]*\bbtn-primary\b[^"]*"[^>]*>\+ 新增工作卡</);
  assert.match(withItemHtml, /class="[^"]*\bbtn-secondary\b[^"]*"[^>]*>認領這張工作</);

  const openedFormHtml = renderWorkbench({openCreate: true});
  assert.equal(countMatches(openedFormHtml, /class="[^"]*\bbtn-primary\b[^"]*"/g), 1);
  assert.match(openedFormHtml, /<form\b/);
  assert.match(openedFormHtml, /class="[^"]*\bbtn-primary\b[^"]*"[^>]*>發布工作卡</);
  assert.match(openedFormHtml, /class="[^"]*\bbtn-secondary\b[^"]*"[^>]*>取消</);
});
