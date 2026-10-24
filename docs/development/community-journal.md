# Native community journal and Mio submission protocol

PR #985 replaces its earlier external iframe with the complete original journal layout, platform-owned API/database and same-origin assets. The old journal site remains an independent output of the same authorized source snapshot. A successful upload is a draft receipt, not publication or proof that both sites display that revision.

## Ownership and release

Platform maintainers own hosting, the PostgreSQL migration and assigning the editorial account. Arum/Mio maintains the source projection, retry/outbox adapter and original layout through normal PRs. The platform does not need LINE credentials, the Mio database, its access code or host login. No runtime code is fetched from the old site.

Apply migration `186_community_journal.sql` through the existing release procedure, with the usual backup/staging checks. The migration creates no publisher and publishes no content. A platform operator must explicitly select the existing member who may edit this site; guild roles, self-reported names and API keys cannot claim this permission. In an operator-controlled database session, bind that verified user's UUID and community UUID to the singleton `community_journal_publisher` row. Validate they refer to the same active user. Do not copy local demo IDs into production. Reassigning the row invalidates previous editors' keys because current authority is checked on every submission/replay.

The assigned member signs in normally and opens `/journal/manage`. They can mint/revoke a dedicated key, read every submitted article/person, approve a content digest, publish the full snapshot or withdraw the currently public snapshot. Keys last 1–90 days (UI default 30), max five active keys; raw secrets are shown once and excluded from stored receipts and audit entries. There is no automatic production bootstrap, key in Git, or API-key publication capability.

## Agent contract v1

`POST /agent-api/v1/journal-submissions`

Headers: `Content-Type: application/json`, `Authorization: Bearer fjp_…`, `Idempotency-Key: <8–128 ASCII letters/digits/_/->`.

The body is a strict UTF-8 JSON object, at most 2 MiB:

```json
{"schema_version":1,"source_revision":"<64 lowercase SHA-256 hex characters>","people":[],"journals":[]}
```

`source_revision` identifies the exact authorized source projection. `payload_sha256` in the receipt is SHA-256 of the **actual HTTP body bytes**, including whitespace; it is not a Python/JavaScript JSON canonicalization. Persist the exact outgoing bytes with the outbox item before sending. Retry with the same key and bytes. Same key/different bytes returns 409. Maximum 100 people, 366 journals, ten pending snapshots; the editor can discard an obsolete draft without deleting the audit record. Content is immutable after receipt; corrections are another snapshot/version.

Person fields: `slug`, `display_name`, `intro` (string or null), `kind` (`person` or `assistant`), `color`, `avatar`, `role`, `category`, `tags`. Avatar fields: `url`, `alt`, `width`, `height`, `display_fit`, `object_position`. Journal fields: `date`, `title`, `excerpt`, `version`, `coverage: {is_partial}`, `blocks`, `development_items`, `decisions`, `people`, `hero`. Blocks are heading/paragraph/quote with `text`, or list with `items`. Development items have `id`, `title`, `next_step`, `status` (proposed/in_progress/reported_done/verified_done). Decisions have `text`, `scope`. People repeated in articles must exactly match the canonical people array. Dates and slugs must be unique. All content is rendered as text, never HTML.

Remove the old projection's `authorization` field when constructing this envelope. Unknown fields are rejected. Do not include raw LINE exports, LINE identifiers, session data, private URLs or secrets. Only explicitly approved, redacted public excerpts may be included in the optional source fields described below. Upstream publication permission remains the producer's responsibility; passing schema checks is not a privacy authorization.

A successful response is 201 with `submission_id`, `source_revision`, `payload_sha256`, `status`, `created_at`; a new submission has `status: ready_for_review`. Replays return the same submission ID and its current status. To resolve an uncertain response, call `GET /agent-api/v1/journal-submissions/receipts/<Idempotency-Key>` with the **same bearer key**. It returns only receipt metadata, not journal content. Revoked/expired keys cannot replay receipts. A different key cannot read the original key's receipt.

