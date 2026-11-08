# Integrated cooking candidate, 2026-11-08

## Current candidate

The current unpublished candidate integrates the controls and presentation actions
into the bounded game stage for all 62 default guided recipes and all four native
market free-cooking routes. The six non-cooking games are unchanged. The four
`practice=1` routes remain alternatives, not four additional games; this is not
completion or playability acceptance of all 72 entries.

The combined implementation has 253 passing focused runtime tests and 167
successfully collected browser tests. Typecheck, build, module and diff checks
passed locally. Current-candidate browser/native execution is `not_run` because
of the established local Chromium socket EPERM restriction; collected cases are
not passes. Published `fe153d8c` passed its complete official Verify and CodeQL
runs, but that evidence does not validate this later candidate. Exact evidence,
safe-area/focus changes, artwork changes and remaining limitations appear below.

The following original guided-only scope and validation sections are historical
records through `fe153d8c`, including superseded failures. Their descriptions of
unchanged market layouts and then-pending checks do not describe this current
candidate. The later local market-family and combined-candidate sections record
the subsequent work.

This is a draft response to the user's rejection of a fullscreen web page with
controls outside the game. It is not completion of all 72 game entries, a release,
a performance acceptance, or an accepted art direction.

## Historical scope through fe153d8c: what changed

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
pumpkin-soup, baked-sweet-potato, cream-risotto and plant-burger. Each scene now uses one large continuous food, partitioned at the actual knife
planes. Only accepted cuts separate a segment and reveal its true cross-section;
elapsed time and rejected gestures do not. Per-step geometry and materials are
bounded and released on rebuild/exit. SVG fallback retains the existing 2D artwork and still accepts input.

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

## Historical validation through fe153d8c

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
  browser cannot reach this checkout's loopback preview. Local browser execution is not a pass. Official CI screenshots are discussed
  separately below.
- Latest-head full CI, real phones/Safari, GPU/FPS,
  actual OS sharing and human art/playability acceptance remain pending.

The first local combined test run exposed old scroll expectations after an
unnecessary handler change; the original accepted-start/view-target behavior was
restored and all 230 tests were rerun. The failure is not a passed run.

A follow-up static review found three candidate layout/accessibility defects:
legacy-theme precedence and relative overlay positioning, fixed canvas sizing
covering lower targets after fullscreen exit/help expansion, and a covered but
focusable help summary while paused. The follow-up uses explicit scoped styles,
ResizeObserver measurements of the real stage/HUD with safe-area spacing, and an
inert non-playing tool dock. The initial browser additions asserted the windowed-help canvas boundary and
paused focus exclusion. CI later exposed that excluding the entire dock also
removed the established paused recipe-help behavior; this is repaired below.

The superseded first CI log exposed an actual JS-only StrictMode fixture build
failure caused by importing CSS directly from CookingGame. The style import now
lives in the arcade entry and a regression runtime test bundles the real component
without a CSS output target. Exact-name fullscreen locators also failed: generated
icon text contributed to the accessible button name. Explicit accessible labels
now preserve the existing fullscreen/back/help names independently of visual icons.
Those superseded logs remain failures.

The complete official Verify run 42457211738 on head 702fa6d6 failed: UI shard 1
had 762 passed and six failed; UI shards 2 and 3, all eight runtime partitions,
the runtime aggregate, static/governance/source checks and CodeQL passed. All 12
preparation/immersive cases passed without retries and retained 35 real PNGs in
artifact 13609851969. The 320px, 667px and desktop stage PNGs, the 200% text failure
and a native pumpkin-cut PNG were actually inspected. Ordinary-size controls are
inside the stage and solids have depth and contact shadows. Food is still small
and repetitive; these images are not human art or all-game playability acceptance.

