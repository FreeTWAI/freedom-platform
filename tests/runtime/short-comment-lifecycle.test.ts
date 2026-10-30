import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {transformSync} from 'esbuild';

// Actual class only: transport/schema imports are not needed by this controlled component harness.
const api = readFileSync(new URL('../../apps/portal-web/src/api.ts', import.meta.url), 'utf8');
const apiModule = {exports: {} as any};
const classStart = api.indexOf('export class ApiError extends Error {'), classEnd = api.indexOf('export type InstanceSelectionCandidate', classStart);
assert.ok(classStart >= 0 && classEnd > classStart);
runInNewContext(transformSync(api.slice(classStart, classEnd), {loader: 'ts', format: 'cjs'}).code, {module: apiModule, exports: apiModule.exports});
const ApiError = apiModule.exports.ApiError;
const source = readFileSync(new URL('../../apps/portal-web/src/modules/SocialInteractions.tsx', import.meta.url), 'utf8');
const parent = readFileSync(new URL('../../apps/portal-web/src/modules/SocialZone.tsx', import.meta.url), 'utf8');
type Element = {type: string; props: any};
function find(tree: any, predicate: (node: Element) => boolean): Element | undefined {
  if (!tree || typeof tree !== 'object') return;
  if (predicate(tree)) return tree;
  for (const child of [tree.props?.children].flat(Infinity)) { const match = find(child, predicate); if (match) return match; }
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function hooksHarness(code: string, name: string, props: any) {
  const hooks: any[] = [], effects: (() => void)[] = []; let index = 0;
  const react = {
    useRef(value: unknown) { const i = index++; return hooks[i] ?? (hooks[i] = {current: value}); },
    useState(value: any) { const i = index++; if (!(i in hooks)) hooks[i] = typeof value === 'function' ? value() : value; return [hooks[i], (next: any) => { hooks[i] = typeof next === 'function' ? next(hooks[i]) : next; }]; },
    useEffect(fn: () => unknown, deps: unknown[]) { const i = index++; if (!hooks[i] || deps.some((value, n) => value !== hooks[i].deps[n])) { hooks[i]?.cleanup?.(); hooks[i] = {deps}; effects.push(() => { hooks[i].cleanup = fn(); }); } },
  };
  const jsx = (type: string, props: any) => ({type, props}), module = {exports: {} as any};
  runInNewContext(transformSync(code, {loader: 'tsx', format: 'cjs', jsx: 'automatic'}).code, {
    module, exports: module.exports, crypto: webcrypto, URL, setTimeout, clearTimeout,
    require(name: string) { if (name === 'react') return react; if (name === 'react/jsx-runtime') return {jsx, jsxs: jsx}; if (name === '../api') return {ApiError}; if (name === '../format') return {formatIsoLocal: (value: string) => value}; return new Proxy({}, {get: (_, key) => String(key)}); },
  });
  function render() { index = 0; return module.exports[name](props); }
  function flush() { while (effects.length) effects.shift()!(); }
  return {render, flush, view() { render(); flush(); return render(); }, unmount() { for (const hook of hooks) hook?.cleanup?.(); }};
}
function interaction(initialOpen = true) {
  const requests: any[] = [], updates: any[] = [];
  const client = {sessionGeneration: 1, get: async () => ({items: [], next_cursor: null}), post: (path: string, body: any, options: any) => new Promise((resolve, reject) => requests.push({path, body, options, resolve, reject}))};
  const props = {client, post: {post_id: 'post-a', comment_count: 0}, canHide: false, initialOpen, onUpdate: (value: any) => updates.push(value)};
  const h = hooksHarness(source, 'SocialInteractions', props);
  function draft(text: string) { find(h.view(), n => n.type === 'textarea')!.props.onChange({target: {value: text}}); }
  function send() { find(h.view(), n => n.type === 'form')!.props.onSubmit({preventDefault() {}}); }
  const ack = {comment_id: 'comment-a', body: 'original', created_at: '2026-10-28T00:00:00.000Z', edited_at: null, revision: 1, mine: true, author: {user_id: 'member', display_name: 'Member'}};
  return {...h, props, client, requests, updates, draft, send, ack};
}
test('parent retains keyed owners independently of active dialog and bounds them to feed/session', () => {
  assert.match(parent, /items\.filter\(post => retainedShortIds\.includes\(post\.post_id\)\)\.map\(post => <ShortPostDialog key=\{post\.post_id\} active=\{shortPostId === post\.post_id\}/);
  assert.match(parent, /shortOwners\?\.client === client && shortOwners\.session === feedSession && shortOwners\.tag === tag/);
  assert.match(parent, /setShortOwners\(null\); setShortPostId\(null\); }, \[client, feedSession, platform, tag, directPost\]/);
  assert.match(parent, /current\.ids\.filter\(id => items\.some\(post => post\.post_id === id\)\)/);
  assert.match(parent, /platform === 'shorts' && !directPost && items\.filter/);
});
test('actual interaction accepts held ACK after dismissal without optimistic count or clearing another draft', async () => {
  const a = interaction(), b = interaction(); a.draft('original'); a.send();
  assert.equal(a.requests.length, 1); assert.equal(a.updates.length, 0);
  a.props.initialOpen = false; a.view(); b.draft('other draft');
  a.requests[0].resolve(a.ack); await settle();
  assert.equal(a.updates.length, 1); assert.equal(a.updates[0].comment_count, 1);
  assert.equal(find(b.view(), n => n.type === 'textarea')!.props.value, 'other draft');
  a.props.initialOpen = true; await settle(); assert.equal(find(a.view(), n => n.type === 'textarea')!.props.value, '');
});
test('unknown outcome retains exact key/body on reopening', async () => {
  const h = interaction(); h.draft('original'); h.send(); const first = h.requests[0];
  h.props.initialOpen = false; h.view(); first.reject(new ApiError({message: 'unknown', network: true})); await settle();
  h.props.initialOpen = true; h.view(); await settle();
  assert.equal(find(h.view(), n => n.type === 'textarea')!.props.value, 'original');
  assert.equal(find(h.view(), n => n.type === 'textarea')!.props.disabled, true);
  h.send(); assert.deepEqual(h.requests[1].body, first.body); assert.deepEqual(h.requests[1].options, first.options);
  h.requests[1].resolve(h.ack); await settle(); assert.equal(h.updates.length, 1);
});
for (const invalidation of ['session', 'unmount'] as const) test(`held ACK remains ignored after ${invalidation}`, async () => {
  const h = interaction(); h.draft('original'); h.send();
  if (invalidation === 'session') h.client.sessionGeneration++; else h.unmount();
  h.requests[0].resolve(h.ack); await settle(); assert.equal(h.updates.length, 0);
});
test('owner first opened for options expands comments on request', async () => {
  const h = interaction(false); assert.equal(find(h.view(), n => n.type === 'textarea'), undefined);
  h.props.initialOpen = true; h.view(); await settle(); assert.ok(find(h.view(), n => n.type === 'textarea'));
});
test('actual dialog closes synchronously, retains children and rejects delayed close after reopen', () => {
  const start = parent.indexOf('function ShortPostDialog('), end = parent.indexOf('export function SocialZone('); assert.ok(start >= 0 && end > start);
  let closed = 0;
  const props = {active: true, label: 'comments', onClose() { closed++; props.active = false; }, children: {draft: 'retained'}};
  const h = hooksHarness(`import {useRef,useEffect} from 'react'; export ${parent.slice(start, end)}`, 'ShortPostDialog', props);
  const dialog = {open: false, showModal() { this.open = true; }, close() { this.open = false; }};
  function view() { const node = h.render(); node.props.ref.current = dialog; h.flush(); return node; }
  let node = view(); assert.equal(dialog.open, true); const oldCloseEvent = node.props.onClose;
  node.props.children[0].props.onClick(); assert.equal(closed, 1); assert.equal(props.active, false);
  node = view(); assert.equal(node.props.children[1], props.children);
  props.active = true; node = view(); oldCloseEvent(); node.props.onClose(); assert.equal(closed, 1); assert.equal(dialog.open, true);
  node.props.onCancel(); assert.equal(props.active, false); dialog.close(); view(); assert.equal(dialog.open, false);
});
test('happy path waits completed exact POST and actual article rather than textarea text', () => {
  const spec = readFileSync(new URL('../e2e/short-videos-share.spec.ts', import.meta.url), 'utf8');
  assert.match(spec, /response\.request\(\)\.method\(\) === 'POST'/);
  assert.match(spec, /expect\(await response\.finished\(\)\)\.toBeNull\(\)/);
  assert.match(spec, /sheet\.locator\('article\.social-comment'\)\.filter\(\{hasText: '從 Short 留言'\}\)/);
  assert.doesNotMatch(spec, /sheet\.getByText\('從 Short 留言'\)/);
});
function reconcileHarness() {
  const requests: any[] = [], errors: string[] = [];
  const client = {sessionGeneration: 1, get: (path: string) => new Promise(resolve => requests.push({path, resolve}))};
  const post = {post_id: 'post-a', revision: 2, comment_count: 0, title: 'keep'}; let items = [post];
  const scope = {client, session: 1, platform: 'shorts', tag: 'tag-a', directPost: null};
  const context: any = {client, currentClient: {current: client}, feedSession: 1, feedScope: {current: scope}, shortCommentReads: {current: new Map()}, confirmedWrites: {current: 0}, loadSequence: {current: 1}, refreshSequence: {current: 1}, setItems(fn: (items: any[]) => any[]) { items = fn(items); }, setActionError(message: string) { errors.push(message); }};
  const start = parent.indexOf('  async function reconcileShortComments('), end = parent.indexOf('  const renderCard =', start); assert.ok(start >= 0 && end > start);
  runInNewContext(transformSync(`${parent.slice(start, end)}; globalThis.reconcile = reconcileShortComments;`, {loader: 'ts', format: 'cjs'}).code, context);
  return {context, client, post, requests, errors, get items() { return items; }, run: () => context.reconcile(post), reply: (index: number, patch: any = {}) => requests[index].resolve({items: [{...post, comment_count: 1, ...patch}]})};
}
test('authoritative count reconciliation does not replace post content or permissions', async () => {
  const h = reconcileHarness(); const task = h.run(); assert.equal(h.requests[0].path, '/social-posts?post_id=post-a');
  h.reply(0, {title: 'must not replace', can_hide: true}); await task;
  assert.equal(h.items[0].comment_count, 1); assert.equal(h.items[0].title, 'keep'); assert.equal('can_hide' in h.items[0], false);
});
for (const reason of ['client', 'session', 'tag', 'platform', 'navigation', 'refresh', 'removed'] as const) test(`count read cannot overwrite ${reason} replacement`, async () => {
  const h = reconcileHarness(); const task = h.run();
  if (reason === 'client') h.context.currentClient.current = {};
  if (reason === 'session') h.client.sessionGeneration++;
  if (reason === 'tag') h.context.feedScope.current = {...h.context.feedScope.current, tag: 'tag-b'};
  if (reason === 'platform') h.context.feedScope.current = {...h.context.feedScope.current, platform: 'note'};
  if (reason === 'navigation') h.context.loadSequence.current++;
  if (reason === 'refresh') h.context.refreshSequence.current++;
  if (reason === 'removed') h.context.setItems(() => []);
  h.reply(0); await task; assert.equal(h.items[0]?.comment_count ?? 0, 0); assert.equal(h.errors.length, 0);
});
test('older reconciliation cannot overwrite newer per-post receipt', async () => {
  const h = reconcileHarness(); const old = h.run(), newer = h.run(); h.reply(1, {comment_count: 2}); await newer; h.reply(0); await old; assert.equal(h.items[0].comment_count, 2);
});
test('intervening confirmed write allows one GET-only revalidation', async () => {
  const h = reconcileHarness(); const task = h.run(); h.context.confirmedWrites.current++; h.reply(0); await settle();
  assert.equal(h.requests.length, 2); assert.equal(h.items[0].comment_count, 0); h.reply(1, {comment_count: 2}); await task; assert.equal(h.items[0].comment_count, 2);
});
test('continued contention surfaces retry instead of applying old count', async () => {
  const h = reconcileHarness(); const task = h.run(); h.context.confirmedWrites.current++; h.reply(0); await settle(); h.context.confirmedWrites.current++; h.reply(1); await task;
  assert.equal(h.requests.length, 2); assert.equal(h.items[0].comment_count, 0); assert.equal(h.errors.length, 1);
});
for (const patch of [{post_id: 'wrong'}, {revision: 1}, {comment_count: -1}, {comment_count: 1.5}]) test(`malformed/old receipt rejected: ${JSON.stringify(patch)}`, async () => {
  const h = reconcileHarness(); const task = h.run(); h.reply(0, patch); await task; assert.equal(h.items[0].comment_count, 0); assert.equal(h.errors.length, 1);
});
test('committed unknown GET before replay preserves dedupe but still reconciles authoritative count', async () => {
  const h = interaction(); let reconciliations = 0; Object.assign(h.props, {onCommentsChanged: () => { reconciliations++; }});
  h.draft('original'); h.send(); const first = h.requests[0]; first.reject(new ApiError({message: 'ACK lost', network: true})); await settle();
  h.props.initialOpen = false; h.view(); (h.client as any).get = async () => ({items: [h.ack], next_cursor: null});
  h.props.initialOpen = true; h.view(); await settle(); h.view(); h.send();
  assert.deepEqual(h.requests[1].body, first.body); assert.deepEqual(h.requests[1].options, first.options);
  h.requests[1].resolve(h.ack); await settle(); assert.equal(h.updates.length, 0); assert.equal(reconciliations, 1);
});
