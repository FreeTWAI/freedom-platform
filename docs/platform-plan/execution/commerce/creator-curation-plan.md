# 創作者推薦與社群合作：實作計畫

> 狀態：**提案／planned；實作與驗收均為 `not_run`**。2026-10-21。
> 固定盤點基準：[`main@65589400b8945f49757a5647fbf004e8b71a384f`](https://github.com/FreeTWAI/freedom-platform/tree/65589400b8945f49757a5647fbf004e8b71a384f)。
> 本文件與 [規格](creator-curation-spec.md) 是現有 Commerce 計畫的增量，不替換 EC-SPEC、既有 PR 或正式營運條款。

## 1. 要解決的問題

需求方描述自由工坊已有約一萬人的社群，希望供應商、創作者、開發者與沒有資源的新成員都能找到參與和合作的方式。這是需求背景，並非本次核驗的活躍會員、成交或收入數據。

本輪目標是讓「我能提供什麼／我想找什麼」有清楚入口，並讓創作者可以整理商品、推薦與協助銷售，而不必先成為收款、出貨與售後責任人。成員可以經營自己的社群；平台靠持續有用的工具、機會、可信紀錄與省事的合作流程，讓人願意回來。

現有商店的供貨合作是 **reseller 轉售模式**：店主自行定價，承擔零售、收款、發票與退款責任。新提案是 **referral 推薦模式**：成交仍歸明確的店家，創作者依事先同意的條款取得推薦佣金。因此不能只把「我的選品」「預估差額」改名為「佣金」。

本次先交付 repo 中可審查、可拆 PR 的 plan＋spec。討論用提案網站僅是概念展示，不能用來證明功能已存在、交易可開啟或分潤已成立。

## 2. 閱讀與證據範圍

已針對這次變更閱讀根目錄治理與貢獻規則、Commerce／Supplier Console 規劃、相關模組契約與實作、付款與訂單邊界、商店前端、會員合作與分享流程，以及相關未合併 PR／Issue。這是針對功能的來源盤點，**不宣稱逐檔讀完整個 repository**。

來源層級必須分開：

| 層級 | 本輪可說什麼 | 不能推論什麼 |
| --- | --- | --- |
| 固定 main 原始碼 | 下表所列能力與限制可在該 SHA 找到 | 已啟用、真人走完、供應商已承諾服務 |
| 未合併 PR | 有人正在做；列為接點、避免重複 | 已進 main 或已上線 |
| 已提交的發布收據 | 2026-10-20 07:16 UTC 的收據記錄 staging／production 為 `3a6e2506`、schema 172；Supplier／Commerce console ON，checkout／交易 Email OFF | 這就是 2026-10-21 的即時狀態；本輪沒有重新查正式環境 |
| 這兩份文件 | 可評審的設計與驗收條件 | runtime 測試、真實金流或產品驗收已通過 |

部署依據為 [current-state](../unified-foundation/current-state.json)、[closeout](../unified-foundation/closeout.md) 與 [2026-10-20 發布收據](../unified-foundation/rollout-short-videos-2026-10-20.json)。後續實作者開始前須重新讀取最新 main、進行中的 PR、當時旗標與准入設定，不以本文件覆蓋它們。

### 2.1 可沿用與真正缺口

| 主題 | 固定基準的來源與現況 | 本次增量 |
| --- | --- | --- |
| 商品與供貨 | `modules/agent-commerce/hosted/{products,supply-catalog,supply-terms,distribution}.ts`；沿用商品、版本化 offer、selection 與 acceptance。`distribution.ts` 明定 reseller 的六項責任 | 推薦只引用已允許公開的商品；獨立的推薦方案與創作者接受紀錄，不偽裝成 seller selection |
| 現有選品 UI | `apps/portal-web/src/modules/HostedDistribution.tsx` 要店主填售價、申請供貨並放進自己的店面 | 新增個人推薦清單；不要求開店，不產生創作者售價或第二份庫存 |
| 買家交易 | `checkout/{cart-quote,terms,orders,public-commands,buyer-identity}.ts`、`payments/` 已有交易核心與身分切換保護；實際能力仍受旗標、store admission、付款及交付設定限制 | 接上有效推薦來源與不可變分配快照；沿用原單店 checkout |
| 供應應付與價差 | `modules/agent-commerce/distribution.ts`、`orders.ts` 的 imported 流程有 record-only supplier payable／margin projection | 不能拿 supplier payable 當推薦佣金；新推薦義務需要獨立型別、來源與收款事實 |
| 到期處理 | `checkout/settlement.ts` 釋放到期庫存 hold | 不是佣金結算服務；不在其中塞入分潤演算法 |
| 一般訂單退款 | `payments/refunds.ts` 現有入口只處理未套用的異常付款；EC-SPEC-06 的 item／shipping 退款仍有後續切片 | 推薦帳消費既有售後／退款權威；未接通前不宣稱一般佣金已可請款，也不另造 RMA |
| 分享 | `docs/development/share-promotion.md` 與對應 share 模組已有分享／有效訪問紀錄 | 點擊、活動 referral 或排行榜不構成交易歸因或現金；可重用複製／分享互動 |
| 合作洽談 | `modules/opportunity-project-work/business.ts` 的 Opportunity 綁作品與作者，Engagement 是雙方固定金額流程 | 可導向有作品的合作；不冒充公開徵人市場、多方佣金或會計帳本 |
| 一起做事 | `modules/opportunity-project-work/work.ts` 與 participation 契約已有工作、承接、驗收、實益等子集 | 接續現有成果與參與入口；一般 Work 的自願模式不自動承諾有預算報酬 |
| 平台收益分配 | [低維運互助契約](../../12-low-ops-mutual-benefit.md) 定義資金邊界；會員營收不自動成為平台收入 | 平台服務費與共同維護分配獨立決策，延後至有實收來源與明確受益對象後實作 |

上表列的是實際可查的接點，不保證每個相鄰規劃的完整能力已實作。例如既有雙方合作收款確認，不等於外部銀行對帳；文件中的完整 allocation／reconciliation 願景，也不能直接當成可用 runtime。

### 2.2 已有人在做的工作

以下狀態於 **2026-10-21 08:11 UTC** 讀取，均為 open、未 merged。開始實作時重新確認；不得把整串 PR 一律升級成新推薦清單的前置條件。

| PR／Issue | 現有工作 | 本計畫的處理 |
| --- | --- | --- |
| [#923](https://github.com/FreeTWAI/freedom-platform/pull/923)（head `0b570f69`） | 會員直接參與、合作進度與 `member-participation-plan.md` | 沿其首頁／合作入口整合；不另造第二個會員首頁 |
| [#921](https://github.com/FreeTWAI/freedom-platform/pull/921)（`e3f4251a`） | 商店可接單條件、管理准入、供貨方案 | 沿用其 readiness 語意；「模組已開」不等於「可以下單」 |
| [#925](https://github.com/FreeTWAI/freedom-platform/pull/925)（`f239ee96`） | 建議售價、MOQ、交期 | 建議售價是資訊；本提案不強制最低轉售價 |
| [#929](https://github.com/FreeTWAI/freedom-platform/pull/929)、[#930](https://github.com/FreeTWAI/freedom-platform/pull/930) | 供貨照片與目錄縮圖，flag OFF | 評估用素材授權不自動變成公開推薦／廣告授權 |
| [#931](https://github.com/FreeTWAI/freedom-platform/pull/931)、[#932](https://github.com/FreeTWAI/freedom-platform/pull/932)、[#935](https://github.com/FreeTWAI/freedom-platform/pull/935) | 店面品牌、賣家政策、商品圖集，flag OFF | 採用其公開投影；不複製另一份店家責任或商品圖集 |
| [#936](https://github.com/FreeTWAI/freedom-platform/pull/936)（`f3143e4b`） | 會員跨店查本人訂單 | 沿既有 `#reservations` 接續；不是跨店一次付款 |
| [#937](https://github.com/FreeTWAI/freedom-platform/pull/937)（`65049b31`） | 已占用庫存、真正接單狀態 | 交易啟用前核對整合結果；庫存 H＋A 不改語意 |
| [#938](https://github.com/FreeTWAI/freedom-platform/issues/938) | 純供應商商品庫與新增零售店入口混淆 | 先修既有角色路徑，不以新推薦頁掩蓋 |
| [#940](https://github.com/FreeTWAI/freedom-platform/issues/940) | 供貨啟用進度不完整 | 分開模組啟用、商品、供貨條件、發布與交易 readiness |
| [#941](https://github.com/FreeTWAI/freedom-platform/issues/941) | 供貨單價為零的驗證提示過晚、資料更新列重複 | 就近驗證、保留輸入；區分或合併資料更新列，保留各讀取範圍的錯誤狀態 |

Commerce PR 的工作分支有堆疊依賴：#921 → #925 → #929 → #930 → #931 → #932 → #935；#936 與 #937 是其後的平行候選。GitHub 的 base 顯示 main 不代表可忽略內含前置提交。實作者核對 diff 與 head 後再選整合點；migration 序號不得照待審分支預先占用。

## 3. 產品原則與責任

1. **一般參與自由。** 不要求先有資源、購買課程、繳費、累積分數或先替平台推廣，才可參與。現有新會員「選主要公會／領技能書」入口仍由現有流程處理；本計畫不偷偷移除，也不新增入會審核。
2. **身分可兼任。** 同一會員可以是創作者、開發者、店主、供應商及其他社群主理人；權限來自具體資源與合作，不因公會或角色標籤取得別人的商店權限。
3. **普通互推開放。** 自己經營社群、分享作品、互相推薦不必先成為官方合作夥伴。正式聯名、素材授權、付費推廣或服務承諾，才需要對應當事人接受的條款。
4. **以行為處理干擾。** 重複洗版、冒名、未同意私訊轟炸、欺騙與騷擾依可核對行為處理；不同意平台或成立自己的社群，不等於惡意。
5. **交易責任明示。** 買家知道向誰買、誰收款、誰出貨與處理退貨。創作者頁清楚揭露推薦利益；平台不因整理訂單就成為代收或履約人。
6. **退出停止新承諾，保留舊義務。** 任何一方可以停止新合作；已接受訂單、已成立佣金、退款、授權與未結爭議按原條款處理，不能藉停用／踢出抹除。

「保證合作方壯大後不離開」不列為產品承諾。平台可以降低繞過合作流程的誘因，但不以永久抽成、限制成員另組社群或阻擋合法匯出作為留存方法。

## 4. 第一版範圍

### 做

- 一般會員可建立有主題、自己的推薦理由與明確店家的推薦清單；只使用已允許公開的內容。
- 買家從清單到實際店家；商品價格、存貨、配送與是否可買由原商店即時決定。
- 店家可提出版本化推薦方案，創作者明示接受後才出現有效佣金條款。
- 推薦來源在買家確認後，與該筆 checkout／order line 綁定；一筆商品明細最多一位佣金受益者。
- 交易開放後，以可追溯付款、履約、退款事件產生推薦義務；支付由店家自行完成，平台記錄事實與其證據層級。
- 在既有會員首頁與合作入口呈現自己的推薦、進度及下一步；沿用現有作品、工具與服務入口。

### 後續切片

- 第一個有佣金的版本只接**店家自己供應、自己作為 seller of record 的已支援商品**。共享供貨轉售鏈再加佣金、多層推薦、多幣別結算、跨站追蹤、付費名單、跨店單一支付都不併入。
- 數位工具可先透過作品展示／合作洽談；可收款販售的數位商品要另定授權、交付、存取與售後能力。不得用假地址／假出貨完成來套現有實體商品流程。
- 平台服務費與共同收益池另行實作；不把會員成交總額、尚未支付的佣金或貢獻分數計成平台可分配收入。

## 5. 分階段交付與 PR 邊界

各階段的「完成」以該 PR 實際 diff／測試／發布收據為準。本文件所有工作仍是 planned。

| 階段 | 交付及主要落點 | 前置／驗收與發布途徑 |
| --- | --- | --- |
| P0 既有路徑修正 | 接續 #938／#940／#941 與 #921／#937；供貨、零售、推薦三個入口分清；新增功能前驗證既有商店流程 | 可獨立修復，不等待推薦佣金；按一般改善或實際影響的交易變更途徑發布 |
| P1 個人推薦清單 | `modules/agent-commerce/` 新增 curation 子域與會員／公開投影；Portal 新清單介面；公開內容授權、撤下與安全外連；無佣金承諾 | 先有 CC-01～07、18～20 的對應驗收；不依賴 checkout ON、平台抽成或全串外觀 PR |
| P2 明示推薦合作 | 版本化 program／agreement、公開利益揭露、可撤回的未來合作、店家與創作者各自權限 | 契約與資料邊界完成；可先以「方案已同意，尚未開放成交計佣」限定試用，不顯示已可賺取 |
| P3 單店歸因與佣金紀錄 | 接入現有 quote／freeze／place，新增不可變 attribution sidecar 與 commission obligation／adjustment／payout evidence；現有退款與付款事實接線 | 商店真實 readiness、交易旗標與已接受商業條款；CC-08～17、21～24；核心／交易發布途徑 |
| P4 合作留存與工具／數位交付 | 接 #923、作品與服務；加入個人下一步、志願案例、可選互推活動；逐項補數位商品的交付與授權 | 普通互推不等 P3；數位有償交付只等自己的責任與能力完備 |
| P5 平台服務收入與共同維護 | 有明確服務、收費人、實收與支出資料後，另寫共同維護分配規格 | 不擋 P0～P4；本輪不建立全站抽成或現金池 |

P1 和 #923 可平行；只在實際共用的首頁／DTO 檔案同步。P2 不以會員發文量作審核條件。P3 不在現有付款核心重做一套訂單或金流，也不為佣金強制開啟全部店家。

### 建議 PR 切分

1. 既有 UX Issue 各自最小修復，補失敗／重試操作證據。
2. 清單資料、公開投影與權限；同 PR 附最小可用 UI，不交付只有後端不可操作的空殼。
3. 店家推薦方案、創作者接受與素材範圍；新增 capability／DTO 同步。
4. 歸因 freeze／place 契約、資料不變條件及買家確認 UI；只有真正支持版本才宣告可計佣。
5. 佣金計算、退款調整與兩方紀錄介面；以合成資料完整走通支付證據層級。
6. 指定同意參與的店家／創作者試用、操作說明及當次發布收據；邀請與啟用另依實際任務授權執行。

每支 PR 附 `source_available / merged / deployed / enabled / acceptance` 的實際狀態，不以其中一欄替代其他欄。若只完成其中一部分，保留可獨立使用的成果和具體下一棒，不加無關的全站完成門檻。

## 6. Codex 接手定位

| 責任 | 優先閱讀／變更接點 | 注意 |
| --- | --- | --- |
| 交易領域 | `modules/agent-commerce/checkout/`、`payments/`、`hosted/`、`distribution.ts` | 新 referral 型別與原 reseller 並存；新貨幣義務不要落在庫存 settlement |
| API／契約 | `apps/platform-api/src/routes/hosted-checkout.ts`、`contracts/guild-launchpad/v1/`、`packages/db/`、`migrations/` | 依現有 SDK、錯誤、CAS、冪等、RLS 與不可變契約發布；新 endpoint 在 spec 標為 proposed |
| 會員／社群 | `modules/opportunity-project-work/`、participation／share 對應模組、#923 的實際 head | 現有 Opportunity 是作品引發的雙方合作；Work 與 Engagement 不等於多方收益帳本 |
| Portal | `HostedDistribution.tsx`、`HostedStore.tsx`、commerce consoles、`DESIGN.md` | 按「找商品／整理推薦／管理商品／處理訂單」等任務呈現；保留原 Logo、tokens、三主題與手機動線 |
| 營運驗收 | 本目錄 EC-SPEC-09／10、[貢獻發布途徑](../../../development/contribution-release-paths.md) | 合併、部署與開放使用分開；保留原已簽責任的處理能力 |

實作者先依根目錄 AGENTS 在獨立 worktree 跑 `freedom prepare`，把真正要改的模組／檔案與反向依賴納入閱讀；不要照本文件機械地新增所有列出的路徑。新 module、schema、capability、事件、data catalog 與權限對照依實際 slice 更新；只有文案的 PR 不執行整套無關付款測試。

## 7. 待確定的產品條件

以下不阻擋 P0／P1；只有需要該條件的交易或承諾不得先行開啟。提案預設須由相應當事人在方案或發布設定中明示接受，不能把文件範例靜默套到全站。

| 決策 | 建議／需要確定的內容 | 只阻擋 |
| --- | --- | --- |
| D1 推薦佣金 | 每個方案自行填整數 basis points、適用商品與計算基礎；沒有全站預設比例 | 該方案開放計佣 |
| D2 歸因有效期 | 第一版限同一瀏覽器分頁的明示推薦；不做跨站／跨裝置追蹤。token 最長期限由版本化方案設定 | P3 歸因啟用 |
| D3 請款時間 | 交付完成及約定等待期間、爭議與退款處理、付款到期日；不知道就不能顯示可請款 | 該筆佣金從 pending 進 payable |
| D4 支付與證據 | 店家自行付款；區分店家登記、創作者確認收款、可核對的實收。先不存銀行資料 | 相關支付紀錄 UI／實收統計 |
| D5 素材與責任 | 誰可用哪些圖文、可在哪裡分享、有效期／撤回；零售責任人、售後聯絡資訊 | 使用該素材／方案，不擋自己的原創內容與一般互推 |
| D6 平台服務收入 | 具體服務與收費對象、費用、實收、可列成本、保留款與個別分配同意 | 僅 P5；不預設平台抽取每筆交易 |
| D7 數位商品 | license、交付證明、版本／更新與支援範圍、退款／撤權處理 | 該類商品收款交付，不擋作品展示與合作洽談 |

## 8. 驗證、觀察與成功判斷

工程驗收採 [spec 的 CC-01～CC-24](creator-curation-spec.md#10-驗收條件)。現有測試可回歸的接點包括 `tests/runtime/hosted-distribution.test.ts`、`hosted-checkout-core.test.ts`、`hosted-checkout-races.test.ts`、`checkout-buyer-identity.test.ts`、`hosted-payment-refunds.test.ts`、`hosted-offline-confirm.test.ts`、`hosted-store-isolation.test.ts`；具體命令以當次 `freedom prepare` 及模組登記為準。**這些 runtime 測試本輪未執行。**

先以合成帳號驗證三段完整旅程：店家提出方案→創作者接受並分享；買家看到責任人→確認推薦來源→向單店下單；店家核對付款／退款→雙方看到一致且不誤稱實收的佣金狀態。確認鍵盤、390px 手機、桌面與三主題；需要真機或真人的項目如實留待當次試用，不拿模擬 persona 當採用證據。

真人試用建議從自願的 2 家店、3～5 位創作者與 2 個獨立社群開始；這是招募規模提案，不是已有名單、服務承諾或固定驗收樣本。觀察：

- 首次完成有內容的推薦清單、完成合作確認所需步驟與卡點。
- 有有效歸因的已付款訂單、退款與待處理例外；點擊另計，不包裝成成交率。
- 可請款、店家登記付款、本人確認收款與實收核對，各自數量與金額。
- 自願再次合作、工具實際採用與有同意的成果分享；不把每日發文量當留存品質。
- 核心／非核心的客服與對帳工時、未知回報比例；不能用人力補位隱藏維運成本。

每個比率附觀察窗與分母，無交易／樣本不足顯示未知或不適用。擴大範圍依問題、供給、已接受容量與實際收益判斷，不承諾每位會員一定有收入。

## 9. 本次文件交付的驗證界線

本次變更僅為本計畫、配套規格與本目錄索引。交付前檢查相對連結／路徑、來源 SHA、文件 diff 與 `git diff --check`，並依實際文件範圍重新產生 coding context。這不替代未來程式、migration、金流、正式環境或真人驗收，也不改寫既有 EC-R／EC-AT 的 planned／not_run 狀態。
