import {LIVE_PUBLIC_ORIGIN} from '../../apps/platform-api/src/routes/published-skills.js';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {before,after,beforeEach,test,type TestContext} from 'node:test';
import sharp from 'sharp';
import type {Pool} from 'pg';
import {createAssetLifecycleWithAuthority,type LifecycleProfile,type LifecyclePrepare} from '../../modules/assets/engine.js';
import {memberLifecycleAuthority} from '../../modules/assets/lifecycle-authority.js';
import {createTenantLifecycleAuthority} from '../../modules/assets/tenant-lifecycle-authority.js';
import {createStorefrontLifecycleAuthority} from '../../modules/assets/storefront-lifecycle-authority.js';
import {createStorefrontAppearanceLifecycleAuthority} from '../../modules/assets/storefront-appearance-authority.js';
import {FakeObjectStore} from '../../packages/asset-storage/fake-store.js';
import {Problem} from '../../packages/shared/problem.js';
import {Hono} from 'hono';
import {nodeRuntime} from '../../apps/platform-api/src/app.js';
import {createHostedStoreAppearanceRoutes,createPublicStoreAppearanceMediaRoutes} from '../../apps/platform-api/src/routes/hosted-store-appearance.js';
import {AppearanceCommandAckSchema,type AppearanceRole} from '../../contracts/guild-launchpad/v1/storefront-appearance.js';
import {createStorefrontAppearanceLifecycle} from '../../modules/assets/storefront-appearance.js';
import {createHostedStorePhotoHarness,photoSourcePng,type HostedStorePhotoHarness} from '../helpers/hosted-store-photo.js';

let f:HostedStorePhotoHarness,assets:ReturnType<typeof createStorefrontAppearanceLifecycle>;
before(async()=>{f=await createHostedStorePhotoHarness();assets=createStorefrontAppearanceLifecycle(f.runtime,{store:f.store});});
after(async()=>{await f?.stop();});beforeEach(async()=>{await f.reset();});
type Store=Awaited<ReturnType<HostedStorePhotoHarness['openStore']>>;
const application=(uploads=true)=>f.application(uploads,{storeAppearanceEnabled:true,storeAppearanceAssets:assets});
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function enable(){await f.h.pool.query("UPDATE domain_media_storage_policy SET mode='r2_only',persistence_allowed=true,policy_revision='synthetic-appearance-media',retained_byte_limit=16777216 WHERE purpose='storefront.product-photo'");}
async function draft(s:Store){return f.ok(await f.h.call('GET',s.root+'/appearance-settings',s.owner,undefined,{},application()));}
async function upload(s:Store,role:AppearanceRole='cover',bytes:Uint8Array=photoSourcePng,expected?:string,key=randomUUID(),app=application()){
  expected??=(await draft(s)).version;
  return app.request(f.h.origin+'/api/v1'+s.root+'/appearance-media/'+role,{method:'POST',headers:{Origin:f.h.origin,Cookie:s.owner.cookie,
    'X-CSRF-Token':s.owner.csrf,'Content-Type':'image/png','Idempotency-Key':key,'If-Match':`"${expected}"`},body:new Uint8Array(bytes)});
}
async function saved(response:Response){assert.equal(response.status,200,await response.clone().text());return AppearanceCommandAckSchema.parse(await response.json());}
async function publish(s:Store){const view=f.ok(await f.h.call('GET',s.root,s.owner,undefined,{},application()));
  return f.ok(await f.h.call('POST',s.root+'/publish',s.owner,{}, {'Idempotency-Key':randomUUID(),'If-Match':`"${view.version}"`},application()));}
