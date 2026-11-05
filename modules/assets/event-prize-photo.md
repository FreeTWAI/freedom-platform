# Saved event prize photos

`community.event-prize-photo` is a closed purpose for one current photo per
saved prize in a saved event. It does not reuse banner or commerce authority.
`prize_details` remains the strict seven-field descriptive contract. The only
read projection is `prize_photos: [{prize_id, photo_version, url}]`, with an exact
same-origin member or anonymous route. Raw Asset/target/object identities,
storage URLs, source digests and bytes never enter that projection or its ACK.

Events in `pending` have already been submitted for review. Organizers may add,
replace or remove photos only while pending and before the database start time.
This is not a private pre-submission draft. A reviewer approving first, an event
starting, or another event edit/photo committing first rejects the unfinished
write. The event's `aggregate_version` is the sole business CAS.

The server derives a UUIDv5 target from the canonical `(event_id, prize_id)`
tuple under its fixed namespace. Clients cannot submit that target, a purpose,
Asset, scope, owner, policy or object proof. Preparation locks the existing
receipt, community-purpose quota, event and retained target in that order. The
shared engine owns pending/processing/stored/finalized, immutable PUT effects,
fences, leases, current session clocks and verified readback. A target remains
for historical intents when its current pointer is removed.

Input is static PNG/JPEG/WebP, at most 2 MiB, 4096 pixels per side and 16,777,216
pixels. Complete framing precedes the installed full decoder. Output is
metadata-free canonical WebP, inside 1920×1920 without enlargement or cropping,
at most 1 MiB. Storage independently validates canonical dimensions. This is
image checking and conversion, not malware scanning or content review. Missing
verified decoder or storage fails closed, never saving the source as fallback.

A scoped command receipt binds operation, method/path, event/prize, expected
version, original MIME, byte length and source SHA. Probe and historical replay
always check the current owner/session/principal/community first. Historical
success does not require the event still to be editable or the prize/photo still
to be current. It does not attach an old photo or advance the event again.
Current required onboarding is re-read from the locked user row, including
historical replay and both member-byte snapshots, rather than trusting a prior
HTTP actor snapshot. Text deletion that detaches photos uses this guard too.
The immutable ACK binds original key, owner, event/prize, operation, exact
expected+1 completion version, and photo version/route or null for removal.
The UI must separately read current state after ACK.

Finalize repeats verified object I/O and current authority/policy before one
SQL transaction makes the new Asset ready, increments event CAS, swaps the
pointer, retires the old Asset, finalizes the intent and commits the domain
fact/outbox/receipt. Publication uses only already-held domain/Asset locks.
An upload failure leaves the previous current pointer unchanged. Removal does
not require new-upload policy or storage. Deleting a prize in `updateEvent`
locks all affected targets/Assets, refreshes session/deadline clocks, then
removes pointers and retires Assets in the same event update transaction.
When photos were detached, the legacy receipt write also repeats the original
and new schedule deadline plus session clock, rolling back a receipt wait that
crosses the editable window without applying that check to historical replay.
Omitted prize JSON or retained IDs preserve pointers. Deleting then re-adding
an ID never revives its old photo. SQL refuses legacy writers that remove a
prize while its pointer remains, and requires same-transaction retirement.

Member reads repeat current member session/principal/community, original event
visibility/reviewer/guild predicates, active owner, prize, pointer, exact ready
unfenced Asset and object identity around one full digest-verified GET. Public
reads use only published referral/open authority and never upgrade from cookies.
Cancellation/withdrawal or pointer changes during GET reject the returned bytes.
All responses are no-store; member reads additionally use private/Vary Cookie.
There is no conditional 304 or unchecked partial Range path. Server revocation
cannot recall bytes already downloaded.

An authorized organizer can read the closed member-only
`GET /api/v1/events/:event/prizes/:prize/photo/availability`. Its only fields are
`event_id`, `prize_id`, `organizer_ref` and `upload_available`. It creates no photo
target or intent and exposes no policy, quota, scope or storage identifiers.
False includes unavailable canonical policy, missing runtime ObjectStore or a
non-editable event. Errors or an unconfirmed response never enable a new UI
upload. This is only a point-in-time hint that an upload can be attempted, not an
authorization or persistence guarantee. Every write still repeats all gates.
Existing-photo removal and original unknown-command recovery do not depend on
this hint. Later false or an ordinary GET never settles or discards an unknown
original File/key/version tuple.

Migration 201 defaults the new canonical policy to legacy, persistence false,
revision/quota null. Legacy means unavailable, not a bytea fallback. The Worker
only reuses an installed ObjectStore transport; no avatar/banner permission or
live flag enables this purpose. No policy, credential, grant, maintenance job or
platform capability floor is enabled/expanded by this source change. Stored,
retired, expired pending and uncertain effects all remain charged conservatively.
New-purpose GC remains closed. Removing a picture does not promise physical
erasure or reclaimed capacity. Real R2 backup/restore remains a separate gate.

Validation evidence belongs in the dated delivery report. Controlled-processor,
mock-store and in-process HTTP tests are not PostgreSQL, native decoding,
Worker/R2, browser accessibility, production rollout or user acceptance.
