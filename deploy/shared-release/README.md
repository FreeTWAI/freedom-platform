# 共用發布入口

這個變更把選版、GitHub 權限檢查、環境憑證入口、發布紀錄與結果收據接到
`Shared release` Actions。**目前是可審查的控制流程，尚未完成可執行的發布工具移植，
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
   同一發布工具 digest 最新的 staging 發布成功。
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

不要把個人 token 或含憑證的 JSON 放進 workflow inputs、repo 或公開 artifacts。
由秘密管理器把值寫入 Environment secrets；操作人只需能啟動 workflow。
權限能否細分到單一 Worker／bucket，須依 Cloudflare 實際 token 類型核對，不能僅靠
變數命名宣稱已隔離。以實際部署、備份工具使用的 API 決定最小權限。

2026-10-25 本輪已把兩個環境設成只接受 main，並寫入 `RELEASE_ENABLED=false`。
當時兩個環境都沒有部署 secrets；本輪沒有讀取、搬移或分發私人金鑰。
尚未安裝 image、config 或上述服務憑證。

## 執行與失敗處理

workflow/controller 固定在 `job.workflow_sha`；應用程式使用所選版本的獨立 checkout。
兩者都須位於 main 歷史。選版工作沒有環境 secrets。執行工作重新查 GitHub 權限與 CI，
再使用該環境的設定。GitHub Deployment 明確登記所選應用版本，避免誤記為 controller 版本。

發布工具在一次性的 GitHub hosted runner 容器內執行，不 SSH 回個人電腦，不掛 Docker
socket 或家目錄。整次發布只有一個 operator process，以維持資料庫 lease／heartbeat
和一致的清理責任。兩個環境先共用一個不取消正在執行工作的 concurrency group；
資料庫 lease 還必須協調現有排程和舊操作入口。GitHub concurrency 本身不涵蓋外部操作者。
排隊中較舊的 run 仍可能被 GitHub 的 concurrency 規則取代，需看 run 的實際狀態。

階段固定為 preflight → backup-before → migration → deploy → health → backup-after → handoff。
備份必須包含遠端讀回、隔離資料庫與物件還原、清理；最後驗證自然備份排程仍能執行。
任一不完整結果都不能標成成功。失敗不自動重跑 mutation、不自動 rollback。
中斷時 receipt／Deployment 可能停在 running／in_progress，代表要讀回核對，不能視為已回滾。

只上傳固定欄位的公開 JSON 收據，不上傳 operator stdout/stderr、DB dump、物件、
原始設定或 provider response。operator 每階段可寫進度，controller 只輸出白名單內的
階段名稱和狀態。這不是對惡意發布工具的防洩漏沙箱；image 本身仍須審查與釘選。

## 還差什麼才算完成

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

本機入口：`node --test deploy/cloudflare/test/shared-release.test.mjs`。
案例使用合成 GitHub／operator 回覆，涵蓋拒絕條件、順序、收據白名單與中斷清理；
不是 GitHub hosted、Cloudflare 或正式資料庫的實跑證據。

參考：[GitHub Environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)、
[關閉預設 Deployment 並保留 Environment](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/deploy-to-environment)、
[Cloudflare GitHub Actions 部署](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)。
