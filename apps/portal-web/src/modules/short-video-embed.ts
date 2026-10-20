import {youtubeVideoId} from '../../../../packages/shared/youtube-video-id';

/** The only origin the page lets embed a player. Keep in sync with `frame-src` in platform-app.ts. */
export const SHORT_VIDEO_EMBED_ORIGIN = 'https://www.youtube-nocookie.com';

export type ShortVideoSource = {post_id: string; url: string | null; kind: 'link' | 'note'; platform: string};

/**
 * Player address built from the 11-character video id alone, never from the address the member pasted.
 * Players start muted and paused-by-script: the feed starts the one on screen and pauses the rest.
 */
export function shortVideoEmbedUrl(url: string | null | undefined): string | null {
  const id = url ? youtubeVideoId(url) : null;
  if (!id) return null;
  const query = new URLSearchParams({playsinline: '1', rel: '0', modestbranding: '1', controls: '0', mute: '1', loop: '1', playlist: id, enablejsapi: '1'});
  return `${SHORT_VIDEO_EMBED_ORIGIN}/embed/${id}?${query}`;
}

export type PlayerCommand = 'playVideo' | 'pauseVideo' | 'mute' | 'unMute';

/** Message for the YouTube player's postMessage API; only ever sent to the allowed origin. */
export function playerCommand(func: PlayerCommand) {
  return JSON.stringify({event: 'command', func, args: []});
}

/**
 * A link in the Shorts address form (youtube.com/shorts/<id>). This is a URL classification only: the video's aspect
 * ratio is not checked or claimed. Watch, youtu.be and embed links never qualify. The address is not fetched.
 */
export function isShortsLink(url: string | null | undefined): boolean {
  if (!url || !youtubeVideoId(url)) return false;
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  return (host === 'youtube.com' || host.endsWith('.youtube.com')) && parsed.pathname.split('/').filter(Boolean)[0] === 'shorts';
}

/** Link posts whose address is in the YouTube Shorts form, newest first as given, one slide per video. */
export function playableShortVideos<T extends ShortVideoSource>(posts: readonly T[]): T[] {
  const seen = new Set<string>();
  return posts.filter(post => {
    if (post.kind !== 'link' || post.platform !== 'youtube' || !isShortsLink(post.url)) return false;
    const id = youtubeVideoId(post.url!);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export type YoutubeLinkKind = 'short' | 'video';

/** `short` for the Shorts address form, `video` for any other single YouTube video address, otherwise null. URL only. */
export function youtubeLinkKind(url: string | null | undefined): YoutubeLinkKind | null {
  if (!url || !youtubeVideoId(url)) return null;
  return isShortsLink(url) ? 'short' : 'video';
}

/**
 * Player address for a single video opened from its post card. Built from the 11-character id on the one allowed
 * origin; the viewer starts it, so it may autoplay, and it keeps the player's own controls.
 */
export function inlineVideoEmbedUrl(url: string | null | undefined): string | null {
  const id = url ? youtubeVideoId(url) : null;
  if (!id) return null;
  const query = new URLSearchParams({playsinline: '1', rel: '0', modestbranding: '1', autoplay: '1'});
  return `${SHORT_VIDEO_EMBED_ORIGIN}/embed/${id}?${query}`;
}

/** What the link composer tells the member about a pasted address. Judged from the text alone; nothing is fetched. */
export function youtubeLinkHint(raw: string, playback: boolean): string | null {
  const kind = youtubeLinkKind(raw.trim());
  if (kind === 'short') return playback ? '這是 YouTube Short 連結，分享後會出現在 Short 動態，也能在貼文中直接播放。' : '這是 YouTube Short 連結。';
  if (kind === 'video') return playback ? '這是 YouTube 影片連結，分享後可在貼文中直接播放。' : '這是 YouTube 影片連結。';
  let host = '';
  try { const parsed = new URL(raw.trim()); if (parsed.protocol === 'https:') host = parsed.hostname.toLowerCase().replace(/\.$/, ''); } catch { return null; }
  const youtube = host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com');
  return youtube ? '這看起來是 YouTube 連結，但不是單支影片（找不到影片代號）。仍可分享，但不會出現在 Short，也無法站內播放。' : null;
}
