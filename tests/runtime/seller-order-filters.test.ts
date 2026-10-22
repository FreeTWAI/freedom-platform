import assert from 'node:assert/strict';
import {test} from 'node:test';
import {displayNumberPattern,normalizeSellerDisplayNumber,normalizeSellerOrderFilters,sameSellerOrderFilters,sellerOrderFilterSummary,SELLER_ORDER_SHORTCUTS,SELLER_PAYMENT_METHODS,type SellerQuery} from '../../modules/agent-commerce/seller-console/order-filters.js';

for(const [input,expected] of [
 ['261016-ABCDEF','261016-ABCDEF'],[' 261016-abcdef ','261016-ABCDEF'],
 ['　２６１０１６－ａｂｃｄｅｆ　','261016-ABCDEF'],['２６１０１６-ＡbＣdＥf','261016-ABCDEF'],
 ['000000-0123az','000000-0123AZ'],['　 ',''],
]) test(`normalize an explicitly submitted order number: ${JSON.stringify(input)}`,()=>{
 assert.equal(normalizeSellerDisplayNumber(input),expected);
 assert.equal(normalizeSellerDisplayNumber(expected),expected);
 if(expected)assert.equal(displayNumberPattern.test(expected),true);
});
for(const input of ['261016-ABCIOL','261016-ABCDE','261016-ABCDEFG','261016-ABCDEF\n','\t261016-ABCDEF',
 '261016-ABC\rDEF','261016–ABCDEF','261016-ABC DEF','261016-ABC\u200bDEF','261016-abcdß',
 '261016-ＡＢＣＤＥſ','../../261016-ABCDEF','261016-ABCDEF?token=secret','261016-ABCDEF#details']) {
 test(`invalid identifier is not repaired into a different order: ${JSON.stringify(input)}`,()=>{
  assert.equal(displayNumberPattern.test(normalizeSellerDisplayNumber(input)),false);
 });
}
test('applying filters preserves their intersection and never adds a server default',()=>{
 const draft:SellerQuery={lifecycle:'open',needs_action:'true',display_number:' ２６１０１６－abcdef ',payment_method:'bank_transfer',awaiting_offline_payment:'true',state:'closed'};
 const result=normalizeSellerOrderFilters(draft);
 assert.deepEqual(result,{lifecycle:'open',needs_action:'true',display_number:'261016-ABCDEF',payment_method:'bank_transfer',awaiting_offline_payment:'true'});
 assert.equal(draft.display_number,' ２６１０１６－abcdef ');
 assert.deepEqual(normalizeSellerOrderFilters({display_number:'　 '}),{});
 assert.deepEqual(normalizeSellerOrderFilters({}),{});
});
test('raw filter comparison distinguishes pending edits from applied route conditions',()=>{
 assert.equal(sameSellerOrderFilters({}, {display_number:undefined,needs_action:undefined}),true);
 for(const query of [{lifecycle:'open'},{needs_action:'true'},{display_number:'261016-ABCDEF'},{payment_method:'bank_transfer'},{awaiting_offline_payment:'true'}] as SellerQuery[]) {
  assert.equal(sameSellerOrderFilters({},query),false);
  assert.equal(sameSellerOrderFilters(query,{...query}),true);
 }
 assert.equal(sameSellerOrderFilters({display_number:'261016-ABCDEF'},{display_number:'261016-abcdef'}),false);
});
test('all shortcut queries are independent and unpaid is not inferred from an exception',()=>{
 assert.deepEqual(SELLER_ORDER_SHORTCUTS.map(value=>value.query),[{}, {awaiting_offline_payment:'true'}, {lifecycle:'open'}, {needs_action:'true'}]);
 assert.deepEqual(Object.keys(SELLER_PAYMENT_METHODS),['immediate_card','bank_transfer','cash_on_meetup']);
});
test('applied summaries explain actual filters without inventing money or order counts',()=>{
 assert.equal(sellerOrderFilterSummary({}),'全部結帳訂單');
 assert.equal(sellerOrderFilterSummary({awaiting_offline_payment:'true'}),'待確認收款（匯款／面交現金）');
 assert.equal(sellerOrderFilterSummary({lifecycle:'closed',payment_method:'cash_on_meetup',needs_action:'true',display_number:'261016-ABCDEF'}),
  '已完成 · 有待處理問題 · 面交現金付款 · 訂單編號 261016-ABCDEF');
});
