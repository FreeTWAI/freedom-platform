-- PROVISIONAL 191: customization + independently consented profile-cover Asset domain.
-- Source candidate only. No storage policy, quota or production activation.
CREATE FUNCTION valid_member_profile_layout(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE item jsonb; ids text[]:=ARRAY[]::text[];
BEGIN
 IF jsonb_typeof(value)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(value))<>7
 OR NOT value ?& ARRAY['theme','accent','cover_style','cover_alt','about','featured','blocks']
 OR jsonb_typeof(value->'theme')<>'string' OR jsonb_typeof(value->'accent')<>'string' OR jsonb_typeof(value->'cover_style')<>'string'
 OR value->>'theme' NOT IN ('paper','night','sage','rose') OR value->>'accent' NOT IN ('violet','blue','teal','berry','amber')
 OR value->>'cover_style' NOT IN ('horizon','grid','constellation','waves')
 OR jsonb_typeof(value->'cover_alt')<>'string' OR char_length(value->>'cover_alt')>120 OR value->>'cover_alt' ~ '[[:cntrl:]]'
 OR jsonb_typeof(value->'about')<>'string' OR char_length(value->>'about')>1600 OR replace(value->>'about',chr(10),'') ~ '[[:cntrl:]]'
 OR jsonb_typeof(value->'featured')<>'array' OR jsonb_array_length(value->'featured')>6
 OR jsonb_typeof(value->'blocks')<>'array' OR jsonb_array_length(value->'blocks')<>4 THEN RETURN false;END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(value->'featured') LOOP
  IF jsonb_typeof(item)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(item))<>3 OR NOT item ?& ARRAY['title','description','url']
  OR jsonb_typeof(item->'title')<>'string' OR char_length(item->>'title') NOT BETWEEN 1 AND 80 OR item->>'title' ~ '[[:cntrl:]]'
  OR jsonb_typeof(item->'description')<>'string' OR char_length(item->>'description')>180 OR item->>'description' ~ '[[:cntrl:]]'
  OR jsonb_typeof(item->'url')<>'string' OR char_length(item->>'url') NOT BETWEEN 1 AND 500 OR item->>'url' ~ '[[:cntrl:]]'
  OR item->>'url' !~ '^https://[^/@[:space:]]+([/?#]|$)' THEN RETURN false;END IF;
 END LOOP;
 FOR item IN SELECT * FROM jsonb_array_elements(value->'blocks') LOOP
  IF jsonb_typeof(item)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(item))<>2 OR NOT item ?& ARRAY['id','visible']
  OR jsonb_typeof(item->'id')<>'string' OR item->>'id' NOT IN ('about','featured','links','recognition') OR jsonb_typeof(item->'visible')<>'boolean' OR item->>'id'=ANY(ids) THEN RETURN false;END IF;
  ids:=array_append(ids,item->>'id');
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
ALTER TABLE member_profile_publications ADD COLUMN layout jsonb NOT NULL DEFAULT '{"theme":"paper","accent":"violet","cover_style":"horizon","cover_alt":"個人頁封面","about":"","featured":[],"blocks":[{"id":"about","visible":true},{"id":"featured","visible":true},{"id":"links","visible":true},{"id":"recognition","visible":true}]}'::jsonb CHECK(valid_member_profile_layout(layout)),
 ADD COLUMN include_cover boolean NOT NULL DEFAULT false,
 ADD COLUMN cover_version bigint CHECK(cover_version>1),
 ADD CONSTRAINT profile_cover_selection_shape CHECK ((include_cover AND cover_version IS NOT NULL) OR (NOT include_cover AND cover_version IS NULL));
-- LOCAL unnumbered proposal. Parent consolidates after publication layout columns:
-- member_profile_publications.include_cover boolean NOT NULL DEFAULT false,
-- cover_version bigint CHECK(cover_version>0), null unless include_cover.
-- No storage activation; all prior migration bytes are unchanged.
CREATE TABLE member_profile_cover_targets (
 user_id uuid PRIMARY KEY,community_id uuid NOT NULL,scope_id uuid NOT NULL,
 scope_kind text GENERATED ALWAYS AS ('personal'::text) STORED,
 owner_principal_id uuid NOT NULL,aggregate_version bigint NOT NULL DEFAULT 1 CHECK(aggregate_version>0),
 FOREIGN KEY(user_id,community_id) REFERENCES users(user_id,community_id),
 FOREIGN KEY(scope_id,scope_kind,owner_principal_id) REFERENCES resource_scopes(scope_id,kind,owner_principal_id),
 FOREIGN KEY(owner_principal_id,user_id) REFERENCES principals(principal_id,user_ref),
 UNIQUE(user_id,scope_id,owner_principal_id)
);
CREATE TABLE member_profile_cover_versions (
 user_id uuid NOT NULL,version bigint NOT NULL CHECK(version>1),scope_id uuid NOT NULL,owner_principal_id uuid NOT NULL,
 asset_id uuid NOT NULL UNIQUE,purpose text GENERATED ALWAYS AS ('member.profile-cover'::text) STORED,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),retired_at timestamptz,
 asset_state text GENERATED ALWAYS AS (CASE WHEN retired_at IS NULL THEN 'ready'::text ELSE 'retired'::text END) STORED,
 PRIMARY KEY(user_id,version),
 FOREIGN KEY(user_id,scope_id,owner_principal_id) REFERENCES member_profile_cover_targets(user_id,scope_id,owner_principal_id),
 FOREIGN KEY(asset_id,scope_id,owner_principal_id,user_id,purpose,asset_state)
 REFERENCES assets(asset_id,scope_id,owner_principal_id,owner_user_id,purpose,state) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE member_profile_publications ADD CONSTRAINT publication_cover_owned_version
 FOREIGN KEY(user_id,cover_version) REFERENCES member_profile_cover_versions(user_id,version);
