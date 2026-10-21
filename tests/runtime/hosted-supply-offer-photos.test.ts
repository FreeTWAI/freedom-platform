import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import type {PoolClient} from 'pg';
import {bindPrincipalContext,bindTenantContext,isolatedTransaction} from '../../packages/resource-scopes/tenant-transaction.js';
import type {Session} from './module-registry-harness.js';
import {withMemberScope} from '../../packages/resource-scopes/index.js';
import {createAssetMaintenance} from '../../modules/assets/maintenance.js';
import {f,app,setupSupplyOfferPhotos,get,send,share,stop,page,upload,fixture,bytes,rows,granted,type Store} from '../helpers/hosted-supply-offer-photos.js';

setupSupplyOfferPhotos();

const detail=async(s:Store)=>f.ok(await get(s,`/supplier-console/products/${s.productId}`));
const sqlCode=(...codes:string[])=>(e:unknown)=>codes.includes((e as {code:string}).code);
async function rolled(run:(q:PoolClient)=>Promise<unknown>) {
  const q=await f.h.pool.connect();try{await q.query('BEGIN');return await run(q);}finally{await q.query('ROLLBACK');q.release();}
}

test('OFFER-PHOTO-01 explicit sharing, replacement and stop leave terms, consent and versions untouched',async()=>{
  const {supplier,seller,offer}=await fixture();
  assert.equal((await page(seller,offer)).photo,null);
  assert.deepEqual((await detail(supplier)).product.offer_photo,{state:'not_shared',seq:null,matches_current_photo:false});
  const selection=f.ok(await send(seller,'/distribution-selections',undefined,{offer_id:offer.offer_id,terms_sha256:offer.terms_sha256,retail_price_minor:2000}),201);
  f.ok(await send(supplier,`/supply-requests/${selection.selection_id}/decision`,selection.version,{decision:'accepted',listing_sha256:selection.listing_sha256}));
  const retained=async()=>({offer:(await f.h.pool.query('SELECT * FROM commerce_hosted_supply_offers WHERE offer_id=$1',[offer.offer_id])).rows,
    selections:(await f.h.pool.query('SELECT * FROM commerce_selections WHERE hosted_offer_id=$1',[offer.offer_id])).rows,
    approvals:(await f.h.pool.query('SELECT * FROM commerce_distribution_acceptances WHERE selection_id=$1',[selection.selection_id])).rows});
  const before=await retained(),key=randomUUID();
  const state=f.ok(await share(supplier,offer,'2',key));assert.deepEqual(state,{state:'shared',seq:'1',matches_current_photo:true});
  assert.deepEqual(f.ok(await share(supplier,offer,'2',key)),state);
  assert.deepEqual(f.ok(await share(supplier,offer)),state,'same identity is a no-op');
  assert.equal((await rows(offer)).length,1);
  assert.equal((await page(seller,offer)).photo?.seq,'1');
  await upload(supplier,'2');
  assert.equal((await detail(supplier)).product.offer_photo.matches_current_photo,false);
  assert.equal((await bytes(seller,offer)).status,200,'an explicit share retains its old photo until changed');
  const stale=await share(supplier,offer,'2');f.ok(stale,412);assert.equal(stale.data.code,'version_conflict');
  assert.equal(f.ok(await share(supplier,offer,'3')).seq,'2');
  assert.equal((await bytes(seller,offer,'1')).status,404);
  assert.equal((await bytes(seller,offer,'2')).status,200);
  assert.deepEqual(f.ok(await stop(supplier,offer)),{state:'not_shared',seq:'3',matches_current_photo:false});
  f.ok(await stop(supplier,offer));assert.equal((await rows(offer)).length,3);
  assert.equal((await page(seller,offer)).photo,null);assert.equal((await bytes(seller,offer,'2')).status,404);
  assert.deepEqual(f.ok(await share(supplier,offer,'2',key)),state,'replay returns its original receipt');
  assert.equal((await rows(offer)).length,3,'an old share replay cannot re-expose a stopped photo');
  assert.equal((await page(seller,offer)).photo,null);
  assert.deepEqual(await retained(),before);
  const facts=(await f.h.pool.query("SELECT aggregate_version::text,operation FROM scoped_transition_journal WHERE aggregate_type='hosted_supply_offer_photo' ORDER BY aggregate_version")).rows;
  assert.deepEqual(facts,[{aggregate_version:'1',operation:'storefront.supply-offer.photo.share'},{aggregate_version:'2',operation:'storefront.supply-offer.photo.share'},{aggregate_version:'3',operation:'storefront.supply-offer.photo.stop'}]);
  const receipts=(await f.h.pool.query("SELECT count(*)::int n FROM scoped_command_receipts WHERE operation='storefront.supply-offer.photo.share'")).rows[0].n;
  assert.equal(receipts,3,'original replay adds no receipt; new-key no-op retains its receipt');
  const changes=f.ok(await get(supplier,'/supplier-console/changes?product_id='+supplier.productId));
  assert.equal(changes.items.filter((row:any)=>row.operation.startsWith('storefront.supply-offer.photo.')).length,3);
});

