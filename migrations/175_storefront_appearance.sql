-- Store appearance is an additive draft/publication sidecar. No activation,
-- new Asset purpose, policy change, GC admission or old-publication rewrite.
CREATE FUNCTION storefront_appearance_ids_valid(ids uuid[]) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT ids IS NOT NULL AND cardinality(ids)<=8
  AND (cardinality(ids)=0 OR (array_ndims(ids)=1 AND array_lower(ids,1)=1))
  AND NOT EXISTS(SELECT 1 FROM unnest(ids) id WHERE id IS NULL)
  AND cardinality(ids)=(SELECT count(DISTINCT id) FROM unnest(ids) id)
$$;
CREATE FUNCTION storefront_announcement_valid(value text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT value IS NOT NULL AND char_length(value)<=80
  AND value !~ U&'[\0001-\001f\007f-\009f\2028\2029]'
$$;

CREATE TABLE commerce_storefront_appearance_drafts (
 tenant_id uuid NOT NULL, instance_id uuid NOT NULL,
 accent_preset text NOT NULL DEFAULT 'lime'
  CHECK(accent_preset IN ('lime','forest','ocean','indigo','rose','terracotta','gold','graphite')),
 announcement text NOT NULL DEFAULT '' CHECK(storefront_announcement_valid(announcement)),
 featured_product_ids uuid[] NOT NULL DEFAULT '{}' CHECK(storefront_appearance_ids_valid(featured_product_ids)),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,instance_id),
 FOREIGN KEY(tenant_id,instance_id) REFERENCES commerce_storefront_profiles(tenant_id,instance_id)
);
CREATE FUNCTION preserve_storefront_appearance_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_ids uuid[] := '{}';
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Appearance drafts are retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.tenant_id,NEW.instance_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.tenant_id,OLD.instance_id,OLD.created_at)
   THEN RAISE EXCEPTION 'Appearance identity is immutable' USING ERRCODE='23514'; END IF;
  previous_ids:=OLD.featured_product_ids;
  NEW.updated_at:=clock_timestamp();
 END IF;
 -- Validate only newly selected IDs. Deleted/disabled configured products may
 -- remain in the draft until explicitly removed, without exposing foreign names.
 IF EXISTS(SELECT 1 FROM unnest(NEW.featured_product_ids) id
  WHERE NOT(id=ANY(previous_ids)) AND NOT EXISTS(
   SELECT 1 FROM commerce_storefront_profiles p
   JOIN commerce_items i ON i.shop_id=p.supply_shop_id AND i.item_id=id
   JOIN commerce_selections s ON s.shop_id=p.storefront_shop_id AND s.item_id=i.item_id AND s.own_retail_enabled
   JOIN commerce_resource_tenants a ON a.resource_kind='shop' AND a.resource_id=p.supply_shop_id
    AND a.tenant_id=p.tenant_id AND a.instance_id=p.instance_id AND a.mapping_state='confirmed'
   JOIN commerce_resource_tenants b ON b.resource_kind='shop' AND b.resource_id=p.storefront_shop_id
    AND b.tenant_id=p.tenant_id AND b.instance_id=p.instance_id AND b.mapping_state='confirmed'
   WHERE p.tenant_id=NEW.tenant_id AND p.instance_id=NEW.instance_id AND p.slug IS NOT NULL))
 THEN RAISE EXCEPTION 'Featured products must be own retail products' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER preserve_storefront_appearance_draft BEFORE INSERT OR UPDATE OR DELETE ON commerce_storefront_appearance_drafts
 FOR EACH ROW EXECUTE FUNCTION preserve_storefront_appearance_draft();

