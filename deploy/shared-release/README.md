# 共用發布入口

這個變更把選版、GitHub 權限檢查、環境憑證入口、發布紀錄與結果收據接到
`Shared release` Actions，並移植 PostgreSQL 備份還原、資料庫鎖及 Cloudflare 傳輸元件。
**完整發布工具尚未串接完成，
也尚未部署。** `plan` 成功只代表版本與 GitHub 權限通過，不能當作環境已準備好。

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
| Variable | `RELEASE_OPERATOR_IMAGE` | 已審查的公開 OCI image，固定 `ghcr.io/freetwai/freedom-release-operator@sha256:…`，不能用 tag |
| Variable | `RELEASE_CONFIG_SHA256` | 下方 config 的完整 UTF-8 bytes SHA-256，包含檔尾換行 |
| Secret | `RELEASE_CONFIG_JSON` | 此環境的目標資源、保留旗標、schema floor 與備份設定；格式見 [operator protocol](operator-protocol.md) |
| Secret | `CLOUDFLARE_API_TOKEN` | 團隊服務帳號的環境專用 token；僅核准的 Worker 部署、目標 R2 備份／讀回及必要資源權限 |
| Secret | `MIGRATION_DATABASE_URL` | 此環境的專用 migration role，保留現有角色、目標與 TLS 核對 |
| Secret | `BACKUP_DATABASE_URL` | 此環境的專用 snapshot／備份 role，包含既有 maintenance pin 所需權限 |
| Secret（僅 staging） | `CF_ACCESS_CLIENT_ID`／`CF_ACCESS_CLIENT_SECRET` | 既有 staging Access 應用准許的團隊 service token，僅傳送到固定 staging health origin |

不要把個人 token 或含憑證的 JSON 放進 workflow inputs、repo 或公開 artifacts。
由秘密管理器把值寫入 Environment secrets；操作人只需能啟動 workflow。
權限能否細分到單一 Worker／bucket，須依 Cloudflare 實際 token 類型核對，不能僅靠
變數命名宣稱已隔離。以實際部署、備份工具使用的 API 決定最小權限。
Staging 保留整站 Access；不得為了 health 檢查關閉保護。Access service token 與
Cloudflare 管理 API token 是分開的憑證。正式公開 health 不接受這組 Access 憑證。

2026-10-25 本輪已把兩個環境設成只接受 main，並寫入 `RELEASE_ENABLED=false`。
當時兩個環境都沒有部署 secrets；本輪沒有讀取、搬移或分發私人金鑰。
尚未安裝 image、config 或上述服務憑證。

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
任一不完整結果都不能標成成功。失敗不自動重跑 mutation、不自動 rollback。
中斷時 receipt／Deployment 可能停在 running／in_progress，代表要讀回核對，不能視為已回滾。
容器若未確認停止，控制程式會回報清理未確認，保留私人工作磁碟到一次性 runner 銷毀，
不會刪除可能仍在執行的 PostgreSQL 資料目錄。它不會把這種結果算成成功。

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
- `cloudflare.mjs`／`intent.mjs`：來源媒體唯讀；遠端備份使用唯一 key、寫入前先同步
  私人磁碟上的操作意圖、只上傳一次，再完整下載比對。REST 寫入仍標示
  `atomicCreateOnly=false`，不能宣稱 provider 保證原子防覆寫。意圖紀錄只保護相同私人
  工作目錄中的重試；跨 runner 的對帳與證據保存仍屬完整 operator 的工作。
  Worker binding digest 可供前後比較；健康檢查只接受指定 SHA，不帶管理 API token，
  staging 則使用只送到固定 origin 的 Access service headers，拒絕跟隨重新導向。

上述元件尚未自行組成完整備份或部署。原生 PostgreSQL 實測使用合成資料；Cloudflare
案例使用注入的 HTTP 回覆，沒有接觸遠端 bucket、Worker 或正式資料庫。

現行發布程式綁定私人主機的絕對路徑、歷次 operator kit、保留 floor 和 systemd 排程。
本 PR 沒有把它假裝成可攜式工具。接續移植須沿用現有
[migration runner](../cloudflare/migration-operator.mjs)、
[daily backup coordinator](../../packages/media-migration/backup-daily.ts) 及
[備份 CLI](../../scripts/media-backup-daily.ts)，完成 [operator protocol](operator-protocol.md)
列出的實際 provider adapter。純粹產生符合格式的收據不能替代這些操作。

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
`node deploy/shared-release/test/postgres-integration.mjs --source .`。這個 fixture 才使用 Docker；
發布元件本身不呼叫 Docker。案例驗證指定快照、隔離還原、截斷備份拒絕、串流失敗、
舊鎖互斥、失去鎖後停止及四個資料庫的清理。已接入既有 deploy-preflight CI job，
重用既有 image。這仍不是 hosted staging 發布或正式資料的還原證據。

參考：[GitHub Environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)、
[關閉預設 Deployment 並保留 Environment](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/deploy-to-environment)、
[Cloudflare GitHub Actions 部署](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)。
