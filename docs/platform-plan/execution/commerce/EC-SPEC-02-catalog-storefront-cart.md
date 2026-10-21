# EC-SPEC-02 商品、店面、購物車與顧客

狀態：proposed（2026-10-15），基準 `efaf314d`。對應需求 EC-R05、R07–R11、R42；驗收 EC-AT03–10、AT12（全部 `not_run`）。頁面行為見 [EC-SPEC-01](EC-SPEC-01-product-visual.md)，訂單與庫存見 [EC-SPEC-03](EC-SPEC-03-order-inventory.md)。表名、欄位與 API 都是提議。

## 0. 現況（已核對）

| 項目 | 現況 | 位置 |
| --- | --- | --- |
| 商店 | 每個 storefront instance 有兩個 `commerce_shops`（供貨用 `supply_shop_id`、對外 `storefront_shop_id`），`origin='hosted'` 的列必須 `accepting_orders=false`、`mode='test'` | `migrations/134_hosted_storefronts.sql:2-5,28-42` |
| 商品 | 自有商品＝供貨 shop 的 `commerce_items` 一列＋對外 shop 的 `commerce_selections` 一列；SKU 由 `product_seq` 產生 `P0001…`；每店最多 200 個（`product_limit` 是 v1 契約 literal） | `modules/agent-commerce/hosted/products.ts:42-50`；`contracts/guild-launchpad/v1/storefront.ts` |
| 供貨商品 | 外部供應商的 item 經 offer／acceptance 選入；共享實體庫存，不複製 | `modules/agent-commerce/hosted/distribution.ts`、`shared-quotes.ts` |
| 照片 | 每個商品一張 WebP（≤1 MiB、≤1920px），`commerce_product_photo_targets`；發布時凍結到 `commerce_publication_photo_refs` | `migrations/141_storefront_product_photos.sql:55,162` |
| 發布 | `commerce_storefront_publications` 不可改：v1 projection（slug、名稱、品牌、介紹、幣別、商品 sku／title／description／price）＋`template_id`＋`media_sha256`；`transaction_state` 固定 `'not_enabled'` | `modules/agent-commerce/hosted/publish.ts:30-34,69` |
| 附加內容的先例 | 版型以獨立 presentation 契約加入，「pinned storefront/v1 projection stays unchanged」 | `contracts/guild-launchpad/v1/storefront-presentation.ts:4` |
| 公開讀取 | 唯一不綁身分的讀取者：讀凍結的 publication，再確認 tenant、模組、owner、deployment binding 都仍有效 | `modules/agent-commerce/hosted/public.ts:10-45` |
| 公開頁沒有即時庫存 | projection 不含 stock；也沒有公開購物車或顧客資料 | `public.ts`；`modules/module-data/catalog.ts:2142` |
| 報價 | 只有會員能取 quote：5 分鐘、`terms_sha256`、不占庫存、同店最多 9 個未用 quote、每 60 秒最多 20 次 | `hosted/direct-quotes.ts:40-74` |
| 金額 | 整數最小單位，100 minor＝1 TWD；幣別 TWD／USD；單價上限 1e8 | `hosted/format.ts:2`；`storefront.ts` |
| 顧客 | 沒有 guest 路徑；訂單只存 `buyer_principal_id` | `hosted/direct-authority.ts:30` |

## 1. 商品、變體、照片、分類

### 1.1 變體＝一個可售 SKU

庫存、保留、配置、行項、供貨同意都以 item／selection 為單位（EC-SPEC-03）。所以**每個變體就是一個 selection（背後一個 item）**，不在 item 之下再分層：

- 新表 `commerce_product_groups`：tenant／instance、`group_id`、標題、介紹、選項軸（最多 2 個，例如「顏色」「尺寸」，每軸最多 20 個值）、預設 SKU、排序、版本。
- 新表 `commerce_product_group_members`：`group_id`、`selection_id`（唯一）、各軸的值、排序。同一組合不重複。
- 既有的單一商品＝只有一個成員、沒有選項軸的 group；遷移時為每個現有 selection 建一個 group，不改 SKU。
- 自有變體各自有庫存、價格；供貨商品的變體是各自接受的 offer。同一個 group 可混合自有與供貨，但頁面只顯示可售狀態，不顯示來源。
- 200 個 SKU 上限不變（v1 literal）。要放寬須另開契約版本，不在 C1／C2。

