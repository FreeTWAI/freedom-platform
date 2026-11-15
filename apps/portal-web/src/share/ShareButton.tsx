import {useEffect, useId, useMemo, useRef, useState, type MouseEvent} from 'react';
import {createPortal} from 'react-dom';
import type {PortalClient} from '../api';
import {useLanguage} from '../language';
import {useLocalAction} from '../useLocalAction';
import {shareQrUrlAllowed} from './share-qr-url';
import '../modules/SkillDiscovery.css';

export type PromotionKind =
  | 'platform'
  | 'social_post'
  | 'skill_book'
  | 'event'
  | 'member_service'
  | 'member_card'
  | 'share';

export type ShareLink = {path: string};

export function promotionLink(client: PortalClient, kind: PromotionKind, target: string): () => Promise<ShareLink> {
  return () => client.post<ShareLink>('/promotion/links', {kind, target});
}

export function isDialogBackdropClick(event: MouseEvent<HTMLDialogElement>) {
  if (event.target !== event.currentTarget) return false;
  const box = event.currentTarget.getBoundingClientRect?.();
  if (box && (box.width > 0 || box.height > 0) && event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom) return false;
  return true;
}

export function returnFocusToTrigger(trigger: HTMLButtonElement | null, preventScroll = false) {
  if (!trigger || trigger.parentNode === null || ('isConnected' in trigger && !trigger.isConnected) || trigger.disabled) return;
  // Responsive disclosures can close while the modal is open. Reveal the
  // original trigger before returning keyboard focus to it.
  for (let parent = trigger.parentElement; parent; parent = parent.parentElement) {
    if (typeof HTMLDetailsElement !== 'undefined' && parent instanceof HTMLDetailsElement) parent.open = true;
  }
  if (preventScroll) trigger.focus({preventScroll: true});
  else trigger.focus();
}

