# Hosted supply cooperation

## Opt-in evaluation photos (2026-10-20)

`FREEDOM_SUPPLY_OFFER_PHOTOS_ENABLED` defaults OFF. Installation additionally
requires guild launchpad, supplier console and installed product-photo reads;
material media and new-upload admission are independent. Source changes do not
enable any environment. `/api/v1/site.supply_offer_photos_enabled` reports the
complete installation decision. When absent, commands and seller bytes are
unmounted and both `SupplyOfferPage.photo` and supplier `product.offer_photo`
are null. Seller catalog/selection thumbnails use a separate optional list below;
with the flag OFF the existing text-only markup and requests are unchanged.

Provisional migration `174_supply_offer_photos.sql` adds only
`commerce_hosted_offer_photos`. Its `(offer_id,seq)` history is append-only and
contiguous under the offer row lock. Each share captures the product's current
ready, unfenced photo and immutable object metadata; an all-null photo tuple
records a stop. The supplier binding must match the offer. SELECT permits the
owner or an offer visible through the offers table's own RLS policy; INSERT
requires the owner tenant. Runtime-role tests additionally tighten the offer
policy in a rolled-back disposable transaction and prove the photo subquery
also becomes unreadable. The application never treats this RLS audience as
sufficient route authority.

Under the supplier's own `/tenants/:tenant_id/storefronts/:instance_id`, POST
`/supply-offers/:offer_id/photo/share` requires `store:write` and `store:publish`;
its If-Match is the **product** selection version, including photo edits. POST
`/supply-offers/:offer_id/photo/stop` requires `store:write`; its If-Match is the
**offer** version, and withdrawn offers may be stopped. Both use empty JSON,
the existing command receipts and current authorization before replay. New rows
write `hosted_supply_offer_photo` facts at their sequence. Repeated current
choices are no-ops. The supplier read reports state, sequence and whether the
shared identity is still the current product photo. Explicitly publishing a
replacement offer carries a previous current share decision to the new offer
with the current product photo in the same transaction, skipping a missing photo.
Withdrawal preserves all history; a stopped decision does not revive an older share.

GET/HEAD `/supply-catalog/:offer_id/photo/:seq` belongs to the **seller's** root.
只有公開中的版本會顯示方案照片；版本撤回或被新版本取代後，即使店主曾選用該版本，也不再顯示照片。

It reuses `findVisibleSupplyOffer` with the detail page: current `store:write`,
same community/currency, and offered or already adopted by this store for base
offer authority. Photos additionally require the offered state and current
shared sequence. It snapshots, releases SQL, fully verifies
`readVerifiedObject`, then reauthorizes and compares offer/share identity. HEAD
performs the same verification. Both responses are private/no-store with Cookie
variation, nosniff, noindex, no-referrer and same-origin resource policy. No
supplier tenant, scope, Asset/object ID, stock or private draft enters the DTO,
and no seller connection changes to the supplier tenant.

The supplier preview reuses its own existing product-photo route with the strict
`?offer_id=<offer>&seq=<seq>` query pair. This opt-in branch requires the new flag,
the own live product/version and own currently offered/shared sequence before
and after verification. It can show the retained shared image even after the
current product image is replaced or removed. It grants no cross-store read.
The preview derives intrinsic dimensions from the decoded image; seller image
dimensions come directly from immutable metadata.

Photos are illustrative and excluded from `terms_sha256`, offer versions and
consent. Share/replace/stop changes no selection, approval, stock, reservation or
checkout. Using supplier images in a seller's own store still requires D-11's
explicit material grant and owned copy. All rows pin their supplier Assets for
the offer's lifetime, including stopped and replaced history. Existing backup
capture includes every registered unfenced object. Product-photo GC remains
uninstalled; **every future GC reference count must include this table** before
claiming a fence. Stopping exposure does not delete bytes or release quota.

This increment follows Mini's fixed [supplier/seller direction](supply-terms.md)
and SP-10. Any authorized shop operator can publish its own supply offers or
propose selections from other shops; guild membership does not grant another
tenant's permissions. A member can use both roles, with independent many-to-many
relations. Existing tenant, instance, command, selection and acceptance authority
remain in use.

An explicit supplier action publishes a minimal immutable offer: product text,
currency, supplier price, per-item shipping and shipping/return terms. Private
edits do not publish it. The catalog exposes only explicitly shared offers to
authorized shop writers in the same community and currency. Saving a replacement
offer withdraws the previous version. Historical snapshots remain retained.

