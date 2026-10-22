import {test, before, after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import sharp from 'sharp';
import {migrate} from '../../scripts/database.js';
import {createApp} from '../../apps/platform-api/src/app.js';
import {tokenHash, type Actor} from '../../modules/identity-membership/service.js';
import {createSocialThumbnailAssetService, resolveSocialThumbnailUploadPolicy} from '../../modules/assets/social-thumbnail.js';
import {FakeObjectStore} from '../../packages/asset-storage/fake-store.js';
import {sha256} from '../../packages/asset-storage/index.js';
import {Problem} from '../../packages/shared/problem.js';
import {readPublicSocialPost, readPublicSocialPostImage, type PublicSocialPostPage, type PublicSocialSharingState} from '../../modules/community/public-social-posts.js';

// Real migrations, domain commands, HTTP auth and disposable local PostgreSQL.
const database = process.env.TEST_DATABASE_URL;
if (!database || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(database).hostname)
  || !/^\/fp_[a-z0-9_]+$/.test(new URL(database).pathname)) throw new Error('Explicit isolated local fp_* TEST_DATABASE_URL required.');
const schema = `fp_public_posts_${process.pid}_${Date.now()}`, community = randomUUID();
const admin = new Pool({connectionString: database});
const pool = new Pool({connectionString: database, options: `-c search_path=${schema} -c statement_timeout=10000`, max: 8});
const origin = 'http://127.0.0.1:4317';
const app = createApp(pool, origin, 'local', {registrationCommunityId: community,
  linkPreviewFetch: async () => new Response('<title>Synthetic link</title>', {headers: {'content-type': 'text/html'}})});
type Session = Actor & {cookie: string};
type Post = {post_id: string; note: string; revision: number; thumbnail_url: string | null};
let png: Buffer, initialized = false;
before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`); initialized = true;
  await migrate(pool);
  png = await sharp({create: {width: 40, height: 20, channels: 3, background: 'green'}}).png().toBuffer();
});
after(async () => { await pool.end(); if (initialized) await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
beforeEach(async () => {
  await pool.query('TRUNCATE communities,login_attempts,auth_rate_limits CASCADE');
  await pool.query('INSERT INTO communities VALUES($1,$2)', [community, 'Synthetic public sharing']);
  // Migration starts in legacy mode. A later bridge test respects the existing
  // monotonic storage policy; fixtures never downgrade or disable its guards.
  await pool.query("UPDATE domain_media_storage_policy SET policy_revision='synthetic-sharing-policy',persistence_allowed=true,retained_byte_limit=10485760 WHERE purpose='community.social-thumbnail'");
});

async function member(communityId = community): Promise<Session> {
  const id = randomUUID(), token = randomBytes(32).toString('base64url'), hash = tokenHash(token);
  const row = (await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,onboarding_required)
    VALUES($1,$2,$3,$4,'not-a-login-hash',$5,false) RETURNING *`, [id, communityId, `${id}@public.local.test`, 'Synthetic author', randomUUID()])).rows[0];
  await pool.query("INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,'synthetic',clock_timestamp()+interval '1 hour')", [hash, id]);
  return {...row, session_hash: hash, csrf_token: 'synthetic', cookie: `freedom_local_session=${token}`};
}
async function request<T = {code?: string}>(path: string, session?: Session, body?: unknown, headers: Record<string, string> = {}) {
  const response = await app.request(origin + '/api/v1' + path, {method: body === undefined ? 'GET' : 'POST',
    headers: {Origin: origin, ...(session ? {Cookie: session.cookie, 'X-CSRF-Token': session.csrf_token} : {}),
      ...(body === undefined ? {} : {'Content-Type': 'application/json', 'Idempotency-Key': randomUUID()}), ...headers},
    body: body === undefined ? undefined : JSON.stringify(body)});
  return {status: response.status, headers: response.headers, data: await response.json() as T};
}
async function note(owner: Session, text = 'Shared synthetic note', extra = {}) {
  const result = await request<Post>('/social-posts/notes', owner, {text, ...extra});
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data;
}
async function state(owner: Session, id: string) {
  const result = await request<PublicSocialSharingState>(`/social-posts/${id}/public-sharing`, owner);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.equal(result.headers.get('etag'), `"${result.data.version}"`);
  return result.data;
}
async function share(owner: Session, id: string, enabled = true) {
  const current = await state(owner, id);
  const result = await request<PublicSocialSharingState>(`/social-posts/${id}/public-sharing`, owner,
    {enabled, post_revision: current.post_revision, media_version: current.media_version}, {'If-Match': `"${current.version}"`});
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data;
}
const publicPost = (id: string, query = '') => request<PublicSocialPostPage>(`/public/shared-posts/${id}${query}`);
const image = (id: string) => app.request(`${origin}/api/v1/public/shared-posts/${id}/image`);
const problem = (code: string) => (error: unknown) => error instanceof Problem && error.code === code;

