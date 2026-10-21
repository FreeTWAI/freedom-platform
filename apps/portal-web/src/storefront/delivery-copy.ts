import type {CartQuoteResponseSchema, CartDeliveryOptionSchema, ShippingMethodRef, ShippingUnavailableReason} from '../../../../contracts/guild-launchpad/v1/hosted-checkout.js';

export const DELIVERY_NAMES: Record<ShippingMethodRef, string> = {meetup: '面交取貨', home: '宅配', 'cvs:UNIMARTC2C': '7-ELEVEN 取貨', 'cvs:FAMIC2C': '全家取貨', 'cvs:HILIFEC2C': '萊爾富取貨'};
export const SHIPPING_REASON_COPY: Record<ShippingUnavailableReason, string> = {
  fulfilment_not_agreed: '目前無法配送',
  shipping_attributes_missing: '店家尚未補齊配送資料，暫時無法使用這個取貨方式。',
  method_unsupported: '這項商品不支援這個取貨方式。',
  temperature_unsupported: '這個取貨方式不支援商品需要的溫層。',
  too_large: '商品尺寸或重量超過這個取貨方式的限制。',
  cvs_value_limit: '商品金額超過超商取貨上限。',
  outlying_unsupported: '這個取貨方式不配送到此地區。',
};
type Quote = ReturnType<typeof CartQuoteResponseSchema.parse>;
type Option = ReturnType<typeof CartDeliveryOptionSchema.parse>;
export type BlockedDeliveryLine = Option['lines'][number];

export function deliveryPanels(quote: Quote | null, selected: ShippingMethodRef | '', failure: BlockedDeliveryLine[] = []) {
  const panels = new Map<ShippingMethodRef, BlockedDeliveryLine[]>();
  for (const option of quote?.delivery_options ?? []) if (!option.available && option.lines.length) panels.set(option.method, option.lines);
  // Selected shipping includes destination-specific checks; generic options do not.
  if (quote?.shipping.state === 'unavailable') panels.set(quote.shipping.method, quote.shipping.lines);
  if (selected && failure.length) panels.set(selected, failure);
  return [...panels].map(([method, lines]) => ({method, lines: [...new Map(lines.map(line => [line.sku, line])).values()]}));
}

/** Only a real all-line quote can offer an alternative. CVS selection is not yet
 * available in this UI, and a failed destination cannot suggest its own method. */
export function deliveryAlternatives(quote: Quote | null, selected: ShippingMethodRef | '') {
  const failed = quote?.shipping.state === 'unavailable' ? quote.shipping.method : selected;
  return quote?.delivery_options.filter(option => option.available && option.method !== failed && !option.method.startsWith('cvs:')) ?? [];
}

export function cartDeliveryNote(options: readonly Option[], sku: string): string | null {
  if (!options.length || options.some(option => !option.lines.some(line => line.sku === sku))) return null;
  return options.some(option => option.lines.some(line => line.sku === sku && line.reason === 'fulfilment_not_agreed'))
    ? SHIPPING_REASON_COPY.fulfilment_not_agreed : '目前沒有可用的取貨方式。';
}

export function deliveryLineTitle(sku: string, quote: Quote | null, cart: readonly {sku: string; title: string}[]) {
  return quote?.lines.find(line => line.sku === sku)?.title ?? cart.find(line => line.sku === sku)?.title ?? `商品 ${sku}`;
}