CREATE TABLE commerce_storefront_appearance_targets (
 tenant_id uuid NOT NULL, instance_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('storefront.cover','storefront.logo')),
 scope_id uuid NOT NULL, scope_kind text GENERATED ALWAYS AS ('tenant'::text) STORED,
 asset_id uuid, representation_id uuid, policy_revision text,
 -- Snapshot of the real profile version, including removal; never a second CAS.
 last_changed_at_profile_version bigint NOT NULL CHECK(last_changed_at_profile_version>0),
 purpose text GENERATED ALWAYS AS ('storefront.product-photo'::text) STORED,
 asset_state text GENERATED ALWAYS AS ('ready'::text) STORED,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,instance_id,kind), UNIQUE(instance_id,tenant_id,scope_id,kind),
 FOREIGN KEY(tenant_id,instance_id) REFERENCES commerce_storefront_profiles(tenant_id,instance_id),
 FOREIGN KEY(scope_id,scope_kind,tenant_id) REFERENCES resource_scopes(scope_id,kind,tenant_ref),
 FOREIGN KEY(asset_id,scope_id,tenant_id,purpose,representation_id,asset_state)
  REFERENCES assets(asset_id,scope_id,tenant_ref,purpose,representation_id,state),
 FOREIGN KEY(asset_id,scope_id,representation_id,policy_revision,purpose)
  REFERENCES asset_objects(asset_id,scope_id,representation_id,policy_revision,purpose),
 CHECK((asset_id IS NULL AND representation_id IS NULL AND policy_revision IS NULL)
  OR (asset_id IS NOT NULL AND representation_id IS NOT NULL AND policy_revision IS NOT NULL))
);
CREATE FUNCTION preserve_storefront_appearance_target() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_version bigint;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Appearance routing is permanent' USING ERRCODE='23514'; END IF;
 SELECT version INTO current_version FROM commerce_storefront_profiles
  WHERE tenant_id=NEW.tenant_id AND instance_id=NEW.instance_id AND slug IS NOT NULL;
 IF current_version IS NULL THEN RAISE EXCEPTION 'Appearance requires a retail store' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.asset_id IS NOT NULL OR NEW.last_changed_at_profile_version<>current_version
   THEN RAISE EXCEPTION 'Initial appearance target must be empty' USING ERRCODE='23514'; END IF;
 ELSE
  IF ROW(NEW.tenant_id,NEW.instance_id,NEW.kind,NEW.scope_id,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.tenant_id,OLD.instance_id,OLD.kind,OLD.scope_id,OLD.created_at)
   THEN RAISE EXCEPTION 'Appearance routing is immutable' USING ERRCODE='23514'; END IF;
  IF ROW(NEW.asset_id,NEW.representation_id,NEW.policy_revision) IS DISTINCT FROM ROW(OLD.asset_id,OLD.representation_id,OLD.policy_revision) THEN
   IF NEW.last_changed_at_profile_version<>current_version OR current_version<=OLD.last_changed_at_profile_version
    THEN RAISE EXCEPTION 'Appearance change requires the advanced profile version' USING ERRCODE='23514'; END IF;
  ELSIF NEW.last_changed_at_profile_version<>OLD.last_changed_at_profile_version
   THEN RAISE EXCEPTION 'Appearance marker requires a pointer change' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.asset_id IS NOT NULL AND NEW.kind='storefront.logo' AND NOT EXISTS(
  SELECT 1 FROM asset_objects WHERE asset_id=NEW.asset_id AND representation_id=NEW.representation_id
   AND scope_id=NEW.scope_id AND policy_revision=NEW.policy_revision AND purpose='storefront.product-photo' AND pixel_width=pixel_height)
 THEN RAISE EXCEPTION 'Logo must be square' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER preserve_storefront_appearance_target BEFORE INSERT OR UPDATE OR DELETE ON commerce_storefront_appearance_targets
 FOR EACH ROW EXECUTE FUNCTION preserve_storefront_appearance_target();
CREATE TRIGGER reject_fenced_asset_reference BEFORE INSERT OR UPDATE ON commerce_storefront_appearance_targets
 FOR EACH ROW EXECUTE FUNCTION reject_fenced_asset_reference();

