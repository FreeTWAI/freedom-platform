# 會員分享整理為社群技能書 · 2026-10-20

平台負責人 Ted 於 2026-10-20 指示：「有分享技能書的都幫忙他們正規化想的技能書」。
沿用 [2026-10-01 手動登錄作品先例](manual-work-skill-books.md)：「手動登錄技能包不應該被差別對待, 應該也把他們做成技能包, 也要幫它們畫圖, 登入成格式化的樣子」。

本次將會員「分享技能書」流程已發布的 12 個 repo 整理為目錄技能書，包含導讀、各 100 則分享介紹、書封、功能示意圖、固定版本來源與上架 migration。目錄從 41 本增至 53 本，原作 repo 指引從 47 個增至 59 個。全部 `guilds: []`，沒有公會指定、技能書 grant 或開發授權；不改會員原投稿、不執行或安裝上游程式、不部署。

## 收錄與署名

下表沿用任務提供的 2026-10-20 公開投稿快照。署名是會員的社群顯示名稱，關係為 `self_declared`，沒有拿 GitHub 帳號核對身分，也不代表已核實原作者。`author` 欄位保留相容的來源署名；新來源另記 `relationship`，導讀的 `credit_role` 讓頁面、書卡、Markdown 分別顯示「維護／策展」，一般作者沿用「作者」。GitHub 連結對這兩種關係使用「原作／來源帳號」。

