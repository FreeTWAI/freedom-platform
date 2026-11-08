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
