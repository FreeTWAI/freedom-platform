import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import './fullscreen-game.css';

type Mode = 'normal' | 'native' | 'viewport';

/** Keep the game mounted while presentation changes, so a run is never reset. */
export type FullscreenGameHandle = { enter: (focusTarget?: HTMLElement | null) => void };

export const FullscreenGame = forwardRef<FullscreenGameHandle, { children: ReactNode }>(function FullscreenGame({ children }, ref) {
  const container = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const button = useRef<HTMLButtonElement>(null);
  const entryFocus = useRef<HTMLElement | null>(null);
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
      const target = entryFocus.current; entryFocus.current = null;
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
        setMessage('此瀏覽器使用全視窗模式，瀏覽器工具列可能仍會顯示。');
      }
    } finally { if (mounted.current) setPending(false); }
  }

  useImperativeHandle(ref, () => ({ enter: (focusTarget) => {
    // A cold deep link has no gesture; the visible button remains available.
    if (mode === 'normal' && !pending && (!navigator.userActivation || navigator.userActivation.isActive)) { entryFocus.current = focusTarget ?? null; void toggle(); }
  } }), [mode, pending]);

  function captureEscape(event: KeyboardEvent<HTMLDivElement>) {
    if (mode === 'normal' || event.key !== 'Escape') return;
    // Exit explicitly before the game's Escape-to-pause handler sees the key.
    event.preventDefault(); event.stopPropagation();
    if (mode === 'viewport') { setMode('normal'); setMessage(''); }
    else if (document.fullscreenElement === container.current) {
      void document.exitFullscreen().catch(() => { if (mounted.current) setMessage('無法離開全螢幕，請使用瀏覽器的退出方式。'); });
    }
  }

  function keys(event: KeyboardEvent<HTMLDivElement>) {
    if (mode === 'normal') return;
    if (event.key !== 'Tab') return;
    const controls = Array.from(container.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])
      .filter(element => element.getClientRects().length > 0 && !element.closest('[inert]'));
    if (!controls.length) return;
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  return <div ref={container} className={`fullscreen-game${mode === 'viewport' ? ' fullscreen-game--viewport' : ''}`} role={mode === 'normal' ? undefined : 'dialog'} aria-modal={mode === 'normal' ? undefined : true} aria-label={mode === 'normal' ? undefined : '遊戲全螢幕'} onKeyDownCapture={captureEscape} onKeyDown={keys}>
    <div className="fullscreen-game__bar"><button ref={button} type="button" className="fullscreen-game__button" onClick={() => void toggle()} aria-disabled={pending} aria-pressed={mode !== 'normal'}>{mode === 'normal' ? '⛶ 全螢幕' : '退出全螢幕'}</button><span role="status">{message}</span></div>
    {children}
  </div>;
});
