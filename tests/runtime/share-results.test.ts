import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createPool, LOCAL_DATABASE_URL } from '../../packages/db/index.js';
import { transaction } from '../../packages/db/index.js';
import { migrate } from '../../scripts/database.js';
import { seedLocal, DEMO_COMMUNITY, DEMO_PASSWORD, DEMO_USERS } from '../../packages/testing/seed.js';
import { createApp } from '../../apps/platform-api/src/app.js';
import { agentOperation } from '../../apps/platform-api/src/agent-allowlist.js';
import type { Actor } from '../../modules/identity-membership/service.js';
import { appendCredit, endorseShare, reverseCredit } from '../../modules/shares/credit.js';
import { myShareResults } from '../../modules/shares/results.js';

const origin = 'http://127.0.0.1:4318';
const databaseUrl = process.env.TEST_DATABASE_URL ?? LOCAL_DATABASE_URL;
const schema = `fp_share_results_${process.pid}_${Date.now()}`;
const admin = createPool(databaseUrl);
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 8 });
let app: ReturnType<typeof createApp>;

type Session = { cookie: string; csrf: string; actor: Actor };

before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
  app = createApp(pool, origin, 'local', { registrationCommunityId: DEMO_COMMUNITY });
});

after(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE communities, login_attempts, auth_rate_limits CASCADE');
  await pool.query('TRUNCATE promotion_click_salts');
  await seedLocal(pool);
});

