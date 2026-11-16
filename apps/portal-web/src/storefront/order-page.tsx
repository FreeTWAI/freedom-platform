import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PublicOrder } from '../../../../contracts/guild-launchpad/v1/hosted-checkout.js';
import { formatMinor } from '../../../../modules/agent-commerce/hosted/format.js';
import { STORE_SLUG_PATTERN } from './cart-store.js';
import { formatOrderLifecycle, formatRetryAfterTaipeiTime, formatTaipeiDateTime, formatTaipeiTime } from './format.js';
import { MeetupCard } from './meetup-card.js';
import { OfflineOrder } from './offline-order.js';
import {
  ACCESS_TOKEN_PATTERN,
  ERROR_COPY,
  OPAQUE_ID_PATTERN,
  classifyOrderResponse,
  consumeAccessHash,
  fetchPublicOrder,
  postForgetBrowser,
  postRedeemOrder,
  queryPayment,
  startPayment,
  type ErrorKind,
  type TokenBox,
} from './order-api.js';
import { renderPaymentAlert, type PaymentAlertState } from './payment-alert.js';
import {
  PAYMENT_OUTCOME_COPY,
  PAYMENT_REFUSED_COPY,
  orderEmailNote,
  orderPaymentSectionCopy,
  paymentView,
  type PaymentView,
} from './payment-view.js';
import { storefrontLoginHref } from './return-path.js';
import { SelfShipCard } from './self-ship-card.js';
interface OrderPageProps {
  container: HTMLElement;
  storeSlug: string;
  storeName: string;
  orderRef: string;
  tokenBox: TokenBox;
  malformedAccessLink: boolean;
  emailEnabled: boolean;
}

type ViewState = 'loading' | 'link_prompt' | 'order' | 'not_found' | 'invalid_link' | 'forgotten';

