/** Registration/envelope tests only; synthetic pool is NOT PostgreSQL evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import type {Pool} from 'pg';
import {createApp} from '../../apps/platform-api/src/app.js';
const origin='http://127.0.0.1:4310';
function fixture(enabled?:boolean){let queries=0;const fail=async()=>{queries++;throw Error('unexpected database access');};return {app:createApp({query:fail,connect:fail} as unknown as Pool,origin,'local',{communityCertificationEnabled:enabled}),queries:()=>queries};}
for(const enabled of [undefined,false,true])test(`certification registration and site flag are explicitly ${String(enabled)}`,async()=>{
 const {app,queries}=fixture(enabled),paths=app.routes.map(route=>`${route.method} ${route.path}`);
 for(const path of ['GET /api/v1/me/community-certification','POST /api/v1/me/community-certification/apply','POST /api/v1/me/community-certification/display','POST /api/v1/me/community-certification/withdraw','GET /admin/api/community-certifications','POST /admin/api/community-certifications/:id/review'])assert.equal(paths.includes(path),enabled===true,path);
 const response=await app.request(origin+'/api/v1/site');assert.equal(response.status,200);assert.equal((await response.json() as any).community_certification_enabled,enabled===true);assert.equal(queries(),0);
});
for(const action of ['', '/apply','/display','/withdraw'])test(`member certification ${action||'read'} cannot enter through missing cookie`,async()=>{
 const {app,queries}=fixture(true),response=await app.request(origin+'/api/v1/me/community-certification'+action,{method:action?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json'},body:action?'{}':undefined});assert.equal(response.status,401);assert.equal(queries(),0);
});
test('unrelated feature flags never enable community certification',()=>{
 const fail=async()=>{throw Error('unexpected DB');},app=createApp({query:fail,connect:fail} as unknown as Pool,origin,'local',{personalContentEnabled:true,communityDiscoveryEnabled:true,memberBlockingEnabled:true});
 assert.equal(app.routes.some(route=>route.path.includes('community-certification')),false);
});