test('OFFER-PHOTO-02 share requires publish, stop only write; product and offer CAS remain distinct',async()=>{
  const {supplier,offer}=await fixture(),writer=await granted(supplier,['store:read','store:write']);
  f.ok(await share(supplier,offer,'2',randomUUID(),writer),403);
  f.ok(await share(supplier,offer,'1'),412);
  f.ok(await share(supplier,offer));
  f.ok(await stop(supplier,offer,'2'),412);
  f.ok(await send(supplier,`/supply-offers/${offer.offer_id}/photo/stop`,'1',{},'POST',randomUUID(),writer));
  assert.equal((await rows(offer)).length,2);
  f.ok(await share(supplier,offer));
  const withdrawn=f.ok(await send(supplier,`/supply-offers/${offer.offer_id}/withdraw`,'1'));
  f.ok(await share(supplier,offer),409);
  assert.equal((await rows(offer)).length,3,'withdraw preserves history');
  f.ok(await stop(supplier,withdrawn));assert.equal((await rows(offer)).length,4);
});

test('OFFER-PHOTO-03 missing current photo is a clear conflict, including after removal',async()=>{
  const {supplier,offer}=await fixture(false);
  const missing=await share(supplier,offer,'1');f.ok(missing,409);assert.equal(missing.data.code,'product_photo_missing');assert.match(missing.data.detail,/照片/);
  assert.equal((await rows(offer)).length,0);f.ok(await stop(supplier,offer));
  await upload(supplier);f.ok(await share(supplier,offer));
  f.ok(await send(supplier,`/products/${supplier.productId}/photo/remove`,'2'));
  f.ok(await share(supplier,offer,'3'),409);
  assert.equal((await detail(supplier)).product.offer_photo.matches_current_photo,false);
});

test('OFFER-PHOTO-04 republish carries the decision with the current photo, skips missing photos and stopped decisions',async()=>{
  const {supplier,seller,offer}=await fixture();f.ok(await share(supplier,offer));await upload(supplier,'2');
  const edit=f.ok(await send(supplier,`/products/${supplier.productId}/supply-terms`,'3',{cost_minor:1500,shipping_minor:0,shipping_terms:'合成新版條件',return_terms:'合成退貨條件'},'PATCH'));
  const next=f.ok(await send(supplier,`/products/${supplier.productId}/supply-offer`,edit.version));
  assert.notEqual(next.offer_id,offer.offer_id);assert.equal((await rows(offer)).length,1);
  assert.equal((await page(seller,next)).photo?.seq,'1');assert.equal((await detail(supplier)).product.offer_photo.matches_current_photo,true);
  const pointer=(await f.h.pool.query('SELECT asset_id FROM commerce_product_photo_targets WHERE product_id=$1',[supplier.productId])).rows[0];
  assert.equal((await rows(next))[0].asset_id,pointer.asset_id);
  f.ok(await stop(supplier,next));
  const again=f.ok(await send(supplier,`/supply-offers/${next.offer_id}/withdraw`,next.version));
  const unshared=f.ok(await send(supplier,`/products/${supplier.productId}/supply-offer`,edit.version));
  assert.equal((await page(seller,unshared)).photo,null,'a stop on the previous offer must not revive an older share');
  f.ok(await share(supplier,unshared,edit.version));
  const removed=f.ok(await send(supplier,`/products/${supplier.productId}/photo/remove`,edit.version));
  f.ok(await send(supplier,`/supply-offers/${unshared.offer_id}/withdraw`,unshared.version));
  const withoutPhoto=f.ok(await send(supplier,`/products/${supplier.productId}/supply-offer`,removed.completed_version));
  assert.equal((await rows(withoutPhoto)).length,0);assert.equal(again.state,'withdrawn');
});

