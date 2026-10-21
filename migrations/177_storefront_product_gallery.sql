-- Additive C1 gallery. No backfill, activation, new purpose, GC or legacy writer trigger.
-- Serialize the exact predecessor check before adding any object. PostgreSQL18
-- pg_get_constraintdef bytes from the installed schema176 are intentionally pinned.
LOCK TABLE asset_upload_intents IN ACCESS EXCLUSIVE MODE;
DO $$DECLARE entry record; actual text;
BEGIN
 FOR entry IN SELECT * FROM (VALUES
  ('upload_profile_shape','0328ebf3cb958112b23b73b4bc8d559a9b51c1b394a0fcc56eafa778188d40ea'),
  ('tenant_upload_identity','962d6eb53fb4a3a99fa757cb8b3594ccdb424485825b1cd7c3579980655180a3')) AS checks(name,sha256)
 LOOP
  SELECT encode(sha256(convert_to(pg_get_constraintdef(oid,false),'UTF8')),'hex') INTO STRICT actual
   FROM pg_constraint WHERE conrelid='asset_upload_intents'::regclass AND conname=entry.name AND contype='c' AND convalidated;
  IF actual<>entry.sha256 THEN RAISE EXCEPTION 'Unexpected gallery intent baseline'; END IF;
 END LOOP;
END $$;

CREATE FUNCTION storefront_gallery_alt_valid(value text) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT value IS NOT NULL AND char_length(value)<=120
  AND value !~ U&'[\0001-\001f\007f-\009f\061c\200e\200f\2028\2029\202a-\202e\2066-\2069]'
  AND value=btrim(value,U&'\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\202f\205f\3000\feff')
$$;
CREATE FUNCTION storefront_gallery_product_version(t uuid,i uuid,p uuid) RETURNS bigint LANGUAGE sql STABLE AS $$
 SELECT s.aggregate_version FROM commerce_storefront_profiles f
 JOIN commerce_items a ON a.shop_id=f.supply_shop_id AND a.item_id=p
 JOIN commerce_selections s ON s.shop_id=f.storefront_shop_id AND s.item_id=a.item_id
 JOIN commerce_shops supply ON supply.shop_id=a.shop_id AND supply.origin='hosted'
 JOIN commerce_shops retail ON retail.shop_id=s.shop_id AND retail.origin='hosted'
 JOIN commerce_resource_tenants x ON x.resource_kind='shop' AND x.resource_id=a.shop_id AND x.tenant_id=f.tenant_id AND x.instance_id=f.instance_id AND x.mapping_state='confirmed'
 JOIN commerce_resource_tenants y ON y.resource_kind='shop' AND y.resource_id=s.shop_id AND y.tenant_id=f.tenant_id AND y.instance_id=f.instance_id AND y.mapping_state='confirmed'
 WHERE f.tenant_id=t AND f.instance_id=i
