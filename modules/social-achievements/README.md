# Progressive social achievements

Independent from admin community certification and accepted-Work recognition (#1128).
Policy `social_days_v1`: 1 / 7 / 30 / 90 / 365 cumulative Asia/Taipei calendar days;
no streak reset, account-age delay, online hours, content-quality inference or rewards.

## Authority and consent

`FREEDOM_SOCIAL_ACHIEVEMENTS_ENABLED` is exact `true` only, default OFF in Node and
Worker. OFF does not register APIs, show owner controls, query the new tables or
invoke recording hooks. Installing the migration enrolls nobody and backfills nothing.
Production activation and data writes require separate release approval.

Nonprivileged milestones use the existing active/onboarded/non-verification-test
member baseline plus explicit counting consent. There is no additional email-verified
gate or mail-service dependency; these titles do not establish an independent human
identity. Existing login/security and community-certification requirements are unchanged.

Both counting and display are independently default false. Counting consent only
covers new server-created qualifying actions after consent. Rejoining starts a new
consent boundary without resetting previously earned days. Closing counting keeps
existing days/awards; erase clears owner days/awards, stops counting and hides title.
No DM, reading, login/session heartbeat, clickstream, keylogging or message body is
read by this module. Derived relationships and dates remain personal data, not anonymous.

World chat requires an explicit A → B → A reply chain completed within 24 hours,
all three messages currently unretracted, both current onboarded active
non-verification-test users enrolled before the first message. Reciprocal blocks
prevent new credit. The completed reply and preceding reply cannot be reused;
per-user/per-track daily unique keys and per-unordered-pair eight-day monthly cap
prevent message volume, repeated sends and concurrent tabs increasing progress.
The world send and achievement writes commit or roll back together. A later message
retraction does not erase an already valid minimal milestone fact or retain its body.

Long-term participation also accepts the existing community-collaboration Work
acceptance fact for its deliverer, with an independent active non-test reviewer;
no private Work or artifact content. This is one participation day, not a new
Contribution, accepted_count change, XP, payment, or blue check. Existing source
acceptance rejects self-review; the hook also validates source joins. Same-pair
monthly cap applies separately to Work and counts distinct dates; reciprocal deliveries
on an already-qualified date can credit each deliverer. Source IDs and per-deliverer
pair/day uniqueness prevent replay or erase/rejoin restoring an old source. Reviewers' IDs are retained only as the
minimal source/pair reference, not a reviewer score or profile.

## Storage and lifecycle

Daily aggregate dates and awarded title IDs stay until explicit erase. Pair/source
references expire after 35 days; each enabled qualifying processing transaction
physically deletes expired references. Inactive communities therefore may retain
expired rows until the next processing transaction (not a guaranteed 35-day physical
purge). Release operator must decide/approve a periodic cleanup if a hard physical
retention deadline is required; this change installs no schedule. Anti-abuse refs
survive erase until expiry to prevent erase/rejoin cap evasion. Command receipts,
moderation reasons and audit logs retain existing platform lifecycle; no promise
is made to erase already retained backups. No raw content is copied into receipts.

A community advisory barrier serializes consent/counting/moderation, daily inserts
are idempotent, and the chat pair barrier precedes it to serialize block changes.
Reads use current user/session checks and final DB clock fence. Mutations use existing
CSRF/Origin, command receipts and If-Match CAS; successful replay reads current state.

## Presentation and moderation

Owner account settings show private progress, unlocked choices and next milestone.
Only a selected, earned title may be displayed after independent display consent.
Profile integration must add title-only metadata to the authenticated #1135 envelope
under that reader's same-statement current same-community/profile/block ACL. Never
add it to anonymous VisitorProfile, search, OG, PNG, general account DTO or caches.
`titleProjection` is the allowlisted presentation helper; no progress or peer IDs.

Verified active platform admins (not guild titles) can pause new awards (qualifying days still accumulate), revoke
visibility or restore it with a required reason, current authority and CAS. Pause
preserves existing display and eligible days; restore re-evaluates thresholds under
the same policy, retains previous awards/counts and grants earned withheld titles.
Revocation hides the title and withholds new awards, not eligible-day counting for
either opted-in participant. Owner appeal is private and one pending appeal at a time. Reports do not automatically
revoke anything. Admin UI uses the member session boundary, never unverified identity.
A reviewed DB integration is still required for races, FK/ACL and persisted behavior.

## Checks

Pure Node: `node --import tsx --test tests/runtime/social-achievements-policy.test.ts`.
DB: `tests/runtime/social-achievements.test.ts` requires explicit disposable
`TEST_DATABASE_URL`; never use default, production, desktop or discovered DB.
Browser: `tests/e2e/social-achievements.spec.ts` uses existing fixture and must follow
production build. These are source test requirements, not claims they were executed.
Integrated candidate migration194 follows main Google190, profile191, cover192 and
certification193. Recheck the main maximum before merge; do not alter `known_gaps`
or historical SQL. This numbering is source integration, not an applied schema.