test('OFFER-PHOTO-05 GET and HEAD verify bytes and exact private headers; metadata exposes no supplier internals',async()=>{
  const {supplier,seller,offer}=await fixture();f.ok(await share(supplier,offer));
  const dto=await page(seller,offer),photo=dto.photo!;assert.equal(photo.width,1);assert.equal(photo.height,1);
  for(const secret of [supplier.tenantId,supplier.instanceId,supplier.owner.user.email,supplier.owner.user.user_id,'"stock"','"reserved"','"scope_id"','"asset_id"','"bank"'])assert.equal(JSON.stringify(dto).includes(secret),false,'private field escaped offer allowlist');
  const first=(await rows(offer))[0];for(const value of [first.asset_id,first.scope_id,first.representation_id])assert.equal(JSON.stringify(dto).includes(value),false);
  for(const method of ['GET','HEAD']) {
    const reads=f.store.gets,response=await bytes(seller,offer,'1',method);
    assert.equal(response.status,200);assert.equal(f.store.gets,reads+1,'HEAD also reads and verifies the complete object');
    for(const [header,value] of Object.entries({'Content-Type':'image/webp','Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin'}))assert.equal(response.headers.get(header),value,header);
    const content=new Uint8Array(await response.arrayBuffer());assert.equal(content.length,method==='HEAD'?0:first.byte_size);
  }
});

test('OFFER-PHOTO-06 adopted withdrawn offers retain terms but hide photos; quarantine preserves active photo reads',async()=>{
  const {supplier,seller,offer}=await fixture();f.ok(await share(supplier,offer));
  const reader=await granted(seller,['store:read']);
  assert.equal((await bytes(seller,offer,'1','GET',reader)).status,403);
  assert.equal((await bytes(seller,offer,'1','GET',null)).status,401);
  assert.equal((await bytes(seller,offer,'99')).status,404);
  const peer=await f.openStore();
  f.ok(await send(seller,'/distribution-selections',undefined,{offer_id:offer.offer_id,terms_sha256:offer.terms_sha256,retail_price_minor:2000}),201);
  const quarantined=f.application(true,{supplierConsoleEnabled:true,supplyOfferPhotosEnabled:true,commerceSettings:{consoleEnabled:true,checkoutEnabled:false,quarantine:true,providerProfiles:[]}});
  assert.equal((await bytes(seller,offer,'1','GET',seller.owner,quarantined)).status,200);
  assert.equal((await page(seller,offer,quarantined)).photo?.seq,'1');
  f.ok(await send(supplier,`/supply-offers/${offer.offer_id}/withdraw`,'1'));
  assert.equal((await bytes(peer,offer)).status,404);assert.equal((await get(peer,`/supply-catalog/${offer.offer_id}`)).status,404);
  assert.equal((await page(seller,offer)).photo,null);
  for(const method of ['GET','HEAD'])assert.equal((await bytes(seller,offer,'1',method)).status,404);
  assert.equal((await page(seller,offer,quarantined)).photo,null);
  assert.equal((await bytes(seller,offer,'1','GET',seller.owner,quarantined)).status,404);
  const blocked=await send(supplier,`/supply-offers/${offer.offer_id}/photo/stop`,'2',{},'POST',randomUUID(),supplier.owner,quarantined);
  f.ok(blocked,503);assert.equal(blocked.data.code,'commerce_quarantined');
});

