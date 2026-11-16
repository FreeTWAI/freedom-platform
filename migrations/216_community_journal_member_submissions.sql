-- Allow community journal drafts submitted directly through the member or fw_agent_
-- door without requiring a legacy fjp_ journal submission key.
ALTER TABLE community_journal_submissions ALTER COLUMN key_id DROP NOT NULL;
