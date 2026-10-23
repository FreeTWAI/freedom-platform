-- DC12 / Ted 2026-10-22: recurring bounded contact retention, including existing rows.
ALTER TABLE commerce_due_work DROP CONSTRAINT commerce_due_work_kind_check;
ALTER TABLE commerce_due_work ADD CONSTRAINT commerce_due_work_kind_check
  CHECK(kind IN ('payment_query','payment_window_end','email','offline_payment_window_end','checkout_contact_retention'));
CREATE INDEX commerce_checkout_contacts_retention ON commerce_checkout_contacts(tenant_id,instance_id,contact_id) WHERE redacted_at IS NULL;
CREATE INDEX commerce_checkout_contacts_live_email ON commerce_checkout_contacts(tenant_id,instance_id,contact_email) WHERE redacted_at IS NULL;
