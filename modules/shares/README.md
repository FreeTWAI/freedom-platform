# Shares

One canonical thing per community, with an append-only fact ledger. Repository identity is the GitHub numeric ID of the upstream original; generic links use normalized URL SHA-256. Existing domain adapters retain current source visibility on every read. Registering a reference never republishes private content.

Writes use member commands and current authority before replay. Share preparation and cache reads happen outside command transactions. GitHub credential operations retain the existing locked session/token lifecycle. Node link fetching uses the host's DNS-pinned transport; Worker links are restricted to the existing provider allowlist. No ambient fetch fallback for arbitrary URLs. Repository requests use fixed api.github.com coordinates, bounded bodies, deadlines and no redirects.

Credit is display-only: no score, XP, money or permissions. Every fact has a unique source key; negative rows reverse exact prior facts. UPDATE/DELETE are rejected in SQL. Hidden/retracted shares atomically append reversals. Test accounts and self-conversions are excluded in SQL. A link-out is never evidence of a star.

Run `tests/runtime/shares.test.ts` against an explicitly provisioned disposable database. Migration 204 is additive; old books, pages, grants and bundles remain.

Events publish through the event adapter and the existing member command envelope, so an agent's approved request digest remains the original HTTP body. The internal `event-ledger.ts` port accepts already-authorized database rows in the caller's transaction; it is not a client assertion API. New publication uses the same shared-content daily quota as links and repositories, in addition to the event quota. Retained pending-event conversion preserves the original creation time and does not consume a new-member-action budget.

Registration credit reads confirmed RSVP facts. The ledger fingerprint deduplicates normalized guest/member email; an event-owned member identity marker additionally prevents another credit after an email change. External registration interests never enter this conversion lane. Moderation retains the shared core's exact reversal rules.
