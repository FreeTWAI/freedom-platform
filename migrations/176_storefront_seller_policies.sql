-- C1 legal information is an additive sidecar. No old publication rewrite,
-- checkout gate, reader capability, account-derived defaults or erasure job.
CREATE FUNCTION storefront_policy_text_valid(value text, maximum integer, multiline boolean)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT value IS NOT NULL AND char_length(value)<=maximum
  AND value=btrim(value,U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff')
  AND value !~ U&'[\0001-\0009\000b-\001f\007f-\009f\061c\200e\200f\2028\2029\202a-\202e\2066-\2069]'
  AND (multiline OR strpos(value,chr(10))=0)
$$;

CREATE TABLE commerce_storefront_seller_versions (
 version_id uuid PRIMARY KEY, tenant_id uuid NOT NULL, instance_id uuid NOT NULL,
 version_no bigint NOT NULL CHECK(version_no>0),
 CONSTRAINT seller_policies_seller_version_limit CHECK(version_no<=500),
 created_at_profile_version bigint NOT NULL CHECK(created_at_profile_version>0),
 business_name text NOT NULL CHECK(storefront_policy_text_valid(business_name,120,false)),
 email text NOT NULL CHECK(storefront_policy_text_valid(email,254,false)),
 phone text NOT NULL CHECK(storefront_policy_text_valid(phone,40,false)),
 address text NOT NULL CHECK(storefront_policy_text_valid(address,300,false)),
 service_hours text NOT NULL CHECK(storefront_policy_text_valid(service_hours,300,false)),
 tax_id text NOT NULL CHECK(tax_id='' OR tax_id ~ '^[0-9]{8}$'),
 responsible_person text NOT NULL CHECK(storefront_policy_text_valid(responsible_person,80,false)),
 content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,instance_id,version_no), UNIQUE(version_id,tenant_id,instance_id),
 FOREIGN KEY(tenant_id,instance_id) REFERENCES commerce_storefront_profiles(tenant_id,instance_id),
 CHECK(business_name<>'' OR ROW(email,phone,address,service_hours,tax_id,responsible_person)=ROW('','','','','','')),
 CHECK(email='' OR (email !~ '[[:space:]]' AND email ~ '^[^@]+@[^@]+\.[^@]+$')),
 CHECK(phone='' OR (phone ~ '^\+?[0-9 ()-]+$' AND char_length(regexp_replace(phone,'[^0-9]','','g')) BETWEEN 6 AND 15))
);
CREATE TABLE commerce_storefront_policy_versions (
 version_id uuid PRIMARY KEY, tenant_id uuid NOT NULL, instance_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('shipping','returns','privacy','terms')),
 version_no bigint NOT NULL CHECK(version_no>0),
 CONSTRAINT seller_policies_policy_version_limit CHECK(version_no<=500),
 created_at_profile_version bigint NOT NULL CHECK(created_at_profile_version>0),
 body text NOT NULL CHECK(storefront_policy_text_valid(body,10000,true)),
 window_days integer, return_by_days integer, drop_ship_disclosed boolean,
 content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,instance_id,kind,version_no), UNIQUE(version_id,tenant_id,instance_id,kind),
 FOREIGN KEY(tenant_id,instance_id) REFERENCES commerce_storefront_profiles(tenant_id,instance_id),
 CHECK((kind='returns' AND (window_days IS NULL OR window_days BETWEEN 7 AND 3650)
   AND return_by_days IS NOT NULL AND return_by_days BETWEEN 1 AND 3650 AND drop_ship_disclosed IS NULL)
  OR (kind='privacy' AND window_days IS NULL AND return_by_days IS NULL AND drop_ship_disclosed IS NOT NULL)
  OR (kind IN ('shipping','terms') AND window_days IS NULL AND return_by_days IS NULL AND drop_ship_disclosed IS NULL))
);
CREATE FUNCTION preserve_storefront_legal_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_version bigint; prior bigint;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Seller and policy versions are immutable' USING ERRCODE='23514'; END IF;
 SELECT version INTO current_version FROM commerce_storefront_profiles
  WHERE tenant_id=NEW.tenant_id AND instance_id=NEW.instance_id AND slug IS NOT NULL FOR UPDATE;
 IF current_version IS NULL OR NEW.created_at_profile_version<>current_version
  THEN RAISE EXCEPTION 'Legal versions require the current retail profile version' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='commerce_storefront_seller_versions' THEN
  SELECT max(version_no) INTO prior FROM commerce_storefront_seller_versions WHERE tenant_id=NEW.tenant_id AND instance_id=NEW.instance_id;
 ELSE
  SELECT max(version_no) INTO prior FROM commerce_storefront_policy_versions WHERE tenant_id=NEW.tenant_id AND instance_id=NEW.instance_id AND kind=NEW.kind;
 END IF;
 IF NEW.version_no<>COALESCE(prior,0)+1 THEN RAISE EXCEPTION 'Legal version sequence must be dense' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER preserve_storefront_legal_version BEFORE INSERT OR UPDATE OR DELETE ON commerce_storefront_seller_versions
 FOR EACH ROW EXECUTE FUNCTION preserve_storefront_legal_version();
