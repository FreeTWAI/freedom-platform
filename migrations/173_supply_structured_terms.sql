-- Structured supply references are advisory (ADR-027); they enforce no sale or fulfilment rule.
ALTER TABLE commerce_items
  ADD COLUMN msrp_minor bigint CHECK (msrp_minor BETWEEN 1 AND 100000000),
  ADD COLUMN minimum_order_quantity integer CHECK (minimum_order_quantity BETWEEN 1 AND 10000),
  ADD COLUMN lead_time_days integer CHECK (lead_time_days BETWEEN 0 AND 365);
