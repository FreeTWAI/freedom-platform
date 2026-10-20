-- Provisional 174: explicit, revocable evaluation photos; no terms or activation changes.
CREATE TABLE commerce_hosted_offer_photos (
 offer_id uuid NOT NULL REFERENCES commerce_hosted_supply_offers(offer_id),
 seq bigint NOT NULL CHECK(seq>0),
 tenant_id uuid NOT NULL, instance_id uuid NOT NULL, item_id uuid NOT NULL,
 scope_id uuid, asset_id uuid, representation_id uuid, policy_revision text,
 scope_kind text GENERATED ALWAYS AS (CASE WHEN scope_id IS NOT NULL THEN 'tenant'::text END) STORED,
 purpose text GENERATED ALWAYS AS (CASE WHEN asset_id IS NOT NULL THEN 'storefront.product-photo'::text END) STORED,
 asset_state text GENERATED ALWAYS AS (CASE WHEN asset_id IS NOT NULL THEN 'ready'::text END) STORED,
 content_type text, byte_size integer, content_sha256 text, transform_version text, width integer, height integer,
 shared_by_principal_id uuid NOT NULL REFERENCES principals(principal_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(offer_id,seq),
 FOREIGN KEY(tenant_id,instance_id) REFERENCES commerce_storefront_profiles(tenant_id,instance_id),
 FOREIGN KEY(scope_id,scope_kind,tenant_id) REFERENCES resource_scopes(scope_id,kind,tenant_ref),
 FOREIGN KEY(asset_id,scope_id,tenant_id,purpose,representation_id,asset_state)
  REFERENCES assets(asset_id,scope_id,tenant_ref,purpose,representation_id,state),
 FOREIGN KEY(asset_id,scope_id,representation_id,policy_revision,purpose)
  REFERENCES asset_objects(asset_id,scope_id,representation_id,policy_revision,purpose),
 CONSTRAINT hosted_offer_photo_complete CHECK (
  (scope_id IS NULL AND asset_id IS NULL AND representation_id IS NULL AND policy_revision IS NULL
   AND content_type IS NULL AND byte_size IS NULL AND content_sha256 IS NULL AND transform_version IS NULL AND width IS NULL AND height IS NULL)
  OR (scope_id IS NOT NULL AND asset_id IS NOT NULL AND representation_id IS NOT NULL AND policy_revision IS NOT NULL
   AND content_type IS NOT NULL AND byte_size IS NOT NULL AND content_sha256 IS NOT NULL AND transform_version IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL))
);
CREATE INDEX commerce_hosted_offer_photos_tenant ON commerce_hosted_offer_photos(tenant_id,instance_id);

CREATE FUNCTION preserve_hosted_offer_photo() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE offer commerce_hosted_supply_offers%ROWTYPE; object asset_objects%ROWTYPE; next_seq bigint;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Offer photo history is append-only' USING ERRCODE='23514'; END IF;
 -- The offer lock serializes numbering even for direct concurrent INSERTs.
 SELECT * INTO STRICT offer FROM commerce_hosted_supply_offers WHERE offer_id=NEW.offer_id FOR UPDATE;
 IF ROW(NEW.tenant_id,NEW.instance_id,NEW.item_id) IS DISTINCT FROM ROW(offer.tenant_id,offer.instance_id,offer.item_id)
 THEN RAISE EXCEPTION 'Photo must belong to its exact offer' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(max(seq),0)+1 INTO next_seq FROM commerce_hosted_offer_photos WHERE offer_id=NEW.offer_id;
 IF NEW.seq<>next_seq THEN RAISE EXCEPTION 'Offer photo sequence must be contiguous' USING ERRCODE='23514'; END IF;
 -- Incomplete identities fall through to the all-null/all-set CHECK.
 IF NEW.scope_id IS NOT NULL AND NEW.asset_id IS NOT NULL AND NEW.representation_id IS NOT NULL AND NEW.policy_revision IS NOT NULL THEN
  IF offer.state<>'offered' THEN RAISE EXCEPTION 'Only an offered version can share a photo' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM commerce_product_photo_targets t
   WHERE t.tenant_id=NEW.tenant_id AND t.instance_id=NEW.instance_id AND t.product_id=NEW.item_id
    AND ROW(t.scope_id,t.asset_id,t.representation_id,t.policy_revision)=ROW(NEW.scope_id,NEW.asset_id,NEW.representation_id,NEW.policy_revision)
   FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Offer photo must be the current product photo' USING ERRCODE='23514'; END IF;
  SELECT * INTO STRICT object FROM asset_objects WHERE asset_id=NEW.asset_id AND scope_id=NEW.scope_id
   AND representation_id=NEW.representation_id AND policy_revision=NEW.policy_revision AND purpose='storefront.product-photo';
  IF (NEW.content_type IS NOT NULL AND NEW.content_type IS DISTINCT FROM object.content_type)
   OR (NEW.byte_size IS NOT NULL AND NEW.byte_size IS DISTINCT FROM object.byte_size)
   OR (NEW.content_sha256 IS NOT NULL AND NEW.content_sha256 IS DISTINCT FROM object.content_sha256)
   OR (NEW.transform_version IS NOT NULL AND NEW.transform_version IS DISTINCT FROM object.transform_version)
   OR (NEW.width IS NOT NULL AND NEW.width IS DISTINCT FROM object.pixel_width)
   OR (NEW.height IS NOT NULL AND NEW.height IS DISTINCT FROM object.pixel_height)
  THEN RAISE EXCEPTION 'Offer photo metadata must match its representation' USING ERRCODE='23514'; END IF;
  NEW.content_type:=object.content_type; NEW.byte_size:=object.byte_size; NEW.content_sha256:=object.content_sha256;
  NEW.transform_version:=object.transform_version; NEW.width:=object.pixel_width; NEW.height:=object.pixel_height;
 END IF;
 RETURN NEW;
END $$;
DO $$BEGIN
 EXECUTE format('ALTER FUNCTION %I.preserve_hosted_offer_photo() SET search_path=pg_catalog,%I',current_schema(),current_schema());
END $$;
CREATE TRIGGER preserve_hosted_offer_photo BEFORE INSERT OR UPDATE OR DELETE ON commerce_hosted_offer_photos
 FOR EACH ROW EXECUTE FUNCTION preserve_hosted_offer_photo();
CREATE TRIGGER reject_fenced_asset_reference BEFORE INSERT ON commerce_hosted_offer_photos
 FOR EACH ROW EXECUTE FUNCTION reject_fenced_asset_reference();
ALTER TABLE commerce_hosted_offer_photos ENABLE ROW LEVEL SECURITY;
-- Invoker-rights EXISTS deliberately inherits the offers table's SELECT policy.
CREATE POLICY commerce_hosted_offer_photos_read ON commerce_hosted_offer_photos FOR SELECT TO PUBLIC
 USING(tenant_id=freedom_ctx_tenant() OR EXISTS(SELECT 1 FROM commerce_hosted_supply_offers o WHERE o.offer_id=commerce_hosted_offer_photos.offer_id));
CREATE POLICY commerce_hosted_offer_photos_insert ON commerce_hosted_offer_photos FOR INSERT TO PUBLIC
 WITH CHECK(tenant_id=freedom_ctx_tenant());
-- All history pins its exact supplier Asset. Photo GC remains uninstalled;
-- any future collector must count this table before claiming a deletion fence.
