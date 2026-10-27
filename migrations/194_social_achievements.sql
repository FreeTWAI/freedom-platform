-- Provisional 190; integration renumbers without changing historical migrations.
-- Default-off runtime; this migration does not enroll anyone or backfill activity.
CREATE TABLE social_achievement_settings (
  user_id uuid PRIMARY KEY REFERENCES users(user_id),
  community_id uuid NOT NULL REFERENCES communities(community_id),
  counting_enabled boolean NOT NULL DEFAULT false,
  show_title boolean NOT NULL DEFAULT false,
  selected_title text,
  consent_since timestamptz,
  policy_version text NOT NULL DEFAULT 'social_days_v1' CHECK(policy_version='social_days_v1'),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','revoked')),
  moderation_reason text,
  appeal text,
  appeal_state text NOT NULL DEFAULT 'none' CHECK(appeal_state IN ('none','pending','resolved')),
  aggregate_version bigint NOT NULL DEFAULT 1 CHECK(aggregate_version>0),
  FOREIGN KEY(user_id,community_id) REFERENCES users(user_id,community_id),
  CHECK(NOT counting_enabled OR consent_since IS NOT NULL),
  CHECK(NOT show_title OR selected_title IS NOT NULL)
);
CREATE TABLE social_achievement_days (
  user_id uuid NOT NULL REFERENCES social_achievement_settings(user_id),
  track text NOT NULL CHECK(track IN ('chat','participation')),
  qualified_day date NOT NULL,
  PRIMARY KEY(user_id,track,qualified_day)
);
CREATE TABLE social_achievement_awards (
  user_id uuid NOT NULL REFERENCES social_achievement_settings(user_id),
  title_id text NOT NULL CHECK(title_id ~ '^(chat|participation)_(1|7|30|90|365)$'),
  policy_version text NOT NULL CHECK(policy_version='social_days_v1'),
  PRIMARY KEY(user_id,title_id)
);
-- Short-lived anti-replay/pair-cap metadata only; no body, link, or online time.
CREATE TABLE social_achievement_pairs (
  community_id uuid NOT NULL REFERENCES communities(community_id),
  low_ref uuid NOT NULL REFERENCES users(user_id),
  high_ref uuid NOT NULL REFERENCES users(user_id),
  qualified_day date NOT NULL,
  source_id uuid NOT NULL,
  reply_id uuid,
  credit_ref uuid REFERENCES users(user_id),
  source_kind text NOT NULL CHECK(source_kind IN ('chat','work')),
  expires_at timestamptz NOT NULL,
  FOREIGN KEY(low_ref,community_id) REFERENCES users(user_id,community_id),
  FOREIGN KEY(high_ref,community_id) REFERENCES users(user_id,community_id),
  CHECK(low_ref<high_ref),
  CHECK((source_kind='chat' AND credit_ref IS NULL) OR (source_kind='work' AND credit_ref IS NOT NULL AND credit_ref IN (low_ref,high_ref))),
  PRIMARY KEY(source_id,source_kind)
);
CREATE INDEX social_achievement_pairs_expiry ON social_achievement_pairs(expires_at);

CREATE UNIQUE INDEX social_achievement_chat_pair_day ON social_achievement_pairs(community_id,low_ref,high_ref,qualified_day) WHERE source_kind='chat';
CREATE UNIQUE INDEX social_achievement_work_pair_day_owner ON social_achievement_pairs(community_id,low_ref,high_ref,qualified_day,credit_ref) WHERE source_kind='work';
