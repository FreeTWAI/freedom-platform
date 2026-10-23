-- Ted's 2026-10-23 minimum: standing, versioned consent; no recipient projection or payment ledger.
CREATE TABLE commerce_fulfilment_agreements (
  agreement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  instance_id uuid NOT NULL,
  store_shop_id uuid NOT NULL REFERENCES commerce_shops(shop_id),
  supplier_tenant_id uuid NOT NULL,
  supplier_instance_id uuid NOT NULL,
  supplier_shop_id uuid NOT NULL REFERENCES commerce_shops(shop_id),
  version bigint NOT NULL CHECK(version>0),
  state text NOT NULL DEFAULT 'proposed' CHECK(state IN ('proposed','accepted','declined','withdrawn','revoked','superseded')),
  fee_per_order_minor bigint NOT NULL CHECK(fee_per_order_minor BETWEEN 0 AND 9007199254740900 AND fee_per_order_minor%100=0),
  currency text NOT NULL DEFAULT 'TWD' CHECK(currency='TWD'),
  promise_working_days integer NOT NULL CHECK(promise_working_days BETWEEN 1 AND 14),
  item_count integer NOT NULL CHECK(item_count BETWEEN 1 AND 200),
  terms_sha256 text NOT NULL CHECK(terms_sha256 ~ '^[0-9a-f]{64}$'),
  proposed_by_principal_id uuid NOT NULL REFERENCES principals(principal_id),
  proposed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_by_principal_id uuid REFERENCES principals(principal_id),
  decided_at timestamptz,
  signed_digest text CHECK(signed_digest ~ '^[0-9a-f]{64}$'),
  revoked_by_principal_id uuid REFERENCES principals(principal_id),
  revoked_at timestamptz,
  revoke_reason text CHECK(char_length(revoke_reason)<=200 AND revoke_reason !~ '[[:cntrl:]]'),
  FOREIGN KEY(tenant_id,instance_id) REFERENCES module_instances(tenant_id,instance_id),
  FOREIGN KEY(supplier_tenant_id,supplier_instance_id) REFERENCES module_instances(tenant_id,instance_id),
  UNIQUE(instance_id,supplier_instance_id,version),
  UNIQUE(agreement_id,tenant_id,instance_id,supplier_tenant_id),
  CHECK(instance_id<>supplier_instance_id),
  CHECK((decided_by_principal_id IS NULL)=(decided_at IS NULL)),
  CHECK((revoked_by_principal_id IS NULL)=(revoked_at IS NULL)),
  CHECK(signed_digest IS NULL OR signed_digest=terms_sha256)
);
CREATE INDEX commerce_fulfilment_agreements_supplier ON commerce_fulfilment_agreements(supplier_tenant_id,supplier_instance_id,state,proposed_at,agreement_id);
CREATE INDEX commerce_fulfilment_agreements_store ON commerce_fulfilment_agreements(tenant_id,instance_id,proposed_at,agreement_id);
ALTER TABLE commerce_fulfilment_agreements ENABLE ROW LEVEL SECURITY;
CREATE POLICY commerce_fulfilment_agreements_participants ON commerce_fulfilment_agreements FOR ALL TO PUBLIC
  USING(freedom_ctx_tenant() IN (tenant_id,supplier_tenant_id))
  WITH CHECK(freedom_ctx_tenant() IN (tenant_id,supplier_tenant_id));
