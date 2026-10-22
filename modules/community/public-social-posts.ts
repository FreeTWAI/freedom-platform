import type {Pool, PoolClient} from 'pg';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {checkVersion, command, journal, type Command} from '../../packages/db/index.js';
import {Problem, requireCondition} from '../../packages/shared/problem.js';
import {normalizeShareUrl} from '../../packages/shared/share-url.js';
import {readDomainMedia, type DomainMediaSnapshot} from '../../packages/media-migration/domain-bridge.js';
import type {ObjectStore} from '../../packages/asset-storage/index.js';
import type {Actor} from '../identity-membership/service.js';
import {resolvePublicCommunity} from './member-services.js';

type Db = Pool | PoolClient;
export type PublicSocialPost = {
  post_id: string; kind: 'note' | 'link'; title: string; note: string | null; url: string | null;
  created_at: string; edited_at: string | null; author: {display_name: string}; image_url: string | null;
};
export type PublicSocialPostPreview = {
  post_id: string; title: string; summary: string; author: {display_name: string}; path: string;
};
export type PublicSocialPostPage = {post: PublicSocialPost; related: PublicSocialPostPreview[]; version: string};
export type PublicSocialSharingState = {
  enabled: boolean; available: boolean; post_revision: number; media_version: string;
  version: string; public_path: string | null; image_url: string | null;
};

const MEDIA_JOINS = `
  LEFT JOIN community_social_post_thumbnails t ON t.post_id=p.post_id
  LEFT JOIN community_social_thumbnail_asset_targets target ON target.post_id=p.post_id
  LEFT JOIN assets asset ON asset.asset_id=target.asset_id AND asset.state='ready' AND asset.deletion_fence=0
  LEFT JOIN asset_objects object ON object.asset_id=asset.asset_id AND object.variant='thumbnail'`;
const THUMBNAIL_HASH = `CASE WHEN t.storage_source='legacy' THEN encode(sha256(t.image_bytes),'hex') ELSE object.content_sha256 END`;
const MEDIA_READY = `(t.post_id IS NULL OR (t.storage_source='legacy' AND t.image_bytes IS NOT NULL)
  OR (t.storage_source='asset' AND asset.asset_id IS NOT NULL AND object.profile_id='community.social-thumbnail'
    AND object.content_type='image/webp' AND object.content_sha256 IS NOT NULL))`;
const AUTHOR_VISIBLE = `u.community_id=p.community_id AND u.active
  AND (NOT u.onboarding_required OR u.onboarding_completed_at IS NOT NULL)
  AND NOT is_verification_test_account(u.user_id)`;
const PUBLIC_JOINS = `FROM community_social_publications publication
  JOIN community_social_posts p ON p.post_id=publication.post_id
    AND p.community_id=publication.community_id AND p.author_user_id=publication.author_user_id
  JOIN users u ON u.user_id=p.author_user_id ${MEDIA_JOINS}`;
const PUBLIC_VISIBLE = `publication.enabled AND p.state='active' AND ${AUTHOR_VISIBLE} AND ${MEDIA_READY}
  AND publication.post_revision=p.edit_revision AND publication.media_version=p.media_version
  AND publication.thumbnail_sha256 IS NOT DISTINCT FROM (${THUMBNAIL_HASH})`;

type SharingRow = {
  post_id: string; community_id: string; author_user_id: string; state: string;
  edit_revision: number; media_version: string; author_visible: boolean; media_ready: boolean; has_image: boolean;
  enabled: boolean | null; version: string | null; published_post_revision: number | null;
  published_media_version: string | null; thumbnail_sha256: string | null; current_thumbnail_sha256: string | null;
};

async function sharingRow(db: Db, actor: Actor, id: string): Promise<SharingRow> {
  const row = (await db.query(`SELECT p.post_id,p.community_id,p.author_user_id,p.state,p.edit_revision,p.media_version::text,
    (${AUTHOR_VISIBLE}) AS author_visible,${MEDIA_READY} AS media_ready,t.post_id IS NOT NULL AS has_image,
    publication.enabled,publication.version::text,publication.post_revision AS published_post_revision,
    publication.media_version::text AS published_media_version,publication.thumbnail_sha256,
    ${THUMBNAIL_HASH} AS current_thumbnail_sha256
    FROM community_social_posts p JOIN users u ON u.user_id=p.author_user_id
    LEFT JOIN community_social_publications publication ON publication.post_id=p.post_id ${MEDIA_JOINS}
    WHERE p.post_id=$1 AND p.community_id=$2`, [id, actor.community_id])).rows[0] as SharingRow | undefined;
  requireCondition(row && row.state === 'active', 404, 'not_found', '找不到這則貼文。');
  requireCondition(row.author_user_id === actor.user_id, 403, 'author_required', '只有原作者可以設定貼文的公開分享。');
  return row;
}