CREATE TRIGGER preserve_storefront_legal_version BEFORE INSERT OR UPDATE OR DELETE ON commerce_storefront_policy_versions
 FOR EACH ROW EXECUTE FUNCTION preserve_storefront_legal_version();

CREATE TABLE commerce_storefront_seller_drafts (
 tenant_id uuid NOT NULL, instance_id uuid NOT NULL, version_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,instance_id),
 FOREIGN KEY(tenant_id,instance_id) REFERENCES commerce_storefront_profiles(tenant_id,instance_id),
 FOREIGN KEY(version_id,tenant_id,instance_id) REFERENCES commerce_storefront_seller_versions(version_id,tenant_id,instance_id)
);
CREATE TABLE commerce_storefront_policy_drafts (
 tenant_id uuid NOT NULL, instance_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('shipping','returns','privacy','terms')), version_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,instance_id,kind),
 FOREIGN KEY(tenant_id,instance_id) REFERENCES commerce_storefront_profiles(tenant_id,instance_id),
 FOREIGN KEY(version_id,tenant_id,instance_id,kind) REFERENCES commerce_storefront_policy_versions(version_id,tenant_id,instance_id,kind)
);
CREATE FUNCTION preserve_storefront_legal_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_version bigint; target_version bigint;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Legal draft routing is retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.tenant_id,NEW.instance_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.tenant_id,OLD.instance_id,OLD.created_at)
   THEN RAISE EXCEPTION 'Legal draft identity is immutable' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='commerce_storefront_policy_drafts' THEN
   IF NEW.kind IS DISTINCT FROM OLD.kind THEN RAISE EXCEPTION 'Legal policy kind is immutable' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.version_id=OLD.version_id THEN NEW.updated_at:=OLD.updated_at; RETURN NEW; END IF;
 END IF;
 SELECT version INTO current_version FROM commerce_storefront_profiles
  WHERE tenant_id=NEW.tenant_id AND instance_id=NEW.instance_id AND slug IS NOT NULL FOR UPDATE;
 IF TG_TABLE_NAME='commerce_storefront_seller_drafts' THEN
  SELECT created_at_profile_version INTO target_version FROM commerce_storefront_seller_versions
   WHERE version_id=NEW.version_id AND tenant_id=NEW.tenant_id AND instance_id=NEW.instance_id;
 ELSE
  SELECT created_at_profile_version INTO target_version FROM commerce_storefront_policy_versions
   WHERE version_id=NEW.version_id AND tenant_id=NEW.tenant_id AND instance_id=NEW.instance_id AND kind=NEW.kind;
 END IF;
 IF current_version IS NULL OR target_version IS NULL OR target_version<>current_version
  THEN RAISE EXCEPTION 'Legal draft pointer requires the current profile version' USING ERRCODE='23514'; END IF;
 NEW.updated_at:=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER preserve_storefront_legal_draft BEFORE INSERT OR UPDATE OR DELETE ON commerce_storefront_seller_drafts
 FOR EACH ROW EXECUTE FUNCTION preserve_storefront_legal_draft();
CREATE TRIGGER preserve_storefront_legal_draft BEFORE INSERT OR UPDATE OR DELETE ON commerce_storefront_policy_drafts
 FOR EACH ROW EXECUTE FUNCTION preserve_storefront_legal_draft();

CREATE FUNCTION storefront_legal_ref_valid(ref jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
 IF ref='null'::jsonb THEN RETURN true; END IF;
 IF jsonb_typeof(ref) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 RETURN (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(ref) k)=ARRAY['sha256','version_id']
  AND jsonb_typeof(ref->'sha256')='string' AND ref->>'sha256' ~ '^[0-9a-f]{64}$'
  AND jsonb_typeof(ref->'version_id')='string'
  AND ref->>'version_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
END $$;
CREATE FUNCTION storefront_legal_document_valid(doc jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE kind text;
BEGIN
 IF jsonb_typeof(doc) IS DISTINCT FROM 'object' OR octet_length(doc::text)>4096 THEN RETURN false; END IF;
 IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(doc) k) IS DISTINCT FROM ARRAY['policies','profile','seller']
  OR doc->>'profile' IS DISTINCT FROM 'freedom.hosted-store-policies/v1'
  OR jsonb_typeof(doc->'policies') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(doc->'policies') k) IS DISTINCT FROM ARRAY['privacy','returns','shipping','terms']
  OR storefront_legal_ref_valid(doc->'seller') IS DISTINCT FROM true THEN RETURN false; END IF;
 FOREACH kind IN ARRAY ARRAY['shipping','returns','privacy','terms'] LOOP
  IF storefront_legal_ref_valid(doc->'policies'->kind) IS DISTINCT FROM true THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
