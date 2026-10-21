// Launch default. These six responsibilities are also stored in every proposal.
export function resellerArrangement<S extends string, P extends string>(sellerId: S, supplierId: P) {
  return {mode: 'reseller' as const, seller_of_record: sellerId, payment_collector: sellerId,
    invoice_issuer: sellerId, refund_owner: sellerId, price_owner: sellerId, fulfillment_party: supplierId};
}
export const resellerRoles = resellerArrangement('seller', 'supplier');
