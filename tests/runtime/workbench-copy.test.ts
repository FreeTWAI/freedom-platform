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

function renderEmptyWorkbench() {
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
      if (stateCall === 1) return [false, () => {}];
      if (stateCall === 5) return [dashboard, () => {}];
      if (stateCall === 6) return [[], () => {}];
      return [typeof init === 'function' ? (init as () => unknown)() : init, () => {}];
    },
  };
  runInNewContext(code, {
    module: mod,
    exports: mod.exports,
    require: (id: string) => {
      if (id === 'react') return reactMock;
      if (id.endsWith('.css')) return {};
      if (id === '../portal-session') {
        return {
          client: {get: async () => ({}), post: async () => ({})},
          usePortal: () => ({session: {user: {user_id: 'owner-1'}}, pending: null, mutate: async () => true}),
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

test('UX-M-08: WorkbenchPanel keeps all empty states <= 24 Chinese characters and trims redundant section copy', () => {
  const html = renderEmptyWorkbench();
  const emptyMatches = [...html.matchAll(/<p class="empty">([^<]+)<\/p>/g)].map(m => m[1]);
  assert.equal(emptyMatches.length, 5);
  for (const text of emptyMatches) {
    assert.ok(text.length <= 24, `Empty state too long (${text.length}): ${text}`);
  }
  assert.doesNotMatch(html, /目前沒有項目/);
  assert.doesNotMatch(html, /可在「接下來」或「其他社群工作」認領/);
  assert.doesNotMatch(html, /你可以在頁尾發布一張/);
  const plainText = html.replace(/<[^>]+>/g, '');
  const zhCount = (plainText.match(/[\u4e00-\u9fff]/g) ?? []).length;
  assert.ok(zhCount <= 120, `Static Chinese character count too high: ${zhCount}`);
});
