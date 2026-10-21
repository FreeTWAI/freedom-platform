# 創作者推薦與社群合作：功能與資料規格

> 狀態：**提案／planned；以下新增資料、API、路由、狀態與驗收均未實作、未啟用，驗收為 `not_run`**。
> 來源基準：`FreeTWAI/freedom-platform@65589400b8945f49757a5647fbf004e8b71a384f`，2026-10-21。
> 排程、現況與待審依賴見 [實作計畫](creator-curation-plan.md)。本文件不授予部署、啟用金流或代當事人接受合作條件的權限。

## 1. 領域邊界與不可破壞條件

| 名稱 | 意義 | 權威與限制 |
| --- | --- | --- |
| 店家／seller of record | 對買家負責的零售主體 | 沿用 tenant／storefront instance 與商家自己的收款、交付、售後流程 |
| 供應商 | 提供貨源或已明示接受的履約服務 | 純供貨商品庫不自動成為可對買家結帳的商店；供貨同意不等於代出貨同意 |
| 轉售者／reseller | 自訂售價、以自己的店家身分賣貨 | 保留現有 selection／acceptance、六項責任、supplier payable 及「預估差額」原語意 |
| 創作者／recommender | 提供推薦內容與成交來源 | 無須開店；沒有店家定價、庫存、買家聯絡資料、退款或收款帳戶管理權限 |
| 推薦清單／collection | 主題、原創推薦理由、已允許公開商品的引用 | 不是商店，不建立商品副本、存貨、另一套價格或 checkout |
| 推薦方案／program | 店家對特定商品提出的版本化佣金與素材條件 | 只在該店、該商品、該版本內有效；未同意不能計佣 |
| 推薦協議／agreement | 店家與創作者對某方案版本的明示接受 | 不代表平台保證商品、收入或履約；不能由 AI、社群長代所有人接受 |
| 佣金義務／obligation | 某筆有效推薦成交應付給某創作者的金額紀錄 | 店家為付款人；不等於平台錢包、已付款或銀行實收 |

共同限制：

- 保留 React／Hono／Workers／PostgreSQL／R2；新增能力放在現有模組，不另建推薦微服務、第二份商品主檔或平台結算核心。
- 一次 checkout 屬於一間店；跨店推薦清單可以存在，買家依店分組前往原購物車，各店付款及訂單獨立。第一版不另建跨店合併購物車或一筆跨店扣款。
- 第一版有佣金的商品限該零售店自有商品，且有已支援的交付與售後流程。跨供應商轉售鏈加佣金、外部站成交與數位自動授權另立切片。
- v1 reservation 仍是原本未付款／不出貨的 profile；不把 literal `false`、分享點擊、預留或草稿升格成成交。
- 保留原 checkout canonical terms、訂單明細、付款／庫存來源及不可變性；新推薦以明示版本化 sidecar 接入，不回填舊訂單成推薦成交。
- 任何方案更新、撤回、成員退出或關閉新功能，都不得刪除既有交易、佣金調整、退款與未完責任。

### 1.1 原始碼中需要特別避開的誤讀

`modules/agent-commerce/distribution.ts` 的 `resellerArrangement` 把 seller 設為零售／收款／發票／退款／定價責任人；`marginProjection` 回傳 `cash_received:false`。這不是 affiliate 能力。

`migrations/138_hosted_direct_reservations.sql` 另以 CHECK 與 composite FK 將既有 transfers／payment_events／supplier_payables 限為 `order_profile=imported_reseller`。新 hosted 推薦不可寫入這些舊金融表，也不可為共用名稱解除 guard；未落地的 hosted 供貨帳規劃仍與推薦佣金分開。

`checkout/settlement.ts` 是到期庫存釋放。`payments/refunds.ts` 的 `recordSellerRefund` 在此基準只接受 `overpaid`／`after_cancel`／`amount_mismatch` 的未套用付款手動退款紀錄；不能據此宣稱普通 `converted`／`allocated` 訂單的完整退貨退款已接通。P3 若要承諾佣金可請款，必須先接通正常訂單的權威退款／交付事實；否則保持待核對，不靠時間到自動放款。

一般 item／shipping 退款分配接續 [EC-SPEC-06](EC-SPEC-06-invoice-aftersales.md) 的 M4 與整數 cap 規則；推薦帳只消費該權威的逐 line 事實，不平行重建 RMA／退款流程。既有 refund 純函式可供測試，不代表 HTTP、provider 或售後端到端已完成。

`business.ts` 的 Engagement 是作品衍生的雙方固定金額合作，收款為一次全額回報與對方確認，不是推薦佣金帳本。分享 `/go` 的有效訪問，也不構成任何貨幣權利。

## 2. 主要使用旅程與入口

### 2.1 新人、社群主理人與開發者

新會員沿現有入會流程完成主要公會與技能書步驟。之後可以瀏覽工具、提出需求、展示作品、參與活動或經營自己的社群，不要求先提供資源、發足貼文、買課或加入官方合作名單。現有 `first-participation` 接待流程有先發分享／公會訊息的條件；若提供「尚未發文就先求助」入口，需在 #923／相關社群工作中明確補上，不能宣稱現況已支持。

