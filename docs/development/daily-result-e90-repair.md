# Daily result measurement and fallback focus follow-up

Draft #1310, 2026-11-09. This bounded follow-up starts at
`c7ff73898982cc93a15fa05e666da53b04993582`, against main
`3586c1a7f0bdbfb0980297e9a996ad95fa8607bd`. It changes tests only.
No product CSS, result handlers, renderer, capture tooling, CI configuration,
package, preview pin or deployment is changed.

## Preserved red evidence

[UI shard 1 job 128942220596](https://github.com/FreeTWAI/freedom-platform/actions/runs/42549614980/job/128942220596)
failed for published head `e90b0b339baa7c53293084f7ffd99119fa0fec2d`, candidate
`a36205a3d33840025186e440646520a78cd9e51b`. The original diagnostic archive has
SHA-256 `51a61654ce682e737a1503b8d496e934c4ff21776d7d2b5f14adcd53a552d5c0`.
Its copy manifest reports 191 copied files, 392 omitted, 134,205,618 bytes.
The relevant Daily and fallback failure traces/error-context files are not
retained, despite their paths being declared in the raw report. Do not treat
those references as available post-failure DOM evidence.

The case report records 27 failures at the helper's post-reference visibility
assertion: 10 CASH composition cases, 12 STAMP native-fullscreen result cases,
and 5 CASH native-fullscreen result cases. The initial result visibility and
exact restored inline-style equality had passed. Four other CASH cases timed
out before this point; the cached-shadow work already in c7ff is a separate
change and was not present in the e90 run. PHOTO composition's 15 cases passed;
the separate native result PHOTO matrix was not reached.

Original, unmodified 320 × 568 PNGs were directly viewed:

- STAMP native fullscreen, 100%: earned stamped sheet, `12 份完成`, saved status
  and all four compact result actions are visible. PNG SHA-256:
  `0244bf2435576e1f9acd015e80f96342692d86a05b12a9d5d21aec87e64b4a61`.
- CASH native renderer / rejected fullscreen, 100%: earned desk and cash,
  `100 萬道具鈔`, saved status and all four compact result actions are visible.
  PNG SHA-256: `11ffd87a5fb62c684ec4030194fd2ab0cf6f3599b815094fedb536ac77709df9`.

These images establish visible results **before** the reference probe. They do
not prove restoration caused the later failure or that the later UI remained
painted. The result root's source CSS is absolute `inset:0`, not
`display:contents`. No product rule hides this result or mutates its inline
style after restoration. Its ResizeObserver positions the closed share dialog.
A zero-size root, inherited visibility, observer effect or browser visibility
behavior after the probe cannot be selected as the proven cause from the
retained evidence. The original root cause remains unknown.

## Bounded measurement correction

The original probe temporarily wrote `visibility:hidden!important` to the
result's inline style. The new probe uses the installed Playwright screenshot
`style` option to apply `opacity:0!important` to the same result **only while
capturing the reference**. This suppresses its paint without hiding it from
focus/visibility queries and does not alter inline styles. The real completed
stage PNG is still captured and attached with no style override.

Installed Playwright 1.63.0's `screenshotElement` passes `options.style` into
`inPagePrepareForScreenshots`; that function appends a temporary stylesheet and
registers its removal. `screenshotElement` calls `_restorePageAfterScreenshot`
in `finally`, including capture failure. A controlled-port test executes that
installed preparation/cleanup function and checks the element-screenshot
finally contract. This is API/cleanup evidence, not browser paint evidence.

The helper retains its root visibility and transparent background checks,
real frozen scene, raw image dimensions, varied reference pixels, channel
comparison tolerance of 2 and at least 50% unchanged scene pixels. It now also
requires **nonzero changed pixels** so a broken/no-op paint suppression cannot
pass. Original inline styles and computed paint/layout for the result and
actual controls must be unchanged after the reference; opacity must be 1,
visibility visible, owners connected, and painted bounds nonzero. The same
four actual actions are rechecked for visible text, accessible names, 44px
minimum targets, text containment, stage/viewport bounds and hit testing.
Opacity-blind `toBeVisible` alone is not used as proof of painting.

Small JSON diagnostics are attached in `finally`, including the checkpoint,
pre-completed-screenshot state, post-completed-screenshot baseline and final
restored state. They include root, painted children and the complete ancestor
chain: connection, inline styles, font sizes (including the test's enlarged
text), display, visibility, opacity, checkVisibility and bounding rectangles.
This retains information in the embedded report even if a future bounded
archive again omits the failure trace. No timeout or scene-exposure threshold
has been relaxed. This is a safer measurement probe, **not an established fix
for product invisibility**.

## Fallback keyboard contract

The timed-out fallback test sought `回遊樂場` in the outer fullscreen tab loop.
That control now belongs to the closed secondary share dialog. The real last
outer action is `更多分享方式`. The test now verifies:

1. The closed inner dialog's Back button is absent from accessible outer
   controls; Tab from More wraps to fullscreen exit and Shift+Tab returns.
2. Enter on More opens the native modal and focuses Close. Inner Back → Tab
   wraps to Close; Shift+Tab wraps back to Back.
3. Escape closes the inner dialog, focuses More and preserves fullscreen.
   A second Escape exits fullscreen without losing the earned result.
4. Reentering fullscreen and real same-seed replay focuses the live game board
   inside its owner, as before. The original 120-second timeout is unchanged.

## Local evidence and remaining work

- 16 new controlled-port/source-contract tests plus 47 existing result
  lifecycle tests: 63 passed, no skips. Controlled ports do not simulate a
  browser's layout, painting, native modal focus or real React reconciliation.
- Sensitivity cases reject no-op suppression, over-half coverage, lingering
  opacity/visibility, hidden ancestors, detached/zero-size owners, lost inline
  styles, clipped/blocked controls, changed image dimensions, blank references
  and capture errors. Exact 50% exposure still passes. Removing only the new
  nonzero-change assertion makes the no-op sensitivity test fail, as expected.
- Full typecheck: an initial unbounded invocation was killed; the same compiler
  with a 2,048 MiB heap limit passed. Focused strict typechecking also passed.
- `npm run build` passed with a workspace-local npm cache after the initial
  attempt could not create the default `/home/agent/.npm` cache. Only existing
  dependencies and local package packing were used; nothing was installed.
- Playwright `--list`: 450 tests collected across the existing Daily/fallback
  and three composition files. Collection does not start a browser or server
  and is not execution evidence.
- `git diff --check` passed. Own initial and final governed context retain the
  exact main base, full affected-module fallback and local/unverified status.

No browser, server, socket, user computer, GitHub write, merge or deployment was
used. The exact integrated head still needs official browser execution of the
same real-input matrix, exports/replay/history, native/light presentation,
200% text, safe insets and target/focus contracts. The e90 failures remain red;
neither these offline tests nor this proposed probe turn that run green.
