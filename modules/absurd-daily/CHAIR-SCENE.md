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
