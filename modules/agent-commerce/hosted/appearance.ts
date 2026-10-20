import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Pool,PoolClient} from 'pg';
import {OpaqueId} from '../../../contracts/common/v1/identity.js';
import {STOREFRONT_APPEARANCE_PROFILE,AccentPresetSchema,AnnouncementSchema,FeaturedProductIdsSchema,
  StorefrontAppearanceInputSchema,StorefrontAppearanceDraftSchema,AppearanceCommandAckSchema,
  PrivateAppearanceImageSchema,PublicAppearanceImageSchema,type AppearanceRole} from '../../../contracts/guild-launchpad/v1/storefront-appearance.js';
import {ProductPhotoMetadataSchema,ProductPhotoSkuSchema} from '../../../contracts/guild-launchpad/v1/hosted-store-media.js';
import {checkVersion} from '../../../packages/db/index.js';
import {requireCondition} from '../../../packages/shared/problem.js';
import type {Actor} from '../../identity-membership/service.js';
import {profile,retailReady,storeCommand,storeRead,storeFact,type Profile} from './store.js';
import {photoProducts} from './photo-projection.js';

export interface AppearanceOptions {enabled?:boolean;mediaInstalled?:boolean;uploadsEnabled?:boolean}
export function parseAppearanceSettingsInput(raw:unknown){
  if(raw&&typeof raw==='object'&&!Array.isArray(raw)){
    const value=raw as Record<string,unknown>;
    if(Object.hasOwn(value,'announcement'))requireCondition(AnnouncementSchema.safeParse(value.announcement).success,422,'appearance_announcement_invalid','公告請使用單行純文字，最多 80 字。');
    if(Object.hasOwn(value,'featured_product_ids'))requireCondition(FeaturedProductIdsSchema.safeParse(value.featured_product_ids).success,422,'appearance_featured_invalid','主打商品最多 8 項，請選擇這間商店的商品且不要重複。');
  }
  const parsed=StorefrontAppearanceInputSchema.safeParse(raw);
  requireCondition(parsed.success,422,'validation_failed','外觀設定格式無效，請檢查主色、公告與主打商品。');
  return {...parsed.data,announcement:parsed.data.announcement.trim()};
}
const invalid=()=>requireCondition(false,500,'storefront_appearance_invalid','店面外觀暫時無法讀取。');
/** Pin metadata and media to the profile version read below. No writes or
 * external I/O occur while this read lock is held. */
export async function lockAppearanceRead(q:PoolClient,tenantId:string,instanceId:string){
  await q.query('SELECT instance_id FROM commerce_storefront_profiles WHERE tenant_id=$1 AND instance_id=$2 FOR SHARE',[tenantId,instanceId]);
}
const sha=z.string().regex(/^[0-9a-f]{64}$(?![\s\S])/);
/** Server-only identities. Never serialized into the anonymous projection or HTML. */
export const AppearanceRefSchema=ProductPhotoMetadataSchema.extend({asset_id:OpaqueId,representation_id:OpaqueId,scope_id:OpaqueId,
  policy_revision:z.string().min(1).max(160),purpose:z.literal('storefront.product-photo'),
  transform_version:z.literal('storefront.product-photo.webp.v1'),sha256:sha}).strict();
export type AppearanceRef=z.infer<typeof AppearanceRefSchema>;
export const PublicationAppearanceDocumentSchema=z.object({profile:z.literal(STOREFRONT_APPEARANCE_PROFILE),accent_preset:AccentPresetSchema,
  announcement:AnnouncementSchema,featured_product_ids:FeaturedProductIdsSchema,
  featured_skus:z.array(ProductPhotoSkuSchema).max(8).refine(v=>new Set(v).size===v.length),
  cover:AppearanceRefSchema.nullable(),logo:AppearanceRefSchema.nullable()}).strict()
  .refine(v=>!v.logo||v.logo.width===v.logo.height);
export type PublicationAppearanceDocument=z.infer<typeof PublicationAppearanceDocumentSchema>;
const defaultSettings={accent_preset:'lime' as const,announcement:'',featured_product_ids:[] as string[]};
function orderedRef(r:AppearanceRef|null){return r?{asset_id:r.asset_id,representation_id:r.representation_id,scope_id:r.scope_id,
  policy_revision:r.policy_revision,purpose:r.purpose,transform_version:r.transform_version,content_type:r.content_type,
  byte_size:r.byte_size,width:r.width,height:r.height,sha256:r.sha256}:null;}