B03 網址維持 `/shops/:slug/products/:sku`；sku 可以是 group 中任一變體，頁面顯示整個 group 並預選該變體，切換變體時以 `history.replaceState` 換成新 SKU。舊連結繼續有效。

### 1.2 照片

- 每個 group 最多 8 張（同一個 `storefront.product-photo` 用途與大小限制），可另指定某變體的代表照。
- 新表 `commerce_product_gallery_photos`（group、順序、asset 參照、可選的 selection），沿用 141 的 asset FK 模式；發布時凍結到新表 `commerce_publication_gallery_refs`。
- 公開路徑另加一個 schema（例如 `/shops/:slug/media/:revision/:sku/:n`），既有單張路徑不變。

**2026-10-20 C1 商品圖組本機候選（schema177，未部署）**：採 lazy groups；未編輯圖組的自有商品視為一成員 group，沒有 backfill。新增 `commerce_product_groups`、`commerce_product_group_members`、`commerce_product_gallery_photos`、`commerce_publication_galleries` 與 `commerce_publication_gallery_refs`。141 指標仍是唯一主照片來源；新照片列使用 2–8 的 secondary slots，讀取與發布轉成連續次序。主照片說明綁定其 asset／representation／scope／policy tuple digest，舊版替換主照片不會錯套舊說明。沒有 live-selection FK 或舊版寫入同步 trigger；移除商品保留 group、成員、照片及歷史參照。

店主可新增、上移／下移、設為主照片、移除，以及填選用的照片說明（trim 後最多 120 個 Unicode code points，拒絕不完整字串、控制字元及 bidi 控制字元）。空白說明以「商品名稱，第 n 張，共 m 張」顯示。既有裝置端縮圖、2 MiB 輸入、1 MiB／1920px WebP 輸出、結果未知原操作重試、保留配額與 `readVerifiedObject` 都沿用；新 target kind 是 `storefront.gallery-photo`，purpose 仍是 `storefront.product-photo`。最多 200 件 × 8 張的現有照片上界為 1,677,721,600 bytes（1,600 MiB）；這不是容量 entitlement，歷史照片、Work、封面／店標及未完成上傳仍受既有兩層儲存政策限制，沒有調高任何政策或實際配額。

商品頁有整張大圖與縮圖連結，可用鍵盤、螢幕閱讀器或無 JavaScript 橫向捲動；每張圖片都有尺寸，首張 eager，其餘 lazy。商品卡片、主打、OG 與商店備用封面只使用主照片。供貨合作商品的買家頁仍只顯示可用的 D-11 店主副本，沒有副本就顯示尚未提供照片；供應商明確分享的 offer 照片仍僅供私人評估，不會自動進入買家頁，也沒有供貨商品圖組編輯。變體軸／切換、代表照與分類仍是後續切片。

### 1.3 分類

`commerce_storefront_categories`（最多 30 個、名稱 ≤ 40 字、排序）與 `commerce_storefront_category_members`（category、group、排序）。一個 group 可在多個分類。

### 1.4 匯入與匯出

E04 提供 CSV 匯出與匯入：先驗證並顯示差異（新增／修改／不變／錯誤，逐列原因），確認後以一個命令套用（帶 Idempotency-Key，上限 200 SKU）。檔案是請求本文（≤ 256 KiB），不存成 asset（現有 MIME 白名單沒有 `text/csv`）。只能修改自有商品；供貨商品的價格只能改自己的售價。

## 2. 店面內容與發布

### 2.1 新增的店面內容

