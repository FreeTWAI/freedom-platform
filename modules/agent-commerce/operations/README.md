# Commerce host operations

## Store readiness and admission receipt

`store-readiness.ts` accepts an already-authorized, tenant-bound client. Seller
overview and the community admin list use the same eight ordered items. The
buyer decision comes directly from `publicPurchaseStateWithClient`; admission
capabilities, active admission and usable payment come from
`readStoreAdmissionFacts`, also used by the runtime admission port. Product
availability uses actual cart quotes in batches of at most 50. Delivery uses
the runtime checkout shipping port's choices for actual own-stock lines.
Node and Worker install that SQL-local port even when checkout is off; a direct
caller without it uses the same delivery-choice implementation. These reads
neither settle inventory nor call providers.

The console-only seller `/overview` checks `store:read` before projection and
returns order counts only with `store:orders:read`. Counts share the order list's
SQL predicates, stop at 100 and expose `99+` through `more`; a failed read never
becomes zero. Seller data excludes admission reasons/actors, host profiles and
quarantine details, as well as payment and contact contents.

`GET /admin/api/commerce/store-readiness` rechecks the active admin, enumerates
tenant scope identities, binds one tenant per isolated transaction, and checks
community before reading its instances. No RLS bypass is used. Every storefront
instance is retained, including unconfigured and inactive ones; whole-community
totals are independent of the requested page. Admin membership uses the same
independence query as the unchanged admission commands. The admin UI downloads
all pages as `freedom.commerce-scope-receipt/v1`, refusing an incomplete receipt
after 20 pages. Pages are observations, not an atomic environment-wide snapshot.
The receipt assists operator scope review; it does not prove consent, enable a
flag or authorize a deployment. No schema change is required.

The list currently walks all tenant scope identities on each page request and
reads each community store for its summary. Only page items receive full cart
and delivery readiness; off-page items use the buyer gate alone. This is intended
for trial scale. A measured one-product own-stock/meetup fixture used 51 SQL
queries for full readiness versus 16 for the buyer gate, excluding caller
authorization, transaction and admin-context restoration. Counts grow with cart
batches and own-stock delivery candidates; receipt pagination repeats the walk.

`readCommerceSettings` defaults console/checkout/quarantine/email off and accepts only
exact `true`/`false`. FREEDOM_COMMERCE_CONSOLE_ENABLED=true requires
FREEDOM_GUILD_LAUNCHPAD_ENABLED=true; checkout=true requires console=true. The
parser always sets consoleEnabled; its optional type keeps older fixtures
compatible, and absence is off. Worker/deployment readiness applies the same
commerce_launchpad_required and commerce_console_required dependency errors.
Seller and supplier pages share the hosted-ui ConsoleShell component, but their
activation flags are independent. Supplier console may remain off during an
own-stock offline checkout trial; its routes and site flag stay off.
`providerProfiles` is empty unless `FREEDOM_COMMERCE_PROVIDER_PROFILES` lists implemented IDs, comma-separated
without whitespace, empty entries or duplicates. `ecpay.aio.credit.v1`,
`offline.bank_transfer.v1` and `offline.cash_on_meetup.v1` are implemented. Invalid
configuration fails readiness with a fixed value-free code.
A Worker list containing `ecpay.*` requires a usable credential keyring and
COMMERCE_JOURNAL R2 binding; offline-only profiles need neither.
`FREEDOM_COMMERCE_EMAIL_ENABLED='true'` requires the Worker `EMAIL`
(`send_email`) binding and COMMERCE_JOURNAL. Node refuses both an `ecpay.*` profile
and `emailEnabled` (`commerce_email_requires_worker`) because it has no
journal or email binding. Only the local E2E host installs memory storage, a
fixture gateway and `FixtureEmailSender`.

Production wiring installs store admission, the optional payment port and, when
`emailEnabled` is true on the Worker, the outbox and Worker email sender.
The SQL-local shipping adapter is always installed; policy adapters remain absent. Admission
requires an unrevoked row in the current `providerEnvironment()`, every capability
registered by storefront 1.1.0 and an active payment service whose profile the
host lists. An empty profile list refuses admission. A 1.0.0 store needs its
owner upgrade first. Lifecycle lock waits recheck admission before creation.
Retained order reads, seller obligations and machine hold expiry continue when
checkout is disabled. Console=false leaves all seller checkout/case routes on
the JSON 404 catch-all. Console=true mounts them inside the launchpad member
boundary; it grants no capability itself. Quarantine keeps seller reads available
and refuses every seller write and on-demand query with commerce_quarantined.