工具作者沿作品／服務入口說明用途、權利、支援範圍與下一步；既有 Showcase 引發 Opportunity 的流程可以保留。一般合作需求若沒有 Showcase，不得偽造一件作品來繞過既有 Opportunity 契約；先沿適用的社群分享／工作入口，公開徵人市場另行設計。

### 2.2 店家／供應商

「我的供貨商品庫」保留純供貨；「我的商店」保留零售。發起推薦方案前先指定真正的零售店及可公開 SKU。沒有零售店的供應商可以繼續供貨合作，或自行完成零售設定；平台不代其變更交易責任。

店家選自有商品 → 填推薦條件及素材權利 → 檢查摘要 → 發布方案 → 處理創作者申請 → 管理未來合作與自己需處理的佣金事項。原商品編輯、發布、付款、配送、訂單與退款沿用現有 console。

### 2.3 創作者

P1 的獨立旅程是：「新增推薦清單」→ 貼上既有公開商品網址 → server 解析允許公開的實際店家／商品 → 填自己的推薦理由及可選的關係揭露 → 預覽 → 明示發布。來源限本站原 `/shops/:slug/products/:sku` 公開頁；只解析本站商品投影，不對任意 URL 發 HTTP。私有供貨目錄、任意外部商品網址、偽造 private item ID 或已撤下商品不能加入；回傳具體原因並保留清單草稿。一般外部連結仍可沿既有社群分享，不冒充本站可計佣商品。

P2／P3 的合作旅程是：「合作選品」→ 看商品、店家、合作條件 → 申請／確認 → 得到自己的分享入口 → 加入自己的主題推薦清單 → 回來查看真正的待辦與佣金狀態。兩條旅程都不要求填零售價、庫存、配送或商家金流憑證；P1 不依賴 program／agreement 或 `store:write`。

P1 清單的系統狀態標示「本平台不計佣」或「尚未透過本平台建立佣金協議」；平台無紀錄不能推定當事人沒有站外報酬、贈品或互惠關係。一般推薦也能由本人揭露與商品、店家或社群的關係，無須先成立 partnership。P2／P3 的有效協議控制本平台計佣能力及已確認條款；利益揭露不以是否有平台協議為前置。本人自述與平台已確認的合作事實分開標示。

### 2.4 買家

推薦清單 → 選一件商品 → 看實際賣家與推薦關係 → 前往該店原商品頁／購物車 → 確認價格、交付、政策與推薦來源 → 原 checkout／付款 → 原訂單頁。

付款後的買家頁不以「你幫創作者賺到多少」取代付款／交付狀態。跨店本人訂單接續待審 #936 的 `#reservations`。未登入可沿原 guest 能力購物；現有線下付款的會員限制保持，不為推薦建立繞過入口。

### 2.5 路由與介面接點

下列新路由是提案，實作時須先確認最新 parser 與權限契約；不是現有 endpoint。

| 頁面 | 既有／提議路由 | 主要操作 |
| --- | --- | --- |
| 供貨與商店 | 既有 `#stores/supply`、`#stores`、tenant／instance consoles | 管理供貨、零售與實際 readiness |
| 合作選品 | proposed `#stores/discover` | 篩選、查看有效方案，不需 `store:write` |
| 我的推薦清單 | proposed `#stores/collections`、`#stores/collections/:id` | 草稿、加入引用、預覽、發布／撤下 |
| 我的推薦合作 | proposed `#stores/recommendations`、`#stores/recommendations/:id` | 申請、接受條款、分享、查看本人義務及待辦 |
| 公開推薦清單 | proposed `/recommendations/:slug` | 公開內容與利益揭露；前往實際店家 |
| 買家商品／交易 | 既有 `/shops/:slug` 下商品、cart、checkout、orders 路徑 | 保留隔離 buyer bundle 與單店交易 |

新 `stores` 保留字路由須在 tenant／instance 匹配前明確分派，不讓 `discover` 被解析成 tenant ID。沿 `Navigation.tsx` 的同一份選單；不另造首頁或全站導覽。會員／console 遵守三主題，公開店面沿既有隔離的 bright storefront 外觀。

## 3. 資料模型（全部為 proposed）

以下是概念與欄位契約，不是已存在的 table。物理命名、FK、RLS 與 migration 編號由實作 PR 按最新 schema 決定，必須保留這些不變條件。商品／店家／訂單引用既有穩定 ID；公開 DTO 使用其公開 reference，不把私有 tenant、成本、來源簽名或 member ID 全部曝光。

