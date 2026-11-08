# Integrated daily-game candidate, 2026-11-08

## Scope and ownership

This local candidate starts at `a694b5fc92f5acdec71997629389028a929b9a4c`
and changes the three daily games: photo, stamp and cash. It preserves the
62 guided cooking and four Market routes from that exact base. Chair, tofu and
holiday remain separate future work. This is not completion or acceptance of all
72 entries, a deployed version, a GPU benchmark, or an approved art direction.

The first reviewable checkpoint is
`94b88d59a1350c807bd25fe7f5779756628b4130`. Subsequent corrections are local
commits on `assistant/daily-scene-local-20261108`; no remote branch is updated.
The governance baseline is `242dbd400a28c283fc684f5b6cbf11070769baae`.
Existing PR #1310, other owners' branches and the shared fullscreen component are
not overwritten. This change does not introduce assets, dependencies, backend
writes, API changes, migrations, payment behavior, XP or contribution claims.

## One bounded game owner

The daily stage now owns the heading, live view, HTML action controls, notices,
photo contact sheet, renderer choice, pause/resume, help and restart. Shared
fullscreen and share controls occupy the same bounded game container. Results,
image-error recovery and sharing remain inside it. Small screens and landscape
use internal lanes and scrolling for controls or enlarged text; the surrounding
page is not intended to become a second game-control panel.

The central canvas is the only scene-pointer target. Buttons and the zoom slider
are its siblings, so interacting with a control cannot also drag the camera,
stamp a paper or classify a card. HTML controls retain keyboard and assistive
activation. Fullscreen is requested from the original Start gesture, and game
focus moves after React removes `inert`, without a delayed focus timer.

The styling uses the existing arcade palette and safe-area variables. It does
not replace the platform logo. The native scene retains its actual Three meshes;
the alternative is explicitly labelled **輕量插畫**, never described as Three.js.
No third-party reference artwork or game source is copied.

## Real rules and image transactions

- Photo retains three clients, 12 seconds per client and two shots each. Camera
  position, field of view, pose and projected landmarks govern the actual grade.
  Shutter acceptance checks the deadline before capturing, even before the next
  animation frame. Capture and grading must succeed before film is consumed.
  A zero-photo retry resets the first client's camera, gesture, film and clock.
- Stamp retains its uncounted practice paper, 12 documents, inclusive radius
  `0.24`, 220 ms cooldown and bounded marks. Pointer coordinates intersect the
  actual paper plane. The visible target ellipse now uses the same canonical
  x/y scale as scoring, correcting the old vertically compressed guide. Accepted
  contact is visible briefly after advancing a document; misses remain on paper.
- Cash retains 30 cards, six decoys, exactly one million in prop currency and the
  160 ms cooldown. Wrong or stale decisions do not consume a card. The visible
  current card follows pointer drag, with the original 48 px decision threshold.
  A pointer can begin sorting only on the current card's actual projected plane.
  The completed light scene draws all 24 accepted bills and six rejected vouchers.
- Pointer and button actions retain down-time ownership and subject identity.
  Secondary pointers, cancellation, lost capture, blur, pause, Escape and client
  transitions cannot complete a held action against a later item. Pausing keeps
  progress and elapsed time; resuming never restarts the run.
- Completed-run capture failure retains the exact original result facts and
  permits image retry without replaying scoring. Existing PNG, workshop JPEG,
  photo selection, share cancellation and publish lifecycle remain authoritative.

## The non-WebGL renderer

`daily-scene-model.ts` contains shared camera, projection, photo landmark,
paper-contact and card-contact math. It has no score or clock authority.
`daily-scene.tsx` draws an original state-driven Canvas2D illustration, using the
same camera projection and domain state as the native scene. Its people,
photobomb board, umbrella, pigeons, paper, target, marks and cards respond to the
actual run. It is playable, not a cover image, prerecorded scene or scorecard
substitute.

Native loading failure offers an explicit light-renderer choice. Switching
renderers pauses and preserves this run, fences stale imports and disposes the
previous renderer. Resize and renderer failures remain recoverable in the stage.
Direct update failures and retained media-effect callbacks identify the current
renderer in recovery messages, rather than calling a light Canvas2D failure 3D.
The light renderer reports zero GPU draw calls/resources rather than inventing
Three statistics. Native geometry/draw-call budgets remain 95/75/70 for the three
games, and the existing diagnostics bounds remain unchanged; real GPU compliance
still needs browser execution.

Both renderers capture their actual current canvas into a 960×720 JPEG, using
letterboxing to preserve the camera aspect ratio. Export failures are explicit.
No synthetic image, canned score or generic cover is substituted for a frame.

