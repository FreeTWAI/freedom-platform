-- PROVISIONAL 190: per Ted #1135, later-merged candidates are renumbered.
-- Source-only candidate; no migration execution or publication implied.
-- No backfill: existing accounts, directory and e-card do not become publications.
CREATE TABLE member_profile_publications (
  user_id uuid PRIMARY KEY REFERENCES users(user_id),
  community_id uuid NOT NULL REFERENCES communities(community_id),
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','members','public')),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 60),
  bio text NOT NULL DEFAULT '' CHECK (char_length(bio) <= 280),
  links jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(links)='array' AND jsonb_array_length(links)<=5),
  aggregate_version bigint NOT NULL DEFAULT 1 CHECK (aggregate_version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (user_id,community_id) REFERENCES users(user_id,community_id)
);
