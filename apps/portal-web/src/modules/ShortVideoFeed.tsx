import {useCallback, useEffect, useRef, useState} from 'react';
import {formatIsoLocal} from '../format';
import {SHORT_VIDEO_EMBED_ORIGIN, playableShortVideos, playerCommand, shortVideoEmbedUrl, type PlayerCommand, type ShortVideoSource} from './short-video-embed';
import './ShortVideoFeed.css';

export type ShortVideoPost = ShortVideoSource & {title: string; thumbnail_url: string | null; author: {display_name: string}; created_at: string};

/**
 * Vertical, swipe-up feed of YouTube links members shared. The slide on screen and its two neighbours hold a
 * player, so the next video is already loaded when it arrives; only the one on screen plays.
 */
export function ShortVideoFeed({posts, hasMore, loadingMore, onLoadMore}: {posts: readonly ShortVideoPost[]; hasMore: boolean; loadingMore: boolean; onLoadMore: () => void}) {
  const videos = playableShortVideos(posts);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [full, setFull] = useState(false);
  const latest = useRef(0);
  latest.current = active;
  const fullTrigger = useRef<HTMLButtonElement>(null);
  const closeFull = useRef<HTMLButtonElement>(null);
  const frames = useRef<(HTMLIFrameElement | null)[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const send = useCallback((index: number, func: PlayerCommand) => {
    frames.current[index]?.contentWindow?.postMessage(playerCommand(func), SHORT_VIDEO_EMBED_ORIGIN);
  }, []);
  // One video plays at a time; a new slide always starts playing.
  useEffect(() => {
    setPaused(false);
    frames.current.forEach((_, index) => send(index, index === active ? 'playVideo' : 'pauseVideo'));
  }, [active, send]);
  useEffect(() => { send(active, muted ? 'mute' : 'unMute'); }, [muted, active, send]);
  useEffect(() => { if (active >= videos.length - 2 && hasMore && !loadingMore) onLoadMore(); }, [active, videos.length, hasMore, loadingMore, onLoadMore]);
  // Full screen is a fixed overlay (no browser Fullscreen API, so it behaves the same on phones): lock the page
  // behind it, keep the slide on screen after the resize, close on Escape and hand focus back afterwards.
  useEffect(() => {
    if (!full) return;
    const {overflow} = document.body.style;
    document.body.style.overflow = 'hidden';
    const root = scroller.current;
    if (root) root.scrollTo({top: latest.current * root.clientHeight, behavior: 'instant'});
    closeFull.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setFull(false); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      const back = scroller.current;
      if (back) back.scrollTo({top: latest.current * back.clientHeight, behavior: 'instant'});
      fullTrigger.current?.focus();
    };
  }, [full]);
  // Every slide is exactly one scroller tall, so the slide on screen follows from the scroll position alone.
  function follow() {
    const root = scroller.current;
    if (!root || !root.clientHeight) return;
    const index = Math.min(Math.max(Math.round(root.scrollTop / root.clientHeight), 0), videos.length - 1);
    setActive(current => current === index ? current : index);
  }
  function go(index: number) {
    const root = scroller.current;
    if (!root) return;
    const next = Math.min(Math.max(index, 0), videos.length - 1);
    root.scrollTo({top: next * root.clientHeight, behavior: 'smooth'});
  }
  function toggle() {
    send(active, paused ? 'playVideo' : 'pauseVideo');
    setPaused(value => !value);
  }
  if (!videos.length) return <p className="empty">還沒有短影音。分享 YouTube 影片連結，就會出現在這裡。</p>;
  return <section className={`short-video-feed${full ? ' is-full' : ''}`} aria-label="短影音" {...(full ? {role: 'dialog', 'aria-modal': true} : {})}>
    {full && <button ref={closeFull} type="button" className="short-video-close" aria-label="離開全螢幕" onClick={() => setFull(false)}>✕</button>}
    <div ref={scroller} className="short-video-scroller" tabIndex={0} onScroll={follow} onKeyDown={event => {
      if (event.key === 'ArrowDown') { event.preventDefault(); go(active + 1); }
      if (event.key === 'ArrowUp') { event.preventDefault(); go(active - 1); }
      if (event.key === ' ') { event.preventDefault(); toggle(); }
    }}>
      {videos.map((post, index) => {
        const embed = Math.abs(index - active) <= 1 ? shortVideoEmbedUrl(post.url) : null;
        return <article key={post.post_id} data-index={index} data-post-id={post.post_id} className="short-video-slide" aria-label={`第 ${index + 1} 支，共 ${videos.length} 支：${post.title}`}>
          {post.thumbnail_url && <img className="short-video-poster" src={post.thumbnail_url} alt="" loading="lazy"/>}
          {embed && <iframe ref={element => { frames.current[index] = element; }} title={post.title} src={embed} tabIndex={-1} allow="autoplay; encrypted-media; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation"
            onLoad={() => { if (index === active) { send(index, 'playVideo'); send(index, muted ? 'mute' : 'unMute'); } else send(index, 'pauseVideo'); }}/>}
          {/* The player never receives touches, so swiping always scrolls the feed; a tap pauses or resumes. */}
          <button type="button" className="short-video-tap" aria-label={index !== active ? `切換到第 ${index + 1} 支` : paused ? '繼續播放' : '暫停'} tabIndex={index === active ? 0 : -1} onClick={index === active ? toggle : () => go(index)}>
            {index === active && paused && <span className="short-video-paused" aria-hidden="true">▶</span>}
          </button>
          <div className="short-video-caption">
            <strong>{post.title}</strong>
            <span>{post.author.display_name} · {formatIsoLocal(post.created_at)}</span>
            {post.url && <a href={post.url} target="_blank" rel="noopener noreferrer">在 YouTube 開啟 ↗</a>}
          </div>
        </article>;
      })}
    </div>
    <div className="short-video-controls">
      <button type="button" aria-label="上一支短影音" disabled={active <= 0} onClick={() => go(active - 1)}>↑</button>
      <button type="button" aria-label={muted ? '開啟聲音' : '關閉聲音'} aria-pressed={!muted} onClick={() => setMuted(value => !value)}>{muted ? '🔇' : '🔊'}</button>
      <button type="button" aria-label="下一支短影音" disabled={active >= videos.length - 1} onClick={() => go(active + 1)}>↓</button>
      {!full && <button ref={fullTrigger} type="button" aria-label="全螢幕" onClick={() => setFull(true)}>⛶</button>}
    </div>
    {!full && <p className="muted short-video-note">播放時由 YouTube 提供影片，YouTube 會看到你正在觀看。</p>}
  </section>;
}
