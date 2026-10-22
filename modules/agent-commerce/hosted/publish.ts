import {draftGalleryData,publishedGalleryDigest,insertPublicationGallery,privateGalleryView,type GalleryOptions} from '../storefront/gallery/model.js';
import {RenderGallerySchema} from '../../../contracts/guild-launchpad/v1/storefront-gallery.js';
import {draftLegalSnapshot,publishedLegalDigest,insertPublicationLegal,renderDraftLegal,type PoliciesOptions} from '../storefront/policies/model.js';
import {lockAppearanceRead,draftAppearanceSnapshot,publishedAppearanceDigest,insertPublicationAppearance,renderAppearance,type AppearanceOptions} from './appearance.js';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { PublicStoreProjectionSchema, StorePreviewSchema, type PublicStoreProjection } from '../../../contracts/guild-launchpad/v1/storefront.js';
import { STOREFRONT_PUBLICATION_PROFILE, StorePublicationReviewSchema, type ReviewedPublicationInput, type StorePublicationReview } from '../../../contracts/guild-launchpad/v1/storefront-publication.js';
import { checkVersion, digest } from '../../../packages/db/index.js';
import { requireCondition } from '../../../packages/shared/problem.js';
import type { Actor } from '../../identity-membership/service.js';
import { profile, retailReady, storeCommand, storeRead, storeView, storeFact, type Profile } from './store.js';
import { photoProducts, draftMediaSnapshot, privatePhotoView, insertPublicationPhotos, type PhotoProduct } from './photo-projection.js';
import { storeHtml,productHtml } from './page.js';
import {distributionProducts} from './distribution.js';

async function publicationProducts(q: PoolClient, p: Profile): Promise<PhotoProduct[]> {
  const own = await photoProducts(q, p, { retailOnly: true }), shared = await distributionProducts(q, p);
  requireCondition(own.length+shared.length<=200, 500, 'storefront_product_limit', '商品資料超出上限。');
  // This projection does not extend the own-product photo reader/writer ACL.
  return [...own,...shared];
}