| 技能書 id | 社群署名 | 自述關係 | 原作 repo | 核對 commit | 授權 |
| --- | --- | --- | --- | --- | --- |
| `hrflow` | Shiang | `author` | [tesdano-crypto/HRSystem-OpenSource](https://github.com/tesdano-crypto/HRSystem-OpenSource/tree/a60cd7b14d25b5a8ab90574247e48a4b4038b11c) | `a60cd7b14d25b5a8ab90574247e48a4b4038b11c` | Apache-2.0 |
| `hdsljp-api` | ken-kk | `author` | [kieiken/hdsljp-api](https://github.com/kieiken/hdsljp-api/tree/a3fc3b4ff2a3acf0df541da1b83a3688e0be8a19) | `a3fc3b4ff2a3acf0df541da1b83a3688e0be8a19` | AGPL-3.0 |
| `usage` | ken-kk | `maintainer` | [kieiken/usage](https://github.com/kieiken/usage/tree/e6298d1af0e2127b587b2ff609942896635bdd66) | `e6298d1af0e2127b587b2ff609942896635bdd66` | AGPL-3.0 |
| `photo-border-remover` | ken-kk | `author` | [kieiken/photo-border-remover](https://github.com/kieiken/photo-border-remover/tree/92df7927148ce6bab202114393365c8bc9e652d1) | `92df7927148ce6bab202114393365c8bc9e652d1` | MIT |
| `ga4-lp-analytics` | ken-kk | `author` | [kieiken/ga4-lp-analytics](https://github.com/kieiken/ga4-lp-analytics/tree/2c2b18d564a6bd6de24cd1057bed197af1b97c32) | `2c2b18d564a6bd6de24cd1057bed197af1b97c32` | MIT |
| `sns-feedback-collect` | ken-kk | `author` | [kieiken/sns-feedback-collect](https://github.com/kieiken/sns-feedback-collect/tree/6d9578f2773a645ac4fea9ed322e0144254202a3) | `6d9578f2773a645ac4fea9ed322e0144254202a3` | MIT |
| `ultracode-token-optimization` | ken-kk | `author` | [kieiken/ultracode-token-optimization](https://github.com/kieiken/ultracode-token-optimization/tree/aa7b2bd43da2364602554e954deeecc02e903b7e) | `aa7b2bd43da2364602554e954deeecc02e903b7e` | MIT |
| `keynote-pptx-doctor` | ken-kk | `author` | [kieiken/keynote-pptx-doctor](https://github.com/kieiken/keynote-pptx-doctor/tree/b7d2a1299f2776e481681d8fa326095cae5053f6) | `b7d2a1299f2776e481681d8fa326095cae5053f6` | MIT |
| `webchat-mcp` | 星語 | `author` | [JS-PACKAGE/WebChatMCP.js](https://github.com/JS-PACKAGE/WebChatMCP.js/tree/a9b5f77874cdb4de669c89a3b7d7fd76d2cd8a44) | `a9b5f77874cdb4de669c89a3b7d7fd76d2cd8a44` | Apache-2.0 |
| `gemini-voice-lab` | Nico | `author` | [Rumi-3653/gemini-voice-lab](https://github.com/Rumi-3653/gemini-voice-lab/tree/c8f6933127ca1d6ba65d0ce47075cfab4b5a0285) | `c8f6933127ca1d6ba65d0ce47075cfab4b5a0285` | MIT |
| `story-bible` | Nico | `author` | [Rumi-3653/story-bible](https://github.com/Rumi-3653/story-bible/tree/d0fa28c9a2bf7f26eaf8f01a8b03c2f4508a9ef5) | `d0fa28c9a2bf7f26eaf8f01a8b03c2f4508a9ef5` | MIT |
| `human-mode` | 啪哩啪啦 | `curator` | [madeofroc-arch/AI-Detox-Center](https://github.com/madeofroc-arch/AI-Detox-Center/tree/b2f5bc19f2f22b18285dfe360a5d77acbda63ca1) | `b2f5bc19f2f22b18285dfe360a5d77acbda63ca1` | MIT |

`usage` 是 ken-kk 維護的二次修改版，原作者 lollapalooza 與 `aqua5230/usage` 的歸屬見固定版本 `NOTICE.md`；不將維護者寫成原作者。Human Mode 是啪哩啪啦策展的 `madeofroc-arch/AI-Detox-Center`，不將策展者寫成作者。AGPL 兩本只描述與連結，不將上游程式碼帶進平台。

| 原投稿 id | 目錄技能書 |
| --- | --- |
| `6169a878-4f7a-4af9-a986-0857c5d91638` | `hrflow` |
| `9f193767-8756-4c39-99e7-4028ec789b1b` | `hdsljp-api` |
| `99263a55-7f76-41b5-816e-fbeaee98c602` | `usage` |
| `01bea8b2-2a82-4caa-a086-7b5d15941a34` | `photo-border-remover` |
| `d42fe060-77de-46ef-b7b1-804722142611` | `ga4-lp-analytics` |
| `c99896c0-b180-4ab6-93c4-a48d8fc7ccf0` | `sns-feedback-collect` |
| `eb6335ff-b187-4154-be15-aac0af62329d` | `ultracode-token-optimization` |
| `ea7c92a4-d649-47df-8350-f78e81c75d4e` | `keynote-pptx-doctor` |
| `91a7f325-54fa-406c-8c55-fdfeef94bf7f` | `webchat-mcp` |
| `0ae22e6c-6d82-4316-b5b7-12ebe67f2b3f` | `gemini-voice-lab` |
| `0dbf5ada-1ff2-44ae-a0b1-f25be6ae340f` | `story-bible` |
| `df5278b8-85cc-486d-b943-a3abbba33dee` | `human-mode` |

WebChatMCP.js 另有一筆 `cf9d4d53-…` 的同 repo 已發布投稿，既有公開清單已隱藏。目錄按 repo 收錄一本；`repository-match.ts` 從目錄產生排除鍵，`public.ts` 在 SQL 的 LIMIT 前排除同 repo 所有投稿，所以兩筆都不再重複出現在書架。原投稿資料與直接閱讀端點仍保留。這是來源與測試範圍的說明，不是正式資料庫操作收據。

## 使用邊界

導讀皆包含適合誰、目前限制、做得到的事、開始前準備、第一步、具體成果與回饋方式。以下依固定版本 README、LICENSE、適用的 NOTICE 與保存契約整理；平台沒有把文件敘述冒充實測結果。

- **HRFlow：開源人資管理系統**：Apache-2.0 自有程式；SQL Server、第三方依賴與政府行事曆資料另有條款，依 NOTICE 核對。.NET 10 與隔離 SQL Server 必備；SQL 整合測試限定 Windows、SQL Express 與整合驗證。這份獨立快照不是既有安裝的升級路徑。補休到期僅是 metadata，尚未自動到期或轉薪；LINE bridge 與外部出勤排程預設停用，需另外設定。台灣薪資與日曆規則須由採用者自行核對；工坊未執行上游程式。
- **hdsljp-api：日文人類圖命盤計算 API**：AGPL-3.0；本書只描述與連結，未複製上游程式碼。修改版透過網路供使用者互動時，須依 AGPL 提供對應原始碼；Swiss Ephemeris 另採 AGPL／專業授權雙軌，採用前核對其條款。Repo 不附必要的 .se1 星曆資料。需 Python 3.10 以上，原作建議 Linux。出生資料須本人同意；這是文化與自我探索工具，不作健康、命運或任職能力判定。工坊未驗證計算準確度。
- **usage：macOS 選單列 Claude／Codex 用量**：ken-kk 自述為維護者，這是 lollapalooza 的 aqua5230/usage 二次修改版，須保留 NOTICE.md 原始署名。AGPL-3.0（原作標示 AGPL-3.0-only）；本書未複製程式碼，修改版若供網路互動須依 AGPL 提供對應原始碼。限 macOS，來源採 Python 3.13；安裝包未簽章，會安裝每分鐘更新的 LaunchAgent。依本機紀錄推算，數值與成本不是官方帳務；原作說明不呼叫 Anthropic／OpenAI API、不讀 Keychain。工坊未安裝或讀取任何個人日誌。
- **照片白邊移除工具**：MIT；原作說明照片處理留在瀏覽器，工坊未實測資料流或裁切品質。瀏覽器版不需安裝；資料夾自動儲存路徑需 macOS 與 Node.js 本機伺服器。輸入限 PNG／JPEG／WebP；倍率 1–3 倍及 DPI 設定不代表恢復原圖細節，應保留原檔並人工檢查白色主體邊緣。
- **ga4-lp-analytics：GA4 著陸頁跳出分析**：MIT 模板；不錄影的設計仍會把事件送到 Google GA4，不能把原作「不收個資」描述推成零隱私負擔。自訂 page、section、cta 值須避免個資，並核對自己的告知與資料設定。自動取數需 GA4、GCP 服務帳號與 PHP 同源 proxy；私鑰放 Web root 外，proxy 與診斷頁置於 Basic 認證下。API 有配額與並行限制，原作不保證轉換成效；工坊未接真實分析帳號。
- **SNS Feedback Collect：貼文反應收集與調整判讀**：MIT；用於發布後計測與診斷，不直接產生或發布貼文。README 依賴 Codex Desktop、Chrome 外掛、已登入服務與作者本機的 kiei-dashboard／tracking.test.js，外部儀表板不在本 repo，需自備或改接相同保存契約。不要把 README 的外掛敘述當成工坊已驗證的可用功能。讀取只限本人有權查看的畫面，仍受 Facebook／Threads 規範與存取狀態限制；工坊未登入或擷取反應。
- **ultracode-token-optimization：多代理工作流程省 token 規則**：MIT 文字規則集，屬軟性行為引導，不保證 token 硬上限或特定節省比例。需自己的 Claude Code／Ultracode Workflow 環境；agentType、模型名稱、繼承與 budget 敘述依作者的特定環境，採用前須逐項查核，不代表所有安裝都支援。模型服務可能另計費，工坊未啟動代理或測量節省效果。
- **keynote-pptx-doctor：修復 Keynote 打不開的 pptx**：MIT；原作提供瀏覽器本機處理、Claude Code Skill 與只用 Python 標準庫的腳本。檢查封裝關聯、媒體格式與 XML，不保證所有問題都能自動修復；修復後仍須在目標 Keynote 核對版面與備註，macOS Quick Look 驗證也需 Mac。原作說明不修改投影片內容，工坊未執行或驗證修復結果，請保留原檔。
- **WebChatMCP.js**：Apache-2.0；需 Node.js 22 以上、Playwright Chromium；Claude／Grok 要登入，訪客與暫存對話狀態依服務而異，不能保證零保存。提示、歷史、工具結果會送到所選第三方聊天服務，仍受其條款、額度與收費限制，並非官方 API 或繞過付費方案。本機持久瀏覽器 profile 保留登入。工具回合由 host 依自己的權限與確認執行，不是沙箱。Codex 等外掛安裝會關閉應用並改設定，服務停止可能影響官方模型連線；Windows 腳本未實機驗證。工坊未安裝或登入。
- **gemini-voice-lab：回合制台灣口語配音**：MIT；真實生成需 Google Gemini API，文字與聲音樣本會送到 Google。免費層次數、模型與造聲 API 能力以自己的專案為準；固定版本記載 API 造聲免費層與 language_code 等仍未實測，不保證免費或台灣腔效果。複製聲音只限本人，須完成同意；私人音檔與 ID 不進 Git。配樂、音效與混音不在範圍，工坊未呼叫 API 或試聽。
- **story-bible：角色 × 場景 × 世界觀設定聖經**：MIT；Markdown 卡可手填，Python 3.8 以上的 check／export 只用標準庫。本工具管理設定，不會自行生成影像、聲音或保證一致性；下游模型費用及資料傳輸另計。範例視覺鎖句與聲線參數未經平台實測；部分下游是作者自用或第三方工具，不在 repo。library 預設忽略版本控制，仍須自己保護未發表 IP；參考圖與聲音需有權使用。工坊未執行匯出。
- **Human Mode：五階提示與自主思考**：啪哩啪啦自述為策展者，原作為 madeofroc-arch/AI-Detox-Center，不能據此稱其為作者。MIT；固定版本的遊戲採預寫題目、本機計算，不需帳號、推論或 API key。結果是遊玩樣本比例，不是心理診斷或個人能力判決；部分題目仍有可辨識線索，重要觀察需多次遊玩。安裝到聊天服務的 Skill 後，對話資料依該服務處理，不能將遊戲本機隱私延伸到所有平台。舊 tracker 歷史保留封存；工坊未執行遊戲或證明訓練效果。

## 分享介紹

12 個 `modules/community/share-introductions/<id>.json` 各有 100 則相異、8–200 字的繁中文案，句內不放 URL，連結由分享介面附加。文案以固定版本的功能、準備與限制為依據，提供不同閱讀切入語氣；不宣稱已使用或測試。

WebChatMCP.js 與 Human Mode 的會員各有 100 則原文，原先優先考慮沿用。這個工作環境對兩個公開 `/api/v1/skill-submissions/<id>/share-content` GET 都回 HTTP 403（一般 User-Agent 重試亦同，網頁工具也無法讀取），所以**本次兩本皆未重用或改寫會員原句**，改寫的是原作固定版本文件的介紹。沒有讀取私人端點或登入繞過。若維護者可取得原句，可後續比較適用文案；不能聲稱已保留會員原本語氣。

## 圖像

24 張圖各自以 builtin-imagegen 獨立生成，只經 sharp `contain` 縮放與 WebP 編碼。沿用工坊系列的炭黑、萊姆綠、鈷藍與鉻金屬書冊／流程插畫；沒有真實人物、品牌標誌、產品文字或假操作截圖。工坊原始 Logo 不變。

- 每本書封：`apps/portal-web/public/art/skills/<id>.webp`，768×512。
- 每本功能示意：`apps/portal-web/public/brand/skill-illustrations/<id>.webp`，1200×630。
- 每張完整提示詞、日期、尺寸、bytes、SHA-256 與原始生成路徑記於[書封 manifest](../design/skill-book-art-manifest.json)及[功能示意 manifest](../design/skill-illustration-manifest.json)。
- Human Mode 這次兩張目錄插畫為全新生成，未取用或改動既有 `/art/community-skills/human-mode*.webp`。

## 上架

新增 `migrations/173_member_shared_skill_books.sql`，只 INSERT 12 筆 `skill_publications` 並使用 `ON CONFLICT DO NOTHING`，保留既有上架時間；不寫入 `member_skill_book_grants`、`development_grants` 或會員資料。`deploy/cloudflare/environments.json` 的 `migrations.last` 為 173，migration plan 與 release compatibility 的已知 ledger／測試同步新增，既有 migration 未改。

173 是任務 baseline `e0f510c34eb605e5a395b6d239316df677776768` 的最低空號；合併前由 orchestrator 確認 main 是否先占用，必要時重編本輪 migration 與相關期望。這次未執行 migration 或宣稱已上線。

## 驗證入口與證據界線

- `npm run typecheck`；前端修改後 `npm run build`。
- 不需 PostgreSQL：`tests/runtime/member-shared-skill-books.test.ts`（固定 pins、角色、無公會指定、SQL 排除參數、24 張精確規格與 manifest 雜湊）、`skill-book-guides.test.ts`、`skill-book-upstreams.test.ts`、`skill-collaboration.test.ts`、`development-map.test.ts`、`skill-share-content.test.ts`、`skill-sharing.test.ts`。
- 本機 migration／release 規劃：`node --test deploy/cloudflare/test/migration-plan.test.mjs deploy/cloudflare/test/release-compatibility.test.mjs`，不接資料庫、不授部署權。
- 需 PostgreSQL，這次 `not_run`：`member-skill-registration.test.ts` 新增 173 的上架／重播／無 grant 變更檢查；`skill-submission-upgrades.test.ts` 新增全部 12 repo 加 WebChatMCP 第二筆、可見對照投稿與直接閱讀的真正 SQL 回歸。任務不允許啟動 PostgreSQL／Docker。
- 需瀏覽器與隔離資料庫，這次 `not_run`：`tests/e2e/skill-book-library.spec.ts`、`audit-skills.spec.ts`。書架期望為 29 本公會技能書與 24 本社群技能書。
- `scripts/verify-public.mjs` 同步 53 本／59 個 repo 的精確期望；這次未執行公開部署驗收。
- 交接實跑結果、先前失敗與未驗項記於 job dir 的 `skill-books.report.md`，不把本機測試當成可信 CI／正式部署證據。context 的 `surface_unmapped` blocker 也保留，不為本次擴大修改治理 descriptors。
- 完成變更後重跑 `node scripts/freedom.mjs prepare --base-ref e0f510c34eb605e5a395b6d239316df677776768 --paths <changed paths>`、檔案 inventory 更新、`verify_revision.py` 與 `git diff --check`。
