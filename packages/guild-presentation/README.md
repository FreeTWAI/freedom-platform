# 公會区塊開發入口

會長的文字、順序、顯示選項走現有啟動台後台；新增呈現元件才改程式。
供貨商品與作品仍由原領域 API 保存。這裡只提供呈現介面，沒有新應用目錄、
登入、資料表或權限。新增業務操作、契約、ACL 或資料結構須由領域維護者整合。

## 先看到一個實際畫面

在 repo 根目錄使用 Node 24 以上與既有 lockfile 安裝依賴，再執行：

```sh
npm ci
npm run guild:preview
```

開啟 `http://127.0.0.1:4487`。此入口沒有 API proxy，只有明示的合成資料；
不需要 PostgreSQL、備份 operator、GitHub、R2 或正式秘密。切換訪客、正式會員、
唯讀成員、空資料、403、404、503、載入中與三種外觀。導覽與建立按鈕只記錄
預覽動作，不會發送命令。主機 watcher 額度不足時可用
`GUILD_PREVIEW_POLL=1 npm run guild:preview`；不要提高整台主機限制。

兩個實際樣板：

| 自己維護的目錄 | 原領域介面 | 模組責任 |
| --- | --- | --- |
| [guild-supply](../../modules/guild-supply/README.md) | `/me/supply-catalogs?pagination=cursor` | 顯示目前可讀的供貨商品庫，返回原供貨頁；建立交給既有應用流程 |
| [guild-open-source](../../modules/guild-open-source/README.md) | `/me/content` | 顯示作品與技能投稿的不同狀態，返回各自管理入口 |

## 新增自己的區塊

1. 在 `modules/<自己的模組>/` 放元件、測試與既有格式的 `freedom.module.json`。
   從上述樣板開始；元件接受 [GuildBlockProps](block.ts)，匯出 `default` 與 `title`。
   `guildKey` 是可選字串。沒有 React context、讀取客戶端欄位或必填 prop 會帶入目前公會；
   只有公會頁渲染區塊時傳入該頁已有的代碼。未傳時既有區塊行為不變。缺少或空白代碼時，
   需要公會範圍的區塊要顯示明確空狀態，不可改列出其他公會的資料。
   `supplierConsoleEnabled` 為可選的站點供應商營運中心旗標；未傳入或為 false 時視為關閉，不讀取營運中心 endpoint。
2. 在該 descriptor 的 `surfaces` 加一個 `guild-block.<名稱>.v1` page，
   `entry` 指到自己擁有且列為 `public_exports` 的元件，`operations` 宣告既有 API
   操作，`auth_profile` 是 `member-session`。`dependencies` 包含呈現 SDK 與實際領域。
   這些是影響範圍與審查資料，不能授予權限。
3. `node scripts/generate-guild-blocks.mjs` 從同一批 descriptor 產生兩份投影：
   瀏覽器的靜態 lazy import 與伺服器的核准 ID 清單。不要手改產物或另建 manifest，
   不需要在 `App.tsx`、`GuildLaunchpad.tsx` 新增公會判斷。
4. 使用 `useGuildRead` 處理目前 session、abort、晚到回應、載入、空資料、無權限、
   關閉與暫時錯誤。公會成員等級只是呈現提示；伺服器仍逐次檢查真正資料權限。
   訪客不讀取私人 endpoint。未知區塊顯示不可用，元件錯誤保留其他區塊與重試入口。
5. 跑自己的測試與共同契約，再提交可審查 PR。首次接入的 descriptor、API、依賴及測試責任
   由平台／領域維護者審查；已接入範圍內的日常修改由具實際 repo 權限的非作者維護者審查。
   元件仍隨主站 build 發布，錯誤邊界不是安全沙箱，不接受任意 JavaScript 或遠端載入器。

## 適用的本機驗證

```sh
npm run typecheck
npm run guild:check
npm run guild:test -- modules/guild-supply
# 或自己的另一個樣板
npm run guild:test -- modules/guild-open-source
```

