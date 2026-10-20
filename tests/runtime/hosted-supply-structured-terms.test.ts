import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {after,before,beforeEach,test} from 'node:test';
import {createApp} from '../../apps/platform-api/src/app.js';
import {formatMinor} from '../../apps/portal-web/src/format.js';
import {digest} from '../../packages/db/index.js';
import {supplyOfferTerms} from '../../modules/agent-commerce/hosted/distribution.js';
import {createShippingQuotePort} from '../../modules/agent-commerce/fulfilment/quote/index.js';
import {cartQuote} from '../../modules/agent-commerce/checkout/cart-quote.js';
import {SupplyTermsSchema} from '../../contracts/guild-launchpad/v1/hosted-supply-terms.js';
import {SupplierProductDetailSchema} from '../../contracts/guild-launchpad/v1/supplier-console.js';
import {TENANT_CURSOR_TEST_KEY} from './tenant-cursor-fixture.js';
import {checkoutHarness,ok,type CheckoutHarness} from './hosted-checkout-harness.js';

let x:CheckoutHarness,app:ReturnType<typeof createApp>;
type Store=Awaited<ReturnType<CheckoutHarness['store']>>;
const keys=['msrp_minor','minimum_order_quantity','lead_time_days'] as const;
const references={msrp_minor:87654321,minimum_order_quantity:9876,lead_time_days:321};
const empty={msrp_minor:null,minimum_order_quantity:null,lead_time_days:null};
// The seven-key object and both hashes were captured from the exact pre-change baseline.
const legacy={title:'合成商品',description:'介紹',currency:'TWD' as const,cost_minor:400,shipping_minor:50,shipping_terms:'三天出貨',return_terms:'瑕疵換貨'};
const body={cost_minor:legacy.cost_minor,shipping_minor:legacy.shipping_minor,shipping_terms:legacy.shipping_terms,return_terms:legacy.return_terms};
const pick=(value:Record<string,unknown>)=>Object.fromEntries(keys.map(k=>[k,value[k]]));
before(async()=>{x=await checkoutHarness('fp_structured_terms');app=createApp(x.runtime,x.h.origin,'local',{guildLaunchpadEnabled:true,supplierConsoleEnabled:true,hostedReservationsEnabled:true,tenantCursorSigningKey:TENANT_CURSOR_TEST_KEY});});
after(async()=>{await x?.stop();});
beforeEach(async()=>{await x.reset();});
const get=(s:Store,path:string)=>x.h.call('GET',s.root+path,s.owner,undefined,{},app);
const send=(s:Store,path:string,data:unknown={},version?:string,method='POST',key=randomUUID())=>x.h.call(method,s.root+path,s.owner,data,{'Idempotency-Key':key,...(version?{'If-Match':`"${version}"`}:{})},app);
const termsPath=(s:Store)=>`/products/${s.product.product_id}/supply-terms`;
const current=(s:Store)=>get(s,termsPath(s)).then(r=>SupplyTermsSchema.parse(ok(r)));
const detail=(s:Store)=>get(s,`/supplier-console/products/${s.product.product_id}`).then(r=>SupplierProductDetailSchema.parse(ok(r)));
const offer=(s:Store,version:string)=>send(s,`/products/${s.product.product_id}/supply-offer`,{},version).then(r=>ok(r));
async function fixture(){const supplier=await x.store(83),seller=await x.store(10,false);const saved=ok(await send(supplier,termsPath(supplier),body,supplier.product.version,'PATCH'));return {supplier,seller,saved};}
const propose=(s:Store,o:any,price:number)=>send(s,'/distribution-selections',{offer_id:o.offer_id,terms_sha256:o.terms_sha256,retail_price_minor:price}).then(r=>ok(r,201));
const accept=(s:Store,l:any)=>send(s,`/supply-requests/${l.selection_id}/decision`,{decision:'accepted',listing_sha256:l.listing_sha256},l.version).then(r=>ok(r));