| 聚合／紀錄 | 最小必要欄位 | 不變條件 |
| --- | --- | --- |
| `RecommendationCollection` | id、owner_member、community、title、description、visibility、state、version、published_revision | draft 私有；本人明示發布；改草稿不改已發布 revision；撤下後匿名不可讀 |
| `CollectionEntry` | collection、position、merchant／item reference、own_reason、self_declared_relationship、optional agreement reference、allowed asset refs | 引用商品而非複製庫存／價格；一個 entry 指向一位實際 seller；內容與素材可公開權利分別成立；本人關係自述不等於平台核准或佣金 |
| `RecommendationProgramRevision` | program、revision、merchant tenant／instance、eligible own-item refs、currency、rate_bps、basis、settlement_unit_minor、attribution_policy、eligibility_policy、payment_due_policy、rights、effective_until、terms_digest | 已發布 revision 不可改；比例、範圍、期限、等待條件、素材權利缺失不能啟用計佣；百分比不是全站預設 |
| `RecommendationAgreement` | id、program revision／digest、merchant principal、creator member、兩方接受事實、state、version、ended_at／reason | 創作者接受與店家核准同一 digest；不能由社群長或會員標籤推導；改版另立接受，不覆寫舊同意 |
| `RecommendationIntent` | opaque id、agreement／version、merchant／item、issued_at、expires_at、server nonce digest、buyer identity fence、state | token 不含買家 PII；不能授予訂單讀取權；只對已允許店家／商品有效；不作跨站 profile |
| `CheckoutAttributionSnapshot` | checkout、snapshot revision、quoted terms hash、line binding、agreement／digest、beneficiary、rule version、buyer confirmation、identity fence | 原子凍結；每條 line 最多一位推薦人；修訂 checkout 時另留 revision 與原冪等結果 |
| `OrderAttribution` | order／line、snapshot reference、placement source、original buyer binding | placement 同交易確定且不可變；後來點其他連結、改會員或改方案不覆蓋 |
| `CommissionObligation` | id、order／line、beneficiary、payer merchant、currency、frozen rule、original eligible base、source payment fact、version | 不是 platform balance；一筆 line 僅一筆初始義務；不從前端傳入金額；舊訂單不補造 |
| `CommissionAdjustment` | obligation、unique source event、kind、delta_minor、rule version、evidence level、created_at | append-only，退款／更正不改原金額；事件重播或不同工作者不重複計算 |
| `CommissionPaymentRecord` | obligation、payer／beneficiary、amount、currency、reported_at、evidence reference、stage、supersedes reference | 第一版一筆義務一次全額登記；付款／確認獨立事實；更正用附加事件；不存銀行帳號或付款憑證圖到公開欄位 |

個人清單依 owner_member＋community 授權，不為沒有店的創作者強制建商業 tenant；交易義務依原 merchant tenant 授權，creator 只透過受限投影讀本人資料，不能為讀資料而切到店家 tenant context。

公開內容讀取每次檢查有效發布與素材權利。若來源撤下／素材撤權，顯示可理解的不可用狀態並停止新導流；不從私有商品或舊公開快取補回圖文。交易快照在原授權範圍內保留，不等於可以繼續公開廣告。快取失效、最大快取壽命與公開 asset 撤回能力須在 P1／P2 實作前具體確定並驗證；無法滿足撤回的媒體不先開啟。

## 4. API、權限與寫入契約（proposed）

### 4.1 路由分工

| 範圍 | 提議接點 | 操作者與回傳範圍 |
| --- | --- | --- |
| 本人清單 | `/api/v1/me/recommendation-collections`、`/:id`、`/:id/publish`、`/:id/withdraw` | 已通過現有會員入口的本人；只讀寫自己的草稿／清單 |
| P1 商品引用解析 | `POST /api/v1/recommendation-targets/resolve`，body 為本站公開商品 URL | 會員唯讀、有界解析；只查原公開投影，回穩定引用與可公開欄位；不要求 program／store:write、不讀私有供貨價格、不爬外部 URL |
| 可參與方案 | `/api/v1/recommendation-programs`、`/:id` | 同 community 的會員；只含可公開／可申請條件，不含店家成本、其他人的申請與交易 |
| 店家方案 | 既有 tenant／storefront root 下 `/recommendation-programs` | 要求對該 instance 的具體新 capability；不能只看前端角色 |
| 本人協議 | `/api/v1/me/recommendation-agreements`、`/:id/accept`、`/:id/end` | 本人接受／停止自己的未來合作；店家核准走 tenant 命令 |
| 分享來源 | `/api/v1/public/recommendation-intents` | 公開 entry 解析成有界 intent；沿同源與匿名流量限制，不授予私有權限 |
| 公開清單 | `/api/v1/public/recommendations/:slug` | 匿名可讀已發布的最小投影；限量分頁、無會員聯絡／訂單資料 |
| checkout 接線 | 既有 cart quote／checkouts／placement 的明示新契約 | 新 client 傳 intent reference；server 決定有效來源並凍結；舊 client 原路徑保留 |
| 本人佣金 | `/api/v1/me/commission-obligations`、`/:id`、`/:id/acknowledge-receipt` | 只見自己金額、去識別交易 reference、條款與證據層級；無買家 PII |
| 店家佣金 | 既有 tenant／storefront root 下 `/commission-obligations`、`/:id/payment-records` | 權限足夠的店家讀／登記自己的應付；不跨店；不觸發外部付款 |

首次實作須把精確 method、schema、capability、錯誤、分頁及事件登錄到目前 authoring contracts，再產生對應 consumer；本文件中的 namespace 不保留實體路由、版本號或 migration 序號。

### 4.2 共同安全與一致性

