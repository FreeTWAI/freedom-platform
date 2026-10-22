// Stable DTOs for member notifications and direct messages (migration 035).
// All pages are newest first; limit 1..50 (default 20), offset >= 0.

import type {MessageContent} from './content-types.js';
export const ORDER_NOTIFICATION_KINDS=[
  'commerce_order_shipped','commerce_order_placed','commerce_order_buyer_cancelled','commerce_order_payment_confirmed',
  'commerce_order_handed_over','commerce_order_seller_cancelled','commerce_order_payment_expired',
] as const;
export const NOTIFICATION_KINDS=[
  'friend_request','friend_accepted','friend_declined','squad_invitation',
  'guild_application_approved','guild_application_rejected',
  'guild_expert_appointed','guild_expert_revoked',
  'guild_master_appointed','guild_master_revoked',
  'guild_member_promoted','guild_member_demoted',
  'event_submitted','event_review_needed','event_approved','event_rejected',
  'event_waitlist_invited','event_schedule_changed','event_cancelled','event_start_reminder',
  'squad_member_removed',
  'social_post_commented','social_post_liked','squad_join_requested','squad_join_accepted',
  ...ORDER_NOTIFICATION_KINDS,
] as const;
export type NotificationKind=typeof NOTIFICATION_KINDS[number];

export const NOTIFICATION_ACTION_TABS=['members','squads','guilds','guild-workspace','messages','events','social','stores','reservations'] as const;
export type NotificationActionTab=typeof NOTIFICATION_ACTION_TABS[number];

// members/messages/squads carry a member or squad UUID, social a post UUID; guilds/guild-workspace
// carry a canonical guild key. Legacy resource_id null opens the tab itself.
// Order actions require an exact locator, decoded only into an existing order route.
export type OrderNotificationAction=
  |{tab:'stores';resource_id:string}
  |{tab:'reservations';resource_id:string};

const compactOrderUuid='[0-9a-f]{12}[1-8][0-9a-f]{3}[89ab][0-9a-f]{15}';
const sellerOrderLocator=new RegExp(`^${compactOrderUuid}_${compactOrderUuid}_${compactOrderUuid}$(?![\\s\\S])`);
const buyerOrderLocator=/^[a-z][a-z0-9-]{1,38}[a-z0-9]\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$(?![\s\S])/;

/** Browser-safe wire guard. No URL, token, extra field or partial order selector is an action. */
export function isOrderNotificationAction(value:unknown):value is OrderNotificationAction {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const action=value as Record<string,unknown>;
  if(Object.keys(action).length!==2||!Object.hasOwn(action,'tab')||!Object.hasOwn(action,'resource_id')||typeof action.resource_id!=='string')return false;
  return action.tab==='stores'?sellerOrderLocator.test(action.resource_id)
    :action.tab==='reservations'&&buyerOrderLocator.test(action.resource_id);
}

export type NotificationAction=
  |{tab:'members';resource_id:string|null}
  |{tab:'messages';resource_id:string|null}
  |{tab:'squads';resource_id:string|null}
  |{tab:'guilds';resource_id:string|null}
  |{tab:'guild-workspace';resource_id:string|null}
  |{tab:'events';resource_id:string|null}
  |{tab:'social';resource_id:string}
  |OrderNotificationAction;

export type Notification={
  notification_id:string;kind:NotificationKind;title:string;body:string;
  created_at:string;read_at:string|null;action:NotificationAction|null;
};
export type NotificationList={items:Notification[];unread_count:number;next_offset:number|null};

/** retracted_at set: body is empty and no sticker, image or quote is returned. */
export type Message={
  message_id:string;sender_ref:string;recipient_ref:string;body:string;
  created_at:string;read_at:string|null;retracted_at:string|null;
}&MessageContent;
export type Participant={user_id:string;display_name:string;avatar_url:string|null;last_seen_at:string|null;is_online:boolean};
export type Conversation={participant:Participant;can_send:boolean;last_message:Message;unread_count:number};
/** unread_count: total unread direct messages for the viewer. */
export type ConversationPage={items:Conversation[];unread_count:number;next_offset:number|null};
/** unread_count: unread messages from this participant to the viewer. */
export type MessagePage={participant:Participant;can_send:boolean;items:Message[];unread_count:number;next_offset:number|null;retraction_count?:string};
/** Body-free update check for one conversation, under the same access rules as its history. */
export type ConversationActivity={last_message_id:string|null;unread_count:number;can_send:boolean;last_outgoing:{message_id:string;read_at:string|null}|null;retraction_count?:string};
/** The portal supplies the latest displayed message of this pair; newer arrivals stay unread. Empty body remains compatible with older clients. */
export type ConversationReadInput={through_message_id?:string};

export const COMMUNICATION_PAGE_DEFAULT_LIMIT=20;
export const COMMUNICATION_PAGE_MAX_LIMIT=50;
export const NOTIFICATION_SOURCE_KEY_MAX=200;
export const NOTIFICATION_TITLE_MAX=160;
export const NOTIFICATION_BODY_MAX=2000;
export const DIRECT_MESSAGE_BODY_MAX=2000;
