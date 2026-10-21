-- Published member-shared repositories converted to catalog 社群技能書.
-- Preserve existing publication times; no member or development grants.
INSERT INTO skill_publications(book_id) VALUES
 ('hrflow'),
 ('hdsljp-api'),
 ('usage'),
 ('photo-border-remover'),
 ('ga4-lp-analytics'),
 ('sns-feedback-collect'),
 ('ultracode-token-optimization'),
 ('keynote-pptx-doctor'),
 ('webchat-mcp'),
 ('gemini-voice-lab'),
 ('story-bible'),
 ('human-mode')
ON CONFLICT DO NOTHING;
