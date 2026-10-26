# Platform guide helper candidate

Independent, deterministic site-direction component, not a language model or a
replacement for the opted-in character guides. It makes no network requests,
uses no model credentials, logs nothing and stores no questions persistently.
The source candidate now mounts in the logged-in member Workspace only. This is
not a deployment, anonymous-site availability or generative-AI claim.

The host must inject reviewed public page titles/help and the currently available
page IDs. Reuse canonical page-help/feature metadata through a reviewed host
adapter; do not create another answer bank or import member/private content.
Knowledge and navigation availability are presentation inputs, never permissions.
No arbitrary URL, selector or business action may be supplied as a destination.

Only an explicit destination-button click requests the host's existing selectTab
callback. It returns void and can refuse a draft-leave guard: do not infer success,
close the helper, change hashes or click form controls. Observe actual page changes.

Account/page changes, external blocking surfaces and closing must clear ephemeral
input/replies. Hand-opened dialogs restore focus only to their connected launcher;
route/account/blocking changes must not steal the new destination's focus. The
host must coordinate native dialogs and other surfaces before integration.

The member host is a coordinated shell adapter; PageTools itself stays unchanged.
Do not mount through module side effects, body injection or CSS workarounds.
Do not edit existing character release gates, profile choices, private model
consent, shared navigation, active collaborators' files or production flags.
Tests must distinguish pure-model, synthetic UI, real browser and integrated-app
coverage. Browser discovery alone is not executed acceptance.

## Component contract

`PlatformHelper` takes `pageId`, opaque login-generation `accountScope`, required
`blocked`, a narrow `availablePageIds` list, reviewed public `knowledge`, and the
existing guarded `onNavigate(id): void` callback. Use a new account scope for each
login generation, not merely the member ID. The scope is used only as a React key.
A blocked host removes the launcher and session; a page/account change replaces
the session before rendering. Neither path explicitly restores launcher focus.
Manual close/Escape clears the session and restores its connected launcher.
Opening is also refused while another native dialog is open. This defense does
not replace the host's required coordination of non-native overlays.

Knowledge entries supply `id`, `title`, `summary`, `steps`, optional `note`; display
uses the current canonical entry, not a cached copy. Available entries must be own
properties with matching allowlisted IDs. Changes to availability immediately
remove result cards and actions. This list is not an authorization decision: the
original route and business operations retain their existing gates.

The first phase recognizes four small, reviewed intent vocabularies (starting,
learning AI, selling, finding partners), optional Chinese question wrappers and
NFKC text. It does not do semantic reasoning or answer arbitrary questions.
Unknown clauses make the whole query unknown; recognized multiple goals ask for
an explicit choice. Questions longer than 240 UTF-16 code units are rejected,
not truncated. Submit clears the input; only intent/page IDs remain as result
state. No transcript or raw-question echo is rendered. Public help text is
rendered as React text, not HTML; only explicit destination clicks navigate.
A refused navigation leaves the helper open. Same-page navigation is not treated
as arrival; actual `pageId` changes close the old session.

## Candidate verification boundary

The runtime test file covers model validation, Unicode normalization, ambiguity,
unknown input, allowlisted/current availability, canonical data isolation and
source-level UI boundaries. Source assertions are not real UI interaction tests.
The normal production build now includes the member host, but build success
cannot demonstrate its integrated runtime behavior. The source includes canonical
data adaptation and overlay coordination; it still needs actual browser coverage for keyboard/IME, focus, route refusal, account changes, 320/390px and
short viewport layouts. No model provider, API, database, dependency, persistent
storage, telemetry or character-guide gate was added.

The input also has an HTML `maxLength=240` cap. `chooseIntent` fails closed for
unknown runtime IDs. A synchronous navigation exception yields only a fixed
message, never exception details. Visible ARIA modal dialogs are checked as an
additional opening defense; hidden ARIA dialogs do not block the launcher.
Starting choices prefer available pending steps, free skill previews, then guilds;
no helper choice claims membership, unlocked skills or completed work.

The runtime file additionally executes the actual TSX component's queued-close
handler using esbuild and synthetic React hooks/DOM refs: a late close event from
the prior opening must not reset a reopened dialog's expanded state or new input.
This is a persistent handler regression, not native dialog/browser evidence.

## Isolated browser specification (not executed locally)