CREATE FUNCTION storefront_appearance_document_valid(doc jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE role text; image jsonb; field text;
BEGIN
 IF jsonb_typeof(doc) IS DISTINCT FROM 'object' OR octet_length(doc::text)>16384
  OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(doc) k)
    IS DISTINCT FROM ARRAY['accent_preset','announcement','cover','featured_product_ids','featured_skus','logo','profile']
  OR doc->>'profile' IS DISTINCT FROM 'freedom.hosted-store-appearance/v1'
  OR jsonb_typeof(doc->'accent_preset') IS DISTINCT FROM 'string'
  OR doc->>'accent_preset' NOT IN ('lime','forest','ocean','indigo','rose','terracotta','gold','graphite')
  OR jsonb_typeof(doc->'announcement') IS DISTINCT FROM 'string'
  OR NOT storefront_announcement_valid(doc->>'announcement')
 THEN RETURN false; END IF;
 FOREACH field IN ARRAY ARRAY['featured_product_ids','featured_skus'] LOOP
  IF jsonb_typeof(doc->field) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(doc->field)>8 OR EXISTS(SELECT 1 FROM jsonb_array_elements(doc->field) x
   WHERE jsonb_typeof(x)<>'string' OR (field='featured_product_ids' AND x#>>'{}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    OR (field='featured_skus' AND x#>>'{}' !~ '^P[0-9]{4,23}$'))
   OR jsonb_array_length(doc->field)<>(SELECT count(DISTINCT x) FROM jsonb_array_elements(doc->field) x)
  THEN RETURN false; END IF;
 END LOOP;
 FOREACH role IN ARRAY ARRAY['cover','logo'] LOOP
  image:=doc->role;
  IF image='null'::jsonb THEN CONTINUE; END IF;
  IF jsonb_typeof(image) IS DISTINCT FROM 'object'
   OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(image) k)
    IS DISTINCT FROM ARRAY['asset_id','byte_size','content_type','height','policy_revision','purpose','representation_id','scope_id','sha256','transform_version','width']
  THEN RETURN false; END IF;
  FOREACH field IN ARRAY ARRAY['asset_id','representation_id','scope_id'] LOOP
   IF jsonb_typeof(image->field) IS DISTINCT FROM 'string' OR image->>field !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
  END LOOP;
  IF image->>'purpose' IS DISTINCT FROM 'storefront.product-photo' OR image->>'content_type' IS DISTINCT FROM 'image/webp'
   OR image->>'transform_version' IS DISTINCT FROM 'storefront.product-photo.webp.v1'
   OR jsonb_typeof(image->'policy_revision') IS DISTINCT FROM 'string' OR char_length(image->>'policy_revision') NOT BETWEEN 1 AND 160
   OR jsonb_typeof(image->'sha256') IS DISTINCT FROM 'string' OR image->>'sha256' !~ '^[0-9a-f]{64}$'
  THEN RETURN false; END IF;
  FOREACH field IN ARRAY ARRAY['byte_size','width','height'] LOOP
   IF jsonb_typeof(image->field) IS DISTINCT FROM 'number' OR image->>field !~ '^[1-9][0-9]{0,6}$' THEN RETURN false; END IF;
  END LOOP;
  IF (image->>'byte_size')::integer>1048576 OR (image->>'width')::integer>1920 OR (image->>'height')::integer>1920
   OR (role='logo' AND image->'width'<>image->'height') THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;

CREATE TABLE commerce_publication_appearances (
 publication_id uuid PRIMARY KEY, tenant_id uuid NOT NULL, instance_id uuid NOT NULL,
 document jsonb NOT NULL CHECK(storefront_appearance_document_valid(document)),
 appearance_sha256 text NOT NULL CHECK(appearance_sha256 ~ '^[0-9a-f]{64}$'),
 UNIQUE(publication_id,tenant_id,instance_id),
 FOREIGN KEY(publication_id,tenant_id,instance_id)
  REFERENCES commerce_storefront_publications(publication_id,tenant_id,instance_id)
);
CREATE TABLE commerce_publication_appearance_refs (
 publication_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('cover','logo')),
 tenant_id uuid NOT NULL, instance_id uuid NOT NULL, scope_id uuid NOT NULL,
 scope_kind text GENERATED ALWAYS AS ('tenant'::text) STORED,
 asset_id uuid NOT NULL, representation_id uuid NOT NULL, policy_revision text NOT NULL,
 purpose text GENERATED ALWAYS AS ('storefront.product-photo'::text) STORED,
 asset_state text GENERATED ALWAYS AS ('ready'::text) STORED,
 content_type text NOT NULL, byte_size integer NOT NULL, content_sha256 text NOT NULL,
 transform_version text NOT NULL, width integer NOT NULL, height integer NOT NULL,
 PRIMARY KEY(publication_id,kind),
 FOREIGN KEY(publication_id,tenant_id,instance_id)
  REFERENCES commerce_publication_appearances(publication_id,tenant_id,instance_id),
 FOREIGN KEY(scope_id,scope_kind,tenant_id) REFERENCES resource_scopes(scope_id,kind,tenant_ref),
 FOREIGN KEY(asset_id,scope_id,tenant_id,purpose,representation_id,asset_state)
  REFERENCES assets(asset_id,scope_id,tenant_ref,purpose,representation_id,state),
 FOREIGN KEY(asset_id,scope_id,representation_id,policy_revision,purpose)
  REFERENCES asset_objects(asset_id,scope_id,representation_id,policy_revision,purpose),
 CHECK(kind<>'logo' OR width=height)
);
CREATE FUNCTION preserve_publication_appearance() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Published appearance is immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER preserve_publication_appearance BEFORE UPDATE OR DELETE ON commerce_publication_appearances
 FOR EACH ROW EXECUTE FUNCTION preserve_publication_appearance();
