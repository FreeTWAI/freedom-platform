import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { Actor } from '../identity-membership/service.js';
import { mineTitles, type PromotionKind } from '../community/promotion.js';
import { promotionPublicSocialJoins,promotionPublicSocialVisible } from '../community/public-social-posts.js';
import { publishedWorkFrom,publishedWorkPayload } from '../skill-submissions/public.js';
import { existingReadableSql,feedShareSql,hiddenEventReadableSql } from './adapters/existing.js';
import { PUBLIC_WORK_VISIBLE } from '../opportunity-project-work/public-sharing.js';
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
  share_kind: ShareKind | null;
  share_title: string | null;
  share_readable: boolean | null;
  target_title: string | null;
  target_available: boolean | null;
};

// CONF-4: a work share's results follow the same public-sharing rule as `/go/<code>`;
// the derived row keeps the outer share alias out of the inner `s` (showcases) scope.
const publicWorkReadableSql=(share:string)=>`(SELECT EXISTS(SELECT 1 FROM work_public_publications publication
  JOIN showcases s USING (showcase_id) JOIN users u ON u.user_id=s.owner_ref
  WHERE publication.showcase_id=work_ref.ref_id AND publication.community_id=work_ref.community_id AND ${PUBLIC_WORK_VISIBLE})
  FROM (SELECT ${share}.ref_id, ${share}.community_id) work_ref)`;
