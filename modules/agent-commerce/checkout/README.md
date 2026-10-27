# Hosted checkout transaction core

This module implements EC-SPEC-03 inside the caller's PostgreSQL transaction.
A store argument is only a shop selector: stored profiles, selections and retained
order lines establish tenant and supplier provenance. Callers must authenticate
buyer capabilities or seller permissions before invoking participant commands.
The payment machine caller must verify the provider fact before invoking payment
application. Transaction-core functions perform no external I/O. The separate
payment action port orchestrates provider queries between committed transactions.

## Buyer identity continuation (2026-10-20)

With checkout enabled, quotes, freeze and placement accept the optional
`X-Commerce-Buyer` header (`guest` or `member:<user UUID>`). It is an equality
fence, never authentication: the actual active session remains authoritative.
`buyer-identity.ts` compares it before principal mapping or domain effects.
Fenced requests acquire three connections in sequence, never two at once:
a short pre-check transaction (always `SET TRANSACTION READ ONLY`), the existing
committed attempt-budget transaction, then the command transaction. The command
compares the identity again before any effect. Quote commands also use
`SET TRANSACTION READ ONLY`. Bucket row locks end with the budget transaction;
they are not held during quotes or checkout/placement domain work. A mismatch
returns 409 `checkout_identity_changed` with 「登入身分已變更，請重新確認」.

A mismatch writes no domain effect. It also charges no budget, unless the identity changes between the pre-check and the command; then only the attempt budget remains.

Rejected commands retain accepted attempt charges, as in the legacy path.
Successful quotes echo the actual identity in the same header. Existing clients
without the header keep their existing command and budget behaviour. The fence
does not change browser order-access tokens, tenant binding or RLS.

The buyer client rechecks the session on lifecycle events and before freeze,
place and retry. After initial confirmation, a background check keeps fields
usable and preserves the quote when the identity and generation are unchanged.
A failed check blocks fields/actions until a successful check. Its v2 tab intent
binds replay coordinates to the store and
stable member user ID (or guest). A new session for the same member can explicitly
retry the original coordinates; a different identity parks them without replay,
clears private in-memory fields and requotes the retained cart. Legacy v1 intents
are untrusted. Tab metadata stores no contact, bank, cookie or CSRF values.
The member history companion is described below.

## Member checkout history (2026-10-20 candidate)

Raw checkout flag ON mounts `GET /api/v1/me/orders` behind the real cookie
boundary, including an onboarding exception for this exact GET only. It needs
no CSRF token. The read-only transaction reuses `member(..., false)` without
mapping a person or scope and rechecks the live session, active user and same
active person principal before returning. Disabled principals are refused;
an unmapped active member gets an empty page. Guild and seller-tenant membership
are not conditions of the original buyer's retained order access.

Migration180 adds only the partial buyer/creation/UUID index. Candidate discovery
is `buyer_principal_id = actual principal AND order_profile = 'hosted_checkout'`,
ordered newest first, at most 21 candidates for a page of at most 20. Dependent
exact-key sidecar/publication/provenance lookups export only frozen store name
and slug, order reference/number, placement time, total/currency, lifecycle and
canonical order path. Missing retained metadata fails closed as an error.
There is no customer/contact/bank query, cross-tenant fanout, role change,
BYPASSRLS, new grant or RLS exception in the list. Existing participant metadata
exemptions suffice. No list budget is charged; no hold is settled.

`tenantListCursors` signs purpose `buyer-orders`, the actual principal, empty
store/scope selectors and filter `{"profile":"hosted_checkout","v":1}`. The
position retains six-digit PostgreSQL microseconds and the UUID; continuation
uses a strict descending tuple boundary. Another member, v1 list, origin or
environment cannot reuse it. Missing signing configuration returns
`tenant_cursor_unavailable`, never a misleading empty page. Query limit defaults
to 20 in the API/domain so generated input/output schemas remain identical.

When the current public store cannot resolve, only the original active member
may read retained B07. Metadata proves exact order, buyer, frozen slug and stored
tenant/instance/shop provenance before the existing explicit order projection
binds that one tenant and reads private contact/payment instructions. Anonymous,
stranger, expired or disabled identities retain the opaque missing response.
The HTML shell authenticates before emitting even the frozen store name; it is
private/no-store/noindex, uses the original Freedom logo, and replays no historical
merchant description, products, photos, appearance, policies or footer. Its
hydrated controls are read-only. Placement, cancellation, payment continuation,
public store pages/JSON and login-return validation gain no retained-store fallback.

These reads remain allowed in quarantine when the raw checkout flag is ON.
The existing site field still masks the feature in a freshly loaded quarantined
portal; it does not become a separate history capability. With the raw flag OFF,
the list/cache middleware are absent and retained B07 falls back to the same
missing-store response. No real environment or flag was changed.

## Inventory and retained facts

