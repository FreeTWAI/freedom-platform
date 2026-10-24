# Native community journal and Mio submission protocol

The member-home “閱讀共創誌” entry now opens `https://aisns.evitina.tw/` inside a closeable iframe. This follows Arum's 2026-10-25 request to use the existing aiSNS site directly instead of the proposed #1008 stream/import integration. The iframe displays the site's own navigation, search, articles and people; no articles or identities are imported by opening it.

The default build destination is that exact HTTPS root. `VITE_COMMUNITY_JOURNAL_URL=https://aisns.evitina.tw/` is also accepted; an explicit empty value or any other URL disables the entry. Remove an old `/journal` override when deploying this entry. The frame is mounted only while open, has a visible close button and a separate “另開共創誌” link for unavailable embeds. Escape in the parent closes it; the child's existing `freedom-journal:close` message is accepted only from the exact aiSNS origin and the mounted iframe window. Focus returns to the opening button.

The platform CSP adds aiSNS to `frame-src` only on `/`, excluding self-origin frames and retaining the optional YouTube policy. Admin, payment handoff, API and native journal paths gain no aiSNS frame permission. aiSNS must independently allow `https://freetwai.com` and `https://staging.freetwai.com` in its `frame-ancestors`; this was observed on its public response on 2026-10-24 UTC, and the release operator must recheck it. Sandbox permissions allow scripts, the source's own origin, forms (required for the site's client-side search submit handler) and user-opened links, but no parent navigation or automatic downloads. aiSNS retains its own `form-action 'none'` policy. Parent credentials and private platform data are not sent into the frame.

The already-merged native `/journal`, `/journal/manage`, APIs, assets and migration 186 remain intact. They are separate from this homepage embed; existing data is not removed or rewritten. The protocol below documents that retained implementation, not a prerequisite to viewing aiSNS. This change does not run a content import, assign an editor, publish a draft, or authorize merge/deployment.

## Ownership and release

Platform maintainers own hosting, the PostgreSQL migration and assigning the editorial account. Arum/Mio maintains the source projection, retry/outbox adapter and original layout through normal PRs. The platform does not need LINE credentials, the Mio database, its access code or host login. The native journal loads platform-owned assets; the new homepage iframe loads aiSNS on its own origin.

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

Person fields: `slug`, `display_name`, `intro` (string or null), `kind` (`person` or `assistant`), `color`, `avatar`, `role`, `category`, `tags`. Avatar fields: `url`, `alt`, `width`, `height`, `display_fit`, `object_position`. Journal fields: `date`, `title`, `excerpt`, `version`, `coverage: {is_partial}`, `blocks`, `development_items`, `decisions`, `people`, `hero`. Blocks are heading/paragraph/quote with `text`, or list with `items`. Development items have `id`, `title`, `next_step`, `status` (proposed/in_progress/reported_done/verified_done). Decisions have `text`, `scope`. People repeated in articles must exactly match the canonical people array. Dates and slugs must be unique within each source community (see below). All content is rendered as text, never HTML.

Remove the old projection's `authorization` field when constructing this envelope. Unknown fields are rejected. Do not include raw LINE exports, LINE identifiers, session data, private URLs or secrets. Only explicitly approved, redacted public excerpts may be included in the optional source fields described below. Upstream publication permission remains the producer's responsibility; passing schema checks is not a privacy authorization.

A successful response is 201 with `submission_id`, `source_revision`, `payload_sha256`, `status`, `created_at`; a new submission has `status: ready_for_review`. Replays return the same submission ID and its current status. To resolve an uncertain response, call `GET /agent-api/v1/journal-submissions/receipts/<Idempotency-Key>` with the **same bearer key**. It returns only receipt metadata, not journal content. Revoked/expired keys cannot replay receipts. A different key cannot read the original key's receipt.

Public readback is `GET /api/v1/public/journal`, returning `{data:{people,journals,...},source_revision,payload_sha256}`. Only the explicitly published snapshot is visible. No published snapshot yields empty arrays. The producer may use public revision readback to mark platform publication observed; submission receipt alone must remain `awaiting_review`.

## Claude / Codex source communities

The v1 person and journal objects optionally accept `community: "freedom" | "claude" | "codex"`. Omission means the original Freedom stream; old payloads and immutable receipt digests remain unchanged. This is an editorial source label, not a platform community UUID, verified membership, or permission grant. Existing editor assignment, key authority and publication checks remain in force.

Uniqueness is `(community, date)` for articles and `(community, slug)` for people. A Claude article and a Codex article can both use the same calendar date without overwriting each other. One article per date per stream remains the daily-journal rule. Each article's people must exactly match canonical people from that same stream. Source `person_slug` and repeated `source_key` checks are also scoped to the article's stream: a matching name, slug or source key in another stream never supplies identity or deduplicates a message. Existing limits (100 people, 366 articles total, 2 MiB) apply to the full snapshot.

Public pages use `/journal/claude` and `/journal/codex`, with `/entries/YYYY-MM-DD` and `/people/<slug>` below each. Original `/journal`, `/journal/entries/...` and `/journal/people/...` links still display Freedom only. Navigation, calendar, previous/next, member profiles and activity links remain inside the selected stream. The editor's article selector displays the stream and date, and its preview calendar only navigates articles in that stream.

`GET /api/v1/public/journal` still returns the complete published snapshot for exact revision readback and producer preservation. Optional `?community=claude` (or `freedom` / `codex`) filters both articles and people; response digests still identify the **full** published snapshot, not the filtered body. `GET /api/v1/public/journal/activity?period=week&community=codex` returns activity from only that stream. Activity without a community defaults to Freedom. Unknown, empty or repeated community parameters are rejected. No unpublished data enter these reads.

The media manifest now advertises `communities: ["freedom", "claude", "codex"]` alongside `filenames`. Producers must preflight this capability before sending community-tagged payloads. Existing deployed code may reject the new fields until this version is released. New media still require separate reviewed imports.

Publication continues to replace the **entire** snapshot atomically. Import both approved community articles together and preserve all still-authorized existing articles/people from every stream; never publish two one-stream snapshots consecutively. There is no implicit merge, independent per-stream permission, automatic publish, or migration in this extension. A stale or uncertain existing snapshot must be resolved before constructing a replacement. Existing digest/aggregate-version checks remain the final editorial publication fence. Once a community-tagged snapshot is published, do not roll the application back to a reader that only keys by date/slug; withdraw or publish a fully reviewed legacy-compatible snapshot first, or deploy a forward fix.

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
