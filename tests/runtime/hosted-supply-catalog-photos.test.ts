import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import type {Pool} from 'pg';
import {SupplyCatalogPhotosSchema} from '../../contracts/guild-launchpad/v1/hosted-distribution.js';
import {listSupplyCatalogPhotos} from '../../modules/agent-commerce/hosted/distribution.js';
import {authenticate} from '../../modules/identity-membership/service.js';
import {f,app,setupSupplyOfferPhotos,get,send,share,stop,page,upload,fixture,bytes,rows,granted,type Store} from '../helpers/hosted-supply-offer-photos.js';

setupSupplyOfferPhotos();

const catalogPhotos=async(s:Store,target=app)=>SupplyCatalogPhotosSchema.parse(f.ok(await get(s,'/supply-catalog-photos',s.owner,target)));

test('CATALOG-PHOTO-01 optional route is unmounted without installation; legacy responses keep their exact shapes and values',async()=>{
  const {supplier,seller,offer}=await fixture();
  const off=f.application(true,{supplierConsoleEnabled:true});
  const paths=['/supply-catalog','/supply-offers',`/supply-catalog/${offer.offer_id}`,'/distribution-selections'];
  for(const path of paths)assert.deepEqual(f.ok(await get(seller,path,seller.owner,off)),f.ok(await get(seller,path)),path);
  for(const options of [
    {supplierConsoleEnabled:true},
    {supplierConsoleEnabled:false,supplyOfferPhotosEnabled:true},
    {guildLaunchpadEnabled:false,supplierConsoleEnabled:true,supplyOfferPhotosEnabled:true},
    {supplierConsoleEnabled:true,supplyOfferPhotosEnabled:true,storePhotoAssetStore:undefined},
  ])assert.equal((await get(seller,'/supply-catalog-photos',seller.owner,f.application(true,options))).status,404);
  f.ok(await share(supplier,offer));
  const before=await Promise.all(paths.map(path=>get(seller,path).then(r=>f.ok(r))));
  assert.equal((await catalogPhotos(seller)).items.length,1);
  assert.deepEqual(await Promise.all(paths.map(path=>get(seller,path).then(r=>f.ok(r)))),before,'the optional list changes no existing read');
  for(const path of ['/supply-catalog','/supply-offers','/distribution-selections'])
    assert.deepEqual(f.ok(await get(seller,path,seller.owner,off)),f.ok(await get(seller,path)),path);
  // The base already gates detail.photo. Preserve that pre-existing ON/OFF difference.
  assert.equal((await page(seller,offer,off)).photo,null);
  assert.deepEqual((await page(seller,offer)).photo,(await catalogPhotos(seller)).items[0].photo);
});

test('CATALOG-PHOTO-02 catalog authorization, empty query, readiness and quarantine apply to the separate photo list',async()=>{
  const {supplier,seller,offer}=await fixture();f.ok(await share(supplier,offer));
  const reader=await granted(seller,['store:read']);
  for(const [session,status] of [[reader,403],[supplier.owner,404],[undefined,401]] as const){
    const replies=await Promise.all(['/supply-catalog','/supply-catalog-photos'].map(path=>f.h.call('GET',seller.root+path,session,undefined,{},app)));
    for(const reply of replies)assert.equal(reply.status,status);
    assert.deepEqual(replies[1].data,replies[0].data);
  }
  for(const query of ['?extra=1','?extra=1&extra=2'])
    assert.equal((await get(seller,'/supply-catalog-photos'+query)).status,(await get(seller,'/supply-catalog'+query)).status);
  const response=await get(seller,'/supply-catalog-photos');f.ok(response);
  for(const [name,value] of Object.entries({'cache-control':'private, no-store','vary':'Cookie','x-content-type-options':'nosniff','x-robots-tag':'noindex, nofollow','referrer-policy':'no-referrer','cross-origin-resource-policy':'same-origin'}))
    assert.equal(response.response.headers.get(name),value,name);
  const quarantined=f.application(true,{supplierConsoleEnabled:true,supplyOfferPhotosEnabled:true,commerceSettings:{consoleEnabled:true,checkoutEnabled:false,quarantine:true,providerProfiles:[]}});
  assert.deepEqual(await catalogPhotos(seller,quarantined),await catalogPhotos(seller));
  // Losing one confirmed shop mapping makes both projections unavailable.
  await f.h.pool.query("UPDATE commerce_resource_tenants SET mapping_state='ambiguous' WHERE tenant_id=$1 AND resource_kind='shop'",[seller.tenantId]);
  assert.equal((await get(seller,'/supply-catalog-photos')).status,(await get(seller,'/supply-catalog')).status);
  assert.notEqual((await get(seller,'/supply-catalog-photos')).status,200);
});

