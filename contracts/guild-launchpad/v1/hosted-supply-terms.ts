import {z} from 'zod';
import {OpaqueId, Version} from './primitives.js';
import {IsoTimeSchema} from './tenant.js';
import {CurrencySchema, ProductInputSchema, MerchantInventorySchema, merchantInventoryMatches} from './storefront.js';

const money = z.number().int().min(0).max(100000000);
const terms = z.string().regex(/^[^\u0000-\u0009\u000b-\u001f\u007f]*$/).trim().min(1).max(2000);
const referenceTerms = {
  msrp_minor: z.number().int().min(1).max(100000000),
  minimum_order_quantity: z.number().int().min(1).max(10000),
  lead_time_days: z.number().int().min(0).max(365),
};
/** Private preparation of existing stock and supply terms, not an offer or acceptance. */
export const SupplyTermsInputSchema = z.object({
  cost_minor: money.min(1), shipping_minor: money, shipping_terms: terms, return_terms: terms,
  // Omission preserves stored values for older clients; null explicitly clears.
  msrp_minor: referenceTerms.msrp_minor.nullable().optional(),
  minimum_order_quantity: referenceTerms.minimum_order_quantity.nullable().optional(),
  lead_time_days: referenceTerms.lead_time_days.nullable().optional(),
}).strict();
/** Unset references MUST be absent: adding null would change historical offer digests. */
export const SupplyOfferTermsSchema = SupplyTermsInputSchema.extend({
  title: ProductInputSchema.shape.title, description: z.string().max(4000), currency: CurrencySchema,
  msrp_minor: referenceTerms.msrp_minor.optional(),
  minimum_order_quantity: referenceTerms.minimum_order_quantity.optional(),
  lead_time_days: referenceTerms.lead_time_days.optional(),
}).strict();
export const SupplyTermsSchema = SupplyTermsInputSchema.extend({
  product_id: OpaqueId, currency: CurrencySchema,
  msrp_minor: referenceTerms.msrp_minor.nullable(),
  minimum_order_quantity: referenceTerms.minimum_order_quantity.nullable(),
  lead_time_days: referenceTerms.lead_time_days.nullable(),
  stock: z.number().int().min(0).max(1000000),
  reserved: z.number().int().min(0).max(1000000),
  available: z.number().int().min(0).max(1000000),
  current_offer: z.object({terms: SupplyOfferTermsSchema,
    supplier_name: z.string(), published_at: IsoTimeSchema, terms_sha256: z.string().regex(/^[a-f0-9]{64}$/)}).strict().nullable().optional(),
  version: Version, transaction_state: z.literal('not_enabled'), inventory: MerchantInventorySchema.optional(),
}).strict().refine(merchantInventoryMatches, 'inventory must match product counters');
export type SupplyTerms = z.infer<typeof SupplyTermsSchema>;
export type SupplyTermsInput = z.infer<typeof SupplyTermsInputSchema>;