The six browser failures have three root causes. Four paused recipe-help cases
were blocked by the whole dock's inert attribute. The single shared help element
now moves into the visible pause overlay, while the covered cooking controls stay
inert. The old unavailable-art test still expected a removed decorative cover and
hidden FoodArt; it now retains the lobby/storage assertions and checks the live
SVG fallback plus a real successful cut. Finally, 200% text made the share label
push Exit under the renderer button. Presentation actions now reserve separate
44px icon targets with full accessible labels, renderer text may wrap, and the
actual top-row/toolbar heights position the mission and scene. Tests retain normal
clicks, 200% text, both compact/landscape flows and keyboard help, with extra hit
and non-overlap checks and PNG retention. No force-click, longer timeout or deleted
case is used. These repairs need a new official run; the old failure is not fixed
by Ted's earlier approval or by the 12 passing preparation cases.

## Follow-up after bf9292fd

Verify 42462370423 failed. UI shard 1 finished with 767 passed and one failed,
without retries; UI shards 2/3, the full runtime aggregate, static checks and
CodeQL passed. All four paused-help cases, the unavailable-art/storage fallback and all
12 preparation cases passed. Artifact 13610878934 contains the report and 40 PNGs.
The actual remaining 200% failure PNG was inspected: Start was pushed into a
second column outside its overlay. The legacy compact theme still supplied
`flex-wrap: wrap` and `overflow: visible` despite the new column/max-height rules.
The overlay now explicitly disables wrapping, contains overflow and preserves
its action button's natural height. No expectation or normal click was removed.
The paused/landscape portions of that 200% case had not been reached.

The same real screenshots exposed a separate art weakness: small whole foods
repeated in a line, with tiny detached cut faces. The new candidate instead has
one dominant continuous potato, pumpkin, sweet potato or mushroom. Its skin and
flesh are actual geometry partitioned at each domain knife plane. Accepted cuts
separate full cross-sections on the board; pumpkin seeds and mushroom stalk cuts
are geometry, not painted screenshots. The knife follows the food's height.
The rules, pointer coordinates, save data and SVG fallback remain unchanged.

Geometry tests now cover every cut count, board contact and footprint,
nonintersecting separated slices, exact guide projection, hidden internal faces,
no elapsed-only redraw, fixed per-step resources and one-time disposal. The two
overlapping old lifecycle/accepted-cut probes were combined into one stronger
five-recipe test, with an explicit nonempty set of all five recipe IDs. This
changes the focused total from 230 to 229 without dropping those guarantees.
The new models and the 200% overlay repair require new native CI images; no
visual pass is claimed for them before those images are inspected.

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

## Local market-family follow-up, 2026-11-08

This section is a separate, unpublished follow-up based on exact head
`fe153d8c485452d2e793c7fd2cc4f137d8ea8900`. It does not replace the exact-head
CI or screenshot acceptance of draft PR #1310. The original worktree and branch
remain untouched. No push, new PR, approval, merge or deployment was performed.

The current open-PR search, #1310 scope/body/review threads, related branch names
and merged #1288/#1290/#1301 records were checked before editing. No active
conflicting claim on these four interfaces was found. #1310 explicitly excluded
the market layout; a contributor name or Ted's dismissed historical review was
not treated as ownership or current approval.

A later parent review identified Ted's new #1311, branch
`feat/guild-repository-workspaces-20261108` at `5d26d0d…`. The parent read
its 64-file guild-launchpad/portal-shell scope and reported no direct market/game
file overlap. That branch is untouched; any later combination still needs a
fresh base/conflict check and exact-head CI.

### Implementation and boundaries

The four native free-cooking routes (egg-fried-rice, steak-dinner, shawarma and
corn-dog) now use a single bounded scene containing presentation controls,
heading/pause/restart/help, live food view and ingredient/tool/sauce palette.
Heat, the primary gesture alternative and Serve have reserved, non-scrolling
tracks. Only secondary palette content scrolls. Short landscape shares one real
header row; the food remains a separate 6:5 hit rectangle. The portrait dock
sizes to its actual enlarged text instead of imposing a fixed clipped height.
Safe-area insets, viewport rejection fallback, normal-mode reflow and 44px
critical targets are covered by source and authored browser assertions.

