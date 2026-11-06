-- Private, non-executable source quarantine. No grants, live policy, GC or publication.
CREATE TABLE member_game_drafts (
 game_id uuid PRIMARY KEY,
 scope_id uuid NOT NULL,
 scope_kind text GENERATED ALWAYS AS ('personal'::text) STORED,
 owner_principal_id uuid NOT NULL,
 owner_user_id uuid NOT NULL,
 community_id uuid NOT NULL REFERENCES communities(community_id),
 title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 80 AND title !~ '[[:cntrl:]<>]'),
 description text NOT NULL CHECK(char_length(description)<=1000),
 aggregate_version bigint NOT NULL DEFAULT 1 CHECK(aggregate_version>0),
 source_revision bigint NOT NULL DEFAULT 0 CHECK(source_revision>=0),
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','quarantined','withdrawn')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(game_id,scope_id,owner_principal_id,owner_user_id),
 FOREIGN KEY(scope_id,scope_kind,owner_principal_id) REFERENCES resource_scopes(scope_id,kind,owner_principal_id),
 FOREIGN KEY(owner_principal_id,owner_user_id) REFERENCES principals(principal_id,user_ref),
 FOREIGN KEY(owner_user_id,community_id) REFERENCES users(user_id,community_id),
 CHECK((state='draft' AND source_revision=0) OR state='withdrawn' OR (state='quarantined' AND source_revision>0))
);
CREATE TABLE member_game_source_revisions (
 game_id uuid NOT NULL,
 revision bigint NOT NULL CHECK(revision>0),
 game_version bigint NOT NULL CHECK(game_version>1),
 asset_id uuid NOT NULL UNIQUE,
 scope_id uuid NOT NULL,
 owner_principal_id uuid NOT NULL,
 owner_user_id uuid NOT NULL,
 purpose text GENERATED ALWAYS AS ('member.game-source'::text) STORED,
 asset_state text GENERATED ALWAYS AS ('ready'::text) STORED,
 trust text NOT NULL DEFAULT 'unreviewed' CHECK(trust='unreviewed'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(game_id,revision),
 FOREIGN KEY(game_id,scope_id,owner_principal_id,owner_user_id) REFERENCES member_game_drafts(game_id,scope_id,owner_principal_id,owner_user_id),
 FOREIGN KEY(asset_id,scope_id,owner_principal_id,owner_user_id,purpose,asset_state) REFERENCES assets(asset_id,scope_id,owner_principal_id,owner_user_id,purpose,state)
);
ALTER TABLE asset_upload_intents ADD COLUMN target_game_id uuid;
ALTER TABLE asset_upload_intents ADD CONSTRAINT upload_game_target FOREIGN KEY(target_game_id,scope_id,owner_principal_id,target_user_id)
 REFERENCES member_game_drafts(game_id,scope_id,owner_principal_id,owner_user_id);
CREATE FUNCTION preserve_game_upload_target() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.target_game_id IS DISTINCT FROM OLD.target_game_id THEN
  RAISE EXCEPTION 'Game upload target is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER preserve_game_upload_target BEFORE UPDATE ON asset_upload_intents FOR EACH ROW EXECUTE FUNCTION preserve_game_upload_target();
DO $$DECLARE old_shape text; tbl text; name text; addition text; BEGIN
 FOR tbl,name,addition IN SELECT * FROM (VALUES
  ('domain_media_storage_policy','domain_media_storage_policy_purpose_check',$p$purpose='member.game-source'$p$),
  ('assets','assets_purpose_check',$p$purpose='member.game-source'$p$),
  ('assets','asset_scope_purpose',$p$purpose='member.game-source' AND scope_kind='personal' AND community_ref IS NULL AND tenant_ref IS NULL$p$),
  ('asset_objects','asset_object_profile_shape',$p$purpose='member.game-source' AND variant='draft' AND content_type='application/octet-stream' AND byte_size BETWEEN 1 AND 262144 AND transform_version='member.game-source.utf8-quarantine.v1'$p$),
  ('asset_objects','asset_object_profile_id_shape',$p$purpose='member.game-source' AND profile_id IS NOT NULL AND profile_id=purpose$p$),
  ('asset_objects','asset_object_photo_dimensions',$p$purpose='member.game-source' AND pixel_width IS NULL AND pixel_height IS NULL$p$)
 ) AS additions(tbl,name,addition) LOOP
  SELECT pg_get_expr(conbin,conrelid,false) INTO STRICT old_shape FROM pg_constraint WHERE conrelid=tbl::regclass AND conname=name AND contype='c' AND convalidated;
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',tbl,name);
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (((%s) AND purpose<>''member.game-source'') OR (%s))',tbl,name,old_shape,addition);
 END LOOP;
 SELECT pg_get_expr(conbin,conrelid,false) INTO STRICT old_shape FROM pg_constraint WHERE conrelid='asset_upload_intents'::regclass AND conname='upload_profile_shape' AND contype='c' AND convalidated;
 ALTER TABLE asset_upload_intents DROP CONSTRAINT upload_profile_shape;
 EXECUTE format($shape$ALTER TABLE asset_upload_intents ADD CONSTRAINT upload_profile_shape CHECK(
  ((%s) AND purpose<>'member.game-source' AND target_game_id IS NULL)
  OR (purpose='member.game-source' AND target_kind=purpose AND target_game_id IS NOT NULL
   AND target_prize_photo_id IS NULL AND target_profile_cover_id IS NULL AND target_gallery_photo_id IS NULL AND target_appearance_id IS NULL
   AND target_distribution_product_id IS NULL AND target_material_id IS NULL AND target_product_id IS NULL
   AND target_ar_id IS NULL AND target_comment_image_id IS NULL AND target_message_image_id IS NULL
   AND target_work_id IS NULL AND target_service_id IS NULL AND target_event_id IS NULL AND target_video_event_id IS NULL
   AND target_post_id IS NULL AND target_submission_id IS NULL AND target_highlight_media_id IS NULL
   AND target_tenant_id IS NULL AND target_instance_id IS NULL AND target_community_id IS NULL AND display_name IS NULL AND source_orientation IS NULL
   AND source_content_type='text/html' AND source_byte_size BETWEEN 1 AND 262144 AND reserved_bytes=262144))$shape$,old_shape);
END $$;
-- Extend only the exact installed finite effect admission, preserving every lock/floor rule.
DO $$DECLARE definition text; name text;
 needle text := '''member.profile-cover'',''community.event-prize-photo''';
BEGIN
 FOREACH name IN ARRAY ARRAY['preserve_domain_media_floor','preserve_asset_object_write_effect'] LOOP
  SELECT pg_get_functiondef(p.oid) INTO STRICT definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname=name AND p.pronargs=0 AND n.nspname=current_schema();
  IF (length(definition)-length(replace(definition,needle,'')))<>length(needle) OR strpos(definition,'''member.game-source''')<>0 THEN RAISE EXCEPTION 'Unexpected asset admission baseline'; END IF;
  EXECUTE replace(definition,needle,needle||',''member.game-source''');
 END LOOP;
END $$;
INSERT INTO domain_media_storage_policy(purpose,mode,persistence_allowed,policy_revision,retained_byte_limit) VALUES('member.game-source','legacy',false,NULL,NULL);
CREATE FUNCTION preserve_game_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Game draft history is retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.aggregate_version<>1 OR NEW.source_revision<>0 OR NEW.state<>'draft' THEN RAISE EXCEPTION 'Game draft starts empty' USING ERRCODE='23514'; END IF;
 ELSE
  IF ROW(NEW.game_id,NEW.scope_id,NEW.owner_principal_id,NEW.owner_user_id,NEW.community_id,NEW.title,NEW.description,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.game_id,OLD.scope_id,OLD.owner_principal_id,OLD.owner_user_id,OLD.community_id,OLD.title,OLD.description,OLD.created_at)
   OR OLD.state='withdrawn' OR NEW.aggregate_version<>OLD.aggregate_version+1
   OR NOT ((NEW.state='withdrawn' AND NEW.source_revision=OLD.source_revision)
    OR (NEW.state='quarantined' AND NEW.source_revision=OLD.source_revision+1)) THEN
    RAISE EXCEPTION 'Invalid game draft transition' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER preserve_game_draft BEFORE INSERT OR UPDATE OR DELETE ON member_game_drafts FOR EACH ROW EXECUTE FUNCTION preserve_game_draft();
CREATE FUNCTION preserve_game_source_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE game member_game_drafts%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Game source revisions are immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO STRICT game FROM member_game_drafts WHERE game_id=NEW.game_id FOR UPDATE;
 PERFORM 1 FROM asset_upload_intents WHERE asset_id=NEW.asset_id FOR UPDATE;
 PERFORM 1 FROM assets WHERE asset_id=NEW.asset_id FOR UPDATE;
 PERFORM 1 FROM domain_media_storage_policy WHERE purpose='member.game-source' FOR SHARE;
 IF game.state<>'quarantined' OR game.aggregate_version<>NEW.game_version OR game.source_revision<>NEW.revision OR NOT EXISTS(
  SELECT 1 FROM asset_upload_intents i JOIN domain_media_storage_policy p USING(purpose)
  WHERE i.asset_id=NEW.asset_id AND i.target_game_id=NEW.game_id AND i.scope_id=NEW.scope_id
   AND i.owner_principal_id=NEW.owner_principal_id AND i.target_user_id=NEW.owner_user_id
   AND i.purpose='member.game-source' AND i.target_kind=i.purpose AND i.state='stored'
   AND i.expected_version=NEW.game_version-1 AND i.fence>0 AND i.expires_at>clock_timestamp() AND i.lease_expires_at>clock_timestamp()
   AND p.mode='r2_only' AND p.persistence_allowed AND p.policy_revision=i.policy_revision
 ) THEN RAISE EXCEPTION 'Game revision requires its live stored upload' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER preserve_game_source_revision BEFORE INSERT OR UPDATE OR DELETE ON member_game_source_revisions FOR EACH ROW EXECUTE FUNCTION preserve_game_source_revision();
CREATE TRIGGER reject_fenced_asset_reference BEFORE INSERT OR UPDATE ON member_game_source_revisions FOR EACH ROW EXECUTE FUNCTION reject_fenced_asset_reference();
CREATE FUNCTION require_game_source_completion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='member_game_drafts' THEN
  IF NEW.source_revision>OLD.source_revision AND NOT EXISTS(SELECT 1 FROM member_game_source_revisions WHERE game_id=NEW.game_id AND revision=NEW.source_revision AND game_version=NEW.aggregate_version) THEN
   RAISE EXCEPTION 'Game CAS requires its source revision' USING ERRCODE='23514';
  END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM asset_upload_intents WHERE asset_id=NEW.asset_id AND target_game_id=NEW.game_id AND purpose='member.game-source' AND expected_version=NEW.game_version-1 AND state='finalized') THEN
   RAISE EXCEPTION 'Game revision requires finalized intent' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER require_game_source_completion AFTER UPDATE ON member_game_drafts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_game_source_completion();
CREATE CONSTRAINT TRIGGER require_game_source_completion AFTER INSERT ON member_game_source_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_game_source_completion();
DO $$DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['preserve_game_upload_target()','preserve_game_draft()','preserve_game_source_revision()','require_game_source_completion()'] LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path=pg_catalog,%I',name,current_schema());
 END LOOP;
END $$;
-- No source-serving route, public URL, automatic cleanup, role or capability.
