import {randomUUID} from 'node:crypto';
import type {Pool, PoolClient} from 'pg';
import {z} from 'zod';
import {command, checkVersion, journal, type Command} from '../../packages/db/index.js';
import {readWithMemberSession} from '../../packages/db/member-session.js';
import {Problem, requireCondition} from '../../packages/shared/problem.js';
import type {Actor} from '../identity-membership/service.js';
import {avatarUrl} from '../identity-membership/avatars.js';
import {canAccessGuildEvent, refuseInternGuildExchange} from './events.js';
import {attendanceInput, attendanceConfirmUnavailable, type AttendanceAck, type AttendanceItem, type AttendancePage} from './event-attendance-state.js';

const pageInput = z.object({limit: z.coerce.number().int().min(1).max(50).default(20), offset: z.coerce.number().int().min(0).default(0)}).strict();
type EventRow = {event_id: string; community_id: string; organizer_ref: string; state: string; starts_at: Date; visibility: string; guild_key: string | null; event_kind: string};
type MemberRow = {active: boolean; onboarding_required: boolean; onboarding_completed_at: Date | null; hidden: boolean};
type AttendanceRow = {attendance_id: string; rsvp_id: string; state: 'confirmed' | 'retracted'; aggregate_version: string; recorded_by: string; recorded_at: Date; updated_by: string; updated_at: Date; retraction_reason: AttendanceItem['retraction_reason']};
type RsvpRow = {rsvp_id: string; state: 'going' | 'cancelled'};

async function organizerEvent(q: PoolClient, actor: Actor, eventId: string, write: boolean): Promise<EventRow> {
  const row = (await q.query(`SELECT event_id,community_id,organizer_ref,state,starts_at,visibility,guild_key,event_kind
    FROM community_events WHERE event_id=$1 AND community_id=$2 ${write ? 'FOR UPDATE NOWAIT' : 'FOR SHARE'}`, [eventId, actor.community_id])).rows[0];
  requireCondition(row, 404, 'not_found', '找不到這場活動。');
  requireCondition(row.organizer_ref === actor.user_id, 403, 'organizer_required', '只有目前的主辦者能查看或更正到場紀錄。');
  return row;
}
async function currentRecord(q: PoolClient, eventId: string, memberId: string): Promise<AttendanceRow | undefined> {
  return (await q.query('SELECT * FROM community_event_attendance WHERE event_id=$1 AND member_ref=$2 FOR UPDATE NOWAIT', [eventId, memberId])).rows[0];
}
async function requireCurrentOnboarding(q: PoolClient, actor: Actor): Promise<void> {
  const row = (await q.query('SELECT onboarding_required,onboarding_completed_at FROM users WHERE user_id=$1 AND community_id=$2', [actor.user_id, actor.community_id])).rows[0];
  requireCondition(row && (!row.onboarding_required || row.onboarding_completed_at), 403, 'onboarding_required', '請先完成會員入門。');
}
async function organizerEligible(q: PoolClient, actor: Actor, event: EventRow): Promise<boolean> {
  await requireCurrentOnboarding(q, actor);
  if (event.event_kind !== 'guild_skill_exchange') return true;
  const membership = (await q.query("SELECT member_tier FROM positioning_profession_memberships WHERE community_id=$1 AND user_id=$2 AND guild_key=$3 AND state='active'", [actor.community_id, actor.user_id, event.guild_key])).rows[0];
  // Same existing rule as refuseInternGuildExchange: former members retain the
  // organizer path, but an active intern cannot introduce a new confirmation.
  return !membership || membership.member_tier === 'full';
}

/** Private union of currently-going members and every retained attendance row.
 * Guest identities, email and contacts are never part of this projection. */
