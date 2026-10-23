import {useEffect, useRef, useState} from 'react';
import {canonicalPath, parseRoute} from './routes.js';

const positions = new Map<string,number>();
export function useRoute() {
  const [route, setRoute] = useState(() => canonicalPath(window.location.href));
  const [revision, setRevision] = useState(0);
  const current = useRef(route);
  const navigateRef = useRef<((href:string,replace?:boolean)=>void)|null>(null);
  useEffect(() => {
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    const sync = () => {
      positions.set(current.current, window.scrollY);
      const next = canonicalPath(window.location.href);
      if (next !== location.pathname + location.search + location.hash) history.replaceState(null, '', next);
      current.current = next;
      setRoute(next);
      setRevision(n => n + 1);
    };
    const navigate = (href:string, replace = false) => {
      const url = new URL(href, window.location.href);
      if (url.origin !== location.origin || parseRoute(url.pathname).page === 'not-found') return;
      const next = canonicalPath(url.href);
      if (next !== current.current) history[replace ? 'replaceState' : 'pushState'](null, '', next);
      sync();
    };
    const click = (event:MouseEvent) => {
      const link = (event.target as Element|null)?.closest<HTMLAnchorElement>('a[href]');
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
      const url = new URL(link.href);
      if (url.origin !== location.origin || parseRoute(url.pathname).page === 'not-found') return;
      event.preventDefault();
      navigate(url.href);
    };
    navigateRef.current = navigate;
    sync();
    document.addEventListener('click', click);
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      document.removeEventListener('click', click);
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
      window.history.scrollRestoration = previousScrollRestoration;
      navigateRef.current = null;
    };
  }, []);
  return {route, revision, positions, navigate: (...args:[string,boolean?]) => navigateRef.current?.(...args)};
}