CREATE FUNCTION preserve_publication_appearance_ref() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE object asset_objects%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Published appearance media is immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO STRICT object FROM asset_objects WHERE asset_id=NEW.asset_id AND scope_id=NEW.scope_id
  AND representation_id=NEW.representation_id AND policy_revision=NEW.policy_revision AND purpose='storefront.product-photo';
 IF (NEW.content_type IS NOT NULL AND NEW.content_type IS DISTINCT FROM object.content_type)
  OR (NEW.byte_size IS NOT NULL AND NEW.byte_size IS DISTINCT FROM object.byte_size)
  OR (NEW.content_sha256 IS NOT NULL AND NEW.content_sha256 IS DISTINCT FROM object.content_sha256)
  OR (NEW.transform_version IS NOT NULL AND NEW.transform_version IS DISTINCT FROM object.transform_version)
  OR (NEW.width IS NOT NULL AND NEW.width IS DISTINCT FROM object.pixel_width)
  OR (NEW.height IS NOT NULL AND NEW.height IS DISTINCT FROM object.pixel_height)
 THEN RAISE EXCEPTION 'Appearance metadata must match its representation' USING ERRCODE='23514'; END IF;
 NEW.content_type:=object.content_type; NEW.byte_size:=object.byte_size; NEW.content_sha256:=object.content_sha256;
 NEW.transform_version:=object.transform_version; NEW.width:=object.pixel_width; NEW.height:=object.pixel_height;
 RETURN NEW;
END $$;
CREATE TRIGGER preserve_publication_appearance_ref BEFORE INSERT OR UPDATE OR DELETE ON commerce_publication_appearance_refs
 FOR EACH ROW EXECUTE FUNCTION preserve_publication_appearance_ref();
CREATE TRIGGER reject_fenced_asset_reference BEFORE INSERT ON commerce_publication_appearance_refs
 FOR EACH ROW EXECUTE FUNCTION reject_fenced_asset_reference();

CREATE FUNCTION require_complete_publication_appearance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doc jsonb; projection jsonb; role text; actual jsonb;
BEGIN
 SELECT a.document,p.projection INTO STRICT doc,projection FROM commerce_publication_appearances a
  JOIN commerce_storefront_publications p USING(publication_id,tenant_id,instance_id)
  WHERE a.publication_id=NEW.publication_id;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(doc->'featured_skus') sku
  WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(projection->'products') product WHERE product->>'sku'=sku))
 THEN RAISE EXCEPTION 'Featured SKU must belong to its publication' USING ERRCODE='23514'; END IF;
 FOREACH role IN ARRAY ARRAY['cover','logo'] LOOP
  SELECT jsonb_build_object('asset_id',r.asset_id,'representation_id',r.representation_id,'scope_id',r.scope_id,
   'policy_revision',r.policy_revision,'purpose',r.purpose,'transform_version',r.transform_version,
   'content_type',r.content_type,'byte_size',r.byte_size,'width',r.width,'height',r.height,'sha256',r.content_sha256)
   INTO actual FROM commerce_publication_appearance_refs r JOIN assets a ON a.asset_id=r.asset_id AND a.deletion_fence=0
   WHERE r.publication_id=NEW.publication_id AND r.kind=role;
  IF COALESCE(actual,'null'::jsonb) IS DISTINCT FROM doc->role
   THEN RAISE EXCEPTION 'Appearance document and references must agree' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER require_complete_publication_appearance AFTER INSERT ON commerce_publication_appearances
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_complete_publication_appearance();
CREATE CONSTRAINT TRIGGER require_complete_publication_appearance AFTER INSERT ON commerce_publication_appearance_refs
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_complete_publication_appearance();
CREATE FUNCTION require_unfenced_appearance_target() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM commerce_storefront_appearance_targets t JOIN assets a USING(asset_id)
  WHERE t.tenant_id=NEW.tenant_id AND t.instance_id=NEW.instance_id AND t.kind=NEW.kind AND a.deletion_fence<>0)
 THEN RAISE EXCEPTION 'Appearance reference is fenced' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER require_unfenced_appearance_target AFTER INSERT OR UPDATE ON commerce_storefront_appearance_targets
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_unfenced_appearance_target();

