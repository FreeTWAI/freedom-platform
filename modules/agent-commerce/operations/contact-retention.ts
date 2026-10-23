import type {Pool,PoolClient} from 'pg';
import {isolatedTransaction} from '../../../packages/resource-scopes/tenant-transaction.js';
import {bindStore,lockStore} from '../checkout/authority.js';
import type {CommerceContactRetention} from './runtime-settings.js';

export const CONTACT_RETENTION_KIND='checkout_contact_retention' as const;
export type ContactRetentionMode=Exclude<CommerceContactRetention,'off'>;
function requireActiveMode(mode:ContactRetentionMode){
  if(mode!=='all')throw Error('contact_retention_mode_required');
}
const batchLimit=(n=200)=>{if(!Number.isInteger(n)||n<1||n>200)throw Error('contact_retention_limit_invalid');return n;};
/** SQL scans and lock waits also have a bound; never extend a host's timeout. */
async function capQueryTime(q:PoolClient){
  await q.query("SELECT set_config('statement_timeout',least(coalesce(nullif(setting::int,0),30000),30000)::text,true) FROM pg_settings WHERE name='statement_timeout'");
}
/** No PII is selected into application memory. Every referencing order must
 * have a fulfilment/cancellation start point at least 180 days ago. */
const eligible=`a.redacted_at IS NULL
  AND EXISTS(SELECT 1 FROM commerce_checkout_orders o WHERE o.contact_id=a.contact_id)
  AND NOT EXISTS(SELECT 1 FROM commerce_checkout_orders o
    LEFT JOIN commerce_meetup_handovers h ON h.order_id=o.order_id
    LEFT JOIN commerce_self_shipments s ON s.order_id=o.order_id
    WHERE o.contact_id=a.contact_id AND
      (CASE WHEN o.lifecycle_state='cancelled' THEN o.cancelled_at ELSE greatest(h.recorded_at,s.recorded_at) END
        <=$3::timestamptz-interval '180 days') IS NOT TRUE)`;

/** Global discovery reads only non-PII checkout bindings. A persistent per-store
 * job means old rows and future contacts need no unbounded migration backfill. */
export async function discoverContactRetention(pool:Pool,limit=200):Promise<number>{
  batchLimit(limit);
  return isolatedTransaction(pool,async q=>{await capQueryTime(q);return (await q.query(`INSERT INTO commerce_due_work(tenant_id,instance_id,kind,target_id,due_at)
    SELECT c.tenant_id,c.instance_id,'checkout_contact_retention',c.instance_id,clock_timestamp()
    FROM commerce_checkouts c WHERE NOT EXISTS(SELECT 1 FROM commerce_due_work w
      WHERE w.kind='checkout_contact_retention' AND w.target_id=c.instance_id)
    GROUP BY c.tenant_id,c.instance_id ORDER BY c.instance_id LIMIT $1
    ON CONFLICT(kind,target_id) DO NOTHING`,[limit])).rowCount??0;});
}
export interface RetentionClaim {due_work_id:string;tenant_id:string;target_id:string;token:string}
export interface RetentionOptions {now?:()=>Date;signal?:AbortSignal;limit?:number}
async function redactContactBatch(q:PoolClient,tenantId:string,instanceId:string,options:RetentionOptions={}){
  const limit=batchLimit(options.limit),now=options.now?.()??new Date();
  if(options.signal?.aborted)throw Error('contact_retention_aborted');
  const ids=(await q.query<{contact_id:string}>(`SELECT a.contact_id FROM commerce_checkout_contacts a
    WHERE a.tenant_id=$1 AND a.instance_id=$2 AND ${eligible}
    ORDER BY a.contact_id LIMIT $4 FOR UPDATE OF a SKIP LOCKED`,[tenantId,instanceId,now,limit])).rows.map(r=>r.contact_id);
  if(ids.length){
    await q.query(`UPDATE commerce_self_shipments s SET tracking_number=NULL,carrier_name=NULL,redacted_at=$3
      FROM commerce_checkout_orders o WHERE s.order_id=o.order_id AND o.contact_id=ANY($1::uuid[])
      AND s.tenant_id=$2 AND s.redacted_at IS NULL`,[ids,tenantId,now]);
    await q.query(`UPDATE commerce_checkout_contacts SET contact_name=NULL,contact_email=NULL,contact_phone=NULL,
      delivery=NULL,invoice=NULL,contact_salt=NULL,redacted_at=$2 WHERE contact_id=ANY($1::uuid[]) AND redacted_at IS NULL`,[ids,now]);
  }
  // The checkout's customer can differ from the placed order's retained customer.
  // Require a redacted checkout/order contact and protect every live link,
  // including normalized email and older contacts after a checkout revision.
  const customers=await q.query(`WITH candidates AS (
    SELECT u.customer_id FROM commerce_customers u WHERE u.tenant_id=$1 AND u.instance_id=$2 AND u.redacted_at IS NULL
    AND EXISTS(SELECT 1 FROM commerce_checkout_contacts a JOIN commerce_checkouts c USING(checkout_id,tenant_id,instance_id)
      WHERE a.tenant_id=u.tenant_id AND a.instance_id=u.instance_id AND a.redacted_at IS NOT NULL
      AND (c.customer_id=u.customer_id
        OR EXISTS(SELECT 1 FROM commerce_checkout_orders o WHERE o.contact_id=a.contact_id AND o.customer_id=u.customer_id)))
    AND NOT EXISTS(SELECT 1 FROM commerce_checkout_contacts a JOIN commerce_checkouts c USING(checkout_id,tenant_id,instance_id)
      WHERE a.tenant_id=u.tenant_id AND a.instance_id=u.instance_id AND a.redacted_at IS NULL
      AND (c.customer_id=u.customer_id OR lower(btrim(a.contact_email))=u.email_normalized
        OR EXISTS(SELECT 1 FROM commerce_checkout_orders o WHERE o.contact_id=a.contact_id AND o.customer_id=u.customer_id)))
    ORDER BY u.customer_id LIMIT $4 FOR UPDATE OF u SKIP LOCKED)
    UPDATE commerce_customers u SET email_normalized='redacted:'||u.customer_id::text,email_verified_at=NULL,redacted_at=$3
    FROM candidates x WHERE u.customer_id=x.customer_id`,[tenantId,instanceId,now,limit]);
  if(options.signal?.aborted)throw Error('contact_retention_aborted');
  const remaining=(await q.query(`SELECT EXISTS(SELECT 1 FROM commerce_checkout_contacts a
    WHERE a.tenant_id=$1 AND a.instance_id=$2 AND ${eligible}) AS pending`,[tenantId,instanceId,now])).rows[0].pending as boolean;
  return {contacts:ids.length,customers:customers.rowCount??0,remaining};
}