async function createNonTestUser(email: string, displayName: string): Promise<Session> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,active,onboarding_required)
     SELECT $1,community_id,$2,$3,password_hash,$4,true,false FROM users WHERE user_id=$5`,
    [id, email, displayName, randomUUID(), DEMO_USERS[0].user_id],
  );
  const res = await app.request(`${origin}/api/v1/auth/login`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: DEMO_PASSWORD }),
  });
  assert.equal(res.status, 200);
  const data = await res.json() as { csrf_token: string; user: { user_id: string; community_id: string } };
  const cookie = res.headers.get('set-cookie')!.split(';')[0];
  return {
    cookie,
    csrf: data.csrf_token,
    actor: { user_id: id, community_id: DEMO_COMMUNITY } as Actor,
  };
}

async function req(path: string, session?: Session, body?: unknown, method?: string, extraHeaders: Record<string, string> = {}) {
  const verb = method ?? (body === undefined ? 'GET' : 'POST');
  const headers: Record<string, string> = {
    Origin: origin,
    ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}),
    ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }),
    ...extraHeaders,
  };
  const res = await app.request(`${origin}/api/v1${path}`, {
    method: verb,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, text };
}

test('S3: myShareResults merges shares, credits, and standalone links with visibility zeroing and cross-member isolation', async () => {
  const alice = await createNonTestUser('alice-s3@example.com', 'Alice');
  const bob = await createNonTestUser('bob-s3@example.com', 'Bob');
  const actorC = await createNonTestUser('charlie-s3@example.com', 'Charlie');

  assert.equal((await req('/me/share-results')).status, 401);
  assert.ok(agentOperation('GET', '/api/v1/me/share-results'));

  // (a) Repository share + tracked link created via BOTH /shares/:id/links and /promotion/links {kind:'share'} -> same code, 3 clicks + 1 star
  const shareA = randomUUID(), repoA = randomUUID();
  await pool.query(
    `INSERT INTO canonical_repositories(repo_id,provider,provider_repo_id,full_name,current_url)
     VALUES($1,'github','997701','org/repo-a','https://github.com/org/repo-a')`,
    [repoA],
  );
  await pool.query(
    `INSERT INTO shares(share_id,community_id,kind,canonical_key,canonical_url,repo_id,title,first_sharer_user_id,state)
     VALUES($1,$2,'repository','github:org/repo-a','https://github.com/org/repo-a',$3,'開源專案 A',$4,'published')`,
    [shareA, DEMO_COMMUNITY, repoA, alice.actor.user_id],
  );
  await transaction(pool, async q => {
    await endorseShare(q, { share_id: shareA, community_id: DEMO_COMMUNITY, first_sharer_user_id: alice.actor.user_id, state: 'published' }, alice.actor.user_id);
    await appendCredit(q, { community_id: DEMO_COMMUNITY, share_id: shareA, user_id: alice.actor.user_id, role: 'sharer', basis: 'star_confirmed', source_ref: `star:1`, actor_user_id: actorC.actor.user_id });
    const rev = await appendCredit(q, { community_id: DEMO_COMMUNITY, share_id: shareA, user_id: alice.actor.user_id, role: 'sharer', basis: 'star_confirmed', source_ref: `star:2`, actor_user_id: bob.actor.user_id });
    await reverseCredit(q, rev!);
  });
  const viaShares = await req(`/shares/${shareA}/links`, alice, {});
  const viaPromo = await req('/promotion/links', alice, { kind: 'share', target: shareA });
  assert.equal(viaShares.status, 200, viaShares.text);
  assert.equal(viaPromo.status, 200, viaPromo.text);
  assert.equal(viaPromo.data.code, viaShares.data.code);

  const clickRes = await req('/promotion/clicks', undefined, { code: viaShares.data.code }, 'POST', {
    'User-Agent': 'Mozilla/5.0 Chrome/128.0.0.0 Safari/537.36',
  });
  assert.equal(clickRes.status, 200);
  // Two visitors on one day and one visitor on the next -> 3 clicks total (plus 1 credit event if recorded)
  const linkA = (await pool.query('SELECT link_id FROM promotion_links WHERE code=$1', [viaShares.data.code])).rows[0].link_id as string;
  await pool.query(
    `INSERT INTO promotion_clicks(link_id,click_day,visitor_key,network_key,community_id,user_id,kind,created_at)
     VALUES($1,'2026-10-04',$2,$3,$4,$5,'share','2026-10-04T02:00:00Z'),
           ($1,'2026-10-04',$6,$7,$4,$5,'share','2026-10-04T03:00:00Z')`,
    [linkA, `v:${'a'.repeat(64)}`, 'b'.repeat(64), DEMO_COMMUNITY, alice.actor.user_id, `v:${'c'.repeat(64)}`, 'd'.repeat(64)],
  );

  // (b) Event link + event share with registrations
  const eventId = randomUUID();
  const eventShareId = randomUUID();
  await pool.query(
    `INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,state,visibility,event_kind)
     VALUES($1,$2,$3,'社群聚會 B','說明',now()+interval '2 days',now()+interval '3 days','online','線上','published','open','other')`,
    [eventId, DEMO_COMMUNITY, alice.actor.user_id],
  );
  await pool.query(
    `INSERT INTO shares(share_id,community_id,kind,canonical_key,canonical_url,ref_table,ref_id,title,first_sharer_user_id,state)
     VALUES($1,$2,'event',$3,$4,'community_events',$5,'社群聚會 B',$6,'published')`,
    [eventShareId, DEMO_COMMUNITY, `event:${eventId}`, `/events/${eventId}`, eventId, alice.actor.user_id],
  );
  await transaction(pool, async q => {
    await endorseShare(q, { share_id: eventShareId, community_id: DEMO_COMMUNITY, first_sharer_user_id: alice.actor.user_id, state: 'published' }, alice.actor.user_id);
    await appendCredit(q, { community_id: DEMO_COMMUNITY, share_id: eventShareId, user_id: alice.actor.user_id, role: 'spreader', basis: 'registration', source_ref: `reg:${eventId}:1`, actor_user_id: actorC.actor.user_id });
  });
  const eventLink = await req('/promotion/links', alice, { kind: 'event', target: eventId });
  assert.equal(eventLink.status, 200, eventLink.text);

  // (c) Standalone links without a shares row: public note post + member_service
  const notePostId = randomUUID();
  await pool.query(
    `INSERT INTO community_social_posts(post_id,community_id,author_user_id,kind,url,platform,title,note,state)
     VALUES($1,$2,$3,'note',NULL,'other','筆記 C','筆記 C\n內容','active')`,
    [notePostId, DEMO_COMMUNITY, alice.actor.user_id],
  );
  const note = { data: { post_id: notePostId } };
  const noteState = await req(`/social-posts/${note.data.post_id}/public-sharing`, alice);
  await req(`/social-posts/${note.data.post_id}/public-sharing`, alice, {
    enabled: true, post_revision: noteState.data.post_revision, media_version: noteState.data.media_version,
  }, 'POST', { 'If-Match': `"${noteState.data.version}"` });
  const noteLink = await req('/promotion/links', alice, { kind: 'social_post', target: note.data.post_id });
  assert.equal(noteLink.status, 200, noteLink.text);

  const serviceId = randomUUID();
  await pool.query(
    `INSERT INTO member_services(service_id,community_id,owner_user_id,title,category,summary,service_mode,contacts,state)
     VALUES($1,$2,$3,'站外服務 C2','language','服務簡介','online','[{"label":"網站","url":"https://example.com/svc-c2"}]'::jsonb,'active')`,
    [serviceId, DEMO_COMMUNITY, alice.actor.user_id],
  );
  const serviceLink = await req('/promotion/links', alice, { kind: 'member_service', target: serviceId });
  assert.equal(serviceLink.status, 200, serviceLink.text);
  const svcClick = await req('/promotion/clicks', undefined, { code: serviceLink.data.code }, 'POST', {
    'User-Agent': 'Mozilla/5.0 Chrome/128.0.0.0 Safari/537.36',
  });
  assert.equal(svcClick.status, 200);

  // (d) Share credit without a tracked link + net-zero reversed share excluded
  const shareD = randomUUID();
  const shareZero = randomUUID();
  await pool.query(
    `INSERT INTO shares(share_id,community_id,kind,canonical_key,canonical_url,title,first_sharer_user_id,state)
     VALUES($1,$2,'link','https://example.com/d','https://example.com/d','無連結分享 D',$3,'published'),
           ($4,$2,'link','https://example.com/z','https://example.com/z','已撤銷積分 Z',$5,'published')`,
    [shareD, DEMO_COMMUNITY, alice.actor.user_id, shareZero, bob.actor.user_id],
  );
  await transaction(pool, async q => {
    await endorseShare(q, { share_id: shareD, community_id: DEMO_COMMUNITY, first_sharer_user_id: alice.actor.user_id, state: 'published' }, alice.actor.user_id);
    const zeroEv = await endorseShare(q, { share_id: shareZero, community_id: DEMO_COMMUNITY, first_sharer_user_id: bob.actor.user_id, state: 'published' }, alice.actor.user_id);
    await reverseCredit(q, zeroEv!);
  });

  let statements=0;
  const counted={query:(...args:any[])=>{statements++;return (pool.query as any)(...args);}} as unknown as import('pg').PoolClient;
  const mixed=await myShareResults(counted,alice.actor,{},DEMO_COMMUNITY);
  assert.equal(mixed.items.length,5);
  assert.equal(statements,1,'a mixed results page is read in a single bounded query');
  const resA = await req('/me/share-results', alice);
  assert.equal(resA.status, 200, resA.text);
  assert.equal(resA.data.next_offset, null);
  assert.equal(resA.data.items.length, 5);
  assert.equal(resA.data.items.some((x: { key: string }) => x.key === `share:${shareZero}`), false);

  const rowA = resA.data.items.find((x: { key: string }) => x.key === `share:${shareA}`);
  assert.deepEqual(rowA.link, { kind: 'share', target: shareA, path: `/go/${viaShares.data.code}` });
  assert.equal(rowA.open_path, `/go/${viaShares.data.code}`);
  assert.equal(rowA.kind, 'repository');
  assert.equal(rowA.title, '開源專案 A');
  assert.equal(rowA.available, true);
  assert.equal(rowA.clicks, 3);
  assert.equal(rowA.stars, 1);
  assert.equal(rowA.registrations, 0);

  const rowB = resA.data.items.find((x: { key: string }) => x.key === `share:${eventShareId}`);
  assert.equal(rowB.kind, 'event');
  assert.equal(rowB.link.kind, 'event');
  assert.equal(rowB.open_path, `/go/${eventLink.data.code}`);
  assert.equal(rowB.registrations, 1);

  const rowC = resA.data.items.find((x: { key: string }) => x.key === `social_post:${note.data.post_id}`);
  assert.equal(rowC.kind, 'social_post');
  assert.equal(rowC.available, true);
  assert.equal(rowC.title, '筆記 C');
  assert.equal(rowC.open_path, `/go/${noteLink.data.code}`);

  const rowC2 = resA.data.items.find((x: { key: string }) => x.key === `member_service:${serviceId}`);
  assert.equal(rowC2.kind, 'member_service');
  assert.equal(rowC2.available, true);
  assert.equal(rowC2.title, '站外服務 C2');
  assert.equal(rowC2.open_path, `/go/${serviceLink.data.code}`);
  assert.equal(rowC2.clicks, 1);

  const rowD = resA.data.items.find((x: { key: string }) => x.key === `share:${shareD}`);
  assert.equal(rowD.link, null);
  assert.equal(rowD.open_path, `#shares/${shareD}`);
  assert.equal(rowD.available, true);
  assert.deepEqual(
    resA.data.items.map((x: { key: string }) => x.key),
    [
      `share:${shareD}`,
      `member_service:${serviceId}`,
      `social_post:${note.data.post_id}`,
      `share:${eventShareId}`,
      `share:${shareA}`,
    ],
  );
  for (let i = 1; i < resA.data.items.length; i++) {
    assert.ok(
      Date.parse(resA.data.items[i - 1].last_at) >= Date.parse(resA.data.items[i].last_at),
      `expected descending last_at at index ${i}`,
    );
  }

  // Bob sees none of Alice's results
  const resBob = await req('/me/share-results', bob);
  assert.equal(resBob.status, 200);
  assert.equal(resBob.data.items.length, 0);

  // Retracted shareD and hidden non-event shareA -> unavailable, '已停止分享', link null, counts 0
  await pool.query(`UPDATE shares SET state='retracted' WHERE share_id=$1`, [shareD]);
  await pool.query(`UPDATE shares SET state='hidden' WHERE share_id=$1`, [shareA]);
  // Hidden event share stays available to organizer (hidden-event exception matching myCredit), unavailable to outsider in guild event
  await pool.query(`UPDATE shares SET state='hidden' WHERE share_id=$1`, [eventShareId]);
  // Note post edit makes standalone note unavailable, pausing service makes standalone service unavailable
  await pool.query(`UPDATE community_social_posts SET edit_revision=edit_revision+1 WHERE post_id=$1`, [note.data.post_id]);
  await pool.query(`UPDATE member_services SET state='paused' WHERE service_id=$1`, [serviceId]);

  const resA2 = await req('/me/share-results', alice);
  const a2 = resA2.data.items.find((x: { key: string }) => x.key === `share:${shareA}`);
  assert.equal(a2.available, false);
  assert.equal(a2.title, '已停止分享');
  assert.equal(a2.link, null);
  assert.equal(a2.open_path, null);
  assert.equal(a2.clicks, 0);
  assert.equal(a2.stars, 0);

  const d2 = resA2.data.items.find((x: { key: string }) => x.key === `share:${shareD}`);
  assert.equal(d2.available, false);
  assert.equal(d2.title, '已停止分享');
  assert.equal(d2.open_path, null);

  const c2 = resA2.data.items.find((x: { key: string }) => x.key === `social_post:${note.data.post_id}`);
  assert.equal(c2.available, false);
  assert.equal(c2.title, '已停止分享');
  assert.equal(c2.link, null);
  assert.equal(c2.open_path, null);

  const svc2 = resA2.data.items.find((x: { key: string }) => x.key === `member_service:${serviceId}`);
  assert.equal(svc2.available, false);
  assert.equal(svc2.title, '已停止分享');
  assert.equal(svc2.link, null);
  assert.equal(svc2.open_path, null);

  const b2 = resA2.data.items.find((x: { key: string }) => x.key === `share:${eventShareId}`);
  assert.equal(b2.available, true);
  assert.equal(b2.title, '社群聚會 B');
});