N is physical stock, H is the sum of held reservations, and A is the sum of
`quantity - shipped_quantity - released_quantity` on paid allocations.
`commerce_items.reserved = H + A`, and available is `N - H - A`.
Deferred constraints enforce the balance and exact frozen line/hold/allocation
bindings at commit, including writes made outside this module. Every order line
retains one hold forever; expiry releases it without cancelling the order.
Conversion releases the hold and creates A atomically without changing reserved.
An unapplied verified paid notification or query protects the order’s held units from both
placement settlement and the scheduled sweep, including after expiry. Deferred
application after quarantine therefore converts those holds before releasing stock.
Late payment allocates the entire order or records `unallocatable` without any A.
Shipment handover reduces N and A; inspected return restocking increases N only.
Allocation counters increase monotonically and must match immutable movements.

Checkout base orders and lines are immutable. The sidecar has one transition from
open to cancelled or closed, with version incremented by one. Payment applications
and movements are append-only and deduplicate their source identities. Allocation
command identities are also retained when cancellation creates no movement. No new
table allows DELETE. Contact revisions insert new rows; only a single complete
PII redaction can update a contact, clearing its salt and retaining its original
salted digest. Customer identity/store/creation fields are immutable; member and
email-verification labels may only be filled once. Customer redaction replaces
email with `redacted:{customer_id}`, clears email verification and fixes
`redacted_at` once; all later updates fail. A later checkout with the real email
creates a new customer, while historical checkout/order references remain. Customers and
contacts use tenant RLS; the domain binds tenant context from resolved store rows.
The non-PII tables have individual exemptions in the tenant data catalog. An
opaque reference, email or catalog entry never confers read authority.

## Lock order

Participant paths lock seller and supplier lifecycle rows in tenant/instance
order, then the community advisory lock, profile, checkout/sidecar, base order,
payment-reference advisory lock, payment attempts, payment applications,
holds/allocations, and items in UUID order. Attempt rows are locked immediately
after base orders and the optional payment-reference lock. Existing-order
machine payment/expiry/system cancellation paths omit lifecycle locks and never
acquire instance locks after acquiring the community lock. Community serialization
makes payment versus expiry or cancellation deterministic: the first commit wins.
A replayed payment reference returns before acquiring inventory locks or writing.
Physical/command references take a global advisory lock after the order locks;
reference comparisons see committed facts even across communities.
All writes and deferred checks must commit in the caller transaction; on any error
the caller must roll back the entire transaction.

Order bell notices are the explicit optional exception to that rule. When the
order-notifications flag and checkout are ON, and commerce is not quarantined,
the existing notification writer runs inside a notification-only savepoint after
the domain effect. Invalid frozen metadata, formatting or recipient invariants
roll back that optional block, emit only `commerce_order_notification_skipped`,
and let commerce continue. Every rejected database query is classified at its
origin, including connection errors without SQLSTATE; database and savepoint
errors propagate and roll back the entire domain transaction and receipt/work
change. Successful notices commit atomically with it. There is no independent
commit, external delivery or retry inside that savepoint. Notification-enabled
offline buyer placement and cancellation may repeat the whole isolated
transaction once after `40P01`, rechecking authority and recipients. Prechecks
and attempt budgets outside it run only once. Card/OFF, seller commands and
scheduled expiry keep their existing error handling. OFF installs no port and issues no
notification SQL. The frozen publication supplies only store name/slug and the
order supplies its display number and immutable buyer principal; the email-based
customer/member label is not a notification identity.

## 買家確認商店政策

安裝 `storePoliciesOptions(runtime)` 時，政策 port 只讀目前 publication 的
`commerce_publication_policy_refs`，以相同 tenant／instance／kind／version 的不可變
政策版本核對正文及 digest。只有正文非空的版本列入要求；草稿、歷史與其他租戶不列入。
consent kind 為 `storefront.shipping`、`storefront.returns`、`storefront.privacy`、
`storefront.terms`，`policy_version_id` 就是該 publication ref 的 `version_id`。
旗標關閉不安裝 port、不讀政策表；沒有 published refs 時要求仍是空陣列。

公開 cart quote 必回 `required_consents`（無要求時為 `[]`），每項有 `policy_kind`、
`policy_version_id`、`POLICY_LABELS` 的繁中 `label` 與 `/shops/<slug>/policies/<kind>`
公開 `url`。結帳頁以單一必填勾選連結所有政策，逐項在新分頁開啟；未勾選不能核對訂單。
freeze 只送當次 quote 的 kind／version 集合。`consents_mismatch` 重新報價、清除同意，
顯示「商店政策剛更新，請重新閱讀並勾選同意。」並聚焦勾選欄位。
placement 照舊重算，差異沿用 `terms_changed`，不自動建立新訂單或放寬條款。
已同意的版本保留在 checkout／order terms；目前賣家／管理員訂單 DTO 未帶出
consents，後續可擴充既有讀模型與顯示，這次不加 migration。

## Canonical terms

`freedom.checkout-terms/v1` contains current publication identity/revision,
server-priced items and exact selection/supplier/offer/acceptance/listing bindings,
shipping groups and total, an explicit zero discount total, policy consent
references, payment method references and a contact digest. It contains no contact,
delivery address or invoice fields. Browser prices are not accepted as authority.
Pricing/bindings reuse the shared reservation resolver, including own products.