Independent active platform admins admit/revoke stores only in their community.
An admin with any active membership in the tenant cannot decide either command.
Receipts retain the decision; revocation is final and re-admission creates a new
row. Reasons are bounded operational notes, never personal data or credentials.
There are no seed admissions or body-selected provider environments.

## External-effect journal

`journal/journal.ts` defines `EffectJournalPort` and strict allowlisted records.
The host environment is local/staging/public. The key is
`<environment>/<yyyy>/<mm>/<dd>/<kind>/<id>` from the occurrence's UTC date;
the body is sorted canonical JSON with application/json content type. Only
identifiers, trade/amount/currency, purpose/profile, state, credential-version and
release metadata are accepted (`email_send` records `order_id` and `purpose: <template>`).
No personal data or key material enters the log.
The R2 adapter conditionally creates with `etagDoesNotMatch: '*'`. An existing
identical object is an idempotent success; different bytes give journal_conflict.
Other failures give journal_unavailable. Errors never contain record data.
The in-memory adapter has identical semantics and is test/E2E-only.

Setup commands append `commerce_control_events` in their domain transaction.
Their immutable detail excludes credential fields, fingerprints, routing refs
and request bodies. `flushControlEvents(pool, journal, {eventIds?, limit})`
appends control.<kind> outside a database transaction, then fills journaled_at
once. Account and admission routes try it after commit, preserving the command
response on failure and logging only a fixed name. Activation-payment routes do
not flush; their confirmation control event waits for the scheduled pass. The scheduler backfills
unjournaled rows independently. Each failed row logs only its event ID and a fixed
reason, then later rows continue. Flush returns written/failed counts; a poison
record remains available for a later retry without blocking unrelated controls. Payment handoff requires its own journal append
before token consumption; journal failure leaves the link available for retry.
Outbound email delivery similarly appends `email_send` and records `journaled_at`
before invoking the email sender.

## Scheduling and provider entry paths

`due-work.ts` maintains the non-PII cross-tenant `commerce_due_work` schedule:
`payment_query` targets an attempt to query, `payment_window_end` targets its
60-minute confirmation deadline, `offline_payment_window_end` targets an offline
order at `expires_at + 72h` (handler `endOfflinePaymentWindow`; before that grace
end a due row is rescheduled, and after it an open unpaid order is cancelled with
`payment_not_completed`), and `email` targets a queued row in
`commerce_outbound_emails`. `scheduleDueWork` upserts by kind/target using
LEAST, so an earlier request wins and a retry never postpones work. `runDueCommerceWork` claims at most 200 due rows cross-tenant with
`FOR UPDATE SKIP LOCKED`, gives them two-minute leases and commits before dispatch.
Each handler binds and validates its own tenant in separate transactions; queries
extend their attempt lease to 60 seconds and make the external call only after
commit, while `email` rows check state/expiry/redaction, journal once, mint a
fresh access link and extend their send lease to 60 seconds at the end of Prepare,
render in memory and call the sender outside any transaction (marking `sent`
whenever still `queued` even if the lease expired, while deleting the due-work row
only when its token still matches the Prepare token). The exact lease timestamp is the ownership token. The claim filters to the
currently runnable kinds (payment kinds require transport and keyring;
`offline_payment_window_end` is registered with no keyring, transport or journal;
`email` requires `emailEnabled`, sender, journal and an explicit `origin`), so queued emails never crowd out
payment queries when email is off or `origin` is unavailable. The executor stops after 50
external calls or five minutes and releases unstarted claims. Errors log only
kind and a fixed code. Finished rows are deleted; `failure_count` tracks consecutive
indefinite results separately from total runs and `last_query_at` tracks calls.
A query needs transport/keyring, but no listed profile or active service, so old
payment responsibility can still reconcile. The tenant/instance must be active.
HTTP 403 waits 30 minutes on that account's payment service only.

Notifications, recorded browser returns and matched B10 order-access requests
queue targeted execution through `PlatformRuntime.afterResponse` after their
scheduling transaction commits. Payment hooks register one work item that first
runs `runDueCommerceWork` for a due `attemptId` (when transport and keyring are
installed), and then—when `emailEnabled`, sender, journal and `origin` are
installed and `orderId` is set—selects up to 10 `queued` email IDs for that order
(`ORDER BY created_at`) and runs `runDueCommerceWork` for those targets. Each work item has a 25-second bound. The Worker gathers them in `ctx.waitUntil`, waits
with `Promise.allSettled`, then ends its pool. An abandoned timed-out query leaves
its lease for cron recovery. Node runs detached with fixed-name failure logging;
tests can install an awaitable collector. The hook spends no notification budget.
Quarantine suppresses it; missing transport/keyring skips only the attempt-query
step, and B10 hooks require `emailEnabled`, sender, journal and `origin`. The ten-minute cron is fallback.
Queries write verified inbox facts, never an external-effect journal record.

