# Shared release Actions entry

This module owns manual release and scheduled backup entries, GitHub admission,
the reviewed operator image, ordered calls and public receipts. It does not replace the database migration runner,
consistent database/object backup, isolated restore or retained rollback floor.

The operator runs on an ephemeral hosted runner, never through SSH to a personal
machine. Its independently reviewed OCI image must be pinned by digest in each
GitHub Environment. No image, command, credential or deployment configuration is
accepted as a workflow input. Missing operator installation refuses execution;
a working plan must never be described as a working deployment.

Private GHCR packages use the job's short-lived GITHUB_TOKEN with packages:read.
Registry authentication stays on the hosted runner and is deleted before the
operator starts; never pass it to the container or require a personal PAT.

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
Only an authenticated successful natural schedule's first attempt, with both
environment jobs and the exact image/config receipt, proves scheduler handoff.
Manual backup or re-running a failed scheduled run is not that evidence.

Environment credentials remain outside the source checkout and public Actions
artifacts. Only allowlisted summaries are published. Never upload database dumps,
objects, raw provider responses, private operator diagnostics or configuration.

This is a new integration candidate. The portable entry and image source exist;
local native fixtures do not establish hosted or provider acceptance. The current
private operator and systemd backup must remain available until a verified
successor takes over. Install independently checked original floor authority;
never bootstrap from live state as its own approval. Keep RELEASE_ENABLED=false
until image installation, team service credentials and staged acceptance are ready.
BACKUP_ENABLED is a separate installation switch. No main merge or deployment is
authorized merely by creating this module or completing a local test.
