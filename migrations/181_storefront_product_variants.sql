-- Extend the lazy gallery home rows. No backfill and no change to item stock.
LOCK TABLE commerce_product_groups,commerce_product_group_members,commerce_product_gallery_photos IN ACCESS EXCLUSIVE MODE;
DO $$DECLARE r record;actual text;
BEGIN
 FOR r IN SELECT * FROM (VALUES
  ('preserve_storefront_gallery_draft','0f0b9ab9739dbd41a471c528572b8eaf7865f0a59863eb4cbff1236df9f71979'),
  ('preserve_storefront_gallery_member','3e5f1499d850f516ff14702241b0ebb9b4f774b30d3f3e8dbdb22e800acb9cc8')
 ) AS pins(name,sha256) LOOP
  SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') INTO STRICT actual FROM pg_proc
   WHERE oid=to_regprocedure(r.name||'()') AND NOT prosecdef AND provolatile='v'
    AND proconfig=ARRAY['search_path=pg_catalog, '||current_schema()];
  IF actual<>r.sha256 THEN RAISE EXCEPTION 'Unexpected variants trigger predecessor';END IF;
 END LOOP;
 FOR r IN SELECT * FROM (VALUES
  ('commerce_product_gallery_photos','preserve_storefront_gallery_draft','CREATE TRIGGER preserve_storefront_gallery_draft BEFORE INSERT OR DELETE OR UPDATE ON <schema>.commerce_product_gallery_photos FOR EACH ROW EXECUTE FUNCTION preserve_storefront_gallery_draft()'),
  ('commerce_product_group_members','preserve_storefront_gallery_member','CREATE TRIGGER preserve_storefront_gallery_member BEFORE INSERT OR DELETE OR UPDATE ON <schema>.commerce_product_group_members FOR EACH ROW EXECUTE FUNCTION preserve_storefront_gallery_member()'),
  ('commerce_product_groups','preserve_storefront_gallery_draft','CREATE TRIGGER preserve_storefront_gallery_draft BEFORE INSERT OR DELETE OR UPDATE ON <schema>.commerce_product_groups FOR EACH ROW EXECUTE FUNCTION preserve_storefront_gallery_draft()')
 ) AS pins(rel,name,definition) LOOP
  SELECT replace(pg_get_triggerdef(oid,false),quote_ident(current_schema())||'.','<schema>.') INTO STRICT actual
   FROM pg_trigger WHERE tgrelid=to_regclass(r.rel) AND tgname=r.name AND NOT tgisinternal AND tgenabled='O' AND tgtype=31;
  IF actual<>r.definition THEN RAISE EXCEPTION 'Unexpected variants trigger attachment';END IF;
 END LOOP;
END $$;

CREATE FUNCTION storefront_variant_text_valid(value text,maximum integer,multiline boolean DEFAULT false) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT value IS NOT NULL AND char_length(value)<=maximum AND value=normalize(value,NFC)
  AND value=btrim(value,U&'\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\202f\205f\3000\feff')
  AND value !~ U&'[\0001-\0009\000b-\001f\007f-\009f\061c\200e\200f\2028\2029\202a-\202e\2066-\2069]'
  AND (multiline OR position(chr(10) IN value)=0)
