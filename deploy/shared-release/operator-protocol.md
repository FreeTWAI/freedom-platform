# Portable operator integration contract

The executable entry and image build source implement this contract; a local
image test is not an installed hosted operator. Keep releases disabled until
service credentials, independently checked authority and image/config pins are
installed for controlled staging acceptance. Do not copy personal-host credentials
into the image. This file is part of the reviewed controller surface.

## Code-only release contract

The protected-main controller now requests `releaseKind: code-only` and the exact
five phases `preflight`, `migration`, `deploy`, `health`, `handoff`. Migration here
means read-only verification of an unchanged migration ledger, canonical grants,
retained constraints and runtime reads, not migration execution. Pending SQL or
changed ledger refuses this path. The legacy migration runner retains its fresh
verified-backup and COMMIT guards for separately reviewed schema operations.

Code-only deploy does not consume scheduled-backup evidence, invoke either backup
phase, connect as the backup role, or require `backupDatabaseUrl`. It still uses
the existing environment config and authenticated R2 control journal, the shared
Actions lock and database lease. Routine backups remain independent and daily.
The new `code-begin` journal event has four ordered stages after preflight;
historical `begin` records retain the original six-stage replay semantics below.
Successful public receipts use `code_release_confirmed` and
`validated-code-release/v1`; staging admission authenticates both genuine legacy
and new receipts with their own phase contract, never check-mode receipts.

An optional failed-backup run reference authenticates the original terminal
workflow/artifact before any BEGIN-only reconciliation. Its failed inner preflight
and `snapshotDump: not_started` plus the authenticated empty-intent journal are
necessary, not sufficient: independent Worker/DB/floor/GC/backend observations
under the lease must pass before append-only abandonment. No seed reset, deletion,
archive/capture-intent recovery or backup-success assertion is part of deploy.
Daily receipts now retain independent allowlisted `phaseCode` and `cleanupCode`;
raw error strings and provider detail never enter these fields.

The rest of this document describes retained legacy and backup contracts where
seven phases, scheduler handoff or `backupDatabaseUrl` are mentioned.

## Invocation and ownership

The manual `check` mode is a separate read-only diagnostic, executed by the
reviewed main controller after the same actor/source/CI admission. It reads the
Environment's pinned config and tests account-token verification, retained
Worker/routes/Hyperdrive inspection, bounded R2 object listings and fixed-origin
health with staging-only Access headers. It does not invoke the operator image,
write a journal, access a database or create a GitHub Deployment. It works with
release and backup switches disabled. Its `checks_passed` receipt is deliberately
ineligible for production staging evidence. Raw responses and exception text are
excluded; write permissions and backup/deployment readiness remain unverified.

The image must be independently reviewed, readable by this repository's Actions
and pinned by digest. A private GHCR package is supported through the job's
`packages: read` GITHUB_TOKEN. The host sends it only to `docker login ghcr.io`
over stdin, pulls the pinned digest using a fresh mode-0700 Docker config, then
removes that config before starting the operator. The token and registry config
are never mounted or passed into the container. Its fixed
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

`credentials.json` supplies `cloudflareApiToken`, `migrationDatabaseUrl`, `runtimeDatabaseUrl` and
`backupDatabaseUrl`; staging also requires `stagingAccessClientId` and
`stagingAccessClientSecret`. Preserve whole-host Access. Send those service
headers only to the fixed staging health origin, never to a redirected endpoint
or the Cloudflare management API. It never supplies a GitHub PAT or the job token. Credentials
are environment-specific service credentials. Provider responses, diagnostics,
source media, backups and credentials stay private. The image must not write them
to `result.json`; the controller discards raw process output.

`config.json` has exactly these fields, validated by `portable/config.mjs`:

| Field | Meaning |
| --- | --- |
| `format`, `target` | `freedom.shared-release-config/v1`, exact Environment |
| `accountId`, `zoneId` | Cloudflare resource IDs, 32 lowercase hex |
| `mediaBucket`, `backupBucket` | Distinct existing source/backup bucket names |
| `database` | Exact `name`, PlanetScale `host`, `port: "5432"`, branch `loginSuffix`; roles are fixed by target and TLS uses `verify-full` |
| `floor` | Independently provisioned UUID `epoch` and `seedSha256` |
| `migrationProfile` | Reviewed `freedom.migrations/legacy-v1`, `first: 1`, exact approved `last`, `known_gaps: [22]` |