| 內容 | 表（提議） | 說明 |
| --- | --- | --- |
| 外觀 | `commerce_storefront_appearance` | 主色代號（8 組之一）、封面 asset、店標 asset、公告列（≤ 80 字）、主打 group（≤ 8）、區段開關；EC-SPEC-01 §4.2 |
| 賣方揭露 | `commerce_storefront_seller_profiles` | 營業名稱、聯絡 Email、聯絡電話、地址或寄件聯絡方式、客服時間；依適用法規由商家據實填寫，平台不代為認證 |
| 政策 | `commerce_storefront_policies` | 種類 `shipping`／`returns`／`privacy`／`terms`；每次修改產生新版本（不可改），純文字 ≤ 10,000 字 |

封面與店標需要新的 asset 用途（例如 `storefront.cover`、`storefront.logo`），比照 141 新增 purpose、大小與 profile。

**2026-10-20 賣方資訊與政策 C1 本機候選（schema176，未部署）**：本切片以兩張 draft pointer 表
`commerce_storefront_seller_drafts`／`commerce_storefront_policy_drafts`，指向不可改的
`commerce_storefront_seller_versions`／`commerce_storefront_policy_versions`，取代本節提議的兩張合併表。
每次有變更的儲存只為變更的項目新增版本；正規化後未變更不新增內容列或推進 profile 版本。
每店的賣方與每種政策各有稠密序號及 500 版上限；沒有清理或刪除歷史的工作。
所有欄位由店主自行填寫，沒有會員或公會資料預填。營業名稱在任一賣方欄位非空時必填；
其他賣方欄位在 C1 選填，統編只驗 8 位半形數字。政策為最多 10,000 個 Unicode code points 的純文字。
`returns.window_days` 可空或 7–3650，`return_by_days` 為 1–3650、預設 14；只顯示，不執行售後規則。
隱私的代出貨說明勾選隨版本保留；既有供貨價接受不是代出貨同意，正式履約同意模型仍未實作。

### 2.2 發布

發布命令（既有 `publishStore`）在同一交易內多寫一列 `commerce_storefront_publication_catalogs`：

- `publication_id`（PK、FK 到 publication）、`profile='freedom.storefront-catalog/v1'`、`document`（groups、選項、分類、外觀、政策版本 ID、賣方揭露）、`document_sha256`。
- 不可改；dirty 判斷加入這個 digest，與現在的 projection、template、media 一起比。
- v1 projection 照舊產生與驗證，公開 JSON `GET /api/v1/public/stores/:slug` 不變。

回退相容：舊版本只讀 v1 projection，看不到附加內容但能正常顯示；舊版本發布的新 revision 沒有附加列時，新版本退回「每個 SKU 一個 group」的顯示，不報錯。

**2026-10-20 店面外觀本機候選（schema175，未部署）**：本次只實作外觀切片，新增 `commerce_storefront_appearance_drafts`、`commerce_storefront_appearance_targets`、`commerce_publication_appearances` 與 `commerce_publication_appearance_refs`。既有版型與主色／公告／主打 ID 以同一個 `PATCH …/appearance-settings`、profile `If-Match` 與冪等鍵保存；封面／店標各有明確的上傳與移除命令，同樣使用 profile 版本。公告最多 80 個 Unicode 字元；主打最多八件自有、零售啟用的商品，候選清單上限 200 與既有 product_limit 相同。供貨選品主打、分類、變體、政策、賣方揭露與 §2.3 條件不在本次範圍。

§2.1 提議的新 purpose 實作為既有 `storefront.product-photo` 下的封閉 `storefront.cover`／`storefront.logo` target kinds：共用已知 profile、配額與備份，以維持舊版計數／還原相容；不替換 asset purpose/admission/policy/profile 基線。封面與店標需要既有照片安裝條件，上傳另需既有 upload predicates、封閉 port 與資料庫政策；主色、公告與主打沒有媒體依賴。店標限定方形，不提供裁切。

這份獨立的 `freedom.hosted-store-appearance/v1` sidecar 不冒充上述完整 catalog 文件；其 canonical digest 加入第四個 dirty／發布去重維度，與原 projection／template／media 一起比較、同交易凍結後切換 current publication。v1 projection 與 `GET /api/v1/public/stores/:slug` 保持原樣。預覽只讀已儲存草稿；公開頁只讀目前發布的外觀。過時或移除的草稿主打可保留設定，但新發布只顯示該 projection 中的商品，不洩露其他商品名稱。