- 會員／店家寫入沿現有 session、exact Origin、CSRF、Idempotency-Key、具引號的 If-Match／CAS 與 command receipt；身分來自 session，不信任 body 的 creator／seller／tenant。
- 匿名 intent／買家命令沿現有 public command 的獨立同源、budget、store 綁定與 capability 模式，不把會員 CSRF 規則誤套成強制登入，也不開任意跨站寫入。
- 新店家 capability 至少區分方案讀取／管理與佣金讀取／登記付款；必須在安裝 release 與授權契約中明示，`store:write` 不自動擴大成 finance 權限。具體名稱在實作 PR 固定。
- 其他人的 id、不同 tenant 或缺權限回適當 403／404；UUID／slug／token 存在不代表有讀取權。行政權限也不默認擁有所有 buyer PII。
- 新命令缺版本 428、舊版本 412；條款／身分／商品狀態衝突用具體 409；格式與金額 422；受 quarantine 限制的寫入遵循既有 503。具體 problem code 隨 schema 一起測試。
- 私有投影 `private, no-store`。交易／intent 不寫入 analytics URL、日誌正文或分享預覽；公開分享 code 只是導流 reference，不能作為訂單權限或揭露個資。
- 公開目標由 server 的固定商店／SKU reference 產生；拒絕任意 redirect URL、HTML／script、私有 asset ref 與未授權素材。社群一般外連沿既有安全規則，不藉推薦功能放寬。
- 有界分頁、穩定排序與 cursor scope；查詢失敗不回假零、也不以讀取觸發對帳、到期、付款或發布。

## 5. 方案生命週期與推薦歸因

### 5.1 合作生命週期

Program：`draft → published → paused / ended`。重新發布改條件必須是新 revision；已結束版本不重新寫入。Agreement：`requested → active / declined`；`active → paused / ended`。具體動作由當事人、版本及目前權限共同決定。

同意的有效內容包括：誰付款、哪些商品、比例與基礎、可計佣事件、等待／付款期限、退款及退出後義務、素材範圍、必要利益揭露。只有 creator 接受但店家未核准，或反之，均不得顯示合作已生效。

新版本不自動適用舊 agreement。想接受新條件的人閱讀差異再接受。暫停／退出停止新 intent 與未成交的計佣；**已 placement 的凍結訂單**仍按原條款結算。單純未完成 checkout 沒有永久鎖定佣金權；若有效性已改變，明示重新確認，不靜默換推薦人。

### 5.2 第一版歸因規則

1. **明示、逐商品。** 不是全站 last-click cookie。每個商品只有買家本次明確確認的推薦來源；從清單加入不同店家商品時，分別保留各自的來源提議。
2. **同一分頁的短期 intent。** 使用 server 建立、有最大期限的 opaque reference。有效期由當時版本化方案明示；P3 啟用前設定上限，沒有值就不可計佣。不做跨瀏覽器、跨裝置拼接、指紋辨識或通訊錄匯入。
3. **衝突由買家決定。** 相同商品已有來源 A 又遇到 B，先保留 A，提供「改採 B」的明示操作；不得依點擊順序偷偷覆寫。沒有來源的商品正常購買；最多一位推薦人，無多層抽成。
4. **server 重新查核。** quote、freeze、place 均核對 merchant／item、agreement、有效期、素材與計佣狀態；不可讓 query string 直接指定受益人或佣金比例。
5. **quote 可讀、placement 不可變。** quote 回傳推薦人公開名稱、關係揭露與可理解的失效原因。freeze 原子保存新的 attribution snapshot 與其 digest，placement 再驗後固定到 order line。
6. **冪等與身分。** 新版本請求摘要必須包含 intent／snapshot 選擇；同 key 改來源必須 conflict，不能復用舊冪等結果改派受益人。沿 `X-Commerce-Buyer` 比對與身分重確認；換帳號清掉前一身分的私有草稿，保留安全 cart 但要求重確認。既有未知 placement 不由新帳號重播。
7. **登入回跳。** 保留 `storefront-return.ts` 的 checkout／order-access／order UUID allowlist；推薦不是 session 或 order access token，不把任意參數塞入 return_to 來放寬限制。回跳後重新解析同一分頁有效 intent，失效就說明。
8. **過期／撤回與原交易。** 建單前來源無效時，回傳變更原因，讓買家選重新確認新方案或明示「繼續購買，不附推薦」。不因推薦功能關閉破壞原有無推薦 checkout；不默默丟失原已確認的推薦。成功 placement 的重試回原結果，不能因後來撤回而改派或取消已成立義務。
9. **有限防濫用。** 店家 principal 與推薦受益人相同的自付方案不得啟用；已知 buyer＝beneficiary 時依明示的第一版不計佣規則處理。Guest 身分未知不能宣稱已排除所有自購；不靠增加隱蔽追蹤補足。可疑情況進需核對狀態，保留理由及申訴接點，不任意刪除義務。

### 5.3 與現有不可變 checkout 的相容性

現有 `freedom.checkout-terms/v1` 已有 TypeScript／SQL hash 驗證、idempotency request digest 與 immutable order constraints。新推薦快照必須使用**獨立的版本化 sidecar／digest**，由新的明示 wire capability 綁進 quote → freeze → place 的整條鏈；不可只塞未參與 hash 的 optional JSON 到 client。

不改舊 v1 terms bytes／hash／order line；新 capability 下的凍結、placement 及 receipts 同交易保存對應 sidecar，DB 約束檢查 merchant／item／buyer／terms hash 的一致性。舊 client 無此能力仍可無推薦購物；若 client 已攜推薦 intent 而 server 不支持，顯示尚未支持並要求使用者決定，不假稱會計佣。需要新 profile 或 contract revision 時另發布不可變版本，不原地改已簽的 contract bundle。

