import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { migrate } from '../../scripts/database.js';
import { DEMO_COMMUNITY, DEMO_PASSWORD, DEMO_USERS, seedLocal } from '../../packages/testing/seed.js';
import { createApp } from '../../apps/platform-api/src/app.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL must name a disposable database');
const schema = `fp_works_public_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: url });
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 12 });
const origin = 'http://127.0.0.1:4310';
const adminEmail = 'ops@local.test';
const verifier = async (req: Request) => {
  assert.equal(req.headers.get('cf-access-jwt-assertion'), 'verified-admin-jwt');
  return { email: adminEmail, subject: 'sub-admin', csrfToken: 'admin-csrf' };
};
const app = createApp(pool, origin, 'local', { personalContentEnabled: true, adminVerifier: verifier });
const defaultApp = createApp(pool, origin, 'local');

before(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await migrate(pool); });
after(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
beforeEach(async () => { await pool.query('TRUNCATE communities,login_attempts,auth_rate_limits CASCADE'); await seedLocal(pool); });

type Member = {
  cookie: string;
  csrf: string;
  user: { user_id: string; display_name: string };
  req: (path: string, opts?: { method?: string; body?: unknown; version?: string; key?: string; headers?: Record<string, string> }) => Promise<Response>;
};

async function member(index: number, completeOnboarding = true): Promise<Member> {
  const res = await app.request(`${origin}/api/v1/auth/login`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: DEMO_USERS[index].email, password: DEMO_PASSWORD }),
  });
  assert.equal(res.status, 200);
  const data = await res.json() as { csrf_token: string; user: { user_id: string; display_name: string } };
  if (completeOnboarding) {
    await pool.query('UPDATE users SET onboarding_completed_at = now() WHERE user_id = $1', [data.user.user_id]);
  }
  const cookie = res.headers.get('set-cookie')!.split(';')[0];
  return {
    cookie,
    csrf: data.csrf_token,
    user: data.user,
    req: async (path, opts = {}) => {
      const { method = opts.body === undefined ? 'GET' : 'POST', body, version, key = randomUUID(), headers = {} } = opts;
      return app.request(`${origin}/api/v1/${path}`, {
        method,
        headers: {
          Origin: origin,
          Cookie: cookie,
          'X-CSRF-Token': data.csrf_token,
          ...(body !== undefined ? { 'Content-Type': 'application/json', 'Idempotency-Key': key } : {}),
          ...(version ? { 'If-Match': `"${version}"` } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    },
  };
}

async function createPublishedWork(m: Member, overrides: Partial<{ title: string; description: string; artifact_ref: string; public_url: string | null }> = {}) {
  const res = await m.req('showcases', {
    body: {
      title: overrides.title ?? '公開閱讀測試作品 <script>alert(1)</script>',
      description: overrides.description ?? '這是作品摘要，說明設計與實作重點。',
      artifact_ref: overrides.artifact_ref ?? 'artifact:private-internal-key-999',
      consent_to_share: true,
      ...(overrides.public_url !== undefined ? { public_url: overrides.public_url } : { public_url: 'https://example.com/demo-work' }),
    },
  });
  assert.equal(res.status, 201, await res.clone().text());
  return await res.json() as { showcase_id: string; aggregate_version: string; title: string };
}

test('attacker checks: another member, admin without ownership, another community, agent token, and stale versions are rejected', async () => {
  const owner = await member(0);
  const other = await member(1);
  const incomplete = await member(2, false);
  await pool.query('UPDATE users SET onboarding_required = true, onboarding_completed_at = NULL WHERE user_id = $1', [incomplete.user.user_id]);

  const work = await createPublishedWork(owner);
  const sharingPath = `me/showcases/${work.showcase_id}/sharing`;

  // Existing work starts member-only; no public page or API exposure.
  const initialGet = await owner.req(sharingPath);
  assert.equal(initialGet.status, 200);
  const initialState = await initialGet.json() as { enabled: boolean; available: boolean; version: string; work_version: string };
  assert.equal(initialState.enabled, false);
  assert.equal(initialState.available, false);
  assert.equal(initialGet.headers.get('etag'), `"${initialState.version}"`);

  // Same 404 response for missing, non-opted-in, and invalid UUID.
  const notOptedInPage = await app.request(`${origin}/works/${work.showcase_id}`);
  const missingPage = await app.request(`${origin}/works/${randomUUID()}`);
  const badIdPage = await app.request(`${origin}/works/not-a-uuid`);
  assert.equal(notOptedInPage.status, 404);
  assert.equal(missingPage.status, 404);
  assert.equal(badIdPage.status, 404);
  const baseline404Html = await missingPage.text();
  assert.equal(await notOptedInPage.text(), baseline404Html);
  assert.equal(await badIdPage.text(), baseline404Html);
  assert.equal((await app.request(`${origin}/api/v1/public/works/${work.showcase_id}`)).status, 404);

  // Unauthenticated caller -> 401
  assert.equal((await app.request(`${origin}/api/v1/${sharingPath}`)).status, 401);

  // Incomplete onboarding member -> 403
  assert.equal((await incomplete.req(sharingPath)).status, 403);

  // Another member -> 404 on both GET and PUT
  assert.equal((await other.req(sharingPath)).status, 404);
  assert.equal((await other.req(sharingPath, { method: 'PUT', body: { enabled: true }, version: initialState.version })).status, 404);

  // Admin without ownership (admin JWT header alone without member session -> 401; admin header + other member -> 404)
  assert.equal((await app.request(`${origin}/api/v1/${sharingPath}`, {
    headers: { 'Cf-Access-Jwt-Assertion': 'verified-admin-jwt' },
  })).status, 401);
  assert.equal((await other.req(sharingPath, {
    method: 'PUT',
    body: { enabled: true },
    version: initialState.version,
    headers: { 'Cf-Access-Jwt-Assertion': 'verified-admin-jwt' },
  })).status, 404);

  // Another community member -> 404
  const secondCommunityId = randomUUID();
  const outsiderId = randomUUID();
  await pool.query('INSERT INTO communities VALUES($1, $2)', [secondCommunityId, '外部社群']);
  await pool.query(`INSERT INTO users(user_id, community_id, email, display_name, password_hash, profession_membership_ref)
    SELECT $1, $2, 'outsider@local.test', '外部成員', password_hash, $3 FROM users WHERE user_id = $4`,
  [outsiderId, secondCommunityId, randomUUID(), owner.user.user_id]);
  const outsiderLogin = await app.request(`${origin}/api/v1/auth/login`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'outsider@local.test', password: DEMO_PASSWORD }),
  });
  assert.equal(outsiderLogin.status, 200);
  const outsiderData = await outsiderLogin.json() as { csrf_token: string };
  const outsiderCookie = outsiderLogin.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await app.request(`${origin}/api/v1/${sharingPath}`, {
    method: 'PUT',
    headers: { Origin: origin, Cookie: outsiderCookie, 'X-CSRF-Token': outsiderData.csrf_token, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(), 'If-Match': `"${initialState.version}"` },
    body: JSON.stringify({ enabled: true }),
  })).status, 404);

  // Agent token without owner scope -> 403 scope_required on both GET and PUT
  const issued = await owner.req('me/agent-tokens', { body: { name: 'Works Agent', scopes: ['read', 'share', 'rsvp'] } });
  assert.equal(issued.status, 201, await issued.clone().text());
  const agentToken = (await issued.json() as { access_token: string }).access_token;
  assert.equal((await app.request(`${origin}/api/v1/${sharingPath}`, {
    headers: { Authorization: `Bearer ${agentToken}` },
  })).status, 403);
  assert.equal((await app.request(`${origin}/api/v1/${sharingPath}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${agentToken}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(), 'If-Match': `"${initialState.version}"` },
    body: JSON.stringify({ enabled: true }),
  })).status, 403);

  // Missing If-Match -> 428; Stale If-Match -> 412; Stale work_version -> 412; Missing CSRF -> 403
  assert.equal((await owner.req(sharingPath, { method: 'PUT', body: { enabled: true }, headers: { 'X-CSRF-Token': 'wrong-csrf' } })).status, 403);
  assert.equal((await owner.req(sharingPath, { method: 'PUT', body: { enabled: true } })).status, 428);
  assert.equal((await owner.req(sharingPath, { method: 'PUT', body: { enabled: true }, version: '999' })).status, 412);
  assert.equal((await owner.req(sharingPath, { method: 'PUT', body: { enabled: true, work_version: '999' }, version: initialState.version })).status, 412);

  // Unpublished draft cannot be opted in -> 409
  const draftRes = await owner.req('me/showcases', { body: { title: '未發布草稿', description: '草稿內容不可公開' } });
  assert.equal(draftRes.status, 201);
  const draft = await draftRes.json() as { showcase_id: string; aggregate_version: string };
  assert.equal((await owner.req(`me/showcases/${draft.showcase_id}/sharing`, {
    method: 'PUT',
    body: { enabled: true, work_version: draft.aggregate_version },
    version: draft.aggregate_version,
  })).status, 409);
  assert.equal(await (await app.request(`${origin}/works/${draft.showcase_id}`)).text(), baseline404Html);
});