$$;
CREATE FUNCTION storefront_variant_axes_valid(axes jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE axis jsonb;v jsonb;
BEGIN
 IF jsonb_typeof(axes) IS DISTINCT FROM 'array' OR jsonb_array_length(axes)>2 THEN RETURN false;END IF;
 IF (SELECT count(DISTINCT a->>'key') FROM jsonb_array_elements(axes) a)<>jsonb_array_length(axes)
 OR (SELECT count(DISTINCT a->>'name') FROM jsonb_array_elements(axes) a)<>jsonb_array_length(axes) THEN RETURN false;END IF;
 FOR axis IN SELECT * FROM jsonb_array_elements(axes) LOOP
  IF jsonb_typeof(axis) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(axis))<>3
   OR jsonb_typeof(axis->'key') IS DISTINCT FROM 'string' OR (axis->>'key')::uuid IS NULL
   OR jsonb_typeof(axis->'name') IS DISTINCT FROM 'string' OR char_length(axis->>'name')=0 OR NOT storefront_variant_text_valid(axis->>'name',20)
   OR jsonb_typeof(axis->'values') IS DISTINCT FROM 'array' OR jsonb_array_length(axis->'values') NOT BETWEEN 1 AND 20 THEN RETURN false;END IF;
  IF (SELECT count(DISTINCT a->>'key') FROM jsonb_array_elements(axis->'values') a)<>jsonb_array_length(axis->'values')
   OR (SELECT count(DISTINCT a->>'name') FROM jsonb_array_elements(axis->'values') a)<>jsonb_array_length(axis->'values') THEN RETURN false;END IF;
  FOR v IN SELECT * FROM jsonb_array_elements(axis->'values') LOOP
   IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(v))<>2
    OR jsonb_typeof(v->'key') IS DISTINCT FROM 'string' OR (v->>'key')::uuid IS NULL
    OR jsonb_typeof(v->'name') IS DISTINCT FROM 'string' OR char_length(v->>'name')=0 OR NOT storefront_variant_text_valid(v->>'name',40) THEN RETURN false;END IF;
  END LOOP;
 END LOOP;RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION storefront_variant_utf16_length(value text) RETURNS integer LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
 SELECT char_length(value)+regexp_count(value,U&'[\+010000-\+10ffff]')
$$;
ALTER TABLE commerce_product_groups
 ADD COLUMN catalog_anchor_sku text CHECK(catalog_anchor_sku ~ '^P[0-9]{4,23}$'),
 ADD COLUMN title text CHECK(title IS NULL OR (char_length(title)>0 AND storefront_variant_text_valid(title,120))),
 ADD COLUMN description text CHECK(description IS NULL OR storefront_variant_text_valid(description,2000,true)),
 ADD COLUMN option_axes jsonb NOT NULL DEFAULT '[]' CHECK(storefront_variant_axes_valid(option_axes)),
 ADD COLUMN default_selection_id uuid,
 ADD COLUMN sort_order integer NOT NULL DEFAULT 0 CHECK(sort_order BETWEEN 0 AND 199),
 ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 ADD CONSTRAINT variant_catalog_text CHECK((catalog_anchor_sku IS NULL AND title IS NULL AND description IS NULL AND option_axes='[]'::jsonb AND default_selection_id IS NULL)
  OR (catalog_anchor_sku IS NOT NULL AND title IS NOT NULL AND description IS NOT NULL));
CREATE UNIQUE INDEX variant_catalog_anchor ON commerce_product_groups(tenant_id,instance_id,catalog_anchor_sku) WHERE catalog_anchor_sku IS NOT NULL;
ALTER TABLE commerce_product_group_members
 ADD COLUMN catalog_group_id uuid,
 ADD COLUMN option_value_keys uuid[] NOT NULL DEFAULT '{}',
 ADD COLUMN sort_order integer NOT NULL DEFAULT 0 CHECK(sort_order BETWEEN 0 AND 199),
 ADD COLUMN membership_version bigint NOT NULL DEFAULT 1 CHECK(membership_version>0),
 ADD CONSTRAINT variant_catalog_group FOREIGN KEY(catalog_group_id,tenant_id,instance_id,scope_id) REFERENCES commerce_product_groups(group_id,tenant_id,instance_id,scope_id),
 ADD CONSTRAINT variant_member_values CHECK(cardinality(option_value_keys)<=2 AND array_position(option_value_keys,NULL) IS NULL AND (catalog_group_id IS NOT NULL OR cardinality(option_value_keys)=0)),
 -- Nondeferrable is essential: 177's old binary uses targetless ON CONFLICT
 -- DO NOTHING on this table. Commands detach old pairs before attaching new
 -- pairs, so permutations stay atomic without a deferred unique arbiter.
 ADD CONSTRAINT variant_combination UNIQUE(catalog_group_id,option_value_keys),
 ADD CONSTRAINT variant_member_order UNIQUE(catalog_group_id,sort_order);