test('historical member content stays private until its author opts in; public DTO and image expose only the reviewed post', async () => {
  const owner = await member(), peer = await member();
  const post = await note(owner, 'Synthetic public text @Synthetic author', {location_name: 'Private exact location', mention_ids: [peer.user_id],
    image: {mime_type: 'image/png', data_base64: png.toString('base64')}});
  await request(`/social-posts/${post.post_id}/comments`, peer, {text: 'Private comment text'});
  await request(`/social-posts/${post.post_id}/like`, peer, {liked: true});
  assert.equal((await publicPost(post.post_id)).status, 404);
  assert.equal((await image(post.post_id)).status, 404);
  assert.equal((await request(`/social-posts/${post.post_id}/public-sharing`)).status, 401);
  assert.equal((await request(`/social-posts/${post.post_id}/public-sharing`, peer)).status, 403);
  assert.equal((await request(`/social-posts/${post.post_id}/public-sharing`, peer, {enabled: true, post_revision: 1, media_version: '2'}, {'If-Match': '"1"'})).status, 403);
  assert.deepEqual(await state(owner, post.post_id), {enabled: false, available: false, post_revision: 1, media_version: '2', version: '1', public_path: null,
    image_url: `/api/v1/social-posts/${post.post_id}/thumbnail?v=2`});

  const published = await share(owner, post.post_id);
  assert.equal(published.available, true); assert.equal(published.version, '2');
  assert.equal(published.public_path, `/posts/${post.post_id}`);
  const result = await publicPost(post.post_id);
  assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.deepEqual(Object.keys(result.data).sort(), ['post', 'related', 'version']);
  assert.match(result.data.version, /^[0-9a-f]{64}$/);
  assert.equal((await publicPost(post.post_id)).data.version, result.data.version);
  assert.deepEqual(Object.keys(result.data.post).sort(), ['author', 'created_at', 'edited_at', 'image_url', 'kind', 'note', 'post_id', 'title', 'url']);
  assert.deepEqual(result.data.post.author, {display_name: 'Synthetic author'});
  assert.equal(result.data.post.note, post.note); assert.equal(result.data.post.url, null);
  assert.equal(result.data.post.image_url, `/api/v1/public/shared-posts/${post.post_id}/image`);
  assert.deepEqual(result.data.related, []);
  const serialized = JSON.stringify(result.data);
  for (const secret of [owner.user_id, peer.user_id, owner.email, 'Private exact location', 'Private comment text', 'like_count', 'mentions', 'avatar', 'community_id']) assert.equal(serialized.includes(secret), false, secret);
  const publicImage = await image(post.post_id);
  assert.equal(publicImage.status, 200); assert.equal(publicImage.headers.get('cache-control'), 'no-store');
  assert.equal(publicImage.headers.get('content-type'), 'image/webp');
  assert.equal(publicImage.headers.get('cross-origin-resource-policy'), 'same-origin');
  const privateImage = await app.request(origin + post.thumbnail_url, {headers: {Cookie: owner.cookie}});
  assert.equal(privateImage.status, 200);
  assert.deepEqual(Buffer.from(await publicImage.arrayBuffer()), Buffer.from(await privateImage.arrayBuffer()));
  assert.equal((await request(`/public/social-posts/${post.post_id}/thumbnail`)).status, 404);
  for (const path of ['/social-posts', `/social-posts/${post.post_id}/comments`, `/social-posts/${post.post_id}/likers`]) assert.equal((await request(path)).status, 401, path);
  assert.equal((await request(`/social-posts/${post.post_id}/like`, undefined, {liked: true})).status, 401);
  assert.equal((await request(`/social-posts/${post.post_id}/comments`, undefined, {text: 'Guest comment'})).status, 401);
});

