import {test, type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {transformSync} from 'esbuild';
import React from 'react';
import {ApiError} from '../../apps/portal-web/src/api';
import {youtubeLinkKind} from '../../apps/portal-web/src/modules/short-video-embed';

// Real React/ReactDOM reconciliation, with an intentionally minimal synthetic
// DOM host. Image errors are injected through actual production callbacks;
// browser image decoding, native event scheduling and layout are not simulated.
class HostNode {
  [key: string]: any;
  parentNode: HostNode | null = null;
  childNodes: HostNode[] = [];
  attributes: Record<string, string> = {};
  style = {setProperty() {}, removeProperty() {}};
  listeners: Record<string, Function[]> = {};
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  constructor(public nodeType: number, public nodeName: string, public ownerDocument: any) {
    if (nodeType === 1) this.tagName = nodeName;
  }
  appendChild(node: HostNode) {
    node.parentNode?.removeChild(node); this.childNodes.push(node); node.parentNode = this; return node;
  }
  removeChild(node: HostNode) {
    const index = this.childNodes.indexOf(node); assert.notEqual(index, -1);
    this.childNodes.splice(index, 1); node.parentNode = null; return node;
  }
  insertBefore(node: HostNode, before: HostNode) {
    node.parentNode?.removeChild(node); const index = this.childNodes.indexOf(before); assert.notEqual(index, -1);
    this.childNodes.splice(index, 0, node); node.parentNode = this; return node;
  }
  setAttribute(key: string, value: unknown) {this.attributes[key] = String(value);}
  removeAttribute(key: string) {delete this.attributes[key];}
  getAttribute(key: string) {return this.attributes[key] ?? null;}
  setAttributeNS(_namespace: string, key: string, value: unknown) {this.setAttribute(key, value);}
  addEventListener(type: string, fn: Function) {(this.listeners[type] ??= []).push(fn);}
  removeEventListener(type: string, fn: Function) {this.listeners[type] = (this.listeners[type] ?? []).filter(item => item !== fn);}
  get firstChild(): HostNode | null {return this.childNodes[0] ?? null;}
  get lastChild(): HostNode | null {return this.childNodes.at(-1) ?? null;}
  get nextSibling(): HostNode | null {return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null;}
  get textContent(): string {return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(node => node.textContent).join('');}
  set textContent(value: string) {this.childNodes.forEach(node => {node.parentNode = null;}); this.childNodes = []; if (value) this.appendChild(this.ownerDocument.createTextNode(String(value)));}
  get src() {return this.attributes.src ?? '';}
  set src(value: string) {this.attributes.src = String(value);}
  contains(node: HostNode): boolean {return node === this || this.childNodes.some(child => child.contains(node));}
}
class HostDocument extends HostNode {
  constructor() {
    super(9, '#document', null); this.ownerDocument = this;
    this.documentElement = new HostNode(1, 'HTML', this); this.body = new HostNode(1, 'BODY', this);
    this.appendChild(this.documentElement); this.documentElement.appendChild(this.body); this.activeElement = this.body;
  }
  createElement(name: string) {return new HostNode(1, name.toUpperCase(), this);}
  createElementNS(namespace: string, name: string) {const node = this.createElement(name); node.namespaceURI = namespace; return node;}
  createTextNode(value: string) {const node = new HostNode(3, '#text', this); node.nodeValue = value; return node;}
}
const document = new HostDocument();
const window = {document, HTMLElement: HostNode, HTMLIFrameElement: class {}, addEventListener() {}, removeEventListener() {}, get event() {return undefined;}};
document.defaultView = window;
Object.assign(globalThis, {document, window, HTMLElement: HostNode, Node: HostNode, IS_REACT_ACT_ENVIRONMENT: true});
// Initialize ReactDOM after installing its synthetic host, in this test process.
const require = createRequire(import.meta.url);
const {createRoot} = require('react-dom/client') as typeof import('react-dom/client');
const {flushSync} = require('react-dom') as typeof import('react-dom');
const flush = (fn: () => void) => React.act(() => flushSync(fn));
const source = readFileSync(new URL('../../apps/portal-web/src/modules/SocialZone.tsx', import.meta.url), 'utf8');
function section(start: string, end: string) {
  const left = source.indexOf(start), right = source.indexOf(end, left);
  assert(left >= 0 && right > left, `production section missing: ${start}`);
  return source.slice(left, right);
}
// Execute unchanged production Thumb, card JSX/file input and upload handler.
// Only surrounding siblings, state ports, image preparation and I/O are fakes.
const compiled = transformSync([
  section('function tone(', 'function SocialBody('),
  section('function Thumb(', 'async function composeImage('),
  section('  async function uploadLinkThumb(', '  async function remove('),
  `function Card({post, view}) {${section('  const renderCard =', '  return <section className="social-zone')}\nreturn renderCard(post, view);}`,
  'globalThis.Card = Card; globalThis.upload = uploadLinkThumb;',
].join('\n'), {loader: 'tsx', format: 'cjs'}).code;
const descendants = (node: HostNode): HostNode[] => [node, ...node.childNodes.flatMap(descendants)];
const props = (node: HostNode) => node[Object.keys(node).find(key => key.startsWith('__reactProps$'))!];

function fixture(t: TestContext) {
  let interactionMounts = 0;
  function Interactions() {
    const [value, setValue] = React.useState(() => {interactionMounts++; return 'kept';});
    return React.createElement('button', {className: 'interaction', onClick: () => setValue('edited')}, value);
  }
  const base = {post_id: '10000000-0000-4000-8000-000000000001', kind: 'link', url: 'https://example.test/read', platform: 'other', platform_label: '其他', title: 'fixture', note: null, created_at: '2026-11-04T00:00:00Z', edited_at: null, revision: 1, author: {user_id: 'author', display_name: 'Fixture', avatar_url: null}, thumbnail_url: '/api/v1/social-posts/10000000-0000-4000-8000-000000000001/thumbnail?v=old', total_points: 0, my_points: 0, mine: true, like_count: 0, comment_count: 0, liked: false};
  const state = {items: [base], notice: '', error: '', saving: false, prepares: 0, requests: [] as any[], response: undefined as any, now: 1793786400000};
  const client = {csrfToken: 'synthetic-csrf', sessionGeneration: 1};
  const noop = () => {};
  const context: any = {
    React, useState: React.useState, URL, crypto: {randomUUID}, Date: {now: () => state.now++}, ApiError,
    client, currentClient: {current: client}, feedSession: 1, saving: false,
    newPosts: {current: [base]}, confirmedWrites: {current: 0},
    setSaving: (value: boolean) => {state.saving = value; context.saving = value;},
    setActionError: (value: string) => {state.error = value;}, setNotice: (value: string) => {state.notice = value;},
    setItems: (fn: Function) => {state.items = fn(state.items);},
    prepareSocialImage: async (file: File) => {state.prepares++; return file;},
    accessAwareFetch: async (path: string, init: unknown) => {
      state.requests.push({path, init});
      return state.response ?? {ok: true, status: 200, json: async () => ({...state.items[0], thumbnail_url: `/api/v1/social-posts/${base.post_id}/thumbnail`})};
    },
    canHide: false, bookmarksEnabled: false, shortVideos: false, confirming: null, editingPost: null,
    MemberAvatar: () => null, SocialPostOptions: ({children}: any) => React.createElement('div', {}, children),
    SocialIcon: () => null, SocialBody: () => null, SocialInteractions: Interactions, PromotionShare: () => null,
    InlineVideo: () => React.createElement('i', {className: 'video'}), SOCIAL_TOPICS: {mood: '近況'}, PLATFORM_LABELS: {other: '其他'},
    formatIsoLocal: (value: string) => value, selectTag: noop, openDelete: noop, hide: noop,
    setEditingPost: noop, editTrigger: {current: null}, youtubeLinkKind,
    reconcileShortComments: noop,
  };
  runInNewContext(compiled, context);
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);
  t.after(() => {flush(() => root.unmount()); document.body.removeChild(container);});
  const find = (predicate: (node: HostNode) => boolean) => descendants(container).find(predicate);
  const image = () => find(node => node.nodeName === 'IMG' && node.getAttribute('class') === 'social-thumb');
  const output = () => image() ? 'img' : find(node => node.getAttribute('class') === 'social-placeholder') ? 'placeholder' : 'none';
  const render = (post: any = state.items[0], view?: any) => {flush(() => root.render(React.createElement(context.Card, {post, view}))); return output();};
  const error = () => {const node = image(); assert(node); flush(() => props(node).onError({target: node, currentTarget: node})); return output();};
  return {state, context, base, container, find, image, output, render, error, mounts: () => interactionMounts};
}
const file = () => new File(['synthetic'], 'thumbnail.png', {type: 'image/png'});

