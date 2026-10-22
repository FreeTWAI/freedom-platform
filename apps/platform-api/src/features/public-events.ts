import { type Context } from 'hono';
import { z } from 'zod';
import { requireCondition } from '../../../../packages/shared/problem.js';
import { authRateLimit } from '../../../../modules/identity-membership/members.js';
import { registerPublicEvent } from '../../../../modules/community/events.js';
import { readGuestEventCalendar } from '../../../../modules/community/event-calendar.js';
import { readGuestEventReminder, saveGuestEventReminder } from '../../../../modules/community/event-reminders.js';
import { mutateGuestEventParticipation, processEventWaitlist, readGuestEventParticipation, requestGuestEventParticipation } from '../../../../modules/community/event-waitlist.js';
import type { PlatformFeatureApp, PlatformFeatureContext } from './context.js';

/** Registered at its original position; common request boundaries stay in the host. */
export function registerPublicEventParticipationRoutes(app: PlatformFeatureApp, context: PlatformFeatureContext) {
  const { pool, origin, runtime, authNetwork } = context;
  const dispatchGuest=async(eventId:string)=>processEventWaitlist(pool,async(to,subject,body)=>{requireCondition(runtime.eventEmailSender,503,'event_email_unavailable','活動郵件服務暫時無法使用。');await runtime.eventEmailSender(to,subject,body);},origin,undefined,eventId);
  if(runtime.eventParticipationEnabled===true){
    const guestMutation=async(c:Context)=>{
      const body=await c.req.json(),version=c.req.header('If-Match')??'',key=c.req.header('Idempotency-Key')??'';
      requireCondition(/^"[1-9][0-9]*"$/.test(version)&&Number.isSafeInteger(Number(version.slice(1,-1))),version?400:428,'version_required','請提供有效的 If-Match 版本。');
      requireCondition(String(body?.expected_version)===version.slice(1,-1),400,'version_mismatch','內容版本必須與 If-Match 相同。');
      requireCondition(/^[A-Za-z0-9_-]{8,128}$/.test(key),400,'idempotency_required','請提供有效的 Idempotency-Key。');
      return {body,key,token:c.req.header('X-Event-Participation-Token')??''};
    };
    app.get('/api/v1/public/events/:id/participation',async c=>c.json(await readGuestEventParticipation(pool,z.uuid().parse(c.req.param('id')),c.req.header('X-Event-Participation-Token')??'')));
    app.get('/api/v1/public/events/:id/calendar',async c=>c.json(await readGuestEventCalendar(pool,z.uuid().parse(c.req.param('id')),c.req.header('X-Event-Participation-Token')??'')));
    app.get('/api/v1/public/events/:id/reminder',async c=>c.json(await readGuestEventReminder(pool,z.uuid().parse(c.req.param('id')),c.req.header('X-Event-Participation-Token')??'')));
    app.post('/api/v1/public/events/:id/participation',async c=>{
      const {body,key,token}=await guestMutation(c),eventId=z.uuid().parse(c.req.param('id'));
      const result=await mutateGuestEventParticipation(pool,eventId,token,body,key);await dispatchGuest(eventId);return c.json(result);
    });
    app.patch('/api/v1/public/events/:id/reminder',async c=>{
      const {body,key,token}=await guestMutation(c);
      requireCondition(body.command_id===key,400,'idempotency_mismatch','內容命令識別碼必須與 Idempotency-Key 相同。');
      return c.json(await saveGuestEventReminder(pool,z.uuid().parse(c.req.param('id')),token,body));
    });
    app.post('/api/v1/public/events/:id/participation-request',async c=>{
      requireCondition(runtime.eventEmailSender,503,'event_email_unavailable','活動郵件服務暫時無法使用。');
      const body=await c.req.json(),email=z.email().max(200).parse(body?.email).trim().toLowerCase();
      await authRateLimit(pool,'event-register-network',authNetwork(c),10,3600);
      await authRateLimit(pool,'event-register-email',email,3,3600);
      await authRateLimit(pool,'event-register-global','global',300,3600);
      return c.json(await requestGuestEventParticipation(pool,z.uuid().parse(c.req.param('id')),body,runtime.eventEmailSender,origin));
    });
  }
  app.post('/api/v1/public/events/:id/register',async c=>{
    requireCondition(runtime.eventEmailSender,503,'event_email_unavailable','活動郵件服務暫時無法使用。');
    const body=await c.req.json();
    const email=z.email().max(200).parse(body?.email).trim().toLowerCase();
    await authRateLimit(pool,'event-register-network',authNetwork(c),10,3600);
    await authRateLimit(pool,'event-register-email',email,3,3600);
    await authRateLimit(pool,'event-register-global','global',300,3600);
    const eventId=z.uuid().parse(c.req.param('id'));
    const result=await registerPublicEvent(pool,eventId,body,runtime.eventEmailSender,origin,runtime.eventParticipationEnabled===true);
    if(runtime.eventParticipationEnabled===true)await dispatchGuest(eventId);
    return c.json(result);
  });
}