Canonical JSON recursively sorts object keys lexicographically, preserves array
order, emits compact JSON without whitespace, and permits null, strings, booleans
and safe integer numbers. Terms keys are ASCII; this is a deliberately scoped
encoding, not RFC 8785. Strings use JSON escaping and UTF-8 bytes; SHA-256 is
lowercase hex. SQL independently checks the same terms hash. The contact digest
is `hashJSON({contact, delivery, invoice, salt})`, using a fresh 16-byte
`crypto.randomBytes` salt encoded as 32 lowercase hex characters. The contact
row holds the salt only while unredacted; placement recomputes with that stored
salt. Only the digest enters terms. A standalone `computeCheckoutTerms` result
uses a fresh ephemeral salt; freezing creates the retained contact and digest.
Every input string, including object keys at any depth and fields stripped by
validation, must be well-formed Unicode and contain no U+0000; otherwise
`invalid_checkout_json` (422) occurs before writes.
Delivery/invoice JSON follows the same integer-only
encoding and bounded UTF-8 size. Shipping ports return references and amounts,
never addresses or personal fields.

Checkout creation/revision keys are hashed independently of content. An additional
append-only `commerce_checkout_idempotency_keys` table retains each command's
keyed request digest and original non-PII response, so revising a draft cannot erase an
earlier key or silently change its replay result. Both freeze `request_sha256`
columns contain HMAC-SHA256 keyed by the plaintext idempotency key (UTF-8) over
`canonicalJSON({input, checkout_id})`, in lowercase hex, so a checkout replay
ignores member identity and keeps the first customer member link. The
plaintext key is never stored; the retained key identifier is an independent
SHA-256 hash. Checkout identity and the
24-hour deadline remain fixed across revisions. Changing contact email resolves
the corresponding store customer; placed orders retain their original customer
and contact references. Placement is idempotent within
(checkout, client order ID), independently of member identity; a replay keeps the first placement's buyer.

## Function contracts

All `q` arguments are caller-owned `PoolClient` transactions. Sweeps and public
commands take a pool; the separate payment action port orchestrates committed
lease/call/result phases outside checkout transactions. Store admission defaults to false and shipping defaults to
`shipping_not_configured`. SQL ports run within the transaction and must not call a
provider. A confirmed payment is exactly an application whose outcome is in
`CONFIRMED_PAYMENT_OUTCOMES = {converted, allocated, unallocatable}`. Simulated,
amount-mismatch, after-cancel and overpaid outcomes do not confirm payment. The
shared SQL helper applies this definition to payment application, both cancellation
paths and unresolved-order detection. An open order without a confirmed payment
blocks a new placement on that checkout with its reference in `unresolved_order`
by default. Payments injects `UnresolvedOrderPort` alongside admission: it blocks
only while an attempt is paid, issued/superseded and handed off, or issued and
unhanded with every hold still held and unexpired. Definite unpaid attempts and
unhanded attempts whose holds are gone do not block; their window can cancel the
old order later. Without the port M1 retains its original behavior.

Payments' 60-minute confirmation window calls `settleOrderPayments` after attempt
changes at/after that deadline. It cancels through `cancelUnpaidOrder` only when
all attempts are failed/expired, no confirmed application exists and no payment
event awaits application. The same cancellation path releases holds and invokes
the payment hook to revoke tokens; a cancellation replay makes no effects.
Unknown, issued, superseded and paid attempts keep the order open. A later paid
fact still applies as `after_cancel`. See [payments](../payments/README.md) and
[EC-SPEC-03](../../../docs/platform-plan/execution/commerce/EC-SPEC-03-order-inventory.md).

A customer/member link is a seller-facing label, independent of order read access.
Both customer upsert and placement fill it only when currently NULL and the member
is an active person principal whose active user has a verified email matching
`email_normalized` after `lower(btrim(users.email))`. Other cases silently leave
it unchanged, including shared family email, mismatched/unverified email and guest
checkout. Placement still records the authenticated member as `buyer_principal_id`;
order access depends on that identity or access grants, never this label.