`FREEDOM_STORE_APPEARANCE_ENABLED` 預設 OFF，`/api/v1/site` 提供 `store_appearance_enabled`。OFF 不掛新路由、不查外觀、不刪資料；舊版形狀的讀寫可忽略 sidecar，舊版新發布沒有 sidecar 時，新版回預設外觀。封面替換／移除不刪舊物件與歷史 refs，也不釋放保留配額。這是本機候選，沒有正式環境開關、部署、hosted CI 或真人驗收宣告。

**2026-10-20 賣方資訊與政策發布切片（schema176，未部署）**：獨立
`freedom.hosted-store-policies/v1` 文件凍結到 `commerce_publication_seller_policies`，政策版本另外以
`commerce_publication_policy_refs` 的複合 FK 固定租戶、商店與種類。只凍結已儲存版本 ID／digest，
未修改的 ID 重用；第五個 dirty／發布去重維度與原四維度同交易切換。沒有 seller 或政策也能發布。
v1 projection 與公開 stores JSON 不擴欄。About、目前政策與歷史政策 HTML 都為 noindex／no-store；
歷史政策僅允許曾在同店發布的非空版本，不公開未發布草稿或歷史賣方版本。公開頁不顯示含草稿的序號，
只顯示首次發布時間與目前／歷史版本。舊版 binary 忽略 sidecar；舊版發布沒有 sidecar 時，新版保持舊頁尾、
新資訊路徑回共同 404。`FREEDOM_STORE_POLICIES_ENABLED` 預設 OFF，site 另加 `store_policies_enabled`；
OFF 不查政策表、不掛路由或 namespace guard，保留 host assets 既有 SPA fallback，且不刪資料。
這不實作本節完整 catalog 文件、買家 consents、訂單政策連結或下一節的任何結帳門檻。

**2026-10-20 商品圖組發布切片（schema177，未部署）**：獨立 `freedom.hosted-store-gallery/v1` 文件與 typed refs 在同一次發布交易凍結，第一張必須與既有 `commerce_publication_photo_refs` 相同；gallery digest 是第六個 dirty／發布去重維度。產品選擇版本的 CAS 與同一 profile boundary 序列化照片／發布；私有多次查詢也共用 profile read lock。預覽讀已儲存草稿，公開頁只讀同店目前 publication。unpublish 不刪資料，republish 才凍結目前草稿；沒有 gallery sidecar 的舊版 publication 合成既有 frozen singleton，絕不讀目前草稿補圖。

`FREEDOM_STORE_GALLERY_ENABLED` 預設 OFF。依 appearance／policies 的 site 慣例，`GET /api/v1/site` **永遠輸出** `store_gallery_enabled`；OFF 時為 false，這是 OFF site JSON 唯一新增欄位。OFF 不查五張 gallery 表、不掛新照片／namespace 路由，原單張編輯器、店面／商品／購物車／結帳／訂單／About／政策 HTML、公開 stores JSON、既有 media JSON 與單張照片路徑保持原行為與 bytes。新的多段 media 路徑與未知尾段保留 host 原 SPA fallback；`shops.css` 與既有 storefront script entry 不變。關閉旗標不刪圖組，舊 binary 仍可讀寫主照片。舊版移除主照片後留下的 secondary rows 只顯示保留通知與「設為主照片／移除」，GET 或發布不自動修復。

### 2.3 開放結帳的條件（C2）

店家設定 `checkout_enabled` 只有在下列都成立時才能打開，任何一項之後失效，新的 checkout 立即停止（已成立的訂單不受影響）：

1. 有已發布的店面，且賣方揭露與 `shipping`、`returns`、`privacy` 政策都已發布。
2. 至少一個可用的收款方式：已驗證、環境相符的收款帳戶（EC-SPEC-04），或店家的匯款或面交付款設定（EC-SPEC-11 §8）。
3. 至少一個可用的配送設定（EC-SPEC-05）；可以只有面交取貨（EC-SPEC-11 §2.2）。
4. 發票設定完成或明確標示不適用（EC-SPEC-06）。
5. 平台的 commerce 開關與該店的准入（EC-SPEC-10 §2.3、§2.5）。