Each seller proposes its own price. Its selection references the original item
and one exact offer; it creates no inventory row. The supplier signs that exact
listing digest and version through the existing append-only acceptance table.
Repricing clears active consent; a seller that stops adoption must submit a new
proposal before the supplier can accept again. Seller withdrawal records the
seller's own command rather than forging a supplier acceptance.

Private preview and explicit publication include only currently offered,
accepted selections. Text comes from the agreed snapshot, with a unique SKU from
the seller's existing sequence and the seller's price. Source inventory, supplier
costs, private media, tenant IDs and signatures never enter the public projection.
The original offer increment did not copy supplier photos. Current selected-line
photo adoption uses its separate grant and retention rules. A published page remains immutable;
withdrawal changes the next preview/publication, without rewriting history.

All writes use `storeCommand`, current `store:write`, confirmed own mappings,
instance/community/profile lock order, version CAS and existing receipt handling.
The shared community writer lock serializes proposals, decisions and withdrawal
without acquiring a foreign tenant or instance lock. Publishing an offer additionally
requires `store:publish`, including receipt replay; private editors alone cannot
share costs with other shop operators. No tenant context is rebound
to manufacture supplier membership. SQL constrains the offer/item relationship,
immutable offer bytes and seller/offer identity. The data catalog records the
supplier-owned snapshot and seller-owned selection separately; this is no export
or module portability implementation.

## Seller catalog evaluation thumbnails (2026-10-20)

GET `/api/v1/tenants/:tenant_id/storefronts/:instance_id/supply-catalog-photos`
is mounted only by the existing complete `supplyOfferPhotosInstalled` decision.
It accepts an empty query and returns strict `SupplyCatalogPhotosSchema`:
`{items: [{offer_id, photo: SupplyOfferPhotoSchema}], truncated: boolean}` (at most
100). No existing catalog, own offers, detail or selection response/schema gains
a field. Older strict portal bundles retain their existing responses; newer
bundles treat 404 from an older API as an absent optional route.

One seller-bound `storeRead` requires current `store:write`, the same profile
and readiness checks as `listSupplyOffers(own=false)`. Both reads use the same
query helper: same community, offered state, other instances, same currency,
`offer_id` order, and first 100 of a 101-row probe. Only after choosing that
window does one batch read the latest share per offer, using numeric sequence
ordering and retaining all-null stop rows. Missing/stopped shares are omitted;
`truncated` comes from the catalog probe even when no photo remains. The list
does not extend its window to find more photos or include historical selections.
It exposes only offer IDs and the same seller-root read path, sequence and
intrinsic dimensions as the detail page. Supplier tenant/instance, Asset/scope
IDs, stock, drafts and contact details never leave the server. Existing RLS,
authorization, byte GET/HEAD, object verification and private headers remain in
force; no seller connection changes tenant context.

`HostedDistribution` fetches this projection independently from its text lists,
only for sellers with the flag enabled. A 404 is quiet; other failures show one
quiet hint and the next “更新供貨狀態” retries. Refresh, abort, scope and session
generation fences reject obsolete results. Refresh clears old thumbnails while
preserving the text/form subtree. Failed images disappear quietly. At tablet
and desktop widths a neutral 96px square sits beside the text, with contain
scaling, intrinsic width/height attributes, lazy loading and asynchronous decode;
on narrow screens it sits above. One hint identifies the visible thumbnails as
supplier evaluation photos, outside the supply terms. Own supplier lists are
unchanged. These are the retained evaluation bytes (up to 1920px), with no
separate thumbnail rendition. No new audience, consent, terms digest, schema
change, store-publication grant, drop-ship consent or supplied-line checkout is
introduced.

Runtime coverage: `CATALOG-PHOTO-01` through `07` live in
[`hosted-supply-catalog-photos.test.ts`](../../../tests/runtime/hosted-supply-catalog-photos.test.ts),
including the 101 real offers that prove the shared catalog window. Offer sharing
and byte-route cases remain in
[`hosted-supply-offer-photos.test.ts`](../../../tests/runtime/hosted-supply-offer-photos.test.ts).
Both files register the same isolated harness hooks through one shared test helper.

## Direct and shared reservation boundary

