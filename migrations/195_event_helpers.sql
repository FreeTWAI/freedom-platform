-- Provisional local candidate number; integration must reconcile the current catalog.
-- Help is independent of attendance, capacity, contact sharing and public cards.
ALTER TABLE community_events ADD COLUMN help_need text
  CHECK (help_need IS NULL OR (length(btrim(help_need)) BETWEEN 1 AND 500 AND length(help_need)<=500));
CREATE TABLE community_event_helpers (
  helper_id uuid PRIMARY KEY,
  event_id uuid NOT NULL,
  member_ref uuid NOT NULL,
  community_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('applied','accepted','declined','withdrawn')),
  aggregate_version bigint NOT NULL DEFAULT 2 CHECK (aggregate_version BETWEEN 2 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id,member_ref),
  CONSTRAINT helper_event_community FOREIGN KEY(event_id,community_id)
    REFERENCES community_events(event_id,community_id) ON DELETE CASCADE,
  CONSTRAINT helper_member_community FOREIGN KEY(member_ref,community_id)
    REFERENCES users(user_id,community_id)
);
CREATE INDEX community_event_helpers_page ON community_event_helpers(event_id,created_at,member_ref);