test('CATALOG-PHOTO-03 current shares only: no unshared, stopped, own, wrong-currency or withdrawn photos; listed bytes and metadata match the page',async()=>{
  const {supplier,seller,offer}=await fixture();
  const unshared=await f.openStore();await upload(unshared);
  const unsharedOffer=f.ok(await send(unshared,`/products/${unshared.productId}/supply-offer`,'2'));
  const otherCurrency=await f.openStore();
  await f.h.pool.query("UPDATE commerce_shops SET currency='USD' WHERE shop_id IN (SELECT supply_shop_id FROM commerce_storefront_profiles WHERE instance_id=$1 UNION ALL SELECT storefront_shop_id FROM commerce_storefront_profiles WHERE instance_id=$1)",[otherCurrency.instanceId]);
  await upload(otherCurrency);const usd=f.ok(await send(otherCurrency,`/products/${otherCurrency.productId}/supply-offer`,'2'));f.ok(await share(otherCurrency,usd));
  await upload(seller);const own=f.ok(await send(seller,`/products/${seller.productId}/supply-offer`,'2'));f.ok(await share(seller,own));
  assert.deepEqual(await catalogPhotos(seller),{items:[],truncated:false});
  f.ok(await share(supplier,offer));
  const first=await catalogPhotos(seller);assert.deepEqual(first,{items:[{offer_id:offer.offer_id,photo:(await page(seller,offer)).photo}],truncated:false});
  assert.equal(first.items.some(row=>[unsharedOffer.offer_id,usd.offer_id,own.offer_id].includes(row.offer_id)),false);
  const response=await app.request(f.h.origin+first.items[0].photo.read_path,{headers:{Cookie:seller.owner.cookie}});
  assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from(await(await bytes(seller,offer)).arrayBuffer()));
  const serialized=JSON.stringify(first),stored=(await rows(offer))[0];
  for(const hidden of [supplier.tenantId,supplier.instanceId,supplier.owner.user.email,stored.asset_id,stored.scope_id,stored.representation_id,'stock','draft','contact'])
    assert.equal(serialized.includes(hidden),false,'photo allowlist leaked a private field');
  await upload(supplier,'2');assert.equal((await catalogPhotos(seller)).items[0].photo.seq,'1','product edits alone cannot replace an explicit share');
  f.ok(await share(supplier,offer,'3'));
  assert.deepEqual((await catalogPhotos(seller)).items,[{offer_id:offer.offer_id,photo:(await page(seller,offer)).photo}]);
  assert.equal((await catalogPhotos(seller)).items[0].photo.seq,'2');
  f.ok(await stop(supplier,offer));assert.deepEqual((await catalogPhotos(seller)).items,[],'a stop cannot fall back to an older shared row');
  f.ok(await share(supplier,offer,'3'));
  for(let n=0;n<3;n++){f.ok(await stop(supplier,offer));f.ok(await share(supplier,offer,'3'));}
  assert.equal((await catalogPhotos(seller)).items[0].photo.seq,'10','latest sequence uses numeric ordering across decimal widths');
  f.ok(await send(supplier,`/supply-offers/${offer.offer_id}/withdraw`,offer.version));
  assert.deepEqual((await catalogPhotos(seller)).items,[]);
});

