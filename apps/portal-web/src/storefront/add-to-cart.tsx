import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  cartCount,
  isValidCurrency,
  isValidPriceMinor,
  isValidProductSku,
  isValidRevision,
  isValidStoreSlug,
  isValidTitle,
  readCart,
  subscribe,
  writeCart,
  type CartCurrency,
  type StoredCart,
} from './cart-store.js';
import { NON_NEGATIVE_INT_PATTERN, parseQuantityInput } from './order-api.js';
interface AddToCartProps {
  storeSlug: string;
  sku: string;
  title: string;
  priceMinor: number;
  currency: CartCurrency;
  revision: string;
  onCartChanged: () => void;
}

type AddAlertKind = 'max_lines' | 'storage_error' | null;

function AddToCart({ storeSlug, sku, title, priceMinor, currency, revision, onCartChanged }: AddToCartProps) {
  const [rawQuantity, setRawQuantity] = useState<string>('1');
  const [alertKind, setAlertKind] = useState<AddAlertKind>(null);
  const [sheetQuantity, setSheetQuantity] = useState<number>(1);
  const [sheetCapped, setSheetCapped] = useState<boolean>(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const viewCartLinkRef = useRef<HTMLAnchorElement | null>(null);

  const parsedQuantity = parseQuantityInput(rawQuantity);
  const isInvalid = parsedQuantity === null;
  const errorId = 'shop-add-quantity-error';

  function handleAdd() {
    if (parsedQuantity === null) {
      inputRef.current?.focus();
      return;
    }
    setAlertKind(null);
    const currentCart = readCart(storeSlug);
    const existingIndex = currentCart.lines.findIndex(line => line.sku === sku);
    let nextQuantity = parsedQuantity;
    let wasCapped = false;
    const nextLines = currentCart.lines.slice();

    if (existingIndex >= 0) {
      const existing = nextLines[existingIndex];
      const sum = existing.quantity + parsedQuantity;
      if (sum > MAX_LINE_QUANTITY) {
        nextQuantity = MAX_LINE_QUANTITY;
        wasCapped = true;
      } else {
        nextQuantity = sum;
      }
      nextLines[existingIndex] = {
        sku,
        quantity: nextQuantity,
        title,
        price_minor: priceMinor,
        currency,
      };
    } else {
      if (nextLines.length >= MAX_CART_LINES) {
        setAlertKind('max_lines');
        return;
      }
      nextLines.push({
        sku,
        quantity: nextQuantity,
        title,
        price_minor: priceMinor,
        currency,
      });
    }

    const ok = writeCart(storeSlug, {
      revision,
      lines: nextLines,
    });
    if (!ok) {
      setAlertKind('storage_error');
      return;
    }

    setSheetQuantity(nextQuantity);
    setSheetCapped(wasCapped);
    onCartChanged();
    if (dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
    viewCartLinkRef.current?.focus();
  }

  return (
    <>
      <div className="shop-add-controls">
        <label htmlFor="shop-add-quantity" className="shop-add-label">數量</label>
        <input
          id="shop-add-quantity"
          ref={inputRef}
          className="shop-quantity-input"
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_LINE_QUANTITY}
          step={1}
          value={rawQuantity}
          aria-invalid={isInvalid ? 'true' : undefined}
          aria-describedby={isInvalid ? errorId : undefined}
          onChange={event => {
            setRawQuantity(event.target.value);
            if (alertKind) setAlertKind(null);
          }}
        />
        <button
          ref={addButtonRef}
          type="button"
          className="shop-button shop-add-submit"
          onClick={handleAdd}
        >
          加入購物車
        </button>
      </div>
      {isInvalid && (
        <p id={errorId} className="shop-field-error">請輸入 1 到 99 的數量。</p>
      )}
      {alertKind === 'max_lines' && (
        <div role="alert" className="shop-add-alert">
          <span>購物車最多放 50 項商品，請先到購物車移除一些商品。</span>
          <a href={`/shops/${storeSlug}/cart`}>查看購物車</a>
        </div>
      )}
      {alertKind === 'storage_error' && (
        <p role="alert" className="shop-add-alert">
          這個瀏覽器無法保存購物車。請允許這個網站儲存資料後再試一次。
        </p>
      )}
      <dialog
        ref={dialogRef}
        className="shop-cart-sheet"
        aria-labelledby="shop-cart-sheet-title"
        onClose={() => {
          addButtonRef.current?.focus();
        }}
      >
        <div className="shop-cart-sheet-top">
          <h2 id="shop-cart-sheet-title">已加入購物車</h2>
          <button
            type="button"
            className="shop-button shop-button-secondary"
            onClick={() => dialogRef.current?.close()}
          >
            關閉
          </button>
        </div>
        <p className="shop-cart-sheet-product">{title}</p>
        <p>購物車裡的數量：{sheetQuantity}</p>
        {sheetCapped && <p>每項商品最多 99 件，已調整為 99 件。</p>}
        <div className="shop-cart-sheet-actions">
          <a
            ref={viewCartLinkRef}
            href={`/shops/${storeSlug}/cart`}
            className="shop-button"
            autoFocus
          >
            查看購物車
          </a>
          <button
            type="button"
            className="shop-button shop-button-secondary"
            onClick={() => dialogRef.current?.close()}
          >
            繼續購物
          </button>
        </div>
      </dialog>
    </>
  );
}

export function bootCartHeaderLink(): () => void {
  const link = document.querySelector<HTMLElement>('.shop-cart-link[data-store-slug]');
  if (!link) return () => {};
  const targetLink = link;
  const slug = targetLink.dataset.storeSlug ?? '';
  if (!isValidStoreSlug(slug)) return () => {};

  let previousCount = cartCount(readCart(slug));
  targetLink.textContent = previousCount === 0 ? '購物車' : `購物車（${previousCount}）`;

  function syncCount() {
    const nextCount = cartCount(readCart(slug));
    targetLink.textContent = nextCount === 0 ? '購物車' : `購物車（${nextCount}）`;
    if (nextCount !== previousCount) {
      previousCount = nextCount;
      const announcer = document.getElementById('shop-cart-status');
      if (announcer) {
        announcer.textContent = nextCount === 0 ? '購物車是空的' : `購物車有 ${nextCount} 件商品`;
      }
    }
  }

  subscribe(slug, syncCount);
  return syncCount;
}

export function bootAddToCart(notifyHeader: () => void) {
  const container = document.getElementById('shop-add-to-cart');
  if (!container) return;
  const storeSlug = container.dataset.storeSlug ?? '';
  const sku = container.dataset.sku ?? '';
  const title = container.dataset.title ?? '';
  const rawPriceMinor = container.dataset.priceMinor ?? '';
  const currency = container.dataset.currency ?? '';
  const revision = container.dataset.revision ?? '';

  if (
    !isValidStoreSlug(storeSlug) ||
    !isValidProductSku(sku) ||
    !isValidTitle(title) ||
    !NON_NEGATIVE_INT_PATTERN.test(rawPriceMinor) ||
    !isValidCurrency(currency) ||
    !isValidRevision(revision)
  ) {
    return;
  }

  const priceMinor = Number(rawPriceMinor);
  if (!isValidPriceMinor(priceMinor)) return;

  createRoot(container).render(
    <AddToCart
      storeSlug={storeSlug}
      sku={sku}
      title={title}
      priceMinor={priceMinor}
      currency={currency}
      revision={revision}
      onCartChanged={notifyHeader}
    />,
  );
}
