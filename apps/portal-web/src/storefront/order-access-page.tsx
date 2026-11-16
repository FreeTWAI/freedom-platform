import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { STORE_SLUG_PATTERN } from './cart-store.js';
import { ERROR_COPY } from './order-api.js';
import { storefrontLoginHref } from './return-path.js';
type OrderAccessOutcome = 'sent' | 'paused' | 'unavailable' | 'failed';

const ORDER_ACCESS_SENT_COPY = '如果資料相符，我們會把查看連結寄到這個 Email。連結 7 天內有效，只能使用一次。';

const ORDER_ACCESS_ERROR_COPY: Record<Exclude<OrderAccessOutcome, 'sent'>, string> = {
  paused: '商店服務暫停中，請稍後再試。',
  unavailable: '這間店目前不寄確認信，請用這個瀏覽器回到訂單，或聯絡店家。',
  failed: '無法寄送查看連結，請稍後重試。',
};

async function postOrderAccessRequest(
  storeSlug: string,
  email: string,
  displayNumber: string,
): Promise<OrderAccessOutcome> {
  try {
    const response = await fetch(`/api/v1/public/stores/${encodeURIComponent(storeSlug)}/order-access-requests`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        display_number: displayNumber,
      }),
    });
    if (response.status === 202 || response.status === 429) {
      return 'sent';
    }
    if (response.status === 503) {
      try {
        const body = (await response.json()) as { code?: unknown };
        if (body && body.code === 'commerce_quarantined') return 'paused';
      } catch {
        return 'failed';
      }
      return 'failed';
    }
    if (response.status === 409) {
      try {
        const body = (await response.json()) as { code?: unknown };
        if (body && body.code === 'order_access_email_unavailable') return 'unavailable';
      } catch {
        return 'failed';
      }
      return 'failed';
    }
    return 'failed';
  } catch {
    return 'failed';
  }
}

interface OrderAccessPageProps {
  container: HTMLElement;
  storeSlug: string;
  storeName: string;
  initialEmail: string;
  initialDisplayNumber: string;
}

function OrderAccessPage({
  container,
  storeSlug,
  storeName,
  initialEmail,
  initialDisplayNumber,
}: OrderAccessPageProps) {
  const [email, setEmail] = useState<string>(initialEmail);
  const [displayNumber, setDisplayNumber] = useState<string>(initialDisplayNumber);
  const [busy, setBusy] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const inFlightRef = useRef<boolean>(false);

  useEffect(() => {
    container.setAttribute('aria-busy', busy ? 'true' : 'false');
  }, [container, busy]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlightRef.current || busy) return;
    const trimmedEmail = email.trim();
    const trimmedDisplayNumber = displayNumber.trim();
    if (!trimmedEmail || !trimmedDisplayNumber) {
      setStatusMessage('請填寫 Email 與訂單編號。');
      return;
    }
    inFlightRef.current = true;
    setBusy(true);
    setStatusMessage('');
    const outcome = await postOrderAccessRequest(storeSlug, trimmedEmail, trimmedDisplayNumber);
    inFlightRef.current = false;
    setBusy(false);
    if (outcome === 'sent') {
      setStatusMessage(ORDER_ACCESS_SENT_COPY);
    } else {
      setStatusMessage(ORDER_ACCESS_ERROR_COPY[outcome]);
    }
  }

  return (
    <>
      <h1 id="shop-order-access-title" tabIndex={-1}>找回訂單</h1>
      <p>輸入下單時填寫的 Email 與訂單編號（例如 261015-ABCDEF），我們會把一次性查看連結寄到你的信箱。</p>
      {container.dataset.buyerJourney === 'true' && <div className="shop-order-actions"><a href={storefrontLoginHref(`/shops/${storeSlug}/order-access`)}>登入會員</a></div>}
      <form className="shop-order-section" noValidate onSubmit={event => void handleSubmit(event)}>
        <div className="shop-order-access-field">
          <label className="shop-add-label" htmlFor="shop-order-access-email">Email</label>
          <input
            id="shop-order-access-email"
            className="shop-text-input"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            maxLength={254}
            required
            disabled={busy}
            value={email}
            onChange={event => setEmail(event.target.value)}
          />
        </div>
        <div className="shop-order-access-field">
          <label className="shop-add-label" htmlFor="shop-order-access-display-number">訂單編號</label>
          <input
            id="shop-order-access-display-number"
            className="shop-text-input"
            name="display_number"
            type="text"
            autoComplete="off"
            maxLength={80}
            placeholder="261015-ABCDEF"
            required
            disabled={busy}
            value={displayNumber}
            onChange={event => setDisplayNumber(event.target.value)}
          />
        </div>
        <div className="shop-order-actions">
          <button type="submit" className="shop-button shop-pay-primary" disabled={busy}>
            寄送查看連結
          </button>
          <a href={`/shops/${storeSlug}`}>回到「{storeName}」</a>
        </div>
      </form>
      <div role="status">
        {statusMessage && (
          <p className="shop-order-alert">
            {statusMessage}
          </p>
        )}
      </div>
    </>
  );
}

export function bootOrderAccessPage() {
  const container = document.getElementById('shop-order-access');
  if (!container) return;
  const storeSlug = container.dataset.storeSlug ?? '';
  const storeName = container.dataset.storeName ?? '';
  if (!STORE_SLUG_PATTERN.test(storeSlug)) return;

  const initialEmail = container.querySelector<HTMLInputElement>('#shop-order-access-email')?.value ?? '';
  const initialDisplayNumber = container.querySelector<HTMLInputElement>('#shop-order-access-display-number')?.value ?? '';

  createRoot(container).render(
    <OrderAccessPage
      container={container}
      storeSlug={storeSlug}
      storeName={storeName}
      initialEmail={initialEmail}
      initialDisplayNumber={initialDisplayNumber}
    />,
  );
}