`commerce_shops` 上 hosted 列的 `accepting_orders=false`、`mode='test'` 約束不動；新的開關獨立。

## 3. 優惠（C2 基礎）

- 種類：訂單金額折抵固定金額、訂單百分比（最多 2 位小數的 bps）、指定 group 的固定金額或百分比。
- 條件：期間、最低消費、總使用次數上限；以代碼或自動套用。C2 每單最多一個優惠，不疊加。
- 結算單位 u：TWD＝100 minor（整數元）、USD＝1 minor，凍結在 terms 的 `settlement_unit_minor`。綠界收款、退刷、發票與折讓都只收整數新臺幣（EC-SPEC-04 §2），所以 TWD 的折扣也以整數元計算。
- 百分比折扣：折扣總額＝商品金額 × 百分比，無條件捨去到 u（實際折扣不超過標示的百分比），畫面顯示的是捨去後的金額。
- 分攤：折扣依行項金額比例分到各行，最大餘數法以 u 為單位決定性分配，結果凍結在 checkout terms（退款、發票、供應商對帳都用這份）。
- 供貨價不變：折扣由賣家吸收，不改 offer 的 cost（EC-SPEC-06 §5）。
- 不能把任何行項折到 0 以下；免運優惠留到 C4。

## 4. 顧客、guest 與訂單存取（DC08）

### 4.1 顧客

- `commerce_customers`：tenant／instance、`customer_id`、正規化 Email（店內唯一）、`email_verified_at`、可選 `member_principal_id`、建立時間。顧客屬於這間店，不是平台會員。
- 會員登入下單時，訂單填 `buyer_principal_id`；guest 下單時為空。「本人的訂單」只依 `buyer_principal_id` 與存取憑證判斷（§4.2），不依顧客記錄的會員連結。
- 顧客記錄的會員連結只是給賣家看的標示：只在這筆顧客記錄還沒連結、而且會員帳號已驗證的 Email 與顧客 Email 相同時建立。其他情況不連結，也不擋下單（例如家人共用一個 Email）。連結建立後不清除、不改連別人。只知道某個 Email 不能讓人取得任何連結。
- 不自動建立會員、不加入公會。
- 聯絡、收件、發票資料放在 EC-SPEC-03 的 `commerce_checkout_contacts`（以 checkout 為鍵、每次修改新增一列），不放在顧客記錄；顧客記錄只有 Email。

### 4.2 訂單存取憑證

| 憑證 | 形式 | 有效期限（提議） | 用途 |
| --- | --- | --- | --- |
| 瀏覽器憑證 | `__Host-freedom_shop` cookie（HttpOnly、Secure、SameSite=Lax、Path=/），值是 256-bit 隨機值；伺服器只存 SHA-256 | 180 天，可撤銷 | 這個瀏覽器建立或兌換過的訂單 |
| 信件連結 | `/shops/:slug/orders/:order_ref#access=<token>`；fragment 不送到伺服器，頁面以 POST 兌換成瀏覽器憑證後清除網址 | 7 天、只能兌換一次 | 換裝置、遺失 cookie |
| 會員 session | 既有 | 既有 | 會員自己的訂單 |

- 新表 `commerce_access_devices`（瀏覽器憑證雜湊、建立／到期／撤銷；不屬於任何店）與 `commerce_order_access_grants`（店、checkout、可選的 order；device 或 link；到期、兌換、撤銷）。不記最後使用時間：讀訂單不寫資料庫。
- 建立或重播 checkout 時，伺服器確保這個瀏覽器有憑證（沒有或已失效就發新的，到期日固定、不延長），並建立「這個 device 可以使用這個 checkout」的 grant；這就是下單需要的 checkout 憑證。重播只在 checkout 未到期、也還沒有訂單時發 grant；否則回 409 `checkout_expired`，不發憑證，所以「忘記」之後，留下的冪等鍵不能把讀單權找回來。兌換信件連結時建立只限那張訂單的 device grant。
- 「在這個瀏覽器忘記我的訂單」撤銷這個 device 並清除 cookie；之後只能用信件連結或會員身分讀單。
- 讀取任何訂單都以「店家＋訂單＋有效 grant 或本人會員」判斷；查不到一律回不揭露的 404。顯示用編號與 `order_ref` 都不是憑證（EC-AT05）。
- B10：`POST /api/v1/public/stores/:slug/order-access-requests`（Email＋顯示用編號）一律回 202；相符時寄信件連結。限流比照活動 guest：每網路每小時 10、每 Email 每小時 3、全域每小時 300。真的寄信需要寄送授權；授權前只在測試環境用 fixture sender（EC-SPEC-10 §6.2、§6.4）。
- 會員可在登入狀態下把持有憑證的 guest 訂單「關聯到我的帳號」（C2 之後，選用）。