/** The same strict allowlist validates live preview, saved publication, and public reads. */
export function publicProjection(raw: unknown): PublicStoreProjection { return PublicStoreProjectionSchema.parse(raw); }
export function projectionDigest(projection: PublicStoreProjection): string {
  const { revision: _revision, published_at: _publishedAt, ...content } = projection;
  return digest(content);
}
async function nextRevision(q: PoolClient, p: Profile) {
  return (await q.query<{ revision: string }>(`SELECT (COALESCE(max(pub.revision),0)+1)::text AS revision FROM commerce_storefront_publications pub
    JOIN commerce_resource_tenants m ON m.instance_id=pub.instance_id AND m.tenant_id=pub.tenant_id
    WHERE m.tenant_id=$1 AND m.instance_id=$2 AND m.resource_id=$3`, [p.tenant_id, p.instance_id, p.storefront_shop_id])).rows[0].revision;
}
async function buildProjection(q: PoolClient, p: Profile, items: readonly PhotoProduct[]) {
  const now = (await q.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0].now;
  return publicProjection({ slug: p.slug, name: p.name, brand: p.brand, description: p.description, currency: p.currency,
    products: items.map(({product: { sku, title, description, price_minor }}) => ({ sku, title, description, price_minor })),
    revision: await nextRevision(q, p), published_at: now.toISOString(), transaction_state: 'not_enabled' });
}
async function draftPublicationDimensions(q: PoolClient, p: Profile, items: readonly PhotoProduct[], options: AppearanceOptions, policiesOptions: PoliciesOptions, galleryOptions: GalleryOptions) {
  return {
    appearance: options.enabled === true ? await draftAppearanceSnapshot(q, p) : undefined,
    policies: policiesOptions.enabled === true ? await draftLegalSnapshot(q, p) : undefined,
    gallery: galleryOptions.enabled === true ? await draftGalleryData(q, p, items) : undefined,
  };
}
type PublicationDimensions = Awaited<ReturnType<typeof draftPublicationDimensions>>;
async function publicationChanges(q: PoolClient, p: Profile, dimensions: PublicationDimensions) {
  const {appearance, policies, gallery} = dimensions;
  return {
    ...(appearance ? {appearance_changed: appearance.sha256 !== await publishedAppearanceDigest(q, p)} : {}),
    ...(policies ? {policies_changed: policies.sha256 !== await publishedLegalDigest(q, p)} : {}),
    ...(gallery ? {gallery_changed: gallery.sha256 !== await publishedGalleryDigest(q, p)} : {}),
  };
}
function publicationDirty(p: Profile, projection: PublicStoreProjection, mediaSha256: string, changes: Awaited<ReturnType<typeof publicationChanges>>) {
  return Object.values(changes).some(Boolean) || projectionDigest(projection) !== p.projection_sha256
    || p.template_id !== p.published_template_id || mediaSha256 !== p.media_sha256;
}
function publicationReviewDigest(p: Profile, projection: PublicStoreProjection, mediaSha256: string, dimensions: PublicationDimensions) {
  return digest({ profile: STOREFRONT_PUBLICATION_PROFILE, tenant_id: p.tenant_id, instance_id: p.instance_id,
    projection_sha256: projectionDigest(projection), template_id: p.template_id, media_sha256: mediaSha256,
    ...(dimensions.appearance ? {appearance_sha256: dimensions.appearance.sha256} : {}),
    ...(dimensions.policies ? {policies_sha256: dimensions.policies.sha256} : {}),
    ...(dimensions.gallery ? {gallery_sha256: dimensions.gallery.sha256} : {}) });
}
/** Review only saved, publishable content. Product/photo edits have their own versions. */
export async function reviewStorePublication(pool: Pool, actor: Actor, tenantId: string, instanceId: string, options: AppearanceOptions = {}, policiesOptions: PoliciesOptions = {}, galleryOptions: GalleryOptions = {}) {
  return storeRead(pool, actor, tenantId, instanceId, 'store:publish', async q => {
    if (options.enabled === true || policiesOptions.enabled === true || galleryOptions.enabled === true) await lockAppearanceRead(q, tenantId, instanceId);
    const p = await profile(q, tenantId, instanceId); retailReady(p);
    const items = await publicationProducts(q, p), media = draftMediaSnapshot(items);
    let projection = await buildProjection(q, p, items);
    const dimensions = await draftPublicationDimensions(q, p, items, options, policiesOptions, galleryOptions);
    const changes = await publicationChanges(q, p, dimensions);
    const dirty = publicationDirty(p, projection, media.sha256, changes);
    const reviewDigest = publicationReviewDigest(p, projection, media.sha256, dimensions);
    if (!dirty && p.projection) projection = publicProjection(p.projection);
    const photos = items.flatMap<StorePublicationReview['photos'][number]>(item => {
      if (dimensions.gallery && !('distributionPhotoVersion' in item)) {
        return privateGalleryView(p, item, dimensions.gallery.byId.get(item.product.product_id)!, galleryOptions).photos
          .map(photo => ({sku: item.product.sku, photo}));
      }
      const photo = privatePhotoView(p, item).photo;
      return photo ? [{sku: item.product.sku, photo}] : [];
    });
    return StorePublicationReviewSchema.parse({ profile: STOREFRONT_PUBLICATION_PROFILE, store_version: p.version,
      preview: { projection, dirty, current_revision: p.revision }, template_id: p.template_id,
      photo_count: photos.length, photos, review_digest: reviewDigest, ...changes });
  });
}
export async function previewStore(pool: Pool, actor: Actor, tenantId: string, instanceId: string, options: AppearanceOptions = {},policiesOptions:PoliciesOptions = {},galleryOptions:GalleryOptions = {}) {
  return storeRead(pool, actor, tenantId, instanceId, 'store:read', async q => {
    if(options.enabled===true||policiesOptions.enabled===true||galleryOptions.enabled===true)await lockAppearanceRead(q,tenantId,instanceId);
    const p = await profile(q, tenantId, instanceId); retailReady(p);
    const items = await publicationProducts(q, p);
    let projection = await buildProjection(q, p, items);
    const dimensions = await draftPublicationDimensions(q, p, items, options, policiesOptions, galleryOptions);
    const dirty = publicationDirty(p, projection, draftMediaSnapshot(items).sha256, await publicationChanges(q, p, dimensions));
    if (!dirty && p.projection) projection = publicProjection(p.projection);
    return StorePreviewSchema.parse({ projection, dirty, current_revision: p.revision });
  });
}
/** Private saved-draft preview uses the exact public renderer and its allowlisted projection. */
export async function previewStorePage(pool: Pool, actor: Actor, tenantId: string, instanceId: string, options: AppearanceOptions = {},policiesOptions:PoliciesOptions = {},galleryOptions:GalleryOptions = {}) {
  return storeRead(pool, actor, tenantId, instanceId, 'store:read', async q => {
    if(options.enabled===true||policiesOptions.enabled===true||galleryOptions.enabled===true)await lockAppearanceRead(q,tenantId,instanceId);
    const p = await profile(q, tenantId, instanceId); retailReady(p);
    const items = await publicationProducts(q, p);
    const appearance=options.enabled===true?renderAppearance((await draftAppearanceSnapshot(q,p)).document,{tenantId,instanceId,version:p.version},options.mediaInstalled===true):undefined;
    const policies=policiesOptions.enabled===true?renderDraftLegal((await draftLegalSnapshot(q,p)).input,`/api/v1/tenants/${tenantId}/storefronts/${instanceId}/preview-page`):undefined;
    return storeHtml(await buildProjection(q, p, items), p.template_id, items.map(item => ({ sku:item.product.sku,photo:privatePhotoView(p,item).photo })), {preview: true}, undefined, appearance, policies,galleryOptions.enabled===true?`/api/v1/tenants/${tenantId}/storefronts/${instanceId}/preview-page`:undefined);
  });
}
export async function publishStore(pool: Pool, actor: Actor, tenantId: string, instanceId: string, key: string, expected: string, unpublish = false, options: AppearanceOptions = {}, policiesOptions: PoliciesOptions = {}, galleryOptions: GalleryOptions = {}) {
  return changePublication(pool, actor, tenantId, instanceId, key, expected, unpublish, options, policiesOptions, galleryOptions);
}
export async function publishReviewedStore(pool: Pool, actor: Actor, tenantId: string, instanceId: string, input: ReviewedPublicationInput, key: string, expected: string, options: AppearanceOptions = {}, policiesOptions: PoliciesOptions = {}, galleryOptions: GalleryOptions = {}) {
  return changePublication(pool, actor, tenantId, instanceId, key, expected, false, options, policiesOptions, galleryOptions, input);
}
async function changePublication(pool: Pool, actor: Actor, tenantId: string, instanceId: string, key: string, expected: string, unpublish: boolean, options: AppearanceOptions, policiesOptions: PoliciesOptions, galleryOptions: GalleryOptions, review?: ReviewedPublicationInput) {
  const operation = unpublish ? 'storefront.unpublish' : review ? 'storefront.publish-reviewed' : 'storefront.publish';
  return storeCommand(pool, actor, tenantId, instanceId, 'store:publish', operation, review ?? {}, key, expected, async (q, context, inst) => {
    const p = await profile(q, tenantId, instanceId, true); retailReady(p); checkVersion(p.version, expected);
    if (unpublish) {
      if (!p.current_publication_id) return storeView(q, context, inst);
      await q.query(`UPDATE commerce_storefront_profiles p SET current_publication_id=NULL,version=p.version+1,updated_at=clock_timestamp()
        FROM commerce_resource_tenants m WHERE m.resource_id=p.storefront_shop_id AND m.tenant_id=$1 AND m.instance_id=$2 AND p.instance_id=m.instance_id`, [tenantId, instanceId]);
    } else {
      const items = await publicationProducts(q, p), media = draftMediaSnapshot(items);
      const projection = await buildProjection(q, p, items);
      const dimensions = await draftPublicationDimensions(q, p, items, options, policiesOptions, galleryOptions);
      const {appearance, policies, gallery} = dimensions;
      // Compare under the same instance/community/profile locks, using exactly
      // the rowset saved below. Do not run this check on a committed receipt replay.
      if (review) requireCondition(review.review_digest === publicationReviewDigest(p, projection, media.sha256, dimensions),
        409, 'storefront_publication_changed', '商品、照片或店面內容已更新，請重新確認後再上架。');
      requireCondition(projection.products.length > 0, 409, 'storefront_has_no_products', '請先新增至少一項商品再公開。');
      const hash = projectionDigest(projection);
      const changes = await publicationChanges(q, p, dimensions);
      if (p.current_publication_id && !publicationDirty(p, projection, media.sha256, changes)) return storeView(q, context, inst);
      const id = randomUUID();
      await q.query(`INSERT INTO commerce_storefront_publications(publication_id,instance_id,tenant_id,revision,slug,projection,projection_sha256,published_by_principal_id,published_at,template_id,media_sha256)
        SELECT $1,m.instance_id,m.tenant_id,$4,$5,$6,$7,$8,$9,$11,$12 FROM commerce_resource_tenants m
        WHERE m.tenant_id=$2 AND m.instance_id=$3 AND m.resource_id=$10 AND m.mapping_state='confirmed'`,
      [id, tenantId, instanceId, projection.revision, p.slug, projection, hash, context.principal_id, projection.published_at, p.storefront_shop_id, p.template_id, media.sha256]);
      await insertPublicationPhotos(q, id, p, items);
      if(appearance)await insertPublicationAppearance(q,id,p,appearance);
      if(policies)await insertPublicationLegal(q,id,p,policies);
      if(gallery)await insertPublicationGallery(q,id,p,gallery);
      await q.query(`UPDATE commerce_storefront_profiles p SET current_publication_id=$3,first_published_at=COALESCE(p.first_published_at,$4),version=p.version+1,updated_at=clock_timestamp()
        FROM commerce_resource_tenants m WHERE m.resource_id=p.storefront_shop_id AND m.tenant_id=$1 AND m.instance_id=$2 AND p.instance_id=m.instance_id`, [tenantId, instanceId, id, projection.published_at]);
    }
    await storeFact(q, context, instanceId, String(BigInt(p.version) + 1n), operation);
    return storeView(q, context, inst);
  });
}

