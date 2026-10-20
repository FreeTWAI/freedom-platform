import {GalleryCommandAckSchema,ProductGalleryDraftSchema} from '../../../contracts/guild-launchpad/v1/storefront-gallery.js';
import {createStorefrontGalleryLifecycle} from '../../../modules/assets/storefront-gallery.js';
import {retainedByteUsage} from '../../../modules/opportunity-project-work/tenant-capacity.js';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import sharp from 'sharp';
import {createApp} from '../../../apps/platform-api/src/app.js';
import {ProductViewSchema,StoreViewSchema} from '../../../contracts/guild-launchpad/v1/storefront.js';
import {ProductMediaCommandSchema,PublicStoreMediaSchema} from '../../../contracts/guild-launchpad/v1/hosted-store-media.js';
import {createStorefrontProductPhotoLifecycle} from '../../../modules/assets/storefront-product-photo.js';
import {createStorefrontAppearanceLifecycle} from '../../../modules/assets/storefront-appearance.js';
import {AppearanceCommandAckSchema,StorefrontAppearanceDraftSchema} from '../../../contracts/guild-launchpad/v1/storefront-appearance.js';
import {readVerifiedObject,type ObjectStore,type AssetObjectKey,type ObjectMetadata} from '../../../packages/asset-storage/index.js';
import {TENANT_CURSOR_TEST_KEY} from '../../runtime/tenant-cursor-fixture.js';
import {memberHeaders,origin,restoreMember,type RestoreMember} from './media-restore-fixtures.js';

/** Reuses the restore drill's canonical restricted role and native R2 ports.
 * No schema, role, fake store, provider or production policy is installed here. */
export function storefrontPhotoApp(runtime:Pool,store:ObjectStore,reader=true,uploads=false){
  return createApp(runtime,origin,'local',{guildLaunchpadEnabled:true,tenantCursorSigningKey:TENANT_CURSOR_TEST_KEY,
    ...(reader?{storePhotoAssetStore:store}:{}),
    ...(reader&&uploads?{storePhotoAssets:createStorefrontProductPhotoLifecycle(runtime,{store}),storePhotoUploadsEnabled:true}:{}),
    linkPreviewFetch:async()=>{throw Error('photo_restore_must_not_fetch_outbound');}});
}
type App=ReturnType<typeof storefrontPhotoApp>;
async function json(app:App,path:string,member:RestoreMember,body?:unknown,version?:string,status=200){
  const response=await app.request(origin+path,{method:body===undefined?'GET':'POST',headers:{...memberHeaders(member),
    ...(body===undefined?{}:{'Content-Type':'application/json','Idempotency-Key':randomUUID()}),
    ...(version===undefined?{}:{'If-Match':`"${version}"`})},body:body===undefined?undefined:JSON.stringify(body)});
  assert.equal(response.status,status,await response.clone().text());return await response.json() as Record<string,any>;
}
export async function publishRestoredPhotos(app:App,root:string,member:RestoreMember){
  const view=StoreViewSchema.parse(await json(app,root,member));
  assert(view.version,'The fixture store must be set up before publishing.');
  await json(app,root+'/publish',member,{},view.version);
}
async function publicMedia(app:App,slug:string){
  const response=await app.request(origin+'/api/v1/public/stores/'+slug+'/media');
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  return PublicStoreMediaSchema.parse(await response.json());
}

/** Full retained rows, including the removed product's routing and old refs.
 * These queries run only on the drill's owner pool; application reads use HTTP. */