$$;
CREATE TABLE commerce_product_groups (
 group_id uuid PRIMARY KEY, tenant_id uuid NOT NULL, instance_id uuid NOT NULL, scope_id uuid NOT NULL,
 scope_kind text GENERATED ALWAYS AS ('tenant'::text) STORED, anchor_product_id uuid NOT NULL,
 main_alt_identity_sha256 text CHECK(main_alt_identity_sha256 ~ '^[0-9a-f]{64}$'),
 main_alt_text text NOT NULL DEFAULT '' CHECK(storefront_gallery_alt_valid(main_alt_text)),
 last_changed_at_product_version bigint NOT NULL CHECK(last_changed_at_product_version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(main_alt_identity_sha256 IS NOT NULL OR main_alt_text=''),
 UNIQUE(tenant_id,instance_id,anchor_product_id),UNIQUE(group_id,tenant_id,instance_id,scope_id),
 FOREIGN KEY(tenant_id,instance_id) REFERENCES commerce_storefront_profiles(tenant_id,instance_id),
 FOREIGN KEY(scope_id,scope_kind,tenant_id) REFERENCES resource_scopes(scope_id,kind,tenant_ref),
 FOREIGN KEY(anchor_product_id,tenant_id,instance_id,scope_id) REFERENCES commerce_product_photo_targets(product_id,tenant_id,instance_id,scope_id)
);
CREATE TABLE commerce_product_group_members (
 tenant_id uuid NOT NULL,instance_id uuid NOT NULL,scope_id uuid NOT NULL,group_id uuid NOT NULL,
 selection_id uuid NOT NULL,product_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,instance_id,selection_id),
 UNIQUE(group_id,tenant_id,instance_id,product_id,scope_id),
 FOREIGN KEY(group_id,tenant_id,instance_id,scope_id) REFERENCES commerce_product_groups(group_id,tenant_id,instance_id,scope_id),
 FOREIGN KEY(product_id,tenant_id,instance_id,scope_id) REFERENCES commerce_product_photo_targets(product_id,tenant_id,instance_id,scope_id)
);
CREATE TABLE commerce_product_gallery_photos (
 photo_id uuid PRIMARY KEY,tenant_id uuid NOT NULL,instance_id uuid NOT NULL,scope_id uuid NOT NULL,
 group_id uuid NOT NULL,product_id uuid NOT NULL,scope_kind text GENERATED ALWAYS AS ('tenant'::text) STORED,
 position smallint CHECK(position BETWEEN 2 AND 8),alt_text text NOT NULL DEFAULT '' CHECK(storefront_gallery_alt_valid(alt_text)),
 asset_id uuid,representation_id uuid,policy_revision text,
 purpose text GENERATED ALWAYS AS ('storefront.product-photo'::text) STORED,
 asset_state text GENERATED ALWAYS AS ('ready'::text) STORED,
 last_changed_at_product_version bigint NOT NULL CHECK(last_changed_at_product_version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(photo_id,tenant_id,instance_id,scope_id),
 FOREIGN KEY(group_id,tenant_id,instance_id,product_id,scope_id) REFERENCES commerce_product_group_members(group_id,tenant_id,instance_id,product_id,scope_id),
 FOREIGN KEY(scope_id,scope_kind,tenant_id) REFERENCES resource_scopes(scope_id,kind,tenant_ref),
 FOREIGN KEY(asset_id,scope_id,tenant_id,purpose,representation_id,asset_state) REFERENCES assets(asset_id,scope_id,tenant_ref,purpose,representation_id,state),
 FOREIGN KEY(asset_id,scope_id,representation_id,policy_revision,purpose) REFERENCES asset_objects(asset_id,scope_id,representation_id,policy_revision,purpose),
 CHECK((asset_id IS NULL AND representation_id IS NULL AND policy_revision IS NULL AND position IS NULL)
  OR (asset_id IS NOT NULL AND representation_id IS NOT NULL AND policy_revision IS NOT NULL))
);
CREATE UNIQUE INDEX gallery_active_position ON commerce_product_gallery_photos(group_id,position) WHERE position IS NOT NULL;
CREATE UNIQUE INDEX gallery_active_representation ON commerce_product_gallery_photos(group_id,asset_id,representation_id,policy_revision) WHERE position IS NOT NULL;
-- Primary swaps reuse an existing retained representation without scanning the
-- product's growing history. Neither this index nor the active index is a GC list.
CREATE INDEX gallery_retained_representation ON commerce_product_gallery_photos(group_id,asset_id,representation_id,policy_revision,created_at,photo_id)
 WHERE position IS NULL AND asset_id IS NOT NULL;
CREATE FUNCTION preserve_storefront_gallery_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Gallery routing is retained' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='commerce_product_groups' THEN
  IF TG_OP='UPDATE' AND ROW(NEW.group_id,NEW.tenant_id,NEW.instance_id,NEW.scope_id,NEW.anchor_product_id,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.group_id,OLD.tenant_id,OLD.instance_id,OLD.scope_id,OLD.anchor_product_id,OLD.created_at)
   THEN RAISE EXCEPTION 'Gallery routing is immutable' USING ERRCODE='23514';END IF;
  v:=storefront_gallery_product_version(NEW.tenant_id,NEW.instance_id,NEW.anchor_product_id);NEW.updated_at:=clock_timestamp();
 ELSE
  IF TG_OP='UPDATE' AND (ROW(NEW.photo_id,NEW.tenant_id,NEW.instance_id,NEW.scope_id,NEW.group_id,NEW.product_id,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.photo_id,OLD.tenant_id,OLD.instance_id,OLD.scope_id,OLD.group_id,OLD.product_id,OLD.created_at)
   OR (OLD.asset_id IS NOT NULL AND ROW(NEW.asset_id,NEW.representation_id,NEW.policy_revision) IS DISTINCT FROM ROW(OLD.asset_id,OLD.representation_id,OLD.policy_revision)))
   THEN RAISE EXCEPTION 'Gallery image identity is immutable' USING ERRCODE='23514';END IF;
  v:=storefront_gallery_product_version(NEW.tenant_id,NEW.instance_id,NEW.product_id);
 END IF;
 IF v IS NULL OR NEW.last_changed_at_product_version<>v THEN RAISE EXCEPTION 'Gallery requires current own product version' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER preserve_storefront_gallery_draft BEFORE INSERT OR UPDATE OR DELETE ON commerce_product_groups FOR EACH ROW EXECUTE FUNCTION preserve_storefront_gallery_draft();
CREATE TRIGGER preserve_storefront_gallery_draft BEFORE INSERT OR UPDATE OR DELETE ON commerce_product_gallery_photos FOR EACH ROW EXECUTE FUNCTION preserve_storefront_gallery_draft();
CREATE FUNCTION preserve_storefront_gallery_member() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Gallery membership is retained and immutable' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM commerce_product_groups g JOIN commerce_storefront_profiles f ON f.tenant_id=g.tenant_id AND f.instance_id=g.instance_id
  JOIN commerce_selections s ON s.shop_id=f.storefront_shop_id AND s.item_id=g.anchor_product_id
  WHERE g.group_id=NEW.group_id AND g.tenant_id=NEW.tenant_id AND g.instance_id=NEW.instance_id AND g.scope_id=NEW.scope_id
  AND g.anchor_product_id=NEW.product_id AND s.selection_id=NEW.selection_id
  AND storefront_gallery_product_version(NEW.tenant_id,NEW.instance_id,NEW.product_id) IS NOT NULL)
 THEN RAISE EXCEPTION 'Gallery member must be the current own selection' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER preserve_storefront_gallery_member BEFORE INSERT OR UPDATE OR DELETE ON commerce_product_group_members FOR EACH ROW EXECUTE FUNCTION preserve_storefront_gallery_member();
