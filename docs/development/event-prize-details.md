# Event prize descriptions

This slice stores organizer-written prize descriptions. It does not select winners,
verify attendance or completion, issue rewards, reserve stock, collect addresses,
or connect prizes to XP, credits, checkout or fulfilment. RSVP, an ended event and
an outcome post are separate facts. Custom photos are not supported by this slice.

## Contract

`prize_details` is an ordered optional list on event create/update. Create omission
means `[]`; update omission preserves the stored list; explicit `[]` clears it.
Existing rows receive `[]`. Each strict item contains a stable UUIDv4 `prize_id`,
`name`, optional-content `description`, integer `quantity`, allowlisted `icon_id`,
required `completion_rule` and required `claim_note`. IDs are generated only when
adding an item, preserved during edits and retries, and unique within an event.

The five-item, 500-unit and 120/500 Unicode-code-point bounds are technical anti-abuse limits,
not a reward policy or promise of stock. Text is plain text, trimmed on input. Zod 4 and SQL count Unicode code points;
new form fields use the same validity check with a 2× UTF-16 native safety bound.
Built-in illustrations use the shared catalog and are not photos of actual prizes.
The public reader does not load the organizer's form or image picker.

The original authorization, visibility, review, pending/future edit guard, version
CAS and command receipt transaction remain authoritative. A published event cannot
silently reduce its prize promise through the pending-event update route. Lists
and public details follow the existing event visibility policy; no attendee data
or private contact information is newly exposed.

## Recovery and integration

A save attempt snapshots the entire prize list. A successful response must match
its event/organizer/next version and canonical list before settling it. Unknown
responses retain the original body, key and version. Draft ownership and same-tick
save fencing reuse the minimal existing #1230 owner mechanism; full integration
must preserve that PR's metadata/media classifiers. The standalone route identity
gate covers the known #1257 fallback; full integration uses #1257's complete read
owner mechanism. Neither dependency is a newly discovered independent fix.

Migration 199 is additive. The main schema198 event UPDATE names its original
columns, so it preserves an existing prize column. Its strict create/update input
rejects the new field, and its old public projection/UI omit prizes rather than
claiming they were issued. This is not old-binary support for the new content.
API and UI readers must roll out consistently before relying on prize displays.
No new global capability floor or runtime flag is introduced; exact schema ledger
approval and retained historical schema checks remain required. Recheck the main
and open-PR migration frontier before integration. No migration is run by this PR.

Pure DTO, ReactDOM synthetic-host and release-planner tests are local evidence.
The in-process Hono middleware tests use throwing database and external-fetch
fences, without listening on a port. They verify request guards, not persisted
results. The database-backed HTTP suite and mobile keyboard/layout journeys are
authored for official CI.
Test discovery is not browser execution, and synthetic focus is not native-browser
or elder/child usability acceptance. Native browser and DB integration remain open
acceptance gates, including applying migration 199 to an existing populated schema.

## HTTP envelope

Only POST `/api/v1/events` and POST `/api/v1/events/:uuid/update` use a 160 KiB
JSON transport ceiling. All other methods, malformed IDs, extra path segments,
wrong-case literal paths, review and RSVP keep the existing 32 KiB limit. UUID
hex digits may use either case; the route literals remain case-sensitive. The original Content-Length and
streaming guards both apply, with early cancellation. Maximum bounded text plus
five prizes fits even when supplementary Unicode and JSON keys are encoded as
UTF-16 `\\uXXXX` escapes (about 158,300 bytes with ordinary ISO timestamps).
This is a transport bound, not a promise to accept unlimited whitespace, padding
or timestamp fractional precision. Existing event field schemas are unchanged.