export async function storefrontPhotoSnapshot(pool:Pool,tenantId:string,instanceId:string){
  const profile='SELECT supply_shop_id,storefront_shop_id FROM commerce_storefront_profiles WHERE tenant_id=$1 AND instance_id=$2';
  const intents='SELECT asset_id FROM asset_upload_intents WHERE target_tenant_id=$1 AND target_instance_id=$2';
  const queries={
    profiles:'SELECT to_jsonb(t) value FROM commerce_storefront_profiles t WHERE tenant_id=$1 AND instance_id=$2',
    publications:'SELECT to_jsonb(t) value FROM commerce_storefront_publications t WHERE tenant_id=$1 AND instance_id=$2',
    refs:'SELECT to_jsonb(t) value FROM commerce_publication_photo_refs t WHERE tenant_id=$1 AND instance_id=$2',
    targets:'SELECT to_jsonb(t) value FROM commerce_product_photo_targets t WHERE tenant_id=$1 AND instance_id=$2',
    items:`SELECT to_jsonb(t) value FROM commerce_items t WHERE shop_id IN (SELECT supply_shop_id FROM (${profile}) p)`,
    selections:`SELECT to_jsonb(t) value FROM commerce_selections t WHERE shop_id IN (SELECT storefront_shop_id FROM (${profile}) p)`,
    shops:`SELECT to_jsonb(t) value FROM commerce_shops t WHERE shop_id IN (SELECT supply_shop_id FROM (${profile}) p UNION SELECT storefront_shop_id FROM (${profile}) p)`,
    mappings:'SELECT to_jsonb(t) value FROM commerce_resource_tenants t WHERE tenant_id=$1 AND instance_id=$2',
    assets:`SELECT to_jsonb(t) value FROM assets t WHERE asset_id IN (${intents})`,
    objects:`SELECT to_jsonb(t) value FROM asset_objects t WHERE asset_id IN (${intents})`,
    intents:'SELECT to_jsonb(t) value FROM asset_upload_intents t WHERE target_tenant_id=$1 AND target_instance_id=$2',
    effects:`SELECT to_jsonb(t) value FROM asset_object_write_effects t WHERE asset_id IN (${intents})`,
    galleryGroups:'SELECT to_jsonb(t) value FROM commerce_product_groups t WHERE tenant_id=$1 AND instance_id=$2',
    galleryMembers:'SELECT to_jsonb(t) value FROM commerce_product_group_members t WHERE tenant_id=$1 AND instance_id=$2',
    galleryPhotos:'SELECT to_jsonb(t) value FROM commerce_product_gallery_photos t WHERE tenant_id=$1 AND instance_id=$2',
    galleries:'SELECT to_jsonb(t) value FROM commerce_publication_galleries t WHERE tenant_id=$1 AND instance_id=$2',
    galleryRefs:'SELECT to_jsonb(t) value FROM commerce_publication_gallery_refs t WHERE tenant_id=$1 AND instance_id=$2',
    appearanceDrafts:'SELECT to_jsonb(t) value FROM commerce_storefront_appearance_drafts t WHERE tenant_id=$1 AND instance_id=$2',
    appearanceTargets:'SELECT to_jsonb(t) value FROM commerce_storefront_appearance_targets t WHERE tenant_id=$1 AND instance_id=$2',
    appearances:'SELECT to_jsonb(t) value FROM commerce_publication_appearances t WHERE tenant_id=$1 AND instance_id=$2',
    appearanceRefs:'SELECT to_jsonb(t) value FROM commerce_publication_appearance_refs t WHERE tenant_id=$1 AND instance_id=$2',
  };
  const result:Record<string,Record<string,any>[]>= {};
  for(const [name,sql] of Object.entries(queries))result[name]=(await pool.query(sql+' ORDER BY to_jsonb(t)::text',[tenantId,instanceId])).rows.map(r=>r.value);
  return result;
}
interface CapturedPhoto {assetId:string;key:AssetObjectKey;metadata:ObjectMetadata;bytes:Buffer;privatePath:string}

