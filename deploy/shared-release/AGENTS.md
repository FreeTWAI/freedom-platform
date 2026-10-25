# Shared release Actions entry

This module owns the manual release entry, GitHub admission, ordered operator
calls and public receipts. It does not replace the database migration runner,
consistent database/object backup, isolated restore or retained rollback floor.

The operator runs on an ephemeral hosted runner, never through SSH to a personal
machine. Its independently reviewed OCI image must be pinned by digest in each
GitHub Environment. No image, command, credential or deployment configuration is
accepted as a workflow input. Missing operator installation refuses execution;
a working plan must never be described as a working deployment.

Only teddashh, arumwu, Hao0321 and detna-vibe-coding may request/re-run a release,
with their current repository write authority checked again. Requests select an
exact merged-main commit and staging-next or next. Exact-source successful main
Verify and CodeQL runs are required. The workflow/controller comes from the
main workflow revision, independently of the selected application revision.

Backup before, migration, deploy, exact-source health, backup after and operator
handoff must all succeed in order. The existing backup must include remote
readback, isolated database/object restore and cleanup. Migration uncertainty or
a failed deployment stops, retains the outcome and does not auto-retry/rollback.
An operator handoff must preserve scheduled backups before a release completes.

Environment credentials remain outside the source checkout and public Actions
artifacts. Only allowlisted summaries are published. Never upload database dumps,
objects, raw provider responses, private operator diagnostics or configuration.

This is a new integration candidate. Current private operators depend on pinned
personal-host paths and systemd; they do not yet implement the portable operator
protocol. Keep RELEASE_ENABLED=false until that port, team service credentials,
and an actual staging execution are verified. No main merge or deployment is
authorized merely by creating this module or completing a local test.