## Local evidence and remaining gates

Evidence is local and does not replace official CI or browser acceptance:

- Production build and full TypeScript check passed. TypeScript needed the
  existing runtime's 4 GiB heap option; an earlier default-heap run exhausted its
  memory and is not counted as a pass.
- The focused daily, focus, cooking geometry and Market runtime regression set
  passed 283 cases after the transition, shared-card-pose, accepted-stack and
  current-renderer error corrections, with zero skips (30 new daily tests).
- The initial daily suite compared 1,296 independent native Three landmark/camera
  combinations with the shared math. TSX tests execute production functions with
  controlled React hooks, clock and renderer ports. Canvas tests execute the
  drawing/capture/cleanup code against a controlled Canvas2D port. Another
  252 cash-pose combinations include 2,268 independent contact samples. These tests
  are not real DOM, native pointer-capture, raster, GPU or visual evidence.
- Playwright successfully collected 178 cases across `absurd-daily.spec.ts` and
  `daily-game-focus.spec.ts`. Twenty newly authored cases cover native/light full
  journeys, real paper contact and cash drag, input ownership, timing, explicit
  non-WebGL recovery, PNG/JPEG retries, safe insets, 200% text, three small-screen
  sizes, dialogs and focus. Discovery is not a browser pass. The suitability of
  existing per-test time budgets remains unverified; none were raised.
- The existing e2e orchestration harness passed 12/12. Broad governance initially
  passed 663/670: four fixture cases failed at a denied Unix socket (`EPERM`),
  and three source-binding cases observed concurrent local edits. The denied
  socket actions were not retried. The complete source-binding test file passed
  10/10 on the clean `5fd734e8` commit; broad governance is still not a full pass.
- `npm run test:contracts` could not start cases because Python `pytest` is not
  installed. Full runtime and cross-repository integration are `not_run` because
  no explicit disposable `TEST_DATABASE_URL` is provisioned. No implicit or
  production database is used.
- Browser execution is `not_run` under the established local Chromium/socket
  restriction. No browser, security flag, profile, external environment or user
  computer workaround was attempted. Installed dependencies include `sharp` but
  no Canvas2D runtime; therefore no renderer-only PNG is claimed either.

The unknown new test path correctly expands the context to all 94 modules.
All 132 unique instruction documents were fully read in both base/candidate
revisions (264 sources, 268 chunks). Exact hashes were compared, with no rule
differences. The scope was not reduced to bypass that gate; unchanged-source
reading evidence can be carried forward only after exact hash comparison. The
local context completeness check is not proof of understanding or CI approval.

Required remaining validation includes the full applicable runtime/governance
and UI gates, actual native/light screenshot review, mobile Safari and real
phones, 320/390 px portrait and 667 px landscape, 200% text, safe-area hit targets,
keyboard and assistive technology, original-gesture fullscreen, focus return,
real PNG/JPEG/OS sharing, GPU draw/resource/FPS budgets, sustained memory cleanup,
and human playability/art acceptance. Do not infer any of these from a build,
unit test, source review or successful test discovery.

## PHOTO composition follow-up from `1fb245c3`, 2026-11-08

This separate local PHOTO candidate replaces the photographed bordered-canvas /
cream-controls-board composition. The actual Three or explicit Canvas2D world
fills the entire bounded owner, in both normal and fullscreen presentations.
No opaque controls surface occupies a second lane below it. Camera arrows,
zoom, shutter, next client, pause, renderer choice and album float at the scene
edges as sibling HTML controls. The central world remains a pointer target.

The active HUD retains full-size remaining seconds, client number and film
count. Short visible button labels retain explicit accessible names; the film
count has moved to its own visible HUD output rather than relying on long
shutter copy. The current four-character goal stays visible in the world at manual and timed
client transitions. A visible saved-star / unsaved indicator reflects the actual
shot outcome. Full requests and shot details remain available in the start/pause
copy and help/album dialogs. The album uses the actual saved
frames and their original captions. Closing a dialog restores its trigger and
leaves the run paused until the player resumes. Empty-run and capture failures
remain visible, and long recovery copy can scroll internally without removing
the recovery buttons from their owner.

The zoom input remains 38–60, initially 44. PHOTO alone adapts portrait
projection: with actual aspect `a`, vertical FOV is
`2 * atan(tan(inputFov / 2) / min(1, a))` (angles converted consistently).
The input is the original square-camera zoom, not fixed vertical degrees.
Portrait retains the old square horizontal field of view and gains vertical
world space without stretching the subject; square and landscape are unchanged.
Native Three, Canvas2D drawing and framing use the same `dailyCamera`, and
capture reads that actual frame. The original anchors, ±.97 threshold, pan
limits, 12-second rounds, obstruction and grades are unchanged.

