import {z} from 'zod';
import {OpaqueId,Version} from './primitives.js';
import {ProductPhotoMetadataSchema,ProductPhotoSkuSchema} from './hosted-store-media.js';

export const STOREFRONT_GALLERY_PROFILE='freedom.hosted-store-gallery/v1' as const;
export const GalleryPhotoKeySchema=z.union([z.literal('main'),OpaqueId]);
const forbidden=/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
export const GalleryAltTextSchema=z.string().refine(v=>v.isWellFormed()&&!forbidden.test(v)&&[...v.trim()].length<=120,'照片說明請使用有效的單行文字，最多 120 字。');
export function normalizeGalleryAlt(raw:unknown):string{return GalleryAltTextSchema.parse(raw===undefined?'':raw).trim();}
const normalizedAlt=GalleryAltTextSchema.refine(v=>v===v.trim());
const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const path=new RegExp(`^/api/v1/tenants/(${uuid})/storefronts/(${uuid})/products/(${uuid})/gallery/photos/(main|${uuid})/([1-9][0-9]{0,18})$(?![\\s\\S])`);
export const GalleryPhotoSchema=ProductPhotoMetadataSchema.extend({photo_key:GalleryPhotoKeySchema,position:z.number().int().min(1).max(8),alt_text:normalizedAlt,read_path:z.string().max(310).regex(path)}).strict();
export const ProductGalleryDraftSchema=z.object({profile:z.literal(STOREFRONT_GALLERY_PROFILE),product_id:OpaqueId,version:Version,
 photos:z.array(GalleryPhotoSchema).max(8),retained_secondary_photos:z.array(GalleryPhotoSchema).max(7),media_installed:z.boolean(),uploads_enabled:z.boolean()}).strict()
 .refine(d=>d.photos.every((p,n)=>p.position===n+1&&(n!==0||p.photo_key==='main')))
 .refine(d=>new Set([...d.photos,...d.retained_secondary_photos].map(p=>p.photo_key)).size===d.photos.length+d.retained_secondary_photos.length)
 .refine(d=>d.photos.length===0||d.retained_secondary_photos.length===0)
 .refine(d=>[...d.photos,...d.retained_secondary_photos].every(p=>{const m=path.exec(p.read_path);return m?.[3]===d.product_id&&m[4]===p.photo_key&&m[5]===d.version;}));
export type ProductGalleryDraft=z.infer<typeof ProductGalleryDraftSchema>;
export const ProductGalleriesSchema=z.object({profile:z.literal(STOREFRONT_GALLERY_PROFILE),items:z.array(ProductGalleryDraftSchema).max(200)}).strict().refine(d=>new Set(d.items.map(p=>p.product_id)).size===d.items.length);
export const ReorderGalleryInputSchema=z.object({photo_keys:z.array(GalleryPhotoKeySchema).min(1).max(8).refine(v=>new Set(v).size===v.length)}).strict();
export const GalleryAltInputSchema=z.object({alt_text:GalleryAltTextSchema.optional()}).strict();
export const RemoveGalleryPhotoInputSchema=z.object({}).strict();
export const GalleryOperationSchema=z.enum(['upload','reorder','describe','remove']);
export const GalleryCommandAckSchema=z.object({profile:z.literal(STOREFRONT_GALLERY_PROFILE),product_id:OpaqueId,operation:GalleryOperationSchema,
 photo_key:GalleryPhotoKeySchema.nullable(),completed_version:Version,changed:z.boolean(),current:ProductGalleryDraftSchema}).strict()
 .refine(d=>d.product_id===d.current.product_id&&BigInt(d.completed_version)<=BigInt(d.current.version));
export type GalleryCommandAck=z.infer<typeof GalleryCommandAckSchema>;
/** Server-only immutable references. Never part of the public v1 projection. */
export const GalleryRefSchema=ProductPhotoMetadataSchema.extend({asset_id:OpaqueId,representation_id:OpaqueId,scope_id:OpaqueId,
 policy_revision:z.string().min(1).max(160),purpose:z.literal('storefront.product-photo'),transform_version:z.literal('storefront.product-photo.webp.v1'),sha256:z.string().regex(/^[0-9a-f]{64}$(?![\s\S])/)}).strict();
export type GalleryRef=z.infer<typeof GalleryRefSchema>;
export const PublicationGalleryDocumentSchema=z.object({profile:z.literal(STOREFRONT_GALLERY_PROFILE),products:z.array(z.object({sku:ProductPhotoSkuSchema,
 photos:z.array(z.object({position:z.number().int().min(1).max(8),alt_text:normalizedAlt,ref:GalleryRefSchema}).strict()).max(8).refine(v=>v.every((p,n)=>p.position===n+1))}).strict()).max(200)}).strict()
 .refine(d=>new Set(d.products.map(p=>p.sku)).size===d.products.length)
 .refine(d=>new TextEncoder().encode(JSON.stringify(d)).length<=4194304);
export type PublicationGalleryDocument=z.infer<typeof PublicationGalleryDocumentSchema>;
export const RenderGallerySchema=z.array(ProductPhotoMetadataSchema.extend({position:z.number().int().min(1).max(8),alt_text:normalizedAlt,read_path:z.string().max(310).regex(/^\/(?:shops\/|api\/v1\/tenants\/)[A-Za-z0-9_\-/]+$(?![\s\S])/)}).strict()).max(8).refine(v=>v.every((p,n)=>p.position===n+1));
export type RenderGallery=z.infer<typeof RenderGallerySchema>;
