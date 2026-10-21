# Hosted product media extension (#317)

`freedom.hosted-store-media/v1` is an additive strict contract. The existing
storefront/v1 JSON, IDs, text/price digest and registry pins stay unchanged.
A product remains `commerce_items.item_id`; its selection aggregate version is
the only photo CAS. No supplier/private `photo_url`, external URL or storage key
is accepted by the photo DTO, upload route or renderer.

The source connects the closed Asset lifecycle to current exact-store authority,
original command receipts, saved draft pointers and immutable publication refs.
Migration 141 must precede this binary. New metadata cannot be read by an older
binary; rollback needs a compatible reader with upload admission disabled.
All deployment, policy and host activation remain separate explicit actions.

## Reads, commands and publication

`photo-authority.ts` locks current instance/deployment, the existing commerce
community boundary and the mapped profile. The Asset adapter then locks tenant
capacity/media policy before `photo-target.ts` locks item, selection and retained
target. Receipt locks precede domain authorization; ObjectStore I/O holds no SQL
transaction. The separate branded Asset authority does not accept Work grants.

`photo-commands.ts` probes the original request receipt before full decoding or
new-upload admission. New work snapshots at most 2 MiB of original bytes and
passes them to the closed core factory. Upload keeps original source MIME, size,
digest, target, expected version and key for every retry. Receipts store only
completion product/version/changed; the strict ACK separately projects current
media, which may be newer than the completed operation. An empty remove still
requires current authorization/CAS and a receipt; it does not increment version.
Removal works with persistence disabled and never deletes retained assets.