test('nullable additive columns retain database bounds, including out-of-range INSERT rejection',async()=>{
 const {supplier}=await fixture();
 const columns=(await x.h.pool.query(`SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema=$1 AND table_name='commerce_items' AND column_name=ANY($2::text[]) ORDER BY column_name`,[x.h.schema,keys])).rows;
 assert.deepEqual(columns,[{column_name:'lead_time_days',data_type:'integer',is_nullable:'YES',column_default:null},{column_name:'minimum_order_quantity',data_type:'integer',is_nullable:'YES',column_default:null},{column_name:'msrp_minor',data_type:'bigint',is_nullable:'YES',column_default:null}]);
 for(const [field,values] of [['msrp_minor',[0,100000001]],['minimum_order_quantity',[0,10001]],['lead_time_days',[-1,366]]] as const)for(const value of values){
  await assert.rejects(x.h.pool.query(`INSERT INTO commerce_items(item_id,shop_id,sku,title,description,price_minor,shipping_minor,stock,reserved,shipping_terms,return_terms,${field}) SELECT $2,shop_id,$3,title,description,price_minor,shipping_minor,stock,0,shipping_terms,return_terms,$4 FROM commerce_items WHERE item_id=$1`,[supplier.product.product_id,randomUUID(),'invalid-'+randomUUID(),value]),(e:unknown)=>(e as {code:string}).code==='23514');
 }
 assert.equal(await x.h.count('commerce_items'),1);assert.deepEqual(pick(await current(supplier)),empty);
});

test('writes distinguish omitted, null and values, with one version/fact/receipt and exact historical replay',async()=>{
 const {supplier,saved}=await fixture(),path=termsPath(supplier),key=randomUUID(),input={...body,...references};
 const first=ok(await send(supplier,path,input,saved.version,'PATCH',key));assert.equal(first.version,String(BigInt(saved.version)+1n));
 assert.deepEqual(pick(await current(supplier)),references);assert.deepEqual(pick(await detail(supplier)),references);
 const count=()=>x.h.count('scoped_transition_journal',"WHERE operation='storefront.supply-terms.update' AND aggregate_id=$1",[supplier.product.product_id]);
 assert.equal(await count(),2);
 assert.deepEqual(ok(await send(supplier,path,input,saved.version,'PATCH',key)),first);assert.equal(await count(),2);
 const omitted=ok(await send(supplier,path,body,first.version,'PATCH'));assert.deepEqual(pick(omitted),references);
 const cleared=ok(await send(supplier,path,{...body,lead_time_days:null},omitted.version,'PATCH'));assert.deepEqual(pick(cleared),{...references,lead_time_days:null});
 assert.deepEqual(pick(await detail(supplier)),{...references,lead_time_days:null});
 const conflict=await send(supplier,path,{...input,lead_time_days:2},saved.version,'PATCH',key);ok(conflict,409);assert.equal(conflict.data.code,'idempotency_conflict');
 ok(await send(supplier,path,input,saved.version,'PATCH'),412);
 const replay=ok(await send(supplier,path,input,saved.version,'PATCH',key));assert.deepEqual(replay,first);assert.deepEqual(pick(await current(supplier)),{...references,lead_time_days:null});
 const allCleared=ok(await send(supplier,path,{...body,...empty},cleared.version,'PATCH'));assert.deepEqual(pick(allCleared),empty);
 const receipts=(await x.h.pool.query(`SELECT response FROM scoped_command_receipts WHERE operation='storefront.supply-terms.update' AND target_id=$1`,[supplier.product.product_id])).rows;
 assert.equal(receipts.length,5);
});

test('wire validation rejects every bound and non-integer type without changing stored terms, version or facts',async()=>{
 const {supplier,saved}=await fixture(),path=termsPath(supplier),before=await current(supplier),facts=await x.h.count('scoped_transition_journal');
 for(const [key,min,max] of [['msrp_minor',1,100000000],['minimum_order_quantity',1,10000],['lead_time_days',0,365]] as const){
  for(const value of [min-1,max+1,1.5,'2',true,{},[]]){
   const reply=await send(supplier,path,{...body,[key]:value},saved.version,'PATCH');ok(reply,422);
   assert.equal(reply.data.code,'validation_failed');assert.equal(reply.data.type,'about:blank');assert.deepEqual(Object.keys(reply.data).sort(),['type','title','status','code','detail'].sort());assert(reply.data.detail.startsWith(key+': '));
   assert.deepEqual(await current(supplier),before);assert.equal(await x.h.count('scoped_transition_journal'),facts);
  }
 }
 for(const values of [{msrp_minor:1,minimum_order_quantity:1,lead_time_days:0},{msrp_minor:100000000,minimum_order_quantity:10000,lead_time_days:365}]){
  const v=await current(supplier);assert.deepEqual(pick(ok(await send(supplier,path,{...body,...values},v.version,'PATCH'))),values);
 }
});