async function remove(s:Store,role:AppearanceRole='cover',app=application(false)){
  const d=await draft(s);return app.request(f.h.origin+'/api/v1'+s.root+'/appearance-media/'+role+'/remove',{method:'POST',headers:{Origin:f.h.origin,Cookie:s.owner.cookie,
    'X-CSRF-Token':s.owner.csrf,'Content-Type':'application/json','Idempotency-Key':randomUUID(),'If-Match':`"${d.version}"`},body:'{}'});
}
async function bytes(path:string,member?:Store['owner'],method='GET',app=application()){
  return app.request(f.h.origin+path,{method,headers:member?{Cookie:member.cookie}:{}});
}

test('APPEARANCE-MEDIA-01 default policy refuses new effects; known media installation exposes metadata independently',async()=>{
  const s=await f.openStore(),r=await upload(s);assert.equal(r.status,503);
  assert.equal(f.store.puts,0);assert.equal((await f.h.pool.query('SELECT count(*)::int n FROM assets')).rows[0].n,0);
  const d=await draft(s);assert.equal(d.media_installed,true);assert.equal(d.uploads_enabled,true);
});
test('APPEARANCE-MEDIA-02 cover and square logo share the canonical product profile with typed instance routing and real dimensions',async()=>{
  const s=await f.openStore();await enable();const cover=await sharp({create:{width:120,height:80,channels:3,background:'#5588aa'}}).png().toBuffer();
  const a=await saved(await upload(s,'cover',cover));assert.equal(a.completed_version,'2');assert.equal(a.current.cover?.width,120);assert.equal(a.current.cover?.height,80);
  const b=await saved(await upload(s,'logo'));assert.equal(b.completed_version,'3');assert.equal(b.current.logo?.width,b.current.logo?.height);
  for(const role of ['cover','logo'] as const){
    const image=b.current[role]!;for(const method of ['GET','HEAD']){
      const response=await bytes(image.read_path,s.owner,method);assert.equal(response.status,200);
      assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('Vary'),'Cookie');
      assert.equal(response.headers.get('Content-Type'),'image/webp');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
      assert.equal(response.headers.get('Content-Length'),String(image.byte_size));assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
      const body=new Uint8Array(await response.arrayBuffer());assert.equal(body.length,method==='HEAD'?0:image.byte_size);
      if(method==='GET'){const m=await sharp(body).metadata();assert.equal(m.format,'webp');assert.equal(m.width,image.width);assert.equal(m.height,image.height);assert.equal(m.exif,undefined);}
    }
  }
  const rows=(await f.h.pool.query('SELECT target_kind,target_appearance_id,target_instance_id,target_product_id,purpose FROM asset_upload_intents ORDER BY target_kind')).rows;
  assert.deepEqual(rows.map(r=>r.target_kind),['storefront.cover','storefront.logo']);
  for(const r of rows){assert.equal(r.target_appearance_id,s.instanceId);assert.equal(r.target_instance_id,s.instanceId);assert.equal(r.target_product_id,null);assert.equal(r.purpose,'storefront.product-photo');}
  assert.equal((await bytes(a.current.cover!.read_path,s.owner)).status,404,'private URLs use the exact current profile version');
});
test('APPEARANCE-MEDIA-03 replacement and removal remain frozen until publish; current revision URLs refuse old revisions',async()=>{
  const s=await f.openStore();await enable();await saved(await upload(s));await saved(await upload(s,'logo'));await publish(s);
  const publicPath=`/shops/${s.slug}/appearance-media/1/cover`,logoPath=`/shops/${s.slug}/appearance-media/1/logo`;
  const branded=await(await application().request(f.h.origin+'/shops/'+s.slug)).text();
  assert.ok(branded.includes(`property="og:image" content="${LIVE_PUBLIC_ORIGIN}${publicPath}"`));
  const product=await(await application().request(f.h.origin+'/shops/'+s.slug+'/products/P0001')).text();assert.match(product,/property="og:image" content="[^"]+\/brand\/freedom-workshop.webp"/);
  const old=await bytes(publicPath);assert.equal(old.status,200);const original=new Uint8Array(await old.arrayBuffer());
  const changed=await sharp({create:{width:30,height:20,channels:3,background:'red'}}).png().toBuffer();await saved(await upload(s,'cover',changed));
  assert.equal(hash(new Uint8Array(await(await bytes(publicPath)).arrayBuffer())),hash(original));
  await publish(s);assert.equal((await bytes(publicPath)).status,404);assert.equal((await bytes(logoPath)).status,404);
  const next=`/shops/${s.slug}/appearance-media/2/cover`;assert.equal((await bytes(next)).status,200);
  await f.h.pool.query("UPDATE domain_media_storage_policy SET persistence_allowed=false WHERE purpose='storefront.product-photo'");
  await saved(await remove(s));assert.equal((await bytes(next)).status,200);await publish(s);assert.equal((await bytes(next)).status,404);
  const page=await(await application().request(f.h.origin+'/shops/'+s.slug)).text();assert.doesNotMatch(page,/class="shop-cover"/);assert.match(page,/shop-merchant-logo/);
  assert.match(page,/property="og:image" content="[^"]+\/brand\/freedom-workshop.webp"/);
  assert.equal((await draft(s)).cover,null);assert.equal((await f.h.pool.query('SELECT count(*)::int n FROM assets')).rows[0].n,3,'all replaced/removed objects retained');
});

