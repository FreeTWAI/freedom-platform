import {z} from 'zod';
import {OpaqueId, Version} from './primitives.js';
import {IsoTimeSchema} from './tenant.js';
import {ProductInputSchema} from './storefront.js';
import {SupplyOfferTermsSchema} from './hosted-supply-terms.js';
export {SupplyOfferTermsSchema} from './hosted-supply-terms.js';

// Roles only: the signed snapshot's person/shop identifiers stay on the server.
export const SupplyArrangementSchema = z.object({
  mode: z.literal('reseller'), seller_of_record: z.literal('seller'), payment_collector: z.literal('seller'),
  invoice_issuer: z.literal('seller'), refund_owner: z.literal('seller'), price_owner: z.literal('seller'),
  fulfillment_party: z.literal('supplier'),
}).strict();
export const SupplyOfferSchema = z.object({
  offer_id: OpaqueId, product_id: OpaqueId, supplier_name: z.string(), source_version: Version,
  terms: SupplyOfferTermsSchema, terms_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(['offered', 'withdrawn']), version: Version,
  published_at: IsoTimeSchema.optional(), arrangement: SupplyArrangementSchema.nullable().optional(),
}).strict();
export const SupplyOffersSchema = z.object({items: z.array(SupplyOfferSchema).max(100), truncated: z.boolean()}).strict();
export const DistributionInputSchema = z.object({
  offer_id: OpaqueId, terms_sha256: SupplyOfferSchema.shape.terms_sha256,
  retail_price_minor: ProductInputSchema.shape.price_minor,
}).strict();
export const DistributionDecisionSchema = z.object({
  decision: z.enum(['accepted', 'declined', 'revoked']), listing_sha256: SupplyOfferSchema.shape.terms_sha256,
  reason: z.string().trim().max(500).optional(),
}).strict();
export const DistributionSchema = z.object({
  selection_id: OpaqueId, offer: SupplyOfferSchema, sku: z.string(), seller_name: z.string(),
  retail_price_minor: ProductInputSchema.shape.price_minor,
  state: z.enum(['awaiting_supply_acceptance', 'sellable', 'declined', 'changes_requested', 'revoked']),
  listing_sha256: SupplyOfferSchema.shape.terms_sha256, version: Version,
  decision_note: z.string().max(500).nullable().optional(), arrangement: SupplyArrangementSchema.nullable().optional(),
}).strict();
export const DistributionsSchema = z.object({items: z.array(DistributionSchema).max(200), truncated: z.boolean()}).strict();
export const SalePathSchema = z.object({available: z.boolean(), reason: z.string().nullable()}).strict();
export const SupplyOfferPhotoStateSchema = z.object({
  state: z.enum(['shared', 'not_shared']), seq: Version.nullable(), matches_current_photo: z.boolean(),
}).strict();
export const SupplyOfferPhotoSchema = z.object({
  read_path: z.string().regex(/^\/api\/v1\/tenants\/[0-9a-f-]+\/storefronts\/[0-9a-f-]+\/supply-catalog\/[0-9a-f-]+\/photo\/[1-9][0-9]*$/),
  seq: Version, width: z.number().int().min(1).max(1920), height: z.number().int().min(1).max(1920),
}).strict();
export const SupplyCatalogPhotosSchema = z.object({
  items: z.array(z.object({offer_id: OpaqueId, photo: SupplyOfferPhotoSchema}).strict()).max(100),
  truncated: z.boolean(),
}).strict();
/** Owner preview on the existing private product-photo route. Both pins are required. */
export const SupplyOfferPhotoPreviewQuerySchema = z.object({offer_id:OpaqueId,seq:Version}).strict();
export const SupplyOfferPageSchema = z.object({
  offer: SupplyOfferSchema, published_at: IsoTimeSchema,
  photo: SupplyOfferPhotoSchema.nullable(),
  supplier: z.object({name: z.string(), public_path: z.string().regex(/^\/shops\/[a-z0-9-]+$/).nullable()}).strict(),
  selection: DistributionSchema.nullable(), decision_note: z.string().max(500).nullable(),
  sale_paths: z.object({display: SalePathSchema, reservation: SalePathSchema, checkout: SalePathSchema}).strict(),
}).strict();
export type SupplyOffer = z.infer<typeof SupplyOfferSchema>;
export type Distribution = z.infer<typeof DistributionSchema>;
