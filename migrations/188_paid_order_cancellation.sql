-- Whole-order cancellation of confirmed offline payments. Money moves outside the platform.
CREATE TABLE commerce_paid_cancellations (
  order_id uuid PRIMARY KEY REFERENCES commerce_checkout_orders(order_id),
  tenant_id uuid NOT NULL,
  instance_id uuid NOT NULL,
  payment_id uuid NOT NULL UNIQUE REFERENCES commerce_offline_payments(payment_id),
  reason text NOT NULL CHECK(reason IN ('out_of_stock','cannot_ship','buyer_request','other')),
  note text CHECK(char_length(note)<=200),
  cancelled_by_principal_id uuid NOT NULL REFERENCES principals(principal_id),
  cancelled_at timestamptz NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor>=0),
  currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
  refund_state text NOT NULL CHECK(refund_state IN ('pending','recorded')),
  refunded_on date,
  refund_method text CHECK(refund_method IN ('bank_transfer','cash')),
  refund_recorded_by_principal_id uuid REFERENCES principals(principal_id),
  refund_recorded_at timestamptz,
  FOREIGN KEY(tenant_id,instance_id) REFERENCES module_instances(tenant_id,instance_id),
  CHECK((refund_state='pending' AND refunded_on IS NULL AND refund_method IS NULL
      AND refund_recorded_by_principal_id IS NULL AND refund_recorded_at IS NULL)
    OR (refund_state='recorded' AND refunded_on IS NOT NULL AND refund_method IS NOT NULL
      AND refund_recorded_by_principal_id IS NOT NULL AND refund_recorded_at IS NOT NULL))
);
CREATE INDEX commerce_paid_cancellations_store ON commerce_paid_cancellations(tenant_id,instance_id,cancelled_at,order_id);
CREATE INDEX commerce_paid_cancellations_canceller ON commerce_paid_cancellations(cancelled_by_principal_id);
CREATE INDEX commerce_paid_cancellations_recorder ON commerce_paid_cancellations(refund_recorded_by_principal_id);
ALTER TABLE commerce_paid_cancellations ENABLE ROW LEVEL SECURITY;
CREATE POLICY commerce_paid_cancellations_tenant ON commerce_paid_cancellations FOR ALL TO PUBLIC
  USING(tenant_id=freedom_ctx_tenant()) WITH CHECK(tenant_id=freedom_ctx_tenant());

CREATE FUNCTION preserve_commerce_paid_cancellation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE co commerce_checkout_orders; p commerce_offline_payments;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'paid cancellations cannot be deleted' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND (OLD.refund_state<>'pending' OR NEW.refund_state<>'recorded'
    OR (to_jsonb(NEW)-ARRAY['refund_state','refunded_on','refund_method','refund_recorded_by_principal_id','refund_recorded_at']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['refund_state','refunded_on','refund_method','refund_recorded_by_principal_id','refund_recorded_at'])) THEN
    RAISE EXCEPTION 'paid cancellations permit one refund record only' USING ERRCODE='23514';
  END IF;
  SELECT * INTO co FROM commerce_checkout_orders WHERE order_id=NEW.order_id
    AND tenant_id=NEW.tenant_id AND instance_id=NEW.instance_id FOR UPDATE;
  IF NOT FOUND OR co.lifecycle_state<>'cancelled' OR co.cancel_reason IS DISTINCT FROM 'paid_cancelled'
    OR co.payment_method NOT IN ('bank_transfer','cash_on_meetup') OR co.cancelled_at IS DISTINCT FROM NEW.cancelled_at
    OR EXISTS(SELECT 1 FROM commerce_self_shipments WHERE order_id=NEW.order_id)
    OR EXISTS(SELECT 1 FROM commerce_meetup_handovers WHERE order_id=NEW.order_id)
    OR EXISTS(SELECT 1 FROM commerce_inventory_allocations WHERE order_id=NEW.order_id AND shipped_quantity<>0) THEN
    RAISE EXCEPTION 'paid cancellation requires an unshipped offline order' USING ERRCODE='23514';
  END IF;
  SELECT * INTO p FROM commerce_offline_payments WHERE payment_id=NEW.payment_id AND order_id=NEW.order_id
    AND tenant_id=NEW.tenant_id AND instance_id=NEW.instance_id AND method=co.payment_method;
  IF NOT FOUND OR p.amount_minor<>NEW.amount_minor OR p.currency<>NEW.currency
    OR NOT EXISTS(SELECT 1 FROM commerce_checkout_payment_applications a WHERE a.order_id=NEW.order_id
      AND a.payment_ref=p.payment_id AND a.outcome IN ('converted','allocated','unallocatable')) THEN
    RAISE EXCEPTION 'paid cancellation freezes the full confirmed offline payment' USING ERRCODE='23514';
  END IF;
  IF NEW.refund_state='recorded' AND (NEW.refunded_on<(p.confirmed_at AT TIME ZONE 'Asia/Taipei')::date
    OR NEW.refunded_on>(clock_timestamp() AT TIME ZONE 'Asia/Taipei')::date
    OR NEW.refund_recorded_at<p.confirmed_at OR NEW.refund_recorded_at>clock_timestamp()) THEN
    RAISE EXCEPTION 'refund date must follow payment confirmation through today' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER preserve_commerce_paid_cancellation BEFORE INSERT OR UPDATE OR DELETE ON commerce_paid_cancellations
  FOR EACH ROW EXECUTE FUNCTION preserve_commerce_paid_cancellation();

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
  'commerce_order_paid_cancelled','commerce_order_refund_recorded'
));
