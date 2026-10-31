-- Public discovery is separate from admission. Preserve existing guest events.
ALTER TABLE community_events
  ADD COLUMN registration_policy text NOT NULL DEFAULT 'guest_allowed'
  CHECK (registration_policy IN ('guest_allowed','community_member'));
