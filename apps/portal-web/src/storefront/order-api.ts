import type { PublicOrder } from '../../../../contracts/guild-launchpad/v1/hosted-checkout.js';
import { MAX_LINE_QUANTITY } from './cart-store.js';
import {
  classifyQueryPaymentResponse,
  classifyStartPaymentResponse,
  isPublicOrderShape,
  type QueryPaymentOutcome,
  type StartPaymentOutcome,
} from './payment-view.js';

export const OPAQUE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const ACCESS_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const NON_NEGATIVE_INT_PATTERN = /^(0|[1-9][0-9]*)$/;
export const POSITIVE_INT_PATTERN = /^[0-9]+$/;
export const QUOTE_DEBOUNCE_MS = 600;

export type ErrorKind = 'rate_limited' | 'paused' | 'failed';
export type OrderResult =
  | { kind: 'ok'; order: PublicOrder }
  | { kind: 'not_found' }
  | { kind: ErrorKind };

export const ERROR_COPY: Record<ErrorKind, string> = {
  rate_limited: '嘗試次數太多，請稍後再試。',
  paused: '商店服務暫停中，請稍後再試。',
  failed: '無法取得訂單，請稍後重試。',
};

export function parseQuantityInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!POSITIVE_INT_PATTERN.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 1 || value > MAX_LINE_QUANTITY) return null;
  return value;
}

export async function classifyOrderResponse(response: Response): Promise<OrderResult> {
  if (response.status >= 200 && response.status < 300) {
    try {
      const body: unknown = await response.json();
      if (!isPublicOrderShape(body)) return { kind: 'failed' };
      return { kind: 'ok', order: body };
    } catch {
      return { kind: 'failed' };
    }
  }
  if ([401, 403, 404].includes(response.status)) return { kind: 'not_found' };
  if (response.status === 429) return { kind: 'rate_limited' };
  if (response.status === 503) {
    try {
      const body = (await response.json()) as { code?: unknown };
      if (body && body.code === 'commerce_quarantined') return { kind: 'paused' };
    } catch {
      return { kind: 'failed' };
    }
    return { kind: 'failed' };
  }
  return { kind: 'failed' };
}

export async function fetchPublicOrder(storeSlug: string, orderRef: string): Promise<OrderResult> {
  try {
    const response = await fetch(`/api/v1/public/stores/${encodeURIComponent(storeSlug)}/orders/${encodeURIComponent(orderRef)}`, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    const result = await classifyOrderResponse(response);
    if (result.kind === 'ok' && (result.order.order_ref !== orderRef || result.order.store.slug !== storeSlug)) return {kind: 'failed'};
    return result;
  } catch {
    return { kind: 'failed' };
  }
}

export async function postRedeemOrder(storeSlug: string, orderRef: string, token: string): Promise<OrderResult> {
  try {
    const response = await fetch(`/api/v1/public/stores/${encodeURIComponent(storeSlug)}/orders/${encodeURIComponent(orderRef)}/access`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token }),
    });
    const result = await classifyOrderResponse(response);
    if (result.kind === 'ok' && (result.order.order_ref !== orderRef || result.order.store.slug !== storeSlug)) return {kind: 'failed'};
    return result;
  } catch {
    return { kind: 'failed' };
  }
}

export async function postForgetBrowser(): Promise<'ok' | 'failed'> {
  try {
    const response = await fetch('/api/v1/public/order-access/forget', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    return response.status === 204 ? 'ok' : 'failed';
  } catch {
    return 'failed';
  }
}

export async function startPayment(storeSlug: string, orderRef: string): Promise<StartPaymentOutcome> {
  try {
    const response = await fetch(
      `/api/v1/public/stores/${encodeURIComponent(storeSlug)}/orders/${encodeURIComponent(orderRef)}/payment-handoffs`,
      {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      },
    );
    return await classifyStartPaymentResponse(response);
  } catch {
    return { kind: 'failed' };
  }
}

export async function queryPayment(storeSlug: string, orderRef: string): Promise<QueryPaymentOutcome> {
  try {
    const response = await fetch(
      `/api/v1/public/stores/${encodeURIComponent(storeSlug)}/orders/${encodeURIComponent(orderRef)}/payment-queries`,
      {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      },
    );
    return await classifyQueryPaymentResponse(response, orderRef);
  } catch {
    return { kind: 'failed' };
  }
}

export function consumeAccessHash(): { kind: 'none' } | { kind: 'valid'; token: string } | { kind: 'malformed' } {
  if (!window.location.hash.startsWith('#access=')) {
    return { kind: 'none' };
  }
  const raw = window.location.hash.slice('#access='.length);
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  if (ACCESS_TOKEN_PATTERN.test(raw)) {
    return { kind: 'valid', token: raw };
  }
  return { kind: 'malformed' };
}

export interface TokenBox {
  read(): string | null;
  write(next: string): void;
  clear(): void;
}
