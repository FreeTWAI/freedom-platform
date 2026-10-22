import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import type {Pool} from 'pg';
import {createApp} from '../../apps/platform-api/src/app.js';
import {MemberOrderPageSchema} from '../../contracts/guild-launchpad/v1/hosted-checkout.js';
import {mapPersonPrincipal} from '../../packages/resource-scopes/index.js';
import {isolatedTransaction} from '../../packages/resource-scopes/tenant-transaction.js';
import {createTenantListCursorCodec} from '../../packages/shared/tenant-list-cursor.js';
import {freezeCheckout,placeCheckoutOrder,cancelUnpaidOrder,canonicalJSON} from '../../modules/agent-commerce/checkout/index.js';
import {createPaymentMethodsPort} from '../../modules/agent-commerce/payments/offline/methods.js';
import {createStoreAdmissionPort} from '../../modules/agent-commerce/operations/admissions.js';
import {checkoutHarness,ports,type CheckoutHarness} from './hosted-checkout-harness.js';
import {TENANT_CURSOR_TEST_KEY} from './tenant-cursor-fixture.js';

let x:CheckoutHarness;
let s:Awaited<ReturnType<CheckoutHarness['store']>>,other:typeof s;
let a:Awaited<ReturnType<CheckoutHarness['h']['person']>>,b:typeof a;
let pa:string,pb:string,bank:string,template:string;
const settings={checkoutEnabled:true,quarantine:false,providerProfiles:[]};
function app(pool:Pool=x.runtime,overrides:Parameters<typeof createApp>[3]={}) {
  return createApp(pool,x.h.origin,'local',{guildLaunchpadEnabled:true,tenantCursorSigningKey:TENANT_CURSOR_TEST_KEY,commerceSettings:settings,commercePorts:{...ports,admission:{allowed:()=>false}},...overrides});
}
async function get(path:string,person:typeof a|null=a,target=app()) {
  return x.h.call('GET',path,person?.session,undefined,{},target);
}
async function place(store:typeof s,principal:string|null,bankTransfer=false) {
  const p=bankTransfer?{...ports,paymentMethods:createPaymentMethodsPort({environment:'sandbox',profiles:['offline.bank_transfer.v1']})}:ports;
  return x.tx(async q=>{
    const c=await freezeCheckout(q,store,{...x.input(store.product.sku,1),idempotencyKey:randomUUID(),...(principal?{memberPrincipalId:principal}:{})},p);
    return placeCheckoutOrder(q,store,{checkoutId:c.checkout_id,termsSha256:c.terms_sha256,clientOrderId:randomUUID(),buyerPrincipalId:principal,environment:'sandbox',paymentMethod:bankTransfer?'bank_transfer':'immediate_card'},p);
  });
}
/** Valid retained cancelled history, including matching durable released holds. */
async function history(count:number,principal:string,above=false) {
  const existing=new Set((await x.h.pool.query("SELECT right(display_number,6) suffix FROM commerce_checkout_orders WHERE instance_id=$1",[other.instanceId])).rows.map(r=>r.suffix));
  const suffixes:string[]=[];
  for(let n=0;suffixes.length<count;n++){const suffix=n.toString(16).toUpperCase().padStart(6,'0');if(!existing.has(suffix))suffixes.push(suffix);}
  const ids=suffixes.map(()=>randomUUID()),clients=suffixes.map(()=>randomUUID());
  await isolatedTransaction(x.h.pool,async q=>{
    await q.query(`INSERT INTO commerce_orders(order_id,public_shop_id,external_id,request_sha256,currency,total_minor,created_at,expires_at,order_profile,buyer_principal_id,client_order_id)
      SELECT n.id,o.public_shop_id,'chk:'||co.checkout_id::text||':'||n.client::text,o.request_sha256,o.currency,o.total_minor,t,t+interval '30 minutes','hosted_checkout',$2,n.client
      FROM commerce_orders o JOIN commerce_checkout_orders co USING(order_id)
      CROSS JOIN unnest($3::uuid[],$4::uuid[]) WITH ORDINALITY n(id,client,seq)
      CROSS JOIN LATERAL (SELECT o.created_at+($5::integer*interval '1 second')+(n.seq%4)*interval '1 microsecond' t) stamp
      WHERE o.order_id=$1`,[template,principal,ids,clients,above?10:0]);
    await q.query(`INSERT INTO commerce_checkout_orders(order_id,tenant_id,instance_id,checkout_id,customer_id,contact_id,display_number,terms,terms_sha256,environment)
      SELECT n.id,co.tenant_id,co.instance_id,co.checkout_id,co.customer_id,co.contact_id,to_char(o.created_at AT TIME ZONE 'Asia/Taipei','YYMMDD')||'-'||n.suffix,co.terms,co.terms_sha256,co.environment
      FROM commerce_checkout_orders co CROSS JOIN unnest($2::uuid[],$3::text[]) n(id,suffix) JOIN commerce_orders o ON o.order_id=n.id WHERE co.order_id=$1`,[template,ids,suffixes]);
    await q.query(`INSERT INTO commerce_order_lines(order_id,selection_id,item_id,quantity,snapshot,order_profile,supplier_shop_id,hosted_offer_id,acceptance_id,listing_sha256)
      SELECT n.id,l.selection_id,l.item_id,l.quantity,l.snapshot,l.order_profile,l.supplier_shop_id,l.hosted_offer_id,l.acceptance_id,l.listing_sha256
      FROM commerce_order_lines l CROSS JOIN unnest($2::uuid[]) n(id) WHERE l.order_id=$1`,[template,ids]);
    await q.query(`INSERT INTO commerce_inventory_reservations(order_id,item_id,supplier_shop_id,quantity,state,created_at,expires_at,released_at)
      SELECT o.order_id,l.item_id,l.supplier_shop_id,l.quantity,'released',o.created_at,o.expires_at,o.created_at+interval '1 microsecond'
      FROM commerce_orders o JOIN commerce_order_lines l USING(order_id) WHERE o.order_id=ANY($1::uuid[])`,[ids]);
    await q.query("UPDATE commerce_checkout_orders SET lifecycle_state='cancelled',cancel_reason='buyer_cancelled',cancelled_at=clock_timestamp(),version=version+1 WHERE order_id=ANY($1::uuid[])",[ids]);
  });
  return ids;
}
async function domainSnapshot() {
  const tables=(await x.h.pool.query("SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND (tablename LIKE 'commerce_%' OR tablename IN ('principals','resource_scopes','auth_rate_limits')) ORDER BY tablename")).rows;
  const hashes:Record<string,string>={};
  for(const {tablename} of tables){assert.match(tablename,/^[a-z_]+$/);hashes[tablename]=createHash('sha256').update(JSON.stringify((await x.h.pool.query(`SELECT to_jsonb(t) row FROM "${tablename}" t ORDER BY to_jsonb(t)::text`)).rows)).digest('hex');}
  return hashes;
}
before(async()=>{
  x=await checkoutHarness('fp_member_checkout');await x.reset();
  s=await x.store(30);other=await x.store(30);
  a=await x.h.person('合成買家甲');b=await x.h.person('合成買家乙');
  pa=(await x.tx(q=>mapPersonPrincipal(q,a.id))).principal_id;pb=(await x.tx(q=>mapPersonPrincipal(q,b.id))).principal_id;
  const owner=(await x.h.pool.query("SELECT principal_id FROM principals WHERE user_ref=$1 AND kind='person'",[s.owner.user.user_id])).rows[0].principal_id;
  const document={schema:'freedom.offline-payment-settings/v1',bank_transfer:{bank_code:'000',bank_name:'合成測試銀行',branch_name:null,account_number:'000000123456',account_name:'合成測試商店',deadline_days:3,note:null},cash_on_meetup:null};
  await x.h.pool.query('INSERT INTO commerce_offline_payment_settings(tenant_id,instance_id,version,document,document_sha256,created_by_principal_id) VALUES($1,$2,1,$3,$4,$5)',[s.tenantId,s.instanceId,document,createHash('sha256').update(canonicalJSON(document)).digest('hex'),owner]);
  bank=(await place(s,pa,true)).order_id;
  template=(await place(other,pa)).order_id;await x.tx(q=>cancelUnpaidOrder(q,other,template,'buyer','buyer_cancelled'));
  await place(s,pb);await place(other,pb);await place(s,null);
  const quoted=await x.h.post(`/hosted-stores/${s.slug}/quotes`,a.session,{publication_revision:'1',items:[{sku:s.product.sku,quantity:1}]},undefined,randomUUID(),x.app);
  assert.equal(quoted.status,201,JSON.stringify(quoted.data));
  const legacy=await x.h.post(`/hosted-stores/${s.slug}/orders`,a.session,{quote_id:quoted.data.quote_id,terms_sha256:quoted.data.terms_sha256,client_order_id:randomUUID()},undefined,randomUUID(),x.app);
  assert.equal(legacy.status,201,JSON.stringify(legacy.data));
  await x.h.pool.query("INSERT INTO commerce_orders(order_id,public_shop_id,external_id,request_sha256,currency,total_minor) VALUES($1,$2,'synthetic-imported-history',$3,'TWD',100)",[randomUUID(),s.storefront_shop_id,'a'.repeat(64)]);
  await history(100,pa);await history(1500,pb);
  await x.h.pool.query('ANALYZE commerce_orders; ANALYZE commerce_checkout_orders; ANALYZE commerce_storefront_publications; ANALYZE commerce_storefront_profiles');
});
after(async()=>{await x?.stop();});

