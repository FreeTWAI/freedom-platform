-- Existing rows retain their audience and review state. Publication/backfill is explicit.
ALTER TABLE community_events
  ADD COLUMN source_url text CHECK(length(source_url)<=2048),
  ADD COLUMN source_host text CHECK(length(source_host)<=253),
  ADD COLUMN imported boolean NOT NULL DEFAULT false,
  ADD COLUMN registration_mode text NOT NULL DEFAULT 'platform' CHECK(registration_mode IN ('platform','external')),
  ADD COLUMN external_registration_url text CHECK(length(external_registration_url)<=2048),
  ADD COLUMN source_organizer text CHECK(length(source_organizer)<=160),
  ADD COLUMN source_cover_url text CHECK(length(source_cover_url)<=2048);
CREATE INDEX community_events_source ON community_events(community_id,source_url) WHERE source_url IS NOT NULL;
CREATE INDEX community_events_duplicate ON community_events(community_id,lower(title),starts_at,lower(location));
-- Share moderation owns the threshold. Return the event to the retained human queue.
CREATE FUNCTION moderate_shared_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind='event' AND NEW.state='hidden' AND OLD.state='published' THEN
    UPDATE community_events SET state='pending',
      aggregate_version=aggregate_version+1,updated_at=now()
      WHERE event_id=NEW.ref_id AND community_id=NEW.community_id AND state='published';
  ELSIF NEW.kind='event' AND OLD.state='hidden' AND NEW.state IN ('published','retracted') THEN
    UPDATE community_events SET state='published',aggregate_version=aggregate_version+1,updated_at=now()
      WHERE event_id=NEW.ref_id AND community_id=NEW.community_id AND state='pending';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER moderate_shared_event AFTER UPDATE OF state ON shares FOR EACH ROW EXECUTE FUNCTION moderate_shared_event();

CREATE FUNCTION event_promotion_credit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s shares; actor uuid;
BEGIN
 IF NEW.kind<>'event' THEN RETURN NEW; END IF;
 SELECT s0.* INTO s FROM shares s0 JOIN promotion_links l ON s0.ref_id::text=l.target_key AND s0.community_id=l.community_id WHERE s0.kind='event' AND l.link_id=NEW.link_id;
 IF s.share_id IS NULL THEN RETURN NEW; END IF;
 IF NEW.visitor_key ~ '^m:[0-9a-f-]{36}$' THEN actor=substring(NEW.visitor_key FROM 3)::uuid; END IF;
 INSERT INTO share_credit_events(community_id,share_id,user_id,role,basis,units,source_ref,actor_user_id)
 VALUES(s.community_id,s.share_id,NEW.user_id,'spreader','qualified_click_day',1,'click:'||NEW.link_id||':'||NEW.click_day,actor) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER event_promotion_credit AFTER INSERT ON promotion_clicks FOR EACH ROW EXECUTE FUNCTION event_promotion_credit();

CREATE TABLE community_event_interests (
 event_id uuid NOT NULL REFERENCES community_events,
 interest_key text NOT NULL CHECK(length(interest_key) BETWEEN 38 AND 50),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(event_id,interest_key)
);
CREATE TABLE community_event_organizer_claims (
 claim_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL REFERENCES community_events,
 community_id uuid NOT NULL REFERENCES communities,user_id uuid NOT NULL REFERENCES users,
 statement text NOT NULL CHECK(length(statement) BETWEEN 10 AND 1000),evidence_url text NOT NULL CHECK(length(evidence_url)<=2048),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','verified','rejected','revoked')),
 version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(event_id,user_id)
);
-- Stable member identity supplements the ledger's email fingerprint. This contains no email,
-- counts, or credit; it prevents the same person gaining another credit after an email change.
CREATE TABLE community_event_registration_credit_people (
 event_id uuid NOT NULL REFERENCES community_events,
 user_id uuid NOT NULL REFERENCES users,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(event_id,user_id)
);