test('OFFER-PHOTO-07 changed share during unlocked object I/O fails closed for GET and HEAD',async()=>{
  const {supplier,seller,offer}=await fixture();f.ok(await share(supplier,offer));
  f.store.afterGet=async()=>{f.store.afterGet=undefined;await upload(supplier,'2');f.ok(await share(supplier,offer,'3'));};
  assert.equal((await bytes(seller,offer)).status,404);
  f.store.afterGet=async()=>{f.store.afterGet=undefined;f.ok(await stop(supplier,offer));};
  assert.equal((await bytes(seller,offer,'2','HEAD')).status,404);
});

test('OFFER-PHOTO-08 default OFF hides routes and fields and reports false; every installation prerequisite is required',async()=>{
  const {supplier,seller,offer}=await fixture();f.ok(await share(supplier,offer));
  for(const options of [{supplierConsoleEnabled:true},{supplierConsoleEnabled:false,supplyOfferPhotosEnabled:true},{guildLaunchpadEnabled:false,supplierConsoleEnabled:true,supplyOfferPhotosEnabled:true}]) {
    const off=f.application(true,options),site=await(await off.request(f.h.origin+'/api/v1/site')).json() as any;
    assert.equal(site.supply_offer_photos_enabled,false);
    assert.equal((await bytes(seller,offer,'1','GET',seller.owner,off)).status,404);
    assert.equal((await send(supplier,`/supply-offers/${offer.offer_id}/photo/share`,'2',{},'POST',randomUUID(),supplier.owner,off)).status,404);
    assert.equal((await send(supplier,`/supply-offers/${offer.offer_id}/photo/stop`,'1',{},'POST',randomUUID(),supplier.owner,off)).status,404);
  }
  const off=f.application(true,{supplierConsoleEnabled:true});
  assert.equal((await page(seller,offer,off)).photo,null);
  assert.equal(f.ok(await get(supplier,`/supplier-console/products/${supplier.productId}`,supplier.owner,off)).product.offer_photo,null);
  const noStore=f.application(true,{supplierConsoleEnabled:true,supplyOfferPhotosEnabled:true,storePhotoAssetStore:undefined});
  assert.equal((await(await noStore.request(f.h.origin+'/api/v1/site')).json() as any).supply_offer_photos_enabled,false);
});

test('OFFER-PHOTO-11 a restrictive offer policy also filters the photo subquery under the runtime role',async()=>{
  const {supplier,seller,offer}=await fixture();f.ok(await share(supplier,offer));
  await rolled(async q=>{
    // Tighten only this disposable transaction; no existing policy is replaced.
    await q.query('CREATE POLICY synthetic_offer_veto ON commerce_hosted_supply_offers AS RESTRICTIVE FOR SELECT USING(false)');
    await q.query(`SET LOCAL ROLE ${f.role}`);
    const principal=(await f.h.pool.query('SELECT principal_id FROM principals WHERE user_ref=$1',[seller.owner.user.user_id])).rows[0].principal_id;
    const scope=(await f.h.pool.query("SELECT scope_id FROM resource_scopes WHERE kind='tenant' AND tenant_ref=$1",[seller.tenantId])).rows[0].scope_id;
    await bindPrincipalContext(q,principal);await bindTenantContext(q,{tenantId:seller.tenantId,tenantScopeId:scope});
    assert.equal((await q.query('SELECT current_user')).rows[0].current_user,f.role);
    assert.equal((await q.query('SELECT 1 FROM commerce_hosted_supply_offers WHERE offer_id=$1',[offer.offer_id])).rowCount,0);
    assert.equal((await q.query('SELECT 1 FROM commerce_hosted_offer_photos WHERE offer_id=$1',[offer.offer_id])).rowCount,0,'EXISTS cannot bypass the offers SELECT policy');
  });
  assert.equal((await bytes(seller,offer)).status,200,'rollback removes the synthetic veto');
});

