import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PublicOrder } from '../../../../contracts/guild-launchpad/v1/hosted-checkout.js';
import { formatMinor } from '../../../../modules/agent-commerce/hosted/format.js';
import { STORE_SLUG_PATTERN } from './cart-store.js';
import { formatOrderLifecycle, formatRetryAfterTaipeiTime, formatTaipeiDateTime, formatTaipeiTime } from './format.js';
import { MeetupCard } from './meetup-card.js';
import {
  ERROR_COPY,
  OPAQUE_ID_PATTERN,
  fetchPublicOrder,
  postForgetBrowser,
  queryPayment,
  startPayment,
  type ErrorKind,
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
const PAYMENT_RETURN_POLL_INTERVAL_MS = 5000;
const PAYMENT_RETURN_MAX_POLLS = 24;

type ReturnLoadState = 'loading' | 'order' | 'no_access' | 'error';

function paymentReturnHeading(loadState: ReturnLoadState, view: PaymentView | null): string {
  if (loadState === 'no_access') return '無法在這個瀏覽器查看付款結果';
  if (loadState !== 'order' || !view) return '付款結果確認中';
  switch (view) {
    case 'paid':
      return '已收到付款';
    case 'refunded':
      return '已退款';
    case 'review':
      return '付款金額待店家確認';
    case 'checking':
    case 'awaiting':
      return '付款結果確認中';
    case 'failed':
      return '付款未完成';
    case 'ready':
      return '尚未付款';
    case 'expired':
      return '付款期限已過';
    case 'closed':
      return '訂單已取消';
  }
}

interface PaymentReturnPageProps {
  container: HTMLElement;
  storeSlug: string;
  storeName: string;
  orderRef: string;
}

function PaymentReturnPage({ container, storeSlug, storeName, orderRef }: PaymentReturnPageProps) {
  const [loadState, setLoadState] = useState<ReturnLoadState>('loading');
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [loadErrorKind, setLoadErrorKind] = useState<ErrorKind | null>(null);
  const [pollingDone, setPollingDone] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(true);
  const [paymentBusy, setPaymentBusy] = useState<boolean>(false);
  const [redirecting, setRedirecting] = useState<boolean>(false);
  const [pendingHidePayButtons, setPendingHidePayButtons] = useState<boolean>(false);
  const [startRateLimited, setStartRateLimited] = useState<boolean>(false);
  const [queryDisabled, setQueryDisabled] = useState<boolean>(false);
  const [paymentAlert, setPaymentAlert] = useState<PaymentAlertState>(null);
  const [statusAnnouncement, setStatusAnnouncement] = useState<{ text: string; visible: boolean }>({
    text: '',
    visible: false,
  });
  const [focusHeadingTrigger, setFocusHeadingTrigger] = useState<number>(0);

  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const unmountedRef = useRef<boolean>(false);
  const initialLoadedRef = useRef<boolean>(false);
  const lastViewKeyRef = useRef<string | null>(null);
  const pollCountRef = useRef<number>(0);
  const pollTimerRef = useRef<number | null>(null);
  const pollingActiveRef = useRef<boolean>(false);
  const requestInFlightRef = useRef<boolean>(false);
  const redirectingRef = useRef<boolean>(false);
  const pendingHideTimerRef = useRef<number | null>(null);
  const startRateLimitTimerRef = useRef<number | null>(null);
  const queryDisableTimerRef = useRef<number | null>(null);

  const anyBusy = busy || paymentBusy;
  const activeSlug = order?.store.slug ?? storeSlug;
  const activeStoreName = order?.store.name ?? storeName;

  useEffect(() => {
    container.setAttribute('aria-busy', anyBusy ? 'true' : 'false');
  }, [container, anyBusy]);

  useEffect(() => {
    document.title = `付款結果｜${activeStoreName}｜自由工坊`;
  }, [activeStoreName]);

  useEffect(() => {
    if (focusHeadingTrigger > 0) {
      headingRef.current?.focus();
    }
  }, [focusHeadingTrigger, loadState, order, pollingDone]);

  function clearPollTimer() {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

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

  function clearQueryDisableTimer() {
    if (queryDisableTimerRef.current !== null) {
      window.clearTimeout(queryDisableTimerRef.current);
      queryDisableTimerRef.current = null;
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

  function armQueryDisableTimer(seconds: number) {
    clearQueryDisableTimer();
    setQueryDisabled(true);
    queryDisableTimerRef.current = window.setTimeout(() => {
      queryDisableTimerRef.current = null;
      setQueryDisabled(false);
    }, seconds * 1000);
  }

  function applyViewTransition(
    nextLoadState: ReturnLoadState,
    nextView: PaymentView | null,
    source: 'initial' | 'poll' | 'buyer',
  ) {
    const nextKey = nextLoadState === 'order' && nextView ? `order:${nextView}` : nextLoadState;
    if (!initialLoadedRef.current) {
      initialLoadedRef.current = true;
      lastViewKeyRef.current = nextKey;
      return;
    }
    if (lastViewKeyRef.current !== nextKey) {
      lastViewKeyRef.current = nextKey;
      const nextH1 = paymentReturnHeading(nextLoadState, nextView);
      setStatusAnnouncement({ text: nextH1, visible: false });
      if (source === 'buyer') {
        setFocusHeadingTrigger(count => count + 1);
      }
    }
  }

  function scheduleNextPoll() {
    clearPollTimer();
    if (unmountedRef.current || !pollingActiveRef.current) return;
    if (pollCountRef.current >= PAYMENT_RETURN_MAX_POLLS) {
      pollingActiveRef.current = false;
      setPollingDone(true);
      return;
    }
    pollTimerRef.current = window.setTimeout(() => {
      pollTimerRef.current = null;
      void runPoll();
    }, PAYMENT_RETURN_POLL_INTERVAL_MS);
  }

  async function runPoll() {
    if (unmountedRef.current || !pollingActiveRef.current) return;
    if (requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    setBusy(true);
    pollCountRef.current += 1;

    const result = await fetchPublicOrder(storeSlug, orderRef);
    if (unmountedRef.current) return;
    requestInFlightRef.current = false;
    setBusy(false);
    if (!pollingActiveRef.current) return;

    if (result.kind === 'ok') {
      const nextView = paymentView(result.order);
      setOrder(result.order);
      setLoadState('order');
      setLoadErrorKind(null);
      applyViewTransition('order', nextView, 'poll');
      if (nextView !== 'checking' && nextView !== 'awaiting') {
        pollingActiveRef.current = false;
        clearPollTimer();
        return;
      }
    } else if (result.kind === 'not_found') {
      pollingActiveRef.current = false;
      clearPollTimer();
      setOrder(null);
      setLoadErrorKind(null);
      setLoadState('no_access');
      applyViewTransition('no_access', null, 'poll');
      return;
    }

    if (pollCountRef.current >= PAYMENT_RETURN_MAX_POLLS) {
      pollingActiveRef.current = false;
      setPollingDone(true);
      return;
    }
    scheduleNextPoll();
  }

  async function runInitialOrRetryLoad(source: 'initial' | 'buyer') {
    if (requestInFlightRef.current) return;
    clearPollTimer();
    pollingActiveRef.current = false;
    requestInFlightRef.current = true;
    setBusy(true);

    const result = await fetchPublicOrder(storeSlug, orderRef);
    if (unmountedRef.current) return;
    requestInFlightRef.current = false;
    setBusy(false);

    if (result.kind === 'ok') {
      const nextView = paymentView(result.order);
      setOrder(result.order);
      setLoadErrorKind(null);
      setLoadState('order');
      applyViewTransition('order', nextView, source);
      if (nextView === 'checking' || nextView === 'awaiting') {
        pollCountRef.current = 0;
        pollingActiveRef.current = true;
        setPollingDone(false);
        scheduleNextPoll();
      } else {
        pollingActiveRef.current = false;
        setPollingDone(false);
      }
      return;
    }

    if (result.kind === 'not_found') {
      setOrder(null);
      setLoadErrorKind(null);
      setPaymentAlert(null);
      setLoadState('no_access');
      applyViewTransition('no_access', null, source);
      return;
    }

    setLoadErrorKind(result.kind);
    setLoadState('error');
    if (!initialLoadedRef.current) {
      initialLoadedRef.current = true;
      lastViewKeyRef.current = 'error';
    }
  }

  async function reReadOrderAfterAction(): Promise<void> {
    const result = await fetchPublicOrder(storeSlug, orderRef);
    if (unmountedRef.current) return;
    if (result.kind === 'ok') {
      const nextView = paymentView(result.order);
      setOrder(result.order);
      setLoadErrorKind(null);
      setLoadState('order');
      applyViewTransition('order', nextView, 'buyer');
      return;
    }
    if (result.kind === 'not_found') {
      pollingActiveRef.current = false;
      clearPollTimer();
      setOrder(null);
      setLoadErrorKind(null);
      setPaymentAlert(null);
      setLoadState('no_access');
      applyViewTransition('no_access', null, 'buyer');
    }
  }

  async function handleStartPayment() {
    if (requestInFlightRef.current || busy || paymentBusy || redirectingRef.current || startRateLimited) return;
    clearPollTimer();
    pollingActiveRef.current = false;
    requestInFlightRef.current = true;
    setPaymentBusy(true);
    const outcome = await startPayment(activeSlug, orderRef);
    if (unmountedRef.current) return;

    if (outcome.kind === 'redirect') {
      setPaymentAlert(null);
      redirectingRef.current = true;
      setRedirecting(true);
      requestInFlightRef.current = false;
      setPaymentBusy(false);
      window.location.assign(outcome.handoffUrl);
      return;
    }

    if (outcome.kind === 'pending') {
      setPaymentAlert({ section: 'action', kind: 'text', text: PAYMENT_OUTCOME_COPY.pending });
      armPendingHideTimer(outcome.retryAfterSeconds);
      await reReadOrderAfterAction();
      requestInFlightRef.current = false;
      setPaymentBusy(false);
      return;
    }

    if (outcome.kind === 'refused') {
      if (outcome.code === 'checkout_hold_expired') {
        setPaymentAlert({ section: 'action', kind: 'hold_expired', storeSlug: activeSlug });
      } else {
        setPaymentAlert({ section: 'action', kind: 'text', text: PAYMENT_REFUSED_COPY[outcome.code] });
      }
      await reReadOrderAfterAction();
      requestInFlightRef.current = false;
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
      requestInFlightRef.current = false;
      setPaymentBusy(false);
      return;
    }

    if (outcome.kind === 'paused') {
      setPaymentAlert({ section: 'action', kind: 'text', text: PAYMENT_OUTCOME_COPY.paused });
      requestInFlightRef.current = false;
      setPaymentBusy(false);
      return;
    }

    if (outcome.kind === 'payment_unavailable') {
      setPaymentAlert({ section: 'action', kind: 'text', text: PAYMENT_OUTCOME_COPY.payment_unavailable });
      requestInFlightRef.current = false;
      setPaymentBusy(false);
      return;
    }

    if (outcome.kind === 'not_found') {
      setPaymentAlert(null);
      await reReadOrderAfterAction();
      requestInFlightRef.current = false;
      setPaymentBusy(false);
      return;
    }

    setPaymentAlert({ section: 'action', kind: 'text', text: PAYMENT_OUTCOME_COPY.failed });
    requestInFlightRef.current = false;
    setPaymentBusy(false);
  }

  async function handleManualQuery() {
    if (requestInFlightRef.current || busy || paymentBusy || redirectingRef.current || queryDisabled) return;
    clearPollTimer();
    pollingActiveRef.current = false;
    requestInFlightRef.current = true;
    setPaymentBusy(true);
    const outcome = await queryPayment(activeSlug, orderRef);
    if (unmountedRef.current) return;

    if (outcome.kind === 'ok') {
      const nextView = paymentView(outcome.order);
      setOrder(outcome.order);
      setLoadErrorKind(null);
      setLoadState('order');
      setPaymentAlert(null);
      if (nextView === 'checking' || nextView === 'awaiting') {
        lastViewKeyRef.current = `order:${nextView}`;
        setStatusAnnouncement({
          text: `${formatTaipeiTime(Date.now())} 已查詢，仍在確認中。`,
          visible: true,
        });
      } else {
        applyViewTransition('order', nextView, 'buyer');
      }
      requestInFlightRef.current = false;
      setPaymentBusy(false);
      return;
    }

    setStatusAnnouncement(prev => (prev.visible ? { text: '', visible: false } : prev));

    if (outcome.kind === 'pending') {
      setPaymentAlert({ section: 'payment', kind: 'text', text: PAYMENT_OUTCOME_COPY.pending });
      armQueryDisableTimer(outcome.retryAfterSeconds);
      requestInFlightRef.current = false;
      setPaymentBusy(false);
      return;
    }

    if (outcome.kind === 'refused') {
      setPaymentAlert({ section: 'payment', kind: 'text', text: PAYMENT_REFUSED_COPY[outcome.code] });
      await reReadOrderAfterAction();
      requestInFlightRef.current = false;
      setPaymentBusy(false);
      return;
    }

    if (outcome.kind === 'rate_limited') {
      const retryTime = formatRetryAfterTaipeiTime(outcome.retryAfterSeconds);
      setPaymentAlert({
        section: 'payment',
        kind: 'text',
        text: `操作太頻繁，請在 ${retryTime} 後再試。`,
      });
      armQueryDisableTimer(outcome.retryAfterSeconds);
      requestInFlightRef.current = false;
      setPaymentBusy(false);
      return;
    }

    if (outcome.kind === 'paused') {
      setPaymentAlert({ section: 'payment', kind: 'text', text: PAYMENT_OUTCOME_COPY.paused });
      requestInFlightRef.current = false;
      setPaymentBusy(false);
      return;
    }

    if (outcome.kind === 'payment_unavailable') {
      setPaymentAlert({ section: 'payment', kind: 'text', text: PAYMENT_OUTCOME_COPY.payment_unavailable });
      requestInFlightRef.current = false;
      setPaymentBusy(false);
      return;
    }

    if (outcome.kind === 'not_found') {
      setPaymentAlert(null);
      await reReadOrderAfterAction();
      requestInFlightRef.current = false;
      setPaymentBusy(false);
      return;
    }

    setPaymentAlert({ section: 'payment', kind: 'text', text: PAYMENT_OUTCOME_COPY.failed });
    requestInFlightRef.current = false;
    setPaymentBusy(false);
  }

  useEffect(() => {
    unmountedRef.current = false;
    void runInitialOrRetryLoad('initial');
    function handlePageShow(event: PageTransitionEvent) {
      if (!event.persisted && !redirectingRef.current) return;
      redirectingRef.current = false;
      requestInFlightRef.current = false;
      setRedirecting(false);
      setPaymentBusy(false);
      clearStartRateLimitTimer();
      clearQueryDisableTimer();
      setStartRateLimited(false);
      setQueryDisabled(false);
      void runInitialOrRetryLoad('initial');
    }
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      unmountedRef.current = true;
      pollingActiveRef.current = false;
      window.removeEventListener('pageshow', handlePageShow);
      clearPollTimer();
      clearPendingHideTimer();
      clearStartRateLimitTimer();
      clearQueryDisableTimer();
    };
  }, []);

  if (loadState === 'loading') {
    return (
      <>
        <h1 id="shop-pay-return-title" ref={headingRef} tabIndex={-1}>付款結果確認中</h1>
        <p role="status">正在向付款服務確認結果…</p>
      </>
    );
  }

  if (loadState === 'error') {
    return (
      <>
        <h1 id="shop-pay-return-title" ref={headingRef} tabIndex={-1}>付款結果確認中</h1>
        <p role="status" className="shop-sr-only">{statusAnnouncement.text}</p>
        {loadErrorKind && <p role="alert" className="shop-order-alert">{ERROR_COPY[loadErrorKind]}</p>}
        <div className="shop-order-actions">
          <button
            type="button"
            className="shop-button shop-button-secondary"
            disabled={anyBusy}
            onClick={() => void runInitialOrRetryLoad('buyer')}
          >
            重試
          </button>
        </div>
      </>
    );
  }

  if (loadState === 'no_access' || !order) {
    return (
      <>
        <h1 id="shop-pay-return-title" ref={headingRef} tabIndex={-1}>無法在這個瀏覽器查看付款結果</h1>
        <p role="status" className="shop-sr-only">{statusAnnouncement.text}</p>
        <p>這個瀏覽器沒有這筆訂單的查看權限。訂單只能在下單時使用的瀏覽器，或以下單時登入的會員帳號查看。</p>
        <div className="shop-order-actions">
          <a href={`/shops/${activeSlug}/order-access`}>找回訂單</a>
          <a href={`/shops/${activeSlug}`}>回到「{activeStoreName}」</a>
        </div>
      </>
    );
  }

  const currentPayView = paymentView(order);
  const headingText = paymentReturnHeading('order', currentPayView);
  const orderHref = `/shops/${activeSlug}/orders/${order.order_ref}`;
  const paymentControlsDisabled = anyBusy || redirecting;

  let bodyText = '';
  switch (currentPayView) {
    case 'paid':
      bodyText = `訂單 ${order.display_number} 的後續進度會顯示在訂單頁。`;
      break;
    case 'refunded':
      bodyText = orderPaymentSectionCopy('refunded').description!;
      break;
    case 'review':
      bodyText = '我們收到的付款和這筆訂單不符，店家會確認並處理退款。請不要再付款。';
      break;
    case 'checking':
    case 'awaiting':
      bodyText = pollingDone
        ? '目前還沒有確認結果。你可以重新查詢，或稍後到訂單頁查看；請不要重複付款。'
        : '已回到商店，正在向付款服務確認結果，請不要重複付款。';
      break;
    case 'failed':
      bodyText = '這次付款沒有完成，沒有扣款。';
      break;
    case 'ready':
      bodyText = `請在 ${formatTaipeiDateTime(order.pay_by)} 前完成付款，逾時保留的商品會釋出。`;
      break;
    case 'expired':
      bodyText = '保留的商品已釋出。';
      break;
    case 'closed':
      bodyText = '這筆訂單已取消，不能再付款。';
      break;
  }

  return (
    <>
      <h1 id="shop-pay-return-title" ref={headingRef} tabIndex={-1}>{headingText}</h1>
      <p className="shop-pay-return-order">訂單 {order.display_number}</p>
      <p>{bodyText}</p>
      <p role="status" className={statusAnnouncement.visible ? 'shop-pay-status' : 'shop-sr-only'}>
        {statusAnnouncement.text}
      </p>
      {paymentAlert && renderPaymentAlert(paymentAlert)}
      <div className="shop-order-actions">
        {currentPayView === 'paid' && (
          <a className="shop-button shop-pay-primary" href={orderHref}>
            查看訂單
          </a>
        )}
        {(currentPayView === 'review' || currentPayView === 'refunded') && <a href={orderHref}>查看訂單</a>}
        {(currentPayView === 'checking' || currentPayView === 'awaiting') && !pollingDone && (
          <a href={orderHref}>查看訂單</a>
        )}
        {(currentPayView === 'checking' || currentPayView === 'awaiting') && pollingDone && (
          <>
            <button
              type="button"
              className="shop-button shop-button-secondary"
              disabled={paymentControlsDisabled || queryDisabled}
              onClick={() => void handleManualQuery()}
            >
              重新查詢
            </button>
            <a href={orderHref}>稍後再看</a>
          </>
        )}
        {currentPayView === 'failed' && (
          <>
            {order.can_resume_payment && !pendingHidePayButtons && (
              <button
                type="button"
                className="shop-button shop-pay-primary"
                disabled={paymentControlsDisabled || startRateLimited}
                onClick={() => void handleStartPayment()}
              >
                {redirecting ? '正在前往付款…' : '重新付款'}
              </button>
            )}
            <a href={orderHref}>查看訂單</a>
          </>
        )}
        {currentPayView === 'ready' && (
          <>
            {order.can_resume_payment && !pendingHidePayButtons && (
              <button
                type="button"
                className="shop-button shop-pay-primary"
                disabled={paymentControlsDisabled || startRateLimited}
                onClick={() => void handleStartPayment()}
              >
                {redirecting ? '正在前往付款…' : '前往付款'}
              </button>
            )}
            <a href={orderHref}>查看訂單</a>
          </>
        )}
        {currentPayView === 'expired' && (
          <>
            <a href={`/shops/${activeSlug}`}>回到「{activeStoreName}」</a>
            <a href={orderHref}>查看訂單</a>
          </>
        )}
        {currentPayView === 'closed' && <a href={orderHref}>查看訂單</a>}
      </div>
    </>
  );
}

export function bootPaymentReturnPage() {
  const container = document.getElementById('shop-pay-return');
  if (!container) return;
  const storeSlug = container.dataset.storeSlug ?? '';
  const storeName = container.dataset.storeName ?? '';
  const orderRef = container.dataset.orderRef ?? '';
  const attemptRef = container.dataset.attemptRef ?? '';
  if (
    !STORE_SLUG_PATTERN.test(storeSlug) ||
    !OPAQUE_ID_PATTERN.test(orderRef) ||
    !OPAQUE_ID_PATTERN.test(attemptRef)
  ) {
    return;
  }

  createRoot(container).render(
    <PaymentReturnPage
      container={container}
      storeSlug={storeSlug}
      storeName={storeName}
      orderRef={orderRef}
    />,
  );
}