test('an anonymous page has at most three public text previews and cannot paginate into member posts', async () => {
  const owner = await member(), anchor = await note(owner, 'Anchor');
  await share(owner, anchor.post_id);
  const previews: string[] = [];
  for (let i = 0; i < 5; i++) {
    const post = await note(owner, `Public preview ${i}\n${'long body '.repeat(50)}`);
    await share(owner, post.post_id); previews.push(post.post_id);
  }
  const privatePost = await note(owner, 'Private member body');
  const revoked = await note(owner, 'Revoked body'); await share(owner, revoked.post_id); await share(owner, revoked.post_id, false);
  const hidden = await note(owner, 'Hidden body'); await share(owner, hidden.post_id); await pool.query("UPDATE community_social_posts SET state='hidden' WHERE post_id=$1", [hidden.post_id]);
  const result = await publicPost(anchor.post_id, '?limit=999&cursor=all&author=all');
  assert.equal(result.status, 200); assert.equal(result.data.related.length, 3);
  for (const preview of result.data.related) {
    assert.ok(previews.includes(preview.post_id)); assert.ok(preview.summary.length <= 160);
    assert.deepEqual(Object.keys(preview).sort(), ['author', 'path', 'post_id', 'summary', 'title']);
    assert.equal(preview.path, `/posts/${preview.post_id}`); assert.deepEqual(preview.author, {display_name: 'Synthetic author'});
  }
  for (const secret of [privatePost.post_id, revoked.post_id, hidden.post_id, 'Private member body', 'Revoked body', 'Hidden body']) assert.equal(JSON.stringify(result.data).includes(secret), false, secret);
  assert.ok([401, 404].includes((await request('/public/shared-posts?limit=999')).status));
  assert.equal((await request('/public/shared-posts/not-a-uuid')).status, 404);
  assert.equal((await publicPost(randomUUID())).status, 404);
});

test('publication version and exact reviewed text/image are required; replay cannot restore revoked access', async () => {
  const owner = await member(), post = await note(owner), path = `/social-posts/${post.post_id}/public-sharing`;
  const body = {enabled: true, post_revision: 1, media_version: '1'};
  assert.equal((await request(path, owner, body)).status, 428);
  assert.equal((await request(path, owner, body, {'If-Match': '"99"'})).status, 412);
  assert.equal((await request(path, owner, {...body, post_revision: 2}, {'If-Match': '"1"'})).status, 412);
  assert.equal((await request(path, owner, {...body, media_version: '2'}, {'If-Match': '"1"'})).status, 412);
  for (const malformed of [{enabled: true}, {...body, anything: true}, {...body, post_revision: '1'}, {...body, media_version: 1}]) {
    assert.equal((await request(path, owner, malformed, {'If-Match': '"1"'})).status, 422);
  }
  const headers = {'If-Match': '"1"', 'Idempotency-Key': randomUUID()};
  const first = await request<PublicSocialSharingState>(path, owner, body, headers);
  assert.equal(first.status, 200);
  assert.deepEqual((await request(path, owner, body, headers)).data, first.data);
  assert.equal((await request(path, owner, {...body, enabled: false}, headers)).status, 409);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM transition_journal WHERE aggregate_type='social_post_publication' AND aggregate_id=$1", [post.post_id])).rows[0].n, 1);
  assert.equal((await request(path, owner, {enabled: false, post_revision: 1, media_version: '1'}, {'If-Match': '"1"'})).status, 412);
  await share(owner, post.post_id, false);
  assert.equal((await request(path, owner, body, headers)).status, 409);
  assert.equal((await publicPost(post.post_id)).status, 404);
  await pool.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1', [owner.session_hash]);
  assert.equal((await request(path, owner, body, headers)).status, 401);
});

