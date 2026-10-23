import {dropShipCoverage} from '../fulfilment/drop-ship/coverage.js';
import {objectKey, readVerifiedObject, type ObjectStore} from '../../../packages/asset-storage/index.js';
import {OpaqueId, Version} from '../../../contracts/guild-launchpad/v1/primitives.js';
import {currentOfferPhoto, appendCurrentOfferPhoto} from '../supplier-console/offer-photos.js';
import {randomUUID} from 'node:crypto';
import type {Pool, PoolClient} from 'pg';
import {checkVersion, digest} from '../../../packages/db/index.js';
import {Problem, requireCondition} from '../../../packages/shared/problem.js';
import {SupplyCatalogPhotosSchema, SupplyOfferPageSchema, SupplyOfferSchema, SupplyOffersSchema, SupplyOfferTermsSchema, DistributionInputSchema, DistributionDecisionSchema,
  DistributionSchema, DistributionsSchema, type SupplyOffer} from '../../../contracts/guild-launchpad/v1/hosted-distribution.js';
import type {Actor} from '../../identity-membership/service.js';
import {resellerArrangement} from '../distribution.js';
import {supplyDisplayPath, supplierReservationEnabled} from './supply-availability.js';
import {sharedLines} from './shared-quotes.js';
import {hostedLineFulfilment, fulfilmentConsentFailure} from '../fulfilment/rules/index.js';
import {readPublicStorePage} from './public.js';
import {profile, ready, retailReady, productCount, storeRead, storeCommand, storeFact, type Profile} from './store.js';

export function offerView(row: Record<string, any>): SupplyOffer {
  return SupplyOfferSchema.parse({offer_id: row.offer_id, product_id: row.item_id, supplier_name: row.supplier_name,
    source_version: String(row.source_version), terms: row.terms, terms_sha256: row.terms_sha256, state: row.state, version: String(row.version),
    published_at: row.created_at ? new Date(row.created_at).toISOString() : undefined,
    arrangement: arrangementView(resellerArrangement('seller', 'supplier'))});
}
function arrangementView(value: Record<string, unknown> | undefined) {
  if (!value || value.mode !== 'reseller' || !value.seller_of_record || !value.fulfillment_party) return null;
  const expected = resellerArrangement(String(value.seller_of_record), String(value.fulfillment_party));
  return Object.entries(expected).every(([key, role]) => value[key] === role) ? resellerArrangement('seller', 'supplier') : null;
}
export function supplyOfferTerms(row: {title: string; description: string; price_minor: string | number; shipping_minor: string | number; shipping_terms: string; return_terms: string; msrp_minor: string | number | null; minimum_order_quantity: number | null; lead_time_days: number | null}, currency: 'TWD' | 'USD') {
  return SupplyOfferTermsSchema.parse({title: row.title, description: row.description, currency,
    cost_minor: Number(row.price_minor), shipping_minor: Number(row.shipping_minor), shipping_terms: row.shipping_terms, return_terms: row.return_terms,
    ...(row.msrp_minor==null?{}:{msrp_minor:Number(row.msrp_minor)}),
    ...(row.minimum_order_quantity==null?{}:{minimum_order_quantity:row.minimum_order_quantity}),
    ...(row.lead_time_days==null?{}:{lead_time_days:row.lead_time_days})});
}
/** Text and evaluation photos share this window, before filtering out missing photos. */
async function supplyOfferRows(q: PoolClient, communityId: string, p: Profile, own = false) {
  return (await q.query(`SELECT * FROM commerce_hosted_supply_offers WHERE community_id=$1
      AND state='offered' AND ($2::boolean AND instance_id=$3 OR NOT $2::boolean AND instance_id<>$3 AND terms->>'currency'=$4)
      ORDER BY offer_id LIMIT 101`, [communityId, own, p.instance_id, p.currency])).rows;
}
export async function listSupplyOffers(pool: Pool, actor: Actor, tenantId: string, instanceId: string, own = false) {
  return storeRead(pool, actor, tenantId, instanceId, 'store:write', async (q, context) => {
    const p = await profile(q, tenantId, instanceId); ready(p);
    const rows = await supplyOfferRows(q, context.community_id, p, own);
    return SupplyOffersSchema.parse({items: rows.slice(0, 100).map(offerView), truncated: rows.length>100});
  });
}
/** Seller-bound read only. Latest rows include stops, so older shares cannot revive. */
export async function listSupplyCatalogPhotos(pool: Pool, actor: Actor, tenantId: string, instanceId: string) {
  return storeRead(pool, actor, tenantId, instanceId, 'store:write', async (q, context) => {
    const p = await profile(q, tenantId, instanceId); ready(p);
    const rows = await supplyOfferRows(q, context.community_id, p);
    const ids = rows.slice(0, 100).map(row=>row.offer_id as string);
    // Batched equivalent of currentOfferPhoto; never query supplier Assets or rebind a tenant.
    const photos = ids.length ? (await q.query(`SELECT DISTINCT ON (p.offer_id) p.offer_id,p.seq::text,p.asset_id,p.width,p.height
      FROM commerce_hosted_offer_photos p WHERE p.offer_id=ANY($1::uuid[]) ORDER BY p.offer_id,p.seq DESC`, [ids])).rows : [];
    const byOffer = new Map(photos.map(photo=>[photo.offer_id, photo]));
    return SupplyCatalogPhotosSchema.parse({items: ids.flatMap(offerId=>{
      const photo = byOffer.get(offerId);
      return photo?.asset_id ? [{offer_id: offerId, photo: {seq:photo.seq,width:photo.width,height:photo.height,
        read_path:`/api/v1/tenants/${tenantId}/storefronts/${instanceId}/supply-catalog/${offerId}/photo/${photo.seq}`}}] : [];
    }), truncated: rows.length>100});
  });
}
/** Publish only the named product's explicit supply allowlist. Saving private terms
 * never enters this member-visible catalog, and publishing does not accept a seller. */
