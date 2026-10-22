import { commerceOrderNotificationsInstalled } from '../routes/hosted-checkout.js';
import { readNotificationPreferences, saveNotificationPreferences, readNotificationReminders, readNotificationSummary, readChannelReminderCounts, readFollowingReminders, readEventBulletinReminders } from '../../../../modules/member-communications/notification-preferences.js';
import { cmd, routeId, respond } from './commands.js';
import type { PlatformFeatureApp, PlatformFeatureContext } from './context.js';

/** Registered at its original position; common request boundaries stay in the host. */
export function registerNotificationPreferenceRoutes(app: PlatformFeatureApp, context: PlatformFeatureContext) {
  const { pool, runtime } = context;
  if(runtime.notificationPreferencesEnabled===true){
    const followingEnabled=runtime.communitySearchEnabled===true&&runtime.communityRelationsEnabled===true;
    app.get('/api/v1/me/notification-preferences',async c=>{
      const preferences=await readNotificationPreferences(pool,c.get('actor'),followingEnabled);
      c.header('ETag',`"${preferences.version}"`);
      return c.json(preferences);
    });
    app.patch('/api/v1/me/notification-preferences',async c=>{
      const preferences=await saveNotificationPreferences(pool,await cmd(c),followingEnabled);
      c.header('ETag',`"${preferences.version}"`);
      return c.json(preferences);
    });
    app.get('/api/v1/me/notification-preferences/reminders',async c=>c.json(await readNotificationReminders(pool,c.get('actor'),followingEnabled,runtime.now?.()??new Date(),commerceOrderNotificationsInstalled(runtime))));
    app.get('/api/v1/me/notification-preferences/summary',async c=>c.json(await readNotificationSummary(pool,c.get('actor'),followingEnabled,runtime.now?.()??new Date())));
    app.get('/api/v1/me/notification-preferences/channel-reminders',async c=>c.json(await readChannelReminderCounts(pool,c.get('actor'),runtime.now?.()??new Date())));
    app.get('/api/v1/me/notification-preferences/following-reminders',async c=>c.json(await readFollowingReminders(pool,c.get('actor'),followingEnabled,runtime.now?.()??new Date())));
    app.get('/api/v1/me/notification-preferences/event-reminders',async c=>c.json(await readEventBulletinReminders(pool,c.get('actor'),runtime.now?.()??new Date())));
  }
}
