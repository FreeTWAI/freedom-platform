# Holiday in-stage candidate (2026-11-08)

This local slice implements **holiday only**. Chair/tofu keep their existing UI;
this is not acceptance of all 72 entries or a new party-art baseline.

## Stage and authority

The opt-in `fullscreen-game--holiday` shell contains presentation/share controls,
title, score/time/combo HUD, actual game world, six accessible targets, feedback,
tools, start/pause/completion, recovery, help and restart confirmation. Results
and their existing sharing flow remain inside the same bounded shell. It does
not opt into the cooking `fullscreen-game--integrated` styles.

The raw native host retains the actual renderer's 4:3 drawing rectangle. HTML
controls and the light board are siblings, so their pointer events cannot bubble
through the raycast host. CSS uses existing arcade/platform tokens. Secondary
tools scroll inside the stage; primary targets do not live below it. Small-screen
HUD labels remain accessible while concise values preserve gameplay space.

The native renderer, all procedural models, assets, domain and constants are
unchanged. Native raycasts, keys 1–6 and six HTML buttons still dispatch the same
hole/round actions. Leaf/tie and text identify holiday/meeting targets. Existing
24-second/20-wave windows, score penalties, held-input stamps, duplicate
rejection, optional sound/reduced motion and done-only result settlement remain.
The perfect synthetic journey's 5100 is an earned test fixture, not a player score.

## Interruptions and recovery

Blur, hidden document, stall and renderer failure retain the same paused run.
Fallback/retry does not resume time. Only explicit Start/Resume advances it.
Restart still keeps the seed and resets only after confirmation. Help also
pauses. Holiday help/restart use a native modal dialog, positioned to the measured
in-stage panel across resize and scroll. Background tools are inert; cancellation
restores the initiating control after the DOM update. First Escape dismisses the
panel, a subsequent Escape reaches the fullscreen owner. Chair/tofu confirmation
behavior is unchanged.

Native results capture the actual canvas. Light results stay explicitly labeled
score SVGs, including accessible result-image text. Failed capture retains the
completed run for retry; existing PNG conversion, recovery, same-seed replay,
platform handoff and user-confirmed publication are retained. The fullscreen
share shortcut scrolls the internal result region, not the entire stage.

## Validation boundary

Source tests add 58 browser cases: four sustained native/light × native/rejected
fullscreen 20-wave journeys, two input/penalty/interruption journeys, two real
context-loss/recovery journeys, two delayed-native-module isolation cases, and
48 viewport/text/mode cases. Sizes are
320×568, 390×844, 667×375 and 1440×900; text is enlarged to 100/125/200% with
nonzero synthetic safe insets. The cases assert real click hit-testing, >=44px
targets, 4:3 canvas, Tab/inert ownership, Escape, actual result downloads, capture
retry, PNG/JPEG conversion retry, AT-only activation, same-seed replay and no
automatic posting. Newly mounted modal text is enlarged and measured separately.
Text-only scaling is not
claimed to be browser zoom. Existing party/daily/cooking regressions remain.

Five new non-native runtime cases execute the actual modal setup/cleanup,
help-Escape and result-navigation code. Initial implementation typecheck exposed
TypeScript's narrowed dead holiday branches in the retained legacy return; the
holiday opt-in guard now preserves the union without changing chair/tofu markup.
The first build stopped because npm pack's default cache path was unavailable;
using a writable temporary cache completed the existing build without installing
software or changing dependencies. Precommit typecheck/build and all 200 tests
in absurd-daily.test.ts passed; fixed-commit validation is reported separately.

Browser/GPU/DOM/pixels/touch/device/Safari/OS sharing/FPS and human art/fun
acceptance are **not_run** in this environment. No browser launch workaround,
CUA, screenshots, deployment or remote publication was performed. Full database
suites require an explicitly provisioned isolated TEST_DATABASE_URL; no default
or production database is used. Known Unix-socket governance fixture failures
are not retried. Discovery is not browser execution.

Full source context retains the inherited 24-path change set and all 94 modules.
All 264 rule-source hashes matched the prior nine-reader semantic ledger; that
semantic reading is reused only for byte-identical sources. All 268 current
chunks were freshly retrieved and reconstructed, followed by completeness
checking. Integrity validation does not itself assert understanding, product
acceptance, trusted CI or permission to merge/deploy. Final binding must use the
fixed clean commit, with no concurrent source edits.


## Holiday composition follow-up (2026-11-09, local source only)

