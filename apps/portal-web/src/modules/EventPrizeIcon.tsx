import {isEventPrizeIconId, type EventPrizeIconId} from '../../../../modules/community/event-prize-icons';

/** Original, source-controlled illustrations contributed under this repository's MIT license.
 * Decorative: callers must render the prize name or icon label as visible text.
 * Unknown persisted values fail closed, rather than inventing a gift or loading a URL.
 */
export function EventPrizeIcon({iconId, className}: {iconId: EventPrizeIconId; className?: string}) {
  if (!isEventPrizeIconId(iconId)) return null;
  return <svg className={className} width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {iconId === 'gift' && <>
      <rect x="8" y="23" width="32" height="18" rx="3" />
      <rect x="5" y="16" width="38" height="8" rx="2" />
      <path d="M24 16v25M24 16c-9 0-14-1-14-6 0-6 10-7 14 6Zm0 0c9 0 14-1 14-6 0-6-10-7-14 6Z" />
    </>}
    {iconId === 'trophy' && <>
      <path d="M14 7h20v12c0 7-4 11-10 11S14 26 14 19V7ZM14 11H7v5c0 7 5 9 9 9M34 11h7v5c0 7-5 9-9 9M24 30v8M17 38h14l3 4H14l3-4Z" />
      <path d="m24 12 2 4 4 .5-3 3 .7 4-3.7-2-3.7 2 .7-4-3-3 4-.5 2-4Z" />
    </>}
    {iconId === 'medal' && <>
      <path d="M14 6h8l8 16M26 6h8l-8 16M14 6l8 16M34 6l-8 16" />
      <circle cx="24" cy="31" r="12" />
      <path d="m24 24 2 4 4 .5-3 3 .7 4-3.7-2-3.7 2 .7-4-3-3 4-.5 2-4Z" />
    </>}
    {iconId === 'book' && <>
      <path d="M24 12C18 8 11 8 5 10v27c7-2 13-2 19 2 6-4 12-4 19-2V10c-6-2-13-2-19 2Zm0 0v27M10 17c3-1 6-1 9 1M10 24c3-1 6-1 9 1M29 18c3-2 6-2 9-1M29 25c3-2 6-2 9-1" />
    </>}
    {iconId === 'ticket' && <>
      <path d="M7 12h34v8a4 4 0 0 0 0 8v8H7v-8a4 4 0 0 0 0-8v-8Z" />
      <path d="M32 16v2m0 4v4m0 4v2m-19-8h12m-9-5h6m-6 10h6" />
    </>}
    {iconId === 'voucher' && <>
      <rect x="5" y="10" width="38" height="28" rx="4" />
      <path d="M16 10v28M5 21h38M16 21c-6 0-8-2-8-5 0-4 6-4 8 5Zm0 0c6 0 8-2 8-5 0-4-6-4-8 5ZM25 28h11m-11 5h7" />
    </>}
  </svg>;
}