CREATE TRIGGER reject_fenced_asset_reference BEFORE INSERT OR UPDATE ON commerce_product_gallery_photos FOR EACH ROW EXECUTE FUNCTION reject_fenced_asset_reference();

CREATE FUNCTION storefront_gallery_document_valid(doc jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE product jsonb;photo jsonb;n integer;
BEGIN
 IF jsonb_typeof(doc) IS DISTINCT FROM 'object' OR doc->>'profile' IS DISTINCT FROM 'freedom.hosted-store-gallery/v1'
  OR (SELECT count(*) FROM jsonb_object_keys(doc))<>2 OR jsonb_typeof(doc->'products') IS DISTINCT FROM 'array'
  OR jsonb_array_length(doc->'products')>200 OR octet_length(doc::text)>4194304 THEN RETURN false;END IF;
 IF (SELECT count(DISTINCT p->>'sku') FROM jsonb_array_elements(doc->'products') p)<>jsonb_array_length(doc->'products') THEN RETURN false;END IF;
 FOR product IN SELECT * FROM jsonb_array_elements(doc->'products') LOOP
  IF jsonb_typeof(product) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(product))<>2
   OR jsonb_typeof(product->'sku') IS DISTINCT FROM 'string' OR product->>'sku' !~ '^P[0-9]{4,23}$'
   OR jsonb_typeof(product->'photos') IS DISTINCT FROM 'array' OR jsonb_array_length(product->'photos')>8 THEN RETURN false;END IF;
  n:=0;
  FOR photo IN SELECT * FROM jsonb_array_elements(product->'photos') LOOP
   n:=n+1;
   IF jsonb_typeof(photo) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(photo))<>3
    OR jsonb_typeof(photo->'position') IS DISTINCT FROM 'number' OR photo->>'position' IS DISTINCT FROM n::text
    OR jsonb_typeof(photo->'alt_text') IS DISTINCT FROM 'string' OR NOT storefront_gallery_alt_valid(photo->>'alt_text')
    OR jsonb_typeof(photo->'ref') IS DISTINCT FROM 'object' THEN RETURN false;END IF;
  END LOOP;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE TABLE commerce_publication_galleries (
 publication_id uuid PRIMARY KEY,tenant_id uuid NOT NULL,instance_id uuid NOT NULL,
 document jsonb NOT NULL CHECK(storefront_gallery_document_valid(document)),gallery_sha256 text NOT NULL CHECK(gallery_sha256 ~ '^[0-9a-f]{64}$'),
 UNIQUE(publication_id,tenant_id,instance_id),
 FOREIGN KEY(publication_id,tenant_id,instance_id) REFERENCES commerce_storefront_publications(publication_id,tenant_id,instance_id)
);
CREATE TABLE commerce_publication_gallery_refs (
 publication_id uuid NOT NULL,sku text NOT NULL CHECK(sku ~ '^P[0-9]{4,23}$'),position smallint NOT NULL CHECK(position BETWEEN 1 AND 8),
 tenant_id uuid NOT NULL,instance_id uuid NOT NULL,scope_id uuid NOT NULL,scope_kind text GENERATED ALWAYS AS ('tenant'::text) STORED,
 alt_text text NOT NULL DEFAULT '' CHECK(storefront_gallery_alt_valid(alt_text)),asset_id uuid NOT NULL,representation_id uuid NOT NULL,policy_revision text NOT NULL,
 purpose text GENERATED ALWAYS AS ('storefront.product-photo'::text) STORED,asset_state text GENERATED ALWAYS AS ('ready'::text) STORED,
 content_type text NOT NULL,byte_size integer NOT NULL,content_sha256 text NOT NULL,transform_version text NOT NULL,width integer NOT NULL,height integer NOT NULL,
 PRIMARY KEY(publication_id,sku,position),
 FOREIGN KEY(publication_id,tenant_id,instance_id) REFERENCES commerce_publication_galleries(publication_id,tenant_id,instance_id),
 FOREIGN KEY(publication_id,tenant_id,instance_id) REFERENCES commerce_storefront_publications(publication_id,tenant_id,instance_id),
 FOREIGN KEY(scope_id,scope_kind,tenant_id) REFERENCES resource_scopes(scope_id,kind,tenant_ref),
 FOREIGN KEY(asset_id,scope_id,tenant_id,purpose,representation_id,asset_state) REFERENCES assets(asset_id,scope_id,tenant_ref,purpose,representation_id,state),
 FOREIGN KEY(asset_id,scope_id,representation_id,policy_revision,purpose) REFERENCES asset_objects(asset_id,scope_id,representation_id,policy_revision,purpose)
);
CREATE FUNCTION preserve_publication_gallery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Published galleries are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER preserve_publication_gallery BEFORE UPDATE OR DELETE ON commerce_publication_galleries FOR EACH ROW EXECUTE FUNCTION preserve_publication_gallery();
CREATE FUNCTION preserve_publication_gallery_ref() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o asset_objects%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Published gallery photos are immutable' USING ERRCODE='23514';END IF;
 SELECT * INTO STRICT o FROM asset_objects WHERE asset_id=NEW.asset_id AND scope_id=NEW.scope_id AND representation_id=NEW.representation_id
  AND policy_revision=NEW.policy_revision AND purpose='storefront.product-photo';
 IF (NEW.content_type IS NOT NULL AND NEW.content_type IS DISTINCT FROM o.content_type)
  OR (NEW.byte_size IS NOT NULL AND NEW.byte_size IS DISTINCT FROM o.byte_size)
  OR (NEW.content_sha256 IS NOT NULL AND NEW.content_sha256 IS DISTINCT FROM o.content_sha256)
  OR (NEW.transform_version IS NOT NULL AND NEW.transform_version IS DISTINCT FROM o.transform_version)
  OR (NEW.width IS NOT NULL AND NEW.width IS DISTINCT FROM o.pixel_width) OR (NEW.height IS NOT NULL AND NEW.height IS DISTINCT FROM o.pixel_height)
 THEN RAISE EXCEPTION 'Gallery metadata must match the representation' USING ERRCODE='23514';END IF;
 NEW.content_type:=o.content_type;NEW.byte_size:=o.byte_size;NEW.content_sha256:=o.content_sha256;NEW.transform_version:=o.transform_version;NEW.width:=o.pixel_width;NEW.height:=o.pixel_height;
 RETURN NEW;
