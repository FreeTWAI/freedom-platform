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