CREATE FUNCTION preserve_profile_cover_target() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Cover history is retained' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN IF NEW.aggregate_version<>1 THEN RAISE EXCEPTION 'Cover target starts at version one' USING ERRCODE='23514';END IF;RETURN NEW;END IF;
 IF ROW(NEW.user_id,NEW.community_id,NEW.scope_id,NEW.owner_principal_id) IS DISTINCT FROM ROW(OLD.user_id,OLD.community_id,OLD.scope_id,OLD.owner_principal_id)
 OR NEW.aggregate_version<>OLD.aggregate_version+1 THEN RAISE EXCEPTION 'Cover target identity is immutable and versions advance once' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER preserve_profile_cover_target BEFORE INSERT OR UPDATE OR DELETE ON member_profile_cover_targets FOR EACH ROW EXECUTE FUNCTION preserve_profile_cover_target();
CREATE FUNCTION preserve_profile_cover_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Cover history is retained' USING ERRCODE='23514';END IF;
 PERFORM 1 FROM member_profile_cover_targets WHERE user_id=NEW.user_id FOR UPDATE;
 IF TG_OP='INSERT' THEN
  IF NEW.retired_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM member_profile_cover_targets WHERE user_id=NEW.user_id AND aggregate_version=NEW.version)
   OR NOT EXISTS(SELECT 1 FROM asset_upload_intents WHERE asset_id=NEW.asset_id AND purpose='member.profile-cover' AND target_profile_cover_id=NEW.user_id AND state='stored' AND expected_version=NEW.version-1)
  THEN RAISE EXCEPTION 'Cover version requires its current stored upload' USING ERRCODE='23514';END IF;
 ELSE
  IF ROW(NEW.user_id,NEW.version,NEW.scope_id,NEW.owner_principal_id,NEW.asset_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.user_id,OLD.version,OLD.scope_id,OLD.owner_principal_id,OLD.asset_id,OLD.created_at)
   OR OLD.retired_at IS NOT NULL OR NEW.retired_at IS NULL
   OR EXISTS(SELECT 1 FROM member_profile_publications WHERE user_id=NEW.user_id AND include_cover AND cover_version=NEW.version)
  THEN RAISE EXCEPTION 'Only an unselected cover version may retire once' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;END $$;
CREATE TRIGGER preserve_profile_cover_version BEFORE INSERT OR UPDATE OR DELETE ON member_profile_cover_versions FOR EACH ROW EXECUTE FUNCTION preserve_profile_cover_version();
CREATE TRIGGER reject_fenced_asset_reference BEFORE INSERT OR UPDATE ON member_profile_cover_versions FOR EACH ROW EXECUTE FUNCTION reject_fenced_asset_reference();
CREATE FUNCTION require_profile_cover_selection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.include_cover THEN
  PERFORM 1 FROM member_profile_cover_targets WHERE user_id=NEW.user_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM member_profile_cover_versions v JOIN assets a USING(asset_id) WHERE v.user_id=NEW.user_id AND v.version=NEW.cover_version AND v.retired_at IS NULL AND a.state='ready' AND a.deletion_fence=0)
  THEN RAISE EXCEPTION 'Published cover needs an owned ready version' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;END $$;
