# Bounded affected job selection

The selector and aggregate are loaded from the installed workflow source, not
from candidate configuration. This candidate adds an `affected` mode for the
exact frontend files in `FRONTEND_LEAF_PROFILES` in `select-affected-jobs.mjs`:
member-card editor/QR/download/styles and newcomer-guide host/gallery/styles.
It does not install a new workflow pin or claim a hosted timing improvement.

A modified existing leaf must have exactly its expected module owner in both
Git revisions. Both complete descriptor graphs must be valid and unchanged;
module dependencies and suite obligations must match the fixed host profile.
The baseline/candidate impact union, including reverse dependencies, must contain
only the changed leaf modules and their known suites. New files, missing or
ambiguous owners, descriptor drift, extra consumers, unknown paths, contracts,
security paths, runtime Markdown, shared infrastructure, rename/delete/mode
changes, pushes and merge groups use full selection. Public sharing helpers,
guide gates, contract/content/release pins and root application files have no
leaf exemption. An ordinary unowned prose document or the generated inventory
may accompany a leaf; they cannot introduce another module obligation.

| Mode | Required selectable jobs |
| --- | --- |
| `full` | All seven existing jobs |
| `docs` | None; always-on integrity still runs |
| `affected`: frontend leaves | Full eight-part runtime plus aggregate, full browser, static/worker |
| `affected`: guild presentation | Guild presentation and static/worker |
| `affected`: informational handoffs | Governance consumers |

The frontend profile omits `governance-consumers`, `deploy-preflight` and the
separate guild-presentation job. It does
not trim runtime test files or browser cases, add a second runner, or replace
independent security harnesses with candidate test reports. `source-integrity`
still verifies generated contracts, runtime text, governance, immutable migrations
and local links; main pushes generate and restore the complete source inventory.
The omitted jobs are selected again if any changed file falls outside the
fixed profile, including database/migration/operator changes.

The aggregate requires every output and every job result. Only the exact fixed
job shape is accepted for affected mode. Selected skip/failure/cancellation,
unselected failure/cancellation, missing results and malformed outputs fail.
An intentionally unselected job may report skipped or success.

Local tests use real Git commits and the actual CLI as well as graph/aggregate
negative cases. They do not prove installed GitHub enforcement or cost savings.
UF:INT-17 also requires the corresponding TS/Rust conformance evidence; full
fallback alone does not supply a missing conformance adapter. The existing
main source archive/restore and daily `verify:inventory` obligations remain separate.

## Informational handoff documents

The fixed `informational_handoff_docs` profile accepts only ordinary modifications
of these existing files, optionally with the exact generated inventory:

- `docs/platform-plan/execution/commerce/work-plan.md`
- `docs/platform-plan/execution/supplier-console/work-plan.md`
- `docs/platform-plan/execution/guild-launchpad/README.md`
- `docs/platform-plan/execution/unified-foundation/closeout.md`
- `docs/platform-plan/execution/unified-foundation/current-state.json`

The trusted selector proves the exact PR base/head and clean integration checkout
with those two ordered parents. Every changed entry must be a non-executable
regular blob in both trees. Complete descriptor graphs must be valid and unchanged;
the fixed owners, dependencies, reverse consumers and suites must still match.
An allowed document used as a module instruction or runtime text stays full.
General context ownership and its full fallback are unchanged.

`governance-consumers` remains selected: its existing contract tests check guild
status against current-state and source facts. Source-integrity, select, the required
verify aggregate and CodeQL keep their existing obligations. Only the exact reason
and job-output shape pass the aggregate; selected skips or missing results fail.

Inventory alone, new/unknown paths, rename/copy/delete/mode changes, mixed code,
tests, specs, acceptance/traceability, schemas, policy, workflow/runner/descriptor
changes and every `rollout-*.json` retain full CI. No schema authenticates those
dated receipts for this exception; the original six-file #876 therefore stays full.
Push and merge-group events remain full. #885 changes the selector itself and
also receives full CI; local tests establish no hosted time or cost saving.

The `deploy-preflight` job enables setup-node's npm download cache before
`npm ci --ignore-scripts`; it still performs a clean install and runs the same
pinned preflight and migration suites. A hosted second-run cache hit and timing
improvement remain unverified locally.

