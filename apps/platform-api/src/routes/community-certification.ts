import {Hono,type Context} from 'hono';
import type {Pool} from 'pg';
import {moduleCommand,type PlatformEnv} from '../module-context.js';
import {readSessionCookie} from '../session-cookie.js';
import {authenticate} from '../../../../modules/identity-membership/service.js';
import type {AdminActor,AdminCommand} from '../../../../modules/platform-admin/service.js';
import type {AdminAccessVerifier} from '../../../../modules/platform-admin/access.js';
import {Problem,requireCondition} from '../../../../packages/shared/problem.js';
import {changeOwnCertification,ownCertification,certificationQueue,reviewCertification} from '../../../../modules/community-certification/service.js';

type AdminEnv={Variables:{admin:AdminActor;adminCsrf:string}};
export function createCommunityCertificationRoutes(pool:Pool){
 const app=new Hono<PlatformEnv>();
 app.use('/me/community-certification*',async(c,next)=>{c.header('Cache-Control','private, no-store');c.header('Vary','Cookie');await next();});
 app.get('/me/community-certification',async c=>{const value=await ownCertification(pool,c.get('actor'));c.header('ETag',`"${value.aggregate_version}"`);return c.json(value);});
 for(const action of ['apply','withdraw','display'] as const)app.post(`/me/community-certification/${action}`,async c=>{
  const input=await moduleCommand(c);input.operation=`POST /api/v1/me/community-certification/${action}`;
  const value=await changeOwnCertification(pool,input,action);c.header('ETag',`"${value.aggregate_version}"`);return c.json(value);
 });
 return app;
}
/** Mounted only inside existing Access/admin/CSRF middleware. */
export function createCommunityCertificationAdminRoutes(pool:Pool,verify:AdminAccessVerifier,origin:string,command:(c:Context<AdminEnv>)=>Promise<AdminCommand>){
 const app=new Hono<AdminEnv>();
 const revalidate=(c:Context<AdminEnv>)=>async()=>{
  const identity=await verify(c.req.raw),admin=c.get('admin');
  requireCondition(identity.subject===admin.subject&&identity.email===admin.email&&identity.csrfToken===c.get('adminCsrf'),401,'admin_identity_rejected','管理員驗證已失效，請重新登入。');
 };
 app.use('*',async(c,next)=>{c.header('Cache-Control','private, no-store');c.header('Vary','Cookie');await next();});
 app.get('/',async c=>c.json(await certificationQueue(pool,c.get('admin'),c.req.query(),revalidate(c))));
 app.post('/:id/review',async c=>{
  const input=await command(c),id=c.req.param('id').toLowerCase();input.operation=`POST /admin/api/community-certifications/${id}/review`;
  const member=await authenticate(pool,readSessionCookie(c.req.header('Cookie'),origin)).catch(error=>{if(error instanceof Problem&&error.status===401)throw new Problem(409,'certification_reviewer_session_required','請先在會員入口登入與管理員驗證信箱相同的帳號，再返回審核。');throw error;});
  return c.json(await reviewCertification(pool,input,member,id,revalidate(c)));
 });
 return app;
}
