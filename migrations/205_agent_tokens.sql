-- Member-approved automation credentials; old read connections retain their constraints.
ALTER TABLE member_client_connections DROP CONSTRAINT member_client_connections_kind_check;
ALTER TABLE member_client_connections DROP CONSTRAINT member_client_connections_scope_check;
ALTER TABLE member_client_connections DROP CONSTRAINT member_client_connections_check;
ALTER TABLE member_client_connections ADD COLUMN scopes text[] NOT NULL DEFAULT '{}',
 ADD COLUMN last_used_at timestamptz, ADD COLUMN suspended_at timestamptz,
 ADD COLUMN failure_count integer NOT NULL DEFAULT 0 CHECK(failure_count>=0),
 ADD COLUMN public_confirmed_at timestamptz,
 ADD COLUMN public_daily_cap integer NOT NULL DEFAULT 20 CHECK(public_daily_cap BETWEEN 0 AND 20),
 ADD COLUMN reaction_daily_cap integer NOT NULL DEFAULT 100 CHECK(reaction_daily_cap BETWEEN 0 AND 100);
ALTER TABLE member_client_connections ADD CHECK (
 (kind='storefront' AND scope='storefront:read' AND store_id IS NOT NULL AND scopes='{}') OR
 (kind='supplier' AND scope='supplier:read' AND store_id IS NULL AND scopes='{}') OR
 (kind='agent' AND scope='agent' AND store_id IS NULL AND token_hash IS NOT NULL
  AND cardinality(scopes)>0 AND scopes <@ ARRAY['read','share','rsvp','react','message']::text[]));
CREATE TABLE agent_pending_publications (
 connection_id uuid PRIMARY KEY REFERENCES member_client_connections,
 operation text NOT NULL, idempotency_key text NOT NULL, request_sha256 text NOT NULL,
 body jsonb NOT NULL, approved_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE agent_daily_usage (
 connection_id uuid NOT NULL REFERENCES member_client_connections, day date NOT NULL,
 public_items integer NOT NULL DEFAULT 0, reactions integer NOT NULL DEFAULT 0,
 PRIMARY KEY(connection_id,day)
);
CREATE TABLE agent_publications (
 connection_id uuid NOT NULL REFERENCES member_client_connections,
 user_id uuid NOT NULL REFERENCES users, operation text NOT NULL, idempotency_key text NOT NULL,
 resource_id text, via_agent boolean NOT NULL DEFAULT true CHECK(via_agent),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(connection_id,operation,idempotency_key)
);
ALTER TABLE community_events ADD COLUMN via_agent boolean NOT NULL DEFAULT false;
ALTER TABLE oss_projects ADD COLUMN via_agent boolean NOT NULL DEFAULT false;

-- Domain transactions append facts without taking a per-recipient sequence lock.
-- The reader assigns cursors to committed facts under one recipient lock. A slow
-- producer can commit later without falling behind a previously issued cursor.
CREATE TABLE agent_change_events (
 event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), community_id uuid NOT NULL REFERENCES communities,
 user_id uuid NOT NULL REFERENCES users, kind text NOT NULL CHECK(kind IN
 ('event.updated','event.approved','rsvp.confirmed','rsvp.waitlist_promoted','message.received','share.credited')),
 source_key text NOT NULL, resource_id text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 cursor bigint, UNIQUE(user_id,source_key), UNIQUE(user_id,cursor)
);
CREATE INDEX agent_change_unassigned ON agent_change_events(user_id,created_at,event_id) WHERE cursor IS NULL;
CREATE TABLE agent_change_cursors (user_id uuid PRIMARY KEY REFERENCES users,last_cursor bigint NOT NULL DEFAULT 0);
CREATE FUNCTION record_agent_change(p_community uuid,p_user uuid,p_kind text,p_source text,p_resource text)
 RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM users WHERE user_id=p_user AND community_id=p_community) THEN
  RAISE EXCEPTION 'agent_change_recipient_invalid';
 END IF;
 INSERT INTO agent_change_events(community_id,user_id,kind,source_key,resource_id)
 VALUES(p_community,p_user,p_kind,p_source,p_resource) ON CONFLICT(user_id,source_key) DO NOTHING;
END $$;
CREATE FUNCTION capture_agent_notification() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_kind text;
BEGIN
 event_kind:=CASE NEW.kind WHEN 'event_approved' THEN 'event.approved'
  WHEN 'event_schedule_changed' THEN 'event.updated' WHEN 'event_cancelled' THEN 'event.updated'
  WHEN 'event_waitlist_invited' THEN 'rsvp.waitlist_promoted' END;
 IF event_kind IS NOT NULL THEN
  PERFORM record_agent_change(NEW.community_id,NEW.recipient_ref,event_kind,'notification/'||NEW.notification_id,NEW.action_resource_id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agent_notification_change AFTER INSERT ON member_notifications FOR EACH ROW EXECUTE FUNCTION capture_agent_notification();
CREATE FUNCTION capture_agent_rsvp() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE community uuid;
BEGIN
 IF NEW.state='going' AND (TG_OP='INSERT' OR OLD.state IS DISTINCT FROM NEW.state) THEN
  SELECT community_id INTO community FROM community_events WHERE event_id=NEW.event_id;
  PERFORM record_agent_change(community,NEW.user_id,'rsvp.confirmed','rsvp/'||NEW.rsvp_id||'/'||NEW.aggregate_version,NEW.event_id::text);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agent_rsvp_change AFTER INSERT OR UPDATE ON community_event_rsvps FOR EACH ROW EXECUTE FUNCTION capture_agent_rsvp();
CREATE FUNCTION capture_agent_message() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- Legacy storage permits malformed cross-community rows; never project them
 -- into a recipient feed or change the legacy writer's behavior.
 IF EXISTS(SELECT 1 FROM users sender JOIN users recipient ON recipient.community_id=sender.community_id
  WHERE sender.user_id=NEW.sender_ref AND recipient.user_id=NEW.recipient_ref AND sender.community_id=NEW.community_id) THEN
  PERFORM record_agent_change(NEW.community_id,NEW.recipient_ref,'message.received','message/'||NEW.message_id,NEW.sender_ref::text);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agent_message_change AFTER INSERT ON member_direct_messages FOR EACH ROW EXECUTE FUNCTION capture_agent_message();
CREATE FUNCTION capture_agent_event_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.title,NEW.description,NEW.starts_at,NEW.ends_at,NEW.mode,NEW.location,NEW.online_url,NEW.visibility,NEW.capacity)
  IS DISTINCT FROM ROW(OLD.title,OLD.description,OLD.starts_at,OLD.ends_at,OLD.mode,OLD.location,OLD.online_url,OLD.visibility,OLD.capacity) THEN
  PERFORM record_agent_change(NEW.community_id,NEW.organizer_ref,'event.updated',
   'event/'||NEW.event_id||'/'||NEW.aggregate_version,NEW.event_id::text);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agent_event_update AFTER UPDATE ON community_events FOR EACH ROW EXECUTE FUNCTION capture_agent_event_update();
