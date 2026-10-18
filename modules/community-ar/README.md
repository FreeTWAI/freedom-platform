# Community image AR

This increment reuses the browser image-target engine from Hao's `AR_HAO`
project for published member cards, organizer-owned public events and an on-device
lightweight editor for text, trusted effects, images and videos. Exported
`.freedom-ar` packets carry the pattern and media together for a future full
software editor; no executable project scripts or remote media URLs are accepted. It does
not import the Unity/Unreal/Vuforia research runners or replace the community,
card, event, Asset, storage or command systems.

## Product and permission contract

1. Select a local image, orient/downsample it to a maximum 1024-pixel edge and
   compile it on this device. Metadata is removed. Pattern-quality hints describe
   image detail, not recognition probability. Cancel removes the compilation
   iframe and its worker/WebGL lifetime. Download the normalized print image.
   Image preparation/compilation has its own abort-controller identity; selecting
   an image does not invalidate pending target/event/scene loads. Replaced or
   cancelled preparation cannot clear a newer operation's progress or result.
   All continuations also retain the mounted page and original session boundary.
2. Try the actual image tracker with the rear camera. The trial is clearly local
   and unpublished. Do not represent a trial as another person's public card.
3. Publish an own card, an own public (`open` / `referral`) event or explicitly
   authored custom content. Custom publishing does not silently publish the
   owner's private member card. Creation, upload and publication use separate durable scoped receipts.
   A lost response keeps the same request, key, bytes and expected version.
4. Open `/ar/<opaque-token>` without login, or select a bounded scan set in
   `#ar`. Current active membership and current parent consent are checked on
   every public metadata/pattern read. Member-card rotation/closure and event
   withdrawal stop new reads. Pattern reads recheck after ObjectStore I/O.
   Live content refresh has a 15-second display lease; failed refresh clears
   the overlay. A public pattern is not identity, attendance or trust evidence.
5. Explicitly capture camera + AR pixels on-device, download, or hand the file
   to the OS share sheet. X/IG/Facebook/Threads logos are selectable and light up.
   Opening a composer or an OS handoff is not confirmed publication. No platform
   posting API, account password, automated browser bot or OAuth is introduced.

## Spatial effects and camera interaction (2026-10-18)

The three existing effect IDs now have original, genuinely three-dimensional
WebGL meshes: orbiting extruded stars (`sparkle`), tilted portal rings and a
floating gem (`halo`), and a rotating cube with volumetric confetti (`confetti`).
They use the tracker's column-major world/projection matrices, not a screen-fixed
animation. Stored packets, bindings, permissions and older readers keep their
existing format; no migration, external model download or new dependency is needed.

The editor loads its camera-free 3D preview only while editing an effect. Members
can rotate and pause it before compiling a target. Reduced-motion preference
starts the preview paused and freezes scanned effects. Preview animation stops
offscreen or in a hidden document; loss of the graphics context offers an explicit
retry. A failed optional preview chunk leaves the draft/editor usable. The scanner falls back to its lightweight 2D effect if WebGL is unavailable
or lost, while recognition, content links and photos remain usable.

The camera offers an immersive, safe-area-aware view, Escape/focus return, front/
rear switching and optional torch. A captured photo includes the current 3D pixels
and automatically stops the camera and inference while the member reviews/shares
it. Continuing scanning is explicit. Backgrounding, leaving, cancelling startup,
changing the login or losing the public display lease clears the overlay and
stops owned media/GPU work. A failed authority refresh invalidates the prepared
scan set until an explicit metadata reload; already-captured local photos cannot
be recalled.

### Resource budgets and measured delivery size

- Request an ideal HD camera image for display/photos, while using a maximum
  **640-pixel longest edge** for inference, preserving the full field of view.
  MindAR 1.2.5's InputLoader draws from the video element's IDL width/height;
  camera `videoWidth`/`videoHeight` remain available for capture. This bounds
  inference pixels, not a guarantee of a particular device's frame rate.
- Cap effect drawing at 30 fps, the GPU backing image at 1280 pixels, and each
  procedural scene at 32 draws / 4096 triangles. Mesh buffers are created once
  per renderer and explicitly deleted on stop; they are not rebuilt per frame.
- Stream actual packet bytes under both the 20 MiB packet and remaining 32 MiB
  scene budgets. The previous implementation allocated a 20 MiB download arena
  even for a small pattern. The new one retains received chunks and makes one
  exact-sized output copy, with a chunk-count bound and cancellable stalled reads.
- The spatial renderer and preview are separate, deferred chunks (7,595 and
  2,924 bytes respectively in this local build; approximately 3.2/1.5 kB gzip).
  They are absent from the initial application JavaScript closure.

The same increment removes My Content's eager import of the showcase editor,
using the existing loading/error boundary when the member opens a draft. Existing
list/editor CSS is retained. The production Vite build was measured with
`scripts/benchmark-portal-build.mjs` against source
`37cdf6ca9da85c60cd528e322d2bcdd3bbafcb33`, using the same installed lockfile:

| Initial HTML/static JavaScript closure | Baseline | Candidate |
| --- | ---: | ---: |
| Actual bytes | 816,416 | 792,158 |
| Per-file gzip bytes | 252,020 | 245,864 |

