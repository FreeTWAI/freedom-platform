-- Closed event-prize photo domain. Source candidate only: no policy enablement,
-- legacy bytes, GC admission, capability floor, grants or deployment changes.
-- prize_details remains migration 199's strict seven-field JSON contract.
CREATE TABLE community_event_prize_photo_targets (
  target_id uuid PRIMARY KEY,
  event_id uuid NOT NULL,
  prize_id uuid NOT NULL,
  community_id uuid NOT NULL,
  scope_id uuid NOT NULL,
  scope_kind text GENERATED ALWAYS AS ('community'::text) STORED,
  owner_principal_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  asset_id uuid UNIQUE,
  -- Snapshot of the sole event CAS, not an independent target version.
  linked_at_version bigint CHECK(linked_at_version BETWEEN 2 AND 9007199254740991),
  purpose text GENERATED ALWAYS AS ('community.event-prize-photo'::text) STORED,
  asset_state text GENERATED ALWAYS AS ('ready'::text) STORED,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((asset_id IS NULL)=(linked_at_version IS NULL)),
  UNIQUE(event_id,prize_id),
  UNIQUE(target_id,scope_id,owner_principal_id,owner_user_id,community_id),
  FOREIGN KEY(event_id,community_id,owner_user_id)
    REFERENCES community_events(event_id,community_id,organizer_ref),
  FOREIGN KEY(scope_id,scope_kind,community_id)
    REFERENCES resource_scopes(scope_id,kind,community_ref),
  FOREIGN KEY(owner_principal_id,owner_user_id)
    REFERENCES principals(principal_id,user_ref),
  FOREIGN KEY(asset_id,scope_id,owner_principal_id,owner_user_id,purpose,asset_state)
    REFERENCES assets(asset_id,scope_id,owner_principal_id,owner_user_id,purpose,state)
);

ALTER TABLE asset_upload_intents ADD COLUMN target_prize_photo_id uuid;
ALTER TABLE asset_upload_intents ADD CONSTRAINT upload_event_prize_photo_target
  FOREIGN KEY(target_prize_photo_id,scope_id,owner_principal_id,target_user_id,target_community_id)
    REFERENCES community_event_prize_photo_targets(target_id,scope_id,owner_principal_id,owner_user_id,community_id);
CREATE FUNCTION preserve_event_prize_photo_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.target_prize_photo_id IS DISTINCT FROM OLD.target_prize_photo_id THEN
    RAISE EXCEPTION 'Prize photo upload target is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preserve_event_prize_photo_intent BEFORE UPDATE ON asset_upload_intents
  FOR EACH ROW EXECUTE FUNCTION preserve_event_prize_photo_intent();

-- Read and extend each validated installed predicate. Never replace newer
-- gallery, appearance, cover, tenant or source-shape clauses with an old copy.
DO $$DECLARE old_shape text; tbl text; name text; addition text; BEGIN
  FOR tbl,name,addition IN SELECT * FROM (VALUES
    ('domain_media_storage_policy','domain_media_storage_policy_purpose_check',$p$purpose='community.event-prize-photo'$p$),
    ('assets','assets_purpose_check',$p$purpose='community.event-prize-photo'$p$),
    ('assets','asset_scope_purpose',$p$purpose='community.event-prize-photo' AND scope_kind='community' AND community_ref IS NOT NULL AND tenant_ref IS NULL$p$),
    ('asset_objects','asset_object_profile_shape',$p$purpose='community.event-prize-photo' AND variant='photo' AND content_type='image/webp' AND byte_size BETWEEN 1 AND 1048576 AND transform_version='community.event-prize-photo.webp.v1'$p$),
    ('asset_objects','asset_object_profile_id_shape',$p$purpose='community.event-prize-photo' AND profile_id IS NOT NULL AND profile_id=purpose$p$),
    ('asset_objects','asset_object_photo_dimensions',$p$purpose='community.event-prize-photo' AND pixel_width IS NOT NULL AND pixel_height IS NOT NULL AND pixel_width BETWEEN 1 AND 1920 AND pixel_height BETWEEN 1 AND 1920$p$)
  ) AS additions(tbl,name,addition) LOOP
    SELECT pg_get_expr(conbin,conrelid,false) INTO STRICT old_shape FROM pg_constraint
      WHERE conrelid=tbl::regclass AND conname=name AND contype='c' AND convalidated;
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',tbl,name);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (((%s) AND purpose<>''community.event-prize-photo'') OR (%s))',tbl,name,old_shape,addition);
  END LOOP;
  SELECT pg_get_expr(conbin,conrelid,false) INTO STRICT old_shape FROM pg_constraint
    WHERE conrelid='asset_upload_intents'::regclass AND conname='upload_profile_shape' AND contype='c' AND convalidated;
  ALTER TABLE asset_upload_intents DROP CONSTRAINT upload_profile_shape;
  EXECUTE format($shape$ALTER TABLE asset_upload_intents ADD CONSTRAINT upload_profile_shape CHECK(
    ((%s) AND purpose<>'community.event-prize-photo' AND target_prize_photo_id IS NULL)
    OR (purpose='community.event-prize-photo' AND target_kind=purpose AND target_prize_photo_id IS NOT NULL AND target_community_id IS NOT NULL
      AND target_profile_cover_id IS NULL AND target_gallery_photo_id IS NULL AND target_appearance_id IS NULL
      AND target_distribution_product_id IS NULL AND target_material_id IS NULL AND target_product_id IS NULL
      AND target_ar_id IS NULL AND target_comment_image_id IS NULL AND target_message_image_id IS NULL
      AND target_work_id IS NULL AND target_service_id IS NULL AND target_event_id IS NULL AND target_video_event_id IS NULL
      AND target_post_id IS NULL AND target_submission_id IS NULL AND target_highlight_media_id IS NULL
      AND target_tenant_id IS NULL AND target_instance_id IS NULL AND display_name IS NULL AND source_orientation IS NULL
      AND source_content_type IN ('image/png','image/jpeg','image/webp') AND source_byte_size BETWEEN 1 AND 2097152
      AND reserved_bytes=1048576 AND expected_version BETWEEN 1 AND 9007199254740990))$shape$,old_shape);