test('concurrent changes with the same publication version commit only one consent and receipt', async () => {
  const owner = await member(), post = await note(owner), path = `/social-posts/${post.post_id}/public-sharing`;
  const body = {enabled: true, post_revision: 1, media_version: '1'};
  const results = await Promise.all([
    request(path, owner, body, {'If-Match': '"1"'}),
    request(path, owner, body, {'If-Match': '"1"'}),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 412]);
  assert.equal((await state(owner, post.post_id)).version, '2');
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM transition_journal WHERE aggregate_type='social_post_publication' AND aggregate_id=$1", [post.post_id])).rows[0].n, 1);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM command_receipts WHERE operation=$1', [`POST /api/v1${path}`])).rows[0].n, 1);
});

test('editing invalidates consent and old receipts until the author reviews and publishes the new revision', async () => {
  const owner = await member(), post = await note(owner, 'Version one', {image: {mime_type: 'image/png', data_base64: png.toString('base64')}});
  const path = `/social-posts/${post.post_id}/public-sharing`, initial = await state(owner, post.post_id);
  const body = {enabled: true, post_revision: initial.post_revision, media_version: initial.media_version};
  const headers = {'If-Match': `"${initial.version}"`, 'Idempotency-Key': randomUUID()};
  assert.equal((await request(path, owner, body, headers)).status, 200);
  assert.equal((await request(`/social-posts/${post.post_id}/edit`, owner, {text: 'Version two private until reviewed'}, {'If-Match': '"1"'})).status, 200);
  const current = await state(owner, post.post_id);
  assert.equal(current.enabled, true); assert.equal(current.available, false); assert.equal(current.post_revision, 2); assert.equal(current.public_path, null);
  assert.equal((await publicPost(post.post_id)).status, 404); assert.equal((await image(post.post_id)).status, 404);
  assert.equal((await request(path, owner, body, headers)).status, 409);
  assert.equal((await request(path, owner, body, {'If-Match': `"${current.version}"`})).status, 412);
  await share(owner, post.post_id);
  assert.equal((await publicPost(post.post_id)).data.post.note, 'Version two private until reviewed');
  assert.equal((await image(post.post_id)).status, 200);
  await share(owner, post.post_id, false);
  assert.equal((await publicPost(post.post_id)).status, 404); assert.equal((await image(post.post_id)).status, 404);
});