There is no guided recipe progression in this family. Domain cooking, ingredient
choices, coating hold, selected portion, salt/sauces, heat/cooldown, scoring,
saving, completion, renderer hit testing and WebGL/resource ownership remain
production behavior. Ready/pause overlays cover inert gameplay; visible help and
restart are native modal dialogs with isolated Tab/Escape and focus return. Error
status opens the paused in-stage retry controls. Shared fullscreen Escape still
exits presentation before gameplay pause; a native modal owns Escape first.

A new original SVG fallback draws the actual bounded portions, selection,
coating/cooked side and sauces. Its portion hit targets drive the same domain.
It is an accessible fallback improvement, not a replacement for native rendering
or evidence that the existing market 3D models meet the user's art expectation.
Native market food/stage, simulation and resource-budget code are unchanged.
No external reference artwork/code was copied and no reference mechanics were
claimed played. The six daily/party games are outside this follow-up.

### Browser coverage matrix (authored, not locally executed)

| Source | Recipes | Render path | Sizes / scale | Behavioral assertions and retained images |
| --- | --- | --- | --- | --- |
| Existing four UX-9 complete-cooking cases | All four | Native WebGL and native result | 390x844; steak result also 667x375 | Real ingredients, heat/time, flip/toss/shave/fold/coating/drain, actual sauce drag, authoritative score/save, result inspection, download and share/link fallback. Result PNG buffers retained; completed Share focuses its panel. |
| Existing four UX-16 presentation cases, expanded | All four | Native WebGL with rejected browser fullscreen / viewport presentation | 320x568, 390x844, 667x375, 1280x800 | Real ingredient/tool palette, canvas identity, disabled unfinished share, mode explanation, help/pause/resume, exit and Escape. Stage bounds, 6:5 rectangle, non-overlap, critical-target clipping and elementFromPoint checks. Full-stage/tools, help and paused PNG buffers. |
| Four new MK-1 cases | All four | Supported SVG fallback, not native | Same four sizes; 200% text at 320x568 and 667x375 | Normal clicks and real SVG food hits change persisted domain state; palette switching, primary action, pause freezes save, inert background, Space/Enter help, modal Tab wrapping/Escape/focus return, restart cancellation, exit/re-entry and fullscreen rejection. Full-stage/sauce, enlarged tools, paused and landscape PNG buffers. |
| Additional checks within MK-1 | All four | SVG fallback | 195x422 CSS viewport, fullscreen and normal; 667x375 normal, including enlarged text | Narrow reflow proxy for 390x844 at 200% browser zoom, scene and persistent-control containment. This changes CSS viewport size; it does not automate browser chrome zoom. |

The 200% text test doubles computed text size/line height of existing scene nodes;
it is not OS accessibility/Safari acceptance. Native 200% text, real phone/Safari,
full OS sharing, GPU/FPS and human art/playability acceptance remain pending.
No force clicks, timeout increases, skipped cases, CI filters or workflow changes
were introduced. The whole absurd-daily spec still collects 155 cases, including
all four existing genuine free-cooking completion cases. Screenshots are attached
as PNG buffers so successful CI JSON reports retain them; collection alone does
not produce those images.

### Local verification and limits

- Full typecheck and build pass; the existing large-chunk warning remains.
- 250 focused actual runtime cases pass with zero skips across absurd-daily,
  daily-game-focus, cooking-ingredient-visuals, kitchen-food-batch and
  market-cooking. Market-specific tests execute actual TSX event/effect closures,
  real domain rules, SVG markup and installed Three geometry, with explicit
  React/DOM/renderer boundaries. They are not native layout/focus/GPU acceptance.
- The first added-test iterations failed on a real 350ms action-cooldown
  expectation and a cross-VM object-prototype assertion. Test timing and the
  primitive assertion were corrected, then the entire focused set was rerun.
- Source review exposed fixed-height dock clipping and inherited fire-button
  padding at short/enlarged sizes. The final layout reserves natural-height
  action rows, bounds only the secondary palette, compacts fire-button padding
  and shares the landscape header. Source review is not a visual pass.