This does not change held-input fencing, native meshes, Canvas2D art, actual capture letterboxing,
result selection, exports or sharing. Stamp and cash retain their composition.
This is not new art approval or acceptance of the other 71 catalog entries.

The additional `daily-photo-composition.spec.ts` journeys retain all existing
20 AD scene cases. Fifteen new cases request real native/light full-stage PNGs
at 320×568, 390×844 and 667×375 with 100% and simulated 200% text. The normal and
fullscreen-rejected viewport PNGs use the same first-shot state at 200ms. They
also capture pause/help and explicit WebGL/capture failure recovery. Assertions
check real text ranges, visible 44px targets without scrolling each control,
full canvas dimensions and an unoccluded central pointer area. Pixel variation
is only a coarse nonblank check, not proof the character, framing or art looks
good. These cases require official browser execution and actual PNG review.

Local checks and exact source/context receipts are provided in the handoff.
The established local browser/socket restriction remains; no browser workaround,
user computer, install, push, publication or deployment was attempted. Physical
phones, mobile Safari, actual browser zoom, safe areas, touch/assistive technology,
GPU performance and human playability remain unverified.

### Independent review follow-up

The narrow PHOTO toolbar explicitly resets Restart against the more-specific
shared Daily dock rule. Browser assertions check all first-three buttons occupy
one non-overlapping row. Backing-resolution assertions preserve the native
640×480-before-DPR and light 960×720 budgets and separately require full CSS
canvas size; they do not assume a tall canvas must exceed 250 backing pixels.

`daily-photo-framing.test.ts` independently derives reachable pan intervals from
the actual projection matrix at 320×568, 390×844 and 667×375, zoom 38/44/60, all
three clients and 1,201 time samples per combination. At widest zoom it requires
actual .35-pad and .25-keyboard targets at every sampled instant, plus a fixed
portrait umbrella target across twelve seconds and near-settled pan. It also
checks unchanged obstruction, pigeon timing, stamp/cash cameras, square
horizontal scale and non-stretched world proportions. These are math probes,
not proof of subject legibility or good composition in real rendered pixels.

Capture-failure feedback has one visible owner: the compact retry alert replaces
the saved-status chip while it is present. The full error remains in the live
notice/help detail, with an explicit accessible retry instruction. Browser
recovery checks include the alert's actual text ranges and reject overlaps with
the timer, film, goal, zoom and action targets at the tested 200% sizes.

## STAMP full-workbench candidate (2026-11-09, local only)

The five exact historical `1fb245c3` native/light/200%-text STAMP PNGs were
inspected before editing. Both renderers still had a bordered paper world above
a separate cream controls card. The 320/390 enlarged-text views clipped/crowded
live copy, and 667×375 used only about 468px of width. Those passing historical
journeys are not visual acceptance and are not pixels from this candidate.

STAMP now fills the bounded owner with one renderer. Goal, real document count,
untimed-practice/elapsed time and misses float over the desk edges. The stamp,
renderer choice, pause, help, restart and presentation controls remain inside
that owner. The hit-test host has no HTML control descendants; the transparent
space between controls still belongs to the actual paper contact surface. The
old cream dock is removed. Long instructions/document titles remain in the
accessible live description and Help; the actual goal, time and progress are
visible during play. Paused/error copy scrolls inside its overlay, while the
start/resume/recovery actions retain their own pinned space.

Original art additions are a revolved solid stamp handle with a narrow waist
and domed grip, physical collars/base screws, layered paper stock, a sprung
clip and an idle ink-pad cradle. The handle is a 32-segment LatheGeometry,
owned/disposed by the native stage. Its terminal normals are normalized. No
third-party assets/code, texture-only substitute or new dependency is used.
The explicit Canvas2D fallback has a corresponding original tool silhouette
and desk accessories; it remains an illustration, not native 3D.

### Narrow projection change and unchanged game authority

The old fixed 40° vertical field of view cuts off the sheet if copied directly
from the near-square panel into a tall full-screen renderer. Only STAMP's
portrait effective FOV changes: the tangent of the old half-angle is multiplied
by `max(1.7, .90 / aspect)` when aspect < 1. Landscape stays at exactly 40°.
Position `(0,5.3,2.7)`, look-at `(0,0,.23)`, clipping planes, paper 3×3.7 at
y=.086, target radius .24, pointer/domain scales 1.2/1.5, .06 key movement,
220ms cooldown, untimed practice and all twelve formal documents are unchanged.
Native rendering, light drawing and ray/plane picking use the same camera.
PHOTO's projection and CASH are unchanged. Existing independent target-click
and camera tests now use the explicitly revised STAMP portrait projection;
no existing hit, timing, count, pointer or focus assertion was removed.

