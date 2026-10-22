import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach} from 'node:test';
import {createHostedStorePhotoHarness,photoSourcePng,type HostedStorePhotoHarness} from './hosted-store-photo.js';
import {SupplyOfferPageSchema} from '../../contracts/guild-launchpad/v1/hosted-distribution.js';
import type {Session} from '../runtime/module-registry-harness.js';

export let f:HostedStorePhotoHarness,app:ReturnType<HostedStorePhotoHarness['application']>;
export type Store=Awaited<ReturnType<HostedStorePhotoHarness['openStore']>>;

export function setupSupplyOfferPhotos() {
  before(async()=>{f=await createHostedStorePhotoHarness();});
  after(async()=>{await f?.stop();});
  beforeEach(async()=>{
    await f.reset();
    await f.h.pool.query("UPDATE domain_media_storage_policy SET mode='r2_only',persistence_allowed=true,policy_revision='synthetic-offer-photo',retained_byte_limit=16777216 WHERE purpose='storefront.product-photo'");
    app=f.application(true,{supplierConsoleEnabled:true,supplyOfferPhotosEnabled:true});
  });
}
export const get=(s:Store,path:string,session:Session|undefined=s.owner,target=app)=>f.h.call('GET',s.root+path,session,undefined,{},target);
export const send=(s:Store,path:string,version?:string,body:unknown={},method='POST',key=randomUUID(),session=s.owner,target=app)=>
  f.h.call(method,s.root+path,session,body,{'Idempotency-Key':key,...(version?{'If-Match':`"${version}"`}:{})},target);
export const share=(s:Store,o:any,version='2',key=randomUUID(),session=s.owner)=>send(s,`/supply-offers/${o.offer_id}/photo/share`,version,{},'POST',key,session);
export const stop=(s:Store,o:any,version=o.version)=>send(s,`/supply-offers/${o.offer_id}/photo/stop`,version);
export const page=async(s:Store,o:any,target=app)=>SupplyOfferPageSchema.parse(f.ok(await get(s,`/supply-catalog/${o.offer_id}`,s.owner,target)));
export async function upload(s:Store,version='1') {
  const response=await app.request(f.h.origin+'/api/v1'+s.root+`/products/${s.productId}/photo`,{method:'POST',headers:{
    Origin:f.h.origin,Cookie:s.owner.cookie,'X-CSRF-Token':s.owner.csrf,'Content-Type':'image/png','Idempotency-Key':randomUUID(),'If-Match':`"${version}"`},body:new Uint8Array(photoSourcePng)});
  assert.equal(response.status,200,await response.clone().text());return await response.json() as any;
}
export async function fixture(withPhoto=true) {
  const supplier=await f.openStore(),seller=await f.openStore();
  if(withPhoto)await upload(supplier);
  const offer=f.ok(await send(supplier,`/products/${supplier.productId}/supply-offer`,withPhoto?'2':'1'));
  return {supplier,seller,offer};
}
export async function bytes(s:Store,o:any,seq='1',method='GET',session:Session|null=s.owner,target=app) {
  return target.request(f.h.origin+'/api/v1'+s.root+`/supply-catalog/${o.offer_id}/photo/${seq}`,{method,headers:{...(session?{Cookie:session.cookie}:{}),'If-None-Match':'*'}});
}
export const rows=async(o:any)=>(await f.h.pool.query('SELECT * FROM commerce_hosted_offer_photos WHERE offer_id=$1 ORDER BY seq',[o.offer_id])).rows;
export async function granted(s:Store,capabilities:string[]) {
  const member=(await f.h.person('合成照片操作員')).session,principal=await f.h.candidate(s.owner,member.user.user_id);
  const invitation=await f.h.post(`/tenants/${s.tenantId}/invitations`,s.owner,{invitee_principal_id:principal,role:'operator',instance_capabilities:[{instance_id:s.instanceId,capabilities}],expires_at:new Date(Date.now()+86400000).toISOString()});
  f.ok(invitation,201);await f.h.accept(member,s.tenantId,invitation);return member;
}
