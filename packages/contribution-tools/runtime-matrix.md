# Diagnostic runtime matrix

## 慢速 DROP 的有界等待（2026-10-20）

目前清理使用一個 **60 秒** absolute deadline，suite 預留 **64 秒**；本節取代下方
歷史紀錄中的 20 秒／24 秒值。每個 DROP 依 `(remaining - 4000) / 剩餘資料庫數`
公平分配時間，單庫最多約 56 秒，仍留四秒作 fresh reconciliation。Metadata statement
仍限兩秒；CREATE 的獨立 20 秒 provisioning budget 不變。兩種診斷的 `elapsed_ms`
上限同步為 60,000，八秒的一次性 observer 及其 200 ms／500 ms 限制不變。

截至本次調查，近約 300 次 Verify 的 16 個失敗 runtime-full jobs 中，有八個清理失敗，
跨 main／PR 與 partitions 0、1、3、5、6，均在 16.053–16.056 秒出現 DROP
`unknown_ack/query_read_timeout`。另外 96 個成功 jobs 的總清理時間為
min 2.317 秒、p50 4.629 秒、p90 10.748 秒、p95 12.732 秒、max 14.323 秒，
其中十個至少十秒。成功尾端已接近舊 DROP 上限；失敗 DROP 的自然完成時間未知。
60 秒是給未知尾端留約 3.5 倍舊 DROP 等待的有界選擇，不是測得的安全上界。