The ACK's completion/current ordering compares the length and lexical order of
the existing bounded canonical decimal `Version` strings. Invalid child fields
therefore remain ordinary `safeParse` failures even when Zod runs the enclosing
cross-field refinement; they are never converted with `BigInt` there (#725).
The positive signed-bigint range and `completed_version <= current.version`
rule are unchanged, including equal versions and decimal-width transitions.
The photo client treats malformed ACK versions as an unconfirmed network result,
retains the original File/key/CAS tuple and requires its explicit retry; it does
not accept an arbitrary 2xx as completion or silently replace that operation.

`photo-projection.ts` reads actual product fields, selection version and typed
ready photo metadata in one statement. Preview uses this same rowset for text
and photos. Publish compares the original content digest, template and separate
canonical media digest. It writes publication plus immutable refs and switches
the existing current-publication pointer in one transaction. Refs survive draft
product removal, which first clears the nullable draft pointer.

Both existing public JSON/HTML and new media routes require current active
instance/deployment/tenant/owner and both confirmed hosted-shop mappings. Ref
queries run only after tenant RLS binding. Their reconstructed canonical digest
must match the immutable publication. Private version paths and public revision
paths recheck the same authority and tuple after full verified object readback.
GET and HEAD both perform verification; no early 304 or borrowed signed URL.
Images use fixed WebP, nosniff and no-store; photo-bearing public HTML is no-store.

## Installation and member behavior

The runtime takes explicit `storePhotoAssetStore`, `storePhotoAssets` and
`storePhotoUploadsEnabled` ports. Absence closes the photo surface. Worker
`FREEDOM_HOSTED_STORE_PHOTOS_ENABLED` installs retained reads and requires the
hosted-store feature plus MEDIA. Independent
`FREEDOM_HOSTED_STORE_PHOTO_UPLOADS_ENABLED` requires that installation and IMAGES.
Both default OFF. Node embedding passes the same explicit ports; the stock Node
server installs no media binding. No committed deployment variables enable them.
Tenant/media SQL policy still independently governs all new retained effects.

Existing saved products offer one photo with small secondary add/replace/remove
controls. Draft save and preview are separate from public publication. Unknown
results retain the original File/body/key/version and block navigation; later
known refusals cannot discard that tuple. A first known CAS conflict refreshes
current state and requires explicit manual review for a new key/version. Fresh
login reads current state without automatically submitting. Full-page close only
warns: this source does not promise durable recovery of a File after reload.

## Evidence boundary

Closed runtime registration includes contract/renderer, UI state and core pure
checks, plus the database/HTTP suite source. The shared fixture uses the existing
registry harness and a real restricted runtime role; its policy is disabled by
default. Native decoding, PostgreSQL, storage races, browser add/replace/remove,
backup/restore and production acceptance require their separately scheduled
runs. Source/type/pure success is not those results. DC-08/catalog and retained
quota registration do not claim export/restore authority or enable photo GC.
Initial broad context `surface_unmapped` remains in the artifact packet; final
context completeness is not a runtime scheduling or execution proof.

## Supplier offer evaluation photos

The default-OFF `FREEDOM_SUPPLY_OFFER_PHOTOS_ENABLED` installs an explicit
supplier share/stop pair and a seller-root `supply-catalog/:offer_id/photo/:seq`
GET/HEAD. [Distribution](distribution.md#opt-in-evaluation-photos-2026-10-20)
defines its audience, product/offer CAS and owner preview query. It introduces
no new storage purpose, upload pipeline, signed URL or publication grant.
只有公開中的版本會顯示方案照片；版本撤回或被新版本取代後，即使店主曾選用該版本，也不再顯示照片。
The existing offer visibility function and an offered-state requirement run in
both authority snapshots;
`readVerifiedObject` runs outside SQL between them, including HEAD. There is no
early 304. Stale sequences and a changed authority/share fail closed.

`commerce_hosted_offer_photos` stores immutable metadata copied from
`asset_objects`, with the same ready-Asset/object composite FKs as publication
refs and the permanent fence guard. Its entire history retains references,
including stopped shares. Future product-photo GC must enumerate this table;
the currently uninstalled GC is not enabled by migration 174. Full backups keep
the table and retained objects together. No deployed activation or restore
acceptance is implied by source registration.

## Store appearance media (local candidate, 2026-10-20)

`freedom.hosted-store-appearance/v1` is a separate strict contract. Migration 175
adds `commerce_storefront_appearance_drafts`,
`commerce_storefront_appearance_targets`, `commerce_publication_appearances` and
`commerce_publication_appearance_refs`. It does not extend or loosen the v1 public
projection, `storefront-presentation` or product-media DTOs. This candidate is not
a deployed flag/policy change.

Cover/logo use closed target kinds `storefront.cover` / `storefront.logo` under
the existing `storefront.product-photo` purpose/profile/transform and image
variant. This implements EC-SPEC-01 §4.2 / EC-SPEC-02 §2's proposed new purposes
as target kinds so older binaries still count and back up these known-purpose
objects. Purpose checks, admission functions, storage policies and object profiles
stay unchanged. Typed intents add one nullable instance target, guarded existing
CHECK branches and an immutable composite FK; old intent branches stay intact.
The two new reference tables join the permanent fence bridge. Product-photo GC
remains uninstalled even with domain-media maintenance opted in.

All appearance writes use `store:manage`, distinctly branded from product-photo
`store:write` authority. Reads require `store:read`; publication remains
`store:publish`. The exact member, tenant, active deployment, mapped retail
profile, current capability and decision clock are rechecked, including original
receipt replay. Reusing a product or tenant-Work authority cannot admit these kinds.

| Method and suffix below `/api/v1/tenants/:tenant_id/storefronts/:instance_id` | Input / result |
| --- | --- |
| `GET /appearance-settings` | Draft, current profile version, eligible own products (≤200), configured order, safe media paths and availability. Private/no-store. |
| `PATCH /appearance-settings` | Strict template/accent/announcement/featured IDs; Idempotency-Key + quoted profile If-Match. Completion + separate current draft. |
| `POST /appearance-media/cover` or `/logo` | Static JPEG/PNG/WebP ≤2 MiB, original key/body/profile CAS. Canonical WebP ≤1 MiB, ≤1920px per side; logo must be square. |
| `POST /appearance-media/cover/remove` or `/logo/remove` | Strict `{}`; same command headers; empty remove is an authorized, receipted no-op. Works with new uploads disabled. |
| `GET` / `HEAD /appearance-media/:role/:version` | Exact current draft profile version, current read authority, verified bytes. |

The browser reuses the existing 20 MB raster preparation pipeline for every
selected image. Metadata and Files remain local until an explicit save. Square
rejection says 「店標請使用正方形圖片。」; no crop tool is installed. Original
HTTP receipt checks precede decoding and new-upload admission. Unknown storage or
HTTP outcomes preserve the exact intent/key/CAS/File; a later refusal cannot
silently erase a previously unknown original. Receipts contain only historical
completion identity/version/changed; ACK.current is read afresh and may be newer.

Profile version is the single CAS. A new empty target records that real current
version; actual attach/remove advances the profile once and records
`last_changed_at_profile_version`. Other profile edits do not rewrite that marker.
Targets, intents, Ready objects and historical refs are retained after replace,
remove or OFF; actual/pending/unknown bytes share both the established tenant
retained budget and product-photo purpose budget. Removal releases no quota.

Private paths send WebP Content-Type, exact Content-Length, nosniff,
`Cache-Control: private, no-store`, `Vary: Cookie`, noindex/nofollow,
no-referrer and same-origin CORP. Public bytes are proxied at
`/shops/:slug/appearance-media/:revision/:role` with no-store, WebP, exact length,
nosniff and noindex/nofollow. Only the current live publication and its exact
frozen role ref authorize reads; old revisions fail closed. Both GET and HEAD
call `readVerifiedObject` outside SQL and recheck authority/identity afterwards.
There is no signed URL, Range/304 shortcut or exposure of object keys/asset IDs.
Quarantine refuses all five appearance writes before effects or receipts.

`FREEDOM_STORE_APPEARANCE_ENABLED` is independent of media installation: non-media
works alone; media routes require `storePhotosInstalled`, and new writes also need
upload admission and the closed port. OFF mounts no new routes and does not query
frozen appearance. Neither setting changes checkout, admissions, payment or
supply behavior. A legacy-shaped binary ignores the sidecar, keeps known-purpose
objects in backups/quotas and can publish a revision without appearance; the new
reader then renders defaults. The actual restore drill seeds a non-empty draft,
both targets, frozen sidecar/refs and two synthetic objects; local results are
separate from deployed restore acceptance and the existing T-047 finding.
