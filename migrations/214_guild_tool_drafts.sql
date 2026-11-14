-- Member tool drafts expire after 24 hours unless accepted by a guild manager or withdrawn.
ALTER TABLE guild_tools ADD COLUMN draft_expires_at timestamptz NULL;
ALTER TABLE guild_tools ADD CONSTRAINT guild_tools_draft_expiry_state
  CHECK (state <> 'enabled' OR draft_expires_at IS NULL) NOT VALID;
CREATE INDEX guild_tools_draft_expires
  ON guild_tools(guild_key, registered_by, draft_expires_at)
  WHERE draft_expires_at IS NOT NULL;
