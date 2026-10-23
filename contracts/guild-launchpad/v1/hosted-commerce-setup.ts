import {DeliveryMethodSchema,LogisticsServiceKeySchema} from './hosted-shipping.js';
import {z} from 'zod';
import {OpaqueId,Version} from './primitives.js';
export const CommerceSetupEmptyInputSchema=z.object({}).strict();
const release=z.object({module_release_ref:z.string().min(1).max(200),application_release_ref:z.string().min(1).max(200)}).strict();
export const StoreReleaseSchema=release.extend({version:Version,capabilities:z.array(z.string()).max(100),upgrade:release.nullable(),can_upgrade:z.boolean()}).strict();
import {IsoTimeSchema} from './tenant.js';
export const ProviderEnvironmentSchema=z.enum(['sandbox','live']);
export const ProviderPurposeSchema=z.enum(['payment','logistics','invoice']);
export const ProviderProfileSchema=z.enum(['ecpay.aio.credit.v1','ecpay.logistics.domestic.v1','ecpay.invoice.b2c.v1']);
export const ProviderServiceStateSchema=z.enum(['draft','active','suspended','retired']);
const fresh={fresh_auth_verification_id:OpaqueId};
export const ProviderAccountCreateInputSchema=z.object({provider:z.literal('ecpay'),environment:ProviderEnvironmentSchema,merchant_id:z.string().regex(/^[0-9]{7,10}$/),...fresh}).strict();
export const ProviderServicePutInputSchema=z.object({profile:ProviderProfileSchema,hash_key:z.string().regex(/^[A-Za-z0-9]{16}$/),hash_iv:z.string().regex(/^[A-Za-z0-9]{16}$/),credit_check_code:z.string().regex(/^[0-9]{8}$/).optional(),...fresh}).strict();
export const LogisticsServiceCreateInputSchema=z.object({service_key:LogisticsServiceKeySchema,...fresh}).strict();
export const ProviderServiceStateInputSchema=z.object(fresh).strict();
export const ProviderServiceViewSchema=z.object({purpose:ProviderPurposeSchema,profile:ProviderProfileSchema,state:ProviderServiceStateSchema,
  credential_version:z.number().int().min(1),credential_updated_at:IsoTimeSchema,activated_at:IsoTimeSchema.nullable(),throttled_until:IsoTimeSchema.nullable()}).strict();
export const PaymentActivationSchema=z.object({attempt_ref:OpaqueId,state:z.enum(['ready','awaiting_result','paid','confirmed','failed','expired']),created_at:IsoTimeSchema}).strict();
export const ProviderActivationPaymentInputSchema=ProviderServiceStateInputSchema;
export const ProviderActivationPaymentResponseSchema=z.object({handoff_url:z.string().regex(/^\/pay\/ecpay\/[A-Za-z0-9_-]{43}$(?![\s\S])/),attempt_ref:OpaqueId,expires_at:IsoTimeSchema}).strict();
export const ProviderAccountViewSchema=z.object({account_id:OpaqueId,provider:z.literal('ecpay'),environment:ProviderEnvironmentSchema,
  merchant_id:z.string().regex(/^[0-9]{7,10}$/),version:Version,created_at:IsoTimeSchema,payment_activation:PaymentActivationSchema.nullable(),logistics_services:z.array(z.object({service_key:LogisticsServiceKeySchema,state:z.enum(['draft','active','suspended']),activated_at:IsoTimeSchema.nullable(),created_at:IsoTimeSchema}).strict()).max(5),services:z.array(ProviderServiceViewSchema).max(3)}).strict();
export const ProviderAccountPageSchema=z.object({items:z.array(ProviderAccountViewSchema)}).strict();
const reason=z.string().trim().min(1).max(500).regex(/^[^\u0000-\u001f\u007f]*$/);
export const StoreAdmissionCreateInputSchema=z.object({tenant_id:OpaqueId,instance_id:OpaqueId,reason}).strict();
export const StoreAdmissionRevokeInputSchema=z.object({reason}).strict();
export const StoreAdmissionQuerySchema=z.object({tenant_id:OpaqueId}).strict();
export const StoreAdmissionViewSchema=z.object({admission_id:OpaqueId,tenant_id:OpaqueId,instance_id:OpaqueId,environment:ProviderEnvironmentSchema,
  admitted_at:IsoTimeSchema,admitted_by:OpaqueId,reason,revoked_at:IsoTimeSchema.nullable(),revoked_by:OpaqueId.nullable(),revoke_reason:reason.nullable()}).strict();