ALTER TABLE asset_upload_intents ADD COLUMN target_appearance_id uuid;
ALTER TABLE asset_upload_intents ADD CONSTRAINT upload_storefront_appearance_target
 FOREIGN KEY(target_appearance_id,target_tenant_id,scope_id,target_kind)
 REFERENCES commerce_storefront_appearance_targets(instance_id,tenant_id,scope_id,kind);
CREATE FUNCTION preserve_storefront_appearance_intent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.target_appearance_id IS DISTINCT FROM OLD.target_appearance_id
 THEN RAISE EXCEPTION 'Appearance intent routing is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER preserve_storefront_appearance_intent BEFORE UPDATE ON asset_upload_intents
 FOR EACH ROW EXECUTE FUNCTION preserve_storefront_appearance_intent();
-- Like 172, wrap the exact installed predicates. Unlike a purpose addition,
-- no Asset/admission/policy/profile predicate needs replacement. Abort on drift.
DO $$DECLARE old_expr text; name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['upload_profile_shape','tenant_upload_identity'] LOOP
  SELECT pg_get_expr(conbin,conrelid) INTO STRICT old_expr FROM pg_constraint
   WHERE conrelid='asset_upload_intents'::regclass AND conname=name AND contype='c' AND convalidated;
  IF strpos(old_expr,'storefront.distribution-photo')=0 OR strpos(old_expr,'storefront.supply-material')=0
   OR strpos(old_expr,'target_appearance_id')<>0 OR strpos(old_expr,'storefront.cover')<>0 OR strpos(old_expr,'storefront.logo')<>0
  THEN RAISE EXCEPTION 'Unexpected appearance intent baseline'; END IF;
  EXECUTE format('ALTER TABLE asset_upload_intents DROP CONSTRAINT %I',name);
  EXECUTE format($shape$ALTER TABLE asset_upload_intents ADD CONSTRAINT %I CHECK(
   ((%s) AND target_appearance_id IS NULL AND target_kind NOT IN ('storefront.cover','storefront.logo'))
   OR (target_kind IN ('storefront.cover','storefront.logo') AND purpose='storefront.product-photo'
    AND target_appearance_id IS NOT NULL AND target_appearance_id=target_instance_id
    AND target_tenant_id IS NOT NULL AND target_instance_id IS NOT NULL
    AND target_product_id IS NULL AND target_distribution_product_id IS NULL AND target_material_id IS NULL
    AND target_ar_id IS NULL AND target_work_id IS NULL AND target_service_id IS NULL AND target_event_id IS NULL
    AND target_video_event_id IS NULL AND target_post_id IS NULL AND target_submission_id IS NULL
    AND target_highlight_media_id IS NULL AND target_message_image_id IS NULL AND target_comment_image_id IS NULL
    AND target_community_id IS NULL AND display_name IS NULL AND source_orientation IS NULL
    AND source_content_type IN ('image/png','image/jpeg','image/webp')
    AND source_byte_size BETWEEN 1 AND 2097152 AND reserved_bytes=1048576))$shape$,name,old_expr);
 END LOOP;
END $$;

DO $$DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['commerce_storefront_appearance_drafts','commerce_storefront_appearance_targets',
  'commerce_publication_appearances','commerce_publication_appearance_refs'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO PUBLIC USING(tenant_id=freedom_ctx_tenant())',name||'_read',name);
  EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO PUBLIC WITH CHECK(tenant_id=freedom_ctx_tenant())',name||'_insert',name);
  IF name IN ('commerce_storefront_appearance_drafts','commerce_storefront_appearance_targets') THEN
   EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE TO PUBLIC USING(tenant_id=freedom_ctx_tenant()) WITH CHECK(tenant_id=freedom_ctx_tenant())',name||'_update',name);
  END IF;
 END LOOP;
 -- All new invoker-rights functions resolve only the physical application schema.
 FOREACH name IN ARRAY ARRAY['storefront_appearance_ids_valid(uuid[])','storefront_announcement_valid(text)',
  'preserve_storefront_appearance_draft()','preserve_storefront_appearance_target()',
  'storefront_appearance_document_valid(jsonb)','preserve_publication_appearance()',
  'preserve_publication_appearance_ref()','require_complete_publication_appearance()',
  'require_unfenced_appearance_target()','preserve_storefront_appearance_intent()'] LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path=pg_catalog,%I',name,current_schema());
 END LOOP;
END $$;
-- Retain all targets, sidecars and refs indefinitely under OPEN-07. Any future
-- product-photo collector must count both new asset-referencing tables.
