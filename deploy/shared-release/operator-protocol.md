# Portable operator integration contract

This contract is not an installed operator. There is no production image in this
PR. Keep both environments disabled until the port and real staging evidence
exist. Do not implement a receipt-only adapter or copy personal-host credentials
into the image. This file is part of the reviewed controller surface.

## Invocation and ownership

The image must be public, independently reviewed and pinned by digest. Its fixed
entrypoint is `/usr/local/bin/freedom-release`; arguments are only `--request`,
`--config`, `--credentials`, `--result`, followed by fixed paths in `/release`.
It runs as UID/GID 1001, no Linux capabilities, no Docker socket, a read-only root,
read-only source/input mounts, a 2 GiB tmpfs, a private output directory and
a private disk-backed `/release/work` mount. PostgreSQL restore data and mutation
intents require the disk mount, never tmpfs. The controller deletes the work
directory only after confirming the container has stopped.
Install Node, the approved PostgreSQL client/server, Wrangler and the static
operator import closure into the image. Temporary isolated restore services must
run unprivileged inside this owned container, not against a live database.

`request.json` binds repository ID, application SHA/tree, controller SHA, target,
original/triggering actors, run ID/attempt, observed main SHA, exact-source Verify
and CodeQL runs, admission time, operator digest, config digest and required phases.
The result binds the SHA-256 of the **exact request file bytes**. The image must
check the clean source SHA/tree before loading any application tools or migrations.

`credentials.json` supplies `cloudflareApiToken`, `migrationDatabaseUrl` and
`backupDatabaseUrl`; staging also requires `stagingAccessClientId` and
`stagingAccessClientSecret`. Preserve whole-host Access. Send those service
headers only to the fixed staging health origin, never to a redirected endpoint
or the Cloudflare management API. It never supplies a GitHub PAT or the job token. Credentials
are environment-specific service credentials. Provider responses, diagnostics,
source media, backups and credentials stay private. The image must not write them
to `result.json`; the controller discards raw process output.

`config.json` has format `freedom.shared-release-config/v1` and the exact `target`.
The port must define and validate the remaining environment-specific configuration:
Cloudflare account/Worker/bucket identities, expected database/role/TLS identities,
public health origin, existing flags/bindings to preserve, approved migration
profile, externally retained rollback floor, object material policy and backup
schedule ownership. No configuration may select arbitrary executable code.
Those required fields cannot be finalized by guessing at the private operator's
resource bindings. The controller pins the full config bytes but intentionally
does not pretend to validate that currently unimplemented provider schema.

## Existing behavior the port must retain

| Phase | Required actual work before reporting success |
| --- | --- |
| `preflight` | Read actual Worker/source and DB identities; compare retained rollback floor and complete ledger, preserve existing flags/secrets/bindings, acquire the same DB backup/release lease as scheduled and legacy operators, maintain heartbeat throughout |
| `backup-before` | Capture the previously deployed release using the existing exported DB snapshot, maintenance pins and object evidence; immutable offsite archive, full readback; isolated DB/object restore and floor/policy checks; cleanup and GC-off readback |
| `migration` | Use the reviewed installed migration runner and exact catalog; expected DB/role/schema checks; preserve transactional migrations plus runtime grants, final ledger checks and explicit commit outcome; observe an uncertain commit instead of rerunning |
| `deploy` | Build/package only the selected reviewed source using pinned tools; preserve current bindings/flags/secrets; invoke Cloudflare deployment once and retain provider confirmation |
| `health` | Read the actual public health endpoint and schema evidence, verify exact release SHA and approved smoke observations; HTTP 200 alone is insufficient |
| `backup-after` | Capture and offsite-readback the new source/schema, then restore DB and objects in owned isolated services, retain floor/material-policy/quarantine checks, cleanup |
| `handoff` | Advance the external retained floor at the approved point, confirm scheduled backup ownership still works, settle all owned temporary resources and maintenance pins, release the lease |

Use the existing daily backup pipeline's source/object/restore semantics, not only
`pg_dump`. Do not change application feature flags during this infrastructure port.
Only owner-recorded feature decisions authorize flag values; Environment config
does not independently approve a new flag. Mutation is attempted once: provider
deployment-list and edge-health propagation use bounded reads, preserving every
observation, including an initial stale result. Never re-deploy because an early
read still shows the predecessor. Measure the actual hosted-runner/database-region
dump time before approving its bounded budget; the current 180-second cap is not
established by synthetic local tests. A timeout or terminating signal fails even
when a subprocess returns zero.
Do not switch the still-unapproved live migration profile to DAG. A one-shot
Actions run does not replace or prove the natural backup scheduler. Coordinate
with its existing owner; do not stop a systemd timer without a verified successor.
Before starting/restoring a Persistent timer, determine whether a scheduled time
was missed while paused. An immediate legitimate catch-up run must be reconciled
with the retained lease and its actual receipt, not mistaken for a mandatory
post-start-idle failure or silently skipped. Keep the forward-only external floor;
dated handoff values are evidence, not a fixed current-state constant.