The current `hosted_direct_reservation` profile remains limited to its own supply
shop. It refuses foreign selections even if displayed and accepted. Its SQL guard,
quote checks, stock adapter, financial exclusions and deployment flags remain
unchanged. The later [shared reservation contract](shared-order-contract.md)
defines cross-party reservation authority, shared inventory, cancellation,
withdrawal fencing, expiry and historical release. It retains exact source and
acceptance references and supplier order projections. Neither reservation profile
grants payment or drop-ship fulfilment authority.

Migration 144 introduced the immutable offer model. Current deployed source and
ledger evidence belong to the [Foundation closeout entry](../../../docs/platform-plan/execution/unified-foundation/closeout.md),
not this module's original implementation history. The offer-page increment adds
no migration and does not authorize deployment or claim live acceptance.

The catalog is capped at 100 and participant lists at 200 with explicit truncation.
Cursor continuation remains subsequent work, not hidden
claims of complete ERP integration. The normal merchant journey and module
portability milestones retain their separate acceptance requirements.

## 2026-10-20 supply offer page

`GET /api/v1/tenants/:tenant_id/storefronts/:instance_id/supply-catalog/:offer_id`
requires current `store:write` on the seller's own store, the catalog's community
and currency boundary, and either an offered version or that store's exact
selection of a withdrawn version. It accepts no query parameters and returns
`private, no-store`. The allowlisted response contains the offer, publication
time, supplier name/public path, this product's own selection, latest decision
note and `sale_paths`. Tenant/instance/person identifiers, stock and private
drafts never enter it. The public path is proved by the existing anonymous
store reader, outside the seller transaction; a final seller read reauthorizes
the private response. No seller client changes its tenant binding.

`sale_paths.display` uses the same offered/sellable predicate as exact consent.
Reservation reuses the supplier configuration gate and `sharedLines` exact
consent/publication validation, without locking or reading inventory. Both
stores must enable reservations and the environment must admit them. A public
supplier's existing public reader additionally proves current lifecycle and
confirmed mappings. For a supplier without a readable public storefront those
private lifecycle facts cannot be proved through the seller's existing access
paths: reservation returns `unknown`, rather than rebinding tenant context.
A complete private-supplier availability projection would need separate schema
work and is outside this increment. Final buyer quotes still revalidate all
parties and inventory. `checkout` shares the production quote's own/supplied
fulfilment classifier and consent-failure function; a supplied line currently
returns `fulfilment_not_agreed`. Price approval grants neither drop-ship consent
nor buyer data. Wholesale goods actually purchased and held by the retailer can
be listed separately as that retailer's own stock.

Supplier preview and seller detail render the same browser-only
`SupplyOfferPresentation`. Before publication preview uses saved fields; after
publication it uses the immutable offer. Dates use Asia/Taipei and version labels
use the first eight hex characters of the terms digest. Responsibility labels
are a roles-only projection of the existing reseller arrangement, never its
private person identifiers. Existing `PriceDifference` and command factories
serve both inline selection and the page.

Decision commands accept optional trimmed `reason` (at most 500 characters),
stored in the existing append-only acceptance `note`. The seller sees the latest
decision's nonempty note on both surfaces; a re-proposal retains that historical
note until a new decision. Accepting without a reason stores an empty note.
Reason is part of the existing command body digest: changing it under the same
idempotency key conflicts. No migration, deployment or flag change is included.


## 2026-10-20 structured reference snapshots

An explicitly published offer may carry `msrp_minor` (1–100000000 minor units),
`minimum_order_quantity` (1–10000 items) and `lead_time_days` (0–365 days, with
0 meaning same-day shipping). These optional integers are present only when set;
unset fields are omitted, never `null`. Every current-product hash caller reads
all three columns. This preserves the exact seven historical keys and digest
when unset, unchanged-offer deduplication, and the console's outdated-version
indicator when only a reference changes. Old selections stay on their frozen
version, and all snapshot consumers continue to accept it.

The seller sees shared detail rows and the catalog summary. An explicit
“填入建議售價” button only fills the seller's price input; it never submits or
prefills automatically. [ADR-027](../../../docs/platform-plan/07-decisions-risks-traceability.md)
keeps suggested prices advisory: no comparison is added to supplier price review,
and no price gate, ranking, filtering, reservation or checkout rule uses these
references. The existing public projection and buyer receipt allowlists exclude
all three fields. No new cross-store reader, drop-ship authority or supplied-line
checkout is introduced.
