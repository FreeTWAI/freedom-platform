/** UI query vocabulary only; the existing server contract still validates every read. */
export type SellerQuery = {
  lifecycle?: 'open' | 'cancelled' | 'closed';
  needs_action?: 'true';
  display_number?: string;
  payment_method?: 'immediate_card' | 'bank_transfer' | 'cash_on_meetup';
  awaiting_offline_payment?: 'true';
  state?: 'open' | 'closed';
};
export const displayNumberPattern = /^[0-9]{6}-[0-9A-HJKMNP-TV-Z]{6}$(?![\s\S])/;
export const SELLER_PAYMENT_METHODS = {
  immediate_card: '信用卡', bank_transfer: '銀行匯款', cash_on_meetup: '面交現金付款',
} as const;
export const SELLER_ORDER_FILTER_KEYS = ['lifecycle', 'needs_action', 'display_number', 'payment_method', 'awaiting_offline_payment'] as const;

/** Normalize pasted ASCII-width characters, not ambiguous letters or arbitrary punctuation. */
export function normalizeSellerDisplayNumber(input: string): string {
  // Do not silently turn embedded line breaks/control characters into another identifier.
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(input)) return input;
  return input.replace(/[\uff01-\uff5e]/gu, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/^[ \u3000]+|[ \u3000]+$/gu, '').replace(/[a-z]/g, char => char.toUpperCase());
}
export function normalizeSellerOrderFilters(input: SellerQuery): SellerQuery {
  const value: SellerQuery = {};
  if (input.lifecycle) value.lifecycle = input.lifecycle;
  if (input.needs_action) value.needs_action = input.needs_action;
  const number = normalizeSellerDisplayNumber(input.display_number ?? '');
  if (number) value.display_number = number;
  if (input.payment_method) value.payment_method = input.payment_method;
  if (input.awaiting_offline_payment) value.awaiting_offline_payment = input.awaiting_offline_payment;
  return value;
}
export function sameSellerOrderFilters(a: SellerQuery, b: SellerQuery): boolean {
  return SELLER_ORDER_FILTER_KEYS.every(key => (a[key] ?? '') === (b[key] ?? ''));
}
export function sellerOrderFilterSummary(query: SellerQuery): string {
  const parts: string[] = [];
  if (query.lifecycle) parts.push({open:'進行中',cancelled:'已取消',closed:'已完成'}[query.lifecycle]);
  if (query.awaiting_offline_payment) parts.push('待確認收款（匯款／面交現金）');
  if (query.needs_action) parts.push('有待處理問題');
  if (query.payment_method) parts.push(SELLER_PAYMENT_METHODS[query.payment_method]);
  if (query.display_number) parts.push(`訂單編號 ${query.display_number}`);
  return parts.length ? parts.join(' · ') : '全部結帳訂單';
}
export const SELLER_ORDER_SHORTCUTS: ReadonlyArray<{label: string; query: SellerQuery}> = [
  {label: '全部訂單', query: {}},
  {label: '待確認收款', query: {awaiting_offline_payment: 'true'}},
  {label: '進行中訂單', query: {lifecycle: 'open'}},
  {label: '有待處理問題', query: {needs_action: 'true'}},
];