END $$;
CREATE TRIGGER preserve_publication_gallery_ref BEFORE INSERT OR UPDATE OR DELETE ON commerce_publication_gallery_refs FOR EACH ROW EXECUTE FUNCTION preserve_publication_gallery_ref();
CREATE TRIGGER reject_fenced_asset_reference BEFORE INSERT ON commerce_publication_gallery_refs FOR EACH ROW EXECUTE FUNCTION reject_fenced_asset_reference();
CREATE FUNCTION require_complete_publication_gallery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doc jsonb;projection jsonb;product jsonb;actual jsonb;primary_ref jsonb;selected_sku text;
BEGIN
 SELECT g.document,p.projection INTO STRICT doc,projection FROM commerce_publication_galleries g JOIN commerce_storefront_publications p USING(publication_id,tenant_id,instance_id)
  WHERE g.publication_id=NEW.publication_id AND g.tenant_id=NEW.tenant_id AND g.instance_id=NEW.instance_id;
 IF TG_TABLE_NAME='commerce_publication_galleries' THEN
  IF jsonb_array_length(doc->'products')<>jsonb_array_length(projection->'products') OR EXISTS(
   SELECT 1 FROM jsonb_array_elements(doc->'products') a WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(projection->'products') b WHERE b->>'sku'=a->>'sku'))
  THEN RAISE EXCEPTION 'Gallery SKUs must match the publication' USING ERRCODE='23514';END IF;
 ELSE selected_sku:=NEW.sku;
 END IF;
 FOR product IN SELECT p FROM jsonb_array_elements(doc->'products') p
  WHERE selected_sku IS NULL OR p->>'sku'=selected_sku LOOP
  SELECT COALESCE(jsonb_agg(jsonb_build_object('position',r.position,'alt_text',r.alt_text,'ref',jsonb_build_object(
   'asset_id',r.asset_id,'representation_id',r.representation_id,'scope_id',r.scope_id,'policy_revision',r.policy_revision,'purpose',r.purpose,
   'transform_version',r.transform_version,'content_type',r.content_type,'byte_size',r.byte_size,'width',r.width,'height',r.height,'sha256',r.content_sha256)) ORDER BY r.position),'[]'::jsonb)
   INTO actual FROM commerce_publication_gallery_refs r JOIN assets a ON a.asset_id=r.asset_id AND a.deletion_fence=0
   WHERE r.publication_id=NEW.publication_id AND r.sku=product->>'sku';
  IF actual IS DISTINCT FROM product->'photos' THEN RAISE EXCEPTION 'Gallery document and refs must agree' USING ERRCODE='23514';END IF;
  SELECT jsonb_build_object('asset_id',r.asset_id,'representation_id',r.representation_id,'scope_id',r.scope_id,'policy_revision',r.policy_revision,'purpose',r.purpose,
   'transform_version',r.transform_version,'content_type',r.content_type,'byte_size',r.byte_size,'width',r.width,'height',r.height,'sha256',r.content_sha256)
   INTO primary_ref FROM commerce_publication_photo_refs r WHERE r.publication_id=NEW.publication_id AND r.sku=product->>'sku';
  IF primary_ref IS DISTINCT FROM actual#>'{0,ref}' THEN RAISE EXCEPTION 'Gallery primary must match the legacy primary' USING ERRCODE='23514';END IF;
 END LOOP;
 IF selected_sku IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(doc->'products') p WHERE p->>'sku'=selected_sku)
 THEN RAISE EXCEPTION 'Gallery SKU must belong to its publication' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER require_complete_publication_gallery AFTER INSERT ON commerce_publication_galleries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_complete_publication_gallery();