CREATE TABLE commerce_fulfilment_agreement_items (
  agreement_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  instance_id uuid NOT NULL,
  supplier_tenant_id uuid NOT NULL,
  selection_id uuid NOT NULL REFERENCES commerce_selections(selection_id),
  item_id uuid NOT NULL REFERENCES commerce_items(item_id),
  state text NOT NULL CHECK(state IN ('proposed','accepted','declined','withdrawn','revoked','superseded')),
  PRIMARY KEY(agreement_id,selection_id),
  FOREIGN KEY(agreement_id,tenant_id,instance_id,supplier_tenant_id)
    REFERENCES commerce_fulfilment_agreements(agreement_id,tenant_id,instance_id,supplier_tenant_id)
);
-- The state mirrors its immutable parent terms; a trigger changes it with the parent.
CREATE UNIQUE INDEX commerce_fulfilment_agreement_accepted_selection ON commerce_fulfilment_agreement_items(instance_id,selection_id) WHERE state='accepted';
CREATE INDEX commerce_fulfilment_agreement_items_supplier ON commerce_fulfilment_agreement_items(supplier_tenant_id,agreement_id);
ALTER TABLE commerce_fulfilment_agreement_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY commerce_fulfilment_agreement_items_participants ON commerce_fulfilment_agreement_items FOR ALL TO PUBLIC
  USING(freedom_ctx_tenant() IN (tenant_id,supplier_tenant_id))
  WITH CHECK(freedom_ctx_tenant() IN (tenant_id,supplier_tenant_id));
CREATE FUNCTION preserve_commerce_fulfilment_agreement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'agreements are retained' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'proposed' OR NEW.tenant_id IS DISTINCT FROM freedom_ctx_tenant()
      OR NEW.decided_at IS NOT NULL OR NEW.signed_digest IS NOT NULL OR NEW.revoked_at IS NOT NULL OR NEW.revoke_reason IS NOT NULL
      OR NOT EXISTS(SELECT 1 FROM commerce_storefront_profiles s JOIN commerce_storefront_profiles p ON p.instance_id=NEW.supplier_instance_id
        JOIN commerce_shops ss ON ss.shop_id=s.storefront_shop_id JOIN commerce_shops ps ON ps.shop_id=p.supply_shop_id
        WHERE s.tenant_id=NEW.tenant_id AND s.instance_id=NEW.instance_id AND s.storefront_shop_id=NEW.store_shop_id AND s.slug IS NOT NULL
          AND p.tenant_id=NEW.supplier_tenant_id AND p.supply_shop_id=NEW.supplier_shop_id AND ss.community_id=ps.community_id AND ss.currency='TWD') THEN
      RAISE EXCEPTION 'invalid agreement proposal' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-ARRAY['state','decided_by_principal_id','decided_at','signed_digest','revoked_by_principal_id','revoked_at','revoke_reason'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','decided_by_principal_id','decided_at','signed_digest','revoked_by_principal_id','revoked_at','revoke_reason']) THEN
    RAISE EXCEPTION 'agreement terms are immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.state='proposed' AND NEW.state IN ('accepted','declined','withdrawn') THEN
    IF (NEW.state='withdrawn' AND freedom_ctx_tenant() IS DISTINCT FROM OLD.tenant_id)
      OR (NEW.state IN ('accepted','declined') AND freedom_ctx_tenant() IS DISTINCT FROM OLD.supplier_tenant_id)
      OR NEW.decided_by_principal_id IS NULL OR NEW.decided_at IS NULL OR NEW.decided_at<OLD.proposed_at
      OR NEW.signed_digest IS DISTINCT FROM (CASE WHEN NEW.state='accepted' THEN OLD.terms_sha256 ELSE NULL END)
      OR NEW.revoked_at IS NOT NULL OR NEW.revoked_by_principal_id IS NOT NULL OR NEW.revoke_reason IS NOT NULL THEN
      RAISE EXCEPTION 'invalid agreement decision' USING ERRCODE='23514';
    END IF;
  ELSIF OLD.state='accepted' AND NEW.state IN ('revoked','superseded') THEN
    IF freedom_ctx_tenant() NOT IN (OLD.tenant_id,OLD.supplier_tenant_id)
      OR (NEW.state='superseded' AND freedom_ctx_tenant() IS DISTINCT FROM OLD.supplier_tenant_id)
      OR ROW(NEW.decided_by_principal_id,NEW.decided_at,NEW.signed_digest) IS DISTINCT FROM ROW(OLD.decided_by_principal_id,OLD.decided_at,OLD.signed_digest)
      OR NEW.revoked_by_principal_id IS NULL OR NEW.revoked_at IS NULL OR NEW.revoked_at<OLD.decided_at THEN
      RAISE EXCEPTION 'invalid agreement revocation' USING ERRCODE='23514';
    END IF;
  ELSE RAISE EXCEPTION 'invalid agreement transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER preserve_commerce_fulfilment_agreement BEFORE INSERT OR UPDATE OR DELETE ON commerce_fulfilment_agreements
  FOR EACH ROW EXECUTE FUNCTION preserve_commerce_fulfilment_agreement();
CREATE FUNCTION preserve_commerce_fulfilment_agreement_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a commerce_fulfilment_agreements;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'agreement products are retained' USING ERRCODE='23514'; END IF;
  SELECT * INTO a FROM commerce_fulfilment_agreements WHERE agreement_id=NEW.agreement_id FOR UPDATE;
  IF NOT FOUND OR NEW.state IS DISTINCT FROM a.state THEN RAISE EXCEPTION 'agreement item state mismatch' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-'state') IS DISTINCT FROM (to_jsonb(OLD)-'state') OR NEW.state=OLD.state THEN
      RAISE EXCEPTION 'agreement products are immutable' USING ERRCODE='23514'; END IF;
  ELSIF a.state<>'proposed' OR freedom_ctx_tenant() IS DISTINCT FROM a.tenant_id
    OR (SELECT count(*) FROM commerce_fulfilment_agreement_items WHERE agreement_id=a.agreement_id)>=200
    OR NOT EXISTS(SELECT 1 FROM commerce_selections s JOIN commerce_items i USING(item_id)
      WHERE s.selection_id=NEW.selection_id AND s.item_id=NEW.item_id AND s.shop_id=a.store_shop_id
        AND s.acceptance_state='sellable' AND i.shop_id=a.supplier_shop_id) THEN
    RAISE EXCEPTION 'agreement requires sellable supplier selections, at most 200' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER preserve_commerce_fulfilment_agreement_item BEFORE INSERT OR UPDATE OR DELETE ON commerce_fulfilment_agreement_items
  FOR EACH ROW EXECUTE FUNCTION preserve_commerce_fulfilment_agreement_item();
