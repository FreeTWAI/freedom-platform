-- #1213: private self-reported progress and optional feedback only.
-- Provisional 198: integration assigns the next number on main.
-- Medals derive from done/group_id; no scores, ranking, titles or consent projection.
-- Rollback: stop these routes, then DROP tester_map_feedback, tester_map_accounts.
-- Removing tables destroys private records; restore data only via the normal backup policy.
CREATE TABLE tester_map_accounts (
  user_id uuid PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  group_id text CHECK(group_id IN ('A','B','C','D','E')),
  done text[] NOT NULL DEFAULT '{}',
  aggregate_version bigint NOT NULL DEFAULT 1 CHECK(aggregate_version BETWEEN 1 AND 9007199254740991)
);
-- Private current feedback, opaque builder reference and triage state; no public identity.
-- A step's features are derived from the server allowlist, never caller-supplied.
CREATE TABLE tester_map_feedback (
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  feedback_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  status text NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','seen','issue','fixed')),
  issue_number integer NULL CHECK(issue_number>0),
  triaged_at timestamptz NULL,
  step_id text NOT NULL,
  result text NOT NULL CHECK(result IN ('pass','problem')),
  note text NOT NULL DEFAULT '' CHECK(char_length(note)<=200 AND note !~ '[[:cntrl:]<>]'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(user_id,step_id)
);
CREATE INDEX tester_map_feedback_recent ON tester_map_feedback(updated_at DESC);