CREATE CONSTRAINT TRIGGER require_complete_publication_gallery AFTER INSERT ON commerce_publication_gallery_refs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_complete_publication_gallery();
CREATE FUNCTION require_unfenced_gallery_photo() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM commerce_product_gallery_photos p JOIN assets a USING(asset_id) WHERE p.photo_id=NEW.photo_id AND a.deletion_fence<>0)
 THEN RAISE EXCEPTION 'Gallery photo is fenced' USING ERRCODE='23514';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER require_unfenced_gallery_photo AFTER INSERT OR UPDATE ON commerce_product_gallery_photos DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_unfenced_gallery_photo();

ALTER TABLE asset_upload_intents ADD COLUMN target_gallery_photo_id uuid;
ALTER TABLE asset_upload_intents ADD CONSTRAINT upload_storefront_gallery_target FOREIGN KEY(target_gallery_photo_id,target_tenant_id,target_instance_id,scope_id)
 REFERENCES commerce_product_gallery_photos(photo_id,tenant_id,instance_id,scope_id);
CREATE FUNCTION preserve_storefront_gallery_intent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.target_gallery_photo_id IS DISTINCT FROM OLD.target_gallery_photo_id THEN RAISE EXCEPTION 'Gallery intent routing is immutable' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER preserve_storefront_gallery_intent BEFORE UPDATE ON asset_upload_intents FOR EACH ROW EXECUTE FUNCTION preserve_storefront_gallery_intent();
DO $$DECLARE old_expr text;name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['upload_profile_shape','tenant_upload_identity'] LOOP
  SELECT pg_get_expr(conbin,conrelid,false) INTO STRICT old_expr FROM pg_constraint WHERE conrelid='asset_upload_intents'::regclass AND conname=name AND contype='c' AND convalidated;
  EXECUTE format('ALTER TABLE asset_upload_intents DROP CONSTRAINT %I',name);
  EXECUTE format($shape$ALTER TABLE asset_upload_intents ADD CONSTRAINT %I CHECK(
   ((%s) AND target_gallery_photo_id IS NULL AND target_kind<>'storefront.gallery-photo')
   OR (purpose='storefront.product-photo' AND target_kind='storefront.gallery-photo' AND target_gallery_photo_id IS NOT NULL
    AND target_tenant_id IS NOT NULL AND target_instance_id IS NOT NULL
    AND target_product_id IS NULL AND target_appearance_id IS NULL AND target_distribution_product_id IS NULL AND target_material_id IS NULL
    AND target_ar_id IS NULL AND target_work_id IS NULL AND target_service_id IS NULL AND target_event_id IS NULL AND target_video_event_id IS NULL
    AND target_post_id IS NULL AND target_submission_id IS NULL AND target_highlight_media_id IS NULL AND target_message_image_id IS NULL AND target_comment_image_id IS NULL
    AND target_community_id IS NULL AND display_name IS NULL AND source_orientation IS NULL
    AND source_content_type IN ('image/png','image/jpeg','image/webp') AND source_byte_size BETWEEN 1 AND 2097152 AND reserved_bytes=1048576))$shape$,name,old_expr);
 END LOOP;