export async function publishSupplyOffer(pool: Pool, actor: Actor, tenantId: string, instanceId: string, productId: string, key: string, expected: string, offerPhotosEnabled = false) {
  return storeCommand(pool, actor, tenantId, instanceId, ['store:write','store:publish'], 'storefront.supply-offer.publish', {}, key, expected, async (q, context) => {
    const p = await profile(q, tenantId, instanceId, true); ready(p);
    const row = (await q.query(`SELECT i.*,l.aggregate_version::text AS version FROM commerce_items i
      JOIN commerce_selections l USING(item_id) WHERE i.item_id=$1 AND i.shop_id=$2 AND l.shop_id=$3 AND l.hosted_offer_id IS NULL`,
    [productId, p.supply_shop_id, p.storefront_shop_id])).rows[0];
    requireCondition(row, 404, 'not_found', '找不到這項商品。'); checkVersion(row.version, expected);
    const terms = supplyOfferTerms(row, p.currency);
    const hash = digest(terms);
    const prior = (await q.query(`SELECT * FROM commerce_hosted_supply_offers WHERE item_id=$1 AND state='offered'`, [productId])).rows[0];
    if (prior && prior.terms_sha256===hash) return offerView(prior);
    if (prior) {
      await q.query(`UPDATE commerce_hosted_supply_offers SET state='withdrawn',version=version+1 WHERE offer_id=$1`, [prior.offer_id]);
      await storeFact(q, context, prior.offer_id, String(BigInt(prior.version)+1n), 'storefront.supply-offer.publish', 'hosted_supply_offer');
    }
    const previousPhoto = offerPhotosEnabled ? (await q.query(`SELECT p.asset_id FROM commerce_hosted_supply_offers o
      LEFT JOIN LATERAL (SELECT asset_id FROM commerce_hosted_offer_photos WHERE offer_id=o.offer_id ORDER BY seq DESC LIMIT 1) p ON true
      WHERE o.item_id=$1 AND o.tenant_id=$2 AND o.instance_id=$3 ORDER BY o.created_at DESC,o.offer_id DESC LIMIT 1`,[productId,tenantId,instanceId])).rows[0] : null;
    const id = randomUUID();
    const saved = (await q.query(`INSERT INTO commerce_hosted_supply_offers(offer_id,tenant_id,instance_id,item_id,community_id,supplier_name,source_version,terms,terms_sha256)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [id, tenantId, instanceId, productId, context.community_id, p.name, row.version, terms, hash])).rows[0];
    await storeFact(q, context, id, '1', 'storefront.supply-offer.publish', 'hosted_supply_offer');
    if (previousPhoto?.asset_id) {
      const seq = await appendCurrentOfferPhoto(q, saved, context.principal_id);
      if (seq) await storeFact(q, context, id, seq, 'storefront.supply-offer.publish', 'hosted_supply_offer_photo');
    }
    return offerView(saved);
  }, productId);
}
export async function withdrawSupplyOffer(pool: Pool, actor: Actor, tenantId: string, instanceId: string, offerId: string, key: string, expected: string) {
  return storeCommand(pool, actor, tenantId, instanceId, 'store:write', 'storefront.supply-offer.withdraw', {}, key, expected, async (q, context) => {
    const p = await profile(q, tenantId, instanceId, true); ready(p);
    const row = (await q.query(`SELECT * FROM commerce_hosted_supply_offers WHERE offer_id=$1 AND tenant_id=$2 AND instance_id=$3 FOR UPDATE`, [offerId, tenantId, instanceId])).rows[0];
    requireCondition(row, 404, 'not_found', '找不到這份供貨版本。'); checkVersion(String(row.version), expected);
    if (row.state==='withdrawn') return offerView(row);
    const saved = (await q.query(`UPDATE commerce_hosted_supply_offers SET state='withdrawn',version=version+1 WHERE offer_id=$1 RETURNING *`, [offerId])).rows[0];
    await storeFact(q, context, offerId, String(saved.version), 'storefront.supply-offer.withdraw', 'hosted_supply_offer');
    return offerView(saved);
  }, offerId);
}

async function selections(q: PoolClient, p: Profile, supplier: boolean, selectionId?: string, productId?: string) {
  return (await q.query(`SELECT l.selection_id,l.hosted_sku,l.retail_price_minor,l.snapshot,l.listing_sha256,l.acceptance_state,
      l.aggregate_version::text AS selection_version,s.name AS seller_name,s.owner_id AS seller_user_id,ss.owner_id AS supplier_user_id,
      (SELECT NULLIF(a.note,'') FROM commerce_distribution_acceptances a WHERE a.selection_id=l.selection_id
        ORDER BY a.created_at DESC,a.acceptance_id DESC LIMIT 1) AS decision_note,o.*
    FROM commerce_selections l JOIN commerce_hosted_supply_offers o ON o.offer_id=l.hosted_offer_id AND o.item_id=l.item_id
    JOIN commerce_shops s ON s.shop_id=l.shop_id AND s.origin='hosted'
    JOIN commerce_storefront_profiles source ON source.instance_id=o.instance_id AND source.tenant_id=o.tenant_id
    JOIN commerce_shops ss ON ss.shop_id=source.supply_shop_id AND ss.origin='hosted'
    WHERE ($2::boolean AND o.tenant_id=$3 AND o.instance_id=$4 OR NOT $2::boolean AND l.shop_id=$1)
      AND ($5::uuid IS NULL OR l.selection_id=$5) AND ($6::uuid IS NULL OR l.item_id=$6) ORDER BY l.selection_id LIMIT 201`,
  [p.storefront_shop_id, supplier, p.tenant_id, p.instance_id, selectionId ?? null, productId ?? null])).rows;
}
export function selectionView(row: Record<string, any>) {
  return DistributionSchema.parse({selection_id: row.selection_id, offer: offerView(row), sku: row.hosted_sku,
    seller_name: row.seller_name, retail_price_minor: Number(row.retail_price_minor), state: row.acceptance_state,
    listing_sha256: row.listing_sha256, version: row.selection_version, decision_note: row.decision_note ?? null,
    arrangement: arrangementView(row.snapshot?.arrangement)});
}
export async function findVisibleSupplyOffer(q: PoolClient, communityId: string, p: Profile, offerId: string) {
    const row = (await q.query(`SELECT o.*,source.slug,source.reservation_enabled,source.supply_shop_id,source.current_publication_id
      FROM commerce_hosted_supply_offers o
      JOIN commerce_storefront_profiles source ON source.tenant_id=o.tenant_id AND source.instance_id=o.instance_id
      WHERE o.offer_id=$1 AND o.community_id=$2 AND o.instance_id<>$3 AND o.terms->>'currency'=$4
      AND (o.state='offered' OR EXISTS(SELECT 1 FROM commerce_selections l
        WHERE l.shop_id=$5 AND l.hosted_offer_id=o.offer_id AND l.item_id=o.item_id))`,
    [offerId, communityId, p.instance_id, p.currency, p.storefront_shop_id])).rows[0];
    requireCondition(row, 404, 'supply_offer_not_found', '找不到可選用的供貨版本。');
    return row;
  }

/** Seller authority stays bound to the seller. Only the existing community offer,
 * selection and profile paths are read here; supplier drafts/stock never enter. */
export async function readSupplyOffer(pool: Pool, actor: Actor, tenantId: string, instanceId: string, offerId: string, admissionEnabled: boolean, offerPhotosEnabled = false, dropShipEnabled = false) {
  const slugs = await storeRead(pool, actor, tenantId, instanceId, 'store:write', async (q, context) => {
    const p = await profile(q, tenantId, instanceId); ready(p);
    return {supplier: (await findVisibleSupplyOffer(q, context.community_id, p, offerId)).slug as string | null, seller: p.slug};
  });
  // The existing anonymous reader owns its own transaction. Release the seller
  // client first (including on a one-client pool), then reauthorize the entire
  // private response below. No tenant context is switched on a seller client.
  const [publicStore, publicSeller] = await Promise.all([
    slugs.supplier ? readPublicStorePage(pool, slugs.supplier) : null,
    slugs.seller ? readPublicStorePage(pool, slugs.seller) : null,
  ]);
  return storeRead(pool, actor, tenantId, instanceId, 'store:write', async (q, context, inst) => {
    const p = await profile(q, tenantId, instanceId); ready(p);
    const row = await findVisibleSupplyOffer(q, context.community_id, p, offerId);
    const publiclyLive = publicStore?.publicationId === row.current_publication_id && slugs.supplier === row.slug;
    const selected = (await selections(q, p, false, undefined, row.item_id))[0];
    const selection = selected ? selectionView(selected) : null;
    const display = supplyDisplayPath(selection?.state ?? 'sellable', selection?.offer.state ?? row.state);
    let reservation = {available: false, reason: 'not_configured' as string | null};
    if (admissionEnabled) {
      const supplier = {reservation_enabled: row.reservation_enabled, currency: row.terms.currency};
      if (context.tenant_status !== 'active' || inst.status !== 'active' || inst.deployment_state !== 'active') reservation.reason = 'store_unavailable';
      else if (!p.reservation_enabled) reservation.reason = 'reservation_not_enabled';
      else if (!supplierReservationEnabled(supplier, p)) reservation.reason = 'supply_unavailable';
      else if (!display.available) reservation.reason = display.reason;
      else if (!selection || !p.current_publication_id) reservation.reason = 'publication_required';
      else if (publicSeller?.publicationId !== p.current_publication_id || slugs.seller !== p.slug) reservation.reason = 'store_unavailable';
      // Private supplier lifecycle/mapping rows are deliberately inaccessible
      // here. A new safe projection would require schema work; never infer it
      // from an immutable offer or switch the seller's tenant context.
      else if (!publiclyLive) reservation.reason = 'unknown';
      else {
        try {
          // The same exact-version/publication decision as a shared reservation.
          // This resolver reads only the already visible immutable source/settings.
          await sharedLines(q, {profile: p, shared: {}}, [{sku: selection.sku, quantity: 1}], async () =>
            ({...p, instance_id: row.instance_id, supply_shop_id: row.supply_shop_id, ...supplier}));
          reservation = {available: true, reason: null};
        } catch (error) {
          if (!(error instanceof Problem) || !['publication_changed','supply_unavailable'].includes(error.code)) throw error;
          reservation.reason = error.code;
        }
      }
    }
    const [covered]=selection?await dropShipCoverage(q,instanceId,[{sku:selection.sku,item_id:row.item_id,selection_id:selection.selection_id,quantity:1,unit_price_minor:selection.retail_price_minor,supplier_shop_id:row.supply_shop_id,own:row.instance_id===instanceId}],dropShipEnabled):[];
    const checkoutReason = fulfilmentConsentFailure(hostedLineFulfilment(row.instance_id === instanceId,covered?.drop_ship,dropShipEnabled));
    const photo = offerPhotosEnabled && row.state==='offered' ? await currentOfferPhoto(q, offerId) : null;
    return SupplyOfferPageSchema.parse({photo: photo?.asset_id ? {seq:photo.seq,width:photo.width,height:photo.height,read_path:`/api/v1/tenants/${tenantId}/storefronts/${instanceId}/supply-catalog/${offerId}/photo/${photo.seq}`} : null, offer: offerView(row), published_at: row.created_at.toISOString(),
      supplier: {name: row.supplier_name, public_path: publiclyLive ? `/shops/${row.slug}` : null},
      selection, decision_note: selection?.decision_note ?? null,
      sale_paths: {display, reservation, checkout: {available: checkoutReason === null, reason: checkoutReason}}});
  });
}
/** Both snapshots authorize the seller and the same current offer/share. No
 * supplier tenant binding, private Asset query, signed URL or SQL lock spans I/O. */
export async function readSupplyOfferPhoto(pool:Pool, store:ObjectStore, actor:Actor, tenantId:string, instanceId:string, rawOfferId:string, rawSeq:string) {
  const offerId=OpaqueId.parse(rawOfferId),seq=Version.parse(rawSeq);
  const snapshot=()=>storeRead(pool,actor,tenantId,instanceId,'store:write',async(q,context)=>{
    const p=await profile(q,tenantId,instanceId);ready(p);
    const offer=await findVisibleSupplyOffer(q,context.community_id,p,offerId);
    requireCondition(offer.state==='offered',404,'not_found','找不到這張方案照片。');
    const photo=await currentOfferPhoto(q,offerId);
    requireCondition(photo?.asset_id && photo.seq===seq,404,'not_found','找不到這張方案照片。');
    return {offerVersion:String(offer.version),photo};
  });
  const before=await snapshot(),photo=before.photo;
  const bytes=(await readVerifiedObject(store,objectKey({scopeId:photo.scope_id,assetId:photo.asset_id,representationId:photo.representation_id}),{
    contentType:photo.content_type,byteSize:photo.byte_size,sha256:photo.content_sha256,transformVersion:photo.transform_version,
    policyRevision:photo.policy_revision,profileId:'storefront.product-photo',
  })).bytes;
  const after=await snapshot();
  requireCondition(JSON.stringify(before)===JSON.stringify(after),404,'not_found','找不到這張方案照片。');
  return bytes;
}
export async function listDistributions(pool: Pool, actor: Actor, tenantId: string, instanceId: string, supplier = false) {
  return storeRead(pool, actor, tenantId, instanceId, 'store:write', async q => {
    const p = await profile(q, tenantId, instanceId); ready(p);
    const rows = await selections(q, p, supplier);
    return DistributionsSchema.parse({items: rows.slice(0, 200).map(selectionView), truncated: rows.length>200});
  });
}
/** A seller proposes its own retail price against one immutable offer. Supplier
 * consent always covers that exact listing digest; changing price clears consent. */
export async function proposeDistribution(pool: Pool, actor: Actor, tenantId: string, instanceId: string, raw: unknown, key: string, selectionId?: string, expected?: string) {
  const input = DistributionInputSchema.parse(raw);
  return storeCommand(pool, actor, tenantId, instanceId, 'store:write', 'storefront.distribution.propose', input, key, expected, async (q, context) => {
    const p = await profile(q, tenantId, instanceId, true); retailReady(p);
    const offer = (await q.query(`SELECT o.*,s.owner_id AS supplier_user_id FROM commerce_hosted_supply_offers o
      JOIN commerce_storefront_profiles p ON p.instance_id=o.instance_id AND p.tenant_id=o.tenant_id
      JOIN commerce_shops s ON s.shop_id=p.supply_shop_id AND s.origin='hosted'
      WHERE offer_id=$1 AND o.community_id=$2 AND o.instance_id<>$3 AND state='offered'`, [input.offer_id, context.community_id, instanceId])).rows[0];
    requireCondition(offer, 404, 'supply_offer_not_found', '找不到可選用的供貨版本。');
    requireCondition(offer.terms_sha256===input.terms_sha256 && offer.terms.currency===p.currency, 409, 'supply_offer_changed', '請重新確認供貨版本與幣別。');
    const prior = selectionId ? (await selections(q, p, false, selectionId))[0] : null;
    if (selectionId) { requireCondition(prior, 404, 'not_found', '找不到這項選品。'); checkVersion(prior.selection_version, expected); }
    const duplicate = (await q.query('SELECT selection_id FROM commerce_selections WHERE shop_id=$1 AND item_id=$2', [p.storefront_shop_id, offer.item_id])).rows[0];
    requireCondition(!duplicate || duplicate.selection_id===selectionId, 409, 'distribution_exists', '這項商品已經選用，請編輯原選品。');
    // A selection keeps its product identity; use a new selection for another item.
    requireCondition(!prior || prior.item_id===offer.item_id, 409, 'distribution_item_changed', '原選品不能改成另一項商品。');
    requireCondition(prior || await productCount(q, p)<200, 409, 'storefront_product_limit', '商品已達上限。');
    const seller = (await q.query('SELECT owner_id FROM commerce_shops WHERE shop_id=$1', [p.storefront_shop_id])).rows[0];
    const sku = prior?.hosted_sku ?? `P${String(p.product_seq+1).padStart(4, '0')}`;
    const snapshot = {...offer.terms, sku, offer_id: offer.offer_id, offer_sha256: offer.terms_sha256,
      seller_shop_id: p.storefront_shop_id, item_id: offer.item_id,
      retail_price_minor: input.retail_price_minor, arrangement: resellerArrangement(seller.owner_id, offer.supplier_user_id)};
    const hash = digest(snapshot), id = selectionId ?? randomUUID();
    if (prior) await q.query(`UPDATE commerce_selections SET hosted_offer_id=$2,retail_price_minor=$3,snapshot=$4,listing_sha256=$5,
      acceptance_state='awaiting_supply_acceptance',current_acceptance_id=NULL,aggregate_version=aggregate_version+1 WHERE selection_id=$1`,
    [id, offer.offer_id, input.retail_price_minor, snapshot, hash]);
    else {
      await q.query('UPDATE commerce_storefront_profiles SET product_seq=product_seq+1 WHERE instance_id=$1', [instanceId]);
      await q.query(`INSERT INTO commerce_selections(selection_id,shop_id,item_id,retail_price_minor,sale_terms,snapshot,listing_sha256,hosted_offer_id,hosted_sku)
        VALUES($1,$2,$3,$4,'交易尚未啟用。',$5,$6,$7,$8)`, [id, p.storefront_shop_id, offer.item_id, input.retail_price_minor, snapshot, hash, offer.offer_id, sku]);
    }
    const saved = (await selections(q, p, false, id))[0];
    await storeFact(q, context, id, saved.selection_version, 'storefront.distribution.propose', 'hosted_distribution');
    return selectionView(saved);
  }, selectionId);
}
export async function decideDistribution(pool: Pool, actor: Actor, tenantId: string, instanceId: string, selectionId: string, raw: unknown, key: string, expected: string) {
  const input = DistributionDecisionSchema.parse(raw);
  return storeCommand(pool, actor, tenantId, instanceId, 'store:write', 'storefront.distribution.decide', input, key, expected, async (q, context) => {
    const p = await profile(q, tenantId, instanceId, true); ready(p);
    const row = (await selections(q, p, true, selectionId))[0];
    requireCondition(row, 404, 'not_found', '找不到這項供貨申請。'); checkVersion(row.selection_version, expected);
    requireCondition(row.listing_sha256===input.listing_sha256 && digest(row.snapshot)===input.listing_sha256,
      409, 'snapshot_changed', '售價或供貨條件已變更，請重新確認。');
    requireCondition(input.decision==='revoked' ? row.acceptance_state==='sellable' : row.acceptance_state==='awaiting_supply_acceptance' && row.state==='offered',
      409, 'invalid_state', '供貨狀態已改變，請重新確認。');
    const id = randomUUID(), state = input.decision==='accepted' ? 'sellable' : input.decision;
    // Record decision order after the command locks, rather than transaction
    // start time: a queued transaction may have begun before the prior decision.
    await q.query(`INSERT INTO commerce_distribution_acceptances(acceptance_id,selection_id,community_id,supplier_user_id,seller_user_id,listing_sha256,decision,signer_user_id,signed_digest,arrangement,note,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$6,$9,$10,clock_timestamp())`, [id, selectionId, context.community_id, row.supplier_user_id, row.seller_user_id, input.listing_sha256, input.decision, actor.user_id, row.snapshot.arrangement, input.reason ?? '']);
    await q.query(`UPDATE commerce_selections SET acceptance_state=$2,current_acceptance_id=$3,aggregate_version=aggregate_version+1 WHERE selection_id=$1`, [selectionId, state, id]);
    const saved = (await selections(q, p, true, selectionId))[0];
    await storeFact(q, context, selectionId, saved.selection_version, 'storefront.distribution.decide', 'hosted_distribution');
    return selectionView(saved);
  }, selectionId);
}

/** Seller withdrawal is its own fact, never a forged supplier signature. */
export async function withdrawDistribution(pool: Pool, actor: Actor, tenantId: string, instanceId: string, selectionId: string, key: string, expected: string) {
  return storeCommand(pool, actor, tenantId, instanceId, 'store:write', 'storefront.distribution.withdraw', {}, key, expected, async (q, context) => {
    const p = await profile(q, tenantId, instanceId, true); ready(p);
    const row = (await selections(q, p, false, selectionId))[0];
    requireCondition(row, 404, 'not_found', '找不到這項選品。'); checkVersion(row.selection_version, expected);
    if (row.acceptance_state==='revoked') return selectionView(row);
    await q.query(`UPDATE commerce_selections SET acceptance_state='revoked',aggregate_version=aggregate_version+1 WHERE selection_id=$1`, [selectionId]);
    const saved = (await selections(q, p, false, selectionId))[0];
    await storeFact(q, context, selectionId, saved.selection_version, 'storefront.distribution.withdraw', 'hosted_distribution');
    return selectionView(saved);
  }, selectionId);
}

/** Publication receives authorized text, seller price and seller-owned photo
 * copies. Supplier draft assets and private authority never enter the projection. */
export async function distributionProducts(q: PoolClient, p: Profile) {
  const {distributionPhotoRows,distributionStoredPhoto}=await import('../supplier-console/distribution-photo-target.js');
  const rows=await distributionPhotoRows(q,p);
  return rows.map(row=>({product:{product_id:row.item_id,sku:row.hosted_sku,title:row.snapshot.title,
    description:row.snapshot.description,price_minor:Number(row.retail_price_minor),currency:p.currency,version:row.selection_version},
    distributionPhotoVersion:row.photo_version??'0',photo:row.usable?distributionStoredPhoto(row):null}));
}
