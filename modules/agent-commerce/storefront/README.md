# Commerce storefront buyer pages

Buyer pages under `/shops/:slug` that need browser code, and the storefront
client bundle they share (EC-SPEC-01 §3, EC-SPEC-02 §4.2 and §6).

2026-10-20 buyer journey: when `FREEDOM_COMMERCE_CHECKOUT_ENABLED` is on, B05,
B10 and the hydrated missing-B07 state for a valid UUID offer 「登入會員」.
The portal accepts only the closed checkout/order-access/order-UUID return paths,
validates the current public store, rechecks the successful session and performs
a full navigation after password, TOTP, backup-code login or registration.
Unavailable stores keep the member in the portal with a notice. Registration
can defer guild choice and positioning. B01/B03 reservation prompts are unchanged;
there is no cart return route.

`buyer-state.ts` and `checkout-page.tsx` implement EC-AT49: changed identities
cannot send old intents, and the retained cart gets a new quote before another
explicit confirmation. `delivery-copy.ts` maps every server delivery reason to
buyer copy. B05 names blocked items and offers only usable all-line alternatives;
otherwise it links to 「回購物車調整」. B04 validates and retains delivery options
and notes only items blocked by every configured option, without calculating
shipping. Prices, quoting, stock and holds retain their existing rules.

Flag-off compatibility covers storefront HTML response bytes, security/cache
headers and stable hydrated DOM for fixed fixtures, plus portal login and
`#reservations`. Edited JavaScript asset bytes are excluded from that comparison.
The existing directly addressable checkout HTML remains available when off;
its API gate still rejects checkout. No site JSON or Worker readiness change is
needed. The portal ignores storefront returns when the flag is off.

2026-10-20 member history companion: raw checkout flag ON adds the portal's
「訂單」 region above unchanged v1 at exact `#reservations`. A buyer who has
not completed onboarding gets only this read-only entry at that exact hash;
leaving it restores onboarding. `HostedOrderPage` composes the checkout-owned,
agent-commerce-co-owned `CheckoutOrders.tsx`, with no new composition import
edge or descriptor dependency. Shared lifecycle/Taipei formatters live in the
existing commerce formatter; storefront `format.ts` re-exports the same names.
The list stores no private browser data and ignores requests from an old member
or session generation. Rows open B07 through full navigation.

Unpublished-store B07 has a member-only, private retained shell and order read.
It exposes only the original buyer's frozen order and bank instructions, with
no historical storefront/footer replay and no command fallback. Anonymous or
other members receive the existing missing-store HTML. The list and retained
read do not change PR-A quotes, identity fences, delivery reasons or unknown ACK
copy. Migration180 is a partial index only; it changes no table or RLS policy.

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

## Seller information and store policies (2026-10-20 local C1 candidate)

Migration `176_storefront_seller_policies.sql` is provisional and additive: seller
and four policy components have immutable changed-save versions, mutable draft
pointers, and a separate immutable publication document plus typed policy refs.
A normalized no-op leaves component rows and profile version unchanged; a command
receipt still records completion metadata. Each seller/per-kind sequence is dense
and capped at 500, including unpublished and removal versions. There is no prune
or erasure executor. A limit failure returns `409 seller_policies_version_limit`
and rolls the whole section back.

`FREEDOM_STORE_POLICIES_ENABLED` defaults OFF independently of appearance, photos,
supply, checkout and admission. `/api/v1/site` exposes `store_policies_enabled`.
OFF installs neither routes nor the unmatched namespace guard, performs no legal
SELECTs, retains the host's current SPA fallback and renders the original footer.
An old binary ignores these new tables; an old-style publication without legal
rows has the original footer and the new information paths return the common 404
when the feature is installed. No v1 projection/JSON field or release floor changes.

