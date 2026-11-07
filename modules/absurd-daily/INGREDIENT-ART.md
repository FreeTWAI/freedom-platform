# Guided preparation art: four ingredients

This is a bounded in-play art increment, not a refresh of all 72 games or all
66 finished dishes. It adds original whole-food silhouettes and exposed cut faces
to five guided slice steps. It does not replace the illustrated covers, change
the four free-cooking games, or claim user acceptance of the visual direction.

## Exact playable scope

| Guided URL (`/play?game=kitchen&practice=1&recipe=…&seed=42`) | Step | Ingredient |
| --- | --- | --- |
| `fish-and-chips` | 0 | 馬鈴薯 / potato |
| `pumpkin-soup` | 0 | 南瓜 / pumpkin |
| `baked-sweet-potato` | 0 | 地瓜 / sweet potato |
| `cream-risotto` | 0 | 蘑菇 / mushroom |
| `plant-burger` | 0 | 蘑菇 / mushroom |

Previously the three root vegetables used the shared carrot glyph, and mushrooms
used the dough glyph. The new potato has an uneven skin and eyes, the pumpkin has
lobes and a stem, the sweet potato has a tapered red skin, and the mushroom has
a cap and stem. Completed slices expose pale potato flesh, a pumpkin seed cavity,
golden sweet-potato flesh, or mushroom gills. Contours and details are original
code-authored artwork. No third-party image, character, texture or site asset is
copied or loaded. The reference website was not available for direct inspection.

## Rendering and behavior boundary

`ingredient-visuals.ts` is the shared immutable source for both production SVG
and shallow extruded 3D layers. This remains the existing matte, cut-paper kitchen
style, not a new physically sculpted renderer. The prior five visual definitions
and seven covered steps remain unchanged. Exact label and shape guards leave all
other ingredients, mixtures and sauces on their existing renderer, including the
separate baked `地瓜` / `dough` step.

Only `i < run.active.count` chooses a cut face. Time, animation preference and
pause status never infer progress. SVG receives that flag only for slice pieces.
The 3D factory builds both states once per slice step, batches each state in its
own group, and never batches their common parent. The surrounding body continues
to exclude the dynamic food roots. Updates only toggle the two groups' visibility.
Both states use the existing step-owned disposal set. Other techniques build only
the whole visual, without preparation-state groups.

Domain, recipe data, scoring, pointer ownership, keyboard controls, touch hit
regions, save formats and the existing slice redraw key are unchanged. The
existing WebGL fallback, pause/resume and reduced-motion paths remain authoritative.

## Fixed budgets and observed source data

- Each state has at most 7 filled layers, each with 3–16 finite points in `[-1,1]`.
- Both states together use at most 4 opaque materials and no textures.
- SVG uses the existing 26px contour scale; 3D uses the existing 0.3-unit scale,
  0.07-unit extrusion depth and 0.025-unit layer offset. No larger hit region.
- Raw extrusion geometry is shared across copies within a step. The test ceiling
  is 14 raw extrusions and 32 retained raw/merged food geometries per target step.
- Expected visible food draws are at most 4 per copy after same-color batching.
  Native GPU calls, frame time and memory have not been measured locally.
- Updates allocate no geometry/material/texture. Step changes and teardown must
  dispose the previously owned resources exactly once, including the hidden state.

| Ingredient | Whole layers / points | Cut layers / points | Materials | Raw extrusions |
| --- | --- | --- | --- | --- |
| Potato | 5 / 36 | 4 / 39 | 4 | 9 |
| Pumpkin | 5 / 47 | 6 / 44 | 4 | 11 |
| Sweet potato | 4 / 33 | 4 / 36 | 4 | 8 |
| Mushroom | 4 / 47 | 6 / 58 | 3 | 10 |

The table is measured from production layer data, not from a GPU. Runtime tests
with real Three geometry additionally check post-bake visibility, shared resources,
footprint, repeated count changes, paused/reduced-motion projections, rebuilds and
idempotent disposal. Their renderer/DOM boundary is stubbed, so even passing those
tests would not be native WebGL visual evidence.

