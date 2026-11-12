-- One canonical object, many sharers. Existing records and public URLs are retained.
CREATE TABLE shares (
  share_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities,
  kind text NOT NULL CHECK (kind IN ('repository','link','event','work','post','service')),
  canonical_key text NOT NULL CHECK (length(canonical_key) BETWEEN 1 AND 200),
  canonical_url text NOT NULL CHECK (length(canonical_url) BETWEEN 1 AND 2048),
  repo_id uuid REFERENCES canonical_repositories,
  ref_table text CHECK (ref_table IN ('community_events','showcases','community_social_posts','member_services')),
  ref_id uuid,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  first_sharer_user_id uuid REFERENCES users,
  state text NOT NULL DEFAULT 'published' CHECK (state IN ('published','hidden','retracted')),
  guild_key text REFERENCES positioning_guild_catalog(guild_key),
  editor_notes jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(editor_notes)='object'),
  legacy_ref jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(legacy_ref)='array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id,kind,canonical_key), UNIQUE (share_id,community_id),
  CHECK ((ref_id IS NULL)=(ref_table IS NULL)),
  CHECK ((kind='repository' AND repo_id IS NOT NULL AND ref_id IS NULL AND ref_table IS NULL)
    OR (kind='link' AND repo_id IS NULL AND ref_id IS NULL AND ref_table IS NULL)
    OR (kind='event' AND repo_id IS NULL AND ref_id IS NOT NULL AND ref_table='community_events')
    OR (kind='work' AND repo_id IS NULL AND ref_id IS NOT NULL AND ref_table='showcases')
    OR (kind='post' AND repo_id IS NULL AND ref_id IS NOT NULL AND ref_table='community_social_posts')
    OR (kind='service' AND repo_id IS NULL AND ref_id IS NOT NULL AND ref_table='member_services'))
);
CREATE UNIQUE INDEX shares_repository ON shares(community_id,repo_id) WHERE repo_id IS NOT NULL;
CREATE INDEX shares_feed ON shares(community_id,created_at DESC,share_id) WHERE state='published';
CREATE INDEX shares_owner_day ON shares(first_sharer_user_id,created_at);

CREATE TABLE share_credit_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES communities,
  share_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users,
  role text NOT NULL CHECK (role IN ('sharer','co_sharer','original_author','organizer','spreader')),
  basis text NOT NULL CHECK (basis IN ('created','shared_again','claim_verified','qualified_click_day','star_confirmed','registration')),
  units smallint NOT NULL CHECK (units IN (-1,1)),
  source_ref text NOT NULL CHECK (length(source_ref) BETWEEN 1 AND 240),
  actor_user_id uuid REFERENCES users,
  reverses_event_id uuid UNIQUE REFERENCES share_credit_events(event_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (share_id,community_id) REFERENCES shares(share_id,community_id),
  CHECK ((units=1 AND reverses_event_id IS NULL) OR (units=-1 AND reverses_event_id IS NOT NULL)),
  CHECK ((basis='created' AND role='sharer') OR (basis='shared_again' AND role='co_sharer')
    OR (basis='claim_verified' AND role IN ('original_author','organizer'))
    OR (basis='qualified_click_day' AND role='spreader')
    OR (basis IN ('star_confirmed','registration') AND role IN ('sharer','spreader')))
);
-- Identity belongs to the fact, not to its recipient: one star/registration cannot credit two members.
CREATE UNIQUE INDEX share_credit_fact ON share_credit_events(community_id,basis,source_ref) WHERE units=1;
CREATE UNIQUE INDEX share_credit_sharer ON share_credit_events(share_id,user_id) WHERE basis IN ('created','shared_again') AND units=1;
CREATE INDEX share_credit_member ON share_credit_events(community_id,user_id,created_at DESC);
CREATE FUNCTION share_credit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s shares; prior share_credit_events;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'share credit is append-only'; END IF;
  SELECT * INTO s FROM shares WHERE share_id=NEW.share_id AND community_id=NEW.community_id FOR UPDATE;
  IF NEW.units=-1 THEN
    SELECT * INTO prior FROM share_credit_events WHERE event_id=NEW.reverses_event_id;
    IF prior.units IS DISTINCT FROM 1 OR ROW(NEW.share_id,NEW.community_id,NEW.user_id,NEW.role,NEW.basis,NEW.source_ref,NEW.actor_user_id)
      IS DISTINCT FROM ROW(prior.share_id,prior.community_id,prior.user_id,prior.role,prior.basis,prior.source_ref,prior.actor_user_id)
      THEN RAISE EXCEPTION 'invalid credit reversal'; END IF;
    RETURN NEW;
  END IF;
  IF s.state IS DISTINCT FROM 'published' THEN RETURN NULL; END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE user_id=NEW.user_id AND community_id=NEW.community_id AND active)
    OR is_verification_test_account(NEW.user_id) THEN RETURN NULL; END IF;
  IF NEW.actor_user_id IS NOT NULL AND (is_verification_test_account(NEW.actor_user_id)
    OR NOT EXISTS(SELECT 1 FROM users WHERE user_id=NEW.actor_user_id AND community_id=NEW.community_id AND active)) THEN RETURN NULL; END IF;
  IF NEW.basis IN ('star_confirmed','registration','qualified_click_day') AND NEW.actor_user_id=NEW.user_id THEN RETURN NULL; END IF;
  IF NEW.basis='star_confirmed' AND NEW.actor_user_id IS NULL THEN RAISE EXCEPTION 'star requires a confirmed member'; END IF;
  IF NEW.basis='created' AND NEW.user_id IS DISTINCT FROM s.first_sharer_user_id THEN RAISE EXCEPTION 'invalid first sharer'; END IF;
  IF NEW.basis='shared_again' AND NEW.user_id=s.first_sharer_user_id THEN RETURN NULL; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER share_credit_append_only BEFORE INSERT OR UPDATE OR DELETE ON share_credit_events FOR EACH ROW EXECUTE FUNCTION share_credit_guard();