CREATE INDEX variant_catalog_members ON commerce_product_group_members(tenant_id,instance_id,catalog_group_id) WHERE catalog_group_id IS NOT NULL;

CREATE OR REPLACE FUNCTION preserve_storefront_gallery_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Gallery routing is retained' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='commerce_product_groups' THEN
  IF TG_OP='UPDATE' AND ROW(NEW.group_id,NEW.tenant_id,NEW.instance_id,NEW.scope_id,NEW.anchor_product_id,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.group_id,OLD.tenant_id,OLD.instance_id,OLD.scope_id,OLD.anchor_product_id,OLD.created_at)
   THEN RAISE EXCEPTION 'Gallery routing is immutable' USING ERRCODE='23514';END IF;
  IF TG_OP='UPDATE' AND ROW(NEW.main_alt_identity_sha256,NEW.main_alt_text,NEW.last_changed_at_product_version)
   IS NOT DISTINCT FROM ROW(OLD.main_alt_identity_sha256,OLD.main_alt_text,OLD.last_changed_at_product_version) THEN
   NEW.updated_at:=clock_timestamp();RETURN NEW;
  END IF;
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
CREATE OR REPLACE FUNCTION preserve_storefront_gallery_member() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Gallery membership is retained and immutable' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.tenant_id,NEW.instance_id,NEW.scope_id,NEW.group_id,NEW.selection_id,NEW.product_id,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.tenant_id,OLD.instance_id,OLD.scope_id,OLD.group_id,OLD.selection_id,OLD.product_id,OLD.created_at)
  THEN RAISE EXCEPTION 'Gallery membership routing is immutable' USING ERRCODE='23514';END IF;
  IF NEW.membership_version<OLD.membership_version OR (ROW(NEW.catalog_group_id,NEW.option_value_keys,NEW.sort_order)
    IS DISTINCT FROM ROW(OLD.catalog_group_id,OLD.option_value_keys,OLD.sort_order) AND NEW.membership_version<>OLD.membership_version+1)
  THEN RAISE EXCEPTION 'Catalog membership changes require a new version' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM commerce_product_groups g JOIN commerce_storefront_profiles f ON f.tenant_id=g.tenant_id AND f.instance_id=g.instance_id
  JOIN commerce_selections s ON s.shop_id=f.storefront_shop_id AND s.item_id=g.anchor_product_id
  WHERE g.group_id=NEW.group_id AND g.tenant_id=NEW.tenant_id AND g.instance_id=NEW.instance_id AND g.scope_id=NEW.scope_id
  AND g.anchor_product_id=NEW.product_id AND s.selection_id=NEW.selection_id
  AND storefront_gallery_product_version(NEW.tenant_id,NEW.instance_id,NEW.product_id) IS NOT NULL)
 THEN RAISE EXCEPTION 'Gallery member must be the current own selection' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION preserve_storefront_catalog_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.catalog_anchor_sku IS NOT NULL AND NEW.catalog_anchor_sku IS DISTINCT FROM OLD.catalog_anchor_sku
 THEN RAISE EXCEPTION 'Catalog group identity is retained' USING ERRCODE='23514';END IF;
 IF OLD.catalog_anchor_sku IS NULL AND NEW.catalog_anchor_sku IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM commerce_items i JOIN commerce_storefront_profiles p ON p.supply_shop_id=i.shop_id
  WHERE p.tenant_id=NEW.tenant_id AND p.instance_id=NEW.instance_id AND i.item_id=NEW.anchor_product_id AND i.sku=NEW.catalog_anchor_sku)
 THEN RAISE EXCEPTION 'Catalog anchor must name its original product SKU' USING ERRCODE='23514';END IF;
 IF ROW(NEW.catalog_anchor_sku,NEW.title,NEW.description,NEW.option_axes,NEW.default_selection_id,NEW.sort_order)
  IS DISTINCT FROM ROW(OLD.catalog_anchor_sku,OLD.title,OLD.description,OLD.option_axes,OLD.default_selection_id,OLD.sort_order)
  AND NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Catalog changes require a new version' USING ERRCODE='23514';END IF;
 IF NEW.version<OLD.version THEN RAISE EXCEPTION 'Catalog version cannot decrease' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER preserve_storefront_catalog_identity BEFORE UPDATE ON commerce_product_groups FOR EACH ROW EXECUTE FUNCTION preserve_storefront_catalog_identity();
