# Platform guide helper candidate

Independent, deterministic site-direction component, not a language model or a
replacement for the opted-in character guides. It makes no network requests,
uses no model credentials, logs nothing and stores no questions persistently.
It is not yet mounted in the site. Do not claim global availability or AI chat.

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

Integration currently awaits coordination of App/PageTools/portal-shell changes.
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
The component is typechecked but remains unmounted: the normal production build
cannot demonstrate its integrated runtime behavior. Host integration still needs
reviewed canonical-data adaptation, overlay coordination and actual browser
coverage for keyboard/IME, focus, route refusal, account changes, 320/390px and
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
