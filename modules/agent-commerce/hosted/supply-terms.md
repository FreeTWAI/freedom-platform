# Hosted supplier preparation

This slice saves private supplier terms on an existing hosted product. Mini's
[original direction](https://github.com/arumwu/freedom-platform/blob/c2237d735a92fbd9c9dd6e60165b472c89f0d0b7/docs/development/supplier-retail-pricing.md)
keeps supplier cost separate from each seller's retail price. The
[ERP module reference](https://github.com/mars-tw/freedom-erp-crm/blob/439e376fcc34c22ddba55e5ac736285d42971530/docs/templates.md)
informs inventory visibility and resumable work; its simulation is not a second
platform stock or payment authority. Cross-module follow-on stays under
[SP-10](../../../docs/platform-plan/execution/guild-launchpad/SP-10-domain-upstream-integration.md).

`GET/PATCH /tenants/:tenant_id/storefronts/:instance_id/products/:product_id/supply-terms`
requires the current member session and `store:write` on that exact instance.
Both the supplier shop and own retail selection must retain confirmed tenant
mappings. Readers with only `store:read` cannot read costs through this extension.
PATCH uses the existing product version, idempotency key, tenant command,
instance/community/profile lock ordering and current authorization before replay.
Private responses are `private, no-store`; receipts are scoped to the tenant and
actor. Journal payloads contain only the product ID and version.

The existing `commerce_items.price_minor` stores supply cost; shipping amount and
terms use the existing item columns. `commerce_selections.retail_price_minor`
remains the seller's price. Product creation initializes both prices as before;
subsequent retail edits cannot overwrite supply cost. The own selection version
serializes both editors. The original preparation introduced no migration, item,
stock balance or receipt system; the structured-reference increment below adds
nullable item columns. Available quantity is `stock - reserved`, from existing inventory;
this form cannot write stock or clear reservations.

The additive contract leaves the pinned storefront/v1 DTO and publication
allowlist unchanged. Saving supplier terms neither changes the public price nor
publishes private costs or shipping/return terms. Existing quotes retain their
immutable terms and product-version fences.

This is preparation, not an offer publication or distribution acceptance. The
UI says so; no supplier qualification, cross-tenant access, payment, automatic
fulfilment or agreement is created. An unmanaged legacy foreign selection still blocks this editor. Hosted foreign
selections reference immutable offers, so editing this private draft leaves their
accepted terms unchanged; explicitly publishing a replacement retires the old offer.

The [hosted distribution increment](distribution.md) implements independent
many-to-many proposals and fixed-version supplier decisions. Shared reservation
stock and per-supplier order visibility are still required next. It must reuse existing selections,
acceptances and transfers while adding explicit cross-party authorization;
removing the legacy `origin='imported'` filter is insufficient. The current direct
reservation profile must not be used to accept foreign supply without that work.

## Supply-only catalogs (schema164)

The supplier guild enters `#stores/supply`, then a private supply catalog on the
existing hosted-store instance. `POST .../supply-profile` accepts only name,
currency and optional description. It reuses an existing profile without changing
its IDs, retail publication or inventory. A new profile has a null slug: no public
URL, template selection or retail activation is required. Both technical shop
mappings remain so the existing offer, consent, order and stock authorities apply.

`GET .../supply-profile` exposes metadata under `store:read`; the cost-bearing
`GET/POST/PATCH .../supply-products` requires `store:write`. Setup requires
`store:manage`. Offer publication continues to require the existing publish
capability. Existing formal membership, tenant status, instance status, current
capability checks before replay, CSRF, idempotency and version fences remain.

New supply products use the existing inventory item and own selection, with
`own_retail_enabled=false`. Retail product lists and publication projections
exclude those selections. Editing supply cost never changes an existing retail
price. Historical own retail selections default to true. A null-slug profile is
excluded from `/me/stores` and rejected by retail setup/update, appearance,
preview, publication and retailer-proposal entry points. `/me/supply-catalogs`
includes reusable existing profiles. Retail activation is deliberately not an
operation in this increment; a future explicit upgrade must retain IDs and
require per-product retail opt-in before publishing any supplier placeholder.

Publish a supply offer, have a separate retailer propose its retail terms, and
let the supplier accept the exact version. Accepted offers, shared reservations,
held stock and supplier orders use the existing immutable snapshots and durable
holds. Reservation admission still requires the existing owner opt-ins; creating
a catalog grants no checkout, payment or fulfilment authority. The supply catalog exposes that setting only after the existing owner-authorized
read succeeds; an administrator's setup capability does not grant it. The control
uses the existing versioned command, retains the exact key on unknown outcomes,
and blocks navigation until those outcomes are resolved. Admission OFF prevents
opening new reservations but still permits stopping admission and reading retained
supplier orders. The supplier-order entry is gated by its own authorized read,
shows only the original supplier projection, and returns to the supply catalog
without requiring retail activation or granting seller cancellation authority.

Migration164 changes only forward schema. Full database backups/restores must
retain null slugs, `own_retail_enabled`, both shop mappings, items, selection
versions, offers, consents and holds together. The existing whole-database backup
and module data catalog cover these fields; a retail-only CSV is not a restore.
Every active/candidate reader and writer requires
`commerce.hosted-supply-catalog.v1` at schema164, even when admission is disabled.
Do not roll back to an older binary that assumes every profile is a public store.

New supply setup/create/update commands follow the private Work command pattern:
receipts and HTTP command responses contain only instance/product IDs, version
and (for setup) the created flag. They contain no name, description, cost, URL or
raw input. The request contributes only its existing command digest. Exact-key
retries return the original metadata receipt after current authorization, even
when the resource has subsequently changed; effects are not repeated. The UI
then calls the separately authorized metadata/product GET for current content.
These GETs do not pretend to be the original command snapshot. Existing retail,
supply-terms and offer receipt shapes are preserved as legacy contracts.


## 2026-10-20 structured supply references

The private terms editor and supplier-console product detail return all three
keys, using `null` when the supplier has not provided a value:

| Field | Meaning | Inclusive integer bounds |
| --- | --- | --- |
| `msrp_minor` | Advisory retail price per item, in the offer currency's minor units | 1–100000000 |
| `minimum_order_quantity` | Supplier's stated minimum items per shop order | 1–10000 |
| `lead_time_days` | Days from receiving the order to shipping; 0 means the same day | 0–365 |

The existing `PATCH …/products/:id/supply-terms` accepts each new key as optional
and nullable: omission preserves its stored value, `null` clears it, and an
integer sets it. Older clients that omit these fields cannot clear them. Both
editors submit only changed reference fields; an empty input explicitly sends
`null`. The update shares the existing statement, transaction, product CAS,
version increment, fact and receipt/replay rules. Changing only one reference
outdates the currently offered terms until the supplier explicitly republishes.

Offer snapshots instead omit unset reference keys entirely and never contain
`null` for them. `terms_sha256` hashes the sorted-key JSON through the historical
`digest`, and both publish deduplication and `matches_current_terms` depend on
that same function. The seven-key pre-change object therefore remains byte-for-
byte equivalent when all references are unset; unchanged republishing reuses the
same offer. Existing selections retain their original immutable version.

Under [ADR-027](../../../docs/platform-plan/07-decisions-risks-traceability.md),
MSRP is information only: there is no price gate, ranking, filtering or suggested
price comparison in supplier review. A seller may propose either a lower or a
higher price. The supplier editor's below-cost note does not prevent saving.
Minimum order and lead time are also informational; they change no reservation,
quantity, availability, checkout or fulfilment decision. These private references
are shared only through the existing community offer and own-selection reads;
the public storefront, buyer APIs and buyer receipts use their existing explicit
allowlists and never include them. They grant no drop-ship consent or supplied-
line checkout. Formal resale-price arrangements still need professional review.

## Private occupied-stock breakdown

The live own-product terms GET adds the optional merchant `inventory` observation
from the authorized item statement. It shows 庫存／已占用／可售 and the held/allocated
breakdown. 可售 and the supplier console's 可用 are the same available quantity.
Missing legacy observations and inconsistent ledgers show unavailable dependent
counts, with a local refresh that preserves the terms draft. PATCH receipts keep
their existing shape and are followed by a fresh read. Supplier offer terms,
retailer catalog projections and published storefront bytes do not gain private
stock data. This read grants no drop-ship consent or buyer-recipient access.