-- Validate only the changed tuple immediately. Metadata changes and changes
-- to the final default still validate the whole group at commit. This keeps a
-- 200-SKU replacement bounded instead of revalidating it 200 times.
CREATE FUNCTION validate_storefront_catalog_member() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g commerce_product_groups%ROWTYPE;label_length integer;
BEGIN
 IF NEW.catalog_group_id IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO STRICT g FROM commerce_product_groups WHERE group_id=NEW.catalog_group_id AND tenant_id=NEW.tenant_id AND instance_id=NEW.instance_id AND scope_id=NEW.scope_id;
 IF g.catalog_anchor_sku IS NULL OR cardinality(NEW.option_value_keys)<>jsonb_array_length(g.option_axes)
  OR NOT EXISTS(SELECT 1 FROM commerce_storefront_profiles f JOIN commerce_selections s ON s.shop_id=f.storefront_shop_id AND s.item_id=NEW.product_id
   JOIN commerce_items i ON i.item_id=s.item_id AND i.shop_id=f.supply_shop_id
   WHERE f.tenant_id=NEW.tenant_id AND f.instance_id=NEW.instance_id AND s.selection_id=NEW.selection_id AND s.own_retail_enabled)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(g.option_axes) WITH ORDINALITY a(axis,position)
   WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a.axis->'values') v WHERE v->>'key'=NEW.option_value_keys[a.position]::text))
 THEN RAISE EXCEPTION 'Catalog member requires a current own selection and existing values' USING ERRCODE='23514';END IF;
 SELECT storefront_variant_utf16_length(g.title)+CASE WHEN cardinality(NEW.option_value_keys)>0 THEN cardinality(NEW.option_value_keys)+1 ELSE 0 END
  +COALESCE(sum(storefront_variant_utf16_length(v->>'name')),0) INTO label_length
  FROM jsonb_array_elements(g.option_axes) WITH ORDINALITY a(axis,position)
  JOIN LATERAL jsonb_array_elements(a.axis->'values') v ON v->>'key'=NEW.option_value_keys[a.position]::text;
 IF label_length>120 THEN RAISE EXCEPTION 'Catalog buyer label exceeds checkout limit' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_storefront_catalog_member BEFORE INSERT OR UPDATE ON commerce_product_group_members FOR EACH ROW EXECUTE FUNCTION validate_storefront_catalog_member();
