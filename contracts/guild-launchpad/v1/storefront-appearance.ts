import {z} from 'zod';
import {OpaqueId,Version} from './primitives.js';
import {StoreTemplateSchema} from './storefront-presentation.js';
import {ProductPhotoMetadataSchema,ProductPhotoSkuSchema} from './hosted-store-media.js';

/** Independent sidecar; storefront/v1 and presentation/v1 remain unchanged. */
export const STOREFRONT_APPEARANCE_PROFILE='freedom.hosted-store-appearance/v1' as const;
export const AccentPresetSchema=z.enum(['lime','forest','ocean','indigo','rose','terracotta','gold','graphite']);
export type AccentPreset=z.infer<typeof AccentPresetSchema>;
export const ACCENT_PRESETS=[
  {id:'lime',name:'萊姆綠（預設）',fill:'#c4ff20',text:'#172200',border:'#537300',focus:'#537300'},
  {id:'forest',name:'森林綠',fill:'#166534',text:'#ffffff',border:'#166534',focus:'#166534'},
  {id:'ocean',name:'海洋藍',fill:'#1d4ed8',text:'#ffffff',border:'#1d4ed8',focus:'#1d4ed8'},
  {id:'indigo',name:'靛青紫',fill:'#5b21b6',text:'#ffffff',border:'#5b21b6',focus:'#5b21b6'},
  {id:'rose',name:'玫瑰紅',fill:'#9f1239',text:'#ffffff',border:'#9f1239',focus:'#9f1239'},
  {id:'terracotta',name:'陶土橘',fill:'#9a3412',text:'#ffffff',border:'#9a3412',focus:'#9a3412'},
  {id:'gold',name:'暖金黃',fill:'#facc15',text:'#422006',border:'#854d0e',focus:'#854d0e'},
  {id:'graphite',name:'石墨灰',fill:'#334155',text:'#ffffff',border:'#334155',focus:'#334155'},
] as const;
export const AppearanceRoleSchema=z.enum(['cover','logo']);
export type AppearanceRole=z.infer<typeof AppearanceRoleSchema>;
export const AnnouncementSchema=z.string().refine(v=>v.isWellFormed(),'公告列請使用有效的文字。')
  .refine(v=>[...v.trim()].length<=80,'公告列最多 80 個字。')
  .refine(v=>!/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(v),'公告列請使用單行純文字。');
export const FeaturedProductIdsSchema=z.array(OpaqueId).max(8).refine(v=>new Set(v).size===v.length);
export const StorefrontAppearanceInputSchema=z.object({template_id:StoreTemplateSchema,accent_preset:AccentPresetSchema,
  announcement:AnnouncementSchema,featured_product_ids:FeaturedProductIdsSchema}).strict();
const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const privatePath=new RegExp(`^/api/v1/tenants/(${uuid})/storefronts/(${uuid})/appearance-media/(cover|logo)/([1-9][0-9]{0,18})$(?![\\s\\S])`);
const publicPath=/^\/shops\/([a-z][a-z0-9-]{1,38}[a-z0-9])\/appearance-media\/([1-9][0-9]{0,18})\/(cover|logo)$(?![\s\S])/;
export const PrivateAppearanceImageSchema=ProductPhotoMetadataSchema.extend({read_path:z.string().max(220).regex(privatePath)
  .refine(v=>Version.safeParse(privatePath.exec(v)?.[4]).success)}).strict();
export const PublicAppearanceImageSchema=ProductPhotoMetadataSchema.extend({read_path:z.string().max(120).regex(publicPath)
  .refine(v=>Version.safeParse(publicPath.exec(v)?.[2]).success)}).strict();
export const StorefrontAppearanceDraftSchema=z.object({profile:z.literal(STOREFRONT_APPEARANCE_PROFILE),version:Version,
  template_id:StoreTemplateSchema,accent_preset:AccentPresetSchema,announcement:AnnouncementSchema,featured_product_ids:FeaturedProductIdsSchema,
  featured_products:z.array(z.object({product_id:OpaqueId,title:z.string().max(200).nullable(),state:z.enum(['available','not_in_catalog'])}).strict()).max(8),
  eligible_products:z.array(z.object({product_id:OpaqueId,sku:ProductPhotoSkuSchema,title:z.string().max(200)}).strict()).max(200),
  has_supplied_products:z.boolean(),cover:PrivateAppearanceImageSchema.nullable(),logo:PrivateAppearanceImageSchema.nullable(),
  media_installed:z.boolean(),uploads_enabled:z.boolean(),published_revision:Version.nullable(),dirty:z.boolean(),
}).strict().refine(v=>v.featured_product_ids.length===v.featured_products.length&&v.featured_product_ids.every((id,i)=>id===v.featured_products[i].product_id))
  .refine(v=>new Set(v.eligible_products.map(p=>p.product_id)).size===v.eligible_products.length)
  .refine(v=>(!v.cover||privatePath.exec(v.cover.read_path)?.[3]==='cover'&&privatePath.exec(v.cover.read_path)?.[4]===v.version)
    &&(!v.logo||v.logo.width===v.logo.height&&privatePath.exec(v.logo.read_path)?.[3]==='logo'&&privatePath.exec(v.logo.read_path)?.[4]===v.version));
export type StorefrontAppearanceDraft=z.infer<typeof StorefrontAppearanceDraftSchema>;
export const AppearanceCommandAckSchema=z.object({profile:z.literal(STOREFRONT_APPEARANCE_PROFILE),completed_version:Version,
  changed:z.boolean(),current:StorefrontAppearanceDraftSchema}).strict().refine(v=>v.completed_version.length<v.current.version.length
    ||v.completed_version.length===v.current.version.length&&v.completed_version<=v.current.version);
export type AppearanceCommandAck=z.infer<typeof AppearanceCommandAckSchema>;
export const RemoveAppearanceImageInputSchema=z.object({}).strict();
