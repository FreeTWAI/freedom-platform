import {useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {formatIsoLocal} from '../format';
import {SHORT_VIDEO_EMBED_ORIGIN, playableShortVideos, playerCommand, shortVideoEmbedUrl, type PlayerCommand, type ShortVideoSource} from './short-video-embed';
import './ShortVideoFeed.css';

export type ShortVideoPost = ShortVideoSource & {title: string; thumbnail_url: string | null; author: {display_name: string}; created_at: string; like_count?: number; comment_count?: number; liked?: boolean};

/** Current post ids from a fresh server response, or null when the list could not be confirmed. */
export type ShortRefreshResult = readonly string[] | null;

/**
 * Vertical, swipe-up feed of YouTube links members shared. The slide on screen and its two neighbours hold a
 * player, so the next video is already loaded when it arrives; only the one on screen plays, and only while
 * the viewer has not paused it, the tab is visible and the list has been confirmed current.
 */
export function ShortVideoFeed({posts, hasMore, loadingMore, onLoadMore, onRefresh, onManage, onLike, onComment, likeBusy, likeRetry, renderShare}: {
  posts: readonly ShortVideoPost[]; hasMore: boolean; loadingMore: boolean; onLoadMore: () => void;
  /** Re-reads the list; resolves with the current ids, or null when the request failed. */
  onRefresh: () => Promise<ShortRefreshResult>;
  /** Opens the existing post card (report, edit, withdraw, hide) for a post. */
  onManage: (post: ShortVideoPost, trigger: HTMLElement) => void;
  /** Like or unlike from the slide, through the same command as the post card. */
  onLike: (post: ShortVideoPost) => void;
  /** Opens the post's comments (the existing comment panel) for a post. */
  onComment: (post: ShortVideoPost, trigger: HTMLElement) => void;
  likeBusy?: string | null;
  /** An uncertain command confirms its original intent rather than starting a new toggle. */
  likeRetry?: Readonly<Record<string,boolean>>;
  /** The existing share control for a post (permalink hand-off). */
  renderShare: (post: ShortVideoPost) => ReactNode;
}) {
  const videos = playableShortVideos(posts);
  const idsKey = videos.map(video => video.post_id).join('|');
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  // A feed that mounts while the tab is already hidden must not start playing.
  const [away, setAway] = useState(() => typeof document !== 'undefined' && document.hidden);
  const [check, setCheck] = useState<'idle' | 'checking' | 'failed'>('idle');
  const [muted, setMuted] = useState(true);
  const [full, setFull] = useState(false);
  const playing = !paused && !away && check === 'idle';
  // The player callbacks outlive a render, so they read the desired state from refs.
  const latest = useRef({active: 0, playing: true, muted: true, videos});
  latest.current = {active, playing, muted, videos};
  const selected = useRef<string | undefined>(undefined);
  const sequence = useRef(0);
  const hadVideos = useRef(false);
  const fullTrigger = useRef<HTMLButtonElement>(null);
  const closeFull = useRef<HTMLButtonElement>(null);
  const frames = useRef<(HTMLIFrameElement | null)[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const emptyNote = useRef<HTMLParagraphElement>(null);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  const send = useCallback((index: number, func: PlayerCommand) => {
    frames.current[index]?.contentWindow?.postMessage(playerCommand(func), SHORT_VIDEO_EMBED_ORIGIN);
  }, []);
  /** One place decides what every player does: only the slide on screen may play, and only while `playing`. */
  const apply = useCallback((index?: number) => {
    const {active: current, playing: on, muted: quiet} = latest.current;
    const targets = index === undefined ? frames.current.map((_, position) => position) : [index];
    for (const position of targets) {
      if (!frames.current[position]) continue;
      if (position === current) { send(position, quiet ? 'mute' : 'unMute'); send(position, on ? 'playVideo' : 'pauseVideo'); }
      else send(position, 'pauseVideo');
    }
  }, [send]);
  useEffect(() => { selected.current ??= videos[active]?.post_id; });
  // A new slide always starts playing, unless the viewer is away or the list is unconfirmed.
  useEffect(() => { setPaused(false); }, [active]);
  useEffect(() => { apply(); }, [active, playing, muted, idsKey, apply]);
  useEffect(() => { if (active >= videos.length - 2 && hasMore && !loadingMore) onLoadMore(); }, [active, videos.length, hasMore, loadingMore, onLoadMore]);
  // The captions of slides that are not on screen are inert. If focus sits on a control of the slide that is about to
  // stop being current, the browser would drop it on <body>; hand it to the feed before the slide goes inert.
  const keepFocusInFeed = useCallback(() => {
    const focused = document.activeElement, root = scroller.current;
    if (root && focused instanceof HTMLElement && focused !== root && root.contains(focused) && focused.closest('.short-video-caption')) root.focus({preventScroll: true});
  }, []);
  // "Next" is disabled on the last slide and "previous" on the first. A disabled button cannot hold focus, so hand it to
  // the feed as soon as the current slide changes under it (before any further key press can leave the dialog from it).
  useLayoutEffect(() => {
    const focused = document.activeElement, root = scroller.current;
    if (root && focused instanceof HTMLButtonElement && focused.disabled && root.parentElement?.contains(focused)) root.focus({preventScroll: true});
  }, [active]);
  // The list changed (refresh, withdrawal, hide): keep the viewer on the same post, or the nearest one if it is gone.
  useEffect(() => {
    const list = latest.current.videos;
    if (!list.length) return;
    const at = selected.current ? list.findIndex(video => video.post_id === selected.current) : -1;
    const next = at >= 0 ? at : Math.min(latest.current.active, list.length - 1);
    selected.current = list[next].post_id;
    if (next !== latest.current.active) {
      keepFocusInFeed();
      setActive(next);
      scroller.current?.scrollTo({top: next * scroller.current.clientHeight, behavior: 'instant'});
    }
  }, [idsKey, keepFocusInFeed]);
  // Leaving the tab stops playback; coming back stays stopped until the current list confirms the video.
  const revalidate = useCallback(async () => {
    const mine = ++sequence.current;
    setCheck('checking');
    let ids: ShortRefreshResult = null;
    try { ids = await refresh.current(); } catch { ids = null; }
    if (mine !== sequence.current) return;
    setCheck(ids ? 'idle' : 'failed');
  }, []);
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) { ++sequence.current; setAway(true); setCheck(current => current === 'checking' ? 'failed' : current); return; }
      setAway(false);
      void revalidate();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { document.removeEventListener('visibilitychange', onVisibility); ++sequence.current; };
  }, [revalidate]);
  // Full screen is a fixed overlay (no browser Fullscreen API, so it behaves the same on phones): lock the page
  // behind it, keep the slide on screen after the resize, close on Escape and hand focus back afterwards.
  useEffect(() => {
    if (!full) return;
    const {overflow} = document.body.style;
    document.body.style.overflow = 'hidden';
    const root = scroller.current;
    if (root) root.scrollTo({top: latest.current.active * root.clientHeight, behavior: 'instant'});
    closeFull.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      // A native dialog opened on top (post options, delete confirmation) owns Escape and Tab.
      if (document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape') { leaveFull(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), a[href], [tabindex="0"]') ?? [])].filter(element => !element.closest('[inert]'));
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1], current = document.activeElement;
      // Focus that has already left the dialog (for example dropped on <body>) comes back in instead of escaping behind it.
      if (!current || !dialog.current?.contains(current)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); return; }
      if (event.shiftKey && current === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && current === last) { event.preventDefault(); first.focus(); }
    };
    // The browser's Back button leaves full screen first instead of leaving the page.
    const onPop = () => { if (!window.history.state?.freedomShortFull) setFull(false); };
    document.addEventListener('keydown', onKey);
    window.addEventListener('popstate', onPop);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
      // Closed some other way (or the page was left): drop our marker so a later Back is not swallowed.
      if (window.history.state?.freedomShortFull) { const {freedomShortFull: _marker, ...rest} = window.history.state; window.history.replaceState(Object.keys(rest).length ? rest : null, ''); }
      document.body.style.overflow = overflow;
      const back = scroller.current;
      if (back) back.scrollTo({top: latest.current.active * back.clientHeight, behavior: 'instant'});
      fullTrigger.current?.focus();
    };
  }, [full]);
  // The last video can disappear while full screen is open: leave it, and give focus somewhere usable.
  useEffect(() => {
    if (videos.length) { hadVideos.current = true; return; }
    if (full) leaveFull();
    if (hadVideos.current) emptyNote.current?.focus();
  }, [videos.length, full]);
  // On a phone the feed opens below the page header and composer; bring it fully on screen so the actions show.
  useEffect(() => {
    if (window.innerWidth <= 480) dialog.current?.scrollIntoView({block: 'start', behavior: 'instant'});
  }, []);
  // Every slide is exactly one scroller tall, so the slide on screen follows from the scroll position alone.
  function follow() {
    const root = scroller.current;
    if (!root || !root.clientHeight) return;
    const index = Math.min(Math.max(Math.round(root.scrollTop / root.clientHeight), 0), videos.length - 1);
    selected.current = videos[index]?.post_id;
    if (index !== latest.current.active) keepFocusInFeed();
    setActive(current => current === index ? current : index);
  }
  function enterFull() {
    window.history.pushState({...window.history.state, freedomShortFull: true}, '');
    setFull(true);
  }
  function leaveFull() {
    if (window.history.state?.freedomShortFull) window.history.back(); else setFull(false);
  }
  function go(index: number) {
    const root = scroller.current;
    if (!root) return;
    const next = Math.min(Math.max(index, 0), videos.length - 1);
    root.scrollTo({top: next * root.clientHeight, behavior: 'smooth'});
  }
  function toggle() {
    if (check !== 'idle') return;
    setPaused(value => !value);
  }
  if (!videos.length) return <p ref={emptyNote} tabIndex={-1} className="empty">還沒有短影音。分享 YouTube 影片連結，就會出現在這裡。</p>;
  const tapLabel = (index: number) => index !== active ? `切換到第 ${index + 1} 支`
    : check === 'checking' ? '正在確認影片狀態' : check === 'failed' ? '無法確認影片狀態，重試' : paused ? '繼續播放' : '暫停';
  return <section ref={dialog} className={`short-video-feed${full ? ' is-full' : ''}`} aria-label="短影音" {...(full ? {role: 'dialog', 'aria-modal': true} : {})}>
    {full && <button ref={closeFull} type="button" className="short-video-close" aria-label="離開全螢幕" onClick={leaveFull}>✕</button>}
    <div ref={scroller} className="short-video-scroller" tabIndex={0} onScroll={follow} onKeyDown={event => {
      // Shortcuts belong to the feed itself and its tap surface. Keys pressed on the action buttons or inside the share /
      // options dialogs keep their native meaning (Space activates a button; it must not pause the video).
      const target = event.target as HTMLElement;
      if (target.closest('dialog')) return;
      const own = target === event.currentTarget || target.classList.contains('short-video-tap');
      if (!own) return;
      if (event.key === 'ArrowDown') { event.preventDefault(); go(active + 1); }
      if (event.key === 'ArrowUp') { event.preventDefault(); go(active - 1); }
      if (event.key === ' ' && target === event.currentTarget) { event.preventDefault(); toggle(); }
    }}>
      {videos.map((post, index) => {
        const embed = Math.abs(index - active) <= 1 ? shortVideoEmbedUrl(post.url) : null;
        const unconfirmed = index === active && check !== 'idle';
        const retryLike=likeRetry?.[post.post_id];
        const likeLabel=retryLike===undefined?(post.liked?'收回讚':'按讚'):(retryLike?'確認上次按讚':'確認上次收回讚');
        return <article key={post.post_id} data-index={index} data-post-id={post.post_id} className={`short-video-slide${unconfirmed ? ' is-unconfirmed' : ''}`} aria-label={`第 ${index + 1} 支，共 ${videos.length} 支：${post.title}`}>
          {post.thumbnail_url && <img className="short-video-poster" src={post.thumbnail_url} alt="" loading="lazy"/>}
          {embed && <iframe ref={element => { frames.current[index] = element; }} title={post.title} src={embed} tabIndex={-1} allow="autoplay; encrypted-media; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation"
            onLoad={() => apply(index)}/>}
          {/* The player never receives touches, so swiping always scrolls the feed; a tap pauses or resumes. */}
          <button type="button" className="short-video-tap" aria-label={tapLabel(index)} tabIndex={index === active ? 0 : -1}
            onClick={index !== active ? () => go(index) : check === 'failed' ? () => void revalidate() : toggle}>
            {index === active && paused && check === 'idle' && <span className="short-video-paused" aria-hidden="true">▶</span>}
            {unconfirmed && <span className="short-video-status" role="status">{check === 'checking' ? '正在確認影片狀態…' : '無法確認影片狀態，點一下重試'}</span>}
          </button>
          <div className="short-video-caption" ref={element => { if (element) { if (index === active) element.removeAttribute('inert'); else element.setAttribute('inert', ''); } }}>
            <strong>{post.title}</strong>
            <span>{post.author.display_name} · {formatIsoLocal(post.created_at)}</span>
            {post.url && <a href={post.url} target="_blank" rel="noopener noreferrer">在 YouTube 開啟 ↗</a>}
            <div className="short-video-actions" role="group" aria-label="貼文互動">
              <button type="button" className="short-video-action" aria-pressed={post.liked ?? false} aria-label={`${likeLabel} · ${post.like_count ?? 0}`} aria-busy={likeBusy === post.post_id || undefined} disabled={likeBusy === post.post_id} onClick={() => onLike(post)}>{retryLike===undefined?(post.liked?'♥':'♡'):likeLabel} {post.like_count ?? 0}</button>
              <button type="button" className="short-video-action" aria-label={`留言 · ${post.comment_count ?? 0}`} onClick={event => onComment(post, event.currentTarget)}>💬 {post.comment_count ?? 0}</button>
              <span className="short-video-share">{renderShare(post)}</span>
              <button type="button" className="short-video-action short-video-manage" onClick={event => onManage(post, event.currentTarget)}>貼文選項與檢舉</button>
            </div>
          </div>
        </article>;
      })}
    </div>
    <div className="short-video-controls">
      <button type="button" aria-label="上一支短影音" disabled={active <= 0} onClick={() => go(active - 1)}>↑</button>
      <button type="button" aria-label={muted ? '開啟聲音' : '關閉聲音'} aria-pressed={!muted} onClick={() => setMuted(value => !value)}>{muted ? '🔇' : '🔊'}</button>
      <button type="button" aria-label="下一支短影音" disabled={active >= videos.length - 1} onClick={() => go(active + 1)}>↓</button>
      {!full && <button ref={fullTrigger} type="button" aria-label="全螢幕" onClick={enterFull}>⛶</button>}
    </div>
    {!full && <p className="muted short-video-note">播放時由 YouTube 提供影片，YouTube 會看到你正在觀看。</p>}
  </section>;
}