CREATE FUNCTION require_valid_storefront_catalog() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g commerce_product_groups%ROWTYPE;n integer;targets uuid[];maximum_label integer;
BEGIN
 -- Validate the final transaction state, including both ends of a moved member.
 IF TG_TABLE_NAME='commerce_product_groups' THEN
  -- A predecessor gallery writer cannot maintain catalog membership when it
  -- deletes a product. Retained missing selections are filtered by the draft
  -- reader and repaired by the next catalog command. An unrelated photo edit
  -- must still obey 177's routing/version checks, without validating untouched
  -- catalog state left by that predecessor.
  IF TG_OP='UPDATE' THEN
   IF ROW(NEW.catalog_anchor_sku,NEW.title,NEW.description,NEW.option_axes,NEW.default_selection_id,NEW.sort_order,NEW.version)
    IS NOT DISTINCT FROM ROW(OLD.catalog_anchor_sku,OLD.title,OLD.description,OLD.option_axes,OLD.default_selection_id,OLD.sort_order,OLD.version)
   THEN RETURN NULL;END IF;
  END IF;
  targets:=ARRAY[NEW.group_id];
 ELSIF TG_OP='UPDATE' THEN targets:=ARRAY[NEW.catalog_group_id,OLD.catalog_group_id];
 ELSE targets:=ARRAY[NEW.catalog_group_id];END IF;
 FOR g IN SELECT * FROM commerce_product_groups WHERE tenant_id=NEW.tenant_id AND instance_id=NEW.instance_id AND group_id=ANY(targets) AND catalog_anchor_sku IS NOT NULL LOOP
  IF TG_TABLE_NAME='commerce_product_group_members' AND g.default_selection_id IS NOT NULL THEN
   IF TG_OP='INSERT' THEN
    IF g.default_selection_id<>NEW.selection_id THEN CONTINUE;END IF;
   ELSIF g.default_selection_id<>NEW.selection_id AND g.default_selection_id<>OLD.selection_id THEN CONTINUE;
   END IF;
  END IF;
  SELECT count(*) INTO n FROM commerce_product_group_members m WHERE m.catalog_group_id=g.group_id AND m.tenant_id=g.tenant_id AND m.instance_id=g.instance_id;
  IF EXISTS(SELECT 1 FROM commerce_product_group_members m JOIN commerce_storefront_profiles f USING(tenant_id,instance_id)
   LEFT JOIN commerce_selections s ON s.selection_id=m.selection_id AND s.shop_id=f.storefront_shop_id AND s.item_id=m.product_id
   LEFT JOIN commerce_items i ON i.item_id=s.item_id
   WHERE m.catalog_group_id=g.group_id AND m.tenant_id=g.tenant_id AND m.instance_id=g.instance_id
    AND (s.selection_id IS NULL OR NOT s.own_retail_enabled OR i.shop_id IS DISTINCT FROM f.supply_shop_id
     OR cardinality(m.option_value_keys)<>jsonb_array_length(g.option_axes)
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(g.option_axes) WITH ORDINALITY a(axis,position)
      WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a.axis->'values') v WHERE v->>'key'=m.option_value_keys[a.position]::text))))
  THEN RAISE EXCEPTION 'Catalog members require current own selections and existing values' USING ERRCODE='23514';END IF;
  SELECT storefront_variant_utf16_length(g.title)+CASE WHEN jsonb_array_length(g.option_axes)>0 THEN jsonb_array_length(g.option_axes)+1 ELSE 0 END
   +COALESCE(sum(value_max),0) INTO maximum_label FROM jsonb_array_elements(g.option_axes) axis
   CROSS JOIN LATERAL (SELECT max(storefront_variant_utf16_length(v->>'name')) AS value_max FROM jsonb_array_elements(axis->'values') v) x;
  IF maximum_label>120 AND EXISTS(SELECT 1 FROM commerce_product_group_members m
   WHERE m.catalog_group_id=g.group_id AND m.tenant_id=g.tenant_id AND m.instance_id=g.instance_id
    AND storefront_variant_utf16_length(g.title)+CASE WHEN cardinality(m.option_value_keys)>0 THEN cardinality(m.option_value_keys)+1 ELSE 0 END
     +COALESCE((SELECT sum(storefront_variant_utf16_length(v->>'name')) FROM jsonb_array_elements(g.option_axes) WITH ORDINALITY a(axis,position)
      JOIN LATERAL jsonb_array_elements(a.axis->'values') v ON v->>'key'=m.option_value_keys[a.position]::text),0)>120)
  THEN RAISE EXCEPTION 'Catalog buyer label exceeds checkout limit' USING ERRCODE='23514';END IF;
  IF n>200 OR (n>1 AND jsonb_array_length(g.option_axes)=0) THEN RAISE EXCEPTION 'Invalid catalog member count' USING ERRCODE='23514';END IF;
  IF n>0 AND NOT EXISTS(SELECT 1 FROM commerce_product_group_members a WHERE a.catalog_group_id=g.group_id AND a.selection_id=g.default_selection_id AND a.tenant_id=g.tenant_id AND a.instance_id=g.instance_id)
  THEN RAISE EXCEPTION 'Catalog default must be a member' USING ERRCODE='23514';END IF;
 END LOOP;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER require_valid_storefront_catalog AFTER INSERT OR UPDATE ON commerce_product_groups DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_valid_storefront_catalog();