| Function | Contract |
| --- | --- |
| `ensureCustomer(q, store, email, memberPrincipalId?)` | Normalize/upsert per store; fill an empty member label only by active verified matching email; preserve existing labels without blocking checkout. |
| `computeCheckoutTerms(q, store, input, ports?)` | Validate 1–50 unique SKUs, quantities 1–99; resolve current server prices/consent and quote shipping; return terms/hash using a fresh ephemeral contact salt. |
| `freezeCheckout(q, store, input, ports?)` | Create or revise the draft and insert a contact; replay equal keyed content, conflict on different content. |
| `placeCheckoutOrder(q, store, input, ports?)` | Require admission, settle bounded due holds, recompute terms and atomically create order/lines/sidecar/holds; report every SKU's available quantity on shortage. |
| `cancelUnpaidOrder(q, store, orderId, actor, reason, ports?)` | Open and no confirmed payment only; release holds, invoke the optional payment cancellation hook in the same transaction and cancel once; repeat cancellation returns the current sidecar without invoking the hook or scheduling work. |
| `settleDueCheckoutHolds(q, itemIds, bounds?)` | Release due checkout holds, keeping orders open; at most 50 items and 99 orders per item. |
| `sweepDueCheckoutHolds(pool, {limit?})` | Process at most 200 selected orders with isolated machine transactions; the Worker scheduler invokes this before due payment work. |
| `applyConfirmedPayment(q, input)` | Deduplicate verified payment reference; record simulated/mismatch/after-cancel/overpaid or convert/allocate/unallocatable atomically. |
| `retryAllocation(q, store, orderId)` | Retry a retained unallocatable fact after restock, all items or none; preserve the original payment outcome on replay. |
| `releaseAllocation(q, store, input)` | Release all or selected unshipped quantities once per command/allocation; cancel with paid_cancelled only when every remaining quantity and every shipped quantity are zero; partially shipped orders remain open. |
| `cancelPaidOrder(q, store, {orderId, commandRef})` | Lock as releaseAllocation; require open, confirmed payment and no shipped units; release all remaining allocations and cancel with paid_cancelled, version + 1. Without allocations, only the sidecar changes. Cancelled replay returns the same row; retryAllocation then refuses. No refund is created. |
| `recordHandover(q, store, input)` | Ship bounded allocation quantities once per shipment/allocation; printing or creating a shipment has no stock effect. |
| `restockReturn(q, store, input)` | Restock once per return/allocation, bounded by shipped minus already restocked. |
| `inventoryPositions(q, itemIds)` in hosted/inventory | Return a map of stock/held/allocated/available; throw reservation_inconsistent (409) when reserved differs from H+A; caller authorizes item access. |

Reference replay compares recorded content before inventory guards. A shipment
must have the same multiset of `(order_id, item_id, quantity)`; otherwise
`shipment_ref_conflict` (409). A return must match order, item, allocation and
quantity; otherwise `return_ref_conflict` (409). Release/paid-cancellation command
references are global to one order, including cancellation without allocations.
Another order, or explicit release lines differing from the recorded
`(item_id, quantity)` set, yields `command_ref_conflict` (409); omitted lines
replay the recorded command. Every conflict leaves counters, stock and movements
unchanged. Paid cancellation without a confirmed payment is
`payment_not_confirmed` (409); any shipped unit is `order_partially_shipped` (409).

The internal `CheckoutInventory` sibling port provides convert, allocate,
releaseAllocation, ship and restock. It derives all supplier bindings from stored
order lines and checks conditional SQL updates and immutable movement history;
callers cannot supply tenant/shop authority to it.

## Public HTTP and browser access

All public commands resolve the slug and prove the same current publication,
resource, tenant, deployment and real-owner liveness as the v1 public store reader
inside their own transaction. Host, Origin, JSON and the 32 KiB request limit use
the platform gate. Replies use `Cache-Control: no-store`; order/access replies
also use `Referrer-Policy: no-referrer`. Responses are parsed against the generated
`hosted-checkout` contract before the command commits and before HTTP sending.

Under `/api/v1/public/stores/:slug`:

| Method | Suffix | Success | Access and admission |
| --- | --- | --- | --- |
| POST | `/cart-quotes` | 200 | quarantine, checkout setting, injected store admission |
| POST | `/checkouts` | 201 new / 200 replay | same gates; secret Idempotency-Key; ensures checkout device grant |
| POST | `/checkouts/:checkout_ref/orders` | 201 new / 200 replay | same gates and live checkout device grant |
| GET | `/orders/:order_ref` | 200 | live device grant or original member buyer |
| POST | `/orders/:order_ref/payment-handoffs` | 201 | same buyer read access; resume or verified-unpaid re-pay with admission/payment/hold gates; 409 pending includes Retry-After during the initial delay |
| POST | `/orders/:order_ref/payment-queries` | 200 public order | same buyer read access, quarantine/checkout gates; 30/network/10 min and shared 1/order/min + 10/order/hour; 409 busy lease, 429 with Retry-After |
| POST | `/orders/:order_ref/access` | 200 | not quarantined, matching single-use live link |
| POST | `/order-access-requests` | empty 202 | not quarantined; an installed email port is required |

`POST /api/v1/public/order-access/forget` accepts `{}` and returns empty 204.
It revokes the current device and clears the cookie. During quarantine it still
clears the cookie and returns 503. Order reads remain available when checkout is
off, the host is quarantined or store admission is withdrawn.

| Error | Status | Meaning |
| --- | --- | --- |
| `commerce_quarantined` | 503 | New checkout/access effects suspended |
| `checkout_not_enabled` | 409 | Host setting or store admission is off |
| `checkout_order_not_found` | 404 | Uniform failed order/credential/store match |
| `checkout_idempotency_conflict`, `order_intent_conflict` | 409 | A retained key has different content |
| `consents_mismatch` | 422 | Freeze consent set differs from current required policies |
| `terms_changed`, `checkout_expired` | 409 | Recompute or checkout deadline prevents placement |
| `payment_profile_unavailable`, `payment_handoff_unavailable` | 409 | Unsupported credit terms or no resumable one-time handoff |
| `checkout_order_closed`, `checkout_hold_expired`, `payment_already_applied`, `payment_attempts_exhausted`, `payment_result_pending` | 409 | Order and payment conflicts in cancellation, re-pay and on-demand payment queries; the initial re-pay delay includes `Retry-After` |
| `stock_unavailable` | 409 | Per-SKU available quantities accompany the error |
| `unresolved_order` | 409 | Existing unpaid order reference accompanies the error |
| `too_many_open_orders` | 429 | Device or normalized email has three open orders at this store; database-clock Retry-After |
| `commerce_rate_limited` | 429 | Bucket exhausted; `Retry-After` uses the database clock |
| `order_access_email_unavailable` | 409 | No email adapter; rejected before SQL access |
| `validation_failed`, `invalid_checkout_json`, `checkout_contact_too_large` | 422 | Invalid structural request or bounded JSON |
| `internal_error` | 500 | Internal codes including `reservation_inconsistent`, `version_overflow` and `tenant_context_unavailable`, response validation and unexpected errors; fixed detail and code-only log |
| `shipping_not_configured`, `shipping_unavailable` | 409 / 422 | No current structural shipping quote |

