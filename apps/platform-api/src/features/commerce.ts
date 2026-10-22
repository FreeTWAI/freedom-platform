import { storeCategoriesInstalled, storeCategoriesOptions, createHostedStoreCategoriesRoutes } from '../routes/hosted-store-categories.js';
import { storeVariantsInstalled, storeVariantsOptions, createHostedStoreVariantsRoutes } from '../routes/hosted-store-variants.js';
import { storeGalleryInstalled, storeGalleryOptions, createHostedStoreGalleryRoutes } from '../routes/hosted-store-gallery.js';
import { storePoliciesInstalled, storePoliciesOptions, createHostedStorePoliciesRoutes } from '../routes/hosted-store-policies.js';
import { createHostedStoreAppearanceRoutes, storeAppearanceInstalled, storeAppearanceOptions } from '../routes/hosted-store-appearance.js';
import { createHostedSupplyOfferPhotoRoutes, supplyOfferPhotosInstalled } from '../routes/hosted-supply-offer-photos.js';
import { createHostedDistributionPhotoRoutes, distributionPhotosInstalled } from '../routes/hosted-distribution-photos.js';
import { createHostedSupplyMaterialRoutes } from '../routes/hosted-supply-materials.js';
import { createHostedSupplyMaterialMediaRoutes, supplyMaterialMediaInstalled } from '../routes/hosted-supply-material-media.js';
import { createHostedShippingRoutes } from '../routes/hosted-shipping.js';
import { createHostedOfflinePaymentRoutes } from '../routes/hosted-offline-payments.js';
import { createHostedSellerCheckoutRoutes } from '../routes/hosted-seller-checkout.js';
import { createHostedCommerceSetupRoutes } from '../routes/hosted-commerce-setup.js';
import { hostedPaymentOptions } from '../routes/hosted-payments.js';
import { providerEnvironment } from '../../../../modules/agent-commerce/operations/admissions.js';
import { hostedCheckoutOptions } from '../routes/hosted-checkout.js';
import { createHostedStoreOverviewRoutes } from '../routes/hosted-store-overview.js';
import { createHostedSupplierConsoleRoutes } from '../routes/hosted-supplier-console.js';
import { createHostedStoreMediaRoutes, storePhotosInstalled } from '../routes/hosted-store-media.js';
import { createHostedStoreRoutes } from '../routes/hosted-store.js';
import { createTenantWorkspaceRoutes } from '../routes/tenant-workspaces.js';
import { createModuleRegistryRoutes } from '../routes/module-registry.js';
import { createTenantWorkRoutes } from '../routes/tenant-work.js';
import type { PlatformFeatureApp, PlatformFeatureContext } from './context.js';

/** Registered at its original position; common request boundaries stay in the host. */
export function registerMemberCommerceRoutes(app: PlatformFeatureApp, context: PlatformFeatureContext) {
  const { pool, origin, freedomEnv, runtime } = context;
  if(runtime.guildLaunchpadEnabled===true){
    app.route('/api/v1',createTenantWorkspaceRoutes(pool));
    app.route('/api/v1',createModuleRegistryRoutes(pool,runtime.moduleProviders,runtime.tenantListCursors));
    app.route('/api/v1',createTenantWorkRoutes(pool,runtime.tenantWorkAssetStore,runtime.tenantListCursors));
    app.route('/api/v1',createHostedStoreRoutes(pool, runtime.hostedReservationsEnabled === true, supplyOfferPhotosInstalled(runtime),storeAppearanceOptions(runtime),storePoliciesOptions(runtime),storeGalleryOptions(runtime),storeVariantsOptions(runtime),storeCategoriesOptions(runtime)));
    app.route('/api/v1',createHostedCommerceSetupRoutes(pool,{keyring:runtime.commerceCredentialKeyring??null,journal:runtime.commercePayments?.journal,activation:hostedPaymentOptions(runtime,freedomEnv),environment:runtime.commerceProviderEnvironment??providerEnvironment(freedomEnv)}));
    if(runtime.commerceSettings?.consoleEnabled===true)app.route('/api/v1',createHostedStoreOverviewRoutes(pool,{checkout:hostedCheckoutOptions(origin,runtime,freedomEnv),environment:providerEnvironment(freedomEnv)}));
    if(runtime.commerceSettings?.consoleEnabled===true)app.route('/api/v1',createHostedShippingRoutes(pool,{environment:runtime.commerceProviderEnvironment??providerEnvironment(freedomEnv)}));
    if(runtime.commerceSettings?.consoleEnabled===true)app.route('/api/v1',createHostedOfflinePaymentRoutes(pool,{profiles:runtime.commerceSettings.providerProfiles}));
    if(runtime.commerceSettings?.consoleEnabled===true)app.route('/api/v1',createHostedSellerCheckoutRoutes(pool,{settings:runtime.commerceSettings,payment:runtime.commercePorts?.payment,paymentActions:runtime.commercePorts?.paymentActions,orderNotifications:hostedCheckoutOptions(origin,runtime,freedomEnv).orderNotifications,cursors:runtime.tenantListCursors,network:runtime.rateLimitNetwork??runtime.sourceNetwork}));
    if(runtime.supplierConsoleEnabled===true) {
      app.route('/api/v1',createHostedSupplierConsoleRoutes(pool,{cursors:runtime.tenantListCursors,offerPhotosEnabled:supplyOfferPhotosInstalled(runtime)}));
      app.route('/api/v1',createHostedSupplyMaterialRoutes(pool));
    }
    if(storeAppearanceInstalled(runtime))app.route('/api/v1',createHostedStoreAppearanceRoutes(pool,runtime));
    if(storePoliciesInstalled(runtime))app.route('/api/v1',createHostedStorePoliciesRoutes(pool,runtime));
    if(storeGalleryInstalled(runtime))app.route('/api/v1',createHostedStoreGalleryRoutes(pool,runtime));
    if(storeVariantsInstalled(runtime))app.route('/api/v1',createHostedStoreVariantsRoutes(pool,runtime));
    if(storeCategoriesInstalled(runtime))app.route('/api/v1',createHostedStoreCategoriesRoutes(pool,runtime));
    if(storePhotosInstalled(runtime))app.route('/api/v1',createHostedStoreMediaRoutes(pool,runtime));
    if(supplyOfferPhotosInstalled(runtime))app.route('/api/v1',createHostedSupplyOfferPhotoRoutes(pool,runtime));
    if(distributionPhotosInstalled(runtime))app.route('/api/v1',createHostedDistributionPhotoRoutes(pool,runtime));
    if(runtime.supplierConsoleEnabled===true&&supplyMaterialMediaInstalled(runtime))app.route('/api/v1',createHostedSupplyMaterialMediaRoutes(pool,runtime));
  }
}