test('unset snapshots preserve the seven historical keys/hash and republish identity; each reference alone outdates an offer',async()=>{
 const row={title:legacy.title,description:legacy.description,price_minor:'400',shipping_minor:'50',shipping_terms:legacy.shipping_terms,return_terms:legacy.return_terms,...empty};
 assert.deepEqual(supplyOfferTerms(row,'TWD'),legacy);assert.equal(digest(legacy),'2442de710a0d24da0d4e24b4bcd7a4b27a994c275704c3827853918398e8f69c');assert.equal(digest(supplyOfferTerms(row,'TWD')),digest(legacy));
 const {supplier,seller,saved}=await fixture();let published=await offer(supplier,saved.version);
 assert.equal(Object.keys(published.terms).length,7);assert.deepEqual(await offer(supplier,saved.version),published);assert.equal((await detail(supplier)).product.offer?.matches_current_terms,true);
 const older=await propose(seller,published,250);let version=saved.version;
 for(const key of keys){
  const changed=ok(await send(supplier,termsPath(supplier),{...body,...empty,[key]:references[key]},version,'PATCH'));version=changed.version;
  assert.equal((await detail(supplier)).product.offer?.matches_current_terms,false,key);
  const next=await offer(supplier,version);assert.notEqual(next.offer_id,published.offer_id);assert.equal(next.terms[key],references[key]);assert.equal(Object.keys(next.terms).length,8);
  assert.equal((await detail(supplier)).product.offer?.matches_current_terms,true);assert.deepEqual(await offer(supplier,version),next);published=next;
 }
 const historical=ok(await get(seller,'/distribution-selections')).items[0];assert.equal(historical.selection_id,older.selection_id);assert.equal(historical.offer.state,'withdrawn');assert.equal(Object.keys(historical.offer.terms).length,7);
});