CREATE CONSTRAINT TRIGGER require_valid_storefront_catalog AFTER INSERT OR UPDATE ON commerce_product_group_members DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_valid_storefront_catalog();

CREATE FUNCTION storefront_variants_document_valid(doc jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE g jsonb;m jsonb;a jsonb;values_list jsonb;label text;seen text[]:='{}';keys text[]:='{}';combos text[];
BEGIN
 IF jsonb_typeof(doc) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(doc))<>2
  OR doc->>'profile' IS DISTINCT FROM 'freedom.hosted-store-variants/v1' OR jsonb_typeof(doc->'groups') IS DISTINCT FROM 'array'
  OR jsonb_array_length(doc->'groups')>200 OR octet_length(doc::text)>4194304 THEN RETURN false;END IF;
 FOR g IN SELECT * FROM jsonb_array_elements(doc->'groups') LOOP
  IF jsonb_typeof(g) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(g))<>8
   OR jsonb_typeof(g->'group_key') IS DISTINCT FROM 'string' OR g->>'group_key' !~ '^P[0-9]{4,23}(~single)?$' OR g->>'group_key'=ANY(keys)
   OR jsonb_typeof(g->'title') IS DISTINCT FROM 'string' OR char_length(g->>'title')=0 OR storefront_variant_utf16_length(g->>'title')>120
   OR jsonb_typeof(g->'description') IS DISTINCT FROM 'string' OR char_length(g->>'description')>2000
   OR NOT storefront_variant_axes_valid(g->'axes') OR jsonb_typeof(g->'members') IS DISTINCT FROM 'array' OR jsonb_array_length(g->'members') NOT BETWEEN 1 AND 200
   OR jsonb_typeof(g->'default_sku') IS DISTINCT FROM 'string' OR jsonb_typeof(g->'gallery_sku') IS DISTINCT FROM 'string' OR g->>'gallery_sku' IS DISTINCT FROM g->>'default_sku'
   OR jsonb_typeof(g->'order') IS DISTINCT FROM 'number' OR (g->>'order')::integer NOT BETWEEN 0 AND 199
   OR (jsonb_array_length(g->'axes')=0 AND jsonb_array_length(g->'members')<>1) THEN RETURN false;END IF;
  keys:=array_append(keys,g->>'group_key');combos:='{}';
  FOR m IN SELECT * FROM jsonb_array_elements(g->'members') LOOP
   IF jsonb_typeof(m) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(m))<>5
    OR jsonb_typeof(m->'sku') IS DISTINCT FROM 'string' OR m->>'sku' !~ '^P[0-9]{4,23}$' OR m->>'sku'=ANY(seen)
    OR jsonb_typeof(m->'value_keys') IS DISTINCT FROM 'array' OR jsonb_array_length(m->'value_keys')<>jsonb_array_length(g->'axes')
    OR jsonb_typeof(m->'values') IS DISTINCT FROM 'array' OR jsonb_array_length(m->'values')<>jsonb_array_length(g->'axes')
    OR (m->'value_keys')::text=ANY(combos) OR jsonb_typeof(m->'buyer_label') IS DISTINCT FROM 'string'
    OR jsonb_typeof(m->'order') IS DISTINCT FROM 'number' OR (m->>'order')::integer NOT BETWEEN 0 AND 199 THEN RETURN false;END IF;
   values_list:='[]';
   FOR a IN SELECT jsonb_build_object('axis',axis,'position',position-1) FROM jsonb_array_elements(g->'axes') WITH ORDINALITY x(axis,position) LOOP
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a->'axis'->'values') v WHERE v->>'key'=m->'value_keys'->>((a->>'position')::integer)) THEN RETURN false;END IF;
    SELECT values_list||jsonb_build_array(v->>'name') INTO values_list FROM jsonb_array_elements(a->'axis'->'values') v WHERE v->>'key'=m->'value_keys'->>((a->>'position')::integer);
   END LOOP;
   label:=g->>'title';
   IF jsonb_array_length(values_list)>0 THEN label:=label||'（'||(SELECT string_agg(v,'／' ORDER BY n) FROM jsonb_array_elements_text(values_list) WITH ORDINALITY x(v,n))||'）';END IF;
   IF m->'values' IS DISTINCT FROM values_list OR m->>'buyer_label' IS DISTINCT FROM label OR storefront_variant_utf16_length(label)>120 THEN RETURN false;END IF;
   seen:=array_append(seen,m->>'sku');combos:=array_append(combos,(m->'value_keys')::text);
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(g->'members') x(member) WHERE x.member->>'sku'=g->>'default_sku') THEN RETURN false;END IF;
 END LOOP;
 RETURN cardinality(seen)<=200;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE TABLE commerce_publication_variants (
 publication_id uuid PRIMARY KEY,tenant_id uuid NOT NULL,instance_id uuid NOT NULL,
 document jsonb NOT NULL CHECK(storefront_variants_document_valid(document)),
 variants_sha256 text NOT NULL CHECK(variants_sha256 ~ '^[0-9a-f]{64}$'),
 UNIQUE(publication_id,tenant_id,instance_id),
 FOREIGN KEY(publication_id,tenant_id,instance_id) REFERENCES commerce_storefront_publications(publication_id,tenant_id,instance_id)
);
CREATE FUNCTION preserve_publication_variants() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Published variants are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER preserve_publication_variants BEFORE UPDATE OR DELETE ON commerce_publication_variants FOR EACH ROW EXECUTE FUNCTION preserve_publication_variants();
CREATE FUNCTION require_complete_publication_variants() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE projection jsonb;
BEGIN
 SELECT p.projection INTO STRICT projection FROM commerce_storefront_publications p WHERE p.publication_id=NEW.publication_id AND p.tenant_id=NEW.tenant_id AND p.instance_id=NEW.instance_id;
 IF (SELECT count(*) FROM jsonb_array_elements(NEW.document->'groups') g CROSS JOIN LATERAL jsonb_array_elements(g->'members') m)<>jsonb_array_length(projection->'products')
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.document->'groups') g CROSS JOIN LATERAL jsonb_array_elements(g->'members') m
   WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(projection->'products') p WHERE p->>'sku'=m->>'sku'))
 THEN RAISE EXCEPTION 'Variants must partition the publication SKUs' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER require_complete_publication_variants AFTER INSERT ON commerce_publication_variants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_complete_publication_variants();
ALTER TABLE commerce_publication_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY commerce_publication_variants_read ON commerce_publication_variants FOR SELECT TO PUBLIC USING(tenant_id=freedom_ctx_tenant());
CREATE POLICY commerce_publication_variants_insert ON commerce_publication_variants FOR INSERT TO PUBLIC WITH CHECK(tenant_id=freedom_ctx_tenant());
CREATE POLICY commerce_product_group_members_update ON commerce_product_group_members FOR UPDATE TO PUBLIC USING(tenant_id=freedom_ctx_tenant()) WITH CHECK(tenant_id=freedom_ctx_tenant());
DO $$DECLARE name text;BEGIN
 FOREACH name IN ARRAY ARRAY['storefront_variant_text_valid(text,integer,boolean)','storefront_variant_axes_valid(jsonb)','storefront_variant_utf16_length(text)',
 'preserve_storefront_gallery_draft()','preserve_storefront_gallery_member()','preserve_storefront_catalog_identity()','validate_storefront_catalog_member()','require_valid_storefront_catalog()',
 'storefront_variants_document_valid(jsonb)','preserve_publication_variants()','require_complete_publication_variants()'] LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path=pg_catalog,%I',name,current_schema());
 END LOOP;
END $$;
