import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import './fullscreen-game.css';

type Mode = 'normal' | 'native' | 'viewport';

/** Keep the game mounted while presentation changes, so a run is never reset. */
export type FullscreenGameHandle = { enter: (focusTarget?: HTMLElement | null, viewTarget?: HTMLElement | null) => void };

export const FullscreenGame = forwardRef<FullscreenGameHandle, { children: ReactNode; resultReady?: boolean; integrated?: boolean; market?: boolean }>(function FullscreenGame({ children, resultReady = false, integrated = false, market = false }, ref) {
  const container = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const button = useRef<HTMLButtonElement>(null);
  const entryFocus = useRef<HTMLElement | null>(null);
  const entryView = useRef<HTMLElement | null>(null);
  const autoAttempted = useRef(false);
  const [mode, setMode] = useState<Mode>('normal');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    mounted.current = true;
    const node = container.current;
    const sync = () => {
      if (document.fullscreenElement === container.current) setMode('native');
      else setMode(current => current === 'native' ? 'normal' : current);
    };
    document.addEventListener('fullscreenchange', sync);
    return () => {
      mounted.current = false;
      document.removeEventListener('fullscreenchange', sync);
      if (node && document.fullscreenElement === node) void document.exitFullscreen().catch(() => {});
    };
  }, []);

  useLayoutEffect(() => {
    if (mode !== 'normal') {
      const target = entryFocus.current, view = entryView.current; entryFocus.current = null; entryView.current = null;
      const active = document.activeElement;
      if (!mounted.current || (target && (!target.isConnected || active !== target || !container.current?.contains(target)))) return;
      // Native entry and viewport fallback settle after the game's start scroll.
      // A tall keyboard owner can extend beyond the viewport. Reveal its exact
      // live view only while both DOM owners remain connected and focus is unchanged.
      if (target && view?.isConnected && target.contains(view)) view.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      // A player may have started the game or reached its result while the
      // browser was still resolving fullscreen. Do not steal their focus.
      if (active instanceof HTMLElement && active !== button.current && container.current?.contains(active)) return;
      (target?.isConnected ? target : button.current)?.focus({ preventScroll: true });
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== 'viewport') return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [mode]);

  async function toggle() {
    const node = container.current;
    if (!node || pending) return;
    autoAttempted.current = true;
    if (mode === 'viewport') { setMode('normal'); setMessage(''); return; }
    if (mode === 'native') {
      setPending(true);
      try { await document.exitFullscreen(); }
      catch { if (mounted.current) setMessage('無法離開全螢幕，請使用瀏覽器的退出方式。'); }
      finally { if (mounted.current) setPending(false); }
      return;
    }
    setPending(true);
    try {
      if (!node.requestFullscreen || document.fullscreenEnabled === false) throw new Error('unsupported');
      // The request happens directly in the click handler, before any await.
      await node.requestFullscreen();
      if (mounted.current) setMessage('');
      else if (document.fullscreenElement === node) void document.exitFullscreen().catch(() => {});
    } catch {
      if (mounted.current) {
        setMode('viewport');
        setMessage('全視窗模式');
      }
    } finally { if (mounted.current) setPending(false); }
  }

  useImperativeHandle(ref, () => ({ enter: (focusTarget, viewTarget) => {
    // A cold deep link has no gesture; the visible button remains available.
    if (!autoAttempted.current && mode === 'normal' && !pending && (!navigator.userActivation || navigator.userActivation.isActive)) { entryFocus.current = focusTarget ?? null; entryView.current = viewTarget ?? focusTarget ?? null; void toggle(); }
  } }), [mode, pending]);

  function captureEscape(event: KeyboardEvent<HTMLDivElement>) {
    if (mode === 'normal' || event.key !== 'Escape') return;
    // The top-layer native modal owns its cancel key before presentation exit.
    if (container.current?.querySelector('dialog:modal')) return;
    // Exit explicitly before the game's Escape-to-pause handler sees the key.
    event.preventDefault(); event.stopPropagation();
    if (mode === 'viewport') { setMode('normal'); setMessage(''); }
    else if (document.fullscreenElement === container.current) {
      void document.exitFullscreen().catch(() => { if (mounted.current) setMessage('無法離開全螢幕，請使用瀏覽器的退出方式。'); });
    }
  }

  function showResultShare() {
    if (!resultReady) return;
    const panel = container.current?.querySelector<HTMLElement>('[data-game-share]');
    panel?.scrollIntoView({ block: 'start', behavior: 'instant' });
    panel?.focus({ preventScroll: true });
  }

  function keys(event: KeyboardEvent<HTMLDivElement>) {
    if (mode === 'normal') return;
    if (event.key !== 'Tab') return;
    const controls = Array.from(container.current?.querySelectorAll<HTMLElement>('a[href], summary, button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])
      .filter(element => element.getClientRects().length > 0 && !element.closest('[inert]'));
    if (!controls.length) return;
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  return <div ref={container} data-game-stage={market ? '' : undefined} className={`fullscreen-game${mode === 'viewport' ? ' fullscreen-game--viewport' : ''}${integrated ? ' fullscreen-game--integrated' : ''}${market ? ' fullscreen-game--market' : ''}`} role={mode === 'normal' ? undefined : 'dialog'} aria-modal={mode === 'normal' ? undefined : true} aria-label={mode === 'normal' ? undefined : '遊戲全螢幕'} onKeyDownCapture={captureEscape} onKeyDown={keys}>
    <div className="fullscreen-game__bar"><button ref={button} type="button" className="fullscreen-game__button" onClick={() => void toggle()} aria-disabled={pending} aria-label={mode === 'normal' ? '⛶ 全螢幕' : '退出全螢幕'} aria-pressed={mode !== 'normal'}>{market ? <span aria-hidden="true">{mode === 'normal' ? '⛶' : '↙'}</span> : mode === 'normal' ? '⛶ 全螢幕' : '退出全螢幕'}</button><button type="button" className="fullscreen-game__button" disabled={!resultReady} aria-label={resultReady ? '分享成果' : '完成後分享'} title={resultReady ? '分享這一局的真實成果' : '完成這一局後即可分享成果'} onClick={showResultShare}>{market ? <span aria-hidden="true">↗</span> : resultReady ? '分享成果' : '完成後分享'}</button><span role="status">{mode === 'viewport' ? '' : message}</span>{mode === 'viewport' && <details className="fullscreen-game__mode-help"><summary aria-label="全視窗說明">{market ? <span aria-hidden="true">ⓘ</span> : '全視窗說明'}</summary><p>此瀏覽器使用全視窗模式，瀏覽器工具列可能仍會顯示。</p></details>}</div>
    {children}
  </div>;
});
