/** Same integer-minor display convention as the portal; conformance values are tested. */
export function formatMinor(amountMinor: string | number, currency: string): string {
  const raw = String(amountMinor).trim()
  if (!/^-?\d+$/.test(raw)) return '金額無法顯示'
  const negative = raw.startsWith('-')
  const digits = (negative ? raw.slice(1) : raw).replace(/^0+(?=\d)/, '') || '0'
  const padded = digits.padStart(3, '0')
  const whole = padded.slice(0, -2)
  const cents = padded.slice(-2)
  const value = Number(`${negative ? '-' : ''}${whole}.${cents}`)
  try {
    return new Intl.NumberFormat('zh-TW', {
      style: 'currency',
      currency: currency || 'TWD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${currency} ${negative ? '-' : ''}${whole}.${cents}`
  }
}

/** Structural buyer lifecycle input; both order contracts must remain assignable. */
type BuyerLifecycle={lifecycle_state:'open'|'cancelled'|'closed';cancel_reason:'buyer_cancelled'|'seller_cancelled'|'payment_not_completed'|'paid_cancelled'|null};

const taipeiDateTimeFormat = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function formatTaipeiDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Map(taipeiDateTimeFormat.formatToParts(date).map(part => [part.type, part.value]));
  const year = parts.get('year');
  const month = parts.get('month');
  const day = parts.get('day');
  const hour = parts.get('hour');
  const minute = parts.get('minute');
  if (!year || !month || !day || !hour || !minute) return '';
  return `${year}/${month}/${day} ${hour}:${minute}`;
}

const taipeiTimeFormat = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function formatTaipeiTime(input: string | number | Date): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Map(taipeiTimeFormat.formatToParts(date).map(part => [part.type, part.value]));
  const hour = parts.get('hour');
  const minute = parts.get('minute');
  if (!hour || !minute) return '';
  return `${hour}:${minute}`;
}

export function formatRetryAfterTaipeiTime(retryAfterSeconds: number, nowMs: number = Date.now()): string {
  const targetMs = nowMs + retryAfterSeconds * 1000;
  const roundedUpMinuteMs = Math.ceil(targetMs / 60_000) * 60_000;
  return formatTaipeiTime(roundedUpMinuteMs);
}

const CANCEL_REASON_COPY: Record<NonNullable<BuyerLifecycle['cancel_reason']>, string> = {
  buyer_cancelled: '你取消了訂單',
  seller_cancelled: '店家取消了訂單',
  payment_not_completed: '未在期限內完成付款',
  paid_cancelled: '店家已取消這筆訂單',
};

export function formatOrderLifecycle(order: BuyerLifecycle): string {
  if (order.lifecycle_state === 'open') return '進行中';
  if (order.lifecycle_state === 'closed') return '已完成';
  const reason = order.cancel_reason ? CANCEL_REASON_COPY[order.cancel_reason] : undefined;
  return reason ? `已取消（${reason}）` : '已取消';
}
