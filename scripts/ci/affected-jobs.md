# Bounded affected job selection

## Minimum sufficient CI

Every change should select checks for the behavior it can affect. Reuse coverage
already supplied by another required check; do not add unrelated product tests
or repeat successful checks without a changed input or unresolved failure.
A broader fallback means the dependency scope is not yet established, not that
all changes inherently require every test. Extend bounded profiles as ownership
and coverage become clear; retain failures and distinguish skipped from passed.

The `browser_specs_only` profile handles ordinary modifications of existing
`tests/e2e/<kebab-case>.spec.ts` files. The unchanged product and complete module
graph do not need another runtime matrix, Worker restore drill or deployment
preflight. The existing **ui-e2e** job adds
the same TypeScript check normally supplied by static-worker. Six existing
runtime files read browser-spec bodies: `public-social-post-page`,
`newcomer-guides`, `social-share`, `social-feed-write-order`,
`guild-workspace-writer` and `guild-member-tier-fixture`. Their controlled
race/ACK, request forwarding and partial setup/cleanup failure cases remain in the small, fixed
`ci.browser-spec-consumers` suite in the same job; no database or new runner is
needed. It retains the pinned runner's missing/empty/skip/failure rejection.
Source integrity,
CodeQL and required review remain in place. This reduces unrelated jobs; it does
not reuse another source's green result. The reviewed PR-only exception below
narrows the browser plan; all other browser-spec changes keep the complete plan.

Like CI-tool changes, browser specs qualify only on a clean exact PR integration
tree or direct main successor. Additions, deletions, renames, executable/link
changes, fixture/config/helper changes, mixed product changes, graph changes and
unproven Git topology retain the existing broader selection. Ignored extra
browser files also prevent this profile. No browser cases, assertions, retries
or deadlines change. The selector's own workflow exception admits only the exact
conditional TypeScript and consumer-suite steps in ui-e2e, at its existing
contracts-build and pinned-runner boundaries, plus only that fixed suite addition.

### Reviewed store setup spec pilot

Only a PR integration diff consisting of an ordinary modification to the existing
`tests/e2e/store-setup-entry.spec.ts` can select `store-setup-entry`. The exact
base/head/candidate parents, clean checkout (including ignored browser files),
regular nonexecutable blobs and unchanged complete descriptor graph are required.
Main push and merge-group browser plans remain full. Guide and guild selection
are unchanged. No workflow, API permission, runner, credential or required gate
is added; the existing ui-e2e job installs selector dependencies as described
below. Execution still comes from `job.workflow_sha`, not an independent
base-pinned controller.

The selector parses both immutable spec versions with the workflow installation's
existing TypeScript parser. The candidate root's `npm ci` does not install packages
under `.freedom/trusted`. After confirming that checkout against `job.workflow_sha`,
only the browser-spec-only lane runs `npm ci --ignore-scripts --no-audit --no-fund`
with `.freedom/trusted` as its working directory. This uses the runner checkout's
own package manifest and lockfile, as the existing selector job does. It adds an
installation in this job; it does not reuse another job's filesystem or load a
parser from candidate `node_modules`. Missing or unloadable installed parsers
still return full. Exact one-file integration evidence also keeps candidate
package/config/dependency sources unchanged; it is not an integrity claim for
arbitrary candidate-installed parser bytes.

The seven reviewed import declarations include exact
bindings: default-mode `person`, `login`, `open`, `post`, `launchStore` and
`captureOffer`, not the same helper's photo-ON server. New imports/bindings,
dynamic loaders, exports, environment-dependent spec code, missing parser or
unprovable syntax fall back to full. Every other repository path is unchanged,
so dependencies, fixture configuration and product source cannot change in this
lane. This is a bounded static dependency policy, not hostile-code isolation.
Product/helper/fixture/config/workflow or unknown mixed paths, descriptor edits,
additions/deletions/renames and mode changes all restore the full browser plan.

At baseline `f56b6c3a2` this spec has seven cases; the motivating #1160 adds an
eighth. Both sources must keep the reviewed static imports, all baseline literal
case names must remain, and the candidate must contain at least eight cases.
The pinned plan executes the **whole file**, unsharded, in default mode: no grep
and no five unrelated fixture-ON passes. Independent `--list` and execution use
the same fixed files/config/environment. The evaluator has an explicit one-pass
contract for this profile, requires at least eight matching listed/executed cases,
rejects skipped/failed/flaky/retried cases and still rejects incomplete six-pass
full plans. The baseline-plus-discovered catalog integrity check still precedes
narrowing; missing unrelated baseline files cannot be hidden by this selection.