Worker names and public origins are fixed by target. Flags, secrets and bindings
are preserved from observed state, matched to the retained floor. Material policy
and coordinate authority come from original pinned legacy bytes. The config
cannot choose programs, commands, feature decisions, arbitrary origins or roles.
The controller binds the exact UTF-8 config bytes; the entry validates all fields.

## Existing behavior the port must retain

| Phase | Required actual work before reporting success |
| --- | --- |
| `preflight` | Read actual Worker/source and DB identities; compare retained rollback floor and complete ledger, preserve existing flags/secrets/bindings, acquire the same DB backup/release lease as scheduled and legacy operators, maintain heartbeat throughout |
| `backup-before` | Capture the previously deployed release using the existing exported DB snapshot, maintenance pins and object evidence; immutable offsite archive, full readback; isolated DB/object restore and floor/policy checks; cleanup and GC-off readback |
| `migration` | Use the reviewed installed migration runner and exact catalog; expected DB/role/schema checks; preserve transactional migrations plus runtime grants, final ledger checks and explicit commit outcome; observe an uncertain commit instead of rerunning |
| `deploy` | Build/package only the selected reviewed source using pinned tools; preserve current bindings/flags/secrets; invoke Wrangler once and retain provider confirmation |
| `health` | Read the actual public health endpoint and schema evidence, verify exact release SHA and approved smoke observations; HTTP 200 alone is insufficient |
| `backup-after` | Capture and offsite-readback the new source/schema, then restore DB and objects in owned isolated services, retain floor/material-policy/quarantine checks, cleanup |
| `handoff` | Advance the external retained floor at the approved point, confirm scheduled backup ownership still works, settle all owned temporary resources and maintenance pins, release the lease |

Use the existing daily backup pipeline's source/object/restore semantics, not only
`pg_dump`. Do not change application feature flags during this infrastructure port.
Only owner-recorded feature decisions authorize flag values; Environment config
does not independently approve a new flag. The controller invokes Wrangler once;
pinned Wrangler 4.138 can internally retry a version upload up to three attempts
on retryable network/API errors. This is not exactly-once provider mutation. Provider
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
shared durable, independently controlled location. The portable entry implements these changes; hosted acceptance remains required. Native dump/isolated restore,
legacy-session lease, bounded R2 transport and exact-source public health polling
now exist under `portable/`. `runPortableBackup` also composes the existing daily
pipeline, private file archive, full R2 transport readback, native PG18 and native
local R2 recovery, with conditional capture-policy cleanup. Its caller retains
the same release lease before/after this backup. It checks complete ledger and
material-policy digests on source and restored databases and the Worker binding
digest on the source. Its required expectations are inputs from the installed
controller. Its mandatory external ports now retain capture/archive intent and
verify the retained constraints on source and restored databases. The entry now connects the durable floor, independently derived candidate
contract and authenticated scheduled-backup evidence. The live seed, published
image installation and actual scheduler handoff remain open.
The integration fixture uses real PG18, native local R2 and synthetic data;
Cloudflare transport uses disk-backed injected HTTP responses. It covers capture
snapshot isolation, full archive readback, object restoration, corruption and
lost mutation replies. It does not establish remote operation or credentials.

`preparePortableMigration` and `runPortableMigration` now wrap the installed
migration runner with canonical runtime grants in the same transaction. The
canonical grants and read-only verifier are read from the admitted Git object;
the port has no private-host imports. It checks the complete before/after ledger,
material policy and GC state, role ownership, RLS inventory, PUBLIC/sequence/table
privileges, then probes actual runtime and backup logins in read-only transactions.
Private create-only intents plus mandatory external intent retention precede
COMMIT. An unavailable shared journal aborts the transaction before COMMIT.
A lost COMMIT reply remains unknown;
`observeMigrationOutcome` reads the transaction status and ledger without granting
permission to resume. The native PG18 fixture verifies atomic rollback and a
committed transaction whose reply was lost. The entry provides floor assertion/advancement and derives the expected contract
from admitted source in a fresh local PG18 database. Fixture callbacks are not
live retained-floor evidence.

`control-store.mjs` validates a complete private R2 append chain rooted in an
independently pinned seed and original legacy authority bytes. It refuses missing
records, forks, changed predecessors and unknown writes, under the shared lease;
it does not claim R2-enforced immutability/CAS. `floor.mjs` rejects unfinished
operations, source/ledger rollback and skipped phases. Confirmed COMMIT advances
the floor before post-commit probes, separately from passing the migration phase.
`coordinate-fence.mjs` validates the retained production migration166 constraints
and only the five already-reviewed PG18 restore definition variants. Original
legacy material-policy bytes remain authoritative; this port cannot bootstrap a
floor from the live database. Independent live provisioning is still needed.

