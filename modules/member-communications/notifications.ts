import type {PoolClient} from 'pg';
import {z} from 'zod';
import {
  NOTIFICATION_ACTION_TABS,NOTIFICATION_BODY_MAX,NOTIFICATION_KINDS,NOTIFICATION_SOURCE_KEY_MAX,NOTIFICATION_TITLE_MAX,isOrderNotificationAction,
  type NotificationAction,type NotificationKind,
  ORDER_NOTIFICATION_KINDS,
} from './types.js';

const uuid=z.string().uuid();
const guildKey=z.string().max(100).regex(/^guild_(?:[a-z_]+|custom_[0-9a-fA-F]{32})$/);
const action=z.discriminatedUnion('tab',[
  z.object({tab:z.literal('members'),resource_id:uuid.nullable()}).strict(),
  z.object({tab:z.literal('messages'),resource_id:uuid.nullable()}).strict(),
  z.object({tab:z.literal('squads'),resource_id:uuid.nullable()}).strict(),
  z.object({tab:z.literal('guilds'),resource_id:guildKey.nullable()}).strict(),
  z.object({tab:z.literal('guild-workspace'),resource_id:guildKey.nullable()}).strict(),
  z.object({tab:z.literal('events'),resource_id:uuid.nullable()}).strict(),
  z.object({tab:z.literal('social'),resource_id:uuid}).strict(),
  z.object({tab:z.literal('stores'),resource_id:z.string().refine(resource_id=>isOrderNotificationAction({tab:'stores',resource_id}))}).strict(),
  z.object({tab:z.literal('reservations'),resource_id:z.string().refine(resource_id=>isOrderNotificationAction({tab:'reservations',resource_id}))}).strict(),
]);
const notifyInput=z.object({
  community_id:uuid,
  recipient_ref:uuid,
  kind:z.enum(NOTIFICATION_KINDS),
  source_key:z.string().min(1).max(NOTIFICATION_SOURCE_KEY_MAX),
  title:z.string().trim().min(1).max(NOTIFICATION_TITLE_MAX),
  body:z.string().trim().min(1).max(NOTIFICATION_BODY_MAX),
  action:action.nullable(),
}).strict();
// Keep the zod tab list and the exported tuple in lockstep.
const _tabs:readonly NotificationAction['tab'][]=NOTIFICATION_ACTION_TABS;void _tabs;

export type NotifyMemberInput={
  community_id:string;recipient_ref:string;kind:NotificationKind;source_key:string;
  title:string;body:string;action:NotificationAction|null;
};

/** One kill-switch predicate for counts, pages, reminders and read eligibility, before pagination. */
export function notificationVisibilitySQL(orderNotificationsEnabled:boolean,alias:''|'n'=''):string {
  const column=alias?'n.kind':'kind';
  return orderNotificationsEnabled?'TRUE':`${column} NOT IN (${ORDER_NOTIFICATION_KINDS.map(kind=>`'${kind}'`).join(',')})`;
}

/**
 * Records one in-app notification inside the caller's transaction, so it
 * commits or rolls back with the domain change. Returns null when the same
 * (community, recipient, source_key) was already recorded (safe replay).
 * The recipient only has to exist in the community; readiness or activity is
 * not required and nothing here grants roles or sends email/external traffic.
 * Invalid input or cross-community routing is a programming error and throws.
 */
export async function notifyMember(q:Pick<PoolClient,'query'>,input:NotifyMemberInput):Promise<{notification_id:string}|null>{
  const parsed=notifyInput.safeParse(input);
  if(!parsed.success)throw new Error(`notification_input_invalid: ${parsed.error.issues.map(i=>i.path.join('.')||'input').join(',')}`);
  const n=parsed.data;
  const recipient=await q.query('SELECT 1 FROM users WHERE user_id=$1 AND community_id=$2',[n.recipient_ref,n.community_id]);
  if(!recipient.rowCount)throw new Error('notification_recipient_outside_community');
  const inserted=await q.query<{notification_id:string}>(
    `INSERT INTO member_notifications(community_id,recipient_ref,kind,source_key,title,body,action_tab,action_resource_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (community_id,recipient_ref,source_key) DO NOTHING
     RETURNING notification_id`,
    [n.community_id,n.recipient_ref,n.kind,n.source_key,n.title,n.body,n.action?.tab??null,n.action?.resource_id??null]);
  return inserted.rows[0]?{notification_id:inserted.rows[0].notification_id}:null;
}

export const eventAccessSql = `e.community_id=$1 AND (e.organizer_ref=$2 OR NOT is_verification_test_account(e.organizer_ref)) AND (
  e.organizer_ref=$2 OR (e.state='published' AND (e.visibility<>'guild' OR EXISTS(
    SELECT 1 FROM positioning_profession_memberships m WHERE m.community_id=e.community_id AND m.user_id=$2 AND m.guild_key=e.guild_key AND m.state='active')))
  OR (e.state='pending' AND EXISTS(SELECT 1 FROM positioning_guild_officers o JOIN positioning_profession_memberships m
    ON m.community_id=o.community_id AND m.guild_key=o.guild_key AND m.user_id=o.user_id AND m.state='active'
    WHERE o.community_id=e.community_id AND o.guild_key=e.review_guild_key AND o.user_id=$2)))`;
export const eventNoticeAccessSql = `(n.kind NOT IN ('event_submitted','event_review_needed','event_approved','event_rejected','event_start_reminder','event_waitlist_invited','event_schedule_changed','event_cancelled','event_announcement')
  OR n.action_resource_id IS NULL OR EXISTS(SELECT 1 FROM community_events e
    WHERE e.event_id::text=n.action_resource_id::text AND (${eventAccessSql} OR (
      n.kind='event_cancelled' AND e.state='cancelled' AND e.community_id=$1
      AND (e.organizer_ref=$2 OR NOT is_verification_test_account(e.organizer_ref))
      AND (e.visibility<>'guild' OR EXISTS(SELECT 1 FROM positioning_profession_memberships m
        WHERE m.community_id=e.community_id AND m.user_id=$2 AND m.guild_key=e.guild_key AND m.state='active'))
      AND (EXISTS(SELECT 1 FROM community_event_rsvps r WHERE r.event_id=e.event_id AND r.user_id=$2 AND r.confirmed_at IS NOT NULL)
        OR EXISTS(SELECT 1 FROM community_event_waitlist w WHERE w.event_id=e.event_id AND w.member_ref=$2))
    ))))`;
