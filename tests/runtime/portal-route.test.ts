import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canonicalHash,legacyHash,resolvePortalRoute,LEGACY_ROUTES,PORTAL_PLACES} from '../../apps/portal-web/src/portal-route';
import {canOpenGuestProfile} from '../../apps/portal-web/src/modules/profile-publication-route';
const expected = {
 home:'home',social:'home',profile:'me',account:'me/settings','my-content':'me/content',todos:'me/start',
 members:'explore/people',skills:'explore/resources',showcase:'explore/works',events:'explore/events',services:'explore/services',highlights:'explore/events/results','community-search':'explore',opensource:'home/share/resource',guilds:'guilds',community:'guilds/community','community-hub':'guilds/community','private-ai':'automation',messages:'me/messages',friends:'me/messages/contacts',squads:'me/teams',business:'me/workspaces',reservations:'me/orders',promotion:'me/shares',
 stores:'guilds/guild_commerce_sales/tools/store',retail:'guilds/guild_commerce_sales/tools/retail-kit','virtual-commerce':'guilds/guild_commerce_sales/tools/rehearsal',supplier:'guilds/guild_product_quality_supply/tools/supplier-kit',marketing:'guilds/guild_marketing/tools/marketing',cocreation:'guilds/guild_ai_vibe/tools/cocreation',workbench:'guilds/guild_ai_project/tools/work',tasks:'guilds/guild_ai_project/tools/work/discovery',engagement:'guilds/guild_opportunity_partnership/tools/engagement',positioning:'guilds/guild_talent_direction/tools/assessment','newbie-village':'guilds/guild_talent_direction/tools/village','tester-map':'guilds/guild_custom_032fd02e754549e9b1e056e2b95b8d50/tools/tester-map',ar:'guilds/guild_ar/tools/ar','guild-workspace':'guilds/manage',
};
test('exactly five places and all 38 historical tabs',()=>{assert.equal(PORTAL_PLACES.length,5);assert.equal(Object.keys(expected).length,38);assert.deepEqual(LEGACY_ROUTES,expected)});
for(const [old,destination] of Object.entries(expected))test(`legacy ${old}: canonical, idempotent, preserves query and object`,()=>{
 const hash=`#${old}/synthetic-id?q=%E4%BD%A0+%26&type=work&draft=draft-1`;
 const result=canonicalHash(hash);assert.equal(result,`#${destination}/synthetic-id?q=%E4%BD%A0+%26&type=work&draft=draft-1`);
 assert.equal(canonicalHash(result),result);
 assert.equal(legacyHash(result),hash.replace(/^#social/, '#home').replace(/^#community-hub/,'#community'));
});
for(const suffix of ['','/overview','/orders','/orders/id','/orders/reservations','/payments','/payments/id','/settings','/settings/payments','/drop-ship'])test(`seller suffix ${suffix}`,()=>{const old='#stores/tenant/store'+suffix;assert.equal(legacyHash(canonicalHash(old)),old);assert.equal(resolvePortalRoute(old).toolId,'store')});
for(const suffix of ['','/overview','/drop-ship/agreements','/drop-ship/orders','/products','/reservations','/partners','/terms','/materials','/reports','/settings','/materials/new','/materials/id','/products/new','/products/id','/reservations/id','/partners/id','/terms/id','/invalid'])test(`supplier suffix ${suffix}`,()=>{const old='#stores/tenant/store/supply'+suffix+'?filter=open';assert.equal(legacyHash(canonicalHash(old)),old);assert.equal(resolvePortalRoute(old).toolId,'catalog')});
for(const old of ['#stores/supply','#stores/supply/setup','#stores/tenant/store/supply-orders','#reservations/shop-name/product/P1234','#reservations/shop-name/intent/id','#reservations/order/id','#my-content/showcases/id','#squad-outcomes/id','#guilds/guild_ai_vibe/start','#guilds/guild_ai_vibe/work','#guilds/guild_ai_vibe/skills','#guilds/guild_ai_vibe/tools','#guilds/guild_ai_vibe/information','#opensource?submission=id&project=other','#profile?view=settings','#account?view=connections','#account?view=recognition','#messages?guild=guild_ai_vibe'])test(`subroute ${old}`,()=>assert.equal(legacyHash(canonicalHash(old)),old));
test('guest profile remains a public projection, owner views cannot match its guest adapter',()=>{
 const id='12345678-1234-1234-1234-123456789abc';
 const publicRoute=resolvePortalRoute('#profile?member='+id);
 assert.equal(publicRoute.ownerOnly,false);assert.equal(canOpenGuestProfile(publicRoute.legacyHash,''),true);
 for(const old of ['#profile','#profile?view=settings','#account','#my-content','#private-ai']){const route=resolvePortalRoute(old);assert.equal(route.ownerOnly,true);assert.equal(canOpenGuestProfile(route.legacyHash,''),false)}
 assert.equal(canOpenGuestProfile(publicRoute.legacyHash,'?code=callback'),false);
});
test('auth, token fragments and HTTP public URLs are outside alias grammar',()=>{
 for(const hash of ['#reset-password/token','#verify-email/token','#change-email/token','#join/guild_ai_vibe','#unknown'])assert.equal(canonicalHash(hash),hash);
 assert.equal(resolvePortalRoute('#guilds/community').guildKey,undefined);
});

import {GUILD_TOOLS,toolHash} from '../../apps/portal-web/src/guild-tools/catalog';
import {guildKeyFromHash,guildActionFromHash,guildToolFromHash,guildRoute} from '../../apps/portal-web/src/modules/guild-launchpad-route';
test('native tool catalog has one owner and extends existing launchpad grammar',()=>{
 assert.equal(GUILD_TOOLS.length,14);
 assert.equal(new Set(GUILD_TOOLS.map(t=>t.guild_key+'/'+t.tool_id)).size,GUILD_TOOLS.length);
 for(const tool of GUILD_TOOLS){assert.equal(tool.kind,'native');assert.ok(tool.title.length<=6);assert.equal(guildKeyFromHash(toolHash(tool)+'?draft=id'),tool.guild_key);assert.equal(guildActionFromHash(toolHash(tool)),'tools');assert.equal(guildToolFromHash(toolHash(tool)),tool.tool_id);assert.equal(guildRoute(tool.guild_key,'tools',tool.tool_id),toolHash(tool));}
 for(const key of ['community','manage','unknown'])assert.equal(guildKeyFromHash('#guilds/'+key),null);
});
