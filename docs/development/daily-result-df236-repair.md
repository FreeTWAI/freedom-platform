# Daily result: strict-CSP probe and share focus boundaries

Draft #1310 follow-up, 2026-11-09. This isolated candidate starts at
`df23678701d55975a3b5fdc78132d6df4224a15f` (tree
`1a6988220f5121cca9a0a035ca36a0ad87a7fafe`) with governed baseline
`3586c1a7f0bdbfb0980297e9a996ad95fa8607bd`. It does not validate newer main.
The preceding [e90 investigation](daily-result-e90-repair.md) is historical;
its proposed screenshot-style probe failed the subsequent official run.

## Preserved official red evidence

[UI1 job 128977694085](https://github.com/FreeTWAI/freedom-platform/actions/runs/42561115306/job/128977694085)
ran df236 with hosted candidate `d4f485d732460c2624013392fe74289d327d0f1d`.
Artifact 13652431611 is 117,842,069 bytes, SHA-256
`6655190ebc1c0f19762b6f92d0f9f9820091cf6c847ec4127a527c663e2a29b5`.
Original JSON, traces and PNGs were inspected read-only; retained paths were
checked rather than inferred from attachment declarations.

Eight CASH 320/390 native/light 100%/200% cases reached the new nonzero-pixel
assertion and failed with zero changes. Earlier painted-root and restored
control checks passed. The 320 native 100% and 320 light 200% original result
PNGs were directly viewed: earned scene, score/status and four result actions
are visible. Their SHA-256 values are respectively
`11ffd87a5fb62c684ec4030194fd2ab0cf6f3599b815094fedb536ac77709df9` and
`4e8d6d0dc9c6299131f996eb9b1969adecc475f7d2024c8d90e2f2348af6bd08`.
The light 200% restoration JSON shows connected, visible, opacity-1 result
bounds 320×568 and 32px root text before/after both screenshots. A zero-height
higher ancestor does not establish an invisible absolute-positioned result.

Two retained traces independently record the blocked reference stylesheet:

- CASH native 390 200%, trace SHA-256
  `775a0fa4742c0b4048d652fbced08957af56a27b024538dff310f6aae8d58cea`,
  console time 4346977.726.
- CASH light 320 200%, trace SHA-256
  `70ff1044ea371df899ab6e1c1adcf42b1b183f7beaee97b3bb3543879d49af84`,
  console time 4460648.223.

Both report: `Applying inline style violates the following Content Security
Policy directive 'style-src 'self''` and `The action has been blocked.` Both
identify `sha256-RWvJGMSiNYAE0JTeiysOfjamDIEy7ZTcCzUMex/TVcA=`, exactly the
SHA-256/base64 of `[data-daily-result] { opacity: 0 !important; }`. The trace's
actual document response has `style-src 'self'`. Installed Playwright 1.63.0
implements screenshot `style` by creating an inline `<style>` tag, setting
its text, and appending it; the recorded location is its append line 28.
Cleanup support did not mean the stylesheet was permitted by CSP. This is a
proven probe failure, not evidence of a product renderer/visibility defect.
The e90 post-restoration visibility failure still has no retained relevant
trace; this newer evidence is not retroactive proof of its root cause.

## Property-only reference correction

The reference now writes only the result's CSSOM opacity property and restores
that property's exact previous value and priority in `finally`. Unlike adding
an inline stylesheet or replacing a whole `style` attribute, CSSOM property
writes operate on the existing declaration; the app and text-scaling helper
already use that route under this policy. No CSP, nonce, bypass flag, workflow,
configuration or dependency is changed. No browser execution of this revised
probe has occurred locally, so CSSOM behavior under the actual runner's CSP
still requires the next exact-head official run.

Before the reference, computed root opacity must be 0. All other observed
root properties and every painted child/ancestor must equal the original
baseline. The same suppressed state must remain after reference capture.
Finally restores only opacity, removing an empty style attribute only if it
was originally absent. The exact original inline style, computed properties,
geometry, actual four controls and all original exposure checks still pass
or fail as before. The completed PNG remains entirely unmodified.

The raw comparison still requires **changed pixels > 0** and **unchanged
fraction ≥ 0.5**, tolerance 2, equal dimensions and nonblank reference pixels.
No-op suppression cannot pass, even when computed opacity reports 0. Embedded
finally diagnostics retain pre-completed, baseline, suppressed-before,
suppressed-after and restored observations, including complete ancestors,
32px/200% text, display/visibility/opacity, connection, geometry, focused and
disabled state, plus the original/restored opacity value and priority. A failed
capture restores the original declaration and keeps the original error.

## Real share-dialog boundary correction

The retained fallback trace SHA-256 is
`7af0bb941686ef2c1cd519611119326acc6084f48371ea9a8f3ea59d3d92b4a6`.
Initial Close focus passed (`call@27526`); Back.focus passed (`call@27528`),
Tab completed (`call@27530`), then Close remained inactive for the unchanged
5-second assertion (`call@27532`). Original failure PNG SHA-256
`1b2220658a75e66f7bbe582a302116503d18279c56730f39142c7c6ada49ff7d`
was directly viewed: the native share dialog is open with Back at its end.
The trace does not record document.activeElement, so the actual destination
is unknown. It is not established that focus reached the browser chrome or
any particular page node.

The product handler only stopped Tab propagation; it did not implement the
required inner boundary wrap. The only product change is this dialog's
keyboard handler: use the existing fullscreen focusable-selector convention,
query live controls on every key, exclude negative-tabindex, disabled,
non-rendered, invisible and inert targets, and wrap last→first on Tab and
first→last on Shift+Tab. Dynamic manual-copy inputs participate normally.
Middle navigation remains native. Modified shortcuts are not prevented.
Sharing/export state, generations, outer fullscreen, Escape and replay code
are untouched.

The fallback test retains its full initial/outer/inner focus contracts, both
Tab directions, both Escape steps, returned focus, actual earned-photo flow
and real replay. No timeout is increased. It now attaches checkpointed actual
active-element, document focus, modal state, containment and control-geometry
diagnostics in finally, to identify any remaining failure instead of guessing.

## Local validation

- `node --import tsx --test --test-concurrency=1` on the measurement, share-focus
  and existing result-lifecycle files: 113 passed (27 + 11 + 75), no skips.
- Sensitivity runs against original df236 fail for both probe and handler.
  Independently deleting forward wrap, reverse wrap, the inert filter,
  nonzero-change assertion, opacity-0 assertion or cleanup also fails the
  matching test with actual assertion failures; no syntax-error substitute.
- Full `tsc --noEmit` with a 2,048 MiB heap limit passed. The first test draft
  used an unavailable TypeScript compiler API; it was removed in favor of
  bounded extraction of the real JSX handler, and all checks were rerun.
- `npm run build` passed using existing dependencies and a local npm cache.
- Playwright `--list` collected 451 tests in the five existing Daily/fallback
  and composition files. Collection started no browser or server.
- `git diff --check` passed. Own initial and expanded-scope governed context
  each verified 264 source records, 132 unique sources and all 134 chunks;
  final exact-head completeness is recorded with the frozen handoff receipt.

Controlled ports execute the actual helper and actual JSX handler; they are
not browser, native modal, layout or CSP execution. Exact-head official
browser coverage remains required, including
real completion, exports, replay/history, native/light, 200% text, safe insets,
44px controls and every old assertion. Earlier native-667 timeouts and cases
not reached by the official run are not claimed fixed by this bounded patch.
No browser, server, socket, install, user computer, push, merge or deployment
was used. The original official failures remain red.