test('APPEARANCE-MEDIA-07 read-only and store:write-only members cannot upload or remove manage settings',async()=>{
  const s=await f.openStore();await enable();await saved(await upload(s));
  for(const keys of [['store:read'],['store:read','store:write']]){
    const person=(await f.h.person('合成店面圖片權限會員')).session;
    const principal=f.ok(await f.call('GET',`/tenants/invite-candidates?user_id=${person.user.user_id}`,s.owner)).principal_id;
    const invitation=f.ok(await f.post(`/tenants/${s.tenantId}/invitations`,s.owner,{invitee_principal_id:principal,role:'operator',instance_capabilities:[{instance_id:s.instanceId,capabilities:keys}],expires_at:new Date(Date.now()+86400000).toISOString()}),201);
    f.ok(await f.post(`/tenants/${s.tenantId}/invitations/${invitation.invitation_id}/accept`,person,{},invitation.version));
    const member={...s,owner:person};for(const role of ['cover','logo'] as const){assert.equal((await upload(member,role)).status,403);assert.equal((await remove(member,role)).status,403);}
    assert.equal((await bytes((await draft(s)).cover.read_path,person)).status,200,'read capability still reads saved images');
  }
  assert.equal((await draft(s)).version,'2');assert.equal(f.store.puts,1);
});
test('APPEARANCE-MEDIA-08 unknown immutable PUT retries the original intent and records one profile completion',async()=>{
  const s=await f.openStore();await enable();const key=randomUUID();f.store.failNext('put-after');f.store.failNext('get');
  assert.equal((await upload(s,'cover',photoSourcePng,'1',key)).status,503);
  const first=(await f.h.pool.query("SELECT intent_id,asset_id,state FROM asset_upload_intents WHERE target_kind='storefront.cover'")).rows;
  assert.equal(first.length,1);assert.equal(first[0].state,'processing');assert.equal((await draft(s)).cover,null);assert.equal((await draft(s)).version,'1');
  const result=await saved(await upload(s,'cover',photoSourcePng,'1',key));assert.equal(result.completed_version,'2');
  const next=(await f.h.pool.query("SELECT intent_id,asset_id,state FROM asset_upload_intents WHERE target_kind='storefront.cover'")).rows;
  assert.deepEqual(next,[{...first[0],state:'finalized'}]);
  assert.equal((await f.h.pool.query("SELECT count(*)::int n FROM scoped_transition_journal WHERE aggregate_id=$1 AND operation='storefront.cover.upload'",[s.instanceId])).rows[0].n,1);
  assert.equal((await f.h.pool.query("SELECT count(*)::int n FROM scoped_command_receipts WHERE target_id=$1 AND operation='storefront.cover.upload' AND idempotency_key=$2",[s.instanceId,key])).rows[0].n,1);
});
test('APPEARANCE-MEDIA-09 canonical persistence revoked during object IO refuses ready publication',async t=>{
  const s=await f.openStore();await enable();const put=f.store.putImmutable.bind(f.store);
  t.mock.method(f.store,'putImmutable',async(...args:Parameters<typeof put>)=>{const result=await put(...args);await f.h.pool.query("UPDATE domain_media_storage_policy SET persistence_allowed=false WHERE purpose='storefront.product-photo'");return result;});
  assert.equal((await upload(s)).status,503);assert.equal((await draft(s)).cover,null);assert.equal((await draft(s)).version,'1');
  assert.equal((await f.h.pool.query("SELECT count(*)::int n FROM assets WHERE state='ready'")).rows[0].n,0);
  const removed=await saved(await remove(s));assert.equal(removed.changed,false);assert.equal(removed.completed_version,'1');
});
test('APPEARANCE-MEDIA-10 quarantine blocks all four media mutations before receipts, intents or provider effects',async()=>{
  const s=await f.openStore();await enable();const app=f.application(true,{storeAppearanceEnabled:true,storeAppearanceAssets:assets,
    commerceSettings:{checkoutEnabled:false,consoleEnabled:false,quarantine:true,providerProfiles:[]}});
  const before=(await f.h.pool.query('SELECT count(*)::int n FROM scoped_command_receipts')).rows[0].n;
  for(const role of ['cover','logo'] as const){
    assert.equal((await upload(s,role,photoSourcePng,'1',randomUUID(),app)).status,503);
    assert.equal((await remove(s,role,app)).status,503);
  }
  assert.equal(f.store.puts,0);assert.equal((await f.h.pool.query('SELECT count(*)::int n FROM asset_upload_intents')).rows[0].n,0);
  assert.equal((await f.h.pool.query('SELECT count(*)::int n FROM scoped_command_receipts')).rows[0].n,before);
});
test('APPEARANCE-MEDIA-11 flag OFF or absent media binding leaves byte and mutation routes unmounted without deleting retained data',async()=>{
  const s=await f.openStore();await enable();const a=await saved(await upload(s));await publish(s);
  const current=(await draft(s)).cover.read_path,publicPath=`/shops/${s.slug}/appearance-media/1/cover`,gets=f.store.gets;
  const off=f.application(true,{storeAppearanceEnabled:false,storeAppearanceAssets:assets});
  const noMedia=f.application(true,{storeAppearanceEnabled:true,storePhotoAssetStore:undefined,storeAppearanceAssets:assets});
  for(const app of [off,noMedia]){
    for(const path of [current,publicPath])for(const method of ['GET','HEAD'])assert.equal((await bytes(path,s.owner,method,app)).status,404);
    assert.equal((await upload(s,'cover',photoSourcePng,a.current.version,randomUUID(),app)).status,404);
    assert.equal((await remove(s,'cover',app)).status,404);
  }
  assert.equal(f.store.gets,gets);assert.equal((await bytes(publicPath)).status,200);
  const html=await(await off.request(f.h.origin+'/shops/'+s.slug)).text();assert.doesNotMatch(html,/shop-cover|data-shop-accent|appearance-media/);
  for(const value of [s.tenantId,s.instanceId,s.productId,s.owner.user.email])assert.ok(!html.includes(value));
});

