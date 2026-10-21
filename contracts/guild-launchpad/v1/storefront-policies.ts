import {z} from 'zod';
import {OpaqueId,Version} from './primitives.js';
import {IsoTimeSchema} from './tenant.js';

export const STOREFRONT_POLICIES_PROFILE='freedom.hosted-store-policies/v1' as const;
export const POLICY_KINDS=['shipping','returns','privacy','terms'] as const;
export const PolicyKindSchema=z.enum(POLICY_KINDS);
export type PolicyKind=z.infer<typeof PolicyKindSchema>;
export const POLICY_LABELS:Record<PolicyKind,string>={shipping:'配送政策',returns:'退換貨政策',privacy:'隱私政策',terms:'服務條款'};
export const SELLER_FIELDS={business_name:['營業名稱',120],email:['聯絡 Email',254],phone:['電話',40],address:['地址',300],service_hours:['客服時間',300],tax_id:['統一編號',8],responsible_person:['負責人',80]} as const;
export const POLICY_CHECKLISTS:Record<PolicyKind,readonly string[]>={
 shipping:['配送範圍與方式','運費','出貨時間','拆包','離島','未取件的處理'],
 returns:['申請期間與條件','不適用的商品與理由','寄回方式與運費負擔','退款方式與時間','發票如何更正'],
 privacy:['收集哪些資料','用途','提供給誰（綠界的金流、物流、發票；代出貨的供應商只取得必要收件資料）','保存期限','聯絡方式'],
 terms:['契約成立','取消','付款','發票'],
};
export const normalizeLegalText=(v:string)=>{const line=v.replace(/\r\n/g,'\n');return forbidden.test(line)?line:line.trim();};
const forbidden=/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
function text(max:number,multiline=false){return z.string().refine(v=>v.isWellFormed(),'請使用有效的文字。').refine(v=>v===normalizeLegalText(v),'請移除前後空白並使用標準換行。')
 .refine(v=>[...v].length<=max,`最多 ${max.toLocaleString('en-US')} 個字。`)
 .refine(v=>!forbidden.test(v)&&(multiline||!v.includes('\n')),'請使用純文字，不要包含控制字元。');}
