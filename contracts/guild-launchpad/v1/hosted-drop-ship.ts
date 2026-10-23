import {z} from 'zod';
import {OpaqueId,Version} from './primitives.js';
import {SelfShipmentSchema} from './hosted-checkout.js';
const time=z.string().datetime({offset:true});
const digest=z.string().regex(/^[0-9a-f]{64}$(?![\s\S])/);
const fee=z.number().int().nonnegative().max(9007199254740900).multipleOf(100);
const shortNote=z.string().trim().max(200).regex(/^[^\p{Cc}\p{Cf}<>]*$(?![\s\S])/u);
export const DropShipProposalSchema=z.object({supplier_instance_id:OpaqueId,selection_ids:z.array(OpaqueId).min(1).max(200),fee_per_order_minor:fee,promise_working_days:z.number().int().min(1).max(14)}).strict().refine(v=>new Set(v.selection_ids).size===v.selection_ids.length,'Duplicate products.');
export const DropShipDecisionSchema=z.object({terms_sha256:digest}).strict();
export const DropShipRevokeSchema=z.object({reason:shortNote.optional()}).strict();
export const DropShipUnableSchema=z.object({reason:z.enum(['out_of_stock','cannot_ship','other']),note:shortNote.optional()}).strict();
export const DropShipAgreementSchema=z.object({agreement_id:OpaqueId,tenant_id:OpaqueId,instance_id:OpaqueId,store_shop_id:OpaqueId,
  supplier_tenant_id:OpaqueId,supplier_instance_id:OpaqueId,supplier_shop_id:OpaqueId,store_name:z.string(),supplier_name:z.string(),version:Version,
  state:z.enum(['proposed','accepted','declined','withdrawn','revoked','superseded']),fee_per_order_minor:fee,currency:z.literal('TWD'),promise_working_days:z.number().int().min(1).max(14),terms_sha256:digest,
  proposed_by_principal_id:OpaqueId,proposed_at:time,decided_by_principal_id:OpaqueId.nullable(),decided_at:time.nullable(),signed_digest:digest.nullable(),
  revoked_by_principal_id:OpaqueId.nullable(),revoked_at:time.nullable(),revoke_reason:shortNote.nullable(),
  items:z.array(z.object({selection_id:OpaqueId,item_id:OpaqueId,title:z.string()}).strict()).min(1).max(200)}).strict();
export const DropShipAgreementsSchema=z.object({items:z.array(DropShipAgreementSchema).max(200)}).strict();
export const DropShipSupplierProductsSchema=z.object({items:z.array(z.object({supplier_instance_id:OpaqueId,supplier_name:z.string(),selection_id:OpaqueId,item_id:OpaqueId,title:z.string()}).strict()).max(200)}).strict();
export const DropShipOrderQuerySchema=z.object({tab:z.enum(['waiting','shipped']).optional(),limit:z.number().int().min(1).max(50).optional(),cursor:z.string().max(512).optional()}).strict();
export const DropShipOrderSchema=z.object({order_ref:OpaqueId,version:Version,store_name:z.string(),display_number:z.string(),payment_confirmed_at:time,ship_by:z.string(),
  items:z.array(z.object({sku:z.string(),title:z.string(),quantity:z.number().int().positive(),unit_supply_cost_minor:z.number().int().nonnegative(),supply_cost_minor:z.number().int().nonnegative()}).strict()).min(1).max(50),
  supply_cost_minor:z.number().int().nonnegative(),drop_ship_fee_minor:fee,currency:z.literal('TWD'),
  recipient:z.object({name:z.string(),mobile:z.string(),postal_code:z.string(),address:z.string()}).strict().nullable(),
  shipment:SelfShipmentSchema.nullable(),unable:z.object({reason:DropShipUnableSchema.shape.reason,note:shortNote.nullable()}).strict().nullable()}).strict();
export const DropShipOrdersSchema=z.object({items:z.array(DropShipOrderSchema).max(50),next_cursor:z.string().max(512).nullable()}).strict();
export type DropShipAgreement=z.infer<typeof DropShipAgreementSchema>;
export type DropShipOrder=z.infer<typeof DropShipOrderSchema>;
