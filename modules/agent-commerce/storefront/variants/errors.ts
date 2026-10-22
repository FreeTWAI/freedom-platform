import {requireCondition} from '../../../../packages/shared/problem.js';
export const variantErrors={
 variant_axes_invalid:'最多 2 個選項，每個選項需有 1 到 20 個不重複的值。',
 variant_axis_name_invalid:'選項名稱請使用有效的單行文字，最多 20 字。',
 variant_value_invalid:'選項值請使用有效的單行文字，最多 40 字，且不要重複。',
 variant_group_text_invalid:'請填寫商品組名稱，最多 120 字；商品組介紹最多 2000 字。',
 variant_label_too_long:'完整商品名稱含規格最多 120 字，請縮短商品組名稱或選項值。',
 variant_member_values_invalid:'每項商品都必須選擇每個選項的一個值。',
 variant_combination_duplicate:'同一組規格已有商品，請調整選項值或拆出重複的商品。',
 variant_singleton_requires_one_member:'沒有選項時只能保留一項商品，請新增選項或拆成各別商品。',
 variant_default_invalid:'請選擇這個商品組中的預設款。',
 variant_member_in_group:'這項商品已在其他商品組，請先拆成單一商品。',
 variant_supply_not_supported:'供貨選品目前各自顯示，不可加入商品組。',
 variant_members_changed:'商品已變更或停止上架，請重新讀取規格。',
 variant_order_invalid:'請使用目前商品且不要重複，重新設定規格順序。',
 variant_anchor_retained:'這項商品仍是原商品組的保留起點，不能建立新的商品組；可重新加入原商品組，或加入其他商品組。',
 storefront_variants_invalid:'商品規格暫時無法讀取，請稍後重試。',
} as const;
export function variantCheck(value:unknown,code:keyof typeof variantErrors,status=422):asserts value{requireCondition(value,status,code,variantErrors[code]);}