END $$;

-- Preserve the installed function bodies, lock order, avatar operator check and
-- all settlement/floor rules. Only the exact admission-list suffix is extended.
DO $$DECLARE definition text; name text;
  needle text := '''community.comment-image'',''storefront.product-photo'',''member.ar-target'',''storefront.supply-material'',''storefront.supply-material-video'',''member.profile-cover''';
BEGIN
  FOREACH name IN ARRAY ARRAY['preserve_domain_media_floor','preserve_asset_object_write_effect'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO STRICT definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE p.proname=name AND p.pronargs=0 AND n.nspname=current_schema();
    IF (length(definition)-length(replace(definition,needle,'')))<>length(needle)
      OR strpos(definition,'''community.event-prize-photo''')<>0 THEN
      RAISE EXCEPTION 'Unexpected asset admission baseline';
    END IF;
    EXECUTE replace(definition,needle,needle||',''community.event-prize-photo''');
  END LOOP;
END $$;
INSERT INTO domain_media_storage_policy(purpose,mode,persistence_allowed,policy_revision,retained_byte_limit)
  VALUES('community.event-prize-photo','legacy',false,NULL,NULL);

CREATE FUNCTION preserve_event_prize_photo_target() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_row community_events%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Prize photo target history is retained' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.target_id,NEW.event_id,NEW.prize_id,NEW.community_id,NEW.scope_id,NEW.owner_principal_id,NEW.owner_user_id,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.target_id,OLD.event_id,OLD.prize_id,OLD.community_id,OLD.scope_id,OLD.owner_principal_id,OLD.owner_user_id,OLD.created_at) THEN
      RAISE EXCEPTION 'Prize photo target identity is immutable' USING ERRCODE='23514';
    END IF;
    IF NEW.asset_id IS NOT DISTINCT FROM OLD.asset_id THEN
      IF NEW.linked_at_version IS DISTINCT FROM OLD.linked_at_version THEN
        RAISE EXCEPTION 'Prize photo attachment version is immutable' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END IF;
  ELSIF NEW.asset_id IS NOT NULL OR NEW.linked_at_version IS NOT NULL THEN
    RAISE EXCEPTION 'Prize photo targets must start empty' USING ERRCODE='23514';
  END IF;
  -- Domain callers already hold event then target. The event row lock also
  -- serializes against legacy JSON writers, preventing a concurrent orphan.
  SELECT * INTO STRICT event_row FROM community_events WHERE event_id=NEW.event_id FOR UPDATE;
  IF TG_OP='INSERT' OR NEW.asset_id IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(event_row.prize_details) AS prize
      WHERE prize->>'prize_id'=NEW.prize_id::text) THEN
      RAISE EXCEPTION 'Prize photo requires its saved event prize' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.asset_id IS NOT NULL THEN
    -- The engine already owns these rows. Direct SQL must not race intent
    -- finalization, an old-Asset retirement, or a policy revocation either.
    PERFORM 1 FROM asset_upload_intents WHERE asset_id=NEW.asset_id FOR UPDATE;
    PERFORM 1 FROM assets WHERE asset_id IN (NEW.asset_id,OLD.asset_id) ORDER BY asset_id FOR UPDATE;
    PERFORM 1 FROM domain_media_storage_policy WHERE purpose='community.event-prize-photo' FOR SHARE;
    -- Refresh the decision clock only after the last possibly blocking lock.
    IF event_row.state<>'pending' OR event_row.starts_at<=clock_timestamp()
      OR NEW.linked_at_version IS DISTINCT FROM event_row.aggregate_version
      OR NOT EXISTS(
        SELECT 1 FROM asset_upload_intents i JOIN domain_media_storage_policy p ON p.purpose=i.purpose
        WHERE i.asset_id=NEW.asset_id AND i.target_prize_photo_id=NEW.target_id
          AND i.scope_id=NEW.scope_id AND i.owner_principal_id=NEW.owner_principal_id
          AND i.target_user_id=NEW.owner_user_id AND i.target_community_id=NEW.community_id
          AND i.purpose='community.event-prize-photo' AND i.target_kind=i.purpose AND i.state='stored'
          AND i.expected_version=NEW.linked_at_version-1 AND i.fence>0
          AND i.expires_at>clock_timestamp() AND i.lease_expires_at>clock_timestamp()
          AND p.mode<>'legacy' AND p.persistence_allowed AND p.policy_revision=i.policy_revision
      ) THEN
      RAISE EXCEPTION 'Prize photo requires its current stored upload and event version' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preserve_event_prize_photo_target BEFORE INSERT OR UPDATE OR DELETE ON community_event_prize_photo_targets
  FOR EACH ROW EXECUTE FUNCTION preserve_event_prize_photo_target();