`tests/e2e/platform-helper.spec.ts` uses the required `./fixtures.js`, including
its existing locale, authentication-isolation schema and single-worker setup.
`platform-helper-fixture.ts` bundles the real component, helper CSS and existing
`styles.css` / `rpg-theme.css` using the already-installed esbuild package.
The fixture is explicitly synthetic: no App mount, real member data, model/API
calls, persistence or business mutation. Only its exact test HTML/JS/CSS paths
are fulfilled through Playwright routing; all other page requests are aborted.
The fixture's host-update event is test-only and is never imported by the app.

Ten authored browser cases cover native Escape/focus, close/reopen with a delayed
close event, IME, submit isolation, guard refusal/acceptance with a retained draft,
account/page/blocking teardown, unknown-query privacy and availability changes,
and 320/390px short viewports with 200% root text size. Enlarged CSS text is not
claimed as device/browser zoom verification. Local fixture bundling and Playwright
`--list` discovery passed; browser execution is **not_run** due to the environment
restriction. Discovery does not execute assertions or establish acceptance.

Host integration must mount the helper outside existing business forms. Its own
submit handler also prevents default and stops propagation as defense in depth;
this does not make nested HTML forms valid or authorize automatic business actions.

Successful results announce only the current available entry count in the existing
polite status region; the query and canonical help are not duplicated there.
A new handled question or explicit intent clears an older navigation error, while
an ignored composition-time submit leaves input and error state untouched. A
navigation exception still shows only the fixed failure message and does not
claim arrival. Three synthetic-handler regressions cover the live count as
availability changes and both recovery paths; actual assistive-technology
announcements remain unverified until browser/AT acceptance is performed.

## Pure canonical-data adapter

`knowledge.ts` exports `buildHelperKnowledge({ metadata, pageHelp,
availablePageIds, guildLaunchpadEnabled })`, returning `{ knowledge,
availablePageIds }` for the existing component. The host injects reviewed public
metadata title and page-help summary/steps/optional note; the adapter imports only
its own `model`, not App, page-help, metadata, session/client types or character
modules. No second answer bank or provider is introduced.

Both outputs contain the same intersection of valid canonical entries, the fixed
`HELPER_PAGE_IDS` list and the host's current available IDs. Ordering follows the
fixed list and duplicates are removed. `stores` additionally requires
`guildLaunchpadEnabled === true`; false, missing, null or malformed flags do not
expose it. This gate does not affect `supplier` or `retail` and does not grant any
business authorization. The host remains responsible for authoritative routes,
capabilities and guarded navigation.

Inputs are plain or null-prototype records with own data properties. Missing,
inherited, accessor or malformed entries/fields are omitted without invoking
getters. Titles, summaries and steps must be nonblank strings; an empty steps
array is valid. A supplied note must be an own string data property; omit it
rather than supplying undefined. Valid strings are preserved exactly, not trimmed
or rewritten. Steps are copied into fresh output; sources are never changed or
frozen. Recompute when canonical data, availability or the flag changes: there is
no cache and an earlier snapshot does not update itself.

Runtime tests execute the adapter using structurally representative synthetic
public records, including missing/malformed/prototype/accessor inputs, strict
stores gating, current availability, source preservation, fresh updates and
consumption by the real helper model. These adapter-only cases do **not** import or parse the shared canonical files.
The separate shell-owned host runtime file now imports and checks the actual
canonical exports. Browser acceptance remains **not_run**. This adapter is theme-neutral and
does not fulfill the separately requested theme-dependent character integration.


## Member Workspace host candidate

`PlatformHelperHost.tsx` is owned by portal-shell and imports the canonical
`pageHelp` and `PORTAL_FEATURE_METADATA` within that shell. It passes the current
registered page IDs through the helper adapter and keeps the strict stores flag.
App mounts it only in the existing logged-in Workspace `topbar-actions`, beside
the share action and outside business forms. No PageTools, shared layout CSS,
Navigation, anonymous/login view, provider or character-guide gate is changed.

The accepted `locationHash` plus client session generation form a React key, never
a DOM attribute or log. This clears question state on same-tab deep-link changes
and new logins. The canonical page ID remains independent of this route key.
Only the original guarded `selectTab` handles navigation; no success is inferred
from its void return. A refused leave keeps the original route and helper open.
For a helper-requested same-tab route, App records only an actual change in its
guard-approved hash, then transfers focus after the keyed dialog unmounts. A
refused/same-hash request, an unrelated route or an intervening modal does not
receive this focus handoff; ordinary navigation effects are unchanged.

