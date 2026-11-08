# Integrated guided-kitchen candidate, 2026-11-08

This is a draft response to the user's rejection of a fullscreen web page with
controls outside the game. It is not completion of all 72 game entries, a release,
a performance acceptance, or an accepted art direction.

## What changed

The guided cooking stage owns its heading, pause/restart actions, instructions,
live renderer, accessible alternative actions, timing feedback and help. The
fullscreen/share controls overlay that same bounded viewport. The tool dock may
scroll internally for enlarged text; the game is no longer a canvas followed by a
separate document card. An actual live kitchen is shown before Start instead of a
large unrelated cover. Existing accepted-start, pause/resume, keyboard, restart
modal, progress/save and result/share logic is retained.

This layout applies to the 62 recipes using the guided route by default and to
explicit `practice=1` routes for the four market recipes. The four market cooking
interfaces and six non-cooking games retain their current layout. This must not
be summarized as all 72 games redesigned.

Four preparation foods now use original curved solid geometry: potato, pumpkin,
sweet potato and mushroom. The five affected first-step recipes are fish-and-chips,
pumpkin-soup, baked-sweet-potato, cream-risotto and plant-burger. Whole and cut
models share bounded resources but remain separate visibility states. Accepted
domain cut counts alone reveal the inside; elapsed time and rejected gestures do
not. SVG fallback retains the existing 2D artwork and still accepts input.

The new models have no external assets or textures. Existing disposal ownership,
heat isolation and draw/resource budgets are unchanged. The dish-result renderer,
recipe rules, scoring and saved data are not rewritten by this increment.

## Inspection and boundaries

The official reference index at https://sherrygamestudio.com/games/ was opened in
the cloud browser. Its steak page reached its starting UI, but its WebGL context
failed and the cooking process could not be played. The published descriptions
are reference information, not proof that those interactions were tested.
No third-party game code, artwork or brand material was copied.

The live freetwai.com guided fish-and-chips route was inspected: a separate
fullscreen/share row, recipe toolbar and large cover were visible; source
confirmed the tools were an adjacent aside that moves below the canvas on phone.
Existing work #1305/#1306 was already integrated by #1309. This branch starts at
main 242dbd400a28c283fc684f5b6cbf11070769baae, and does not alter Ted's branches.

## Validation

- Full `npm run typecheck` and `npm run build`: passed locally. The existing large
  chunk build warning remains.
- Focused actual runtime tests: 229 passed, zero skipped across absurd-daily,
  daily-game-focus, cooking-ingredient-visuals and kitchen-food-batch. Geometry
  tests use installed Three, with the existing renderer boundary stub. They are
  not native GPU or visual acceptance.
- Module ownership check and diff whitespace check: passed. Three pre-existing,
  unrelated unmapped portal surfaces remain reported.
- Twelve cooking-preparation browser tests collect successfully. Seven existing
  cases are retained, and five new cases cover 320x568, 390x844, 667x375 and
  1440x900 plus the 320px viewport fallback. New cases assert same-screen stage/control bounds, use an actual
  pointer cut, pause/resume, SVG fallback, restart cancellation and lobby return,
  and attach real screenshots as PNG buffers for CI retention.
- Local browser execution: blocked before page execution. Installed Chromium
  fails its required local socket with EPERM, including the reviewed execution
  attempt. No security-flag or profile workaround was used. The separate cloud
  browser cannot reach this checkout's loopback preview. No new native screenshot
  or local browser pass is claimed.
- Full DB/runtime suites, exact-head official CI, real phones/Safari, GPU/FPS,
  actual OS sharing and human art/playability acceptance remain pending.

The first local combined test run exposed old scroll expectations after an
unnecessary handler change; the original accepted-start/view-target behavior was
restored and all 229 tests were rerun. The failure is not a passed run.

## Remaining rollout work

1. Review exact-head CI screenshots and all gameplay states, including every
   guided technique and result sharing. Repair failures before considering review.
2. Refine the remaining preparation ingredients and the four free-cooking scenes
   from real gameplay, not from cover images.
3. Bring all six non-cooking games' controls into their own scene and verify their
   touch, keyboard, fallback, finish and replay loops.
4. Review real phone layouts and human playability for every entry. Retain a
   per-game acceptance record; shared code coverage is not 72 individual passes.

Ted is the requested maintainer reviewer. No approval, merge, deployment or
permission/configuration change is part of this branch.
