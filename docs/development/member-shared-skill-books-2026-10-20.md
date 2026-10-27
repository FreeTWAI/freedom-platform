# 會員分享整理為社群技能書 · 2026-10-20

平台負責人 Ted 於 2026-10-20 指示：「有分享技能書的都幫忙他們正規化想的技能書」。
沿用 [2026-10-01 手動登錄作品先例](manual-work-skill-books.md)：「手動登錄技能包不應該被差別對待, 應該也把他們做成技能包, 也要幫它們畫圖, 登入成格式化的樣子」。

本次將會員「分享技能書」流程已發布的 12 個 repo 整理為目錄技能書，包含導讀、各 100 則分享介紹、書封、功能示意圖、固定版本來源與上架 migration。目錄從 41 本增至 53 本，原作 repo 指引從 47 個增至 59 個。全部 `guilds: []`，沒有公會指定、技能書 grant 或開發授權；不改會員原投稿、不執行或安裝上游程式、不部署。

Ted 於同日核准這 12 本作為獨立目錄技能書公開，條件是：「把圖都畫一畫 介紹都寫好一點 github 都連起來」。本輪 `skill-books-polish` 重畫全部圖像、改寫導讀與分享短句、核對公開 GitHub 入口；仍未部署或變動正式資料。

## 收錄與署名

下表沿用任務提供的 2026-10-20 公開投稿快照。署名是會員的社群顯示名稱，關係為 `self_declared`，沒有拿 GitHub 帳號核對身分，也不代表已核實原作者。`author` 欄位保留相容的來源署名；新來源另記 `relationship`，導讀的 `credit_role` 讓頁面、書卡、Markdown 分別顯示「維護／策展」，一般作者沿用「作者」。GitHub 連結對這兩種關係使用「原作／來源帳號」。