test('OFFER-PHOTO-12 permanent asset fences are checked before a new reference can be retained',async()=>{
  const {supplier,offer}=await fixture();
  const context=await withMemberScope(f.runtime,{actor:supplier.actor,scope:'personal'},async()=>{},async(_q,context)=>context);
  const fenced=randomUUID(),representation=randomUUID();
  await f.h.pool.query(`INSERT INTO assets(asset_id,scope_id,owner_principal_id,owner_user_id,policy_revision,representation_id,created_at)
    VALUES($1,$2,$3,$4,'synthetic-fence',$5,clock_timestamp()-interval '1 hour')`,[fenced,context.scope.scope_id,context.subject_principal.principal_id,supplier.actor.user_id,representation]);
  await f.h.pool.query("UPDATE asset_maintenance_policy SET enabled=true,revision='synthetic-fence',orphan_retention_seconds=1,retired_retention_seconds=1,delete_lease_seconds=30,capture_seconds=30,pin_seconds=30,max_capture_objects=100");
  await createAssetMaintenance(f.h.pool,{store:f.store,enabled:true}).claimDelete(fenced);
  // A partial tuple must still reach the independent generic fence trigger,
  // rather than relying on the pointer or all-null/all-set constraint alone.
  await assert.rejects(rolled(q=>q.query(`INSERT INTO commerce_hosted_offer_photos(offer_id,seq,tenant_id,instance_id,item_id,asset_id,shared_by_principal_id)
    VALUES($1,1,$2,$3,$4,$5,$6)`,[offer.offer_id,supplier.tenantId,supplier.instanceId,supplier.productId,fenced,context.subject_principal.principal_id])),
  (e:unknown)=>(e as {code:string}).code==='23514'&&/permanently fenced/.test((e as Error).message));
  assert.equal((await rows(offer)).length,0);
});

test('OFFER-PHOTO-13 supplier preview reads the actual retained share through its own product-photo route',async()=>{
  const {supplier,seller,offer}=await fixture();f.ok(await share(supplier,offer));
  const original=Buffer.from(await(await bytes(seller,offer)).arrayBuffer());
  await upload(supplier,'2');
  const path='/api/v1'+supplier.root+`/products/${supplier.productId}/photo/3?offer_id=${offer.offer_id}&seq=1`;
  const read=(method='GET',session:Session|null=supplier.owner,target=app)=>target.request(f.h.origin+path,{method,headers:session?{Cookie:session.cookie}:{}});
  const response=await read();assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),original);
  assert.equal((await read('HEAD')).status,200);
  assert.equal((await read('GET',seller.owner)).status,404);assert.equal((await read('GET',null)).status,401);
  assert.equal((await read('GET',supplier.owner,f.application(true,{supplierConsoleEnabled:true}))).status,404);
  const stale=await app.request(f.h.origin+path.replace('seq=1','seq=9'),{headers:{Cookie:supplier.owner.cookie}});assert.equal(stale.status,404);
  f.store.afterGet=async()=>{f.store.afterGet=undefined;f.ok(await stop(supplier,offer));};
  assert.equal((await read()).status,404);assert.equal((await read()).status,404);
});