Six existing source-consumer files, TypeScript, portal build, source integrity,
CodeQL, aggregate, required checks and review remain unchanged. This candidate
is separate from the current release and does not alter any running run.
This PR-only path does not claim to cover every order-dependent interaction
between specs sharing a fixture or database. Main pushes retain the full browser
plan to exercise cross-spec behavior; fixture/helper changes also remain full.
Synthetic runner tests are not browser/product acceptance or a hosted timing
comparison. The reported local 9.3-second single-spec result is not a full-CI
baseline; no formal runtime savings are claimed.

The `delivery_tooling` profile applies to exact release/backup workflow and
operator paths, the daily backup orchestrator/diagnostics/test, and the selector
and Verify workflow controls. It runs **deploy-preflight**: operator/preflight
unit tests, isolated migration/native PostgreSQL/R2 restoration, and the daily
backup orchestration tests. The already-required source-integrity job runs
selector/workflow and governance tests. CodeQL and non-author code-owner review
continue independently. Product runtime partitions, browser/UI, static Worker
and consumer repository suites do not run for these operator-only changes.

This profile works for both PR integration trees and a direct main successor.
The selector verifies the actual immutable base/candidate trees, checkout and
ordered parents; main uses GitHub's `before` SHA. It accepts ordinary additions
or modifications within proven operator ownership. Ownership additions for
already-covered operator files use the existing governance tests; removed ownership
or changed dependencies, tests and surfaces remain full. Mixed product, schema,
other CI runner, deletion, rename or mode changes fall back to broader selection. Generated inventory may accompany a scoped change.
It does not reuse a green result for a different source or weaken deployment
source/actor/lease/health checks. Ordinary code deployment and daily backups are
separate operations; deployment need not repeat a full daily backup.

Coverage refinements keep Verify edits confined to the `select` and
`deploy-preflight` blocks; global execution controls and every other job must
remain unchanged. The exact daily-backup test uses `ci.daily-backup` through the
existing pinned completeness runner, which rejects empty, skipped, TODO and
failed cases. Deployment preflight also retains TypeScript checking without
running unrelated UI tests.

The bounded mapping checks the actual governance/shared-release reverse closure,
instruction consumers and declared suite obligations. For the two exact daily
backup sources, the other direct media consumers and remaining media-owned
source are parsed from both immutable trees to reject new references into the
daily subgraph. New reverse consumers, new suites, public exports, local aliases
or unresolved loaders invalidate that mapping; the unrelated transitive media
product closure is not selected merely because it shares a coarse module.
This is a bounded source/dependency policy, not a universal dynamic-code proof.

Unowned product source produces the existing `surface_unmapped` governance
warning. It does not weaken the retained direct literal-import boundary: a
regression proves the same unowned consumer passes ownership validation with a
warning but is rejected by delivery selection. Owned importing consumers remain
selector-level negatives too. Mandatory source-integrity failure still rejects
the aggregate; ownership warnings are not mislabeled as that failure.

The older profiles below retain their own event and path limits. In particular,
the statements about full push selection below exclude delivery tooling, bounded CI tools and browser-spec-only changes.

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
| `affected`: delivery tooling | Deploy preflight (PR and direct main successor) |
| `affected`: browser_specs_only | Complete browser plan, TypeScript and six existing consumer test files in ui-e2e (PR and direct main successor) |

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
- `module_app_markdown`：全部變更僅為 `modules/**/*.md` 或 `apps/**/*.md`，不選 heavy job。排除 AGENTS、隱藏路徑、runtime text、guild presentation 路徑，以及 runtime 測試確實讀取的 `modules/agent-commerce/operations/notifications/README.md`（`commerce-email-templates.test.ts:286`）與 `modules/module-registry/platform-hold.md`（`module-instance-lifecycle.test.ts:845`）；它們保留既有選擇。公會展示 Markdown 保留原 profile。

