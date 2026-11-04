import {z} from 'zod';

export const attendanceInput = z.discriminatedUnion('action', [
  z.object({action: z.literal('confirm')}).strict(),
  z.object({action: z.literal('retract'), reason: z.enum(['marked_wrong_member', 'not_confirmed'])}).strict(),
]);
export type AttendanceAction = z.infer<typeof attendanceInput>;
export type AttendanceState = 'unconfirmed' | 'confirmed' | 'retracted';
export type AttendanceUnavailable = 'self_confirmation' | 'event_unavailable' | 'event_not_started'
  | 'registration_cancelled' | 'member_unavailable' | 'organizer_unavailable' | 'version_exhausted';

/** No elapsed-time, RSVP, helper or personal-mission fact is attendance proof. */
export function attendanceConfirmUnavailable(input: {
  self: boolean; eventState: string; started: boolean; going: boolean;
  memberEligible: boolean; organizerEligible: boolean; version: number;
}): AttendanceUnavailable | null {
  if (input.self) return 'self_confirmation';
  if (input.eventState !== 'published') return 'event_unavailable';
  if (!input.started) return 'event_not_started';
  if (!input.going) return 'registration_cancelled';
  if (!input.memberEligible) return 'member_unavailable';
  if (!input.organizerEligible) return 'organizer_unavailable';
  if (input.version >= Number.MAX_SAFE_INTEGER) return 'version_exhausted';
  return null;
}

export type AttendanceAck = {
  acknowledged: true; event_id: string; member_ref: string;
  action: AttendanceAction['action']; retraction_reason: string | null;
  command_key: string; attendance_version: number; changed: boolean;
};
export type AttendanceItem = {
  member_ref: string; nickname: string; avatar_url: string | null;
  registration_state: 'going' | 'cancelled'; registered_at: string;
  state: AttendanceState; version: number;
  recorded_by: string | null; recorded_at: string | null;
  updated_by: string | null; updated_at: string | null;
  retraction_reason: 'marked_wrong_member' | 'not_confirmed' | null;
  can_confirm: boolean; can_retract: boolean; confirm_unavailable: AttendanceUnavailable | null;
};
export type AttendancePage = {
  event_id: string; organizer_ref: string; items: AttendanceItem[]; total: number; next_offset: number | null;
};
