# 共用發布入口

2026-10-29 10:19 UTC 接續：產品 `5d662e6e` 的 main CI 已成功；[staging 40853952665](https://github.com/FreeTWAI/freedom-platform/actions/runs/40853952665) 回報部署與 health 通過，最後 handoff 失去 lease，workflow／Deployment 仍為 failure。journal 尚未持鎖讀回，未重送部署；正式站仍是健康的 `5c4bf56d`／schema194。
復原 [#1173](https://github.com/FreeTWAI/freedom-platform/pull/1173) 的 source 修正與 CI 已完成，仍待獨立正式核准、合併與新映像驗證／安裝。之後優先結清這筆 staging handoff，再取得同 source／image 的成功 staging 發布收據，才接續正式站。設定 hash、映像 pins 與旗標本輪未變；租約中斷根因未確認。見[完整收據與下一步](../../docs/platform-plan/execution/unified-foundation/rollout-main-5d662e6e-2026-10-29.json)。

一般程式發布使用 `releaseKind: independent`：preflight → migration（無待執行 SQL 時唯讀確認；有則走已核准交易）→ deploy → health → handoff。
不等待日常備份、不執行發布前後的 dump／遠端讀回／隔離還原，也不需要備份 DB 憑證。
日常 `Shared backup` 保留每日 **05:43 UTC**、完整備份／讀回／還原／清理與獨立收據。
GitHub 版本歷史只保存程式，不能當作資料庫備份。

## 目前安裝狀態

2026-10-27 05:06 UTC：兩環境已透過共用 Actions 完成真實發布，版本均為
`1db283839296e284602217140a21921072d86629`，五階段全部成功：

- [staging-next 發布收據](https://github.com/FreeTWAI/freedom-platform/actions/runs/40452068872)：04:56 UTC 完成。
- [next 正式發布收據](https://github.com/FreeTWAI/freedom-platform/actions/runs/40452543953)：05:02 UTC 完成，採用上述 staging 收據。
- [工具映像建置與獨立下載驗證](https://github.com/FreeTWAI/freedom-platform/actions/runs/40451864619)：
  `ghcr.io/freetwai/freedom-release-operator@sha256:5b2fa38af5d87ee4117744286931e4ed117e8d86fdb2929b9e676410232b2c39`。

四人帳號均重新核對為 repo admin；兩環境 `RELEASE_ENABLED`、`BACKUP_ENABLED` 都是 `true`，
Environment 沒有人工 reviewer 等待條件。使用各環境的服務憑證與短效 GHCR 授權，不需分發個人金鑰。
正式站 health 回讀 HTTP 200、`status=ok` 與上述版本。這兩次發起人為 `teddashh`；
其他三人的操作紀錄尚未觀察，不能將權限核對寫成四人都已實跑。
新映像的首次自然備份排程尚待觀察，原 timer 的交接由原維運負責人收尾；不阻擋日常部署。
完整接續紀錄：[部署追蹤留言](https://github.com/FreeTWAI/freedom-platform/pull/1105#issuecomment-6432723873)。

## 發布與備份邊界

已核准 main 的待執行 migration 使用原 immutable catalog／SQL policy、交易執行器、lease、ledger prefix、
COMMIT intent 與確認後 floor；不要求新備份。DDL 是資料變更，不能當作可逆程式更新；
破壞性 SQL 仍須在來源審查中明確評估，未知 COMMIT 結果停止且不自動重試／回滾。
跨環境 Actions concurrency 與 DB advisory lease 保留，正在執行的備份或 migration 不會被取消。
舊 journal 仍依原七階段 replay；新 `release-begin-v2` 保留四個 journal stages；有 migration 時確認 COMMIT 即更新 schema floor，
無 migration 時先完成唯讀檢查才建立 journal，健康查核後完成發布。

新增媒體用途時，operator 在原本的隔離候選資料庫分別讀取既有 schema 與候選 schema，
只接受已審 SQL 新增的預設停用政策列（legacy、無 persistence、無 quota／revision）。
既有環境政策與 GC 狀態仍須不變；交易內逐列核對後，將前後政策 digest 綁定 COMMIT intent，
確認提交才更新 floor，供後續發布與日常備份沿用。這不會啟用新用途，也不以 live 狀態自我核准。
若出現 `release_migration_frontier_mismatch`，表示 Environment config 的 `migrationProfile.last`
與選定來源的 SQL catalog 不符；設定負責人應核對已審 migration 後更新 config secret 與 hash。
這與 SQL policy 拒絕不同，不需重跑來源 CI 或備份來排除。

若前次備份留下可驗證的未完成 journal，可在 deploy 選填 `recover_backup_run_id`。
可信、已結束的失敗收據須證明尚未進入 capture 且沒有 intent，或 capture 失敗但 dump 尚未開始；
後者接受沒有 intent、唯一 capture-policy intent 的原始 policy digest 仍完全相符，
或原 revision 已提交且通過既有清理讀回；
持有同一 lease 後重新查 Worker、原 floor／ledger／material policy、GC OFF、零 deletion fences
及沒有目前維護角色的 capture backend，才 append abandonment，保留原失敗。
這不是備份成功，也不執行新備份。archive／migration／deploy intent、額外 intent 或任何不確定狀態仍拒絕。
2026-10-27 正式發布已對帳失敗備份 `40315670754`，追加 abandonment 後完成發布；
該備份仍是失敗紀錄。日常發布不需再填這個 run ID。

首次接手時，舊操作者可能已在共用 journal 建立後發布較新的程式。Controller 會核對
該環境最新 GitHub deployment 的成功狀態、四位操作者身分、main／CI 及新舊版本關係；
image 在 lease 內另核對 Worker、未變的 bindings、完整 SQL catalog、DB ledger、原政策
與座標限制，才追加 `legacy-source-adopted`。不重設 seed、不改 schema、不抹除舊紀錄。
若同時有 BEGIN-only 備份失敗，先依原失敗收據與唯讀檢查追加 abandonment，再銜接版本。
有 capture／archive／migration／deploy intent、未核准版本、schema 或設定變動仍會停止。
這類首次接手在 operator 通過 preflight（含版本銜接）後才建立新的 GitHub Deployment，
避免 image 下載或唯讀檢查失敗時，新紀錄遮住原本可信的舊發布。失敗的 Actions 收據仍保留；
缺少 Deployment 不證明沒有副作用，重做前仍須讀回原 journal，未知 intent 不放行。
一般（非 legacy）發布則在 controller 旗標預算檢查後、operator 啟動前建立 Deployment 並寫入
`in_progress`；任一 GitHub 寫入失敗即停止，不進入 provider 或 floor 寫入。

## 歷史安裝紀錄

以下為具日期的歷史觀察，不能代替本頁開頭的最新發布收據。
本機測試、`plan` 或 `check` 成功都不表示已發布。

2026-10-26 安裝進度：兩環境的 account-owned Cloudflare token、原始 floor／config
與私人 image 已安裝；[staging 唯讀查核](https://github.com/FreeTWAI/freedom-platform/actions/runs/40276457566)
及 [production 唯讀查核](https://github.com/FreeTWAI/freedom-platform/actions/runs/40276554245) 通過。
[staging 備份首跑](https://github.com/FreeTWAI/freedom-platform/actions/runs/40276749439) 失敗，
原收據未保存細部階段；遠端 journal 只有 capture-policy intent，尚無 archive intent。
後續唯讀觀察確認維護開關關閉、刪除 fence 為零；本機另驗 343 張表的快照、PG18 dump
及 66 個媒體物件成功，但沒有重現 hosted 失敗，不能拿這些結果替代完整備份驗收。
當時 `BACKUP_ENABLED`／`RELEASE_ENABLED` 皆為 false，並保留舊 timer；
目前開關與交付結果以本頁開頭的最新具日期紀錄為準。

2026-10-25 查核：`teddashh`、`arumwu`、`Hao0321`、`detna-vibe-coding` 都有此 repo
的 admin 權限。現有 main ruleset 仍要求非作者審查、CODEOWNERS、最新推送後核准，
以及 Verify／CodeQL。部署塞車不能直接歸因於「其他人沒有 GitHub 寫入權」。
本變更保留這些規則；部署操作人不需要拿到別人的個人 token。

## 四人的操作方式

環境已安裝並完成實際發布驗收，四人使用自己的 GitHub 登入：

1. 開啟 [Actions → Shared release](https://github.com/FreeTWAI/freedom-platform/actions/workflows/shared-release.yml)，
   按 Run workflow，workflow branch 保持 `main`。
2. 填完整 40 字元的 main commit SHA，選 `staging-next` 與 `deploy`。
   `plan` 是選用的 GitHub 准入預覽；日常部署已內建相同檢查，不必每次先跑。
   日常操作的 `recover_backup_run_id` 留空，沿用已安裝的工具映像，不必每次重建。
   暫不提供會漂移的 `main`／tag／短 SHA 作為版本輸入。
3. 在 Summary 看版本、原始發起人、此次執行者、兩個 CI run 及結果收據。
   同一版本最新的 main push Verify、CodeQL 必須全部成功；PR 的綠燈不替代主線驗證。
   新存憑證後，選 `check` 可先驗 Cloudflare 帳戶 token、Worker／路由／Hyperdrive
   讀取、兩個 R2 bucket 列舉及 staging Access health。先安裝正確的 config secret／hash；
   此模式不需開啟發布／備份，也不需安裝 image 或 floor，不建立 Deployment、不修改資料。
   Summary 逐項列出結果；通過只表示這些唯讀請求成功，不證明寫入權限、DB、備份或可部署。
   帳戶驗證被拒時，會另以唯讀請求辨識是否誤存有效的使用者 token；若是，顯示
   `release_account_owned_token_required`，不把它當作帳戶服務憑證通過。帳戶 token
   從 Cloudflare **Manage account → Account API tokens** 建立，與個人頭像下的
   My Profile → API Tokens 不同（[Cloudflare 說明](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/)）。
   Access 回傳重新導向時顯示 `release_environment_redirect_rejected` 與 HTTP 狀態，
   不跟隨 Location、不轉送憑證；檢查應用已儲存的 Service Auth 政策及指定的 service token。
4. staging 成功後，選同一版本、`next` 與 `deploy`。正式 `next` 會要求同一版本、
   同一發布工具 digest 最新的 staging 發布成功，而且成功收據須來自可信的完整 workflow 執行。
5. 查看每個階段和 GitHub Deployment。失敗先看收據；migration 或 provider 結果
  不明時，由操作人讀回實際狀態再處理，不能直接反覆點 Re-run。

完成對帳並確認可再次執行後，staging 應使用一次新的完整 dispatch；若依既有處理決定
重跑既有 run，須選 **Re-run all jobs**。正式准入要求 admission 與 deploy 來自同一個
attempt；只重跑 deploy／failed jobs，可能因 admission 屬於舊 attempt 而被拒絕。
這不授予未知結果的 migration／部署重做權；先確認前次 provider 與 DB 的實際結果。

使用自己的 GitHub 登入即可。原始發起人及重跑者都會再查當下權限，帳號同名但 ID
不同、權限已撤銷或不在四人名單內，都不通過。Actions 使用短效 `GITHUB_TOKEN`
查驗和登記發布；不需要 repo 管理員的 PAT。

## GitHub Environment 安裝

入口為 Settings → Environments → `staging-next`／`next`。兩個環境分開設定，
Deployment branches and tags 選 Selected branches and tags，只加 **branch `main`**。
不新增只能由 Ted 核准的 Environment reviewer，避免重建同一個人工瓶頸。

| 種類 | 名稱 | 用途 |
| --- | --- | --- |
| Variable | `RELEASE_ENABLED` | 安裝與 staging 真實演練完成前維持 `false` |
| Variable | `BACKUP_ENABLED` | 獨立安裝備份入口；未設或非 `true` 時拒絕，不能由發布開關推定 |
| Variable | `RELEASE_OPERATOR_IMAGE` | 已審查且本倉 Actions 可讀的 OCI image，固定 `ghcr.io/freetwai/freedom-release-operator@sha256:…`，不能用 tag |
| Variable | `RELEASE_CONFIG_SHA256` | 下方 config 的完整 UTF-8 bytes SHA-256，包含檔尾換行 |
| Secret | `RELEASE_CONFIG_JSON` | 此環境的資源、DB 身份、外部 floor seed 與 migration profile；不接受程式或旗標決策，格式見 [operator protocol](operator-protocol.md) |
| Secret | `CLOUDFLARE_API_TOKEN` | 團隊服務帳號的環境專用 token；僅核准的 Worker 部署、目標 R2 備份／讀回及必要資源權限 |
| Secret | `MIGRATION_DATABASE_URL` | 此環境的專用 migration role，保留現有角色、目標與 TLS 核對 |
| Secret | `RUNTIME_DATABASE_URL` | 此環境既有 app role，migration 後用獨立唯讀交易確認實際登入與讀取權限 |
| Secret | `BACKUP_DATABASE_URL` | 此環境的 SELECT-only snapshot／備份 role；policy／capture pin 寫入使用既有 migrator 連線，不擴充 backup role 權限 |
| Secret（僅 staging） | `CF_ACCESS_CLIENT_ID`／`CF_ACCESS_CLIENT_SECRET` | 既有 staging Access 應用准許的團隊 service token，僅傳送到固定 staging health origin |

不要把個人 token 或含憑證的 JSON 放進 workflow inputs、repo 或公開 artifacts。
由秘密管理器把值寫入 Environment secrets；操作人只需能啟動 workflow。
權限能否細分到單一 Worker／bucket，須依 Cloudflare 實際 token 類型核對，不能僅靠
變數命名宣稱已隔離。以實際部署、備份工具使用的 API 決定最小權限。
Staging 保留整站 Access；不得為了 health 檢查關閉保護。Access service token 與
Cloudflare 管理 API token 是分開的憑證。正式公開 health 不接受這組 Access 憑證。

2026-10-25 本輪已把兩個環境設成只接受 main，並寫入 `RELEASE_ENABLED=false`。
兩環境的 migrator、app、backup 服務帳號各自完成實際唯讀連線、DB／role 與
PG18／TLS 核對後，已分別寫入上述三個 Database URL secrets（共六組）。
沒有變更角色、重設密碼或執行 live migration。現有 Cloudflare token 經 API
確認屬於個人帳號；它沒有被複製到共用 secrets。當時團隊 Cloudflare token、Access
service token、image 與 config 尚未安裝，發布未啟用。

## 首次安裝與備份接手

1. 原始碼通過必要審查、合併及相同 main 版本 CI 後，由四人之一執行
   `Release operator image`。它只封裝已追蹤來源，實跑 image 內 PG18、R2、migration
   與 smoke 邊界驗證，再以短效 job token 發布 GHCR；不讀取部署秘密。
2. 保持 GHCR 套件 Private，把輸出的不可變 digest 安裝到兩個 Environment。
   發布 workflow 會將套件連結本倉；確認 Package settings 的 **Manage Actions access**
   已給 `freedom-platform` Read 或更高權限（Codespaces access 是另一項設定）。
   部署與備份 job 使用 `packages: read` 的短效 `GITHUB_TOKEN` 登入並下載固定 digest；
   權杖只經 stdin 傳給 runner 上的 Docker，暫存登入資料在啟動 operator 前刪除。
   不需要改組織的公開政策、建立個人 PAT 或另存 registry secret。
   `Release operator image` 的 `verify-pull` 會在另一個乾淨 runner，使用只有
   `packages: read` 的 job token 實測下載；不能以 image build／push 綠燈替代。
   從原操作者保留的 legacy floor、素材政策及座標約束建立獨立核對的私人 seed；
   不得以當下 DB 狀態自行核准新的還原下限。固定 config bytes 與 SHA-256 必須一致。
   若網站只有程式更新、最後 migration 仍是舊版本，可用 seed v2 明確採納已部署的
   後繼版本；先獨立核對該版 main／CI、provider、DB ledger 與原政策。Operator 再
   驗 Git ancestry、兩個 tree 和完整 SQL catalog；原 legacy floor 不改寫，不能用
   v2 接受新增／變更／刪除 migration 或跳過原座標約束。
3. 補齊服務憑證、原始 floor 與 image 後，開啟 staging 的 `RELEASE_ENABLED`，
   執行一次真實五階段發布並核對收據。成功後啟用 `next`，以同一版本完成正式發布。
   不先啟動新備份、不要求最新自然備份，也不更動原資料庫還原下限。
4. `BACKUP_ENABLED` 獨立控制每日備份。先確認真實 dump、遠端讀回、隔離還原及清理，
   再觀察每日 **05:43 UTC** 自然觸發的兩環境收據；人工重跑不能冒充自然首試。
   舊 timer 由原維運負責人處理，在備份接手確認後退役；此事不阻擋正常程式發布。
   新舊入口仍共用 DB lease，正在執行的備份不會因發布而被取消。
5. 四位操作人各自使用自己的帳號，Actions 保留原發起人、重跑者、版本與結果。
   其他帳號有權限不等於已觀察到他們的操作；實際操作與第二操作者演練另記錄。

目前沒有未結案 floor 的自動重做功能。缺漏或未知副作用先讀回對帳，不靠重跑取得成功。
舊七階段契約的自然備份證據檢查只保留作歷史相容；不適用於一般 `independent` 發布。

### 備份在上傳前失敗時的手動接續

四位操作人可在 `Shared backup` 選同一環境，於 `recover_run_id` 填入原失敗 run ID，
啟動一次新的完整 workflow。這不是 Re-run，也不把原失敗改成成功。
控制程式先向 GitHub 核對原 run 已完成且失敗、main workflow、操作者、該環境 job
及原 artifact；同 source／tree／config 才能接續，image 可更新到已審的修正版。
Operator 取得原共用 DB lease 後，再讀回未變更的 Worker、ledger、政策與原 floor，
確認原 capture backend 已結束、維護開關關閉且沒有刪除 fence，才追加
`backup-abandoned` 歷史紀錄並開始新的備份。所有來源 pins 與原失敗證據保留。

既有 capture revision 路徑仍要求唯一 capture-policy intent；新增 `before_dump` 邊界只接受
沒有 intent，或 policy（僅排除 generation）與 intent 的 `before` digest 完全相符且尚未提交。
兩者也可由獨立 deploy 接續；legacy predecessor 仍只限原 BEGIN-only 路徑。任何 archive intent 都拒絕。
上傳結果不明、migration／deploy 失敗、舊程序仍存活、設定或狀態已改變都拒絕；
不覆寫 seed、不刪 journal、不自動重送 PUT，也不能以此取得自然排程成功證據。
每個失敗 operator 階段都記錄固定 `failureCode`；公開收據只發布最後失敗階段的合法
`release_` 識別碼，Summary 同步顯示，無合法識別碼時為 `release_operation_failed`。
備份另保留階段、snapshot dump 進度、清理結果與固定 SQLSTATE／網路診斷碼；
不包含原始錯誤、cause 或憑證。

## 執行與失敗處理

發布紀錄的 GET 遇到網路／逾時、HTTP 429 或 500／502／503／504 時最多讀取三次，
每次仍受原 30 秒期限與 DB lease 限制；遵守五分鐘內的 Retry-After 秒數，
更長的等待直接停止，不提前重試；lease 中斷即停止等待。
完整鏈、digest、大小與權威檢查保留，認證拒絕、缺漏與內容不符不重試。
公開失敗碼區分讀取網路、逾時、限流與暫時不可用，不輸出原始錯誤或私有內容。
這個讀取處理不重送 PUT，也不自動重做 migration 或部署；未知寫入結果仍先讀回對帳。

workflow/controller 固定在 `job.workflow_sha`；應用程式使用所選版本的獨立 checkout。
兩者都須位於 main 歷史。選版工作沒有環境 secrets。執行工作重新查 GitHub 權限與 CI，
再使用該環境的設定。GitHub Deployment 明確登記所選應用版本，避免誤記為 controller 版本。

Deployment payload 和 success status 可由有寫入權的流程建立，單靠這兩者不能證明 staging
做過完整發布。正式環境會另向 GitHub 查 Shared release 的 workflow ID／path、main
controller、成功 run／attempt、四人帳號 ID 及該次 admission／deploy jobs；再下載該 run
專屬的 `release-result-<run>-<attempt>` artifact，核對 GitHub 提供的 digest，讀取唯一且有
大小上限的 `receipt.json`。收據必須綁定同一 Deployment ID、source／tree、operator、
staging config、操作者及該發布契約的全部階段成功（一般發布為五階段）。最後重讀 run 與最新 Deployment，拒絕已重跑或
被新紀錄取代的結果。Artifact 缺失、到期、舊 attempt、plan-only 或不完整收據都不放行。
這依賴受保護 main 的已審查 workflow 與 GitHub artifact 歸屬，不能替代 operator／provider 實跑。

發布工具在一次性的 GitHub hosted runner 容器內執行，不 SSH 回個人電腦，不掛 Docker
socket 或家目錄。整次發布只有一個 operator process，以維持資料庫 lease／heartbeat
和一致的清理責任。兩個環境先共用一個不取消正在執行工作的 concurrency group；
資料庫 lease 還必須協調現有排程和舊操作入口。GitHub concurrency 本身不涵蓋外部操作者。
排隊中較舊的 run 仍可能被 GitHub 的 concurrency 規則取代，需看 run 的實際狀態。

一般發布固定為 preflight → migration → deploy → health → handoff；舊七階段紀錄僅供相容讀回。
每日備份獨立完成遠端讀回、隔離資料庫與物件還原及清理，不參與一般發布准入。
任一不完整結果都不能標成成功。控制程式失敗後不重啟發布、不自動 rollback。
釘選的 Wrangler 4.138 自己會對部分網路／5xx／429 錯誤重試上傳，最多三次；
「只啟動一次 Wrangler」不等於「只有一次 provider upload」。不明結果仍須讀回對帳。
中斷時 receipt／Deployment 可能停在 running／in_progress，代表要讀回核對，不能視為已回滾。
容器若未確認停止，控制程式會回報清理未確認，保留私人工作磁碟到一次性 runner 銷毀，
不會刪除可能仍在執行的 PostgreSQL 資料目錄。它不會把這種結果算成成功。

現行操作者在 [2026-10-25 的交接留言](https://github.com/FreeTWAI/freedom-platform/pull/1038#issuecomment-6394000777)
補充了實際踩過的限制：Worker deployments 清單和 edge smoke 可能暫時仍讀到舊版，
只能有界重讀並保留各次結果，不可因此再次部署。原生 dump 目前的 180 秒上限仍是
待實測預算；必須在 hosted runner 到實際資料庫區域測量後才可安裝，不能拿本機
合成資料的耗時背書。程式對訊號／timeout 一律回報失敗，即使程序回傳 exit 0。
排程接手還須判斷暫停期間是否錯過時段；既有 systemd `Persistent=yes` 可能在啟動時
立即補跑，不能把所有啟動後的執行都當作交接失敗。這些仍是後續 operator 安裝驗收項。

旗標值以 owner 的既有決策紀錄為準；Environment config 只是傳遞設定，不是新旗標
的核准來源。變更須以經 code owner 審查的 PR 編輯 [flag-decisions.json](flag-decisions.json)，
記錄各 target 的布林字串值、決策人、日期及本倉 GitHub 決策網址；再正常發布合併後的
精確 main SHA，先 `staging-next`、成功後才 `next`。本次記錄 Ted 於 2026-10-27
決定兩環境的 `FREEDOM_COMMUNITY_RELATIONS_ENABLED="true"`；既有搜尋旗標維持原值。
移除 entry **不會關閉**旗標；關閉須明確設定 `"false"`。缺少整個檔案時完全保留舊行為。

決策僅從准入 SHA 的 Git blob 讀取，不讀 workflow input、Environment config 或網路。
只允許 `FREEDOM_*_ENABLED` 的 plain-text 布林旗標，名稱總長最多 64 字元、決策網址最多
160 字元，每 target 最多保存 64 筆決策；與 live 不同的變更每次發布最多 16 筆，
另查核序列化 metadata 預算，超限在 begin／publish 前以 `release_flag_changes_too_many` 拒絕。
需要變更多個旗標時，請拆成多次發布。`plan` 未讀 live，保守地將本 target 決策視為變更。
未知欄位、其他變數或 binding 類型一律拒絕。`plan` 列出決策（`from: null` 表示未讀線上舊值，
不代表已新增）；`check` 用唯讀觀察列出實際差異（此時 `null` 表示線上不存在）。
發布收據只公開 `name/from/to/record`；確認部署後 floor 採用預期 bindings hash，
後續備份與發布沿用新 hash。未知部署結果仍停止對帳，不自動重試。

該次操作者回報的 rollback floor 是 `36bec661`／schema 189，並正在準備
下一版；這是具日期的交接觀察。接手時必須重讀權威 floor，僅能前進，不能直接把
這個歷史值寫死在 Actions。

只上傳固定欄位的公開 JSON 收據，不上傳 operator stdout/stderr、DB dump、物件、
原始設定或 provider response。operator 每階段可寫進度，controller 只輸出白名單內的
階段名稱、狀態及上述公開旗標差異。這不是對惡意發布工具的防洩漏沙箱；image 本身仍須審查與釘選。

## 還差什麼才算完成

`portable/` 現在已有可執行、可測試的元件：

- `postgres.mjs`：原生 PG18 快照 dump，以及磁碟上的全新隔離還原，僅開私人 Unix socket。
  完整讀完及驗證備份串流後才執行單一交易還原；正式資料庫 URL 不能作為還原目的地。
  遠端連線要求完整 TLS 驗證，SQL role 與 PlanetScale 分支登入名稱分開核對。
- `lease.mjs`：沿用舊每日備份的 advisory lock，整個發布持續使用同一連線；
  連線中斷會撤銷工作訊號，不能回報成功交接。
- `backup.mjs`：沿用既有 daily backup coordinator，實際執行同一快照的 DB dump 與
  媒體擷取、封裝、遠端完整讀回、PG18 與本機原生 R2 還原、隔離證據比對及清理。
  前後核對 Worker source／bindings、完整 migration ledger 和 material policy digest；
  runtime role 不得有倒退 sequence 的 UPDATE 權限。備份完成後仍保留來源 pins 與
  整次發布的 lease，供接續 migration 使用。
- `capture-policy.mjs`：先寫私人操作意圖，再條件式開啟擷取保護。若 UPDATE 結果不明，
  先確認該次 PID／database／role／隨機 application name 的 backend 已停止，才關閉
  自己 revision 的保護；不能讓較晚提交的 UPDATE 在清理後重新開啟維運。
  實際啟用 UPDATE 前立即重查 lease／abort；準備或寫意圖期間失鎖時，不送出新的啟用寫入。
- `migration.mjs`／`canonical-sql.mjs`：使用已釘選來源的 migration runner，將 runtime
  grants 放在同一交易。核對 ledger、RLS、權限和 GC，再以實際 app／backup 角色唯讀探測。
  COMMIT 回覆不明時保留交易 ID，只提供讀回判斷，不允許直接重跑。
- `build.mjs`：複製指定 commit 與 lockfile，以固定工具建置前端及 Worker dry-run，
  核對來源未變與輸出 digest；建置程序不繼承部署憑證。已實跑 `0ec26d5c` 的本機
  npm 安裝、build、Wrangler dry-run，這不是 image／hosted runner 的驗收。
- `deploy.mjs`：讀回 active version、bindings、route、crons、workers.dev、Tokyo placement
  與 Hyperdrive cache；套用本 SHA 的 owner 決策，保留其他旗標、秘密與綁定，只呼叫一次 Wrangler。Provider 清單延遲或
  GET 失敗會留下觀察紀錄並有界重讀，不再次發布。兩環境已完成實際唯讀核對；
  provider mutation 的實際驗收結果另見本頁開頭的發布收據；本機合成驗證不等於發布。
  另讀取 service metadata 核對 Workers Logs，明確保留目前的停用狀態；若已啟用
  Logs／traces 或出現未支援設定，在上傳前拒絕，不靠 `--keep-vars` 猜測會保留。
- `control-store.mjs`／`floor.mjs`：在私人 R2 保存有序操作紀錄，以獨立釘選的 seed
  和原始 legacy floor 為起點。每次核對完整前後關聯，缺檔、分叉、舊 head 或未結案
  操作都拒絕繼續；不能由目前資料庫重新造一份權威。COMMIT 前先保留交易 ID，確認
  提交後立即提高還原下限，後續權限探測仍需完成才算 migration 通過。這些 R2 操作
  以合成 transport 驗證並接入完整 image entry；live seed 已於 2026-10-26 安裝，
  目前操作結果以具日期的 Actions 收據為準。
- `coordinate-fence.mjs`：唯讀核對原有十個 repository coordinate 約束，還原時只接受
  已釘選的 PG18 定義差異。保留原始核准資料，不重建或放寬約束；已對正式 DB 做
  唯讀比對，十項吻合。備份與 migration 現在要求接入外部意圖保存及約束驗證。
- `backup-storage.mjs`／`backup-tar.py`：使用既有 create-only 檔案存放器保存媒體，
  大小受限的 TAR 只接受固定範圍的普通檔案。下載副本先核對整體 digest，再檢查
  全部 member；拒絕重複路徑、穿越路徑、symlink 與特殊檔案，不使用 `extractall`。
- `cloudflare.mjs`／`intent.mjs`：來源媒體唯讀；遠端備份使用唯一 key、寫入前先同步
  私人磁碟上的操作意圖、只上傳一次，再完整下載比對。REST 寫入仍標示
  `atomicCreateOnly=false`，不能宣稱 provider 保證原子防覆寫。意圖紀錄只保護相同私人
  工作目錄中的重試；跨 runner 的對帳與證據保存仍屬完整 operator 的工作。
  Worker binding digest 可供前後比較；健康檢查只接受指定 SHA，不帶管理 API token，
  staging 則使用只送到固定 origin 的 Access service headers，拒絕跟隨重新導向。

這個備份 adapter 仍要求上層提供已核准的來源、ledger 與 material policy digest。
比對 digest 不等於驗證外部 retained floor 的權威；live seed 使用另行核對的原始 authority。
image 安裝與發布、自然排程、第二操作者演練各自保留實際驗收紀錄。原生 PostgreSQL／R2
演練使用合成資料；Cloudflare HTTP 邊界使用磁碟上的合成遠端副本，沒有接觸遠端
bucket、Worker 或正式資料庫。

舊發布程式綁定私人主機的絕對路徑、歷次 operator kit、保留 floor 和 systemd 排程。
共用入口改用固定 image，沿用現有
[migration runner](../cloudflare/migration-operator.mjs)、
[daily backup coordinator](../../packages/media-migration/backup-daily.ts) 及
[備份 CLI](../../scripts/media-backup-daily.ts)，完成 [operator protocol](operator-protocol.md)
列出的操作順序。`entry.mjs` 串接實際元件，`candidate-contract.mjs` 從指定來源在全新
隔離 DB 推導預期權限；`smoke.mjs` 重用既有唯讀 health／protocol／assets／anonymous 驗證。
本機 image 已以 UID 1001、唯讀根目錄、無網路執行 native fixture；這不是遠端發布。
備份 adapter 由 image 內的固定 `tsx` 載入既有 TypeScript
模組；TAR codec 使用 Python 標準函式庫。純粹產生符合格式的收據不能替代這些操作。

一般發布啟用標準是：已審查 image 在 hosted runner 完成真實 staging 五階段發布，
正式環境核對同版本、同工具的可信 staging 收據。每日備份與第二操作者演練
各自驗收，不重新成為普通發布的等待條件。不得因此宣稱 UF:INT-18、AP:OPS-07、
UF:INT-23 或第二操作者還原要求已完成。

本機入口：`node --test deploy/cloudflare/test/shared-release.test.mjs`，涵蓋 GitHub 准入、
收據、私有程序、Cloudflare 傳輸失敗及清理拒絕條件。
私人意圖檔案例優先使用 repo 的 `.freedom` 磁碟，再檢查 `/var/tmp`。若工具環境把兩處
都映射成 tmpfs，可設 `FREEDOM_RELEASE_TEST_DISK_ROOT` 指向可寫的磁碟目錄；仍會保留
生產元件的磁碟與權限檢查，不會以略過測試或放寬 guard 取得成功。

真實 PG18 隔離驗證：先備妥 `verify.yml` 已釘選的 PostgreSQL 18 image，再執行
`node --import tsx deploy/shared-release/test/postgres-integration.mjs --source .`。這個 fixture 才使用 Docker；
發布元件本身不呼叫 Docker。案例驗證指定快照、隔離還原、截斷備份拒絕、串流失敗、
舊鎖互斥、失去鎖後停止與資料庫清理，並執行完整 DB／媒體備份還原；檢查快照後新增
媒體不混入、遠端損毀先於還原被拒絕、PUT 回覆遺失不重送，以及 policy UPDATE 已
提交但回覆遺失時的清理。已接入既有 deploy-preflight CI job，
重用既有 image。這仍不是 hosted staging 發布或正式資料的還原證據。

參考：[GitHub Environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)、
[關閉預設 Deployment 並保留 Environment](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/deploy-to-environment)、
[Cloudflare GitHub Actions 部署](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)。