test('CATALOG-PHOTO-04 other-community shares stay outside the seller catalog',async()=>{
  const seller=await f.openStore(),community=randomUUID(),member=await f.h.person('合成其他社群供應商');
  await f.h.pool.query("INSERT INTO communities(community_id,name) VALUES($1,'合成隔離社群')",[community]);
  await f.h.pool.query('UPDATE users SET community_id=$1 WHERE user_id=$2',[community,member.id]);
  await f.h.pool.query("INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state,member_tier) VALUES($1,$2,$3,'guild_commerce_sales','active','full')",[randomUUID(),community,member.id]);
  await f.h.pool.query(`INSERT INTO guild_application_offerings(offering_id,community_id,guild_key,application_key,release_ref,status,display_order,launch_policy_ref,version)
    VALUES($1,$2,'guild_commerce_sales','hosted-store','hosted-store@1.0.0','offered',10,'{"policy_key":"hosted-store.launch","version":"1"}',1)`,[randomUUID(),community]);
  const owner=member.session,{tenantId,workspaceId}=await f.h.createTenant(owner,'合成隔離供貨');
  const plan=await f.h.plan(owner,tenantId,f.h.planBody('guild_commerce_sales',workspaceId,'hosted-store','hosted-store@1.0.0'));f.ok(plan,201);
  assert.equal((await f.h.launch(owner,tenantId,plan)).data.state,'succeeded');
  const instanceId=(await f.h.pool.query("SELECT instance_id FROM module_instances WHERE tenant_id=$1 AND module_key='storefront'",[tenantId])).rows[0].instance_id;
  const s={owner,tenantId,workspaceId,instanceId,root:`/tenants/${tenantId}/storefronts/${instanceId}`,slug:'other-'+randomUUID().slice(0,8),actor:await authenticate(f.runtime,owner.cookie.split('=')[1]),productId:'',version:'1'};
  f.ok(await send(s,'/setup',undefined,{name:'合成隔離供應商',slug:s.slug,currency:'TWD'}),201);
  const product=f.ok(await send(s,'/products',undefined,{title:'隔離照片商品',price_minor:1000,stock:1}),201);s.productId=product.product_id;
  await upload(s);const offer=f.ok(await send(s,`/products/${s.productId}/supply-offer`,'2'));f.ok(await share(s,offer));
  assert.equal((await catalogPhotos(seller)).items.some(row=>row.offer_id===offer.offer_id),false);
  assert.deepEqual(f.ok(await get(seller,'/supply-catalog')).items,[]);
  assert.equal((await bytes(seller,offer)).status,404);
});

test('CATALOG-PHOTO-05 republish carries only the existing sharing decision and removes selected old-version photos',async()=>{
  const {supplier,seller,offer}=await fixture();f.ok(await share(supplier,offer));
  f.ok(await send(seller,'/distribution-selections',undefined,{offer_id:offer.offer_id,terms_sha256:offer.terms_sha256,retail_price_minor:2000}),201);
  await upload(supplier,'2');
  const edit=f.ok(await send(supplier,`/products/${supplier.productId}/supply-terms`,'3',{cost_minor:1500,shipping_minor:0,shipping_terms:'合成新版出貨',return_terms:'合成退貨'},'PATCH'));
  const next=f.ok(await send(supplier,`/products/${supplier.productId}/supply-offer`,edit.version));
  assert.deepEqual((await catalogPhotos(seller)).items,[{offer_id:next.offer_id,photo:(await page(seller,next)).photo}]);
  assert.equal((await page(seller,offer)).photo,null);
  f.ok(await stop(supplier,next));
  f.ok(await send(supplier,`/supply-offers/${next.offer_id}/withdraw`,next.version));
  const unshared=f.ok(await send(supplier,`/products/${supplier.productId}/supply-offer`,edit.version));
  assert.deepEqual((await catalogPhotos(seller)).items,[]);assert.equal((await page(seller,unshared)).photo,null);
});