function OrderPage({ container, storeSlug, storeName, orderRef, tokenBox, malformedAccessLink, emailEnabled }: OrderPageProps) {
  const readOnly = container.dataset.retainedOrder === 'true';
  const [view, setView] = useState<ViewState>(malformedAccessLink ? 'invalid_link' : 'loading');
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null);
  const [retryTarget, setRetryTarget] = useState<'get' | 'redeem'>('get');
  const [busy, setBusy] = useState<boolean>(!malformedAccessLink);
  const [redeeming, setRedeeming] = useState<boolean>(false);
  const [forgetting, setForgetting] = useState<boolean>(false);
  const [forgetError, setForgetError] = useState<boolean>(false);
  const [focusHeadingTrigger, setFocusHeadingTrigger] = useState<number>(0);
  const [focusPaymentHeadingTrigger, setFocusPaymentHeadingTrigger] = useState<number>(0);

  const [paymentBusy, setPaymentBusy] = useState<boolean>(false);
  const [redirecting, setRedirecting] = useState<boolean>(false);
  const [pendingHidePayButtons, setPendingHidePayButtons] = useState<boolean>(false);
  const [startRateLimited, setStartRateLimited] = useState<boolean>(false);
  const [queryRateLimited, setQueryRateLimited] = useState<boolean>(false);
  const [paymentAlert, setPaymentAlert] = useState<PaymentAlertState>(null);
  const [queryStatus, setQueryStatus] = useState<string>('');

  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const paymentHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const forgetTriggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const forgottenTransitionRef = useRef<boolean>(false);
  const failedForgetCloseRef = useRef(false);
  const forgetFocusRequest = useRef<{generation: number; failed: boolean} | null>(null);
  const redeemRejectedRef = useRef<boolean>(false);
  const initialTitleRef = useRef<string>(document.title);
  const orderReadGeneration = useRef(0);

  const paymentInFlightRef = useRef<boolean>(false);
  const redirectingRef = useRef<boolean>(false);
  const pendingHideTimerRef = useRef<number | null>(null);
  const startRateLimitTimerRef = useRef<number | null>(null);
  const queryRateLimitTimerRef = useRef<number | null>(null);

  const anyBusy = busy || forgetting || paymentBusy;

  useEffect(() => {
    container.setAttribute('aria-busy', anyBusy ? 'true' : 'false');
  }, [container, anyBusy]);

  useEffect(() => {
    if (view === 'order' && order) {
      document.title = `訂單 ${order.display_number}｜${order.store.name}｜自由工坊`;
    } else {
      document.title = initialTitleRef.current;
    }
  }, [view, order]);

  useEffect(() => {
    if (focusHeadingTrigger > 0) {
      headingRef.current?.focus();
    }
  }, [focusHeadingTrigger, view]);

  useEffect(() => {
    if (focusPaymentHeadingTrigger > 0) {
      paymentHeadingRef.current?.focus();
    }
  }, [focusPaymentHeadingTrigger, order]);

  useEffect(() => {
    const request = forgetFocusRequest.current;
    if (!request?.failed) return;
    if (request.generation !== orderReadGeneration.current || view !== 'order') {
      forgetFocusRequest.current = null;
      return;
    }
    const trigger = forgetTriggerRef.current, dialog = dialogRef.current;
    if (!trigger || trigger.disabled || !dialog || dialog.open) return;
    forgetFocusRequest.current = null;
    // A failed request may close before React commits the enabled trigger.
    // Restore once, without taking focus from a newer user interaction.
    const active = document.activeElement;
    if (active === document.body || active === trigger || (active && dialog.contains(active))) trigger.focus();
  }, [forgetting, forgetError, busy, paymentBusy, redirecting, view]);

  function clearPendingHideTimer() {
    if (pendingHideTimerRef.current !== null) {
      window.clearTimeout(pendingHideTimerRef.current);
      pendingHideTimerRef.current = null;
    }
  }

  function clearStartRateLimitTimer() {
    if (startRateLimitTimerRef.current !== null) {
      window.clearTimeout(startRateLimitTimerRef.current);
      startRateLimitTimerRef.current = null;
    }
  }

  function clearQueryRateLimitTimer() {
    if (queryRateLimitTimerRef.current !== null) {
      window.clearTimeout(queryRateLimitTimerRef.current);
      queryRateLimitTimerRef.current = null;
    }
  }

  function armPendingHideTimer(seconds: number) {
    clearPendingHideTimer();
    setPendingHidePayButtons(true);
    pendingHideTimerRef.current = window.setTimeout(() => {
      pendingHideTimerRef.current = null;
      setPendingHidePayButtons(false);
    }, seconds * 1000);
  }

  function armStartRateLimitTimer(seconds: number) {
    clearStartRateLimitTimer();
    setStartRateLimited(true);
    startRateLimitTimerRef.current = window.setTimeout(() => {
      startRateLimitTimerRef.current = null;
      setStartRateLimited(false);
    }, seconds * 1000);
  }

  function armQueryRateLimitTimer(seconds: number) {
    clearQueryRateLimitTimer();
    setQueryRateLimited(true);
    queryRateLimitTimerRef.current = window.setTimeout(() => {
      queryRateLimitTimerRef.current = null;
      setQueryRateLimited(false);
    }, seconds * 1000);
  }

  async function runInitialOrRetryGet() {
    const generation = ++orderReadGeneration.current;
    setBusy(true);
    const result = await fetchPublicOrder(storeSlug, orderRef);
    if (generation !== orderReadGeneration.current) return;
    if (result.kind === 'ok') {
      redeemRejectedRef.current = false;
      tokenBox.clear();
      setOrder(result.order);
      setErrorKind(null);
      setView('order');
      setBusy(false);
      return;
    }
    if (result.kind === 'not_found') {
      setErrorKind(null);
      setOrder(null);
      setPaymentAlert(null);
      if (tokenBox.read() !== null) {
        setView('link_prompt');
      } else if (redeemRejectedRef.current) {
        redeemRejectedRef.current = false;
        setView('invalid_link');
      } else {
        setView('not_found');
      }
      setBusy(false);
      return;
    }
    setErrorKind(result.kind);
    setRetryTarget('get');
    setBusy(false);
  }

  async function cancelOfflineOrder() {
    if (paymentInFlightRef.current || busy || forgetting || !order || order.payment_method === 'immediate_card') return;
    const generation = ++orderReadGeneration.current;
    paymentInFlightRef.current = true;
    setPaymentBusy(true);
    setPaymentAlert(null);
    try {
      const response = await fetch(`/api/v1/public/stores/${encodeURIComponent(storeSlug)}/orders/${encodeURIComponent(orderRef)}/cancel`, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: {Accept: 'application/json', 'Content-Type': 'application/json'}, body: '{}',
      });
      const result = await classifyOrderResponse(response);
      if (generation !== orderReadGeneration.current) return;
      if (result.kind === 'ok' && result.order.order_ref === orderRef && result.order.store.slug === storeSlug) {
        setOrder(result.order);
        setErrorKind(null);
      } else if (result.kind === 'not_found' || response.status === 403) {
        setOrder(null);
        setView('not_found');
      } else {
        await reReadOrderAfterPayment(false);
        setPaymentAlert({section: 'payment', kind: 'text', text: '尚未確認訂單已取消。請查看最新狀態後再試。'});
      }
    } catch {
      if (generation !== orderReadGeneration.current) return;
      await reReadOrderAfterPayment(false);
      setPaymentAlert({section: 'payment', kind: 'text', text: '尚未確認訂單已取消。請查看最新狀態後再試。'});
    } finally {
      paymentInFlightRef.current = false;
      setPaymentBusy(false);
    }
  }

  async function reReadOrderAfterPayment(preserveAlertOnError: boolean): Promise<PublicOrder | null> {
    const generation = orderReadGeneration.current;
    const result = await fetchPublicOrder(storeSlug, orderRef);
    if (generation !== orderReadGeneration.current) return null;
    if (result.kind === 'ok') {
      setOrder(result.order);
      setErrorKind(null);
      setView('order');
      return result.order;
    }
    if (result.kind === 'not_found') {
      setOrder(null);
      setErrorKind(null);
      setPaymentAlert(null);
      setView('not_found');
      return null;
    }
    if (!preserveAlertOnError) {
      setErrorKind(result.kind);
      setRetryTarget('get');
    }
    return null;
  }

  async function handleStartPayment() {
    if (paymentInFlightRef.current || busy || forgetting || redirectingRef.current || startRateLimited) return;
    paymentInFlightRef.current = true;
    setPaymentBusy(true);
    const activeOrderSlug = order?.store.slug ?? storeSlug;
    const outcome = await startPayment(activeOrderSlug, orderRef);

    if (outcome.kind === 'redirect') {
      setPaymentAlert(null);
      redirectingRef.current = true;
      setRedirecting(true);
      paymentInFlightRef.current = false;
      setPaymentBusy(false);
      window.location.assign(outcome.handoffUrl);
      return;
    }

    if (outcome.kind === 'pending') {
      setPaymentAlert({ section: 'action', kind: 'text', text: PAYMENT_OUTCOME_COPY.pending });
      armPendingHideTimer(outcome.retryAfterSeconds);
      await reReadOrderAfterPayment(true);
      paymentInFlightRef.current = false;
      setPaymentBusy(false);
      return;
    }

    if (outcome.kind === 'refused') {
      if (outcome.code === 'checkout_hold_expired') {
        setPaymentAlert({ section: 'action', kind: 'hold_expired', storeSlug: activeOrderSlug });
      } else {
        setPaymentAlert({ section: 'action', kind: 'text', text: PAYMENT_REFUSED_COPY[outcome.code] });
      }
      await reReadOrderAfterPayment(true);
      paymentInFlightRef.current = false;
      setPaymentBusy(false);
      return;
    }

    if (outcome.kind === 'rate_limited') {
      const retryTime = formatRetryAfterTaipeiTime(outcome.retryAfterSeconds);
      setPaymentAlert({
        section: 'action',
        kind: 'text',
        text: `操作太頻繁，請在 ${retryTime} 後再試。`,
      });
      armStartRateLimitTimer(outcome.retryAfterSeconds);
      paymentInFlightRef.current = false;
      setPaymentBusy(false);
      return;
    }

    if (outcome.kind === 'paused') {
      setPaymentAlert({ section: 'action', kind: 'text', text: PAYMENT_OUTCOME_COPY.paused });
      paymentInFlightRef.current = false;
      setPaymentBusy(false);
      return;
    }

    if (outcome.kind === 'payment_unavailable') {
      setPaymentAlert({ section: 'action', kind: 'text', text: PAYMENT_OUTCOME_COPY.payment_unavailable });
      paymentInFlightRef.current = false;
      setPaymentBusy(false);
      return;
    }

    if (outcome.kind === 'not_found') {
      setPaymentAlert(null);
      await reReadOrderAfterPayment(false);
      paymentInFlightRef.current = false;
      setPaymentBusy(false);
      return;
    }

    setPaymentAlert({ section: 'action', kind: 'text', text: PAYMENT_OUTCOME_COPY.failed });
    paymentInFlightRef.current = false;
    setPaymentBusy(false);
  }

  async function handleQueryPayment() {
    if (paymentInFlightRef.current || busy || forgetting || redirectingRef.current || queryRateLimited) return;
    paymentInFlightRef.current = true;
    setPaymentBusy(true);
    const activeOrderSlug = order?.store.slug ?? storeSlug;
    const outcome = await queryPayment(activeOrderSlug, orderRef);

    if (outcome.kind === 'ok') {
      const nextView = paymentView(outcome.order);
      const nextCopy = orderPaymentSectionCopy(nextView);
      const nextHasQueryButton = outcome.order.lifecycle_state === 'open' && nextCopy.canQueryWhenOpen;
      setOrder(outcome.order);
      setPaymentAlert(null);
      setQueryStatus(`${formatTaipeiTime(Date.now())} 已查詢：${nextCopy.label}`);
      paymentInFlightRef.current = false;
      setPaymentBusy(false);
      if (!nextHasQueryButton) {
        setFocusPaymentHeadingTrigger(count => count + 1);
      }
      return;
    }

    setQueryStatus('');

    if (outcome.kind === 'pending') {
      setPaymentAlert({ section: 'payment', kind: 'text', text: PAYMENT_OUTCOME_COPY.pending });
      armPendingHideTimer(outcome.retryAfterSeconds);
      const nextOrder = await reReadOrderAfterPayment(true);
      paymentInFlightRef.current = false;
      setPaymentBusy(false);
      if (nextOrder) {
        const nextCopy = orderPaymentSectionCopy(paymentView(nextOrder));
        if (!(nextOrder.lifecycle_state === 'open' && nextCopy.canQueryWhenOpen)) {
          setFocusPaymentHeadingTrigger(count => count + 1);
        }
      }
      return;
    }

    if (outcome.kind === 'refused') {
      setPaymentAlert({ section: 'payment', kind: 'text', text: PAYMENT_REFUSED_COPY[outcome.code] });
      const nextOrder = await reReadOrderAfterPayment(true);
      paymentInFlightRef.current = false;
      setPaymentBusy(false);
      if (nextOrder) {
        const nextCopy = orderPaymentSectionCopy(paymentView(nextOrder));
        if (!(nextOrder.lifecycle_state === 'open' && nextCopy.canQueryWhenOpen)) {
          setFocusPaymentHeadingTrigger(count => count + 1);
        }
      }
      return;
    }

    if (outcome.kind === 'rate_limited') {
      const retryTime = formatRetryAfterTaipeiTime(outcome.retryAfterSeconds);
      setPaymentAlert({
        section: 'payment',
        kind: 'text',
        text: `操作太頻繁，請在 ${retryTime} 後再試。`,
      });
      armQueryRateLimitTimer(outcome.retryAfterSeconds);
      paymentInFlightRef.current = false;
      setPaymentBusy(false);
      return;
    }

    if (outcome.kind === 'paused') {
      setPaymentAlert({ section: 'payment', kind: 'text', text: PAYMENT_OUTCOME_COPY.paused });
      paymentInFlightRef.current = false;
      setPaymentBusy(false);
      return;
    }

    if (outcome.kind === 'payment_unavailable') {
      setPaymentAlert({ section: 'payment', kind: 'text', text: PAYMENT_OUTCOME_COPY.payment_unavailable });
      paymentInFlightRef.current = false;
      setPaymentBusy(false);
      return;
    }

    if (outcome.kind === 'not_found') {
      setPaymentAlert(null);
      await reReadOrderAfterPayment(false);
      paymentInFlightRef.current = false;
      setPaymentBusy(false);
      return;
    }

    setPaymentAlert({ section: 'payment', kind: 'text', text: PAYMENT_OUTCOME_COPY.failed });
    paymentInFlightRef.current = false;
    setPaymentBusy(false);
  }

  async function runRedeem() {
    const generation = ++orderReadGeneration.current;
    const token = tokenBox.read();
    if (!token) {
      setView('invalid_link');
      return;
    }
    setBusy(true);
    setRedeeming(true);
    const result = await postRedeemOrder(storeSlug, orderRef, token);
    if (generation !== orderReadGeneration.current) return;
    if (result.kind === 'ok') {
      redeemRejectedRef.current = false;
      tokenBox.clear();
      setOrder(result.order);
      setErrorKind(null);
      setRedeeming(false);
      setBusy(false);
      setView('order');
      setFocusHeadingTrigger(count => count + 1);
      return;
    }
    if (result.kind === 'not_found') {
      tokenBox.clear();
      redeemRejectedRef.current = true;
      const followUp = await fetchPublicOrder(storeSlug, orderRef);
      if (generation !== orderReadGeneration.current) return;
      setRedeeming(false);
      setBusy(false);
      if (followUp.kind === 'ok') {
        redeemRejectedRef.current = false;
        setOrder(followUp.order);
        setErrorKind(null);
        setView('order');
        setFocusHeadingTrigger(count => count + 1);
      } else if (followUp.kind === 'not_found') {
        redeemRejectedRef.current = false;
        setOrder(null);
        setErrorKind(null);
        setView('invalid_link');
      } else {
        setErrorKind(followUp.kind);
        setRetryTarget('get');
      }
      return;
    }
    setRedeeming(false);
    setBusy(false);
    setErrorKind(result.kind);
    setRetryTarget('redeem');
  }

  useEffect(() => {
    if (!malformedAccessLink) {
      void runInitialOrRetryGet();
    }
    function handleHashChange() {
      forgetFocusRequest.current = null;
      const consumed = consumeAccessHash();
      if (consumed.kind === 'none') return;
      setForgetting(false);
      if (consumed.kind === 'malformed') {
        orderReadGeneration.current++;
        redeemRejectedRef.current = false;
        tokenBox.clear();
        setOrder(null);
        setErrorKind(null);
        setRedeeming(false);
        setBusy(false);
        setView('invalid_link');
        return;
      }
      redeemRejectedRef.current = false;
      tokenBox.write(consumed.token);
      setErrorKind(null);
      void runInitialOrRetryGet();
    }
    function handlePageShow(event: PageTransitionEvent) {
      if (!event.persisted && !redirectingRef.current) return;
      forgetFocusRequest.current = null;
      setForgetting(false);
      redirectingRef.current = false;
      paymentInFlightRef.current = false;
      setRedirecting(false);
      setPaymentBusy(false);
      clearStartRateLimitTimer();
      clearQueryRateLimitTimer();
      setStartRateLimited(false);
      setQueryRateLimited(false);
      setOrder(null);
      setView('loading');
      void runInitialOrRetryGet();
    }
    const cancelForgetFocus = () => { forgetFocusRequest.current = null; };
    window.addEventListener('pagehide', cancelForgetFocus);
    window.addEventListener('popstate', cancelForgetFocus);
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      orderReadGeneration.current++;
      forgetFocusRequest.current = null;
      window.removeEventListener('pagehide', cancelForgetFocus);
      window.removeEventListener('popstate', cancelForgetFocus);
      window.removeEventListener('hashchange', handleHashChange);
      window.removeEventListener('pageshow', handlePageShow);
      clearPendingHideTimer();
      clearStartRateLimitTimer();
      clearQueryRateLimitTimer();
    };
  }, []);

  function handleRetry() {
    if (retryTarget === 'redeem' && tokenBox.read() !== null) {
      void runRedeem();
    } else {
      void runInitialOrRetryGet();
    }
  }

  function openForgetDialog() {
    setForgetError(false);
    forgottenTransitionRef.current = false;
    failedForgetCloseRef.current = false;
    forgetFocusRequest.current = null;
    dialogRef.current?.showModal();
  }

  async function confirmForget() {
    const generation = ++orderReadGeneration.current;
    const focusRequest = {generation, failed: false};
    forgetFocusRequest.current = focusRequest;
    setForgetting(true);
    const outcome = await postForgetBrowser();
    if (generation !== orderReadGeneration.current) return;
    if (outcome === 'ok') {
      forgetFocusRequest.current = null;
      forgottenTransitionRef.current = true;
      dialogRef.current?.close();
      setForgetting(false);
      setErrorKind(null);
      setOrder(null);
      setPaymentAlert(null);
      setQueryStatus('');
      setView('forgotten');
      setFocusHeadingTrigger(count => count + 1);
      return;
    }
    focusRequest.failed = true;
    failedForgetCloseRef.current = true;
    setForgetting(false);
    setForgetError(true);
    dialogRef.current?.close();
  }

  const activeSlug = order?.store.slug ?? storeSlug;
  const activeStoreName = order?.store.name ?? storeName;
  const errorBlock = errorKind ? (
    <>
      <p role="alert" className="shop-order-alert">{ERROR_COPY[errorKind]}</p>
      <div className="shop-order-actions">
        <button type="button" className="shop-button shop-button-secondary" disabled={busy} onClick={handleRetry}>
          重試
        </button>
      </div>
    </>
  ) : null;

  if (view === 'loading') {
    return (
      <>
        <h1 id="shop-order-title" ref={headingRef} tabIndex={-1}>訂單</h1>
        {errorBlock ?? <p role="status">正在讀取訂單…</p>}
      </>
    );
  }

  if (view === 'link_prompt') {
    return (
      <>
        <h1 id="shop-order-title" ref={headingRef} tabIndex={-1}>開啟訂單</h1>
        <p role="status">這個訂單連結只能使用一次。開啟後，這個瀏覽器會記住這筆訂單，之後可以直接查看。</p>
        {errorBlock ?? (
          <div className="shop-order-actions">
            <button type="button" className="shop-button shop-button-prompt" disabled={busy} onClick={() => void runRedeem()}>
              {redeeming ? '正在開啟…' : '在這個瀏覽器開啟訂單'}
            </button>
          </div>
        )}
      </>
    );
  }

  if (view === 'not_found') {
    return (
      <>
        <h1 id="shop-order-title" ref={headingRef} tabIndex={-1}>找不到這筆訂單</h1>
        <p role="status">這個瀏覽器沒有這筆訂單的查看權限，或訂單不存在。訂單只能在下單時使用的瀏覽器，或以下單時登入的會員帳號查看。</p>
        {errorBlock}
        <div className="shop-order-actions">
          {container.dataset.buyerJourney === 'true' && <a href={storefrontLoginHref(`/shops/${activeSlug}/orders/${orderRef}`)}>登入會員</a>}
          <a href={`/shops/${activeSlug}/order-access`}>找回訂單</a>
          <a href={`/shops/${activeSlug}`}>回到「{activeStoreName}」</a>
        </div>
      </>
    );
  }

  if (view === 'invalid_link') {
    return (
      <>
        <h1 id="shop-order-title" ref={headingRef} tabIndex={-1}>這個訂單連結無法使用</h1>
        <p role="status">連結可能已經用過、超過 7 天，或不屬於這筆訂單。每個訂單連結只能在一個瀏覽器開啟一次。</p>
        {errorBlock}
        <div className="shop-order-actions">
          <a href={`/shops/${activeSlug}/order-access`}>找回訂單</a>
          <a href={`/shops/${activeSlug}`}>回到「{activeStoreName}」</a>
        </div>
      </>
    );
  }

  if (view === 'forgotten' || !order) {
    return (
      <>
        <h1 id="shop-order-title" ref={headingRef} tabIndex={-1}>這個瀏覽器已忘記你的訂單</h1>
        <p role="status">之後在這個瀏覽器打開訂單網址，會顯示找不到訂單。</p>
        {errorBlock}
        <div className="shop-order-actions">
          <a href={`/shops/${activeSlug}`}>回到「{activeStoreName}」</a>
        </div>
      </>
    );
  }

  const currentPayView = paymentView(order);
  const offline = order.payment_method !== 'immediate_card';
  const isOpenOrder = order.lifecycle_state === 'open';
  const showActionSection =
    !readOnly && !offline && isOpenOrder &&
    (currentPayView === 'ready' ||
      currentPayView === 'expired' ||
      ((currentPayView === 'failed' || currentPayView === 'awaiting') && order.can_resume_payment));
  const paymentSection = orderPaymentSectionCopy(currentPayView);
  const emailNote = readOnly ? '請以下單時登入的會員帳號查看訂單，或前往「我的訂單」。' : offline && emailEnabled ? '請保留訂單網址，也可以用下單時登入的會員帳號查看。' : orderEmailNote(currentPayView, emailEnabled);
  const paymentControlsDisabled = busy || forgetting || paymentBusy || redirecting;

  return (
    <>
      <div className="shop-order-header">
        <h1 id="shop-order-title" ref={headingRef} tabIndex={-1}>訂單 {order.display_number}</h1>
        <p className="shop-order-meta">
          <a href={`/shops/${order.store.slug}`}>{order.store.name}</a>・下單時間 {formatTaipeiDateTime(order.created_at)}
        </p>
        <p className="shop-order-status">訂單狀態：{formatOrderLifecycle(order)}</p>
      </div>
      {errorBlock}

      {offline && <OfflineOrder key={order.order_ref} order={order} readOnly={readOnly} disabled={paymentControlsDisabled}
        onCancel={cancelOfflineOrder} onRefresh={() => void runInitialOrRetryGet()} />}

      {showActionSection && (
        <section className="shop-order-section" aria-labelledby="shop-order-action-heading">
          <h2 id="shop-order-action-heading">需要你處理</h2>
          {currentPayView === 'ready' && (
            <>
              <p>請在 {formatTaipeiDateTime(order.pay_by)} 前完成付款，逾時保留的商品會釋出。</p>
              {order.can_resume_payment && !pendingHidePayButtons && (
                <div className="shop-order-actions">
                  <button
                    type="button"
                    className="shop-button shop-pay-primary"
                    disabled={paymentControlsDisabled || startRateLimited}
                    onClick={() => void handleStartPayment()}
                  >
                    {redirecting ? '正在前往付款…' : '前往付款'}
                  </button>
                </div>
              )}
            </>
          )}
          {currentPayView === 'failed' && order.can_resume_payment && (
            <>
              <p>請在 {formatTaipeiDateTime(order.pay_by)} 前重新付款，逾時保留的商品會釋出。</p>
              {!pendingHidePayButtons && (
                <div className="shop-order-actions">
                  <button
                    type="button"
                    className="shop-button shop-pay-primary"
                    disabled={paymentControlsDisabled || startRateLimited}
                    onClick={() => void handleStartPayment()}
                  >
                    {redirecting ? '正在前往付款…' : '重新付款'}
                  </button>
                </div>
              )}
            </>
          )}
          {currentPayView === 'awaiting' && order.can_resume_payment && (
            <>
              <p>如果你沒有完成付款，可以重新付款；我們會先向付款服務確認，不會重複扣款。</p>
              {!pendingHidePayButtons && (
                <div className="shop-order-actions">
                  <button
                    type="button"
                    className="shop-button shop-button-secondary"
                    disabled={paymentControlsDisabled || startRateLimited}
                    onClick={() => void handleStartPayment()}
                  >
                    {redirecting ? '正在前往付款…' : '重新付款'}
                  </button>
                </div>
              )}
            </>
          )}
          {currentPayView === 'expired' && (
            <>
              <p>付款期限已過，保留的商品已釋出。</p>
              <div className="shop-order-actions">
                <a href={`/shops/${order.store.slug}`}>回到「{order.store.name}」</a>
              </div>
            </>
          )}
          {paymentAlert && paymentAlert.section === 'action' && renderPaymentAlert(paymentAlert)}
        </section>
      )}

      <section className="shop-order-section" aria-labelledby="shop-order-payment-heading">
        <h2 id="shop-order-payment-heading" className="shop-pay-section-heading" ref={paymentHeadingRef} tabIndex={-1}>付款</h2>
        <p className="shop-pay-label">{offline && currentPayView === 'paid' ? '已收款（店家確認）' : paymentSection.label}</p>
        {!offline && paymentSection.description && <p>{paymentSection.description}</p>}
        {!readOnly && !offline && isOpenOrder && paymentSection.canQueryWhenOpen && (
          <div className="shop-order-actions">
            <button
              type="button"
              className="shop-button shop-button-secondary"
              disabled={paymentControlsDisabled || queryRateLimited}
              onClick={() => void handleQueryPayment()}
            >
              查詢付款結果
            </button>
          </div>
        )}
        <p role="status" className={queryStatus ? 'shop-pay-status' : 'shop-sr-only'}>
          {queryStatus}
        </p>
        {paymentAlert && (paymentAlert.section === 'payment' || !showActionSection) && renderPaymentAlert(paymentAlert)}
        {emailNote && <p className="shop-order-meta">{emailNote}</p>}
      </section>

      <MeetupCard order={order} />
      <SelfShipCard order={order} />

      <section className="shop-order-section" aria-labelledby="shop-order-items-heading">
        <h2 id="shop-order-items-heading">商品</h2>
        <ul className="shop-order-lines">
          {order.lines.map(line => (
            <li key={line.sku} className="shop-order-line">
              <p className="shop-order-line-title">{line.title}</p>
              {line.options.length > 0 && (
                <p className="shop-order-line-options">
                  {line.options.map(opt => `${opt.name}：${opt.value}`).join('、')}
                </p>
              )}
              <p className="shop-order-line-numbers">
                <span>數量 {line.quantity}</span>
                <span>單價 {formatMinor(line.unit_price_minor, order.currency)}</span>
                <span className="shop-order-line-subtotal">小計 {formatMinor(line.line_total_minor, order.currency)}</span>
              </p>
            </li>
          ))}
        </ul>
        <dl className="shop-order-totals">
          <div className="shop-order-row">
            <dt>商品小計</dt>
            <dd>{formatMinor(order.merchandise_total_minor, order.currency)}</dd>
          </div>
          {order.discount_total_minor > 0 && (
            <div className="shop-order-row">
              <dt>折扣</dt>
              <dd>−{formatMinor(order.discount_total_minor, order.currency)}</dd>
            </div>
          )}
          <div className="shop-order-row">
            <dt>運費</dt>
            <dd>{formatMinor(order.shipping_total_minor, order.currency)}</dd>
          </div>
          <div className="shop-order-row shop-order-row-total">
            <dt>總額</dt>
            <dd>{formatMinor(order.total_minor, order.currency)}</dd>
          </div>
        </dl>
      </section>

      <section className="shop-order-section" aria-labelledby="shop-order-contact-heading">
        <h2 id="shop-order-contact-heading">聯絡資料</h2>
        {order.redacted || !order.contact ? (
          <p>這筆訂單的聯絡資料已依保存期限遮罩。</p>
        ) : (
          <dl className="shop-order-contact">
            <div className="shop-order-row">
              <dt>姓名</dt>
              <dd>{order.contact.name}</dd>
            </div>
            <div className="shop-order-row">
              <dt>Email</dt>
              <dd>{order.contact.email}</dd>
            </div>
            <div className="shop-order-row">
              <dt>手機</dt>
              <dd>{order.contact.phone}</dd>
            </div>
          </dl>
        )}
      </section>

      {readOnly ? <div className="shop-order-actions"><a href="/#reservations">我的訂單</a></div> : <section className="shop-order-section" aria-labelledby="shop-order-browser-heading">
        <h2 id="shop-order-browser-heading">這個瀏覽器</h2>
        <p>這個瀏覽器會記住你在自由工坊商店的訂單。用的是共用電腦的話，看完後請讓這個瀏覽器忘記訂單。</p>
        <div className="shop-order-actions">
          <button
            type="button"
            className="shop-button shop-button-secondary"
            ref={forgetTriggerRef}
            disabled={paymentControlsDisabled}
            onClick={openForgetDialog}
          >
            在這個瀏覽器忘記我的訂單
          </button>
        </div>
        {forgetError && <p role="alert" className="shop-order-alert">無法忘記訂單，請稍後重試。</p>}
        <dialog
          ref={dialogRef}
          className="shop-dialog"
          aria-labelledby="shop-forget-title"
          onCancel={event => {
            if (forgetting) event.preventDefault();
          }}
          onClose={() => {
            if (failedForgetCloseRef.current) {
              failedForgetCloseRef.current = false;
              return;
            }
            if (!forgottenTransitionRef.current) {
              forgetTriggerRef.current?.focus();
            }
          }}
        >
          <h2 id="shop-forget-title">要在這個瀏覽器忘記你的訂單嗎？</h2>
          <p>忘記後，這個瀏覽器就不能再打開你在任何自由工坊商店的訂單。這些商店目前不寄訂單信件；如果你下單時沒有登入會員，之後只能聯絡店家。</p>
          <div className="shop-order-actions">
            <button
              type="button"
              className="shop-button"
              disabled={forgetting}
              onClick={() => void confirmForget()}
            >
              忘記訂單
            </button>
            <button
              type="button"
              className="shop-button shop-button-secondary"
              disabled={forgetting}
              onClick={() => dialogRef.current?.close()}
            >
              取消
            </button>
          </div>
        </dialog>
      </section>}
    </>
  );
}

export function bootOrderPage() {
  const container = document.getElementById('shop-order');
  if (!container) return;
  const storeSlug = container.dataset.storeSlug ?? '';
  const storeName = container.dataset.storeName ?? '';
  const orderRef = container.dataset.orderRef ?? '';
  if (!STORE_SLUG_PATTERN.test(storeSlug) || !OPAQUE_ID_PATTERN.test(orderRef)) return;

  const initialAccess = consumeAccessHash();
  let accessToken: string | null = container.dataset.retainedOrder !== 'true' && initialAccess.kind === 'valid' ? initialAccess.token : null;
  const malformedAccessLink = container.dataset.retainedOrder !== 'true' && initialAccess.kind === 'malformed';

  const tokenBox: TokenBox = {
    read: () => accessToken,
    write: (next: string) => {
      accessToken = next;
    },
    clear: () => {
      accessToken = null;
    },
  };

  const emailEnabled = container.dataset.emailEnabled === 'true';

  createRoot(container).render(
    <OrderPage
      container={container}
      storeSlug={storeSlug}
      storeName={storeName}
      orderRef={orderRef}
      tokenBox={tokenBox}
      malformedAccessLink={malformedAccessLink}
      emailEnabled={emailEnabled}
    />,
  );
}
