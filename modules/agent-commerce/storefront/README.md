# Commerce storefront buyer pages

Buyer pages under `/shops/:slug` that need browser code, and the storefront
client bundle they share (EC-SPEC-01 §3, EC-SPEC-02 §4.2 and §6).

- Server HTML for these pages lives in this directory. The routes stay in
  `apps/platform-api/src/routes/hosted-store.ts` next to the other `/shops`
  pages.
- The client entry lives in `apps/portal-web/src/storefront/`. Vite emits it
  under the fixed name `assets/storefront.js`, which is served `no-store` like
  the other fixed-name files. It uses only the `shop-` styles in `/shops.css`
  and never loads the portal app, themes, navigation or chat.
- Orders are read only through the public checkout API (`hosted-checkout`).
  The pages show no data that the API did not return.
- The shop, product and buyer pages share the published merchant name and
  navigation through `hosted/storefront-shell.ts`. The original Freedom Workshop
  logo and platform attribution stay in the footer. Order guidance remains
  reachable when new checkout is closed; it does not grant access to any order.
  Private previews show the saved merchant identity without public navigation
  or checkout actions. The shared 「商店說明與聯絡」 section displays the
  merchant-authored `description` from that same publication (or saved draft
  in private preview). It is available without JavaScript on shop, product,
  cart, checkout, order-access, order and payment-return pages, including
  missing-order guidance for a still-published shop. Empty descriptions say
  that the merchant has not supplied this information.
  Member contact details, buyer data, bank settings and supplier agreement
  terms are never used to fill this section. Text is escaped, line breaks are
  preserved and URLs are not automatically turned into links. The shop header
  shows a short introduction; the full text remains in the shared section.
- Merchants edit the existing 「商店介紹」 field under 「商店資料」, save,
  preview, then publish. Its guidance asks for their public contact, payment,
  delivery and after-sales information; it does not invent or verify those
  claims. Draft changes do not update public pages. Withdrawal and current
  store visibility checks still govern all pages. No new DTO, migration,
  payment setting, transaction authority or frozen order term is introduced.
- Before Ted authorises `FREEDOM_COMMERCE_EMAIL_ENABLED`, B10 shows the
  EC-SPEC-10 §6.2 explanation and collects no Email.

Status: `pages.ts` renders the B04 cart shell (`cartPageHtml`), the B05 checkout
shell (`checkoutPageHtml`), the B07 order
shell (`orderPageHtml`), the 404 order-missing page (`orderMissingHtml`), the
B10 order-access guidance page (`orderAccessPageHtml`), the B06 payment return
shell (`paymentReturnPageHtml`) and the 404 payment-return-missing page
(`paymentReturnMissingHtml`);
`apps/portal-web/src/storefront/main.tsx`, `payment-view.ts` and `cart-store.ts`
persist per-store browser carts, sync the B01/B03 header cart count and live
announcer, mount `#shop-add-to-cart` with the B03 modal cart sheet, mount
`#shop-cart` to price the B04 cart via
`POST /api/v1/public/stores/:slug/cart-quotes`, mount `#shop-order` (B07) to
redeem one-time links, display order/payment state (`需要你處理` and `付款`),
start or resume payment via `POST …/payment-handoffs`, query payment results via
`POST …/payment-queries` and forget browser device access, and mount
`#shop-pay-return` (B06) to poll the order for up to two minutes after a
provider browser return and render the payment outcome without exposing contact
data, line items or amounts.

`checkout-page.tsx` freezes server quotes before placing an order, displays
server payment availability, and supports offline payments with meetup pickup.
CVS store selection and invoice fields remain pending their provider workflows.
The checkout key and contact values stay in memory. A placement stores only its
checkout reference, terms hash, payment method and client order ID in tab session
storage before sending, so a lost response or refresh can retry the same intent.
Recovered intents retain the current cart because its original contents are not
persisted with the intent; another tab may have prepared a newer purchase.
No bank instructions or contact data are persisted in browser storage.
`offline-order.tsx` displays authorized, frozen bank/meetup instructions, seller
confirmation and deadlines, and offers refresh and buyer cancellation. It never
starts a payment attempt. An optional `meetup_notes` order field supplies public
notes from the frozen shipping groups, rather than current merchant settings.

## Store appearance (local candidate, 2026-10-20)

Migration 175 adds retained appearance drafts/targets and immutable publication
sidecars/refs. `FREEDOM_STORE_APPEARANCE_ENABLED` defaults OFF in Node and Worker;
`GET /api/v1/site` exposes `store_appearance_enabled`. This source does not enable
any environment or claim deployment, hosted CI, merchant adoption or full C1
acceptance. Categories, variants, policies and seller disclosure remain later work.

With the flag ON, 「店面與發布 → 店面外觀」 edits the existing template together
with eight named accent presets, a one-line announcement of at most 80 Unicode
characters, and an ordered list of up to eight own retail products. Supplied
products remain outside the picker. All appearance writes require `store:manage`
(the same boundary as the existing template); publish still requires
`store:publish`. This is the explicit EC-SPEC-02 §7 deviation from its proposed
`store:write` rule. Read-only members see saved values and images without controls.

Metadata works without media installation. Cover/logo reads and mutations require
`storePhotosInstalled`; new uploads also require the existing upload predicates,
a closed appearance lifecycle port and canonical persistence/quota admission.
Each media send uses the current storefront profile version, while metadata saves
combine template/accent/announcement/featured IDs in one CAS command. Local images
can coexist with text edits; sends wait until text is saved, and text waits during
an unresolved image operation. Unknown results retain the original key, version,
body/File and require explicit retry, including after same-member re-login.
Known CAS refusals retain input for explicit review against the refreshed draft.
These in-memory Files are not promised to survive a full document reload.

Publish freezes a separate canonical appearance digest alongside the unchanged
projection, template and product-media dimensions. Public shop, product, cart,
checkout, order and payment-return shells read only the current publication.
The announcement stays static; logo and store name lead the header; the original
Freedom logo and 「使用自由工坊開店」 remain in the footer. Covers display the
whole image at its own aspect ratio, without overlay/crop/tinted framing, with
frozen width/height and capped height. Text precedes the cover on mobile/tablet
and sits beside it on desktop. No cover means a text-only hero. `og:image` uses a
frozen cover when media is installed, then the existing first published product
photo, then the original Freedom asset. Product OG images retain their own rule.
Featured products appear in frozen order only when present in that publication.

The v1 public projection and `GET /api/v1/public/stores/:slug` remain unchanged.
OFF ignores every appearance row and mounts no new routes. A legacy-shaped
publisher can create a publication with no appearance sidecar; ON renders defaults
for that publication. Drafts, replaced/removed images and historical refs are
retained throughout OFF and rollback. No GC or retention policy is enabled.
See the [media contract](../hosted/media-contract.md#store-appearance-media-local-candidate-2026-10-20)
and [closed asset profile](../../assets/storefront-appearance.md) for byte routes,
shared-purpose compatibility and storage boundaries.