test('member list is an indexed original-buyer read across stores with frozen metadata and stable continuations',async()=>{
  const role=(await x.runtime.query("SELECT r.rolsuper,r.rolbypassrls,c.relowner::regrole::text<>current_user AS non_owner FROM pg_roles r CROSS JOIN pg_class c WHERE r.rolname=current_user AND c.oid='commerce_orders'::regclass")).rows[0];
  assert.deepEqual(role,{rolsuper:false,rolbypassrls:false,non_owner:true});
  const expected=(await x.h.pool.query("SELECT order_id FROM commerce_orders WHERE buyer_principal_id=$1 AND order_profile='hosted_checkout' ORDER BY created_at DESC,order_id DESC",[pa])).rows.map(r=>r.order_id);
  const captured:{sql:string;values:unknown[]}[]=[];
  const traced=new Proxy(x.runtime,{get(pool,key){if(key!=='connect'){const v=Reflect.get(pool,key);return typeof v==='function'?v.bind(pool):v;}return async()=>{const q=await pool.connect();return new Proxy(q,{get(client,p){if(p==='query')return async(sql:string,values:unknown[])=>{if(sql.startsWith('WITH candidate AS MATERIALIZED'))captured.push({sql,values});return client.query(sql,values);};const value=Reflect.get(client,p);return typeof value==='function'?value.bind(client):value;}});};}}) as Pool;
  const target=app(traced),before=await domainSnapshot();
  const first=await get('/me/orders',a,target);assert.equal(first.status,200,JSON.stringify(first.data));
  assert.equal(first.response.headers.get('Cache-Control'),'private, no-store');assert.equal(first.response.headers.get('Vary'),'Cookie');assert.equal(first.response.headers.get('Referrer-Policy'),'no-referrer');assert.equal(first.response.headers.get('Set-Cookie'),null);
  const page=MemberOrderPageSchema.parse(first.data);assert.equal(page.items.length,20);assert(page.next_cursor);
  assert.deepEqual(page.items.map(i=>i.order_ref),expected.slice(0,20));
  assert.deepEqual(Object.keys(page.items[0]).sort(),['created_at','currency','display_number','order_path','order_ref','status','store','total_minor']);
  assert(!JSON.stringify(page).includes('000000123456'));assert(!JSON.stringify(page).includes('synthetic-buyer@example.test'));
  const seen=page.items.map(i=>i.order_ref);let cursor:string|null=page.next_cursor;
  while(cursor){const next=await get('/me/orders?cursor='+encodeURIComponent(cursor),a,target);assert.equal(next.status,200);const p=MemberOrderPageSchema.parse(next.data);seen.push(...p.items.map(i=>i.order_ref));cursor=p.next_cursor;}
  assert.deepEqual(seen,expected);assert(seen.includes(bank));assert.equal(new Set(seen).size,seen.length);
  assert.deepEqual(await domainSnapshot(),before,'GET writes no commerce metadata, mapping, scopes or rate budget');
  for(const [label,capture] of [['first',captured[0]],['continuation',captured[1]]] as const){
    const plan=(await x.runtime.query('EXPLAIN (ANALYZE, BUFFERS) '+capture.sql,capture.values)).rows.map(r=>r['QUERY PLAN']).join('\n');
    assert.match(plan,/Index Scan using commerce_orders_member_checkout_created_idx/);assert.match(plan,/CTE candidate/);assert.match(plan,/rows=21(?:\.00)? loops=1/);
    console.log(`MEMBER_ORDERS_EXPLAIN_${label}\n${plan}`);
  }
  await history(1,pa,true);
  const next=MemberOrderPageSchema.parse((await get('/me/orders?cursor='+encodeURIComponent(page.next_cursor!))).data);
  assert.deepEqual(next.items.map(i=>i.order_ref),expected.slice(20,40),'new higher order never shifts the continuation');
  const draft=(await x.h.call('GET',s.root,s.owner,undefined,{},x.app)).data;
  assert.equal((await x.send(s,'',{name:'新的私人草稿名稱'},draft.version,'PATCH')).status,200);await x.publish(s);
  const current=MemberOrderPageSchema.parse((await get('/me/orders?limit=20')).data);
  const all=[...current.items];let c=current.next_cursor;while(c){const p=MemberOrderPageSchema.parse((await get('/me/orders?cursor='+encodeURIComponent(c))).data);all.push(...p.items);c=p.next_cursor;}
  assert.equal(all.find(i=>i.order_ref===bank)?.store.name,'合成商店');
});

