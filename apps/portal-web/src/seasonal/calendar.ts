/** Gregorian seasonal decoration only; no account, entitlement or reward meaning. */
export type SeasonalDecoration = 'halloween' | 'christmas' | 'newyear';
const taipeiDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: 'numeric', day: 'numeric',
});

function calendarParts(now: Date) {
  if (!Number.isFinite(now.getTime())) return null;
  const parts = taipeiDate.formatToParts(now);
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value);
  return {year: value('year'), month: value('month'), day: value('day')};
}

/** Inclusive local dates. New Year means Jan 1, not a guessed lunar calendar. */
export function seasonalDecorationAt(now: Date): SeasonalDecoration | null {
  const date = calendarParts(now);
  if (!date) return null;
  const {month, day} = date;
  if (month === 10 && day >= 25 && day <= 31) return 'halloween';
  if (month === 12 && day >= 15 && day <= 25) return 'christmas';
  if ((month === 12 && day >= 28) || (month === 1 && day <= 3)) return 'newyear';
  return null;
}

/** Current Taipei calendar has UTC+08:00 without daylight saving. */
export function millisecondsUntilTaipeiMidnight(now: Date): number {
  const date = calendarParts(now);
  if (!date) return 60_000;
  const next = Date.UTC(date.year, date.month - 1, date.day + 1) - 8 * 60 * 60 * 1000;
  return Math.max(1, next - now.getTime());
}
