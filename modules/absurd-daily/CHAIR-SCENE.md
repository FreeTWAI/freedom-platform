# Chair in-stage candidate (2026-11-08)

This local slice extends the reviewed Holiday stage to **辦公椅逃亡**.
Tofu keeps its existing production layout. This is not acceptance of all 72
entries or a new native-art baseline. No remote publication is included.

## Stage and gameplay authority

`fullscreen-game--chair` opts into the bounded party shell, not cooking's
`fullscreen-game--integrated` rules. The title, score/time/three-life HUD,
actual world, left/jump/right controls, live feedback, pause/help/restart,
renderer recovery and result sharing all remain inside that stage. The three
primary controls are siblings of the empty renderer/gesture host. Native
Three and light SVG both retain a true 4:3 world; the SVG is a pointer-transparent
sibling, with its detailed readout retained for assistive technology.

The existing domain, constants, native renderer, procedural models, assets and
light projection are unchanged. Runs remain 30 seconds, 22 seeded waves and
three lives. Collisions still use actual lateral position and jump height.
Swipes need at least 28 CSS pixels; buttons, arrows/A/D, tap and Space retain
existing actions. Held inputs retain their resolved-wave stamp and cannot be
released into a later wave. `chairView` reads actual x/jump and the existing
2800 ms horizon. The fixture's 4280 is earned by 22 correct decisions, never
awarded automatically.

## Lifecycle and accessibility

The shared Holiday modal owner now also handles chair help/restart. Native
modal placement follows the measured in-stage overlay, with inert background,
Escape ownership and post-commit return focus. Start/Resume focuses the host
after its inert state is removed. Blur, hidden document, >1500 ms stall and
renderer failure pause the same run. Only explicit resume restarts time.
Restart requires confirmation and keeps the seed. Generation-fenced loader
cancellation/disposal, same-run light fallback and retry remain unchanged.

The scrollable native control pane starts at its first row, with auto margins
centering only when space permits. This addresses the source of the earlier
centered-overflow concern without claiming measured layout acceptance. Tests
retain Holiday coverage and strengthen reverse first/last target reachability.
Chair controls use three columns on phones/short landscape, and a sidebar on
wider screens. Secondary tools and oversized panels scroll within their owner.
Safe-area values remain env-backed, with chair-specific overrides for synthetic
tests; synthetic insets are not physical-notch evidence.

Native results still call the real canvas capture. Light chair export is a
labeled score SVG with totals and an explicit notice that no per-wave route
was saved. Result image alternative text now identifies that card as a record,
not a 3D screenshot. Capture failure preserves done state for retry; settlement
is single-use. Existing PNG/JPEG retries, same-seed replay and user-confirmed
sharing are retained. The share shortcut scrolls the internal result region.

## Evidence boundaries

New controller CPU tests execute production hooks/handlers with deterministic
renderer ports: full 22-wave/30-second native/light runs, three-life loss,
paused modal ownership, capture retry/single settlement, same-seed restart,
blur/hidden/stall and native-to-light recovery. These are not DOM/GPU proofs.
An initial fixture expected an absent `RunResult.score`; it was corrected to
assert the actual exact summary contract, retaining all domain score assertions.

Browser source adds sustained native/rejected-fullscreen journeys and bounded
320×568, 390×844, 667×375 and 1440×900 cases at 100/125/200% text with synthetic
safe insets. Coverage includes >=44px contained hit targets, first/last control
reachability, real pointer/keyboard/AT activation, stale/secondary/cancelled
input, wave ownership, help/restart/focus/Escape, context loss, delayed imports,
full completion/loss and capture/results/replay. Existing Holiday, tofu, daily
and cooking assertions are preserved. Text scaling is not browser zoom.

The review follow-up retains the 4:3 assertion and also requires the world to
measure at least **128 CSS px wide and 96 CSS px high**, with its actual rectangle
in every world-size failure message. This only guards against a nearly vanished
world, not against poor art or human playability. No production styles, text
sizes or content are changed to meet this threshold. The existing 200% text
cases at 320×568, 390×844 and 667×375 attach real viewport PNGs and world/stage
rectangle JSON before bounds checks, both while playing and after modal resume,
for native/light rendering and native/rejected fullscreen. These artifacts are
created only when the browser cases actually run; none was generated locally.

