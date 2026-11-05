import type {AttendanceAction, AttendanceAck, AttendanceItem, AttendancePage} from '../../../../modules/community/event-attendance-state.js';

export type {AttendanceAction, AttendanceItem, AttendancePage};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const reasons = new Set(['marked_wrong_member', 'not_confirmed']);
const unavailable = new Set(['self_confirmation', 'event_unavailable', 'event_not_started', 'registration_cancelled', 'member_unavailable', 'organizer_unavailable', 'version_exhausted']);
const id = (value: unknown): value is string => typeof value === 'string' && uuid.test(value);
const version = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const time = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));

function item(value: unknown): value is AttendanceItem {
  if (!value || typeof value !== 'object') return false;
  const row = value as AttendanceItem;
  if (!id(row.member_ref) || typeof row.nickname !== 'string' || !version(row.version)
    || !['going', 'cancelled'].includes(row.registration_state) || !time(row.registered_at)
    || !(row.avatar_url === null || typeof row.avatar_url === 'string' && row.avatar_url.startsWith('/api/v1/'))
    || typeof row.can_confirm !== 'boolean' || typeof row.can_retract !== 'boolean'
    || !(row.confirm_unavailable === null || unavailable.has(row.confirm_unavailable))) return false;
  if (row.state === 'unconfirmed') return row.version === 1 && row.recorded_by === null && row.recorded_at === null
    && row.updated_by === null && row.updated_at === null && row.retraction_reason === null && !row.can_retract
    && row.can_confirm === (row.confirm_unavailable === null);
  if (!['confirmed', 'retracted'].includes(row.state) || row.version < 2 || !id(row.recorded_by) || !time(row.recorded_at)
    || !id(row.updated_by) || !time(row.updated_at)) return false;
  if (row.state === 'confirmed') return row.retraction_reason === null && !row.can_confirm
    && (!row.can_retract || row.version < Number.MAX_SAFE_INTEGER && row.confirm_unavailable !== 'organizer_unavailable');
  return reasons.has(row.retraction_reason!) && !row.can_retract && row.can_confirm === (row.confirm_unavailable === null);
}

export function attendancePage(value: unknown, eventId: string, organizerId: string, offset: number): value is AttendancePage {
  if (!value || typeof value !== 'object') return false;
  const page = value as AttendancePage;
  return page.event_id === eventId && page.organizer_ref === organizerId && Array.isArray(page.items) && page.items.length <= 20
    && Number.isSafeInteger(page.total) && page.total >= 0 && page.items.length <= Math.max(0, page.total - offset)
    && new Set(page.items.map(row => row?.member_ref)).size === page.items.length && page.items.every(item)
    && (page.next_offset === null
      ? offset + page.items.length >= page.total
      : Number.isSafeInteger(page.next_offset) && page.items.length === 20 && page.next_offset === offset + 20 && page.next_offset < page.total)
    && page.items.every(row => row.member_ref !== organizerId || !row.can_confirm && row.confirm_unavailable === 'self_confirmation');
}

/** Only the original command receipt may release an unknown attempt. Its
 * version is a lower bound for a subsequent read, never current UI state. */
export function attendanceAck(value: unknown, command: {eventId: string; memberId: string; body: AttendanceAction; key: string; version: number}): value is AttendanceAck {
  if (!value || typeof value !== 'object') return false;
  const ack = value as AttendanceAck;
  return ack.acknowledged === true && ack.event_id === command.eventId && ack.member_ref === command.memberId
    && ack.action === command.body.action && ack.command_key === command.key
    && ack.retraction_reason === (command.body.action === 'retract' ? command.body.reason : null)
    && typeof ack.changed === 'boolean' && version(ack.attendance_version) && ack.attendance_version >= 2
    && ack.attendance_version === command.version + (ack.changed ? 1 : 0);
}