`guild:check` 檢查登錄產物、嚴格 v1／v2 契約、未知版本與訪客呈現。
`guild:test` 建置專用預覽後跑模組內的 Playwright 測試，不啟動資料庫。
三種外觀、390／768／1440px、正常／空／拒絕／錯誤與實際導覽都需要核對。
本機預覽不能替代真實 API、撤權、CAS、發布與回復的整合測試。

改共同殼層或組裝契約時，平台維護者還要執行
`tests/runtime/guild-launchpad.test.ts` 與 `tests/e2e/guild-block-composition.spec.ts`、
原啟動台／用途配置旅程；使用獨立磁碟 PostgreSQL，跑完移除自己建立的容器與 volume。
領域變更另跑領域與反向相依測試。不要為此連接正式 DB。

提交前沿 [現有 context／影響工具](../../governance/README.md)檢查 baseline、
candidate、擁有者、依賴及 blockers。**2026-10-12 曾安裝公會局部 CI**，
當時 workflow 為 `14f82aa2`；目前 CI 從 `job.workflow_sha` 取得受審工具，
不把歷史 pin 當作目前安裝證據。下方分開記錄候選範圍及歷史 PR 證據；
未知路徑、核心或不完整依賴仍跑廣範圍驗證。

## 會長如何使用已審查的區塊

在啟動台「調整版面」選「啟用可組裝版面」，再選「加入公會工具」。
調整標題、顺序與顯示，保存草稿、預覽，再發布。現有 editor／delegate／publisher
權限與版本衝突處理保持有效；一般成員無法保存。草稿不進公開頁。
v1 仍嚴格讀取七區塊，轉換只建立新的 v2 草稿，不改寫已存歷史與 digest；
可從歷史回復已發布的 v1。未知版本不能新保存或發布，舊配置中未知區塊安全顯示不可用。

舊版的供貨、人才與製作主要動作集中在
[相容元件](../../modules/guild-workspace/LegacyLaunchpadPrimary.tsx)，保留既有使用者流程。
新工具使用區塊介面；不要繼續擴充相容元件的公會清單。平台預設版面未被自動改寫。

本輪 Agent 實作與隔離測試不代表真人驗收完成。仍需兩位非核心公會開發者，
各自在自己的目錄交付一次有用的修改，記錄使用入口、適用測試、維護者協助及卡點。
正式部署、相稱 CI 安裝與真人成果分別記錄，不互相替代。


## 已安裝的公會驗證路徑

`guild-presentation` 固定工作包含型別、登錄一致性、入口建置、五個公會 runtime 檔、三個殼層整合 browser 檔，以及供貨、開源與活動三個既有區塊的 preview 測試。完整與未知改動仍同時執行這些檢查。只有乾淨的 PR 整合 commit、完整相依圖與兩端已審查 import 邊界都成立時，才選 `guild-presentation` 與 `static-worker`。固定必要 `verify` 仍執行並核對所選工作，CodeQL、review 與禁止 bypass 的合併門檻保留。

本次候選把兩個固定元件檔案的試點，擴為已核准的 `modules/guild-supply/` 與
`modules/guild-open-source/` 模組目錄：元件、同模組 TS／TSX helper、純 CSS、說明與
既有 preview 測試可一起修改，也可新增 helper／純 CSS／說明。TypeScript AST 核對
兩個 Git 版本內的全部原始碼及本機 import 解析；註解或文字中的 `from`、`constructor`
不再造成廣測。產品與 preview 測試的外部依賴分開比對，測試專用依賴不能流入產品。
完整 descriptor 圖、原始 ownership、公開介面、權限與反向相依仍須一致，
共用殼層整合測試及 static-worker 保留。

