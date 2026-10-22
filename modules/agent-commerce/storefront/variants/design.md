# Own product variants

`FREEDOM_STORE_VARIANTS_ENABLED` defaults OFF and requires guild launchpad. It
needs neither media nor checkout. Supply selections remain independent products;
a future mixed-group slice must preserve each accepted offer, exact consent,
selection price and item inventory authority. It must not add a layer below item.

## Identity and retained gallery homes

Migration 181 extends the lazy 177 group/member rows without a backfill. An
unedited product remains an implicit singleton. Each member keeps its immutable
original gallery `group_id`, product, selection, tenant, instance and scope.
`catalog_group_id` is the separate pointer to the current catalog group. It never
moves a photo or changes an Asset reference.

An explicit catalog group has the stable key of its original anchor SKU. Its row
and key survive splitting out or deleting that anchor. A detached live anchor has
management key `P0001~single` while the retained original group still has members.
It cannot anchor another group, but can rejoin its original group or join another
explicit group as a member. Buyer URLs always use actual SKUs, never this suffix.
An empty catalog group becomes dormant; its retained routing is not deleted.

The default is a current member. Removal re-derives it from remaining saved member
order, retaining the group key. Title and description initially copy the anchor.
Grouping does not overwrite the underlying item titles or descriptions. Splitting
restores their own presentation. Price, stock, holds, allocations and order lines
remain attached to their existing selections/items.

Combination and member-order uniqueness are nondeferrable. PostgreSQL rejects
177's unchanged targetless `ON CONFLICT DO NOTHING` if this table has any deferred
UNIQUE arbiter. Replacement therefore detaches old pairs, updates group metadata,
then attaches new pairs atomically. Immediate tuple checks and deferred group/
default checks preserve the invariants without rescanning all 200 members after
each unrelated tuple change. Original trigger function hashes and attachments are
pinned to the installed schema-180 predecessor before replacement.

## Publication, buyer labels and rollback

The immutable variants sidecar partitions the frozen v1 publication SKUs. Its
canonical digest is the seventh publication dirty/dedupe dimension. A missing
sidecar synthesizes singleton groups from that publication. An invalid shape,
coverage or digest fails closed. Today's draft never repairs an old publication.
The public v1 projection and its JSON endpoint are unchanged.

The group's default SKU supplies its shared gallery and card photo. Other SKU
photos stay retained and regain their own presentation after a split. Per-variant
representative photos are the separate follow-up F-V02.

A member label is `group title（value／value）`, limited to the existing checkout
120 UTF-16-unit title bound without truncation. B03 uses group text and the selected
label. The optional checkout label port runs after the existing raw title, price
and consent checks, then freezes the label into the existing terms item title.
Legacy v1 reservation quotes and placements always keep raw item titles. Placed
orders keep frozen labels. Unplaced checkouts across a flag/binary rollback fail
safely with `terms_changed` and require a fresh checkout.

OFF installs no new handler, reads no variants metadata or sidecar, and injects no
variants browser asset. The conventional site boolean remains present. Older
binaries ignore the additive data, retain the 177 insertion behavior, and can
publish without a sidecar.

## Public rendering and editor commands

Every option is a server-rendered link to an existing tuple's SKU. The first axis
can select a compatible sellable tuple; the second offers only tuples under the
current first-axis value. Sold-out links remain browsable but have no purchase
control. Availability is read only after `purchase.open`; closed pages retain the
original reservation action and perform no inventory query. Open pages use bulk
raw validation/inventory reads and recheck current publication/liveness.

The optional script disables old purchase controls, replaces history and reloads
from the server. It restores keyboard focus and announces the new selection and
price/status. It does not rebind the legacy cart application in place.

The five private handlers use existing store read/write authority, group If-Match
and storefront-targeted command receipts. Receipts retain completion metadata;
replay reauthorizes and reads the current draft. The current reply, final authorization
and a newly created receipt share the mutation transaction, so a known reply
rejection cannot leave the new write committed. Compound creation reuses canonical
product SQL inside the same command and transaction. Unknown editor results retain
the original body, key and expected version in member/store-scoped browser memory.
Only the exact flagged group-replacement PUT has the 128 KiB body allowance.

A predecessor may delete a canonical product while leaving its retained catalog
membership behind. Draft reads omit missing selections and derive a surviving
default. Gallery-only group updates retain all 177 routing/version checks and
skip unrelated catalog validation. The next actual catalog change detaches the
retained tuples before validating and attaching the current members. This keeps
legacy photo editing usable after a rollback without relaxing catalog writes.

## Reviewed publication

The saved variants snapshot participates in `publicationChanges`,
`publicationDirty` and the reviewed digest as `variants_sha256`. The private
review includes `variants_changed` only with the variants flag ON. Both publish
commands freeze the same checked dimensions object; a later group/member/default
change requires a fresh visible review and explicit publish. OFF omits both new
fields and preserves the original publication review bytes/digest inputs.

Review photos follow the frozen group's `gallery_sku`, once per shared gallery;
other members' retained photos are not presented as buyer-visible images. The
review still lists all v1 SKUs; it does not add a variant picker to that list.
The owner editor keeps publication blocked for local drafts and pending/unknown
commands, and its saved callback reloads the publication review.
