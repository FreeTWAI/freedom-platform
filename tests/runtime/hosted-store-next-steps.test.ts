import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {storeNextSteps, type StoreNextStepsInput} from '../../apps/portal-web/src/modules/hosted-store-next-steps.js';
import {HostedStoreNextSteps} from '../../apps/portal-web/src/modules/HostedStoreNextSteps.js';

type Expected = ReturnType<typeof storeNextSteps>;

const cases: ReadonlyArray<{name: string; input: StoreNextStepsInput; expected: Expected}> = [
  {
    name: 'never_published with 0 products and publish permission',
    input: {publicationState: 'never_published', productCount: 0, writable: true, canWrite: true, canPublish: true},
    expected: {
      steps: [
        {key: 'store', done: true, text: '商店資料已建立'},
        {key: 'products', done: false, text: '新增第一件商品'},
        {key: 'publish', done: false, text: '在「店面與發布」預覽後發布'},
      ],
      current: 'products',
      next: 'products',
    },
  },
  {
    name: 'never_published with 0 products and no publish permission',
    input: {publicationState: 'never_published', productCount: 0, writable: true, canWrite: true, canPublish: false},
    expected: {
      steps: [
        {key: 'store', done: true, text: '商店資料已建立'},
        {key: 'products', done: false, text: '新增第一件商品'},
        {key: 'publish', done: false, text: '請有發布權限的成員預覽後發布'},
      ],
      current: 'products',
      next: 'products',
    },
  },
  {
    name: 'never_published with products and publish permission',
    input: {publicationState: 'never_published', productCount: 3, writable: true, canWrite: true, canPublish: true},
    expected: {
      steps: [
        {key: 'store', done: true, text: '商店資料已建立'},
        {key: 'products', done: true, text: '已新增 3 件商品'},
        {key: 'publish', done: false, text: '在「店面與發布」預覽後發布'},
      ],
      current: 'publish',
      next: 'publish',
    },
  },
  {
    name: 'never_published with products and no publish permission',
    input: {publicationState: 'never_published', productCount: 1, writable: true, canWrite: true, canPublish: false},
    expected: {
      steps: [
        {key: 'store', done: true, text: '商店資料已建立'},
        {key: 'products', done: true, text: '已新增 1 件商品'},
        {key: 'publish', done: false, text: '請有發布權限的成員預覽後發布'},
      ],
      current: 'publish',
      next: null,
    },
  },
  {
    name: 'published returns null',
    input: {publicationState: 'published', productCount: 2, writable: true, canWrite: true, canPublish: true},
    expected: null,
  },
  {
    name: 'unpublished returns null',
    input: {publicationState: 'unpublished', productCount: 2, writable: true, canWrite: true, canPublish: true},
    expected: null,
  },
  {
    name: 'not writable returns null',
    input: {publicationState: 'never_published', productCount: 0, writable: false, canWrite: true, canPublish: true},
    expected: null,
  },
  {
    name: 'no store:write capability returns null',
    input: {publicationState: 'never_published', productCount: 0, writable: true, canWrite: false, canPublish: true},
    expected: null,
  },
];

for (const entry of cases) {
  test(`storeNextSteps: ${entry.name}`, () => {
    assert.deepEqual(storeNextSteps(entry.input), entry.expected);
  });
}

test('HostedStoreNextSteps renders steps, hides button on current next tab, and shows button on another tab', () => {
  const onProductsTab = renderToStaticMarkup(createElement(HostedStoreNextSteps, {
    publicationState: 'never_published',
    productCount: 0,
    writable: true,
    canWrite: true,
    canPublish: true,
    area: 'products',
    onNext: () => {},
  }));
  assert.match(onProductsTab, /aria-label="開店步驟"/);
  assert.match(onProductsTab, /data-done="true"[^>]*><span class="sr-only">已完成：<\/span>商店資料已建立/);
  assert.match(onProductsTab, /data-done="false" aria-current="step">新增第一件商品/);
  assert.doesNotMatch(onProductsTab, /前往下一步/);

  const withProducts = renderToStaticMarkup(createElement(HostedStoreNextSteps, {
    publicationState: 'never_published',
    productCount: 1,
    writable: true,
    canWrite: true,
    canPublish: true,
    area: 'products',
    onNext: () => {},
  }));
  assert.match(withProducts, /<span class="sr-only">已完成：<\/span>已新增 1 件商品/);
  assert.match(withProducts, /aria-current="step">在「店面與發布」預覽後發布/);
  assert.match(withProducts, /<button[^>]*class="btn btn-primary btn-small"[^>]*>前往下一步<\/button>/);

  const onPublishTab = renderToStaticMarkup(createElement(HostedStoreNextSteps, {
    publicationState: 'never_published',
    productCount: 1,
    writable: true,
    canWrite: true,
    canPublish: true,
    area: 'publish',
    onNext: () => {},
  }));
  assert.doesNotMatch(onPublishTab, /前往下一步/);

  const noPublish = renderToStaticMarkup(createElement(HostedStoreNextSteps, {
    publicationState: 'never_published',
    productCount: 1,
    writable: true,
    canWrite: true,
    canPublish: false,
    area: 'products',
    onNext: () => {},
  }));
  assert.doesNotMatch(noPublish, /前往下一步/);
  assert.match(noPublish, /請有發布權限的成員預覽後發布/);

  const published = renderToStaticMarkup(createElement(HostedStoreNextSteps, {
    publicationState: 'published',
    productCount: 1,
    writable: true,
    canWrite: true,
    canPublish: true,
    area: 'products',
    onNext: () => {},
  }));
  assert.equal(published, '');
});
