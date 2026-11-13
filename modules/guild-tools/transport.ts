import type { PreviewFetch } from '../community/link-preview.js';

/** Optional transport policy checks raw input before the shared URL normalizer erases spelling. */
export type GuildToolFetch = PreviewFetch & { assertUrl?: (input: string) => void };
