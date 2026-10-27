# Google identity candidate

Default OFF. This source change does not register an OAuth application, configure
credentials, grant Google access, deploy, or authorize a release. Operators must
review the draft and separately install an exact-origin web client and working
mailbox recovery before opting in. Only `openid email` is requested; no offline
access, refresh token, avatar, Google display name, or role is imported.

## Identity and recovery

The immutable key is (`google`, `sub`), never email. A subject can map to only one
member, and a member has at most one Google subject. Email conflicts never merge
accounts: sign in using the original method, then explicitly link after entering
the current real password. Linking a non-Gmail Google account is allowed only
through that existing authenticated-account flow.

New passwordless registration is limited to verified `gmail.com` mailboxes or
verified Workspace mailboxes with a valid hosted-domain claim. This is a bounded
first phase, not support for arbitrary Google-email signup. Future Google emails
never overwrite the platform recovery mailbox. Google does not replace platform
TOTP, onboarding, community boundaries, grants, or member authorization.

A provider-only member has SQL NULL password_hash, not a generated password or
fake hash. Existing mailbox password recovery sets a real password and preserves
TOTP. Password checks reject NULL while paying the normal dummy derivation cost.
Changing email, enabling/disabling TOTP, deactivating, linking/unlinking, and tenant
high-risk operations still require their existing real-password checks. Settings
explain first-time password setup using the current verified mailbox. Disabling
Google leaves mailbox recovery and existing password login available. Status and
password-verified unlink remain available, but OFF refuses new starts/completions.

## Protocol and concurrency

Full-page authorization-code flow uses S256 PKCE, nonce and random state. The
HttpOnly browser-flow cookie is Strict; the existing member cookie stays Strict.
The callback page strips its query and POSTs same-origin, never exempts a callback
mutation from Origin/CSRF or imports a token from a query string. Link operations
also require the original active session and unchanged password hash. Anonymous
starts refuse an already-active member session rather than switching accounts.

The database commits a one-use state claim before provider I/O. Unknown remote
outcomes require a new flow; there is no code-exchange retry. Final local effects
require the retained state and DB decision-clock deadline. Normal password login,
registration, successful password recovery, and logout cancel the same browser's
pending state/challenges/activations. Cancellation can remove a claimed state while an exchange
is in flight. Provider calls occur outside database locks. User locks precede
identity/challenge locks; subject/email constraints arbitrate races. Failed final
checks roll back newly created users, preferences, identities and sessions.

Existing platform TOTP/backup codes run before session creation, with the same
persisted failure budget. Short-lived challenges bind browser, original cookie,
identity ID and credential hash; unlink, password recovery, cancellation, expiry
or account deactivation cannot revive them. Replay cannot create another session.

Completion (including TOTP) creates only a dormant SQL session: its expiry is
already reached and both presence timestamps are NULL. It cannot authenticate on
any existing route. The response sets that cookie once and returns an in-memory,
one-use activation secret. A separate ACK requires the exact cookie, browser-flow
proof, active identity generation, unchanged credential digest and account version.
The proof expires after one minute. ACK locks user, session and proof, rechecks the
DB deadline after waits, then activates the session with an absolute lifetime capped
at original issuance plus 30 days. ACK and ACK retries never set cookies. The client
re-reads /session and compares user and CSRF before installing current authority.

Successful ordinary login/register/reset/logout always delete only the new Google
flow cookie, including when Google is OFF or that request had no marker. This is
necessary for a normal request queued before the first Google start response.
All auth-serving instances must run this compatible source before enabling Google;
a genuinely old binary cannot provide that deletion guarantee. OFF otherwise keeps
existing session-cookie, response and authority semantics, apart from NULL-safe
password support and the explicitly documented account capability field.

Browser response ordering is not made seamless: a very late dormant cookie can
clobber a newer cookie and require re-login, but cannot activate without its current
browser proof. Once ACK succeeds, no Google Set-Cookie response remains in flight.
Concurrent independent ordinary logins retain their existing semantics. Expired or
revoked dormant proofs are pruned with their sessions under session locks. A newly
registered account can persist if activation is abandoned; its stable identity and
verified-mailbox recovery remain usable. Unlink keeps a revoked-subject tombstone;
explicit relink creates a new identity generation that rejects older callbacks.
Unlink carries the exact identity ID from the owner-only status read, in addition
to current session and real-password verification. A missing or changed generation
never falls back to the current link and cannot clear newer pending flows. A stale
replay returns a conflict rather than an idempotent success; reread status and make
a new explicit choice. No password-bearing receipt is stored. After success the
UI rereads status rather than assuming no concurrent link exists.

Only sanitized errors are returned. Provider codes, ID/access tokens, nonce,
verifier, client secret and password are not journaled or logged. The browser keeps
authorization response/challenge in memory only. Public capability returns one
boolean, never client secret or server configuration. No Google script/iframe or
CSP relaxation is used.

## Schema and rollback

Migration 190 adds identities, pending states/challenges/activations and nullable passwords.
Historical SQL bytes and known gap 22 remain unchanged. The source-only Cloudflare
migration catalog and catalog regression now include 190; this does not claim it
is deployed. The canonical `deploy/cloudflare/sql/20-runtime-grants.psql` grants ordinary app
DML and migrator default privileges (lines 7–10); migration and grants must be
reviewed/applied together after migration or restore. The restricted-role test
executes canonical 20/40/45 grant SQL with fixture schema/role substitution, using
real non-owner LOGIN connections, for both pre-190 defaults and post-190 repair.
Broker/executor allowlists exclude all four Google tables. These are global auth
tables, not tenant-RLS tables: the shared app role is not a tenant isolation proof.
No new tenant/runtime/credential-custody authority is added. Expired OAuth rows are
pruned in bounded SKIP LOCKED batches, including when Google is OFF.

After the first provider-only account exists, rolling back to binaries that assume
non-null password hashes is unsafe even if Google is OFF. Keep migration/data and
the NULL-safe password guard/recovery code. Do not invent passwords, delete identities,
merge users or set NOT NULL to force a rollback. Operator review is required for a
compatible rollback/recovery plan; no down migration is supplied.

Node options and Worker bindings are explicit. FREEDOM_GOOGLE_LOGIN_ENABLED must
be exactly `true`, and GOOGLE_LOGIN_CLIENT_ID / GOOGLE_LOGIN_CLIENT_SECRET and a
mailbox sender must all exist. This PR supplies no values or live configuration.

## Evidence requirements

Tests must cover real signed ID-token validation; email/sub conflicts; nonce,
PKCE/browser/session binding; cancellation/replay; concurrent callback and unlink;
TOTP/backup/failure budget; deactivation; password setup and OFF recovery; email
change/recovery revocation; expiry after lock waits; Node/Worker flag isolation;
exact public-auth allowlist; existing password and sensitive-operation guards.
Full browser coverage remains required. Synthetic tests do not establish live
Google acceptance, real-device behavior or deployment safety. A sandbox-blocked
browser run is not a pass.

Official protocol references:
- https://developers.google.com/identity/openid-connect/openid-connect
- https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
