-- Provisional 190 on main043; renumber the later-merged candidate, never add gaps.
-- No automatic awards, backfill, identity binding, grants or external effects.
CREATE TABLE member_community_certifications (
  user_id uuid PRIMARY KEY,
  community_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'unrequested' CHECK(state IN ('unrequested','pending','active','rejected','revoked','withdrawn')),
  statement text NOT NULL DEFAULT '' CHECK(char_length(statement)<=1000),
  show_community_certification boolean NOT NULL DEFAULT false,
  policy_version text NOT NULL DEFAULT 'community_certification_v1' CHECK(policy_version='community_certification_v1'),
  aggregate_version bigint NOT NULL CHECK(aggregate_version>=2),
  reviewed_by uuid REFERENCES platform_admins(admin_id),
  reviewer_user_id uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(user_id,community_id) REFERENCES users(user_id,community_id),
  FOREIGN KEY(reviewer_user_id,community_id) REFERENCES users(user_id,community_id),
  CHECK(reviewer_user_id IS NULL OR reviewer_user_id<>user_id),
  CHECK((reviewed_by IS NULL AND reviewer_user_id IS NULL AND reviewed_at IS NULL)
    OR (reviewed_by IS NOT NULL AND reviewer_user_id IS NOT NULL AND reviewed_at IS NOT NULL)),
  CHECK(state NOT IN ('active','rejected','revoked') OR reviewed_by IS NOT NULL),
  CHECK(state NOT IN ('pending','active','rejected','revoked') OR char_length(statement)>=10)
);
CREATE INDEX member_community_certifications_review_queue ON member_community_certifications(community_id,state,updated_at,user_id);