test('successful production upload replaces a previously broken thumbnail', async t => {
  const h = fixture(t); h.render(); assert.equal(h.error(), 'placeholder');
  await h.context.upload(h.base, file());
  assert.equal(h.state.notice, '縮圖已更新。'); assert.equal(h.state.error, '');
  assert.equal(h.context.confirmedWrites.current, 1); assert.equal(h.state.requests.length, 1);
  const request = h.state.requests[0];
  assert.equal(request.path, `/api/v1/social-posts/${h.base.post_id}/thumbnail`);
  assert.equal(request.init.method, 'PUT'); assert.equal(request.init.credentials, 'same-origin');
  assert.equal(request.init.headers['X-CSRF-Token'], 'synthetic-csrf');
  assert.match(request.init.headers['Idempotency-Key'], /^[0-9a-f-]{36}$/);
  assert.equal(request.init.body.type, 'image/png'); assert.equal(h.state.prepares, 1);
  assert.equal(h.context.newPosts.current[0].thumbnail_url, h.state.items[0].thumbnail_url);
  assert.equal(h.render(), 'img'); assert.equal(h.image()!.src, h.state.items[0].thumbnail_url);
  assert.notEqual(h.image()!.src, h.base.thumbnail_url);
});
test('the actual replacement file-input handler uploads once and clears its input', async t => {
  const h = fixture(t); h.render(); h.error();
  const input = h.find(node => node.nodeName === 'INPUT' && node.getAttribute('aria-label') === '更換縮圖'); assert(input);
  const target = {files: [file()], value: 'selected'};
  await React.act(async () => {props(input).onChange({target}); await new Promise(resolve => setImmediate(resolve));});
  assert.equal(target.value, ''); assert.equal(h.state.requests.length, 1);
  assert.equal(h.state.notice, '縮圖已更新。'); assert.equal(h.render(), 'img');
});
test('same failed URL stays in fallback without retrying on unrelated updates', t => {
  const h = fixture(t); h.render(); h.error();
  for (let count = 1; count <= 3; count++) assert.equal(h.render({...h.base, like_count: count}), 'placeholder');
  assert.equal(h.state.requests.length, 0);
});
test('same URL retains its image and replacing it preserves article and sibling draft state', t => {
  const h = fixture(t); h.render(); const image = h.image(), article = h.find(node => node.nodeName === 'ARTICLE');
  const interaction = h.find(node => node.getAttribute('class') === 'interaction')!;
  flush(() => props(interaction).onClick()); h.render({...h.base, like_count: 2}); assert.equal(h.image() === image, true);
  h.render({...h.base, thumbnail_url: `${h.base.thumbnail_url}-new`});
  assert.equal(h.find(node => node.nodeName === 'ARTICLE') === article, true);
  assert.equal(h.find(node => node.getAttribute('class') === 'interaction') === interaction, true);
  assert.equal(interaction.textContent, 'edited'); assert.equal(h.mounts(), 1);
});
for (const kind of ['note', 'link']) test(`${kind} thumbnail can be removed and reintroduced after an error`, t => {
  const h = fixture(t), post = {...h.base, kind, url: kind === 'note' ? null : h.base.url};
  h.render(post); h.error(); assert.equal(h.render({...post, thumbnail_url: null}), kind === 'note' ? 'none' : 'placeholder');
  assert.equal(h.render(post), 'img'); assert.equal(h.image()!.src, post.thumbnail_url);
});
test('a second confirmed replacement recovers even when the first replacement also failed', async t => {
  const h = fixture(t); h.render(); h.error(); await h.context.upload(h.base, file());
  assert.equal(h.render(), 'img'); const first = h.state.items[0].thumbnail_url; h.error();
  await h.context.upload(h.state.items[0], file()); assert.notEqual(h.state.items[0].thumbnail_url, first);
  assert.equal(h.state.requests.length, 2); assert.equal(h.render(), 'img'); assert.equal(h.mounts(), 1);
});
// Injected callback orders test state ownership. They do not claim that native
// browsers deliver obsolete image errors through a retained earlier callback.
for (const currentFails of [false, true]) test(`retired thumbnail callback cannot alter replacement (current failed: ${currentFails})`, t => {
  const h = fixture(t); h.render(); const old = h.image()!, oldError = props(old).onError;
  h.render({...h.base, thumbnail_url: `${h.base.thumbnail_url}-new`}); if (currentFails) h.error();
  flush(() => oldError({target: old, currentTarget: old}));
  assert.equal(h.output(), currentFails ? 'placeholder' : 'img');
});
test('an earlier A callback cannot poison a fresh A after A to B to A', t => {
  const h = fixture(t); h.render(); const old = h.image()!, oldError = props(old).onError;
  h.render({...h.base, thumbnail_url: `${h.base.thumbnail_url}-new`}); h.render(h.base);
  flush(() => oldError({target: old, currentTarget: old})); assert.equal(h.output(), 'img');
});
test('inline videos remain on the existing video path while detail cards use the thumbnail', t => {
  const h = fixture(t); h.context.shortVideos = true; const post = {...h.base, url: 'https://youtube.com/watch?v=dQw4w9WgXcQ'};
  assert.equal(h.render(post, {inline: true}), 'none'); assert(h.find(node => node.getAttribute('class') === 'video'));
  assert.equal(h.render(post, {inline: false}), 'img');
});
// The fixture uses the production URL classifier, not substring host matching.
for (const url of [
  'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
  'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
  'https://evil.example/youtube.com/watch?v=dQw4w9WgXcQ',
  'https://evil.example/?next=https://youtube.com/watch?v=dQw4w9WgXcQ',
  'https://youtube.com@evil.example/watch?v=dQw4w9WgXcQ',
  'http://youtube.com/watch?v=dQw4w9WgXcQ',
  'https://youtube.com/watch?v=short',
  'not a URL containing youtube.com',
]) test(`untrusted or invalid video URL keeps the thumbnail: ${url}`, t => {
  const h = fixture(t); h.context.shortVideos = true;
  assert.equal(h.render({...h.base, url}, {inline: true}), 'img');
  assert.equal(h.find(node => node.getAttribute('class') === 'video'), undefined);
});
for (const url of [
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://youtu.be/dQw4w9WgXcQ',
  'https://www.youtube.com/shorts/dQw4w9WgXcQ',
  'https://www.youtube.com/embed/dQw4w9WgXcQ',
]) test(`canonical video URL retains inline playback and detail thumbnail: ${url}`, t => {
  const h = fixture(t); h.context.shortVideos = true;
  assert.equal(h.render({...h.base, url}, {inline: true}), 'none');
  assert.equal(Boolean(h.find(node => node.getAttribute('class') === 'video')), true);
  assert.equal(h.render({...h.base, url}, {inline: false}), 'img');
});
for (const boundary of ['wrong post ID', 'wrong post kind', 'wrong thumbnail URL', 'HTTP rejection', 'session before upload', 'session during prepare', 'session after response', 'no CSRF', 'another client']) test(`unconfirmed replacement preserves failed state: ${boundary}`, async t => {
  const h = fixture(t); h.render(); h.error();
  const payload = {...h.base, thumbnail_url: `/api/v1/social-posts/${h.base.post_id}/thumbnail`};
  if (boundary === 'wrong post ID') payload.post_id = 'another-post';
  if (boundary === 'wrong post kind') payload.kind = 'note';
  if (boundary === 'wrong thumbnail URL') payload.thumbnail_url = '/wrong';
  if (boundary.startsWith('wrong ')) h.state.response = {ok: true, status: 200, json: async () => payload};
  if (boundary === 'session before upload') h.context.client.sessionGeneration++;
  if (boundary === 'HTTP rejection') h.state.response = {ok: false, status: 403, json: async () => ({detail: 'denied'})};
  if (boundary === 'session during prepare') h.context.prepareSocialImage = async (value: File) => {h.context.client.sessionGeneration++; return value;};
  if (boundary === 'session after response') h.context.accessAwareFetch = async () => {h.context.client.sessionGeneration++; return {ok: true, status: 200, json: async () => ({...h.base, thumbnail_url: `/api/v1/social-posts/${h.base.post_id}/thumbnail`})};};
  if (boundary === 'no CSRF') h.context.client.csrfToken = null;
  if (boundary === 'another client') h.context.currentClient.current = {...h.context.client};
  await h.context.upload(h.base, file());
  assert.equal(h.context.confirmedWrites.current, 0); assert.equal(h.state.items[0].thumbnail_url, h.base.thumbnail_url);
  assert.equal(h.state.notice, ''); assert.equal(h.render(), 'placeholder');
  if (['session before upload', 'session during prepare', 'no CSRF', 'another client'].includes(boundary)) assert.equal(h.state.requests.length, 0);
});