/** Gallery-only draft detail. Same store:read, profile snapshot and renderer as
 * the catalog preview; supplied selections retain their existing private image. */
export async function previewProductPage(pool:Pool,actor:Actor,tenantId:string,instanceId:string,sku:string,options:AppearanceOptions={},policiesOptions:PoliciesOptions={},galleryOptions:GalleryOptions={}){
 return storeRead(pool,actor,tenantId,instanceId,'store:read',async q=>{
  await lockAppearanceRead(q,tenantId,instanceId);const p=await profile(q,tenantId,instanceId);retailReady(p);
  const items=await publicationProducts(q,p),item=items.find(p=>p.product.sku===sku);requireCondition(item,404,'not_found','找不到這項商品。');
  const data=await draftGalleryData(q,p,items),base=`/api/v1/tenants/${tenantId}/storefronts/${instanceId}/preview-page`;
  const appearance=options.enabled===true?renderAppearance((await draftAppearanceSnapshot(q,p)).document,{tenantId,instanceId,version:p.version},options.mediaInstalled===true):undefined;
  const policies=policiesOptions.enabled===true?renderDraftLegal((await draftLegalSnapshot(q,p)).input,base):undefined;
  const photos='distributionPhotoVersion' in item?(privatePhotoView(p,item).photo?[{...privatePhotoView(p,item).photo!,position:1,alt_text:''}]:[]):privateGalleryView(p,item,data.byId.get(item.product.product_id)!,galleryOptions).photos.map(({photo_key:_key,...photo})=>photo);
  return productHtml(await buildProjection(q,p,items),sku,items.map(item=>({sku:item.product.sku,photo:privatePhotoView(p,item).photo})),undefined,undefined,appearance,policies,RenderGallerySchema.parse(galleryOptions.mediaInstalled===true?photos:[]),base)!;
 });
}