鎖順序沿既有 lifecycle → community → profile／checkout／order → payment／inventory，新增 agreement／attribution 的鎖順序須在實作設計中固定並加並發反例；不可讀外部 provider 或另一 tenant 的 HTTP 來完成資料庫內交易。

## 6. 佣金計算與金額語意

### 6.1 可計佣的付款事實

只有原交易核心接受的付款應用與對應的凍結訂單，才可產生初始佣金待核對紀錄。`converted`／`allocated` 為付款確認後的正常庫存結果；`unallocatable` 也是原核心所承認的付款結果，但必須維持「付款已確認、配貨待處理」且不得進可請款。

`simulated`、amount mismatch、after-cancel、overpaid、未套用／隔離中的事件與瀏覽器成功回跳，不成立正常推薦成交。重送 webhook、query、離線確認或重播原命令不增加第二筆佣金。

線下付款沿店家確認，標示 `merchant_confirmed`；provider notification／query 驗證標示 `provider_verified`。二者來源不同，UI 不把線下店家回報寫成銀行驗證。只有付款事件不足以證明創作者已收到佣金。

### 6.2 計算公式

第一版只支持既有單一幣別訂單，不換匯。所有 money 使用 safe integer minor units／DB 整數，計算使用可檢查溢位的整數方式，不用浮點百分比。

- `B`：該 frozen order line 的商品成交金額。現有 discount 為零；未支持明確 discount allocation 前不加入跨商品折扣。排除另列運費、另列稅費，不猜測 `tax_state=not_assessed` 的內含稅額，也不扣想像的商家成本。
- `r`：雙方接受的整數 `rate_bps`，範圍 1～10000；沒有約定就沒有佣金。零佣金普通推薦保持 P1 身分，不假裝成付費方案。
- `u`：凍結的整數支付／計價單位，第一版與商家幣別的可記錄結算單位一致：現有規則 USD＝1 minor、TWD＝100 minor（整元）。不把 TWD minor 當作元。
- `R`：已由有效退款事實明確分配到該 line 的累計商品退款，`0 ≤ R ≤ B`；運費退款不混入。沒有逐 line 分配的模糊退款，先標待核對，不任意平均。
- 初始佣金 `C0 = floor(B × r ÷ (10000 × u)) × u`。
- 退款後應付 `C(R) = floor((B − R) × r ÷ (10000 × u)) × u`。
- 每次只附加 `C(R_new) − C(R_old)` 的調整；這樣分次退款、重播及全額退款結果一致，全退為零。不各自對每次退款比例四捨五入。

若依約定單位計算結果為零，保留可讀的計算依據並顯示「本筆計算為零」，不產生可請款或零元付款操作；不可用虛構小數收入湊成儀表板收益。

**合成例子，比例不是預設：** 商品 NT$1,000，`B=100000`、`r=1000`（10%）、`u=100`，初始佣金 NT$100。商品先退 NT$300，剩餘佣金 NT$70；再退 NT$700，剩餘為零。另付 NT$80 運費不計佣；這些數字不表示平台將抽 10% 或任何人已獲收入。

金流費、平台服務費、保留款或稅務扣款不得從此公式偷偷再扣；若後續需要，須有獨立明細、可讀條件與當事人同意，再升版。第一版不把全部 creator 義務匯成可自由移轉的餘額。

### 6.3 雙軸狀態與證據

佣金「是否成立／可請款」和「是否付款／收到」分開，保留所有事件。摘要不可將 pending、可請款與已收款加成一個「總收入」。

| 義務狀態 | 條件與顯示 |
| --- | --- |
| `pending` 待核對 | 有合格付款／歸因，但未完成交付或約定等待條件；顯示還差什麼 |
| `held` 暫緩 | 配貨異常、退款／爭議、來源不一致、缺正常退款能力等；有具體原因與責任人 |
| `payable` 可請款 | 淨佣金大於零，且原方案的付款、交付、等待與爭議條件均有有效事實；列付款方與到期日 |
| `zero` 本筆計算為零 | 初始公式因金額／結算單位算為零；保留依據，沒有請款／付款操作 |
| `reversed` 已沖回 | 全額或部分退款、明示成立的撤銷事實使原本正數佣金歸零；原金額與調整仍可查 |

| 支付證據階段 | 允許的 UI 說法 | 不可說法 |
| --- | --- | --- |
| `not_reported` | 尚未登記付款 | 平台已欠入錢包 |
| `payment_reported` | 店家已登記付款，待收款人確認 | 已匯入、銀行已驗證 |
| `receipt_acknowledged` | 創作者本人確認已收款，附確認時間 | 等於 provider／銀行對帳通過 |
| `reconciled_received` | 已依列明的外部收款證據核對 | 沒有對應 adapter／紀錄也顯示此狀態 |

第一版可以只實作前三級，並把實收核對顯示為「尚未提供」；既有 Engagement 的雙方確認不直接生成第四級。一般利益回報、人工備註、點擊與貢獻角色都不觸發金額或支付狀態。