export async function storefrontPhotoFixtures(owner:Pool,runtime:Pool,store:ObjectStore){
  const community=randomUUID();await owner.query('INSERT INTO communities VALUES($1,$2)',[community,'Synthetic photo restore']);
  const member=await restoreMember(owner,community),other=await restoreMember(owner,community);
  await owner.query(`INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state,member_tier)
    VALUES($1,$2,$3,'guild_commerce_sales','active','full')`,[randomUUID(),community,member.actor.user_id]);
  // Fixture-only operator setup; never relax the application's canonical grants.
  await owner.query(`INSERT INTO tenant_capacity_policies(policy_id,revision,tenant_id,plan_ref,max_active_instances,max_instances_per_module,
    max_concurrent_provisions,max_work_items,max_retained_bytes,max_concurrent_jobs,max_model_budget,status)
    SELECT $1,1,NULL,'synthetic-photo-restore',10,3,2,1000,104857600,4,NULL,'active'
    WHERE NOT EXISTS(SELECT 1 FROM tenant_capacity_policies WHERE tenant_id IS NULL AND status='active')`,[randomUUID()]);
  await owner.query(`INSERT INTO guild_application_offerings(offering_id,community_id,guild_key,application_key,release_ref,status,display_order,launch_policy_ref,version)
    VALUES($1,$2,'guild_commerce_sales','hosted-store','hosted-store@1.0.0','offered',10,'{"policy_key":"hosted-store.launch","version":"1"}',1)`,[randomUUID(),community]);
  await owner.query("UPDATE domain_media_storage_policy SET mode='r2_only',persistence_allowed=true,policy_revision='synthetic-photo-restore',retained_byte_limit=16777216 WHERE purpose='storefront.product-photo'");
  const app=storefrontPhotoApp(runtime,store,true,true);
  const made=await json(app,'/api/v1/tenants',member,{display_name:'Synthetic photo restore',workspace_name:'Photo restore'},undefined,201);
  const tenantId=made.tenant.tenant_id as string,workspaceId=made.workspace.workspace_id as string;
  const foreign=await json(app,'/api/v1/tenants',other,{display_name:'Other restore tenant'},undefined,201);
  assert.notEqual(foreign.tenant.tenant_id,tenantId);
  const planned=await json(app,`/api/v1/tenants/${tenantId}/application-launch-plans`,member,{
    guild_key:'guild_commerce_sales',workspace_id:workspaceId,application_key:'hosted-store',release_ref:'hosted-store@1.0.0',
    installation_choice:'create_new',dependencies:[],configuration:{}},undefined,201);
  const launch=await app.request(origin+`/api/v1/tenants/${tenantId}/application-installations`,{method:'POST',
    headers:{...memberHeaders(member),'Content-Type':'application/json','Idempotency-Key':randomUUID()},
    body:JSON.stringify({plan_id:planned.plan_id,expected_plan_version:planned.version,configuration_digest:planned.configuration_digest})});
  assert.ok([200,202].includes(launch.status),await launch.clone().text());assert.equal((await launch.json() as {state:string}).state,'succeeded');
  const instances=(await owner.query("SELECT instance_id FROM module_instances WHERE tenant_id=$1 AND module_key='storefront'",[tenantId])).rows;
  assert.equal(instances.length,1);const instanceId=instances[0].instance_id as string,root=`/api/v1/tenants/${tenantId}/storefronts/${instanceId}`,slug='restore-'+randomUUID().slice(0,8);
  await json(app,root+'/setup',member,{name:'Synthetic restore shop',slug,currency:'TWD'},undefined,201);
  const add=async(title:string)=>ProductViewSchema.parse(await json(app,root+'/products',member,{title,description:'Owned restore fixture',price_minor:1234,stock:5},undefined,201));
  const p1=await add('Retained replacement'),p2=await add('Removed live product');
  async function upload(productId:string,version:string,width:number,height:number,background:string):Promise<CapturedPhoto>{
    const png=await sharp({create:{width,height,channels:3,background}}).png().toBuffer();
    const response=await app.request(origin+root+'/products/'+productId+'/photo',{method:'POST',headers:{...memberHeaders(member),
      'Content-Type':'image/png','Idempotency-Key':randomUUID(),'If-Match':`"${version}"`},body:new Uint8Array(png)});
    assert.equal(response.status,200,await response.clone().text());const saved=ProductMediaCommandSchema.parse(await response.json());assert(saved.current.photo);
    assert.equal(saved.current.photo.width,width);assert.equal(saved.current.photo.height,height);
    const read=await app.request(origin+saved.current.photo.read_path,{headers:memberHeaders(member)});assert.equal(read.status,200);
    const bytes=Buffer.from(await read.arrayBuffer());
    const row=(await owner.query(`SELECT o.* FROM commerce_product_photo_targets t JOIN asset_objects o ON o.asset_id=t.asset_id
      WHERE t.tenant_id=$1 AND t.instance_id=$2 AND t.product_id=$3`,[tenantId,instanceId,productId])).rows[0];
    assert.equal(row.content_sha256,createHash('sha256').update(bytes).digest('hex'));
    assert.equal(row.pixel_width,width);assert.equal(row.pixel_height,height);assert.equal(row.profile_id,'storefront.product-photo');
    return {assetId:row.asset_id,key:row.object_key,bytes,privatePath:saved.current.photo.read_path,metadata:{contentType:row.content_type,
      byteSize:row.byte_size,sha256:row.content_sha256,transformVersion:row.transform_version,policyRevision:row.policy_revision,profileId:row.profile_id}};
  }
  const a=await upload(p1.product_id,'1',13,11,'red'),c=await upload(p2.product_id,'1',23,7,'green');
  await publishRestoredPhotos(app,root,member);const revision1=await publicMedia(app,slug);
  const b=await upload(p1.product_id,'2',17,19,'blue');
  await publishRestoredPhotos(app,root,member);const revision2=await publicMedia(app,slug);
  assert.equal(revision1.revision,'1');assert.equal(revision2.revision,'2');
  await json(app,root+'/products/'+p2.product_id+'/remove',member,{},'2');
  const snapshot=await storefrontPhotoSnapshot(owner,tenantId,instanceId);
  assert.equal(snapshot.assets.length,3);assert(snapshot.assets.every(row=>row.state==='ready'&&String(row.deletion_fence)==='0'));
  assert.equal(snapshot.objects.length,3);assert.equal(snapshot.intents.length,3);
  assert.equal(snapshot.items.length,1);assert.equal(snapshot.items[0].item_id,p1.product_id);assert.equal(snapshot.selections.length,1);
  assert.equal(snapshot.targets.length,2);assert.equal(snapshot.targets.find(row=>row.product_id===p1.product_id)?.asset_id,b.assetId);
  const removedTarget=snapshot.targets.find(row=>row.product_id===p2.product_id);assert(removedTarget);
  for(const field of ['asset_id','representation_id','policy_revision','linked_at_product_version'])assert.equal(removedTarget[field],null);
  assert.equal(snapshot.publications.length,2);assert.equal(snapshot.refs.length,4);
  assert.equal(snapshot.refs.filter(row=>row.asset_id===a.assetId).length,1);assert.equal(snapshot.refs.filter(row=>row.asset_id===b.assetId).length,1);
  assert.equal(snapshot.refs.filter(row=>row.asset_id===c.assetId).length,2);
  assert.equal(new Set([a.metadata.sha256,b.metadata.sha256,c.metadata.sha256]).size,3);
  return {member,other,tenantId,instanceId,root,slug,p1,p2,a,b,c,revision1,revision2,snapshot};
}
export type StorefrontPhotoFixture=Awaited<ReturnType<typeof storefrontPhotoFixtures>>;