Final fixed-commit command results are supplied with the handoff. Browser/GPU,
actual DOM/pixels/touch/Safari/OS sharing/FPS and human art/fun acceptance remain
**not_run**. No browser launch, workaround, screenshot fabrication or install
was attempted. Full database suites require an explicit isolated test database;
none is configured. Known denied Unix-socket governance fixtures are not retried,
and Python contracts remain unavailable without pytest.

The full inherited scope and all 94 modules remain in context. All 264 rule
source hashes matched the prior complete nine-reader semantic ledger, whose
nine receipt hashes were reverified. Semantic reading is reused only for these
byte-identical texts. All 268 current chunks were retrieved before editing;
final binding repeats this on a fixed clean commit. Completeness is local
integrity evidence, not CI approval, permission or product acceptance.


## Exact 7f25d1e9 regression repair candidate (2026-11-09)

Verify 42508072805 UI shard 1 completed 774 passed / 62 failed / zero skipped
or flaky. Sixty failures are Party; two mushroom-art cases are a separate repair.
This is completed assertion/timeout evidence, not the earlier runner-loss event.
Artifact 13630154941 (118,684,647 bytes, SHA-256
`e28bd4b3e475ffc16a787ade7c0e9c83cc16a4871107a8de2a214a5c5c988ae6`)
binds base 242dbd4, head 7f25d1e9 and candidate eb52519b. Original screenshots,
traces and JSON were read and retained unchanged.

The failures have distinct causes:

- Forty-six geometry/hit-test cases: legacy landscape `align-items:start`
  collapses the size-contained world to 0×0; at 320×568 / 200% the long Chair
  flex labels wrap vertically and leave a 51×39 world (Tofu 88×66). A late
  resumed Holiday case also reaches 0×0. The field now stretches its world,
  reserves a 96px minimum world row, isolates retired layout rules and uses
  compact primary controls with complete accessible names. Lives and misses
  remain visible. The world background extends behind the edge controls instead
  of exposing separate cream control cards. This is not new 3D art acceptance.
- PT-6 fails its existing owner-containment check before Start in landscape;
  inactive second-row cells overflow their original owner. Compact labels and
  explicit control geometry address it; its assertion remains unchanged.
- Two native Tofu completions show the next block in the actual renderer, but
  stale React HUD/drop state after a completed 460ms landing. Semantic score,
  wave and turn changes now publish immediately instead of waiting for the
  90ms UI throttle. Original duration, scoring and completion assertions remain.
- Four context-loss cases observe one old 16ms render sample before fallback
  publishes the retained simulation state. Failure now synchronizes diagnostics
  after releasing the failed renderer, without rendering or resuming it.
- Two hold/cancel cases fail only at presentation Escape after Pause disables
  the focused button. Pause now transfers focus to enabled Resume within the
  stage. The cancelled-input, score, frozen-clock and Escape checks remain.
- Five native duration journeys time out while still playing. Original traces
  show roughly 2.2–2.5 seconds of CI wall time per simulated second. This is a
  renderer-throughput issue under that host, not measured phone FPS. Renderer
  optimization is a separate candidate and must pass the unchanged formal
  journeys before these failures can be called resolved.

Six production-controller regressions cover between-draw context loss, exact
landing-frame HUD/drop publication and Pause-to-Resume focus. The first focused
run retained a failure because an old source-extraction fixture omitted the
newly used input-stamp port; after adding that real production port, 224/224
runtime cases passed with no skips. Browser source retains all original cases
and adds Holiday minimum-world and before-assertion PNG evidence, matching the
existing Chair/Tofu diagnostics. Local browser/GPU/PNG execution remains not_run;
new formal screenshots, ordinary clicks/Tab, full results/replay, physical touch,
Safari, OS sharing and human composition/art/fun acceptance remain required.


Independent source review found two additional compact-control risks in the
first repair: a centered three-row Chair pad could begin above its scroll
origin, and the fixed 104px Tofu rail could not contain a 200% nowrap label.
The follow-up uses a three-column, 176px Chair rail in short landscape and
single visible direction/drop indicators with unchanged complete accessible
names. Scrollable control grids start at a nonnegative origin. Browser hit
checks additionally require each visible control child to fit its button;
no existing size, containment, focus, clock or score assertion was removed.
The follow-up still requires actual new-head browser and screenshot validation.