// Zod's UUID acceptance also includes the all-zero and all-ones UUIDs.
const UUID = `(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)`;
const SHARE_RESULTS_SQL = `WITH links AS (
  SELECT l.link_id, l.kind, l.target_key, l.code, l.created_at,
         count(c.link_id)::int AS clicks, max(c.created_at) AS last_click
  FROM promotion_links l LEFT JOIN promotion_clicks c ON c.link_id = l.link_id
  WHERE l.community_id = $1 AND l.user_id = $2 AND l.revoked_at IS NULL
  GROUP BY l.link_id
), resolved AS (
  -- A link joins the share its clicks credit (share_promotion_credit, migration 212), so the share and its
  -- links are one row: a share link joins its share; an event, post or service link joins the share of that
  -- original; a skill book link joins the repository share that carries the book. A link whose original was
  -- never shared keeps its own row. So do platform and member-card links: their shares only anchor click
  -- credit (see credit below). Shares match in any state, so a stopped share keeps its links in its row;
  -- a skill book link matches only a published share (share_legacy_promotion_targets), as click credit does.
  SELECT links.*, coalesce(share_target.share_id,original_target.share_id,book_target.share_id) AS share_id
  FROM links
  LEFT JOIN shares share_target ON links.kind='share' AND share_target.community_id=$1
    AND share_target.share_id=CASE WHEN links.target_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN links.target_key::uuid END
  LEFT JOIN LATERAL (SELECT s.share_id FROM shares s
    WHERE links.kind IN ('event','social_post','member_service') AND s.community_id=$1
      AND s.kind=CASE links.kind WHEN 'event' THEN 'event' WHEN 'social_post' THEN 'post' ELSE 'service' END
      AND s.ref_id=CASE WHEN links.target_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN links.target_key::uuid END
    ORDER BY s.share_id LIMIT 1) original_target ON true
  LEFT JOIN LATERAL (SELECT t.share_id FROM share_legacy_promotion_targets t
    WHERE links.kind='skill_book' AND t.community_id=$1 AND t.target_key=links.target_key
    ORDER BY t.share_id LIMIT 1) book_target ON true
), link_rows AS (
  SELECT share_id, kind, target_key, code, created_at, clicks, last_click FROM resolved WHERE share_id IS NULL
  UNION ALL
  -- Several links can credit one share (a repository's share link and its skill book links). The row counts
  -- the clicks of all of them and offers the share's own link, else the newest one.
  (SELECT DISTINCT ON (share_id) share_id, kind, target_key, code, max(created_at) OVER per_share,
          (sum(clicks) OVER per_share)::int, max(last_click) OVER per_share
   FROM resolved WHERE share_id IS NOT NULL
   WINDOW per_share AS (PARTITION BY share_id)
   ORDER BY share_id, kind<>'share', created_at DESC, link_id)
), credit AS (
  SELECT e.share_id,
         coalesce(sum(e.units) FILTER (WHERE e.basis = 'star_confirmed'), 0)::int AS stars,
         coalesce(sum(e.units) FILTER (WHERE e.basis = 'registration'), 0)::int AS registrations,
         max(e.created_at) AS last_credit
  FROM share_credit_events e
  WHERE e.community_id = $1 AND e.user_id = $2
  GROUP BY e.share_id
  HAVING sum(e.units) > 0
    -- Platform and member-card shares only anchor click credit; they are not feed items (feedShareSql). The
    -- member's own links already show those clicks, one row per link, so an anchor adds no row.
    AND EXISTS(SELECT 1 FROM shares credited WHERE credited.share_id = e.share_id AND credited.community_id = $1 AND ${feedShareSql('credited')})
), page AS (
 SELECT coalesce(lr.share_id, cr.share_id)::text AS share_id, lr.kind AS link_kind, lr.target_key, lr.code,
       coalesce(lr.clicks, 0)::int AS clicks, coalesce(cr.stars, 0)::int AS stars,
       coalesce(cr.registrations, 0)::int AS registrations,
       greatest(lr.created_at, lr.last_click, cr.last_credit) AS last_at
 FROM link_rows lr FULL OUTER JOIN credit cr ON cr.share_id = lr.share_id
 ORDER BY last_at DESC NULLS LAST, coalesce(lr.share_id::text, cr.share_id::text, lr.kind || ':' || lr.target_key)
 LIMIT 51 OFFSET $3
), public_community AS (
 SELECT CASE WHEN $4::uuid IS NOT NULL THEN $4::uuid WHEN count(*)=1 THEN min(id)::uuid END AS id
 FROM (SELECT community_id::text AS id FROM communities ORDER BY community_id LIMIT 2) communities
)
SELECT page.*,s.kind AS share_kind,s.title AS share_title,
 CASE WHEN s.state='published' AND s.kind='work' THEN ${publicWorkReadableSql('s')}
   WHEN s.state='published' THEN ${existingReadableSql('s','$2')} ELSE ${hiddenEventReadableSql('s','$2')} END AS share_readable,
 CASE page.link_kind
  WHEN 'event' THEN event.title
  WHEN 'social_post' THEN CASE WHEN post.kind='link' THEN post.title ELSE coalesce(nullif(post.title,''),'自由工坊貼文') END
  WHEN 'member_service' THEN service.title
  WHEN 'skill_book' THEN book.title
  WHEN 'member_card' THEN card_user.display_name||' 的自由工坊名片'
 END AS target_title,
 CASE page.link_kind
  WHEN 'event' THEN event.state='published'
  WHEN 'social_post' THEN post.state='active' AND (post.kind='link' OR EXISTS(
   SELECT 1 ${promotionPublicSocialJoins} WHERE p.post_id=post.post_id
    AND p.community_id=(SELECT id FROM public_community) AND ${promotionPublicSocialVisible}))
  WHEN 'member_service' THEN service.state='active' AND service_user.active AND NOT is_verification_test_account(service_user.user_id)
  WHEN 'skill_book' THEN book.title IS NOT NULL AND book.title<>''
  WHEN 'member_card' THEN card.enabled AND card_user.active
   AND (NOT card_user.onboarding_required OR card_user.onboarding_completed_at IS NOT NULL)
   AND NOT is_verification_test_account(card_user.user_id)
   AND lower(page.target_key)=lower($2::text)||':'||substr(encode(sha256(convert_to(card.share_token,'UTF8')),'hex'),1,16)
  ELSE false END AS target_available
FROM page
LEFT JOIN shares s ON s.community_id=$1 AND s.share_id=page.share_id::uuid
LEFT JOIN community_events event ON page.share_id IS NULL AND page.link_kind='event' AND event.community_id=$1
 AND event.event_id=CASE WHEN page.target_key ~* '^${UUID}$' THEN page.target_key::uuid END
-- Posts, services and skill submissions are read for share rows too: the link's own rule decides whether it is offered.
LEFT JOIN community_social_posts post ON page.link_kind='social_post' AND post.community_id=$1
 AND post.post_id=CASE WHEN page.target_key ~* '^${UUID}$' THEN page.target_key::uuid END
LEFT JOIN member_services service ON page.link_kind='member_service' AND service.community_id=$1
 AND service.service_id=CASE WHEN page.target_key ~* '^${UUID}$' THEN page.target_key::uuid END
LEFT JOIN users service_user ON service_user.user_id=service.owner_user_id
LEFT JOIN LATERAL (SELECT (${publishedWorkPayload})->>'title' AS title ${publishedWorkFrom}
 AND s.community_id=$1 AND s.submission_id=CASE WHEN page.link_kind='skill_book'
  AND page.target_key ~* '^submission:${UUID}$' THEN substring(page.target_key FROM 12)::uuid END) book ON true
LEFT JOIN member_card_shares card ON page.share_id IS NULL AND page.link_kind='member_card' AND card.community_id=$1 AND card.user_id=$2
LEFT JOIN users card_user ON card_user.user_id=card.user_id AND card_user.community_id=card.community_id
ORDER BY page.last_at DESC NULLS LAST,coalesce(page.share_id,page.link_kind||':'||page.target_key)`;