/** Called only after the existing drill fences imported sessions and supplies fresh ones. */
export async function assertRestoredStorefrontPhotos(owner:Pool,runtime:Pool,store:ObjectStore,f:StorefrontPhotoFixture){
  const app=storefrontPhotoApp(runtime,store); // uploads OFF, compatible reads ON
  for(const photo of [f.a,f.b,f.c])assert.deepEqual(Buffer.from((await readVerifiedObject(store,photo.key,photo.metadata)).bytes),photo.bytes);
  async function read(path:string,bytes:Buffer,member?:RestoreMember){
    for(const method of ['GET','HEAD']){
      const response=await app.request(origin+path,{method,headers:member?memberHeaders(member):{}});
      assert.equal(response.status,200,await response.clone().text());assert.equal(response.headers.get('cache-control'),member?'private, no-store':'no-store');
      assert.equal(response.headers.get('content-type'),'image/webp');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
      assert.equal(response.headers.get('content-length'),String(bytes.length));
      assert.deepEqual(Buffer.from(await response.arrayBuffer()),method==='HEAD'?Buffer.alloc(0):bytes);
    }
  }
  await read(f.b.privatePath,f.b.bytes,f.member);
  const uploadOff=await app.request(origin+f.root+'/products/'+f.p1.product_id+'/photo',{method:'POST',
    headers:{...memberHeaders(f.member),'Content-Type':'image/webp','Idempotency-Key':randomUUID(),'If-Match':'"3"'},body:new Uint8Array(f.b.bytes)});
  assert.equal(uploadOff.status,503,'Uploads OFF must not prevent compatible reads or create a fourth object.');
  for(const path of [f.a.privatePath,f.c.privatePath])assert.equal((await app.request(origin+path,{headers:memberHeaders(f.member)})).status,404);
  assert.equal((await app.request(origin+f.b.privatePath,{headers:memberHeaders(f.other)})).status,404);
  assert.deepEqual(await publicMedia(app,f.slug),f.revision2);
  for(const photo of f.revision2.photos)await read(photo.photo.read_path,photo.sku===f.p1.sku?f.b.bytes:f.c.bytes);
  for(const photo of f.revision1.photos)assert.equal((await app.request(origin+photo.photo.read_path)).status,404);
  const disabled=storefrontPhotoApp(runtime,store,false);
  for(const path of [f.b.privatePath,...f.revision2.photos.map(p=>p.photo.read_path)])
    assert.equal((await disabled.request(origin+path,{headers:memberHeaders(f.member)})).status,404);
  await publishRestoredPhotos(app,f.root,f.member);
  const next=await publicMedia(app,f.slug);assert.equal(next.revision,'3');assert.deepEqual(next.photos.map(p=>p.sku),[f.p1.sku]);
  await read(next.photos[0].photo.read_path,f.b.bytes);
  for(const photo of f.revision2.photos)assert.equal((await app.request(origin+photo.photo.read_path)).status,404);
  const after=await storefrontPhotoSnapshot(owner,f.tenantId,f.instanceId);
  for(const row of f.snapshot.publications)assert.deepEqual(after.publications.find(p=>p.publication_id===row.publication_id),row);
  for(const row of f.snapshot.refs)assert.deepEqual(after.refs.find(p=>p.publication_id===row.publication_id&&p.sku===row.sku),row);
  assert.deepEqual(after.assets,f.snapshot.assets);assert.deepEqual(after.objects,f.snapshot.objects);
  assert.deepEqual(after.targets,f.snapshot.targets);assert.deepEqual(after.intents,f.snapshot.intents);assert.deepEqual(after.effects,f.snapshot.effects);
}

export function storefrontAppearanceApp(runtime:Pool,store:ObjectStore,uploads=false){
  return createApp(runtime,origin,'local',{guildLaunchpadEnabled:true,storeAppearanceEnabled:true,
    tenantCursorSigningKey:TENANT_CURSOR_TEST_KEY,storePhotoAssetStore:store,
    ...(uploads?{storePhotoUploadsEnabled:true,storePhotoAssets:createStorefrontProductPhotoLifecycle(runtime,{store}),
      storeAppearanceAssets:createStorefrontAppearanceLifecycle(runtime,{store})}:{}),
    linkPreviewFetch:async()=>{throw Error('appearance_restore_must_not_fetch_outbound');}});
}

