export {formatTaipeiDateTime,formatTaipeiTime,formatRetryAfterTaipeiTime,formatOrderLifecycle} from '../../../../modules/agent-commerce/hosted/format.js';

/** A validated calendar date has no time or time zone to convert. */
export function formatCalendarDate(value: string) {
  return value.replaceAll('-', '/');
}
