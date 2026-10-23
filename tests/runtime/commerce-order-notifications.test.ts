import {readRetainedMemberOrder} from '../../modules/agent-commerce/checkout/member-orders.js';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {before,after,test} from 'node:test';
import type {Pool,PoolClient,QueryResult} from 'pg';
import {checkoutHarness,type CheckoutHarness} from './hosted-checkout-harness.js';
import {canonicalJSON,freezeCheckout,type CheckoutPorts} from '../../modules/agent-commerce/checkout/terms.js';
import {placeCheckoutOrder,cancelUnpaidOrder} from '../../modules/agent-commerce/checkout/orders.js';
import {createPublicCheckout,placePublicOrder,cancelPublicOrder,type HostedCheckoutOptions} from '../../modules/agent-commerce/checkout/public-commands.js';
import {createOrderNotifications,SELLER_ORDER_NOTIFICATION_RECIPIENTS_SQL,type OrderNotificationPort} from '../../modules/agent-commerce/checkout/order-notifications.js';
import {createPaymentMethodsPort} from '../../modules/agent-commerce/payments/offline/methods.js';
import {completeMeetup,confirmOfflinePayment} from '../../modules/agent-commerce/payments/offline/confirm.js';
import {cancelSellerPaidCheckoutOrder,recordSellerPaidCancellationRefund,readSellerCheckoutOrder} from '../../modules/agent-commerce/checkout/seller-orders.js';
import {orderNotificationDestination} from '../../modules/agent-commerce/checkout/notification-action.js';
import {authenticate} from '../../modules/identity-membership/service.js';
import {listNotifications} from '../../modules/member-communications/service.js';
import {mapPersonPrincipal} from '../../packages/resource-scopes/index.js';
import {syntheticShippingPort} from '../../scripts/synthetic-shipping-quote.js';
import {Problem} from '../../packages/shared/problem.js';
import type {Actor} from '../../modules/identity-membership/service.js';
import {createApp} from '../../apps/platform-api/src/app.js';
import {TENANT_CURSOR_TEST_KEY} from './tenant-cursor-fixture.js';
import {applyOwnerAccountStatus} from '../../modules/tenant-workspaces/security-path.js';

let x:CheckoutHarness,s:Awaited<ReturnType<CheckoutHarness['store']>>,buyer:Awaited<ReturnType<CheckoutHarness['h']['person']>>;
let httpApp:ReturnType<typeof createApp>;
let owner:Actor,buyerPrincipal:string,ownerPrincipal:string,community:string,foreignCommunity:string;
const port=createOrderNotifications(true,{checkoutEnabled:true,quarantine:false})!;
const token=(cookie:string)=>cookie.split(';')[0].split('=').slice(1).join('=');
const basePorts=():CheckoutPorts=>({admission:{allowed:()=>true},shipping:syntheticShippingPort({method_ref:'meetup'}),
  paymentMethods:createPaymentMethodsPort({environment:'sandbox',profiles:['offline.bank_transfer.v1','offline.cash_on_meetup.v1']})});