/** A separate store preserves the original product-photo revision fixture exactly. */
export async function storefrontAppearanceFixtures(owner:Pool,runtime:Pool,store:ObjectStore,photos:StorefrontPhotoFixture){
  const member=photos.member,other=photos.other,app=storefrontAppearanceApp(runtime,store,true);
  const made=await json(app,'/api/v1/tenants',member,{display_name:'Synthetic appearance restore',workspace_name:'Appearance restore'},undefined,201);
  const tenantId=made.tenant.tenant_id as string,workspaceId=made.workspace.workspace_id as string;
  const planned=await json(app,`/api/v1/tenants/${tenantId}/application-launch-plans`,member,{
    guild_key:'guild_commerce_sales',workspace_id:workspaceId,application_key:'hosted-store',release_ref:'hosted-store@1.0.0',
    installation_choice:'create_new',dependencies:[],configuration:{}},undefined,201);
  await json(app,`/api/v1/tenants/${tenantId}/application-installations`,member,
    {plan_id:planned.plan_id,expected_plan_version:planned.version,configuration_digest:planned.configuration_digest},undefined,200);
  const instanceId=(await owner.query("SELECT instance_id FROM module_instances WHERE tenant_id=$1 AND module_key='storefront'",[tenantId])).rows[0].instance_id as string;
  const root=`/api/v1/tenants/${tenantId}/storefronts/${instanceId}`,slug='appearance-'+randomUUID().slice(0,8);
  await json(app,root+'/setup',member,{name:'Synthetic branded shop',slug,currency:'TWD'},undefined,201);
  const product=ProductViewSchema.parse(await json(app,root+'/products',member,{title:'Synthetic featured item',description:'Owned fixture',price_minor:1200,stock:5},undefined,201));
  const settings=await app.request(origin+root+'/appearance-settings',{method:'PATCH',headers:{...memberHeaders(member),
    'Content-Type':'application/json','Idempotency-Key':randomUUID(),'If-Match':'"1"'},body:JSON.stringify({template_id:'catalog-grid-v1',
      accent_preset:'ocean',announcement:'合成還原公告',featured_product_ids:[product.product_id]})});
  assert.equal(settings.status,200,await settings.clone().text());AppearanceCommandAckSchema.parse(await settings.json());
  const images:Record<string,CapturedPhoto>={};
  for(const role of ['cover','logo'] as const){
    const draft=StorefrontAppearanceDraftSchema.parse(await json(app,root+'/appearance-settings',member));
    const png=await sharp({create:{width:role==='cover'?120:24,height:role==='cover'?80:24,channels:3,background:role==='cover'?'#256381':'#ce9e42'}}).png().toBuffer();
    const response=await app.request(origin+root+'/appearance-media/'+role,{method:'POST',headers:{...memberHeaders(member),
      'Content-Type':'image/png','Idempotency-Key':randomUUID(),'If-Match':`"${draft.version}"`},body:new Uint8Array(png)});
    assert.equal(response.status,200,await response.clone().text());const ack=AppearanceCommandAckSchema.parse(await response.json());
    const image=ack.current[role]!;const bytes=Buffer.from(await(await app.request(origin+image.read_path,{headers:memberHeaders(member)})).arrayBuffer());
    const row=(await owner.query(`SELECT o.* FROM commerce_storefront_appearance_targets t JOIN asset_objects o USING(asset_id)
      WHERE t.tenant_id=$1 AND t.instance_id=$2 AND t.kind=$3`,[tenantId,instanceId,'storefront.'+role])).rows[0];
    assert.equal(row.content_sha256,createHash('sha256').update(bytes).digest('hex'));
    images[role]={assetId:row.asset_id,key:row.object_key,bytes,privatePath:image.read_path,metadata:{contentType:row.content_type,
      byteSize:row.byte_size,sha256:row.content_sha256,transformVersion:row.transform_version,policyRevision:row.policy_revision,profileId:row.profile_id}};
  }
  await publishRestoredPhotos(app,root,member);
  const draft=StorefrontAppearanceDraftSchema.parse(await json(app,root+'/appearance-settings',member));
  for(const role of ['cover','logo'] as const)images[role].privatePath=draft[role]!.read_path;
  const snapshot=await storefrontPhotoSnapshot(owner,tenantId,instanceId);
  assert.equal(snapshot.appearanceDrafts.length,1);assert.equal(snapshot.appearanceTargets.length,2);
  assert.equal(snapshot.appearances.length,1);assert.equal(snapshot.appearanceRefs.length,2);assert.equal(snapshot.assets.length,2);
  assert.equal(draft.dirty,false);assert.equal(draft.accent_preset,'ocean');assert.equal(draft.announcement,'合成還原公告');
  const publicResponse=await app.request(origin+'/api/v1/public/stores/'+slug);assert.equal(publicResponse.status,200);
  return {member,other,tenantId,instanceId,root,slug,product,draft,images,snapshot,publicJson:await publicResponse.text()};
}
export type StorefrontAppearanceFixture=Awaited<ReturnType<typeof storefrontAppearanceFixtures>>;