CREATE TRIGGER require_profile_cover_selection BEFORE INSERT OR UPDATE ON member_profile_publications FOR EACH ROW EXECUTE FUNCTION require_profile_cover_selection();
ALTER TABLE asset_upload_intents ADD COLUMN target_profile_cover_id uuid;
ALTER TABLE asset_upload_intents ADD CONSTRAINT upload_profile_cover_target FOREIGN KEY(target_profile_cover_id,scope_id,owner_principal_id) REFERENCES member_profile_cover_targets(user_id,scope_id,owner_principal_id);
CREATE FUNCTION preserve_profile_cover_intent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.target_profile_cover_id IS DISTINCT FROM OLD.target_profile_cover_id THEN RAISE EXCEPTION 'Cover upload target is immutable' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER preserve_profile_cover_intent BEFORE UPDATE ON asset_upload_intents FOR EACH ROW EXECUTE FUNCTION preserve_profile_cover_intent();
-- Extend the exact installed predicates, including gallery/appearance additions.
-- No older definition replaces current CHECK branches.
DO $$DECLARE old_shape text;tbl text;name text;addition text; BEGIN
 FOR tbl,name,addition IN SELECT * FROM (VALUES
 ('domain_media_storage_policy','domain_media_storage_policy_purpose_check',$p$purpose='member.profile-cover'$p$),
 ('assets','assets_purpose_check',$p$purpose='member.profile-cover'$p$),
 ('assets','asset_scope_purpose',$p$purpose='member.profile-cover' AND scope_kind='personal' AND community_ref IS NULL AND tenant_ref IS NULL$p$),
 ('asset_objects','asset_object_profile_shape',$p$purpose='member.profile-cover' AND variant='cover' AND content_type='image/webp' AND byte_size BETWEEN 1 AND 524288 AND transform_version='member.profile-cover.webp.v1'$p$),
 ('asset_objects','asset_object_profile_id_shape',$p$purpose='member.profile-cover' AND profile_id IS NOT NULL AND profile_id=purpose$p$),
 ('asset_objects','asset_object_photo_dimensions',$p$purpose='member.profile-cover' AND pixel_width IS NOT NULL AND pixel_height IS NOT NULL AND pixel_width=1600 AND pixel_height=600$p$)
 ) AS additions(tbl,name,addition) LOOP
  SELECT pg_get_expr(conbin,conrelid,false) INTO STRICT old_shape FROM pg_constraint WHERE conrelid=tbl::regclass AND conname=name AND contype='c' AND convalidated;
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',tbl,name);
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (((%s) AND purpose<>''member.profile-cover'') OR (%s))',tbl,name,old_shape,addition);
 END LOOP;
 SELECT pg_get_expr(conbin,conrelid,false) INTO STRICT old_shape FROM pg_constraint WHERE conrelid='asset_upload_intents'::regclass AND conname='upload_profile_shape' AND contype='c' AND convalidated;
 ALTER TABLE asset_upload_intents DROP CONSTRAINT upload_profile_shape;
 EXECUTE format($shape$ALTER TABLE asset_upload_intents ADD CONSTRAINT upload_profile_shape CHECK(
 ((%s) AND purpose<>'member.profile-cover' AND target_profile_cover_id IS NULL)
 OR (purpose='member.profile-cover' AND target_kind=purpose AND target_profile_cover_id=target_user_id AND target_profile_cover_id IS NOT NULL
 AND target_gallery_photo_id IS NULL AND target_appearance_id IS NULL AND target_distribution_product_id IS NULL AND target_material_id IS NULL AND target_product_id IS NULL
 AND target_ar_id IS NULL AND target_comment_image_id IS NULL AND target_message_image_id IS NULL AND target_work_id IS NULL AND target_service_id IS NULL
 AND target_event_id IS NULL AND target_video_event_id IS NULL AND target_post_id IS NULL AND target_submission_id IS NULL AND target_highlight_media_id IS NULL
 AND target_community_id IS NULL AND target_tenant_id IS NULL AND target_instance_id IS NULL AND display_name IS NULL AND source_orientation IS NULL
 AND source_content_type IN ('image/png','image/jpeg','image/webp') AND source_byte_size BETWEEN 1 AND 4194304 AND reserved_bytes=524288))$shape$,old_shape);
END $$;
DO $$DECLARE definition text;name text; BEGIN
 FOREACH name IN ARRAY ARRAY['preserve_domain_media_floor','preserve_asset_object_write_effect'] LOOP
  SELECT pg_get_functiondef(p.oid) INTO STRICT definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname=name AND n.nspname=current_schema();
  IF strpos(definition,'''community.comment-image'',''storefront.product-photo'',''member.ar-target'',''storefront.supply-material'',''storefront.supply-material-video''')=0 THEN RAISE EXCEPTION 'Unexpected asset admission baseline';END IF;
  EXECUTE replace(definition,'''community.comment-image'',''storefront.product-photo'',''member.ar-target'',''storefront.supply-material'',''storefront.supply-material-video''','''community.comment-image'',''storefront.product-photo'',''member.ar-target'',''storefront.supply-material'',''storefront.supply-material-video'',''member.profile-cover''');
 END LOOP;
END $$;
INSERT INTO domain_media_storage_policy(purpose) VALUES('member.profile-cover');
DO $$DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['preserve_profile_cover_target()','preserve_profile_cover_version()','require_profile_cover_selection()','preserve_profile_cover_intent()'] LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path=pg_catalog,%I',name,current_schema());
 END LOOP;
END $$;
-- Default legacy means unavailable (no legacy cover data exists). No policy,
-- quota, storage binding or retention duration is guessed or enabled here.
-- Existing closed GC purpose admission deliberately continues to reject this
-- new domain. Retired versions remain retained/charged; physical GC needs its
-- own reviewed reference/backup/write-effect protocol and operator authority.
