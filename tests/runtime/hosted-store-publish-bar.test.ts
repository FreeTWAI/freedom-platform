import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {HostedStorePublishBar, type HostedStorePublishBarProps} from '../../apps/portal-web/src/modules/HostedStorePublishBar.js';

const projectionBase = {
  slug: 'demo-shop',
  name: '示範小店',
  brand: null,
  description: '',
  currency: 'TWD' as const,
  revision: '1',
  published_at: '2026-01-01T00:00:00Z',
  transaction_state: 'not_enabled' as const,
};

const product = {sku: 'P0001', title: '手工皂', description: '', price_minor: 15000};

function makeProps(overrides: Partial<HostedStorePublishBarProps> = {}): HostedStorePublishBarProps {
  return {
    publication: {state: 'never_published', current_revision: null, published_at: null, public_path: null},
    preview: {projection: {...projectionBase, products: []}, dirty: false, current_revision: null},
    productCount: 0,
    canWrite: true,
    canPublish: true,
    onAddProduct: () => {},
    publicationReview: null,
    publishDisabled: false,
    publishSaved: () => {},
    hasDraft: false,
    photoBlocking: false,
    loading: false,
    publicPath: null,
    storeCopyUrl: null,
    copyAction: {pending: null},
    copyLink: async () => {},
    copyFeedback: null,
    manualUrl: null,
    manualField: {current: null},
    ...overrides,
  };
}

test('HostedStorePublishBar renders unpublished states and primary actions', () => {
  const empty = renderToStaticMarkup(createElement(HostedStorePublishBar, makeProps()));
  assert.match(empty, /aria-label="公開狀態"/);
  assert.match(empty, /<p>還沒公開。下一步：新增第一件商品。<\/p>/);
  assert.match(empty, />新增商品<\/button>/);
  assert.doesNotMatch(empty, />發布</);

  const emptyReadOnly = renderToStaticMarkup(createElement(HostedStorePublishBar, makeProps({canWrite: false})));
  assert.match(emptyReadOnly, /還沒公開。下一步：新增第一件商品。/);
  assert.doesNotMatch(emptyReadOnly, />新增商品</);

  const readyNeverPublished = renderToStaticMarkup(createElement(HostedStorePublishBar, makeProps({
    preview: {projection: {...projectionBase, products: [product]}, dirty: true, current_revision: null},
    productCount: 1,
  })));
  assert.match(readyNeverPublished, /<p>還沒公開。下一步：發布商店。<\/p>/);
  assert.match(readyNeverPublished, />發布<\/button>/);
  assert.doesNotMatch(readyNeverPublished, />新增商品</);

  const stopped = renderToStaticMarkup(createElement(HostedStorePublishBar, makeProps({
    publication: {state: 'unpublished', current_revision: '1', published_at: '2026-01-01T00:00:00Z', public_path: null},
    preview: {projection: {...projectionBase, products: [product]}, dirty: true, current_revision: '1'},
    productCount: 1,
  })));
  assert.match(stopped, /<p>已停止公開。下一步：發布商店。<\/p>/);
  assert.doesNotMatch(stopped, /上次發布/);
  assert.match(stopped, />發布<\/button>/);

  const noPublish = renderToStaticMarkup(createElement(HostedStorePublishBar, makeProps({
    preview: {projection: {...projectionBase, products: [product]}, dirty: true, current_revision: null},
    productCount: 1,
    canPublish: false,
  })));
  assert.match(noPublish, /<p>還沒公開。請有發布權限的成員發布。<\/p>/);
  assert.doesNotMatch(noPublish, />發布</);
});

test('HostedStorePublishBar renders published clean, dirty, share actions, and disabled hints', () => {
  const publishedClean = renderToStaticMarkup(createElement(HostedStorePublishBar, makeProps({
    publication: {state: 'published', current_revision: '2', published_at: '2026-01-01T00:00:00Z', public_path: '/shops/demo-shop'},
    preview: {projection: {...projectionBase, products: [product]}, dirty: false, current_revision: '2'},
    productCount: 1,
    publicPath: '/shops/demo-shop',
    storeCopyUrl: 'https://example.test/shops/demo-shop',
  })));
  assert.match(publishedClean, /<p>已公開第 2 版。 <small class="hosted-store-publish-bar-time">上次發布 [^<]+<\/small><\/p>/);
  assert.doesNotMatch(publishedClean, />發布更新</);
  assert.match(publishedClean, /href="\/shops\/demo-shop"[^>]*>查看公開頁<\/a>/);
  assert.match(publishedClean, />複製連結<\/button>/);

  const publishedDirty = renderToStaticMarkup(createElement(HostedStorePublishBar, makeProps({
    publication: {state: 'published', current_revision: '2', published_at: '2026-01-01T00:00:00Z', public_path: '/shops/demo-shop'},
    preview: {projection: {...projectionBase, products: [product]}, dirty: true, current_revision: '2'},
    productCount: 1,
    publicPath: '/shops/demo-shop',
    storeCopyUrl: 'https://example.test/shops/demo-shop',
  })));
  assert.match(publishedDirty, /<p>已公開第 2 版。有變更還沒公開。 <small class="hosted-store-publish-bar-time">上次發布 [^<]+<\/small><\/p>/);
  assert.match(publishedDirty, />發布更新<\/button>/);
  assert.match(publishedDirty, />查看公開頁<\/a>/);

  for (const [overrides, hint] of [
    [{hasDraft: true, publishDisabled: true}, '先儲存或取消還沒儲存的修改。'],
    [{photoBlocking: true, publishDisabled: true}, '照片還在儲存，完成後就能發布。'],
    [{loading: true, publishDisabled: true}, '正在確認可上架內容…'],
  ] as const) {
    const blocked = renderToStaticMarkup(createElement(HostedStorePublishBar, makeProps({
      preview: {projection: {...projectionBase, products: [product]}, dirty: true, current_revision: null},
      productCount: 1,
      ...overrides,
    })));
    assert.match(blocked, new RegExp(`<p class="field-hint">${hint}</p>`));
    assert.match(blocked, /disabled=""[^>]*>發布<\/button>/);
  }

  const copied = renderToStaticMarkup(createElement(HostedStorePublishBar, makeProps({
    publication: {state: 'published', current_revision: '1', published_at: '2026-01-01T00:00:00Z', public_path: '/shops/demo-shop'},
    preview: {projection: {...projectionBase, products: [product]}, dirty: false, current_revision: '1'},
    productCount: 1,
    publicPath: '/shops/demo-shop',
    storeCopyUrl: 'https://example.test/shops/demo-shop',
    copyFeedback: {url: 'https://example.test/shops/demo-shop', message: '已複製連結'},
  })));
  assert.match(copied, /role="status">已複製連結<\/p>/);

  const manual = renderToStaticMarkup(createElement(HostedStorePublishBar, makeProps({
    publication: {state: 'published', current_revision: '1', published_at: '2026-01-01T00:00:00Z', public_path: '/shops/demo-shop'},
    preview: {projection: {...projectionBase, products: [product]}, dirty: false, current_revision: '1'},
    productCount: 1,
    publicPath: '/shops/demo-shop',
    storeCopyUrl: 'https://example.test/shops/demo-shop',
    manualUrl: 'https://example.test/shops/demo-shop',
  })));
  assert.match(manual, /手動複製連結/);
});
