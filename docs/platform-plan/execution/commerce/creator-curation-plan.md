# 創作者推薦與社群合作：實作計畫

> 狀態：**提案／planned；實作與驗收均為 `not_run`**。2026-10-21。
> 固定盤點基準：[`main@2d8056de0ff54cc52f42c9ea491f70a7955a1624`](https://github.com/FreeTWAI/freedom-platform/tree/2d8056de0ff54cc52f42c9ea491f70a7955a1624)。
> 本文件與 [規格](creator-curation-spec.md) 是現有 Commerce 計畫的增量，不替換 EC-SPEC、既有 PR 或正式營運條款，也不覆蓋 canonical 設計；與其不同之處標為「提議變更，待 Ted 決定」。

## 0. canonical 出處與對齊

依 [07 §1.1](../../07-decisions-risks-traceability.md)，Ted 的決定、00 基線、ADR／領域不變條件與機器可讀契約優先於本計畫。下表逐點對齊；「沿用」照 canonical 做，其餘列入 [§7](#7-待-ted-決定的產品條件) 的 CC-D，Ted 決定前不實作。

| 出處 | canonical 要點 | 本計畫 |
| --- | --- | --- |
| [03](../../03-domain-events-state-machines.md) §3.6 末段、§3.8 | 推廣者只分享 attribution link、不向買家收款；signed referral rule＋accepted attribution＋已付訂單明細才產生 `CommissionObligation`；推廣者自己收款就是 reseller，價差不是佣金 | 沿用。P1 清單不產生任何義務；P2 起的推薦方案就是店家的 signed referral rule |
| 03 §3.9、§7.10 | `CommissionObligation`：`pending → qualified → due`；退款走 `FinancialObligationReversal`；每條 line 只一層明示受益人，不形成上下線 | 沿用這些名稱與狀態，不另立 payable／held／zero 狀態 |
| 03 §7.9 | 歸因優先序預設：signed referral／session evidence > store promo code > buyer order-time selection > manual post-order claim；可配置但要版本化 | 沿用為預設；同層衝突的處理列 CC-D14 |
| [04](../../04-module-specifications.md) §3.3～§3.6 | 推廣者選品、Promoter Wallet View（不是託管錢包）、`GET /api/v1/me/earnings`；`commission_base`、bps、進位、歸因期限寫進版本化 policy，預設半入、30 天同 Offer last eligible click，自購不自動封鎖 | 名稱與 API 沿用；不同的提議列 CC-D1、CC-D2、CC-D8～CC-D10 |
| 07 ADR-013、OD-26 | 商品分潤用版本化 Offer／agreement，不做 downline；現有 Offer 表達不了的具名 business case，要有法律、濫用、退款、揭露 evidence 才建立 ADR 工作 | P1 不受影響。P2 以後：**需要新 ADR，待 Ted 簽 OD-26** |
| 07 ADR-030、§4.3、ADR-063、OD-27、OD-28 | `due` 義務逐單建 `SettlementInstruction`；預設 `record_only` 只顯示「已記錄」、`money_movement_enabled=false`；Direct payout／manual report 為 replace，人工證據只走 `manual_required` | 沿用。「店家站外付款、自行回報」是提議變更，列 CC-D4 |
| 07 OD-23、ADR-025 | 不做 MoR、escrow、wallet 或代收；一次 checkout 一個 Seller | 沿用 |
| 07 R-PAY-06 | 退款／chargeback 要沖回佣金義務：不可變分配、property tests、append-only reversal | 沿用；已結算後退款的處理列 CC-D13 |
| [commerce-distribution](../../contracts/commerce-distribution.example.yaml) | `commission_obligation` 只來自 signed commission rule＋已驗證付款，綁 `buyer_order_ref`、`order_line_ref`；平台不收不持有資金；`record_only` 只投影「已記錄」；退款建 reverse obligation 或依已簽條款抵扣未來結算 | 沿用 |
| [operating-policy](../../contracts/operating-policy.example.yaml) `money` | `record_only`、`money_movement_enabled: false`、`benefit_report_creates_payable: false`、`automatic_global_commission: false`、會員營收不是平台收入 | 沿用；沒有全站預設比例 |
| [12 低維運互助](../../12-low-ops-mutual-benefit.md) §2（L21）、§8（L99） | 不另建帳本或全站抽成；單一 Seller、無 custody／wallet；payable、initiated、recorded、reconciled_received 分開顯示，實收只看既有付款對帳 | 沿用；不新建分潤帳本（CC-D15） |
| [refferq 採用評估](../supplier-console/refferq-adoption.md) | 建立付款時不可把佣金標成已付；讀不到不是零，不放假數字 | 沿用 |
| [OPEN-07](../guild-launchpad/decision-log.md)、[EC-SPEC-09](EC-SPEC-09-security-ci-tests.md) §3 | 備份 30 天、衍生副本 7 天、tombstone 至少 45 天；commerce 資料集保存仍是 `policy_undecided` | 推薦紀錄保存期限列 CC-D20 |

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
| 發布收據與部署紀錄 | 自 2026-10-20 22:14 UTC 起 staging／production 都是 `cf7e518b`、schema 172；Supplier／Commerce console ON，checkout／交易 Email OFF（GitHub Deployments；收據在待合併的 [#933](https://github.com/FreeTWAI/freedom-platform/pull/933)）。#921 與其後進 main 的變更尚未部署 | 這就是當下即時狀態；本輪沒有直接查正式環境 |
| 這兩份文件 | 可評審的設計與驗收條件 | runtime 測試、真實金流或產品驗收已通過 |

main 已提交的部署依據 [current-state](../unified-foundation/current-state.json)、[closeout](../unified-foundation/closeout.md) 與 [2026-10-20 發布收據](../unified-foundation/rollout-short-videos-2026-10-20.json) 仍記錄前一版 `3a6e2506`（07:16 UTC）；`cf7e518b` 的收據以 #933 合併後為準。後續實作者開始前須重新讀取最新 main、進行中的 PR、當時旗標與准入設定，不以本文件覆蓋它們。

### 2.1 可沿用與真正缺口

| 主題 | 固定基準的來源與現況 | 本次增量 |
| --- | --- | --- |
| 商品與供貨 | `modules/agent-commerce/hosted/{products,supply-catalog,supply-terms,distribution}.ts`；沿用商品、版本化 offer、selection 與 acceptance。reseller 的六項責任定義在 `hosted-ui/reseller-arrangement.ts`，`modules/agent-commerce/distribution.ts` 只 re-export。開零售店要電商公會（`guild_commerce_sales`）有效成員，實習可（`hosted/store.ts:155`）；開供貨商品庫要供應或電商公會（`hosted/supply-catalog.ts:32`） | 推薦只引用已允許公開的商品；推薦方案與創作者接受不偽裝成 seller selection（是否另立紀錄待 OD-26 的 ADR） |
| 現有選品 UI | `apps/portal-web/src/modules/HostedDistribution.tsx` 要店主填售價、申請供貨並放進自己的店面 | 新增個人推薦清單；不要求開店，不產生創作者售價或第二份庫存 |
| 買家交易 | `checkout/{cart-quote,terms,orders,public-commands,buyer-identity}.ts`、`payments/` 已有交易核心與身分切換保護；實際能力仍受旗標、store admission、付款及交付設定限制 | 接上有效推薦來源與不可變分配快照；沿用原單店 checkout |
| 供應應付與價差 | `modules/agent-commerce/distribution.ts`、`orders.ts` 的 imported 流程有 record-only supplier payable／margin projection | 不能拿 supplier payable 當推薦佣金；推薦義務用 canonical `CommissionObligation`（03 §3.9），不寫入 imported 舊表，也不新建分潤帳本（12 §2） |
| 到期處理 | `checkout/settlement.ts` 釋放到期庫存 hold | 不是佣金結算服務；不在其中塞入分潤演算法 |
| 一般訂單退款 | `payments/refunds.ts` 現有入口只處理未套用的異常付款；EC-SPEC-06 的 item／shipping 退款仍有後續切片 | 佣金義務只消費既有售後／退款權威的逐 line 事實；未接通前一般佣金不進 `due`，也不另造 RMA |
| 分享 | `docs/development/share-promotion.md` 與對應 share 模組已有分享／有效訪問紀錄 | 點擊、活動 referral 或排行榜不構成交易歸因或現金；可重用複製／分享互動 |
| 合作洽談 | `modules/opportunity-project-work/business.ts` 的 Opportunity 綁作品與作者，Engagement 是雙方固定金額流程 | 可導向有作品的合作；不冒充公開徵人市場、多方佣金或會計帳本 |
| 一起做事 | `modules/opportunity-project-work/work.ts` 與 participation 契約已有工作、承接、驗收、實益等子集 | 接續現有成果與參與入口；一般 Work 的自願模式不自動承諾有預算報酬 |
| 平台收益分配 | [低維運互助契約](../../12-low-ops-mutual-benefit.md) 定義資金邊界；會員營收不自動成為平台收入 | 平台服務費與共同維護分配獨立決策，延後至有實收來源與明確受益對象後實作 |

上表列的是實際可查的接點，不保證每個相鄰規劃的完整能力已實作。例如既有雙方合作收款確認，不等於外部銀行對帳；文件中的完整 allocation／reconciliation 願景，也不能直接當成可用 runtime。

### 2.2 已有人在做的工作

以下狀態於 **2026-10-21 21:40 UTC** 讀取。開始實作時重新確認；不得把整串 PR 一律升級成新推薦清單的前置條件。

| PR／Issue | 用途與狀態（as of 2026-10-21） | 本計畫的處理 |
| --- | --- | --- |
| [#921](https://github.com/FreeTWAI/freedom-platform/pull/921) | 商店可接單條件、管理准入（`AdminStoreAdmissions.tsx`）、供貨方案頁（`HostedSupplyOffer.tsx`）；16:23 UTC 已合併，尚未部署 | 沿用其 readiness 語意；「模組已開」不等於「可以下單」 |
| [#937](https://github.com/FreeTWAI/freedom-platform/pull/937) | 已占用庫存、各店真正接單狀態；20:45 UTC 連同 #929～#935 合併，尚未部署 | 交易啟用前核對；庫存 H＋A 不改語意 |
| [#929](https://github.com/FreeTWAI/freedom-platform/pull/929)、[#930](https://github.com/FreeTWAI/freedom-platform/pull/930) | 供貨照片與目錄縮圖，flag OFF；已合併，尚未部署 | 評估用素材授權不自動變成公開推薦／廣告授權 |
| [#931](https://github.com/FreeTWAI/freedom-platform/pull/931)、[#932](https://github.com/FreeTWAI/freedom-platform/pull/932)、[#935](https://github.com/FreeTWAI/freedom-platform/pull/935) | 店面品牌、賣家資訊與政策、商品圖集，flag OFF；已合併，尚未部署 | 採用其公開投影；不複製另一份店家責任或商品圖集 |
| [#923](https://github.com/FreeTWAI/freedom-platform/pull/923) | 會員直接參與、合作進度與 `member-participation-plan.md`；open | 沿其首頁／合作入口整合；不另造第二個會員首頁 |
| [#925](https://github.com/FreeTWAI/freedom-platform/pull/925) | 建議售價、MOQ、交期；open，其提交已隨 #929 的堆疊進 main | 建議售價是資訊；本提案不強制最低轉售價 |
| [#936](https://github.com/FreeTWAI/freedom-platform/pull/936) | 會員跨店查本人 checkout 訂單（checkout 旗標）；open | 沿既有 `#reservations` 接續；不是跨店一次付款 |
| [#944](https://github.com/FreeTWAI/freedom-platform/pull/944) | 商品變體，flag OFF；open | 推薦引用可售 SKU，隨其變體語意，不另定規格 |
| [#946](https://github.com/FreeTWAI/freedom-platform/pull/946) | 線下訂單事件進通知鈴，flag OFF；open | 推薦相關通知沿同一機制，不另造通知管道 |
| [#956](https://github.com/FreeTWAI/freedom-platform/pull/956) | 店內商品分類，flag OFF；open | 選品與清單篩選沿用其分類，不另建 |
| [#958](https://github.com/FreeTWAI/freedom-platform/pull/958) | 供貨新增商品單價就近驗證、區分資料更新來源（修 #941）；open | #941 的修正以此為準，P0 不重做 |
| [#943](https://github.com/FreeTWAI/freedom-platform/pull/943) | 開店引導、商品照片自動儲存與一鍵上架；draft | 與 #938 的入口修正一起核對；不另造開店流程 |
| [#938](https://github.com/FreeTWAI/freedom-platform/issues/938) | Issue：純供應商商品庫與新增零售店入口混淆；open | 先修既有角色路徑，不以新推薦頁掩蓋 |
| [#940](https://github.com/FreeTWAI/freedom-platform/issues/940) | Issue：供貨啟用進度不完整；open | 分開模組啟用、商品、供貨條件、發布與交易 readiness |
| [#941](https://github.com/FreeTWAI/freedom-platform/issues/941) | Issue：供貨單價為零的驗證提示過晚、資料更新列重複；open | 就近驗證、保留輸入；區分或合併資料更新列，保留各讀取範圍的錯誤狀態 |

依賴（as of 2026-10-21）：#921 已合併；#929 → #930 → #931 → #932 → #935 → #937 這串經 #937 一起進 main。仍開啟的堆疊是 #936 → #944 → #946 → #956（#956 另含 #925）。#923、#925、#958 各自建在 #921 之後的 main 上；#943 是草稿，建在較舊的 main。GitHub 的 base 顯示 main 不代表可忽略內含前置提交。實作者核對 diff 後再選整合點；migration 序號不得照待審分支預先占用。

## 3. 產品原則與責任

1. **一般參與自由。** 不要求先有資源、購買課程、繳費、累積分數或先替平台推廣，才可參與。現有新會員「選主要公會／領技能書」入口仍由現有流程處理；本計畫不偷偷移除，也不新增入會審核。
2. **身分可兼任。** 同一會員可以是創作者、開發者、店主、供應商及其他社群主理人；權限來自具體資源與合作，不因公會或角色標籤取得別人的商店權限。
3. **普通互推開放。** 自己經營社群、分享作品、互相推薦不必先成為官方合作夥伴。正式聯名、素材授權、付費推廣或服務承諾，才需要對應當事人接受的條款。
4. **以行為處理干擾。** 重複洗版、冒名、未同意私訊轟炸、欺騙與騷擾依可核對行為處理；不同意平台或成立自己的社群，不等於惡意。
5. **交易責任明示。** 買家知道向誰買、誰收款、誰出貨與處理退貨。創作者頁清楚揭露推薦利益；平台不因整理訂單就成為代收或履約人。
6. **退出停止新承諾，保留舊義務。** 任何一方可以停止新合作；已接受訂單、已成立佣金、退款、授權與未結爭議按原條款處理，不能藉停用／踢出抹除。

「保證合作方壯大後不離開」不列為產品承諾。平台可以降低繞過合作流程的誘因，但不以永久抽成、限制成員另組社群或阻擋合法匯出作為留存方法。

## 4. 第一版範圍

### 做（P1；平台不碰錢，不受 OD-26 限制）

- 一般會員可建立有主題、自己的推薦理由與明確店家的推薦清單；只使用已允許公開的內容。
- 買家從清單到實際店家；商品價格、存貨、配送與是否可買由原商店即時決定。
- 在既有會員首頁與合作入口呈現自己的推薦、進度及下一步；沿用現有作品、工具與服務入口。

### P2 以後（需要新 ADR，待 Ted 簽 OD-26）

- 店家提出版本化推薦方案（即 03 §3.8 的 signed referral rule），創作者明示接受後才有有效佣金條款。
- 推薦來源依 03 §7.9 的優先序與該筆 checkout／order line 綁定；每條 line 的受益人數見 CC-D11。
- 交易開放後，由已驗證的付款與退款事實產生 `CommissionObligation`（`pending → qualified → due`）與 `FinancialObligationReversal`；結算沿 `record_only`，只顯示「已記錄」；店家站外付款與回報的提議列 CC-D4。

### 後續切片

- 第一個有佣金的版本接哪些商品待 Ted 決定（CC-D12；提議只接**店家自己供應、自己作為 seller of record 的已支援商品**）。不做 downline（OD-26）、一次 checkout 一個 Seller（ADR-025）是 canonical；共享供貨轉售鏈再加佣金、多幣別結算、跨站追蹤、付費名單、跨店單一支付都不併入。
- 數位工具可先透過作品展示／合作洽談；可收款販售的數位商品要另定授權、交付、存取與售後能力。不得用假地址／假出貨完成來套現有實體商品流程。
- 平台服務費與共同收益池另行實作；不把會員成交總額、尚未支付的佣金或貢獻分數計成平台可分配收入。

## 5. 分階段交付與 PR 邊界

各階段的「完成」以該 PR 實際 diff／測試／發布收據為準。本文件所有工作仍是 planned。

| 階段 | 交付及主要落點 | 前置／驗收與發布途徑 |
| --- | --- | --- |
| P0 既有路徑修正 | 接續 #938／#940／#941（#958、#943 處理中），以已合併的 #921／#937 為基礎；供貨、零售、推薦三個入口分清；新增功能前驗證既有商店流程 | 可獨立修復，不等待推薦佣金；按一般改善或實際影響的交易變更途徑發布 |
| P1 個人推薦清單 | `modules/agent-commerce/` 新增 curation 子域與會員／公開投影；Portal 新清單介面（CR-01、CR-02）；公開內容授權、撤下與安全外連；無佣金承諾 | 先有 CC-01～07、18～20 的對應驗收；不依賴 checkout ON、平台抽成或全串外觀 PR |
| P2 明示推薦合作 | 版本化方案／協議、公開利益揭露、可撤回的未來合作、店家與創作者各自權限（CR-03～CR-05） | **需要新 ADR，待 Ted 簽 OD-26**；之後契約與資料邊界完成；可先以「方案已同意，尚未開放成交計佣」限定試用，不顯示已可賺取 |
| P3 單店歸因與佣金紀錄 | 接入現有 quote／freeze／place，新增不可變 attribution sidecar 與 `CommissionObligation`／`FinancialObligationReversal`／`SettlementInstruction`（`record_only`）；現有退款與付款事實接線；人工支付證據依 CC-D4 | **需要新 ADR，待 Ted 簽 OD-26**；商店真實 readiness、交易旗標與已接受商業條款；CC-08～17、21～24；核心／交易發布途徑 |
| P4 合作留存與工具／數位交付 | 接 #923、作品與服務；加入個人下一步、志願案例、可選互推活動；逐項補數位商品的交付與授權 | 普通互推不等 P3；數位有償交付只等自己的責任與能力完備（CC-D7）；若加佣金，同 P2 的 OD-26 條件 |
| P5 平台服務收入與共同維護 | 有明確服務、收費人、實收與支出資料後，另寫共同維護分配規格 | 不擋 P0～P4；本輪不建立全站抽成或現金池（CC-D6） |

P1 和 #923 可平行；只在實際共用的首頁／DTO 檔案同步。P2 不以會員發文量作審核條件。P3 不在現有付款核心重做一套訂單或金流，也不為佣金強制開啟全部店家。

### 建議 PR 切分

1. 既有 UX Issue 各自最小修復，補失敗／重試操作證據。
2. 清單資料、公開投影與權限；同 PR 附最小可用 UI，不交付只有後端不可操作的空殼。
3. （P2，ADR 通過後）店家推薦方案、創作者接受與素材範圍；新增 capability／DTO 同步。
4. （P3）歸因 freeze／place 契約、資料不變條件及買家確認 UI；只有真正支持版本才宣告可計佣。
5. （P3）`CommissionObligation` 計算、`FinancialObligationReversal` 與 `record_only` 結算明細；以合成資料走通 `pending → qualified → due` 與「已記錄」；人工支付證據依 CC-D4 的決定。
6. 指定同意參與的店家／創作者試用（規模見 CC-D16）、操作說明及當次發布收據；邀請與啟用另依實際任務授權執行。

每支 PR 附 `source_available / merged / deployed / enabled / acceptance` 的實際狀態，不以其中一欄替代其他欄。若只完成其中一部分，保留可獨立使用的成果和具體下一棒，不加無關的全站完成門檻。

## 6. Codex 接手定位

| 責任 | 優先閱讀／變更接點 | 注意 |
| --- | --- | --- |
| 交易領域 | `modules/agent-commerce/checkout/`、`payments/`、`hosted/`、`distribution.ts` | referral 用 canonical `CommissionObligation`，與原 reseller 並存；不落在庫存 settlement，也不寫 imported 舊金融表 |
| API／契約 | `apps/platform-api/src/routes/hosted-checkout.ts`、`contracts/guild-launchpad/v1/`、`packages/db/`、`migrations/` | 依現有 SDK、錯誤、CAS、冪等、RLS 與不可變契約發布；新 endpoint 在 spec 標為 proposed |
| 會員／社群 | `modules/opportunity-project-work/`、participation／share 對應模組、#923 的實際 head | 現有 Opportunity 是作品引發的雙方合作；Work 與 Engagement 不等於多方收益帳本 |
| Portal | `HostedDistribution.tsx`、`HostedStore.tsx`、commerce consoles、`DESIGN.md` | 按「找商品／整理推薦／管理商品／處理訂單」等任務呈現；保留原 Logo、tokens、三主題與手機動線 |
| 營運驗收 | 本目錄 EC-SPEC-09／10、[貢獻發布途徑](../../../development/contribution-release-paths.md) | 合併、部署與開放使用分開；保留原已簽責任的處理能力 |

實作者先依根目錄 AGENTS 在獨立 worktree 跑 `freedom prepare`，把真正要改的模組／檔案與反向依賴納入閱讀；不要照本文件機械地新增所有列出的路徑。新 module、schema、capability、事件、data catalog 與權限對照依實際 slice 更新；只有文案的 PR 不執行整套無關付款測試。

## 7. 待 Ted 決定的產品條件

以下都是待決，不是定案；除另註外不阻擋 P0／P1，只有需要該條件的交易或承諾不得先行開啟。編號 CC-D1～CC-D20 與 [decisions.md](decisions.md) 的 DC01～DC12、規格的驗收 CC-01～24 分開。負責人預設 Ted。「canonical／現況」欄照做；與它不同的提議即「提議變更，待 Ted 決定」。Ted 決定後，仍須由相應當事人在方案或發布設定中明示接受，不把文件範例靜默套到全站。

| 決策 | canonical／現況 | 提議（待 Ted 決定） | 負責人 | 只阻擋 |
| --- | --- | --- | --- | --- |
| CC-D1 比例 | bps 或固定 Money，寫進版本化 policy；不得有全站固定比例（04 §3.6、07 §4.3） | 每個方案自填整數 bps，1～10000（0.01%～100%） | Ted | 該方案開放計佣 |
| CC-D2 歸因期限與方式 | AttributionPolicy 逐 Offer 版本化；04 §3.6 第一版預設 30 天、同 Offer last eligible click，但它不是全站預設（07 §4.3） | 只認同一瀏覽器分頁的明示推薦，期限由方案設定；不做跨站／跨裝置追蹤 | Ted | P3 歸因啟用 |
| CC-D3 到期條件 | `pending → qualified → due`（03 §7.10）；爭議只暫停該筆義務（04 §3.3） | 交付完成、約定等待期滿、無未決退款／爭議才進 `due`；缺事實不靠時間到期 | Ted | 該筆義務進 `due` |
| CC-D4 結算與支付證據 | `record_only` 只顯示「已記錄」；Direct payout／manual report 為 replace，人工證據只走 `manual_required`，轉帳由收款人或 provider 事實確認（07 §4.3、ADR-030、ADR-063、OD-28、03 §3.9） | 店家站外付款後登記、創作者確認收款，分四級證據顯示（規格 §6.3）；先不存銀行資料 | Ted | P3 支付紀錄 UI／實收統計 |
| CC-D5 素材與責任 | — | 誰可用哪些圖文、可在哪裡分享、有效期／撤回；零售責任人、售後聯絡資訊 | Ted＋各店家 | 使用該素材／方案；不擋自己的原創內容與一般互推 |
| CC-D6 平台服務收入 | 不全站抽成；一般 benefit report 不建立 payable（12 §2、§8；operating-policy） | 具體服務與收費對象、費用、實收、可列成本、保留款與個別分配同意 | Ted | 僅 P5 |
| CC-D7 數位商品 | — | license、交付證明、版本／更新與支援範圍、退款／撤權處理 | Ted | 該類商品收款交付；不擋作品展示與合作洽談 |
| CC-D8 計算基礎 | `commission_base` 須明定為商品小計、折後小計或實收，並寫明是否不含運費／稅（04 §3.6） | 該 line 的含稅商品成交金額，不含另列運費與稅；E08 上線後是否改用折後小計一併決定（規格 §5.4） | Ted（必要時會計專業） | 該方案開放計佣 |
| CC-D9 進位 | 進位方式與餘數歸屬寫進 policy；預設半入到 minor unit、餘數留 seller（04 §3.6） | 每項無條件捨去到整數 NT$（u＝100，與 EC-SPEC-02 §3 的折扣捨去一致） | Ted | 該方案開放計佣 |
| CC-D10 自購 | 自我推薦、coupon 與點擊不自動封鎖；要限制就用明白規則與人工處理（04 §3.6） | 店家與受益人相同的方案不得啟用；已知買家＝受益人時不計佣（規格 §5.2 第 9 條） | Ted | P3 歸因啟用 |
| CC-D11 每條 line 受益人數 | 不做 downline（OD-26）；只一層明示受益人，同一 recipient 同一 policy line 不重複計（03 §3.9、04 §3.6） | 每條 line 最多一位受益人 | Ted | P3 歸因啟用 |
| CC-D12 適用商品 | — | 第一版只算店家自有、自任 seller of record 的已支援商品 | Ted | 範圍外商品計佣 |
| CC-D13 已結算後退款 | 退款建 reverse obligation，依已簽條款由收款方退回或抵扣未來結算，不經平台錢包（03 §3.9、commerce-distribution、R-PAY-06） | 不自動追回，記差額待雙方依條款處理（規格 §6.4） | Ted | P3 結算 |
| CC-D14 歸因衝突 | 03 §7.9 優先序；同 Offer 預設取最後一次有效點擊（04 §3.6） | 同層兩個來源時保留先前的來源，讓買家明示改選（規格 §5.2 第 3 條） | Ted | P3 歸因啟用 |
| CC-D15 紀錄範圍 | 不另建帳本或全站抽成（12 §2） | 不新建分潤帳本；金錢紀錄只用 `CommissionObligation`／`FinancialObligationReversal`／`SettlementInstruction`；方案、協議、intent 等是否另立紀錄由 OD-26 的 ADR 決定 | Ted | P2／P3 資料設計 |
| CC-D16 試點規模 | — | 自願的 2 家店、3～5 位創作者、2 個獨立社群 | Ted | 真人試用 |
| CC-D17 個人收佣的扣繳、申報與收據 | 平台不代收、不代付（OD-23） | 尚無提議；需要會計／稅務專業意見 | Ted＋會計／稅務專業 | P3 結算 |
| CC-D18 推薦揭露是否合法 | — | 揭露文案與位置待法律專業確認 | Ted＋法律專業 | P2 合作標示；P1 本人自述文案上線前核對 |
| CC-D19 方案條款範本 | 社群規則與服務條款入口仍待 [#261](https://github.com/FreeTWAI/freedom-platform/issues/261) | 條款範本隨 #261 的入口發布 | Ted | P2 發布方案 |
| CC-D20 推薦紀錄保存期限 | OPEN-07 已定備份、衍生副本、匯出連結與 tombstone 期限；commerce 資料集仍是 `policy_undecided`（EC-SPEC-09 §3） | 清單、intent、歸因與義務各自的期限 | Ted | P3 的歸因與義務紀錄（P1 清單的刪除沿 OPEN-07 既有類別） |

## 8. 驗證、觀察與成功判斷

工程驗收採 [spec 的 CC-01～CC-24](creator-curation-spec.md#10-驗收條件)。現有測試可回歸的接點包括 `tests/runtime/hosted-distribution.test.ts`、`hosted-checkout-core.test.ts`、`hosted-checkout-races.test.ts`、`checkout-buyer-identity.test.ts`、`hosted-payment-refunds.test.ts`、`hosted-offline-confirm.test.ts`、`hosted-store-isolation.test.ts`；具體命令以當次 `freedom prepare` 及模組登記為準。**這些 runtime 測試本輪未執行。**

先以合成帳號驗證三段完整旅程：店家提出方案→創作者接受並分享；買家看到責任人→確認推薦來源→向單店下單；店家核對付款／退款→雙方看到一致且不誤稱實收的佣金狀態。確認鍵盤、390px 手機、桌面與三主題；需要真機或真人的項目如實留待當次試用，不拿模擬 persona 當採用證據。

真人試用規模待 Ted 決定（CC-D16；提議自願的 2 家店、3～5 位創作者與 2 個獨立社群），不是已有名單、服務承諾或固定驗收樣本。觀察：

- 首次完成有內容的推薦清單、完成合作確認所需步驟與卡點。
- 有有效歸因的已付款訂單、退款與待處理例外；點擊另計，不包裝成成交率。
- 進 `due`、結算明細（已記錄）與實收核對，各自數量與金額；店家登記與本人確認是否納入依 CC-D4。
- 自願再次合作、工具實際採用與有同意的成果分享；不把每日發文量當留存品質。
- 核心／非核心的客服與對帳工時、未知回報比例；不能用人力補位隱藏維運成本。

每個比率附觀察窗與分母，無交易／樣本不足顯示未知或不適用。擴大範圍依問題、供給、已接受容量與實際收益判斷，不承諾每位會員一定有收入。

## 9. 本次文件交付的驗證界線

本次變更僅為本計畫、配套規格、本目錄索引與 [pages.md](pages.md) 的提案頁面 ID。交付前檢查相對連結／路徑、來源 SHA、文件 diff 與 `git diff --check`，並依實際文件範圍重新產生 coding context。這不替代未來程式、migration、金流、正式環境或真人驗收，也不改寫既有 EC-R／EC-AT 的 planned／not_run 狀態。
