-- Candidate only; no provider registration or rollout. Old binaries cannot safely
-- serve nullable passwords once Google-only members exist, even with Google OFF.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
CREATE TABLE member_login_identities (
  identity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK(provider='google'),
  subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 255 AND subject ~ '^[ -~]+$'),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  community_id uuid NOT NULL REFERENCES communities,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  FOREIGN KEY(user_id,community_id) REFERENCES users(user_id,community_id),
  UNIQUE(provider,subject)
);
-- Retain revoked subjects so a late callback cannot masquerade as fresh signup.
CREATE UNIQUE INDEX member_login_identities_active_user ON member_login_identities(user_id,provider) WHERE revoked_at IS NULL;
CREATE TABLE google_login_states (
  state_hash text PRIMARY KEY,
  browser_hash text NOT NULL,
  nonce text NOT NULL,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  intent text NOT NULL CHECK(intent IN ('login','link')),
  original_session_hash text,
  user_id uuid REFERENCES users ON DELETE CASCADE,
  community_id uuid REFERENCES communities,
  credential_hash text,
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '10 minutes',
  CHECK((intent='login' AND user_id IS NULL AND community_id IS NULL AND credential_hash IS NULL)
    OR (intent='link' AND user_id IS NOT NULL AND community_id IS NOT NULL AND credential_hash IS NOT NULL AND original_session_hash IS NOT NULL))
);
-- original_session_hash is a comparison fence, not an authority or FK: anonymous
-- attempts may carry an expired cookie; linked authority is rechecked explicitly.
CREATE INDEX google_login_states_expiry ON google_login_states(expires_at);
CREATE TABLE google_login_challenges (
  challenge_hash text PRIMARY KEY,
  origin_state_hash text NOT NULL,
  identity_id uuid NOT NULL REFERENCES member_login_identities ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  browser_hash text NOT NULL,
  original_session_hash text,
  credential_hash text,
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '5 minutes'
);
CREATE INDEX google_login_challenges_expiry ON google_login_challenges(expires_at);
-- A completion cookie is unusable until a one-use, same-browser ACK. No raw
-- session, activation token, browser verifier or password hash is stored here.
CREATE TABLE google_login_activations (
  activation_hash text PRIMARY KEY,
  session_hash text NOT NULL UNIQUE REFERENCES sessions(token_hash) ON DELETE CASCADE,
  identity_id uuid NOT NULL REFERENCES member_login_identities ON DELETE CASCADE,
  browser_hash text NOT NULL,
  origin_state_hash text NOT NULL,
  credential_hash text,
  account_version bigint NOT NULL,
  registered boolean NOT NULL,
  revoked_at timestamptz,
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '1 minute'
);
CREATE INDEX google_login_activations_expiry ON google_login_activations(expires_at);
