import {useEffect, useId, useMemo, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import type {PortalClient} from '../api';
import {useLanguage} from '../language';
import {useLocalAction} from '../useLocalAction';
import {shareQr} from './share-qr';
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

export function ShareButton({
  title,
  fallbackUrl,
  makeLink,
  text,
  introductions,
  label = '分享',
  buttonClassName = 'btn btn-ghost',
  disabled = false,
  preserveShell = false,
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
  preserveShell?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [linkPath, setLinkPath] = useState<string | null>(null);
  const [tracked, setTracked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [selectedIntro, setSelectedIntro] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const [manual, setManual] = useState(false);
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const manualField = useRef<HTMLTextAreaElement>(null);
  const generation = useRef(0);
  const {t} = useLanguage();

  useEffect(() => () => {
    generation.current++;
    onClose?.();
  }, []);

  useEffect(() => {
    if (disabled && open) {
      generation.current++;
      setOpen(false);
      setLinkPath(null);
      setTracked(false);
      setBusy(false);
      dialog.current?.close();
      onClose?.();
    }
  }, [disabled, open]);

  useEffect(() => {
    if (open) {
      generation.current++;
      setOpen(false);
      setLinkPath(null);
      setTracked(false);
      setBusy(false);
      setStatus('');
      setManual(false);
      setShowQr(false);
      dialog.current?.close();
      onClose?.();
    }
  }, [fallbackUrl]);

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open && dialog.current?.open) dialog.current?.close();
  }, [open]);

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
  const qr = useMemo(() => (url ? shareQr(url, origin) : null), [url, origin]);
  const action = useLocalAction([title, url, effectiveText, open]);
  const hasNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  function close() {
    generation.current++;
    setOpen(false);
    setStatus('');
    setManual(false);
    setShowQr(false);
    dialog.current?.close();
    onClose?.();
    // Responsive disclosures can close while the modal is open. Reveal the
    // original trigger before returning keyboard focus to it.
    for (let parent = trigger.current?.parentElement; parent; parent = parent.parentElement) {
      if (typeof HTMLDetailsElement !== 'undefined' && parent instanceof HTMLDetailsElement) parent.open = true;
    }
    trigger.current?.focus();
  }

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
    setOpen(true);
    setLinkPath(null);
    setTracked(false);
    setShowQr(false);
    setSelectedIntro(null);
    setStatus('');
    setManual(false);
    onOpen?.();
    if (makeLink) {
      setBusy(true);
      void load(run, makeLink);
    } else {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
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
    if (!url) return;
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
    if (!open || busy || !url) return;
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

  return <div className="skill-share promotion-share">
    <button ref={trigger} type="button" className={buttonClassName} aria-haspopup="dialog" disabled={disabled || undefined} onClick={disabled ? undefined : openDialog}>{label}</button>
    {(open || preserveShell) && createPortal(
      <dialog
        ref={dialog}
        className="skill-share-dialog promotion-share-dialog"
        aria-labelledby={`${id}-title`}
        onCancel={event => {
          event.stopPropagation();
          event.preventDefault();
          close();
        }}
        onClose={event => {
          event.stopPropagation();
          generation.current++;
          setOpen(false);
          onClose?.();
        }}
      >
        <div className="skill-share-preview">
          <header className="skill-share-head">
            <h2 id={`${id}-title`}>分享「{title}」</h2>
            <button type="button" className="btn btn-ghost" onClick={close} aria-label="關閉分享">關閉</button>
          </header>
          {effectiveText && <p className="skill-share-text">{effectiveText}</p>}
          <p className="skill-share-url">{busy ? '正在準備分享連結…' : url}</p>
          {!busy && <p className="share-credit-note">{tracked ? '有人點開，會記在你名下。' : '這是一般連結，不會記在你名下。'}</p>}
          <div className="skill-share-actions">
            {hasNativeShare ? <>
              <button type="button" className="btn btn-primary" aria-busy={action.pending === 'share'} disabled={busy || !url || action.pending !== null} onClick={() => void send()}>
                {action.pending === 'share' ? t('action.sharing') : '分享'}
              </button>
              <button type="button" className="btn btn-ghost" aria-busy={action.pending === 'copy'} disabled={busy || !url || action.pending !== null} onClick={() => void copy()}>
                {action.pending === 'copy' ? t('action.copying') : '複製連結'}
              </button>
            </> : (
              <button type="button" className="btn btn-primary" aria-busy={action.pending === 'copy'} disabled={busy || !url || action.pending !== null} onClick={() => void copy()}>
                {action.pending === 'copy' ? t('action.copying') : '複製連結'}
              </button>
            )}
            {qr && (
              <button type="button" className="btn btn-ghost" aria-expanded={showQr} disabled={busy} onClick={() => setShowQr(v => !v)}>
                QR 碼
              </button>
            )}
          </div>
          {showQr && qr && (
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
                      disabled={action.pending !== null}
                      name={`${id}-intro`}
                      checked={selectedIntro === idx}
                      onChange={() => {
                        setSelectedIntro(idx);
                        setStatus('');
                        setManual(false);
                      }}
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
                  aria-busy={action.pending === platform}
                  disabled={busy || !url || action.pending !== null}
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
        </div>
      </dialog>,
      document.body,
    )}
  </div>;
}
