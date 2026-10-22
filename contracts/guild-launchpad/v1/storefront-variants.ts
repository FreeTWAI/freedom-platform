import {z} from 'zod';
import {OpaqueId,Version} from './primitives.js';
import {ProductInputSchema,ProductViewSchema} from './storefront.js';
import {ProductPhotoSkuSchema} from './hosted-store-media.js';

export const STOREFRONT_VARIANTS_PROFILE='freedom.hosted-store-variants/v1' as const;
// A detached anchor has its own singleton identity while its retained catalog
// group keeps the original key. SKU URLs themselves never change.
export const ProductGroupKeySchema=z.string().regex(/^P[0-9]{4,23}(?:~single)?$(?![\s\S])/);
const forbidden=/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
const scalarPattern=(max:number,min=0)=>new RegExp(`^(?:[^\\uD800-\\uDFFF]|[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]){${min},${max}}$(?![\\s\\S])`);
const line=(max:number)=>z.string().regex(scalarPattern(max,1)).refine(v=>v.isWellFormed()&&!forbidden.test(v)&&[...v.trim()].length>=1&&[...v.trim()].length<=max);
export const VariantAxisNameSchema=line(20);
export const VariantValueNameSchema=line(40);
export const VariantGroupTitleSchema=line(120);
export const VariantGroupDescriptionSchema=z.string().regex(scalarPattern(2000)).refine(v=>v.isWellFormed()&&![...v].some(c=>/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(c))&&[...v.trim()].length<=2000);
export const VariantValueSchema=z.object({key:OpaqueId,name:VariantValueNameSchema}).strict();
export const VariantAxisSchema=z.object({key:OpaqueId,name:VariantAxisNameSchema,values:z.array(VariantValueSchema).min(1).max(20)}).strict().refine(a=>new Set(a.values.map(v=>v.key)).size===a.values.length&&new Set(a.values.map(v=>v.name)).size===a.values.length);
export const VariantMemberInputSchema=z.object({product_id:OpaqueId,product_version:Version,value_keys:z.array(OpaqueId).max(2)}).strict();
export const ReplaceProductGroupInputSchema=z.object({title:VariantGroupTitleSchema,description:VariantGroupDescriptionSchema,axes:z.array(VariantAxisSchema).max(2),members:z.array(VariantMemberInputSchema).min(1).max(200),default_product_id:OpaqueId,order:z.number().int().min(0).max(199)}).strict();
export const CreateVariantProductInputSchema=z.object({product:ProductInputSchema,value_keys:z.array(OpaqueId).max(2)}).strict();
export const SplitProductGroupInputSchema=z.object({}).strict();
export const ProductGroupMemberSchema=z.object({product:ProductViewSchema.extend({stock:z.number().int().min(0).max(1000000).nullable()}),selection_id:OpaqueId,source:z.enum(['own','supply']),value_keys:z.array(OpaqueId).max(2),values:z.array(z.string()).max(2),buyer_label:z.string().min(1).max(120),order:z.number().int().min(0).max(199)}).strict();
export const ProductGroupDraftSchema=z.object({profile:z.literal(STOREFRONT_VARIANTS_PROFILE),group_key:ProductGroupKeySchema,group_id:OpaqueId.nullable(),version:Version,title:z.string(),description:z.string(),axes:z.array(VariantAxisSchema).max(2),members:z.array(ProductGroupMemberSchema).min(1).max(200),default_product_id:OpaqueId,order:z.number().int().min(0).max(199),editable:z.boolean(),can_anchor:z.boolean()}).strict();
export type ProductGroupDraft=z.infer<typeof ProductGroupDraftSchema>;
export const ProductGroupPageSchema=z.object({profile:z.literal(STOREFRONT_VARIANTS_PROFILE),items:z.array(ProductGroupDraftSchema).max(200)}).strict();
export const VariantOperationSchema=z.enum(['replace','create-product','split']);
export const VariantCommandAckSchema=z.object({profile:z.literal(STOREFRONT_VARIANTS_PROFILE),group_key:ProductGroupKeySchema,operation:VariantOperationSchema,completed_version:Version,changed:z.boolean(),current:ProductGroupPageSchema}).strict();
export type VariantCommandAck=z.infer<typeof VariantCommandAckSchema>;
export const RenderVariantMemberSchema=z.object({sku:ProductPhotoSkuSchema,value_keys:z.array(OpaqueId).max(2),values:z.array(z.string()).max(2),buyer_label:z.string().min(1).max(120),order:z.number().int().min(0).max(199)}).strict();
export const RenderVariantGroupSchema=z.object({group_key:ProductGroupKeySchema,title:z.string().min(1).max(120),description:z.string().regex(scalarPattern(2000)).refine(v=>v.isWellFormed()&&[...v].length<=2000),axes:z.array(VariantAxisSchema).max(2),default_sku:ProductPhotoSkuSchema,gallery_sku:ProductPhotoSkuSchema,order:z.number().int().min(0).max(199),members:z.array(RenderVariantMemberSchema).min(1).max(200)}).strict();
export type RenderVariantGroup=z.infer<typeof RenderVariantGroupSchema>;
export const PublicationVariantsDocumentSchema=z.object({profile:z.literal(STOREFRONT_VARIANTS_PROFILE),groups:z.array(RenderVariantGroupSchema).max(200)}).strict().refine(d=>new TextEncoder().encode(JSON.stringify(d)).length<=4194304);
export type PublicationVariantsDocument=z.infer<typeof PublicationVariantsDocumentSchema>;
export const VariantErrorCodeSchema=z.enum(['variant_axes_invalid','variant_axis_name_invalid','variant_value_invalid','variant_group_text_invalid','variant_label_too_long','variant_member_values_invalid','variant_combination_duplicate','variant_singleton_requires_one_member','variant_default_invalid','variant_member_in_group','variant_supply_not_supported','variant_members_changed','variant_order_invalid','variant_anchor_retained','storefront_variants_invalid']);