CREATE FUNCTION sync_commerce_fulfilment_agreement_items() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE commerce_fulfilment_agreement_items SET state=NEW.state WHERE agreement_id=NEW.agreement_id;
  RETURN NULL;
END;
$$;
CREATE TRIGGER sync_commerce_fulfilment_agreement_items AFTER UPDATE OF state ON commerce_fulfilment_agreements
  FOR EACH ROW EXECUTE FUNCTION sync_commerce_fulfilment_agreement_items();
CREATE FUNCTION check_commerce_fulfilment_agreement_items() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM commerce_fulfilment_agreement_items WHERE agreement_id=NEW.agreement_id) IS DISTINCT FROM
    (SELECT item_count FROM commerce_fulfilment_agreements WHERE agreement_id=NEW.agreement_id) THEN
    RAISE EXCEPTION 'agreement requires 1 to 200 products' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER check_commerce_fulfilment_agreement_items AFTER INSERT ON commerce_fulfilment_agreements
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_commerce_fulfilment_agreement_items();
CREATE CONSTRAINT TRIGGER check_commerce_fulfilment_agreement_item_count AFTER INSERT ON commerce_fulfilment_agreement_items
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_commerce_fulfilment_agreement_items();
ALTER TABLE commerce_self_shipments ADD COLUMN shipper_instance_id uuid REFERENCES module_instances(instance_id);