test('APPEARANCE-MEDIA-12 manage without product write can upload; revocation refuses original receipt replay and private bytes',async()=>{
  const s=await f.openStore();await enable();const person=(await f.h.person('合成外觀管理會員')).session;
  const principal=f.ok(await f.call('GET',`/tenants/invite-candidates?user_id=${person.user.user_id}`,s.owner)).principal_id;
  const invitation=f.ok(await f.post(`/tenants/${s.tenantId}/invitations`,s.owner,{invitee_principal_id:principal,role:'operator',instance_capabilities:[{instance_id:s.instanceId,capabilities:['store:read','store:manage']}],expires_at:new Date(Date.now()+86400000).toISOString()}),201);
  f.ok(await f.post(`/tenants/${s.tenantId}/invitations/${invitation.invitation_id}/accept`,person,{},invitation.version));
  const member={...s,owner:person},key=randomUUID(),a=await saved(await upload(member,'cover',photoSourcePng,'1',key));await publish(s);
  const privatePath=(await draft(s)).cover.read_path;assert.equal((await bytes(privatePath,person)).status,200);
  const membership=f.ok(await f.call('GET',`/tenants/${s.tenantId}/members`,s.owner)).items.find((m:any)=>m.principal_id===principal);
  f.ok(await f.post(`/tenants/${s.tenantId}/members/${principal}/change`,s.owner,{role:'operator',status:'active',instance_capabilities:[],reason:'撤銷合成外觀管理'},membership.version));
  assert.equal((await upload(member,'cover',photoSourcePng,'1',key)).status,404);
  assert.equal((await bytes(privatePath,person)).status,404);
  assert.equal((await bytes(`/shops/${s.slug}/appearance-media/1/cover`)).status,200);
});