test('HTTP session, cursor, onboarding, quarantine and flag boundaries do not widen buyer ownership',async()=>{
  assert.equal((await get('/me/orders',null)).status,401);
  assert.equal((await app().request(x.h.origin+'/api/v1/me/orders',{headers:{Cookie:a.session.cookie}})).status,200,'a read needs no CSRF header');
  for(const query of ['limit=0','limit=21','limit=-1','limit=1.5','limit=01','limit=1&limit=1','cursor=','buyer_principal_id='+pa,'tenant_id='+s.tenantId])assert.equal((await get('/me/orders?'+query)).status,422,query);
  const first=MemberOrderPageSchema.parse((await get('/me/orders?limit=1')).data);assert.equal(first.items.length,1);assert(first.next_cursor);
  for(const cursor of ['broken',first.next_cursor!.slice(0,-1)+'!',createTenantListCursorCodec(TENANT_CURSOR_TEST_KEY,{origin:x.h.origin,environment:'other'}).encode({at:'2028-02-29T00:00:00.123456Z',id:bank},{purpose:'buyer-orders',tenantId:'',scopeId:'',principalId:pa,resourceId:null,filter:'{"profile":"hosted_checkout","v":1}'})])assert.equal((await get('/me/orders?cursor='+encodeURIComponent(cursor))).status,422);
  assert.equal((await get('/me/orders?cursor='+encodeURIComponent(first.next_cursor!),b)).status,422);
  const codec=createTenantListCursorCodec(TENANT_CURSOR_TEST_KEY,{origin:x.h.origin,environment:'local'});
  const v1=codec.encode({at:'2028-02-29T00:00:00.123456Z',id:bank},{purpose:'buyer-orders',tenantId:'',scopeId:randomUUID(),principalId:pa,resourceId:null,filter:'{"shared":true}'});
  assert.equal((await get('/me/orders?cursor='+encodeURIComponent(v1))).status,422);
  assert.equal((await get('/me/orders',a,app(x.runtime,{tenantCursorSigningKey:undefined}))).data.code,'tenant_cursor_unavailable');
  const off=app(x.runtime,{commerceSettings:{...settings,checkoutEnabled:false}});
  for(const person of [a,null]){
    const headers:Record<string,string>=person?{Cookie:person.session.cookie}:{};
    const hidden=await off.request(x.h.origin+'/api/v1/me/orders',{headers}),unknown=await off.request(x.h.origin+'/api/v1/me/unknown-checkout-list',{headers});
    assert.equal(hidden.status,unknown.status);assert.equal(await hidden.text(),await unknown.text());
    for(const name of ['Cache-Control','Content-Security-Policy','X-Robots-Tag','X-Content-Type-Options','Referrer-Policy','Content-Type','Vary'])assert.equal(hidden.headers.get(name),unknown.headers.get(name),name);
  }
  const unmapped=await x.h.person('合成新會員');const before=await domainSnapshot();assert.deepEqual((await get('/me/orders',unmapped)).data,{items:[],next_cursor:null});assert.deepEqual(await domainSnapshot(),before);
  await x.h.pool.query('UPDATE users SET onboarding_required=true,onboarding_completed_at=NULL WHERE user_id=$1',[a.id]);
  assert.equal((await get('/me/orders')).status,200);assert.equal((await get('/me/reservations')).status,403);
  assert.equal((await app().request(x.h.origin+'/api/v1/me/orders',{method:'HEAD',headers:{Cookie:a.session.cookie}})).status,403);
  assert.equal((await x.h.call('POST','/me/orders',a.session,{}, {},app())).data.code,'onboarding_required');
  await x.h.pool.query('UPDATE users SET onboarding_required=false WHERE user_id=$1',[a.id]);
  await x.h.fullMember(a.id,'guild_commerce_sales');await x.h.pool.query("UPDATE positioning_profession_memberships SET state='left' WHERE user_id=$1",[a.id]);assert.equal((await get('/me/orders')).status,200);
  const quarantined=app(x.runtime,{commerceSettings:{...settings,quarantine:true}}),snapshot=await domainSnapshot();assert.equal((await get('/me/orders',a,quarantined)).status,200);assert.deepEqual(await domainSnapshot(),snapshot);
  await x.h.pool.query("UPDATE principals SET status='disabled' WHERE principal_id=$1",[pa]);assert.equal((await get('/me/orders')).data.code,'member_unavailable');await x.h.pool.query("UPDATE principals SET status='active' WHERE principal_id=$1",[pa]);
  for(const change of ['deactivated','expired','revoked','deleted'] as const){
    const person=await x.h.person('合成失效會員');
    if(change==='deactivated')await x.h.pool.query('UPDATE users SET active=false WHERE user_id=$1',[person.id]);
    else if(change==='expired')await x.h.pool.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",[person.id]);
    else if(change==='revoked')await x.h.pool.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=$1',[person.id]);
    else {await x.h.pool.query('DELETE FROM sessions WHERE user_id=$1',[person.id]);await x.h.pool.query('DELETE FROM users WHERE user_id=$1',[person.id]);}
    assert.equal((await get('/me/orders',person)).status,401,change);
  }
});