CREATE OR REPLACE FUNCTION preserve_commerce_self_shipment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE co commerce_checkout_orders;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'self shipments are append only' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL AND NEW.tracking_number IS NULL AND NEW.carrier_name IS NULL
      AND (to_jsonb(NEW)-ARRAY['redacted_at','tracking_number','carrier_name']) IS NOT DISTINCT FROM
          (to_jsonb(OLD)-ARRAY['redacted_at','tracking_number','carrier_name']) THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'self shipments permit one privacy redaction only' USING ERRCODE='23514';
  END IF;
  SELECT * INTO co FROM commerce_checkout_orders WHERE order_id=NEW.order_id AND tenant_id=NEW.tenant_id AND instance_id=NEW.instance_id FOR UPDATE;
  IF NOT FOUND OR co.lifecycle_state<>'open' OR co.payment_method<>'bank_transfer' OR co.terms->>'currency' IS DISTINCT FROM 'TWD'
    OR jsonb_array_length(co.terms->'shipping'->'groups') IS DISTINCT FROM 1
    OR co.terms->'shipping'->'groups'->0->>'method_ref' IS DISTINCT FROM 'self_ship'
    OR co.terms->'shipping'->'groups'->0->'self_ship'->>'service_key' IS DISTINCT FROM 'seller.self_ship.v1'
    OR co.terms->'shipping'->'groups'->0->'logistics' IS DISTINCT FROM 'null'::jsonb
    OR co.terms->'shipping'->'groups'->0->'meetup' IS DISTINCT FROM 'null'::jsonb
    OR co.terms->'shipping'->'groups'->0->'attribute_versions' IS DISTINCT FROM '[]'::jsonb
    OR jsonb_array_length(co.terms->'shipping'->'groups'->0->'parcels') IS DISTINCT FROM 1
    OR co.terms->'shipping'->'groups'->0->'self_ship'->>'fee_basis' IS DISTINCT FROM 'order'
    OR co.terms->'shipping'->'groups'->0->'self_ship'->'working_days' IS DISTINCT FROM '[1,2,3,4,5]'::jsonb
    OR EXISTS(SELECT 1 FROM commerce_meetup_handovers WHERE order_id=NEW.order_id)
    OR NEW.redacted_at IS NOT NULL THEN
    RAISE EXCEPTION 'self shipment must match an open self shipped bank order' USING ERRCODE='23514';
  END IF;
  IF (
    (NEW.shipper_instance_id IS NULL AND co.terms->'shipping'->'groups'->0->>'fulfilment_mode'='self'
      AND co.terms->'shipping'->'groups'->0->'agreement'='null'::jsonb
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(co.terms->'bindings') b WHERE b->>'supplier_instance_id' IS DISTINCT FROM NEW.instance_id::text))
    OR (NEW.shipper_instance_id IS NOT NULL AND co.terms->'shipping'->'groups'->0->>'fulfilment_mode'='drop_ship'
      AND EXISTS(SELECT 1 FROM commerce_fulfilment_agreements a
        WHERE a.agreement_id=(co.terms->'shipping'->'groups'->0->'agreement'->>'agreement_id')::uuid
          AND a.version::text=co.terms->'shipping'->'groups'->0->'agreement'->>'version'
          AND a.tenant_id=NEW.tenant_id AND a.instance_id=NEW.instance_id AND a.supplier_instance_id=NEW.shipper_instance_id
          AND a.signed_digest=a.terms_sha256 AND a.decided_at IS NOT NULL
          AND a.supplier_shop_id::text=co.terms->'shipping'->'groups'->0->>'supplier_shop_id'
          AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(co.terms->'bindings') b
            WHERE b->>'supplier_instance_id' IS DISTINCT FROM a.supplier_instance_id::text
              OR NOT EXISTS(SELECT 1 FROM commerce_fulfilment_agreement_items ai WHERE ai.agreement_id=a.agreement_id
                AND ai.selection_id::text=b->>'selection_id' AND ai.item_id::text=b->>'item_id'))))
  ) IS NOT TRUE THEN RAISE EXCEPTION 'shipment shipper must match frozen agreement' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM commerce_offline_payments p JOIN commerce_checkout_payment_applications a ON a.payment_ref=p.payment_id AND a.order_id=p.order_id
      WHERE p.order_id=NEW.order_id AND p.method='bank_transfer' AND a.outcome IN ('converted','allocated','unallocatable')
        AND p.amount_minor=(co.terms->>'total_minor')::bigint
        AND NEW.sent_on>=(p.confirmed_at AT TIME ZONE 'Asia/Taipei')::date AND NEW.recorded_at>=p.confirmed_at)
    OR NEW.sent_on>(NEW.recorded_at AT TIME ZONE 'Asia/Taipei')::date OR NEW.recorded_at>clock_timestamp() THEN
    RAISE EXCEPTION 'self shipment requires confirmed payment and a valid sent date' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM commerce_inventory_allocations WHERE order_id=NEW.order_id AND (shipped_quantity<>0 OR released_quantity<>0))
    OR EXISTS(SELECT 1 FROM commerce_order_lines l LEFT JOIN commerce_inventory_allocations a ON a.order_id=l.order_id AND a.item_id=l.item_id
      WHERE l.order_id=NEW.order_id AND (a.allocation_id IS NULL OR a.quantity<>l.quantity))
    OR NOT EXISTS(SELECT 1 FROM commerce_order_lines WHERE order_id=NEW.order_id) THEN
    RAISE EXCEPTION 'self shipment requires complete unshipped allocations' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE member_notifications DROP CONSTRAINT member_notifications_kind_check;