- Module ownership and whitespace checks pass. Three existing unrelated unmapped
  portal surfaces remain warnings. Exact affected context has no blockers.
- Local browser execution is `not_run`: the previously established Chromium
  socket EPERM restriction was not retried or bypassed. No user computer,
  security flags, alternate browser profile or network workaround was used.
- Full database-backed runtime/UI suites and official exact-head CI are pending.
  No isolated test database was supplied for this local follow-up. These local
  focused results do not fulfill the separate full-runtime or native UI gates.

Publication and review of the follow-up are the parent's next decision after
#1310's current exact-head verification, not an action taken by this worktree.

The final boundary check found that the shared cookbook-save warning still lived
outside FullscreenGame. A small market-only follow-up routes that same warning
and retry action into the market loader/paused overlay and completed result.
Other families keep their existing location; cookbook storage/scoring semantics
are unchanged. An actual-TSX runtime case covers the active warning-to-pause flow.
The existing native steak completion case now injects a cookbook-only quota
failure, checks the in-stage warning, restores storage and retries successfully.
This browser addition is collected, not locally executed.

## Combined local candidate: market scene and remaining-food contact

The parent-authorized preparation fix from
`7d8e9ac6c3c0258808e80241ae00f123fdb74245` was cherry-picked without conflict
as `b3a387fffc3de243492dc2bdacc0297f18a3e905` onto the isolated market branch.
It changes only `preparation-model.ts` and its existing runtime test file: after
the mushroom's last stalk-bearing segment is cut away, the still-connected cap
settles as one aggregate onto the board, and knife height follows the same
vertical offset. Knife x planes, accepted-cut semantics and resource ownership
remain unchanged. The added test covers every cut count and reset for all five
real preparation recipes, including contact, remaining-body seams, cut-piece
separation, board bounds, knife height and unchanged allocated resources.

On this combined source, all 251 focused runtime tests pass with zero skipped.
Full typecheck, build, module ownership and diff whitespace checks pass; the
existing large-chunk warning and three unrelated ownership warnings remain.
Context is based on `242dbd400a28c283fc684f5b6cbf11070769baae`, with the full
union of the original PR's 12 files and the market work's nine files: 17 unique
paths, 70 instruction/version sources and 36 chunks, with no blockers. The
applicable source contents are unchanged from the already-read full context.

This is a new, unpublished combined candidate. It has no native browser
screenshots or official exact-head CI results. Earlier PR #1310 images and CI
cannot establish visual acceptance for this combined source. Browser execution
remains not_run under the existing EPERM boundary. The original #1310 worktree
and fe153d8c head were not modified, and no push, review approval, merge or
deployment was performed.

## Published fe153d8c verification and screenshot review

