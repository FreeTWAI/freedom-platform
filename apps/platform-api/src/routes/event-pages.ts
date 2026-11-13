import {publicUpcomingEvents,publicEventCalendar} from '../../../../modules/community/event-exposure.js';
import {Hono} from 'hono';
import {z} from 'zod';
import type {Pool} from 'pg';
import {authenticate,type Actor} from '../../../../modules/identity-membership/service.js';
import {Problem} from '../../../../packages/shared/problem.js';
import {readWithMemberSession} from '../../../../packages/db/member-session.js';
import {readSessionCookie} from '../session-cookie.js';
import {eventPageData,eventPageHtml} from '../../../../modules/community/event-page.js';
import {generateEventCalendar} from '../../../../modules/community/event-calendar.js';
export function createEventPageRoutes(pool:Pool,origin:string,participation:boolean,email:boolean){
 const app=new Hono();
 app.get('/api/v1/public/events',async c=>{c.header('Cache-Control','no-store');return c.json({items:await publicUpcomingEvents(pool)});});
 if(participation)app.get('/events.ics',async c=>{c.header('Cache-Control','no-store');c.header('Content-Type','text/calendar; charset=utf-8');return c.body(await publicEventCalendar(pool));});
 async function viewer(cookie?:string){let actor:Actor|null=null;const token=readSessionCookie(cookie,origin);if(token)try{actor=await authenticate(pool,token);}catch(e){if(!(e instanceof Problem&&e.status===401))throw e;}return actor?.onboarding_required&&!actor.onboarding_completed_at?null:actor;}
 async function read(id:string,actor:Actor|null){return actor?readWithMemberSession(pool,actor,q=>eventPageData(q,id,actor)):eventPageData(pool,id,null);}
 app.get('/events/:id',async(c,next)=>{
  if(c.req.query('app')==='1')return next();
  const actor=await viewer(c.req.header('Cookie')),event=await read(z.uuid().parse(c.req.param('id')),actor);
  c.header('Cache-Control','private, no-store');c.header('Vary','Cookie');
  if(event.visibility!=='open')c.header('X-Robots-Tag','noindex, nofollow');
  const refs=c.req.queries('ref')??[],referralCode=refs.length===1&&/^[A-Za-z0-9_-]{16,32}$/.test(refs[0])?refs[0]:undefined;
  return c.html(eventPageHtml(event,origin,{member:Boolean(actor),participation,guest:participation&&email,referralCode}));
 });
 if(participation)app.get('/events/:id/calendar.ics',async c=>{
  const actor=await viewer(c.req.header('Cookie')),event=await read(z.uuid().parse(c.req.param('id')),actor),result=generateEventCalendar(event);
  c.header('Cache-Control','private, no-store');c.header('Vary','Cookie');c.header('Content-Type','text/calendar; charset=utf-8');c.header('Content-Disposition',`attachment; filename="${result.filename}"`);return c.body(result.calendar);
 });
 return app;
}
