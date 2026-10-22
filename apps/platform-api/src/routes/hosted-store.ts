import {readCategoryBuyerPage} from '../../../../modules/agent-commerce/storefront/categories/read.js';
import {CategoryPageError,categoryErrorHtml} from '../../../../modules/agent-commerce/storefront/categories/pages.js';
import type {CategoriesOptions} from '../../../../modules/agent-commerce/storefront/categories/model.js';
import {catalogErrorHtml} from '../../../../modules/agent-commerce/storefront/variants/page.js';
import {readVariantBuyerPage} from '../../../../modules/agent-commerce/storefront/variants/buyer.js';
import type {VariantsOptions} from '../../../../modules/agent-commerce/storefront/variants/model.js';
import {retainedMemberOrderHeading} from '../../../../modules/agent-commerce/checkout/member-orders.js';
import {readSessionCookie} from '../session-cookie.js';
import {renderGallery,type GalleryOptions} from '../../../../modules/agent-commerce/storefront/gallery/model.js';
import type {PoliciesOptions} from '../../../../modules/agent-commerce/storefront/policies/model.js';
import type {AppearanceOptions} from '../../../../modules/agent-commerce/hosted/appearance.js';
import {SupplyCatalogSetupInputSchema,SupplyProductInputSchema,SupplyProductUpdateInputSchema} from '../../../../contracts/guild-launchpad/v1/hosted-supply-catalog.js';
import {readSupplyCatalog,setupSupplyCatalog,listSupplyProducts,addSupplyProduct,updateSupplyProduct} from '../../../../modules/agent-commerce/hosted/supply-catalog.js';
import { Hono } from 'hono';
import type { Pool } from 'pg';
import { OpaqueId } from '../../../../contracts/common/v1/identity.js';
import { EmptyStoreInputSchema, StoreSetupInputSchema, StoreUpdateInputSchema, ProductInputSchema, ProductUpdateInputSchema, SlugQuerySchema, SlugAvailabilitySchema } from '../../../../contracts/guild-launchpad/v1/storefront.js';
import { MyStoresQuerySchema, MyStoresLegacyProjectionSchema } from '../../../../contracts/guild-launchpad/v1/storefront-pagination.js';
import { listMyStores, setupStore, updateStore, storeRead, storeView, slugAvailability } from '../../../../modules/agent-commerce/hosted/store.js';
import { listProducts, addProduct, updateProduct, removeProduct } from '../../../../modules/agent-commerce/hosted/products.js';
import { previewStore, previewStorePage, publishStore, reviewStorePublication, publishReviewedStore } from '../../../../modules/agent-commerce/hosted/publish.js';
import { ReviewedPublicationInputSchema } from '../../../../contracts/guild-launchpad/v1/storefront-publication.js';
import { StoreAppearanceInputSchema } from '../../../../contracts/guild-launchpad/v1/storefront-presentation.js';
import { readStoreAppearance, updateStoreAppearance } from '../../../../modules/agent-commerce/hosted/presentation.js';
import { SupplyTermsInputSchema } from '../../../../contracts/guild-launchpad/v1/hosted-supply-terms.js';
import { readSupplyTerms, updateSupplyTerms } from '../../../../modules/agent-commerce/hosted/supply-terms.js';
import { readPublicStore, readPublicStorePage } from '../../../../modules/agent-commerce/hosted/public.js';
import { storeHtml, productHtml, publicProduct, storeMissingHtml } from '../../../../modules/agent-commerce/hosted/page.js';
import { cartPageHtml, checkoutPageHtml, orderPageHtml, retainedOrderPageHtml, orderMissingHtml, orderAccessPageHtml, paymentReturnPageHtml, paymentReturnMissingHtml } from '../../../../modules/agent-commerce/storefront/pages.js';
import { resolvePaymentReturn } from '../../../../modules/agent-commerce/payments/browser-return.js';
import { Problem } from '../../../../packages/shared/problem.js';
import { publicPurchaseState, type HostedCheckoutOptions } from '../../../../modules/agent-commerce/checkout/public-commands.js';
import type { PlatformEnv } from '../module-context.js';
import { privateCache, singleQuery, commandHeaders, etag } from './tenant-http.js';
import {createHostedDistributionRoutes} from './hosted-distribution.js';

