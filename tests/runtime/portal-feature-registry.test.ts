import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidElement, type ReactElement } from 'react';
import { PortalClient } from '../../apps/portal-web/src/api.js';
import type { PortalFeatureContext, PortalFeatureEntries, PortalFeatureEntry } from '../../apps/portal-web/src/features/types.js';
import { composePortalFeatures } from '../../apps/portal-web/src/features/composition.js';
import { PORTAL_FEATURE_METADATA, TAB_TITLES, TAB_GUIDANCE } from '../../apps/portal-web/src/features/metadata.js';
import { commerceFeatures, HostedOrderPage } from '../../apps/portal-web/src/features/commerce.js';
import { identityFeatures } from '../../apps/portal-web/src/features/identity.js';
import type { TabId, SessionPayload } from '../../apps/portal-web/src/types.js';

function fixture(overrides: Partial<PortalFeatureContext> = {}): PortalFeatureContext {
  return {
    client: new PortalClient(),
    session: { user: { user_id: 'synthetic-member-a', display_name: '測試會員' }, csrf_token: 'synthetic-csrf-a' } as SessionPayload,
    site: null,
    locationHash: '#reservations',
    selectTab: () => {}, friendScope: 'accepted', notificationTarget: null, headerMember: null,
    registerPageLeave: () => {}, replaceBuyerLocation: () => {}, onSessionExpired: () => {},
    openMemberMessage: () => {}, showIncomingFriends: () => {},
    ...overrides,
  };
}

function element(value: unknown): ReactElement<Record<string, any>> {
  assert.ok(isValidElement(value));
  return value as ReactElement<Record<string, any>>;
}

function completeEntries(render: PortalFeatureEntry['render'] = () => null): PortalFeatureEntries {
  return Object.fromEntries(Object.keys(PORTAL_FEATURE_METADATA).map(id => [id, {
    moduleId: 'synthetic-owner', placement: 'page', render,
  }])) as PortalFeatureEntries;
}

test('feature composition rejects duplicate, missing and unknown pages without invoking feature code', () => {
  let renders = 0;
  const complete = completeEntries(() => { renders++; return null; });
  const composed = composePortalFeatures([complete]);
  assert.deepEqual(Object.keys(composed), Object.keys(TAB_TITLES));
  assert.deepEqual(Object.keys(TAB_GUIDANCE), Object.keys(TAB_TITLES));
  assert.equal(renders, 0);
  assert.throws(() => composePortalFeatures([complete, { home: complete.home }]), /duplicate_portal_feature/);
  const missing = { ...complete }; delete missing.home;
  assert.throws(() => composePortalFeatures([missing]), /missing_portal_feature/);
  assert.throws(() => composePortalFeatures([complete, { invented: complete.home } as PortalFeatureEntries]), /unknown_portal_feature/);
  assert.throws(() => composePortalFeatures([{ ...complete, home: undefined }]), /invalid_portal_feature/);
  assert.equal(renders, 0);
});

test('selecting one registered page executes only that page and preserves overlay placement', () => {
  const visited: string[] = [];
  const entries = completeEntries();
  for (const id of Object.keys(entries) as TabId[]) entries[id] = {
    moduleId: 'synthetic-owner', placement: id === 'messages' ? 'overlay' : 'page',
    render: () => { visited.push(id); return null; },
  };
  const composed = composePortalFeatures([entries]);
  composed.skills.render(fixture());
  assert.deepEqual(visited, ['skills']);
  assert.equal(composed.messages.placement, 'overlay');
  assert.equal(Object.isFrozen(composed), true);
});

test('buyer order entry retains the same lazy component, exact callbacks and account-generation key', () => {
  const context = fixture();
  const before = element(commerceFeatures.reservations.render(context));
  assert.equal(before.type, HostedOrderPage);
  assert.equal(before.key, `${context.session.user.user_id}:${context.client.sessionGeneration}`);
  assert.equal(before.props.client, context.client);
  assert.equal(before.props.registerLeave, context.registerPageLeave);
  assert.equal(before.props.replaceLocation, context.replaceBuyerLocation);
  assert.equal(before.props.checkoutOrders, undefined);
  const enabled = fixture({ site: { registration_enabled: true, demo_accounts_enabled: false, public_mode: false, member_blocking_enabled: false, commerce_checkout_enabled: true } });
  const order = element(commerceFeatures.reservations.render(enabled));
  assert.deepEqual(order.props.checkoutOrders, {
    userId: enabled.session.user.user_id, csrfToken: enabled.session.csrf_token,
    onSessionExpired: enabled.onSessionExpired,
  });
  const next = element(commerceFeatures.reservations.render({ ...enabled, session: { ...enabled.session, user: { ...enabled.session.user, user_id: 'synthetic-member-b' } } }));
  assert.notEqual(next.key, order.key);
});

test('store entry does not turn missing capability data into enabled features', () => {
  const context = fixture();
  const store = element(commerceFeatures.stores.render(context));
  for (const prop of ['categoriesEnabled','variantsEnabled','galleryEnabled','policiesEnabled','appearanceEnabled',
    'supplyOfferPhotosEnabled','distributionPhotosEnabled','materialMediaEnabled','materialUploadsEnabled',
    'checkoutEnabled','commerceConsoleEnabled','consoleEnabled','photosEnabled','photoUploadsEnabled','enabled']) {
    assert.equal(store.props[prop], false, prop);
  }
  assert.equal(store.props.providerEnvironment, 'sandbox');
  assert.equal(store.props.registerLeave, context.registerPageLeave);
  assert.equal(element(commerceFeatures.business.render(context)).props.enabled, null);
});

test('store entry forwards independent flags and the existing production environment distinction', () => {
  const context = fixture({ site: {
    registration_enabled: true, demo_accounts_enabled: false, public_mode: true, member_blocking_enabled: false,
    guild_launchpad_enabled: true, commerce_console_enabled: true, supplier_console_enabled: false,
    store_categories_enabled: true, store_variants_enabled: false, commerce_checkout_enabled: false,
  } });
  const store = element(commerceFeatures.stores.render(context));
  assert.equal(store.props.enabled, true);
  assert.equal(store.props.commerceConsoleEnabled, true);
  assert.equal(store.props.consoleEnabled, false);
  assert.equal(store.props.categoriesEnabled, true);
  assert.equal(store.props.variantsEnabled, false);
  assert.equal(store.props.checkoutEnabled, false);
  assert.equal(store.props.providerEnvironment, 'live');
});

test('friend/member entries forward shell actions without making a notification from another page a member focus', () => {
  const ids: string[] = []; let incoming = 0;
  const context = fixture({ friendScope: 'incoming', openMemberMessage: id => ids.push(id),
    showIncomingFriends: () => { incoming++; }, notificationTarget: { tab: 'social', resource_id: 'synthetic-post', sequence: 7 } });
  const friends = element(identityFeatures.friends.render(context));
  assert.equal(friends.props.initialScope, 'incoming');
  friends.props.onMessage('synthetic-peer');
  const members = element(identityFeatures.members.render(context));
  assert.equal(members.props.focusRequest, undefined);
  members.props.onIncomingFriends();
  members.props.onMessage('synthetic-peer-2');
  assert.deepEqual(ids, ['synthetic-peer', 'synthetic-peer-2']);
  assert.equal(incoming, 1);
  const focused = element(identityFeatures.members.render({ ...context, notificationTarget: { tab: 'members', resource_id: 'synthetic-peer', sequence: 8 } }));
  assert.deepEqual(focused.props.focusRequest, { id: 'synthetic-peer', sequence: 8 });
});