test('suggested price never gates either seller price; minimum and lead references leave display, reservation and cart decisions identical',async()=>{
 const {supplier,seller,saved}=await fixture();const o=await offer(supplier,saved.version),selected=await accept(supplier,await propose(seller,o,1200));await x.publish(seller);
 const buyer=(await x.h.person('合成買家')).session;
 const quote=async(s:Store,sku:string)=>{const revision=ok(await get(s,'' )).publication.current_revision;return ok(await x.h.call('POST',`/hosted-stores/${s.slug}/reservation-quotes`,buyer,{publication_revision:revision,items:[{sku,quantity:1}]},{'Idempotency-Key':randomUUID()},app),201);};
 const cart=(s:Store,sku:string)=>x.tx(q=>cartQuote(q,s,{publication_revision:'1',lines:[{sku,quantity:1}]},{shipping:createShippingQuotePort({environment:'sandbox'})}));
 const beforePage=ok(await get(seller,'/supply-catalog/'+o.offer_id)),beforeQuote=await quote(seller,selected.sku),beforeCart=await cart(seller,selected.sku);
 const updated=ok(await send(supplier,termsPath(supplier),{...body,...references},saved.version,'PATCH')),newOffer=await offer(supplier,updated.version);
 const lower=await x.store(10,false),higher=await x.store(10,false);
 for(const [s,price] of [[lower,1200],[higher,99999999]] as const){
  const applied=await propose(s,newOffer,price);assert.equal(applied.state,'awaiting_supply_acceptance');const accepted=await accept(supplier,applied);assert.equal(accepted.state,'sellable');assert.equal(accepted.retail_price_minor,price);await x.publish(s);
  const page=ok(await get(s,'/supply-catalog/'+newOffer.offer_id));assert.deepEqual(pick(page.offer.terms),references);assert.deepEqual(page.sale_paths,beforePage.sale_paths);
  const reserved=await quote(s,accepted.sku);assert.equal(reserved.items[0].quantity,1);assert.equal(reserved.items[0].line_total_minor,price);assert.equal(reserved.payment_enabled,beforeQuote.payment_enabled);
  const result=await cart(s,accepted.sku);assert.equal(result.lines[0].state,beforeCart.lines[0].state);assert.deepEqual(result.shipping,beforeCart.shipping);
  if(price===1200){const comparable=(value:typeof result)=>({...value,lines:value.lines.map(line=>({...line,sku:'same-selection'}))});assert.deepEqual(comparable(result),comparable(beforeCart),'all cart quote fields remain identical at the same retail price');}
  const order=ok(await x.h.call('POST',`/hosted-stores/${s.slug}/reservation-orders`,buyer,{quote_id:reserved.quote_id,terms_sha256:reserved.terms_sha256,client_order_id:randomUUID()},{'Idempotency-Key':randomUUID()},app),201);
  assert.equal(order.items[0].quantity,1);assert.equal(order.state,'reserved');
  for(const key of keys)assert.equal(JSON.stringify(order).includes(key),false);
  for(const endpoint of [`/api/v1/public/stores/${s.slug}`,`/shops/${s.slug}`,`/shops/${s.slug}/products/${accepted.sku}`]){
   const response=await app.request(x.h.origin+endpoint);assert.equal(response.status,200);const text=await response.text();for(const value of [...keys,...Object.values(references).map(String)])assert.equal(text.includes(value),false,endpoint+' leaked advisory data');
  }
 }
 const report=ok(await get(supplier,'/supplier-console/report?from=2026-01-01&to=2026-12-31'));assert.equal(report.products.outdated,0);
 const csv=await get(supplier,'/supplier-console/report.csv?from=2026-01-01&to=2026-12-31');assert.equal(csv.status,200);
 const reservations=ok(await get(supplier,'/supplier-console/reservations'));assert.equal(reservations.items.length,2,'minimum order quantity does not block one-item reservations');
});

test('shared presentation preserves byte-identical old markup and adds only supplied reference rows',()=>{
 const source=readFileSync(new URL('../../modules/agent-commerce/hosted-ui/SupplyOfferPresentation.tsx',import.meta.url),'utf8');
 const module={exports:{} as {SupplyOfferPresentation:React.ComponentType<any>}};
 runInNewContext(transformSync(source,{loader:'tsx',format:'cjs'}).code,{module,exports:module.exports,React,Intl,require:(name:string)=>name.endsWith('.css')||name.endsWith('SupplyOfferText')?{}:{formatMinor}});
 const render=(terms:Record<string,unknown>)=>renderToStaticMarkup(React.createElement(module.exports.SupplyOfferPresentation,{terms,supplierName:'合成供應商',arrangement:null}));
 assert.equal(createHash('sha256').update(render(legacy)).digest('hex'),'7ab5902d03adf315d95389ed517b8857a3ada03743ee260658b5b137f4020bb8');
 const referenceNote='這些是供應商提供的參考資訊。系統不會依最低訂量限制預留或結帳，也不保證出貨時間。';
 for(const text of ['供應商建議售價','訂貨與交期',referenceNote])assert(!render(legacy).includes(text),text);
 const present=render({...legacy,msrp_minor:45000,minimum_order_quantity:2,lead_time_days:3});
 for(const text of ['供應商建議售價','$450.00','建議售價只供參考，你可以自行決定零售價。','訂貨與交期',referenceNote,'建議最低訂量：每次 2 件','預估交期：收到訂單後約 3 天內出貨'])assert(present.includes(text),text);
 assert(!present.includes('每次訂貨至少'));
 const sameDay=render({...legacy,lead_time_days:0});assert(sameDay.includes(referenceNote));assert(sameDay.includes('預估交期：收到訂單當天出貨'));assert(!sameDay.includes('建議最低訂量：'));assert(!sameDay.includes('供應商建議售價'));
});
