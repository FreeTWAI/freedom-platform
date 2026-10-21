import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Navigation, TAB_TITLES} from '../../apps/portal-web/src/Navigation.js';
import {interfaceText, LANGUAGES} from '../../apps/portal-web/src/language.js';
import {buyerOrderNotificationAction,orderNotificationDestination,sellerOrderNotificationAction} from '../../modules/agent-commerce/checkout/notification-action.js';
import {isOrderNotificationAction} from '../../modules/member-communications/types.js';
import {parseSellerConsoleRoute,sellerConsoleHref,sellerSlugFallback} from '../../modules/agent-commerce/seller-console/route.js';
import {OfflineOrder} from '../../apps/portal-web/src/storefront/offline-order.js';
import type {PublicOrder} from '../../contracts/guild-launchpad/v1/hosted-checkout.js';

const orderScope={tenantId:'11111111-1111-4111-8111-11111111111a',instanceId:'22222222-2222-4222-8222-22222222222b'};
const orderId='33333333-3333-4333-8333-33333333333c';

test('buyer order navigation uses the order-list label in every supported language', () => {
  assert.deepEqual(LANGUAGES.map(([language]) => interfaceText(language, 'nav.reservations')),
    ['我的訂單', 'My orders', '注文履歴', '내 주문', 'Mis pedidos']);
  assert.equal(interfaceText('zh-Hant', 'nav.reservations'), TAB_TITLES.reservations);
  const markup = renderToStaticMarkup(createElement(Navigation, {current: 'reservations', onSelect() {},
    canManageGuild: false, guildLaunchpadEnabled: false, communitySearchEnabled: false, personalContentEnabled: false, mobileOpen: true}));
  assert.match(markup, /我的訂單/);
  assert.doesNotMatch(markup, /查詢我的預留/);
});

test('seller notices carry the exact store and order into the existing console and legacy dispatch',()=>{
  const action=sellerOrderNotificationAction(orderScope,orderId);
  assert.equal(action.resource_id.length,98);
  assert.ok(isOrderNotificationAction(action));
  const destination=orderNotificationDestination(action);
  assert.deepEqual(destination,{tab:'stores',hash:sellerConsoleHref(orderScope,'order',{id:orderId})});
  assert.ok(destination?.tab==='stores');
  const route=parseSellerConsoleRoute(destination.hash);
  assert.equal(route?.tenantId,orderScope.tenantId);
  assert.equal(route?.instanceId,orderScope.instanceId);
  assert.equal(route?.page,'order');
  assert.equal(route?.id,orderId);
  assert.deepEqual(sellerSlugFallback(destination.hash),{...orderScope,orders:true});
  assert.notDeepEqual(orderNotificationDestination(sellerOrderNotificationAction({...orderScope,instanceId:orderId},orderScope.instanceId)),destination);
  assert.throws(()=>sellerOrderNotificationAction({...orderScope,tenantId:orderScope.tenantId.replace(/-/g,'')},orderId));
});

test('buyer notices open only the same-origin B07 path with the frozen slug and order',()=>{
  for(const slug of ['abc','notice-shop','a'.repeat(40)]){
    const action=buyerOrderNotificationAction(slug,orderId);
    assert.ok(isOrderNotificationAction(action));
    assert.ok(action.resource_id.length<=77);
    assert.deepEqual(orderNotificationDestination(action),{tab:'reservations',path:`/shops/${slug}/orders/${orderId}`});
  }
  for(const slug of ['ab','a'.repeat(41),'-notice','notice-','NOTICE','notice\n','../notice','notice?token=private']){
    assert.throws(()=>buyerOrderNotificationAction(slug,orderId));
  }
});