function sharingState(row: SharingRow, publicCommunity: string | null): PublicSocialSharingState {
  const available = row.enabled === true && row.author_visible && row.media_ready && row.community_id === publicCommunity
    && row.published_post_revision === row.edit_revision && row.published_media_version === row.media_version
    && row.thumbnail_sha256 === row.current_thumbnail_sha256;
  return {
    enabled: row.enabled === true, available, post_revision: row.edit_revision, media_version: row.media_version,
    version: row.version ?? '1', public_path: available ? `/posts/${row.post_id}` : null,
    image_url: row.has_image ? `/api/v1/social-posts/${row.post_id}/thumbnail?v=${row.media_version}` : null,
  };
}

/** Caller holds the existing member-session read transaction. */
export async function readSocialPostSharing(db: Db, actor: Actor, id: string, publicCommunity: string | null) {
  return sharingState(await sharingRow(db, actor, id), publicCommunity);
}

const shareInput = z.object({
  enabled: z.boolean(), post_revision: z.number().int().min(1).max(2147483647),
  media_version: z.string().regex(/^[1-9][0-9]{0,18}$/),
}).strict();

/** Only the original author can publish the exact text/image they reviewed.
 * Publication CAS is separate from the post's editing and media versions. */
export async function setSocialPostSharing(pool: Pool, inputCommand: Command, id: string, publicCommunity: string | null, now = new Date()) {
  const body = shareInput.parse(inputCommand.body);
  const input: Command = {...inputCommand, actor: {...inputCommand.actor}, body};
  const updatedAt = new Date(now);
  let current: SharingRow;
  return command(pool, input, async q => {
    const locked = (await q.query(`SELECT author_user_id,state FROM community_social_posts
      WHERE post_id=$1 AND community_id=$2 FOR UPDATE`, [id, input.actor.community_id])).rows[0];
    requireCondition(locked && locked.state === 'active', 404, 'not_found', '找不到這則貼文。');
    requireCondition(locked.author_user_id === input.actor.user_id, 403, 'author_required', '只有原作者可以設定貼文的公開分享。');
    // Re-read after a possible post-lock wait. All existing editing/media
    // writers serialize through this same post row.
    current = await sharingRow(q, input.actor, id);
    const prior = (await q.query(`SELECT response FROM command_receipts
      WHERE user_id=$1 AND operation=$2 AND idempotency_key=$3`, [input.actor.user_id, input.operation, input.key])).rows[0];
    if (prior) {
      requireCondition(prior.response.version === (current.version ?? '1'), 409, 'public_sharing_changed', '公開分享設定已變更，請重新讀取後再操作。');
      requireCondition(!prior.response.enabled || sharingState(current, publicCommunity).available, 409, 'public_sharing_changed', '貼文內容或分享設定已變更，請重新讀取後再操作。');
    }
  }, async q => {
    checkVersion(current.version ?? '1', input.expected);
    if (body.enabled) {
      requireCondition(current.community_id === publicCommunity && current.author_visible, 403, 'public_sharing_unavailable', '目前無法開放這則貼文的外部閱讀。');
      requireCondition(current.edit_revision === body.post_revision && current.media_version === body.media_version,
        412, 'version_conflict', '貼文內容或圖片已更新，請重新確認後再開放。');
      requireCondition(current.media_ready, 503, 'media_unavailable', '貼文圖片暫時無法讀取，請稍後再開放。');
    }
    const saved = (await q.query(`INSERT INTO community_social_publications
      (post_id,community_id,author_user_id,enabled,post_revision,media_version,thumbnail_sha256,version,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,2,$8)
      ON CONFLICT(post_id) DO UPDATE SET enabled=EXCLUDED.enabled,post_revision=EXCLUDED.post_revision,
        media_version=EXCLUDED.media_version,thumbnail_sha256=EXCLUDED.thumbnail_sha256,
        version=community_social_publications.version+1,updated_at=EXCLUDED.updated_at
      RETURNING version::text`, [id, input.actor.community_id, input.actor.user_id, body.enabled,
      current.edit_revision, current.media_version, current.current_thumbnail_sha256, updatedAt])).rows[0];
    await journal(q, input.actor, 'social_post_publication', id, saved.version, input.operation,
      {enabled: body.enabled, post_revision: current.edit_revision, media_version: current.media_version});
    return readSocialPostSharing(q, input.actor, id, publicCommunity);
  });
}

type PublicRow = {
  item_kind: 'post' | 'related'; post_id: string; kind: 'note' | 'link'; title: string; note: string | null;
  url: string | null; created_at: Date | string; edited_at: Date | string | null; display_name: string; has_image: boolean;
  publication_version: string; post_revision: number; media_version: string; thumbnail_sha256: string | null;
};
const PUBLIC_PINS = `publication.version::text AS publication_version,p.edit_revision AS post_revision,
  p.media_version::text,publication.thumbnail_sha256,publication.updated_at AS publication_time`;
const PUBLIC_FIELDS = `p.post_id,p.kind,p.title,p.note,p.url,p.created_at,p.edited_at,u.display_name,t.post_id IS NOT NULL AS has_image,${PUBLIC_PINS}`;
const iso = (value: Date | string) => new Date(value).toISOString();