CREATE FUNCTION shares_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'shares are retained'; END IF;
  IF ROW(NEW.share_id,NEW.community_id,NEW.kind,NEW.canonical_key,NEW.repo_id,NEW.ref_table,NEW.ref_id,NEW.first_sharer_user_id,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.share_id,OLD.community_id,OLD.kind,OLD.canonical_key,OLD.repo_id,OLD.ref_table,OLD.ref_id,OLD.first_sharer_user_id,OLD.created_at)
    THEN RAISE EXCEPTION 'share identity is immutable'; END IF;
  IF NEW.state<>OLD.state AND NEW.state<>'published' THEN
    INSERT INTO share_credit_events(community_id,share_id,user_id,role,basis,units,source_ref,actor_user_id,reverses_event_id)
      SELECT community_id,share_id,user_id,role,basis,-1,source_ref,actor_user_id,event_id
      FROM share_credit_events WHERE share_id=OLD.share_id AND units=1 ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER shares_retained BEFORE UPDATE OR DELETE ON shares FOR EACH ROW EXECUTE FUNCTION shares_guard();
CREATE TABLE share_reports (
  share_id uuid NOT NULL REFERENCES shares,
  user_id uuid NOT NULL REFERENCES users,
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(share_id,user_id)
);

ALTER TABLE canonical_repositories
  ADD COLUMN description text,
  ADD COLUMN topics text[] NOT NULL DEFAULT '{}',
  ADD COLUMN homepage text,
  ADD COLUMN license_spdx text,
  ADD COLUMN readme_html text,
  ADD COLUMN readme_sha text,
  ADD COLUMN latest_release jsonb,
  ADD COLUMN etag text,
  ADD COLUMN fetched_at timestamptz,
  ADD COLUMN fetch_state text NOT NULL DEFAULT 'pending' CHECK (fetch_state IN ('pending','ready','unavailable','error')),
  ADD COLUMN facts jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN refresh_after timestamptz NOT NULL DEFAULT now();
ALTER TABLE skill_star_support ADD COLUMN via_share_id uuid REFERENCES shares, ADD COLUMN via_user_id uuid REFERENCES users;
ALTER TABLE guild_skill_book_bindings ADD COLUMN share_id uuid REFERENCES shares;
ALTER TABLE member_skill_book_grants ADD COLUMN share_id uuid REFERENCES shares;
ALTER TABLE oss_projects ADD COLUMN share_id uuid REFERENCES shares;
ALTER TABLE skill_submissions ADD COLUMN share_id uuid REFERENCES shares;
ALTER TABLE promotion_links DROP CONSTRAINT promotion_links_kind_check;
ALTER TABLE promotion_links ADD CONSTRAINT promotion_links_kind_check CHECK (kind IN ('member_card','platform','skill_book','social_post','member_service','event','share'));
ALTER TABLE promotion_clicks DROP CONSTRAINT promotion_clicks_kind_check;
ALTER TABLE promotion_clicks ADD CONSTRAINT promotion_clicks_kind_check CHECK (kind IN ('member_card','platform','skill_book','social_post','member_service','event','share'));

-- Only the existing bot/self/budget-filtered promotion writer supplies clicks.
-- One qualified link-day, not a claim of unique humans or raw page views.
CREATE FUNCTION share_promotion_credit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s shares; actor uuid;
BEGIN
  IF NEW.kind<>'share' THEN RETURN NEW; END IF;
  SELECT s0.* INTO s FROM shares s0 JOIN promotion_links l ON l.target_key=s0.share_id::text AND l.community_id=s0.community_id WHERE l.link_id=NEW.link_id;
  IF s.share_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.visitor_key ~ '^m:[0-9a-f-]{36}$' THEN actor=substring(NEW.visitor_key FROM 3)::uuid; END IF;
  INSERT INTO share_credit_events(community_id,share_id,user_id,role,basis,units,source_ref,actor_user_id)
    VALUES(s.community_id,s.share_id,NEW.user_id,'spreader','qualified_click_day',1,'click:'||NEW.link_id||':'||NEW.click_day,actor) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER promotion_share_credit AFTER INSERT ON promotion_clicks FOR EACH ROW EXECUTE FUNCTION share_promotion_credit();

-- Existing author-claim moderation also reconciles the new ledger.
CREATE FUNCTION share_claim_credit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state='verified' AND NEW.role IN ('original_author','co_original_author') THEN
    INSERT INTO share_credit_events(community_id,share_id,user_id,role,basis,units,source_ref)
      SELECT NEW.community_id,s.share_id,NEW.user_id,'original_author','claim_verified',1,'claim:'||NEW.claim_id
      FROM shares s WHERE s.repo_id=NEW.repo_id AND s.community_id=NEW.community_id AND s.state='published'
      ON CONFLICT DO NOTHING;
  ELSIF NEW.state IN ('disputed','revoked','withdrawn','rejected') THEN
    INSERT INTO share_credit_events(community_id,share_id,user_id,role,basis,units,source_ref,actor_user_id,reverses_event_id)
      SELECT community_id,share_id,user_id,role,basis,-1,source_ref,actor_user_id,event_id FROM share_credit_events
      WHERE basis='claim_verified' AND source_ref='claim:'||NEW.claim_id AND units=1 ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER repo_claim_share_credit AFTER INSERT OR UPDATE OF state ON repo_credit_claims FOR EACH ROW EXECUTE FUNCTION share_claim_credit();