### 4.3 顯示用訂單編號

格式 `YYMMDD-XXXXXX`（6 個 Crockford Base32 字元，店內唯一，碰撞時重抽）。只給人看、給客服對照，不能用來讀單。

### 4.4 資料保存

個資只在需要的地方出現（EC-SPEC-01 §7.5）。保存期限與遮罩見 EC-SPEC-09 §3（DC12 的建議預設，待 Ted 確認）：訂單各軸線結束且售後期限屆滿後 180 天，整份聯絡、收件與發票資料一起遮罩；帳務與發票必要欄位保留。實際法定期限由商家與專業人士確認，不在程式寫死。

## 5. 購物車報價與 checkout

### 5.1 共同規則

- 所有公開命令先走 `readPublicStorePage` 的存活檢查（tenant、模組、owner、deployment binding）。
- 只接受 JSON，沿用預設 32 KiB 與 Origin 檢查；新的公開路徑不需要 Origin 例外（都是同站瀏覽器請求）。
- 價格、折扣、運費、總額都由伺服器算；瀏覽器送的價格一律忽略（EC-AT08）。
- 金額欄位都是整數最小單位，帶幣別。
- TWD 的單價、運費與固定金額折扣在賣家後台以整數元輸入。既有 API 仍接受兩位小數（不改 v1 契約），但 terms 裡任何 TWD 金額有零頭時，綠界付款方式不提供（EC-SPEC-04 §2），賣家後台的開店檢查列出這些商品或運費設定。

### 5.2 `POST /api/v1/public/stores/:slug/cart-quotes`

不保存、不占庫存、不需身分。

- 輸入：`publication_revision`、`lines[{sku, quantity}]`（1–50 行、每行 1–99、SKU 不重複）、可選 `promotion_code`、可選 `delivery`（方式與地區，用來試算運費）。
- 輸出：目前 revision；逐行 `{sku, title, options, unit_price_minor, quantity, line_total_minor, state}`，`state` ∈ `ok`／`insufficient`（附可購買上限）／`unavailable`／`revision_changed`；`merchandise_total_minor`、`discounts[]`、`shipping`（每個配送群組的運費或「需要配送資料」）、`total_minor`（運費未定時為 null）。
- 可售量以唯讀方式計算：N − 未到期的 held − 未結配置（EC-SPEC-03 §2），不在公開 GET／報價時寫入或結算過期保留。
- 逐行判斷：某個供貨來源不能賣（不在同一社群、停用、未設定）時，只有它的行是 `unavailable`；店本身不能賣才整張報價失敗。`merchandise_total_minor` 只加總 `ok` 與 `revision_changed` 的行；有任何一行是 `insufficient` 或 `unavailable` 時，`total_minor` 也是 null。
- 限流：每網路每分鐘 60、每店每分鐘 600（EC-SPEC-09 §4）。

### 5.3 `POST /api/v1/public/stores/:slug/checkouts`

