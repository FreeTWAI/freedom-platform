import React, { lazy } from 'react';
import type { PortalFeatureEntries } from './types';

export const HostedOrderPage = lazy(() => import('../modules/HostedOrder').then(m => ({default: m.HostedOrderPage})))
const HostedStore = lazy(() => import('../modules/HostedStore').then(m => ({default: m.HostedStore})))
const TenantSettings = lazy(() => import('../modules/TenantSettings').then(m => ({default: m.TenantSettings})))
const SupplierPanel = lazy(() => import('../modules/CommercePanels').then(m => ({default: m.SupplierPanel})))
const RetailPanel = lazy(() => import('../modules/CommercePanels').then(m => ({default: m.RetailPanel})))

const VirtualCommerce = lazy(() => import('../modules/VirtualCommerce').then(m => ({default: m.VirtualCommerce})))

// Page entries only compose existing features. Session, navigation and leave guards stay in the shell.
export const commerceFeatures = {
  "virtual-commerce": {
    moduleId: "virtual-commerce", placement: 'page',
    render: ({client, session}) => <VirtualCommerce key={`${session.user.user_id}:${client.sessionGeneration}`} />,
  },
  "reservations": {
    moduleId: "hosted-checkout", placement: 'page',
    render: ({client, session, site, locationHash, registerPageLeave, replaceBuyerLocation, onSessionExpired}) => <HostedOrderPage key={`${session.user.user_id}:${client.sessionGeneration}`} client={client} locationHash={locationHash} registerLeave={registerPageLeave} replaceLocation={replaceBuyerLocation} checkoutOrders={site?.commerce_checkout_enabled===true?{userId:session.user.user_id,csrfToken:session.csrf_token,onSessionExpired}:undefined} />,
  },
  "stores": {
    moduleId: "agent-commerce-portal", placement: 'page',
    render: ({client, session, site, locationHash, registerPageLeave}) => <HostedStore dropShipEnabled={site?.commerce_drop_ship_enabled===true} selfShipEnabled={site?.commerce_self_ship_enabled===true} categoriesEnabled={site?.store_categories_enabled===true} variantsEnabled={site?.store_variants_enabled===true} galleryEnabled={site?.store_gallery_enabled===true} policiesEnabled={site?.store_policies_enabled===true} appearanceEnabled={site?.store_appearance_enabled===true} supplyOfferPhotosEnabled={site?.supply_offer_photos_enabled===true} distributionPhotosEnabled={site?.distribution_photos_enabled===true} materialMediaEnabled={site?.supply_material_media_enabled===true} materialUploadsEnabled={site?.supply_material_uploads_enabled===true} checkoutEnabled={site?.commerce_checkout_enabled===true} commerceConsoleEnabled={site?.commerce_console_enabled === true} providerEnvironment={site?.public_mode === true ? 'live' : 'sandbox'} consoleEnabled={site?.supplier_console_enabled === true} client={client} photosEnabled={site?.hosted_store_photos_enabled===true} photoUploadsEnabled={site?.hosted_store_photo_uploads_enabled===true} enabled={site?.guild_launchpad_enabled === true} locationHash={locationHash} userId={session.user.user_id} registerLeave={registerPageLeave} />,
  },
  "business": {
    moduleId: "tenant-workspaces", placement: 'page',
    render: ({client, session, site}) => <TenantSettings client={client} session={session} enabled={site ? site.guild_launchpad_enabled === true : null} />,
  },
  "supplier": {
    moduleId: "agent-commerce-portal", placement: 'page',
    render: ({client, session, selectTab}) => <SupplierPanel client={client} session={session} onNavigate={selectTab} />,
  },
  "retail": {
    moduleId: "agent-commerce-portal", placement: 'page',
    render: ({client, session, selectTab}) => <RetailPanel client={client} session={session} onNavigate={selectTab} />,
  },
} satisfies PortalFeatureEntries;