The parent verified that [Verify 42466292861](https://github.com/FreeTWAI/freedom-platform/actions/runs/42466292861)
completed successfully for the published exact head
`fe153d8c485452d2e793c7fd2cc4f137d8ea8900`. UI aggregate job 128699840300,
the runtime aggregate and CodeQL passed. Default UI shards reported respectively
768 passed/0 skipped, 719 passed/46 skipped, and 753 passed/13 skipped. The five
additional pinned UI fixtures reported 13 passed/1 skipped, 1, 20, 46 and 4
passed. These results apply only to fe153d8c, not this unpublished candidate.

The actual CI PNGs were inspected, including both 200% text sizes and paused-help
states, native 320x568/390x844/667x375 full stages and the native pumpkin landscape.
The zero-inset ordinary-size controls are in the stage and the native cuts have
visible volume. There are still layout/playability limits:

- At 320x568 with doubled text, the live food view shrinks to approximately
  90x63px and the heading is cramped. The large alternative-action button works;
  this does not establish comfortable direct-food interaction or art acceptance.
- The 667x375 enlarged dock clips lower text and relies on internal scrolling.
- Both enlarged paused-help PNGs were taken after the test exits fullscreen.
  They show a scrolled normal page, not a proven trapped fullscreen overlay.
  The same passing test subsequently clicks Resume normally. Its assertion
  checks Resume against its overlay owner, not the whole viewport or every line
  of help. It does not prove no-scroll visibility or fullscreen 200% pause UX.
- CI supplied zero physical safe-area insets. The previous landscape rules
  hard-coded toolbar top/left and dock right/bottom, leaving a real notch/home-
  indicator risk despite the passing click tests.

## Safe-area and post-commit focus follow-up

The parent authorized a narrowly scoped safe-area repair rather than a 200% UI
redesign. Four production CSS properties resolve the browser's env insets.
Guided toolbar, presentation/mode controls, dock, overlays and safe food bounds
use those values; zero-inset geometry retains the previous layout. Market uses
same values for normal edge-to-edge mode, fullscreen padding and native dialogs.

Existing browser cases now override those production properties with top 28px,
right 24px, bottom 32px and left 40px. They check actual control/food bounds, hit
targets and non-overlap, pause/help/resume, native rendering and SVG fallback,
and retain PNG buffers. Market also exercises real heat changes and normal-mode
insets. Original zero-inset screenshots, enlarged-text cases, keyboard assertions
and native completion cases remain. The two specs still collect 167 cases.
This deterministic CSS stress is not real-device notch or Safari acceptance,
and these new browser assertions have not run locally.

Read-only review also found an actual market focus regression: Start/Resume
called focus while the previous ready/paused DOM was still inert. Fullscreen is
still requested synchronously in the user gesture, but a post-commit layout
effect now hands focus to the same connected surface after inert is removed.
It checks for a newer focus owner; pause, retry/disposal and detach invalidate
pending handoffs. Browser assertions cover focused Start, Resume and restarted
Start in native/SVG flows. A real-TSX runtime case checks deferred focus,
non-stealing and cancellation. Existing synchronous fullscreen-handler fixtures
were updated with the new ref/document boundary without removing assertions.
Their first five missing-fixture failures are not counted as passes; all 252
focused tests passed on rerun, with zero skipped. Typecheck and build passed.

That fixture update adds `tests/runtime/absurd-daily.test.ts` to the exact union,
so final context now covers 18 actual paths, not a narrowed 17-path selection.
The latest parent owner check found #1311 at
`6cff9d59f196a8f182e163ea43cd1f548564b062`, still open/unmerged against
242dbd4 with 64 files and no direct game-file overlap. Its branch is untouched.
This candidate remains unpublished and has no official exact-head browser/CI
acceptance; fe153d8c's successful run must not be presented as this code's pass.

## Final local integration after safe-area/focus review

Safe-area and post-commit market focus changes were committed as `880e97d9`.
The parent-authorized art follow-up
`d0663775d6b620c7b45078a245e51f823aee145b` then cherry-picked cleanly as
`3e926daf`. The shared preparation E2E file auto-merged without conflicts;
nonzero-inset checks and all five new late-cut native capture flows are retained.
The art change raises root-vegetable tips, gives pumpkin a taller vertically
lobed body and makes the mushroom stalk visible below its cap. It retains the
previous connected-remainder contact/knife fix. CPU geometry tests and the
parent's CPU preview are not GPU screenshot or art acceptance.

On the combined source, all 253 focused runtime cases pass, zero skipped.
Full typecheck, build, module ownership and base-to-candidate whitespace checks
pass. The large-chunk warning and the same three unrelated ownership warnings
remain. The two complete E2E specs collect 167 cases, including the unchanged
12 preparation cases with stronger flows. No timeouts, force clicks, skip lists
or CI selection were weakened. The final exact context uses base 242dbd4 and
all 18 actual affected paths, with unchanged applicable source contents and no
blockers. The isolated branch is not published. Native insets, new focus
assertions, late-cut images and full exact-head CI all still require execution
and review on this new candidate; the successful fe153d8c results above remain
strictly separate evidence.