/** One SQL snapshot returns exactly the shared post and at most three text
 * previews. No anonymous feed, caller-selected pagination or private DTO. */
export async function readPublicSocialPost(pool: Pool, id: string, configured?: string): Promise<PublicSocialPostPage | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const community = await resolvePublicCommunity(pool, configured);
  if (!community) return null;
  const rows = (await pool.query(`WITH anchor AS (
      SELECT ${PUBLIC_FIELDS} ${PUBLIC_JOINS}
      WHERE p.post_id=$1 AND p.community_id=$2 AND ${PUBLIC_VISIBLE}
    ), previews AS (
      SELECT p.post_id,p.kind,p.title,left(COALESCE(p.note,p.title),160) AS note,
        NULL::text AS url,p.created_at,p.edited_at,u.display_name,false AS has_image,${PUBLIC_PINS}
      ${PUBLIC_JOINS} WHERE p.post_id<>$1 AND p.community_id=$2 AND ${PUBLIC_VISIBLE}
        AND EXISTS(SELECT 1 FROM anchor)
      ORDER BY publication.updated_at DESC,p.post_id DESC LIMIT 3
    ) SELECT 'post' AS item_kind,* FROM anchor UNION ALL SELECT 'related' AS item_kind,* FROM previews
      ORDER BY item_kind,publication_time DESC,post_id DESC`, [id, community])).rows as PublicRow[];
  const post = rows.find(row => row.item_kind === 'post');
  if (!post) return null;
  const normalized = post.kind === 'link' && post.url ? normalizeShareUrl(post.url) : null;
  const page = {
    post: {
      post_id: post.post_id, kind: post.kind, title: post.title, note: post.note,
      url: normalized?.ok ? normalized.url : null, created_at: iso(post.created_at), edited_at: post.edited_at ? iso(post.edited_at) : null,
      author: {display_name: post.display_name}, image_url: post.has_image ? `/api/v1/public/shared-posts/${post.post_id}/image` : null,
    },
    related: rows.filter(row => row.item_kind === 'related').map(row => ({post_id: row.post_id, title: row.title,
      summary: row.note ?? row.title, author: {display_name: row.display_name}, path: `/posts/${row.post_id}`})),
  };
  // Browser freshness covers image-only republication, author names and the
  // bounded preview set without disclosing internal publication/media metadata.
  const pins = rows.map(row => [row.post_id, row.publication_version, row.post_revision, row.media_version, row.thumbnail_sha256]);
  return {...page, version: createHash('sha256').update(JSON.stringify([page, pins])).digest('hex')};
}

async function publicImageSnapshot(pool: Pool, id: string, configured?: string): Promise<DomainMediaSnapshot | undefined> {
  const community = await resolvePublicCommunity(pool, configured);
  if (!community) return;
  const row = (await pool.query(`SELECT p.media_version::text,p.community_id,publication.version::text AS publication_version,
    publication.post_revision,publication.thumbnail_sha256,t.storage_source,t.image_bytes,
    asset.asset_id,asset.scope_id,object.representation_id,object.content_type,object.byte_size,
    object.content_sha256,object.transform_version,object.policy_revision,object.profile_id
    ${PUBLIC_JOINS} WHERE p.post_id=$1 AND p.community_id=$2 AND t.post_id IS NOT NULL AND ${PUBLIC_VISIBLE}`, [id, community])).rows[0];
  if (!row) return;
  return {
    purpose: 'community.social-thumbnail', targetId: id, variant: 'thumbnail', domainVersion: row.media_version,
    authorizationVersion: JSON.stringify([row.community_id, row.publication_version, row.post_revision, row.thumbnail_sha256]),
    source: row.storage_source, legacyBytes: row.image_bytes, legacyContentType: 'image/webp',
    assetId: row.asset_id, scopeId: row.scope_id, representationId: row.representation_id,
    metadata: row.profile_id ? {profileId: row.profile_id, contentType: row.content_type, byteSize: row.byte_size,
      sha256: row.content_sha256, transformVersion: row.transform_version, policyRevision: row.policy_revision} : null,
  };
}

/** Rechecks current publication, author, community, text and media after object
 * I/O; retained legacy bytes never replace an unavailable asset. */
export async function readPublicSocialPostImage(pool: Pool, id: string, configured?: string, store?: ObjectStore): Promise<Buffer> {
  if (!z.uuid().safeParse(id).success) throw new Problem(404, 'not_found', '找不到這則貼文。');
  try {
    return (await readDomainMedia(() => publicImageSnapshot(pool, id, configured),
      {purpose: 'community.social-thumbnail', targetId: id, variant: 'thumbnail'}, store)).bytes;
  } catch (error) {
    if (error instanceof Problem && error.status === 404) throw new Problem(404, 'not_found', '找不到這則貼文。');
    throw error;
  }
}