`provider-entry-paths.ts` recognizes exactly the payment callback POST and the
browser-return POST with lowercase 26-character account refs. The platform gate
retains Host checks while skipping Origin, JSON and cookie/session processing
for those two machine entries. Other methods under their prefixes return 404.
Budgets live in checkout's constants table and commit in separate short
transactions; browser-return exhaustion suppresses writes while preserving the
verified redirect. The pre-verification notification allowance is keyed by
account and network, so one network cannot exhaust another sender’s budget. No provider source-IP allowlist is assumed.

Quarantine stops new commerce effects, the hold sweep, deferred payment
application, due work, the outbound-email sweep and control-event backfill.
Verified callbacks still retain their inbox facts for ordered replay. When
quarantine is off, the Worker runs deferred payment application before the hold
sweep, then due work, then `sweepCommerceOutboundEmails` (up to 500 expired
`queued` emails marked `expired` with their due-work rows deleted, and up to 500
closed emails deleted 45 days after `updated_at`, regardless of `emailEnabled`),
then the journal flush, with independent fixed-name error handlers. A failing deferred event logs only its ID and skips
later events of that attempt in the run while other attempts continue. The result
reports applied/failed/skipped counts; partial failures receive a fixed Worker log.
Settlement also retains holds protected by unapplied
verified paid notifications or query results, so placements cannot release them before recovery.
See [payment confirmation](../payments/README.md) for slot/backoff, window-end and
automatic cancellation rules, and [notifications](notifications/README.md) for
the email outbox and delivery rules.

Release capabilities commerce.hosted-checkout.v1 (168) and
commerce.hosted-payment.v1 (169) are mandatory for planned or retained schema
floors; they grant no payment, email, invoice or deployment authority. See
[EC-SPEC-10](../../../docs/platform-plan/execution/commerce/EC-SPEC-10-release-operations.md)
and [EC-SPEC-09](../../../docs/platform-plan/execution/commerce/EC-SPEC-09-security-ci-tests.md).

Contact retention (`contact-retention.ts`, migration 187) uses a persistent per-store due-work lease and bounded existing-row discovery. `FREEDOM_COMMERCE_CONTACT_RETENTION` defaults to `off` (including unset): merge/deploy runs no discovery, dispatch or customer sweep and leaves existing due rows undispatched.

Exact `all` enables only the approved 180-day order rule and customer sweep. Every referencing order must have a fulfilment/cancellation start point at least 180 days ago. On 2026-10-23 Ted said 「不要再設什麼30天規則」: contacts with no order remain live indefinitely. 「別在那邊搞一堆遮蔽 很無聊」 removes deferrals for exceptions, payments, refunds, provider events and inventory. Other values, including `orders`, fail readiness with `commerce_contact_retention_invalid`; the scheduler logs that fixed name followed by `commerce_settings_invalid`, without the value. Retention and commerce payment application, hold cleanup, due work and email stop for that tick; unrelated scheduled jobs continue. Ted's 「all, all」 specifies staging/production `all`, set by the release operator. Active retention runs independently of checkout admission and quarantine, never performs external effects and never closes orders. Returning to `off` stops new masking without restoring data.

Customers need an already-redacted contact linked through checkout/order customer IDs and no live contact linked through checkout customer, normalized email or order customer. Unlinked customers remain. Permanent revision limit: an older live unreferenced contact on a revised checkout still protects that checkout's customers after the order's current contact is masked. Orders without a start point retain their data. Store owners handle their own customers' manual privacy requests without a platform workflow; backups are kept 30 days (Ted, 2026-10-23).

`DueCommerceWorkDependencies.contactRetention` is optional and accepts only `all`: ordinary business dispatchers omit it, so they cannot claim privacy rows; the dedicated retention runner supplies its required mode.

Restore lockdown requires the operator's `--contact-retention <off|all>` declaration and composes the same bounded redaction transaction for `all`; `off` only locks ACLs. Completion always keeps `deploymentReady:false` and never authorizes reopening. Public self-ship no longer depends on retention mode; the existing console/launchpad checks remain and Ted still decides its production flag. The commerce-operations descriptor owns migration 187 because this is the due-work executor and cron lifecycle, not a checkout schema ownership transfer.