## Local evidence, 2026-11-07

- Seven contour/catalog/production-SVG tests and five unchanged focus tests pass
  (12 total, zero skips), with network, server and database connections fenced off.
- Targeted TypeScript checking of the shared artwork, production SVG component,
  pure test and new browser cases passes. This does not typecheck the unavailable
  Three import graph.
- The production SVG component renders before/after views for all five real
  recipes, plus an enlarged study drawn directly from the final layer data.
  PNGs are rasterizations of those SVGs, not browser or native 3D screenshots.
  These are review artifacts outside the runtime asset path.
- Five browser cases in `tests/e2e/cooking-preparation-art.spec.ts` are authored
  for actual native start, one cut, pause/resume, explicit SVG fallback, a second
  cut and exit. They use the existing isolated fixtures, 320/1440px viewports and
  reduced-motion variants, and retain the existing whole-scene budgets of
  calls ≤100, geometries <100 and textures ≤3. Native whole/cut and SVG screenshots
  are future review outputs, not locally executed evidence or accepted goldens.
- Module ownership check passes with the same three unrelated unmapped surfaces.
  The new browser file has exact ownership; baseline/candidate rules and required
  full runtime/browser suites are not reduced.
- Full typecheck fails because `three` and its types are absent. The native-stage
  and combined absurd-daily test processes fail at module loading before their
  test bodies run. No substitute Three implementation is used.
- Standard `npm run build` passes generated-source checks, then fails in the
  existing skill-client packaging step with `ENOENT` creating `/home/agent/.npm`,
  before Vite. No installation or cache-permission workaround is attempted.
- Native WebGL, browser/E2E, real mobile/Safari performance, full runtime/CI and
  human visual acceptance remain `not_run` or externally pending. No deployment,
  merge, push, external review approval or full-game completion is claimed.

The local worktree is based on synthetic snapshot
`49228a6bfd31071636d2872b836df684601e1d89`: text/game sources match official
`ecf76f1e5da02677876f07ad17ae100d43db58d9`, with 55 unrelated historical skill
WebP files retained. It must not be published as an exact official main tree.
Only this reviewed text delta is a candidate for integration onto official main.

## Isolated fullscreen integration candidate, 2026-11-07

This candidate combines the complete, disjoint text deltas of Draft #1305
(`c7c48ee4fc766dbeebd9d46cfabac677b082cd3a`) and Draft #1306
(`7dce012d9fa2c7d27c5df2fb0cce338068a7b399`) on official main
`02fbcc2a7ce79914261d3fb6d5de40269af9758b`. Neither source PR is merged.
Main's 96 changed UTF-8 files were materialized and blob-hash verified; none
overlaps the two PRs' 16 files. Publication must use main's official tree
`6bfef4be6ddc05aff9d8defca4dbde54f46de366` plus the reviewed text delta,
never the synthetic local ancestry or its 55 historical skill-book WebP files.

The source PRs' separate official CI passed on the earlier `ecf76f1e` base.
The #1306 artifact retained and exposed all 15 original PNGs for inspection.
Those receipts do not prove this new-main union or artwork inside fullscreen:
the original art cases exit fullscreen before cutting, while #1305's new
fullscreen cases exercise the renderer fallback with WebGL blocked.

The original five art cases remain unchanged. Two additional cases in the same
owned E2E file use pumpkin soup at 667×375 with production WebGL enabled:
one keeps actual native fullscreen, and one rejects only `requestFullscreen`
to exercise the existing viewport fallback. They cut once without leaving that
presentation, check actual draw/resource budgets, pause/resume the same run,
switch to SVG and verify every whole/cut polygon, cut a second time, then exit
and re-enter presentation and the native renderer without losing progress.
They record short-landscape geometry before screenshots can scroll the canvas,
require the live scene and direct action to fit, and attach original PNG Buffers
through the existing helper/report path. The original resource limits, assertions,
case timeout and CI selection remain unchanged; no product behavior is changed
to anticipate an unobserved failure.