export function useShareControls({
  open,
  resetKey,
  title,
  fallbackUrl,
  text,
  introductions,
  linkPath,
  tracked,
  busy,
  disabled = false,
}: {
  open: boolean;
  resetKey?: unknown;
  title: string;
  fallbackUrl: string;
  text?: string;
  introductions?: readonly string[];
  linkPath: string | null;
  tracked: boolean;
  busy: boolean;
  disabled?: boolean;
}) {
  const [showQr, setShowQr] = useState(false);
  const [qrModule, setQrModule] = useState<{
    shareQr: (url: string, origin: string) => {url: string; size: number; path: string} | null;
  } | null>(null);
  const [qrError, setQrError] = useState(false);
  const [selectedIntro, setSelectedIntro] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const [manual, setManual] = useState(false);
  const manualField = useRef<HTMLTextAreaElement>(null);
  const generation = useRef(0);
  const {t} = useLanguage();

  useEffect(() => {
    generation.current++;
    setShowQr(false);
    setQrError(false);
    setSelectedIntro(null);
    setStatus('');
    setManual(false);
  }, [open, resetKey]);

  useEffect(() => () => {
    generation.current++;
  }, []);

  useEffect(() => {
    if (manual && open) {
      manualField.current?.focus();
      manualField.current?.select();
    }
  }, [manual, open]);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://freetwai.com';
  const url = useMemo(() => {
    if (busy) return '';
    const baseHref = tracked && linkPath
      ? new URL(linkPath, origin).href
      : new URL(fallbackUrl, origin).href;
    if (selectedIntro === null || !introductions?.length || selectedIntro >= introductions.length) return baseHref;
    const parsed = new URL(baseHref);
    parsed.searchParams.set('intro', String(selectedIntro + 1));
    return parsed.href;
  }, [busy, tracked, linkPath, origin, fallbackUrl, selectedIntro, introductions]);

  const effectiveText = selectedIntro !== null && introductions?.[selectedIntro]
    ? introductions[selectedIntro]
    : text;
  const copyText = effectiveText ? `${effectiveText}\n${url}` : url;
  const qrAllowed = useMemo(() => Boolean(url && shareQrUrlAllowed(url, origin)), [url, origin]);
  const qr = useMemo(() => (qrModule && url ? qrModule.shareQr(url, origin) : null), [qrModule, url, origin]);
  const qrLoading = showQr && qrAllowed && !qrModule && !qrError;
  const qrFailed = showQr && qrAllowed && (qrError || (qrModule !== null && !qr));

  useEffect(() => {
    if (!showQr) {
      setQrError(false);
      return;
    }
    if (!open || !qrAllowed || qrModule) return;
    let cancelled = false;
    setQrError(false);
    import('./share-qr')
      .then(mod => {
        if (cancelled) return;
        if (typeof mod?.shareQr !== 'function') {
          setQrError(true);
          return;
        }
        setQrModule({shareQr: mod.shareQr});
      })
      .catch(() => {
        if (!cancelled) setQrError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, showQr, qrAllowed, qrModule]);

  const action = useLocalAction([title, url, effectiveText, open, resetKey]);
  const hasNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const actionsDisabled = busy || disabled || !url || action.pending !== null;

  async function copy() {
    if (!open || busy || disabled || !url) return;
    const run = generation.current;
    const result = await action.run('copy', () => {
      setStatus('');
      setManual(false);
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
        return Promise.reject(new Error('clipboard_unavailable'));
      }
      return navigator.clipboard.writeText(copyText);
    });
    if (run !== generation.current) return;
    if (result.status === 'done') setStatus('已複製。');
    else if (result.status === 'failed') {
      setManual(true);
      setStatus('請手動複製下面的內容。');
    }
  }

  async function send() {
    if (!open || busy || disabled || !url) return;
    if (!hasNativeShare) {
      await copy();
      return;
    }
    const run = generation.current;
    const result = await action.run('share', () => {
      setStatus('');
      setManual(false);
      return navigator.share(effectiveText ? {title, text: effectiveText, url} : {title, url});
    });
    if (run !== generation.current) return;
    if (result.status === 'done') setStatus('已交給手機分享。');
    else if (result.status === 'failed' && (result.error as {name?: string} | null)?.name !== 'AbortError') {
      setManual(true);
      setStatus('請手動複製下面的內容。');
    }
  }

  async function shareTo(platform: 'LINE' | 'Telegram') {
    if (!open || busy || disabled || !url) return;
    const run = generation.current;
    const result = await action.run(platform, async () => {
      setStatus('');
      setManual(false);
      const endpoint = platform === 'LINE' ? 'https://social-plugins.line.me/lineit/share' : 'https://t.me/share/url';
      const destination = `${endpoint}?url=${encodeURIComponent(url)}&text=${encodeURIComponent(effectiveText || title)}`;
      // Open only inside this click, before awaiting; no SDK or prefetch.
      window.open(destination, '_blank', 'noopener,noreferrer');
    });
    if (run !== generation.current) return;
    if (result.status === 'done') setStatus(`請在 ${platform} 完成分享；若未開啟，可複製連結。`);
    else if (result.status === 'failed') {
      setManual(true);
      setStatus(`無法開啟 ${platform} 分享，請手動複製下面的內容。`);
    }
  }

  function resetUi() {
    generation.current++;
    setShowQr(false);
    setSelectedIntro(null);
    setStatus('');
    setManual(false);
  }

  return {
    effectiveText,
    url,
    tracked,
    busy,
    disabled,
    copyText,
    qr,
    qrAllowed,
    qrLoading,
    qrFailed,
    hasNativeShare,
    actionsDisabled,
    pending: action.pending,
    showQr,
    setShowQr,
    selectedIntro,
    selectIntro(idx: number) {
      setSelectedIntro(idx);
      setStatus('');
      setManual(false);
    },
    introductions,
    status,
    manual,
    manualField,
    copy,
    send,
    shareTo,
    resetUi,
    t,
  };
}

export type ShareControls = ReturnType<typeof useShareControls>;

export function SharePanel({
  id,
  controls,
  actionsClassName = 'skill-share-actions',
}: {
  id: string;
  controls: ShareControls;
  actionsClassName?: string;
}) {
  const {
    effectiveText,
    url,
    tracked,
    busy,
    disabled,
    copyText,
    qr,
    qrAllowed,
    qrLoading,
    qrFailed,
    hasNativeShare,
    actionsDisabled,
    pending,
    showQr,
    setShowQr,
    selectedIntro,
    selectIntro,
    introductions,
    status,
    manual,
    manualField,
    copy,
    send,
    shareTo,
    t,
  } = controls;

  return <>
    {effectiveText && <p className="skill-share-text">{effectiveText}</p>}
    <p className="skill-share-url">{busy ? '正在準備分享連結…' : url}</p>
    {!busy && <p className="share-credit-note">{tracked ? '有人點開，會記在你名下。' : '這是一般連結，不會記在你名下。'}</p>}
    <div className={actionsClassName}>
      {hasNativeShare ? <>
        <button type="button" className="btn btn-primary" aria-busy={pending === 'share'} disabled={actionsDisabled} onClick={() => void send()}>
          {pending === 'share' ? t('action.sharing') : '分享'}
        </button>
        <button type="button" className="btn btn-ghost" aria-busy={pending === 'copy'} disabled={actionsDisabled} onClick={() => void copy()}>
          {pending === 'copy' ? t('action.copying') : '複製連結'}
        </button>
      </> : (
        <button type="button" className="btn btn-primary" aria-busy={pending === 'copy'} disabled={actionsDisabled} onClick={() => void copy()}>
          {pending === 'copy' ? t('action.copying') : '複製連結'}
        </button>
      )}
      {qrAllowed && (
        <button type="button" className="btn btn-ghost" aria-expanded={showQr} disabled={busy || disabled} onClick={() => setShowQr(v => !v)}>
          QR 碼
        </button>
      )}
    </div>
    {qrLoading && <p role="status">產生 QR 中…</p>}
    {qrFailed && <p role="status">QR 暫時無法產生。</p>}
    {showQr && qrAllowed && qr && (
      <div className="share-qr-panel">
        <svg role="img" aria-label="分享連結的 QR Code" xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${qr.size} ${qr.size}`} width={qr.size * 4} height={qr.size * 4} shapeRendering="crispEdges">
          <rect width={qr.size} height={qr.size} fill="#fff" />
          <path d={qr.path} fill="#08090b" />
        </svg>
      </div>
    )}
    {introductions && introductions.length > 0 && (
      <details className="share-intros">
        <summary>換一句介紹</summary>
        <fieldset className="share-intro-list">
          <legend className="sr-only">選擇要一起分享的介紹</legend>
          {introductions.map((item, idx) => (
            <label key={`${idx}-${item.slice(0, 12)}`} className="share-intro-option">
              <input
                type="radio"
                disabled={pending !== null}
                name={`${id}-intro`}
                checked={selectedIntro === idx}
                onChange={() => selectIntro(idx)}
              />
              <span>{item}</span>
            </label>
          ))}
        </fieldset>
      </details>
    )}
    <details className="share-more">
      <summary>更多</summary>
      <div className="share-more-actions">
        {(['LINE', 'Telegram'] as const).map(platform => (
          <button
            key={platform}
            type="button"
            className="btn btn-ghost"
            aria-busy={pending === platform}
            disabled={actionsDisabled}
            title={`另開 ${platform} 分享視窗`}
            onClick={() => void shareTo(platform)}
          >
            {platform} 分享 ↗
          </button>
        ))}
      </div>
    </details>
    {status && <p className="skill-share-status" role="status">{status}</p>}
    {manual && (
      <div className="field">
        <label htmlFor={`${id}-manual`}>手動複製分享內容</label>
        <textarea
          ref={manualField}
          id={`${id}-manual`}
          value={copyText}
          readOnly
          rows={3}
          onFocus={event => event.currentTarget.select()}
        />
      </div>
    )}
  </>;
}

export function ShareButton({
  title,
  fallbackUrl,
  makeLink,
  text,
  introductions,
  label = '分享',
  buttonClassName = 'btn btn-ghost',
  disabled = false,
  onOpen,
  onClose,
}: {
  title: string;
  fallbackUrl: string;
  makeLink?: (() => Promise<ShareLink>) | null;
  text?: string;
  introductions?: readonly string[];
  label?: string;
  buttonClassName?: string;
  disabled?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [linkPath, setLinkPath] = useState<string | null>(null);
  const [tracked, setTracked] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const isOpenRef = useRef(false);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const controls = useShareControls({
    open,
    title,
    fallbackUrl,
    text,
    introductions,
    linkPath,
    tracked,
    busy,
    disabled,
  });

  function closeDialog(returnFocus: boolean) {
    generation.current++;
    if (!isOpenRef.current) return;
    isOpenRef.current = false;
    if (mounted.current) {
      setOpen(false);
      setLinkPath(null);
      setTracked(false);
      setBusy(false);
      controls.resetUi();
    }
    if (dialog.current?.open) dialog.current.close();
    onCloseRef.current?.();
    if (returnFocus && !disabledRef.current) returnFocusToTrigger(trigger.current);
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      closeDialog(false);
    };
  }, []);

  useEffect(() => {
    if (disabled && isOpenRef.current) closeDialog(false);
  }, [disabled]);

  useEffect(() => {
    if (isOpenRef.current) closeDialog(!disabledRef.current);
  }, [fallbackUrl, title, text]);

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open && dialog.current?.open) dialog.current?.close();
  }, [open]);

  async function load(run: number, create: () => Promise<ShareLink>) {
    try {
      const result = await create();
      if (run !== generation.current) return;
      if (result?.path) {
        setLinkPath(result.path);
        setTracked(true);
      } else {
        setLinkPath(null);
        setTracked(false);
      }
    } catch {
      if (run !== generation.current) return;
      setLinkPath(null);
      setTracked(false);
    } finally {
      if (run === generation.current) setBusy(false);
    }
  }

  function openDialog() {
    if (disabled) return;
    const run = ++generation.current;
    isOpenRef.current = true;
    setOpen(true);
    setLinkPath(null);
    setTracked(false);
    controls.resetUi();
    onOpen?.();
    if (makeLink) {
      setBusy(true);
      void load(run, makeLink);
    } else {
      setBusy(false);
    }
  }

  return <div className="skill-share promotion-share">
    <button ref={trigger} type="button" className={buttonClassName} aria-haspopup="dialog" disabled={disabled || undefined} onClick={disabled ? undefined : openDialog}>{label}</button>
    {open && createPortal(
      <dialog
        ref={dialog}
        className="skill-share-dialog promotion-share-dialog"
        aria-labelledby={`${id}-title`}
        onClick={event => {
          if (!isDialogBackdropClick(event)) return;
          event.stopPropagation();
          closeDialog(true);
        }}
        onCancel={event => {
          event.stopPropagation();
          event.preventDefault();
          closeDialog(true);
        }}
        onClose={event => {
          event.stopPropagation();
          closeDialog(true);
        }}
      >
        <div className="skill-share-preview">
          <header className="skill-share-head">
            <h2 id={`${id}-title`}>分享「{title}」</h2>
            <button type="button" className="btn btn-ghost" onClick={() => closeDialog(true)} aria-label="關閉分享">關閉</button>
          </header>
          <SharePanel id={id} controls={controls} />
        </div>
      </dialog>,
      document.body,
    )}
  </div>;
}