test('consent idempotency, concurrency, default app without personalContent flag, SSR headers/OG/no-leaks, edit invalidation, and withdrawal', async () => {
  const owner = await member(0);
  const sharer = await member(1);
  const work = await createPublishedWork(owner, {
    title: '作品「光影」<img src=x onerror=alert(1)>',
    description: '只有核准版本會出現在公開頁面中。',
    artifact_ref: 'artifact:SECRET-DRAFT-PATH',
    public_url: 'https://example.com/public-showcase',
  });
  const path = `me/showcases/${work.showcase_id}/sharing`;

  // Default built app (personalContentEnabled=false) still allows owner to manage /me/showcases/:id/sharing.
  const defGet = await defaultApp.request(`${origin}/api/v1/${path}`, {
    headers: { Origin: origin, Cookie: owner.cookie, 'X-CSRF-Token': owner.csrf },
  });
  assert.equal(defGet.status, 200);
  const s0 = await defGet.json() as { version: string; work_version: string };

  // Concurrent writes with same If-Match: one succeeds, one gets 412.
  const idempKey = randomUUID();
  const [c1, c2] = await Promise.all([
    defaultApp.request(`${origin}/api/v1/${path}`, {
      method: 'PUT',
      headers: { Origin: origin, Cookie: owner.cookie, 'X-CSRF-Token': owner.csrf, 'Content-Type': 'application/json', 'Idempotency-Key': idempKey, 'If-Match': `"${s0.version}"` },
      body: JSON.stringify({ enabled: true, work_version: s0.work_version }),
    }),
    defaultApp.request(`${origin}/api/v1/${path}`, {
      method: 'PUT',
      headers: { Origin: origin, Cookie: owner.cookie, 'X-CSRF-Token': owner.csrf, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(), 'If-Match': `"${s0.version}"` },
      body: JSON.stringify({ enabled: true, work_version: s0.work_version }),
    }),
  ]);
  const statuses = [c1.status, c2.status].sort();
  assert.deepEqual(statuses, [200, 412]);

  // Idempotent replay with same key & body succeeds with 200, conflict with different body returns 409.
  const replay = await defaultApp.request(`${origin}/api/v1/${path}`, {
    method: 'PUT',
    headers: { Origin: origin, Cookie: owner.cookie, 'X-CSRF-Token': owner.csrf, 'Content-Type': 'application/json', 'Idempotency-Key': idempKey, 'If-Match': `"${s0.version}"` },
    body: JSON.stringify({ enabled: true, work_version: s0.work_version }),
  });
  assert.equal(replay.status, 200);
  const conflictBody = await defaultApp.request(`${origin}/api/v1/${path}`, {
    method: 'PUT',
    headers: { Origin: origin, Cookie: owner.cookie, 'X-CSRF-Token': owner.csrf, 'Content-Type': 'application/json', 'Idempotency-Key': idempKey, 'If-Match': `"${s0.version}"` },
    body: JSON.stringify({ enabled: false, work_version: s0.work_version }),
  });
  assert.equal(conflictBody.status, 409);

  // Check SSR /works/:id and public projection JSON.
  const pageRes = await defaultApp.request(`${origin}/works/${work.showcase_id}`);
  assert.equal(pageRes.status, 200);
  assert.equal(pageRes.headers.get('cache-control'), 'no-store');
  assert.equal(pageRes.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(pageRes.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.match(pageRes.headers.get('content-security-policy') ?? '', /script-src 'self'/);
  const html = await pageRes.text();
  assert.match(html, /property="og:type" content="article"/);
  assert.match(html, /property="og:title" content="作品「光影」&lt;img src=x onerror=alert\(1\)&gt;｜自由工坊"/);
  assert.match(html, /property="og:url" content="https:\/\/[^"]+\/works\//);
  assert.match(html, /property="og:image"/);
  assert.match(html, /https:\/\/example\.com\/public-showcase/);
  assert.match(html, new RegExp(DEMO_USERS[0].display_name));
  // Never leak private fields, internal artifact_ref, owner email, or unescaped script.
  assert.equal(html.includes('SECRET-DRAFT-PATH'), false);
  assert.equal(html.includes(DEMO_USERS[0].email), false);
  assert.equal(html.includes('<img src=x'), false);

  // Sharer credit (?via=) shows only for valid active share link pointing to THIS work.
  const shareRes = await sharer.req('shares', { body: { kind: 'work', ref_id: work.showcase_id } });
  assert.equal(shareRes.status, 200, await shareRes.clone().text());
  const workShareId = (await shareRes.json() as { share_id: string }).share_id;
  const linkCode = 'worksharer';
  await pool.query(
    `INSERT INTO promotion_links(link_id, community_id, user_id, kind, target_key, code)
     VALUES($1, $2, $3, 'share', $4, $5)`,
    [randomUUID(), DEMO_COMMUNITY, sharer.user.user_id, workShareId, linkCode],
  );
  const viaHtml = await (await defaultApp.request(`${origin}/works/${work.showcase_id}?via=${linkCode}`)).text();
  assert.match(viaHtml, new RegExp(`由 ${DEMO_USERS[1].display_name} 推薦分享`));
  assert.equal(viaHtml.includes(DEMO_USERS[1].email), false);
  const badViaHtml = await (await defaultApp.request(`${origin}/works/${work.showcase_id}?via=nonexistentcode`)).text();
  assert.equal(badViaHtml.includes('推薦分享'), false);

  // Withdrawing and editing the work immediately hides /works/:id until re-published AND re-confirmed.
  const baseline404 = await (await defaultApp.request(`${origin}/works/${randomUUID()}`)).text();
  const wdRes = await owner.req(`me/showcases/${work.showcase_id}/withdraw`, {
    body: {},
    version: work.aggregate_version,
  });
  assert.equal(wdRes.status, 200, await wdRes.clone().text());
  const withdrawn = await wdRes.json() as { aggregate_version: string };
  assert.equal(await (await defaultApp.request(`${origin}/works/${work.showcase_id}`)).text(), baseline404);
  assert.equal((await defaultApp.request(`${origin}/api/v1/public/works/${work.showcase_id}`)).status, 404);

  const editRes = await owner.req(`me/showcases/${work.showcase_id}`, {
    method: 'PATCH',
    body: { title: '改版作品標題', description: '改版摘要內容', artifact_ref: 'artifact:v2', public_url: 'https://example.com/public-v2' },
    version: withdrawn.aggregate_version,
  });
  assert.equal(editRes.status, 200, await editRes.clone().text());
  const edited = await editRes.json() as { aggregate_version: string };
  assert.equal(await (await defaultApp.request(`${origin}/works/${work.showcase_id}`)).text(), baseline404);

  // Re-publishing alone does NOT make /works/:id public again.
  const repub = await owner.req(`me/showcases/${work.showcase_id}/publish`, {
    body: { consent_to_share: true },
    version: edited.aggregate_version,
  });
  assert.equal(repub.status, 200);
  const republished = await repub.json() as { aggregate_version: string };
  assert.equal((await defaultApp.request(`${origin}/works/${work.showcase_id}`)).status, 404);

  // Owner reads fresh sharing state and confirms the new version.
  const freshState = await (await owner.req(path)).json() as { enabled: boolean; needs_reconfirmation: boolean; version: string; work_version: string };
  assert.equal(freshState.enabled, false);
  assert.equal(freshState.needs_reconfirmation, true);
  assert.equal(String(freshState.work_version), String(republished.aggregate_version));

  const reconfirmed = await owner.req(path, {
    method: 'PUT',
    body: { enabled: true, work_version: freshState.work_version },
    version: freshState.version,
  });
  assert.equal(reconfirmed.status, 200);
  const reconfirmedState = await reconfirmed.json() as { enabled: boolean; available: boolean; version: string };
  assert.equal(reconfirmedState.enabled, true);
  assert.equal(reconfirmedState.available, true);

  // Revised work renders updated content, and unsafe scheme stored in DB is omitted from href.
  const reHtml = await (await defaultApp.request(`${origin}/works/${work.showcase_id}`)).text();
  assert.match(reHtml, /改版作品標題/);
  assert.match(reHtml, /https:\/\/example\.com\/public-v2/);
  await pool.query("UPDATE showcases SET public_url = 'javascript:alert(1)' WHERE showcase_id = $1", [work.showcase_id]);
  // Trigger also hid it automatically on raw DB edit.
  assert.equal((await defaultApp.request(`${origin}/works/${work.showcase_id}`)).status, 404);
  const afterDbEdit = await (await owner.req(path)).json() as { enabled: boolean; version: string; work_version: string };
  assert.equal(afterDbEdit.enabled, false);
  const reconfirmedAgain = await owner.req(path, {
    method: 'PUT',
    body: { enabled: true, work_version: afterDbEdit.work_version },
    version: afterDbEdit.version,
  });
  assert.equal(reconfirmedAgain.status, 200);
  const unsafeFilteredHtml = await (await defaultApp.request(`${origin}/works/${work.showcase_id}`)).text();
  assert.equal(unsafeFilteredHtml.includes('javascript:'), false);
  const afterUnsafeReconfirm = await reconfirmedAgain.json() as { version: string };

  // Withdrawing consent takes effect immediately with exact same 404 HTML.
  const withdrawRes = await owner.req(path, {
    method: 'PUT',
    body: { enabled: false },
    version: afterUnsafeReconfirm.version,
  });
  assert.equal(withdrawRes.status, 200);
  const afterWithdraw = await defaultApp.request(`${origin}/works/${work.showcase_id}`);
  assert.equal(afterWithdraw.status, 404);
  assert.equal(await afterWithdraw.text(), baseline404);
});

// Execute the real control and PortalClient with delayed HTTP, following the
// existing component harness pattern in skill-share-client.test.ts.
async function sharingControl(t: import('node:test').TestContext) {
  const { existsSync, readFileSync } = await import('node:fs');
  const pathMod = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { runInNewContext } = await import('node:vm');
  const { webcrypto } = await import('node:crypto');
  const { createRequire } = await import('node:module');
  const { transformSync } = await import('esbuild');
  const React = (await import('react')).default;
  const { PortalClient, ApiError } = await import('../../apps/portal-web/src/api.js');

  class HostNode {
    [key: string]: any;
    parentNode: HostNode | null = null;
    childNodes: HostNode[] = [];
    attributes: Record<string, string> = {};
    style = { setProperty() {}, removeProperty() {} };
    listeners: Record<string, Function[]> = {};
    namespaceURI = 'http://www.w3.org/1999/xhtml';
    open = false;
    constructor(public nodeType: number, public nodeName: string, public ownerDocument: any) {
      if (nodeType === 1) this.tagName = nodeName;
    }
    appendChild(node: HostNode) { node.parentNode?.removeChild(node); this.childNodes.push(node); node.parentNode = this; return node; }
    removeChild(node: HostNode) { const i = this.childNodes.indexOf(node); assert.notEqual(i, -1); this.childNodes.splice(i, 1); node.parentNode = null; return node; }
    insertBefore(node: HostNode, before: HostNode) { node.parentNode?.removeChild(node); const i = this.childNodes.indexOf(before); assert.notEqual(i, -1); this.childNodes.splice(i, 0, node); node.parentNode = this; return node; }
    setAttribute(key: string, value: unknown) { this.attributes[key] = String(value); if (key === 'open') this.open = true; }
    removeAttribute(key: string) { delete this.attributes[key]; if (key === 'open') this.open = false; }
    getAttribute(key: string) { return this.attributes[key] ?? null; }
    setAttributeNS(_ns: string, key: string, value: unknown) { this.setAttribute(key, value); }
    addEventListener(type: string, fn: Function) { (this.listeners[type] ??= []).push(fn); }
    removeEventListener(type: string, fn: Function) { this.listeners[type] = (this.listeners[type] ?? []).filter(x => x !== fn); }
    get firstChild(): HostNode | null { return this.childNodes[0] ?? null; }
    get lastChild(): HostNode | null { return this.childNodes.at(-1) ?? null; }
    get nextSibling(): HostNode | null { return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null; }
    get textContent(): string { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(n => n.textContent).join(''); }
    set textContent(value: string) { this.childNodes.forEach(n => { n.parentNode = null; }); this.childNodes = []; if (value) this.appendChild(this.ownerDocument.createTextNode(String(value))); }
    get parentElement(): HostNode | null { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
    contains(node: HostNode): boolean { return node === this || this.childNodes.some(c => c.contains(node)); }
    closest() { return null; }
    showModal() { this.open = true; this.setAttribute('open', ''); }
    close() { this.open = false; this.removeAttribute('open'); }
    focus() {}
    select() {}
  }
  class HostDocument extends HostNode {
    constructor() {
      super(9, '#document', null); this.ownerDocument = this;
      this.documentElement = new HostNode(1, 'HTML', this); this.body = new HostNode(1, 'BODY', this);
      this.appendChild(this.documentElement); this.documentElement.appendChild(this.body); this.activeElement = this.body;
    }
    createElement(name: string) { return new HostNode(1, name.toUpperCase(), this); }
    createElementNS(ns: string, name: string) { const node = this.createElement(name); node.namespaceURI = ns; return node; }
    createTextNode(value: string) { const node = new HostNode(3, '#text', this); node.nodeValue = value; return node; }
  }
  const document = new HostDocument();
  const clipboard = { writeText: async (text: string) => { copies.push(text); } };
  const navigatorState = { clipboard };
  const windowObj = {
    location: { origin }, open() { throw Error('No external navigation permitted'); },
    document, HTMLElement: HostNode, HTMLDetailsElement: class extends HostNode {}, HTMLIFrameElement: class {},
    addEventListener() {}, removeEventListener() {}, get event() { return undefined; },
  };
  document.defaultView = windowObj;
  Object.assign(globalThis, { document, window: windowObj, HTMLElement: HostNode, HTMLDetailsElement: windowObj.HTMLDetailsElement, Node: HostNode, IS_REACT_ACT_ENVIRONMENT: true });
  const req = createRequire(import.meta.url);
  const { createRoot } = req('react-dom/client') as typeof import('react-dom/client');
  const { flushSync } = req('react-dom') as typeof import('react-dom');
  const flushReact = (fn: () => void) => React.act(() => flushSync(fn));

  const client = new PortalClient();
  client.csrfToken = randomUUID();
  const requests: any[] = [], copies: string[] = [];
  let writes = 0, renders = 0;
  const wrappedSetters = new WeakMap<Function, Function>();
  const wrapSetter = (setter: Function) => {
    let wrapped = wrappedSetters.get(setter);
    if (!wrapped) {
      wrapped = (next: unknown) => { writes++; return setter(next); };
      wrappedSetters.set(setter, wrapped);
    }
    return wrapped;
  };
  const trackedReact = {
    ...React,
    useState: <T,>(initial?: T | (() => T)) => {
      const [value, setValue] = React.useState(initial as T);
      return [value, wrapSetter(setValue)] as [T, typeof setValue];
    },
  };
  let props: any = { showcaseId: randomUUID(), workVersion: '1', status: 'published', onReload: async () => {} };
  t.mock.method(globalThis, 'fetch', (path: string, options: any) => {
    if (path.endsWith('/me/client-errors')) return Promise.resolve(new Response(null, { status: 204 }));
    return new Promise((resolve, reject) => requests.push({ path, options, resolve, reject }));
  });

  const base = fileURLToPath(new URL('../../', import.meta.url));
  const cache = new Map<string, any>();
  const compile = (relative: string): any => {
    const file = pathMod.resolve(base, relative);
    if (cache.has(file)) return cache.get(file);
    const mod = { exports: {} as any }; cache.set(file, mod.exports);
    const raw = readFileSync(file, 'utf8');
    runInNewContext(transformSync(raw, { loader: relative.endsWith('.tsx') ? 'tsx' : 'ts', format: 'cjs', jsx: 'automatic' }).code, {
      module: mod, exports: mod.exports, crypto: webcrypto, Intl, URL, console, setTimeout, clearTimeout,
      window: windowObj, document, navigator: navigatorState,
      require(name: string) {
        if (name === 'react') return trackedReact;
        if (name === 'react/jsx-runtime' || name === 'react-dom' || name === 'qrcode') return req(name);
        if (name === '../api') return { ApiError };
        if (name === '../portal-session') return { client, describeError: (e: Error) => ({ message: e.message }) };
        if (name === '../language') return { useLanguage: () => ({ t: (k: string) => k }) };
        if (name.endsWith('.css')) return {};
        if (name.startsWith('.')) {
          const resolved = pathMod.resolve(pathMod.dirname(file), name);
          const target = [resolved, resolved + '.ts', resolved + '.tsx'].find(existsSync);
          assert.ok(target, `missing ${name}`);
          return compile(pathMod.relative(base, target));
        }
        throw Error('Unexpected import: ' + name);
      },
    });
    cache.set(file, mod.exports);
    return mod.exports;
  };
  const { WorkPublicSharing } = compile('apps/portal-web/src/modules/WorkPublicSharing.tsx');
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);
  let unmounted = false;
  const render = () => {
    if (!unmounted) flushReact(() => root.render(
      React.createElement(React.Profiler, { id: 'work-public', onRender: () => { renders++; } },
        React.createElement(WorkPublicSharing, props)),
    ));
  };
  const unmount = () => {
    if (!unmounted) {
      unmounted = true;
      flushReact(() => root.unmount());
      container.parentNode?.removeChild(container);
      delete (globalThis as any).window;
      delete (globalThis as any).document;
      delete (globalThis as any).HTMLElement;
      delete (globalThis as any).HTMLDetailsElement;
      delete (globalThis as any).Node;
      delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    }
  };
  t.after(unmount);

  const propsOf = (node: HostNode) => node[Object.keys(node).find(k => k.startsWith('__reactProps$'))!];
  const descendants = (node: HostNode): HostNode[] => [node, ...node.childNodes.flatMap(descendants)];
  const view = () => descendants(document.body);
  const toggle = () => {
    const node = view().find(n => n.getAttribute('role') === 'switch')!;
    return { props: { ...propsOf(node), disabled: Boolean(propsOf(node).disabled), checked: Boolean(propsOf(node).checked) } };
  };
  const flush = () => React.act(async () => { await new Promise<void>(resolve => setImmediate(resolve)); });
  const response = async (index: number, body: unknown, status = 200) => {
    requests[index].resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
    await flush();
  };
  const sharing = (version = '1', enabled = false) => ({ showcase_id: props.showcaseId, status: 'published', visibility: 'community', enabled, available: enabled, needs_reconfirmation: false, work_version: version, approved_work_version: enabled ? version : null, version, public_path: `/works/${props.showcaseId}` });
  const start = async (enabled = false, version = '1') => { render(); await response(0, sharing(version, enabled)); };
  const clickButton = (label: string) => {
    const button = view().find(n => n.nodeName === 'BUTTON' && n.textContent === label);
    assert.ok(button && !propsOf(button).disabled, `${label} enabled`);
    flushReact(() => propsOf(button).onClick({ preventDefault() {}, stopPropagation() {} }));
  };
  const share = () => clickButton('分享');
  const act = (fn: () => void | Promise<void>) => React.act(fn);
  return { props, client, requests, copies, clipboard, view, toggle, response, sharing, start, render, share, clickButton, flush, unmount, propsOf, act, writes: () => writes, renders: () => renders };
}

test('stale displayed work cannot opt in after a conflict until its complete content has reloaded', async t => {
  const h = await sharingControl(t);
  let finishReload!: () => void, reloads = 0;
  h.props.onReload = () => { reloads++; return new Promise<void>(resolve => { finishReload = resolve; }); };
  await h.start();
  await h.act(async () => { h.toggle().props.onChange({ target: { checked: true } }); });
  assert.equal(JSON.parse(h.requests[1].options.body).work_version, '1');
  await h.response(1, { code: 'version_conflict', detail: '作品內容已更新' }, 412);
  await h.response(2, h.sharing('4'));
  assert.equal(h.toggle().props.disabled, true);
  assert.ok(h.view().some(n => n.textContent === '作品已更新，請重新檢視後再開放'));
  assert.equal(reloads, 1);
  await h.act(async () => { h.toggle().props.onChange({ target: { checked: true } }); });
  assert.equal(h.requests.length, 3, 'even a queued event cannot submit unseen content');
  h.props.workVersion = '4';
  h.render();
  finishReload();
  await h.flush();
  await h.response(3, h.sharing('4'));
  assert.equal(h.toggle().props.disabled, false);
  await h.act(async () => { h.toggle().props.onChange({ target: { checked: true } }); });
  assert.equal(JSON.parse(h.requests[4].options.body).work_version, '4');
  await h.response(4, h.sharing('4', true));
  assert.equal(h.toggle().props.checked, true);
});

test('sharing state newer than the displayed work disables consent immediately', async t => {
  const h = await sharingControl(t);
  await h.start(false, '4');
  assert.equal(h.toggle().props.disabled, true);
  await h.act(async () => { h.toggle().props.onChange({ target: { checked: true } }); });
  assert.equal(h.requests.length, 1);
});

for (const stage of ['share', 'link', 'clipboard', 'failure', 'unmount'] as const) {
  test(`work sharing stops on session change during ${stage}`, async t => {
    const h = await sharingControl(t);
    await h.start(true);
    let finishCopy!: () => void;
    if (stage === 'clipboard') h.clipboard.writeText = async text => { h.copies.push(text); await new Promise<void>(resolve => { finishCopy = resolve; }); };
    h.share();
    if (stage === 'link' || stage === 'clipboard') await h.response(1, { share_id: randomUUID() });
    if (stage === 'clipboard') {
      await h.response(2, { path: '/go/abcdefghij' });
      h.clickButton('複製連結');
    }
    if (stage === 'unmount') h.unmount();
    else { h.client.csrfToken = null; h.client.csrfToken = randomUUID(); h.render(); }
    const writes = h.writes();
    const renders = h.renders();
    if (stage === 'clipboard') { finishCopy(); await h.flush(); }
    else if (stage === 'link') await h.response(2, { path: '/go/abcdefghij' });
    else await h.response(1, stage === 'failure' ? { code: 'failed' } : { share_id: randomUUID() }, stage === 'failure' ? 503 : 200);
    assert.equal(h.requests.filter(r => !r.path.endsWith('/client-errors')).length, stage === 'link' || stage === 'clipboard' ? 3 : 2, 'no next request under another session');
    assert.equal(h.copies.length, stage === 'clipboard' ? 1 : 0, 'no clipboard write after session ends');
    assert.equal(h.writes(), writes, 'no late success, error, or busy state updates');
    assert.equal(h.renders(), renders, 'no late React renders after session ends or unmount');
    if (stage === 'unmount') assert.equal(h.view().find(n => n.nodeName === 'DIALOG' && n.open), undefined);
  });
}

test('a failed conflict refresh keeps consent disabled until the work is reloaded', async t => {
  const h = await sharingControl(t);
  await h.start();
  await h.act(async () => { h.toggle().props.onChange({ target: { checked: true } }); });
  await h.response(1, { code: 'version_conflict' }, 412);
  await h.response(2, { code: 'unavailable' }, 503);
  assert.equal(h.toggle().props.disabled, true);
  const count = h.requests.filter(r => !r.path.endsWith('/client-errors')).length;
  await h.act(async () => { h.toggle().props.onChange({ target: { checked: true } }); });
  assert.equal(h.requests.filter(r => !r.path.endsWith('/client-errors')).length, count);
});

test('same-session sharing creates one link and copies its returned attribution URL', async t => {
  const h = await sharingControl(t);
  await h.start(true);
  h.share();
  const id = randomUUID();
  await h.response(1, { share_id: id });
  assert.equal(h.requests[2].path, `/api/v1/shares/${id}/links`);
  await h.response(2, { path: '/go/abcdefghij' });
  assert.equal(h.view().find(n => n.getAttribute('class') === 'skill-share-url')?.textContent, `${origin}/go/abcdefghij`);
  h.clickButton('複製連結');
  await h.flush();
  assert.deepEqual(h.copies, [`${origin}/go/abcdefghij`]);
  assert.ok(h.view().some(n => n.nodeName === 'A' && n.getAttribute('href') === `/works/${h.props.showcaseId}`));
});

test('CONF-9: work share button is disabled while toggle request is busy', async t => {
  const h = await sharingControl(t);
  await h.start(true);
  const shareButton = () => h.view().find(n => n.nodeName === 'BUTTON' && n.textContent === '分享');
  assert.ok(shareButton());
  assert.equal(Boolean(h.propsOf(shareButton()!).disabled), false);

  await h.act(async () => { h.toggle().props.onChange({ target: { checked: false } }); });
  assert.equal(h.toggle().props.disabled, true);
  assert.equal(Boolean(h.propsOf(shareButton()!).disabled), true);
  h.propsOf(shareButton()!).onClick?.({ preventDefault() {}, stopPropagation() {} });
  assert.equal(h.requests.filter(r => !r.path.endsWith('/client-errors')).length, 2);

  await h.response(1, { code: 'server_error', detail: 'fail' }, 500);
  await h.response(2, h.sharing('1', true));
  assert.equal(Boolean(h.propsOf(shareButton()!).disabled), false);
});

test('UX-V-15: /works/:id has one btn-primary, unique hrefs, short pre-action copy, and 404 escapes id with matching security headers', async () => {
  const owner = await member(0);
  const work = await createPublishedWork(owner, {
    title: '公開作品測試標題',
    description: '測試摘要內容',
    public_url: 'https://example.com/v15-work',
  });
  const s0Res = await defaultApp.request(`${origin}/api/v1/me/showcases/${work.showcase_id}/sharing`, {
    headers: { Origin: origin, Cookie: owner.cookie, 'X-CSRF-Token': owner.csrf },
  });
  const s0 = await s0Res.json() as { version: string; work_version: string };
  const pub = await defaultApp.request(`${origin}/api/v1/me/showcases/${work.showcase_id}/sharing`, {
    method: 'PUT',
    headers: { Origin: origin, Cookie: owner.cookie, 'X-CSRF-Token': owner.csrf, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(), 'If-Match': `"${s0.version}"` },
    body: JSON.stringify({ enabled: true, work_version: s0.work_version }),
  });
  assert.equal(pub.status, 200);

  const found = await defaultApp.request(`${origin}/works/${work.showcase_id}`);
  assert.equal(found.status, 200);
  const headerNames = ['cache-control', 'referrer-policy', 'x-robots-tag', 'x-content-type-options', 'content-security-policy'];
  for (const h of headerNames) assert.ok(found.headers.get(h), `missing header ${h} on 200`);
  assert.equal(found.headers.get('cache-control'), 'no-store');
  assert.equal(found.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(found.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(found.headers.get('x-content-type-options'), 'nosniff');
  const foundCsp = found.headers.get('content-security-policy') ?? '';
  assert.match(foundCsp, /script-src 'self'/);
  assert.match(foundCsp, /style-src 'self'/);
  const foundHtml = await found.text();
  assert.equal((foundHtml.match(/\bbtn-primary\b/g) ?? []).length, 1);
  assert.doesNotMatch(foundHtml, /<script(?![^>]*\bsrc=)/i);
  assert.doesNotMatch(foundHtml, /<style\b/i);
  assert.doesNotMatch(foundHtml, /\sstyle=/i);
  assert.doesNotMatch(foundHtml, /\son[a-z]{2,}\s*=/i);
  const foundHrefs = [...foundHtml.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(foundHrefs).size, foundHrefs.length, `duplicate hrefs on /works/:id: ${foundHrefs.join(', ')}`);
  const foundMain = foundHtml.slice(foundHtml.indexOf('<main'), foundHtml.indexOf('</main>'));
  const foundPre = foundMain.slice(0, foundMain.search(/<a\b[^>]*btn-primary/)).replace(/<[^>]*>/g, '')
    .replaceAll(DEMO_USERS[0].display_name, '').replace(Array.from(DEMO_USERS[0].display_name)[0] ?? '', '')
    .replaceAll('公開作品測試標題', '').replaceAll('測試摘要內容', '').replaceAll('前往作品外部連結', '').replaceAll('外部連結', '').replace(/\s+/g, '');
  assert.ok(foundPre.length <= 20, `expected <=20 static chars before btn-primary, got ${foundPre.length}: ${foundPre}`);

  const badId = '<script>alert(1)</script>';
  for (const probe of [randomUUID(), encodeURIComponent(badId)]) {
    const miss = await defaultApp.request(`${origin}/works/${probe}`);
    assert.equal(miss.status, 404);
    for (const h of headerNames) assert.equal(miss.headers.get(h), found.headers.get(h), `header mismatch for ${h}`);
    const html = await miss.text();
    assert.equal(html.includes(badId), false);
    assert.equal((html.match(/\bbtn-primary\b/g) ?? []).length, 1);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/i);
    assert.doesNotMatch(html, /<style\b/i);
    assert.doesNotMatch(html, /\sstyle=/i);
    assert.doesNotMatch(html, /\son[a-z]{2,}\s*=/i);
    assert.equal(html.includes('<script'), false);
    const hrefs = [...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(m => m[1]);
    assert.equal(new Set(hrefs).size, hrefs.length, `duplicate hrefs on /works 404: ${hrefs.join(', ')}`);
    const missMain = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
    const missPre = missMain.slice(0, missMain.search(/<a\b[^>]*btn-primary/)).replace(/<[^>]*>/g, '').replace(/\s+/g, '');
    assert.ok(missPre.length <= 20, `expected <=20 chars before 404 primary, got ${missPre.length}: ${missPre}`);
  }
});

test('I3: /works/:id exposes secondary share entry, visitor sign-in return_to, share_id wiring, and hidden-share guard', async () => {
  const owner = await member(0);
  const sharer = await member(1);
  const work = await createPublishedWork(owner, {
    title: '作品分享入口測試',
    description: '作品頁應提供分享連結與登入導回。',
  });
  const s0Res = await owner.req(`me/showcases/${work.showcase_id}/sharing`);
  const s0 = await s0Res.json() as { version: string; work_version: string };
  const pubRes = await owner.req(`me/showcases/${work.showcase_id}/sharing`, {
    method: 'PUT',
    body: { enabled: true, work_version: s0.work_version },
    version: s0.version,
  });
  assert.equal(pubRes.status, 200);

  // Publishing the work already created its original share (p3-c1), so the page passes that share_id.
  const original = await pool.query("SELECT share_id FROM shares WHERE kind = 'work' AND ref_id = $1 AND state = 'published'", [work.showcase_id]);
  assert.equal(original.rowCount, 1);
  const originalShareId: string = original.rows[0].share_id;
  assert.match(await (await defaultApp.request(`${origin}/works/${work.showcase_id}`)).text(), new RegExp(`data-share-id="${originalShareId}"`));

  // Without a published share (the author withdrew theirs), /works/:id still offers the share entry with empty data-share-id.
  const retractRes = await owner.req(`shares/${originalShareId}/retract`, { body: {} });
  assert.equal(retractRes.status, 200, await retractRes.clone().text());
  assert.equal((await retractRes.json() as { state: string }).state, 'retracted');
  const withoutShareRes = await defaultApp.request(`${origin}/works/${work.showcase_id}`);
  assert.equal(withoutShareRes.status, 200);
  const withoutShareHtml = await withoutShareRes.text();
  assert.match(withoutShareHtml, /<script src="\/work-page\.js" defer><\/script>/);
  assert.match(withoutShareHtml, new RegExp(`data-work-id="${work.showcase_id}"`));
  assert.match(withoutShareHtml, /data-share-id=""/);
  assert.match(withoutShareHtml, new RegExp(`data-work-login href="/\\?return_to=%2Fworks%2F${work.showcase_id}"`));
  assert.match(withoutShareHtml, /<button[^>]*id="work-share"[^>]*class="[^"]*\bbtn-secondary\b[^"]*"[^>]*hidden/);
  assert.equal((withoutShareHtml.match(/\bbtn-primary\b/g) ?? []).length, 1);
  assert.match(withoutShareHtml, /id="work-share-result"/);
  assert.match(withoutShareHtml, /id="work-share-status"[^>]*role="status"/);

  // Sharing again publishes the same share; /works/:id passes its share_id so the one link API creates /go/<code> -> /works/:id?via=<code>.
  const createdShare = await owner.req('shares', { body: { kind: 'work', ref_id: work.showcase_id } });
  assert.equal(createdShare.status, 200, await createdShare.clone().text());
  const { share_id: shareId } = await createdShare.json() as { share_id: string };
  assert.equal(shareId, originalShareId);
  const withShareHtml = await (await defaultApp.request(`${origin}/works/${work.showcase_id}`)).text();
  assert.match(withShareHtml, new RegExp(`data-share-id="${shareId}"`));

  const linkRes = await sharer.req(`shares/${shareId}/links`, { body: {} });
  assert.equal(linkRes.status, 200, await linkRes.clone().text());
  const { path, code } = await linkRes.json() as { path: string; code: string };
  assert.match(path, /^\/go\/[A-Za-z0-9_-]{10}$/);

  const goRes = await defaultApp.request(`${origin}${path}`);
  assert.equal(goRes.status, 200);
  const goHtml = await goRes.text();
  assert.match(goHtml, new RegExp(`/works/${work.showcase_id}\\?via=${code}`));

  const creditedHtml = await (await defaultApp.request(`${origin}/works/${work.showcase_id}?via=${code}`)).text();
  assert.match(creditedHtml, new RegExp(`由 ${DEMO_USERS[1].display_name} 推薦分享`));

  // Moderation-hidden share omits the share entry button and share_id.
  await pool.query("UPDATE shares SET state = 'hidden' WHERE share_id = $1", [shareId]);
  const hiddenHtml = await (await defaultApp.request(`${origin}/works/${work.showcase_id}`)).text();
  assert.equal(hiddenHtml.includes(shareId), false);
  assert.equal(hiddenHtml.includes('id="work-share"'), false);
});