This is 24,258 fewer JavaScript bytes and 6,156 fewer gzip bytes (2.44%). It does
not measure network latency, real-device FPS, total asset storage, server capacity
or all platform workflows. The self-hosted SDK, existing theme art and license
bytes are retained. No new runtime dependencies, service, posting API or updater
are introduced.

## Data and common-core boundary

`community_ar_targets` is an opt-in personal-scope sidecar registered in the
existing data responsibility catalog. The owner, community, kind, event,
opaque token and linked pattern are immutable. Changes use its one bigint
aggregate version. Scope/principal/owner/purpose/ready-Asset composite foreign
keys reject rebinding. One image fingerprint may be public per community;
fingerprints use actual grayscale tracking pixels, not randomized matcher
clusters. A member explicitly selects an optional public activity for display;
RSVP is never used to infer the scan set. Cancellation hides that activity's
scan set. An event scan filter does not create attendance or membership facts.

`.mind` packets contain grayscale source pixels. They live in the existing
Asset/ObjectStore lifecycle, never in a SQL byte column, command body, journal
or outbox. A closed 20 MiB `member.ar-target` profile validates the MindAR v2
packet, bounded nesting/collections, dimensions, keypoints, descriptors and
cluster indexes before storage or inference. Target inference data is bounded
to 2 MiB. Optional content has a versioned text/effect/image/video union; media
bytes stay in the same immutable Asset, while only a small sanitized binding
projection lives in SQL. Images are fully decoded and normalized through the
existing image runtime; videos use bounded MP4/WebM browser containers. One
scan set is at most 8 targets / 32 MiB; larger sets require a narrower selection. No arbitrary URL/project/effect
script from a share link is executed. Camera frames and captured photos are
not automatically persisted. Retained data is not physically deleted on
withdrawal; GC and retention/appeal policy remain an operator responsibility.

## Release and compatibility

The Node/Worker release setting is `arEnabled` / `FREEDOM_AR_ENABLED`, absent
by default. A trusted `arAssetStore` / MEDIA adapter is also required. Migration
167 adds a default-OFF domain storage policy. There is no legacy byte fallback.
Operators must independently approve persistence revision/quota, compatible
reader floor, backup/restore and retention before enabling publication.
The member publishing flag uses the same minimum 20 MiB retained quota as the
write policy's single-upload reservation; a smaller quota keeps publishing off.
Production flags/resources are not enabled by this PR. Do not downgrade to a
reader that cannot understand the new purpose after AR writes begin.

The MIT MindAR 1.2.5 npm browser distribution is SRI-verified and self-hosted.
See [vendor manifest](vendor/manifest.json) and [license](vendor/MindAR-LICENSE.txt).
Its worker factories and dependency filenames are adapted, unused inline
worker copies are removed, and its browser controller is minified with the
locked Rolldown build tool and legal comments retained so the
existing `script-src 'self'` CSP also covers workers, without `unsafe-eval`,
third-party scripts or blob/data worker permission. The full distribution's
native `canvas` dependency is not installed. Shared MessagePack is pinned in
the root lockfile. A managed web release provides SDK updates; there is no
Windows updater or platform driver.

To reproduce the browser SDK, verify the npm archive against the SRI above,
extract its `dist/controller-mGt1s8dJ.js`, `dist/ui-fBadYuor.js`,
`dist/mindar-image.prod.js` and `LICENSE` into a scratch directory, then run
`node modules/community-ar/vendor/build-sdk.mjs <scratch-directory>` after
`npm ci`. The builder verifies all original hashes, uses the locked Rolldown,
updates content filenames/descriptors and exposes the real processing Promise
for cancellation/error handling. Inference logic is unchanged.

Image content is at most 2 MiB after on-device preparation; the server fully
decodes and normalizes it to canonical WebP. Videos are at most 16 MiB, are
not transcoded, and playback depends on the device's supported codecs.

## Acceptance evidence

Run the focused `community-ar` runtime and browser tests against an explicitly
isolated database. Their fixtures are synthetic MIT images/videos; copied old
AR_HAO result JSON is not candidate evidence. The real tracker must acquire
the positive replay and reject the negative replay. Mock camera/clipboard
checks only establish UI recovery and lifetime behavior. Browser layout checks
cover narrow/mobile/desktop, current theme tokens, keyboard and touch sizes.

The focused runtime suite also covers streamed-packet allocation/overflow/abort,
bounded spatial geometry and HD/portrait inference dimensions. Browser cases
exercise actual WebGL preview pixels and rotation, context loss/retry, immersive
320/390/768/1440 layouts, real positive/negative tracker replays, 3D photo capture,
camera/GPU shutdown and the no-second-WebGL-context fallback. Run them against a
fresh frontend build and an explicitly isolated PostgreSQL database.

On 2026-10-18 the supplied [reference short](https://www.youtube.com/shorts/ECpb7sJg8Vs)
was viewed in a browser: poster-anchored 3D skull/shoe/portal imagery informed the
interaction direction. No reference media or models were imported. These original
procedural presets are not a general Lens Studio editor or a measured claim of
competitor superiority. Physical printed shirts, folds, outdoor reflections and
real iPhone/Android devices still require a separate operator field trial;
source/browser simulation cannot establish those outcomes.