Known mobile-menu, messages, pending and expired-access states block the host.
A narrow DOM monitor additionally observes visible native/ARIA modals, existing
shell menus/popovers and real console/chat surfaces, excluding the helper's own
subtree. It reads only structural visibility, not member text or form values; it
never clicks, closes or rewrites another UI. Hidden surfaces do not block. The
member console is headless: an old expanded preference without a visible console
is not treated as a blocker. Observer/listener cleanup is covered synthetically.

The new runtime tests execute actual canonical projection, explicit shell gates,
visibility/own-surface exclusion and real host handlers with synthetic hooks.
The actual App navigation callback and post-commit focus effect are also evaluated
in a synthetic VM for accepted/refused/same-hash/foreign-modal/unrelated routes;
that does not simulate native inert behavior or establish browser focus acceptance.
`platform-helper-host.spec.ts` authors real Workspace login, help/route/focus,
page-tools/share/chat mutual exclusion, actual event draft-leave guard, login and
same-tab reset, stores-off/missing and base-theme narrow-screen checks. These
browser assertions have only been discovered, not executed locally. Existing
isolated component tests remain separate; no browser, mobile keyboard, assistive
technology or real member acceptance is inferred from runtime/build results.

This adds a per-member-page normal-flow entry, not an always-floating bubble or
an anonymous-site bot. Existing theme colors are inherited. Theme-dependent
characters still require a separate approved design/integration with the existing
GuideHost release and asset gates; this candidate does not claim that work done.

## Optional controller preparation (not character wiring)

`PlatformHelper` optionally accepts `controllerRef: Ref<HelperDialogController>`
and `onDialogChange`. Existing callers omit both, retaining the same launcher,
dialog, model, guarded navigation and default close/Escape focus behavior.
The handle exposes the dialog ID, a live `open` getter, and
`requestOpen(origin: HTMLElement): boolean`. The only supported use is an explicit
user action on a same-document connected, enabled, non-hidden launcher. False is
an immediate refusal, never a queued request. Repeated opens do not clear input,
restart composition or issue duplicate notifications. Native open failures leave
no partially opened state.

A handle belongs to one committed component lifetime. Account/page replacement,
the member host's accepted-route key, blocking teardown and unmount invalidate
retained handles. StrictMode effect replay creates a fresh lease; it does not
revive a previously captured handle. Reconnected layout setup closes any retained
open native dialog and clears ephemeral state before issuing the fresh lease; a
new explicit user action is required. Actual unmount cleanup does not call close
or restore origin focus. React clears the live ref during cleanup. Replacing only
the ref prop within the same mounted session does not revoke previously captured
handles; they share that session's lifetime, not a separate authorization grant.
No handle, element, callback, input or request is persisted or sent over a network.

Changes report `{dialogId, open: true, origin}` or
`{dialogId, open: false, reason, origin}`. Reasons are `dismiss` (Close/Escape),
`native` (an otherwise unhandled native close) and `teardown` (lifetime ended).
These notifications contain no query, answer, account or route. Optional listener
exceptions cannot interrupt cleanup and are neither logged nor surfaced. A queued
close from an earlier opening cannot reset a dialog that has already reopened.

External launchers deliberately do **not** receive an explicit focus call from
the helper. Existing guides disable controls while a native modal is present;
immediately focusing that disabled origin would be premature. A future scoped
host/GuideEngine integration must restore focus only after a manual dismissal,
its suppression has cleared, the same scope remains current and no newer blocker
or navigation exists. Teardown cancels restoration. The helper schedules no timer,
retry, global event or synthetic click. Native browser focus behavior is still
unverified by the synthetic tests.

This increment does not connect App, PlatformHelperHost, GuideHost or GuideEngine,
hide the existing launcher, add another character, change themes, load character
assets, bypass release gates or introduce generative AI. The future opted-in
character may call this same dialog only through its existing verified ready
scope; fallback entry selection and deferred guide-focus handshake remain shared
integration work. New actual-source synthetic lifecycle tests cover controller
leases, refusal, IME/repeated open, notifications, failed native opening and
teardown; they are not React scheduling or browser acceptance.
