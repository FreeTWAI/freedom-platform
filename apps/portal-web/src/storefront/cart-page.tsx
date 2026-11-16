import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CartQuoteResponseSchema, type CartDeliveryOptionSchema } from '../../../../contracts/guild-launchpad/v1/hosted-checkout.js';
import { formatMinor } from '../../../../modules/agent-commerce/hosted/format.js';
import {
  MAX_LINE_QUANTITY,
  isValidCurrency,
  isValidPriceMinor,
  isValidRevision,
  isValidStoreSlug,
  isValidTitle,
  readCart,
  subscribe,
  writeCart,
  type CartCurrency,
  type StoredCart,
} from './cart-store.js';
import { cartDeliveryNote } from './delivery-copy.js';
import { ERROR_COPY, QUOTE_DEBOUNCE_MS, parseQuantityInput, type ErrorKind } from './order-api.js';
import { storefrontLoginHref } from './return-path.js';
interface CartQuoteOption {
  name: string;
  value: string;
}

type CartQuoteLineState = 'ok' | 'insufficient' | 'unavailable' | 'revision_changed';

interface CartQuoteLine {
  sku: string;
  title: string | null;
  options: CartQuoteOption[];
  unit_price_minor: number | null;
  quantity: number;
  line_total_minor: number | null;
  state: CartQuoteLineState;
  available?: number;
}

type CartQuoteShipping =
  | { state: 'quoted'; groups: { group_ref: string; amount_minor: number }[]; total_minor: number }
  | { state: 'needs_delivery_data' | 'not_configured'; groups: never[]; total_minor: null }
  | Extract<ReturnType<typeof CartQuoteResponseSchema.parse>['shipping'], {state: 'unavailable'}>;

interface CartQuoteResponse {
  delivery_options?: ReturnType<typeof CartDeliveryOptionSchema.parse>[];
  publication_revision: string;
  currency: CartCurrency;
  lines: CartQuoteLine[];
  merchandise_total_minor: number;
  discounts: never[];
  shipping: CartQuoteShipping;
  total_minor: number | null;
}

type CartErrorKind = 'rate_limited' | 'paused' | 'not_open' | 'store_not_found' | 'failed';

type CartQuoteResult =
  | { kind: 'ok'; quote: CartQuoteResponse }
  | { kind: CartErrorKind };

const CART_ALERT_COPY: Record<'rate_limited' | 'paused' | 'failed', string> = {
  rate_limited: '更新太頻繁，請稍後再試。',
  paused: '商店服務暫停中，請稍後再試。',
  failed: '無法取得最新價格，請稍後重試。',
};

function cartFullKey(cart: StoredCart): string {
  if (cart.lines.length === 0) return '';
  return `${cart.revision}|${cart.lines.map(line => `${line.sku}:${line.quantity}`).join(',')}`;
}

function isCartQuoteShape(
  value: unknown,
  requestedLines: readonly { sku: string; quantity: number }[],
): value is CartQuoteResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.publication_revision !== 'string' || !isValidRevision(candidate.publication_revision)) {
    return false;
  }
  if (!isValidCurrency(candidate.currency)) return false;
  if (!isValidPriceMinor(candidate.merchandise_total_minor)) return false;
  if (!Array.isArray(candidate.discounts) || candidate.discounts.length !== 0) return false;
  if (candidate.total_minor !== null && !isValidPriceMinor(candidate.total_minor)) return false;

  const shipping = candidate.shipping;
  if (!shipping || typeof shipping !== 'object' || Array.isArray(shipping)) return false;
  const shipRecord = shipping as Record<string, unknown>;
  if (shipRecord.state === 'quoted') {
    if (!Array.isArray(shipRecord.groups) || !isValidPriceMinor(shipRecord.total_minor)) return false;
    for (const group of shipRecord.groups) {
      if (!group || typeof group !== 'object' || Array.isArray(group)) return false;
      const g = group as Record<string, unknown>;
      if (typeof g.group_ref !== 'string' || !isValidPriceMinor(g.amount_minor)) return false;
    }
  } else if (shipRecord.state === 'needs_delivery_data' || shipRecord.state === 'not_configured') {
    if (!Array.isArray(shipRecord.groups) || shipRecord.groups.length !== 0 || shipRecord.total_minor !== null) {
      return false;
    }
  } else {
    return false;
  }

  if (!Array.isArray(candidate.lines) || candidate.lines.length !== requestedLines.length) return false;
  for (let i = 0; i < requestedLines.length; i += 1) {
    const rawLine = candidate.lines[i];
    if (!rawLine || typeof rawLine !== 'object' || Array.isArray(rawLine)) return false;
    const line = rawLine as Record<string, unknown>;
    if (line.sku !== requestedLines[i].sku) return false;
    if (line.quantity !== requestedLines[i].quantity) return false;
    if (line.title !== null && !isValidTitle(line.title)) return false;
    if (!Array.isArray(line.options)) return false;
    for (const opt of line.options) {
      if (!opt || typeof opt !== 'object' || Array.isArray(opt)) return false;
      const optRecord = opt as Record<string, unknown>;
      if (typeof optRecord.name !== 'string' || typeof optRecord.value !== 'string') return false;
    }
    if (line.unit_price_minor !== null && !isValidPriceMinor(line.unit_price_minor)) return false;
    if (line.line_total_minor !== null && !isValidPriceMinor(line.line_total_minor)) return false;
    if (
      line.state !== 'ok' &&
      line.state !== 'revision_changed' &&
      line.state !== 'insufficient' &&
      line.state !== 'unavailable'
    ) {
      return false;
    }
    if (line.state === 'insufficient') {
      if (typeof line.available !== 'number' || !Number.isInteger(line.available) || line.available < 0) {
        return false;
      }
    }
    if (line.state === 'ok' || line.state === 'revision_changed') {
      if (line.unit_price_minor === null || line.line_total_minor === null) return false;
    }
  }

  return true;
}

