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

function renderEmptyWorkbench(view: 'mine' | 'community' | 'outcomes' = 'mine') {
  const url = new URL('../../apps/portal-web/src/modules/WorkbenchPanel.tsx', import.meta.url);
  const dashboard = {summary: {accepted_count: 0}, now: [], next: [], review_queue: [], gained: []};
  let stateCall = 0;
  const portalSessionMock = {
    client: {get: async () => ({}), post: async () => ({})},
    usePortal: () => ({session: {user: {user_id: 'owner-1'}}, pending: null, mutate: async () => true}),
    describeError: () => ({title: '錯誤', detail: '錯誤'}),
    isOwnRef: () => false,
  };
  const loadModule = (fileUrl: URL): Record<string, unknown> => {
    const req = createRequire(fileUrl);
    const mod = {exports: {} as Record<string, unknown>};
    const code = transformSync(readFileSync(fileUrl, 'utf8'), {loader: 'tsx', format: 'cjs', jsx: 'automatic'}).code;
    runInNewContext(code, {
      module: mod,
      exports: mod.exports,
      require: (id: string) => {
        if (id === 'react') {
          return {
            ...React,
            useState: (init: unknown) => {
              if (fileUrl.pathname.endsWith('WorkbenchPanel.tsx')) {
                stateCall++;
                if (stateCall === 1) return [false, () => {}];
                if (stateCall === 5) return [dashboard, () => {}];
                if (stateCall === 6) return [[], () => {}];
                if (init === 'mine') return [view, () => {}];
              }
              return [typeof init === 'function' ? (init as () => unknown)() : init, () => {}];
            },
          };
        }
        if (id.endsWith('.css')) return {};
        if (id.endsWith('/ContributionOutcomes') || id === './ContributionOutcomes') return {WorkContributionRoles: () => null};
        if (id.endsWith('/BenefitObservations') || id === './BenefitObservations') return {BenefitObservations: () => null};
        if (id.endsWith('/portal-session')) return portalSessionMock;
        if (id.startsWith('./workbench/')) return loadModule(new URL(`${id}.tsx`, fileUrl));
        return req(id);
      },
    });
    return mod.exports;
  };
  const modExports = loadModule(url);
  const WorkbenchPanel = modExports.WorkbenchPanel as React.ComponentType<{selectedId?: string}>;
  const ReviewQueue = loadModule(new URL('../../apps/portal-web/src/modules/workbench/ReviewQueue.tsx', import.meta.url)).ReviewQueue as React.ComponentType<{entries: unknown[]; pending: string | null; mutate: () => Promise<boolean>; onChanged: () => Promise<void>}>;
  return {
    html: renderToStaticMarkup(React.createElement(WorkbenchPanel)),
    reviewEmptyHtml: renderToStaticMarkup(React.createElement(ReviewQueue, {entries: [], pending: null, mutate: async () => true, onChanged: async () => {}})),
  };
}

test('UX-M-08: WorkbenchPanel keeps all empty states <= 24 Chinese characters and trims redundant section copy', () => {
  const mine = renderEmptyWorkbench('mine');
  const community = renderEmptyWorkbench('community');
  const outcomes = renderEmptyWorkbench('outcomes');
  const viewHtmls = [mine.html, community.html, outcomes.html];
  const emptyMatches = [
    ...[mine.html, community.html, outcomes.html, mine.reviewEmptyHtml].flatMap(h => [...h.matchAll(/<p class="empty">([^<]+)<\/p>/g)].map(m => m[1])),
  ];
  assert.equal(emptyMatches.length, 5);
  for (const text of emptyMatches) {
    assert.ok(text.length <= 24, `Empty state too long (${text.length}): ${text}`);
  }
  for (const html of viewHtmls) {
    assert.doesNotMatch(html, /目前沒有項目/);
    assert.doesNotMatch(html, /可在「接下來」或「其他社群工作」認領/);
    assert.doesNotMatch(html, /你可以在頁尾發布一張/);
    const plainText = html.replace(/<[^>]+>/g, '');
    const zhCount = (plainText.match(/[\u4e00-\u9fff]/g) ?? []).length;
    assert.ok(zhCount <= 120, `Static Chinese character count too high: ${zhCount}`);
  }
});