CREATE TRIGGER reject_fenced_asset_reference BEFORE INSERT OR UPDATE ON community_event_prize_photo_targets
  FOR EACH ROW EXECUTE FUNCTION reject_fenced_asset_reference();

-- Stored is required at pointer publication; finalized is required at COMMIT.
-- Detaching/replacing must retire the old Asset in that same transaction.
CREATE FUNCTION require_event_prize_photo_completion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.asset_id IS DISTINCT FROM OLD.asset_id THEN
    IF OLD.asset_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM assets WHERE asset_id=OLD.asset_id AND state='retired') THEN
      RAISE EXCEPTION 'Detached prize photo must retire in the same transaction' USING ERRCODE='23514';
    END IF;
    IF NEW.asset_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM asset_upload_intents WHERE asset_id=NEW.asset_id AND target_prize_photo_id=NEW.target_id
        AND scope_id=NEW.scope_id AND owner_principal_id=NEW.owner_principal_id AND target_user_id=NEW.owner_user_id
        AND target_community_id=NEW.community_id AND purpose='community.event-prize-photo'
        AND target_kind=purpose AND expected_version=NEW.linked_at_version-1 AND state='finalized'
    ) THEN
      RAISE EXCEPTION 'Prize photo pointer requires its atomically finalized intent' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER require_event_prize_photo_completion AFTER UPDATE ON community_event_prize_photo_targets
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_event_prize_photo_completion();

CREATE FUNCTION require_detached_event_prize_photos() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM community_event_prize_photo_targets t WHERE t.event_id=NEW.event_id AND t.asset_id IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.prize_details) AS prize WHERE prize->>'prize_id'=t.prize_id::text)) THEN
    RAISE EXCEPTION 'Detach and retire a prize photo before removing its prize' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER require_detached_event_prize_photos BEFORE UPDATE OF prize_details ON community_events
  FOR EACH ROW EXECUTE FUNCTION require_detached_event_prize_photos();

DO $$DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['preserve_event_prize_photo_intent()','preserve_event_prize_photo_target()',
    'require_event_prize_photo_completion()','require_detached_event_prize_photos()'] LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path=pg_catalog,%I',name,current_schema());
  END LOOP;
END $$;
-- No legacy fallback exists for this purpose. Policy defaults unavailable.
-- The closed maintenance purpose list is deliberately unchanged: even retired
-- photos stay retained and charged until separately reviewed GC admission.
