# 從一個功能模組開始貢獻

先找到功能的模組，再修改它的實作與測試。平台使用同一套 `freedom.module.json` 記錄模組歸屬、公開入口、依賴與驗證要求；不需要另建一份功能清單，也不需要為每個功能開一個 repository。

從自己的 fork 或工作分支提交 PR 到 `FreeTWAI/freedom-platform:main`。先看 [目前 PR](https://github.com/FreeTWAI/freedom-platform/pulls) 與 [Issues](https://github.com/FreeTWAI/freedom-platform/issues)，協調重疊範圍；已獲維護者直接派工時沿用該授權。完整協作規則見 [CONTRIBUTING](../../CONTRIBUTING.md)；Agent 開工前仍須讀 [AGENTS](../../AGENTS.md) 與受影響模組的 context。

## 1. 找到要修改的模組

需要 Node 24 或以上，從 repository 根目錄執行 `npm ci` 後即可使用：

```sh
# 全部模組，輸出結構化 JSON
npm run module:list

# 一個模組的檔案、公開入口、依賴與測試
npm run module:list -- --module community-search

# 已知畫面或 API 檔案，反查負責模組
npm run module:list -- --path apps/portal-web/src/modules/Community.tsx
```

`owned_paths` 是功能來源的歸屬；`public_exports` 是建議給其他模組使用的入口；`dependencies` 記錄相依；`instructions` 是修改前要讀的規則；`tests` 連到既有固定測試套件。`owner_role` 表示維護責任，不授予 GitHub、會員或商務權限。

已存在的功能請直接修改原模組。只有責任、資料與對外合約可以獨立說明時，才新增模組。父模組和子模組共同擁有一個檔案有時是刻意安排，工具會列出 `shared_ownership`，不能為了消除重疊而刪減原有測試範圍。

## 2. 新增模組骨架

以下名稱只是範例，請換成本次功能的 kebab-case ID；`--owner` 填實際維護角色，`--depends` 填已存在的模組 ID，以逗號分隔。

```sh
npm run module:new -- --id community-calendar --owner community --depends shared --dry-run true
```

預覽會列出五個檔案的完整內容，不寫入工作目錄：

| 檔案 | 用途 |
| --- | --- |
| `modules/community-calendar/freedom.module.json` | 歸屬、依賴、公開入口與測試 |
| `modules/community-calendar/README.md` | 功能責任與實作說明 |
| `modules/community-calendar/index.ts` | 給其他模組使用的入口 |
| `modules/community-calendar/service.ts` | 可替換的純函式教學範例 |
| `tests/runtime/community-calendar.test.ts` | 正常輸入與拒絕案例 |

依下一節先取得新增路徑的 context，再建立：

```sh
npm run module:new -- --id community-calendar --owner community --depends shared
```

工具拒絕覆寫既有檔案、重複 ID、路徑穿越、大小寫碰撞與 symlink 目錄。若名稱已有模組或被既有 descriptor 保留，先重新選擇責任範圍，不提供強制覆寫選項。

骨架尚未接入平台。請把教學函式與範例測試改成本次功能，寫清楚輸入、輸出、目前權限、失敗及重試行為；再按下表接入真正的頁面或 API。

## 3. 取得本次修改的 context

先 fetch 本次 PR 的上游，再固定 baseline。以下假設 `origin` 指向中央 repo；fork 使用者可把 `origin` 換成已設定的 `upstream`。

```sh
git fetch origin main
FREEDOM_BASE=$(git rev-parse origin/main)

# 修改現有模組
node scripts/freedom.mjs prepare --base-ref "$FREEDOM_BASE" --scope community-search
```

新模組的 descriptor 尚未存在時，`--scope` 不認得新 ID。先用 dry-run 的所有預計路徑取得 context，例如：

```sh
node scripts/freedom.mjs prepare --base-ref "$FREEDOM_BASE" --paths modules/community-calendar/freedom.module.json,modules/community-calendar/README.md,modules/community-calendar/index.ts,modules/community-calendar/service.ts,tests/runtime/community-calendar.test.ts
```

新路徑尚無歸屬時，工具會保守涵蓋全庫並回報 `surface_unmapped`。讀取完整規則並記錄這個原因；建立 descriptor 是解除這個特定 blocker 的工作，不能縮成無關模組來掩蓋它。建立骨架後重新執行 `prepare --base-ref "$FREEDOM_BASE" --scope community-calendar`。有跨模組修改時，加入所有實際範圍；工具也會納入已偵測的 worktree 差異。

核對輸出的 repository、head、base 與 affected modules。小範圍輸出 `freedom.coding-context/v1`，讀完 `context_path` 指向的 bundle；大範圍輸出 manifest，依 `chunk_count` 讀完所有 chunk，再檢查完整性：

```sh
# 僅適用於 manifest；把路徑換成 prepare 的 context_path
node scripts/freedom.mjs context --manifest .freedom/context/REPLACE/REPLACE/manifest.json --chunk 0
# 繼續讀取 1 到 chunk_count - 1
node scripts/freedom.mjs context --manifest .freedom/context/REPLACE/REPLACE/manifest.json --check complete
```

完整性檢查確認規則與目前工作目錄相符，不代表已理解規則或通過功能驗收。詳細說明見 [governance/README](../../governance/README.md)。

## 4. 功能程式放在哪裡

| 要修改的內容 | 主要位置 | 接入方式 |
| --- | --- | --- |
| 業務規則、狀態、權限與資料寫入 | `modules/<domain>/` | 優先使用該模組的公開入口，保留原本權威來源與重試契約 |
| 可共用的低階能力 | `packages/<capability>/` | 不依賴頁面或應用程式組合層 |
| 已登入的前端頁面 | `apps/portal-web/src/modules/` 等既有功能目錄 | 在 `src/features/` 的對應功能群提供具型別的 renderer |
| 分頁標題與說明 | `apps/portal-web/src/features/metadata.ts` | 同步 `Tab` 型別與實際導覽；註冊表拒絕缺漏、重複或未知項目 |
| HTTP 路由 | `apps/platform-api/src/routes/` | 用既有 route factory，或在 `src/features/` 對應 registrar 接入 |
| API 共通邊界 | `apps/platform-api/src/platform-app.ts` | 明確放在公開或會員邊界的正確位置，由 host 保持順序 |
| runtime / Worker 安裝與依賴 | `apps/platform-api/src/app.ts`、`runtime.ts`、`worker.ts` | 沿用既有 host adapter 與有效旗標，不由 descriptor 自動安裝 |
| 測試 | `tests/runtime/`、`tests/e2e/`、模組自己的測試目錄 | 驗證行為、權限拒絕、失敗及重試，不只測檔名或文字存在 |

前端目前分為 `identity`、`guilds`、`community`、`work`、`commerce` 五個功能群。`registry.tsx` 靜態組合它們；`types.ts` 定義 App 提供的 session、資料及 callbacks。`App.tsx` 保留登入、onboarding、生命週期與錯誤邊界；訊息仍使用既有 overlay。未完成入會的結帳入口共用相同訂單元件。新增頁面需要同步導覽與測試，不會因為新增 JSON 就自動出現在公開網站。

後端的 `features/` 把原本內嵌的登入、會員帳號、搜尋關係、個人內容、通知偏好、工作、公開活動、名片、媒體與商務組合抽成註冊函式。公開與會員路由仍在 host 的原順序呼叫。新會員路由應放在 `memberBoundary` 後；交易功能須保留原本 checkout、onboarding、quarantine 與 private-cache 規則。不要移動共通邊界來讓新功能通過。

這些是同一個應用程式內的模組；descriptor 的依賴圖與檔案歸屬不是 JavaScript import 隔離器。既有模組仍有歷史相依，跨模組變更須在 PR 清楚列出。`modules/module-registry/` 則是租戶執行期 instance / provision / capacity 系統，與這份開發模組目錄是不同責任。

## 5. 驗證後提交 PR

```sh
# 全部產品來源的歸屬、descriptor references 與 dependency graph
npm run module:check

# 單一新模組的行為測試（請換成實際 ID）
node --import tsx --test tests/runtime/community-calendar.test.ts
npm run typecheck

# 改過前端時，先 build，再跑符合範圍的瀏覽器測試
npm run build
```

`module:check` 檢查 `apps/`、`modules/`、`packages/` 的 TS、JS 與 CSS 產品來源；回報會列出完整掃描範圍與排除項。測試、型別宣告、生成或 vendor 資料及已編譯 public assets 不納入產品來源統計，手寫 public JS / CSS 與 production fixtures 仍納入。真正的依賴、引用檔或來源歸屬問題會使命令失敗。現有 `test:governance` 會執行真實 checkout 的來源覆蓋測試，新增未歸屬程式會讓 CI 失敗。

檢查沒有證明 import 隔離、runtime 註冊、授權或業務行為；這些仍需對應測試與審查。`--paths` 可協助診斷局部路徑，但不能用局部結果宣稱全庫通過。也不要刪掉舊 ownership、降低既有測試或提高 descriptor 上限來消除錯誤；同一個專屬功能資料夾可使用合理的 `/**`，混合目錄則明確列出來源。

依實際範圍執行既有 runtime、契約、governance 與瀏覽器驗證，再以固定 baseline 產生本機報告：

```sh
node scripts/freedom.mjs verify --base-ref "$FREEDOM_BASE" --report .freedom/reports/module-contribution.json
git diff --check
```

需要資料庫的測試先準備獨立、可丟棄的 PostgreSQL；CLI 使用明確的 `TEST_DATABASE_URL`，設定規則見 [本機 runtime](local-runtime.md) 與 [governance](../../governance/README.md)。缺資料庫、瀏覽器或固定行為證據時，寫實際的 `not_run` / unavailable 與原因；`verify` 的 exit 2 不是成功，也不要求為了開 PR 假造所有驗收已完成。新功能模組目前仍會保留 `registration_behavior_audit_required`；即使選定測試通過，也要列出 runtime 註冊與行為審查的未驗項。不要為了消除檢查錯誤重建歷史 inventory；依本次 PR 實際套用的 CI 要求執行，source-boundaries 與 pin 轉換狀態見 [驗證說明](../../scripts/ci/release-inventory.md)。

最後 push 自己的分支，建立 PR 到中央 `main`。使用自動帶入的 PR 模板交代問題、結果、模組、跨模組依賴、實跑命令與未驗項。新功能若需要 migration 或旗標，再說明其啟用條件與回退限制。PR、CI 成功與功能正式啟用是不同狀態；合併及部署依既有 [貢獻發布途徑](contribution-release-paths.md) 辦理。
