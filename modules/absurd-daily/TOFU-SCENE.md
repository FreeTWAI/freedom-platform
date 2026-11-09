# Tofu stage integration candidate

## Scope and unchanged authority

This local candidate follows Holiday and Chair at `9445e0302efad15b08d8ec345826c537727fc856` (tree `2f0022c17dcac58eb656ea67f97ace050e540132`), against main `242dbd400a28c283fc684f5b6cbf11070769baae`. It moves Tofu into the same party-specific bounded stage. It does not claim accepted art or fun for all 72 games, publication, CI approval or deployment.

The native Three renderer, domain, catalog, tofu batching and art inputs remain unchanged. The actual game offers a timing/drop action, not left/right movement or a stop button. Preserve 12 successful layers, three misses or 60 seconds; alternating X/Z travel; perfect tolerance .12; minimum overlap .32; 460ms landing; real clipped/falling geometry and earned perfect score 2925. Scoring remains domain-owned; no fixture edits to those constants.

## UI and lifecycle

The stage includes HUD (score, time, layers and remaining misses), real drop control, pause, restart, help/settings, sound/motion and renderer recovery. The raycast/gesture host remains empty except for its native canvas. The 4:3 light SVG is a sibling overlay with pointer-events disabled; controls are siblings, so a button release cannot also trigger a scene drop. Light mode is explicitly labeled and projects current layer sizes, positions, active travel, clipping and landing from the same run.

The existing party dialog owns a measured in-stage rectangle, top-layer modality, focus containment and Escape. Opening help or restart pauses and cancels held inputs; closing retains the paused run until explicit resume. Fresh turn-owned input is required after a landing. Context recovery preserves the run and does not automatically resume. A finished run retains capture retry; results and the existing share/replay/navigation controls stay within the same bounded stage. Light results are labeled as a run record rather than a 3D screenshot.

Use existing arcade tokens, a minimum 44px action target and env-backed safe-area insets. Compact HUD keeps misses visible. Landscape places the drop control beside the 4:3 scene; narrow screens place it within the stage below the world. Enlarged text may use bounded tools/modal/result scrolling; it must not shrink the world to a token-size canvas merely to keep controls clickable.

## Verification boundaries

Automated source/controller/CPU validation and authored browser journeys are different evidence. Local browser launch is unavailable and not attempted. New browser diagnostics must attach actual stage PNG bytes before geometry assertions when a permitted formal runner executes them; the existence of screenshot code is not evidence that PNGs have been produced or reviewed.

Full native/light completion, clipping and misses, held-input ownership, capture/share failures, restart, pause/help, context loss/retry, normal/rejected fullscreen, actual Tab focus, 200% text and nonzero synthetic insets belong to the requested regression coverage. Synthetic insets do not verify a real notch. Final checks and their exact source binding are reported with the candidate rather than borrowing historical Holiday/Chair counts.

Human art/fun acceptance, real DOM/GPU rendering and screenshot inspection, physical touch/phones, Safari, OS sharing and full formal CI remain unverified. No new reference assets are used. The reference index was viewed earlier, but its steak WebGL did not start, so its cooking interactions were not played.

## 2026-11-09 bounded Tofu controls candidate

This slice starts from the frozen Holiday composition at `eb38014c38a381ad7127d39dacd2b1ba9f9996da`. Only `PartyGame.tsx`, `party.css`, the Tofu sections of the existing runtime/browser tests, and this document change. Holiday and Chair behavior, renderer/domain/batching, source-bound previews, capture tooling, workflows, packages, Daily results and Cooking remain outside the slice.

Seven original Tofu PNGs from historical `d141d90243f0f23162383567d071bfb791d500d2`, run 42533847998, were hash-verified and directly viewed. The corresponding original JSON measures the 667×375 / 200% world at 128×96 CSS px in both native and light modes; the tool strip visibly clips. The 320×568 world is 164.265625×123.203125, while 390×844 already fits 360×270. These observations diagnose the old composition, not the new candidate. The original renderer/light-scene bytes remain unchanged; intervening Holiday-only UI changes do not turn those screenshots into current-source evidence.

The Tofu title, HUD and tools now share the existing warm world background without full-width opaque bands. All tools remain direct buttons with their complete accessible names, titles, refs, pressed state and original handlers; compact symbols wrap within the stage instead of a horizontal strip. Score and time units remain visible, and the actual layer count and remaining misses remain unchanged. Portrait puts the compact drop control beside feedback, leaving the whole world width available. Wide/short screens put that control beside the world and the HUD alongside the title. Flow measures actual text/control heights, including enlarged text; nothing overlays the native pixels. The light scene's decorative rectangle is transparent against the same surface, without altering its real tower projection.

The renderer is still fixed 640×480 with an exact, uniformly fitted 4:3 native/light input rectangle. There is no crop, cover, stretch, CSS zoom, camera change, fake scene or new resize contract. The whole rectangle remains reserved for real early/late towers, X/Z movement, clipping and falls. The same input stamps/cancellation, pause/recovery, measured native dialog, inert state, focus return, capture retry, single settlement and history ownership remain in place. Party still unmounts when the parent shows the separate Result screen; this is not continuous live-world results or full responsive edge-to-edge 3D.

Validation on this source: direct TypeScript check, the standard offline build, and all 225 cases in `tests/runtime/absurd-daily.test.ts` pass. Existing controller journeys additionally check unique tool names/titles, disabled and pressed states, and that a motion toggle does not change the run. The five exact 4:3 source guards are preserved. Browser collection still discovers 359 cases in the same existing file; collection is not execution. No local browser/server, installation, publication, merge or deployment is used.

The existing 48-case native/light × native/rejected × viewport/text matrix now checks every tool before any scroll, >=44px targets, text/content containment, hit testing, safe-area bounds, transparent chrome, no HUD/control overlap, complete host/canvas alignment and an empty light host. Existing world floors/ratios and modal/input journeys remain. The exact short-landscape 200% fullscreen state must reach >=144px world height, 50% above the original 96px and 125% more area. This is a pending requirement, not a measured improvement. Normal-mode return is checked in each existing matrix case.

The four existing full twelve-layer journeys retain earned 2925-point completion, native/light capture and export failures/retries, and same-seed replay. Their late ten/eleven-layer towers add 200% text, real X/Z travel extremes, active final falls and original PNG/JSON attachments before bounds assertions. The existing clipping/three-miss journeys gain whole-world clearance checks during real falls, preserving the same total clock advance. No new long-running matrix, timeout, skip, selection or workflow change is introduced; added browser execution cost remains unmeasured.

New-source browser execution/pixels, physical touch/Safari, actual OS sharing, human art/fun acceptance, full database-backed suites and formal CI remain `not_run` for this local candidate. Historical screenshots and CPU/source tests do not validate its new layout. Fresh native preview capture remains unavailable through the currently restricted supported workflow; no source pin or capture route was changed. This bounded slice does not complete Tofu, Party results, or the all-game redesign.