The existing editor's 商店資料 contains 賣方資訊與商店政策. Its business-name
hint explains that a name enables the footer seller information, About and policy
links; it introduces no publication requirement. Private API root
`/api/v1/tenants/:tenant_id/storefronts/:instance_id/seller-policies` accepts GET
(`store:read`) and atomic PUT (`store:manage`, profile If-Match and Idempotency-Key).
This deliberately follows the existing description/contact authority rather than
SPEC-02's proposed `store:write`. Public/private fields are never inferred from
member accounts or guild profiles. The command receipt, journal, audit details,
logs and analytics retain no seller fields or policy prose. PUT alone has a 512 KiB
wire bound; raw structural string bounds keep its snapshot below the unchanged
256 KiB shared cap. Other routes retain their existing bounds.

Only saving changes drafts; preview renders saved drafts and publish freezes the
same IDs/digests under the fifth dirty dimension. Reads and retries reauthorize;
unknown results retain the original key/body/CAS in RAM and require an explicit
resend. A known 412 retains input for explicit review against refreshed data.
Quarantine blocks PUT and receipt replay before writes, while authorized reads
and published pages remain available. Publishing empty legal information succeeds.

Public HTML routes are `/shops/:slug/about`, `/shops/:slug/policies/:kind` and
`/shops/:slug/policies/:kind/v/:version_id`. They require the current publication's
liveness and legal sidecar; history additionally requires a same-store, same-kind,
ever-published nonempty policy. Foreign, unpublished and missing versions share
one opaque 404. Public information pages ignore query strings, including sharing
and campaign tags; private previews reject query strings with 422.
Every page remains noindex/no-store. Plain text is escaped, blank
lines form paragraphs, single newlines form line breaks, and there is no Markdown,
HTML or auto-linking. Seller Email/phone are text. Only rendered legal content
loads `shop-policies.css`. Products link to published shipping/returns. Terms are
linked in About/footer only and imply no buyer consent.

A published business name replaces the original responsibility statement with the
fixed seller sentence. Empty descriptions omit the contradictory missing-contact
placeholder. Preview keeps the original saved-draft notice followed by the draft
seller sentence. With no business name the footer is exactly the old branch.
About puts the seller fields and policy links in its main content only; its seller
heading owns `#shop-information`. About omits the footer information card while
retaining the responsibility sentence, Freedom logo and existing order links.
Other pages retain their footer information card. The privacy page and preview
address buyers directly; the owner's drop-ship checkbox label remains unchanged.
Historical policy footers always use the current seller; there is no old-seller
endpoint. Republishing removed phone/address withdraws it from all public pages.
Old policy prose may still contain personal data: withdrawal/erasure is an explicit
open product question for Ted, alongside evidence retention and future order links.

2026-10-20 editor-warning follow-up (OPEN-07): editable policy fields now explain
that published policy versions retain public URLs after replacement or clearing,
and that no individual-version withdrawal is available. The warning distinguishes
current seller disclosure, whose phone/address can be removed by republishing,
and directs personal contact details to seller fields rather than policy prose.
Private-history access/retention and public-prose withdrawal remain Ted's decision
before real-content activation. This copy changes no history or public reads.

C1 format choices: seller limits in the independent `storefront-policies` contract;
8 ASCII tax digits without checksum; optional returns window 7–3650 days; return-by
1–3650, default 14; all display only. The editor's checklist contains headings only.
The privacy statement is versioned and highlighted for supplier-sourced selections;
accepted supply pricing is not a drop-ship agreement (`fulfilment/rules/consent.ts`
still supplies `not_agreed`). No checkout gate, consent, AI drafting, order link,
payment/admission rule or readiness item is added. Existing checkout terms already
retain publication identity/revision; later order evidence can build on that without
this slice changing checkout or orders. The strict readiness contract stays eight.

Verification entry points: four `storefront-policies-{render,sql,commands,publication}`
runtime files and the default-mode `hosted-store-policies.spec.ts` (ten tests, real
per-test feature hosts, no media fixture). Restore/retarget fixtures cover all six
nonempty tenant tables. These are synthetic local checks, not hosted CI, deployment,
legal certification, Safari or real-member adoption evidence.

