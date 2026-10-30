import {randomInt, randomUUID} from 'node:crypto';
import type {Pool, PoolClient} from 'pg';
import {z} from 'zod';
import {command, checkVersion, type Command} from '../../packages/db/index.js';
import {readWithMemberSession} from '../../packages/db/member-session.js';
import {Problem, requireCondition} from '../../packages/shared/problem.js';
import type {Actor} from '../identity-membership/service.js';
import {lockMemberGuilds} from '../positioning/onboarding.js';
import {readEvent} from '../community/events.js';
import {MISSION_POLICY, MISSION_TEMPLATES, chooseMissions, changeMission} from './policy.js';

const inputSchema = z.discriminatedUnion('action', [
  z.object({action: z.literal('start')}).strict(),
  z.object({action: z.literal('clear')}).strict(),
  z.object({action: z.literal('replace'), slot: z.number().int().min(0).max(2)}).strict(),
  z.object({action: z.literal('mark_done'), slot: z.number().int().min(0).max(2)}).strict(),
  z.object({action: z.literal('skip'), slot: z.number().int().min(0).max(2)}).strict(),
]);
const slotSchema = z.object({
  template_id: z.enum(['read_intro', 'think_question', 'notice_interest', 'prepare_intro', 'reflect', 'take_break']),
  state: z.enum(['active', 'self_reported', 'skipped']),
}).strict();

async function own(q: PoolClient, actor: Actor, id: string) {
  return (await q.query(
    'SELECT * FROM event_mission_progress WHERE community_id=$1 AND event_id=$2 AND member_ref=$3',
    [actor.community_id, id, actor.user_id],
  )).rows[0];
}

async function requireEventScope(q: PoolClient, actor: Actor, id: string) {
  const event = await q.query(
    'SELECT 1 FROM community_events WHERE event_id=$1 AND community_id=$2',
    [id, actor.community_id],
  );
  requireCondition(event.rowCount === 1, 404, 'not_found', '找不到活動。');
}

async function ready(q: PoolClient, actor: Actor) {
  const user = (await q.query(
    'SELECT onboarding_required,onboarding_completed_at FROM users WHERE user_id=$1 AND community_id=$2',
    [actor.user_id, actor.community_id],
  )).rows[0];
  requireCondition(
    user && (!user.onboarding_required || user.onboarding_completed_at),
    403, 'onboarding_required', '請先完成會員入門。',
  );
}

async function accessible(q: PoolClient, actor: Actor, id: string) {
  const event = await readEvent(q, actor, id);
  requireCondition(
    event.state === 'published',
    409, 'event_closed', '活動未開放，小任務暫停；仍可清除自己的紀錄。',
  );
}

export async function readEventMissions(pool: Pool, actor: Actor, id: string) {
  return readWithMemberSession(pool, actor, async q => {
    await requireEventScope(q, actor, id);
    const row = await own(q, actor, id);
    let editable = true;
    try {
      await ready(q, actor);
      await accessible(q, actor, id);
    } catch (error) {
      if (!row || !(error instanceof Problem) || ![403, 404, 409].includes(error.status)) throw error;
      editable = false;
    }
    // A source can move communities during the intervening non-locking reads.
    await requireEventScope(q, actor, id);
    const slots = editable && row?.enabled ? z.array(slotSchema).length(3).parse(row.slots) : [];
    // The inaccessible projection exposes only the owner's version/clear control,
    // not event details or old task content. It is not an event access capability.
    return {
      policy: MISSION_POLICY,
      version: Number(row?.aggregate_version ?? 1),
      enabled: row?.enabled ?? false,
      editable,
      slots: slots.map((slot, index) => ({
        slot: index,
        ...slot,
        ...MISSION_TEMPLATES.find(template => template.id === slot.template_id)!,
      })),
    };
  });
}

export async function mutateEventMissions(pool: Pool, raw: Command, id: string) {
  const body = inputSchema.parse(raw.body);
  const input = {...raw, actor: {...raw.actor}, body};
  requireCondition(input.expected, 428, 'version_required', '請重新讀取小任務版本。');

  return command(pool, input, async q => {
    if (body.action !== 'clear') {
      await ready(q, input.actor);
      await lockMemberGuilds(q, input.actor);
    }
    // Same guild-before-event order as event commands. No writer locks on GET.
    const event = (await q.query(
      'SELECT event_id FROM community_events WHERE event_id=$1 AND community_id=$2 FOR SHARE',
      [id, input.actor.community_id],
    )).rows[0];
    requireCondition(event, 404, 'not_found', '找不到活動。');
    await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `event-missions/${input.actor.community_id}/${id}/${input.actor.user_id}`,
    ]);
    if (body.action === 'clear') {
      requireCondition(await own(q, input.actor, id), 404, 'not_found', '找不到你的小任務紀錄。');
    } else {
      await accessible(q, input.actor, id);
    }
  }, async q => {
    const row = await own(q, input.actor, id);
    checkVersion(String(row?.aggregate_version ?? 1), input.expected);
    requireCondition(
      Number(row?.aggregate_version ?? 1) < Number.MAX_SAFE_INTEGER,
      409, 'version_exhausted', '小任務暫時無法更新。',
    );
    const enabled = body.action !== 'clear';
    let slots = row?.enabled ? z.array(slotSchema).length(3).parse(row.slots) : [];
    if (body.action === 'clear') {
      slots = [];
    } else if (body.action === 'start') {
      requireCondition(!row?.enabled, 409, 'already_started', '已經開始，請重新讀取目前任務。');
      slots = chooseMissions(randomInt(MISSION_TEMPLATES.length));
    } else {
      requireCondition(row?.enabled, 409, 'not_started', '請先自願開始小任務。');
      slots = changeMission(slots, body, randomInt(MISSION_TEMPLATES.length));
    }
    await q.query(`
      INSERT INTO event_mission_progress(
        progress_id,community_id,event_id,member_ref,enabled,policy_version,slots,aggregate_version
      ) VALUES($1,$2,$3,$4,$5,$6,$7,2)
      ON CONFLICT(event_id,member_ref) DO UPDATE SET
        enabled=EXCLUDED.enabled,slots=EXCLUDED.slots,
        aggregate_version=event_mission_progress.aggregate_version+1,updated_at=clock_timestamp()`,
    [row?.progress_id ?? randomUUID(), input.actor.community_id, id, input.actor.user_id,
      enabled, MISSION_POLICY, JSON.stringify(slots)]);
    // Existing command receipt is the minimal acknowledgement only. Replaying a
    // pre-clear command cannot return or restore deleted assignment content.
    return {acknowledged: true as const, event_id: id, action: body.action, command_key: input.key};
  });
}
