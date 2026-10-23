-- Seller self-shipping: one immutable, tenant-local whole-order shipment.
-- Disable intake to roll back application use; retain shipment and movement history.
CREATE TABLE commerce_self_shipments (
  shipment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  instance_id uuid NOT NULL,
  order_id uuid NOT NULL UNIQUE REFERENCES commerce_checkout_orders(order_id),
  carrier_key text NOT NULL CHECK(carrier_key IN ('post','tcat','hct','tjoin','other')),
  carrier_name text,
  tracking_number text,
  sent_on date NOT NULL CHECK(sent_on>=DATE '2000-01-01' AND sent_on<DATE '2100-01-01'),
  recorded_by_principal_id uuid NOT NULL REFERENCES principals(principal_id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  redacted_at timestamptz,
  FOREIGN KEY(tenant_id,instance_id) REFERENCES module_instances(tenant_id,instance_id),
  CHECK((redacted_at IS NULL AND tracking_number IS NOT NULL AND tracking_number ~ '^[0-9A-Za-z-]{1,50}$'
      AND ((carrier_key='other' AND carrier_name IS NOT NULL AND char_length(carrier_name) BETWEEN 1 AND 40
        AND carrier_name=btrim(carrier_name) AND carrier_name !~ '[[:cntrl:]<>]' AND carrier_name !~ U&'[\202A-\202E\2066-\2069]')
        OR (carrier_key<>'other' AND carrier_name IS NULL)))
    OR (redacted_at IS NOT NULL AND tracking_number IS NULL AND carrier_name IS NULL)),
  CHECK(redacted_at IS NULL OR redacted_at>=recorded_at)
);
CREATE INDEX commerce_self_shipments_store ON commerce_self_shipments(tenant_id,instance_id,recorded_at,shipment_id);
CREATE INDEX commerce_self_shipments_recorder ON commerce_self_shipments(recorded_by_principal_id);
ALTER TABLE commerce_self_shipments ENABLE ROW LEVEL SECURITY;
CREATE POLICY commerce_self_shipments_tenant ON commerce_self_shipments FOR ALL TO PUBLIC
  USING(tenant_id=freedom_ctx_tenant()) WITH CHECK(tenant_id=freedom_ctx_tenant());

CREATE FUNCTION preserve_commerce_self_shipment() RETURNS trigger LANGUAGE plpgsql AS $$
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
    OR co.terms->'shipping'->'groups'->0->>'fulfilment_mode' IS DISTINCT FROM 'self'
    OR co.terms->'shipping'->'groups'->0->'self_ship'->>'service_key' IS DISTINCT FROM 'seller.self_ship.v1'
    OR co.terms->'shipping'->'groups'->0->'logistics' IS DISTINCT FROM 'null'::jsonb
    OR co.terms->'shipping'->'groups'->0->'meetup' IS DISTINCT FROM 'null'::jsonb
    OR co.terms->'shipping'->'groups'->0->'agreement' IS DISTINCT FROM 'null'::jsonb
    OR co.terms->'shipping'->'groups'->0->'attribute_versions' IS DISTINCT FROM '[]'::jsonb
    OR jsonb_array_length(co.terms->'shipping'->'groups'->0->'parcels') IS DISTINCT FROM 1
    OR co.terms->'shipping'->'groups'->0->'self_ship'->>'fee_basis' IS DISTINCT FROM 'order'
    OR co.terms->'shipping'->'groups'->0->'self_ship'->'working_days' IS DISTINCT FROM '[1,2,3,4,5]'::jsonb
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(co.terms->'bindings') b WHERE b->>'supplier_instance_id' IS DISTINCT FROM NEW.instance_id::text)
    OR EXISTS(SELECT 1 FROM commerce_meetup_handovers WHERE order_id=NEW.order_id)
    OR NEW.redacted_at IS NOT NULL THEN
    RAISE EXCEPTION 'self shipment must match an open self shipped bank order' USING ERRCODE='23514';
  END IF;
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
CREATE TRIGGER preserve_commerce_self_shipment BEFORE INSERT OR UPDATE OR DELETE ON commerce_self_shipments
  FOR EACH ROW EXECUTE FUNCTION preserve_commerce_self_shipment();

CREATE FUNCTION check_commerce_self_shipment_inventory() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM commerce_inventory_allocations a
      LEFT JOIN commerce_inventory_movements m ON m.allocation_id=a.allocation_id AND m.kind='ship' AND m.source_ref=NEW.shipment_id
      WHERE a.order_id=NEW.order_id AND (a.released_quantity<>0 OR a.shipped_quantity<>a.quantity OR m.quantity IS DISTINCT FROM a.quantity))
    OR EXISTS(SELECT 1 FROM commerce_inventory_movements m WHERE m.kind='ship'
      AND ((m.order_id=NEW.order_id AND m.source_ref<>NEW.shipment_id) OR (m.source_ref=NEW.shipment_id AND m.order_id<>NEW.order_id))) THEN
    RAISE EXCEPTION 'self shipment and whole order ship movements must commit together' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER check_commerce_self_shipment_inventory AFTER INSERT ON commerce_self_shipments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_commerce_self_shipment_inventory();

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
  'commerce_order_handed_over','commerce_order_seller_cancelled','commerce_order_payment_expired','commerce_order_shipped'
));
