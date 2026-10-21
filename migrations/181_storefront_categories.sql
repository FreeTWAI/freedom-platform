-- Retained display identities, independent of live item and gallery routing.
CREATE TABLE commerce_storefront_categories (
 category_id uuid PRIMARY KEY,tenant_id uuid NOT NULL,instance_id uuid NOT NULL,scope_id uuid NOT NULL,
 scope_kind text GENERATED ALWAYS AS ('tenant'::text) STORED,
 name text NOT NULL CHECK(char_length(name)>0 AND storefront_variant_text_valid(name,40)),
 name_key text NOT NULL CHECK(name_key=name),sort_order smallint,
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),removed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((removed_at IS NULL AND sort_order BETWEEN 1 AND 30 AND sort_order IS NOT NULL) OR (removed_at IS NOT NULL AND sort_order IS NULL)),
 UNIQUE(category_id,tenant_id,instance_id,scope_id),
 UNIQUE(tenant_id,instance_id,sort_order) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(tenant_id,instance_id) REFERENCES commerce_storefront_profiles(tenant_id,instance_id),
 FOREIGN KEY(scope_id,scope_kind,tenant_id) REFERENCES resource_scopes(scope_id,kind,tenant_ref)
);
CREATE UNIQUE INDEX storefront_category_name ON commerce_storefront_categories(tenant_id,instance_id,name_key) WHERE removed_at IS NULL;
CREATE TABLE commerce_storefront_category_members (
 category_id uuid NOT NULL,tenant_id uuid NOT NULL,instance_id uuid NOT NULL,scope_id uuid NOT NULL,
 scope_kind text GENERATED ALWAYS AS ('tenant'::text) STORED,
 group_key text NOT NULL CHECK(group_key ~ '^P[0-9]{4,23}(~single)?$'),sort_order integer,removed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(category_id,group_key),
 CHECK((removed_at IS NULL AND sort_order BETWEEN 0 AND 199 AND sort_order IS NOT NULL) OR (removed_at IS NOT NULL AND sort_order IS NULL)),
 UNIQUE(category_id,sort_order) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(category_id,tenant_id,instance_id,scope_id) REFERENCES commerce_storefront_categories(category_id,tenant_id,instance_id,scope_id),
 FOREIGN KEY(scope_id,scope_kind,tenant_id) REFERENCES resource_scopes(scope_id,kind,tenant_ref)
);
CREATE FUNCTION preserve_storefront_category() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE active_count integer;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Category history is retained' USING ERRCODE='23514';END IF;
 PERFORM 1 FROM commerce_storefront_profiles WHERE tenant_id=NEW.tenant_id AND instance_id=NEW.instance_id AND slug IS NOT NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Retail profile required' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.category_id,NEW.tenant_id,NEW.instance_id,NEW.scope_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.category_id,OLD.tenant_id,OLD.instance_id,OLD.scope_id,OLD.created_at)
   OR OLD.removed_at IS NOT NULL OR NEW.version<>OLD.version+1
  THEN RAISE EXCEPTION 'Category identity/version is immutable' USING ERRCODE='23514';END IF;
 ELSIF NEW.version<>1 OR NEW.removed_at IS NOT NULL THEN RAISE EXCEPTION 'Invalid initial category' USING ERRCODE='23514';END IF;
 SELECT count(*) INTO active_count FROM commerce_storefront_categories WHERE tenant_id=NEW.tenant_id AND instance_id=NEW.instance_id AND removed_at IS NULL AND category_id<>NEW.category_id;
 IF NEW.removed_at IS NULL AND active_count>=30 THEN RAISE EXCEPTION 'Category limit' USING ERRCODE='23514',CONSTRAINT='storefront_category_limit';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER preserve_storefront_category BEFORE INSERT OR UPDATE OR DELETE ON commerce_storefront_categories FOR EACH ROW EXECUTE FUNCTION preserve_storefront_category();
CREATE FUNCTION preserve_storefront_category_member() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Category membership is retained' USING ERRCODE='23514';END IF;
 PERFORM 1 FROM commerce_storefront_profiles WHERE tenant_id=NEW.tenant_id AND instance_id=NEW.instance_id FOR UPDATE;
 IF TG_OP='UPDATE' AND ROW(NEW.category_id,NEW.tenant_id,NEW.instance_id,NEW.scope_id,NEW.group_key,NEW.created_at) IS DISTINCT FROM ROW(OLD.category_id,OLD.tenant_id,OLD.instance_id,OLD.scope_id,OLD.group_key,OLD.created_at)
 THEN RAISE EXCEPTION 'Category membership identity is immutable' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER preserve_storefront_category_member BEFORE INSERT OR UPDATE OR DELETE ON commerce_storefront_category_members FOR EACH ROW EXECUTE FUNCTION preserve_storefront_category_member();
