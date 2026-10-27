/* DESIGN ONLY. Not a migration, not executable DDL, no allocated number.
Candidate table: member_community_certifications
  community_id uuid + member_ref uuid: composite FK to users(user_id,community_id)
  PRIMARY KEY (community_id, member_ref)
  state text CHECK IN ('active','revoked')
  aggregate_version bigint CHECK > 0
  policy_version text: exact adopted community-certification policy
  decided_by uuid: reference existing platform_admins admin_id
  decided_at timestamptz

Do not duplicate platform_admin_audit or platform_admin_receipts.
Each grant/revoke atomically writes state, existing private audit and receipt.
Audit retains reason and before/after/version; public DTO omits all audit fields.
No contribution counter/point wallet: derive from current accepted Work facts.

Display preferences belong to canonical profile storage, default false:
  show_community_certification boolean
  show_contribution_badges boolean
Do not allocate that storage here or race the profile worker's ACL/persistence.
Anonymous projection omits both badges. No grants, triggers, backfill, or writes.

Before implementation: coordinate schema slot (#1043 owns 190), initial-row CAS,
lock order, mixed-version/release compatibility, current authority before replay,
Access expiry revalidation, data catalog/retention and runtime role privileges.
*/
