# Consented profile covers (local customization candidate)

A cover is a new `member.profile-cover` Asset purpose, not an avatar or service
cover. The canonical lifecycle owns prepare/claim/write/finalize, immutable
objects, scoped member receipts, current session clocks and write-effect fencing.
No caller supplies object URLs, keys, asset IDs, policies or ownership.

Uploads are staged immutable owner versions. Uploading or cancelling an editor
never changes the selected publication. Publication save locks the cover target
and selected ready version before its publication CAS; `include_cover` is false
by default and consent binds an exact `cover_version`. Existing public images
remain unchanged until Save. Removal refuses any selected version; deselection
is a separate explicit publication save. Upload refuses three existing unselected drafts. A later explicit deselection
can leave four unselected versions; owner metadata exposes all four for cleanup.
The total retained live-version window is at most four (selected plus drafts).
All pending, ready and retired objects remain charged to the operator-approved
retained-byte quota. There is no guessed quota or physical-erasure promise.

Input is static PNG/JPEG/WebP, at most 4 MiB, 4096 per dimension / 16,777,216
pixels. The installed request decoder fully decodes, orients, strips metadata
and produces fixed 1600×600 canonical WebP at most 512 KiB. Missing decoder or
object storage refuses upload. Storage independently checks output dimensions.
The policy row starts legacy/persistence-disabled with no revision/quota; legacy
here means unavailable, never fallback to arbitrary original bytes. Activation
requires separately authorized, tested operator policy and storage configuration.

Owner preview requires a fresh owner session. Member bytes reuse the exact
canonical profile predicate, community/readiness/block rules and session clock;
public bytes always use anonymous authority and never cookies. Both visitor
routes require exact version plus publication generation and explicit consent.
Each read checks the same SQL authority before and after one verified object GET.
Changed generation, consent, owner status, member/session/block, object identity
or retirement rejects the response; no lock spans object I/O, no ETag/304 shortcut,
and Range does not produce an unchecked partial body. All responses are no-store.
Already downloaded bytes cannot be recalled, and public means signed-out people
can read; blocking a signed-in member is not a secrecy guarantee for public mode.

## Integration

Mount `createProfileCoverRoutes` after existing session/Origin/CSRF middleware.
Mount only `createPublicProfileCoverRoutes` on the anonymous public composition.
The platform binary body gate must recognize `isProfileCoverUpload` and apply
`checkProfileCoverHeaders` before accumulation; do not route it through JSON.
The existing client transport should preserve same-file/key/CAS on unknown retry.
Do not put object identifiers in profile DTOs: project only `cover.version` and
`cover.generation` under the canonical text profile ACL in the same SQL statement.

The reviewed SQL proposal is consolidated in local migration
`192_member_profile_customization.sql`, following profile publication191. Exact installed CHECK predicates and fixed-search-path functions
are extended, not replaced by older snapshots. Existing closed GC admission
continues to reject this purpose: retired versions remain retained and charged.
Physical cleanup requires a separate reviewed reference/backup/write-effect
protocol and authority. This code does not activate deployment or configuration.

Pure tests use structural raster fixtures and mocked SQL/ObjectStore boundaries;
they do not prove decoding, database constraints, concurrency or native browser
behaviour. DB/native test source must run on the integrated schema in hosted CI
before any release claim. Account-level community certification is separate and
does not mean every cover, bio or external link has administrator approval.
