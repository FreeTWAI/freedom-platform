-- Provisional local candidate number; integration must reconcile the current catalog.
-- Help is independent of attendance, capacity, contact sharing and public cards.
ALTER TABLE community_events ADD COLUMN help_need text
  CHECK (help_need IS NULL OR (length(btrim(help_need)) BETWEEN 1 AND 500 AND length(help_need)<=500));
CREATE TABLE community_event_helpers (
  helper_id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES community_events ON DELETE CASCADE,
  member_ref uuid NOT NULL REFERENCES users,
  state text NOT NULL CHECK (state IN ('applied','accepted','declined','withdrawn')),
  aggregate_version bigint NOT NULL DEFAULT 2 CHECK (aggregate_version BETWEEN 2 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id,member_ref)
);
CREATE INDEX community_event_helpers_page ON community_event_helpers(event_id,created_at,member_ref);
