import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { Actor } from '../identity-membership/service.js';
import { canAccessGuildEvent } from '../community/events.js';
import { mineTitles, type PromotionKind } from '../community/promotion.js';
import { existingTitle } from './adapters/existing.js';
import type { ShareKind } from './types.js';

export type ShareResultKind = ShareKind | PromotionKind;

export type ShareResult = {
  key: string;
  kind: ShareResultKind;
  title: string;
  available: boolean;
  link: { kind: string; target: string; path: string } | null;
  open_path: string | null;
  clicks: number;
  stars: number;
  registrations: number;
  last_at: string;
};

type SqlResultRow = {
  share_id: string | null;
  link_kind: PromotionKind | null;
  target_key: string | null;
  code: string | null;
  clicks: number;
  stars: number;
  registrations: number;
  last_at: Date | string;
};

type ShareMetaRow = {
  share_id: string;
  kind: ShareKind;
  title: string;
  ref_id: string | null;
  state: string;
};

/** Same readability contract as `myCredit`, with `state='published'` required except for `myCredit`'s hidden-event exception. */
export async function isShareReadable(
  q: PoolClient,
  actor: Actor,
  share: Pick<ShareMetaRow, 'kind' | 'ref_id' | 'state'>,
): Promise<boolean> {
  if (share.state === 'published') {
    return !share.ref_id || Boolean(await existingTitle(q, actor, share.kind, share.ref_id));
  }
  if (share.kind === 'event' && share.state === 'hidden' && share.ref_id) {
    const event = (
      await q.query(
        'SELECT * FROM community_events WHERE event_id=$1 AND community_id=$2 AND NOT is_verification_test_account(organizer_ref)',
        [share.ref_id, actor.community_id],
      )
    ).rows[0];
    return Boolean(event && (await canAccessGuildEvent(q, actor, event)));
  }
  return false;
}

const SHARE_RESULTS_SQL = `WITH links AS (
  SELECT l.link_id, l.kind, l.target_key, l.code, l.created_at,
         count(c.link_id)::int AS clicks, max(c.created_at) AS last_click
  FROM promotion_links l LEFT JOIN promotion_clicks c ON c.link_id = l.link_id
  WHERE l.community_id = $1 AND l.user_id = $2 AND l.revoked_at IS NULL
  GROUP BY l.link_id
), link_rows AS (
  SELECT links.*, s.share_id
  FROM links LEFT JOIN shares s ON s.community_id = $1 AND (
       (links.kind = 'share' AND s.share_id::text = links.target_key)
    OR (links.kind = 'event' AND s.kind = 'event' AND s.ref_id::text = links.target_key))
), credit AS (
  SELECT e.share_id,
         coalesce(sum(e.units) FILTER (WHERE e.basis = 'star_confirmed'), 0)::int AS stars,
         coalesce(sum(e.units) FILTER (WHERE e.basis = 'registration'), 0)::int AS registrations,
         max(e.created_at) AS last_credit
  FROM share_credit_events e
  WHERE e.community_id = $1 AND e.user_id = $2
  GROUP BY e.share_id
  HAVING sum(e.units) > 0
)
SELECT coalesce(lr.share_id, cr.share_id)::text AS share_id, lr.kind AS link_kind, lr.target_key, lr.code,
       coalesce(lr.clicks, 0)::int AS clicks, coalesce(cr.stars, 0)::int AS stars,
       coalesce(cr.registrations, 0)::int AS registrations,
       greatest(lr.created_at, lr.last_click, cr.last_credit) AS last_at
FROM link_rows lr FULL OUTER JOIN credit cr ON cr.share_id = lr.share_id
ORDER BY last_at DESC NULLS LAST, coalesce(lr.share_id::text, cr.share_id::text, lr.kind || ':' || lr.target_key)
LIMIT 51 OFFSET $3`;

export async function myShareResults(
  q: PoolClient,
  actor: Actor,
  raw: unknown = {},
  publicCommunity?: string | null,
): Promise<{ items: ShareResult[]; next_offset: number | null }> {
  const query = z.object({ offset: z.coerce.number().int().min(0).max(10000).default(0) }).strict().parse(raw);
  const rows = (await q.query(SHARE_RESULTS_SQL, [actor.community_id, actor.user_id, query.offset])).rows as SqlResultRow[];
  const pageRows = rows.slice(0, 50);

  const shareIds = [...new Set(pageRows.flatMap(r => (r.share_id ? [r.share_id] : [])))];
  const shareById = new Map<string, ShareMetaRow>();
  if (shareIds.length) {
    const shareRows = (
      await q.query(
        'SELECT share_id::text AS share_id, kind, title, ref_id::text AS ref_id, state FROM shares WHERE community_id=$1 AND share_id=ANY($2::uuid[])',
        [actor.community_id, shareIds],
      )
    ).rows as ShareMetaRow[];
    for (const share of shareRows) shareById.set(share.share_id, share);
  }

  const nonShareTargets = pageRows
    .filter((r): r is SqlResultRow & { link_kind: PromotionKind; target_key: string } => !r.share_id && Boolean(r.link_kind && r.target_key))
    .map(r => ({ kind: r.link_kind, target_key: r.target_key }));
  const resolveLinkTitle = nonShareTargets.length
    ? await mineTitles(q, actor, nonShareTargets, publicCommunity)
    : null;

  const items: ShareResult[] = [];
  for (const row of pageRows) {
    const last_at = new Date(row.last_at).toISOString();
    if (row.share_id) {
      const share = shareById.get(row.share_id);
      const kind: ShareResultKind = share ? share.kind : (row.link_kind ?? 'link');
      const available = share ? await isShareReadable(q, actor, share) : false;
      if (!available || !share) {
        items.push({
          key: `share:${row.share_id}`,
          kind,
          title: '已停止分享',
          available: false,
          link: null,
          open_path: null,
          clicks: 0,
          stars: 0,
          registrations: 0,
          last_at,
        });
        continue;
      }
      const link = row.link_kind && row.target_key && row.code
        ? { kind: row.link_kind, target: row.target_key, path: `/go/${row.code}` }
        : null;
      items.push({
        key: `share:${row.share_id}`,
        kind: share.kind,
        title: share.title,
        available: true,
        link,
        open_path: link ? link.path : `#shares/${row.share_id}`,
        clicks: row.clicks,
        stars: row.stars,
        registrations: row.registrations,
        last_at,
      });
      continue;
    }

    const kind = row.link_kind!;
    const target = row.target_key!;
    const resolved = resolveLinkTitle!({ kind, target_key: target });
    if (!resolved.available) {
      items.push({
        key: `${kind}:${target}`,
        kind,
        title: '已停止分享',
        available: false,
        link: null,
        open_path: null,
        clicks: 0,
        stars: 0,
        registrations: 0,
        last_at,
      });
      continue;
    }
    const path = `/go/${row.code}`;
    items.push({
      key: `${kind}:${target}`,
      kind,
      title: resolved.title,
      available: true,
      link: { kind, target, path },
      open_path: path,
      clicks: row.clicks,
      stars: 0,
      registrations: 0,
      last_at,
    });
  }

  return {
    items,
    next_offset: rows.length === 51 ? query.offset + 50 : null,
  };
}
