import { PAYMENT_REFUSED_COPY } from './payment-view.js';

export type PaymentAlertState =
  | { section: 'action' | 'payment'; kind: 'text'; text: string }
  | { section: 'action' | 'payment'; kind: 'hold_expired'; storeSlug: string }
  | null;

export function renderPaymentAlert(alert: NonNullable<PaymentAlertState>) {
  if (alert.kind === 'hold_expired') {
    return (
      <p role="alert" className="shop-order-alert shop-pay-alert">
        <span>{PAYMENT_REFUSED_COPY.checkout_hold_expired}</span>{' '}
        <a href={`/shops/${alert.storeSlug}/cart`}>前往購物車</a>
      </p>
    );
  }
  return (
    <p role="alert" className="shop-order-alert">
      {alert.text}
    </p>
  );
}