export async function assertRestoredStorefrontAppearance(owner:Pool,runtime:Pool,store:ObjectStore,f:StorefrontAppearanceFixture){
  const app=storefrontAppearanceApp(runtime,store); // compatible reads ON; new uploads OFF
  assert.deepEqual(await storefrontPhotoSnapshot(owner,f.tenantId,f.instanceId),f.snapshot);
  assert.deepEqual(StorefrontAppearanceDraftSchema.parse(await json(app,f.root+'/appearance-settings',f.member)),{...f.draft,uploads_enabled:false});
  for(const role of ['cover','logo'] as const){
    const image=f.images[role];assert.deepEqual(Buffer.from((await readVerifiedObject(store,image.key,image.metadata)).bytes),image.bytes);
    for(const [path,member] of [[image.privatePath,f.member],[`/shops/${f.slug}/appearance-media/1/${role}`,undefined]] as const){
      for(const method of ['GET','HEAD']){
        const response=await app.request(origin+path,{method,headers:member?memberHeaders(member):{}});
        assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),member?'private, no-store':'no-store');
        assert.equal(response.headers.get('content-type'),'image/webp');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
        assert.equal(response.headers.get('content-length'),String(image.bytes.length));
        assert.deepEqual(Buffer.from(await response.arrayBuffer()),method==='HEAD'?Buffer.alloc(0):image.bytes);
      }
    }
    assert.equal((await app.request(origin+image.privatePath,{headers:memberHeaders(f.other)})).status,404);
    assert.equal((await app.request(origin+`/shops/${f.slug}/appearance-media/2/${role}`)).status,404);
    const refused=await app.request(origin+f.root+'/appearance-media/'+role,{method:'POST',headers:{...memberHeaders(f.member),
      'Content-Type':'image/webp','Idempotency-Key':randomUUID(),'If-Match':`"${f.draft.version}"`},body:new Uint8Array(image.bytes)});
    assert.equal(refused.status,503);
  }
  const html=await(await app.request(origin+'/shops/'+f.slug)).text();assert.match(html,/data-shop-accent="ocean"/);
  assert.match(html,/合成還原公告/);assert.match(html,/shop-merchant-logo/);assert.match(html,/shop-featured/);
  const publicResponse=await app.request(origin+'/api/v1/public/stores/'+f.slug);assert.equal(publicResponse.status,200);assert.equal(await publicResponse.text(),f.publicJson);
  for(const table of ['commerce_storefront_appearance_drafts','commerce_storefront_appearance_targets','commerce_publication_appearances','commerce_publication_appearance_refs']){
    assert.equal((await runtime.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0,'Unbound restored runtime must not see tenant appearance rows.');
  }
  const off=storefrontPhotoApp(runtime,store);const oldHtml=await(await off.request(origin+'/shops/'+f.slug)).text();
  assert.doesNotMatch(oldHtml,/data-shop-accent|shop-merchant-logo|合成還原公告|shop-featured/);
  assert.equal((await off.request(origin+f.images.cover.privatePath,{headers:memberHeaders(f.member)})).status,404);
  assert.deepEqual(await storefrontPhotoSnapshot(owner,f.tenantId,f.instanceId),f.snapshot,'Flag OFF and rejected uploads retain every frozen row.');
}

export function storefrontGalleryApp(runtime:Pool,store:ObjectStore,uploads=false){
 return createApp(runtime,origin,'local',{guildLaunchpadEnabled:true,storeGalleryEnabled:true,tenantCursorSigningKey:TENANT_CURSOR_TEST_KEY,
  storePhotoAssetStore:store,...(uploads?{storeGalleryAssets:createStorefrontGalleryLifecycle(runtime,{store}),storePhotoUploadsEnabled:true}:{}),
  linkPreviewFetch:async()=>{throw Error('gallery_restore_must_not_fetch_outbound');}});
}
/** Separate tenants leave all original 141/175 fixtures and assertions intact.
 * A: 3 ready images + 2 on a deleted product + 1 stored pending image.
 * B: 2 ready images. Exactly eight additional objects, irrespective of refs. */
