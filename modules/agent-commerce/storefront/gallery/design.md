# C1 product gallery invariants

Approved local design, 2026-10-20. This source does not authorize activation or deployment.

- Lazy groups: a product without a group is an implicit singleton. No backfill, live-selection FK or legacy-write synchronization trigger.
- The migration141 pointer is the sole primary image authority. Secondary slots are2–8; the effective/frozen order is dense. Primary alt binds the exact primary tuple digest.
- All gallery writes require store:write and product selection CAS. Private reads require store:read. Existing photo limits, known purpose, quota, verified reads and retained unknown-operation recovery apply.
- Legacy single-photo removal retains the tail; show the minimal recovery notice and explicit promote/remove actions. GET and publish never repair it.
- Freeze a separate gallery document and refs with each new gallery-enabled publication; first ref agrees with legacy primary refs. Projection/v1 and existing media JSON stay unchanged.
- OFF reads no gallery table and preserves the original editor, HTML, media, SPA fallback, shops.css and storefront entry. Site JSON alone adds store_gallery_enabled:false, following appearance/policies.
- Five additive tenant tables, exact baseline guards on both wrapped intent CHECKs, tenant RLS without FORCE, restricted canonical runtime grants, immutable frozen rows, no deletion or quota release.
- Variants/categories and supplied-product galleries are later work. Alt remains optional; no storage limit/policy changes.

## Work plan

Register paths; migration and schema evidence; closed lifecycle/contracts; private draft commands; publication/public renderer; owner UI; bounded runtime/browser/restore verification; dated docs and inventory.

Only three new runtime files (gallery SQL, commands, media), each targeted below30 seconds locally. Append at most12 gallery browser cases after the32 unchanged photo cases; leave the main photo fixture gallery-off. A small default-mode OFF spec has at most3 cases.

Verify the exact base reader/renderer against a new publication with gallery SELECT revoked. The integrator authorized the stock labelled/no-network media-restore runner once near delivery; no other database widening applies. No real flags, deploy, provider, email or remote operations.