export async function myShareResults(
  q: PoolClient,
  actor: Actor,
  raw: unknown = {},
  publicCommunity?: string | null,
): Promise<{ items: ShareResult[]; next_offset: number | null }> {
  const query = z.object({ offset: z.coerce.number().int().min(0).max(10000).default(0) }).strict().parse(raw);
  const configuredCommunity=publicCommunity&&z.uuid().safeParse(publicCommunity).success?publicCommunity:null;
  const rows = (await q.query(SHARE_RESULTS_SQL, [actor.community_id, actor.user_id, query.offset,configuredCommunity])).rows as SqlResultRow[];
  const pageRows = rows.slice(0, 50);
  // Catalog/platform labels are in memory; all database-backed labels and
  // current visibility were read with the results in the query above.
  const isStatic = (r: SqlResultRow): r is SqlResultRow & { link_kind: PromotionKind; target_key: string } => Boolean(r.target_key)
    && (r.link_kind==='platform'||r.link_kind==='skill_book'&&r.target_key!.startsWith('book:'));
  const staticTargets = pageRows.filter(isStatic).map(r => ({ kind: r.link_kind, target_key: r.target_key }));
  const resolveStaticTitle = staticTargets.length
    ? await mineTitles(q, actor, staticTargets, publicCommunity)
    : null;
  // A link's own title and state, by the rule `/go` applies to it.
  const linkTarget = (r: SqlResultRow) => isStatic(r)
    ? resolveStaticTitle!({ kind: r.link_kind, target_key: r.target_key })
    : { title: r.target_title ?? '已無法開啟', available: r.target_available ?? false };

  const items: ShareResult[] = [];
  for (const row of pageRows) {
    const last_at = new Date(row.last_at).toISOString();
    if (row.share_id) {
      const kind: ShareResultKind = row.share_kind ?? row.link_kind ?? 'link';
      const available = row.share_readable ?? false;
      if (!available || !row.share_kind) {
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
      // The share decides the row. Its link is offered only while the link opens by its own rule, the one `/go`
      // applies: a post that is no longer public, a paused service or a withdrawn skill offers none, so a share
      // that members can still read may have no link. A share link and an event link open with their share.
      const linkOpen = row.link_kind === 'share' || row.link_kind === 'event' || linkTarget(row).available;
      const link = linkOpen && row.link_kind && row.target_key && row.code
        ? { kind: row.link_kind, target: row.target_key, path: `/go/${row.code}` }
        : null;
      items.push({
        key: `share:${row.share_id}`,
        kind: row.share_kind,
        title: row.share_title!,
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
    const resolved = linkTarget(row);
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