-- This transaction-local switch chooses catalog semantics only, never authority.
-- OFF checks SKU selections only; it does not query either variants table.
CREATE FUNCTION storefront_category_group_exists(t uuid,i uuid,k text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE p commerce_storefront_profiles; live_item uuid;live_selection uuid;assigned uuid;home uuid;
BEGIN
 SELECT * INTO STRICT p FROM commerce_storefront_profiles WHERE tenant_id=t AND instance_id=i;
 IF current_setting('freedom.category_variants',true) IS DISTINCT FROM 'on' THEN
  RETURN EXISTS(SELECT 1 FROM commerce_selections s JOIN commerce_items item USING(item_id)
   WHERE s.shop_id=p.storefront_shop_id AND ((item.shop_id=p.supply_shop_id AND s.own_retail_enabled AND item.sku=k)
    OR (s.hosted_sku=k AND s.acceptance_state='sellable' AND EXISTS(SELECT 1 FROM commerce_hosted_supply_offers o JOIN commerce_distribution_acceptances a ON a.acceptance_id=s.current_acceptance_id AND a.selection_id=s.selection_id WHERE o.offer_id=s.hosted_offer_id AND o.item_id=s.item_id AND o.state='offered' AND a.decision='accepted' AND a.listing_sha256=s.listing_sha256 AND s.snapshot->>'offer_sha256'=o.terms_sha256))));
 END IF;
 -- An explicit group's anchor may no longer have a live item.
 IF EXISTS(SELECT 1 FROM commerce_product_groups g JOIN commerce_product_group_members m ON m.catalog_group_id=g.group_id AND m.tenant_id=g.tenant_id AND m.instance_id=g.instance_id
  JOIN commerce_selections s ON s.selection_id=m.selection_id AND s.shop_id=p.storefront_shop_id AND s.own_retail_enabled
  JOIN commerce_items item ON item.item_id=s.item_id AND item.shop_id=p.supply_shop_id
  WHERE g.tenant_id=t AND g.instance_id=i AND g.catalog_anchor_sku=k) THEN RETURN true;END IF;
 SELECT item.item_id,s.selection_id INTO live_item,live_selection FROM commerce_selections s JOIN commerce_items item USING(item_id)
  WHERE s.shop_id=p.storefront_shop_id AND ((item.shop_id=p.supply_shop_id AND s.own_retail_enabled AND item.sku=replace(k,'~single',''))
   OR (s.hosted_sku=k AND s.acceptance_state='sellable' AND EXISTS(SELECT 1 FROM commerce_hosted_supply_offers o JOIN commerce_distribution_acceptances a ON a.acceptance_id=s.current_acceptance_id AND a.selection_id=s.selection_id WHERE o.offer_id=s.hosted_offer_id AND o.item_id=s.item_id AND o.state='offered' AND a.decision='accepted' AND a.listing_sha256=s.listing_sha256 AND s.snapshot->>'offer_sha256'=o.terms_sha256)));
 IF live_selection IS NULL THEN RETURN false;END IF;
 SELECT m.catalog_group_id INTO assigned FROM commerce_product_group_members m WHERE m.tenant_id=t AND m.instance_id=i AND m.selection_id=live_selection;
 IF assigned IS NOT NULL THEN RETURN false;END IF;
 SELECT g.group_id INTO home FROM commerce_product_groups g WHERE g.tenant_id=t AND g.instance_id=i AND g.anchor_product_id=live_item
  AND EXISTS(SELECT 1 FROM commerce_product_group_members m JOIN commerce_selections s ON s.selection_id=m.selection_id AND s.shop_id=p.storefront_shop_id AND s.own_retail_enabled
   WHERE m.tenant_id=t AND m.instance_id=i AND m.catalog_group_id=g.group_id);
 RETURN (home IS NOT NULL)=(k LIKE '%~single');
END $$;
CREATE FUNCTION validate_storefront_category_member() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 -- Resolve only new/reactivated references; predecessor removals may leave stale
 -- rows. Reads mark them inactive and publishing omits them without a GET write.
 IF (TG_OP='INSERT' OR OLD.removed_at IS NOT NULL) AND NEW.removed_at IS NULL
  AND EXISTS(SELECT 1 FROM commerce_storefront_category_members m WHERE m.category_id=NEW.category_id AND m.group_key=NEW.group_key AND m.removed_at IS NULL)
 THEN
  IF NOT EXISTS(SELECT 1 FROM commerce_storefront_categories c WHERE c.category_id=NEW.category_id AND c.tenant_id=NEW.tenant_id AND c.instance_id=NEW.instance_id AND c.removed_at IS NULL)
   OR NOT storefront_category_group_exists(NEW.tenant_id,NEW.instance_id,NEW.group_key)
  THEN RAISE EXCEPTION 'Category group no longer resolves' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER validate_storefront_category_member AFTER INSERT OR UPDATE ON commerce_storefront_category_members DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_storefront_category_member();
CREATE FUNCTION storefront_categories_document_valid(doc jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE c jsonb;g jsonb;s jsonb;ids text[]:='{}';names text[]:='{}';orders text[]:='{}';keys text[];positions text[];skus text[];
BEGIN
 IF jsonb_typeof(doc) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(doc))<>2 OR doc->>'profile' IS DISTINCT FROM 'freedom.hosted-store-categories/v1'
  OR jsonb_typeof(doc->'categories') IS DISTINCT FROM 'array' OR jsonb_array_length(doc->'categories')>30 OR octet_length(doc::text)>1048576 THEN RETURN false;END IF;
 FOR c IN SELECT * FROM jsonb_array_elements(doc->'categories') LOOP
  IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(c))<>4
   OR jsonb_typeof(c->'category_id') IS DISTINCT FROM 'string' OR (c->>'category_id')::uuid IS NULL OR c->>'category_id'=ANY(ids)
   OR jsonb_typeof(c->'name') IS DISTINCT FROM 'string' OR char_length(c->>'name')=0 OR NOT storefront_variant_text_valid(c->>'name',40) OR c->>'name'=ANY(names)
   OR jsonb_typeof(c->'order') IS DISTINCT FROM 'number' OR (c->>'order') !~ '^[0-9]+$' OR (c->>'order')::integer NOT BETWEEN 1 AND 30 OR c->>'order'=ANY(orders)
   OR jsonb_typeof(c->'groups') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'groups') NOT BETWEEN 1 AND 200 THEN RETURN false;END IF;
  ids:=array_append(ids,c->>'category_id');names:=array_append(names,c->>'name');orders:=array_append(orders,c->>'order');keys:='{}';positions:='{}';skus:='{}';
  FOR g IN SELECT * FROM jsonb_array_elements(c->'groups') LOOP
   IF jsonb_typeof(g) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(g))<>3
    OR jsonb_typeof(g->'group_key') IS DISTINCT FROM 'string' OR g->>'group_key' !~ '^P[0-9]{4,23}(~single)?$' OR g->>'group_key'=ANY(keys)
    OR jsonb_typeof(g->'order') IS DISTINCT FROM 'number' OR (g->>'order') !~ '^[0-9]+$' OR (g->>'order')::integer NOT BETWEEN 0 AND 199 OR g->>'order'=ANY(positions)
    OR jsonb_typeof(g->'skus') IS DISTINCT FROM 'array' OR jsonb_array_length(g->'skus') NOT BETWEEN 1 AND 200 THEN RETURN false;END IF;
   keys:=array_append(keys,g->>'group_key');positions:=array_append(positions,g->>'order');
   FOR s IN SELECT * FROM jsonb_array_elements(g->'skus') LOOP
    IF jsonb_typeof(s) IS DISTINCT FROM 'string' OR s#>>'{}' !~ '^P[0-9]{4,23}$' OR s#>>'{}'=ANY(skus) THEN RETURN false;END IF;
    skus:=array_append(skus,s#>>'{}');
   END LOOP;
  END LOOP;
  IF cardinality(skus)>200 THEN RETURN false;END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE TABLE commerce_publication_categories (
 publication_id uuid PRIMARY KEY,tenant_id uuid NOT NULL,instance_id uuid NOT NULL,
 document jsonb NOT NULL CHECK(storefront_categories_document_valid(document)),
 categories_sha256 text NOT NULL CHECK(categories_sha256 ~ '^[0-9a-f]{64}$'),
 FOREIGN KEY(publication_id,tenant_id,instance_id) REFERENCES commerce_storefront_publications(publication_id,tenant_id,instance_id)
);
CREATE FUNCTION preserve_publication_categories() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Published categories are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER preserve_publication_categories BEFORE UPDATE OR DELETE ON commerce_publication_categories FOR EACH ROW EXECUTE FUNCTION preserve_publication_categories();
CREATE FUNCTION validate_publication_categories() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE projection jsonb;
BEGIN
 SELECT p.projection INTO STRICT projection FROM commerce_storefront_publications p WHERE p.publication_id=NEW.publication_id AND p.tenant_id=NEW.tenant_id AND p.instance_id=NEW.instance_id;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.document->'categories') c CROSS JOIN LATERAL jsonb_array_elements(c->'groups') g CROSS JOIN LATERAL jsonb_array_elements_text(g->'skus') sku
  WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(projection->'products') p WHERE p->>'sku'=sku))
 THEN RAISE EXCEPTION 'Categories require publication SKUs' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER validate_publication_categories AFTER INSERT ON commerce_publication_categories DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_publication_categories();
DO $$DECLARE rel text;fn text;BEGIN
 FOREACH rel IN ARRAY ARRAY['commerce_storefront_categories','commerce_storefront_category_members','commerce_publication_categories'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',rel);
  EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO PUBLIC USING(tenant_id=freedom_ctx_tenant())',rel||'_read',rel);
  EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO PUBLIC WITH CHECK(tenant_id=freedom_ctx_tenant())',rel||'_insert',rel);
  IF rel<>'commerce_publication_categories' THEN EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE TO PUBLIC USING(tenant_id=freedom_ctx_tenant()) WITH CHECK(tenant_id=freedom_ctx_tenant())',rel||'_update',rel);END IF;
 END LOOP;
 FOREACH fn IN ARRAY ARRAY['preserve_storefront_category()','preserve_storefront_category_member()','storefront_category_group_exists(uuid,uuid,text)','validate_storefront_category_member()','storefront_categories_document_valid(jsonb)','preserve_publication_categories()','validate_publication_categories()'] LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path=pg_catalog,%I',fn,current_schema());
 END LOOP;
END $$;