export async function listEventAttendance(pool: Pool, rawActor: Actor, eventId: string, raw: unknown): Promise<AttendancePage> {
  const actor = {...rawActor}, {limit, offset} = pageInput.parse(raw);
  return readWithMemberSession(pool, actor, async q => {
    const event = await organizerEvent(q, actor, eventId, false);
    const eligibleOrganizer = await organizerEligible(q, actor, event);
    const started = (await q.query('SELECT $1::timestamptz<=clock_timestamp() AS started', [event.starts_at])).rows[0].started;
    const rows = (await q.query(`WITH members AS MATERIALIZED (
      SELECT r.user_id AS member_ref,r.state AS registration_state,r.created_at AS registered_at,
        u.display_name,u.active,u.onboarding_required,u.onboarding_completed_at,
        is_verification_test_account(u.user_id) AS hidden,
        (e.visibility<>'guild' OR EXISTS(SELECT 1 FROM positioning_profession_memberships m
          WHERE m.community_id=e.community_id AND m.user_id=r.user_id AND m.guild_key=e.guild_key AND m.state='active')) AS guild_eligible,
        a.state,a.aggregate_version,a.recorded_by,a.recorded_at,a.updated_by,a.updated_at,a.retraction_reason,
        p.present AS avatar_present,p.aggregate_version AS avatar_version
      FROM community_event_rsvps r JOIN community_events e ON e.event_id=r.event_id AND e.community_id=$2
      JOIN users u ON u.user_id=r.user_id AND u.community_id=$2
      LEFT JOIN community_event_attendance a ON a.event_id=r.event_id AND a.member_ref=r.user_id AND a.community_id=$2
      LEFT JOIN member_avatar_presence p ON p.user_id=r.user_id AND p.community_id=$2
      WHERE r.event_id=$1 AND (r.state='going' OR a.attendance_id IS NOT NULL)
        AND (a.attendance_id IS NOT NULL OR NOT is_verification_test_account(r.user_id))
    ), page AS (SELECT * FROM members ORDER BY registered_at,member_ref LIMIT $3 OFFSET $4),
    counted AS (SELECT count(*)::int AS total FROM members)
    SELECT page.*,counted.total FROM counted LEFT JOIN page ON true ORDER BY registered_at,member_ref`, [eventId, actor.community_id, limit, offset])).rows;
    const items: AttendanceItem[] = rows.filter(row => row.member_ref !== null).map(row => {
      const version = Number(row.aggregate_version ?? 1);
      const unavailable = attendanceConfirmUnavailable({self: row.member_ref === actor.user_id, eventState: event.state, started,
        going: row.registration_state === 'going', memberEligible: row.active && !row.hidden && (!row.onboarding_required || Boolean(row.onboarding_completed_at)) && row.guild_eligible,
        organizerEligible: eligibleOrganizer, version});
      return {member_ref: row.member_ref, nickname: row.display_name,
        avatar_url: row.avatar_present ? avatarUrl(row.member_ref, row.avatar_version ?? '1', true) : null,
        registration_state: row.registration_state, registered_at: row.registered_at.toISOString(),
        state: row.state ?? 'unconfirmed', version,
        recorded_by: row.recorded_by ?? null, recorded_at: row.recorded_at?.toISOString() ?? null,
        updated_by: row.updated_by ?? null, updated_at: row.updated_at?.toISOString() ?? null,
        retraction_reason: row.retraction_reason ?? null,
        can_confirm: row.state !== 'confirmed' && unavailable === null,
        can_retract: row.state === 'confirmed' && eligibleOrganizer && version < Number.MAX_SAFE_INTEGER, confirm_unavailable: unavailable};
    });
    const total = Number(rows[0]?.total ?? 0);
    return {event_id: eventId, organizer_ref: actor.user_id, items, total, next_offset: offset + items.length < total ? offset + limit : null};
  });
}

