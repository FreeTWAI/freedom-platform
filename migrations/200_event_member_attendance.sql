-- Organizer-recorded member attendance only. RSVP is not attendance, completion
-- or an award. No historical registration is backfilled as attendance.
ALTER TABLE community_event_rsvps ADD CONSTRAINT event_rsvp_identity
  UNIQUE(rsvp_id,event_id,user_id);

CREATE TABLE community_event_attendance (
  attendance_id uuid PRIMARY KEY,
  community_id uuid NOT NULL,
  event_id uuid NOT NULL,
  member_ref uuid NOT NULL,
  rsvp_id uuid NOT NULL,
  state text NOT NULL CHECK(state IN ('confirmed','retracted')),
  aggregate_version bigint NOT NULL DEFAULT 2 CHECK(aggregate_version BETWEEN 2 AND 9007199254740991),
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  retraction_reason text CHECK(retraction_reason IN ('marked_wrong_member','not_confirmed')),
  CHECK((state='confirmed' AND retraction_reason IS NULL) OR (state='retracted' AND retraction_reason IS NOT NULL)),
  UNIQUE(event_id,member_ref),
  CONSTRAINT attendance_event_community FOREIGN KEY(event_id,community_id)
    REFERENCES community_events(event_id,community_id) ON DELETE CASCADE,
  CONSTRAINT attendance_member_community FOREIGN KEY(member_ref,community_id)
    REFERENCES users(user_id,community_id) ON DELETE CASCADE,
  CONSTRAINT attendance_rsvp_identity FOREIGN KEY(rsvp_id,event_id,member_ref)
    REFERENCES community_event_rsvps(rsvp_id,event_id,user_id) ON DELETE CASCADE,
  CONSTRAINT attendance_recorder_community FOREIGN KEY(recorded_by,community_id)
    REFERENCES users(user_id,community_id),
  CONSTRAINT attendance_editor_community FOREIGN KEY(updated_by,community_id)
    REFERENCES users(user_id,community_id)
);
CREATE INDEX community_event_attendance_page ON community_event_attendance(event_id,member_ref);

-- Corrections change state/version, never the person/event to which the fact
-- belongs. This UPDATE-only guard does not obstruct existing parent cleanup.
CREATE FUNCTION protect_event_attendance_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.attendance_id,NEW.community_id,NEW.event_id,NEW.member_ref,NEW.rsvp_id)
    IS DISTINCT FROM ROW(OLD.attendance_id,OLD.community_id,OLD.event_id,OLD.member_ref,OLD.rsvp_id) THEN
    RAISE EXCEPTION 'event attendance identity is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER event_attendance_identity_immutable BEFORE UPDATE ON community_event_attendance
  FOR EACH ROW EXECUTE FUNCTION protect_event_attendance_identity();
