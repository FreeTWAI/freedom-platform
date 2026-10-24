import {useCallback, useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {
  CartQuoteResponseSchema, CheckoutErrorSchema, CheckoutResponseSchema, PlaceOrderInputSchema,
  PlaceOrderResponseSchema, CheckoutBuyerIdentitySchema, type CheckoutBuyerIdentity, type ShippingMethodRef,
} from '../../../../contracts/guild-launchpad/v1/hosted-checkout.js';
import {OpaqueId} from '../../../../contracts/guild-launchpad/v1/primitives.js';
import {formatMinor} from '../../../../modules/agent-commerce/hosted/format.js';
import {isValidStoreSlug, readCart, writeCart} from './cart-store.js';
import {formatTaipeiDateTime} from './format.js';
import {DELIVERY_NAMES, SHIPPING_REASON_COPY, deliveryPanels, deliveryAlternatives, deliveryLineTitle, type BlockedDeliveryLine} from './delivery-copy.js';
import {storefrontLoginHref} from './return-path.js';
import {CheckoutBuyerState, readCheckoutIdentity, IDENTITY_CHANGED_COPY, PREVIOUS_ORDER_COPY} from './buyer-state.js';

type Quote = ReturnType<typeof CartQuoteResponseSchema.parse>;
type Checkout = ReturnType<typeof CheckoutResponseSchema.parse>;
type Intent = {checkoutRef: string; input: ReturnType<typeof PlaceOrderInputSchema.parse>};
const methodNames = {immediate_card: '信用卡', bank_transfer: '銀行匯款', cash_on_meetup: '面交付款'};
const deliveryNames = DELIVERY_NAMES;
const unavailable = {member_required: '登入會員後才能選擇匯款或面交', meetup_required: '面交付款只能搭配面交取貨', payment_profile_unavailable: '這個付款方式目前無法使用'};
const fieldNames: Record<string, string> = {'delivery.name': '收件人姓名', 'delivery.mobile': '收件人手機', 'delivery.postal_code': '郵遞區號', 'delivery.address': '收件地址', 'delivery.method': '取貨方式'};
const deliveryFieldTargets:Record<string,string>={'delivery.name':'checkout-name','delivery.mobile':'checkout-mobile','delivery.postal_code':'checkout-postal','delivery.address':'checkout-address'};
const intentKey = (slug: string) => `freedom.shop.order-intent.v1:${slug}`;
function readIntent(slug: string): Intent | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(intentKey(slug)) ?? 'null');
    const id = OpaqueId.safeParse(raw?.checkoutRef), input = PlaceOrderInputSchema.safeParse(raw?.input);
    return id.success && input.success ? {checkoutRef: id.data, input: input.data} : null;
  } catch {return null;}
}
async function post(slug: string, path: string, body: unknown, key?: string, buyer?: CheckoutBuyerIdentity, signal?: AbortSignal) {
  const response = await fetch(`/api/v1/public/stores/${encodeURIComponent(slug)}/${path}`, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: {Accept: 'application/json', 'Content-Type': 'application/json', ...(key ? {'Idempotency-Key': key} : {}), ...(buyer ? {'X-Commerce-Buyer': buyer} : {})},
    signal,
    body: JSON.stringify(body),
  });
  const data: unknown = await response.json();
  return {response, data};
}
function errorCopy(raw: unknown): string {
  const parsed = CheckoutErrorSchema.safeParse(raw);
  if (!parsed.success) return '無法確認處理結果。請重試同一筆請求。';
  const error = parsed.data;
  if (error.fields) return error.fields.map(field => `${fieldNames[field.path] ?? '收件資料'}需要修正（${field.code === 'required' ? '必填' : '格式不符'}）。`).join('');
  switch (error.code) {
    case 'terms_changed': case 'publication_changed': return '商品、價格或配送設定已更新。請回購物車重新核對。';
    case 'checkout_identity_changed': return IDENTITY_CHANGED_COPY;
    case 'offline_payment_requires_member': return unavailable.member_required;
    case 'offline_order_limit': return '這間店目前待付款的訂單較多，請稍後再試或選擇其他付款方式。';
    case 'commerce_rate_limited': case 'too_many_open_orders': return '目前訂單或操作次數較多，請稍後再試。';
    case 'checkout_not_enabled': return '這間店尚未開放結帳。';
    case 'commerce_quarantined': return '商店服務暫停中，請稍後再試。';
    case 'stock_unavailable': case 'supply_unavailable': return '商品庫存已改變，請回購物車重新確認數量。';
    case 'shipping_not_configured': case 'shipping_unavailable': return '目前商品無法使用這個取貨方式，請重新選擇。';
    case 'delivery_store_required': return '尚未選擇取貨門市，請選擇其他取貨方式。';
    case 'checkout_expired': return '這次結帳已到期，請回購物車重新核對。';
    case 'checkout_order_not_found': case 'checkout_not_found': return '目前無法查看這次結帳。請使用原本的瀏覽器或登入下單的會員帳號。';
    case 'payment_method_unavailable': case 'payment_profile_unavailable': return '這個付款方式目前無法使用，請重新核對訂單。';
    default: return '無法完成這次操作。請保留目前頁面並稍後重試。';
  }
}