export function appearanceSnapshot(raw:unknown){
  const d=PublicationAppearanceDocumentSchema.parse(raw);
  const document={profile:d.profile,accent_preset:d.accent_preset,announcement:d.announcement,
    featured_product_ids:d.featured_product_ids,featured_skus:d.featured_skus,cover:orderedRef(d.cover),logo:orderedRef(d.logo)};
  Object.freeze(document.featured_product_ids);Object.freeze(document.featured_skus);
  if(document.cover)Object.freeze(document.cover);if(document.logo)Object.freeze(document.logo);Object.freeze(document);
  return Object.freeze({document,sha256:createHash('sha256').update(JSON.stringify(document)).digest('hex')});
}
export const defaultAppearanceSnapshot=()=>appearanceSnapshot({profile:STOREFRONT_APPEARANCE_PROFILE,...defaultSettings,featured_skus:[],cover:null,logo:null});
function reference(row:Record<string,any>):AppearanceRef{
  return AppearanceRefSchema.parse({asset_id:row.asset_id,representation_id:row.representation_id,scope_id:row.scope_id,
    policy_revision:row.policy_revision,purpose:row.purpose,transform_version:row.transform_version,content_type:row.content_type,
    byte_size:Number(row.byte_size),width:row.width,height:row.height,sha256:row.content_sha256});
}
const metadata=(r:AppearanceRef)=>({content_type:r.content_type,byte_size:r.byte_size,width:r.width,height:r.height});
export async function draftAppearanceSnapshot(q:PoolClient,p:Profile){
  const settings=StorefrontAppearanceInputSchema.omit({template_id:true}).parse((await q.query(`SELECT accent_preset,announcement,featured_product_ids
    FROM commerce_storefront_appearance_drafts WHERE tenant_id=$1 AND instance_id=$2`,[p.tenant_id,p.instance_id])).rows[0]??defaultSettings);
  const own=await photoProducts(q,p,{retailOnly:true});
  const eligible_products=own.map(({product})=>({product_id:product.product_id,sku:product.sku,title:product.title}));
  const byId=new Map(eligible_products.map(product=>[product.product_id,product]));
  const rows=(await q.query(`SELECT t.kind,t.asset_id,o.asset_id AS object_asset_id,t.representation_id,t.scope_id,t.policy_revision,
    o.purpose,o.transform_version,o.content_type,o.byte_size,o.pixel_width AS width,o.pixel_height AS height,o.content_sha256
    FROM commerce_storefront_appearance_targets t
    LEFT JOIN assets a ON a.asset_id=t.asset_id AND a.scope_id=t.scope_id AND a.tenant_ref=t.tenant_id AND a.scope_kind='tenant'
      AND a.purpose=t.purpose AND a.state='ready' AND a.deletion_fence=0 AND a.representation_id=t.representation_id
    LEFT JOIN asset_objects o ON o.asset_id=a.asset_id AND o.representation_id=a.representation_id AND o.scope_id=a.scope_id
      AND o.policy_revision=t.policy_revision AND o.purpose=t.purpose AND o.profile_id='storefront.product-photo'
    WHERE t.tenant_id=$1 AND t.instance_id=$2 ORDER BY t.kind`,[p.tenant_id,p.instance_id])).rows;
  let cover:AppearanceRef|null=null,logo:AppearanceRef|null=null;
  for(const row of rows){if(row.asset_id===null)continue;if(!row.object_asset_id)invalid();
    if(row.kind==='storefront.cover')cover=reference(row);else if(row.kind==='storefront.logo')logo=reference(row);else invalid();}
  const snapshot=appearanceSnapshot({profile:STOREFRONT_APPEARANCE_PROFILE,...settings,
    featured_skus:settings.featured_product_ids.flatMap(id=>byId.has(id)?[byId.get(id)!.sku]:[]),cover,logo});
  return {...snapshot,settings,eligible_products,featured_products:settings.featured_product_ids.map(product_id=>({product_id,
    title:byId.get(product_id)?.title??null,state:byId.has(product_id)?'available' as const:'not_in_catalog' as const}))};
}
export async function publicationAppearance(q:PoolClient,publicationId:string,tenantId:string,instanceId:string){
  const row=(await q.query(`SELECT document,appearance_sha256 FROM commerce_publication_appearances
    WHERE publication_id=$1 AND tenant_id=$2 AND instance_id=$3`,[publicationId,tenantId,instanceId])).rows[0];
  if(!row)return defaultAppearanceSnapshot();
  const snapshot=appearanceSnapshot(row.document);if(snapshot.sha256!==row.appearance_sha256)invalid();
  const refs=(await q.query(`SELECT r.*,o.content_sha256 AS object_sha256,o.pixel_width AS object_width,o.pixel_height AS object_height
    FROM commerce_publication_appearance_refs r
    JOIN assets a ON a.asset_id=r.asset_id AND a.scope_id=r.scope_id AND a.tenant_ref=r.tenant_id AND a.scope_kind='tenant'
      AND a.purpose=r.purpose AND a.state='ready' AND a.deletion_fence=0 AND a.representation_id=r.representation_id
    JOIN asset_objects o ON o.asset_id=a.asset_id AND o.representation_id=a.representation_id AND o.scope_id=a.scope_id
      AND o.policy_revision=r.policy_revision AND o.purpose=r.purpose AND o.profile_id='storefront.product-photo'
    WHERE r.publication_id=$1 AND r.tenant_id=$2 AND r.instance_id=$3 ORDER BY r.kind`,[publicationId,tenantId,instanceId])).rows;
  for(const role of ['cover','logo'] as const){
    const r=refs.find(r=>r.kind===role);
    if(r&&(r.content_sha256!==r.object_sha256||r.width!==r.object_width||r.height!==r.object_height))invalid();
    if(JSON.stringify(orderedRef(r?reference(r):null))!==JSON.stringify(snapshot.document[role]))invalid();
  }
  if(refs.length!==Number(Boolean(snapshot.document.cover))+Number(Boolean(snapshot.document.logo)))invalid();
  return snapshot;
}
export async function publishedAppearanceDigest(q:PoolClient,p:Profile){
  return p.current_publication_id?(await publicationAppearance(q,p.current_publication_id,p.tenant_id,p.instance_id)).sha256:defaultAppearanceSnapshot().sha256;
}
export async function insertPublicationAppearance(q:PoolClient,id:string,p:Profile,snapshot:ReturnType<typeof appearanceSnapshot>){
  await q.query(`INSERT INTO commerce_publication_appearances(publication_id,tenant_id,instance_id,document,appearance_sha256)
    VALUES($1,$2,$3,$4,$5)`,[id,p.tenant_id,p.instance_id,snapshot.document,snapshot.sha256]);
  for(const role of ['cover','logo'] as const){const r=snapshot.document[role];if(!r)continue;
    await q.query(`INSERT INTO commerce_publication_appearance_refs(publication_id,kind,tenant_id,instance_id,scope_id,asset_id,representation_id,policy_revision)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,role,p.tenant_id,p.instance_id,r.scope_id,r.asset_id,r.representation_id,r.policy_revision]);}
}
/** Public render view contains no Asset, tenant, member, scope or policy identity. */
export interface RenderAppearance {accent_preset:z.infer<typeof AccentPresetSchema>;announcement:string;featured_skus:string[];
  cover:z.infer<typeof PublicAppearanceImageSchema>|z.infer<typeof PrivateAppearanceImageSchema>|null;
  logo:z.infer<typeof PublicAppearanceImageSchema>|z.infer<typeof PrivateAppearanceImageSchema>|null}
export function renderAppearance(d:PublicationAppearanceDocument,binding:{slug:string;revision:string}|{tenantId:string;instanceId:string;version:string},mediaInstalled:boolean):RenderAppearance{
  function image(role:AppearanceRole){const r=d[role];if(!r||!mediaInstalled)return null;
    return 'slug' in binding?PublicAppearanceImageSchema.parse({...metadata(r),read_path:`/shops/${binding.slug}/appearance-media/${binding.revision}/${role}`}):
      PrivateAppearanceImageSchema.parse({...metadata(r),read_path:`/api/v1/tenants/${binding.tenantId}/storefronts/${binding.instanceId}/appearance-media/${role}/${binding.version}`});}
  return {accent_preset:d.accent_preset,announcement:d.announcement,featured_skus:d.featured_skus,cover:image('cover'),logo:image('logo')};
}
export async function appearanceDraftView(q:PoolClient,p:Profile,options:AppearanceOptions={}){
  const draft=await draftAppearanceSnapshot(q,p),render=renderAppearance(draft.document,{tenantId:p.tenant_id,instanceId:p.instance_id,version:p.version},options.mediaInstalled===true);
  const supplied=(await q.query('SELECT EXISTS(SELECT 1 FROM commerce_selections WHERE shop_id=$1 AND hosted_offer_id IS NOT NULL) AS present',[p.storefront_shop_id])).rows[0].present;
  return StorefrontAppearanceDraftSchema.parse({profile:STOREFRONT_APPEARANCE_PROFILE,version:p.version,template_id:p.template_id,...draft.settings,
    featured_products:draft.featured_products,eligible_products:draft.eligible_products,has_supplied_products:supplied,
    cover:render.cover,logo:render.logo,media_installed:options.mediaInstalled===true,uploads_enabled:options.mediaInstalled===true&&options.uploadsEnabled===true,
    published_revision:p.revision,dirty:p.template_id!==p.published_template_id||draft.sha256!==await publishedAppearanceDigest(q,p)});
}
export async function readAppearanceSettings(pool:Pool,actor:Actor,tenantId:string,instanceId:string,options:AppearanceOptions={}){
  return storeRead(pool,actor,tenantId,instanceId,'store:read',async q=>{await lockAppearanceRead(q,tenantId,instanceId);const p=await profile(q,tenantId,instanceId);retailReady(p);return appearanceDraftView(q,p,options);});
}
export async function updateAppearanceSettings(pool:Pool,actor:Actor,tenantId:string,instanceId:string,raw:unknown,key:string,expected:string,options:AppearanceOptions={}){
  const input=parseAppearanceSettingsInput(raw);
  const completion=await storeCommand(pool,actor,tenantId,instanceId,'store:manage','storefront.appearance-settings.update',input,key,expected,async(q,context)=>{
    const p=await profile(q,tenantId,instanceId,true);retailReady(p);checkVersion(p.version,expected);
    const draft=await draftAppearanceSnapshot(q,p),old=new Set(draft.settings.featured_product_ids),eligible=new Set(draft.eligible_products.map(p=>p.product_id));
    requireCondition(input.featured_product_ids.every(id=>old.has(id)||eligible.has(id)),422,'appearance_featured_invalid','主打商品最多 8 項，請選擇這間商店的商品且不要重複。');
    const changed=p.template_id!==input.template_id||JSON.stringify(draft.settings)!==JSON.stringify({accent_preset:input.accent_preset,announcement:input.announcement,featured_product_ids:input.featured_product_ids});
    if(!changed)return {completed_version:p.version,changed:false};
    // BEFORE INSERT runs before ON CONFLICT. Updating an existing draft must
    // retain its known stale IDs rather than validating them as new selections.
    const values=[tenantId,instanceId,input.accent_preset,input.announcement,input.featured_product_ids];
    const updated=await q.query(`UPDATE commerce_storefront_appearance_drafts SET accent_preset=$3,announcement=$4,featured_product_ids=$5
      WHERE tenant_id=$1 AND instance_id=$2`,values);
    if(!updated.rowCount)await q.query(`INSERT INTO commerce_storefront_appearance_drafts(tenant_id,instance_id,accent_preset,announcement,featured_product_ids)
      VALUES($1,$2,$3,$4,$5)`,values);
    const version=String(BigInt(p.version)+1n);
    await q.query('UPDATE commerce_storefront_profiles SET template_id=$3,version=version+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND instance_id=$2',[tenantId,instanceId,input.template_id]);
    await storeFact(q,context,instanceId,version,'storefront.appearance-settings.update');
    return {completed_version:version,changed:true};
  });
  const current=await readAppearanceSettings(pool,actor,tenantId,instanceId,options);
  return AppearanceCommandAckSchema.parse({profile:STOREFRONT_APPEARANCE_PROFILE,...completion,current});
}
