import {useState} from 'react';
import {inlineVideoEmbedUrl} from './short-video-embed';
import './InlineVideo.css';

/**
 * A YouTube link post can be played where it is. Nothing loads from YouTube until the viewer asks, and the player
 * is removed again on request, so scrolling past a post never contacts the provider.
 */
export function InlineVideo({url, title, poster}: {url: string | null; title: string; poster: string | null}) {
  const [playing, setPlaying] = useState(false);
  const embed = playing ? inlineVideoEmbedUrl(url) : null;
  if (!inlineVideoEmbedUrl(url)) return null;
  return <div className="inline-video">
    {embed
      ? <div className="inline-video-frame">
        <iframe title={title} src={embed} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation"/>
      </div>
      : poster && <img className="inline-video-poster" src={poster} alt="" width={640} height={360} loading="lazy"/>}
    <div className="inline-video-actions">
      <button type="button" className="btn btn-ghost" aria-pressed={playing} onClick={() => setPlaying(value => !value)}>{playing ? '收起影片' : '▶ 站內播放'}</button>
      {!playing && <span className="muted inline-video-note">播放時由 YouTube 提供影片，YouTube 會看到你正在觀看。</span>}
    </div>
  </div>;
}
