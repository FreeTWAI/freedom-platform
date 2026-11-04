import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
const sql = readFileSync(new URL('../../../migrations/201_event_prize_photos.sql', import.meta.url), 'utf8');
// Static source contract only. PostgreSQL enforcement is a separate runtime suite.
test('prize photo schema extends validated installed predicates, not historical allowlist copies', () => {
  for (const name of ['domain_media_storage_policy_purpose_check','assets_purpose_check','asset_scope_purpose','asset_object_profile_shape','asset_object_profile_id_shape','asset_object_photo_dimensions','upload_profile_shape']) assert(sql.includes(`'${name}'`), name);
  assert.match(sql, /pg_get_expr\(conbin,conrelid,false\)/);
  assert.match(sql, /contype='c' AND convalidated/);
  assert.match(sql, /\(\(%s\) AND purpose<>''community.event-prize-photo''\) OR \(%s\)/);
  assert.match(sql, /purpose<>'community.event-prize-photo' AND target_prize_photo_id IS NULL/);
  assert.match(sql, /pg_get_functiondef/);assert.match(sql, /length\(definition\)-length\(replace\(definition,needle,''\)\)/);
});
test('prize photo identity, typed target, immutable routing and ready fence are explicit', () => {
  assert.match(sql, /target_id uuid PRIMARY KEY/);assert.match(sql, /UNIQUE\(event_id,prize_id\)/);
  assert.match(sql, /FOREIGN KEY\(target_prize_photo_id,scope_id,owner_principal_id,target_user_id,target_community_id\)/);
  assert.match(sql, /FOREIGN KEY\(asset_id,scope_id,owner_principal_id,owner_user_id,purpose,asset_state\)/);
  assert.match(sql, /linked_at_version BETWEEN 2 AND 9007199254740991/);
  assert.match(sql, /Prize photo target identity is immutable/);assert.match(sql, /Prize photo target history is retained/);
  assert.match(sql, /CREATE TRIGGER reject_fenced_asset_reference BEFORE INSERT OR UPDATE ON community_event_prize_photo_targets/);
  for (const field of ['profile_cover','gallery_photo','appearance','distribution_product','material','product','ar','comment_image','message_image','work','service','event','video_event','post','submission','highlight_media','tenant','instance']) assert(sql.includes(`target_${field}_id IS NULL`), field);
  assert.match(sql, /target_prize_photo_id IS NOT NULL AND target_community_id IS NOT NULL/);
});
test('one exact stored-to-finalized pointer, retained retirement and old JSON writer guard are present', () => {
  assert.match(sql, /i\.target_prize_photo_id=NEW\.target_id/);assert.match(sql, /i\.state='stored'/);
  const locking=sql.indexOf('PERFORM 1 FROM asset_upload_intents WHERE asset_id=NEW.asset_id FOR UPDATE;');
  const policy=sql.indexOf("PERFORM 1 FROM domain_media_storage_policy WHERE purpose='community.event-prize-photo' FOR SHARE;");
  const clock=sql.indexOf("IF event_row.state<>'pending'");assert(locking>0&&policy>locking&&clock>policy);
  assert.match(sql, /assets WHERE asset_id IN \(NEW\.asset_id,OLD\.asset_id\) ORDER BY asset_id FOR UPDATE/);
  assert.match(sql, /i\.expected_version=NEW\.linked_at_version-1/);
  assert.match(sql, /NEW\.linked_at_version IS DISTINCT FROM event_row\.aggregate_version/);
  assert.match(sql, /event_row\.state<>'pending' OR event_row\.starts_at<=clock_timestamp\(\)/);
  assert.match(sql, /CREATE CONSTRAINT TRIGGER require_event_prize_photo_completion[\s\S]*DEFERRABLE INITIALLY DEFERRED/);
  assert.match(sql, /asset_id=OLD\.asset_id AND state='retired'/);assert.match(sql, /expected_version=NEW\.linked_at_version-1 AND state='finalized'/);
  assert.match(sql, /BEFORE UPDATE OF prize_details ON community_events/);
  assert.match(sql, /jsonb_array_elements\(NEW\.prize_details\)/);
  assert.doesNotMatch(sql, /ADD COLUMN (?:aggregate_version|photo_version)|ALTER[^;]*prize_details/);
});
test('canonical profile is finite and policy is unavailable without widening GC or release floor', () => {
  assert.match(sql, /variant='photo'.*content_type='image\/webp'.*byte_size BETWEEN 1 AND 1048576.*transform_version='community.event-prize-photo.webp.v1'/);
  assert.match(sql, /pixel_width BETWEEN 1 AND 1920 AND pixel_height BETWEEN 1 AND 1920/);
  assert.match(sql, /source_byte_size BETWEEN 1 AND 2097152/);assert.match(sql, /reserved_bytes=1048576/);
  assert.match(sql, /VALUES\('community.event-prize-photo','legacy',false,NULL,NULL\)/);
  assert.doesNotMatch(sql, /CREATE(?: OR REPLACE)? FUNCTION (?:lock_asset_deletion_domain|check_asset_deletion_claim)|UPDATE asset_maintenance_policy|GRANT |SECURITY DEFINER/);
  assert.doesNotMatch(sql, /ADD COLUMN.*(?:image_bytes|image_url|object_key)/);
});
