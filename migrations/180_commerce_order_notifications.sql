-- In-site order notices reuse the existing writer, transaction and dedupe key.
-- No backfill, new objects, RLS changes or runtime privileges.
-- Rollback: disable order notifications and retain these widened checks/history.
-- Narrowing checks requires proving no retained row uses the new kinds or tabs.
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
  'event_waitlist_invited','event_schedule_changed','event_cancelled','event_start_reminder',
  'commerce_order_placed','commerce_order_buyer_cancelled','commerce_order_payment_confirmed',
  'commerce_order_handed_over','commerce_order_seller_cancelled','commerce_order_payment_expired'
));
ALTER TABLE member_notifications DROP CONSTRAINT member_notifications_action_tab_check;
ALTER TABLE member_notifications ADD CONSTRAINT member_notifications_action_tab_check CHECK (action_tab IN (
  'members','squads','guilds','guild-workspace','messages','events','social','stores','reservations'
));