The new cases and their PNGs require the next exact-candidate official CI run.
Local discovery/type checks and pure tests are not native browser evidence.
No merge, deployment, human visual approval or complete-game acceptance is implied.

## Official union failure follow-up, 2026-11-07

Draft #1309 head `76fbdc14edbb4b5510877adcbaa2151c341ea46e` received actual
browser evidence in run `42383640560`, attempt 1. Its default shard 1 had 806
passing and three failing cases. The plant-burger trace shows the test queried
an exit button before `fullscreenchange` updated it, got zero matches and never
clicked exit. The art cases now wait for entered presentation and its settled
control before clicking the real exit button; no timeout or exit assertion is
weakened.

Both new 667×375 cases failed before their first cut. Original PNGs show the
board clipped below the viewport, and trace geometry records the live scene
from y=219.6875 to y=477.390625 in a 375px viewport. Draw counts remained within
the existing limits (88 calls, 18 geometries, 3 textures). The settled-entry
handler had scrolled the tall keyboard section, rather than the actual scene.
The cooking start now supplies that scene as a separate view target. After
native or viewport entry settles, only that connected child of the original,
still-focused section in the same fullscreen host may scroll. The scene never
receives keyboard focus. For an entry with a supplied focus owner, detached or
moved targets, moved focus, unmount and stale ownership cannot cause a delayed
scroll or refocus. Callers without a separate
view retain the original target; explicit exit and the one-attempt latch remain
unchanged.

The ordinary cooking begin/resume layout scroll remains unchanged: the failing
run did not reach resume in these two cases, so no separate resume defect is
claimed. The cases additionally check section focus at start/resume and record
resumed geometry before any screenshot can scroll it. Original resource and
geometry limits, native API ownership, seven case registrations and 25 expected
PNG Buffer attachments remain intact. No scene dimensions, CSS, CI selection,
renderer, game state or timeout is changed.

Production-handler probes include positive and negative ownership cases and
run against both candidate source and the exact failing source. They do not
substitute for mounted React, native WebGL or browser geometry. The corrected
candidate still requires its own official CI and PNG inspection; the previous
failure artifacts do not prove the fix passes. Local missing Three dependencies
and build packaging restrictions remain explicit verification boundaries.


## Official resume follow-up, 2026-11-07

The next official Draft #1309 head, `134be68706d012dd3a2fe077db4cfbff762ad93c`,
was tested in run `42390468143`, attempt 1. Its default shard 1 passed 807 cases
and failed only the two new fullscreen cases, now at resumed geometry. The five
original art cases passed. Both new cases passed start and first-cut geometry
(scene bottom 375.390625 against the unchanged 376px ceiling), kept the real
first cut and stayed within resources (88 calls, 22 geometries, 3 textures).

Original failure PNGs and traces now establish the previously unverified resume
issue. Both traces show fullscreen scrollTop 102 at start/cut, 325 during the
resume click's actionability scroll, then 69 immediately after the real resume
handler. Section focus and native/viewport ownership still pass. Scene dimensions
stay unchanged, but it moves down 33px to bottom 408.390625. The actual CSS
resources in those traces retain 72px fullscreen scroll padding and 12px layout
scroll margin; the resumed layout top of 83.890625 matches the existing
layout-target start alignment, with the mission header above the live scene.

Only a successfully accepted paused-to-playing resume now reveals its live
scene with nearest alignment after the existing section focus. A ready cold
start keeps its original layout scroll. Fullscreen entry, its one-attempt latch,
manual exit, asynchronous ownership guards, CSS, renderer and all browser
assertions/timeouts remain unchanged. Actual-handler probes cover the optional
callback, existing native/viewport ownership, explicit exit, rejected resumes,
and preserved run identity, step, reports and cut progress. They fail against
the exact previous source and pass against the candidate, without simulating
browser geometry. The same seven official browser cases and 25 expected PNGs
must still execute and be inspected on the next exact candidate; SVG and reentry
were not reached in this failed run, and local process tests do not verify them.
