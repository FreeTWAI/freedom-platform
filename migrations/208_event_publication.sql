-- Existing rows retain their audience and review state. Publication/backfill is explicit.
ALTER TABLE community_events
  ADD COLUMN source_url text,
  ADD COLUMN source_host text,
  ADD COLUMN imported boolean NOT NULL DEFAULT false,
  ADD COLUMN registration_mode text NOT NULL DEFAULT 'platform',
  ADD COLUMN external_registration_url text,
  ADD COLUMN source_organizer text,
  ADD COLUMN source_cover_url text;
ALTER TABLE community_events ADD CONSTRAINT community_events_source_url_check CHECK(length(source_url)<=2048) NOT VALID;
ALTER TABLE community_events ADD CONSTRAINT community_events_source_host_check CHECK(length(source_host)<=253) NOT VALID;
ALTER TABLE community_events ADD CONSTRAINT community_events_registration_mode_check CHECK(registration_mode IN ('platform','external')) NOT VALID;
ALTER TABLE community_events ADD CONSTRAINT community_events_external_registration_url_check CHECK(length(external_registration_url)<=2048) NOT VALID;
ALTER TABLE community_events ADD CONSTRAINT community_events_source_organizer_check CHECK(length(source_organizer)<=160) NOT VALID;
ALTER TABLE community_events ADD CONSTRAINT community_events_source_cover_url_check CHECK(length(source_cover_url)<=2048) NOT VALID;
-- source_url is newly added and therefore NULL for all old events. Index only
-- the new keys, maintained by writers on either Worker version, without a live-table build.
CREATE TABLE community_event_source_keys (
  event_id uuid PRIMARY KEY REFERENCES community_events(event_id) ON DELETE CASCADE,
  community_id uuid NOT NULL REFERENCES communities,
  source_url text NOT NULL
);
CREATE INDEX community_event_source_keys_lookup ON community_event_source_keys(community_id,md5(source_url));
CREATE FUNCTION maintain_community_event_source_key() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source_url IS NULL THEN
    DELETE FROM community_event_source_keys WHERE event_id=NEW.event_id;
  ELSE
    INSERT INTO community_event_source_keys(event_id,community_id,source_url)
      VALUES(NEW.event_id,NEW.community_id,NEW.source_url)
      ON CONFLICT(event_id) DO UPDATE SET community_id=EXCLUDED.community_id,source_url=EXCLUDED.source_url;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER community_event_source_key AFTER INSERT OR UPDATE OF source_url,community_id ON community_events
  FOR EACH ROW EXECUTE FUNCTION maintain_community_event_source_key();
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