test('S3: myShareResults pages at 50 rows with next_offset', async () => {
  const alice = await createNonTestUser('alice-page@example.com', 'Alice Pager');
  const base = Date.UTC(2026, 9, 1, 0, 0, 0);
  await transaction(pool, async q => {
    for (let i = 0; i < 52; i++) {
      await q.query(
        `INSERT INTO promotion_links(community_id,user_id,kind,target_key,code,created_at) VALUES($1,$2,'skill_book',$3,$4,$5)`,
        [DEMO_COMMUNITY, alice.actor.user_id, `book:typo-studio-${i}`, randomBytes(7).toString('base64url'), new Date(base + i * 1000)],
      );
    }
    const first = await myShareResults(q, alice.actor, { offset: 0 }, DEMO_COMMUNITY);
    assert.equal(first.items.length, 50);
    assert.equal(first.next_offset, 50);
    const second = await myShareResults(q, alice.actor, { offset: 50 }, DEMO_COMMUNITY);
    assert.equal(second.items.length, 2);
    assert.equal(second.next_offset, null);
    assert.deepEqual(
      [...first.items, ...second.items].map(x => x.key),
      Array.from({ length: 52 }, (_, i) => `skill_book:book:typo-studio-${51 - i}`),
    );
  });
});

test('mixed standalone results preserve current event, skill, card and static availability in one query',async()=>{
 const alice=await createNonTestUser('mixed-results@example.com','Mixed Results');
 const event=randomUUID(),project=randomUUID(),version=randomUUID(),submission=randomUUID(),sha='a'.repeat(64);
 await pool.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,state,visibility)
  VALUES($1,$2,$3,'Synthetic event','Details',now()+interval '2 days',now()+interval '3 days','in_person','Location','published','open')`,[event,DEMO_COMMUNITY,alice.actor.user_id]);
 await pool.query(`INSERT INTO oss_projects(project_id,community_id,owner_ref,title,description,use_notes,repository_id,repository_full_name,repository_url,relationship)
  VALUES($1,$2,$3,'Synthetic skill','Details','Use','8801001','example/mixed','https://github.com/example/mixed','author')`,[project,DEMO_COMMUNITY,alice.actor.user_id]);
 await pool.query(`INSERT INTO oss_project_versions(version_id,project_id,repository_id,commit_sha,default_branch,repository_full_name,repository_url,readme_url,license_spdx,is_fork,archived,source_snapshot,source_sha256,facts_sha256,inspected_at)
  VALUES($1,$2,'8801001',$3,'main','example/mixed','https://github.com/example/mixed','https://github.com/example/mixed#readme','MIT',false,false,'{}',$4,$4,now())`,[version,project,'b'.repeat(40),sha]);
 await pool.query('UPDATE oss_projects SET current_version_id=$2 WHERE project_id=$1',[project,version]);
 await pool.query(`INSERT INTO skill_submissions(submission_id,community_id,owner_ref,status,payload,payload_sha256,consent_to_share,project_id,project_version_id,published_at,grant_consumed_at)
  VALUES($1,$2,$3,'published',$4,$5,true,$6,$7,now(),now())`,[submission,DEMO_COMMUNITY,alice.actor.user_id,JSON.stringify({title:'Synthetic skill',description:'Details',relationship:'author',share_introductions:['One'],use_notes:'Use'}),sha,project,version]);
 const token=randomBytes(32).toString('base64url'),generation=createHash('sha256').update(token).digest('hex').slice(0,16);
 await pool.query('INSERT INTO member_card_shares(user_id,community_id,share_token,enabled,include_avatar) VALUES($1,$2,$3,true,false)',[alice.actor.user_id,DEMO_COMMUNITY,token]);
 const targets=[['event',event],['skill_book',`submission:${submission}`],['skill_book','book:social-post'],['platform','tester-map'],['member_card',`${alice.actor.user_id}:${generation}`],['member_card',`${alice.actor.user_id}:${'0'.repeat(16)}`]] as const;
 for(const [kind,target] of targets)await pool.query('INSERT INTO promotion_links(community_id,user_id,kind,target_key,code) VALUES($1,$2,$3,$4,$5)',[DEMO_COMMUNITY,alice.actor.user_id,kind,target,randomBytes(7).toString('base64url')]);
 const check=async()=>{
  let statements=0;
  const counted={query:(...args:any[])=>{statements++;return (pool.query as any)(...args);}} as unknown as import('pg').PoolClient;
  const actual=await myShareResults(counted,alice.actor,{},DEMO_COMMUNITY);
  assert.equal(statements,1);assert.equal(actual.items.length,targets.length);
  const {mineTitles}=await import('../../modules/community/promotion.js');
  const expected=await mineTitles(pool,alice.actor,targets.map(([kind,target_key])=>({kind,target_key})),DEMO_COMMUNITY);
  for(const [kind,target_key] of targets){
   const row=actual.items.find(item=>item.key===`${kind}:${target_key}`),original=expected({kind,target_key});
   assert.ok(row);assert.equal(row.available,original.available);assert.equal(row.title,original.available?original.title:'已停止分享');
  }
 };
 await check();
 await pool.query('UPDATE member_card_shares SET enabled=false WHERE user_id=$1',[alice.actor.user_id]);
 await pool.query('UPDATE oss_projects SET sharing_withdrawn_at=now() WHERE project_id=$1',[project]);
 await pool.query("UPDATE community_events SET state='cancelled' WHERE event_id=$1",[event]);
 await check();
});

test('S3: myShareResults orders all four result kinds newest-first by greatest(created_at, last_click, last_credit)', async () => {
  const alice = await createNonTestUser('alice-order@example.com', 'Alice Order');
  const bob = await createNonTestUser('bob-order@example.com', 'Bob Order');

  const repoId = randomUUID();
  const repoShareId = randomUUID();
  const eventId = randomUUID();
  const eventShareId = randomUUID();
  const serviceId = randomUUID();
  const notePostId = randomUUID();
  await pool.query(
    `INSERT INTO community_social_posts(post_id,community_id,author_user_id,kind,url,platform,title,note,state)
     VALUES($1,$2,$3,'note',NULL,'other','排序測試筆記','排序測試筆記\n內容','active')`,
    [notePostId, DEMO_COMMUNITY, alice.actor.user_id],
  );
  const note = { data: { post_id: notePostId } };
  const noteState = await req(`/social-posts/${note.data.post_id}/public-sharing`, alice);
  await req(`/social-posts/${note.data.post_id}/public-sharing`, alice, {
    enabled: true, post_revision: noteState.data.post_revision, media_version: noteState.data.media_version,
  }, 'POST', { 'If-Match': `"${noteState.data.version}"` });

  await pool.query(
    `INSERT INTO canonical_repositories(repo_id,provider,provider_repo_id,full_name,current_url)
     VALUES($1,'github','997799','org/repo-order','https://github.com/org/repo-order')`,
    [repoId],
  );
  await pool.query(
    `INSERT INTO shares(share_id,community_id,kind,canonical_key,canonical_url,repo_id,title,first_sharer_user_id,state)
     VALUES($1,$2,'repository','github:org/repo-order','https://github.com/org/repo-order',$3,'排序專案',$4,'published')`,
    [repoShareId, DEMO_COMMUNITY, repoId, alice.actor.user_id],
  );
  await pool.query(
    `INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,state,visibility,event_kind)
     VALUES($1,$2,$3,'排序活動','說明',now()+interval '2 days',now()+interval '3 days','online','線上','published','open','other')`,
    [eventId, DEMO_COMMUNITY, alice.actor.user_id],
  );
  await pool.query(
    `INSERT INTO shares(share_id,community_id,kind,canonical_key,canonical_url,ref_table,ref_id,title,first_sharer_user_id,state)
     VALUES($1,$2,'event',$3,$4,'community_events',$5,'排序活動',$6,'published')`,
    [eventShareId, DEMO_COMMUNITY, `event:${eventId}`, `/events/${eventId}`, eventId, alice.actor.user_id],
  );
  await pool.query(
    `INSERT INTO member_services(service_id,community_id,owner_user_id,title,category,summary,service_mode,contacts,state)
     VALUES($1,$2,$3,'排序服務','language','服務簡介','online','[{"label":"網站","url":"https://example.com/order-svc"}]'::jsonb,'active')`,
    [serviceId, DEMO_COMMUNITY, alice.actor.user_id],
  );

  const repoLink = await req(`/shares/${repoShareId}/links`, alice, {});
  const eventLink = await req('/promotion/links', alice, { kind: 'event', target: eventId });
  const noteLink = await req('/promotion/links', alice, { kind: 'social_post', target: note.data.post_id });
  const serviceLink = await req('/promotion/links', alice, { kind: 'member_service', target: serviceId });
  assert.equal(repoLink.status, 200);
  assert.equal(eventLink.status, 200);
  assert.equal(noteLink.status, 200);
  assert.equal(serviceLink.status, 200);

  // Set deterministic link creation times: service (t4) > note (t3) > event (t2) > repo (t1),
  // then advance repo via last_click (t6) and event via last_credit (t5).
  await pool.query(
    `UPDATE promotion_links SET created_at = CASE code
       WHEN $1 THEN '2026-10-01T00:01:00Z'::timestamptz
       WHEN $2 THEN '2026-10-01T00:02:00Z'::timestamptz
       WHEN $3 THEN '2026-10-01T00:03:00Z'::timestamptz
       WHEN $4 THEN '2026-10-01T00:04:00Z'::timestamptz
     END WHERE code IN ($1,$2,$3,$4)`,
    [repoLink.data.code, eventLink.data.code, noteLink.data.code, serviceLink.data.code],
  );
  const linkRows = (
    await pool.query('SELECT link_id FROM promotion_links WHERE code=$1', [repoLink.data.code])
  ).rows as Array<{ link_id: string }>;
  const repoLinkId = linkRows[0].link_id;
  await pool.query(
    `INSERT INTO promotion_clicks(link_id,click_day,visitor_key,network_key,community_id,user_id,kind,created_at)
     VALUES($1,'2026-10-01',$2,$3,$4,$5,'share','2026-10-01T00:06:00Z')`,
    [repoLinkId, `v:${'1'.repeat(64)}`, '2'.repeat(64), DEMO_COMMUNITY, alice.actor.user_id],
  );
  await pool.query(
    `INSERT INTO share_credit_events(share_id,community_id,user_id,role,basis,units,source_ref,actor_user_id,created_at)
     VALUES($1,$2,$3,'spreader','registration',1,$4,$5,'2026-10-01T00:05:00Z'),
           ($6,$2,$3,'sharer','star_confirmed',1,$7,$5,'2026-10-01T00:02:30Z')`,
    [eventShareId, DEMO_COMMUNITY, alice.actor.user_id, `reg:order:${eventId}`, bob.actor.user_id, repoShareId, `star:order:${repoShareId}`],
  );

  const ordered = await req('/me/share-results', alice);
  assert.equal(ordered.status, 200, ordered.text);
  assert.deepEqual(
    ordered.data.items.map((x: { key: string }) => x.key),
    [
      `share:${repoShareId}`,
      `share:${eventShareId}`,
      `member_service:${serviceId}`,
      `social_post:${note.data.post_id}`,
    ],
  );
});

test('CONF-4: myShareResults withholds work share results when public sharing is off or stale', async () => {
  const author = await createNonTestUser('author-conf4@example.com', 'Author Conf4');
  const attacker = await createNonTestUser('attacker-conf4@example.com', 'Attacker Conf4');
  const workId = randomUUID();
  await pool.query(
    `INSERT INTO showcases(showcase_id,community_id,owner_ref,title,description,artifact_ref,status,visibility,consent_recorded_at)
     VALUES($1,$2,$3,'公開作品 CONF-4','公開摘要','artifact:conf4','published','community',now())`,
    [workId, DEMO_COMMUNITY, author.actor.user_id],
  );

  const initialState = await req(`/me/showcases/${workId}/sharing`, author);
  assert.equal(initialState.status, 200, initialState.text);
  const enableRes = await req(
    `/me/showcases/${workId}/sharing`,
    author,
    { enabled: true, work_version: initialState.data.work_version },
    'PUT',
    { 'If-Match': `"${initialState.data.version}"` },
  );
  assert.equal(enableRes.status, 200, enableRes.text);

  const workShare = await req('/shares', attacker, { kind: 'work', ref_id: workId });
  assert.equal(workShare.status, 200, workShare.text);
  const shareId = workShare.data.share_id as string;
  const shareLinkRes = await req(`/shares/${shareId}/links`, attacker, {});
  assert.equal(shareLinkRes.status, 200, shareLinkRes.text);
  const code = shareLinkRes.data.code as string;

  const clickRes = await req('/promotion/clicks', undefined, { code }, 'POST', {
    'User-Agent': 'Mozilla/5.0 Chrome/128.0.0.0 Safari/537.36',
  });
  assert.equal(clickRes.status, 200, clickRes.text);
  const goOpen = await app.request(`${origin}/go/${code}`);
  assert.equal(goOpen.status, 200);

  const beforeDisable = await req('/me/share-results', attacker);
  assert.equal(beforeDisable.status, 200, beforeDisable.text);
  const openRow = beforeDisable.data.items.find((x: { key: string }) => x.key === `share:${shareId}`);
  assert.equal(openRow.available, true);
  assert.equal(openRow.clicks, 1);
  assert.equal(openRow.open_path, `/go/${code}`);

  // Author disables public sharing -> both /go/<code> and /me/share-results withhold the work share
  const disableRes = await req(
    `/me/showcases/${workId}/sharing`,
    author,
    { enabled: false },
    'PUT',
    { 'If-Match': `"${enableRes.data.version}"` },
  );
  assert.equal(disableRes.status, 200, disableRes.text);

  const goAfterDisable = await app.request(`${origin}/go/${code}`);
  assert.equal(goAfterDisable.status, 404);
  const resultsAfterDisable = await req('/me/share-results', attacker);
  assert.equal(resultsAfterDisable.status, 200, resultsAfterDisable.text);
  const disabledRow = resultsAfterDisable.data.items.find((x: { key: string }) => x.key === `share:${shareId}`);
  assert.equal(disabledRow.available, false);
  assert.equal(disabledRow.title, '已停止分享');
  assert.equal(disabledRow.link, null);
  assert.equal(disabledRow.open_path, null);
  assert.equal(disabledRow.clicks, 0);
  assert.equal(disabledRow.stars, 0);
  assert.equal(disabledRow.registrations, 0);

  // Author re-enables public sharing, then edits the showcase so approved_work_version becomes stale
  const reenableRes = await req(
    `/me/showcases/${workId}/sharing`,
    author,
    { enabled: true, work_version: disableRes.data.work_version },
    'PUT',
    { 'If-Match': `"${disableRes.data.version}"` },
  );
  assert.equal(reenableRes.status, 200, reenableRes.text);
  assert.equal((await app.request(`${origin}/go/${code}`)).status, 200);

  await pool.query(
    `UPDATE showcases SET aggregate_version = aggregate_version + 1 WHERE showcase_id = $1`,
    [workId],
  );
  assert.equal((await app.request(`${origin}/go/${code}`)).status, 404);

  const resultsAfterStale = await req('/me/share-results', attacker);
  assert.equal(resultsAfterStale.status, 200, resultsAfterStale.text);
  const staleRow = resultsAfterStale.data.items.find((x: { key: string }) => x.key === `share:${shareId}`);
  assert.equal(staleRow.available, false);
  assert.equal(staleRow.title, '已停止分享');
  assert.equal(staleRow.link, null);
  assert.equal(staleRow.open_path, null);
  assert.equal(staleRow.clicks, 0);
});

test('S3: a published post or service and its tracked link are one result row, before and after pause and removal', async () => {
  // The normal publication paths create the share and the author's credit; shareLink then makes a
  // social_post or member_service link. The results must join them instead of listing the item twice.
  const saved = app;
  app = createApp(pool, origin, 'local', {
    registrationCommunityId: DEMO_COMMUNITY,
    linkPreviewFetch: async () => new Response('<meta property="og:title" content="頁面標題">', { status: 200, headers: { 'content-type': 'text/html' } }),
  });
  try {
    const author = await createNonTestUser('original-author@example.test', '原創作者');
    const post = await req('/social-posts', author, { url: 'https://example.com/original-post', title: '原創貼文' });
    assert.equal(post.status, 201, post.text);
    const service = await req('/member-services', author, {
      title: '原創服務', category: 'hair_beauty', summary: '客製造型', description: '線上討論。',
      price_text: '每堂 NT$800 起', area_text: '線上', service_mode: 'online',
      contacts: [{ label: '官方網站', url: 'https://example.com/service' }],
    });
    assert.equal(service.status, 201, service.text);
    const shareOf = async (kind: string, ref: string) =>
      (await pool.query('SELECT share_id::text AS id FROM shares WHERE community_id=$1 AND kind=$2 AND ref_id=$3', [DEMO_COMMUNITY, kind, ref])).rows[0]?.id as string;
    // A note is public only while its author shares it publicly (the rule `/go` applies to its link).
    const note = await req('/social-posts/notes', author, { text: '原創筆記' });
    assert.equal(note.status, 201, note.text);
    const publicSharing = async (enabled: boolean) => {
      const current = await req(`/social-posts/${note.data.post_id}/public-sharing`, author);
      assert.equal(current.status, 200, current.text);
      const changed = await req(`/social-posts/${note.data.post_id}/public-sharing`, author,
        { enabled, post_revision: current.data.post_revision, media_version: current.data.media_version }, 'POST', { 'If-Match': `"${current.data.version}"` });
      assert.equal(changed.status, 200, changed.text);
    };
    await publicSharing(true);
    const postShare = await shareOf('post', post.data.post_id), serviceShare = await shareOf('service', service.data.service_id), noteShare = await shareOf('post', note.data.post_id);
    assert.ok(postShare && serviceShare && noteShare, 'publication creates every share');
    const paths = new Map<string, string>();
    for (const share of [postShare, serviceShare, noteShare]) {
      const link = await req(`/shares/${share}/links`, author, {});
      assert.ok(link.status === 200 || link.status === 201, link.text);
      paths.set(share, link.data.path);
      const clicked = await app.request(`${origin}/api/v1/promotion/clicks`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' },
        body: JSON.stringify({ code: link.data.code }),
      });
      assert.ok(clicked.status < 300, await clicked.text());
    }
    assert.deepEqual((await pool.query('SELECT l.kind, count(c.link_id)::int AS clicks FROM promotion_links l LEFT JOIN promotion_clicks c USING(link_id) WHERE l.user_id=$1 GROUP BY l.kind ORDER BY l.kind', [author.actor.user_id])).rows,
      [{ kind: 'member_service', clicks: 1 }, { kind: 'social_post', clicks: 2 }]);

    const results = async () => {
      const response = await req('/me/share-results', author);
      assert.equal(response.status, 200, response.text);
      return response.data.items as ShareResultItem[];
    };
    type ShareResultItem = { key: string; kind: string; title: string; available: boolean; link: { kind: string; path: string } | null; clicks: number };
    const keys = [`share:${postShare}`, `share:${serviceShare}`, `share:${noteShare}`].sort();
    const before = await results();
    assert.deepEqual(before.map(i => i.key).sort(), keys, JSON.stringify(before));
    for (const [share, kind, linkKind] of [[postShare, 'post', 'social_post'], [serviceShare, 'service', 'member_service'], [noteShare, 'post', 'social_post']]) {
      const row = before.find(i => i.key === `share:${share}`)!;
      assert.equal(row.kind, kind); assert.equal(row.available, true);
      assert.equal(row.clicks, 1); assert.deepEqual(row.link && { kind: row.link.kind, path: row.link.path }, { kind: linkKind, path: paths.get(share) });
    }
    assert.equal(before.find(i => i.key === `share:${postShare}`)!.title, '原創貼文');
    assert.equal(before.find(i => i.key === `share:${serviceShare}`)!.title, '原創服務');

    // Withdrawing public sharing keeps the note readable to members: one row with its real count, and
    // no public link to offer.
    await publicSharing(false);
    const withdrawn = await results();
    assert.deepEqual(withdrawn.map(i => i.key).sort(), keys, JSON.stringify(withdrawn));
    const noteRow = withdrawn.find(i => i.key === `share:${noteShare}`)!;
    assert.deepEqual({ available: noteRow.available, link: noteRow.link, clicks: noteRow.clicks }, { available: true, link: null, clicks: 1 });

    assert.equal((await req(`/member-services/${service.data.service_id}/pause`, author, {}, 'POST', { 'If-Match': '"1"' })).status, 200);
    assert.equal((await req(`/social-posts/${post.data.post_id}`, author, {}, 'DELETE')).status, 200);
    const after = await results();
    assert.deepEqual(after.map(i => i.key).sort(), keys, JSON.stringify(after));
    for (const row of after.filter(i => i.key !== `share:${noteShare}`)) assert.deepEqual({ title: row.title, available: row.available, link: row.link, clicks: row.clicks }, { title: '已停止分享', available: false, link: null, clicks: 0 });
  } finally {
    app = saved;
  }
});

test('S3: platform, member-card and skill-book links stay one row each once their clicks credit a share', async () => {
  const member = await createNonTestUser('links-once@example.com', '連結分享者');
  const chrome = { 'User-Agent': 'Mozilla/5.0 Chrome/128.0.0.0 Safari/537.36' };
  // A repository share that carries a catalog skill book, as the share backfill attaches it.
  const repo = randomUUID(), repoShare = randomUUID();
  await pool.query(
    `INSERT INTO canonical_repositories(repo_id,provider,provider_repo_id,full_name,current_url)
     VALUES($1,'github','997702','org/book-repo','https://github.com/org/book-repo')`, [repo]);
  await pool.query(
    `INSERT INTO shares(share_id,community_id,kind,canonical_key,canonical_url,repo_id,title,first_sharer_user_id,state,legacy_ref)
     VALUES($1,$2,'repository','github:org/book-repo','https://github.com/org/book-repo',$3,'技能書專案',$4,'published',$5::jsonb)`,
    [repoShare, DEMO_COMMUNITY, repo, member.actor.user_id, JSON.stringify([{ kind: 'book', id: 'social-post' }])]);
  await pool.query('INSERT INTO member_card_shares(user_id,community_id,share_token,enabled,include_avatar) VALUES($1,$2,$3,true,false)',
    [member.actor.user_id, DEMO_COMMUNITY, randomBytes(32).toString('base64url')]);
  const click = async (code: string) => {
    const res = await req('/promotion/clicks', undefined, { code }, 'POST', chrome);
    assert.equal(res.status, 200, res.text);
  };
  for (const [kind, target] of [['platform', 'workshop'], ['platform', 'tester-map'], ['member_card', member.actor.user_id], ['skill_book', 'book:social-post']]) {
    const link = await req('/promotion/links', member, { kind, target });
    assert.equal(link.status, 200, link.text);
    await click(link.data.code);
  }
  // Each click credited a share: the platform's and the member card's anchors, and the repository share.
  const credited = (await pool.query(
    `SELECT DISTINCT s.kind,s.canonical_key FROM share_credit_events e JOIN shares s USING (share_id,community_id)
     WHERE e.user_id=$1 AND e.basis='qualified_click_day' ORDER BY s.canonical_key`, [member.actor.user_id])).rows;
  assert.deepEqual(credited, [
    { kind: 'repository', canonical_key: 'github:org/book-repo' },
    { kind: 'link', canonical_key: `member-card:${member.actor.user_id}` },
    { kind: 'link', canonical_key: 'platform' },
  ].sort((a, b) => a.canonical_key < b.canonical_key ? -1 : 1));
  const codes = new Map((await pool.query('SELECT kind,target_key,code FROM promotion_links WHERE user_id=$1', [member.actor.user_id])).rows
    .map(row => [`${row.kind}:${row.target_key}`, row.code as string]));
  const card = [...codes.keys()].find(key => key.startsWith('member_card:'))!;
  const results = async () => {
    const res = await req('/me/share-results', member);
    assert.equal(res.status, 200, res.text);
    return res.data.items as { key: string; kind: string; title: string; available: boolean; link: { kind: string; path: string } | null; clicks: number }[];
  };
  const byKey = (items: Awaited<ReturnType<typeof results>>, key: string) => items.find(item => item.key === key)!;

  // The anchors add no row; the repository share and its skill book link are one row.
  const first = await results();
  assert.deepEqual(first.map(item => item.key).sort(), ['platform:workshop', 'platform:tester-map', card, `share:${repoShare}`].sort(), JSON.stringify(first));
  for (const key of ['platform:workshop', 'platform:tester-map', card]) {
    const row = byKey(first, key);
    assert.deepEqual({ available: row.available, clicks: row.clicks, path: row.link?.path }, { available: true, clicks: 1, path: `/go/${codes.get(key)}` });
  }
  const book = byKey(first, `share:${repoShare}`);
  assert.deepEqual({ kind: book.kind, title: book.title, clicks: book.clicks, link: book.link && { kind: book.link.kind, path: book.link.path } },
    { kind: 'repository', title: '技能書專案', clicks: 1, link: { kind: 'skill_book', path: `/go/${codes.get('skill_book:book:social-post')}` } });

  // The repository's own share link joins the same row: both links' clicks, and the share link is offered.
  const own = await req(`/shares/${repoShare}/links`, member, {});
  assert.equal(own.status, 200, own.text);
  await click(own.data.code);
  const second = await results();
  assert.equal(second.filter(item => item.key === `share:${repoShare}`).length, 1, JSON.stringify(second));
  const both = byKey(second, `share:${repoShare}`);
  assert.deepEqual({ clicks: both.clicks, link: both.link && { kind: both.link.kind, path: both.link.path } },
    { clicks: 2, link: { kind: 'share', path: own.data.path } });

  // A member card that is turned off stops by its own rule, and its anchor still adds no row.
  await pool.query('UPDATE member_card_shares SET enabled=false WHERE user_id=$1', [member.actor.user_id]);
  const third = await results();
  assert.deepEqual(third.map(item => item.key).sort(), ['platform:workshop', 'platform:tester-map', card, `share:${repoShare}`].sort(), JSON.stringify(third));
  assert.deepEqual({ available: byKey(third, card).available, link: byKey(third, card).link }, { available: false, link: null });
});