test('CATALOG-PHOTO-06 101 real offers prove the shared 100-item window, truncation, order and bounded batched read',async()=>{
  const supplier=await f.openStore(),seller=await f.openStore(),offers:any[]=[];
  offers.push(f.ok(await send(supplier,`/products/${supplier.productId}/supply-offer`,'1')));
  for(let n=1;n<=100;n++){
    const product=f.ok(await send(supplier,'/products',undefined,{title:`合成視窗商品 ${n}`,price_minor:1000,stock:1}),201);
    offers.push(f.ok(await send(supplier,`/products/${product.product_id}/supply-offer`,product.version)));
    if(n===99){assert.equal(f.ok(await get(seller,'/supply-catalog')).truncated,false);assert.deepEqual(await catalogPhotos(seller),{items:[],truncated:false});}
  }
  offers.sort((a,b)=>a.offer_id.localeCompare(b.offer_id));
  const shareIndex=async(index:number)=>{const s={...supplier,productId:offers[index].product_id};await upload(s);f.ok(await share(s,offers[index]));};
  await shareIndex(100);
  assert.deepEqual(await catalogPhotos(seller),{items:[],truncated:true},'a photo beyond the catalog window cannot move into the list');
  await shareIndex(99);await shareIndex(0);
  const catalog=f.ok(await get(seller,'/supply-catalog')),queries:string[]=[];
  const monitored=new Proxy(f.runtime,{get(pool,key){
    if(key==='connect')return async()=>{
      const q=await pool.connect();return new Proxy(q,{get(client,property){
        if(property==='query')return (...args:any[])=>{queries.push(typeof args[0]==='string'?args[0]:args[0].text);return (client.query as Function).apply(client,args);};
        const value=Reflect.get(client,property);return typeof value==='function'?value.bind(client):value;
      }});
    };
    const value=Reflect.get(pool,key);return typeof value==='function'?value.bind(pool):value;
  }}) as Pool;
  const photos=await listSupplyCatalogPhotos(monitored,seller.actor,seller.tenantId,seller.instanceId);
  assert.equal(photos.truncated,catalog.truncated);
  assert.deepEqual(catalog.items.map((o:any)=>o.offer_id),offers.slice(0,100).map(o=>o.offer_id));
  assert.deepEqual(photos.items.map(o=>o.offer_id),[catalog.items[0].offer_id,catalog.items[99].offer_id]);
  assert.equal(queries.filter(sql=>/FROM commerce_hosted_supply_offers/.test(sql)).length,1);
  assert.equal(queries.filter(sql=>/FROM commerce_hosted_offer_photos/.test(sql)).length,1,'one batch for all current shares');
  assert.equal(queries.filter(sql=>/^BEGIN/.test(sql)).length,1,'one seller-authorized storeRead');
  f.ok(await send(supplier,`/supply-offers/${offers[100].offer_id}/withdraw`,offers[100].version));
  assert.equal(f.ok(await get(seller,'/supply-catalog')).truncated,false);
  assert.deepEqual(await catalogPhotos(seller),{...photos,truncated:false});
});

test('CATALOG-PHOTO-07 the new response is strict at every level and bounded at 100, reusing the unchanged photo shape',async()=>{
  const {supplier,seller,offer}=await fixture();f.ok(await share(supplier,offer));
  const good=await catalogPhotos(seller),item=good.items[0];
  for(const invalid of [
    {...good,unknown:true},{items:good.items},
    {...good,items:[{...item,asset_id:randomUUID()}]},
    {...good,items:[{...item,photo:{...item.photo,scope_id:randomUUID()}}]},
    {...good,items:[{...item,photo:{...item.photo,seq:'0'}}]},
    {...good,items:[{...item,photo:{...item.photo,width:1921}}]},
    {...good,items:[{...item,photo:{...item.photo,read_path:'https://example.test/photo'}}]},
    {...good,items:Array.from({length:101},()=>item)},
  ])assert.equal(SupplyCatalogPhotosSchema.safeParse(invalid).success,false);
  assert.equal(SupplyCatalogPhotosSchema.safeParse({...good,items:Array.from({length:100},()=>item)}).success,true);
});