function CheckoutPage({slug, name, container}: {slug: string; name: string; container: HTMLElement}) {
  const enhanced = container.dataset.buyerJourney === 'true';
  const [buyer] = useState(() => {try {return enhanced ? new CheckoutBuyerState(slug, sessionStorage) : null;} catch {return null;}});
  const [identityChecking, setIdentityChecking] = useState(enhanced);
  const [identityError, setIdentityError] = useState('');
  const [identityGeneration, setIdentityGeneration] = useState(0);
  const [identityNotice, setIdentityNotice] = useState(false);
  const [previousOrder, setPreviousOrder] = useState(false);
  const mounted = useRef(true);
  const checking = useRef<Promise<{identity: CheckoutBuyerIdentity; generation: number; changed: boolean} | null> | null>(null);
  const [cart] = useState(() => readCart(slug));
  const [intent, setIntent] = useState<Intent | null>(() => enhanced ? buyer?.intent ?? null : readIntent(slug));
  // A persisted intent has no original cart snapshot. After a reload, the
  // current cart may belong to a newer purchase, so recovery must retain it.
  const submittedCart = useRef(intent === null ? cart : null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [method, setMethod] = useState<ShippingMethodRef | ''>('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [postal, setPostal] = useState('');
  const [address, setAddress] = useState('');
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [payment, setPayment] = useState<keyof typeof methodNames | ''>('');
  const [busy, setBusy] = useState(false);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [deliveryFailure, setDeliveryFailure] = useState<BlockedDeliveryLine[]>([]);
  const fieldProps = (path: string) => ({'aria-invalid': Boolean(fieldErrors[path]), 'aria-describedby': fieldErrors[path] ? `checkout-error-${path}` : undefined});
  const fieldError = (path: string) => fieldErrors[path] ? <p id={`checkout-error-${path}`} className="shop-order-alert">{fieldErrors[path]}</p> : null;
  const [refresh, setRefresh] = useState(0);
  const [freezeUnknown, setFreezeUnknown] = useState(false);
  const inFlight = useRef(false);
  const freezeRequest = useRef<{key: string; body: unknown} | null>(null);
  type Operation = {controller: AbortController; identity?: CheckoutBuyerIdentity; generation: number};
  const operation = useRef<Operation | null>(null);
  const live = (request: Operation) => mounted.current && operation.current === request && (!enhanced || request.identity !== undefined && buyer?.matches(request.identity, request.generation));
  const heading = useRef<HTMLHeadingElement>(null);
  const lines = cart.lines.map(({sku, quantity}) => ({sku, quantity}));

  const checkIdentity = useCallback(() => {
    if (checking.current) return checking.current;
    setIdentityChecking(true);
    const pending = (async () => {
      try {
        if (!buyer) throw Error('Unavailable tab storage.');
        const identity = await readCheckoutIdentity();
        if (!mounted.current) return null;
        const result = buyer.observe(identity);
        setIdentityError(''); setIdentityGeneration(buyer.generation);
        if (result.changed) {
          operation.current?.controller.abort(); operation.current = null; inFlight.current = false;
          freezeRequest.current = null;
          setIntent(null); setCheckout(null); setQuote(null); setPayment(''); setMethod('');
          setContactName(''); setEmail(''); setMobile(''); setPostal(''); setAddress('');
          setFieldErrors({}); setDeliveryFailure([]); setError(''); setFreezeUnknown(false); setBusy(false); setQuoteBusy(false);
          setIdentityNotice(true); setPreviousOrder(value => value || result.previousOrder);
          requestAnimationFrame(() => heading.current?.focus());
        }
        return {identity, generation: buyer.generation, changed: result.changed};
      } catch {
        if (mounted.current) {setIdentityError('無法確認登入狀態，請重試。'); setQuoteBusy(false);}
        return null;
      } finally {
        checking.current = null;
        if (mounted.current) setIdentityChecking(false);
      }
    })();
    checking.current = pending;
    return pending;
  }, [buyer]);
  useEffect(() => {
    mounted.current = true;
    if (!enhanced) return () => {mounted.current = false;};
    const refreshIdentity = () => {void checkIdentity();};
    const visible = () => {if (document.visibilityState === 'visible') refreshIdentity();};
    refreshIdentity();
    window.addEventListener('pageshow', refreshIdentity); window.addEventListener('focus', refreshIdentity);
    document.addEventListener('visibilitychange', visible);
    return () => {
      mounted.current = false; operation.current?.controller.abort();
      window.removeEventListener('pageshow', refreshIdentity); window.removeEventListener('focus', refreshIdentity);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [enhanced, checkIdentity]);
  function identityRejected() {
    buyer?.invalidate(); setIdentityNotice(true); void checkIdentity();
  }
  // A confirmed tab stays editable during a background read. Failed reads
  // remain blocked until a successful check; actions still await that check.
  const identityBlocked = enhanced && (Boolean(identityError) || !buyer?.identity);
  useEffect(() => {
    if (busy || identityBlocked || freezeUnknown) return;
    const target = Object.keys(fieldErrors).map(path => deliveryFieldTargets[path]).find(Boolean);
    if (target) document.getElementById(target)?.focus();
  }, [busy, identityBlocked, freezeUnknown, fieldErrors]);
  useEffect(() => {container.setAttribute('aria-busy', busy || quoteBusy || enhanced && identityChecking ? 'true' : 'false');}, [busy, quoteBusy, container, enhanced, identityChecking]);
  useEffect(() => {document.title = `結帳｜${name}｜自由工坊`;}, [name]);
  useEffect(() => {
    if (intent || checkout || cart.lines.length === 0 || identityBlocked) return;
    const identity = buyer?.identity, generation = buyer?.generation;
    const controller = new AbortController();
    let active = true;
    // Keep the delivery controls mounted while repricing so keyboard focus and
    // the selected recipient fields are not lost. Stale totals cannot submit.
    setQuoteBusy(true); setError('');
    const timer = window.setTimeout(() => {
      void post(slug, 'cart-quotes', {
        publication_revision: cart.revision, lines,
        ...(method ? {delivery: {method, ...((method === 'home' || method === 'self_ship') && postal ? {postal_code: postal} : {})}} : {}),
      }, undefined, enhanced ? identity ?? undefined : undefined, controller.signal).then(({response, data}) => {
        if (!active || enhanced && (!identity || !buyer?.matches(identity, generation!))) return;
        if (enhanced && (CheckoutErrorSchema.safeParse(data).data?.code === 'checkout_identity_changed' || response.ok && CheckoutBuyerIdentitySchema.safeParse(response.headers.get('X-Commerce-Buyer')).data !== identity)) {identityRejected(); return;}
        const parsed = CartQuoteResponseSchema.safeParse(data);
        if (!response.ok || !parsed.success) {setQuote(null); setError(errorCopy(data)); return;}
        const result = parsed.data;
        if (result.lines.length !== lines.length || result.lines.some((line, index) => line.sku !== lines[index].sku || line.quantity !== lines[index].quantity)) {
          setQuote(null); setError('報價與購物車不符，請重新讀取。'); return;
        }
        setQuote(result); setDeliveryFailure([]);
      }).catch(() => {if (active) {setQuote(null); setError('無法取得最新報價，請稍後重試。');}})
        .finally(() => {if (active) setQuoteBusy(false);});
    }, 300);
    return () => {active = false; controller.abort(); window.clearTimeout(timer);};
  }, [slug, cart, method, postal, refresh, Boolean(checkout), Boolean(intent), identityBlocked, identityGeneration]);

  async function freeze() {
    if (inFlight.current || (!freezeRequest.current && (!quote || quoteBusy))) return;
    const observed = enhanced ? await checkIdentity() : null;
    if (enhanced && (!observed || observed.changed) || inFlight.current) return;
    const request: Operation = {controller: new AbortController(), identity: observed?.identity, generation: observed?.generation ?? 0};
    operation.current = request;
    inFlight.current = true; setBusy(true); setError(''); setFieldErrors({});
    if (!freezeRequest.current) freezeRequest.current = {
      key: crypto.randomUUID(),
      body: {publication_revision: quote!.publication_revision, lines,
        contact: {name: contactName.trim(), email: email.trim(), phone: mobile.trim()},
        delivery: {method, name: contactName.trim(), mobile: mobile.trim(), ...((method === 'home' || method === 'self_ship') ? {postal_code: postal.trim(), address: address.trim()} : {})},
        invoice: null, consents: []},
    };
    try {
      const {response, data} = await post(slug, 'checkouts', freezeRequest.current.body, freezeRequest.current.key, request.identity, request.controller.signal);
      if (!live(request)) return;
      if (CheckoutErrorSchema.safeParse(data).data?.code === 'checkout_identity_changed') {identityRejected(); return;}
      const parsed = CheckoutResponseSchema.safeParse(data);
      if (response.ok && parsed.success) {
        setCheckout(parsed.data); setQuoteBusy(false); setFreezeUnknown(false); freezeRequest.current = null;
        const offered = quote?.payment_options.find(option => option.available && parsed.data.terms.payment_methods.includes(option.method));
        setPayment(offered?.method ?? '');
        heading.current?.focus();
      } else {
        setError(errorCopy(data));
        const problem = CheckoutErrorSchema.safeParse(data);
        if (enhanced && problem.success && problem.data.lines) {setDeliveryFailure(problem.data.lines); setRefresh(value => value + 1);}
        if (problem.success && problem.data.fields) {
          const copy:Record<string,string>={required:'請填寫此欄位。',format:'請檢查此欄位的格式。',too_long:'此欄位內容太長。',unknown_postal_code:'請填寫可辨識的臺灣郵遞區號。'};
          setFieldErrors(Object.fromEntries(problem.data.fields.map(field => [field.path, method==='self_ship' ? copy[field.code]??'請檢查此欄位的格式。' : `${fieldNames[field.path] ?? '收件資料'}${field.code === 'required' ? '為必填' : '格式不符'}，請修正後再試。`])));
        }
        const definitive = response.status >= 400 && response.status < 500 && CheckoutErrorSchema.safeParse(data).success;
        setFreezeUnknown(!definitive);
        if (definitive) freezeRequest.current = null;
      }
    } catch {if (live(request)) {setFreezeUnknown(true); setError('還沒收到結帳結果。重試會沿用同一筆請求。');}}
    finally {if (operation.current === request) {operation.current = null; inFlight.current = false; if (mounted.current) setBusy(false);}}
  }

  async function place() {
    if (inFlight.current || (!intent && (!checkout || !payment))) return;
    const observed = enhanced ? await checkIdentity() : null;
    if (enhanced && (!observed || observed.changed) || inFlight.current) return;
    const request: Operation = {controller: new AbortController(), identity: observed?.identity, generation: observed?.generation ?? 0};
    const current = intent ?? {checkoutRef: checkout!.checkout_ref, input: {terms_sha256: checkout!.terms_sha256, client_order_id: crypto.randomUUID(), payment_method: payment as keyof typeof methodNames}};
    const retrying = intent !== null;
    // Persist only replay coordinates, never contacts, checkout keys or bank data.
    // Saving before the first request makes refresh/unknown ACK replay the same order.
    try {if (enhanced) buyer!.saveIntent(current); else sessionStorage.setItem(intentKey(slug), JSON.stringify(current));}
    catch {setError('瀏覽器無法保留下單結果，請允許此網站儲存資料後再下單。'); return;}
    operation.current = request;
    setIntent(current); inFlight.current = true; setBusy(true); setError('');
    try {
      const {response, data} = await post(slug, `checkouts/${encodeURIComponent(current.checkoutRef)}/orders`, current.input, undefined, request.identity, request.controller.signal);
      if (!live(request)) return;
      if (CheckoutErrorSchema.safeParse(data).data?.code === 'checkout_identity_changed') {identityRejected(); return;}
      const parsed = PlaceOrderResponseSchema.safeParse(data);
      if (response.ok && parsed.success && parsed.data.order.store.slug === slug && parsed.data.order.payment_method === current.input.payment_method) {
        if (enhanced) buyer!.clearIntent(); else sessionStorage.removeItem(intentKey(slug));
        freezeRequest.current = null;
        // A cart changed in another tab must not be discarded by an older checkout.
        if (submittedCart.current && JSON.stringify(readCart(slug)) === JSON.stringify(submittedCart.current)) writeCart(slug, {revision: '', lines: []});
        window.location.assign(parsed.data.payment?.handoff_url ?? `/shops/${encodeURIComponent(slug)}/orders/${parsed.data.order.order_ref}`);
        return;
      }
      setError(errorCopy(data));
      const problem = CheckoutErrorSchema.safeParse(data);
      if (response.status === 409 && problem.success && problem.data.code === 'unresolved_order' && problem.data.order_ref) {
        window.location.assign(`/shops/${encodeURIComponent(slug)}/orders/${problem.data.order_ref}`);
      }
      // A first, explicit transaction rejection allows the buyer to edit the
      // frozen checkout. After any uncertain attempt, keep the original replay
      // coordinates even if a later gate refuses it; that order may exist.
      if (!retrying && response.status >= 400 && response.status < 500 && problem.success && problem.data.code !== 'unresolved_order') {
        if (enhanced) buyer!.clearIntent(); else sessionStorage.removeItem(intentKey(slug));
        setIntent(null);
      }
    } catch {if (live(request)) setError('還沒收到下單結果。請重試同一筆訂單，避免重複下單。');}
    finally {if (operation.current === request) {operation.current = null; inFlight.current = false; if (mounted.current) setBusy(false);}}
  }

  const quoteReady = Boolean(!identityBlocked && quote && !quoteBusy && method && quote.shipping.state === 'quoted' && quote.total_minor !== null && quote.lines.every(line => line.state === 'ok' || line.state === 'revision_changed'));
  const deliveryOption = quote?.delivery_options.find(option => option.method === method);
  const dropShip=deliveryOption?.fulfilment_mode==='drop_ship';
  const dropShipNotice='由供應商直接寄出；收件人姓名、手機、地址會提供給供應商，只用於寄送';
  const paymentOptions = (quote?.payment_options ?? []).filter(option => method !== 'self_ship' || option.method === 'bank_transfer');
  const panels = enhanced ? deliveryPanels(quote, method, deliveryFailure) : [];
  const alternatives = deliveryAlternatives(quote, method);
  const needsAlternative = panels.length > 0 && (!method || quote?.shipping.state === 'unavailable' || deliveryFailure.length > 0);
  return <>
    <h1 id="shop-checkout-title" tabIndex={-1} ref={heading}>結帳</h1>
    {enhanced && identityNotice && <p role="status" className="shop-order-alert">{IDENTITY_CHANGED_COPY}</p>}
    {enhanced && previousOrder && <p>{PREVIOUS_ORDER_COPY}</p>}
    {enhanced && identityChecking && identityBlocked && <p role="status">正在確認登入狀態…</p>}
    {enhanced && identityError && <div><p role="alert">{identityError}</p><button type="button" className="shop-button shop-button-secondary" onClick={() => void checkIdentity()}>重新確認登入狀態</button></div>}
    {error && <p role="alert" className="shop-order-alert">{error}</p>}
    {intent ? <section className="shop-order-section" aria-labelledby="shop-order-retry-heading">
      <h2 id="shop-order-retry-heading">確認下單結果</h2>
      <p>上次下單結果尚未確認。重試會沿用同一筆訂單。</p>
      <div className="shop-order-actions"><button className="shop-button shop-pay-primary" disabled={busy || identityBlocked} type="button" onClick={() => void place()}>{busy ? '正在確認…' : '重試同一筆訂單'}</button><a href={`/shops/${slug}/order-access`}>找回訂單</a></div>
    </section> : cart.lines.length === 0 ? <p>購物車是空的。<a href={`/shops/${slug}`}>回到商店</a></p> : checkout ? <>
      <section className="shop-order-section" aria-labelledby="shop-checkout-summary">
        <h2 id="shop-checkout-summary">2. 核對商品與配送</h2>
        <ul className="shop-order-lines">{checkout.terms.items.map(line => <li className="shop-order-line" key={line.sku}><p>{line.title} × {line.quantity}</p><p>{formatMinor(line.line_total_minor, checkout.terms.currency)}</p></li>)}</ul>
        {checkout.terms.shipping.groups.map(group => <div key={group.group_ref}><p>{group.fulfilment_mode==='drop_ship'?'宅配（供應商代出貨）':deliveryNames[group.method]}・運費 {formatMinor(group.amount_minor, checkout.terms.currency)}</p>{group.fulfilment_mode==='drop_ship'&&<p>{dropShipNotice}</p>}{group.meetup_note && <p className="shop-preserve-lines">{group.meetup_note}</p>}{group.self_ship&&<><p>店家確認收款後 {group.self_ship.handling_days} 個工作天內寄出。</p>{group.self_ship.note&&<p className="shop-preserve-lines">{group.self_ship.note}</p>}</>}</div>)}
        <p className="shop-pay-label">總額 {formatMinor(checkout.terms.total_minor, checkout.terms.currency)}</p>
        <p>收件人：{contactName}・{mobile}</p><p>Email：{email}</p>
        {(method === 'home' || method === 'self_ship') && <p>地址：{postal} {address}</p>}
      </section>
      <section className="shop-order-section" aria-labelledby="shop-checkout-payment">
        <h2 id="shop-checkout-payment">3. 付款方式</h2>
        {paymentOptions.map(option => <label className="shop-checkout-choice" key={option.method}>
          <input type="radio" name="payment" checked={payment === option.method} disabled={busy || !option.available || !checkout.terms.payment_methods.includes(option.method)} onChange={() => setPayment(option.method)} />
          <span>{methodNames[option.method]}{option.reason && <span className="shop-checkout-reason">{unavailable[option.reason]}</span>}</span>
        </label>)}
        {method === 'self_ship'&&<p>{dropShip?'代出貨只提供銀行匯款，店家確認收款後由供應商寄出。':'自行寄送只提供銀行匯款，店家確認收款後寄出。'}</p>}
        {payment === 'bank_transfer' && <p>下單後提供匯款帳號，請於 {checkout.terms.offline_payment?.bank_transfer_deadline_days} 天內付款。店家確認後更新訂單狀態。</p>}
        {payment === 'cash_on_meetup' && <p>請於 {checkout.terms.offline_payment?.meetup_deadline_days} 天內完成面交付款。</p>}
      </section>
      <section className="shop-order-section" aria-labelledby="shop-checkout-confirm">
        <h2 id="shop-checkout-confirm">4. 最後確認</h2><p>請確認商品、收件資料與付款方式。報價有效至 {formatTaipeiDateTime(checkout.expires_at)}。</p>
        <div className="shop-order-actions"><button className="shop-button shop-pay-primary" type="button" disabled={busy || identityBlocked || !payment} onClick={() => void place()}>{payment === 'immediate_card' ? '確認並付款' : '確認下單'}</button>
          <button className="shop-button shop-button-secondary" type="button" disabled={busy || identityBlocked} onClick={() => {setCheckout(null); setPayment(''); setError('');}}>修改資料</button></div>
      </section>
    </> : <form onSubmit={event => {event.preventDefault(); void freeze();}}>
      <fieldset className="shop-checkout-fields" disabled={busy || identityBlocked || freezeUnknown}>
        <legend>1. 聯絡人與取貨方式</legend>
        <div className="shop-order-access-field"><label htmlFor="checkout-name">收件人姓名</label><input {...fieldProps('delivery.name')} id="checkout-name" className="shop-text-input" autoComplete="name" maxLength={40} required value={contactName} onChange={event => setContactName(event.target.value)} />{fieldError('delivery.name')}</div>
        <div className="shop-order-access-field"><label htmlFor="checkout-mobile">收件人手機</label><input {...fieldProps('delivery.mobile')} id="checkout-mobile" className="shop-text-input" type="tel" autoComplete="tel" maxLength={20} required value={mobile} onChange={event => setMobile(event.target.value)} />{fieldError('delivery.mobile')}</div>
        <div className="shop-order-access-field"><label htmlFor="checkout-email">Email</label><input id="checkout-email" className="shop-text-input" type="email" autoComplete="email" maxLength={254} required value={email} onChange={event => setEmail(event.target.value)} /></div>
        {quoteBusy && <p role="status">正在取得配送報價…</p>}
        {quote?.delivery_options.map(option => <label className="shop-checkout-choice" key={option.method}>
          <input type="radio" name="delivery" aria-describedby={enhanced && panels.some(panel => panel.method === option.method) ? `delivery-blocked-${option.method}` : undefined} required checked={method === option.method} disabled={!option.available || option.method.startsWith('cvs:')} onChange={() => setMethod(option.method)} />
          <span>{option.fulfilment_mode==='drop_ship'?'宅配（供應商代出貨）':deliveryNames[option.method]}{!option.available && <span className="shop-checkout-reason">目前商品無法使用這個取貨方式</span>}{option.method.startsWith('cvs:') && <span className="shop-checkout-reason">門市選擇尚未開放</span>}</span>
        </label>)}
        {panels.map(panel => <section className="shop-order-section" key={panel.method} aria-labelledby={`delivery-blocked-title-${panel.method}`} id={`delivery-blocked-${panel.method}`}>
          <h2 id={`delivery-blocked-title-${panel.method}`}>以下商品無法使用「{deliveryNames[panel.method]}」：</h2>
          <ul>{panel.lines.map(line => <li key={line.sku}>{deliveryLineTitle(line.sku, quote, cart.lines)}：{SHIPPING_REASON_COPY[line.reason]}</li>)}</ul>
        </section>)}
        {needsAlternative && (alternatives.length > 0 ? <div className="shop-order-actions">
          {alternatives.map(option => <button className="shop-button shop-button-secondary" type="button" key={option.method} disabled={quoteBusy || identityBlocked} onClick={() => {setDeliveryFailure([]); setMethod(option.method);}}>改用{deliveryNames[option.method]}</button>)}
          <p>選擇後將重新報價。</p>
        </div> : <div><p>這些商品目前無法一起配送，請回購物車調整或分開下單。</p><div className="shop-order-actions"><a href={`/shops/${slug}/cart`}>回購物車調整</a></div></div>)}
        {(method === 'home' || method === 'self_ship') && <>
          <div className="shop-order-access-field"><label htmlFor="checkout-postal">郵遞區號</label><input {...fieldProps('delivery.postal_code')} id="checkout-postal" className="shop-text-input" autoComplete="postal-code" inputMode="numeric" maxLength={10} required value={postal} onChange={event => setPostal(event.target.value)} />{fieldError('delivery.postal_code')}</div>
          <div className="shop-order-access-field"><label htmlFor="checkout-address">收件地址</label><input {...fieldProps('delivery.address')} id="checkout-address" className="shop-text-input" autoComplete="street-address" maxLength={120} required value={address} onChange={event => setAddress(event.target.value)} />{fieldError('delivery.address')}</div>
        </>}
        {method === 'self_ship'&&<><p>每單一件包裹；不配送離島。</p><p>{dropShip?'代出貨只提供銀行匯款，店家確認收款後由供應商寄出。':'自行寄送只提供銀行匯款，店家確認收款後寄出。'}</p><p>{dropShip?dropShipNotice:'收件資料僅供這間店處理訂單；不會顯示在公開商店頁。'}</p><p>請填寫 3、5 或 6 碼郵遞區號。</p><p>工作天為週一至週五，不另排除國定假日。</p></>}
        {deliveryOption?.note && <p className="shop-preserve-lines">{deliveryOption.note}</p>}
        {quoteReady && quote && <><p>商品 {formatMinor(quote.merchandise_total_minor, quote.currency)}</p><p>運費 {formatMinor(quote.shipping.total_minor!, quote.currency)}</p><p>商品與運費合計 {formatMinor(quote.total_minor!, quote.currency)}</p></>}
        {quote?.lines.some(line => line.state === 'revision_changed') && <p>商品內容或價格已更新，請在下一步核對最新報價。</p>}
        {quote?.lines.some(line => line.state === 'insufficient' || line.state === 'unavailable') && <p>商品庫存已改變，請回購物車調整。</p>}
        {paymentOptions.map(option => <p key={option.method}>{methodNames[option.method]}：{option.reason ? unavailable[option.reason] : '可使用'}</p>)}
        {paymentOptions.some(option => option.reason === 'member_required') && <div className="shop-order-actions"><a href={container.dataset.buyerJourney === 'true' ? storefrontLoginHref(`/shops/${slug}/checkout`) : '/'}>登入會員</a></div>}
      </fieldset>
      <div className="shop-order-actions">
        <button className="shop-button shop-pay-primary" type={freezeUnknown ? 'button' : 'submit'} disabled={busy || identityBlocked || (!freezeUnknown && (!quoteReady || !paymentOptions.some(option => option.available)))} onClick={freezeUnknown ? () => void freeze() : undefined}>{busy ? '正在核對…' : freezeUnknown ? '重試同一筆結帳' : '核對訂單'}</button>
        {!freezeUnknown && <button className="shop-button shop-button-secondary" type="button" disabled={busy || quoteBusy} onClick={() => setRefresh(value => value + 1)}>更新報價</button>}
      </div>
    </form>}
    {!intent && !freezeUnknown && <div className="shop-order-actions"><a href={`/shops/${slug}/cart`}>回購物車</a></div>}
  </>;
}

export function bootCheckoutPage() {
  const container = document.getElementById('shop-checkout');
  if (!container || !isValidStoreSlug(container.dataset.storeSlug ?? '')) return;
  createRoot(container).render(<CheckoutPage slug={container.dataset.storeSlug!} name={container.dataset.storeName ?? ''} container={container} />);
}