Legacy seed v1 requires the deployed source/tree to equal the original migration
floor. Seed v2 explicitly supports an already deployed code-only descendant:
the provisioner independently checks its exact main/CI identity and provider
state before pinning it. On every open, the operator verifies Git ancestry, both
immutable trees and the descendant's entire regular SQL catalog against the
original ledger, using the existing `migrationDigest` format. Added, removed or
changed migrations fail. The original legacy floor, schema ledger, material
policy and coordinate authority stay byte-pinned and unchanged; v2 does not
invent migration events or approve a live database as new schema authority.

`buildApplication` copies the selected Git commit into a fresh independent build
directory, installs its lockfile, builds the portal and runs the image's fixed
Wrangler dry-run without inherited provider/DB/job credentials. It verifies the
source before/after and records asset/bundle digests. `createWorkerDeployer`
compares the active version, complete bindings, topology, runtime, Tokyo placement
and disabled Hyperdrive cache. It renders from preserved live bindings, keeps
secrets with `--keep-vars`, leaves routes unchanged and publishes once. Bounded
provider GETs retain stale/failed observations; an uncertain publish is never
replayed. The entry retains mutation intent in the shared journal before invoking
the provider. Local actual build/dry-run and live read-only provider checks
are separate evidence from synthetic publish tests; none proves a real deployment.
Worker Logs are read from service metadata as well as settings; the present
absent/disabled configuration is explicitly retained. Any enabled/unknown Logs or
traces shape refuses before upload. `--keep-vars` is not observability preservation.
Capture-policy enable now receives the release lease and checks ownership directly
before its UPDATE, including after asynchronous intent persistence. Conditional
cleanup of an already-attempted write remains available after ownership loss.

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

## Image and scheduled backup

`release-operator-image.yml` admits the exact reviewed main controller through
Verify/CodeQL and the four-account permission check. A tracked-source archive
excludes `.git` and private/untracked files. Immutable Node24 and PG18 bases,
locked dependencies, fixed TS loader and the reviewed import closure produce the
image. Its native fixture runs as UID1001 with read-only root and no network,
then the short-lived job token publishes GHCR. Publication does not alter pins
or enable an environment; a separate job's authenticated pull must be verified
before installation. The `verify-pull` job uses a fresh runner and only
`packages: read`, exercising the same download helper as release/backup.
Organization package-publication policy need not change.

`shared-backup.yml` has a separate `BACKUP_ENABLED` switch. It backs up each
actually deployed, main/CI-admitted SHA under the same DB lease and shared journal.
Its fixed phases are `preflight`, `backup`, `handoff`; the backup includes complete
readback, isolated DB/object restore and cleanup, without migration or deployment.
The journal permits this only at the settled floor and cannot advance source pins.
Manual runs are installation diagnostics. The natural schedule is 05:43 UTC for
both targets, serially, sharing the release concurrency group.

Before release, the controller authenticates the latest natural schedule's first
attempt, main workflow identity, both successful jobs, and the exact environment
artifact/digest/actors. The receipt must be no older than 36 hours and match the
installed image/config. A manual run, rerun, stale receipt or newer failed natural
run cannot authorize handoff. This avoids a circular bootstrap: install backup
first, observe natural success, then enable staging release. Keep the old backup
until the successor has been verified; no automatic timer retirement is present.

The image receives this verified schedule evidence without a GitHub token and
binds it into the final retained handoff event. Its health phase first observes
exact source, then reuses the existing read-only candidate health, protocol,
assets and anonymous checks with bounded retries. Staging Access is tested both
with service headers and without them; redirects are never followed. Login
Origin probes send only `{}` with a missing/foreign origin, no member credentials.
Failed observations remain private and cannot be replaced by later success.

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

For standalone backup, use `freedom.shared-backup-operator-result/v1`, the same
request binding and three ordered phases. Preflight requires the same live source,
lease, floor and flags; backup has the same restore evidence; handoff requires
`sourcePinsRetained`, `cleanupVerified`, `leaseReleased`. The controller marks
`validated-backup-phases/v1` only after validation. Full backup reports are private;
only bounded explicit proof fields enter operator results and journal events.
