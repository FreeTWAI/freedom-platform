# 工作包、批次、依賴與決策

整體進度追蹤沿用 [#234](https://github.com/FreeTWAI/freedom-platform/issues/234)，這裡只記錄工作怎麼切、誰改哪些檔案、彼此依賴與待決事項，不另開進度系統。

## 2026-10-20：結構化供貨條件

本機候選補上選填建議售價、最低訂量與交期，讓供應商在兩個供貨條件編輯器填寫一次，店主在供貨目錄卡片與共用供貨方案頁讀取同一個已公開版本。建議售價沿 offer 幣別；最低訂量以件計，交期 0 代表收到訂單當天出貨。空白清除為 null，未修改欄位省略保留。舊 offer 的未填欄位不加入快照，以保留原 digest、重複公開的版本與歷史選品讀取。

這關閉 SC-05／SC-12「結構化建議售價、最低訂量、交期」的輸入及呈現缺口。三欄只作資訊：不執行最低訂量或交期，不設價格門檻，不做售價排序／篩選，也不在供應商審核頁增加建議售價比較（ADR-027）。店主可自行定價；「填入建議售價」只填欄位、不送出。沒有代出貨同意、供貨商品結帳或選用前照片，買家公開頁與收據不提供這三欄。

本批只有一份 additive nullable migration（本分支暫用 173；工具要求連號，整合時與 #919 對帳重編），沒有 backfill、default、旗標變更、部署或真人試用。實跑命令、結果及未驗部分見交付報告，仍待整合者獨立複驗；不改歷史 handoff 或原 requirement 的 accepted 狀態。

## 2026-10-20：供貨方案頁

本機候選補上 SC-12 的單一供貨方案頁、供貨目錄搜尋、與供應商共用的已保存／公開版本預覽，以及不同意／撤回原因。商品、完整條件、逐件成本、責任分工、確切版本同意與目前展示／預留／結帳路徑放在同一頁；原申請、改價及停止採用命令與收據沿用。這關閉店主只能從小卡片拼湊供貨條件的呈現缺口，不代表真人已能獨立完成決策。

不新增代出貨同意；供貨商品仍不能結帳購買。未公開供應商的完整預留資格缺少可供賣家安全讀取的投影時回 `unknown`，沒有跨 tenant 讀取或猜測。結構化建議售價、最低訂量、交期及選用前照片仍待後續工作。批發買入並自行持有後，才可作為自己的庫存商品使用收款／面交設定。

本批沒有 migration、旗標變更、部署、provider 呼叫或真人試用；也不改原部署收據、Foundation requirement 的 accepted 狀態與 R1 未驗項。驗證範圍與實跑結果以本批交付報告為準，由整合者獨立複驗。

## 2026-10-17：交付與啟用接點

本節按 #886 合併後的 `main@1ab95391` 與作者具日期的紀錄安排接續工作；下方批次／決策表保留原歷史狀態。
[#862](https://github.com/FreeTWAI/freedom-platform/pull/862) 的 S3 與 [#864](https://github.com/FreeTWAI/freedom-platform/pull/864) 的 D-11 已隨 `855bdfff`／schema172 完成兩環境發布，見 [2026-10-17 23:26:50 UTC 完成收據的公開對帳](https://github.com/FreeTWAI/freedom-platform/issues/234#issuecomment-6243446592)。
Supplier console、素材 media/uploads 與合作照片在 staging ON、production OFF；Commerce console／checkout／email 兩環境都 OFF。Staging 合成帳號 core、S3／D-11、ON→OFF→ON 通過；production 僅 health／protocol／Supplier-OFF，沒有建立業務帳號或 session。
四組前後備份均完成遠端讀回、DB＋物件實際還原與清理；schema172 日常程式已安裝、timers 已恢復。自然排程尚未觀察，production service 歷史 exit-code 失敗及其他原失敗保留。
[16:42 UTC 的 `d39370a1`／schema171 收據](../unified-foundation/rollout-commerce-buyer-2026-10-17.json)保留為歷史；855發布工作已完成。#886 賣家離線 UI 不在855部署內，#890 後續修正尚未合併；兩者不借用855收據宣告新候選驗收或真人試用完成。

- **下一步與 owner：** `teddashh` 沿 #862／#864 原供貨線交付 #890 素材操作確認與未知後撤權恢復等有限修正；root release owner 從實際合併來源固定新候選，依既有 [WP-07](WP-07-release-evidence.md) 完成其適用的備份／還原、部署與 staging 真 API／R2 驗收，對帳該候選素材 policy／容量與旗標。855／schema172 發布及其原雲端驗收已完成，不重新設為待辦。Production Supplier 受控啟用與 R1 真人試用仍沿原工作包；D-13 維持原 host 開關，不另造逐事業灰度。
- **D-11 的驗收語意與操作確認：** 選用時複製成賣家 Asset 並計入賣家容量，選用與發布都驗目前權限。撤權後保留既有公開快照，失效合作照片在下一次發布移除；不能要求既有公開快照立刻 404。賣家選用確認已說明此語意；`teddashh` 沿 #864 的本機候選已在供應商 [Material.tsx](../../../../modules/agent-commerce/supplier-console/ui/pages/Material.tsx) 補齊撤銷授權、撤回素材與改回 `partners` 的說明及可取消確認：「既有已發布照片保留，店家重新發布後才移除失效來源」。[SC-E2E-60／62／65](../../../../tests/e2e/supplier-console-materials.spec.ts) 已驗三種取消零寫入、原版本送出、遺失回覆後同命令重試，以及 390／768／1440 確認視窗；既有 [DP-04](../../../../tests/runtime/distribution-photos.test.ts) 的撤銷／撤回／`partners` 三案亦通過。本機合成驗證不代表已審查、合併、部署或真人試用；後續沿 [detna 既有啟用清單](https://github.com/FreeTWAI/freedom-platform/issues/234#issuecomment-6240724810) 與原 release owner 接續。關旗標後私人合作照片路徑 404、已存預覽可開但照片可能不可讀；賣家自有照片與已發布快照仍可讀，回退 reader 必須保留 schema172 的資料能力。
- **#888 未知後拒絕的原命令恢復：** [#890](https://github.com/FreeTWAI/freedom-platform/pull/890) 的產品修正來源 `df013ee8a` 已包含 [#888](https://github.com/FreeTWAI/freedom-platform/issues/888) 的 [controller 修正](../../../../modules/agent-commerce/supplier-console/state/useSupplierConsoleController.ts)：曾有未知結果的命令再遇 403／404 時保留原 method／path／body／key／If-Match，成功重新讀取 profile 也不結案；權限恢復後只重播原命令，從未未知的明確拒絕維持原處理。[SC-E2E-36](../../../../tests/e2e/supplier-console-recovery.spec.ts) 的已提交／未送達 × 403／404 四案與既有回歸已在本機通過，規格沿 [SC-SPEC-02](SC-SPEC-02-shell-session-recovery.md)／[SC-SPEC-05](SC-SPEC-05-tests-ci-guild-dev.md) 同步。`cf458f84` 的 [原 CI](https://github.com/FreeTWAI/freedom-platform/actions/runs/39083411024) 保留 SC-E2E-73 漏按新增 `partners` 確認的失敗；`df013ee8a` 僅補測試 helper 的確認步驟與說明斷言，完整 [照片 browser 檔](../../../../tests/e2e/hosted-store-photo.spec.ts) 在本機專用 fixture 25／25 通過，沒有移除既有公開快照／重新發布斷言。這份產品與 #889 啟用交接文件的整合候選尚未合併或部署，須以新精確 head 重新完成 review／完整 CI；舊來源核准或本機結果不能代替。`teddashh` 與 root release owner 沿原供貨線完成後續，不以本機結果宣告 R1 真人試用完成。
- **真正完成 R1：** Ted 依 [SC-SPEC-06 §5～7](SC-SPEC-06-release-rollback-pilot.md) 安排兩位供應商、兩位賣家與兩位非核心公會作者的原定試用；必要操作不能由 DB／API 代做，舊頁退場仍守原條件。CI／合成雙帳號通過只提供相應證據，不補造真人採用。
- **Commerce 接點：** [五項交付順序](../commerce/work-plan.md#2026-10-17交付與啟用順序)保留 C1 商品工作與 C2／C3 原承諾。`teddashh` 的 [#884 自有庫存商品離線設定、收款確認與面交 UI](https://github.com/FreeTWAI/freedom-platform/issues/884) 已隨 [#886](https://github.com/FreeTWAI/freedom-platform/pull/886)（`699cae20` → `main@1ab95391`）通過獨立 review、完整 CI 並合併；原本機雙帳號真 API／UI 證據保留，該新來源尚未包含在855部署，部署與真人試用仍待完成，首批不含供應商配送。依既有 [host 旗標判斷](../../../../modules/agent-commerce/operations/runtime-settings.ts)，Commerce console ON 需要 Supplier console ON，兩者均非逐店曝光；Commerce 的 tenant／instance／environment 准入只限制新訂單，不限制這兩個主控台。root／Ted 下一步須在同一份 [Commerce 實際啟用範圍收據](../commerce/work-plan.md#離線試用的實際啟用範圍) 記清這項影響；本次沒有操作 public，也不變更 D-13 或 #884 的完成條件。付款、物流、發票及可攜發行不是 R1 前置；[#882](https://github.com/FreeTWAI/freedom-platform/issues/882) 的 provider 邊界與 [#883](https://github.com/FreeTWAI/freedom-platform/issues/883) 的憑證宣告亦不擋面交或 R1。

這是原工作包的具體交接，沿本次既有整合／發布授權推進；不改歷史收據、未驗項或 Foundation 的 accepted 狀態，也不把其他 Foundation 未驗項增加為本批產品的新前置。

## 1. 工作包與批次

| 工作包 | 本案內容 | 批次 | 直接依賴 |
| --- | --- | --- | --- |
| WP-00 現況與差異 | [WP-00-baseline.md](WP-00-baseline.md)、[sources.md](sources.md)、[refferq-adoption.md](refferq-adoption.md) | — | 無 |
| WP-01 產品設計與 Spec | [pages.md](pages.md)、SC-SPEC-01～06、契約 `contracts/guild-launchpad/v1/supplier-console.ts` | — | WP-00 |
| WP-02 殼層與路由 | 營運中心殼層、路由、controller、離開保護、舊入口 | S1 | WP-01 契約 |
| WP-03 用途查詢與資料 | 五個新讀取、`PATCH supply-profile`、純供貨照片、旗標 | S1；S2 補查詢 | WP-01 契約 |
| WP-04 供貨旅程整合 | 各頁接上真 API，J01～J04、J06 在新版走通 | S1 | WP-02、WP-03 |
| WP-05 素材與管理完整度 | 合作素材、營運報表、CSV | S3 | WP-02、WP-03、D-05、D-14 |
| WP-06 整合與驗證 | 同一候選的 runtime／E2E／視覺／效能證據 | 每批 | WP-04（S1）、WP-05（S3） |
| WP-07 發布、試用與退場 | staging、正式開啟、試用、舊頁退場 | 每批 | WP-06 |

批次內容：

- **S1 第一條供貨旅程**（本輪實作）：殼層、概覽、商品清單／新增／詳情（含照片）、供貨條件與審核、合作店家清單／詳情、預留、設定與資料。詳見 [first-journey.md](first-journey.md)。
- **S2 補齊查詢**：預留的伺服器篩選與單筆詳情（G-07）、近期變更（G-09）、公會區塊的本人待辦（G-14）。可先接在 S1 分支上開發，S1 合併後開 PR。
- **S3 素材與報表**：SC-09、SC-10（SC-SPEC-04 §4、§5）。D-05、D-14 已核准。報表要連到 S2 的預留篩選，所以 S3 接在 S2 分支上開發，S1、S2 合併後開 PR。D-11（素材進公開店面）不在 S3 這批，見 §5。

## 2. 三條實作線與 S1 分工

每條線只有一個寫入者；Claude（Opus 5.5）負責設計、寫 brief、整合與驗證，不和實作者同時改同一個檔案。

| 線 | S1 job | 執行者 | 內容 |
| --- | --- | --- | --- |
| 用途 API／資料 | A | Codex `gpt-6.1-sol` | 旗標（app、runtime、server、worker、site、E2E fixture 與 E2E server）；`apps/platform-api/src/routes/hosted-supplier-console.ts`（五個讀取與 `PATCH R/supply-profile`），只在新版開啟時掛在 `platform-app.ts` 的 launchpad 區塊內；讀取服務 `modules/agent-commerce/supplier-console/reads.ts`；`updateSupplyProfile`（`supply-catalog.ts`）；從 `publishSupplyOffer` 抽出 `supplyOfferTerms`；descriptor 的 API surface；`tests/runtime/supplier-console.test.ts` 與契約正反例 |
| 用途 API／資料 | B | agy `gemini-4-argon-high` | 純供貨照片：`photoProducts` 的 `retailOnly` 參數、四個呼叫點與 `hosted-store-media.ts`（只在新版開啟時放寬）；`tests/runtime/supplier-console-writes.test.ts` |
| 殼層／體驗 | C | Codex `gpt-6.1-sol` | `modules/agent-commerce/supplier-console/**` 的殼層、頁面、controller 與純狀態模組；`HostedStore.tsx` 路由與關閉時的舊頁回退；`App.tsx` 的 h1 與離開檢查；頁面工具登錄；`tests/runtime/supplier-console-state.test.ts` |
| 旅程／素材 | D1 | agy `gemini-4-argon` | `tests/e2e/supplier-console.spec.ts`：旅程 1～15 連續一條、舊書籤、新版關閉時回退 |
| 旅程／素材 | D2 | agy `gemini-3.8-flash` | `tests/e2e/supplier-console-cooperation.spec.ts`：步驟 8～11 的分支（改價、改條件、不同意／撤回、同名店、唯讀成員） |
| 旅程／素材 | D3 | Codex `gpt-6.1-sol` | `tests/e2e/supplier-console-recovery.spec.ts`：J06；照片 pass 的純供貨案例 |
| 旅程／素材 | D4 | Codex `gpt-6.1-sol` | `tests/e2e/supplier-console-navigation.spec.ts`：事業切換時晚到的讀取（AT-03）、200 件商品的清單與返回位置（AT-09、10、30）、鍵盤與焦點（AT-41） |
| 旅程／素材 | D5 | agy `gemini-3.8-flash` | `tests/e2e/supplier-console-visual.spec.ts`：五種寬度與五種外觀的視覺驗收（AT-40） |

A、B、C 平行（各自的 worktree、拋棄式資料庫與 E2E port），以已提交的契約為共同邊界；D1～D3 在 A＋B＋C 整合後平行開始，各寫一支 spec；D4、D5 是整合後補上的瀏覽器缺口，同樣各寫一支。agy 的輸出（B、D1、D2、D5）只當草稿：Claude 逐項對照程式與測試後才整合。

實際分工的調整：原排給 B 的 `PATCH supply-profile` 改由 A 放在新路由檔與 `supply-catalog.ts`，`store.ts` 與 `hosted-store.ts` 都不必修改；契約與 `generate-contracts.ts` 已隨 WP-01 提交。

## 3. 共用檔案

擁有者以各 `freedom.module.json` 的 `owned_paths` 解析（`packages/contribution-tools/context.mjs` 的 `owns`）。

| 檔案 | Descriptor 擁有者 | Job | 改動 |
| --- | --- | --- | --- |
| `apps/platform-api/src/app.ts`、`runtime.ts`、`server.ts`、`worker.ts` | application-composition、work | A | `supplierConsoleEnabled` 選項與環境變數 |
| `apps/platform-api/src/platform-app.ts` | work | A | `site` 欄位；在 launchpad 區塊內依旗標掛新路由 |
| `apps/portal-web/src/modules/Community.tsx` | community | A | `SiteConfig` 加 `supplier_console_enabled` |
| `tests/e2e/member-feature-fixture.ts`、`scripts/e2e-server.ts` | e2e-harness | A | `Features` 與 E2E server 加旗標 |
| `modules/guild-workspace/generate-contracts.ts` | guild-workspace | WP-01 | 新 bundle（隨契約提交） |
| `tests/runtime/guild-launchpad-contracts.test.ts` | guild-workspace | A | 新 schema 正反例 |
| `modules/agent-commerce/hosted/distribution.ts` | agent-commerce、hosted-distribution | A | 抽出 `supplyOfferTerms` |
| `modules/agent-commerce/hosted/supply-catalog.ts` | agent-commerce | A | `updateSupplyProfile` |
| `modules/agent-commerce/hosted/photo-{projection,read,commands}.ts`、`publish.ts`、`apps/platform-api/src/routes/hosted-store-media.ts` | agent-commerce | B | `retailOnly`（新版開啟時才放寬） |
| `tests/helpers/hosted-store-photo.ts` | agent-commerce | B | 測試 app 可帶 runtime 選項 |
| `apps/portal-web/src/modules/HostedStore.tsx` | agent-commerce | C | 路由與回退 |
| `apps/portal-web/src/App.tsx` | application-composition、work | C | h1、頁面工具的 `pageId`、離開檢查帶目的地 |
| `apps/portal-web/src/Navigation.tsx` | application-composition | C | 營運中心子頁仍標示供貨商品庫 |
| `apps/portal-web/src/interface-messages.ts`、`page-help.ts` | application-composition | C | 頁名（五種語言）與 `supplier-console` 說明 |
| `apps/portal-web/src/modules/newcomer-guides/page-support.ts`、`ai-sister-pages.ts` | newcomer-guides | C | `supplier-console` 登錄為停用（同 `stores`） |
| `apps/portal-web/src/modules/HostedStorePhoto.tsx` | agent-commerce | C | `product` 參數只取 ID、名稱與版本 |
| `modules/agent-commerce/hosted-ui/ConsoleShell.{tsx,css}`（新檔） | agent-commerce | Claude | 營運中心與賣家後台共用的側欄殼層 |
| `modules/development/pages.ts` | development | C | `supplier-console` 頁面 |
| `tests/e2e/hosted-store-photo.spec.ts` | agent-commerce | D3 | 純供貨照片案例 |
| `docs/platform-plan/execution/spec-index.md` | 無 | Claude | 一行索引 |

新檔案全部列入 `supplier-console` descriptor（SC-SPEC-05 §5），避免成為 `selectImpact` 的未知路徑。

## 4. 依賴順序

```
WP-00 → WP-01（含契約）─┬→ A ─┐
                        ├→ B ─┼→ Claude 整合 → D1～D5 → WP-06（S1 證據）→ Ted 決定 PR／合併 → WP-07
                        └→ C ─┘
S1 合併 → S2 → S3（D-05、D-14 已核准）
S3 → D-11 素材進公開店面（先通知 Commerce）
```

只有一件事會擋路：合併、部署、開旗標與試用都等 Ted（開 PR 已依 D-12 核准）。S2、S3 可以先接在前一批的分支上開發，前一批合併後再各自開 PR。其餘依上圖往下做。

## 5. 決策

「採用」表示依建議直接進行（屬工程預設，沒有改變產品承諾）；「需 Ted」表示會影響成本、對外行為或權限，要 Ted 決定；「Ted 核准」表示 Ted 已同意建議。

| 編號 | 決策 | 建議 | 狀態 | 只影響 |
| --- | --- | --- | --- | --- |
| D-01 | 路由放哪裡 | `#stores/<t>/<i>/supply/...`，不新增全站分頁 | 採用 | WP-02 |
| D-02 | 新版開關 | `FREEDOM_SUPPLIER_CONSOLE_ENABLED`，預設關，需 launchpad 同時開 | 採用 | WP-02、03、06、07 |
| D-03 | 程式位置 | `modules/agent-commerce/supplier-console/`＋nested descriptor `supplier-console` | 採用 | WP-02、03 |
| D-04 | 合作店家用什麼 ID | 賣家店面 shop ID（`commerce_selections.shop_id`），不用名稱或 tenant | 採用 | WP-03 |
| D-05 | 素材用哪種媒體用途 | 新用途 `storefront.supply-material`，只收靜態圖片並沿用商品照片處理器；文案存文字；PDF／SVG 不收；影片見 D-14 | Ted 核准（2026-10-15） | WP-05 |
| D-06 | 草稿存哪裡 | 只在記憶體；未確認操作在同一會員重新登入後恢復，不跨重新整理 | 採用 | WP-02 |
| D-07 | 事業資料的修改範圍 | 只限純供貨事業；已開零售的在商店資料頁修改 | 採用 | WP-03、05 |
| D-08 | 純供貨商品照片的讀取權限 | 與零售商品照片相同（`store:read`，只回 ID、版本與照片 metadata） | 採用 | WP-03、04 |
| D-09 | 離開檢查 | App 的檢查接收目的地 hash，營運中心內換頁不打斷 | 採用 | WP-02 |
| D-10 | 頁面工具與新手引導 | 頁面工具用 `supplier-console`；引導沿用 `stores` 的停用 | 採用 | WP-02 |
| D-11 | 合作店家如何在公開店面使用素材 | 選「用於公開店面」時複製成賣家 tenant 的 Asset（佔賣家容量）；發布只引用複本 | Ted 已核准 D-11（2026-10-15）；本機 job-d11 候選，未合併／未部署；選用時複製的時機 Ted 已確認（2026-10-16）；瀏覽器 SC-E2E-72～77、82～84（82、83 為合成 HTTP 投影，84 與 76 為資料庫複本；本機；SC-E2E-78 屬於 S3，79～81 留給 S3） | WP-05 |
| D-12 | PR 怎麼包 | 文件＋S1 一支 PR，一次完整 CI、同一候選的證據 | Ted 核准（2026-10-15） | WP-06、07 |
| D-13 | 正式環境怎麼開 | 沿用 host 設定一次開，不做逐事業灰度 | Ted 核准（2026-10-15） | WP-07 |
| D-14 | 素材影片 | 供應商自己壓縮後上傳：MP4 或 WebM，最多 20 MiB；平台只檢查格式與大小，不轉檔，也不在瀏覽器壓縮。另立用途 `storefront.supply-material-video`，存放與播放沿用活動影片。Cloudflare Media Transformations 是之後要由平台產生縮圖或較小版本時的做法（SC-SPEC-04 §4） | Ted 核准（2026-10-15） | WP-05 |

計畫 16.2 已列的預設（沿用品牌與 token、對外名稱「供應商營運中心」、商品容量 200、供貨價可見範圍沿用現有角色、素材預設只給明確授權的合作方、撤回後禁止新取用但保留歷史、R2 交易責任另定）全部照建議採用，不影響本輪工作。

## 6. 成本與資源

- 不新增付費服務、第二套資料庫、常駐服務或追蹤 SaaS。
- 每個候選一次完整 CI；本機驗證用拋棄式 PostgreSQL（`postgres:18-alpine`），資料放磁碟 volume 並設 `dynamic_shared_memory_type=mmap`，不碰開發資料庫 54339。
- 測試暫存依 Ted 2026-10-09 的規則放磁碟：資料庫、SQLite、pytest 與 Git scratch 都不用 `/dev/shm` 或任何 tmpfs；pytest 用 `pytest-disktmp uv run pytest -q ...`，其他暫存用 `~/agent-work/tmp/` 下的唯一目錄；結束時清掉自己建立的 container、volume 與暫存目錄。做法見 [Runtime CI PostgreSQL storage and cleanup](../../../development/runtime-ci-postgres.md)。
- 各 job 的實際投入與返工原因記在 [sources.md](sources.md) 的方法表。

## 2026-10-20：選用前商品照片

此輪補上選用前評估照片：供應商逐份方案明確分享目前商品照片、換圖或停止；同社群、原本可讀這份方案的店主在方案頁看得到，供應商預覽同一張圖。照片與供貨條件摘要及同意版本分開，操作不產生新供貨版本、不改選品、同意、庫存、預留或結帳。重發新版本在同一交易沿用分享決定與目前照片，沒有照片時略過。

新增 `FREEDOM_SUPPLY_OFFER_PHOTOS_ENABLED` 預設關閉，所有真實環境維持關閉；本輪沒有部署、開旗標、修改 secrets 或真人試用。新路由只在 launchpad、supplier console、此旗標與商品照片讀取均安裝後掛載；不需要素材媒體或上傳開關。Migration `174_supply_offer_photos.sql` 是合併前暫定編號，整合時須同步所有名稱及 schema 下限。

尚未涵蓋：代出貨同意、供貨商品結帳。商品卡縮圖由下方同日增量承接。店主若要在自己的店面使用供應商照片，仍需 D-11 的另外素材授權與複本；評估照片不授予此權利。分享歷史在方案存續期間釘住供應商資產，停止提供不刪除、不釋放配額。商品照片 GC 目前仍未安裝，將來啟用前必須把新表納入引用計數與保留政策。自動測試與合成瀏覽器驗證的實跑結果記於交付報告，不作已部署或真人驗收證明。

## 2026-10-20：供貨清單縮圖

本機候選在同一個預設關閉的 `FREEDOM_SUPPLY_OFFER_PHOTOS_ENABLED` 後補上「選用其他商店的商品」與「我的選品」縮圖，顯示供應商已明確分享、同一位店主已可在供貨方案頁讀取的評估照片。沒有新增讀者或同意，照片仍不屬於供貨條件與 `terms_sha256`。撤回、換版、停止分享後，更新供貨狀態就移除縮圖；供應商自己的「我的供貨」不變。

新增一條獨立、嚴格且受同一安裝判斷限制的 `supply-catalog-photos` GET，沿用供貨目錄相同的排序、100 筆視窗及截斷，批次讀最新分享；既有四種讀取 schema／回應保持原狀。前端不因照片失敗清空或阻擋清單，舊 API 的 404 安靜略過，其他失敗由原更新動作重試。無照片或單張失敗不放佔位圖；96px 中性方框保持比例、不裁切，平板／桌面並排，手機可在標題上方。原評估照片最多 1920px，沒有另外生成較小縮圖。

代出貨同意、供貨商品結帳與 D-11 店面使用授權仍保留原界線。這個增量沒有 migration、SQL 物件變更、相依套件、部署、真實旗標或 secret 變更。SC-E2E-87 留在既有照片 pass 檔案，預設 pass 沿用原供貨旅程；實跑結果與截圖檢視記於交付報告，不宣稱真人採用或線上啟用。

清單照片的 runtime 覆蓋 `CATALOG-PHOTO-01`～`07` 位於
[`hosted-supply-catalog-photos.test.ts`](../../../../tests/runtime/hosted-supply-catalog-photos.test.ts)，
供貨方案照片的 `OFFER-PHOTO-01`～`16` 留在
[`hosted-supply-offer-photos.test.ts`](../../../../tests/runtime/hosted-supply-offer-photos.test.ts)。
兩檔共用一份隔離 harness 與原有 hooks，測試內容與斷言不變（包含 101 筆真實 offer）；
拆檔讓固定的 runtime CI 分區可分別排程，不改分區權重或預算。