export async function mutateEventAttendance(pool: Pool, rawInput: Command, eventId: string, memberId: string): Promise<AttendanceAck> {
  eventId = z.uuid().parse(eventId).toLowerCase(); memberId = z.uuid().parse(memberId).toLowerCase();
  const body = attendanceInput.parse(rawInput.body), input = {...rawInput, actor: {...rawInput.actor}, body};
  requireCondition(input.expected, 428, 'version_required', '請重新讀取這位會員的到場紀錄版本。');
  let event: EventRow, member: MemberRow, rsvp: RsvpRow, row: AttendanceRow | undefined;
  try { return await command(pool, input, async q => {
    // Keep actor/session/receipt protocol. Existing guild writes do not all
    // share a global ordering: never wait while holding our new subject/guild/
    // event locks. Try the exact canonical guild keys, NOWAIT for domain rows;
    // any conflict rolls the whole command back without a receipt or effect.
    member = (await q.query(`SELECT active,onboarding_required,onboarding_completed_at,is_verification_test_account(user_id) AS hidden
      FROM users WHERE user_id=$1 AND community_id=$2 FOR SHARE NOWAIT`, [memberId, input.actor.community_id])).rows[0];
    for (const user_id of [...new Set([input.actor.user_id, memberId])].sort()) {
      const acquired = (await q.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired', [`guild-member/${input.actor.community_id}/${user_id}`])).rows[0]?.acquired;
      requireCondition(acquired === true, 409, 'attendance_busy', '會員資格或活動紀錄正在更新，這次操作未寫入，請重新讀取後再試。');
    }
    event = await organizerEvent(q, input.actor, eventId, true);
    // Match existing event update/cancel authority BEFORE receipt replay. A
    // subject losing eligibility permits correction; an actor losing write
    // authority does not. Do not invent an intern/delegate correction grant.
    await refuseInternGuildExchange(q, input.actor, event);
    requireCondition(await organizerEligible(q, input.actor, event), 403, 'attendance_organizer_unavailable', '目前沒有記錄或更正到場的權限，請先恢復會員資格。');
    rsvp = (await q.query('SELECT rsvp_id,state FROM community_event_rsvps WHERE event_id=$1 AND user_id=$2 FOR UPDATE NOWAIT', [eventId, memberId])).rows[0];
    row = await currentRecord(q, eventId, memberId);
    requireCondition(member && rsvp && (!member.hidden || row), 404, 'not_found', '找不到這位會員的活動紀錄。');
    requireCondition(!row || row.rsvp_id === rsvp.rsvp_id, 409, 'attendance_identity_conflict', '活動紀錄關聯已變更，請重新讀取。');
    // Current authority/identity always precede even an old receipt. Mutable
    // eligibility goes in run: cancellation must not strand a successful ACK.
  }, async q => {
    checkVersion(row?.aggregate_version ?? '1', input.expected);
    if (body.action === 'confirm') {
      const started = (await q.query('SELECT $1::timestamptz<=clock_timestamp() AS started', [event.starts_at])).rows[0].started;
      const unavailable = attendanceConfirmUnavailable({self: memberId === input.actor.user_id,
        eventState: event.state, started, going: rsvp.state === 'going',
        memberEligible: member.active && !member.hidden && (!member.onboarding_required || Boolean(member.onboarding_completed_at))
          && await canAccessGuildEvent(q, {...input.actor, user_id: memberId}, event),
        organizerEligible: await organizerEligible(q, input.actor, event), version: Number(row?.aggregate_version ?? 1)});
      requireCondition(unavailable === null, 409, unavailable === 'self_confirmation' ? 'attendance_self_confirmation' : 'attendance_unavailable',
        unavailable === 'self_confirmation' ? '不能由自己確認自己的到場。' : '目前不能新增這位會員的到場確認，請重新讀取。');
    } else requireCondition(row, 404, 'not_found', '這位會員沒有可撤回的到場紀錄。');
    const next = body.action === 'confirm' ? 'confirmed' : 'retracted';
    const changed = row?.state !== next;
    if (changed) {
      requireCondition(Number(row?.aggregate_version ?? 1) < Number.MAX_SAFE_INTEGER, 409, 'attendance_version_exhausted', '到場紀錄暫時無法變更。');
      if (!row) {
        row = (await q.query(`INSERT INTO community_event_attendance(attendance_id,community_id,event_id,member_ref,rsvp_id,state,recorded_by,updated_by)
          VALUES($1,$2,$3,$4,$5,'confirmed',$6,$6) RETURNING *`, [randomUUID(), input.actor.community_id, eventId, memberId, rsvp.rsvp_id, input.actor.user_id])).rows[0];
      } else {
        row = (await q.query(`UPDATE community_event_attendance SET state=$2,retraction_reason=$3,updated_by=$4,updated_at=clock_timestamp(),
          recorded_by=CASE WHEN $2='confirmed' THEN $4 ELSE recorded_by END,
          recorded_at=CASE WHEN $2='confirmed' THEN clock_timestamp() ELSE recorded_at END,
          aggregate_version=aggregate_version+1 WHERE attendance_id=$1 RETURNING *`,
        [row.attendance_id, next, body.action === 'retract' ? body.reason : null, input.actor.user_id])).rows[0];
      }
      await journal(q, input.actor, 'community_event_attendance', row!.attendance_id, row!.aggregate_version, body.action,
        {event_id: eventId, member_ref: memberId, rsvp_id: rsvp.rsvp_id, reason: body.action === 'retract' ? body.reason : null});
    }
    // Minimal immutable acknowledgement. It never carries a historical person
    // profile or attendance snapshot that a client could mistake for current.
    return {acknowledged: true, event_id: eventId, member_ref: memberId, action: body.action,
      retraction_reason: body.action === 'retract' ? body.reason : null, command_key: input.key,
      attendance_version: Number(row!.aggregate_version), changed};
  }); } catch (cause) {
    // command() has already rolled back. Do not issue more domain SQL in an
    // aborted transaction, retry automatically, or reinterpret another error.
    if (cause && typeof cause === 'object' && 'code' in cause && cause.code === '55P03') {
      throw new Problem(409, 'attendance_busy', '會員資格或活動紀錄正在更新，這次操作未寫入，請重新讀取後再試。');
    }
    throw cause;
  }
}
