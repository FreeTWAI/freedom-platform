import {digest} from '../../../packages/db/index.js';

export const supplyDisplayPath = (state: string, offerState: string) => ({
  available: state === 'sellable' && offerState === 'offered',
  reason: offerState !== 'offered' ? 'supply_withdrawn' : state !== 'sellable' ? 'supply_not_accepted' : null,
});

/** Same configuration gate for a supplier quote and the seller's private preview.
 * Lifecycle, publication and inventory are still revalidated by the quote command. */
export function supplierReservationEnabled(supplier: {reservation_enabled: boolean; currency: string}, seller: {currency: string}) {
  return supplier.reservation_enabled && supplier.currency === seller.currency;
}

/** Exact immutable-version consent used by sharedLines; never a price-only check. */
export function suppliedConsentAvailable(row: Record<string, any>, currency: string) {
  return !!(row.hosted_offer_id && supplyDisplayPath(row.acceptance_state, row.offer_state).available
    && row.acceptance_decision === 'accepted' && row.current_acceptance_id === row.acceptance_id
    && row.listing_sha256 === row.accepted_sha256 && digest(row.snapshot) === row.listing_sha256
    && row.snapshot.offer_sha256 === row.offer_sha256 && row.snapshot.offer_id === row.hosted_offer_id
    && row.offer_terms?.currency === currency);
}
