/** Stable presentation IDs only; these never confer a prize or redemption right. */
export const EVENT_PRIZE_ICON_IDS = Object.freeze(['gift', 'trophy', 'medal', 'book', 'ticket', 'voucher'] as const);
export type EventPrizeIconId = (typeof EVENT_PRIZE_ICON_IDS)[number];
export const DEFAULT_EVENT_PRIZE_ICON_ID: EventPrizeIconId = 'gift';

export const EVENT_PRIZE_ICONS: readonly Readonly<{id: EventPrizeIconId; label: string}>[] = Object.freeze([
  Object.freeze({id: 'gift', label: '禮物'} as const),
  Object.freeze({id: 'trophy', label: '獎盃'} as const),
  Object.freeze({id: 'medal', label: '獎牌'} as const),
  Object.freeze({id: 'book', label: '書本'} as const),
  Object.freeze({id: 'ticket', label: '入場券'} as const),
  Object.freeze({id: 'voucher', label: '禮券'} as const),
]);

export function isEventPrizeIconId(value: unknown): value is EventPrizeIconId {
  return typeof value === 'string' && EVENT_PRIZE_ICON_IDS.some(id => id === value);
}
