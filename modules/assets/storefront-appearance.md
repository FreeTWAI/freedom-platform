# Closed storefront cover and logo media

Local candidate, migration 175; every appearance flag defaults OFF. No production
policy, admission, profile, storage binding, environment flag or GC is enabled.

`storefront.cover` and `storefront.logo` are closed target kinds of the existing
`storefront.product-photo` purpose, profile and `storefront.product-photo.webp.v1`
transform, with variant `image`. They implement the proposed separate purposes in
EC-SPEC-01 §4.2 and EC-SPEC-02 §2 without extending purpose/admission/policy/profile
baselines. Older binaries recognize, count and back up these objects. They ignore
appearance tables when serving/publishing, and product-photo GC remains closed.

The dedicated non-copyable lifecycle authority requires current `store:manage`,
not the product-photo writer authority or tenant Work authority. The HTTP facade
and every engine phase prove current member/session, tenant, instance/deployment,
confirmed retail mappings and capability. The fixed profile/policy/target order
remains inside SQL; decode and ObjectStore I/O remain outside transactions.
No upload JSON can supply a profile, purpose, SQL port or verification evidence.

The closed factory snapshots ≤2 MiB of static JPEG/PNG/WebP, uses the canonical
product-photo decoder/metadata stripping and produces WebP ≤1 MiB within
1920×1920 without enlargement. Logo output must be square, otherwise
「店標請使用正方形圖片。」. The editor always uses the existing device raster
pipeline (original ≤20 MB, bounded WebP with existing PNG fallback), preserves
aspect/transparency, previews the whole image and requires explicit save.
There is no crop, SVG upload, arbitrary URL or separate OG upload.

Appearance intents route through nullable `target_appearance_id=target_instance_id`
and the closed kind, FK-bound to the retained tenant/scope/instance target. The
single CAS is the storefront profile version. Initial empty target markers use
that real version; actual attach/remove advances it once and updates only
`last_changed_at_profile_version`. Metadata edits and publish may advance profile
version without changing this pointer marker. Receipt completion and a fresh
current draft remain separate, allowing an original retry to return newer state.
A previously unknown original cannot acquire a new key or lose its File merely
because a later request is refused.

New uploads need the appearance flag, existing photo installation/upload gates,
the explicit closed lifecycle port and canonical persistence/capacity policy.
Stored bytes charge actual size; pending work reserves the established 1 MiB.
Product, cover, logo, replaced, removed and unknown objects all share the existing
purpose and tenant retained budgets. Replace/remove does not retire or delete
objects, and duplicate frozen refs do not multiply their storage charge.

Draft targets and publication refs have ready-Asset/object composite FKs,
permanent fence references and tenant RLS. Publication sidecars and refs are
immutable, contain only allowlisted metadata and join the appearance digest.
They add no required parent-publication field. A no-sidecar legacy publication
renders defaults; OFF ignores retained appearance without changing data.

Private reads use exact current profile versions and store:read. Public reads
require the current publication revision and its frozen role ref after all
existing store visibility proofs. Both GET and HEAD verify full bytes with
`readVerifiedObject` and revalidate current authority/identity after I/O.
Proxied WebP uses exact Content-Length, nosniff and no-store; private paths add
Vary Cookie, same-origin CORP and no-referrer. Object keys and asset IDs never
enter the public paths. See the [HTTP/media contract](../agent-commerce/hosted/media-contract.md#store-appearance-media-local-candidate-2026-10-20).

Backup capture already includes known-purpose Assets. Restore includes draft,
both targets, immutable sidecar/refs and matching synthetic object bytes under
canonical restored grants. The official local PG18/native-R2 drill is separate
from hosted CI, operator acceptance, T-047 revocation recovery and actual rollout.
Retention stays policy_undecided; no export authority, purge, TTL or GC is added.