The other closed contract error codes cover unavailable publication/supply,
contact, store readiness, invalid totals and the platform request gate. Delivery
and invoice contents are structural only: objects, UTF-8 byte limits, depth at
most eight and at most 2048 nodes each. The quote's optional delivery uses the
same walker and byte limit. All input text must be well-formed Unicode without
U+0000, including SKU, contact, B10, redemption and nested buyer JSON strings/keys.
Delivery/invoice reject `aggregate_version` at every depth with
`invalid_checkout_json`, because `wireVersionResponses` rewrites that reserved key. Required consents are an exact set from
the injected policy port, empty by default; placement recomputes them too.

The browser cookie is `__Host-freedom_shop` on HTTPS, `freedom_local_shop` on HTTP:
HttpOnly, SameSite=Lax, Path=/, Secure on HTTPS, no Domain, remaining absolute
180-day Max-Age. Only its SHA-256 is stored. Duplicate cookie names are rejected.
A device spans stores; its grants are tenant-scoped and immutable except one-way
revocation and link redemption. Checkout grants cover that checkout; redeemed
links grant only one order. Session membership alone never authorizes placement.
Checkout replay grants access only before its absolute expiry and before any
order exists; otherwise it returns `checkout_expired` without a device, grant or
cookie. Its fingerprint ignores login/logout/member switches and keeps the first
customer member link. Checkout responses, including replays, allowlist only the
public terms fields: revision, currency, priced items, discounts, group references
and shipping amounts, tax state, totals, consents, payment methods and nullable
`offline_payment`. They omit
internal publication, supplier, selection, binding and contact digests. The returned
`terms_sha256` still hashes the full retained terms and placement checks it.

A quote classifies supplier failures per line as `unavailable`; seller liveness
still fails the whole request and the checkout/placement lock path stays strict.
Merchandise totals sum only `ok` and `revision_changed` lines; total is null when
shipping is unquoted or any line is insufficient/unavailable.

Only active person principals are recorded on create; disabled principals are
guests. Order reads take no session/user row locks and make no writes.
The first placement records its optional member buyer; retries never link a new
buyer. Reads neither refresh devices nor write grant/session activity.

Access links contain 32 random bytes in a fragment, expire after seven days and
redeem exactly once in the same transaction as the order grant and device cookie.
Redemption first locks the immutable link identity, then checks the database clock,
revocation and one-use state in a separate statement. It checks link expiry again
after device/grant/order processing, before committing. Expiry during either lock
wait returns the same `checkout_order_not_found` 404 and rolls back the redeemed
marker and all device/grant writes; no cookie or private order response is sent.
The fixed 168-hour lifetime, token and order scope never change. An original
checkout key cannot restore access after placement/forget; B10 can issue a fresh
link that restores access to that order only.
B10 requires an injected `CommerceEmailOutbox` (`options.email`, installed only
when `FREEDOM_COMMERCE_EMAIL_ENABLED` is true); without it, B10 returns 409
`order_access_email_unavailable` before any SQL access. When installed, B10
matches the store's display number and unredacted normalized customer email and
queues an `order_access` row in `commerce_outbound_emails` (plus its
`commerce_due_work` entry) with a fresh `access_request_id` inside the same
transaction as the rate-limit charges and lookup, without creating a link or
sending inline. Unmatched, redacted and rate-limited requests all return empty
202; the route triggers `runDueCommerceWork` for the queued `email_id` through
`afterResponse` after commit, and the due-work executor mints the one-time access
link at send time. Only customer email and checkout contact email hold canonical
plaintext; no extra copy enters the outbox, grants, buckets, errors or logs.

`COMMERCE_LIMITS` is the single constants table: cart network 60/min and store
600/min; checkout network 30/10 min and store 600/10 min; placement network
10/10 min and store 300/10 min; three open unpaid unexpired orders per device and
normalized email at the same store; three new orders per network/30 min; B10 network
10/hour, hashed normalized email 3/hour and global 300/hour; redemption network
30/10 min. Commerce buckets share `auth_rate_limits` under a `commerce:` prefix.
Every attempt that passes the limiter is counted, including failures, unknown
slugs, conflicts and replays. Attempt budgets commit in a short transaction before
the command; limiter rejections roll that budget transaction back. Store buckets
use the public slug resolution without admission or locks; unknown slugs count
only the network. The cart then runs its separate READ ONLY transaction with no
settlement, holds or bucket locks. Checkout and placement similarly start after
their attempt budgets commit; failed/expired/used-token redemptions remain counted.
B10 still commits budgets with its lookup and answers 202 on exhaustion.
Only the new-order network approximation stays in the placement transaction,
counts new orders and rolls back on failure. Open-order counts and advisory locks
are scoped to the store tenant and instance; their 429 includes Retry-After from
the database clock until the earliest counted prior open order expires (at least 1).