## Product gallery (local candidate, 2026-10-20)

Migration `177_storefront_product_gallery.sql` is provisional. Five new retained
tenant tables implement lazy groups, membership, secondary photos and immutable
publication documents/refs. No backfill, selection FK or legacy write trigger is
installed. Migration 141 remains the only primary pointer; secondary slots are
2–8, normalized to dense effective order. Primary alt binds its exact tuple
digest, so a legacy replacement cannot inherit the previous description. Reads
select only current product groups; retained primary lookup is indexed.

`FREEDOM_STORE_GALLERY_ENABLED` defaults OFF independently of appearance/policies.
Site always adds `store_gallery_enabled` (false OFF); every other site field is
unchanged. OFF mounts no gallery route and reads none of its five tables. The
original photo editor, storefront/product/cart/checkout/order/About/policy HTML,
v1 public store JSON, media JSON and single-photo paths keep their old bytes.
New ordinal media paths and unknown suffixes still reach the host's original SPA
fallback. Both the source and built `shops.css` / existing storefront entry stay
unchanged. No real activation, deploy or policy/limit change is included.

ON, owners manage up to eight ordered own-product photos with optional alt text
(trimmed, well formed, at most 120 Unicode code points; controls/bidi rejected).
Additions share the existing browser preparation, native decoder, closed upload
lifecycle, access-aware requests and retained unknown-result machinery. A new
`storefront.gallery-photo` target uses the established `storefront.product-photo`
purpose, limits, quota and backup profile. Unknown original File/JSON/key/CAS
stays in member/product-scoped RAM; retry never changes that original tuple.
Known CAS refusal requires explicit review before a fresh key/version.

All gallery mutations require `store:write`; `store:manage` or `store:publish`
alone does not grant it. Private reads need `store:read`. Routes below are relative
to `/api/v1/tenants/:tenant_id/storefronts/:instance_id`:

- GET `product-galleries`, GET `products/:product_id/gallery`.
- POST `products/:product_id/gallery/photos/:photo_id` (bounded raw image).
- POST `products/:product_id/gallery/reorder` (exact complete ordered key set).
- PATCH `products/:product_id/gallery/photos/:photo_key` (optional `alt_text`).
- POST `products/:product_id/gallery/photos/:photo_key/remove` (strict empty JSON).
- GET/HEAD `products/:product_id/gallery/photos/:photo_key/:version`.
- GET `preview-page/products/:sku` (saved draft detail).

Mutations use `Idempotency-Key` and product selection `If-Match`; receipts retain
completion metadata, then reproject the current draft under current authority.
Version conflict is 412, stale order/full gallery is 409, invalid description is 422.
Private snapshots share the profile read boundary; byte I/O holds no transaction.
Quarantine blocks new writes and receipt replay before effects. Original legacy
single-photo routes, capabilities, copy and tests remain in place.

Publishing freezes a separate canonical gallery document and refs under the same
profile boundary as the existing five dimensions. Its digest is the sixth dirty /
deduplication dimension; primary refs must equal the legacy freeze. Preview uses
saved draft; public `/shops/:slug/media/:revision/:sku/:n` uses only the same store's
current publication, with verified object readback between two authority snapshots.
GET/HEAD are no-store/noindex; foreign, draft, old or out-of-range paths share 404.
Unpublish retains history; republish freezes the current draft. A missing old
sidecar derives a singleton from the old frozen refs, never from a live draft.

Buyer figures show whole images in a reserved square stage. Dimensioned thumbnails
are real anchors; the separate `storefront-gallery.js` enhances selection, focus,
arrow/Home/End keys and a polite current-photo announcement. No JS still exposes
all figures through scrolling and anchors. Gallery CSS is independent. Cards,
featured products, OG and fallback cover still use only the primary. Supplied
products show one usable D-11 seller copy or the existing placeholder; explicitly
shared offer photos remain private evaluation media. No supplied gallery controls
or variant/category UI is added.

