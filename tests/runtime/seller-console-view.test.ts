import {storeOrderStatus} from '../../modules/agent-commerce/seller-console/ui/view';
import {StoreReadinessSchema,type StoreReadiness} from '../../contracts/guild-launchpad/v1/hosted-commerce-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import {words,money,amountToMinor,setupNext} from '../../modules/agent-commerce/seller-console/ui/view.js';
import {SellerPaymentStateSchema,SellerInventoryStateSchema,SellerCheckoutOrderSummarySchema,ExceptionCaseViewSchema,SellerPaymentAttemptSchema,SellerPaymentApplicationSchema} from '../../contracts/guild-launchpad/v1/hosted-seller-checkout.js';
import {ProviderServiceStateSchema,PaymentActivationSchema,CommerceSetupErrorCodeSchema} from '../../contracts/guild-launchpad/v1/hosted-commerce-setup.js';
import {createAttempt,idleAttempt,startAttempt,retryAttempt,attemptLocked,unknownFailure} from '../../modules/agent-commerce/seller-console/state/attempt.js';
import {ApiError,PortalClient} from '../../apps/portal-web/src/api.js';
import {errorText} from '../../modules/agent-commerce/seller-console/state/controller.js';
const enums={payment:SellerPaymentStateSchema.options,inventory:SellerInventoryStateSchema.options,lifecycle:SellerCheckoutOrderSummarySchema.shape.lifecycle_state.options,cancel:SellerCheckoutOrderSummarySchema.shape.cancel_reason.unwrap().options,kind:ExceptionCaseViewSchema.shape.kind.options,next:ExceptionCaseViewSchema.shape.next_action.options,resolution:ExceptionCaseViewSchema.shape.resolution.unwrap().shape.code.options,status:ExceptionCaseViewSchema.shape.status.options,service:ProviderServiceStateSchema.options,activation:PaymentActivationSchema.shape.state.options,attempt:SellerPaymentAttemptSchema.shape.state.options,application:SellerPaymentApplicationSchema.shape.outcome.options,latest:['ready','awaiting_result','paid','failed','expired']};
for(const [axis,values] of Object.entries(enums))test('wording covers exactly '+axis,()=>{const map=words[axis as keyof typeof words];assert.deepEqual(Object.keys(map).sort(),[...values].sort());assert.equal(new Set(Object.values(map)).size,values.length);for(const word of Object.values(map))assert.ok(word.trim());});
test('seller payment and inventory wording communicates independent axes',()=>{assert.equal(words.payment.confirmed,'已收款');assert.equal(words.payment.simulated,'模擬付款（不會出貨）');assert.equal(words.inventory.unallocated,'已收款但缺貨，需處理');assert.equal(words.payment.overpaid,'收款與訂單不符，需處理');});
test('whole major amounts convert using store currency rules',()=>{for(const currency of ['TWD','USD']){assert.equal(amountToMinor('350',currency),35000);assert.equal(amountToMinor('1',currency),100);assert.match(money(35000,currency),/350/);}for(const bad of ['','0','-1','1.5','1e3','Infinity','1\n','999999999999999999999',' 1','NaN'])assert.throws(()=>amountToMinor(bad,'TWD'),bad);assert.throws(()=>amountToMinor('1','JPY'));});
test('unknown attempts keep the same immutable key, body and version; new key only after settling',()=>{const input={method:'post' as const,path:'/orders/id/cancel',body:{nested:{value:1}},ifMatch:'7'},state=startAttempt(idleAttempt,input);assert.ok(attemptLocked(state));assert.notEqual(state.phase,'idle');input.body.nested.value=2;assert.deepEqual(state.attempt.body,{nested:{value:1}});assert.ok(Object.isFrozen(state.attempt.body));const unknown={...state,phase:'unknown' as const};assert.equal(startAttempt(unknown,input),unknown);const retry=retryAttempt(unknown);assert.equal(retry.attempt,state.attempt);assert.equal(retry.attempt?.key,state.attempt.key);assert.equal(retry.attempt?.ifMatch,'7');assert.ok(attemptLocked(unknown));assert.ok(!attemptLocked(idleAttempt));assert.notEqual(startAttempt(idleAttempt,input).attempt?.key,state.attempt.key);assert.equal(createAttempt(input,'10000000-0000-4000-8000-000000000001').key,'10000000-0000-4000-8000-000000000001');assert.ok(unknownFailure(new TypeError('network')));});