消費者追查使用 `git grep` 搜尋所有 tracked JS／TS／Python／shell／workflow 的 `.md`、`docs/platform-plan`、`readFile/read_text/open/glob`。`scripts/generate-guild-blocks.mjs` 實際讀 descriptor JSON 的 surfaces 與 entry existence，沒有讀取一般模組 Markdown；`guild-presentation-profile.mjs` 讀 module tree（含 Markdown）並保留原 profile。rollout receipts、closeout、requirement-evidence、work-plan 與 tester-map COORDINATION 未找到 domain code／test 的內容讀取；文件連結、descriptor instructions 和歷史 hash 索引不等於 domain 輸入。此清單以目前 source 為界，新消費者需同步 selector。

實際檔案列表與原派工的兩處差異保留：#1083 的 README／current-state 確為 Python 測試輸入，因此整組只選 governance-consumers；`git diff --name-only b267f472 95aae4da` 的 #1087 列表含 `tests/e2e/absurd-daily.spec.ts`，整組保留 full。Shared-release 工具與 workflows 維持 full，對應的 `delivery_tooling` lane 由 #1094 負責。

新 lanes 使用明確 reason 和全部七個 boolean outputs；aggregate 逐一核對確切 job 集合。只有完整 PR diff、有效 baseline/candidate graph、乾淨且 ordered-parent 的 integration tree 和非 executable regular blobs 才能窄化。code、被讀取的 data、deploy、verify/codeql、governance、selector/tooling 控制檔與 status/mode 不明的變更維持 full。Push／merge_group 維持 full；既有前端 leaf 行為不變。

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


The exact `ci.daily-backup` registry metadata addition may accompany delivery
changes. Removing that one literal declaration must reproduce the complete
baseline registry bytes. Existing suite definitions, test discovery baselines,
loaders, environment forwarding and timeouts therefore remain unchanged; edits
to them keep broader selection. The existing pinned-suite contract test remains
in mandatory `ci.governance-unit`, including empty/skipped/failed daily-suite
regressions. Its test file may accompany the addition; the suite runner itself
has no delivery exemption.


The Verify mask rejects noncanonical job-level structure, including quoted and
underscore job headers after the final deployment job. A bounded direct-import
check additionally reads outside JS/TS sources in both immutable trees, regardless
of ownership/dependency declarations, and rejects relative literal imports/re-exports,
literal dynamic imports, CommonJS requires and type imports into daily-backup or
shared-release. It runs for release-only changes too. Limits are 4,096 files,
2 MB per file and 64 MB per snapshot; unchanged blobs share one read cache.
This is a direct relative literal-import boundary, not comprehensive proof about computed
loaders, arbitrary executable strings or transitive imports. Existing stricter
media-boundary parser checks and mandatory ownership validation remain separate.


## Bounded CI tools coverage

`ci_tools` supports PR integrations and direct-first-parent main pushes. Pushes
require `GITHUB_REF=refs/heads/main` from the workflow event, head equal to the
checked-out candidate, and candidate first parent equal to event.before. Missing
proof, other refs and multi-commit pushes retain full selection. The workflow
accepts push events only on main; local invocations are projections, not
authenticated hosted evidence. Both events use the same clean-checkout, immutable
tree, descriptor and source guards below. CI tools are proved before delivery
tooling so selector-only edits do not inherit deployment checks.

`ci_tools` selects no heavy job: mandatory source integrity already runs selector,
governance and pinned-suite contract tests. `ci_tools_document_inputs` adds the
existing governance-consumers job only when a known plan-document input changes.
The profile covers exact selector/context/module tooling files and their existing
tests, supporting prose, and only the module schema's owned-path limit increase
from 64 to 256. Other schema changes, runtime files and unknown source stay broad.

The sole deletion allowance is the paired retirement of `circleci-worker-status.mjs`
and its test. Both must be ordinary blobs before deletion. Verify must equal its
baseline after removing precisely the obsolete provider checkout/status step,
its statuses permission and the condition on the existing pinned worker suite;
all other executable workflow bytes remain unchanged. Candidate source/workflows
must contain no remaining direct import or workflow reference to that helper.
The source check also rejects outside direct consumers of the changed context,
module and schema libraries. Complete descriptor graphs remain unchanged and the
reviewed governance reverse closure retains its existing unit-test mapping.
No commit/tree pins, general deletion exemption or new test platform are used.

Ownership warnings do not permit an unowned product source to add an unresolved
computed import/require, eval or Function loader and still select delivery-only
checks. This small check uses the existing product-source scope; harmless unowned
sources and literal unrelated imports remain warnings. It is not general
JavaScript or transitive dependency analysis. Source-integrity and aggregate
failure semantics, CodeQL and non-author review remain required.