[PR #898 的失敗 partition 3](https://github.com/FreeTWAI/freedom-platform/actions/runs/39139517705/job/117711191116)
通過 758 個測試後，DROP 的 checkpoint 只花 0.052 秒；8.221 秒的 observer 為
`unavailable`，16.054 秒失去回覆，verifier 終止 cleaner 後在 16.667 秒讀到
`database_present`。服務 log 的 administrator termination 與仍在執行的 DROP 相符。
同次較早 checkpoint 的 sync files 為 306,035／159,323；這是大量檔案工作量的證據，
並非 DROP 當下目錄檔案數的精確盤點。

[PostgreSQL REL_18_STABLE 的 dropdb](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/commands/dbcommands.c)
先以持久的 in-place update 標記資料庫 invalid，再 transactionally 刪除 catalog row，
接著依序等待 immediate checkpoint、SMGRRELEASE ProcSignalBarrier，最後
`remove_dbtablespaces` 呼叫
[rmtree](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/common/rmtree.c)
逐檔 unlink／刪目錄並要求同步 commit。取消或終止在 interrupt processing 時生效；
rmtree 沒有逐檔 `CHECK_FOR_INTERRUPTS`，不能假設 termination ACK 會立即停止刪檔。
若在 invalid 標記後、commit 前失敗，catalog row 的刪除會回滾，invalid 狀態保留，
檔案可能已部分或全部移除。因此 backend 消失或 DROP ACK 都不能證明資料庫已刪除。
大量檔案在 runner filesystem 的移除延遲是合理推論；log 沒有分開量到 barrier／rmtree，
不能將 unavailable observer 當作進度或根因證明。

八／六分區仍限 1,500 秒：最多 20 秒 provisioning + 約 1,416 秒測試 + 64 秒 reserve。
reserve 比原本多 40 秒；以 [commerce 計畫](../../docs/platform-plan/execution/commerce/work-plan.md)
的 1,150.196 秒最長觀察保守估算，扣完 provisioning 仍有約 266 秒測試餘裕；
該 run 的測試／清理失敗紀錄保留。40 分鐘 Actions job 為 2,400 秒，partition 外仍留 900 秒供
setup／build／integration／artifact；不保證任意 runner 延遲都能完成。四分區維持
1,200 秒、本機 full 維持 900 秒，因此扣相同 provisioning 後分別約 1,116／816 秒；
這些入口也少 40 秒測試時間，並未增加外層 deadline 或擴張 aggregate window。

正向 fresh absence、owner／session／nonce identity、owner／cleaner settlement、
所有資料庫仍存在即失敗的規則保留，不重試 DROP，不改 service container 或 durability。
假 transport／clock regression 涵蓋 30 秒 DROP、遺失 ACK、仍存在及超時；它不是原生
PostgreSQL I/O 重現。改動後的真實資料庫證據只能來自 hosted CI；
一次綠燈不代表 flake 已消失，需觀察多次自然執行的清理尾端與失敗率。

Eight separate CI hosts can each run one deterministic partition against their own PostgreSQL server (the tools still accept six and four). This does not change the local `runLocalSuite(..., 'runtime.full')` default four-process behavior. Each matrix invocation creates and cleans exactly one fresh nonce database through the existing owned-database helper, runs one test process with `--test-concurrency=1`, and preserves its original process report. Arbitrary files, commands, partition counts or indexes are refused.

```sh
node scripts/runtime-full.mjs --partition-count 8 --partition-index 0 --output .freedom/reports/runtime-partition-0.json
node scripts/runtime-aggregate.mjs --partition-count 8 --input-dir .freedom/reports/runtime-partitions --output .freedom/reports/runtime-full-matrix.json
```

Use indexes 0 through 7 on separate hosts. Upload each `runtime-partition-N.json` even on failure, then download the eight files into one flat input directory. A fragment has schema `freedom.runtime-partition/v1` and check ID `runtime.partition.N`; it cannot represent a full-suite pass. Both its outer and nested cleanup flags must be true for acceptance. Failed artifacts remain intact and are never overwritten by aggregation.

## 權重更新，2026-10-24

本次沿用 `8034f082d` 的推導：每檔取兩次 hosted run 的最小 serial progress
差值（含載入），權重向上取整秒、至少 1。輸入為 main `53d528fc` 的
[run 40135849585](https://github.com/FreeTWAI/freedom-platform/actions/runs/40135849585)
與 PR #1017 merge `53253dcc` 的
[run 40135935354](https://github.com/FreeTWAI/freedom-platform/actions/runs/40135935354)，
皆為 attempt 1、八分區全部通過。16 份 logs 均以嚴格 `--log` 解析，無 partial
或飽和值；fixture 使用工具既有 `source`、`measurement`、`milliseconds` 格式，
不再附前次才需要的 partial 標記。舊 fixture 原樣保留，不混入本輪 minima。

兩次 run 各自的分區聯集都精確涵蓋 baseline `b13a9fa9` 的 491 個 runtime files，
無重複、缺漏或刪除，每筆 completed record 的 `source_sha256` 都與目前檔案相符。
`53d528fc` 到 baseline 的差異只有 FriendsPanel、其 e2e 與 inventory，無 runtime
檔案變更；PR merge 的 parent 關係依任務提供，該 merge object 本機不可用，未另驗。
量測合計 9,157.207 秒，整秒權重合計 9,426。這是排程估算；兩次舊權重的成功 run
不代表新 candidate 已跑過 hosted CI，也不更新原需求驗收或部署狀態。

用實際 `partitionRuntimeFiles(files, 8)`，按本次 fixture 的 ms 加總：

| 分區 | 舊權重秒數 | 新權重秒數 |
| --- | ---: | ---: |
| 0 | 879.625 | 1,144.176 |
| 1 | 1,127.559 | 1,142.662 |
| 2 | 1,362.694 | 1,144.018 |
| 3 | 1,350.967 | 1,143.654 |
| 4 | 970.068 | 1,142.868 |
| 5 | 1,368.154 | 1,144.836 |
| 6 | 1,099.495 | 1,148.066 |
| 7 | 998.645 | 1,146.927 |

最小／最大由 879.625／1,368.154 → 1,142.662／1,148.066 秒，spread 5.404 秒，
最大值低於本輪 1,250 秒目標。以各 run 自己的全部量測重算新分配，main 為
1,161.931–1,256.785 秒、PR 為 1,231.367–1,366.546 秒；minima 的低估與主機差異
仍存在。此處不含 integration suite、provisioning、檔案間隙或 cleanup；GitHub step
分鐘數不能直接當作這些 per-file durations。新 candidate 仍需完整 hosted matrix。

歷史測試依前次方法對齊其窗口；本次唯一改動的歷史數值如下：

| 檢查 | 舊界線（秒） | 新界線（秒） | 理由 |
| --- | ---: | ---: | --- |
| October 21 八分區最大值 | <1,210 | <1,416 | 原 cushion 依 October 21 權重校準；改錨既有 1,500 − 64 cleanup − 20 provisioning 窗口 |
| October 21 新增 15 秒未知檔案 | <1,220 | <1,416 | 同一個窗口，不另加額外餘裕 |

October 21 的 `<10 秒` spread 檢查移至 October 24 fixture，數值不變；新 fixture
同時保留 `<1,210 秒` 最大值與加檔 `<1,220 秒`，比本輪目標更嚴。
October 21 歷史成本在新分配的最大值為 1,268.921 秒，加檔最多 1,276.254 秒；
不再用它判定新量測的平衡。所有其他歷史界線、完整聯集、唯一性、排序、加檔檢查均保留。
分區數、test／job timeout、cleanup reserve 與 case／source／失敗驗證規則完全不變。

原始 logs 位於 `/tmp/fp-diag/runtime-reweigh-20261025/`，檔名包含 run／attempt／job ID；
逐 job 的分區、檔數、SHA-256 與稽核命令保存在本次 job report。從 repo root 重現：

```sh
node scripts/ci/derive-runtime-weights.mjs --root . \
  --note "Progress segments of runs 40135849585 (2026-10-24, main 53d528fc, attempt 1) and 40135935354 (2026-10-24, PR #1017 merge 53253dcc, attempt 1); all eight partitions of both runs passed; all 491 current runtime files have matching source hashes." \
  --output packages/contribution-tools/runtime-file-weights.mjs \
  --costs-output packages/contribution-tools/test/fixtures/runtime-hosted-costs-20261024.json \
  --log /tmp/fp-diag/runtime-reweigh-20261025/main-53d528fc-run40135849585-a1-120998363219.log \
  --log /tmp/fp-diag/runtime-reweigh-20261025/main-53d528fc-run40135849585-a1-120998363230.log \
  --log /tmp/fp-diag/runtime-reweigh-20261025/main-53d528fc-run40135849585-a1-120998363247.log \
  --log /tmp/fp-diag/runtime-reweigh-20261025/main-53d528fc-run40135849585-a1-120998363253.log \
  --log /tmp/fp-diag/runtime-reweigh-20261025/main-53d528fc-run40135849585-a1-120998363262.log \
  --log /tmp/fp-diag/runtime-reweigh-20261025/main-53d528fc-run40135849585-a1-120998363275.log \
  --log /tmp/fp-diag/runtime-reweigh-20261025/main-53d528fc-run40135849585-a1-120998363290.log \
  --log /tmp/fp-diag/runtime-reweigh-20261025/main-53d528fc-run40135849585-a1-120998363413.log \
  --log /tmp/fp-diag/runtime-reweigh-20261025/pr1017-merge-53253dcc-run40135935354-a1-120999494409.log \
  --log /tmp/fp-diag/runtime-reweigh-20261025/pr1017-merge-53253dcc-run40135935354-a1-120999494445.log \
  --log /tmp/fp-diag/runtime-reweigh-20261025/pr1017-merge-53253dcc-run40135935354-a1-120999494446.log \
  --log /tmp/fp-diag/runtime-reweigh-20261025/pr1017-merge-53253dcc-run40135935354-a1-120999494457.log \
  --log /tmp/fp-diag/runtime-reweigh-20261025/pr1017-merge-53253dcc-run40135935354-a1-120999494461.log \
  --log /tmp/fp-diag/runtime-reweigh-20261025/pr1017-merge-53253dcc-run40135935354-a1-120999494491.log \
  --log /tmp/fp-diag/runtime-reweigh-20261025/pr1017-merge-53253dcc-run40135935354-a1-120999494492.log \
  --log /tmp/fp-diag/runtime-reweigh-20261025/pr1017-merge-53253dcc-run40135935354-a1-120999494515.log
```

## 權重更新，2026-10-21

本次以 run 39674589957（batch #963，`05eee5b2`，attempt 1）及
39673038442（main `2d8056de`）的 16 份 job logs 重算；各有七個完整
segment 以 `--log` 輸入，batch partition 1 與 main partition 3 逾時，
以 `--partial-log` 僅納入已完成檔案。兩次 run 都沒有通過；量測不是通過證據。
目前 467 個 runtime files 全部在兩次 run 的已完成檔案聯集中有量測，
無刪除或未量測檔案；per-file minima 合計 9,500.848 秒，整秒權重合計 9,744。
輸出保留工具產生的 `Partial scheduling estimates` 前綴及 fixture 的 partial 標記，
因為跨 run 聯集不能取代單次完整、source-bound 的 hosted 證據。

October 16 原始 logs 不在本機，無法重放或重新比較當時主機；因此不保留為本輪輸入，
也不宣稱已量得它們與今天主機的速度差。沿用下方歷史上排除較快主機的理由，
避免把舊 host／舊檔案的較低耗時混入目前 minima；今天兩次 run 量測目前檔案與主機。
舊 fixtures 原樣保留，來源仍可追溯。

對目前 467 檔案使用真正的 `partitionRuntimeFiles(files, 8)`，以本次 fixture
逐分區加總量測 ms：舊權重為 939.118–1,518.582 秒，新權重為
1,183.704–1,192.938 秒，最大值低於約 1,430 秒，亦低於扣除最多 20 秒
provisioning 與 64 秒 cleanup reserve 後的 1,416 秒。這只是排程估算，
不是主機速度保證；batch 必須在新 candidate 上重跑整個 CI matrix 才能證明通過。
新 fixture 測試沿用 October 16 的完整聯集、唯一性、排序、spread 與新增未量測檔案
檢查，八分區上界為 1,210 秒，新增 15 秒檔案的上界為 1,220 秒。
依 orchestrator 決策，三組歷史上界重新對齊原先說明的窗口，並非依新實算值選上界：

- run 37567098443 四分區由 770 → 870 秒，加檔由 780 → 870 秒；低於 870 秒的
  cushion 是依早期權重校準，900 秒分區約留 870 秒測試的歷史窗口不變。
- October 9 六分區由 760 → 870 秒，加檔由 770 → 870 秒，對齊原訊息所指
  900 秒窗口；四分區由 1,150 → 1,200 秒，對齊原訊息所指 legacy matrix budget。
- October 16 六／八分區分別由 1,040／780 → 1,210 秒，沿用 October 21 fixture
  的窗口；加檔仍保留 `bound + 10_000`（由 1,050／790 → 1,220 秒）。舊 1.33×／1.8×
  餘裕推論針對當時 runs 推導的權重；目前權重已不來自 October 16，因此比照 October 16
  更新時對 October 9 的處理，只移除這組 `< 10_000` spread assertion。

歷史 fixture 內容及其餘 assertions 全部保留；October 21 的 spread 檢查不變。

從 repo root 重現（原始 logs 另存於 job dir）：

```sh
node scripts/ci/derive-runtime-weights.mjs --root . \
  --note "Progress segments of runs 39674589957 (2026-10-21, batch #963 at 05eee5b2; p1 timed out) and 39673038442 (2026-10-21, main 2d8056de; p3 timed out); timed-out partitions add completed files only. No run passed." \
  --output packages/contribution-tools/runtime-file-weights.mjs \
  --costs-output packages/contribution-tools/test/fixtures/runtime-hosted-costs-20261021.json \
  --log /home/thuang/agent-work/cli-jobs-20261020/reweigh-20261021-logs/b963-p0-success.log \
  --log /home/thuang/agent-work/cli-jobs-20261020/reweigh-20261021-logs/b963-p2-success.log \
  --log /home/thuang/agent-work/cli-jobs-20261020/reweigh-20261021-logs/b963-p3-success.log \
  --log /home/thuang/agent-work/cli-jobs-20261020/reweigh-20261021-logs/b963-p4-success.log \
  --log /home/thuang/agent-work/cli-jobs-20261020/reweigh-20261021-logs/b963-p5-success.log \
  --log /home/thuang/agent-work/cli-jobs-20261020/reweigh-20261021-logs/b963-p6-success.log \
  --log /home/thuang/agent-work/cli-jobs-20261020/reweigh-20261021-logs/b963-p7-success.log \
  --log /home/thuang/agent-work/cli-jobs-20261020/reweigh-20261021-logs/main-p0-success.log \
  --log /home/thuang/agent-work/cli-jobs-20261020/reweigh-20261021-logs/main-p1-success.log \
  --log /home/thuang/agent-work/cli-jobs-20261020/reweigh-20261021-logs/main-p2-success.log \
  --log /home/thuang/agent-work/cli-jobs-20261020/reweigh-20261021-logs/main-p4-success.log \
  --log /home/thuang/agent-work/cli-jobs-20261020/reweigh-20261021-logs/main-p5-success.log \
  --log /home/thuang/agent-work/cli-jobs-20261020/reweigh-20261021-logs/main-p6-success.log \
  --log /home/thuang/agent-work/cli-jobs-20261020/reweigh-20261021-logs/main-p7-success.log \
  --partial-log /home/thuang/agent-work/cli-jobs-20261020/reweigh-20261021-logs/b963-p1-failure.log \
  --partial-log /home/thuang/agent-work/cli-jobs-20261020/reweigh-20261021-logs/main-p3-failure.log
```

## 歷史權重推導，2026-10-16

The producer snapshots the actual Git HEAD and full selected source manifest before execution and again after cleanup, rejecting tracked-tree changes. The manifest contains sorted `{path,source_sha256}` entries for all current full-suite files, including the closed baseline; deterministic partition membership uses the reviewed static scheduling weights in `partitionRuntimeFiles`, assigning estimated longest files first to the least-loaded partition with index tie-breaking. The October 16 weights were per-file minimum serial durations from the file-progress segments of hosted runs 38968059268 and 38960147348 (October 16, the commerce candidates) and 38003118152 (October 9). No run passed: 38968059268 timed out partition 1 and failed partition 5's database cleanup, 38960147348 timed out partition 3 and 38003118152 timed out partitions 1 and 4. Timing observations never turn those results into passes. The parser rejects an incomplete final segment unless the log is named with `--partial-log`; a timed-out segment then contributes only its completed files, never the file in flight, and its counters must still match. Those historical reporters clamped `elapsed_ms` at 1,200,000, below their 1,500-second budget; saturated files have no measured duration. The current strict/partial admission rules below supersede the historical omission behavior. Run 38000643429 is no longer an input: its hosts were about 30% faster than run 38960147348 in aggregate, against 21% for run 38003118152, and a minimum across all three understated the files measured only on October 16.

The October 9 weights covered 320 files. On the October 16 candidate, 411 files were selected and the unmeasured ones kept the 10-second default, including 40 new commerce runtime files; the 39 that completed took about 1,370 seconds together. Partition 3 reached its 1,500-second deadline with 49/69 files completed. The other five passed: partitions 2 and 5 finished their files in about 900 and 970 seconds, partitions 0, 1 and 4 in 1,380–1,525. That first regenerated fixture covered 395 measured files; the other 16 candidate files kept the 10-second default. Their estimated six loads are 1,085–1,090 seconds of per-file minima. Run 38960147348's own durations, with October 9 durations scaled by 1.35 for the 20 files it never completed, give 1,244–1,342 seconds per partition under the new allocation. That assumes `commerce-provider-accounts.test.ts` takes about 40 seconds after its secret scan became one statement per scan; its weight still records the 215 seconds of the measured run. Estimates require a fresh coherent hosted run; they are neither throughput guarantees nor acceptance evidence. No runner, case, file, cleanup, partition deadline or aggregate-window requirement changed.

Historical regeneration used the eighteen job logs (retain failure results separately): the fourteen complete partitions with `--log`, and partition 1 of run 38968059268, partition 3 of run 38960147348 and partitions 1 and 4 of run 38003118152 with `--partial-log`. Partition 5 of run 38968059268 completed all 69 files before its cleanup failed, so it is a complete segment:

```sh
node scripts/ci/derive-runtime-weights.mjs --root . \
  --note "Progress segments of runs 38968059268 (2026-10-16; p1 timed out, p5 failed database cleanup after all files completed), 38960147348 (2026-10-16; p3 timed out) and 38003118152 (2026-10-09; p1,p4 timed out); timed-out partitions add completed files only. No run passed." \
  --output packages/contribution-tools/runtime-file-weights.mjs \
  --costs-output packages/contribution-tools/test/fixtures/runtime-hosted-costs-20261016.json \
  --log <complete unsaturated partition log> ... --partial-log <explicit historical incomplete or saturated log> ...
```

The October 9 command, with the ten complete logs of runs 38000643429 and 38003118152, still reproduces `runtime-hosted-costs-disk-20261009.json` exactly. Historical October 7 and October 9 cost fixtures remain unchanged. At the October 16 refresh, their hotspot, maximum and four-partition bounds passed with those weights; the October 9 fixture no longer asserts a 15-second spread, because the weights no longer come from it. The October 16 fixture test checks six and eight partitions against the 1,500-second host budget. At about 1,630 seconds of minima per partition, the full suite no longer fits four 1,200-second partitions, so no four-partition bound is asserted for it. This does not claim that a local four-process full run has acquired the legacy matrix budget.

Each process retains the original sorted file order. Unknown files receive the same default weight and remain mandatory; file counts need not be equal. Producer, aggregate and local full runner import the same candidate implementation, not a separately installed timing registry. New selections change the manifest and must be rerun together. Untracked build output does not imply a tracked source change.

## Eight partitions, 2026-10-16

CI now runs eight partitions. Each keeps the 1,500-second absolute budget and the
24-second cleanup reserve; the aggregate permits eight budgets plus 1,800 seconds
of queue gaps, a 13,800-second (230-minute) wall span. Six and four partitions
remain accepted by both tools with their existing limits, and the local full-suite
default is unchanged.

Run 38968059268 (PR #863 head `e266c86e`, the commerce candidate after its
weights were regenerated) selected 411 files. No case failed. Partition 1 reached
its 1,476-second test allowance with 64/69 files completed. Partition 5 completed
all 69 files and 906 cases in 1,036 seconds, then failed cleanup: its `DROP
DATABASE` exceeded the 16-second read timeout. The passing partitions took
1,014, 1,367, 1,415 and 1,412 seconds, three of them within 5% of the allowance.
Many files ran far above their minima on these hosts (for example, 22 to 108
seconds and 9 to 82 seconds), so weights cannot keep six partitions inside the
budget: recomputing the six-way allocation with these weights and this run's
durations still gives a heaviest partition of about 1,430 seconds before
provisioning. The same durations give about 1,040 seconds for the heaviest of
eight partitions.

`runtime-hosted-costs-20261016.json` now covers 404 files; per-file minima total
about 6,140 seconds, about 1,027 seconds per six-way partition and 770 seconds
per eight-way partition. Each run uses two more hosted runners. These are
scheduling estimates, not acceptance evidence; the new matrix still requires one
fresh complete hosted run.

## Current queue capacity and attempt isolation, 2026-10-15

Six-partition aggregation now permits a 10,800-second (180-minute) wall span:
six existing 1,500-second partition budgets plus 1,800 seconds of queue gaps.
The partitions may therefore run sequentially when hosted capacity is busy.
Each partition still has its 1,500-second absolute execution/provisioning budget
and 24-second cleanup reserve; each Actions job still times out at 40 minutes.
The four-partition 1,200 / 1,800-second limits and local full-suite runner are
unchanged. Queue allowance never grants an individual test process more time.

Run `38695036914`, attempt 1, demonstrated the previous scheduling assumption
was invalid: partition 3's runtime step began at 07:08:57 UTC, partition 5
finished at 07:54:49, and partition 0 did not begin until 07:59:29. This already
exceeded the old aggregate window despite successful individual partitions.
These are job-step observations, not a passing full-suite result. The original
run retains its original checks and cannot be repaired by changing this source.

CI uploads `runtime-partition-<run_attempt>-<index>` and downloads only
`runtime-partition-<current_run_attempt>-*` from the current workflow run.
The six inner JSON filenames remain unchanged. A failed-only retry cannot
borrow earlier-attempt passes; missing current-attempt fragments fail closed.
After a runtime or aggregate failure, rerun all partitions together (the
complete workflow), never splice artifacts across attempts. Aggregate diagnostic
artifacts also include the attempt, preserving previous failures without name
conflicts. All six fragments still require the exact candidate and source
manifest, complete file/case union, individual deadlines and verified cleanup.

The v1 JSON remains diagnostic, candidate-controlled evidence: it does not
authenticate a GitHub attempt. Same-run/attempt isolation belongs to the CI
artifact transport above. Synthetic regressions check sequential 150-minute
capacity, the 180-minute boundary and one millisecond over, alongside unchanged
partition/four-partition rejections; workflow regressions require attempt-scoped
uploads/downloads without cross-run overrides. Hosted verification remains
required, and a queue exceeding the finite allowance still fails.

## Earlier partition capacity increase, 2026-10-15

Six-partition invocations now have a 1,500-second absolute budget, including
provisioning and the unchanged 24-second cleanup reserve. The 40-minute CI job
timeout and 2,400-second aggregate window remain unchanged. Four-partition
limits stay at 1,200 / 1,800 seconds; local full-suite behavior is unchanged.

PR #680 at head `93c6dc3f` used candidate and runner `79ecb76e`. In run
`38675206937`, partition 3 first completed all 62 files and 888 cases in
1,034.944 seconds of test progress, then failed database cleanup. Attempt 2
completed 55 files and 830 cases before the whole-process timeout; cleanup
passed. The same 55 file hashes took 956.817 seconds of measured file work
in attempt 1 and 1,146.151 seconds in attempt 2, about 20% longer. Of these,
54 files were slower. The next file previously needed 46.702 seconds but had
only about 26.5 seconds left. This supports a capacity limit, not an observed
individual test hang. Both original attempts remain failed.

Using the faster original durations for the seven unfinished files gives a
1,224.308-second completion projection, already above the former test budget.
Allowing the observed 20% variance for that tail still leaves about 236 seconds
within the new 1,476-second test allowance, before provisioning cost. This is
finite scheduling headroom, not a completion guarantee. No files, assertions,
case requirements, weights, cleanup checks or process termination rules change.

The aggregate still rejects fragments whose earliest start to latest end is
over 40 minutes. If a failed-only retry would exceed that window, run the full
six-partition matrix on one immutable candidate instead. The observed mixed
attempts spanned 86 minutes 29.418 seconds and could not pass aggregation even
if the retried partition passed. This capacity fix requires one fresh complete
matrix on the reviewed new candidate; its result cannot turn the original
head's failures into success. Delayed cross-attempt reuse needs a separately
reviewed identity and selection rule; the current v1 format does not provide it.

Existing matrix regressions retain all source, union, case and cleanup
rejections, plus the four-partition limits. Six-partition boundaries now accept
1,500 seconds and reject one millisecond more, while the 2,400-second aggregate
boundary and a delayed failed-only fragment remain rejected when exceeded.

## Timing integrity investigation, 2026-10-17

The six-partition execution budget is already 1,500 seconds, but the diagnostic
reporter still clamped elapsed time at 1,200 seconds. In successful
[Verify 38994475692, partition 3](https://github.com/FreeTWAI/freedom-platform/actions/runs/38994475692/job/117285301639),
all 63 files completed, yet 19 progress records reached that old ceiling.
Ten files were affected; nine had both endpoints equal to 1,200,000 ms and would
be assigned zero measured duration (rounded to weight 1). Complete file counts
therefore did not establish complete timing evidence. The original successful
test result remains successful; only its late-file scheduling measurements are
unusable. The other five partitions' timing records did not reach the ceiling.

The reporter's diagnostic bound now matches the existing 1,500-second execution
budget for both six and eight partitions. Strict `--log` input rejects any
started/completed record at either the
legacy 1,200,000-ms ceiling or the current 1,500,000-ms ceiling, and rejects
invalid/out-of-range elapsed values. An exact natural hit on a ceiling is also
conservatively rejected because v1 records cannot distinguish it from clamping.
No incomplete or saturated partition is silently dropped from a strict refresh.

Explicit `--partial-log` preserves historical scheduling estimates: it admits
only matched completed files, omits files with either endpoint at either ceiling,
and never invents a duration for in-flight or unstarted files. Both modes reject
invalid start/end values, reversed durations and inconsistent counters. The CLI
marks partial cost output `input_completeness: partial_scheduling_estimates`,
lists the partial log names, and emits a warning. These estimates cannot serve as
a complete refresh; retain the original logs, source identities and missing-file
accounting. Historical saturated logs must now be explicitly named partial even
if their file counts were complete. Parse/validation failure (including an empty
partial segment) occurs before either existing output is overwritten.

Existing weights and their historical fixture remain unchanged. Collect complete,
unsaturated per-file evidence from a future ordinary required run, verify source
hashes and the full current eight-partition union, then evaluate a separate weight refresh.
Do not infer missing durations from zero deltas or substitute log arrival times
for the reporter's monotonic clock. Tests exercise late-file emission/decoding,
legacy saturation rejection and the unchanged failed-timeout result boundary.
This fixes measurement fidelity; no hosted speedup is demonstrated or promised.
Suite budgets, selection, case checks, cleanup, scheduling and security are unchanged.

Pre-Commerce run 39002101887 used runner/candidate `cc65d3d4` and verified
371 files across six partitions; 23 endpoints exceeded 1,200,000 ms, reaching
1,365,634 ms without clipping. It proves late timing retention, not complete
Commerce-source coverage or acceleration. Browser shards took 30.4/30.9 minutes
and remained the critical path. Await ordinary eight-partition CI on the
integrated source before considering weights or a matched whole-run comparison.
The earlier local focused 29/30 result remains a failure: the unchanged one-second
timeout fixture saw zero completed files. Controlled child-start pauses of 100 ms
and 1,200 ms under the same 1,000 ms host deadline yielded one and zero completed
files respectively, both correctly failing with test_timeout. This demonstrates
the fixture startup-scheduling dependency, not the original delay’s exact cause;
the isolated pass does not erase it. No deadline or assertion was relaxed.

## Historical capacity change, 2026-10-10

The October 10 source gave six partitions 1,200 seconds each and a 2,400-second aggregate window. Legacy four-partition limits remained 1,200 / 1,800 seconds; the local full-suite default was unchanged. At that time, the installed `fa2fcdef` runner still used six-partition 900 / 1,800 seconds until a separately reviewed trusted-source rollout. That source change did not update the workflow pin, ruleset, permissions or runner hardware.

Evidence: [run 38043467019](https://github.com/FreeTWAI-AI/freedom-platform/actions/runs/38043467019) completed all six runtime partitions with final test-progress elapsed times 813/678/866/842/859/841 seconds. [Run 38046517453](https://github.com/FreeTWAI-AI/freedom-platform/actions/runs/38046517453) recorded 575/timeout/590/848/576/677 seconds. Its partition 1 completed 51 files with zero failures and verified cleanup; those same source hashes took 665 seconds previously and 865 seconds this time. The remaining tenant-policy-operator file previously completed in 6.17 seconds. These are hosted timing observations, not a passing result for the timed-out run or a throughput guarantee.

The unchanged 24-second cleanup reserve left roughly 875 seconds for tests. The prior 866-second completion had little headroom. A 1,200-second fragment leaves approximately 310 seconds beyond that observed test duration after the reserve, while remaining finite. The six-partition aggregate window keeps the same two-fragment-budget allowance for one coherent run. Weight-only rescheduling was insufficiently robust across the two observations; no scheduling weights, historical cost fixtures, file selections or case expectations are changed here.

`runtime-full.mjs` accepts `--partition-count 4` or `6`; `runtime-aggregate.mjs` defaults to four. Producer and aggregate share the partition budget. The producer still provisions one owned nonce database, runs one serial test process, reserves cleanup time and verifies cleanup before success. The aggregate independently recomputes current HEAD and the full manifest and requires distinct indexes, exact source/candidate identities, deterministic file and case unions, nonempty complete counts, zero failures/skips/cancellations/todo, unique case identities and verified cleanup. Missing or malformed JSON and noncanonical UTC timestamps fail. Both each fragment's duration and the whole earliest-start/latest-end span are checked. Delayed failed-only reruns cannot splice in fragments outside the applicable aggregate window.

Boundary regressions accept exactly 1,200 seconds and reject 1,200 seconds plus one millisecond for six-partition fragments; they accept exactly 2,400 seconds and reject 2,400 seconds plus one millisecond for the six-partition run. Existing four-partition and missing/source/cleanup/case rejection tests remain in place. Hosted verification on the proposed trusted runner remains required; local synthetic fixtures do not establish real runtime throughput.


The combined evidence digest hashes the six complete fragments ordered by index; individual original output hashes remain separately available. This is diagnostic candidate-controlled evidence, not authenticated supervisor evidence. All aggregate results retain `gate_enforced:false` and `merge_authorized:false`; this tool supplies no installed App gate, deployment approval or provider access. Local negative tests use synthetic reports and do not prove actual full-suite execution or hosted throughput.

## Bounded nonce-backend settlement (2026-10-17, #873)

[Verify39032894806 partition0](https://github.com/FreeTWAI/freedom-platform/actions/runs/39032894806/job/117396873274)
at head602ab0 / runner bd78372e completed53 files and807 cases, then failed
cleanup. DROP lost its acknowledgement after16057ms; the exact cleaner backend
was still present after the1s termination wait, so the old single readback failed
at17265ms. PostgreSQL logged termination around18.7s; this does not establish
that the database was absent. The final checkpoint was57ms. The cleanup source
matched prior green82806434 and main4e4b9f20; no WP07-causation or checkpoint-delay
claim is supported. Original failed artifact12101472856 remains failure evidence.

After a false termination acknowledgement, the helper now rechecks only the
same PID + owner + nonce application identity, at100ms intervals with bounded
metadata queries. It sends termination once, reserves the last1000ms for fresh
positive database-absence verification, and keeps the original20s absolute
cleanup deadline /24s suite reserve. Both query configuration and read timeouts
respect that reserve. A backend still present at the settlement cutoff fails;
an absent backend alone never passes cleanup. Database presence, identity or
ownership mismatch, unavailable observation and deadline expiry remain failures.
No retry of DROP, larger budget or parsing of late server logs is introduced.

Controlled transport/clock cases exercise the actual helper: unknown DROP ACK
at16.057s, termination after18.7s, never terminating, database still present,
settlement only at19.5s and absence observed after20s. These are sequencing
counterexamples, not a native reproduction of the hosted delay. Native wait/
lock/I/O capture was unavailable locally: no PostgreSQL binary/cached container
image, and the pinned CI image pull returned Forbidden. Existing source-bound
matrix checks and ordinary required CI remain mandatory; no blind full-suite
rerun is evidence for this change.

## One bounded DROP wait observation

Actual main0de6e17c [Verify39062324899 partition6](https://github.com/FreeTWAI/freedom-platform/actions/runs/39062324899/job/117482703119)
passed628 cases but failed cleanup: DROP unknown ACK at16054ms, then fresh
`database_present` at16865ms after backend termination. Checkpoint took40ms;
wait/lock/I/O cause remains unknown. Artifact12112047318 and receipt digest
`bfce2a1808e9f06dd51b41207b4c86287191b630fbe833d500a80a08649d63c3`
remain failed evidence, distinct from the earlier settlement and browser53200 failures.

If an individual DROP is still pending after8s, the helper attempts one concurrent
read-only observation on a separate connection with the same existing credentials.
It targets the exact cleaner PID/user/nonce application, checks the observer's
base database/current user/session user, and selects only state/wait category,
wait event and counts of granted/waiting locks and blocking backends. No query,
name, PID, client address, relation ID or arbitrary server error is emitted.
The existing nonblocking JSON diagnostic sink emits `phase:drop_observation`;
values are allowlisted, unknown strings become `other`, counts cap at1000 and
invalid counts become null. Missing/inaccessible identity and probe failures are
`unavailable`, never evidence of absence. A null wait event is not proof of progress.

Connection, statement and query limits are200ms, with a500ms total observer
watchdog. DROP completion cancels the observer timer and destroys any observer
socket; observation is never awaited or consulted by cleanup. No extra sleep,
DROP retry, privilege, deadline or acceptance change is introduced. The20s
cleanup deadline,24s suite reserve and fresh positive absence check remain.
The extra connection and catalog read have small resource overhead and may affect
scheduling; this is a single diagnostic sample, not continuous tracing or proof of
root cause. Slow scheduling can miss the sample; observer failure, unavailable
metadata or a blocked/closed log sink must not change cleanup's boolean result.
No full suite is run solely to manufacture a stall. Native PG wait-state evidence
remains pending an ordinary run; controlled transport tests are not such evidence.