Pure source/Three math measured these full-paper pixel rectangles, in
left/right/top/bottom order, before any browser verification:

- 320×568: 24.6 / 295.4 / 151.3 / 413.3, effective FOV 63.49°.
- 390×844: 19.4 / 370.6 / 249.9 / 589.6, effective FOV 70.67°.
- 667×375: 181.5 / 485.5 / 38.6 / 332.6, unchanged 40°.
- Normal 320px viewport, actual 296×482 host: 33.1 / 262.9 / 128.4 / 350.7, 63.49°.
- Normal 390px viewport, actual 358×758 host: 17.8 / 340.2 / 221.0 / 532.9, 69.49°.
- Normal 667px viewport, actual 635×289 host: 200.4 / 434.6 / 29.7 / 256.3, unchanged 40°.

The normal widths retain existing 12px/16px arcade root gutters. Earlier
320×482 / 390×758 / 667×289 shorter-host probes remain as additional model
cases, not claimed normal browser dimensions.

Model checks retain the full sheet and all 12 target circles for five seeds
inside conservative clear areas designed for 200% text with explicit
12/8/16/8px safe insets. The smallest sampled target diameter is 42.5px at
320×568 and about 36px in short normal mode. This is **not** a claim of a 44px
physical target or phone playability. The actual 44px+ stamp button and keyboard
route remain available. Radius/scoring was not enlarged to hide this limit.

### Review repairs before visual acceptance

Independent source review found the legacy landscape stage max-width still
limited play to 468px at a 667px viewport. The STAMP stage now explicitly resets
max-width to none. Overlay paragraphs explicitly use the dark ink token rather
than inheriting the old toy theme's pale text. Browser cases retain strict
renderer/owner ratios > .99 and exposed paper/target checks, require the computed
max-width reset, and compare playing/paused host geometry. Normal-mode checks use
the real gutter-reduced owner rather than incorrectly requiring 320px.

Future browser observations check computed paragraph foreground and contrast
against both bounding underlays of the translucent cover, including start,
pause and error/recovery states. The current formatted timer is also in its
accessible label; production-handler tests cover practice, elapsed and pause.
These repairs are source/runtime evidence, not new browser pixel acceptance.

### Verification scope and remaining acceptance

Production-handler/runtime tests cover visible facts, actual time/pause, input
ownership, geometry/normals, native-factory contact, full paper bounds, all twelve
hits, bounded meshes and disposal. Canvas2D probes inspect the actual drawn
64-point target path and its corresponding picking coordinates. These use
controlled DOM/GPU ports and are not raster/native browser evidence.

`daily-stamp-composition.spec.ts` adds 16 genuine future browser cases. Twelve
cross native/light, 320×568 / 390×844 / 667×375, 100% / 200% actual text and
explicit safe insets. They require full-canvas/full-paper visible geometry,
uncovered target pixels, non-overlapping/unclipped live HUD, real practice and
all 12 documents, normal/fullscreen snapshots, modal return and actual Tab,
arrow-key and Enter input. Three cases use actual WEBGL_lose_context, explicit
light recovery, a one-shot final capture fault and a real earned/downloaded PNG.
One checks an initially unavailable WebGL context and explicit playable fallback.
Existing cancellation, stale-subject, focus and full-paper journeys are retained.

New visual/browser/touch execution is **NOT RUN** here. The five-file collection
contains 405 cases, including these 16; collection is not execution. Formal CI
must generate and retain the authored viewport, normal, pause, context-loss,
readback-failure and earned-result PNGs for independent visual review. No all-72,
human-fun, real-phone/Safari, actual notch, GPU/FPS or OS-sharing acceptance is
claimed. No socket/server/browser workaround, install, timeout/skip/workflow
change, publication, approval, merge or deployment was performed.

Build review initially rejected the pending typecheck→build shell because npm
might contact a registry. Read-only checks found no build log or running process;
the build had not started and the first typecheck's exit was unknown. The exact
build chain contains local generated-source checks, `npm pack --ignore-scripts`
of the dependency-free local skill-client directory, and the installed Vite.
After this evidence was supplied, one re-review of the same `npm run build` with
`npm_config_offline=true` and a writable cache succeeded, exit 0. No installation
or alternate execution route was used. Final exact-head local check counts and
source-context binding belong in the handoff; local checks are not whole CI.