## Root README documentation policy proposal

An ordinary `M` content change to the exact root `README.md` may use the existing
`docs` mode, alone or with otherwise qualifying prose and the exact generated
inventory. Both revisions must have valid bounded module graphs (unique IDs, existing
dependencies, no cycles), and neither may explicitly own `README.md`; ownership in either revision retains full CI. Other
documents retain the baseline/candidate impact union. README plus a frontend
leaf stays full: this exception does not expand the affected profile.

This intentionally changes the previous conservative root-instruction policy.
It admits all root README prose modifications, not only navigation paragraphs;
it does not infer whether prose is harmless or replace content review. Root
README remains a mandatory instruction and retains its full context impact in
`ROOT_INSTRUCTIONS` and `selectImpact`. AGENTS/CONTRIBUTING, runtime Markdown,
code, tests, workflows, policy, contracts, descriptors, SQL, unknown paths and
non-content changes still retain full selection. Pushes and merge groups do too.

The selector continues to read exact GitHub event base/head Git trees through
the installed trusted source. No candidate script or file list can opt into this
policy. Source-integrity, the required aggregate and their failure semantics
are unchanged. This source proposal does not update the installed workflow pin,
change GitHub settings or bypass any current PR's checks. Hosted savings require
a separately reviewed and authorized installed-source upgrade.

## Approved guild module boundaries

The guild profile is now a source candidate for ordinary changes within the two
approved guild module directories, rather than exact import prefixes in two files.
Existing preview tests, Markdown, local TS/TSX helpers and plain CSS may accompany
component edits. New helpers/styles/docs are allowed under existing ownership;
new preview test files remain full until the fixed runner enumerates them.

Selection still requires the complete, unchanged baseline/candidate descriptor
graph, approved owners/surfaces/operations and exact reverse-consumer obligations.

PR #896 新增的 `platform-admin-portal` 已納入
`GUIDE_COMPOSITION_PROFILE.dependencies` 的精確集合。Admin 依賴 development、
guild-workspace、positioning、shared，沒有依賴 guild-supply 或 guild-open-source；
只改這兩個公會的展示時，反向影響仍只有被改的葉節點與 application-composition，
因此保留 `guild-presentation`、`static-worker` 兩個 jobs。Admin 自身的 ownership、
`runtime.full`／`ui.default` 義務不變；修改 admin 路徑或與公會混改仍選全部七個
selectable jobs（runtime-full、runtime-aggregate、ui-e2e、static-worker、
governance-consumers、deploy-preflight、guild-presentation）。若 admin 成為公會葉節點的
反向消費者，或 composition 相依集合再變動，仍退回 full。維持舊清單會讓目前圖上的
公會展示修改一律因 `guild_impact_unproven` 選全部七個 jobs；本次明確採用更新清單，
並以實際圖及 Git integration 測試保護此界線。這不更新已安裝的 workflow pin。

The selector reads every regular source blob in each affected module in both
immutable Git trees. TypeScript AST imports and exports must resolve locally or
retain the same baseline external dependency set; product/test dependency sets
stay separate. Comments, strings and harmless import formatting no longer count
as imports. Missing/ambiguous local resolution, unknown modules, new external
or cross-domain dependencies, dynamic/type imports, CommonJS, import.meta,
CSS imports/URL assets, unknown configuration, AGENTS, rename/delete/mode changes
and missing/invalid parsers retain full CI. Limits are 256 files per module/revision,
262144 bytes per file and 2000000 bytes across the two module snapshots.

The selector job installs its own workflow checkout's existing lockfile with
`npm ci --ignore-scripts --no-audit --no-fund`; it never obtains parsers from the
candidate checkout. The existing TypeScript 6 compatibility parser and PostCSS
parse source as data without running candidate code/configuration. The verify
aggregate remains dependency-free. This is dependency selection, not a security
sandbox or a claim that all program behavior is statically known. Review,
source-integrity, CodeQL, fixed guild integration/preview checks and strict
main protections remain unchanged. This control-plane PR itself requires full CI;
local regression results do not establish hosted savings or independent guild
maintainer assignments.
