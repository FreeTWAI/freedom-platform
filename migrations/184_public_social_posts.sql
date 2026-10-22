-- Author opt-in is independent from the existing member feed. No historical
-- post, comment, member profile or image becomes public by this migration.
CREATE TABLE community_social_publications (
  post_id uuid PRIMARY KEY,
  community_id uuid NOT NULL,
  author_user_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  post_revision integer NOT NULL CHECK (post_revision > 0),
  media_version bigint NOT NULL CHECK (media_version > 0),
  thumbnail_sha256 text CHECK (thumbnail_sha256 ~ '^[0-9a-f]{64}$'),
  version bigint NOT NULL CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (post_id,community_id,author_user_id)
    REFERENCES community_social_posts(post_id,community_id,author_user_id)
    ON DELETE CASCADE
);
CREATE INDEX social_publications_preview
  ON community_social_publications(community_id,updated_at DESC,post_id DESC)
  WHERE enabled;
