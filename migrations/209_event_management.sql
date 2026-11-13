-- Organizer changes contain field names, never registrant identities or contacts.
CREATE TABLE community_event_changes (
  event_id uuid NOT NULL REFERENCES community_events(event_id) ON DELETE CASCADE,
  event_version bigint NOT NULL CHECK(event_version BETWEEN 1 AND 9007199254740991),
  changed_fields text[] NOT NULL CHECK(cardinality(changed_fields)>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(event_id,event_version)
);
CREATE TABLE community_event_announcements (
  announcement_id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES community_events(event_id) ON DELETE CASCADE,
  event_version bigint NOT NULL CHECK(event_version BETWEEN 1 AND 9007199254740991),
  body text NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(event_id,event_version)
);
CREATE INDEX community_event_announcements_day ON community_event_announcements(event_id,created_at);
ALTER TABLE community_event_participation_notices ADD COLUMN body text CHECK(length(body)<=2000);
ALTER TABLE community_event_participation_notices DROP CONSTRAINT community_event_participation_notices_kind_check;
ALTER TABLE community_event_participation_notices ADD CONSTRAINT community_event_participation_notices_kind_check
  CHECK(kind IN ('event_schedule_changed','event_cancelled','event_announcement'));

ALTER TABLE member_notifications DROP CONSTRAINT member_notifications_kind_check;
ALTER TABLE member_notifications ADD CONSTRAINT member_notifications_kind_check CHECK (kind IN (
  'friend_request','friend_accepted','friend_declined','squad_invitation',
  'guild_application_approved','guild_application_rejected',
  'guild_expert_appointed','guild_expert_revoked',
  'guild_master_appointed','guild_master_revoked',
  'guild_member_promoted','guild_member_demoted',
  'event_submitted','event_review_needed','event_approved','event_rejected',
  'squad_member_removed','social_post_commented','social_post_liked',
  'squad_join_requested','squad_join_accepted',
  'event_waitlist_invited','event_schedule_changed','event_cancelled','event_start_reminder','event_announcement',
  'commerce_order_placed','commerce_order_buyer_cancelled','commerce_order_payment_confirmed',
  'commerce_order_handed_over','commerce_order_seller_cancelled','commerce_order_payment_expired','commerce_order_paid_cancelled','commerce_order_refund_recorded','commerce_order_shipped',
  'commerce_drop_ship_proposed','commerce_drop_ship_accepted','commerce_drop_ship_declined','commerce_drop_ship_revoked',
  'commerce_drop_ship_payment_confirmed','commerce_drop_ship_shipped','commerce_drop_ship_unable'
));

-- Delivery attempts reserve the budget before contacting the provider, including
-- failures and unknown outcomes. Superseded versions never return to pending.
ALTER TABLE community_event_participation_notices ADD COLUMN attempted_at timestamptz;
ALTER TABLE community_event_participation_notices DROP CONSTRAINT community_event_participation_notices_status_check;
ALTER TABLE community_event_participation_notices ADD CONSTRAINT community_event_participation_notices_status_check
 CHECK(status IN ('pending','unknown','provider_accepted','failed','skipped'));
UPDATE community_event_participation_notices SET attempted_at=clock_timestamp()
 WHERE status IN ('unknown','provider_accepted','failed');
WITH pending AS (
 SELECT notice_id,row_number() OVER (PARTITION BY event_id,guest_email ORDER BY event_version DESC) AS rank
 FROM community_event_participation_notices WHERE kind='event_schedule_changed' AND status='pending'
)
UPDATE community_event_participation_notices n SET status='skipped' FROM pending p WHERE n.notice_id=p.notice_id AND p.rank>1;
CREATE UNIQUE INDEX event_change_notice_pending ON community_event_participation_notices(event_id,guest_email)
 WHERE kind='event_schedule_changed' AND status='pending';
CREATE INDEX event_change_notice_budget ON community_event_participation_notices(event_id,guest_email,attempted_at)
 WHERE kind='event_schedule_changed' AND attempted_at IS NOT NULL;

-- Dismiss redundant unread copies from the older per-version producer. The
-- newest notice retains unread state; older bodies remain in notification history.
WITH unread AS (
 SELECT notification_id,row_number() OVER (
  PARTITION BY community_id,recipient_ref,action_resource_id ORDER BY created_at DESC,notification_id DESC
 ) AS rank
 FROM member_notifications WHERE kind='event_schedule_changed' AND action_tab='events' AND action_resource_id IS NOT NULL AND read_at IS NULL
)
UPDATE member_notifications n SET read_at=clock_timestamp()
 FROM unread u WHERE n.notification_id=u.notification_id AND u.rank>1;