test('every setup problem code has a specific next step',()=>{for(const code of CommerceSetupErrorCodeSchema.options)assert.ok(setupNext[code],code);});
test('invalid money never becomes a zero amount',()=>{for(const value of ['bad','',NaN,'1.5'])assert.equal(money(value,'TWD'),'金額無法顯示');assert.match(money(0,'TWD'),/0\.00/);assert.match(money(100,'USD'),/1\.00/);});

test('offline setting field problems reach the seller form without changing other API errors',async t=>{
 const fields=[{path:'bank_transfer.account_number',code:'format'}];
 const payloads=[{code:'offline_settings_invalid',fields},{code:'validation_failed',fields},{code:'offline_settings_invalid',fields:[{path:'bank_transfer.account_number',code:'untrusted secret'}]},{code:'offline_settings_invalid',fields:[{path:'account 123456',code:'format'}]},{code:'offline_settings_invalid',fields,errors:[{path:'old.consumer',code:'required'}]}];
 t.mock.method(globalThis,'fetch',async()=>Response.json({...payloads.shift(),detail:'must not reflect an account or password'},{status:422}));
 const client=new PortalClient();client.csrfToken='synthetic';
 for(const expected of [fields,undefined,undefined,undefined,[{path:'old.consumer',code:'required'}]])await assert.rejects(client.put('/settings',{}, {suppressConsole:true}),(cause:unknown)=>{
  assert.ok(cause instanceof ApiError);assert.deepEqual(cause.errors,expected);assert.doesNotMatch(errorText(cause,true),/account or password/);return true;
 });
});