test('malformed or unknown order actions stay readable without producing a destination',()=>{
  const seller=sellerOrderNotificationAction(orderScope,orderId),buyer=buyerOrderNotificationAction('notice-shop',orderId);
  const invalid:unknown[]=[null,{},[],{tab:'future',resource_id:buyer.resource_id},{tab:'stores',resource_id:null},
    {tab:'reservations',resource_id:null},{...buyer,extra:'untrusted'},{...seller,url:'https://example.invalid'},
    Object.create(buyer),{...seller,resource_id:seller.resource_id.toUpperCase()},
    {...seller,resource_id:seller.resource_id.slice(0,12)+'0'+seller.resource_id.slice(13)},
    {...seller,resource_id:seller.resource_id.slice(0,16)+'7'+seller.resource_id.slice(17)},
    {...buyer,resource_id:buyer.resource_id.replace('-4333-','-0333-')},
    {...buyer,resource_id:buyer.resource_id.replace('-8333-','-7333-')},
    {...seller,resource_id:seller.resource_id.replace(/_/g,'/')},
    {...seller,resource_id:seller.resource_id.slice(0,-1)},
    {...seller,resource_id:`${seller.resource_id}\n`},
    {...buyer,resource_id:`${buyer.resource_id}\n`},
    {...buyer,resource_id:`${buyer.resource_id}?token=private`},
    {...buyer,resource_id:`${buyer.resource_id}#fragment`},
    {...buyer,resource_id:`notice-shop/%2e%2e/${orderId}`},
    {...buyer,resource_id:`notice-shop\\${orderId}`},
    {...buyer,resource_id:`//example.invalid/${orderId}`},
    {...buyer,resource_id:`https://example.invalid/shops/${buyer.resource_id}`},
    {tab:'members',resource_id:orderId}];
  for(const value of invalid){
    assert.equal(isOrderNotificationAction(value),false,JSON.stringify(value));
    assert.equal(orderNotificationDestination(value),null,JSON.stringify(value));
  }
});

const unpaidBankOrder:PublicOrder={
  order_ref:orderId,display_number:'261021-ABC123',store:{slug:'notice-shop',name:'合成測試商店'},
  created_at:'2026-10-21T00:00:00.000Z',pay_by:'2026-10-22T00:00:00.000Z',
  lifecycle_state:'open',cancel_reason:null,payment_state:'unpaid',payment_method:'bank_transfer',
  reservation_expired:false,payment_grace_until:'2026-10-25T00:00:00.000Z',currency:'TWD',
  lines:[{sku:'SYNTHETIC',title:'合成商品',quantity:1,unit_price_minor:10000,line_total_minor:10000,options:[]}],
  merchandise_total_minor:10000,discount_total_minor:0,shipping_total_minor:0,total_minor:10000,
  offline_instructions:{bank_code:'000',bank_name:'合成銀行',branch_name:null,account_number:'000000000000',
    account_name:'合成測試帳戶',note:null,amount_minor:10000,pay_by:'2026-10-22T00:00:00.000Z'},
  latest_payment_attempt:null,can_resume_payment:false,contact:null,delivery:null,invoice:null,redacted:true,
};
function offlineOrderMarkup(patch:Partial<PublicOrder>={},readOnly=false,disabled=false){
  return renderToStaticMarkup(createElement(OfflineOrder,{order:{...unpaidBankOrder,...patch},readOnly,disabled,onCancel:async()=>{},onRefresh(){}}));
}

test('B07 bank instructions name the existing manual refresh in every open unpaid rendering',()=>{
  for(const readOnly of [false,true])for(const disabled of [false,true]){
    const markup=offlineOrderMarkup({},readOnly,disabled);
    assert.ok(markup.includes('店家確認收款後，按「更新訂單狀態」即可看到最新狀態。'));
    assert.match(markup,/<button[^>]*class="shop-button shop-button-secondary"[^>]*>更新訂單狀態<\/button>/);
    assert.doesNotMatch(markup,/店家確認收款後，這裡會更新。/);
  }
});

test('B07 keeps refresh limited to open unpaid orders and does not promise it in other states',()=>{
  for(const lifecycle_state of ['open','cancelled','closed'] as const){
    for(const payment_state of ['unpaid','pending','simulated','confirmed','overpaid','refunded'] as const){
      const offline_instructions=lifecycle_state==='open'&&(payment_state==='unpaid'||payment_state==='pending')?unpaidBankOrder.offline_instructions:null;
      const markup=offlineOrderMarkup({lifecycle_state,payment_state,offline_instructions,cancel_reason:lifecycle_state==='cancelled'?'buyer_cancelled':null});
      const refresh=lifecycle_state==='open'&&payment_state==='unpaid';
      assert.equal(markup.includes('>更新訂單狀態</button>'),refresh);
      assert.equal(markup.includes('店家確認收款後，按「更新訂單狀態」即可看到最新狀態。'),refresh);
    }
  }
  for(const patch of [{reservation_expired:true},{payment_method:'cash_on_meetup' as const,offline_instructions:null}]){
    const markup=offlineOrderMarkup(patch);
    assert.ok(markup.includes('>更新訂單狀態</button>'));
    assert.ok(!markup.includes('店家確認收款後，按「更新訂單狀態」即可看到最新狀態。'));
  }
});
