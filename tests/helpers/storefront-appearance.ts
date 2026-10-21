import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';

/** Owner-only SQL fixture; callers keep every production FK/trigger active. */
export async function seedAppearanceRows(q:PoolClient, input:{tenantId:string;instanceId:string;productId:string}){
  const p=(await q.query(`SELECT p.*,s.scope_id FROM commerce_storefront_profiles p
    JOIN resource_scopes s ON s.kind='tenant' AND s.tenant_ref=p.tenant_id
    WHERE p.tenant_id=$1 AND p.instance_id=$2`,[input.tenantId,input.instanceId])).rows[0];
  const o=(await q.query(`SELECT o.* FROM commerce_product_photo_targets t JOIN asset_objects o
    ON o.asset_id=t.asset_id AND o.representation_id=t.representation_id WHERE t.tenant_id=$1 AND t.instance_id=$2 AND t.product_id=$3`,
  [input.tenantId,input.instanceId,input.productId])).rows[0];
  if(!p||!o)throw Error('A published store and real square ready product photo are required');
  await q.query(`INSERT INTO commerce_storefront_appearance_drafts(tenant_id,instance_id,accent_preset,announcement,featured_product_ids)
    VALUES($1,$2,'ocean','合成商店公告',$3)`,[input.tenantId,input.instanceId,[input.productId]]);
  for(const kind of ['storefront.cover','storefront.logo'])await q.query(`INSERT INTO commerce_storefront_appearance_targets
    (tenant_id,instance_id,kind,scope_id,last_changed_at_profile_version) VALUES($1,$2,$3,$4,$5)`,
  [input.tenantId,input.instanceId,kind,p.scope_id,p.version]);
  await q.query('UPDATE commerce_storefront_profiles SET version=version+1 WHERE tenant_id=$1 AND instance_id=$2',[input.tenantId,input.instanceId]);
  await q.query(`UPDATE commerce_storefront_appearance_targets SET asset_id=$3,representation_id=$4,policy_revision=$5,
    last_changed_at_profile_version=$6 WHERE tenant_id=$1 AND instance_id=$2`,[input.tenantId,input.instanceId,o.asset_id,o.representation_id,o.policy_revision,String(BigInt(p.version)+1n)]);
  const image={asset_id:o.asset_id,representation_id:o.representation_id,scope_id:o.scope_id,policy_revision:o.policy_revision,
    purpose:'storefront.product-photo',transform_version:o.transform_version,content_type:o.content_type,
    byte_size:Number(o.byte_size),width:o.pixel_width,height:o.pixel_height,sha256:o.content_sha256};
  const document={profile:'freedom.hosted-store-appearance/v1',accent_preset:'ocean',announcement:'合成商店公告',
    featured_product_ids:[input.productId],featured_skus:['P0001'],cover:image,logo:image};
  const digest=createHash('sha256').update(JSON.stringify(document)).digest('hex');
  await q.query(`INSERT INTO commerce_publication_appearances(publication_id,tenant_id,instance_id,document,appearance_sha256)
    VALUES($1,$2,$3,$4,$5)`,[p.current_publication_id,input.tenantId,input.instanceId,document,digest]);
  for(const kind of ['cover','logo'])await q.query(`INSERT INTO commerce_publication_appearance_refs
    (publication_id,kind,tenant_id,instance_id,scope_id,asset_id,representation_id,policy_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
  [p.current_publication_id,kind,input.tenantId,input.instanceId,o.scope_id,o.asset_id,o.representation_id,o.policy_revision]);
  return {profile:p,object:o,document,digest};
}
