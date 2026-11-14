-- Credit qualified clicks on platform and member_card promotion links through shares.
-- Existing branches stay unchanged; creates the community platform share or owner card share when missing.
CREATE OR REPLACE FUNCTION share_promotion_credit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  s shares;
  actor uuid;
  l promotion_links;
  card_owner uuid;
  card_token text;
  owner_name text;
BEGIN
  SELECT * INTO l FROM promotion_links WHERE link_id=NEW.link_id;
  IF l.kind='share' AND l.target_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO s FROM shares WHERE share_id=l.target_key::uuid AND community_id=l.community_id AND state='published';
  ELSIF l.kind IN ('event','social_post','member_service') AND l.target_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO s FROM shares WHERE community_id=l.community_id
      AND kind=CASE l.kind WHEN 'event' THEN 'event' WHEN 'social_post' THEN 'post' ELSE 'service' END
      AND ref_id=l.target_key::uuid AND state='published' ORDER BY share_id LIMIT 1;
  ELSIF l.kind='skill_book' THEN
    WITH candidates AS MATERIALIZED (
      SELECT share_id FROM share_legacy_promotion_targets WHERE community_id=l.community_id AND target_key=l.target_key
    ) SELECT sh.* INTO s FROM candidates c JOIN shares sh ON sh.share_id=c.share_id
      WHERE sh.state='published' ORDER BY sh.share_id LIMIT 1;
  ELSIF l.kind='platform' THEN
    SELECT * INTO s FROM shares WHERE community_id=l.community_id AND kind='link' AND canonical_key='platform';
    IF s.share_id IS NULL THEN
      INSERT INTO shares(community_id,kind,canonical_key,canonical_url,title,first_sharer_user_id,state)
        VALUES(l.community_id,'link','platform','/','自由工坊',NULL,'published')
        ON CONFLICT (community_id,kind,canonical_key) DO NOTHING;
      SELECT * INTO s FROM shares WHERE community_id=l.community_id AND kind='link' AND canonical_key='platform';
    END IF;
  ELSIF l.kind='member_card' AND l.target_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:[0-9a-f]{16})?$' THEN
    card_owner := substring(l.target_key FROM 1 FOR 36)::uuid;
    SELECT * INTO s FROM shares WHERE community_id=l.community_id AND kind='link' AND canonical_key='member-card:'||card_owner::text;
    IF s.share_id IS NULL THEN
      SELECT mcs.share_token, u.display_name INTO card_token, owner_name
        FROM member_card_shares mcs
        JOIN users u ON u.user_id=mcs.user_id AND u.community_id=mcs.community_id
        WHERE mcs.user_id=card_owner AND mcs.community_id=l.community_id AND mcs.enabled AND u.active;
      IF FOUND AND length(owner_name) > 0 THEN
        INSERT INTO shares(community_id,kind,canonical_key,canonical_url,title,first_sharer_user_id,state)
          VALUES(l.community_id,'link','member-card:'||card_owner::text,'/member-cards/'||card_token,left(owner_name,200),card_owner,'published')
          ON CONFLICT (community_id,kind,canonical_key) DO NOTHING;
        SELECT * INTO s FROM shares WHERE community_id=l.community_id AND kind='link' AND canonical_key='member-card:'||card_owner::text;
      END IF;
    END IF;
  END IF;
  IF s.share_id IS NULL OR s.state IS DISTINCT FROM 'published' THEN RETURN NEW; END IF;
  IF NEW.visitor_key ~ '^m:[0-9a-f-]{36}$' THEN actor=substring(NEW.visitor_key FROM 3)::uuid; END IF;
  INSERT INTO share_credit_events(community_id,share_id,user_id,role,basis,units,source_ref,actor_user_id)
    VALUES(s.community_id,s.share_id,NEW.user_id,'spreader','qualified_click_day',1,'click:'||s.share_id||':'||NEW.user_id||':'||to_char(NEW.click_day,'YYYY-MM-DD'),actor) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
