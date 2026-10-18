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
 * A vertical (9:16) video, judged by the address alone: YouTube Shorts live under youtube.com/shorts/<id>.
 * Watch, youtu.be and embed links can be any shape, so they never qualify. The address is not fetched.
 */
export function isShortsLink(url: string | null | undefined): boolean {
  if (!url || !youtubeVideoId(url)) return false;
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  return (host === 'youtube.com' || host.endsWith('.youtube.com')) && parsed.pathname.split('/').filter(Boolean)[0] === 'shorts';
}

/** Link posts that carry a vertical YouTube Short, newest first as given, one slide per video. */
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
