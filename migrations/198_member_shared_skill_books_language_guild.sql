-- Published member-shared repositories converted to catalog 社群技能書 (2026-11-03).
-- Preserve existing publication times.
INSERT INTO skill_publications(book_id) VALUES
 ('project-hub'),
 ('taiwanese-english-checker')
ON CONFLICT DO NOTHING;

-- At the platform owner's request, 台式英文抓蟲器 becomes a designated book of the
-- administrator-approved custom guild 語言學習與AI協作公會. Custom guilds designate books
-- only through this table, which approval writes; there is no static catalog mapping.
-- Databases without that approved application (fresh or test) skip both statements.
INSERT INTO guild_skill_book_bindings(community_id,guild_key,book_id)
SELECT a.community_id,a.approved_guild_key,'taiwanese-english-checker'
FROM guild_creation_applications a
JOIN positioning_guild_catalog g ON g.guild_key=a.approved_guild_key
WHERE a.application_id='e3ab38b6-8bcd-4305-8b79-686477bdabf5' AND a.state='approved'
  AND a.approved_guild_key='guild_custom_e3ab38b68bcd43058b79686477bdabf5'
ON CONFLICT DO NOTHING;

-- Existing active members of that guild receive the book too, as in migration 031.
-- This does not change memberships, primary choices, consent, or development authority.
INSERT INTO member_skill_book_grants(grant_id,community_id,user_id,guild_key,book_id)
SELECT gen_random_uuid(),m.community_id,m.user_id,m.guild_key,b.book_id
FROM guild_skill_book_bindings b
JOIN positioning_profession_memberships m ON m.community_id=b.community_id AND m.guild_key=b.guild_key AND m.state='active'
JOIN users u ON u.user_id=m.user_id AND u.community_id=m.community_id AND u.active
WHERE b.guild_key='guild_custom_e3ab38b68bcd43058b79686477bdabf5' AND b.book_id='taiwanese-english-checker'
ON CONFLICT DO NOTHING;