test('a late session or principal change suppresses the list; invalid retained metadata is never an empty page',async()=>{
  async function readWithSeam(run:()=>Promise<void>,corrupt=false){
    let fired=false;
    const wrapped=new Proxy(x.runtime,{get(pool,key){if(key!=='connect'){const v=Reflect.get(pool,key);return typeof v==='function'?v.bind(pool):v;}return async()=>{const q=await pool.connect();return new Proxy(q,{get(client,p){if(p==='query')return async(sql:string,values:unknown[])=>{
      const result=await client.query(sql,values);
      if(!fired&&sql.startsWith('WITH candidate AS MATERIALIZED')){fired=true;await run();if(corrupt)result.rows[result.rows.length-1].provenance=false;}
      return result;
    };const v=Reflect.get(client,p);return typeof v==='function'?v.bind(client):v;}});};}}) as Pool;
    const response=await get('/me/orders',a,app(wrapped));assert(fired);return response;
  }
  const disabled=await readWithSeam(async()=>{await x.h.pool.query("UPDATE principals SET status='disabled' WHERE principal_id=$1",[pa]);});
  assert.equal(disabled.status,403);assert.equal(disabled.data.code,'member_unavailable');assert.equal(disabled.data.items,undefined);
  await x.h.pool.query("UPDATE principals SET status='active' WHERE principal_id=$1",[pa]);
  const inactive=await readWithSeam(async()=>{await x.h.pool.query('UPDATE users SET active=false WHERE user_id=$1',[a.id]);});
  assert.equal(inactive.status,401);assert.equal(inactive.data.items,undefined);await x.h.pool.query('UPDATE users SET active=true WHERE user_id=$1',[a.id]);
  const broken=await readWithSeam(async()=>{},true);assert.equal(broken.status,500);assert.equal(broken.data.code,'internal_error');assert.equal(broken.data.items,undefined);
});