export async function storefrontGalleryFixtures(owner:Pool,runtime:Pool,store:ObjectStore,photos:Pick<StorefrontPhotoFixture,'member'|'other'>){
 const app=storefrontGalleryApp(runtime,store,true),assets=createStorefrontGalleryLifecycle(runtime,{store});
 async function make(member:RestoreMember,label:string){
  await owner.query(`INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state,member_tier)
   SELECT $1,community_id,user_id,'guild_commerce_sales','active','full' FROM users WHERE user_id=$2
   AND NOT EXISTS(SELECT 1 FROM positioning_profession_memberships WHERE user_id=$2 AND guild_key='guild_commerce_sales' AND state='active')`,[randomUUID(),member.actor.user_id]);
  const made=await json(app,'/api/v1/tenants',member,{display_name:'Synthetic gallery '+label,workspace_name:'Gallery restore'},undefined,201),tenantId=made.tenant.tenant_id as string;
  const planned=await json(app,`/api/v1/tenants/${tenantId}/application-launch-plans`,member,{guild_key:'guild_commerce_sales',workspace_id:made.workspace.workspace_id,application_key:'hosted-store',release_ref:'hosted-store@1.0.0',installation_choice:'create_new',dependencies:[],configuration:{}},undefined,201);
  await json(app,`/api/v1/tenants/${tenantId}/application-installations`,member,{plan_id:planned.plan_id,expected_plan_version:planned.version,configuration_digest:planned.configuration_digest},undefined,200);
  const instanceId=(await owner.query("SELECT instance_id FROM module_instances WHERE tenant_id=$1 AND module_key='storefront'",[tenantId])).rows[0].instance_id as string;
  const root=`/api/v1/tenants/${tenantId}/storefronts/${instanceId}`,slug='gallery-'+randomUUID().slice(0,8);
  await json(app,root+'/setup',member,{name:'Synthetic gallery '+label,slug,currency:'TWD'},undefined,201);
  const product=ProductViewSchema.parse(await json(app,root+'/products',member,{title:'Synthetic gallery item',description:'Synthetic restore',price_minor:100,stock:5},undefined,201));
  return {member,tenantId,instanceId,root,slug,product};
 }
 type Store=Awaited<ReturnType<typeof make>>;
 async function draft(s:Store,product=s.product){return ProductGalleryDraftSchema.parse(await json(app,s.root+'/products/'+product.product_id+'/gallery',s.member));}
 async function upload(s:Store,color:string,product=s.product){
  const d=await draft(s,product),png=await sharp({create:{width:40,height:30,channels:3,background:color}}).png().toBuffer();
  const response=await app.request(origin+s.root+'/products/'+product.product_id+'/gallery/photos/'+randomUUID(),{method:'POST',headers:{...memberHeaders(s.member),'Content-Type':'image/png','Idempotency-Key':randomUUID(),'If-Match':`"${d.version}"`},body:new Uint8Array(png)});
  assert.equal(response.status,200,await response.clone().text());return GalleryCommandAckSchema.parse(await response.json()).current;
 }
 const a=await make(photos.member,'A'),b=await make(photos.other,'B');
 await upload(a,'#7898ac');await upload(a,'#ac9878');let d=await upload(a,'#78ac98');
 const removed=ProductViewSchema.parse(await json(app,a.root+'/products',a.member,{title:'Synthetic removed gallery item',description:'Retained group',price_minor:100,stock:2},undefined,201));
 await upload(a,'#8c789f',removed);const removedDraft=await upload(a,'#789f8c',removed);
 await publishRestoredPhotos(app,a.root,a.member);
 const ordered=[d.photos[1].photo_key,d.photos[0].photo_key,d.photos[2].photo_key];
 d=GalleryCommandAckSchema.parse(await json(app,a.root+'/products/'+a.product.product_id+'/gallery/reorder',a.member,{photo_keys:ordered},d.version)).current;
 await json(app,a.root+'/products/'+a.product.product_id+'/gallery/photos/'+d.photos[2].photo_key+'/remove',a.member,{},d.version);
 await json(app,a.root+'/products/'+removed.product_id+'/remove',a.member,{},removedDraft.version);
 await publishRestoredPhotos(app,a.root,a.member);
 await upload(b,'#8877a0');await upload(b,'#a08877');await publishRestoredPhotos(app,b.root,b.member);
 // Persist verified bytes but deliberately stop before finalization. Capture
 // must retain this stored/pending object too; it is never in a public gallery.
 d=await draft(a);const pendingPng=await sharp({create:{width:20,height:20,channels:3,background:'#719580'}}).png().toBuffer();
 const api=await assets.forGalleryProduct(a.product.product_id).forProduct({mime:'image/png',bytes:pendingPng});
 const actor={...a.member.actor,tenant_id:a.tenantId,instance_id:a.instanceId},key=randomUUID(),photoId=randomUUID();
 const prepared=await api.prepare(actor,{key,targetProductId:a.product.product_id,targetGalleryPhotoId:photoId,expectedVersion:d.version,contentType:'image/png',byteSize:pendingPng.length,sha256:createHash('sha256').update(pendingPng).digest('hex')});
 const lease=await api.resumeUpload(actor,{key,intentId:prepared.intentId});
 await api.write(actor,{key:randomUUID(),intentId:lease.intentId,fence:lease.fence,leaseToken:lease.leaseToken},new ReadableStream({start(c){c.enqueue(pendingPng);c.close();}}));
 const result=[];
 for(const s of [a,b]){
  const snapshot=await storefrontPhotoSnapshot(owner,s.tenantId,s.instanceId),images:CapturedPhoto[]=[];
  for(const o of snapshot.objects){const metadata:ObjectMetadata={contentType:o.content_type,byteSize:o.byte_size,sha256:o.content_sha256,transformVersion:o.transform_version,policyRevision:o.policy_revision,profileId:o.profile_id};images.push({assetId:o.asset_id,key:o.object_key,metadata,bytes:Buffer.from((await readVerifiedObject(store,o.object_key,metadata)).bytes),privatePath:''});}
  const q=await owner.connect();let usage:string;try{const scope=(await q.query("SELECT scope_id FROM resource_scopes WHERE kind='tenant' AND tenant_ref=$1",[s.tenantId])).rows[0].scope_id;usage=String(await retainedByteUsage(q,scope,s.tenantId));}finally{q.release();}
  const publicResponse=await app.request(origin+'/api/v1/public/stores/'+s.slug),html=await app.request(origin+'/shops/'+s.slug+'/products/P0001');assert.equal(publicResponse.status,200);assert.equal(html.status,200);
  result.push({...s,snapshot,images,draft:await draft(s),publicJson:await publicResponse.text(),html:await html.text(),usage});
 }
 assert.equal(result[0].images.length,6);assert.equal(result[1].images.length,2);
 assert.equal(result[0].snapshot.galleryGroups.length,2);assert.equal(result[0].snapshot.galleryMembers.length,2);assert.equal(result[0].snapshot.galleryPhotos.length,6);
 assert.equal(result[0].snapshot.galleries.length,2);assert.equal(result[0].snapshot.galleryRefs.length,7);
 assert.equal(result[1].snapshot.galleryGroups.length,1);assert.equal(result[1].snapshot.galleryRefs.length,2);
 assert.equal(result[0].snapshot.intents.filter(i=>i.state==='stored').length,1);assert.equal(result[0].snapshot.assets.filter(a=>a.state==='pending').length,1);
 return {stores:result,images:result.flatMap(s=>s.images),pending:prepared.assetId};
}
export type StorefrontGalleryFixture=Awaited<ReturnType<typeof storefrontGalleryFixtures>>;
export async function assertRestoredStorefrontGallery(owner:Pool,runtime:Pool,store:ObjectStore,f:StorefrontGalleryFixture){
 const app=storefrontGalleryApp(runtime,store);
 for(const s of f.stores){
  assert.deepEqual(await storefrontPhotoSnapshot(owner,s.tenantId,s.instanceId),s.snapshot);
  const draft=ProductGalleryDraftSchema.parse(await json(app,s.root+'/products/'+s.product.product_id+'/gallery',s.member));assert.deepEqual(draft,{...s.draft,uploads_enabled:false});
  const pub=await app.request(origin+'/api/v1/public/stores/'+s.slug);assert.equal(await pub.text(),s.publicJson);
  assert.equal(await(await app.request(origin+'/shops/'+s.slug+'/products/P0001')).text(),s.html);
  for(const image of s.images)assert.deepEqual(Buffer.from((await readVerifiedObject(store,image.key,image.metadata)).bytes),image.bytes);
  const current=(s.snapshot.profiles[0].current_publication_id),refs=s.snapshot.galleryRefs.filter(r=>r.publication_id===current);
  for(const photo of draft.photos){const response=await app.request(origin+photo.read_path,{headers:memberHeaders(s.member)});assert.equal(response.status,200);const ref=refs.find(r=>r.position===photo.position);assert(ref);assert.deepEqual(Buffer.from(await response.arrayBuffer()),s.images.find(i=>i.assetId===ref.asset_id)!.bytes);}
  for(const ref of refs){const path=`/shops/${s.slug}/media/${s.snapshot.publications.find(p=>p.publication_id===current)!.revision}/${ref.sku}/${ref.position}`;
   for(const method of ['GET','HEAD']){const response=await app.request(origin+path,{method});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(Buffer.from(await response.arrayBuffer()),method==='HEAD'?Buffer.alloc(0):s.images.find(i=>i.assetId===ref.asset_id)!.bytes);}}
  const other=f.stores.find(other=>other.tenantId!==s.tenantId)!;assert.equal((await app.request(origin+draft.photos[0].read_path,{headers:memberHeaders(other.member)})).status,404);
  const q=await owner.connect();try{const scope=(await q.query("SELECT scope_id FROM resource_scopes WHERE kind='tenant' AND tenant_ref=$1",[s.tenantId])).rows[0].scope_id;assert.equal(String(await retainedByteUsage(q,scope,s.tenantId)),s.usage);}finally{q.release();}
 }
 const a=f.stores[0];for(const path of [`/shops/${a.slug}/media/1/P0001/1`,`/shops/${a.slug}/media/2/P0001/3`,`/shops/${a.slug}/media/2/P0002/1`])assert.equal((await app.request(origin+path)).status,404);
}