第一版 `payment_reported` 僅允許對單一 payable 義務一次全額登記，帶當時版本、currency 與 amount；未確認／未撤銷的登記存在時不能再登記。每筆入帳金額、確認者和 source reference 不重複；收款本人才能確認，不由店家替其確認。更正用可追溯事件，不能改掉已確認資料。批次／分期付款後續另定不可超付的 allocation 契約。

### 6.4 退款、爭議與退出後責任

退款核准／已登記／provider 已完成等證據分開保留。尚未完成或來源互相矛盾時先暫緩相關佣金；只有原售後／退款領域判定生效、非 failed 且有逐 line 分配的退款事實，才新增確定的調整。若該領域接受的是 manual record，調整保留這個證據層級，不宣稱 provider／銀行驗證；前端備註或申請退款本身不能代替該事實。對普通正常訂單若沒有完整退款來源或交付證據，不允許排程僅憑已過幾天就轉 payable。

已登記或已確認支付後才發生退款，照樣保留負向義務調整與已支付事實，產生「已付超過目前應付，待協議處理」差額；不能扣平台錢包、扣下一個不相干合作的錢或自動向創作者扣款。追回／折抵需要原明示條件與可追溯的新處理紀錄。

停止新推薦不影響授權當事人讀舊 statement、處理退款、提出爭議及確認既有支付。會員／tenant 停用或封鎖時仍依既有保留責任機制處理，不能為此繞過停權／quarantine 來恢復一般寫入；必要處理由既有授權 operator 走可稽核程序。

## 7. 社群共贏、留存與開發者成果

### 7.1 日常互推與正式合作分開

一般作品、社群或資源互推不要求簽正式 partnership。可沿既有分享入口補上「這是什麼／適合誰／與我有什麼關係」，鼓勵本人參與討論；不建立最低發文量、先貢獻才能宣傳或禁止加入別群的規則。

針對洗版、欺騙、騷擾、冒名、未經同意匯入／私訊會員等可核對行為，沿現有 moderation／檢舉及正式規則工作處理，附理由與復核接點。不同意平台、合理批評、銷售有明示價值的服務，或社群長自行壯大，不以「針對我們」一語自動判違規。正式對外條款仍接續 #261，不用本提案冒充已發布服務條款。

需要平台代推、聯名、限定素材、付費曝光、保證工時或分配收益的合作，才明示：各方提供什麼、期間／範圍、品牌與資料用途、驗收與退出。合作可各自保有品牌，不共享會員名單；公開案例和聯名使用須有相應同意。

### 7.2 讓人願意回來的最小功能

- 接續 #923：自己的工作／合作／推薦下一步、最近可用機會及可選通知，不再新增一套會員首頁。
- 保留已同意的合作與成果歷史，讓再次合作不用重談全部事項；本人可停止新承諾。
- 既有 `work_contribution_roles`／confirmations 可呈現提案、設計、實作、測試、文件、協調等共同署名；同一工作不靠多個角色灌成果數。署名不是分潤權。
- 一般 Work 的 `voluntary_contribution` 不因加上角色就變有預算工作。付費案要在真正支持的合作／合約能力中明示付款人與金額，不用「以後一定分潤」換取免費維護。
- 通知以現有偏好與 opt-in 機制接續；不自動寄廣告、替會員貼文或大量私訊。平台不承諾每人一定接到案或賺錢。

### 7.3 平台服務收入與貢獻分配的後續規格入口

會員成交額、店家收到的買家款、創作者佣金、平台自己提供服務而收到的費用，是四種不同事實。未有收費服務與同意就不建立全站抽成。

若後續確定共同維護分配，先定一個有期限的可分配池：可核對的平台實收 − 對應退款／既有義務 − 已接受的營運成本 − 已明示保留款；負數不假造待分配收益。成本類別、期間、受益對象、貢獻接受與分配計算需可查、可申訴；不從 XP、聊天量、GitHub Stars 或未經驗收的提交次數直接換現金。這只定義 P5 的設計入口，並未新增運作中的池、股權或會員分紅權。

## 8. 失敗、恢復與可存取性

| 狀態 | 介面與恢復 |
| --- | --- |
| 初次載入／更新 | 分開「讀取中」與保留上次資料的「更新中」；標時間，不先顯示零收入／零商品 |
| 真正空清單／搜尋無結果 | 分別說明；提供新增推薦或清除篩選，不強制開店 |
| 資料讀取失敗 | 明確指出失敗範圍與重試；403／換帳號清除無權讀資料；不以空陣列偽裝成功 |
| 商品／方案撤下 | 說明目前不可用；回清單／尋找替代，不自動購買或換賣家 |
| 方案改版／價格變動 | 顯示舊新差異，要求重新確認；不可默默換條款、金額或受益人 |
| 寫入結果未知 | 使用原 method／path／body／key／If-Match 查核或重試，阻止重複提交；換新 key 不能作為修復 |
| 412 衝突 | 保留本人的草稿與最新版本，比較後明示套回／放棄，不整頁重設輸入 |
| 欄位錯誤 | 就近顯示原因、保留值、聚焦第一個錯誤；價格政策依 server schema，stock＝0 仍可合法 |
| 複製／系統分享失敗或取消 | 提供手動複製並還原焦點；取消不計分享成功、點擊或佣金 |
| 身分切換／登出 | 停止舊私有讀取，忽略過期 response，重確認 checkout；不替新身分重送舊操作 |
| 新功能關閉 | 保留普通商店與既有合法歷史處理；新推薦／計佣入口顯示實際 unavailable reason |