test('merchant banner uses readiness facts across the complete checkout truth table',()=>{
 const ready:StoreReadiness=StoreReadinessSchema.parse({accepting_orders:true,methods:{payment:['bank_transfer'],delivery:['meetup']},items:[
  {key:'storefront',state:'done',revision:'1'}, {key:'products',state:'done',published_count:1,sellable_count:1,own_stock_count:1},
  {key:'store_information',state:'done'},{key:'release',state:'done',module_release_ref:'storefront@1.1.0'},
  {key:'payment',state:'done',version:'1'},{key:'delivery',state:'done',version:'1'},
  {key:'admission',state:'done'},{key:'platform',state:'done'},
 ]});
 const changed=(key:string,state:string,accepting=false)=>StoreReadinessSchema.parse({...ready,accepting_orders:accepting,items:ready.items.map(i=>i.key===key?{...i,state}:i)});
 assert.equal(storeOrderStatus({readiness:ready}).text,'目前已開放接單；買家可依商店設定結帳。');
 for(const reservationOpen of [true,false,undefined]) {
  assert.deepEqual(storeOrderStatus({readiness:ready,reservationOpen}),storeOrderStatus({readiness:ready}));
  for(const consoleEnabled of [true,false])assert.equal(storeOrderStatus({checkoutEnabled:false,consoleEnabled,reservationOpen,readiness:ready,status:403}).text,
   reservationOpen?'已開放 30 分鐘庫存預留；付款與出貨尚未啟用。':'店鋪／商品展示已就緒，交易尚未啟用');
 }
 assert.equal(storeOrderStatus({consoleEnabled:false,readiness:ready}).text,'平台已開放結帳；這個環境未提供開店準備，暫時無法確認這間商店是否接單。');
 assert.equal(storeOrderStatus({loading:true}).text,'正在確認這間商店的接單狀態…');
 for(const status of [403,404,409,500,undefined]) {
  const failed=storeOrderStatus({status});assert.equal(failed.text,'暫時無法確認這間商店是否接單，請重新讀取開店準備。');assert.equal(failed.retry,status!==403);
 }
 assert.equal(storeOrderStatus({readiness:changed('platform','paused')}).text,'平台目前暫停新結帳訂單；已成立的訂單仍可查看與處理。');
 assert.equal(storeOrderStatus({readiness:changed('admission','revoked')}).text,'這間商店目前已暫停接受新結帳訂單；已成立的訂單仍可查看與處理。');
 assert.equal(storeOrderStatus({readiness:changed('admission','not_admitted')}).text,'開店設定已備妥，等待平台確認後才能接受結帳訂單。');
 for(const [key,state,label] of [['storefront','missing','發布商店'],['products','missing','可售商品'],['release','upgrade_required','商店版本'],['payment','missing','付款方式'],['payment','not_offered','付款方式'],['delivery','missing','交付方式']] as const) {
  const result=storeOrderStatus({readiness:changed(key,state)});assert.equal(result.review,true);assert.match(result.text,new RegExp('待完成：'+label));
  if(state==='not_offered')assert.match(result.text,/付款方式目前平台尚未開放/);
 }
 for(const [key,phrase] of [['products','目前沒有可售商品'],['delivery','交付方式尚未完成']] as const) {
  const result=storeOrderStatus({readiness:changed(key,'missing',true)});assert.equal(result.review,true);assert.equal(result.text,`結帳入口已開放；${phrase}，買家目前無法完成下單。`);
 }
 const both=changed('products','missing',true);both.items=both.items.map(i=>i.key==='delivery'?{...i,state:'missing'}:i);
 assert.match(storeOrderStatus({readiness:both}).text,/目前沒有可售商品、交付方式尚未完成/);
 const wait=changed('payment','missing');wait.items=wait.items.map(i=>i.key==='admission'?{...i,state:'not_admitted'}:i);
 assert.match(storeOrderStatus({readiness:wait}).text,/平台開放確認待完成/);
 assert.equal(storeOrderStatus({readiness:changed('store_information','missing',true)}).text,'目前已開放接單；商店說明與聯絡方式尚未完成，請檢查開店準備。');
 for(const [key,state] of [['release','upgrade_required'],['payment','missing'],['admission','not_admitted']] as const)
  assert.equal(storeOrderStatus({readiness:changed(key,state,true)}).text,'目前尚未開放結帳接單，請檢查開店準備。');
 assert.equal(storeOrderStatus({readiness:{...ready,accepting_orders:false}}).text,'目前尚未開放結帳接單，請檢查開店準備。');
});

// A disabled flag hides a new method but preserves a saved one for other settings.
test('self-ship settings distinguish hidden, read-only and editable states and preserve unrelated profile fields',async()=>{
 const {selfShipSettingMode,withSelfShip}=await import('../../modules/agent-commerce/seller-console/ui/SelfShipSettings.js');
 assert.equal(selfShipSettingMode(false,false),'hidden');assert.equal(selfShipSettingMode(false,true),'readonly');
 for(const exists of [false,true])assert.equal(selfShipSettingMode(true,exists),'editable');
 const {ShippingProfileInputSchema}=await import('../../contracts/guild-launchpad/v1/hosted-shipping.js');
 const profile=ShippingProfileInputSchema.parse({schema:'freedom.shipping-profile/v1',working_days:[1,3,5],services:[],delivery_options:[{method:'meetup',note:'保留面交說明。'},{method:'home',fee_per_parcel_minor:6000,free_over_minor:null,outlying:{kind:'excluded'}}],drop_ship:null});
 const option={method:'self_ship' as const,fee_per_order_minor:0,handling_days:14,note:'保留第二行。\n合成物流'};
 const added=withSelfShip(profile,option);assert.deepEqual(added.delivery_options,[...profile.delivery_options,option]);assert.deepEqual(ShippingProfileInputSchema.parse(added),added);
 const replaced=withSelfShip(added,{...option,fee_per_order_minor:1000000});assert.deepEqual(replaced.delivery_options.slice(0,2),profile.delivery_options);assert.deepEqual(replaced.working_days,profile.working_days);assert.deepEqual(replaced.services,profile.services);assert.deepEqual(replaced.drop_ship,profile.drop_ship);
 assert.deepEqual(withSelfShip(added,null),profile);assert.deepEqual(profile.delivery_options.length,2);
});