const SellerObjectSchema=z.object({business_name:text(120),email:text(254),phone:text(40),address:text(300),service_hours:text(300),tax_id:text(8),responsible_person:text(80)}).strict();
export const SellerDraftSchema=SellerObjectSchema.superRefine((s,c)=>{
 if(!s.business_name&&Object.values(s).some(Boolean))c.addIssue({code:'custom',path:['business_name'],message:'填寫賣方資料時，請填寫營業名稱。'});
 if(s.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(s.email))c.addIssue({code:'custom',path:['email'],message:'請填寫有效的 Email 格式。'});
 if(s.phone&&(!/^\+?[0-9 ()-]+$/.test(s.phone)||s.phone.replace(/[^0-9]/g,'').length<6||s.phone.replace(/[^0-9]/g,'').length>15))c.addIssue({code:'custom',path:['phone'],message:'請填寫 6–15 位數字的電話，可包含 +、空白、括號與連字號。'});
 if(s.tax_id&&!/^[0-9]{8}$/.test(s.tax_id))c.addIssue({code:'custom',path:['tax_id'],message:'統一編號須為 8 位半形數字。'});
});
export type SellerDraft=z.infer<typeof SellerDraftSchema>;
const body=text(10000,true);
export const PolicyDraftSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('shipping'),body}).strict(),
 z.object({kind:z.literal('returns'),body,window_days:z.number({error:'請填寫天數。'}).int('請填寫整數天數。').min(7,'售後申請期間須為 7–3650 天。').max(3650,'售後申請期間須為 7–3650 天。').nullable(),return_by_days:z.number({error:'請填寫天數。'}).int('請填寫整數天數。').min(1,'核准後寄回期限須為 1–3650 天。').max(3650,'核准後寄回期限須為 1–3650 天。')}).strict(),
 z.object({kind:z.literal('privacy'),body,drop_ship_disclosed:z.boolean()}).strict(),
 z.object({kind:z.literal('terms'),body}).strict(),
]);
export type PolicyDraft=z.infer<typeof PolicyDraftSchema>;
export const SellerPoliciesInputSchema=z.object({seller:SellerDraftSchema,policies:z.object({
 shipping:PolicyDraftSchema.options[0],returns:PolicyDraftSchema.options[1],privacy:PolicyDraftSchema.options[2],terms:PolicyDraftSchema.options[3],
}).strict()}).strict();
export type SellerPoliciesInput=z.infer<typeof SellerPoliciesInputSchema>;
export const emptySellerPolicies=():SellerPoliciesInput=>({seller:{business_name:'',email:'',phone:'',address:'',service_hours:'',tax_id:'',responsible_person:''},policies:{
 shipping:{kind:'shipping',body:''},returns:{kind:'returns',body:'',window_days:null,return_by_days:14},privacy:{kind:'privacy',body:'',drop_ship_disclosed:false},terms:{kind:'terms',body:''},
}});
// The command snapshots raw JSON before normalization (256 KiB). Four policy
// strings admit <=20,000 UTF-16 units AND <=60,000 serialized UTF-8 bytes each.
// Seller strings admit 2*(120+254+40+300+300+8+80)=2,204 units; worst JSON
// escaping is 6 bytes/unit. Keys, kinds and numeric fields use <2,048 bytes:
// 4*60,000 + 2,204*6 + 2,048 = 255,272 < 262,144. Wire whitespace is separately
// bounded to 512 KiB on this exact installed PUT route. Neither shared cap changes.
const rawBody=z.string().max(20000,'政策內容超出長度上限。').refine(v=>new TextEncoder().encode(JSON.stringify(v)).length-2<=60000,'政策內容超出長度上限。');
const rawSeller=z.object(Object.fromEntries(Object.entries(SELLER_FIELDS).map(([k,[,n]])=>[k,z.string().max(n*2,`最多 ${n} 個字。`)])) as {[K in keyof SellerDraft]:z.ZodString}).strict();
export const SellerPoliciesWireSchema=z.object({seller:rawSeller,policies:z.object({
 shipping:z.object({kind:z.literal('shipping'),body:rawBody}).strict(),
 returns:z.object({kind:z.literal('returns'),body:rawBody,window_days:z.number({error:'請填寫天數。'}).int('請填寫整數天數。').min(7,'售後申請期間須為 7–3650 天。').max(3650,'售後申請期間須為 7–3650 天。').nullable(),return_by_days:z.number({error:'請填寫天數。'}).int('請填寫整數天數。').min(1,'核准後寄回期限須為 1–3650 天。').max(3650,'核准後寄回期限須為 1–3650 天。').optional()}).strict(),
 privacy:z.object({kind:z.literal('privacy'),body:rawBody,drop_ship_disclosed:z.boolean()}).strict(),
 terms:z.object({kind:z.literal('terms'),body:rawBody}).strict(),
}).strict()}).strict();
const sha=z.string().regex(/^[0-9a-f]{64}$(?![\s\S])/);
export const LegalVersionRefSchema=z.object({version_id:OpaqueId,sha256:sha}).strict();
export const PublicationSellerPoliciesSchema=z.object({profile:z.literal(STOREFRONT_POLICIES_PROFILE),seller:LegalVersionRefSchema.nullable(),policies:z.object({
 shipping:LegalVersionRefSchema.nullable(),returns:LegalVersionRefSchema.nullable(),privacy:LegalVersionRefSchema.nullable(),terms:LegalVersionRefSchema.nullable(),
}).strict()}).strict();
export type PublicationSellerPolicies=z.infer<typeof PublicationSellerPoliciesSchema>;
export const PolicyVersionReadSchema=z.object({version_id:OpaqueId,policy:PolicyDraftSchema,first_published_at:IsoTimeSchema,current:z.boolean()}).strict();
export type PolicyVersionRead=z.infer<typeof PolicyVersionReadSchema>;
export const SellerPoliciesDraftSchema=SellerPoliciesInputSchema.extend({profile:z.literal(STOREFRONT_POLICIES_PROFILE),version:Version,dirty:z.boolean(),has_supplied_products:z.boolean()}).strict();
export type SellerPoliciesDraft=z.infer<typeof SellerPoliciesDraftSchema>;
export const SellerPoliciesAckSchema=z.object({profile:z.literal(STOREFRONT_POLICIES_PROFILE),completed_version:Version,changed:z.boolean(),current:SellerPoliciesDraftSchema}).strict()
 .refine(v=>v.completed_version.length<v.current.version.length||v.completed_version.length===v.current.version.length&&v.completed_version<=v.current.version);
export type SellerPoliciesAck=z.infer<typeof SellerPoliciesAckSchema>;

/** Normalize only after structural snapshot admission; no account defaults. */
export function normalizeSellerPolicies(raw:z.infer<typeof SellerPoliciesWireSchema>){
 return {seller:Object.fromEntries(Object.entries(raw.seller).map(([k,v])=>[k,normalizeLegalText(v)])),policies:Object.fromEntries(POLICY_KINDS.map(k=>[k,{...raw.policies[k],...(k==='returns'?{return_by_days:raw.policies.returns.return_by_days??14}:{}),body:normalizeLegalText(raw.policies[k].body)}]))};
}
