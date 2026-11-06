# Private native game source quarantine candidate

This source-only increment adds authenticated owner APIs, not a playable community
hosting service. Migration 203 is provisional until integration; no migration,
policy, cloud binding, grant, reviewer role, deployment or cleanup is activated.

POST /api/v1/me/game-drafts creates a private title/description draft. GET of its
UUID reads only that owner's metadata and a point-in-time upload availability.
POST /source accepts exact text/html, one UTF-8 file, at most 256 KiB. POST
/withdraw accepts an empty JSON object. All writes use existing same-origin,
member session and CSRF middleware plus Idempotency-Key; source/withdraw require
If-Match. Onboarding, current user/session/principal/personal scope, ownership and
community are checked again inside canonical transactions, including replay.
There is no collection/public metadata endpoint and no source-byte GET endpoint.
The initial metadata receipt supplies the ID for cold owner reads. UI is not wired.

The source reader has a 15-second absolute transport deadline and disconnect
cancellation. It never parses, executes, sanitizes or fetches HTML dependencies.
The domain reuses validateGameUploadSource, snapshots bytes and derives digest,
size and source identity. That helper remains unreviewed/not_stored. Only the
closed member.game-source lifecycle profile prepares storage metadata, with
application/octet-stream and member.game-source.utf8-quarantine.v1. Existing
private-text MIME allowances do not change. Generic legacy preparation rejects
this new profile; original game bytes are not a normalized safe document.

The shared lifecycle owns current member authority, quota serialization, bounded
prepare/claim/write/finalize, lease and fence, immutable PUT effect ledger and
verified readback outside row locks. SQL metadata/purpose/target constraints,
ready reference fences and deferred same-transaction finalization backstop the
adapter. The game aggregate_version is the only CAS; source_revision increments
only for a committed immutable source revision. No game asset ID, object key,
bucket, policy, lease token, raw source or digest enters the public DTO or game-domain journal.
The private game command receipt digest binds source digest, exact bytes and expected version.
Existing internal lifecycle prepare/claim receipts still retain Asset identifiers
and lease correlation nonces for canonical recovery, and internal lifecycle facts
retain their established Asset metadata. None is returned by this game API.
A successful historical upload receipt does not restore its source as current.

Quarantine publication means only committing a private source revision; it is
not approval or public publication. Replacing a source retains all prior revisions.
Withdraw is irreversible in this slice, stops new uploads, and retains private
metadata, source history and conservative quota charges. It requires no storage
availability or new-upload policy. Session/account/scope revocation rejects
metadata reads, command replay and remaining upload phases. There is no physical
erasure, deletion/GC admission, quota reclamation or automatic review transition.

Default canonical policy is legacy/false/null/null, which means unavailable, not
legacy byte fallback. Only r2_only, explicit persistence permission, a valid
revision and at least 256 KiB retained quota can admit saving. Missing ObjectStore
also fails closed. Worker composition only reuses an already-installed private
MEDIA transport; this does not enable that policy. No GUIDE_STATIC/public bucket,
public URL, generic asset-serving route or browser execution is introduced.
Owner metadata drafts are capped at 100 retained records; upload rate and pending
intent limits apply in addition to retained-byte capacity.

Tenant-data catalog entries describe physical FK coverage, not tenant permissions.
New-purpose GC remains excluded. Real PostgreSQL race/constraint tests, runtime
role grants, Worker/R2 backup/restore, trusted CI and rollout evidence remain
separate gates. This source cannot establish cloud readiness from mock tests.

Still unfinished: reviewer authority and exact-revision decisions, licensing
consent for publication, isolated-origin execution with network/CPU limits,
moderation and public delivery/revocation, member upload UI and end-to-end human
acceptance. Never present stored or ready Asset state as reviewed, safe or playable.

## Local candidate evidence, 2026-11-06

- Executed 31 Node static-schema, migration-planner and exact-ledger compatibility
  tests across game-quarantine-schema, migration-plan, profile-publication-schema,
  community-certification-schema and event-missions-schema: 31 passed, zero skips.
  These do not execute PostgreSQL or prove SQL constraints.
- module-check passed with the same three existing unrelated unmapped surfaces;
  git diff --check passed. Thirteen changed/new TypeScript files passed Node24
  syntax transformation. Initial strip-only syntax attempt rejected an existing
  TypeScript parameter property; transform mode completed. Neither is typecheck.
- Semantic typecheck invocation failed before checking code: local TypeScript is
  absent. Both focused runtime test processes failed at startup because tsx is
  absent (zero test bodies ran). Dependencies were not installed or bypassed.
- SQL/lifecycle and transport tests are authored but unexecuted. They cover owner
  and expired-session rejection, cold metadata, exact replay/source mismatch,
  immutable revisions, current CAS, withdraw during PUT, unknown PUT evidence,
  conservative retention, existing avatar read refusal, and live catalog coverage.
  runtime.full discovers both new direct test files through its existing registry.
- Full runtime, PostgreSQL schema/races, production build, HTTP member-middleware
  integration, browser/E2E, Worker/R2, runtime-role permissions, cloud backup/restore,
  actual migration and deployment are not_run. No full-suite or readiness claim.
- Read-only independent source review found no definite blocking auth/storage/SQL
  defect; it is not an independent CI receipt or maintainer approval. The prohibited
  tenant-data-catalog test remains byte-identical and its required checks remain.