export function createHostedStoreRoutes(pool: Pool, admissionEnabled = false, offerPhotosEnabled = false, appearanceOptions:AppearanceOptions = {},policiesOptions:PoliciesOptions = {},galleryOptions:GalleryOptions = {},variantsOptions:VariantsOptions = {},categoriesOptions:CategoriesOptions = {}) {
  const app = new Hono<PlatformEnv>();
  app.route('/', createHostedDistributionRoutes(pool, admissionEnabled, offerPhotosEnabled));
  app.use('*', async (c, next) => { try { await next(); } finally { privateCache(c); } });
  const ids = (c: Parameters<typeof singleQuery>[0]) => [OpaqueId.parse(c.req.param('tenant_id')), OpaqueId.parse(c.req.param('instance_id'))] as const;
  const root = '/tenants/:tenant_id/storefronts/:instance_id';
  app.get('/me/stores', async c => {
    const query = MyStoresQuerySchema.parse(singleQuery(c));
    const page = await listMyStores(pool, c.get('actor'), query.cursor);
    return c.json(query.pagination === 'cursor' ? page : MyStoresLegacyProjectionSchema.parse(page));
  });
  app.get('/me/supply-catalogs', async c => {
    const query = MyStoresQuerySchema.parse(singleQuery(c));
    const page = await listMyStores(pool, c.get('actor'), query.cursor, true);
    return c.json(query.pagination === 'cursor' ? page : MyStoresLegacyProjectionSchema.parse(page));
  });
  app.get(root + '/supply-profile', async c => {
    EmptyStoreInputSchema.parse(singleQuery(c)); const [t,i]=ids(c);
    const view=await readSupplyCatalog(pool,c.get('actor'),t,i);if(view.version)etag(c,view.version);return c.json(view);
  });
  app.post(root + '/supply-profile', async c => {
    const h=commandHeaders(c,false),body=SupplyCatalogSetupInputSchema.parse(await c.req.json()),[t,i]=ids(c);
    const result=await setupSupplyCatalog(pool,c.get('actor'),t,i,body,h.key);etag(c,result.version);
    return c.json(result,result.created?201:200);
  });
  app.get(root + '/supply-products', async c => {
    EmptyStoreInputSchema.parse(singleQuery(c));const [t,i]=ids(c);return c.json(await listSupplyProducts(pool,c.get('actor'),t,i));
  });
  app.post(root + '/supply-products', async c => {
    const h=commandHeaders(c,false),body=SupplyProductInputSchema.parse(await c.req.json()),[t,i]=ids(c);
    const product=await addSupplyProduct(pool,c.get('actor'),t,i,body,h.key);etag(c,product.version);return c.json(product,201);
  });
  app.patch(root + '/supply-products/:product_id', async c => {
    const h=commandHeaders(c,true),body=SupplyProductUpdateInputSchema.parse(await c.req.json()),[t,i]=ids(c);
    const product=await updateSupplyProduct(pool,c.get('actor'),t,i,OpaqueId.parse(c.req.param('product_id')),body,h.key,h.expected!);
    etag(c,product.version);return c.json(product);
  });
  app.get(root, async c => {
    EmptyStoreInputSchema.parse(singleQuery(c));
    const [t, i] = ids(c); const view = await storeRead(pool, c.get('actor'), t, i, 'store:read', (q, context, inst) => storeView(q, context, inst));
    if (view.version) etag(c, view.version); return c.json(view);
  });
  app.post(root + '/setup', async c => {
    const h = commandHeaders(c, false); const body = StoreSetupInputSchema.parse(await c.req.json()); const [t, i] = ids(c);
    const result = await setupStore(pool, c.get('actor'), t, i, body, h.key); if (result.view.version) etag(c, result.view.version);
    return c.json(result.view, result.created ? 201 : 200);
  });
  app.patch(root, async c => {
    const h = commandHeaders(c, true); const body = StoreUpdateInputSchema.parse(await c.req.json()); const [t, i] = ids(c);
    const view = await updateStore(pool, c.get('actor'), t, i, body, h.key, h.expected!); if (view.version) etag(c, view.version); return c.json(view);
  });
  app.get(root + '/slug-availability', async c => {
    const query = SlugQuerySchema.parse(singleQuery(c)); const [t, i] = ids(c);
    return c.json(await storeRead(pool, c.get('actor'), t, i, 'store:manage', async q => SlugAvailabilitySchema.parse(await slugAvailability(q, query.slug, i))));
  });
  app.get(root + '/products', async c => { EmptyStoreInputSchema.parse(singleQuery(c)); const [t, i] = ids(c); return c.json(await listProducts(pool, c.get('actor'), t, i)); });
  app.post(root + '/products', async c => {
    const h = commandHeaders(c, false); const body = ProductInputSchema.parse(await c.req.json()); const [t, i] = ids(c);
    const result = await addProduct(pool, c.get('actor'), t, i, body, h.key); etag(c, result.version); return c.json(result, 201);
  });
  app.patch(root + '/products/:product_id', async c => {
    const h = commandHeaders(c, true); const body = ProductUpdateInputSchema.parse(await c.req.json()); const [t, i] = ids(c);
    const result = await updateProduct(pool, c.get('actor'), t, i, OpaqueId.parse(c.req.param('product_id')), body, h.key, h.expected!); etag(c, result.version); return c.json(result);
  });
  app.post(root + '/products/:product_id/remove', async c => {
    const h = commandHeaders(c, true); EmptyStoreInputSchema.parse(await c.req.json()); const [t, i] = ids(c);
    return c.json(await removeProduct(pool, c.get('actor'), t, i, OpaqueId.parse(c.req.param('product_id')), h.key, h.expected!,variantsOptions.enabled===true));
  });
  app.get(root + '/products/:product_id/supply-terms', async c => {
    EmptyStoreInputSchema.parse(singleQuery(c)); const [t, i] = ids(c);
    const view = await readSupplyTerms(pool, c.get('actor'), t, i, OpaqueId.parse(c.req.param('product_id')));
    etag(c, view.version); return c.json(view);
  });
  app.patch(root + '/products/:product_id/supply-terms', async c => {
    EmptyStoreInputSchema.parse(singleQuery(c)); const h = commandHeaders(c, true); const [t, i] = ids(c);
    const body = SupplyTermsInputSchema.parse(await c.req.json());
    const view = await updateSupplyTerms(pool, c.get('actor'), t, i, OpaqueId.parse(c.req.param('product_id')), body, h.key, h.expected!);
    etag(c, view.version); return c.json(view);
  });
  app.get(root + '/preview', async c => { EmptyStoreInputSchema.parse(singleQuery(c)); const [t, i] = ids(c); return c.json(await previewStore(pool, c.get('actor'), t, i, appearanceOptions,policiesOptions,galleryOptions,variantsOptions,categoriesOptions)); });
  app.get(root + '/publication-review', async c => {
    EmptyStoreInputSchema.parse(singleQuery(c)); const [t, i] = ids(c);
    const review = await reviewStorePublication(pool, c.get('actor'), t, i, appearanceOptions,policiesOptions,galleryOptions,variantsOptions,categoriesOptions); etag(c, review.store_version); return c.json(review);
  });
  app.post(root + '/publish-reviewed', async c => {
    EmptyStoreInputSchema.parse(singleQuery(c)); const h = commandHeaders(c, true);
    const body = ReviewedPublicationInputSchema.parse(await c.req.json()); const [t, i] = ids(c);
    const view = await publishReviewedStore(pool, c.get('actor'), t, i, body, h.key, h.expected!, appearanceOptions,policiesOptions,galleryOptions,variantsOptions,categoriesOptions);
    if (view.version) etag(c, view.version); return c.json(view);
  });
  app.get(root + '/appearance', async c => {
    EmptyStoreInputSchema.parse(singleQuery(c)); const [t, i] = ids(c);
    const view = await readStoreAppearance(pool, c.get('actor'), t, i); etag(c, view.version); return c.json(view);
  });
  app.patch(root + '/appearance', async c => {
    EmptyStoreInputSchema.parse(singleQuery(c)); const h = commandHeaders(c, true);
    const body = StoreAppearanceInputSchema.parse(await c.req.json()); const [t, i] = ids(c);
    const view = await updateStoreAppearance(pool, c.get('actor'), t, i, body, h.key, h.expected!); etag(c, view.version); return c.json(view);
  });
  app.get(root + '/preview-page', async c => {
    if(categoriesOptions.enabled!==true)EmptyStoreInputSchema.parse(singleQuery(c));
    else {const params=new URL(c.req.url).searchParams;params.delete('category');EmptyStoreInputSchema.parse(Object.fromEntries(params));}
    const [t,i]=ids(c);c.header('X-Robots-Tag','noindex, nofollow');
    try{return c.html(await previewStorePage(pool,c.get('actor'),t,i,appearanceOptions,policiesOptions,galleryOptions,variantsOptions,categoriesOptions,new URL(c.req.url).searchParams.getAll('category')));}
    catch(e){if(e instanceof CategoryPageError)return c.html(categoryErrorHtml(e),e.status);throw e;}
  });
  for (const action of ['publish', 'unpublish'] as const) app.post(root + '/' + action, async c => {
    const h = commandHeaders(c, true); EmptyStoreInputSchema.parse(await c.req.json()); const [t, i] = ids(c);
    const view = await publishStore(pool, c.get('actor'), t, i, h.key, h.expected!, action === 'unpublish', appearanceOptions,policiesOptions,galleryOptions,variantsOptions,categoriesOptions); if (view.version) etag(c, view.version); return c.json(view);
  });
  return app;
}
/** `checkout` is the checkout API's own configuration (see `hostedCheckoutOptions`). */
export function createPublicHostedStoreRoutes(
  pool: Pool,
  publicOrigin?: string,
  checkout?: HostedCheckoutOptions,
  options?: { emailEnabled?: boolean; appearance?:AppearanceOptions;policies?:PoliciesOptions;gallery?:GalleryOptions;variants?:VariantsOptions;categories?:CategoriesOptions },
) {
  const app = new Hono<PlatformEnv>();
  const buyerJourneyEnabled = checkout?.settings?.checkoutEnabled === true;
  const emailEnabled = options?.emailEnabled ?? checkout?.settings?.emailEnabled ?? Boolean(checkout?.email);
  const variantPage=async(c:Parameters<typeof singleQuery>[0],readOptions=options)=>{try{return await readVariantBuyerPage(pool,c.req.param('slug')!,readOptions??{},checkout);}catch(e){
    if(e instanceof Problem&&['storefront_variants_invalid','storefront_categories_invalid','storefront_catalog_changed'].includes(e.code))return c.html(catalogErrorHtml(e.message,e.code==='storefront_catalog_changed'),e.status as 500);
    throw e;
  }};
  app.get('/api/v1/public/stores/:slug', async c => {
    c.header('Cache-Control', 'no-store'); c.header('X-Robots-Tag', 'noindex');
    const store = await readPublicStore(pool, c.req.param('slug'));
    if (!store) throw new Problem(404, 'not_found', '找不到這間商店。');
    c.header('Cache-Control', 'public, max-age=60'); return c.json(store);
  });
  app.get('/shops/:slug', async c => {
    c.header('Cache-Control', 'no-store'); c.header('X-Robots-Tag', 'noindex');
    try{
    if(options?.variants?.enabled===true){
      const result=await variantPage(c);if(result instanceof Response)return result;if(!result)return c.html(storeMissingHtml(),404);
      const {store,purchase,catalog}=result;return c.html(storeHtml(store.projection,store.template_id,store.media.photos,publicOrigin?{publicOrigin}:undefined,purchase,store.appearance,store.policies,undefined,catalog,options?.categories?.enabled===true?{document:store.categories!.document,query:new URL(c.req.url).searchParams.getAll('category'),base:`/shops/${store.projection.slug}`} : undefined));
    }
    const categoryPage=options?.categories?.enabled===true?await readCategoryBuyerPage(pool,c.req.param('slug'),options,checkout):undefined;
    const store = categoryPage===undefined?await readPublicStorePage(pool,c.req.param('slug'),options?.appearance,options?.policies):categoryPage?.store;
    if (!store) return c.html(storeMissingHtml(), 404);
    const purchase = categoryPage?.purchase??(checkout ? await publicPurchaseState(pool, store.projection.slug, checkout) : {open: false as const});
    return c.html(storeHtml(store.projection, store.template_id, store.media.photos, publicOrigin ? {publicOrigin} : undefined, purchase, store.appearance, store.policies,undefined,undefined,options?.categories?.enabled===true?{document:store.categories!.document,query:new URL(c.req.url).searchParams.getAll('category'),base:`/shops/${store.projection.slug}`} : undefined));
    }catch(e){if(e instanceof CategoryPageError)return c.html(categoryErrorHtml(e),e.status);if(e instanceof Problem&&['storefront_categories_invalid','storefront_catalog_changed'].includes(e.code))return c.html(catalogErrorHtml(e.message,e.code==='storefront_catalog_changed'),e.status as 500);throw e;}
  });
  app.get('/shops/:slug/products/:sku', async c => {
    c.header('Cache-Control', 'no-store'); c.header('X-Robots-Tag', 'noindex');
    if(options?.variants?.enabled===true){
      const result=await variantPage(c,{...options,categories:undefined}),sku=c.req.param('sku');if(result instanceof Response)return result;if(!result||!publicProduct(result.store.projection,sku))return c.html(storeMissingHtml(true),404);
      const {store,purchase,catalog}=result,group=catalog.document.groups.find(g=>g.members.some(m=>m.sku===sku))!;
      return c.html(productHtml(store.projection,sku,store.media.photos,publicOrigin?{publicOrigin}:undefined,purchase,store.appearance,store.policies,store.gallery?renderGallery(store.gallery.document,group.gallery_sku,store.projection.slug,store.projection.revision,options.gallery?.mediaInstalled===true):undefined,undefined,catalog)!);
    }
    const store = await readPublicStorePage(pool, c.req.param('slug'), options?.appearance,options?.policies,options?.gallery), sku = c.req.param('sku');
    if (!store || !publicProduct(store.projection, sku)) return c.html(storeMissingHtml(true), 404);
    const purchase = checkout ? await publicPurchaseState(pool, store.projection.slug, checkout, sku) : {open: false as const};
    const html = productHtml(store.projection, sku, store.media.photos, publicOrigin ? {publicOrigin} : undefined, purchase, store.appearance, store.policies,store.gallery?renderGallery(store.gallery.document,sku,store.projection.slug,store.projection.revision,options?.gallery?.mediaInstalled===true):undefined);
    if (!html) return c.html(storeMissingHtml(true), 404);
    return c.html(html);
  });
  app.get('/shops/:slug/cart', async c => {
    c.header('Cache-Control', 'no-store'); c.header('X-Robots-Tag', 'noindex');
    const store = await readPublicStorePage(pool, c.req.param('slug'), options?.appearance,options?.policies);
    if (!store) return c.html(storeMissingHtml(), 404);
    return c.html(cartPageHtml({...store.projection,appearance:store.appearance,policies:store.policies}, buyerJourneyEnabled));
  });
  app.get('/shops/:slug/checkout', async c => {
    c.header('Cache-Control', 'no-store'); c.header('X-Robots-Tag', 'noindex');
    const store = await readPublicStorePage(pool, c.req.param('slug'), options?.appearance,options?.policies);
    if (!store) return c.html(storeMissingHtml(), 404);
    return c.html(checkoutPageHtml({...store.projection,appearance:store.appearance,policies:store.policies}, buyerJourneyEnabled));
  });
  app.get('/shops/:slug/orders/:order_ref', async c => {
    c.header('Cache-Control', 'no-store'); c.header('X-Robots-Tag', 'noindex');
    const store = await readPublicStorePage(pool, c.req.param('slug'), options?.appearance,options?.policies);
    const orderRef = c.req.param('order_ref');
    if (!store) {
      if(buyerJourneyEnabled&&OpaqueId.safeParse(orderRef).success) {
        const heading=await retainedMemberOrderHeading(pool,c.req.param('slug'),orderRef,readSessionCookie(c.req.header('Cookie'),checkout!.origin));
        if(heading){privateCache(c);return c.html(retainedOrderPageHtml(heading,orderRef));}
      }
      return c.html(storeMissingHtml(),404);
    }
    if (!OpaqueId.safeParse(orderRef).success) return c.html(orderMissingHtml({...store.projection,appearance:store.appearance,policies:store.policies}), 404);
    return c.html(orderPageHtml({...store.projection,appearance:store.appearance,policies:store.policies}, orderRef, { emailEnabled, buyerJourneyEnabled }));
  });
  app.get('/shops/:slug/order-access', async c => {
    c.header('Cache-Control', 'no-store'); c.header('X-Robots-Tag', 'noindex');
    const store = await readPublicStorePage(pool, c.req.param('slug'), options?.appearance,options?.policies);
    if (!store) return c.html(storeMissingHtml(), 404);
    return c.html(orderAccessPageHtml({...store.projection,appearance:store.appearance,policies:store.policies}, { emailEnabled, buyerJourneyEnabled }));
  });
  app.get('/shops/:slug/payment-return/:attempt_ref', async c => {
    c.header('Cache-Control', 'no-store'); c.header('X-Robots-Tag', 'noindex');
    const store = await readPublicStorePage(pool, c.req.param('slug'), options?.appearance,options?.policies);
    if (!store) return c.html(storeMissingHtml(), 404);
    const attemptRef = c.req.param('attempt_ref');
    if (!OpaqueId.safeParse(attemptRef).success) return c.html(paymentReturnMissingHtml({...store.projection,appearance:store.appearance,policies:store.policies}), 404);
    const resolved = await resolvePaymentReturn(pool, store.projection.slug, attemptRef);
    if (!resolved) return c.html(paymentReturnMissingHtml({...store.projection,appearance:store.appearance,policies:store.policies}), 404);
    return c.html(paymentReturnPageHtml({...store.projection,appearance:store.appearance,policies:store.policies}, resolved.order_ref, attemptRef));
  });
  return app;
}