test('OFFER-PHOTO-09 SQL rejects updates, deletes, sequence gaps, partial tuples and non-current photos',async()=>{
  const {supplier,offer}=await fixture();f.ok(await share(supplier,offer));const original=(await rows(offer))[0];
  for(const query of ['UPDATE commerce_hosted_offer_photos SET seq=seq','DELETE FROM commerce_hosted_offer_photos'])await assert.rejects(rolled(q=>q.query(query)),sqlCode('23514'));
  const insert=(q:PoolClient,seq:string,photo:Record<string,any>={})=>q.query(`INSERT INTO commerce_hosted_offer_photos(offer_id,seq,tenant_id,instance_id,item_id,shared_by_principal_id,scope_id,asset_id,representation_id,policy_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[offer.offer_id,seq,supplier.tenantId,supplier.instanceId,supplier.productId,original.shared_by_principal_id,photo.scope_id??null,photo.asset_id??null,photo.representation_id??null,photo.policy_revision??null]);
  await assert.rejects(rolled(q=>insert(q,'3')),sqlCode('23514'));
  await assert.rejects(rolled(q=>insert(q,'2',{scope_id:original.scope_id})),sqlCode('23514'));
  await assert.rejects(rolled(q=>q.query(`INSERT INTO commerce_hosted_offer_photos(offer_id,seq,tenant_id,instance_id,item_id,shared_by_principal_id,scope_id,asset_id,representation_id,policy_revision,width) VALUES($1,2,$2,$3,$4,$5,$6,$7,$8,$9,999)`,[offer.offer_id,supplier.tenantId,supplier.instanceId,supplier.productId,original.shared_by_principal_id,original.scope_id,original.asset_id,original.representation_id,original.policy_revision])),sqlCode('23514'));
  await upload(supplier,'2');
  await assert.rejects(rolled(q=>insert(q,'2',original)),sqlCode('23514'));
  assert.equal((await rows(offer)).length,1);
});

test('OFFER-PHOTO-10 runtime RLS inherits offer visibility without widening its audience or supplier writes',async()=>{
  const {supplier,seller,offer}=await fixture();f.ok(await share(supplier,offer));
  const principal=async(s:Store)=>(await f.h.pool.query('SELECT principal_id FROM principals WHERE user_ref=$1',[s.owner.user.user_id])).rows[0].principal_id as string;
  const counts=async(principalId?:string,tenant?:Store)=>isolatedTransaction(f.runtime,async q=>{
    if(principalId)await bindPrincipalContext(q,principalId);
    if(tenant){const scope=(await f.h.pool.query("SELECT scope_id FROM resource_scopes WHERE kind='tenant' AND tenant_ref=$1",[tenant.tenantId])).rows[0].scope_id;await bindTenantContext(q,{tenantId:tenant.tenantId,tenantScopeId:scope});}
    return (await q.query(`SELECT (SELECT count(*)::int FROM commerce_hosted_supply_offers WHERE offer_id=$1) offers,(SELECT count(*)::int FROM commerce_hosted_offer_photos WHERE offer_id=$1) photos`,[offer.offer_id])).rows[0];
  });
  assert.deepEqual(await counts(),{offers:0,photos:0});
  assert.deepEqual(await counts(await principal(supplier),supplier),{offers:1,photos:1});
  assert.deepEqual(await counts(await principal(seller),seller),{offers:1,photos:1});
  await f.h.pool.query('UPDATE users SET active=false WHERE user_id=$1',[seller.owner.user.user_id]);
  assert.deepEqual(await counts(await principal(seller),seller),{offers:0,photos:0});
  await f.h.pool.query('UPDATE users SET active=true WHERE user_id=$1',[seller.owner.user.user_id]);
  const community=randomUUID();await f.h.pool.query("INSERT INTO communities(community_id,name) VALUES($1,'合成其他社群')",[community]);
  await f.h.pool.query('UPDATE users SET community_id=$1 WHERE user_id=$2',[community,seller.owner.user.user_id]);
  assert.deepEqual(await counts(await principal(seller),seller),{offers:0,photos:0});
  const foreign=await bytes(seller,offer);assert.equal(foreign.status,(await get(seller,`/supply-catalog/${offer.offer_id}`)).status);assert.notEqual(foreign.status,200);
  await assert.rejects(isolatedTransaction(f.runtime,async q=>{
    await bindPrincipalContext(q,await principal(seller));const scope=(await f.h.pool.query("SELECT scope_id FROM resource_scopes WHERE kind='tenant' AND tenant_ref=$1",[seller.tenantId])).rows[0].scope_id;await bindTenantContext(q,{tenantId:seller.tenantId,tenantScopeId:scope});
    const row=(await rows(offer))[0];await q.query(`INSERT INTO commerce_hosted_offer_photos(offer_id,seq,tenant_id,instance_id,item_id,shared_by_principal_id) VALUES($1,2,$2,$3,$4,$5)`,[offer.offer_id,supplier.tenantId,supplier.instanceId,supplier.productId,row.shared_by_principal_id]);
  }),sqlCode('42501','P0002'));
});


test('OFFER-PHOTO-14 actual runtime grant block leaves history readable and insertable without mutation grants',async()=>{
  const template=await readFile(new URL('../../deploy/cloudflare/sql/20-runtime-grants.psql',import.meta.url),'utf8');
  const query=template.split('-- BEGIN OFFER PHOTO HISTORY GRANTS\n')[1].split('\n\\gexec')[0]
    .replaceAll(":'runtime'",`'${f.role}'`).replace("n.nspname='public'",`n.nspname='${f.h.schema}'`);
  await rolled(async q=>{
    const statements=(await q.query(query)).rows;assert.equal(statements.length,1);
    for(const row of statements)await q.query(row.format);
    const privileges=(await q.query(`SELECT has_table_privilege($1,$2,'SELECT') AS read,
      has_table_privilege($1,$2,'INSERT') AS append,has_table_privilege($1,$2,'UPDATE') AS update,
      has_table_privilege($1,$2,'DELETE') AS delete,has_table_privilege($1,$2,'TRUNCATE') AS truncate`,[f.role,`${f.h.schema}.commerce_hosted_offer_photos`])).rows[0];
    assert.deepEqual(privileges,{read:true,append:true,update:false,delete:false,truncate:false});
  });
});


test('OFFER-PHOTO-15 republishing hides a selected old version and stopping the current version closes every seller photo',async()=>{
  const {supplier,seller,offer}=await fixture(),peer=await f.openStore();
  f.ok(await share(supplier,offer));
  f.ok(await send(seller,'/distribution-selections',undefined,{offer_id:offer.offer_id,terms_sha256:offer.terms_sha256,retail_price_minor:2000}),201);
  const edit=f.ok(await send(supplier,`/products/${supplier.productId}/supply-terms`,'2',{cost_minor:1500,shipping_minor:0,shipping_terms:'合成新版條件',return_terms:'合成退貨條件'},'PATCH'));
  const next=f.ok(await send(supplier,`/products/${supplier.productId}/supply-offer`,edit.version));
  const oldPage=await page(seller,offer);assert.equal(oldPage.offer.state,'withdrawn');assert.equal(oldPage.photo,null);
  for(const method of ['GET','HEAD']){
    const old=await bytes(seller,offer,'1',method);assert.equal(old.status,404);
    if(method==='GET')assert.equal((await old.json() as any).code,'not_found');
  }
  for(const store of [seller,peer]){
    assert.equal((await page(store,next)).photo?.seq,'1');
    for(const method of ['GET','HEAD'])assert.equal((await bytes(store,next,'1',method)).status,200);
  }
  f.ok(await stop(supplier,next));
  for(const store of [seller,peer]){
    assert.equal((await page(store,next)).photo,null);
    for(const version of [offer,next])for(const method of ['GET','HEAD'])assert.equal((await bytes(store,version,'1',method)).status,404);
  }
  assert.equal((await page(seller,offer)).photo,null);
  assert.equal((await get(peer,`/supply-catalog/${offer.offer_id}`)).status,404);
  assert.equal((await rows(offer)).length,1,'withdrawn share history is retained');
  assert.equal((await rows(next)).length,2,'only the explicit current-version stop appends a row');
});

for(const method of ['GET','HEAD'])test(`OFFER-PHOTO-16 ${method} refuses a selected offer withdrawn during verified object I/O`,async()=>{
  const {supplier,seller,offer}=await fixture();f.ok(await share(supplier,offer));
  f.ok(await send(seller,'/distribution-selections',undefined,{offer_id:offer.offer_id,terms_sha256:offer.terms_sha256,retail_price_minor:2000}),201);
  f.store.afterGet=async()=>{f.store.afterGet=undefined;f.ok(await send(supplier,`/supply-offers/${offer.offer_id}/withdraw`,'1'));};
  const response=await bytes(seller,offer,'1',method);assert.equal(response.status,404);
  if(method==='GET')assert.equal((await response.json() as any).code,'not_found');
  assert.equal((await page(seller,offer)).photo,null);
  assert.equal((await rows(offer)).length,1);
});
