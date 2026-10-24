-- Explicit operator assignment; no existing member implicitly becomes publisher.
CREATE TABLE community_journal_publisher (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 community_id uuid NOT NULL REFERENCES communities(community_id),
 owner_ref uuid NOT NULL REFERENCES users(user_id),
 published_submission_id uuid,
 aggregate_version bigint NOT NULL DEFAULT 1 CHECK(aggregate_version>0)
);
CREATE TABLE community_journal_keys (
 key_id uuid PRIMARY KEY, community_id uuid NOT NULL REFERENCES communities(community_id),
 user_id uuid NOT NULL REFERENCES users(user_id), label text NOT NULL,
 token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
 revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE community_journal_submissions (
 submission_id uuid PRIMARY KEY, community_id uuid NOT NULL REFERENCES communities(community_id),
 owner_ref uuid NOT NULL REFERENCES users(user_id), key_id uuid NOT NULL REFERENCES community_journal_keys(key_id),
 idempotency_key text NOT NULL, source_revision text NOT NULL, payload_sha256 text NOT NULL,
 payload jsonb NOT NULL, status text NOT NULL DEFAULT 'ready_for_review' CHECK(status IN ('ready_for_review','published','superseded','withdrawn')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(key_id,idempotency_key)
);
ALTER TABLE community_journal_publisher ADD CONSTRAINT community_journal_published_fk FOREIGN KEY(published_submission_id) REFERENCES community_journal_submissions(submission_id);
CREATE INDEX community_journal_review ON community_journal_submissions(community_id,owner_ref,created_at DESC);
