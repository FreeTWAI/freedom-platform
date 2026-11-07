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
