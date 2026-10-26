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
| `affected`: plan_receipt_docs / module_app_markdown | 無 heavy jobs |
| `affected`: plan_document_inputs | Governance consumers |
| `affected`: shared_release_tooling | Deploy preflight |

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
main source archive/restore remains separate. 日期 inventory 僅為歷史快照；PR CI 與 main pushes 使用 Git objects。

## 最小 CI 路徑與消費者證據（2026-10-26）

Owner 原則：「當有其他的機制已經覆蓋到了, 就應該相信其他的機制」。新增 lane 只選既有 jobs，不新增 gate；source-integrity 仍處理契約生成、runtime text、治理、migration 與本機連結。

- `plan_receipt_docs`：全部變更為 `docs/platform-plan/**` 的 `.md/.json/.yaml/.yml/.csv/.txt`，即使 descriptor 擁有也不加 heavy job。排除 contracts 非 Markdown、contracts/tests、execution/tools、AGENTS；已知 Python 文件輸入改走下列 lane。
- `plan_document_inputs`：上述文件包含 `execution/{first-work-batch.md,acceptance-matrix.md,milestones.md,spec-index.md}`、`execution/specs/**`、`execution/guild-launchpad/**` 或 `execution/unified-foundation/current-state.json` 時，只選 `governance-consumers`。證據：contracts 的 `test_{five_clock_invariants,work_reviewer_capacity,reviewer_appointment_entitlement,low_ops_contracts}.py`；execution/tools 的 `check_specs.py`、`check_package_dag.py` 與 `tests/test_guild_launchpad_status.py:21–24`。`ci.contracts-pytest` 在該 job 執行，guild-launchpad validator 也讀該 pack 的 Markdown／traceability／acceptance-progress。
- `shared_release_tooling`：全部變更僅為 `deploy/shared-release/**`、`deploy/cloudflare/test/shared-release.test.mjs` 與 `.github/workflows/{shared-release,shared-backup,release-operator-image}.yml`，只選 `deploy-preflight`。該 job 的 `ci.deploy-preflight` 依目錄探索 `shared-release.test.mjs`，並執行 shared-release PostgreSQL integration。此 lane 不選 runtime-full／ui-e2e。
- `module_app_markdown`：全部變更僅為 `modules/**/*.md` 或 `apps/**/*.md`，不選 heavy job。排除 AGENTS、隱藏路徑、runtime text、guild presentation 路徑，以及 runtime 測試確實讀取的 `modules/agent-commerce/operations/notifications/README.md`（`commerce-email-templates.test.ts:286`）與 `modules/module-registry/platform-hold.md`（`module-instance-lifecycle.test.ts:845`）；它們保留既有選擇。公會展示 Markdown 保留原 profile。

消費者追查使用 `git grep` 搜尋所有 tracked JS／TS／Python／shell／workflow 的 `.md`、`docs/platform-plan`、`readFile/read_text/open/glob`。`scripts/generate-guild-blocks.mjs` 實際讀 descriptor JSON 的 surfaces 與 entry existence，沒有讀取一般模組 Markdown；`guild-presentation-profile.mjs` 讀 module tree（含 Markdown）並保留原 profile。rollout receipts、closeout、requirement-evidence、work-plan 與 tester-map COORDINATION 未找到 domain code／test 的內容讀取；文件連結、descriptor instructions 和歷史 hash 索引不等於 domain 輸入。此清單以目前 source 為界，新消費者需同步 selector。

實際檔案列表與原派工的兩處差異保留：#1083 的 README／current-state 確為 Python 測試輸入，因此整組只選 governance-consumers；`git diff --name-only b267f472 95aae4da` 的 #1087 列表含 `tests/e2e/absurd-daily.spec.ts`，混合列表保留 full，去掉該 E2E 的 shared-release 集合才只選 deploy-preflight。

新 lanes 使用明確 reason 和全部七個 boolean outputs；aggregate 逐一核對確切 job 集合。只有完整 PR diff、有效 baseline/candidate graph、乾淨且 ordered-parent 的 integration tree 和非 executable regular blobs 才能窄化。code、被讀取的 data、其他 deploy、verify/codeql、governance、selector/tooling 控制檔與 status/mode 不明的變更維持 full。Push／merge_group 維持 full；既有前端 leaf 行為不變。

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