ALTER TABLE member_notifications ADD CONSTRAINT member_notifications_kind_check CHECK (kind IN (
  'friend_request','friend_accepted','friend_declined','squad_invitation',
  'guild_application_approved','guild_application_rejected',
  'guild_expert_appointed','guild_expert_revoked',
  'guild_master_appointed','guild_master_revoked',
  'guild_member_promoted','guild_member_demoted',
  'event_submitted','event_review_needed','event_approved','event_rejected',
  'squad_member_removed','social_post_commented','social_post_liked',
  'squad_join_requested','squad_join_accepted',
  'event_waitlist_invited','event_schedule_changed','event_cancelled','event_start_reminder',
  'commerce_order_placed','commerce_order_buyer_cancelled','commerce_order_payment_confirmed',
  'commerce_order_handed_over','commerce_order_seller_cancelled','commerce_order_payment_expired','commerce_order_shipped',
  'commerce_drop_ship_proposed','commerce_drop_ship_accepted','commerce_drop_ship_declined','commerce_drop_ship_revoked',
  'commerce_drop_ship_payment_confirmed','commerce_drop_ship_shipped','commerce_drop_ship_unable'
));

ALTER TABLE commerce_exception_cases DROP CONSTRAINT commerce_exception_cases_kind_check,
  ADD CONSTRAINT commerce_exception_cases_kind_check CHECK(kind IN ('unmatched_payment','amount_mismatch','paid_unallocatable','paid_after_cancel','overpaid','payment_unconfirmed','contradicting_event','fulfiller_unable'));
ALTER TABLE commerce_exception_cases DROP CONSTRAINT commerce_exception_cases_subject_kind_check,
  ADD CONSTRAINT commerce_exception_cases_subject_kind_check CHECK(subject_kind IN ('payment_attempt','payment_event','offline_payment','order'));
ALTER TABLE commerce_exception_cases ADD CONSTRAINT commerce_exception_fulfiller_subject CHECK(kind<>'fulfiller_unable' OR (subject_kind='order' AND order_id=subject_id));

-- The existing exception owns this report; there is no separate recipient or fulfilment projection.
ALTER TABLE commerce_exception_cases ADD COLUMN fulfiller_reason text,
  ADD COLUMN fulfiller_note text,
  ADD CONSTRAINT commerce_exception_fulfiller_detail CHECK(
    (kind='fulfiller_unable' AND fulfiller_reason IS NOT NULL AND fulfiller_reason IN ('out_of_stock','cannot_ship','other')
      AND (fulfiller_note IS NULL OR (char_length(fulfiller_note)<=200 AND fulfiller_note !~ '[[:cntrl:]<>]')))
    OR (kind<>'fulfiller_unable' AND fulfiller_reason IS NULL AND fulfiller_note IS NULL));