const options=():HostedCheckoutOptions=>({origin:x.h.origin,environment:'sandbox',settings:{checkoutEnabled:true,quarantine:false,providerProfiles:[]},...basePorts(),orderNotifications:port});
before(async()=>{
  x=await checkoutHarness('fp_order_notices');await x.reset();s=await x.store(200);
  const version=(await x.h.pool.query('SELECT version::text FROM module_instances WHERE instance_id=$1',[s.instanceId])).rows[0].version;
  assert.equal((await x.h.call('POST',s.root+'/upgrade',s.owner,{}, {'Idempotency-Key':randomUUID(),'If-Match':`"${version}"`},x.app)).status,200);
  buyer=await x.h.person('合成通知買家');
  buyerPrincipal=(await x.tx(q=>mapPersonPrincipal(q,buyer.id))).principal_id;
  ownerPrincipal=(await x.tx(q=>mapPersonPrincipal(q,s.owner.user.user_id))).principal_id;
  owner=await authenticate(x.runtime,token(s.owner.cookie));
  community=owner.community_id;
  const document={schema:'freedom.offline-payment-settings/v1',bank_transfer:{bank_code:'000',bank_name:'合成銀行',branch_name:null,account_number:'000000123456',account_name:'合成測試帳戶',deadline_days:3,note:null},cash_on_meetup:{deadline_days:7}};
  await x.h.pool.query(`INSERT INTO commerce_offline_payment_settings(tenant_id,instance_id,version,document,document_sha256,created_by_principal_id)
    VALUES($1,$2,1,$3,$4,$5)`,[s.tenantId,s.instanceId,document,createHash('sha256').update(canonicalJSON(document)).digest('hex'),ownerPrincipal]);
  httpApp=createApp(x.runtime,x.h.origin,'local',{guildLaunchpadEnabled:true,hostedReservationsEnabled:true,tenantCursorSigningKey:TENANT_CURSOR_TEST_KEY,commerceSettings:options().settings,commerceOrderNotificationsEnabled:true,commercePorts:basePorts()});
});
after(async()=>x?.stop());
async function notices(id:string,event?:string){
  return(await x.h.pool.query(`SELECT * FROM member_notifications WHERE source_key LIKE $1 ORDER BY recipient_ref`,[`commerce-order/v1/${id}/${event??'%'}`])).rows;
}
async function freeze(){return x.tx(q=>freezeCheckout(q,s,{...x.input(s.product.sku,1),idempotencyKey:randomUUID()},basePorts()));}
async function placed(method:'bank_transfer'|'cash_on_meetup'='bank_transfer',principal=buyerPrincipal,notifications:OrderNotificationPort|null=port){
  const saved=await freeze();return x.tx(q=>placeCheckoutOrder(q,s,{checkoutId:saved.checkout_id,termsSha256:saved.terms_sha256,clientOrderId:randomUUID(),buyerPrincipalId:principal,environment:'sandbox',paymentMethod:method},{...basePorts(),orderNotifications:notifications??undefined}));
}
async function cancelThroughHttp(id:string){
  const response=await x.h.call('POST',`/public/stores/${s.slug}/orders/${id}/cancel`,buyer.session,{}, {},httpApp);
  assert.equal(response.status,200);return response.data;
}
function intercept(q:PoolClient,run:(text:string,values:unknown[]|undefined,next:()=>Promise<QueryResult>)=>Promise<QueryResult>):PoolClient {
  return new Proxy(q,{get(target,key,receiver){
    if(key==='query')return new Proxy(target.query,{apply(fn,_self,args){return run(args[0],args[1],()=>Reflect.apply(fn,target,args));}});
    return Reflect.get(target,key,receiver);
  }});
}
function observed(run:(logs:unknown[][])=>Promise<void>){
  const original=console.error,logs:unknown[][]=[];console.error=(...args)=>logs.push(args);
  return run(logs).finally(()=>{console.error=original;});
}