async function postCartQuote(storeSlug: string, cart: StoredCart, enhanced = false): Promise<CartQuoteResult> {
  const requestedLines = cart.lines.map(line => ({
    sku: line.sku,
    quantity: line.quantity,
  }));
  try {
    const response = await fetch(`/api/v1/public/stores/${encodeURIComponent(storeSlug)}/cart-quotes`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        publication_revision: cart.revision,
        lines: requestedLines,
      }),
    });

    if (response.status >= 200 && response.status < 300) {
      try {
        const body: unknown = await response.json();
        if (enhanced) {
          const parsed = CartQuoteResponseSchema.safeParse(body);
          if (!parsed.success || parsed.data.lines.length !== requestedLines.length || parsed.data.lines.some((line, index) => line.sku !== requestedLines[index].sku || line.quantity !== requestedLines[index].quantity)) return {kind: 'failed'};
          return {kind: 'ok', quote: parsed.data};
        }
        if (!isCartQuoteShape(body, requestedLines)) return { kind: 'failed' };
        return { kind: 'ok', quote: body };
      } catch {
        return { kind: 'failed' };
      }
    }
    if (response.status === 429) return { kind: 'rate_limited' };
    if (response.status === 404) return { kind: 'store_not_found' };
    if (response.status === 503) {
      try {
        const body = (await response.json()) as { code?: unknown };
        if (body && body.code === 'commerce_quarantined') return { kind: 'paused' };
      } catch {
        return { kind: 'failed' };
      }
      return { kind: 'failed' };
    }
    if (response.status === 409) {
      try {
        const body = (await response.json()) as { code?: unknown };
        if (body && body.code === 'checkout_not_enabled') return { kind: 'not_open' };
      } catch {
        return { kind: 'failed' };
      }
      return { kind: 'failed' };
    }
    return { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

interface CartPageProps {
  container: HTMLElement;
  storeSlug: string;
  storeName: string;
}

type PendingFocusTarget =
  | { kind: 'heading' }
  | { kind: 'remove'; sku: string }
  | { kind: 'quantity'; sku: string }
  | null;

function CartPage({ container, storeSlug, storeName }: CartPageProps) {
  const enhanced = container.dataset.buyerJourney === 'true';
  const [cart, setCart] = useState<StoredCart>(() => readCart(storeSlug));
  const [draftQuantities, setDraftQuantities] = useState<Record<string, string>>({});
  const [matchedQuote, setMatchedQuote] = useState<{ key: string; quote: CartQuoteResponse } | null>(null);
  const [errorState, setErrorState] = useState<{ key: string; kind: CartErrorKind } | null>(null);
  const [removalStatus, setRemovalStatus] = useState<string>('');
  const [pendingFocus, setPendingFocus] = useState<PendingFocusTarget>(null);

  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const quantityInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const removeButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const latestCartRef = useRef<StoredCart>(cart);
  const inFlightRef = useRef<boolean>(false);
  const debounceTimerRef = useRef<number | null>(null);
  const followUpReadyRef = useRef<boolean>(false);
  const retryInFlightRef = useRef<boolean>(false);
  const unmountedRef = useRef<boolean>(false);

  const currentKey = cartFullKey(cart);
  const quote = matchedQuote && matchedQuote.key === currentKey ? matchedQuote.quote : null;
  const activeError = errorState && errorState.key === currentKey ? errorState.kind : null;
  const isPending = cart.lines.length > 0 && quote === null && activeError === null;

  useEffect(() => {
    container.setAttribute('aria-busy', isPending ? 'true' : 'false');
  }, [container, isPending]);

  useEffect(() => {
    document.title = `購物車｜${storeName}｜自由工坊`;
  }, [storeName]);

  useEffect(() => {
    if (!pendingFocus) return;
    if (pendingFocus.kind === 'heading') {
      headingRef.current?.focus();
    } else if (pendingFocus.kind === 'remove') {
      removeButtonRefs.current.get(pendingFocus.sku)?.focus();
    } else if (pendingFocus.kind === 'quantity') {
      quantityInputRefs.current.get(pendingFocus.sku)?.focus();
    }
    setPendingFocus(null);
  }, [pendingFocus, cart, quote, activeError]);

  function clearDebounceTimer() {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }

  async function executeFetch() {
    if (unmountedRef.current) return;
    const requestCart = latestCartRef.current;
    if (requestCart.lines.length === 0) return;
    if (inFlightRef.current) {
      followUpReadyRef.current = true;
      return;
    }

    inFlightRef.current = true;
    followUpReadyRef.current = false;
    const requestKey = cartFullKey(requestCart);
    const wasRetry = retryInFlightRef.current;
    retryInFlightRef.current = false;

    const result = await postCartQuote(storeSlug, requestCart, enhanced);
    if (unmountedRef.current) return;
    inFlightRef.current = false;

    const currentCart = latestCartRef.current;
    if (cartFullKey(currentCart) === requestKey) {
      if (result.kind === 'ok') {
        let nextCart = currentCart;
        if (result.quote.publication_revision !== currentCart.revision) {
          nextCart = {
            revision: result.quote.publication_revision,
            lines: currentCart.lines,
          };
          latestCartRef.current = nextCart;
          writeCart(storeSlug, nextCart);
          setCart(nextCart);
        }
        const nextKey = cartFullKey(nextCart);
        setErrorState(null);
        setMatchedQuote({ key: nextKey, quote: result.quote });
        if (wasRetry) {
          setPendingFocus({ kind: 'heading' });
        }
      } else {
        setMatchedQuote(null);
        setErrorState({ key: requestKey, kind: result.kind });
      }
    } else if (currentCart.lines.length > 0 && followUpReadyRef.current && debounceTimerRef.current === null) {
      followUpReadyRef.current = false;
      void executeFetch();
    }
  }

  function scheduleDebouncedQuote(nextCart: StoredCart) {
    clearDebounceTimer();
    followUpReadyRef.current = false;
    retryInFlightRef.current = false;
    if (nextCart.lines.length === 0) {
      setMatchedQuote(null);
      setErrorState(null);
      return;
    }
    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      void executeFetch();
    }, QUOTE_DEBOUNCE_MS);
  }

  useEffect(() => {
    unmountedRef.current = false;
    if (latestCartRef.current.lines.length > 0) {
      void executeFetch();
    }
    const unsubscribe = subscribe(storeSlug, () => {
      const nextCart = readCart(storeSlug);
      latestCartRef.current = nextCart;
      setDraftQuantities({});
      setCart(nextCart);
      scheduleDebouncedQuote(nextCart);
    });
    return () => {
      unmountedRef.current = true;
      clearDebounceTimer();
      unsubscribe();
    };
  }, [storeSlug]);

  function applyCartChange(nextCart: StoredCart) {
    latestCartRef.current = nextCart;
    writeCart(storeSlug, nextCart);
    setCart(nextCart);
    scheduleDebouncedQuote(nextCart);
  }

  function clearDraftForSku(sku: string) {
    setDraftQuantities(prev => {
      if (!(sku in prev)) return prev;
      const next = { ...prev };
      delete next[sku];
      return next;
    });
  }

  function handleStepQuantity(sku: string, nextQuantity: number) {
    if (nextQuantity < 1 || nextQuantity > MAX_LINE_QUANTITY) return;
    clearDraftForSku(sku);
    const current = latestCartRef.current;
    const nextLines = current.lines.map(line => (line.sku === sku ? { ...line, quantity: nextQuantity } : line));
    applyCartChange({ revision: current.revision, lines: nextLines });
  }

  function handleInputQuantity(sku: string, rawValue: string) {
    setDraftQuantities(prev => ({ ...prev, [sku]: rawValue }));
    const parsed = parseQuantityInput(rawValue);
    if (parsed === null) return;
    const current = latestCartRef.current;
    const existing = current.lines.find(line => line.sku === sku);
    if (!existing || existing.quantity === parsed) return;
    const nextLines = current.lines.map(line => (line.sku === sku ? { ...line, quantity: parsed } : line));
    applyCartChange({ revision: current.revision, lines: nextLines });
  }

  function handleBlurQuantity(sku: string) {
    clearDraftForSku(sku);
  }

  function handleCapToAvailable(sku: string, available: number) {
    if (available < 1 || available > MAX_LINE_QUANTITY) return;
    clearDraftForSku(sku);
    const current = latestCartRef.current;
    const nextLines = current.lines.map(line => (line.sku === sku ? { ...line, quantity: available } : line));
    applyCartChange({ revision: current.revision, lines: nextLines });
    setPendingFocus({ kind: 'quantity', sku });
  }

  function handleRemoveLine(index: number, sku: string, displayTitle: string) {
    clearDraftForSku(sku);
    const current = latestCartRef.current;
    const nextLines = current.lines.filter(line => line.sku !== sku);
    const nextCart: StoredCart = nextLines.length === 0 ? { revision: '', lines: [] } : { revision: current.revision, lines: nextLines };

    setRemovalStatus(`已從購物車移除「${displayTitle}」。`);
    if (nextLines.length === 0) {
      setPendingFocus({ kind: 'heading' });
    } else if (index < nextLines.length) {
      setPendingFocus({ kind: 'remove', sku: nextLines[index].sku });
    } else {
      setPendingFocus({ kind: 'remove', sku: nextLines[nextLines.length - 1].sku });
    }

    applyCartChange(nextCart);
  }

  function handleRetry() {
    clearDebounceTimer();
    followUpReadyRef.current = false;
    retryInFlightRef.current = true;
    setErrorState(null);
    void executeFetch();
  }

  if (cart.lines.length === 0) {
    return (
      <>
        <h1 id="shop-cart-title" ref={headingRef} tabIndex={-1}>購物車</h1>
        {removalStatus && <p className="shop-sr-only" role="status">{removalStatus}</p>}
        <p>購物車是空的。</p>
        <div className="shop-cart-actions">
          <a href={`/shops/${storeSlug}`}>回到「{storeName}」</a>
        </div>
      </>
    );
  }

  const isAlertError = activeError === 'rate_limited' || activeError === 'paused' || activeError === 'failed';
  const hideAmounts = activeError === 'not_open' || activeError === 'store_not_found';
  const hasFlaggedLines = Boolean(
    quote && quote.lines.some(line => line.state === 'insufficient' || line.state === 'unavailable'),
  );

  let merchandiseDisplay = '計算中…';
  let shippingDisplay = '計算中…';
  let totalDisplay = '計算中…';

  if (isAlertError) {
    merchandiseDisplay = '無法取得';
    shippingDisplay = '無法取得';
    totalDisplay = '無法取得';
  } else if (quote) {
    merchandiseDisplay = formatMinor(quote.merchandise_total_minor, quote.currency);
    if (quote.shipping.state === 'quoted') {
      shippingDisplay = formatMinor(quote.shipping.total_minor, quote.currency);
    } else if (quote.shipping.state === 'not_configured') {
      shippingDisplay = '這間店尚未設定配送方式';
    } else {
      shippingDisplay = '於下一步依配送方式計算';
    }

    if (quote.total_minor !== null) {
      totalDisplay = formatMinor(quote.total_minor, quote.currency);
    } else if (hasFlaggedLines) {
      totalDisplay = '處理上面標示的商品後顯示';
    } else if (quote.shipping.state === 'not_configured') {
      totalDisplay = '店家設定配送方式後顯示';
    } else {
      totalDisplay = '選擇配送方式後顯示';
    }
  }

  return (
    <>
      <h1 id="shop-cart-title" ref={headingRef} tabIndex={-1}>購物車</h1>
      {removalStatus && <p className="shop-sr-only" role="status">{removalStatus}</p>}
      {isAlertError && (
        <>
          <p role="alert" className="shop-cart-alert">{CART_ALERT_COPY[activeError]}</p>
          <div className="shop-cart-actions">
            <button
              type="button"
              className="shop-button shop-button-secondary"
              disabled={isPending}
              onClick={handleRetry}
            >
              重試
            </button>
          </div>
        </>
      )}
      {activeError === 'not_open' && (
        <p role="status">這間店目前沒有開放線上購物。購物車會保留在這個瀏覽器。</p>
      )}
      {activeError === 'store_not_found' && (
        <p role="status">這間商店目前沒有公開。</p>
      )}

      <section className="shop-cart-section" aria-labelledby="shop-cart-items-heading">
        <h2 id="shop-cart-items-heading">商品</h2>
        <ul className="shop-cart-lines">
          {cart.lines.map((line, index) => {
            const quoteLine = quote ? quote.lines[index] : null;
            const displayTitle = quoteLine && quoteLine.title !== null ? quoteLine.title : line.title;
            const rawLineQuantity = draftQuantities[line.sku] ?? String(line.quantity);
            const lineInputInvalid = parseQuantityInput(rawLineQuantity) === null;
            const lineErrorId = `shop-cart-qty-error-${line.sku}`;
            const hideQuantityControls =
              quoteLine !== null &&
              (quoteLine.state === 'unavailable' ||
                (quoteLine.state === 'insufficient' && (quoteLine.available ?? 0) === 0));

            const showPriceUpdated = Boolean(
              quote &&
                quoteLine &&
                quoteLine.unit_price_minor !== null &&
                (line.price_minor !== quoteLine.unit_price_minor || line.currency !== quote.currency),
            );

            return (
              <li key={line.sku} className="shop-cart-line">
                <p className="shop-cart-line-title">
                  {quoteLine && quoteLine.title !== null ? (
                    <a href={`/shops/${storeSlug}/products/${line.sku}`}>{quoteLine.title}</a>
                  ) : (
                    line.title
                  )}
                </p>
                {quoteLine && quoteLine.options.length > 0 && (
                  <p className="shop-cart-line-options">
                    {quoteLine.options.map(opt => `${opt.name}：${opt.value}`).join('、')}
                  </p>
                )}
                {!hideAmounts && isPending && (
                  <p className="shop-cart-line-numbers">
                    <span>單價 計算中…</span>
                    <span className="shop-cart-line-subtotal">小計 計算中…</span>
                  </p>
                )}
                {!hideAmounts && isAlertError && (
                  <p className="shop-cart-line-numbers">
                    <span>單價 無法取得</span>
                    <span className="shop-cart-line-subtotal">小計 無法取得</span>
                  </p>
                )}
                {!hideAmounts &&
                  quote &&
                  quoteLine &&
                  (quoteLine.unit_price_minor !== null ||
                    ((quoteLine.state === 'ok' || quoteLine.state === 'revision_changed') &&
                      quoteLine.line_total_minor !== null)) && (
                    <p className="shop-cart-line-numbers">
                      {quoteLine.unit_price_minor !== null && (
                        <span>單價 {formatMinor(quoteLine.unit_price_minor, quote.currency)}</span>
                      )}
                      {(quoteLine.state === 'ok' || quoteLine.state === 'revision_changed') &&
                        quoteLine.line_total_minor !== null && (
                          <span className="shop-cart-line-subtotal">
                            小計 {formatMinor(quoteLine.line_total_minor, quote.currency)}
                          </span>
                        )}
                    </p>
                  )}
                {!hideAmounts && showPriceUpdated && (
                  <p className="shop-cart-price-updated">
                    價格已更新，加入時為 {formatMinor(line.price_minor, line.currency)}
                  </p>
                )}
                {quoteLine?.state === 'insufficient' && (quoteLine.available ?? 0) > 0 && (
                  <>
                    <p className="shop-cart-line-state">
                      數量不足，目前最多可購買 {quoteLine.available} 件。
                    </p>
                    <div className="shop-cart-actions">
                      <button
                        type="button"
                        className="shop-button shop-button-secondary"
                        aria-label={`把${displayTitle}改為可購買數量`}
                        onClick={() => handleCapToAvailable(line.sku, quoteLine.available ?? 1)}
                      >
                        改為可購買數量
                      </button>
                    </div>
                  </>
                )}
                {((quoteLine?.state === 'insufficient' && (quoteLine.available ?? 0) === 0) ||
                  (quoteLine?.state === 'unavailable' && quoteLine.title !== null)) && (
                  <p className="shop-cart-line-state">目前沒有可售數量。</p>
                )}
                {quoteLine?.state === 'unavailable' && quoteLine.title === null && (
                  <p className="shop-cart-line-state">已下架。</p>
                )}
                {enhanced && quote && cartDeliveryNote(quote.delivery_options ?? [], line.sku) && <p className="shop-cart-line-state">{cartDeliveryNote(quote.delivery_options ?? [], line.sku)}</p>}
                <div className="shop-cart-line-controls">
                  {!hideQuantityControls && (
                    <div className="shop-cart-stepper">
                      <button
                        type="button"
                        className="shop-button shop-button-secondary shop-button-stepper"
                        aria-label={`減少${displayTitle}數量`}
                        disabled={line.quantity <= 1}
                        onClick={() => handleStepQuantity(line.sku, line.quantity - 1)}
                      >
                        −
                      </button>
                      <input
                        ref={el => {
                          if (el) quantityInputRefs.current.set(line.sku, el);
                          else quantityInputRefs.current.delete(line.sku);
                        }}
                        className="shop-quantity-input"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={MAX_LINE_QUANTITY}
                        step={1}
                        aria-label={`${displayTitle}數量`}
                        aria-invalid={lineInputInvalid ? 'true' : undefined}
                        aria-describedby={lineInputInvalid ? lineErrorId : undefined}
                        value={rawLineQuantity}
                        onChange={event => handleInputQuantity(line.sku, event.target.value)}
                        onBlur={() => handleBlurQuantity(line.sku)}
                      />
                      <button
                        type="button"
                        className="shop-button shop-button-secondary shop-button-stepper"
                        aria-label={`增加${displayTitle}數量`}
                        disabled={line.quantity >= MAX_LINE_QUANTITY}
                        onClick={() => handleStepQuantity(line.sku, line.quantity + 1)}
                      >
                        +
                      </button>
                    </div>
                  )}
                  <button
                    ref={el => {
                      if (el) removeButtonRefs.current.set(line.sku, el);
                      else removeButtonRefs.current.delete(line.sku);
                    }}
                    type="button"
                    className="shop-button shop-button-secondary"
                    aria-label={`從購物車移除${displayTitle}`}
                    onClick={() => handleRemoveLine(index, line.sku, displayTitle)}
                  >
                    移除
                  </button>
                </div>
                {!hideQuantityControls && lineInputInvalid && (
                  <p id={lineErrorId} className="shop-field-error">請輸入 1 到 99 的數量。</p>
                )}
              </li>
            );
          })}
        </ul>
        {!hideAmounts && hasFlaggedLines && (
          <p className="shop-cart-note">商品小計不含上面標示的商品。</p>
        )}
      </section>

      {!hideAmounts && (
        <>
          <section className="shop-cart-section" aria-labelledby="shop-cart-totals-heading">
            <h2 id="shop-cart-totals-heading">金額明細</h2>
            <dl className="shop-cart-totals">
              <div className="shop-cart-row">
                <dt>商品小計</dt>
                <dd>{merchandiseDisplay}</dd>
              </div>
              <div className="shop-cart-row">
                <dt>運費</dt>
                <dd>{shippingDisplay}</dd>
              </div>
              <div className="shop-cart-row shop-cart-row-total">
                <dt>總額</dt>
                <dd>{totalDisplay}</dd>
              </div>
            </dl>
          </section>
          <p>{hasFlaggedLines ? '請先處理上面標示的商品。' : '請到結帳頁選擇取貨與付款方式，核對最新價格。'}</p>
          <div className="shop-cart-actions">
            {!hasFlaggedLines && quote && <a href={`/shops/${storeSlug}/checkout`} className="shop-button shop-pay-primary">前往結帳</a>}
            <a href={`/shops/${storeSlug}`}>繼續購物</a>
          </div>
        </>
      )}

      {activeError === 'not_open' && (
        <div className="shop-cart-actions">
          <a href={`/shops/${storeSlug}`}>回到「{storeName}」</a>
        </div>
      )}
      {activeError === 'store_not_found' && (
        <div className="shop-cart-actions">
          <a href="/">返回自由工坊</a>
        </div>
      )}
    </>
  );
}

export function bootCartPage() {
  const container = document.getElementById('shop-cart');
  if (!container) return;
  const storeSlug = container.dataset.storeSlug ?? '';
  const storeName = container.dataset.storeName ?? '';
  if (!isValidStoreSlug(storeSlug)) return;

  createRoot(container).render(
    <CartPage
      container={container}
      storeSlug={storeSlug}
      storeName={storeName}
    />,
  );
}