/** Called only by the leased due-work dispatcher. Store/community locks serialize
 * payment, fulfilment, exception and checkout changes, including archived stores. */
export async function retainCheckoutContacts(pool:Pool,claim:RetentionClaim,mode:ContactRetentionMode,options:RetentionOptions={}){
  requireActiveMode(mode);
  return isolatedTransaction(pool,async q=>{
    await capQueryTime(q);
    const target=(await q.query(`SELECT tenant_id,instance_id,storefront_shop_id FROM commerce_storefront_profiles WHERE instance_id=$1`,[claim.target_id])).rows[0];
    if(!target||target.tenant_id!==claim.tenant_id)throw Error('contact_retention_binding_invalid');
    await bindStore(q,target.tenant_id);
    await lockStore(q,target,[],[],false);
    const current=(await q.query(`SELECT *,lease_until::text AS token FROM commerce_due_work WHERE due_work_id=$1 FOR UPDATE`,[claim.due_work_id])).rows[0];
    const now=options.now?.()??new Date();
    if(!current||current.kind!==CONTACT_RETENTION_KIND||current.tenant_id!==claim.tenant_id||current.instance_id!==claim.target_id
      ||current.target_id!==claim.target_id||current.token!==claim.token||new Date(current.lease_until)<=now)throw Error('contact_retention_lease_lost');
    const result=await redactContactBatch(q,target.tenant_id,target.instance_id,{...options,now:()=>now});
    if(options.signal?.aborted||new Date(current.lease_until)<=(options.now?.()??new Date()))throw Error('contact_retention_lease_lost');
    await q.query(`UPDATE commerce_due_work SET due_at=$2::timestamptz+interval '10 minutes',lease_until=NULL,
      last_error=NULL,failure_count=0,updated_at=clock_timestamp() WHERE due_work_id=$1 AND lease_until=$3::timestamptz`,[claim.due_work_id,now,claim.token]);
    return {...result,externalCalls:0};
  });
}
/** Privacy maintenance is independent of commerce activation/quarantine. The
 * explicit kind filter cannot dispatch a payment, email or other external effect. */
export async function runContactRetentionWork(pool:Pool,mode:ContactRetentionMode,options:RetentionOptions&{targets?:readonly string[]}={}){
  requireActiveMode(mode);
  await discoverContactRetention(pool);
  const {runDueCommerceWork}=await import('./due-work.js');
  return runDueCommerceWork(pool,{freedomEnv:'local',contactRetention:mode,now:options.now,signal:options.signal},
    {kinds:[CONTACT_RETENTION_KIND],targets:options.targets,signal:options.signal});
}

/** Restore calls this while exposure remains quarantined. One bounded store page,
 * one <=200-contact transaction per store. A full page or remaining contacts
 * requires another invocation; this is never permission to reopen a deployment. */
export async function runRestoredContactRetention(pool:Pool,mode:ContactRetentionMode,options:RetentionOptions&{afterInstance?:string}={}){
  requireActiveMode(mode);
  const limit=batchLimit(options.limit);
  if(options.afterInstance&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.afterInstance))throw Error('contact_retention_cursor_invalid');
  const rows=await isolatedTransaction(pool,async q=>{await capQueryTime(q);return (await q.query<{tenant_id:string;instance_id:string;storefront_shop_id:string}>(`SELECT DISTINCT p.tenant_id,p.instance_id,p.storefront_shop_id
    FROM commerce_storefront_profiles p JOIN commerce_checkouts c USING(tenant_id,instance_id)
    WHERE ($1::uuid IS NULL OR p.instance_id>$1) ORDER BY p.instance_id LIMIT $2`,[options.afterInstance??null,limit])).rows;});
  let contacts=0,customers=0,remaining=false;
  for(const p of rows){
    const result=await isolatedTransaction(pool,async q=>{await capQueryTime(q);await bindStore(q,p.tenant_id);await lockStore(q,p,[],[],false);return redactContactBatch(q,p.tenant_id,p.instance_id,options);});
    contacts+=result.contacts;customers+=result.customers;remaining||=result.remaining||result.customers===limit;
  }
  return {status:remaining?'repeat_page':rows.length===limit?'next_page':'scan_complete',contacts,customers,
    after_instance:remaining?options.afterInstance??null:rows.at(-1)?.instance_id??options.afterInstance??null,
    deploymentReady:false as const};
}