END $$;
DO $$DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['commerce_product_groups','commerce_product_group_members','commerce_product_gallery_photos','commerce_publication_galleries','commerce_publication_gallery_refs'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO PUBLIC USING(tenant_id=freedom_ctx_tenant())',name||'_read',name);
  EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO PUBLIC WITH CHECK(tenant_id=freedom_ctx_tenant())',name||'_insert',name);
  IF name IN ('commerce_product_groups','commerce_product_gallery_photos') THEN
   EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE TO PUBLIC USING(tenant_id=freedom_ctx_tenant()) WITH CHECK(tenant_id=freedom_ctx_tenant())',name||'_update',name);
  END IF;
 END LOOP;
 FOREACH name IN ARRAY ARRAY['storefront_gallery_alt_valid(text)','storefront_gallery_product_version(uuid,uuid,uuid)','preserve_storefront_gallery_draft()',
  'preserve_storefront_gallery_member()','storefront_gallery_document_valid(jsonb)','preserve_publication_gallery()','preserve_publication_gallery_ref()',
  'require_complete_publication_gallery()','require_unfenced_gallery_photo()','preserve_storefront_gallery_intent()'] LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path=pg_catalog,%I',name,current_schema());
 END LOOP;
END $$;
-- Retention is OPEN-07 policy_undecided. Inactive rows, old snapshots and bytes
-- remain retained/charged. A future collector must count both new Asset ref tables.