新公會／descriptor、SDK、契約、API、設定與 AGENTS、跨模組或新外部 import、
動態 import／CommonJS／import.meta、CSS import／URL 資產、增加消費者、刪除／改名／
mode 變更與未知路徑仍完整驗證。新增 preview 測試檔也保留完整路徑，因目前 runner
只列舉既有測試檔；不能把未執行的新檔案當作局部驗證成功。依賴解析器缺失、語法錯誤
或來源超出上限時回退完整驗證。這是相稱 CI 的依賴判定，不是程式安全沙箱。

選測工作以受審 workflow checkout 的既有 lockfile 執行 `npm ci --ignore-scripts`，
從該安裝讀取既有 TypeScript 相容 parser 與 PostCSS；不執行 candidate 設定或套件 hooks。
主線 push 與核心修改仍完整驗證。本次程式與本機測試不代表已安裝或真人自主交付完成。

本機不需要資料庫的開發入口仍是 `npm run guild:preview` 與 `npm run guild:test`。平台維護者可用隔離 PostgreSQL 跑 `node scripts/ci/run-guild-runtime.mjs`；`TEST_DATABASE_URL` 必須指向可丟棄的測試庫。CI 的 browser 執行器接受固定 `--guild-presentation` 或 `--guild-preview` 工作，不接受任意檔案清單，逐案例核對列舉與執行結果；選中却未執行、只 skip、零案例、測試程序失敗都不算通過。

安裝前，`14f82aa2` 的 natural main Verify [38230347332](https://github.com/FreeTWAI-AI/freedom-platform/actions/runs/38230347332) 全部 15 jobs 通過，包含完整 browser 895 案及公會工作；CodeQL 與來源封存的實際還原亦通過。組織 ruleset `24469536` 僅更新 workflow SHA，並讀回確認其他門檻不變。

安裝後的 [#467](https://github.com/FreeTWAI-AI/freedom-platform/pull/467) 只改 `modules/guild-supply/CatalogBlock.tsx`，未修改中央殼層或全倉 inventory。[必要 Verify](https://github.com/FreeTWAI-AI/freedom-platform/actions/runs/38235723633) 在 388 秒內完成：公會 runtime 38 案、殼層整合 browser 15 案、預覽 3 案，以及 source-integrity、static-worker、彙總皆通過；完整 runtime／browser 是未選取，不是聲稱已執行。detna-vibe-coding 審查 exact head `74d34118` 後合併為 `e16dc6b8`。這證明已安裝的局部 PR 路徑可用；作者與 review 都是 AI 協作，兩位非核心公會作者的真人交付驗收仍待進行。

公會作者現在不用重寫全倉 hash inventory。每日必要 source-integrity 從可信 Git objects 核對既有 migration 不變與相對連結，保留契約生成／diff、runtime text 及治理測試；完整來源 tar、雜湊清單與實際還原由 main 整合產生 artifact。日期清單保留為歷史資料；`verify:inventory` 是舊清單的重現工具，不再是新 workflow 的日常門檻。

## 審查責任與自主交付驗收

內容設定沿原草稿／預覽／發布權限，由公會長或被委派編輯者完成，不需要程式 PR。
首次接入或擴大共用 API、跨公會資料、交易、schema、CI 與權限時，由相應平台／領域
維護者審查。日常公會程式由具資格的非作者公會維護者處理，無須公會、平台、Ted 三重簽核。
CODEOWNERS 與既有主線保護仍適用；descriptor 的 owner_role 不會授予 GitHub 權限。
寫完之後的發布途徑與暫緩 PR 的狀態摘要格式，見[群友貢獻的發布途徑](../../docs/development/contribution-release-paths.md)。

各先行公會仍須確認具名維護者與替補、實際 repo write 權限及可用審查路徑。
本候選未指定未同意的負責人，也沒有變更 repo 權限或 CODEOWNERS。已有 GitHub 權限
不等於已承諾某公會責任。驗收仍要記錄兩位非核心作者各完成一個有用區塊，能自行預覽、
測試、取得非作者審查並發布，且無須 Ted 代改、代合併或手動啟動 CI；Agent 合成案例
與歷史 #467 不替代這兩次真實交付。
