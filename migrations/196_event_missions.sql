-- Private self-reported exercises. Not attendance, Work, Contribution or XP.
-- A cleared row retains only identity/version to prevent stale-command ABA;
-- no task text, peer identity, location or contact information is collected.
CREATE TABLE event_mission_progress (
  progress_id uuid PRIMARY KEY,
  community_id uuid NOT NULL REFERENCES communities,
  event_id uuid NOT NULL REFERENCES community_events ON DELETE CASCADE,
  member_ref uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  policy_version text NOT NULL CHECK(policy_version='personal_self_exercises_v1'),
  slots jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(slots)='array'),
  aggregate_version bigint NOT NULL CHECK(aggregate_version BETWEEN 2 AND 9007199254740991),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((enabled AND jsonb_array_length(slots)=3) OR (NOT enabled AND slots='[]'::jsonb)),
  UNIQUE(event_id,member_ref)
);
