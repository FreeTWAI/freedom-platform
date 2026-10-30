import {ReservationOrderSchema as OrderSchema, ReservationQuoteSchema as QuoteSchema, type ReservationOrder as HostedOrder, type ReservationQuote as HostedOrderQuote} from '../../../../contracts/guild-launchpad/v1/hosted-shared-order';
import type {z} from 'zod';
import type {QuoteInputSchema, SubmitInputSchema} from '../../../../contracts/guild-launchpad/v1/hosted-order';

import type {BuyerRoute} from './hosted-order-route';
export {buyerRoute, type BuyerRoute} from './hosted-order-route';
export type QuoteInput = z.infer<typeof QuoteInputSchema>;
export type SubmitInput = z.infer<typeof SubmitInputSchema>;
export type BuyerAttempt =
  | {kind: 'quote'; slug: string; key: string; body: QuoteInput; unknown: boolean}
  | {kind: 'submit'; slug: string; key: string; body: SubmitInput; unknown: boolean}
  | {kind: 'cancel'; id: string; slug: string; intent: string; key: string; body: Record<string, never>; version: string; unknown: boolean};
export function readQuote(raw: unknown, slug: string, body: QuoteInput): HostedOrderQuote | null {
  const p = QuoteSchema.safeParse(raw);
  if (!p.success || p.data.store.slug !== slug || p.data.publication_revision !== body.publication_revision || p.data.items.length !== body.items.length) return null;
  if (!body.items.every(i => p.data.items.some(q => q.sku === i.sku && q.quantity === i.quantity))) return null;
  return p.data;
}
export function readOrder(raw: unknown, expected: Exclude<BuyerRoute, {kind: 'lookup'} | {kind: 'shop'}>, submit?: SubmitInput): HostedOrder | null {
  const p = OrderSchema.safeParse(raw);
  if (!p.success) return null;
  const order = p.data;
  if (expected.kind === 'order' ? order.order_id !== expected.id : order.store.slug !== expected.slug || order.client_order_id !== expected.intent) return null;
  if (submit && (order.quote_id !== submit.quote_id || order.terms_sha256 !== submit.terms_sha256)) return null;
  return order;
}
/** A current reserved observation is useful, but is never cancellation acknowledgement. */
export function readCancelObservation(raw: unknown, expected: {id: string; slug: string; intent: string}): {order: HostedOrder; confirmed: boolean} | null {
  const order = readOrder(raw, {kind: 'order', id: expected.id});
  if (!order || order.store.slug !== expected.slug || order.client_order_id !== expected.intent) return null;
  return {order, confirmed: order.state === 'cancelled' || order.state === 'expired'};
}