The private operator's current assumptions require a deliberate port: absolute
cross-kit imports become an image-owned reviewed closure; private credential-file
lookup becomes the supplied credentials file; host-bound restoration becomes an
unprivileged isolated service; host filesystem floor/scheduler state needs a
shared durable, independently controlled location. These are open implementation
items, not fulfilled by the controller tests. Native dump/isolated restore,
legacy-session lease, bounded R2 transport and exact-source public health polling
now exist under `portable/`. `runPortableBackup` also composes the existing daily
pipeline, private file archive, full R2 transport readback, native PG18 and native
local R2 recovery, with conditional capture-policy cleanup. Its caller retains
the same release lease before/after this backup. It checks complete ledger and
material-policy digests on source and restored databases and the Worker binding
digest on the source. Its required expectations are inputs from the installed
controller, not authenticated external-floor evidence: the durable floor reader,
approved policy authority, migration transaction, Worker deployer and scheduler
handoff are still open. Do not install it as an independently enabled deployer.
The integration fixture uses real PG18, native local R2 and synthetic data;
Cloudflare transport uses disk-backed injected HTTP responses. It covers capture
snapshot isolation, full archive readback, object restoration, corruption and
lost mutation replies. It does not establish remote operation or credentials.

`publishArchive` persists an exclusive disk intent before provider work and refuses
reuse of that UUID in the same work directory. It preserves the existing unique
single-writer REST limitation (`atomicCreateOnly=false`); the enclosing operator
must hold the shared lease, allocate a fresh unpredictable set ID, preserve private
intent/outcome evidence outside the ephemeral runner, and reconcile unknown
effects. Public health success alone does not set `schemaVerified` or `smokePassed`.

The controller adds `operatorEvidence: validated-seven-phases/v1` only after its
full operator-result validation succeeds. A production prerequisite authenticates
the staging receipt through the completed main Shared release run/attempt and
GitHub-owned artifact association/digest, plus the exact Deployment ID and all
seven projected phase successes. Generic Deployment metadata alone is not trusted.
The download reader uses the hosted runner's Python standard ZIP reader in isolated
mode, in memory, with one regular receipt member and bounded compressed/expanded
sizes; no artifact paths are extracted or executed. The GitHub token is never
forwarded to the artifact download origin.

## Result and progress

Atomically replace `/release/output/result.json` after each phase. It must be a
regular, non-symlink file, at most 65,536 bytes. Top-level fields:

```json
{
  "format": "freedom.shared-release-operator-result/v1",
  "requestSha256": "<sha256 of request file>",
  "sourceSha": "<application commit>",
  "target": "staging-next",
  "runId": 123,
  "runAttempt": 1,
  "operatorImage": "ghcr.io/freetwai/freedom-release-operator@sha256:<digest>",
  "configSha256": "<sha256 of config file>",
  "phases": []
}
```

Phases are an ordered prefix of the seven names above. Each has `name`, `status`,
`startedAt`, `completedAt` (ISO timestamps, completion only when finished).
Progress statuses are `running`, `passed`, `failed`; only the last may be running
or failed. A successful final result contains all seven, all passed, ordered
non-overlapping timestamps after admission and not in the future.

Additional required successful evidence fields:

| Phase | Fields |
| --- | --- |
| preflight | `leaseHeld`, `sourceCompatible`, `retainedFloorVerified`, `flagsPreserved`: true; `previousSourceSha`: exact live SHA |
| both backups | `sourceSha`: previous or new as applicable; `archiveSha256`: 64 hex; `remoteReadback`: `verified`; `restore`: `database_and_objects_restored`; `cleanupVerified`: true; `exposure`: `quarantine` |
| migration | `outcome`: `committed` or `unchanged`; `ledgerVerified`, `runtimeGrantsVerified`: true |
| deploy | `sourceSha`: requested SHA; `providerConfirmed`: true |
| health | `sourceSha`: requested SHA; `statusCode`: 200; `schemaVerified`, `smokePassed`: true |
| handoff | `scheduledBackupsVerified`, `cleanupVerified`, `leaseReleased`, `retainedFloorAdvanced`: true |

Exit zero only after every actual operation and cleanup succeeds. On failure,
persist a bound progress record and exit nonzero; never continue to later phases.
Unknown mutation outcomes require readback/reconciliation, not automatic replay.
The controller projects phase names/status/times only into public receipts;
an interrupted run's progress is explicitly a report, not confirmed completion.
Schema validation authenticates neither the image nor the provider observations:
image review, environment pins and actual staging acceptance remain necessary.