test('revoked admission keeps a still-published shop on its public member order page',async()=>{
  const version=(await x.h.pool.query('SELECT version::text FROM module_instances WHERE instance_id=$1',[s.instanceId])).rows[0].version;
  assert.equal((await x.send(s,'/upgrade',{},version)).status,200);
  const csrf=randomUUID(),adminEmail=`admin-${randomUUID()}@example.test`;
  await x.h.pool.query(`INSERT INTO platform_admins(admin_id,community_id,email,display_name)
    SELECT $1,community_id,$2,'合成獨立准入管理員' FROM tenants WHERE tenant_id=$3`,[randomUUID(),adminEmail,s.tenantId]);
  const profiles=['offline.bank_transfer.v1'],admission=createStoreAdmissionPort('sandbox',profiles);
  const target=app(x.runtime,{commerceSettings:{...settings,consoleEnabled:true,providerProfiles:profiles},commercePorts:{...ports,admission},adminVerifier:async()=>({email:adminEmail,subject:'synthetic-member-orders-admin',csrfToken:csrf})});
  const admin=async(path:string,body:unknown,status:number)=>{
    const response=await target.request(x.h.origin+'/admin/api/commerce/store-admissions'+path,{method:'POST',headers:{Origin:x.h.origin,'X-Admin-CSRF':csrf,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify(body)});
    const value=await response.json() as any;assert.equal(response.status,status,JSON.stringify(value));return value;
  };
  const admitted=await admin('',{tenant_id:s.tenantId,instance_id:s.instanceId,reason:'合成公開訂單准入驗證'},201);
  assert.equal(await x.tx(async q=>admission.allowed(q,s)),true);
  const root=`/public/stores/${s.slug}`,original=await get(root+'/orders/'+bank,a,target);
  assert.equal(original.status,200);assert.equal(original.data.offline_instructions.account_number,'000000123456');
  const revoked=await admin('/'+admitted.admission_id+'/revoke',{reason:'合成只撤銷准入，商店繼續公開'},200);
  assert(revoked.revoked_at);assert.equal(await x.tx(async q=>admission.allowed(q,s)),false);
  const html=await target.request(x.h.origin+`/shops/${s.slug}/orders/${bank}`,{headers:{Cookie:a.session.cookie}});
  assert.equal(html.status,200);const body=await html.text();
  assert.doesNotMatch(body,/data-retained-order="true"/);assert.match(body,/class="shop-footer"/);
  const read=await get(root+'/orders/'+bank,a,target);assert.equal(read.status,200);assert.equal(read.data.order_ref,bank);
  assert.deepEqual(read.data.offline_instructions,original.data.offline_instructions);
  const publication=await get(root,a,target);assert.equal(publication.status,200);
  const blocked=await x.h.post(root+'/checkouts',a.session,{...x.input(s.product.sku,1),publication_revision:publication.data.revision},undefined,randomUUID(),target);
  assert.equal(blocked.status,409);assert.equal(blocked.data.code,'checkout_not_enabled');
});

test('retained private B07 admits only the active original member after unpublication and revoked admission',async()=>{
  const current=(await x.h.call('GET',s.root,s.owner,undefined,{},x.app)).data;
  assert.equal((await x.send(s,'/unpublish',{},current.version)).status,200);
  const path=`/shops/${s.slug}/orders/${bank}`,json=`/api/v1/public/stores/${s.slug}/orders/${bank}`,target=app();
  const html=await target.request(x.h.origin+path,{headers:{Cookie:a.session.cookie}});assert.equal(html.status,200);const body=await html.text();
  assert.equal(html.headers.get('Cache-Control'),'private, no-store');assert.equal(html.headers.get('X-Robots-Tag'),'noindex, nofollow');
  assert.match(body,/data-retained-order="true"/);assert.match(body,/freedom-workshop.webp/);assert.match(body,/合成商店/);
  assert.doesNotMatch(body,/新的私人草稿名稱|商品僅供|shop-footer|shop-information|shop-merchant-logo|data-store-appearance|000000123456|synthetic-buyer/);
  const read=await target.request(x.h.origin+json,{headers:{Cookie:a.session.cookie}});assert.equal(read.status,200);const value=await read.json() as any;
  assert.equal(value.offline_instructions.account_number,'000000123456');assert.equal(value.store.name,'合成商店');
  const missing=await target.request(x.h.origin+`/shops/${s.slug}`);assert.equal(missing.status,404);const missingBody=await missing.text();
  for(const [slug,ref,cookie] of [[s.slug,bank,undefined],[s.slug,bank,b.session.cookie],[other.slug,bank,a.session.cookie],[s.slug,'malformed',a.session.cookie]] as const){
    const r=await target.request(x.h.origin+`/shops/${slug}/orders/${ref}`,{headers:cookie?{Cookie:cookie}:{}});
    if(slug===other.slug)assert.equal(r.status,200); // Current public shell stays public; its order API still denies the wrong store.
    else {assert.equal(r.status,404);assert.equal(await r.text(),missingBody);}
    const api=await target.request(x.h.origin+`/api/v1/public/stores/${slug}/orders/${ref}`,{headers:cookie?{Cookie:cookie}:{}});assert.equal(api.status,404);
  }
  assert.equal((await target.request(x.h.origin+`/api/v1/public/stores/${s.slug}`)).status,404);
  await x.h.pool.query(`UPDATE commerce_checkout_contacts SET contact_name=NULL,contact_email=NULL,contact_phone=NULL,delivery=NULL,invoice=NULL,contact_salt=NULL,redacted_at=clock_timestamp()
    WHERE contact_id=(SELECT contact_id FROM commerce_checkout_orders WHERE order_id=$1)`,[bank]);
  const redacted=await target.request(x.h.origin+json,{headers:{Cookie:a.session.cookie}});assert.equal(redacted.status,200);const redactedOrder=await redacted.json() as any;
  assert.equal(redactedOrder.redacted,true);assert.equal(redactedOrder.contact,null);assert.equal(redactedOrder.offline_instructions.account_number,'000000123456');
  assert.equal((await get('/me/orders')).status,200);
  const snapshot=await domainSnapshot();
  const blocked=await target.request(x.h.origin+json+'/cancel',{method:'POST',headers:{Origin:x.h.origin,Cookie:a.session.cookie,'Content-Type':'application/json'},body:'{}'});assert.equal(blocked.status,404);
  const after=await domainSnapshot();delete snapshot.auth_rate_limits;delete after.auth_rate_limits;assert.deepEqual(after,snapshot);
  const off=app(x.runtime,{commerceSettings:{...settings,checkoutEnabled:false}});
  assert.equal((await off.request(x.h.origin+path,{headers:{Cookie:a.session.cookie}})).status,404);
  // Test-only deterministic seam: deactivate after the metadata read, before the final clock/identity check.
  let changed=false;
  const raced=new Proxy(x.runtime,{get(pool,key){if(key!=='connect'){const v=Reflect.get(pool,key);return typeof v==='function'?v.bind(pool):v;}return async()=>{const q=await pool.connect();return new Proxy(q,{get(client,p){if(p==='query')return async(sql:string,values:unknown[])=>{const result=await client.query(sql,values);if(!changed&&sql.includes('FROM commerce_orders o')&&sql.includes('pub.slug=$3')){changed=true;await x.h.pool.query('UPDATE users SET active=false WHERE user_id=$1',[a.id]);}return result;};const v=Reflect.get(client,p);return typeof v==='function'?v.bind(client):v;}});};}}) as Pool;
  const denied=await app(raced).request(x.h.origin+path,{headers:{Cookie:a.session.cookie}});assert.equal(denied.status,404);assert.equal(await denied.text(),missingBody);assert(changed);
  await x.h.pool.query('UPDATE users SET active=true WHERE user_id=$1',[a.id]);
});
