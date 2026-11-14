import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { checkVersion, command, journal, type Command } from '../../packages/db/index.js';
import { readWithMemberSession } from '../../packages/db/member-session.js';
import { Problem, requireCondition } from '../../packages/shared/problem.js';
import type { Actor } from '../identity-membership/service.js';

type Queryable = Pick<Pool | PoolClient, 'query'>;

const AUTHOR_VISIBLE = `u.community_id = s.community_id AND u.active
  AND (NOT u.onboarding_required OR u.onboarding_completed_at IS NOT NULL)
  AND NOT is_verification_test_account(u.user_id)`;

export const PUBLIC_WORK_VISIBLE = `publication.enabled = true
  AND publication.approved_work_version = s.aggregate_version
  AND s.status = 'published'
  AND s.visibility = 'community'
  AND ${AUTHOR_VISIBLE}`;

const WorkSharingBody = z.object({
  enabled: z.boolean(),
  work_version: z.union([
    z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    z.string().regex(/^[1-9][0-9]{0,18}$/),
  ]).optional(),
}).strict();

export interface WorkSharingState {
  showcase_id: string;
  title: string;
  description: string;
  public_url: string | null;
  status: 'draft' | 'published' | 'withdrawn';
  visibility: 'private' | 'community';
  enabled: boolean;
  available: boolean;
  needs_reconfirmation: boolean;
  work_version: string;
  approved_work_version: string | null;
  version: string;
  public_path: string;
  updated_at: string | null;
}

export interface PublicWorkView {
  showcase_id: string;
  community_id: string;
  title: string;
  description: string;
  public_url: string | null;
  creator_name: string;
  sharer_name: string | null;
  share_id: string | null;
  share_hidden: boolean;
  approved_work_version: string;
  version: string;
  updated_at: string | null;
}

export async function resolvePublicCommunity(db: Queryable, communityId?: string) {
  if (communityId) return communityId;
  const rows = (await db.query('SELECT community_id FROM communities ORDER BY community_id LIMIT 2')).rows;
  return rows.length === 1 ? rows[0].community_id as string : null;
}

async function ownedWorkSharingRow(db: Queryable, id: string, actor: Actor, lock = false) {
  const row = (await db.query(`
    SELECT s.showcase_id, s.community_id, s.owner_ref, s.title, s.description, s.public_url,
      s.status, s.visibility, s.aggregate_version::text AS work_version,
      publication.enabled AS publication_enabled,
      publication.approved_work_version::text AS approved_work_version,
      publication.version::text AS publication_version,
      publication.consented_at,
      publication.updated_at,
      (${AUTHOR_VISIBLE}) AS author_visible,
      (${PUBLIC_WORK_VISIBLE}) AS available
    FROM showcases s
    JOIN users u ON u.user_id = s.owner_ref
    LEFT JOIN work_public_publications publication USING (showcase_id)
    WHERE s.showcase_id = $1 AND s.community_id = $2 AND s.owner_ref = $3
    ${lock ? 'FOR UPDATE OF s' : ''}
  `, [id, actor.community_id, actor.user_id])).rows[0];
  requireCondition(row, 404, 'not_found', '找不到這份作品。');
  return row;
}

function toSharingState(row: Record<string, unknown>): WorkSharingState {
  const workVersion = String(row.work_version);
  const approvedWorkVersion = row.approved_work_version ? String(row.approved_work_version) : null;
  const enabled = row.publication_enabled === true
    && approvedWorkVersion === workVersion
    && row.status === 'published'
    && row.visibility === 'community';
  const available = enabled && row.available === true;
  const version = row.publication_version ? String(row.publication_version) : workVersion;
  return {
    showcase_id: String(row.showcase_id),
    title: String(row.title),
    description: String(row.description),
    public_url: row.public_url ? String(row.public_url) : null,
    status: row.status as WorkSharingState['status'],
    visibility: row.visibility as WorkSharingState['visibility'],
    enabled,
    available,
    needs_reconfirmation: Boolean(row.consented_at) && !enabled,
    work_version: workVersion,
    approved_work_version: approvedWorkVersion,
    version,
    public_path: `/works/${String(row.showcase_id)}`,
    updated_at: row.updated_at ? new Date(String(row.updated_at)).toISOString() : null,
  };
}

export async function readShowcaseSharing(pool: Pool, actor: Actor, id: string): Promise<WorkSharingState> {
  requireCondition(!actor.agent, 403, 'scope_required', 'Agent 沒有這項操作權限。');
  const workId = z.uuid().parse(id);
  return readWithMemberSession(pool, actor, async q => toSharingState(await ownedWorkSharingRow(q, workId, actor)));
}

