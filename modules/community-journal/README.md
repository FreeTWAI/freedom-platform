# Community journal

Platform-owned native journal UI and versioned editorial snapshots. Arum/Mio supplies an already authorized public projection; this module owns validation, PostgreSQL storage, review and public publication. Source ingestion, LINE sessions and private conversations stay outside this repository.

The original journal layout is retained by user request: home, calendar, articles, people, profile dialogs, design images and responsive CSS. It has its own same-origin page at `/journal`; it does not embed or fetch the previous site. `/journal/manage` uses the existing member session and CSRF boundary. Newcomer-guide integration is disabled for this independent reading surface; it has no registered anchors or guide controls.

See [protocol and operation](../../docs/development/community-journal.md). The module descriptor describes source responsibility; it grants no publisher or deployment authority.

Program contributions follow the repository license. Phosphor vectors retain their MIT notice under the frontend's `licenses/`. Images and editorial content have separate display permissions; see the asset notice. Do not treat them as relicensed under MIT.