test('current author eligibility and configured community govern every public read and new enable', async () => {
  const owner = await member(), post = await note(owner, 'Eligible author', {image: {mime_type: 'image/png', data_base64: png.toString('base64')}});
  await share(owner, post.post_id);
  for (const [update, restore] of [
    ['active=false', 'active=true'],
    ['onboarding_required=true,onboarding_completed_at=NULL', 'onboarding_required=false'],
    ["email='synthetic@example.invalid'", "email='synthetic@public.local.test'"],
  ]) {
    await pool.query(`UPDATE users SET ${update} WHERE user_id=$1`, [owner.user_id]);
    assert.equal(await readPublicSocialPost(pool, post.post_id, community), null);
    assert.equal((await image(post.post_id)).status, 404);
    await pool.query(`UPDATE users SET ${restore} WHERE user_id=$1`, [owner.user_id]);
    assert.ok(await readPublicSocialPost(pool, post.post_id, community));
  }
  const foreign = randomUUID(); await pool.query('INSERT INTO communities VALUES($1,$2)', [foreign, 'Synthetic foreign']);
  assert.equal(await readPublicSocialPost(pool, post.post_id), null, 'ambiguous unconfigured public community fails closed');
  assert.equal(await readPublicSocialPost(pool, post.post_id, foreign), null);
  await assert.rejects(readPublicSocialPostImage(pool, post.post_id, foreign), problem('not_found'));
  assert.ok(await readPublicSocialPost(pool, post.post_id, community));
  const foreignOwner = await member(foreign), foreignPost = await note(foreignOwner);
  const foreignState = await state(foreignOwner, foreignPost.post_id);
  assert.equal((await request(`/social-posts/${foreignPost.post_id}/public-sharing`, foreignOwner,
    {enabled: true, post_revision: foreignState.post_revision, media_version: foreignState.media_version}, {'If-Match': `"${foreignState.version}"`})).status, 403);
  assert.equal((await request(`/social-posts/${post.post_id}/public-sharing`, foreignOwner)).status, 404);
  await pool.query("UPDATE community_social_posts SET state='deleted' WHERE post_id=$1", [post.post_id]);
  assert.equal((await publicPost(post.post_id)).status, 404); assert.equal((await image(post.post_id)).status, 404);
});

test('a replacement link thumbnail invalidates consent without a text edit', async () => {
  const owner = await member();
  const created = await request<Post>('/social-posts', owner, {url: 'https://example.org/public-sharing', title: 'Synthetic link'});
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = created.data.post_id;
  const upload = (bytes: Buffer) => app.request(`${origin}/api/v1/social-posts/${id}/thumbnail`, {method: 'PUT',
    headers: {Origin: origin, Cookie: owner.cookie, 'X-CSRF-Token': owner.csrf_token, 'Content-Type': 'image/png', 'Idempotency-Key': randomUUID()}, body: new Uint8Array(bytes)});
  assert.equal((await upload(png)).status, 200);
  const initial = await share(owner, id), initialPage = (await publicPost(id)).data;
  assert.equal((await image(id)).status, 200);
  const changed = await sharp({create: {width: 40, height: 20, channels: 3, background: 'blue'}}).png().toBuffer();
  assert.equal((await upload(changed)).status, 200);
  const current = await state(owner, id);
  assert.equal(current.post_revision, initial.post_revision); assert.notEqual(current.media_version, initial.media_version); assert.equal(current.available, false);
  assert.equal((await publicPost(id)).status, 404); assert.equal((await image(id)).status, 404);
  assert.equal((await request(`/social-posts/${id}/public-sharing`, owner,
    {enabled: true, post_revision: current.post_revision, media_version: initial.media_version}, {'If-Match': `"${current.version}"`})).status, 412);
  await share(owner, id);
  const replacementPage = await publicPost(id);
  assert.equal(replacementPage.status, 200); assert.equal((await image(id)).status, 200);
  assert.equal(replacementPage.data.post.image_url, initialPage.post.image_url);
  assert.notEqual(replacementPage.data.version, initialPage.version, 'same-text replacement still invalidates the browser projection');
});

