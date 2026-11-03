import {OpaqueId} from '../../../../contracts/guild-launchpad/v1/primitives';
import {StoreSlugSchema} from '../../../../contracts/guild-launchpad/v1/storefront';

// The shell needs only route locators. Response decoders stay behind the order page import.
export type BuyerRoute = {kind: 'lookup'} | {kind: 'shop'; slug: string; sku?: string} | {kind: 'intent'; slug: string; intent: string} | {kind: 'order'; id: string};
/** Exact same-origin hash grammar; no query, encoding, private fields or redirect target. */
export function buyerRoute(hash: string): BuyerRoute | null {
  if (hash === '#reservations') return {kind: 'lookup'};
  const p = hash.split('/');
  if (p[0] !== '#reservations') return null;
  const id = (v: string) => /^[0-9a-f-]{36}$/.test(v) && OpaqueId.safeParse(v).success;
  if (p.length === 3 && p[1] === 'order' && id(p[2])) return {kind: 'order', id: p[2]};
  const slug = p[1];
  if (!slug || !/^[a-z][a-z0-9-]{1,38}[a-z0-9]$/.test(slug) || !StoreSlugSchema.safeParse(slug).success) return null;
  if (p.length === 2) return {kind: 'shop', slug};
  if (p.length === 4 && p[2] === 'product' && /^P[0-9]{4,23}$(?![\s\S])/.test(p[3])) return {kind: 'shop', slug, sku: p[3]};
  if (p.length === 4 && p[2] === 'intent' && id(p[3])) return {kind: 'intent', slug, intent: p[3]};
  return null;
}

export type SellerRoute = {tenantId: string; instanceId: string; supplier?: boolean};
/** Only opaque store locators; never a redirect, credential or buyer identity. */
export function sellerOrdersRoute(hash: string): SellerRoute | null {
  const p = hash.split('/');
  const id = (v: string) => /^[0-9a-f-]{36}$/.test(v) && OpaqueId.safeParse(v).success;
  return p.length === 4 && p[0] === '#stores' && ['orders','supply-orders'].includes(p[3]) && id(p[1]) && id(p[2])
    ? {tenantId: p[1], instanceId: p[2], ...(p[3] === 'supply-orders' ? {supplier:true} : {})} : null;
}