Host checkout, console, quarantine and email settings default off. Checkout requires the console setting,
which requires the launchpad setting. Production installs store admission, the SQL-local shipping quote port,
the optional configured payment port and, when `emailEnabled` is true on the Worker, the email outbox and
Worker sender. A caller-supplied `commercePorts` override replaces those ports, so checkout tests and the
ECPay end-to-end fixture keep their own shipping port. Policy ports remain absent unless a caller injects one.
The scheduler sweeps up to 200 due holds before GitHub sync
whenever quarantine is off, including when checkout creation is disabled.
`commerce.hosted-checkout.v1` is a mandatory write floor from planned or retained
schema168, independently of feature flags. It grants no payment or deploy authority.

Known residuals: someone who knows a buyer's email can still fill that buyer's
three open-order slots at one store. B10 email buckets use the same unsalted hash
as the platform auth limiter; the database already holds plaintext email in the
customer row. A valid cookie makes reads of a real order ref in that store take
two more queries than a random ref.

## Shipping quote

`ShippingQuotePort` is optional on `CheckoutPorts`. `quote` freezes one shipping
object for checkout and placement. `cart`, when present, prices delivery options
inside the read-only cart transaction. The store argument is the full store
profile. Lines carry sku, item, quantity, server unit price, supplier shop and
`own` (true only when the binding's supplier instance is this store). `own` is
not stored on the frozen binding. The port sorts lines by SKU with code-unit
order. Checkout calls `validateShippingQuote` on the result and stores that
object. A programming failure throws `Error('shipping_quote_invalid')` with no
buyer data; the route maps that to 500.

`CheckoutDeliveryProblem` is the buyer-facing shipping error:
`shipping_not_configured` (409, 「尚未設定配送。」), `delivery_invalid` (422, with
1–20 field paths), `shipping_unavailable` (422, one line per failing SKU), and
`delivery_store_required` (409, 「請先選擇取貨門市。」). Field paths are `delivery`,
`delivery.method`, or `delivery.` plus an ASCII identifier, at most 80 characters.
A key that cannot be represented that way is the generic `delivery` path and is
not copied into the response. The route adds `fields` or `lines` only when the
array is non-empty, then parses the body with `CheckoutErrorSchema`.

The frozen shipping object is internal. `publicCheckoutTerms` publishes
`destination_state` and, per group, `group_ref`, `method`, amounts, parcel count,
handling days, SKU quantities and `meetup_note`. Shop ids, agreement ids,
versions, locations and service keys stay off that view. `payment_methods`
contains the available methods in canonical order: `immediate_card`,
`bank_transfer`, `cash_on_meetup`. Frozen `offline_payment` contains the settings
version and the deadlines for the listed offline methods; it never contains bank
account details. Cart `payment_options` also reports unavailable methods and their
reasons, including membership and meetup requirements. Meetup's method reference
is exactly `meetup`.

Placement recomputes terms and compares `terms_sha256`. A shipping change is
`terms_changed`. Immediately after that recompute, and before the unresolved-order
lookup, placement requires `shipping.destination_state === 'complete'`. A missing
state fails closed as 409 `delivery_store_required`, so a convenience-store quote
cannot be placed until a later map job stores the chosen shop. Production
supplied lines are `fulfilment_not_agreed` until agreements exist. The test-only
`syntheticShippingQuote` helper is not imported here. It may model an already
agreed drop-ship line for consent regressions, and it rejects a supplied meetup
line instead of building a drop-ship meetup group.

## Deliberately outside this slice

Refund execution, fulfilment/shipment aggregates,
return-case resolution, invoices and the
buyer pages that consume link fragments remain separate milestones. Domain
functions accept verified payment, handover and inspected-return facts from those
modules. Imported finance and direct/shared v1 DTOs keep their separate profiles
and literal-false payment/fulfilment fields. Schema168 remains expand-only.


## Payment port and shared exceptions

Checkout never imports the payment implementation; the operations executor
dispatches payment due work. `CheckoutPaymentPort` is optional
in `CheckoutPorts`, injected alongside admission by the runtime and passed through
`hostedCheckoutOptions`. Without it, domain tests retain M1 behavior. Its methods
validate credit terms, create the initial attempt after holds, issue/reissue the
one-time handoff, reconcile cancellation and summarize payment state. Creation
and placement call profile availability before effects; invalid unit/net/shipping
amounts or total cause payment_profile_unavailable with fixed Chinese text.
Placement and replay return a fresh token only while the attempt is issued and
has not been handed off. The buyer resume endpoint uses the same stored gates.

`CheckoutPaymentMethodsPort` is the optional sibling of that card port. Hosts
inject it whenever a provider profile is listed. `choosePaymentTerms` freezes the
offered methods and an `offline_payment` block that carries the settings version
and deadlines only. `placeCheckoutOrder` stores the chosen `payment_method` on
`commerce_checkout_orders`. An immediate card expires 30 minutes after creation.
Bank transfer and cash on meetup expire `24 * deadline_days` hours after creation
and schedule `offline_payment_window_end` for `expires_at + 72h`. Hold release at
`expires_at` returns the stock and leaves the order open, so a seller can still
confirm it until the grace handler cancels it. Card settlement does not cancel
an offline order.

`cancelPublicOrder` cancels an open unpaid card or offline order as
`buyer_cancelled`. A second cancel returns the same order. A confirmed payment
answers `payment_already_applied`. Quarantine answers 503 before any change. The
route is mounted with the other public checkout paths and is not part of the
tenant route table.

`publicOrder` uses the payment summary port. Outstanding unapplied payments take priority in the payment port; recorded offline cancellations read as refunded. Other orders retain confirmed applications,
fully refunded unapplied payments, pending hints, simulated applications and unpaid. The latest attempt exposes only a coarse state and creation time;
can_resume_payment runs the same eligibility checks as resume. Provider/account
facts and exception cases never enter the buyer DTO. Resume and order replies
use no-store and no-referrer; the 30-per-10-minute resume network budget commits
before the command.

`exceptions.ts` owns the shared payment exception policy and `openException`.
All seven payment kinds are the retailer's responsibility, with an adjustable
72-hour due interval and a policy-owned next_action. The partial open
identity index makes event replay idempotent; closing requires status, resolution
code/note and resolver together and cannot be revised. Resolution notes use fixed server templates and are protected by the exact
tenant RLS policy used by checkout contacts. Seller routes below handle cases. See
[EC-SPEC-05 §7.1](../../../docs/platform-plan/execution/commerce/EC-SPEC-05-fulfilment.md)
and [EC-SPEC-04](../../../docs/platform-plan/execution/commerce/EC-SPEC-04-payment.md).

## Seller checkout HTTP

The console flag mounts these routes under
`/api/v1/tenants/:tenant_id/storefronts/:instance_id`. All replies are
`private, no-store`; every route first requires the instance's `store:read` gate.
The installed storefront 1.1.0 release must contain each requested capability;
owners/admins on 1.0.0 receive 403. These are independent of v1's `/orders` routes.

| Method | Suffix | Additional capability | Headers / budget |
| --- | --- | --- | --- |
| GET | `/checkout-orders` | `store:orders:read` | Signed cursor; limit 1–50, default 20 |
| GET | `/checkout-orders/:order_id` | `store:orders:read` | Order-version ETag |
| GET | `/checkout-orders/:order_id/contact` | `store:customers:read` | No ETag; 300 attempts/principal/hour, including denials |
| POST | `/checkout-orders/:order_id/cancel` | `store:orders:manage` | Idempotency-Key + order If-Match; `{}` |
| POST | `/checkout-orders/:order_id/payment-queries` | `store:orders:read` or `store:finance:read` | No command headers; `{}`; shared 1/order/minute and 10/order/hour |
| GET | `/checkout-orders/:order_id/refunds` | `store:finance:read` | Oldest first, at most 100 |
| POST | `/checkout-orders/:order_id/refunds` | `store:refund` | Idempotency-Key; no If-Match; 201 |
| GET | `/exception-cases?view=retailer` | `store:orders:read` | `state=open|closed`, signed cursor, limit 1–50 |
| GET | `/exception-cases/:case_id` | `store:orders:read` | Case-version ETag |
| POST | `/exception-cases/:case_id/actions/:action` | `store:orders:manage` | Idempotency-Key + case If-Match |

Order lists accept only lifecycle, needs_action=true, an exact uppercase stored
display_number, cursor and limit. Display numbers are authorized filters, never
credentials. Cursors bind purpose, principal, tenant/scope, instance and canonical
filters; decode follows authorization. Orders sort newest first. Open cases sort
by due date then ID; closed cases sort by updated date then ID descending. Cases
without orders, including activation and unmatched payments, remain visible.

Order DTOs include only the first trimmed Unicode code point plus ○○, or null
with contact_redacted=true. The separate delayed contact read rechecks current
capability/redaction after spending only the caller's own principal allowance.
Contact, delivery and invoice fields never enter order or command DTOs. Finance
attempt/application/refund details and case payment facts require finance read.

Read-time axes remain independent: lifecycle is retained; payment uses the payment
port (confirmed/unpaid fallback without it); inventory prioritizes unallocated
payments, then allocation remaining/shipped counters, then held/hold_expired and
released. Reads never settle holds, lock commerce rows or invoke checkoutInventory.
A past-due retained held row reads hold_expired without changing the row. Detail
actions reflect current capabilities, tenant state, payment/inventory facts and
quarantine; every command repeats its own authority checks.

`sellerCheckoutCommand` uses scopedTenantCommand with a shared tenant lock and
instance capability checks, without requiring an active selling deployment.
The tenant must remain active and the instance cannot be archived/failed.
Cancelling, refund recording and case handling continue on paused stores and
when checkout is off. Quarantine returns 503 for writes and seller queries;
reads remain available. The runner stores only `{ id }` in command receipts,
then projects current rows in that same transaction; receipt replays re-project
and revalidate authority. No personal or masked contact value is retained there.

Cancellation checks the locked order version, calls cancelUnpaidOrder with the
stored profile selector and payment hook, and returns the new ETag. Missing/stale
If-Match gives 428/412; confirmed payments or closed orders give 409. Cancellation
replay preserves the row and handed-off attempts receive scheduled queries.

Cases lock last, after attempt or allocation locks. resolve_with_evidence permits
refunded for mismatch/after-cancel/overpaid, confirmed or checked_with_provider
for unconfirmed payment, and checked_with_provider for unmatched/contradicting
events. confirmed requires a confirmed subject attempt under FOR SHARE.
retry_allocation is exclusive to paid_unallocatable and closes in the same
transaction as allocation; failures leave both unchanged. Dates use the database's
Asia/Taipei day, real calendar validation, and a restricted reference. There is
no free-text input or dismiss action. Fixed resolution notes are:

| Code / action | Note |
| --- | --- |
| refunded evidence | 店家已在綠界後台退款（{provider_date}，參考號 {provider_reference}）。 |
| checked_with_provider | 店家已在綠界後台核對（{provider_date}，參考號 {provider_reference}）。 |
| confirmed | 付款已向綠界確認。 |
| allocated retry | 補貨後已重新配貨。 |
| fully recorded refund | 店家已登記全額退款。 |

See [security §2.2–§2.5 and §4](../../../docs/platform-plan/execution/commerce/EC-SPEC-09-security-ci-tests.md),
[payment exceptions/refunds](../../../docs/platform-plan/execution/commerce/EC-SPEC-04-payment.md),
[order axes](../../../docs/platform-plan/execution/commerce/EC-SPEC-03-order-inventory.md)
and [release obligations/quarantine](../../../docs/platform-plan/execution/commerce/EC-SPEC-10-release-operations.md).
E05/E09 pages await the Supplier Console shell; this module supplies their DTOs,
capabilities and actions without adding seller pages.


## 店家自行寄送 B（2026-10-22）

`self_ship` 是無外部帳戶的獨立方式；每單定額、一單一包、銀行匯款、自有商品。收件資料只在原 contacts.delivery，正規化後計算摘要。原 `recordHandover` 原子寫 ship movement；同單唯一不可改寫的 `commerce_self_shipments` 只允許一次個資遮蔽。供貨仍 `fulfilment_not_agreed`；出貨不關單。參見 EC-SPEC-05 §2.7、EC-SPEC-09 §3。預設 flag OFF，既有訂單仍可履約；沒有 email、API carrier 呼叫、標籤或貨態同步。PR-A public guard 由完成保留排程的 PR-C 解除；UI 另由 PR-B 提供。

## Paid offline cancellation (Ted 2026-10-23 approved b.1)

The seller paid-cancellation command requires orders:manage; recording a refund
also requires store:refund. The separate refund command needs store:refund.
Both reuse sellerCheckoutCommand, session/CSRF, idempotency and If-Match. Open,
confirmed offline orders are eligible until any self-shipment, meetup handover
or shipped quantity exists, regardless of the frozen delivery method.

cancelPaidOfflineOrderHeld reuses cancelPaidOrder, releases remaining holds,
retains the full payment, reason and private merchant note in
commerce_paid_cancellations, closes open paid_unallocatable cases as cancelled,
and emits the member buyer notice in the same transaction. The refund can be
pending or recorded immediately. A pending refund can be recorded exactly once
with a Taipei date between confirmation and server today and bank_transfer or
cash. The store moves money outside the platform; the platform never verifies it.
The buyer projection omits the merchant note. Retained member detail uses that
same public projection; the metadata-only member list keeps its existing ACL.
No card refunds, returns, partial cancellation, email, new flag or approval step
are added. Existing scoped receipts retain references and replay current rows.

The integrated supplier `fulfiller_unable` case points to the original order for
whole-order offline cancellation and refund recording. It has no card-provider
evidence action. Cancellation resolves the case in the same inventory transaction;
a later supplier shipment can instead resolve it as shipped.

## Minimal standing drop-ship (2026-10-23)

With drop-ship intake enabled, accepted exact-version consent resolves supplied
selections once per quote. A checkout contains either only store-owned lines or
only selections covered by one agreement; mixed shippers require separate
orders. Manual drop-ship freezes supply unit costs, the per-order fee including
postage and the weekday promise in private terms. Public terms disclose only
manual supplier fulfilment and the buyer's store postage; supplier costs and the
agreement digest stay private. Existing own-line public group keys are preserved.

Only bank transfer paid to the store is available. Revocation or intake off
blocks new placement, while frozen orders retain their supplier and terms.
Supplier reads and writes stay in Commerce, through the fulfilment module's
explicit authorization and strict contact allowlist; no recipient projection,
read window, read receipt, per-order acceptance, payable, statement, ECPay service or
email is introduced. The store still owns cancellation, refund and service.