test('APPEARANCE-MEDIA-13 the existing product-photo quota counts covers, logos and removed retained bytes together',async()=>{
  const s=await f.openStore();await enable();await saved(await upload(s));
  await f.h.pool.query("UPDATE domain_media_storage_policy SET retained_byte_limit=1048576 WHERE purpose='storefront.product-photo'");
  const logo=await upload(s,'logo');assert.equal(logo.status,409);assert.equal((await logo.json() as any).code,'asset_retained_quota');
  const product=await f.app.request(f.h.origin+'/api/v1'+s.root+'/products/'+s.productId+'/photo',{method:'POST',headers:{Origin:f.h.origin,Cookie:s.owner.cookie,
    'X-CSRF-Token':s.owner.csrf,'Content-Type':'image/png','Idempotency-Key':randomUUID(),'If-Match':'"1"'},body:new Uint8Array(photoSourcePng)});
  assert.equal(product.status,409);assert.equal((await product.json() as any).code,'asset_retained_quota');
  await saved(await remove(s));assert.equal((await upload(s)).status,409,'removal cannot release retained storage quota');
  const d=await draft(s),metadata=await f.h.call('PATCH',s.root+'/appearance-settings',s.owner,{template_id:'catalog-grid-v1',accent_preset:'forest',announcement:'無須媒體容量的合成公告',featured_product_ids:[]},
    {'Idempotency-Key':randomUUID(),'If-Match':`"${d.version}"`},application());
  f.ok(metadata);assert.equal(metadata.data.current.accent_preset,'forest');assert.equal(f.store.puts,1);
});
test('APPEARANCE-MEDIA-04 non-square and malformed sources are known refusals before intent admission',async()=>{
  const s=await f.openStore();await enable();const rectangle=await sharp({create:{width:20,height:10,channels:3,background:'blue'}}).png().toBuffer();
  const r=await upload(s,'logo',rectangle);assert.equal(r.status,422);const error=await r.json() as any;assert.equal(error.code,'appearance_logo_not_square');assert.equal(error.detail,'店標請使用正方形圖片。');
  const malformed=await upload(s,'cover',Buffer.from('not an image'));assert.equal(malformed.status,422);assert.equal((await malformed.json() as any).code,'invalid_appearance_image');
  assert.equal(f.store.puts,0);assert.equal((await f.h.pool.query('SELECT count(*)::int n FROM asset_upload_intents')).rows[0].n,0);
});
test('APPEARANCE-MEDIA-05 original receipt replay precedes new-upload policy and decoder; current ACK may be newer',async()=>{
  const s=await f.openStore();await enable();const key=randomUUID(),a=await saved(await upload(s,'cover',photoSourcePng,'1',key));
  const b=await saved(await upload(s,'logo'));assert.equal(b.completed_version,'3');
  await f.h.pool.query("UPDATE domain_media_storage_policy SET persistence_allowed=false WHERE purpose='storefront.product-photo'");
  const app=f.application(false,{storeAppearanceEnabled:true,storeAppearanceAssets:undefined}),puts=f.store.puts;
  const replay=await saved(await upload(s,'cover',photoSourcePng,'1',key,app));assert.equal(replay.completed_version,a.completed_version);assert.equal(replay.current.version,b.current.version);assert.equal(f.store.puts,puts);
  const changed=await upload(s,'cover',Buffer.from('different'),'1',key,app);assert.equal(changed.status,409);assert.equal((await changed.json() as any).code,'idempotency_conflict');
});
test('APPEARANCE-MEDIA-06 GET and HEAD revalidate authorization after full object verification, including a mid-read publication change',async()=>{
  const s=await f.openStore();await enable();const a=await saved(await upload(s));await publish(s);const path=`/shops/${s.slug}/appearance-media/1/cover`;
  const before=f.store.gets;assert.equal((await bytes(path,undefined,'HEAD')).status,200);assert.ok(f.store.gets>before);
  f.store.afterGet=async()=>{f.store.afterGet=undefined;await f.h.pool.query('UPDATE commerce_storefront_profiles SET current_publication_id=NULL,version=version+1 WHERE instance_id=$1',[s.instanceId]);};
  assert.equal((await bytes(path)).status,404);
  const current=await draft(s);
  f.store.afterGet=async()=>{f.store.afterGet=undefined;await f.h.pool.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1',[s.actor.session_hash]);};
  assert.ok([401,404].includes((await bytes(current.cover!.read_path,s.owner)).status));
});


test('APPEARANCE-MEDIA-14 the closed manage authority cannot substitute for product/Work authority or be copied',()=>{
  let touched=false;const fail=async()=>{touched=true;throw Error('unexpected appearance port');};
  const authority=createStorefrontAppearanceLifecycleAuthority(),old=createStorefrontLifecycleAuthority();
  const definition:LifecycleProfile<LifecyclePrepare,never,any,any>={purpose:'storefront.product-photo',targetKind:'storefront.cover',
    variant:'image',inputMaxBytes:2097152,outputMaxBytes:1048576,retireReplacedAsset:false,parsePrepare:value=>value,targetId:()=>'',
    lockTarget:fail,resolvePolicy:fail,requireCapacity:fail,prepareRepresentation:fail,lockPublication:fail,publish:fail};
  const make=(profile=definition,port:any=authority)=>createAssetLifecycleWithAuthority({} as Pool,{store:new FakeObjectStore()},profile,port);
  for(const targetKind of ['storefront.cover','storefront.logo'] as const){
    const profile={...definition,targetKind};assert.doesNotThrow(()=>make(profile));
    for(const wrong of [memberLifecycleAuthority,createTenantLifecycleAuthority(),old,{...authority}])
      assert.throws(()=>make(profile,wrong),(e:unknown)=>e instanceof Problem&&e.code==='asset_authority_profile_invalid');
    for(const change of [{retireReplacedAsset:true},{inputMaxBytes:2097153},{outputMaxBytes:1048577},{variant:'cover' as const}])
      assert.throws(()=>make({...profile,...change}),(e:unknown)=>e instanceof Problem&&e.code==='asset_profile_invalid');
  }
  for(const targetKind of ['storefront.product-photo','storefront.distribution-photo','storefront.supply-material','work.tenant-result'] as const)
    assert.throws(()=>make({...definition,targetKind}),(e:unknown)=>e instanceof Problem&&e.code==='asset_authority_profile_invalid');
  assert.equal(touched,false);
});

test('APPEARANCE-MEDIA-15 appearance routers preserve unrelated API and static response headers',async()=>{
  const runtime=nodeRuntime('local',f.h.origin,{guildLaunchpadEnabled:true,storeAppearanceEnabled:true,storePhotoAssetStore:f.store});
  for(const [mount,router,path] of [
    ['/api/v1',createHostedStoreAppearanceRoutes(f.runtime,runtime),'/api/v1/unrelated-fixture'],
    ['/',createPublicStoreAppearanceMediaRoutes(f.runtime,runtime),'/unrelated-fixture.css'],
  ] as const){
    const baseline=new Hono().get(path,c=>c.text('synthetic unaffected response'));
    const installed=new Hono().route(mount,router).get(path,c=>c.text('synthetic unaffected response'));
    const before=await baseline.request(f.h.origin+path),after=await installed.request(f.h.origin+path);
    assert.equal(after.status,before.status);assert.equal(await after.text(),await before.text());
    assert.deepEqual(Object.fromEntries(after.headers),Object.fromEntries(before.headers),'Appearance cache/noindex/Vary headers belong only to appearance routes.');
  }
});

function delayedPut(t:TestContext){
  let entered!:()=>void,release!:()=>void,first=true;
  const reached=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  const put=f.store.putImmutable.bind(f.store);
  t.mock.method(f.store,'putImmutable',async(...args:Parameters<typeof put>)=>{
    const wait=first;first=false;const result=await put(...args);
    if(wait){entered();await gate;}return result;
  });
  return {release,async reached(pending:Promise<Response>){await Promise.race([reached,pending.then(()=>assert.fail('The upload must reach the unlocked object-store gate.'))]);}};
}
async function refusedPublication(s:Store,role:AppearanceRole,key:string){
  const row=(await f.h.pool.query(`SELECT i.intent_id,i.state,a.state AS asset_state,t.asset_id AS pointer FROM asset_upload_intents i
    JOIN assets a USING(asset_id) JOIN commerce_storefront_appearance_targets t ON t.tenant_id=i.target_tenant_id AND t.instance_id=i.target_instance_id AND t.kind=i.target_kind
    WHERE i.target_instance_id=$1 AND i.target_kind=$2`,[s.instanceId,'storefront.'+role])).rows;
  assert.equal(row.length,1);assert.equal(row[0].asset_state,'pending');assert.equal(row[0].pointer,null);assert.notEqual(row[0].state,'finalized');
  assert.equal((await f.h.pool.query(`SELECT count(*)::int n FROM scoped_command_receipts
    WHERE (target_id=$1 AND operation=$2 AND idempotency_key=$3) OR (target_id=$4 AND operation='asset.upload.finalize')`,
  [s.instanceId,'storefront.'+role+'.upload',key,row[0].intent_id])).rows[0].n,0);
  assert.equal((await f.h.pool.query('SELECT count(*)::int n FROM scoped_transition_journal WHERE aggregate_id=$1 AND operation=$2',
    [s.instanceId,'storefront.'+role+'.upload'])).rows[0].n,0);
  return row[0];
}
test('APPEARANCE-MEDIA-16 a profile edit during delayed object IO refuses stale cover finalization and its success receipt',async t=>{
  const s=await f.openStore();await enable();const gate=delayedPut(t),key=randomUUID(),pending=upload(s,'cover',photoSourcePng,'1',key);
  try{
    await gate.reached(pending);
    f.ok(await f.h.call('PATCH',s.root+'/appearance-settings',s.owner,{template_id:'catalog-grid-v1',accent_preset:'forest',announcement:'合成同步修改',featured_product_ids:[]},
      {'Idempotency-Key':randomUUID(),'If-Match':'"1"'},application()));
  }finally{gate.release();}
  const response=await pending;assert.equal(response.status,412);assert.equal((await response.json() as any).code,'version_conflict');
  await refusedPublication(s,'cover',key);assert.equal((await draft(s)).version,'2');
});
test('APPEARANCE-MEDIA-17 lease takeover during delayed object IO fences the original writer without a ready pointer or receipt',async t=>{
  const s=await f.openStore();await enable();const gate=delayedPut(t),key=randomUUID(),pending=upload(s,'logo',photoSourcePng,'1',key);
  try{
    await gate.reached(pending);
    const intent=(await f.h.pool.query("SELECT intent_id,fence,lease_token FROM asset_upload_intents WHERE target_kind='storefront.logo'")).rows[0];
    await f.h.pool.query("UPDATE asset_upload_intents SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE intent_id=$1",[intent.intent_id]);
    const api=await assets.forRole('logo',{mime:'image/png',bytes:photoSourcePng});
    const lease=await api.claim({...s.actor,tenant_id:s.tenantId,instance_id:s.instanceId},{key:randomUUID(),intentId:intent.intent_id});
    assert.equal(lease.fence,String(BigInt(intent.fence)+1n));assert.notEqual(lease.leaseToken,intent.lease_token);
  }finally{gate.release();}
  const response=await pending;assert.equal(response.status,409);assert.equal((await response.json() as any).code,'asset_lease_stale');
  const row=await refusedPublication(s,'logo',key);assert.equal(row.state,'processing');assert.equal((await draft(s)).version,'1');
  assert.equal((await f.h.pool.query('SELECT count(*)::int n FROM scoped_command_receipts WHERE target_id=$1 AND operation=\'asset.upload.write\'',[row.intent_id])).rows[0].n,0);
});
test('APPEARANCE-MEDIA-18 session expiry during delayed object IO refuses storage completion, ready publication and the success receipt',async t=>{
  const s=await f.openStore();await enable();const gate=delayedPut(t),key=randomUUID(),pending=upload(s,'cover',photoSourcePng,'1',key);
  try{
    await gate.reached(pending);
    await f.h.pool.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1",[s.actor.session_hash]);
  }finally{gate.release();}
  const response=await pending;assert.equal(response.status,401);assert.equal((await response.json() as any).code,'session_expired');
  const row=await refusedPublication(s,'cover',key);assert.equal(row.state,'processing');
  assert.equal((await f.h.pool.query('SELECT version::text FROM commerce_storefront_profiles WHERE instance_id=$1',[s.instanceId])).rows[0].version,'1');
  assert.equal((await f.h.pool.query('SELECT count(*)::int n FROM scoped_command_receipts WHERE target_id=$1 AND operation=\'asset.upload.write\'',[row.intent_id])).rows[0].n,0);
});
test('APPEARANCE-MEDIA-19 cover and logo finalizations serialize on the same profile CAS across delayed object IO',async t=>{
  const s=await f.openStore();await enable();const gate=delayedPut(t),key=randomUUID(),pending=upload(s,'cover',photoSourcePng,'1',key);
  let winner!:Awaited<ReturnType<typeof saved>>;
  try{
    await gate.reached(pending);winner=await saved(await upload(s,'logo',photoSourcePng,'1'));
    assert.equal(winner.completed_version,'2');assert.equal(winner.current.cover,null);assert.ok(winner.current.logo);
  }finally{gate.release();}
  const response=await pending;assert.equal(response.status,412);assert.equal((await response.json() as any).code,'version_conflict');
  await refusedPublication(s,'cover',key);
  const current=await draft(s);assert.equal(current.version,'2');assert.equal(current.cover,null);assert.deepEqual(current.logo,winner.current.logo);
  assert.equal((await f.h.pool.query("SELECT count(*)::int n FROM assets WHERE state='ready'")).rows[0].n,1);
  assert.deepEqual((await f.h.pool.query("SELECT operation,count(*)::int n FROM scoped_command_receipts WHERE operation IN ('storefront.cover.upload','storefront.logo.upload') GROUP BY operation")).rows,
    [{operation:'storefront.logo.upload',n:1}]);
});
