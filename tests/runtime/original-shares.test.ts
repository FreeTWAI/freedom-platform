import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { migrate } from '../../scripts/database.js';
import { seedLocal, DEMO_USERS, DEMO_COMMUNITY } from '../../packages/testing/seed.js';
import type { Actor } from '../../modules/identity-membership/service.js';
import { transaction } from '../../packages/db/index.js';
import { publishOriginalShare } from '../../modules/shares/original-ledger.js';
import { createShare, readShare, listShares } from '../../modules/shares/service.js';
import { createNativeSocialPost, createSocialPost, editSocialPost } from '../../modules/community/social-posts.js';
import { createMemberService, editMemberService } from '../../modules/community/member-services.js';
import { createShowcase, createShowcaseDraft, publishOwnShowcase, updateOwnShowcase, withdrawOwnShowcase } from '../../modules/opportunity-project-work/business.js';

const url = process.env.TEST_DATABASE_URL;
assert.ok(url, 'Set an isolated TEST_DATABASE_URL');
const schema = `fp_orig_shares_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: url });
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
const actors: Actor[] = [];

before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
  await seedLocal(pool);
  for (let i = 0; i < 2; i++) {
    const id = i === 0 ? DEMO_USERS[0].user_id : randomUUID();
    const token = randomUUID();
    if (i > 0) {
      await pool.query(
        `INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,active,onboarding_required)
         SELECT $1,community_id,$2,'Synthetic author',password_hash,$3,true,false FROM users WHERE user_id=$4`,
        [id, `orig-${i}@example.com`, randomUUID(), DEMO_USERS[0].user_id]
      );
    }
    await pool.query('UPDATE users SET email=$2 WHERE user_id=$1', [id, `orig-${i}@example.com`]);
    await pool.query(
      `INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$1,now()+interval '1 day')`,
      [token, id]
    );
    actors.push({ user_id: id, community_id: DEMO_COMMUNITY, session_hash: token, display_name: 'Synthetic author' } as Actor);
  }
});

after(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

test('I1: publishOriginalShare inserts, reopens retracted, refuses hidden, credits once, and ignores daily limit', async () => {
  const cases = [
    { kind: 'post' as const, refTable: 'community_social_posts', urlPrefix: '/?social-post=', urlSuffix: '#social' },
    { kind: 'service' as const, refTable: 'member_services', urlPrefix: '/services/', urlSuffix: '' },
    { kind: 'work' as const, refTable: 'showcases', urlPrefix: '/#showcase/', urlSuffix: '' }
  ];

  for (const c of cases) {
    const refId = randomUUID();
    const shareId = await transaction(pool, q =>
      publishOriginalShare(q, {
        kind: c.kind,
        refTable: c.refTable,
        refId,
        title: `Original ${c.kind}`,
        communityId: actors[0].community_id,
        authorId: actors[0].user_id,
        guildKey: null
      })
    );
    assert.ok(shareId);

    const row = (await pool.query('SELECT * FROM shares WHERE share_id=$1', [shareId])).rows[0];
    assert.equal(row.kind, c.kind);
    assert.equal(row.ref_table, c.refTable);
    assert.equal(row.ref_id, refId);
    assert.equal(row.canonical_key, `${c.kind}:${refId}`);
    assert.equal(row.canonical_url, `${c.urlPrefix}${refId}${c.urlSuffix}`);
    assert.equal(row.first_sharer_user_id, actors[0].user_id);
    assert.equal(row.state, 'published');

    const credits = (
      await pool.query('SELECT role, basis, units FROM share_credit_events WHERE share_id=$1', [shareId])
    ).rows;
    assert.equal(credits.length, 1);
    assert.equal(credits[0].role, 'sharer');
    assert.equal(credits[0].basis, 'created');
    assert.equal(credits[0].units, 1);

    // Repeating publishOriginalShare returns the same share_id without double crediting.
    const secondId = await transaction(pool, q =>
      publishOriginalShare(q, {
        kind: c.kind,
        refTable: c.refTable,
        refId,
        title: `Updated ${c.kind}`,
        communityId: actors[0].community_id,
        authorId: actors[0].user_id,
        guildKey: null
      })
    );
    assert.equal(secondId, shareId);
    const updatedRow = (await pool.query('SELECT title FROM shares WHERE share_id=$1', [shareId])).rows[0];
    assert.equal(updatedRow.title, `Updated ${c.kind}`);
    const creditCount = (
      await pool.query('SELECT count(*)::int n FROM share_credit_events WHERE share_id=$1', [shareId])
    ).rows[0].n;
    assert.equal(creditCount, 1);
  }

  // Retracted share is reopened; hidden share is refused.
  const retractedRef = randomUUID();
  const retractedId = await transaction(pool, q =>
    publishOriginalShare(q, {
      kind: 'work',
      refTable: 'showcases',
      refId: retractedRef,
      title: 'Retracted work',
      communityId: actors[0].community_id,
      authorId: actors[0].user_id,
      guildKey: null
    })
  );
  await pool.query("UPDATE shares SET state='retracted' WHERE share_id=$1", [retractedId]);
  const reopenedId = await transaction(pool, q =>
    publishOriginalShare(q, {
      kind: 'work',
      refTable: 'showcases',
      refId: retractedRef,
      title: 'Reopened work',
      communityId: actors[0].community_id,
      authorId: actors[0].user_id,
      guildKey: null
    })
  );
  assert.equal(reopenedId, retractedId);
  assert.equal((await pool.query('SELECT state FROM shares WHERE share_id=$1', [reopenedId])).rows[0].state, 'published');

  await pool.query("UPDATE shares SET state='hidden' WHERE share_id=$1", [reopenedId]);
  await assert.rejects(
    transaction(pool, q =>
      publishOriginalShare(q, {
        kind: 'work',
        refTable: 'showcases',
        refId: retractedRef,
        title: 'Hidden work',
        communityId: actors[0].community_id,
        authorId: actors[0].user_id,
        guildKey: null
      })
    ),
    /停止公開/
  );

  // Daily share limit (20) does not block publishOriginalShare.
  for (let i = 0; i < 22; i++) {
    await transaction(pool, q =>
      publishOriginalShare(q, {
        kind: 'post',
        refTable: 'community_social_posts',
        refId: randomUUID(),
        title: `Burst post ${i}`,
        communityId: actors[1].community_id,
        authorId: actors[1].user_id,
        guildKey: null
      })
    );
  }
  const authorCount = (
    await pool.query('SELECT count(*)::int n FROM shares WHERE first_sharer_user_id=$1', [actors[1].user_id])
  ).rows[0].n;
  assert.equal(authorCount, 22);
});

test('I2: every publish path creates one published share, credits author once, returns share_id on note/link posts, and matches POST /api/v1/shares', async () => {
  const author = actors[0];
  const other = actors[1];

  // 1. publishNativeNote via createNativeSocialPost
  const note = await createNativeSocialPost(pool, {
    actor: author,
    operation: 'POST /api/v1/social-posts/notes',
    key: randomUUID(),
    body: { text: '原生筆記第一行標題\n第二行內容' }
  });
  assert.ok(note.share_id, 'note response carries share_id');
  const noteShares = (
    await pool.query("SELECT * FROM shares WHERE kind='post' AND ref_id=$1", [note.post_id])
  ).rows;
  assert.equal(noteShares.length, 1);
  assert.equal(noteShares[0].share_id, note.share_id);
  assert.equal(noteShares[0].first_sharer_user_id, author.user_id);
  assert.equal(noteShares[0].state, 'published');
  assert.equal(noteShares[0].title, '原生筆記第一行標題');

  // POST /api/v1/shares (createShare) with kind='post', ref_id returns same share_id without duplicating created credit
  const noteByAuthor = await createShare(pool, {
    actor: author,
    operation: 'POST /shares',
    key: randomUUID(),
    body: { kind: 'post', ref_id: note.post_id }
  });
  assert.equal(noteByAuthor.share_id, note.share_id);
  assert.equal(noteByAuthor.created, false);
  const noteByOther = await createShare(pool, {
    actor: other,
    operation: 'POST /shares',
    key: randomUUID(),
    body: { kind: 'post', ref_id: note.post_id }
  });
  assert.equal(noteByOther.share_id, note.share_id);
  assert.equal(noteByOther.created, false);
  const noteCredits = (
    await pool.query('SELECT user_id, role, basis, units FROM share_credit_events WHERE share_id=$1 ORDER BY created_at', [note.share_id])
  ).rows;
  assert.equal(noteCredits.filter(c => c.user_id === author.user_id && c.basis === 'created').length, 1);
  assert.equal(noteCredits.filter(c => c.user_id === other.user_id && c.basis === 'shared_again').length, 1);

  // 2. createSocialPost (link post)
  const linkPost = await createSocialPost(
    pool,
    {
      actor: author,
      operation: 'POST /api/v1/social-posts',
      key: randomUUID(),
      body: { url: 'https://example.com/p3c1-link-post', title: '連結分享標題' }
    },
    { title: 'Preview title', image: null, source: null }
  );
  assert.ok(linkPost.share_id, 'link post response carries share_id');
  const linkShare = await createShare(pool, {
    actor: author,
    operation: 'POST /shares',
    key: randomUUID(),
    body: { kind: 'post', ref_id: linkPost.post_id }
  });
  assert.equal(linkShare.share_id, linkPost.share_id);
  assert.equal(
    (await pool.query('SELECT count(*)::int n FROM share_credit_events WHERE share_id=$1', [linkPost.share_id])).rows[0].n,
    1
  );

  // 3. createMemberService (active)
  const service = await createMemberService(pool, {
    actor: author,
    operation: 'POST /api/v1/member-services',
    key: randomUUID(),
    body: {
      title: '測試會員服務一號',
      category: 'tech',
      summary: '幫你建立網站與自動化工具',
      description: null,
      price_text: null,
      area_text: null,
      service_mode: 'online',
      contacts: [{ label: '網站', url: 'https://example.com/service-contact' }]
    }
  });
  const serviceRows = (
    await pool.query("SELECT * FROM shares WHERE kind='service' AND ref_id=$1", [service.service_id])
  ).rows;
  assert.equal(serviceRows.length, 1);
  assert.equal(serviceRows[0].first_sharer_user_id, author.user_id);
  assert.equal(serviceRows[0].title, '測試會員服務一號');
  const serviceShare = await createShare(pool, {
    actor: author,
    operation: 'POST /shares',
    key: randomUUID(),
    body: { kind: 'service', ref_id: service.service_id }
  });
  assert.equal(serviceShare.share_id, serviceRows[0].share_id);
  assert.equal(
    (await pool.query("SELECT count(*)::int n FROM share_credit_events WHERE share_id=$1 AND basis='created'", [serviceShare.share_id])).rows[0].n,
    1
  );

  // 4. createShowcase (published directly)
  const showcase = await createShowcase(pool, {
    actor: author,
    operation: 'POST /api/v1/showcases',
    key: randomUUID(),
    body: { title: '直接建立作品標題', description: '作品詳細內容', consent_to_share: true }
  });
  const showcaseShareRows = (
    await pool.query("SELECT * FROM shares WHERE kind='work' AND ref_id=$1", [showcase.showcase_id])
  ).rows;
  assert.equal(showcaseShareRows.length, 1);
  assert.equal(showcaseShareRows[0].first_sharer_user_id, author.user_id);
  const showcaseShare = await createShare(pool, {
    actor: author,
    operation: 'POST /shares',
    key: randomUUID(),
    body: { kind: 'work', ref_id: showcase.showcase_id }
  });
  assert.equal(showcaseShare.share_id, showcaseShareRows[0].share_id);
  assert.equal(
    (await pool.query("SELECT count(*)::int n FROM share_credit_events WHERE share_id=$1 AND basis='created'", [showcaseShare.share_id])).rows[0].n,
    1
  );

  // 5. createShowcaseDraft does not create a share; publishOwnShowcase creates one
  const draft = await createShowcaseDraft(pool, {
    actor: author,
    operation: 'POST /api/v1/me/showcases',
    key: randomUUID(),
    body: { title: '草稿待發佈作品', description: '草稿內容' }
  });
  assert.equal(
    (await pool.query("SELECT count(*)::int n FROM shares WHERE kind='work' AND ref_id=$1", [draft.showcase_id])).rows[0].n,
    0
  );
  await publishOwnShowcase(
    pool,
    {
      actor: author,
      operation: 'POST /api/v1/me/showcases/:id/publish',
      key: randomUUID(),
      expected: String(draft.aggregate_version),
      body: { consent_to_share: true }
    },
    draft.showcase_id
  );
  const publishedDraftShares = (
    await pool.query("SELECT * FROM shares WHERE kind='work' AND ref_id=$1", [draft.showcase_id])
  ).rows;
  assert.equal(publishedDraftShares.length, 1);
  assert.equal(publishedDraftShares[0].first_sharer_user_id, author.user_id);
  assert.equal(
    (await pool.query("SELECT count(*)::int n FROM share_credit_events WHERE share_id=$1 AND basis='created'", [publishedDraftShares[0].share_id])).rows[0].n,
    1
  );

  // 6. Who can read a share does not change (verification test account share stays hidden from other members)
  await pool.query("UPDATE users SET email='verification-orig@example.invalid' WHERE user_id=$1", [other.user_id]);
  const hiddenNote = await createNativeSocialPost(pool, {
    actor: other,
    operation: 'POST /api/v1/social-posts/notes',
    key: randomUUID(),
    body: { text: '測試帳號貼文' }
  });
  await transaction(pool, async q => {
    await assert.rejects(readShare(q, author, hiddenNote.share_id!), /找不到/);
    const listed = await listShares(q, author, { limit: 50, offset: 0 });
    assert.equal(listed.items.some(item => item.share_id === hiddenNote.share_id), false);
  });
  await pool.query("UPDATE users SET email='orig-1@example.com' WHERE user_id=$1", [other.user_id]);
});

test('I3: title edits on social note, social link post, member service, and showcase update shares.title in same transaction', async () => {
  const author = actors[0];

  // 1. editSocialPost (note)
  const note = await createNativeSocialPost(pool, {
    actor: author,
    operation: 'POST /api/v1/social-posts/notes',
    key: randomUUID(),
    body: { text: '舊筆記標題\n舊內容' }
  });
  await editSocialPost(
    pool,
    {
      actor: author,
      operation: `POST /api/v1/social-posts/${note.post_id}/edit`,
      key: randomUUID(),
      expected: String(note.revision),
      body: { text: '新筆記標題\n新內容' }
    },
    note.post_id
  );
  assert.equal(
    (await pool.query("SELECT title FROM shares WHERE kind='post' AND ref_id=$1", [note.post_id])).rows[0].title,
    '新筆記標題'
  );

  // 2. editSocialPost (link)
  const linkPost = await createSocialPost(
    pool,
    {
      actor: author,
      operation: 'POST /api/v1/social-posts',
      key: randomUUID(),
      body: { url: 'https://example.com/p3c1-edit-link', title: '舊連結標題' }
    },
    { title: 'Preview', image: null, source: null }
  );
  await editSocialPost(
    pool,
    {
      actor: author,
      operation: `POST /api/v1/social-posts/${linkPost.post_id}/edit`,
      key: randomUUID(),
      expected: String(linkPost.revision),
      body: { title: '新連結標題', note: '新備註' }
    },
    linkPost.post_id
  );
  assert.equal(
    (await pool.query("SELECT title FROM shares WHERE kind='post' AND ref_id=$1", [linkPost.post_id])).rows[0].title,
    '新連結標題'
  );

  // 3. editMemberService
  const svc = await createMemberService(pool, {
    actor: author,
    operation: 'POST /api/v1/member-services',
    key: randomUUID(),
    body: {
      title: '舊服務標題',
      category: 'tech',
      summary: '服務簡介',
      description: null,
      price_text: null,
      area_text: null,
      service_mode: 'online',
      contacts: [{ label: '網站', url: 'https://example.com/svc-edit' }]
    }
  });
  await editMemberService(
    pool,
    {
      actor: author,
      operation: `PUT /api/v1/member-services/${svc.service_id}`,
      key: randomUUID(),
      expected: String(svc.aggregate_version),
      body: {
        title: '新服務標題',
        category: 'tech',
        summary: '服務簡介',
        description: null,
        price_text: null,
        area_text: null,
        service_mode: 'online',
        contacts: [{ label: '網站', url: 'https://example.com/svc-edit' }]
      }
    },
    svc.service_id
  );
  assert.equal(
    (await pool.query("SELECT title FROM shares WHERE kind='service' AND ref_id=$1", [svc.service_id])).rows[0].title,
    '新服務標題'
  );

  // 4. updateOwnShowcase
  const work = await createShowcase(pool, {
    actor: author,
    operation: 'POST /api/v1/showcases',
    key: randomUUID(),
    body: { title: '舊作品標題', description: '作品說明', consent_to_share: true }
  });
  const withdrawn = await withdrawOwnShowcase(
    pool,
    {
      actor: author,
      operation: `POST /api/v1/me/showcases/${work.showcase_id}/withdraw`,
      key: randomUUID(),
      expected: String(work.aggregate_version),
      body: {}
    },
    work.showcase_id
  );
  await updateOwnShowcase(
    pool,
    {
      actor: author,
      operation: `PUT /api/v1/me/showcases/${work.showcase_id}`,
      key: randomUUID(),
      expected: String(withdrawn.aggregate_version),
      body: { title: '新作品標題', description: '作品新說明' }
    },
    work.showcase_id
  );
  assert.equal(
    (await pool.query("SELECT title FROM shares WHERE kind='work' AND ref_id=$1", [work.showcase_id])).rows[0].title,
    '新作品標題'
  );
});

test('I5: migration 211 backfills published post/service/work without credit, respects withdrawn endorsements, and is repeatable', async () => {
  const migrationCheck = await pool.query("SELECT 1 FROM schema_migrations WHERE name='211_original_shares.sql'");
  assert.equal(migrationCheck.rowCount, 1);

  const sql = readFileSync(new URL('../../migrations/211_original_shares.sql', import.meta.url), 'utf8');
  const author = actors[0];
  const sharer = actors[1];

  const activePostId = randomUUID();
  const hiddenPostId = randomUUID();
  const activeServiceId = randomUUID();
  const pausedServiceId = randomUUID();
  const publishedWorkId = randomUUID();
  const draftWorkId = randomUUID();
  const withdrawnEndorsementPostId = randomUUID();
  const retractedSharePostId = randomUUID();

  await pool.query(
    `INSERT INTO community_social_posts(post_id,community_id,author_user_id,kind,url,platform,title,note,state)
     VALUES($1,$2,$3,'note',NULL,'other','回填筆記標題','回填筆記內文','active'),
           ($4,$2,$3,'note',NULL,'other','隱藏筆記標題','隱藏筆記內文','hidden'),
           ($5,$2,$3,'note',NULL,'other','撤回贊同筆記','撤回贊同內文','active'),
           ($6,$2,$3,'note',NULL,'other','收回分享筆記','收回分享內文','active')`,
    [activePostId, author.community_id, author.user_id, hiddenPostId, withdrawnEndorsementPostId, retractedSharePostId]
  );

  await pool.query(
    `INSERT INTO member_services(service_id,community_id,owner_user_id,title,category,summary,service_mode,contacts,state)
     VALUES($1,$2,$3,'回填服務標題','tech','回填服務摘要','online','[{"label":"網站","url":"https://example.com/s1"}]'::jsonb,'active'),
           ($4,$2,$3,'暫停服務標題','tech','暫停服務摘要','online','[{"label":"網站","url":"https://example.com/s2"}]'::jsonb,'paused')`,
    [activeServiceId, author.community_id, author.user_id, pausedServiceId]
  );

  await pool.query(
    `INSERT INTO showcases(showcase_id,community_id,owner_ref,title,description,artifact_ref,visibility,status,consent_recorded_at)
     VALUES($1,$2,$3,'回填作品標題','回填作品說明','https://example.com/w1','community','published',now()),
           ($4,$2,$3,'草稿作品標題','草稿作品說明','https://example.com/w2','private','draft',NULL)`,
    [publishedWorkId, author.community_id, author.user_id, draftWorkId]
  );

  const withdrawnShareId = randomUUID();
  await pool.query(
    `INSERT INTO shares(share_id,community_id,kind,canonical_key,canonical_url,ref_table,ref_id,title,first_sharer_user_id,state)
     VALUES($1,$2,'post',$3,$4,'community_social_posts',$5,'撤回贊同筆記',$6,'published')`,
    [withdrawnShareId, author.community_id, `post:${withdrawnEndorsementPostId}`, `/?social-post=${withdrawnEndorsementPostId}#social`, withdrawnEndorsementPostId, author.user_id]
  );
  await pool.query(
    `INSERT INTO share_endorsements(share_id,user_id,withdrawn_at) VALUES($1,$2,now())`,
    [withdrawnShareId, author.user_id]
  );

  const retractedShareId = randomUUID();
  await pool.query(
    `INSERT INTO shares(share_id,community_id,kind,canonical_key,canonical_url,ref_table,ref_id,title,first_sharer_user_id,state)
     VALUES($1,$2,'post',$3,$4,'community_social_posts',$5,'收回分享筆記',$6,'retracted')`,
    [retractedShareId, author.community_id, `post:${retractedSharePostId}`, `/?social-post=${retractedSharePostId}#social`, retractedSharePostId, author.user_id]
  );

  const creditsBefore = Number((await pool.query('SELECT count(*)::int AS n FROM share_credit_events')).rows[0].n);

  await pool.query(sql);

  const creditsAfterFirst = Number((await pool.query('SELECT count(*)::int AS n FROM share_credit_events')).rows[0].n);
  assert.equal(creditsAfterFirst, creditsBefore);

  const expectedBackfills = [
    { kind: 'post', refId: activePostId, refTable: 'community_social_posts', url: `/?social-post=${activePostId}#social`, title: '回填筆記標題' },
    { kind: 'service', refId: activeServiceId, refTable: 'member_services', url: `/services/${activeServiceId}`, title: '回填服務標題' },
    { kind: 'work', refId: publishedWorkId, refTable: 'showcases', url: `/#showcase/${publishedWorkId}`, title: '回填作品標題' }
  ];

  for (const item of expectedBackfills) {
    const shareRows = (
      await pool.query(
        'SELECT share_id, state, first_sharer_user_id, canonical_key, canonical_url, ref_table, title FROM shares WHERE kind=$1 AND ref_id=$2',
        [item.kind, item.refId]
      )
    ).rows;
    assert.equal(shareRows.length, 1);
    assert.equal(shareRows[0].state, 'published');
    assert.equal(shareRows[0].first_sharer_user_id, author.user_id);
    assert.equal(shareRows[0].canonical_key, `${item.kind}:${item.refId}`);
    assert.equal(shareRows[0].canonical_url, item.url);
    assert.equal(shareRows[0].ref_table, item.refTable);
    assert.equal(shareRows[0].title, item.title);

    const endorsements = (
      await pool.query('SELECT user_id, withdrawn_at FROM share_endorsements WHERE share_id=$1', [shareRows[0].share_id])
    ).rows;
    assert.equal(endorsements.length, 1);
    assert.equal(endorsements[0].user_id, author.user_id);
    assert.equal(endorsements[0].withdrawn_at, null);
  }

  for (const [kind, refId] of [
    ['post', hiddenPostId],
    ['service', pausedServiceId],
    ['work', draftWorkId]
  ] as const) {
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM shares WHERE kind=$1 AND ref_id=$2', [kind, refId])).rows[0].n, 0);
  }

  assert.equal(
    (await pool.query('SELECT count(*)::int AS n FROM share_endorsements WHERE share_id=$1 AND withdrawn_at IS NULL', [withdrawnShareId])).rows[0].n,
    0
  );
  assert.equal((await pool.query('SELECT state FROM shares WHERE share_id=$1', [retractedShareId])).rows[0].state, 'retracted');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM share_endorsements WHERE share_id=$1', [retractedShareId])).rows[0].n, 0);

  // POST /api/v1/shares logic returns the same backfilled share_id
  const backfilledPostShareId = (
    await pool.query("SELECT share_id FROM shares WHERE kind='post' AND ref_id=$1", [activePostId])
  ).rows[0].share_id;
  const reshared = await createShare(pool, {
    actor: sharer,
    operation: 'POST /api/v1/shares',
    key: randomUUID(),
    body: { kind: 'post', ref_id: activePostId }
  });
  assert.equal(reshared.share_id, backfilledPostShareId);

  // Run the migration's backfill statement again after inserting another published post without a share (plain SQL)
  const creditsBeforeSecond = Number((await pool.query('SELECT count(*)::int AS n FROM share_credit_events')).rows[0].n);
  const sharesBeforeSecond = Number((await pool.query('SELECT count(*)::int AS n FROM shares')).rows[0].n);
  const secondPostId = randomUUID();
  await pool.query(
    `INSERT INTO community_social_posts(post_id,community_id,author_user_id,kind,url,platform,title,note,state)
     VALUES($1,$2,$3,'note',NULL,'other','二次回填筆記','二次回填內文','active')`,
    [secondPostId, author.community_id, author.user_id]
  );

  await pool.query(sql);

  const sharesAfterSecond = Number((await pool.query('SELECT count(*)::int AS n FROM shares')).rows[0].n);
  const creditsAfterSecond = Number((await pool.query('SELECT count(*)::int AS n FROM share_credit_events')).rows[0].n);
  assert.equal(sharesAfterSecond, sharesBeforeSecond + 1);
  assert.equal(creditsAfterSecond, creditsBeforeSecond);

  const secondShare = (
    await pool.query("SELECT share_id, state, first_sharer_user_id FROM shares WHERE kind='post' AND ref_id=$1", [secondPostId])
  ).rows;
  assert.equal(secondShare.length, 1);
  assert.equal(secondShare[0].state, 'published');
  assert.equal(secondShare[0].first_sharer_user_id, author.user_id);
  assert.equal(
    (await pool.query('SELECT count(*)::int AS n FROM share_endorsements WHERE share_id=$1 AND user_id=$2 AND withdrawn_at IS NULL', [secondShare[0].share_id, author.user_id])).rows[0].n,
    1
  );

  // Running again with nothing new changes nothing
  const endorsementsBeforeThird = Number((await pool.query('SELECT count(*)::int AS n FROM share_endorsements')).rows[0].n);
  await pool.query(sql);
  assert.equal(Number((await pool.query('SELECT count(*)::int AS n FROM shares')).rows[0].n), sharesAfterSecond);
  assert.equal(Number((await pool.query('SELECT count(*)::int AS n FROM share_endorsements')).rows[0].n), endorsementsBeforeThird);
  assert.equal(Number((await pool.query('SELECT count(*)::int AS n FROM share_credit_events')).rows[0].n), creditsBeforeSecond);
});