test('real member placement, concurrent retry and buyer cancellation use one atomic notice per event and no email-based identity',async()=>{
  const opt=options(),access={network:'198.51.100.80',sessionToken:token(buyer.session.cookie)};
  const opened=await createPublicCheckout(x.runtime,s.slug,x.input(s.product.sku,1),randomUUID(),access,opt);
  const browser={...access,deviceToken:token(opened.cookie)},input={terms_sha256:opened.value.terms_sha256,client_order_id:randomUUID(),payment_method:'bank_transfer' as const};
  const results=await Promise.all([placePublicOrder(x.runtime,s.slug,opened.value.checkout_ref,input,browser,opt),placePublicOrder(x.runtime,s.slug,opened.value.checkout_ref,input,browser,opt)]);
  assert.equal(results.filter(r=>r.created).length,1);assert.equal(results[0].value.order.order_ref,results[1].value.order.order_ref);
  const id=results[0].value.order.order_ref,D=results[0].value.order.display_number;
  const replay=await placePublicOrder(x.runtime,s.slug,opened.value.checkout_ref,input,browser,opt);assert.equal(replay.created,false);
  const rows=await notices(id);assert.equal(rows.length,1);assert.equal(rows[0].recipient_ref,s.owner.user.user_id);
  assert.equal(rows[0].title,'新訂單待確認收款');assert.equal(rows[0].body,`「合成商店」收到訂單 ${D}，等待銀行匯款；請至訂單頁查看。`);
  assert.equal(rows[0].source_key,`commerce-order/v1/${id}/placed`);
  assert.deepEqual(orderNotificationDestination({tab:rows[0].action_tab,resource_id:rows[0].action_resource_id}),{tab:'stores',hash:`#stores/${s.tenantId}/${s.instanceId}/orders/${id}`});
  assert.equal((await x.h.pool.query(`SELECT c.member_principal_id FROM commerce_checkout_orders co JOIN commerce_customers c USING(customer_id) WHERE co.order_id=$1`,[id])).rows[0].member_principal_id,null);
  await cancelThroughHttp(id);await cancelThroughHttp(id);
  const cancelled=await notices(id,'buyer_cancelled');assert.equal(cancelled.length,1);
  assert.equal(cancelled[0].title,'買家已取消訂單');assert.equal(cancelled[0].body,`「合成商店」的訂單 ${D} 已由買家取消。`);
  assert.equal(cancelled[0].recipient_ref,s.owner.user.user_id);assert.equal((await notices(id)).length,2);
  const cash=await placed('cash_on_meetup');assert.equal((await notices(cash.order_id))[0].title,'新訂單待安排面交');
  assert.equal((await notices(cash.order_id))[0].body,`「合成商店」收到訂單 ${cash.display_number}，等待面交付款；請至訂單頁查看。`);
  const self=await placed('bank_transfer',ownerPrincipal);assert.deepEqual(await notices(self.order_id),[]);
  const role=(await x.runtime.query(`SELECT r.rolsuper,r.rolbypassrls,pg_get_userbyid(c.relowner)=current_user AS owns,
    has_table_privilege(current_user,c.oid,'INSERT') AS inserts,c.relrowsecurity,c.relforcerowsecurity
    FROM pg_roles r CROSS JOIN pg_class c WHERE r.rolname=current_user AND c.oid='member_notifications'::regclass`)).rows[0];
  assert.deepEqual(role,{rolsuper:false,rolbypassrls:false,owns:false,inserts:true,relrowsecurity:false,relforcerowsecurity:false});
  const ordinary=basePorts(),guestPorts={...ordinary,paymentMethods:{...ordinary.paymentMethods!,offlinePaymentRequiresMember:false},orderNotifications:port};
  const guestCheckout=await x.tx(q=>freezeCheckout(q,s,{...x.input(s.product.sku,1),idempotencyKey:randomUUID()},guestPorts));
  const guest=await x.tx(q=>placeCheckoutOrder(q,s,{checkoutId:guestCheckout.checkout_id,termsSha256:guestCheckout.terms_sha256,clientOrderId:randomUUID(),buyerPrincipalId:null,environment:'sandbox',paymentMethod:'cash_on_meetup'},guestPorts));
  const date=(await x.h.pool.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'Asia/Taipei','YYYY-MM-DD') d")).rows[0].d;
  await completeMeetup(x.runtime,owner,s.tenantId,s.instanceId,guest.order_id,{amount_minor:guest.terms.total_minor,completed_on:date},randomUUID(),guest.version,{orderNotifications:port});
  assert.deepEqual(await notices(guest.order_id),[]);
});

