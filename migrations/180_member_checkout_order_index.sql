CREATE INDEX commerce_orders_member_checkout_created_idx
  ON commerce_orders (buyer_principal_id, created_at DESC, order_id DESC)
  WHERE order_profile = 'hosted_checkout' AND buyer_principal_id IS NOT NULL;
