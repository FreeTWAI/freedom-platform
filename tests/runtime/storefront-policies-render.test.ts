import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {emptySellerPolicies,SellerPoliciesInputSchema,SellerPoliciesWireSchema,SellerPoliciesAckSchema,normalizeSellerPolicies,PolicyDraftSchema,PublicationSellerPoliciesSchema,POLICY_KINDS} from '../../contracts/guild-launchpad/v1/storefront-policies.js';
import {legalParagraphs,aboutHtml,policyHtml} from '../../modules/agent-commerce/storefront/policies/pages.js';
import {digest} from '../../packages/db/index.js';
import {renderDraftLegal,policyFromRow,sellerFromRow} from '../../modules/agent-commerce/storefront/policies/model.js';
import {storeHtml,productHtml,storeMissingHtml} from '../../modules/agent-commerce/hosted/page.js';
import * as pages from '../../modules/agent-commerce/storefront/pages.js';
import {frozenPolicyFields,policiesAcknowledgement,holdPoliciesAttempt,heldPoliciesAttempt,restorePoliciesAttempt,releasePoliciesAttempt,reviewPoliciesAttempt,type PoliciesAttempt} from '../../apps/portal-web/src/modules/hosted-store-policies-state.js';
import {syntheticSeller} from '../helpers/storefront-policies.js';
import {PublicStoreProjectionSchema} from '../../contracts/guild-launchpad/v1/storefront.js';
// Captured before changing shared renderers, against the approved appearance head.
const baseline={
  "store": {
    "slug": "synthetic-shop",
    "name": "合成測試商店",
    "brand": null,
    "description": "合成說明\n第二行",
    "currency": "TWD",
    "products": [
      {
        "sku": "P0001",
        "title": "合成商品",
        "description": "合成商品說明",
        "price_minor": 100
      }
    ],
    "revision": "1",
    "published_at": "2026-10-20T00:00:00.000Z",
    "transaction_state": "not_enabled"
  },
  "hashes": {
    "home": "78edbe7351388035de1f95468d9602c7848d73029b61223bdc51104da756e0e2",
    "product": "556ff4702cc725a097445d338fcec1b1dc14eeb6d43852da4549e9c586465131",
    "preview": "7a0f8314466d93846adacdd1ac887a5d75f57b89c4093bc1c711b85eb95a259d",
    "missing": "5fafd27a9f9b2e25e9d060e4009528265763ce8b9a4f1b37edd1275f180f5905",
    "cart": "fb355c93a8303c257c2ba1ea523d88d64f3e5ebaaa8acd61d00bcfde2f0419ea",
    "checkout": "8356f8415624c371510e93e587691d90a497f18831ebcd00a995056942ab43a8",
    "order": "1fb78e04ea1197aa4cafeb59c04d94562ff23fb20811994165b673550411fa70",
    "orderMissing": "a26cb68d8db1c9d988f8768b33b31c8c015bb8ae2da71109bef84b358666556d",
    "access": "c8fd67488c92cb4a981bcf62d760c5c6c62d45ccd529713beae7589fbca9cc81",
    "return": "27a51c2ed9607b7049efb8ab4742314c4c03daa8f9bac1931d9332b80585824a",
    "returnMissing": "88ca3937288738a350e53a606be99561ece28960d75e2547fee46b11785cd8ef"
  }
};
const store=PublicStoreProjectionSchema.parse(baseline.store),hash=(v:string)=>createHash('sha256').update(v).digest('hex');
function input(){const i=emptySellerPolicies();i.seller={...syntheticSeller};for(const k of POLICY_KINDS)i.policies[k].body='合成政策\n第二行\n\n下一段';return i;}
test('POL-CONTRACT-01 canonical Unicode, CRLF, whitespace-only and 10,000 code points',()=>{
 const raw=input();raw.policies.shipping.body='  😀'.repeat(1)+'😀'.repeat(9999)+'\r\n  ';
 const parsed=SellerPoliciesInputSchema.parse(normalizeSellerPolicies(SellerPoliciesWireSchema.parse(raw)));assert.equal([...parsed.policies.shipping.body].length,10000);
 assert.equal(PolicyDraftSchema.safeParse({kind:'shipping',body:'😀'.repeat(10001)}).success,false);
 const empty=emptySellerPolicies();empty.seller.address='  ';empty.policies.shipping.body='\r\n ';
 assert.deepEqual(SellerPoliciesInputSchema.parse(normalizeSellerPolicies(SellerPoliciesWireSchema.parse(empty))),emptySellerPolicies());
 for(const text of ['\ud800','a\u0000b','a\u0001b','a\u0085b','a\u202eb','a\u2066b','a\u200fb','a\rb'])assert.equal(PolicyDraftSchema.safeParse({kind:'shipping',body:text}).success,false);
 assert.equal(PolicyDraftSchema.safeParse({kind:'shipping',body:'עברית 中文 <script> javascript:'}).success,true);
});
test('POL-CONTRACT-02 seller responsibility, formats, defaults and strict policy fields',()=>{
 const i=emptySellerPolicies();i.seller.email='seller@example.test';assert.equal(SellerPoliciesInputSchema.safeParse(i).success,false);i.seller.business_name='合成測試商行';assert(SellerPoliciesInputSchema.safeParse(i).success);
 for(const tax of ['１２３４５６７８','0000000','000000000'])assert.equal(SellerPoliciesInputSchema.safeParse({...i,seller:{...i.seller,tax_id:tax}}).success,false);
 assert(SellerPoliciesInputSchema.safeParse({...i,seller:{...i.seller,tax_id:'00000000'}}).success);
 for(const window_days of [6,3651,1.5])assert.equal(PolicyDraftSchema.safeParse({kind:'returns',body:'',window_days,return_by_days:14}).success,false);
 assert.equal(PolicyDraftSchema.safeParse({kind:'privacy',body:'',drop_ship_disclosed:false,window_days:7}).success,false);
 const raw=SellerPoliciesWireSchema.parse(i);delete raw.policies.returns.return_by_days;assert.equal(SellerPoliciesInputSchema.parse(normalizeSellerPolicies(raw)).policies.returns.return_by_days,14);
 assert.equal(PublicationSellerPoliciesSchema.safeParse({private_email:'seller@example.test'}).success,false);
});
test('POL-PAGE-01 every baseline shell remains byte-identical without seller policy data',()=>{
 const html={home:storeHtml(store),product:productHtml(store,'P0001')!,preview:storeHtml(store,undefined,[],{preview:true}),missing:storeMissingHtml(),cart:pages.cartPageHtml(store),checkout:pages.checkoutPageHtml(store),order:pages.orderPageHtml(store,'synthetic-order'),orderMissing:pages.orderMissingHtml(store),access:pages.orderAccessPageHtml(store),return:pages.paymentReturnPageHtml(store,'synthetic-order','synthetic-attempt'),returnMissing:pages.paymentReturnMissingHtml(store)};
 assert.deepEqual(Object.fromEntries(Object.entries(html).map(([k,v])=>[k,hash(v)])),baseline.hashes);
 const legal=renderDraftLegal(emptySellerPolicies());assert.equal(storeHtml(store,undefined,[],undefined,undefined,undefined,legal),html.home);
});
test('POL-PAGE-02 seller replaces responsibility and empty-description placeholder in every shell',()=>{
 const legal=renderDraftLegal(input()),s={...store,description:'',policies:legal};
 for(const html of [storeHtml(s,undefined,[],undefined,undefined,undefined,legal),productHtml(s,'P0001',[],undefined,undefined,undefined,legal)!,pages.cartPageHtml(s),pages.checkoutPageHtml(s),pages.orderPageHtml(s,'synthetic'),pages.orderMissingHtml(s),pages.orderAccessPageHtml(s),pages.paymentReturnMissingHtml(s),aboutHtml(s)]){
  assert.equal(html.split('自由工坊提供網站服務，不是賣方。').length-1,1);assert.doesNotMatch(html,/商品資訊與訂單服務由|店主尚未補充商店說明與聯絡方式。/);assert.match(html,/本店由合成測試商行經營/);assert.match(html,/seller@example.test/);assert.doesNotMatch(html,/mailto:|tel:/);assert.match(html,/shop-policies.css/);assert.match(html,/name="robots" content="noindex"/);
 }
});
test('POL-PAGE-03 B03 links, escaping, paragraphs and public version labels',()=>{
 const i=input();i.policies.shipping.body='<script>alert(1)</script>\njavascript:alert(2)\n\nשלום';const legal=renderDraftLegal(i),s={...store,policies:legal};
 const html=policyHtml(s,'shipping',{version_id:randomUUID(),policy:i.policies.shipping,first_published_at:'2026-10-20T00:00:00.000Z',current:false});
 assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;<br>javascript:alert\(2\)<\/p><p>שלום/);assert.doesNotMatch(html,/<script>|href="javascript:|版本 [0-9]/);assert.match(html,/首次發布於/);assert.match(html,/歷史版本/);
 const p=productHtml(store,'P0001',[],undefined,undefined,undefined,legal)!;assert.match(p,/aria-label="配送與退換貨政策"/);assert.match(p,/policies\/shipping/);assert.match(p,/policies\/returns/);
 assert.equal(legalParagraphs('a\nb\n\nc'),'<p>a<br>b</p><p>c</p>');
});
test('POL-PAGE-07 draft seller follows the unchanged preview notice and uses private links',()=>{
 const legal=renderDraftLegal(input(),'/api/v1/tenants/synthetic/storefronts/synthetic/preview-page');const html=storeHtml({...store,description:''},undefined,[],{preview:true},undefined,undefined,legal);
 assert.equal(html.split('店主已儲存的預覽，尚未對外發布。').length-1,1);assert(html.indexOf('店主已儲存的預覽，尚未對外發布。')<html.indexOf('本店由合成測試商行經營'));assert(html.indexOf('店主已儲存的預覽，尚未對外發布。')<html.indexOf('shop-seller-details'));const about=aboutHtml({...store,policies:legal},true);assert.equal(about.split('店主已儲存的預覽，尚未對外發布。').length-1,1);assert(about.indexOf('店主已儲存的預覽，尚未對外發布。')<about.indexOf('shop-seller-details'));
 assert.match(html,/preview-page\/about/);assert.match(html,/preview-page\/policies\/shipping/);assert.doesNotMatch(html,/href="\/shops\/synthetic-shop\/policies/);
});
test('POL-STATE-01 frozen attempts retain exact body, key and CAS across remount and unknown 412',()=>{
 const client={},user='synthetic-user',body=frozenPolicyFields(input()),a:PoliciesAttempt=Object.freeze({tenantId:randomUUID(),instanceId:randomUUID(),key:randomUUID(),expected:'1',body,hadUnknown:false});
 assert(Object.isFrozen(body.policies.privacy));holdPoliciesAttempt(client,user,a);const restored=restorePoliciesAttempt(client,user,a)!;assert(restored.hadUnknown);assert.equal(restored.body,a.body);assert.equal(restored.key,a.key);assert.throws(()=>reviewPoliciesAttempt(restored,'2',randomUUID()));assert.throws(()=>holdPoliciesAttempt(client,user,{...restored,key:randomUUID()}));assert.equal(heldPoliciesAttempt(client,'other-user',a),null);assert.equal(heldPoliciesAttempt({},user,a),null);releasePoliciesAttempt(client,user,a);assert.equal(heldPoliciesAttempt(client,user,a),null);
 const ack={profile:'freedom.hosted-store-policies/v1',completed_version:'2',changed:true,current:{profile:'freedom.hosted-store-policies/v1',version:'2',dirty:true,has_supplied_products:false,...input()}};
 for(const version of ['abc','1.2','0','01','9223372036854775808']){assert.equal(SellerPoliciesAckSchema.safeParse({...ack,completed_version:version}).success,false);assert.equal(policiesAcknowledgement({...ack,current:{...ack.current,version}},a),null);}assert.equal(policiesAcknowledgement(ack,{...a,expected:'abc'}),null);
 assert(policiesAcknowledgement(ack,a));assert.equal(policiesAcknowledgement({...ack,completed_version:'3'},a),null);assert.equal(policiesAcknowledgement({...ack,current:{...ack.current,seller:{...ack.current.seller,phone:''}}},a),null);
});

test('POL-CONTRACT-03 immutable content digests are checked and errors never include prose',()=>{
 const seller={...syntheticSeller,content_sha256:digest(syntheticSeller)};assert.deepEqual(sellerFromRow(seller),syntheticSeller);
 assert.throws(()=>sellerFromRow({...seller,phone:''}),{message:'賣方資訊與商店政策暫時無法讀取。'});
 const policy={kind:'shipping' as const,body:'合成政策'};assert.deepEqual(policyFromRow({...policy,content_sha256:digest(policy)}),policy);
 assert.throws(()=>policyFromRow({...policy,body:'合成變更政策',content_sha256:digest(policy)}),{message:'賣方資訊與商店政策暫時無法讀取。'});
 for(const cp of [0x061c,0x200e,0x200f,0x202a,0x202b,0x202c,0x202d,0x202e,0x2066,0x2067,0x2068,0x2069]){const v=emptySellerPolicies();v.policies.shipping.body='a'+String.fromCodePoint(cp)+'b';assert.equal(SellerPoliciesInputSchema.safeParse(normalizeSellerPolicies(SellerPoliciesWireSchema.parse(v))).success,false);}
 const v=input();v.seller.business_name='<script>合成</script>';const html=aboutHtml({...store,policies:renderDraftLegal(v)});assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;合成&lt;\/script&gt;/);
});