| 技能書 id | 社群署名 | 自述關係 | 原作 repo | 核對 commit | 授權 |
| --- | --- | --- | --- | --- | --- |
| `hrflow` | Shiang | `author` | [tesdano-crypto/HRSystem-OpenSource](https://github.com/tesdano-crypto/HRSystem-OpenSource) | [`a60cd7b14d25b5a8ab90574247e48a4b4038b11c`](https://github.com/tesdano-crypto/HRSystem-OpenSource/commit/a60cd7b14d25b5a8ab90574247e48a4b4038b11c) | [Apache-2.0](https://github.com/tesdano-crypto/HRSystem-OpenSource/blob/a60cd7b14d25b5a8ab90574247e48a4b4038b11c/LICENSE) |
| `hdsljp-api` | ken-kk | `author` | [kieiken/hdsljp-api](https://github.com/kieiken/hdsljp-api) | [`a3fc3b4ff2a3acf0df541da1b83a3688e0be8a19`](https://github.com/kieiken/hdsljp-api/commit/a3fc3b4ff2a3acf0df541da1b83a3688e0be8a19) | [AGPL-3.0](https://github.com/kieiken/hdsljp-api/blob/a3fc3b4ff2a3acf0df541da1b83a3688e0be8a19/LICENSE) |
| `usage` | ken-kk | `maintainer` | [kieiken/usage](https://github.com/kieiken/usage) | [`e6298d1af0e2127b587b2ff609942896635bdd66`](https://github.com/kieiken/usage/commit/e6298d1af0e2127b587b2ff609942896635bdd66) | [AGPL-3.0](https://github.com/kieiken/usage/blob/e6298d1af0e2127b587b2ff609942896635bdd66/LICENSE) |
| `photo-border-remover` | ken-kk | `author` | [kieiken/photo-border-remover](https://github.com/kieiken/photo-border-remover) | [`92df7927148ce6bab202114393365c8bc9e652d1`](https://github.com/kieiken/photo-border-remover/commit/92df7927148ce6bab202114393365c8bc9e652d1) | [MIT](https://github.com/kieiken/photo-border-remover/blob/92df7927148ce6bab202114393365c8bc9e652d1/LICENSE) |
| `ga4-lp-analytics` | ken-kk | `author` | [kieiken/ga4-lp-analytics](https://github.com/kieiken/ga4-lp-analytics) | [`2c2b18d564a6bd6de24cd1057bed197af1b97c32`](https://github.com/kieiken/ga4-lp-analytics/commit/2c2b18d564a6bd6de24cd1057bed197af1b97c32) | [MIT](https://github.com/kieiken/ga4-lp-analytics/blob/2c2b18d564a6bd6de24cd1057bed197af1b97c32/LICENSE) |
| `sns-feedback-collect` | ken-kk | `author` | [kieiken/sns-feedback-collect](https://github.com/kieiken/sns-feedback-collect) | [`6d9578f2773a645ac4fea9ed322e0144254202a3`](https://github.com/kieiken/sns-feedback-collect/commit/6d9578f2773a645ac4fea9ed322e0144254202a3) | [MIT](https://github.com/kieiken/sns-feedback-collect/blob/6d9578f2773a645ac4fea9ed322e0144254202a3/LICENSE) |
| `ultracode-token-optimization` | ken-kk | `author` | [kieiken/ultracode-token-optimization](https://github.com/kieiken/ultracode-token-optimization) | [`aa7b2bd43da2364602554e954deeecc02e903b7e`](https://github.com/kieiken/ultracode-token-optimization/commit/aa7b2bd43da2364602554e954deeecc02e903b7e) | [MIT](https://github.com/kieiken/ultracode-token-optimization/blob/aa7b2bd43da2364602554e954deeecc02e903b7e/LICENSE) |
| `keynote-pptx-doctor` | ken-kk | `author` | [kieiken/keynote-pptx-doctor](https://github.com/kieiken/keynote-pptx-doctor) | [`b7d2a1299f2776e481681d8fa326095cae5053f6`](https://github.com/kieiken/keynote-pptx-doctor/commit/b7d2a1299f2776e481681d8fa326095cae5053f6) | [MIT](https://github.com/kieiken/keynote-pptx-doctor/blob/b7d2a1299f2776e481681d8fa326095cae5053f6/LICENSE) |
| `webchat-mcp` | 星語 | `author` | [JS-PACKAGE/WebChatMCP.js](https://github.com/JS-PACKAGE/WebChatMCP.js) | [`a9b5f77874cdb4de669c89a3b7d7fd76d2cd8a44`](https://github.com/JS-PACKAGE/WebChatMCP.js/commit/a9b5f77874cdb4de669c89a3b7d7fd76d2cd8a44) | [Apache-2.0](https://github.com/JS-PACKAGE/WebChatMCP.js/blob/a9b5f77874cdb4de669c89a3b7d7fd76d2cd8a44/LICENSE) |
| `gemini-voice-lab` | Nico | `author` | [Rumi-3653/gemini-voice-lab](https://github.com/Rumi-3653/gemini-voice-lab) | [`c8f6933127ca1d6ba65d0ce47075cfab4b5a0285`](https://github.com/Rumi-3653/gemini-voice-lab/commit/c8f6933127ca1d6ba65d0ce47075cfab4b5a0285) | [MIT](https://github.com/Rumi-3653/gemini-voice-lab/blob/c8f6933127ca1d6ba65d0ce47075cfab4b5a0285/LICENSE) |
| `story-bible` | Nico | `author` | [Rumi-3653/story-bible](https://github.com/Rumi-3653/story-bible) | [`d0fa28c9a2bf7f26eaf8f01a8b03c2f4508a9ef5`](https://github.com/Rumi-3653/story-bible/commit/d0fa28c9a2bf7f26eaf8f01a8b03c2f4508a9ef5) | [MIT](https://github.com/Rumi-3653/story-bible/blob/d0fa28c9a2bf7f26eaf8f01a8b03c2f4508a9ef5/LICENSE) |
| `human-mode` | 啪哩啪啦 | `curator` | [madeofroc-arch/AI-Detox-Center](https://github.com/madeofroc-arch/AI-Detox-Center) | [`b2f5bc19f2f22b18285dfe360a5d77acbda63ca1`](https://github.com/madeofroc-arch/AI-Detox-Center/commit/b2f5bc19f2f22b18285dfe360a5d77acbda63ca1) | [MIT](https://github.com/madeofroc-arch/AI-Detox-Center/blob/b2f5bc19f2f22b18285dfe360a5d77acbda63ca1/LICENSE) |

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

- **HRFlow：開源人資管理系統**：這是需自行架設的 Apache-2.0 人資系統。核心需 .NET 10 與隔離 SQL Server；SQL 整合測試限 Windows、SQL Express 與整合驗證。這份獨立快照不是舊系統的升級路徑。補休到期僅存 metadata，尚無自動到期或轉薪。LINE bridge、外部出勤排程預設關閉，另需設定；不含 LINE 出勤報表匯入。台灣薪資、保險與日曆規則須自行核對，SQL Server、依賴套件與政府行事曆另有條款，見 NOTICE。工坊未架設或測試上游。
- **hdsljp-api：日文人類圖命盤計算 API**：這是計算 API，需自行架設，沒有現成命盤網站。AGPL-3.0；本書只描述並連結，不複製程式碼。網路提供服務及修改版的對應原始碼義務須依 LICENSE 核對；Swiss Ephemeris 另有 AGPL／專業授權雙軌。必要的 .se1 星曆資料不附在 repo。需 Python 3.10 以上，原作建議 Linux。出生資料需本人同意；命盤不作健康或任職能力判定。工坊未執行 API，也未驗證計算準確度。
- **usage：macOS 選單列 Claude／Codex 用量**：限 macOS。ken-kk 自述為維護者；此版修改自 lollapalooza 的 aqua5230/usage，原始歸屬見 NOTICE.md。AGPL-3.0-only，散布與網路提供修改版時須核對授權義務；本書不複製程式碼。安裝包未簽章，會新增每分鐘更新的 LaunchAgent。本機日誌推算值與概算成本不是官方帳單；README 表示不呼叫 Anthropic／OpenAI API、不讀 Keychain。工坊未安裝，也未讀取個人日誌。
- **照片白邊移除工具**：MIT。瀏覽器版免安裝；README 說明圖片在瀏覽器內處理、不上傳，工坊未實測傳輸或裁切品質。指定資料夾自動保存需 macOS 與 Node.js 的本機服務。輸入限 PNG／JPEG／WebP，輸出 PNG；1–3 倍放大及 DPI 設定不會憑空補回細節。白色主體可能和外框難區分，請保留原檔、逐張看邊緣。
- **ga4-lp-analytics：GA4 著陸頁跳出分析**：MIT 模板，需自行接上網站。手填診斷可先用合成數字；自動取數需 GA4 property、GCP 服務帳號與 PHP 同源 proxy。事件仍送到 Google GA4，沒有錄影不代表零隱私負擔；page／section／cta 不可夾帶個資，須核對網站告知與 GA4 設定。私鑰放 Web root 外，proxy 與診斷頁需 Basic 認證。API 有配額與並行限制；漏斗是判讀線索，不保證轉換改善。工坊未接真實分析帳號。
- **SNS Feedback Collect：貼文反應收集與調整判讀**：MIT 的貼文後測 Skill，不直接寫文或發文。README 使用 Codex Desktop、Chrome 外掛及登入中的服務，並依賴作者自己的 kiei-dashboard／tracking.test.js；儀表板不在本 repo，無法只下載就完整試用。外掛能力與社群平台規範需自行確認，僅查看本人有權讀取的畫面。契約以 0 留存部分不可見指標，須在 notes 說明缺值，不能當成真實零。工坊未登入、擷取或驗證自動化。
- **ultracode-token-optimization：多代理工作流程省 token 規則**：MIT 文字規則 Skill，沒有執行引擎或 token 硬上限，也沒有固定節省率保證。需自備 Claude Code／Ultracode Workflow 與服務額度。SKILL.md 的 agentType、模型名稱、繼承及 budget 行為依作者特定環境，採用前要逐項對照自己的 runtime；不能直接照抄模型配置。工坊未啟動代理，也未量測節省效果。
- **keynote-pptx-doctor：修復 Keynote 打不開的 pptx**：MIT。可在瀏覽器本機診斷／修復，或用 Python 3 標準庫腳本；也能作為 Claude Code Skill。README 說明不改投影片內容、瀏覽器不傳檔，工坊未驗證傳輸與修復結果。封裝修好不等於版面完整，仍要在目標 Keynote 比對圖片、文字與備註；Quick Look 驗證需 macOS。不是所有損壞都可修復，務必保留原檔。
- **WebChatMCP.js**：Apache-2.0，本機橋接，並非官方 API。需 Node.js 22 以上與 Playwright Chromium；Claude／Grok 需登入，訪客與暫存狀態可能是 unknown，不能保證零保存。提示、歷史及工具結果會送至所選第三方服務，受其條款、額度與費用限制。持久 profile 保存登入；HTTP 無認證，預設只綁 loopback。外掛由 host 按自身權限執行工具，不是沙箱。Codex 等安裝腳本會關閉應用、改設定，服務停用可能影響官方模型連線；Windows 腳本未實機驗證。工坊未安裝或登入。
- **gemini-voice-lab：回合制台灣口語配音**：MIT。離線自檢與 dry-run 不打 API，dry-run 輸出靜音佔位；真實合成需 Gemini API key，文字與聲音樣本會送到 Google。額度、費用與模型能力以自己的專案為準，不保證免費。固定版本仍把 API 造聲免費層、language_code 與共用配額列為未實測。複製聲音只限本人且先取得同意，私人音檔與 ID 不進 Git；台灣腔效果有上限。配樂、音效、混音不在範圍，工坊未合成或試聽。
- **story-bible：角色 × 場景 × 世界觀設定聖經**：MIT。Markdown 卡可手填；check／export 需 Python 3.8 以上，只用標準庫。這是設定管理，不會自行生圖、配音或保證角色一致。export 針對 emotion-shot-pipeline 的角色 JSON，其他下游可能是作者自用或第三方工具，不在 repo。examples/還傘 的視覺鎖句與聲線參數未經平台實測。library 預設不進 Git，仍需自己備份與保護未發表 IP；參考圖與聲音需有使用權。工坊未執行檢查或匯出。
- **Human Mode：五階提示與自主思考**：啪哩啪啦自述為策展者；原作為 madeofroc-arch/AI-Detox-Center，策展不等於原創作者。MIT。固定版本遊戲採預寫題目、本機計算，不需帳號、推論或 API key。遊玩比例只描述該組樣本，不是心理診斷或個人能力評分；題目仍有已知線索風險，單次結果不足以證明改善。提示 Skill 安裝進外部聊天工具後，對話由該服務處理，不能套用遊戲的本機隱私說明。舊 tracker 歷史留存封存；工坊未遊玩或驗證訓練效果。

## 分享介紹

12 個 `modules/community/share-introductions/<id>.json` 各有 100 則相異、8–200 字的繁中文案，句內不放 URL，連結由分享介面附加。本輪逐句核對 1,200 則，移除原本同一組 25 項事實輪換四種固定句尾的結構；每項事實只留一次直述，另寫每本 75 則檔案、情境、設定、核對或回饋切入句。不宣稱已使用或測試。

WebChatMCP.js 與 Human Mode 的會員各有 100 則原文，原先優先考慮沿用。這個工作環境對兩個公開 `/api/v1/skill-submissions/<id>/share-content` GET 都回 HTTP 403（一般 User-Agent 重試亦同，網頁工具也無法讀取），所以**本次兩本皆未重用或改寫會員原句**，改寫的是原作固定版本文件的介紹。沒有讀取私人端點或登入繞過。若維護者可取得原句，可後續比較適用文案；不能聲稱已保留會員原本語氣。

## 圖像

24 張目錄圖已全部以 builtin-imagegen 重新獨立產生，sharp 只做縮放與 WebP 編碼。先從固定 README 寫出用途與圖像隱喻，再逐張檢視全尺寸與約 240px 縮圖；維持炭黑、酸萊姆綠 #c4ff20、鈷藍 #3044ff 與鉻金屬的系列風格。沒有真實人物、品牌標誌、文字／數字、浮水印或假操作截圖；原始 Logo 不變。

- 書封：`apps/portal-web/public/art/skills/<id>.webp`，768×512。
- 功能圖：`apps/portal-web/public/brand/skill-illustrations/<id>.webp`，1200×630，均為三段輸入／處理／結果示意。
- 完整 prompt、來源路徑、attempts、尺寸、bytes、SHA-256 與 source_note：[書封 manifest](../design/skill-book-art-manifest.json)、[功能圖 manifest](../design/skill-illustration-manifest.json)。
- Job dir 總表：`skill-books-polish.covers-new.png`（4×3）、`skill-books-polish.illustrations-new.png`（3×4），順序與來源表一致。
- Human Mode 封面首版多一階、功能圖首版把遊玩紀錄畫成音訊符號，均棄用重畫；兩張各 2 次，其餘各 1 次。未取用既有 community-skills 圖。

| id | 書封隱喻 | 功能圖流程 | 封面／功能圖次數 |
| --- | --- | --- | --- |
| `hrflow` | 員工識別證、空白月曆與打卡鐘 | 員工與班表 → 出勤／請假核准 → 整理後的人資紀錄 | 1／1 |
| `hdsljp-api` | 無字日曆和時鐘接到幾何中心命盤板 | 日曆、時間與地點 → 星曆軌道計算 → 無字幾何命盤與欄位卡 | 1／1 |
| `usage` | 螢幕頂端的兩條用量條與展開的用量面板 | 本機日誌檔 → 用量彙整 → 選單列用量條和概算面板 | 1／1 |
| `photo-border-remover` | 白邊山景照片正被裁切，邊框從外側剝離 | 有白邊照片 → 裁切框 → 無白邊的同張照片 | 1／1 |
| `ga4-lp-analytics` | 長網頁區段旁的逐層縮小漏斗 | 分區著陸頁 → 彙總事件／同源 proxy → 漏斗診斷與待辦卡 | 1／1 |
| `sns-feedback-collect` | 貼文卡上的愛心與對話氣泡，旁接比較長條 | 貼文反應卡 → 本機保存托盤 → 比較長條與調整扳手 | 1／1 |
| `ultracode-token-optimization` | 三個工作站將厚文件縮成短交接卡並交給檢查夾板 | 厚任務卷宗 → 分工與摘要卡交接 → 附證據的核對夾板 | 1／1 |
| `keynote-pptx-doctor` | 破裂的投影片牌被小扳手修復 | 斷開的投影片封裝 → XML／關聯檢查與扳手 → 完整投影片副本 | 1／1 |
| `webchat-mcp` | 本機連接插頭接到有問答氣泡的瀏覽器框 | MCP client 提示卡 → 本機瀏覽器橋 → 網頁聊天回覆，回向 client 的細箭頭 | 1／1 |
| `gemini-voice-lab` | 麥克風、波形與單一調音滑桿 | 無字配音稿 → 單一滑桿與波形 → 耳機試聽與回合紀錄卡 | 1／1 |
| `story-bible` | 三個無字圖示分頁的設定活頁夾：角色棋子、山景、地球 | 角色／場景／世界卡 → 活頁夾正本與檢查 → 下游設定卡 | 1／1 |
| `human-mode` | 選擇籌碼、放大鏡與五階提示階梯 | 四選項先放籌碼 → 放大鏡比較兩份論證 → 五階提示卡與遊玩紀錄 | 2／2 |

## GitHub 連結

2026-10-20 匿名 GET：12 次 `api.github.com/repos/<repo>` metadata，以及 118 次 `github.com`／固定 SHA 的 `raw.githubusercontent.com` GET，全部 HTTP 200。回應、最終網址、時間與 SHA-256 留在 job dir `skill-books-polish.github/`，摘要為 `audit.json`。Fork 的匿名 GET 最終為登入入口，200 只表示入口可到達，未建立 Fork／Star／Follow。

原作、Fork、Star／metrics 均沿用各書的 upstream repo。介紹視窗與公開 HTML 的「來源 GitHub 帳號」連到 repo owner，明示「Repo 擁有者帳號，不代表會員身分已核實」。封面模組提供共用帳號元件；既有 GitHub social 的 Follow 已連到同一帳號。

12 本皆 `has_issues=true`、`has_discussions=false`，回饋目標保持 `/issues`，不新增無需使用的 override；單元測試精確核對所有目標。之後若停用 Issues，需重新核對並另改目標。網站只收錄 https 的作品宣告；外部網站存活與內容未驗證（本輪僅允許 GitHub／raw／repo metadata GET）。

| id | 原作／owner／Fork／commit GET | reading／所有 evidence（GitHub＋raw） | has_issues／homepage | contribution_url GET | website_url／宣告來源 |
| --- | --- | --- | --- | --- | --- |
| `hrflow` | [原作](https://github.com/tesdano-crypto/HRSystem-OpenSource)／[帳號](https://github.com/tesdano-crypto)／[Fork](https://github.com/tesdano-crypto/HRSystem-OpenSource/fork)／[commit](https://github.com/tesdano-crypto/HRSystem-OpenSource/commit/a60cd7b14d25b5a8ab90574247e48a4b4038b11c) 均 200 | `README.md`、`LICENSE`、`NOTICE` 均 200 | true／空白 | [Issues](https://github.com/tesdano-crypto/HRSystem-OpenSource/issues) 200 | 空白（metadata／README 無作品網站宣告） |
| `hdsljp-api` | [原作](https://github.com/kieiken/hdsljp-api)／[帳號](https://github.com/kieiken)／[Fork](https://github.com/kieiken/hdsljp-api/fork)／[commit](https://github.com/kieiken/hdsljp-api/commit/a3fc3b4ff2a3acf0df541da1b83a3688e0be8a19) 均 200 | `README.md`、`LICENSE` 均 200 | true／空白 | [Issues](https://github.com/kieiken/hdsljp-api/issues) 200 | 空白（metadata／README 無作品網站宣告） |
| `usage` | [原作](https://github.com/kieiken/usage)／[帳號](https://github.com/kieiken)／[Fork](https://github.com/kieiken/usage/fork)／[commit](https://github.com/kieiken/usage/commit/e6298d1af0e2127b587b2ff609942896635bdd66) 均 200 | `README.md`、`LICENSE`、`NOTICE.md` 均 200 | true／空白 | [Issues](https://github.com/kieiken/usage/issues) 200 | 空白（metadata／README 無作品網站宣告） |
| `photo-border-remover` | [原作](https://github.com/kieiken/photo-border-remover)／[帳號](https://github.com/kieiken)／[Fork](https://github.com/kieiken/photo-border-remover/fork)／[commit](https://github.com/kieiken/photo-border-remover/commit/92df7927148ce6bab202114393365c8bc9e652d1) 均 200 | `README.md`、`LICENSE` 均 200 | true／空白 | [Issues](https://github.com/kieiken/photo-border-remover/issues) 200 | `https://kieiken.github.io/photo-border-remover/`（固定 README） |
| `ga4-lp-analytics` | [原作](https://github.com/kieiken/ga4-lp-analytics)／[帳號](https://github.com/kieiken)／[Fork](https://github.com/kieiken/ga4-lp-analytics/fork)／[commit](https://github.com/kieiken/ga4-lp-analytics/commit/2c2b18d564a6bd6de24cd1057bed197af1b97c32) 均 200 | `README.md`、`LICENSE` 均 200 | true／空白 | [Issues](https://github.com/kieiken/ga4-lp-analytics/issues) 200 | 空白（metadata／README 無作品網站宣告） |
| `sns-feedback-collect` | [原作](https://github.com/kieiken/sns-feedback-collect)／[帳號](https://github.com/kieiken)／[Fork](https://github.com/kieiken/sns-feedback-collect/fork)／[commit](https://github.com/kieiken/sns-feedback-collect/commit/6d9578f2773a645ac4fea9ed322e0144254202a3) 均 200 | `README.md`、`LICENSE`、`references/dashboard-contract.md`、`references/hao-evaluation.md` 均 200 | true／空白 | [Issues](https://github.com/kieiken/sns-feedback-collect/issues) 200 | 空白（metadata／README 無作品網站宣告） |
| `ultracode-token-optimization` | [原作](https://github.com/kieiken/ultracode-token-optimization)／[帳號](https://github.com/kieiken)／[Fork](https://github.com/kieiken/ultracode-token-optimization/fork)／[commit](https://github.com/kieiken/ultracode-token-optimization/commit/aa7b2bd43da2364602554e954deeecc02e903b7e) 均 200 | `README.md`、`LICENSE` 均 200 | true／空白 | [Issues](https://github.com/kieiken/ultracode-token-optimization/issues) 200 | 空白（metadata／README 無作品網站宣告） |
| `keynote-pptx-doctor` | [原作](https://github.com/kieiken/keynote-pptx-doctor)／[帳號](https://github.com/kieiken)／[Fork](https://github.com/kieiken/keynote-pptx-doctor/fork)／[commit](https://github.com/kieiken/keynote-pptx-doctor/commit/b7d2a1299f2776e481681d8fa326095cae5053f6) 均 200 | `README.md`、`LICENSE` 均 200 | true／空白 | [Issues](https://github.com/kieiken/keynote-pptx-doctor/issues) 200 | `https://kieiken.github.io/keynote-pptx-doctor/`（固定 README） |
| `webchat-mcp` | [原作](https://github.com/JS-PACKAGE/WebChatMCP.js)／[帳號](https://github.com/JS-PACKAGE)／[Fork](https://github.com/JS-PACKAGE/WebChatMCP.js/fork)／[commit](https://github.com/JS-PACKAGE/WebChatMCP.js/commit/a9b5f77874cdb4de669c89a3b7d7fd76d2cd8a44) 均 200 | `README.md`、`LICENSE` 均 200 | true／`https://webchatmcp.js-package.xyz` | [Issues](https://github.com/JS-PACKAGE/WebChatMCP.js/issues) 200 | `https://webchatmcp.js-package.xyz`（固定 README＋metadata homepage） |
| `gemini-voice-lab` | [原作](https://github.com/Rumi-3653/gemini-voice-lab)／[帳號](https://github.com/Rumi-3653)／[Fork](https://github.com/Rumi-3653/gemini-voice-lab/fork)／[commit](https://github.com/Rumi-3653/gemini-voice-lab/commit/c8f6933127ca1d6ba65d0ce47075cfab4b5a0285) 均 200 | `README.md`、`LICENSE` 均 200 | true／空白 | [Issues](https://github.com/Rumi-3653/gemini-voice-lab/issues) 200 | 空白（metadata／README 無作品網站宣告） |
| `story-bible` | [原作](https://github.com/Rumi-3653/story-bible)／[帳號](https://github.com/Rumi-3653)／[Fork](https://github.com/Rumi-3653/story-bible/fork)／[commit](https://github.com/Rumi-3653/story-bible/commit/d0fa28c9a2bf7f26eaf8f01a8b03c2f4508a9ef5) 均 200 | `README.md`、`LICENSE` 均 200 | true／空白 | [Issues](https://github.com/Rumi-3653/story-bible/issues) 200 | 空白（metadata／README 無作品網站宣告） |
| `human-mode` | [原作](https://github.com/madeofroc-arch/AI-Detox-Center)／[帳號](https://github.com/madeofroc-arch)／[Fork](https://github.com/madeofroc-arch/AI-Detox-Center/fork)／[commit](https://github.com/madeofroc-arch/AI-Detox-Center/commit/b2f5bc19f2f22b18285dfe360a5d77acbda63ca1) 均 200 | `README.md`、`LICENSE`、`skill/README.md` 均 200 | true／空白 | [Issues](https://github.com/madeofroc-arch/AI-Detox-Center/issues) 200 | 空白（metadata／README 無作品網站宣告） |

`trackedGitHubRepositories` 與 `catalogMetricTargets` 均從目錄導出；新增 fake pool 單元測試證明 12 個 repo 都納入，沒有查資料庫或呼叫同步。`bookOrThrow` 直接查目錄、`AuthorClaimPanel` 接受 book id，沒有另一份 allowlist；fake pool 測試證明 owner 已連結時可讀每本認領入口。提交仍依既有 GitHub 連結、聲明、來源觀察與人工審查流程；未新增或核實 claim，未實跑認領寫入。

## 上架

新增 `migrations/179_member_shared_skill_books.sql`，只 INSERT 12 筆 `skill_publications` 並使用 `ON CONFLICT DO NOTHING`，保留既有上架時間；不寫入 `member_skill_book_grants`、`development_grants` 或會員資料。`deploy/cloudflare/environments.json` 的 `migrations.last` 為 179，migration plan 與 release compatibility 的已知 ledger／測試同步新增，既有 migration 未改。

#937 先合併占用 173–177，本批次把 #768 改為 178、#919 改為 179。這次未執行 migration 或宣稱已上線。

## 驗證入口與證據界線

- `npm run typecheck`；前端修改後 `npm run build`。
- 不需 PostgreSQL：`tests/runtime/member-shared-skill-books.test.ts`（固定 pins、角色、無公會指定、SQL 排除參數、24 張精確規格與 manifest 雜湊）、`skill-book-guides.test.ts`、`skill-book-upstreams.test.ts`、`skill-collaboration.test.ts`、`development-map.test.ts`、`skill-share-content.test.ts`、`skill-sharing.test.ts`。
- 本機 migration／release 規劃：`node --test deploy/cloudflare/test/migration-plan.test.mjs deploy/cloudflare/test/release-compatibility.test.mjs`，不接資料庫、不授部署權。
- 需 PostgreSQL，這次 `not_run`：`member-skill-registration.test.ts` 新增 179 的上架／重播／無 grant 變更檢查；`skill-submission-upgrades.test.ts` 新增全部 12 repo 加 WebChatMCP 第二筆、可見對照投稿與直接閱讀的真正 SQL 回歸。任務不允許啟動 PostgreSQL／Docker。
- 需瀏覽器與隔離資料庫，這次 `not_run`：`tests/e2e/skill-book-library.spec.ts`、`audit-skills.spec.ts`。書架期望為 29 本公會技能書與 24 本社群技能書。
- `scripts/verify-public.mjs` 同步 53 本／59 個 repo 的精確期望；這次未執行公開部署驗收。
- 前輪實跑結果在 job dir `skill-books.report.md`；本輪精修、實跑與未驗項另記 `skill-books-polish.report.md`，不把本機測試當成可信 CI／正式部署證據。context 的 `surface_unmapped` blocker 也保留，不為本次擴大修改治理 descriptors。
- 本輪完成後重跑 `node scripts/freedom.mjs prepare --base-ref cf7e518b129786fb4c8a23d587982a7df06c25bb --paths <changed paths>` 與 `git diff --check`。