Public readback is `GET /api/v1/public/journal`, returning `{data:{people,journals,...},source_revision,payload_sha256}`. Only the explicitly published snapshot is visible. No published snapshot yields empty arrays. The producer may use public revision readback to mark platform publication observed; submission receipt alone must remain `awaiting_review`.

## Optional reading and source fields

Existing v1 snapshots remain valid. Each article may add `reading_note` with `conclusion`, `priority_todo` and `discussion_question` (each up to 300 characters); empty fields are hidden. A heading may add up to 100 `source_messages`. Each excerpt contains an offset-bearing ISO `time` and nonblank `text` (up to 6,000 characters), with optional `sender_name` and `sender_avatar` using an already imported public image, `display_fit` and `object_position`. An avatar requires a sender name. The source time must belong to the article's Taipei calendar date.

An optional `source_key` is a stable, opaque 64-character lowercase hex key generated by the producer; never send a raw upstream identifier. Optional `person_slug` requires that key and must match a canonical person. Repeated keys must have identical source content and attribution. These are publisher assertions reviewed with the exact snapshot, not verified platform member identities. Names and portraits never establish attribution. Unapproved excerpts must be omitted before submission.

The native article shows collapsible source bubbles, device-local times with a timezone label, per-article notes and the week/month date navigator. Safe HTTP(S) references in paragraphs, lists and quotes are clickable. Repository-shaped GitHub links are normalized and deduplicated in an always-visible related-repositories row, including when source excerpts are collapsed. The editor uses the same article presentation and keeps date navigation inside the selected private draft.

`GET /api/v1/public/journal/activity?period=week` (default) or `period=month` derives activity only from the currently published snapshot. It returns `{data:{scope:"published_sources",range:{start,end,time_zone:"Asia/Taipei"},people:[{slug,count}],messages:[{key,person_slug,text,time,journal_date,chapter_id,topic}],unattributed_count}}` with `Cache-Control: no-store`. Periods include today and the preceding 6 or 29 Taipei calendar days. Stable keys deduplicate excerpts; only known human profiles enter counts. Missing attribution is counted separately, and AI profiles are excluded. This measures approved published excerpts, not all group messages or verified membership.

The home page shows activity for 7/30 days, up to four discussion topics and an even number of project cards when at least two exist. Each member has a full page with topic filters and five excerpts per page; changing the period resets filters and pagination. Loading/failure clears old counts. This update uses existing JSON payload storage and requires no additional database migration or media imports.

## Media boundary in this release

The six previously authorized public PNG portraits and three existing design images are included unchanged. Avatar references retain `/media/public/<sha256>.png` in the source contract and render from the platform's own `/journal-assets/<sha256>.png`. Only filenames in `modules/community-journal/media.ts` are accepted. `GET /api/v1/public/journal/media-manifest` returns `{filenames:[...]}` for producer preflight. New/changed image hashes are rejected as `media_not_imported`; do not replace them with private or external URLs or claim the sync succeeded. Import/review new assets through a subsequent PR or an independently reviewed platform media adapter. Generic media upload is not implemented by this release.

This first release can synchronize the currently approved two articles/six people and later text updates using those images. It does not silently widen permission to publish new portraits or third-party artwork. The source site's media bytes and platform bytes must be compared by SHA-256.

## Two-site synchronization

Mio keeps one immutable authorized source snapshot. Track each destination independently: old-site applied/readback revision; platform submitted receipt; platform published/readback revision. Persist failed/uncertain operations and retry the same bytes/ID. Never roll back an already applied destination merely because the other is awaiting review. Report partial synchronization honestly and retain the previous live snapshot on failure. Platform approval atomically replaces the **entire** public set, including removing items omitted from the new snapshot.

## Verification boundaries

Use isolated PostgreSQL and synthetic people/articles for committed tests. Tests cover publisher assignment, session/CSRF, key isolation/revocation/expiry, raw-byte digest, replay/conflict/concurrency, private drafts, version-and-digest-bound approval, withdrawal, strict schemas/body limits and native deep links. Browser validation must run after `npm run build`. Formal-site deployment, production key provisioning, physical-device acceptance and observed two-site publication remain separate release checks.