export async function setShowcaseSharing(pool: Pool, input: Command, id: string): Promise<WorkSharingState> {
  requireCondition(!input.actor.agent, 403, 'scope_required', 'Agent 沒有這項操作權限。');
  const workId = z.uuid().parse(id);
  const parsed = WorkSharingBody.parse(input.body);
  return command(pool, input, async q => toSharingState(await ownedWorkSharingRow(q, workId, input.actor)), async q => {
    const row = await ownedWorkSharingRow(q, workId, input.actor, true);
    const workVersion = String(row.work_version);
    const currentVersion = row.publication_version ? String(row.publication_version) : workVersion;
    checkVersion(currentVersion, input.expected);
    if (parsed.work_version !== undefined && String(parsed.work_version) !== workVersion) {
      throw new Problem(412, 'version_conflict', '作品內容已更新，請重新確認目前版本。');
    }
    if (parsed.enabled) {
      requireCondition(
        row.status === 'published' && row.visibility === 'community',
        409,
        'work_not_published',
        '請先發布作品到社群，再開放公開閱讀。',
      );
      requireCondition(
        row.author_visible === true,
        403,
        'account_not_public',
        '目前帳號狀態無法開放公開閱讀。',
      );
    }
    const nextVersion = (BigInt(currentVersion) + 1n).toString();
    await q.query(`
      INSERT INTO work_public_publications(
        showcase_id, community_id, owner_ref, enabled, approved_work_version,
        version, consented_at, withdrawn_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $4 THEN now() ELSE NULL END, CASE WHEN $4 THEN NULL ELSE now() END, now())
      ON CONFLICT (showcase_id) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        approved_work_version = CASE WHEN EXCLUDED.enabled THEN EXCLUDED.approved_work_version ELSE work_public_publications.approved_work_version END,
        version = EXCLUDED.version,
        consented_at = COALESCE(EXCLUDED.consented_at, work_public_publications.consented_at),
        withdrawn_at = CASE WHEN EXCLUDED.enabled THEN NULL ELSE now() END,
        updated_at = now()
    `, [workId, input.actor.community_id, input.actor.user_id, parsed.enabled, workVersion, nextVersion]);
    await journal(q, input.actor, 'work_public_publication', workId, nextVersion, parsed.enabled ? 'public_sharing_enabled' : 'public_sharing_disabled', {
      enabled: parsed.enabled,
      work_version: workVersion,
    });
    return toSharingState(await ownedWorkSharingRow(q, workId, input.actor));
  });
}

export async function readPublicWork(db: Queryable, id: string, communityId?: string, viaCode?: string): Promise<PublicWorkView | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const resolvedCommunity = await resolvePublicCommunity(db, communityId);
  if (!resolvedCommunity) return null;
  const row = (await db.query(`
    SELECT s.showcase_id, s.community_id, s.title, s.description, s.public_url,
      u.display_name AS creator_name,
      publication.approved_work_version::text AS approved_work_version,
      publication.version::text AS version,
      publication.updated_at
    FROM work_public_publications publication
    JOIN showcases s USING (showcase_id)
    JOIN users u ON u.user_id = s.owner_ref
    WHERE publication.showcase_id = $1
      AND publication.community_id = $2
      AND ${PUBLIC_WORK_VISIBLE}
  `, [id, resolvedCommunity])).rows[0];
  if (!row) return null;
  let sharerName: string | null = null;
  if (viaCode && /^[A-Za-z0-9_-]{10}$/.test(viaCode)) {
    const shareRow = (await db.query(`
      SELECT u_sharer.display_name AS sharer_name
      FROM promotion_links l
      JOIN shares sh ON sh.share_id::text = l.target_key
      JOIN users u_sharer ON u_sharer.user_id = l.user_id
      WHERE l.code = $1
        AND l.community_id = $2
        AND l.kind = 'share'
        AND l.revoked_at IS NULL
        AND sh.state = 'published'
        AND sh.kind = 'work'
        AND sh.ref_id = $3
        AND sh.community_id = $2
        AND u_sharer.community_id = $2
        AND u_sharer.active
        AND (NOT u_sharer.onboarding_required OR u_sharer.onboarding_completed_at IS NOT NULL)
        AND NOT is_verification_test_account(u_sharer.user_id)
        AND (sh.first_sharer_user_id IS NULL OR NOT is_verification_test_account(sh.first_sharer_user_id))
    `, [viaCode, resolvedCommunity, id])).rows[0];
    sharerName = shareRow?.sharer_name ? String(shareRow.sharer_name) : null;
  }
  const shareRow = (await db.query(`
    SELECT share_id, state
    FROM shares
    WHERE kind = 'work'
      AND ref_id = $1
      AND community_id = $2
    LIMIT 1
  `, [id, resolvedCommunity])).rows[0] as { share_id?: string; state?: string } | undefined;
  return {
    showcase_id: String(row.showcase_id),
    community_id: String(row.community_id),
    title: String(row.title),
    description: String(row.description),
    public_url: row.public_url ? String(row.public_url) : null,
    creator_name: String(row.creator_name),
    sharer_name: sharerName,
    share_id: shareRow?.state === 'published' && shareRow.share_id ? String(shareRow.share_id) : null,
    share_hidden: shareRow?.state === 'hidden',
    approved_work_version: String(row.approved_work_version),
    version: String(row.version),
    updated_at: row.updated_at ? new Date(String(row.updated_at)).toISOString() : null,
  };
}