test('offline buyer transactions retry one real recipient-key deadlock without repeating prechecks or budgets',async()=>{
  // A second owner keeps the store active when the contending owner deactivates.
  const other=await x.h.person('合成第二店主'),otherPrincipal=(await x.tx(q=>mapPersonPrincipal(q,other.id))).principal_id;
  await x.h.pool.query("INSERT INTO tenant_memberships(tenant_id,principal_id,role,status,accepted_at) VALUES($1,$2,'owner','active',clock_timestamp())",[s.tenantId,otherPrincipal]);
  const access={network:'198.51.100.85',sessionToken:token(buyer.session.cookie),expectedBuyer:`member:${buyer.id}` as const};
  const opened=await createPublicCheckout(x.runtime,s.slug,x.input(s.product.sku,1),randomUUID(),access,options());
  const browser={...access,deviceToken:token(opened.cookie)},input={terms_sha256:opened.value.terms_sha256,client_order_id:randomUUID(),payment_method:'bank_transfer' as const};
  async function cycle<T>(event:'placed'|'buyer_cancelled',run:(pool:Pool,opt:HostedCheckoutOptions)=>Promise<T>){
    const holder=await x.h.pool.connect();let command:Promise<{value?:T;error?:unknown}>|undefined;
    const statements:{text:string;values:unknown[]|undefined}[]=[],codes:string[]=[],orderIds:string[]=[];let emits=0,insertPid!:(pid:number)=>void;
    const inserting=new Promise<number>(resolve=>{insertPid=resolve;});
    const traced=new Proxy(x.runtime,{get(target,key){
      if(key==='connect')return async()=>intercept(await target.connect(),async(text,values,next)=>{
        statements.push({text,values});try{return await next();}catch(error){codes.push(String((error as {code?:string}).code));throw error;}
      });
      const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
    }});
    const opt={...options(),orderNotifications:{async emit(q:PoolClient,facts:Parameters<OrderNotificationPort['emit']>[1]){
      emits++;orderIds.push(facts.orderId);await port.emit(intercept(q,async(text,values,next)=>{
        if(text.includes('INSERT INTO member_notifications')&&values?.[1]===s.owner.user.user_id){
          insertPid((await q.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
        }
        return next();
      }),facts);
    }}};
    try{
      await holder.query('BEGIN');const holderPid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const deadlockTimeout=(await holder.query('SHOW deadlock_timeout')).rows[0].deadlock_timeout;
      await holder.query('SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE',[s.owner.user.user_id]);
      command=run(traced,opt).then(value=>({value}),error=>({error}));
      const pid=await Promise.race([inserting,command.then(outcome=>{throw outcome.error??new Error('command completed without the recipient INSERT');})]),deadline=Date.now()+15000;let blocked=false;
      while(Date.now()<deadline){
        const row=(await x.runtime.query('SELECT $2::int=ANY(pg_blocking_pids($1)) AS blocked FROM pg_stat_activity WHERE pid=$1 AND wait_event_type=\'Lock\'',[pid,holderPid])).rows[0];
        if(row?.blocked){blocked=true;break;}
      }
      assert.equal(blocked,true,'notification INSERT must be waiting on the held recipient key');
      // The notification backend began waiting first, so its default deadlock
      // timer detects this cycle before the owner's later tenant-lock wait.
      await holder.query('SELECT tenant_id FROM tenants WHERE tenant_id=$1 FOR UPDATE',[s.tenantId]);
      await holder.query('UPDATE users SET active=false WHERE user_id=$1',[s.owner.user.user_id]);
      await applyOwnerAccountStatus(holder,s.owner.user.user_id,false);
      await holder.query('COMMIT');
      const outcome=await command;assert.equal(outcome.error,undefined,'buyer transaction must recover from its 40P01');
      assert.equal(emits,2);assert.deepEqual(codes,['40P01']);
      const delivered=(await x.runtime.query('SELECT recipient_ref FROM member_notifications WHERE source_key=ANY($1::text[])',[orderIds.map(id=>`commerce-order/v1/${id}/${event}`)])).rows;
      assert.deepEqual(delivered,[{recipient_ref:other.id}],'the rolled-back attempt must leave no partial notice set');
      assert.equal(statements.filter(s=>s.text==='SET TRANSACTION READ ONLY').length,event==='placed'?1:0);
      for(const bucket of event==='placed'?['placementNetwork','placementStore']:['handoffNetwork']){
        assert.equal(statements.filter(s=>s.text.startsWith('INSERT INTO auth_rate_limits')&&String(s.values?.[0]).startsWith(`commerce:${bucket}:`)).length,1);
      }
      console.info('order_notice_deadlock_trace',{event,recipient_key_wait:true,sqlstate:codes[0],attempts:emits,deadlock_timeout:deadlockTimeout});
      return outcome.value!;
    }finally{
      await holder.query('ROLLBACK');holder.release();await command;
    }
  }
  try{
    const result=await cycle('placed',(pool,opt)=>placePublicOrder(pool,s.slug,opened.value.checkout_ref,input,browser,opt));
    const id=result.value.order.order_ref;
    assert.equal((await x.h.pool.query('SELECT active FROM users WHERE user_id=$1',[s.owner.user.user_id])).rows[0].active,false);
    assert.deepEqual((await notices(id,'placed')).map(n=>n.recipient_ref),[other.id]);
    await x.h.pool.query('UPDATE users SET active=true WHERE user_id=$1',[s.owner.user.user_id]);
    await cycle('buyer_cancelled',(pool,opt)=>cancelPublicOrder(pool,s.slug,id,browser,opt));
    assert.equal((await x.h.pool.query('SELECT active FROM users WHERE user_id=$1',[s.owner.user.user_id])).rows[0].active,false);
    assert.deepEqual((await notices(id,'buyer_cancelled')).map(n=>n.recipient_ref),[other.id]);
    assert.equal((await notices(id)).length,2);
    await x.h.pool.query('UPDATE users SET active=true WHERE user_id=$1',[s.owner.user.user_id]);
    const next=await createPublicCheckout(x.runtime,s.slug,x.input(s.product.sku,1),randomUUID(),access,options());let attempts=0;
    const failing={...options(),orderNotifications:{emit:(q:PoolClient,facts:Parameters<OrderNotificationPort['emit']>[1])=>port.emit(intercept(q,async(text,_values,run)=>{
      if(text.startsWith('SELECT co.tenant_id')){attempts++;throw Object.assign(new Error('synthetic_deadlock'),{code:'40P01'});}return run();
    }),facts)}};
    const clientOrderId=randomUUID();
    await assert.rejects(placePublicOrder(x.runtime,s.slug,next.value.checkout_ref,{...input,terms_sha256:next.value.terms_sha256,client_order_id:clientOrderId},{...access,deviceToken:token(next.cookie)},failing),error=>(error as {code?:string}).code==='40P01');
    assert.equal(attempts,2,'a second deadlock must propagate, without another automatic attempt');
    assert.equal((await x.h.pool.query('SELECT 1 FROM commerce_orders WHERE client_order_id=$1',[clientOrderId])).rowCount,0);
  }finally{
    await x.h.pool.query('UPDATE users SET active=true WHERE user_id=$1',[s.owner.user.user_id]);
    await x.h.pool.query("UPDATE tenant_memberships SET status='revoked',revoked_at=clock_timestamp() WHERE tenant_id=$1 AND principal_id=$2",[s.tenantId,otherPrincipal]);
  }
});

type Person={id:string;pid:string;email:string;n:number};
const people:Person[]=Array.from({length:70},(_,i)=>({id:randomUUID(),pid:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,email:`notice-${randomUUID()}@example.test`,n:i+1}));
let wrongInstance:string;
async function addPeople(from:number,to:number){
  const batch=people.filter(p=>p.n>=from&&p.n<=to);
  await x.h.pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,active,onboarding_required)
    SELECT p.id,CASE WHEN p.n=13 THEN $3::uuid ELSE u.community_id END,p.email,'合成通知成員',u.password_hash,gen_random_uuid(),p.n<>8,p.n=10
    FROM jsonb_to_recordset($1) p(id uuid,pid uuid,email text,n int) CROSS JOIN users u WHERE u.user_id=$2`,[JSON.stringify(batch),s.owner.user.user_id,foreignCommunity]);
  await x.h.pool.query(`INSERT INTO principals(principal_id,user_ref,status)
    SELECT p.pid,p.id,CASE WHEN p.n=9 THEN 'disabled' ELSE 'active' END FROM jsonb_to_recordset($1) p(id uuid,pid uuid,n int)`,[JSON.stringify(batch)]);
  const memberships=batch.filter(p=>p.n!==11&&p.n!==14).map(p=>({...p,role:p.n===1?'admin':p.n===3?'viewer':'operator'}));
  await x.h.pool.query(`INSERT INTO tenant_memberships(tenant_id,principal_id,role,status,accepted_at,revoked_at)
    SELECT $2,p.pid,p.role,CASE WHEN p.n=7 THEN 'revoked' ELSE 'active' END,clock_timestamp(),CASE WHEN p.n=7 THEN clock_timestamp() END
    FROM jsonb_to_recordset($1) p(pid uuid,n int,role text)`,[JSON.stringify(memberships),s.tenantId]);
  const grants=memberships.filter(p=>p.n!==1).map(p=>({...p,instance:p.n===12?wrongInstance:s.instanceId,caps:p.n===4?['store:orders:read']:p.n===5?['store:read']:['store:read','store:orders:read']}));
  await x.h.pool.query(`INSERT INTO tenant_module_permissions(tenant_id,principal_id,instance_id,capabilities,status,granted_by_principal_id,revoked_at)
    SELECT $2,p.pid,p.instance,p.caps,CASE WHEN p.n=6 THEN 'revoked' ELSE 'active' END,$3,CASE WHEN p.n=6 THEN clock_timestamp() END
    FROM jsonb_to_recordset($1) p(pid uuid,n int,instance uuid,caps text[])`,[JSON.stringify(grants),s.tenantId,ownerPrincipal]);
}
test('a bounded capability snapshot excludes unrelated/revoked readers; retained notices never grant later order access',async()=>{
  foreignCommunity=randomUUID();await x.h.pool.query('INSERT INTO communities(community_id,name) VALUES($1,$2)',[foreignCommunity,'合成其他社群']);
  const workspace=await x.h.workspace(s.owner,s.tenantId,'合成另一個實例');
  const enabled=await x.h.enable(s.owner,s.tenantId,workspace,'guild_commerce_sales');assert.equal(enabled.status,200,JSON.stringify(enabled.data));
  wrongInstance=(await x.h.pool.query('SELECT instance_id FROM module_instances WHERE tenant_id=$1 AND instance_id<>$2 LIMIT 1',[s.tenantId,s.instanceId])).rows[0].instance_id;
  await addPeople(1,14);
  const other=await x.store(1,false);
  await x.h.pool.query("INSERT INTO tenant_memberships(tenant_id,principal_id,role,status,accepted_at) VALUES($1,$2,'operator','active',clock_timestamp())",[other.tenantId,people[10].pid]);
  const otherOwner=(await x.h.pool.query('SELECT principal_id FROM principals WHERE user_ref=$1',[other.owner.user.user_id])).rows[0].principal_id;
  await x.h.pool.query(`INSERT INTO tenant_module_permissions(tenant_id,principal_id,instance_id,capabilities,status,granted_by_principal_id)
    VALUES($1,$2,$3,ARRAY['store:read','store:orders:read'],'active',$4)`,[other.tenantId,people[10].pid,other.instanceId,otherOwner]);
  const order=await placed();
  const recipients=(await notices(order.order_id)).map(n=>n.recipient_ref).sort();
  assert.deepEqual(recipients,[s.owner.user.user_id,people[0].id,people[1].id,people[2].id].sort());
  const session=await x.h.signIn(people[1].email),reader=await authenticate(x.runtime,token(session.cookie));
  assert.equal((await readSellerCheckoutOrder(x.runtime,reader,s.tenantId,s.instanceId,order.order_id)).order_ref,order.order_id);
  await x.h.pool.query("UPDATE tenant_module_permissions SET status='revoked',revoked_at=clock_timestamp() WHERE tenant_id=$1 AND principal_id=$2",[s.tenantId,people[1].pid]);
  await assert.rejects(readSellerCheckoutOrder(x.runtime,reader,s.tenantId,s.instanceId,order.order_id),e=>e instanceof Problem&&e.status===404&&e.code==='not_found');
  assert.ok((await listNotifications(x.runtime,reader,{},true)).items.some(n=>n.body.includes(order.display_number)&&n.action?.tab==='stores'));
  await cancelThroughHttp(order.order_id);
  const cancelled=await notices(order.order_id,'buyer_cancelled');
  assert.equal(cancelled.filter(n=>n.recipient_ref===s.owner.user.user_id).length,1,'the eligible owner must receive the HTTP cancellation notice');
  assert.equal(cancelled.length,3);
  assert.ok(cancelled.every(n=>n.recipient_ref!==people[1].id));
});

test('optional programming failures roll back only notices, but query-origin errors roll back the whole placement',async()=>{
  const broken:OrderNotificationPort={emit:(q,input)=>port.emit(intercept(q,async(text,_values,next)=>{
    const result=await next();
    if(text.startsWith("SELECT projection->>'name'"))Object.defineProperty(result.rows[0],'name',{get(){throw Object.assign(new Error('synthetic_formatter_failure'),{code:'23514'});}});
    return result;
  }),input)};
  await observed(async logs=>{
    const order=await placed('bank_transfer',buyerPrincipal,broken);
    assert.deepEqual(await notices(order.order_id),[]);assert.deepEqual(logs,[['commerce_order_notification_skipped']]);
  });
  let inserts=0;
  const invariant:OrderNotificationPort={emit:(q,input)=>port.emit(intercept(q,async(text,values,next)=>{
    if(text.startsWith('SELECT 1 FROM users')&&values?.[0]===people[0].id)await x.h.pool.query('UPDATE users SET community_id=$2 WHERE user_id=$1',[people[0].id,foreignCommunity]);
    const result=await next();if(text.startsWith('INSERT INTO member_notifications'))inserts++;return result;
  }),input)};
  try{await observed(async logs=>{
    const order=await placed('bank_transfer',buyerPrincipal,invariant);
    assert.equal(inserts,1);assert.deepEqual(await notices(order.order_id),[]);assert.deepEqual(logs,[['commerce_order_notification_skipped']]);
  });}finally{await x.h.pool.query('UPDATE users SET community_id=$2 WHERE user_id=$1',[people[0].id,community]);}
  const error=new Error('synthetic_connection_rejection_without_sqlstate');let failedId='';
  const failing:OrderNotificationPort={emit:(q,input)=>{failedId=input.orderId;return port.emit(intercept(q,async(text,_values,next)=>{
    if(text.startsWith('INSERT INTO member_notifications'))throw error;return next();
  }),input);}};
  const saved=await freeze(),input={checkoutId:saved.checkout_id,termsSha256:saved.terms_sha256,clientOrderId:randomUUID(),buyerPrincipalId:buyerPrincipal,environment:'sandbox' as const,paymentMethod:'bank_transfer' as const};
  await assert.rejects(x.tx(q=>placeCheckoutOrder(q,s,input,{...basePorts(),orderNotifications:failing})),cause=>cause===error);
  assert.equal((await x.h.pool.query('SELECT 1 FROM commerce_orders WHERE order_id=$1',[failedId])).rowCount,0);assert.deepEqual(await notices(failedId),[]);
  const recovered=await x.tx(q=>placeCheckoutOrder(q,s,input,{...basePorts(),orderNotifications:port}));assert.equal((await notices(recovered.order_id)).length,3);
  const queries:string[]=[];
  const off=await freeze();
  const offInput={...input,checkoutId:off.checkout_id,termsSha256:off.terms_sha256,clientOrderId:randomUUID()};
  const offOrder=await x.tx(q=>placeCheckoutOrder(intercept(q,async(text,_values,next)=>{queries.push(text);return next();}),s,offInput,basePorts()));
  assert.ok(queries.every(sql=>!sql.includes('member_notifications')&&!sql.includes('SAVEPOINT')&&!sql.includes('WITH eligible')));
  assert.equal((await x.tx(q=>placeCheckoutOrder(q,s,offInput,{...basePorts(),orderNotifications:port}))).order_id,offOrder.order_id);
  assert.deepEqual(await notices(offOrder.order_id),[]);
});

test('fan-out is owner-first at 50 plus a sentinel, self notices are excluded, and a foreign buyer is notified only in their own community',async()=>{
  await addPeople(15,70);
  await x.h.pool.query("INSERT INTO tenant_memberships(tenant_id,principal_id,role,status,accepted_at) VALUES($1,$2,'admin','active',clock_timestamp())",[s.tenantId,buyerPrincipal]);
  let selected=0,statements=0;
  const bounded:OrderNotificationPort={emit:(q,input)=>port.emit(intercept(q,async(text,_values,next)=>{
    const result=await next();if(text===SELLER_ORDER_NOTIFICATION_RECIPIENTS_SQL){statements++;selected=result.rows.length;}return result;
  }),input)};
  await observed(async logs=>{
    const order=await placed('cash_on_meetup',buyerPrincipal,bounded),rows=await notices(order.order_id);
    assert.equal(statements,1);assert.equal(selected,51);assert.equal(rows.length,50);
    assert.ok(rows.some(n=>n.recipient_ref===s.owner.user.user_id));assert.ok(rows.some(n=>n.recipient_ref===people[0].id));
    assert.ok(rows.every(n=>n.recipient_ref!==buyer.id&&n.recipient_ref!==people[1].id&&n.recipient_ref!==people[10].id&&n.recipient_ref!==people[12].id));
    assert.deepEqual(logs,[['commerce_order_notification_fanout_capped',{selected:50,overflow:true}]]);
  });
  const foreign=await placed('bank_transfer',people[12].pid,null);
  // Explicitly omit the port for this setup; only the real seller confirmation is under test.
  const date=(await x.h.pool.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'Asia/Taipei','YYYY-MM-DD') d")).rows[0].d;
  await confirmOfflinePayment(x.runtime,owner,s.tenantId,s.instanceId,foreign.order_id,{amount_minor:foreign.terms.total_minor,received_on:date},randomUUID(),foreign.version,{orderNotifications:port});
  const rows=await notices(foreign.order_id,'payment_confirmed');assert.equal(rows.length,1);
  assert.equal(rows[0].recipient_ref,people[12].id);assert.equal(rows[0].community_id,foreignCommunity);assert.equal(rows[0].action_tab,'reservations');
});

test('paid cancellation and later refund send member notices with the actual refund state and keep merchant notes private',async()=>{
  const order=await placed(),date=(await x.h.pool.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'Asia/Taipei','YYYY-MM-DD') d")).rows[0].d;
  await confirmOfflinePayment(x.runtime,owner,s.tenantId,s.instanceId,order.order_id,{amount_minor:order.terms.total_minor,received_on:date},randomUUID(),'1');
  const key=randomUUID(),input={reason:'out_of_stock',note:'合成店家私人備註',refund_state:'pending'};
  await cancelSellerPaidCheckoutOrder(x.runtime,owner,s.tenantId,s.instanceId,order.order_id,input,key,'1',{orderNotifications:port});
  await cancelSellerPaidCheckoutOrder(x.runtime,owner,s.tenantId,s.instanceId,order.order_id,input,key,'1',{orderNotifications:port});
  const cancelled=await notices(order.order_id,'paid_cancelled');assert.equal(cancelled.length,1);assert.equal(cancelled[0].recipient_ref,buyer.id);assert.equal(cancelled[0].kind,'commerce_order_paid_cancelled');assert.match(cancelled[0].body,/待退款/);
  assert.deepEqual(orderNotificationDestination({tab:cancelled[0].action_tab,resource_id:cancelled[0].action_resource_id}),{tab:'reservations',path:`/shops/${s.slug}/orders/${order.order_id}`});
  const pending=await readRetainedMemberOrder(x.runtime,s.slug,order.order_id,token(buyer.session.cookie));assert.equal(pending?.paid_cancellation?.refund_state,'pending');assert.equal(JSON.stringify(pending).includes(input.note),false);
  await recordSellerPaidCancellationRefund(x.runtime,owner,s.tenantId,s.instanceId,order.order_id,{refunded_on:date,refund_method:'cash'},randomUUID(),'2',{orderNotifications:port});
  const recorded=await notices(order.order_id,'refund_recorded');assert.equal(recorded.length,1);assert.equal(recorded[0].recipient_ref,buyer.id);assert.equal(recorded[0].kind,'commerce_order_refund_recorded');assert.match(recorded[0].body,/已退款/);
  const done=await readRetainedMemberOrder(x.runtime,s.slug,order.order_id,token(buyer.session.cookie));assert.equal(done?.payment_state,'refunded');assert.equal(done?.paid_cancellation?.refund_method,'cash');
  assert.equal(JSON.stringify([...cancelled,...recorded]).includes(input.note),false);
  const immediate=await placed();await confirmOfflinePayment(x.runtime,owner,s.tenantId,s.instanceId,immediate.order_id,{amount_minor:immediate.terms.total_minor,received_on:date},randomUUID(),'1');
  await cancelSellerPaidCheckoutOrder(x.runtime,owner,s.tenantId,s.instanceId,immediate.order_id,{reason:'other',refund_state:'recorded',refunded_on:date,refund_method:'bank_transfer'},randomUUID(),'1',{orderNotifications:port});
  assert.match((await notices(immediate.order_id,'paid_cancelled'))[0].body,/已退款/);assert.deepEqual(await notices(immediate.order_id,'refund_recorded'),[]);
});
