-- Short-lived per-member cache of resolved GitHub repository facts between preview and create.
-- Objects are owned by the migrator role. Default privileges grant the runtime role.
CREATE TABLE share_preview_facts (
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  url_key text NOT NULL,
  facts jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, url_key)
);

CREATE INDEX share_preview_facts_created_at ON share_preview_facts(created_at);