Legacy removal of the primary retains secondary rows. The editor shows only the
recovery notice and explicit promote/remove controls for those rows; GET/publish
never repairs them. Alt stays optional. 200 × 8 × 1 MiB is 1,677,721,600 bytes of current
photos before cover/logo, replacements, historical and unfinished objects. Existing
purpose and shared tenant retention budgets can refuse earlier; this is not an
entitlement and no collector or quota release is introduced (OPEN-07).

Verification uses exactly `storefront-gallery-{sql,commands,media}.test.ts`, the
original single-photo/appearance/policy regressions, global route/RLS/quarantine /
media bridge guards, ten appended photo-browser cases and two default OFF cases.
Screens cover 390/768/1440, eight photos, keyboard and no JS. The media restore drill
preserves its original 17 objects plus exactly 8 gallery objects; its two gallery
stores include promotion, removal, a deleted product, frozen revisions and stored
pending bytes. The separate tenant drill has nonempty A/B graphs and six captured
objects (two Work/four product photos). Exact-base reader/rendering proof revokes
SELECT on all five gallery tables. The contract generator emits the independent
`storefront-gallery.schema.json`; original contract families remain unchanged.

## Store categories (2026-10-21 local candidate)

Migration183 adds retained `commerce_storefront_categories`,
`commerce_storefront_category_members` and immutable
`commerce_publication_categories`. `FREEDOM_STORE_CATEGORIES_ENABLED` defaults
OFF and independently requires launchpad; it requires neither variants, media
nor checkout. This source activates no environment or deployment. Categories
use existing store:read/write and profile If-Match; publication still requires
store:publish. Names are normalized NFC single-line text of at most 40 Unicode
characters, with at most 30 active categories per store. Empty categories remain
editable and are omitted from publication.

With variants ON, membership resolves exact ProductGroupKeySchema identities.
The surviving original group keeps P0001 after its anchor splits out or is
removed; the detached live anchor is P0001~single. Both are independently
assignable. Rejoin removes the singleton from the effective catalog: its retained
reference becomes inactive, warns without revealing an unavailable title, and is
omitted from publish. Reads do not repair rows. With variants OFF, only exact
SKU singleton keys resolve; suffixed references are inactive and never stripped.
This branch reads no variants metadata or sidecar. The transaction-local SQL
`freedom.category_variants` setting selects the same semantics for activation validation;
it never grants access to a product or another store.

The manager, private preview and publish share the effective catalog and category
snapshot. Publication freezes covered SKUs, so later flag changes do not consult
today's draft to interpret a published category. Missing old sidecars yield an
empty category list; malformed or digest/coverage-invalid rows fail closed.
Category rename, order and membership participate in dirty/dedupe and the reviewed
publication digest (`categories_sha256`); timestamps and row versions do not.
`publication-review` includes `categories_changed` only with categories ON. Both
plain and reviewed publish freeze the same category snapshot after the locked
digest check, using the current variants option to resolve group membership.
A co-owner edit after review returns 409 without publication or receipt writes.
The 商品分類 editor blocks publication for unsaved or pending commands and
reloads the review after saving. See [category design](categories/design.md). A normalized no-op changes no profile/category version.

Buyers follow ordinary no-JS links at `/shops/:slug?category=<uuid>#products`.
Selected categories preserve membership order, show each effective frozen group
once and omit featured products. Empty, removed, unpublished and wrong-store
category identities share the same 404 page; malformed or repeated category
queries return 400. UUIDs are display identities, not authority. Draft changes
remain private until publish; unpublish retains frozen history. Existing public
v1 JSON, cart/checkout terms, asset references, quotas and retention policy are
unchanged. Unknown editor operations retain their original command in
member/session/store-scoped RAM, and late reads cannot overwrite local edits.