CREATE TABLE commerce_publication_seller_policies (
 publication_id uuid PRIMARY KEY, tenant_id uuid NOT NULL, instance_id uuid NOT NULL, seller_version_id uuid,
 document jsonb NOT NULL CHECK(storefront_legal_document_valid(document)),
 policies_sha256 text NOT NULL CHECK(policies_sha256 ~ '^[0-9a-f]{64}$'),
 UNIQUE(publication_id,tenant_id,instance_id),
 FOREIGN KEY(publication_id,tenant_id,instance_id) REFERENCES commerce_storefront_publications(publication_id,tenant_id,instance_id),
 FOREIGN KEY(seller_version_id,tenant_id,instance_id) REFERENCES commerce_storefront_seller_versions(version_id,tenant_id,instance_id)
);
CREATE TABLE commerce_publication_policy_refs (
 publication_id uuid NOT NULL, tenant_id uuid NOT NULL, instance_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('shipping','returns','privacy','terms')), version_id uuid NOT NULL,
 PRIMARY KEY(publication_id,kind),
 FOREIGN KEY(publication_id,tenant_id,instance_id) REFERENCES commerce_publication_seller_policies(publication_id,tenant_id,instance_id),
 FOREIGN KEY(version_id,tenant_id,instance_id,kind) REFERENCES commerce_storefront_policy_versions(version_id,tenant_id,instance_id,kind)
);
CREATE INDEX commerce_publication_policy_history ON commerce_publication_policy_refs(tenant_id,instance_id,kind,version_id);
CREATE FUNCTION preserve_publication_legal_information() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Publication legal information is immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER preserve_publication_legal_information BEFORE UPDATE OR DELETE ON commerce_publication_seller_policies
 FOR EACH ROW EXECUTE FUNCTION preserve_publication_legal_information();
CREATE TRIGGER preserve_publication_legal_information BEFORE UPDATE OR DELETE ON commerce_publication_policy_refs
 FOR EACH ROW EXECUTE FUNCTION preserve_publication_legal_information();
CREATE FUNCTION require_complete_publication_legal_information() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE root commerce_publication_seller_policies%ROWTYPE; actual jsonb; policy_kind text;
BEGIN
 SELECT * INTO STRICT root FROM commerce_publication_seller_policies WHERE publication_id=NEW.publication_id;
 SELECT jsonb_build_object('version_id',v.version_id,'sha256',v.content_sha256) INTO actual
  FROM commerce_storefront_seller_versions v WHERE v.version_id=root.seller_version_id AND v.tenant_id=root.tenant_id AND v.instance_id=root.instance_id;
 IF COALESCE(actual,'null'::jsonb) IS DISTINCT FROM root.document->'seller'
  THEN RAISE EXCEPTION 'Seller freeze and reference must agree' USING ERRCODE='23514'; END IF;
 FOREACH policy_kind IN ARRAY ARRAY['shipping','returns','privacy','terms'] LOOP
  SELECT jsonb_build_object('version_id',v.version_id,'sha256',v.content_sha256) INTO actual
   FROM commerce_publication_policy_refs r JOIN commerce_storefront_policy_versions v
    ON v.version_id=r.version_id AND v.tenant_id=r.tenant_id AND v.instance_id=r.instance_id AND v.kind=r.kind
   WHERE r.publication_id=root.publication_id AND r.tenant_id=root.tenant_id AND r.instance_id=root.instance_id AND r.kind=policy_kind;
  IF COALESCE(actual,'null'::jsonb) IS DISTINCT FROM root.document->'policies'->policy_kind
   THEN RAISE EXCEPTION 'Policy freeze and references must agree' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER require_complete_publication_legal_information AFTER INSERT ON commerce_publication_seller_policies
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_complete_publication_legal_information();
CREATE CONSTRAINT TRIGGER require_complete_publication_legal_information AFTER INSERT ON commerce_publication_policy_refs
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_complete_publication_legal_information();

DO $$DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['commerce_storefront_seller_versions','commerce_storefront_policy_versions',
  'commerce_storefront_seller_drafts','commerce_storefront_policy_drafts','commerce_publication_seller_policies','commerce_publication_policy_refs'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO PUBLIC USING(tenant_id=freedom_ctx_tenant())',name||'_read',name);
  EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO PUBLIC WITH CHECK(tenant_id=freedom_ctx_tenant())',name||'_insert',name);
  IF name IN ('commerce_storefront_seller_drafts','commerce_storefront_policy_drafts') THEN
   EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE TO PUBLIC USING(tenant_id=freedom_ctx_tenant()) WITH CHECK(tenant_id=freedom_ctx_tenant())',name||'_update',name);
  END IF;
 END LOOP;
 FOREACH name IN ARRAY ARRAY['storefront_policy_text_valid(text,integer,boolean)','preserve_storefront_legal_version()',
  'preserve_storefront_legal_draft()','storefront_legal_ref_valid(jsonb)','storefront_legal_document_valid(jsonb)',
  'preserve_publication_legal_information()','require_complete_publication_legal_information()'] LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path=pg_catalog,%I',name,current_schema());
 END LOOP;
END $$;
-- OPEN-07 retention is undecided. No delete/prune admission; each component's
-- dense sequence is capped at 500, including unpublished and removal versions.