## Bounded Chair control composition (2026-11-09 source candidate)

This increment only changes Chair presentation in PartyGame.tsx and party.css,
plus Chair sections of the existing tests and this document. It follows the
separately reviewed Holiday and Tofu control slices. The actual game remains
辦公椅逃亡: a 30-second runner with 22 seeded waves, lateral/jump collisions,
tickets and three lives. It is not a musical-chair game.

Title, HUD and tools now share the green game surface without opaque full-width
bands. Score/time units remain visible. All direct tools use compact visible
symbols with the complete accessible name, title, pressed/disabled state and
original action/ref. Tools wrap instead of clipping a horizontal strip. The
three 48px primary targets form a centered pad below the world in portrait and
a narrow, separate game-edge lane on wide/short screens. Wide/short title and
HUD share a measured flow row. The light scene's decorative outer rectangle is
transparent; its real road, obstacles, tickets and character are unchanged.

The complete native/light world remains unobscured in its exact 4:3 rectangle.
No renderer pixels are stretched, covered, cropped or zoomed. The 640×480
buffer, cameras, native input mapping, light projection and source-bound art
inputs are unchanged. Every gameplay/controller line before the composition
branch is unchanged. Original held-wave input, cancellation, modal/focus,
pause/resume, recovery, capture retry and single settlement remain authoritative.
Holiday, Tofu, Daily, parent Result and Cooking are outside this increment.

Seven original d141d902 / run 42533847998 Chair PNGs were directly inspected
and SHA-256 checked. At 667×375 with 200% text, the original native/light JSON
measures 173.84375×130.390625 CSS px, with opaque bands and clipped tools. These
are historical diagnosis artifacts, not new-source acceptance evidence.

The existing 48-case viewport/text/native-light/fullscreen matrix now checks
all controls before scrolling, >=44px targets, complete text/content and safe
area containment, transparent bands, no HUD/control collisions, the complete
unobscured world, actual hit testing, native canvas alignment, light SVG equality
and an empty light host. It also returns to normal mode and attaches original
normal-mode PNG/JSON at 200% text. The original 128×96 floor and exact 4:3 checks
remain. The exact 667×375 fullscreen/200% state must have >=25% more height than
the historical 130.390625px (>=56% more area). This is an unexecuted acceptance
requirement, not an observed improvement or a minimum added to fake a pass.

Existing full 22-wave journeys retain all real 4280-point, 30-second, capture,
PNG/JPEG retry and same-seed replay assertions. They add early and earned late
wave 11/21 pixels and world clearance, with 200% text and real jumps. Existing
three-collision journeys add clearance at two/one lives. Controller tests add
unique tool names/titles, disabled/pressed states and a no-score-mutation motion
toggle. No case, score, duration, skip, timeout, selection or sharding is relaxed.
Extra geometry and screenshot cost is unmeasured until formal browser execution.

Browser/GPU execution, new-source PNGs, actual CSS geometry, full platform CI,
physical touch/phones, Safari, browser zoom, OS sharing and human art/fun
acceptance remain not_run here. Text enlargement and synthetic safe insets are
not real-device evidence. The fixed renderer cannot fill every viewport edge;
Party still unmounts for the separate parent Result, so continuous live-world
results are not solved. Fresh source-bound preview capture is unavailable
through the supported historical #1061-restricted workflow. Preview pins,
source lists, capture tooling, workflows, dependencies and performance code are
untouched. This bounded candidate does not complete the all-game redesign.

Local source checks passed: direct Node TypeScript typecheck, the standard build
with npm offline/update-notifier/audit/fund restrictions, all 225 cases in
absurd-daily.test.ts with zero skips, all ten declared Party preview source
hashes, and git diff --check. Browser collection still lists 359 cases; none
was executed here. Dependencies came from the existing offline ignored
node_modules directory, without an installation or a root symlink. Full
DB-backed runtime/contract suites were not run; no isolated TEST_DATABASE_URL
was supplied. Exact commit, tree, context receipts and command logs accompany
the handoff. These checks are source/CPU evidence, not rendered acceptance.