會員區沿原 Logo、DESIGN tokens、明亮／夜航／敘生主題及 ConsoleShell 同一份導航；公開店面沿原隔離樣式。驗證 320／390／768／1280／1440px 無整頁橫向溢出，正文至少 14px、手機 input 至少 16px、觸控目標 44px。鍵盤可以完成搜尋→詳情→確認→分享；dialog 支持關閉、Esc 與焦點返回，狀態不只靠顏色，遵守 reduced-motion。

必要責任與風險資訊不藏於截斷文字；無新手導覽能力的頁面按既有規則登記 disabled 原因，不讓角色提示遮擋交易操作。這些是未來 UI slice 驗收，本文件沒有改 UI。

## 9. 資料遷移、事件與啟用

### 9.1 相容性

採 expand-only 新表／sidecar，保留 deployed migrations bytes；新 migration 編號由整合時最新 main 決定。不把原 `commerce_selections` 的 reseller 改成 referral，不覆寫既有訂單與簽署條款，不把歷史點擊補成 affiliate 訂單。

P1 與 P2／P3 的能力分開控制。關閉新流入不能關閉舊義務的合法查閱／處理；退款、historical payments、移除公開素材仍依既有安全及生命周期約束。舊 client、無新 capability 的 installed release、checkout OFF 以及 server 不支持新 wire profile，都必須有明確降級，不能靠 UI 隱藏當成 server gate。

### 9.2 原子性與事件來源

order attribution 與 placement 同交易提交，失敗一起 rollback。委派工作者計算 obligation 時以真實 order／payment application 的 immutable source reference 冪等，並重新驗證 scope；不可把先收到前端「付款成功」視為來源。

事件投遞順序不等於交易發生順序。建立 obligation 與處理 adjustment 必須在同一有界鎖定範圍讀取 canonical 的付款及累計有效退款，補齊已存在的退款來源後才投影餘額。退款先到而 obligation 尚未建立時，保留可重試的未匹配事件／來源，不把它當成功而丟棄；稍後付款事件不能只寫 C0 後就變 payable。已處理 source reference 唯一，重播後結果與原交易順序一致；沒有新事實不靠重試另加一筆金額。

付款／退款的 domain source、不同通知重送、查詢發現與到期工作有穩定去重鍵。事件 inbox／outbox／journal 若沿用現有機制，先確認實際 consumer；本文件不假定所有領域事件已接通。外部 I/O 保持在既有 lease／call／result 等交易外流程，不在新 DB command 中呼叫金流服務。

RLS、資料分類、public projection、append-only 與 DB unique／FK／check constraints 隨 migration 一起交付。原經過 retention／redaction 的買家資料不能從推薦快照重建；statement 只保留履行既有責任所需的最少資訊，保留期間沿正式資料政策確認。

### 9.3 啟用順序

先 P1 的一般改善／限定試用，再 P2 的明示合作。P3 只有在實際店家交易 readiness、正常退款／履約來源、條款接受、對應測試與當次發布條件具備後，才對明確範圍開放。merchant／creator 自願試用不等於授權操作者在正式環境替他們建立交易。

合併、部署、旗標啟用、真人採用與實收各自記錄。不得把部署收據中的 console ON 解讀為 checkout 或自動分佣已開；不為讀清單而先啟用交易 Email 或全站金流。

## 10. 驗收條件

全部狀態 **planned / `not_run`**。每個實作 PR 只承接自己的 ID，附基準、命令／環境與結果；未執行的不改稱通過。

