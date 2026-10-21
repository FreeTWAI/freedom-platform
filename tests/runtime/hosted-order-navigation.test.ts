import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Navigation, TAB_TITLES} from '../../apps/portal-web/src/Navigation.js';
import {interfaceText, LANGUAGES} from '../../apps/portal-web/src/language.js';
import {buyerOrderNotificationAction,orderNotificationDestination,sellerOrderNotificationAction} from '../../modules/agent-commerce/checkout/notification-action.js';
import {isOrderNotificationAction} from '../../modules/member-communications/types.js';
import {parseSellerConsoleRoute,sellerConsoleHref,sellerSlugFallback} from '../../modules/agent-commerce/seller-console/route.js';

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
