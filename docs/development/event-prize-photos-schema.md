# Event prize photo persistence contract

Migration 201 is an authored source candidate. It is not a migration execution,
policy activation, deployment or PostgreSQL acceptance receipt. Migration 199's
strict seven-field `prize_details` JSON stays unchanged. Photos are separate
server-owned records, not client-supplied URLs or Asset identifiers.

## Identity and write order

`community_event_prize_photo_targets.target_id` is an internal server-created
UUID. The application uses its fixed UUID namespace and `(event_id, prize_id)`
tuple; external clients never choose a target ID. The database separately
requires unique `(event_id, prize_id)`, immutable target/event/prize/community/
scope/principal/user/creation identity, and the exact event organizer, community
scope and principal/user foreign keys. Targets start empty and cannot be deleted,
including after a prize is removed. This deliberately retains the owning event
and organizer identity through restrictive FKs; it does not add event deletion.

`asset_id` and `linked_at_version` are both NULL or both present. A present pointer
must reference an unfenced ready Asset with exactly the same scope, owner and
`community.event-prize-photo` purpose. `linked_at_version` is a safe integer from
2 through 9007199254740991, copied from the event version produced by attachment.
It is not a second CAS. Later text edits do not rewrite it.

An upload intent names `target_prize_photo_id` and `target_community_id`; the
required `target_user_id` binds the organizer. Their composite FK also binds
scope and principal. Every other optional target ID, orientation and display
name must be NULL. Expected event versions are 1 through 9007199254740990. Existing
intent identity guards remain, plus an immutable prize-photo target guard.

The application locks event, target, intent and UUID-sorted new/old Assets before
its final policy/session/clock decision. For replacement, in one transaction:

1. Mark the exact stored upload's Asset ready.
2. CAS the event from expected version to expected + 1.
3. Assign the pointer and that event version.
4. Retire the old Asset, if any.
5. Finalize the same upload intent and append the domain fact and receipt.

The pointer trigger requires the saved prize still exists, the event is pending
and has not started according to the database clock, the exact stored intent
binds that target and expected version, the lease is live, and current persistence
policy/revision admits it. The trigger holds the exact intent, UUID-sorted new/old
Assets and canonical policy row before its final database-clock check; normal
engine callers already own these locks. Deferred constraints require the exact intent finalized
and any detached previous Asset retired by COMMIT. These backstops supplement,
not replace, current-member/session/guild authority, quota, receipt and object
verification in the shared lifecycle engine. SQL owner-level DDL/TRUNCATE is not
a supported runtime authorization boundary.

For explicit removal, the application CASes the event, clears both pointer
columns and retires the old Asset in the same transaction, whether the event CAS occurs before or after detachment. Stopping uploads does
not block removal. For a text edit that removes prizes, prelock the affected
Assets, clear their pointers and retire them **before** writing the new prize
JSON and event CAS. An old writer that removes a still-attached prize is rejected.
The event row lock serializes prize deletion with new attachment. Reordering or
renaming the same stable prize ID retains its photo; removing then re-adding that
ID reuses the empty retained target, never resurrects the old retired Asset.

## Closed profile and inactive policy

- Purpose/profile: `community.event-prize-photo`.
- Variant: `photo`; transform: `community.event-prize-photo.webp.v1`.
- Input: static PNG/JPEG/WebP, at most 2 MiB; native decoder bounds are 4096 on
  either side and 16,777,216 pixels.
- Output: canonical metadata-free WebP, at most 1 MiB, positive width and height
  at most 1920. Application processing fits inside 1920 × 1920 without upscaling.
- Initial policy: `legacy`, persistence false, revision and retained limit NULL.
  There are no legacy prize-photo bytes. This default means unavailable.

The migration reads validated installed CHECK predicates and adds only this
purpose, preserving newer gallery/appearance/cover clauses. It extends exactly
one expected admission-list suffix in the installed floor and object-write-effect
functions, retaining their bodies, search paths and existing safety branches.
Unexpected installed function text aborts rather than accepting a broad rewrite.
No release capability, GC purpose, retention duration, credential, permission,
flag or storage binding changes. Retired and unknown-write Assets stay retained
and charged. Physical deletion requires separate reviewed admission.

## Evidence boundaries

The focused `deploy/cloudflare/test/event-prize-photo-schema.test.mjs` checks
source shape only. Migration-plan and release-compatibility tests exercise pure
catalog/ledger logic, including exact schema201 approval, rejecting old approvals,
mutated/renamed/future files, and unchanged required capabilities.

`tests/runtime/event-prize-photo-schema.test.ts` is authored real-PostgreSQL
coverage. It requires an explicit local `fp_*` TEST_DATABASE_URL and creates its
own isolated schema. It covers cold SQL reads, replacement/removal, strict JSON,
immutable and cross-owner identity, stored/finalized and retirement atomicity,
old-writer deletion rejection, real lock-wait ordering, inactive/revised policy,
missing objects, retained-byte/GC boundaries, and schema200 upgrade preservation.
It does not use mock database responses. It has **not run** in this task. Its
synthetic object metadata is not native decoding, verified object I/O, malware
scanning, HTTP authorization or end-to-end UI evidence. Those remain the separate
runtime/native/browser acceptance work of the full feature.

`tests/runtime/event-prize-photo-db.test.ts` separately calls the actual
`mutateEventPrizePhoto`, member/public readers and `updateEvent`, with native
sharp and a fake external object store. It covers cold-pool bytes, historical
ACKs after replacement/removal/publication, current authority before replay,
atomic text deletion, unknown PUT retention, two-snapshot revocation and actual
blocking-PID concurrency/expiry. It is also **authored, not run**. The SQL-only
suite is not substituted for this application-lifecycle acceptance.