export const StoreAdmissionPageSchema=z.object({items:z.array(StoreAdmissionViewSchema).max(100)}).strict();
export const StoreReadinessItemSchema=z.discriminatedUnion('key',[
  z.object({key:z.literal('storefront'),state:z.enum(['done','missing']),revision:Version.nullable()}).strict(),
  z.object({key:z.literal('products'),state:z.enum(['done','missing']),published_count:z.number().int().nonnegative(),sellable_count:z.number().int().nonnegative(),own_stock_count:z.number().int().nonnegative()}).strict(),
  z.object({key:z.literal('store_information'),state:z.enum(['done','missing'])}).strict(),
  z.object({key:z.literal('release'),state:z.enum(['done','upgrade_required']),module_release_ref:z.string()}).strict(),
  z.object({key:z.literal('payment'),state:z.enum(['done','missing','not_offered']),version:Version.nullable()}).strict(),
  z.object({key:z.literal('delivery'),state:z.enum(['done','missing']),version:Version.nullable()}).strict(),
  z.object({key:z.literal('admission'),state:z.enum(['done','not_admitted','revoked'])}).strict(),
  z.object({key:z.literal('platform'),state:z.enum(['done','paused'])}).strict(),
]);
export const StoreReadinessMethodsSchema=z.object({payment:z.array(z.enum(['bank_transfer','cash_on_meetup','card'])).max(3),
  delivery:z.array(DeliveryMethodSchema).max(6)}).strict();
export const StoreReadinessSchema=z.object({accepting_orders:z.boolean(),items:z.array(StoreReadinessItemSchema).length(8),methods:StoreReadinessMethodsSchema}).strict();
const orderCount=z.object({count:z.number().int().min(0).max(99),more:z.boolean()}).strict();
export const StoreOverviewSchema=StoreReadinessSchema.extend({tenant_id:OpaqueId,instance_id:OpaqueId,environment:ProviderEnvironmentSchema,checked_at:IsoTimeSchema,
  orders:z.object({open:orderCount,awaiting_offline_payment:orderCount,needs_action:orderCount}).strict().nullable()}).strict();
export const AdminStoreReadinessQuerySchema=z.object({limit:z.string().regex(/^(?:[1-9]|[1-4][0-9]|50)$/).optional(),offset:z.string().regex(/^(?:0|[1-9][0-9]{0,14})$/).optional()}).strict();
export const AdminStoreReadinessItemSchema=z.object({tenant_id:OpaqueId,tenant_display_name:z.string(),tenant_status:z.string(),instance_id:OpaqueId,instance_status:z.string(),
  store:z.object({name:z.string(),slug:z.string().nullable(),public_path:z.string().nullable()}).strict().nullable(),module_release_ref:z.string(),readiness:StoreReadinessSchema,
  admission:z.object({active:StoreAdmissionViewSchema.nullable(),last_revoked:StoreAdmissionViewSchema.nullable()}).strict(),admin_is_member:z.boolean()}).strict();
export const AdminStoreReadinessPageSchema=z.object({environment:ProviderEnvironmentSchema,checked_at:IsoTimeSchema,release_sha:z.string().nullable(),
  platform:z.object({checkout_enabled:z.boolean(),quarantine:z.boolean(),provider_profiles:z.array(z.string())}).strict(),
  summary:z.object({stores:z.number().int().nonnegative(),active_admissions:z.number().int().nonnegative(),accepting_orders:z.number().int().nonnegative()}).strict(),
  items:z.array(AdminStoreReadinessItemSchema).max(50),next_offset:z.number().int().nonnegative().nullable()}).strict();
export type StoreReadiness=z.infer<typeof StoreReadinessSchema>;
export type StoreOverview=z.infer<typeof StoreOverviewSchema>;
export type AdminStoreReadinessPage=z.infer<typeof AdminStoreReadinessPageSchema>;
/** UI-only vocabulary shared by seller and admin; no server imports. */
export const STORE_READINESS_LABELS={storefront:'發布商店',products:'可售商品',store_information:'商店說明與聯絡方式',release:'商店版本',payment:'付款方式',delivery:'交付方式',admission:'平台開放確認',platform:'平台接單服務'} as const;
export const STORE_PAYMENT_LABELS={bank_transfer:'銀行匯款',cash_on_meetup:'面交付現',card:'信用卡'} as const;
export function storeReadinessStateLabel(item:z.infer<typeof StoreReadinessItemSchema>){
  return item.state==='done'?'完成':item.key==='admission'||item.key==='platform'||item.state==='not_offered'?'等待平台':'待完成';
}
export const CommerceSetupErrorCodeSchema=z.enum([
  'logistics_credentials_required','logistics_service_exists','logistics_service_not_found','logistics_service_state','logistics_service_conflict',
  'store_upgrade_unavailable','commerce_credentials_unavailable','provider_environment_not_allowed','provider_account_exists',
  'provider_account_not_found','provider_profile_invalid','provider_service_state','provider_service_conflict','provider_activation_pending','commerce_quarantined','commerce_rate_limited',
  'admission_not_independent','admission_revoked','store_admission_exists','store_admission_unavailable','store_admission_not_found',
  'validation_failed','fresh_auth_required','capability_denied','not_found','tenant_not_found','tenant_capability_denied',
  'storefront_unavailable','idempotency_required','idempotency_conflict','version_required','invalid_version','version_conflict',
  'session_expired','principal_disabled','scope_disabled','admin_required','admin_csrf_rejected','internal_error',
]);
export const CommerceSetupErrorSchema=z.object({type:z.literal('about:blank'),title:z.string(),status:z.number().int().min(400).max(599),code:CommerceSetupErrorCodeSchema,detail:z.string()}).strict();
