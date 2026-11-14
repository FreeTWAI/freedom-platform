-- Backfill published shares and initial endorsements for existing published posts, active services and published works.
-- Writes no share_credit_events rows; safe to run repeatedly.
WITH candidate AS (
  SELECT p.community_id,
         'post'::text AS kind,
         'post:' || p.post_id::text AS canonical_key,
         '/?social-post=' || p.post_id::text || '#social' AS canonical_url,
         'community_social_posts'::text AS ref_table,
         p.post_id AS ref_id,
         p.title,
         p.author_user_id AS first_sharer_user_id,
         p.created_at
    FROM community_social_posts p
   WHERE p.state = 'active'
  UNION ALL
  SELECT v.community_id,
         'service'::text AS kind,
         'service:' || v.service_id::text AS canonical_key,
         '/services/' || v.service_id::text AS canonical_url,
         'member_services'::text AS ref_table,
         v.service_id AS ref_id,
         v.title,
         v.owner_user_id AS first_sharer_user_id,
         v.created_at
    FROM member_services v
   WHERE v.state = 'active'
  UNION ALL
  SELECT w.community_id,
         'work'::text AS kind,
         'work:' || w.showcase_id::text AS canonical_key,
         '/#showcase/' || w.showcase_id::text AS canonical_url,
         'showcases'::text AS ref_table,
         w.showcase_id AS ref_id,
         left(w.title, 200) AS title,
         w.owner_ref AS first_sharer_user_id,
         w.created_at
    FROM showcases w
   WHERE w.status = 'published'
     AND w.visibility = 'community'
     AND length(w.title) >= 1
),
inserted AS (
  INSERT INTO shares (community_id, kind, canonical_key, canonical_url, ref_table, ref_id, title, first_sharer_user_id, state, created_at)
  SELECT c.community_id, c.kind, c.canonical_key, c.canonical_url, c.ref_table, c.ref_id, c.title, c.first_sharer_user_id, 'published', c.created_at
    FROM candidate c
   WHERE NOT EXISTS (
     SELECT 1 FROM shares s
      WHERE s.community_id = c.community_id
        AND s.kind = c.kind
        AND s.canonical_key = c.canonical_key
   )
  ON CONFLICT (community_id, kind, canonical_key) DO NOTHING
  RETURNING share_id, first_sharer_user_id, state
)
INSERT INTO share_endorsements (share_id, user_id)
SELECT i.share_id, i.first_sharer_user_id
  FROM inserted i
 WHERE i.state = 'published'
   AND i.first_sharer_user_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM share_endorsements e
      WHERE e.share_id = i.share_id
        AND e.user_id = i.first_sharer_user_id
   )
ON CONFLICT (share_id, user_id) WHERE withdrawn_at IS NULL DO NOTHING;