test('owner sharing state reveals a newly added image even when the original feed card had no thumbnail', async () => {
  const owner = await member();
  const created = await request<Post>('/social-posts', owner, {url: 'https://example.org/new-sharing-image', title: 'Initially text only'});
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.thumbnail_url, null);
  const id = created.data.post_id, initial = await state(owner, id);
  assert.equal(initial.image_url, null); assert.equal(initial.media_version, '1');
  await share(owner, id);
  const uploaded = await app.request(`${origin}/api/v1/social-posts/${id}/thumbnail`, {method: 'PUT',
    headers: {Origin: origin, Cookie: owner.cookie, 'X-CSRF-Token': owner.csrf_token, 'Content-Type': 'image/png', 'Idempotency-Key': randomUUID()}, body: new Uint8Array(png)});
  assert.equal(uploaded.status, 200);
  const current = await state(owner, id);
  assert.equal(current.post_revision, initial.post_revision);
  assert.equal(current.media_version, '2'); assert.equal(current.available, false);
  assert.equal(current.image_url, `/api/v1/social-posts/${id}/thumbnail?v=2`);
  const preview = await app.request(origin + current.image_url, {headers: {Cookie: owner.cookie}});
  assert.equal(preview.status, 200); assert.equal(preview.headers.get('content-type'), 'image/webp');
  assert.equal((await request(`/social-posts/${id}/public-sharing`, owner,
    {enabled: true, post_revision: current.post_revision, media_version: initial.media_version}, {'If-Match': `"${current.version}"`})).status, 412);
  assert.equal((await publicPost(id)).status, 404);
  await share(owner, id);
  assert.equal((await image(id)).status, 200);
});

test('public projection version changes on explicit republication, author name and the bounded related preview set', async () => {
  const owner = await member(), post = await note(owner, 'Stable body');
  await share(owner, post.post_id);
  const original = (await publicPost(post.post_id)).data;
  await share(owner, post.post_id, false); await share(owner, post.post_id);
  const republished = (await publicPost(post.post_id)).data;
  assert.deepEqual(republished.post, original.post); assert.notEqual(republished.version, original.version);
  await pool.query("UPDATE users SET display_name='Updated public name' WHERE user_id=$1", [owner.user_id]);
  const renamed = (await publicPost(post.post_id)).data;
  assert.equal(renamed.post.author.display_name, 'Updated public name'); assert.notEqual(renamed.version, republished.version);
  const related = await note(owner, 'New preview'); await share(owner, related.post_id);
  const expanded = (await publicPost(post.post_id)).data;
  assert.equal(expanded.related.length, 1); assert.notEqual(expanded.version, renamed.version);
  await share(owner, related.post_id, false);
  const withdrawn = (await publicPost(post.post_id)).data;
  assert.equal(withdrawn.related.length, 0); assert.notEqual(withdrawn.version, expanded.version);
});

test('a registration-disabled public runtime keeps shared posts readable without advertising or accepting signup', async () => {
  const owner = await member(), post = await note(owner, 'Public reading while signup is closed');
  await share(owner, post.post_id);
  // Empty configured registration id prevents an inherited environment value.
  // The existing single-community public resolver still admits opted-in posts.
  const closedOrigin = 'https://sharing.example.test';
  const closed = createApp(pool, closedOrigin, 'public', {registrationCommunityId: ''});
  const site = await closed.request(`${closedOrigin}/api/v1/site`);
  assert.equal(site.status, 200); assert.equal((await site.json()).registration_enabled, false);
  const json = await closed.request(`${closedOrigin}/api/v1/public/shared-posts/${post.post_id}`);
  assert.equal(json.status, 200); assert.equal((await json.json()).post.note, post.note);
  const page = await closed.request(`${closedOrigin}/posts/${post.post_id}`), html = await page.text();
  assert.equal(page.status, 200); assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.ok(html.includes('登入看更多與留言'));
  assert.equal(html.includes('data-post-join'), false); assert.equal(html.includes('建立帳號'), false);
  const registration = await closed.request(`${closedOrigin}/api/v1/auth/register`, {method: 'POST',
    headers: {Origin: closedOrigin, 'Content-Type': 'application/json'},
    body: JSON.stringify({email: 'synthetic-closed-signup@example.test', password: 'synthetic-closed-password'})});
  assert.equal(registration.status, 503); assert.equal((await registration.json()).code, 'registration_unavailable');
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM users WHERE email='synthetic-closed-signup@example.test'")).rows[0].n, 0);
});