- Header `Idempotency-Key`：至少 128 bits 的隨機值（伺服器只存雜湊）。同 key 同內容重播回同一 checkout，並對同一個瀏覽器重新設定憑證（條件見 §4.2）；同 key 不同內容回 409。內容比對不含會員身分：登入或登出後重送仍是同一個 checkout，保留第一次的買家，與下單的重送相同（§5.4）。因為 key 能取回 checkout，它被視為秘密；前端在下單成功後就丟掉它。
- 輸入：revision、lines、`contact{email, phone, name}`、`delivery`（宅配地址，或以選店 session 附上的門市，EC-SPEC-05 §3.5～3.6）、`invoice`（EC-SPEC-06）、`consents[{policy_kind, policy_version_id}]`、可選 `promotion_code`。
- 伺服器重算並凍結 terms：行項價格、選項、來源、折扣分攤、配送群組與運費、稅務顯示、總額、政策版本、付款方式清單；`terms_sha256`。不可配送或不可售直接 422 並指出行項（EC-AT12）。
- 回傳：`checkout_ref`、terms 的公開視圖、`terms_sha256`、`expires_at`（checkout 本身 24 小時有效，供保留過期後重新下單用）。公開視圖只有行項、折扣、配送群組的運費、總額、政策版本與付款方式；不含供貨來源、選品與庫存項目等內部 ID、listing／offer 雜湊，也不含聯絡資料的摘要（EC-SPEC-09 §2.7）。`terms_sha256` 仍是完整凍結 terms 的雜湊；瀏覽器只把它原樣送回下單。
- 店家未開放結帳時回 409 `checkout_not_enabled`（C1 的 B05 依此顯示「尚未開放線上付款」）。

### 5.4 `POST /api/v1/public/stores/:slug/checkouts/:checkout_ref/orders`

- 需要該 checkout 的 device grant（§4.2）。checkout 不記錄建立者，所以會員 session 本身不能代替 grant；下單時若有會員 session，訂單記下 `buyer_principal_id`。輸入 `terms_sha256`、`client_order_id`（UUID）；同一 checkout 內 `client_order_id` 就是冪等鍵，重送回同一張訂單。
- 依 EC-SPEC-03 §4.1 在一個交易內建立訂單、行項、sidecar（指向 checkout 目前的聯絡資料列，不另外複製聯絡資料）、全部保留與第一個付款 attempt；回傳訂單投影與付款交接資訊。
- 同一 checkout 已有未付款且付款結果未定的訂單時回 409，附該訂單的 `order_ref`（EC-SPEC-03 §4.3）。

### 5.5 保留庫存的濫用防護

匿名建立訂單會占 30 分鐘庫存。線下付款的訂單占用數天，另有只限會員與每店上限（EC-SPEC-11 §3.3）。限制（EC-SPEC-09 §4，以測試與 staging 觀察校準）：

- 每個瀏覽器憑證、每個 Email，在同一家店同時最多 3 張未付款的有效訂單；超過時回 429 並說明，`Retry-After` 是最早到期那張的剩餘秒數。上限以店為範圍：別人用你的 Email 在其他店下單擋不住你，回應也不透露你在其他店有沒有訂單。網路不寫進訂單（不保存由 IP 推導的資料），所以網路的上限用限流 bucket 近似：每網路每 30 分鐘（保留的時效）最多新建 3 張訂單。
- 每網路每 10 分鐘最多 10 次下單；每店全域每 10 分鐘 300 次。
- 店家可設定單一 SKU 每單上限（≤ 99）。
- 這些數字與實際攻擊情境（例如一個人用多個 Email）列入 EC-SPEC-09 的負面測試。

## 6. 店面程式的位置

- B01–B03、B09、B10、付款交接頁、B06 由 `modules/agent-commerce/hosted/page.ts` 一類的 server renderer 產生。
- B04、B05、B07／B08 用一個獨立的前端入口（Vite 另一個 entry，例如 `apps/portal-web/src/storefront/`），輸出到同一個 `dist`，只載入店面樣式；不載入 portal 的 App、主題、導覽與聊天。
- 公開 HTML 維持 `noindex`（現況）；是否開放搜尋引擎收錄是店家設定，C2 之後再議。
- 公開 JSON 沿用 60 秒快取；cart-quotes、checkouts、訂單讀取都是 `no-store`。

## 7. 權限