This bounded follow-up starts at local integration
`afe88ddcf334f5063c9dc6a5fe0bf7daec770cbb`, on main baseline
`3586c1a7f0bdbfb0980297e9a996ad95fa8607bd`. It changes only Holiday
presentation in `PartyGame.tsx` / `party.css` and Holiday tests/documentation.
Chair and Tofu keep their existing markup, styles and gameplay. Daily result
ownership, cooking, native renderer/domain/batch/capture, preview source inputs,
images, package manifests, Vite and workflows are untouched.

The title, HUD and tools now share the Holiday world background rather than
opaque full-width bands. On wide or short screens the HUD occupies the title
lane. Its units remain visible, including on compact screens; short landscapes
place units on their own measured line so a four-digit score cannot crowd the
title. Every existing tool remains a direct button, with the same complete
accessible name, title, pressed state and handler. Pause/restart/help/sound use
visible symbols; motion shows 動 / 靜; native recovery uses a cube symbol.
The tool row wraps within the available width, with no closed menu and no
horizontal scrolling strip. Targets stay at least 44px; text is not reduced.

The existing height-first uniform 4:3 native host fit is unchanged. No HUD or
control may cover that rectangle. Native Holiday is still the actual fixed
640×480 scene; light Holiday is the separate six-cell illustrated control board.
Neither is replaced by a preview image. The model quality, projection, real
picking, 24-second/20-wave clock, score, input stamps, pause/recovery, capture,
modal focus and fullscreen owner are unchanged. Party still unmounts when the
parent displays Result. This follow-up does not complete live-scene results,
Party-wide redesign, responsive full-frame 3D, or art/fun acceptance.

### Original evidence and pending verification

Five original d141 PNGs were viewed before implementation: embedded attachment
indices 104, 108, 116, 120 and 126 from run 42533847998, covering native/light,
320×568 and 667×375, 200% text, native/rejected fullscreen. Each original PNG's
SHA-256 matched the attachment index. They show clipped secondary tools and
separate bands. The corresponding native 667×375 JSON records an intact world
of 173.84375×130.390625 CSS px. These are historical evidence, not screenshots
of this candidate. PartyGame, party.css and the native stage were byte-identical
on the chosen base; FullscreenGame's intervening change adds the Daily-only
result-share callback and does not change Holiday's default branch.

The existing 48-case Holiday layout matrix now checks every direct control
before scrolling, complete safe-area containment, text/control clipping, physical
hit points, >=44px targets, native pixel/host alignment, empty light host,
non-overlap of controls/HUD/world, and transparent bands. It also checks normal
mode after the existing native/rejected fullscreen journey, including 200% text
screenshots. In the exact 667×375 fullscreen / 200% text comparison it requires
at least 25% more world height than the original JSON (at least 56% more area),
while preserving all old assertions. That is a pending browser requirement,
not a measured candidate improvement or a new acceptance verdict.

The existing twenty-wave journeys now measure composition at entry and after
waves 10 and 20. Existing wrong-target, stale pointer/Space/Enter, cancellation,
context loss, real capture failure/retry, PNG/JPEG recovery and same-seed replay
journeys remain. No matrix duplication, skipped cases, timeout, threshold,
workflow, sharding or selection relaxation was introduced. The non-native
Holiday controller harness resolves actual accessible names instead of visible
text and additionally checks unique labels, titles, pressed states and unchanged
score when toggling motion. Its original score/focus assertions remain.

Direct TypeScript checking, the offline standard build and all 225 tests in
`tests/runtime/absurd-daily.test.ts` passed locally; browser collection lists 359
cases in `absurd-daily.spec.ts`. Collection is not execution. Candidate browser
pixels, real layout/hit testing, physical touch, Safari, OS sharing and human
art/fun acceptance are not_run. Native preview refresh remains unavailable under
the historical #1061 workflow restriction. All ten existing party-art source
inputs still match. The observed UI1 baseline was 856 cases in about 63 minutes;
this follow-up's extra assertion/screenshot cost is unmeasured until CI.

Own full-scope compact context retained all 94 affected modules and 264
baseline/candidate source records, 132 unique rule texts and 134 chunks. Every
chunk was retrieved and reconstructed, bindings and prior semantic-read hashes
were checked, and completeness passed. Identical prior rule understanding is
reused only for byte-identical texts. This is local context assurance, not CI,
merge/deploy permission or product acceptance. No push, approval, merge, deploy,
Codex task, local browser/server/socket or dependency installation was performed.
