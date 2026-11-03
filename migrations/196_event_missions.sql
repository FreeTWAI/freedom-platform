-- Private self-reported exercises. Not attendance, Work, Contribution or XP.
-- A cleared row retains only identity/version to prevent stale-command ABA;
-- no task text, peer identity, location or contact information is collected.
CREATE TABLE event_mission_progress (
  progress_id uuid PRIMARY KEY,
  community_id uuid NOT NULL REFERENCES communities,
  event_id uuid NOT NULL,
  member_ref uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  policy_version text NOT NULL CHECK(policy_version='personal_self_exercises_v1'),
  slots jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(slots)='array'),
  aggregate_version bigint NOT NULL CHECK(aggregate_version BETWEEN 2 AND 9007199254740991),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((enabled AND jsonb_array_length(slots)=3) OR (NOT enabled AND slots='[]'::jsonb)),
  CONSTRAINT event_mission_event_community_fk
    FOREIGN KEY(event_id,community_id) REFERENCES community_events(event_id,community_id) ON DELETE CASCADE,
  CONSTRAINT event_mission_member_community_fk
    FOREIGN KEY(member_ref,community_id) REFERENCES users(user_id,community_id) ON DELETE CASCADE,
  UNIQUE(event_id,member_ref)
);