| ID | 情境／反例 | 必須觀察的結果 |
| --- | --- | --- |
| CC-01 | 沒有店舖且沒有 program 的合法會員貼公開商品網址建立清單 | server 只解析本站有效公開商品；可完成草稿、原創理由、預覽、明示發布；不創建 tenant／stock、不要求 store:write；私有或外部目標明確拒絕 |
| CC-02 | 其他會員／不同 community 讀寫私有清單 | 拒絕；猜 id、公開 slug 不授予草稿、成本或會員聯絡資料 |
| CC-03 | 同一清單含不同店家 | 每件顯示真實 seller，分店前往原 cart；沒有一次跨店付款或第二套價格 |
| CC-04 | 店家商品、素材撤下／撤權 | 公開投影與快取按規格失效；不讀私有快照補回；歷史交易保留原權限 |
| CC-05 | 方案缺比例、期限、責任或素材條件 | 可保存草稿；不可啟用計佣；普通無佣金分享仍可使用 |
| CC-06 | 只有一方接受、舊版接受或跨店核准 | 不產生活躍 agreement；有效雙方接受必須匹配同一 digest |
| CC-07 | 開發者／社群主理人一般互推，無平台協議但有本人揭露贈品／站外合作 | 無付費／發文量／排他門檻；如實顯示本人自述與「本平台不計佣」，不聲稱未約定任何佣金、不產生平台佣金、不取得他人商店權限 |
| CC-08 | 重複點連結、A／B 來源衝突、token 過期／竄改 | 不以點擊賺錢；明示選來源；server 拒絕錯 merchant／item／過期 token，無靜默改派 |
| CC-09 | quote 後改方案、暫停或關閉新功能 | 新 placement 要重新確認或明示無推薦購買；不破壞既有普通 checkout |
| CC-10 | freeze／place 同 key 重送、改 source、並發兩次 | 原結果或正確 conflict；一個 order line 最多一個 attribution／初始 obligation，無重複扣庫存 |
| CC-11 | guest 登入、同會員新 session、換另一帳號、未知舊 intent | 沿原 identity fence；保留安全 cart，清私有草稿／舊授權；換帳號不重播未知 placement |
| CC-12 | 模擬付款、僅 browser return、mismatch、after-cancel、overpaid | 不產生正常已成交佣金；verified unallocatable 只可待處理，不能 payable |
| CC-13 | provider 重送／query 與 offline confirmation | 同來源不重算；離線顯示店家確認，不宣稱銀行核實 |
| CC-14 | 正常交付／退款權威未接通，等待日已到 | 維持具體 held reason，不能僅憑排程轉 payable；補有效事實後才重新評估 |
| CC-15 | 整元計算、初始為零、部分退款歸零、多次退款、全退、運費退、金額溢位 | 依凍結整數公式；分次結果一致，零額不進 payable／付款；重播無第二個 adjustment，退款不超過 B，溢位拒絕且無部分寫入 |
| CC-16 | 可請款→店家登記→本人確認；店家替對方確認／重複登記 | 金額／currency／version 符合；無超付重複紀錄；證據層級分明、creator 才能確認自己收款 |
| CC-17 | 已支付後退款、合作結束、商店暫停 | 保留支付與負向調整；差額待處理，不自動扣款／清除；合法歷史讀取與既有責任可接續 |
| CC-18 | 清單／方案／statement 載入失敗、真正空資料 | unknown／error 與真零分開，保留有時間的舊資料；不洩漏前一帳號 response |
| CC-19 | 寫入結果未知、412、複製失敗、表單欄位錯誤 | 保留原操作坐標與草稿，明確恢復；手動複製可用；沒有重複提交與假成功 |
| CC-20 | 320／390／768／1280／1440px、三主題、全鍵盤 | 無溢出、焦點可完成主要流程，狀態文字與責任資訊可讀；公開店面維持原樣式隔離 |
| CC-21 | 舊 client／v1 reservation／reseller journey 回歸 | 原 profile、literal false、supplier payable、價差與流程不變；不誤升級收入或交易 |
| CC-22 | 退款早於付款 consumer、事件重播、付款／歸因並發與 migration 直接 SQL 反例 | DB 證明 tenant、唯一、金額、不變欄位及鎖順序；亂序結果與 canonical 累計事實一致；回滾無半筆 attribution／obligation |
| CC-23 | 關閉新推薦、quarantine、撤權、匿名掃描 | 新流入安全拒絕；既有有權歷史與責任按既有機制處理，無跨 tenant／PII 洩漏 |
| CC-24 | 支付摘要、貢獻、分享與平台收益統計 | 不把 click／XP／recorded／會員 GMV 當平台實收；每種數字有證據層級、期間及分母 |

## 11. 來源與接手閱讀

以下路徑都依本文固定 SHA 閱讀；後續變更須以當時最新實作重新核對，而非讓本規格覆蓋它。

- [Commerce 索引](README.md)、[付款](EC-SPEC-04-payment.md)、[售後](EC-SPEC-06-invoice-aftersales.md)、[安全](EC-SPEC-09-security-ci-tests.md)、[發布](EC-SPEC-10-release-operations.md)、[線下付款](EC-SPEC-11-offline-payment.md)。
- [Hosted supply cooperation](../../../../modules/agent-commerce/hosted/distribution.md)、[checkout 契約](../../../../modules/agent-commerce/checkout/README.md)、[buyer storefront](../../../../modules/agent-commerce/storefront/README.md)。
- [低維運互助契約](../../12-low-ops-mutual-benefit.md)、[分享語意](../../../development/share-promotion.md)、[貢獻發布途徑](../../../development/contribution-release-paths.md)。
- 實碼：`modules/agent-commerce/{distribution,orders}.ts`、`checkout/{terms,orders,buyer-identity,settlement,confirmed-payment}.ts`、`payments/{refunds,rules/types}.ts`、`apps/platform-api/src/routes/hosted-checkout.ts`。
- 會員實碼：`modules/opportunity-project-work/{business,work,contribution-roles}.ts`、`modules/community/first-participation.ts`；待審 [#923](https://github.com/FreeTWAI/freedom-platform/pull/923) 有自己的會員參與計畫。
- 前端：`apps/portal-web/src/Navigation.tsx`、`apps/portal-web/src/modules/{PromotionShare,HostedStore,HostedDistribution,GuildLaunchpadApplications}.tsx`、`modules/agent-commerce/{hosted-ui,supplier-console,seller-console,storefront}/`。

本次只交付文件；沒有執行上述功能測試、修改 runtime、schema、旗標、production 資料或進行付款。未來實作者按實際影響範圍產生 coding context、補契約及驗收，不把本文件中的建議叫作已完成。
