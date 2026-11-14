// /go/:code is an app route, so it wins over the asset handler and the SPA shell.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createPool, LOCAL_DATABASE_URL } from '../../packages/db/index.js';
import { migrate } from '../../scripts/database.js';
import { seedLocal, DEMO_USERS, DEMO_PASSWORD, DEMO_COMMUNITY } from '../../packages/testing/seed.js';
import { createPlatformApp } from '../../apps/platform-api/src/platform-app.js';
import { nodeRuntime } from '../../apps/platform-api/src/app.js';
import { mountAssets } from '../../apps/platform-api/src/worker.js';

const origin = 'http://127.0.0.1:4310';
const SHELL = '<!doctype html><title>spa shell</title>';
const GO_JS = '/* go.js asset */';
const databaseUrl = process.env.TEST_DATABASE_URL ?? LOCAL_DATABASE_URL;
const schema = `fp_sharego_${process.pid}_${Date.now()}`;
const admin = createPool(databaseUrl);
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 4 });
const assets = { async fetch(request: Request) {
  const path = new URL(request.url).pathname;
  if (path === '/go.js') return new Response(GO_JS, { status: 200, headers: { 'content-type': 'text/javascript' } });
  if (path === '/' || path === '/index.html') return new Response(SHELL, { status: 200, headers: { 'content-type': 'text/html' } });
  return new Response('missing', { status: 404 });
} };
const app = createPlatformApp(pool, origin, 'local', nodeRuntime('local', origin));
mountAssets(app, assets);

before(async () => { await admin.query(`CREATE SCHEMA ${schema}`); await migrate(pool); await seedLocal(pool); });
after(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

async function login() {
  const response = await app.request(origin + '/api/v1/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: DEMO_USERS[0].email, password: DEMO_PASSWORD }) });
  assert.equal(response.status, 200);
  const body = await response.json() as { csrf_token: string };
  return { cookie: response.headers.get('set-cookie')!.split(';')[0], csrf: body.csrf_token };
}

test('an unknown share code is the generic app 404, not the SPA shell', async () => {
  const response = await app.request(origin + '/go/aaaaaaaaaa');
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  const html = await response.text();
  assert.match(html, /分享連結目前無法開啟/);
  assert.doesNotMatch(html, /spa shell|og:|data-target|data-code|go\.js/);
});

test('a live share code returns the interstitial before assets, and /go.js stays a static file', async () => {
  const session = await login();
  const created = await app.request(origin + '/api/v1/promotion/links', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: session.cookie, 'X-CSRF-Token': session.csrf }, body: JSON.stringify({ kind: 'platform', target: 'workshop' }) });
  assert.equal(created.status, 200, await created.clone().text());
  const code = (await created.json() as { code: string }).code;
  const page = await app.request(origin + '/go/' + code);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type') ?? '', /text\/html/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.match(page.headers.get('content-security-policy') ?? '', /script-src 'self'/);
  assert.match(html, /正在開啟：自由工坊/);
  assert.match(html, new RegExp(`data-code="${code}"`));
  assert.ok(!html.includes('spa shell'));
  const asset = await app.request(origin + '/go.js');
  assert.equal(asset.status, 200);
  assert.equal(await asset.text(), GO_JS);
  const shell = await app.request(origin + '/skills');
  assert.equal(shell.status, 200);
  assert.equal(await shell.text(), SHELL);
});

test('/services is the app page, not the SPA shell', async () => {
  const list = await app.request(origin + '/services');
  const html = await list.text();
  assert.equal(list.status, 200);
  assert.match(list.headers.get('content-type') ?? '', /text\/html/);
  assert.equal(list.headers.get('cache-control'), 'public, max-age=60');
  assert.match(html, /社員服務/);
  assert.equal(html.includes('spa shell'), false);
  const missing = await app.request(origin + '/services/00000000-0000-4000-8000-000000000099');
  const missingHtml = await missing.text();
  assert.equal(missing.status, 404);
  assert.match(missingHtml, /找不到這項服務/);
  assert.equal(missingHtml.includes('spa shell'), false);
  const css = await app.request(origin + '/services.css');
  assert.equal(await css.text(), SHELL);
});


test('worker /go refuses revoked and disabled-owner repository and public-work share links without clicks', async () => {
  const users = (await pool.query('SELECT user_id FROM users WHERE email=ANY($1::text[]) ORDER BY email', [[DEMO_USERS[0].email, DEMO_USERS[1].email]])).rows;
  assert.equal(users.length, 2);
  const [owner, disabled] = users.map(row => row.user_id as string);
  const repo = randomUUID(), repoShare = randomUUID(), work = randomUUID(), workShare = randomUUID();
  await pool.query(`INSERT INTO canonical_repositories(repo_id,provider,provider_repo_id,full_name,current_url)
    VALUES($1,'github','998802','org/worker-repo','https://github.com/org/worker-repo')`, [repo]);
  await pool.query(`INSERT INTO showcases(showcase_id,community_id,owner_ref,title,description,artifact_ref,status,visibility)
    VALUES($1,$2,$3,'公開作品','作品簡介','artifact:worker','published','community')`, [work, DEMO_COMMUNITY, owner]);
  await pool.query(`INSERT INTO work_public_publications(showcase_id,community_id,owner_ref,enabled,approved_work_version,consented_at)
    VALUES($1,$2,$3,true,1,now())`, [work, DEMO_COMMUNITY, owner]);
  await pool.query(`INSERT INTO shares(share_id,community_id,kind,canonical_key,canonical_url,repo_id,ref_table,ref_id,title,first_sharer_user_id,state)
    VALUES($1,$2,'repository','github:org/worker-repo','https://github.com/org/worker-repo',$3,NULL,NULL,'公開 Repo',$4,'published'),
          ($5,$2,'work',$6,$7,NULL,'showcases',$8,'公開作品',$4,'published')`,
    [repoShare, DEMO_COMMUNITY, repo, owner, workShare, `work:${work}`, `/#showcase/${work}`, work]);
  const links: {code: string; user: string}[] = [];
  for (const user of [owner, disabled]) for (const target of [repoShare, workShare]) {
    const code = randomUUID().replaceAll('-', '').slice(0, 10);
    await pool.query(`INSERT INTO promotion_links(community_id,user_id,kind,target_key,code) VALUES($1,$2,'share',$3,$4)`, [DEMO_COMMUNITY, user, target, code]);
    links.push({code, user});
    assert.equal((await app.request(origin + '/go/' + code)).status, 200);
  }
  await pool.query('UPDATE promotion_links SET revoked_at=now() WHERE code=ANY($1::text[])', [links.filter(link => link.user === owner).map(link => link.code)]);
  await pool.query('UPDATE users SET active=false WHERE user_id=$1', [disabled]);
  for (const {code} of links) {
    const response = await app.request(origin + '/go/' + code);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('location'), null);
    const count = await pool.query('SELECT count(*)::int AS n FROM promotion_clicks c JOIN promotion_links l USING(link_id) WHERE l.code=$1', [code]);
    assert.equal(count.rows[0].n, 0);
  }
});
