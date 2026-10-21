import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {StorefrontAppearanceInputSchema,StorefrontAppearanceDraftSchema,AppearanceCommandAckSchema,
  AnnouncementSchema,STOREFRONT_APPEARANCE_PROFILE} from '../../contracts/guild-launchpad/v1/storefront-appearance.js';
import {PublicStoreProjectionSchema} from '../../contracts/guild-launchpad/v1/storefront.js';
import {StoreAppearanceInputSchema} from '../../contracts/guild-launchpad/v1/storefront-presentation.js';
import {appearanceSnapshot,defaultAppearanceSnapshot,renderAppearance} from '../../modules/agent-commerce/hosted/appearance.js';
import {storeHtml,productHtml} from '../../modules/agent-commerce/hosted/page.js';

const input={template_id:'catalog-grid-v1',accent_preset:'lime',announcement:'',featured_product_ids:[]};
const projection=PublicStoreProjectionSchema.parse({slug:'safe-store',name:'合成商店',brand:null,description:'合成介紹',currency:'TWD',products:[{sku:'P0001',title:'合成商品',description:'合成內容',price_minor:123}],revision:'1',published_at:'2026-10-20T00:00:00.000Z',transaction_state:'not_enabled'});
test('appearance accepts only controlled metadata; old presentation and public projection remain strict',()=>{
  assert.ok(StorefrontAppearanceInputSchema.safeParse(input).success);
  for(const extra of [{css:'color:red'},{contact_email:'synthetic@invalid.test'},{bank_account:'synthetic'},{accent_preset:'#fff'},{featured_product_ids:[randomUUID(),randomUUID(),...Array.from({length:7},()=>randomUUID())]},{cover:'/caller-selected.png'}])assert.equal(StorefrontAppearanceInputSchema.safeParse({...input,...extra}).success,false);
  assert.equal(StoreAppearanceInputSchema.safeParse(input).success,false);
  assert.equal(PublicStoreProjectionSchema.safeParse({...projection,appearance:input}).success,false);
  for(const text of ['合'.repeat(80),'🛍️'.repeat(26),'<b>純文字</b>','  合成公告  ','　 ','  '+'𠮷'.repeat(80)+'　'])assert.equal(AnnouncementSchema.safeParse(text).success,true);
  for(const text of ['合'.repeat(81),' '+'𠮷'.repeat(81)+' ','x\ny','x\ry','x\u0085y','x\u2028y','x\u0000y','\ud800','\udc00'])assert.equal(AnnouncementSchema.safeParse(text).success,false);
});
test('publication digest fixes key order, keeps featured order and excludes all volatile fields',()=>{
  const a=randomUUID(),b=randomUUID();const d={...defaultAppearanceSnapshot().document,featured_product_ids:[a,b],featured_skus:['P0002','P0001']};
  const first=appearanceSnapshot(d),second=appearanceSnapshot(Object.fromEntries(Object.entries(d).reverse()));
  assert.equal(first.sha256,second.sha256);assert.notEqual(first.sha256,appearanceSnapshot({...d,featured_skus:['P0001','P0002']}).sha256);
  assert(Object.isFrozen(first));assert(Object.isFrozen(first.document));assert(Object.isFrozen(first.document.featured_skus));
  assert.throws(()=>appearanceSnapshot({...d,version:'2'}));assert.throws(()=>appearanceSnapshot({...d,object_key:'private'}));
  const empty={profile:STOREFRONT_APPEARANCE_PROFILE,accent_preset:'lime',announcement:'',featured_product_ids:[],featured_skus:[],cover:null,logo:null};
  assert.equal(defaultAppearanceSnapshot().sha256,createHash('sha256').update(JSON.stringify(empty)).digest('hex'));
});
test('completion compares bounded decimal versions safely and validates current role/version paths',()=>{
  const draft={profile:STOREFRONT_APPEARANCE_PROFILE,version:'9223372036854775807',...input,featured_products:[],eligible_products:[],has_supplied_products:false,
    cover:null,logo:null,media_installed:false,uploads_enabled:false,published_revision:null,dirty:true};
  assert.ok(StorefrontAppearanceDraftSchema.safeParse(draft).success);
  assert.ok(AppearanceCommandAckSchema.safeParse({profile:STOREFRONT_APPEARANCE_PROFILE,completed_version:'9007199254740993',changed:true,current:draft}).success);
  for(const completed_version of ['9223372036854775808','0','01','1\n'])assert.equal(AppearanceCommandAckSchema.safeParse({profile:STOREFRONT_APPEARANCE_PROFILE,completed_version,changed:true,current:draft}).success,false);
  const t=randomUUID(),i=randomUUID(),image={content_type:'image/webp',byte_size:10,width:10,height:10,read_path:`/api/v1/tenants/${t}/storefronts/${i}/appearance-media/cover/1`};
  assert.equal(StorefrontAppearanceDraftSchema.safeParse({...draft,version:'1',cover:image}).success,true);
  assert.equal(StorefrontAppearanceDraftSchema.safeParse({...draft,cover:image}).success,false);
  assert.equal(StorefrontAppearanceDraftSchema.safeParse({...draft,version:'1',logo:image}).success,false);
});
test('flag-OFF rendering matches captured base HTML bytes for store, preview and product',()=>{
  // Captured from the assigned 54540acc base renderer, including its own shell.
  const outputs=[storeHtml(projection),storeHtml(projection,'catalog-list-v1',[],{preview:true}),productHtml(projection,'P0001')!];
  assert.deepEqual(outputs.map(html=>createHash('sha256').update(html).digest('hex')),[
    '6fb09096459fda3aa43f0d9e6f64f7161064b597079b34d679091a4a3d33141f',
    '48da432deae94ad2304426fb4dea3429e9cb8cd40876546621ba699e4e0e6f96',
    'a67338c3a10a4c55bb0c98cebe560beffaf7725fc55784a965f3306db54fb59e',
  ]);
});
test('appearance HTML escapes announcements and excludes stale featured SKUs without an implicit cover',()=>{
  const d={...defaultAppearanceSnapshot().document,announcement:'<script>合成</script>',featured_skus:['P9999','P0001']};
  const appearance=renderAppearance(d,{slug:projection.slug,revision:projection.revision},false);
  const html=storeHtml(projection,'catalog-grid-v1',[],undefined,undefined,appearance);
  assert.match(html,/&lt;script&gt;合成&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>/i);
  assert.doesNotMatch(html,/shop-cover|P9999/);
  assert.equal((html.match(/<article>/g)??[]).length,2);assert.ok(html.indexOf('id="featured-products"')<html.indexOf('id="products"'));
  const mixedAppearance=renderAppearance({...d,announcement:'<ScRiPt>合成</sCrIpT>'},{slug:projection.slug,revision:projection.revision},false);
  const mixedHtml=storeHtml(projection,'catalog-grid-v1',[],undefined,undefined,mixedAppearance);
  assert.match(mixedHtml,/&lt;ScRiPt&gt;合成&lt;\/sCrIpT&gt;/);assert.doesNotMatch(mixedHtml,/<script>/i);
  const blank=storeHtml(projection,'catalog-grid-v1',[],undefined,undefined,{...appearance,announcement:'　 '});
  assert.doesNotMatch(blank,/class="shop-announcement"/);
});
test('featured products retain configured order above the full catalog and public images bind the current store revision',()=>{
  const store={...projection,products:[...projection.products,{...projection.products[0],sku:'P0002',title:'第二件合成商品'}]};
  const appearance=renderAppearance({...defaultAppearanceSnapshot().document,featured_skus:['P0002','P0001']},{slug:store.slug,revision:store.revision},true);
  const html=storeHtml(store,'catalog-grid-v1',[],undefined,undefined,appearance);
  const featured=html.slice(html.indexOf('id="featured-products"'),html.indexOf('id="products"'));
  assert.ok(featured.indexOf('第二件合成商品')<featured.indexOf('>合成商品</a>'));
  const image={content_type:'image/webp' as const,byte_size:10,width:10,height:10,read_path:'/shops/other-store/appearance-media/1/cover'};
  assert.throws(()=>storeHtml(store,'catalog-grid-v1',[],undefined,undefined,{...appearance,cover:image}),/storefront_public_appearance_required/);
});
test('generated independent appearance bundle contains no server-only Asset identity',()=>{
  const bytes=readFileSync(new URL('../../contracts/guild-launchpad/v1/storefront-appearance.schema.json',import.meta.url),'utf8');
  const doc=JSON.parse(bytes);assert.deepEqual(Object.keys(doc.$defs),['appearance-settings-input','appearance-draft','appearance-command','remove-appearance-image-input']);
  assert.doesNotMatch(bytes,/"(?:asset_id|scope_id|policy_revision|representation_id|object_key|account_number|contact_email)"/);
});
