-- Opt-in public reading consent for works (`showcases`).
-- Existing works stay member-only until the owner explicitly confirms the exact version.
CREATE TABLE work_public_publications (
  showcase_id uuid PRIMARY KEY REFERENCES showcases ON DELETE CASCADE,
  community_id uuid NOT NULL REFERENCES communities,
  owner_ref uuid NOT NULL REFERENCES users,
  enabled boolean NOT NULL DEFAULT false,
  approved_work_version bigint NOT NULL CHECK (approved_work_version >= 1),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  consented_at timestamptz,
  withdrawn_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX work_public_publications_live
  ON work_public_publications(community_id, showcase_id)
  WHERE enabled;

-- Editing the work, its link/artifact, status/visibility, or version hides public reading
-- until the owner explicitly re-confirms the updated version.
CREATE OR REPLACE FUNCTION invalidate_work_public_sharing_on_edit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.title IS DISTINCT FROM OLD.title
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.artifact_ref IS DISTINCT FROM OLD.artifact_ref
    OR NEW.public_url IS DISTINCT FROM OLD.public_url
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.visibility IS DISTINCT FROM OLD.visibility
    OR NEW.aggregate_version IS DISTINCT FROM OLD.aggregate_version
    OR NEW.status IS DISTINCT FROM 'published'
    OR NEW.visibility IS DISTINCT FROM 'community' THEN
    UPDATE work_public_publications
      SET enabled = false,
          withdrawn_at = CASE WHEN enabled THEN now() ELSE withdrawn_at END,
          version = version + 1,
          updated_at = now()
      WHERE showcase_id = NEW.showcase_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER work_public_sharing_invalidation
  AFTER UPDATE ON showcases
  FOR EACH ROW
  EXECUTE FUNCTION invalidate_work_public_sharing_on_edit();