test('asset bytes are verified and current consent is checked after object I/O; retained legacy data never substitutes', async () => {
  const owner = await member(), id = randomUUID();
  await pool.query("INSERT INTO community_social_posts(post_id,community_id,author_user_id,url,platform,title,state) VALUES($1,$2,$3,'https://example.org/asset-sharing','other','Synthetic asset','active')", [id, community, owner.user_id]);
  const legacy = await sharp(png).webp().toBuffer();
  await pool.query("INSERT INTO community_social_post_thumbnails(post_id,image_bytes,source) VALUES($1,$2,'page')", [id, legacy]);
  await pool.query("UPDATE domain_media_storage_policy SET mode='bridge' WHERE purpose='community.social-thumbnail'");
  const store = new FakeObjectStore(), assets = createSocialThumbnailAssetService(pool, {store, resolvePolicy: resolveSocialThumbnailUploadPolicy});
  const prepared = await assets.prepare(owner, {key: randomUUID(), targetPostId: id, expectedVersion: '2', contentType: 'image/png', byteSize: png.length, sha256: await sha256(png)});
  const claim = await assets.claim(owner, {key: randomUUID(), intentId: prepared.intentId});
  const lease = {intentId: claim.intentId, fence: claim.fence, leaseToken: claim.leaseToken};
  await assets.write(owner, {key: randomUUID(), ...lease}, new ReadableStream({start(controller) { controller.enqueue(png); controller.close(); }}));
  await assets.finalize(owner, {key: randomUUID(), ...lease});
  await share(owner, id);
  assert.equal((await sharp(await readPublicSocialPostImage(pool, id, community, store)).metadata()).format, 'webp');
  await assert.rejects(readPublicSocialPostImage(pool, id, community), problem('media_unavailable'));
  assert.deepEqual((await pool.query('SELECT image_bytes FROM community_social_post_thumbnails WHERE post_id=$1', [id])).rows[0].image_bytes, legacy);
  const get = store.get.bind(store);
  store.get = async (...args) => { const value = await get(...args); await share(owner, id, false); return value; };
  await assert.rejects(readPublicSocialPostImage(pool, id, community, store), problem('not_found'));
  assert.equal((await publicPost(id)).status, 404);
  store.get = get;
  await share(owner, id);
  store.get = async (...args) => { const value = await get(...args); await pool.query('UPDATE users SET active=false WHERE user_id=$1', [owner.user_id]); return value; };
  await assert.rejects(readPublicSocialPostImage(pool, id, community, store), problem('not_found'));
});

test('a session expiring while publication waits on the post lock cannot publish or store a receipt', async () => {
  const owner = await member(), post = await note(owner), key = randomUUID();
  await pool.query("UPDATE sessions SET expires_at=clock_timestamp()+interval '2 seconds' WHERE token_hash=$1", [owner.session_hash]);
  const blocker = await pool.connect();
  let pending: ReturnType<typeof request> | undefined;
  try {
    await blocker.query('BEGIN');
    const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await blocker.query('SELECT post_id FROM community_social_posts WHERE post_id=$1 FOR UPDATE', [post.post_id]);
    pending = request(`/social-posts/${post.post_id}/public-sharing`, owner, {enabled: true, post_revision: 1, media_version: '1'}, {'If-Match': '"1"', 'Idempotency-Key': key});
    let waiting = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      waiting = Boolean((await admin.query('SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))', [pid])).rowCount);
      if (waiting) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(waiting, 'the publication must actually wait on the locked post');
    await blocker.query('SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM expires_at-clock_timestamp()))+0.05) FROM sessions WHERE token_hash=$1', [owner.session_hash]);
  } finally {
    await blocker.query('ROLLBACK'); blocker.release();
    if (pending) await pending;
  }
  assert.equal((await pending!).status, 401);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM community_social_publications WHERE post_id=$1', [post.post_id])).rows[0].n, 0);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM command_receipts WHERE idempotency_key=$1', [key])).rows[0].n, 0);
  assert.equal((await publicPost(post.post_id)).status, 404);
});
