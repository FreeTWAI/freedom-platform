# 共用發布入口

這個變更把選版、GitHub 權限檢查、環境憑證入口、發布紀錄與結果收據接到
`Shared release` Actions，並串接資料庫／媒體備份、遠端讀回與隔離還原。
完整發布 entry、OCI image 建置入口和自然備份 workflow 已接入原始碼，
**尚未在 hosted runner 發布或啟用。** `plan` 成功只代表版本與 GitHub 權限通過，不能當作環境已準備好。

2026-10-25 查核：`teddashh`、`arumwu`、`Hao0321`、`detna-vibe-coding` 都有此 repo
的 admin 權限。現有 main ruleset 仍要求非作者審查、CODEOWNERS、最新推送後核准，
以及 Verify／CodeQL。部署塞車不能直接歸因於「其他人沒有 GitHub 寫入權」。
本變更保留這些規則；部署操作人不需要拿到別人的個人 token。

## 四人的操作方式

合併這份 workflow、完成下方安裝及 staging 驗證後：

1. 開啟 [Actions → Shared release](https://github.com/FreeTWAI/freedom-platform/actions/workflows/shared-release.yml)，
   按 Run workflow，workflow branch 保持 `main`。
2. 填完整 40 字元的 main commit SHA，選 `staging-next` 或 `next`，先選 `plan`。
   暫不提供會漂移的 `main`／tag／短 SHA 作為版本輸入。
3. 在 Summary 看版本、原始發起人、此次執行者、兩個 CI run 及結果收據。
   同一版本最新的 main push Verify、CodeQL 必須全部成功；PR 的綠燈不替代主線驗證。
4. 確認環境已安裝後，選同一版本與 `deploy`。正式 `next` 會要求同一版本、
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
| Variable | `RELEASE_OPERATOR_IMAGE` | 已審查的公開 OCI image，固定 `ghcr.io/freetwai/freedom-release-operator@sha256:…`，不能用 tag |
| Variable | `RELEASE_CONFIG_SHA256` | 下方 config 的完整 UTF-8 bytes SHA-256，包含檔尾換行 |
| Secret | `RELEASE_CONFIG_JSON` | 此環境的資源、DB 身份、外部 floor seed 與 migration profile；不接受程式或旗標決策，格式見 [operator protocol](operator-protocol.md) |
| Secret | `CLOUDFLARE_API_TOKEN` | 團隊服務帳號的環境專用 token；僅核准的 Worker 部署、目標 R2 備份／讀回及必要資源權限 |
| Secret | `MIGRATION_DATABASE_URL` | 此環境的專用 migration role，保留現有角色、目標與 TLS 核對 |
| Secret | `RUNTIME_DATABASE_URL` | 此環境既有 app role，migration 後用獨立唯讀交易確認實際登入與讀取權限 |
| Secret | `BACKUP_DATABASE_URL` | 此環境的專用 snapshot／備份 role，包含既有 maintenance pin 所需權限 |
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
確認屬於個人帳號；它沒有被複製到共用 secrets。團隊 Cloudflare token、Access
service token、image 與 config 仍待安裝，發布尚未啟用。

## 首次安裝與備份接手

1. 原始碼通過必要審查、合併及相同 main 版本 CI 後，由四人之一執行
   `Release operator image`。它只封裝已追蹤來源，實跑 image 內 PG18、R2、migration
   與 smoke 邊界驗證，再以短效 job token 發布 GHCR；不讀取部署秘密。
2. 確認該 image 可公開拉取，把輸出的不可變 digest 安裝到兩個 Environment。
   從原操作者保留的 legacy floor、素材政策及座標約束建立獨立核對的私人 seed；
   不得以當下 DB 狀態自行核准新的還原下限。固定 config bytes 與 SHA-256 必須一致。
3. 補齊服務憑證後，先開 `BACKUP_ENABLED`，保持 `RELEASE_ENABLED=false`。
   各環境先手動執行 `Shared backup`，核對真實 dump 預算、遠端讀回、隔離還原及清理。
4. 保留舊 timer，等新 `Shared backup` 在 **05:43 UTC** 自然觸發並完成兩個環境。
   所有來源仍走 main／CI 准入；它備份當下實際部署版本，不擅自升級應用。
   新舊入口共用原 DB advisory lease，不會同時擷取。若因舊工作占鎖而拒絕，保留失敗，
   對齊排程後等下一次自然觸發；人工重跑不能冒充自然首試。
5. 設定 staging 發布入口並完成真實七階段演練，再由另一位操作者使用自己的帳號執行。
   `next` 另核對相同版本 staging 成果。舊 timer 的退役只在接手確認後處理。

每次發布要求最新自然備份 run 首次 attempt 成功、兩個環境 jobs 與該環境 artifact
通過驗證，收據不超過 36 小時，image／config 與本次完全相同。改 pin 後須先驗新 pin
的備份與自然排程。手動備份、舊 attempt、過期 artifact、失敗的新 run 都不放行。
目前沒有自動排程補跑或未結案 floor 的自動重做功能；缺漏會明確拒絕。

## 執行與失敗處理

workflow/controller 固定在 `job.workflow_sha`；應用程式使用所選版本的獨立 checkout。
兩者都須位於 main 歷史。選版工作沒有環境 secrets。執行工作重新查 GitHub 權限與 CI，
再使用該環境的設定。GitHub Deployment 明確登記所選應用版本，避免誤記為 controller 版本。

Deployment payload 和 success status 可由有寫入權的流程建立，單靠這兩者不能證明 staging
做過完整發布。正式環境會另向 GitHub 查 Shared release 的 workflow ID／path、main
controller、成功 run／attempt、四人帳號 ID 及該次 admission／deploy jobs；再下載該 run
專屬的 `release-result-<run>-<attempt>` artifact，核對 GitHub 提供的 digest，讀取唯一且有
大小上限的 `receipt.json`。收據必須綁定同一 Deployment ID、source／tree、operator、
staging config、操作者及全部七階段成功。最後重讀 run 與最新 Deployment，拒絕已重跑或
被新紀錄取代的結果。Artifact 缺失、到期、舊 attempt、plan-only 或不完整收據都不放行。
這依賴受保護 main 的已審查 workflow 與 GitHub artifact 歸屬，不能替代 operator／provider 實跑。

發布工具在一次性的 GitHub hosted runner 容器內執行，不 SSH 回個人電腦，不掛 Docker
socket 或家目錄。整次發布只有一個 operator process，以維持資料庫 lease／heartbeat
和一致的清理責任。兩個環境先共用一個不取消正在執行工作的 concurrency group；
資料庫 lease 還必須協調現有排程和舊操作入口。GitHub concurrency 本身不涵蓋外部操作者。
排隊中較舊的 run 仍可能被 GitHub 的 concurrency 規則取代，需看 run 的實際狀態。

階段固定為 preflight → backup-before → migration → deploy → health → backup-after → handoff。
備份必須包含遠端讀回、隔離資料庫與物件還原、清理；最後驗證自然備份排程仍能執行。
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
的核准來源。該次操作者回報的 rollback floor 是 `36bec661`／schema 189，並正在準備
下一版；這是具日期的交接觀察。接手時必須重讀權威 floor，僅能前進，不能直接把
這個歷史值寫死在 Actions。

只上傳固定欄位的公開 JSON 收據，不上傳 operator stdout/stderr、DB dump、物件、
原始設定或 provider response。operator 每階段可寫進度，controller 只輸出白名單內的
階段名稱和狀態。這不是對惡意發布工具的防洩漏沙箱；image 本身仍須審查與釘選。

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
  與 Hyperdrive cache；保留現有旗標、秘密與綁定，只呼叫一次 Wrangler。Provider 清單延遲或
  GET 失敗會留下觀察紀錄並有界重讀，不再次發布。兩環境已完成實際唯讀核對；
  mutation 仍只驗了合成 provider，沒有實際部署。
  另讀取 service metadata 核對 Workers Logs，明確保留目前的停用狀態；若已啟用
  Logs／traces 或出現未支援設定，在上傳前拒絕，不靠 `--keep-vars` 猜測會保留。
- `control-store.mjs`／`floor.mjs`：在私人 R2 保存有序操作紀錄，以獨立釘選的 seed
  和原始 legacy floor 為起點。每次核對完整前後關聯，缺檔、分叉、舊 head 或未結案
  操作都拒絕繼續；不能由目前資料庫重新造一份權威。COMMIT 前先保留交易 ID，確認
  提交後立即提高還原下限，後續權限探測仍需完成才算 migration 通過。這些 R2 操作
  目前以合成 transport 驗證並接入完整 image entry；尚未建立 live seed。
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
比對 digest 不等於驗證外部 retained floor 的權威；共享紀錄程式已補上，live 權威
seed、公開 image 安裝與自然排程交接仍未完成。原生 PostgreSQL／R2
演練使用合成資料；Cloudflare HTTP 邊界使用磁碟上的合成遠端副本，沒有接觸遠端
bucket、Worker 或正式資料庫。

現行發布程式綁定私人主機的絕對路徑、歷次 operator kit、保留 floor 和 systemd 排程。
本 PR 將執行入口移入固定 image，沿用現有
[migration runner](../cloudflare/migration-operator.mjs)、
[daily backup coordinator](../../packages/media-migration/backup-daily.ts) 及
[備份 CLI](../../scripts/media-backup-daily.ts)，完成 [operator protocol](operator-protocol.md)
列出的操作順序。`entry.mjs` 串接實際元件，`candidate-contract.mjs` 從指定來源在全新
隔離 DB 推導預期權限；`smoke.mjs` 重用既有唯讀 health／protocol／assets／anonymous 驗證。
本機 image 已以 UID 1001、唯讀根目錄、無網路執行 native fixture；這不是遠端發布。
備份 adapter 由 image 內的固定 `tsx` 載入既有 TypeScript
模組；TAR codec 使用 Python 標準函式庫。純粹產生符合格式的收據不能替代這些操作。

啟用標準是：已審查的 image 可在 hosted runner 完成真實 staging 發布、前後備份、
資料庫／物件還原與清理，並證明自然備份接手；再由另一位具名操作者以自己的帳號
完成一次。正式環境另依既有發布條件啟用。不得因此宣稱 UF:INT-18、AP:OPS-07、
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