| 操作 | 能力 |
| --- | --- |
| 變體、照片、分類、匯入 | `store:write`（既有） |
| 外觀、政策、賣方揭露 | `store:write`；發布需 `store:publish`（既有） |
| 優惠 | `store:write` |
| 開放／關閉結帳 | `store:manage`，並檢查 §2.3 |
| 公開讀取、報價、checkout、下單 | 匿名；訂單讀寫依 §4.2 |

**本切片的明確差異（2026-10-20）**：外觀的所有寫入（含版型、封面與店標）統一要求既有 `store:manage`，沿用現行版型命令的管理邊界，避免商品 `store:write` 自動取得品牌修改權；發布仍是 `store:publish`，草稿與私有圖片讀取仍是 `store:read`。這取代上表對本切片外觀的 `store:write` 提議，不更動商品照片、供貨或其他既有能力，也不宣告政策／賣方揭露已實作。唯讀與僅商品寫入的成員看不到外觀編輯控制，伺服器直接命令也拒絕。

**商品圖組權限（2026-10-20）**：上傳、排序、照片說明、設主照片與移除均要求 `store:write`，並使用產品 selection `If-Match` 與 `Idempotency-Key`；`store:manage` 或 `store:publish` 單獨不授予照片寫入。私有草稿／圖片與預覽為 `store:read`，唯讀成員看照片且沒有編輯控制。發布仍為 `store:publish`；公開圖片只接受目前同店、同 revision、同 SKU 的 frozen refs，其他商店、未發布草稿與越界次序共用 404。

新能力名稱（訂單、出貨、收款等）在 EC-SPEC-09 §2；都需要新的 storefront 模組版本（`storefront@1.0.0` 的能力清單是凍結的，`migrations/134_hosted_storefronts.sql:88`）。


**賣方資訊與政策的明確權限差異（2026-10-20）**：整節原子儲存採 `store:manage`，
與現行「商店介紹／商店說明與聯絡」及外觀的管理權限一致。賣方身分是零售責任聲明，
商品 `store:write` 不授予這項權限。草稿讀取與已儲存預覽仍需 `store:read`，發布仍需
`store:publish`；不增加能力鍵，不改訂單、供貨、付款、准入或 readiness 的規則。
這明確取代上表對本次政策／賣方揭露的 `store:write` 提議。

## 8. 測試（全部 not_run）

| 案例 | 要證明 |
| --- | --- |
| 變體與庫存 | 兩個變體各自庫存；一個售完時另一個仍可買；10 件 6＋5 在變體上一樣成立 |
| 發布凍結 | 發布後改商品、分類、政策，公開頁不變；再次發布才更新；舊 revision 的報價回 `revision_changed`（EC-AT06） |
| 回退 | 只有 v1 projection 的 publication 照常顯示；舊版本讀新 publication 不報錯 |
| 價格篡改 | 送假價格、假折扣、假運費都被忽略（EC-AT08） |
| 整數與幣別 | 折扣分攤的最大餘數結果固定；總額＝各行＋運費－折扣（EC-AT09） |
| guest 回查 | 本人用 cookie 或信件連結讀得到；換訂單編號、猜 `order_ref`、拿別店憑證都讀不到（EC-AT05） |
| 匿名不被入會擋 | 未登入未入會可加購物車、走到結帳；後台頁仍拒絕（EC-AT04） |
| 不可配送 | 受限商品與門市服務不相容時在付款前擋下（EC-AT12） |
| 濫用 | 同一網路、Email、瀏覽器超過未付訂單上限時被拒，且不留下保留 |
| Idempotency-Key | 同 key 重播回同一 checkout；不同內容 409；回應遺失後重試不建立第二筆 |

## 9. 待決

| 項目 | 影響 | 預設 |
| --- | --- | --- |
| 200 SKU 上限是否足夠 | 有很多變體的店 | C1／C2 維持；需要時開 v2 契約 |
| 瀏覽器憑證 180 天 | 回查便利 vs. 共用電腦風險 | 180 天，訂單頁提供「從這個瀏覽器移除」 |
| 是否允許 guest | 已提議允許（DC08） | 允許 |
| 限流數值 | 濫用與正常使用 | 本文件數值，EC-SPEC-09 以測試校準 |
