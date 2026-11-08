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
