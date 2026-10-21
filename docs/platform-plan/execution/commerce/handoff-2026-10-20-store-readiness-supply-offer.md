# 2026-10-20 開店準備與供貨方案頁整合交接

這是具日期的本機候選證據，接在 [#916](https://github.com/FreeTWAI/freedom-platform/pull/916) 的公會成員資格之後，
沿 [#234](https://github.com/FreeTWAI/freedom-platform/issues/234) 與 [#889](https://github.com/FreeTWAI/freedom-platform/pull/889)
的[既有有限啟用工作線](work-plan.md)。不取代 [Foundation 現況入口](../unified-foundation/closeout.md)，
也不宣告部署或真人驗收。功能說明見 [commerce 工作計畫](work-plan.md)與
[Supplier Console 工作計畫](../supplier-console/work-plan.md)的 2026-10-20 段落；這裡記錄整合與整合者的獨立複驗。

## 固定來源與交付

- 整合分支：`integration/commerce-store-supply-20261020`。基準是 #916 的 `9b8aab3a`，已含 main `3a6e2506`。
- 開店準備：`feat/commerce-store-readiness-20261020` 的 12 個提交（`06f30a75` 至 `c14a6c93`），起點 `93dbcf2f`。
- 供貨方案頁：`feat/supply-offer-page-20261020` 的 8 個提交（`45be469e` 至 `8b6d9245`），起點 `93dbcf2f`。
- 合併：`7523cea4`（開店準備）、`ca6a7b79`（供貨方案頁）、`f53d3551`（#916 的 `9b8aab3a` 與 main）、
  `2dc2c68d`（供貨方案頁的時間格式修正）、`35db7702`（開店準備的契約測試修正）。
- 兩個功能分支只在本機，沒有另外 push；審查與合併都以本整合分支為準。

## 店主與平台管理員看到的

1. 店主後台的「開店準備」（`GET /api/v1/tenants/:tenant_id/storefronts/:instance_id/overview`，Commerce console 開啟時才掛載，需 `store:read`）列出八項：
   發布商店、可售商品、商店說明與聯絡方式、商店版本、付款方式、交付方式、平台開放確認、平台接單服務。
   每項有狀態、下一步與既有設定頁的連結。「目前已開放接單」直接呼叫買家下單用的同一個判斷
   （`publicPurchaseStateWithClient`），清單只是引導，不新增買家端條件。有 `store:orders:read` 時另顯示
   進行中、待確認收款、待處理問題三項訂單數，超過 99 顯示 99+。
2. 平台管理的「商店准入」（`GET /admin/api/commerce/store-readiness`，公會啟動台開啟時才掛載）列出社群內所有商店，
   包括未設定、暫停與尚未就緒的，並附上目前環境的有效准入；摘要涵蓋整個社群，不受分頁影響。
   准入與撤銷仍走原本的獨立管理員命令。頁面可下載 `freedom.commerce-scope-receipt/v1` JSON 收據：
   會讀完所有頁，超過 20 頁（1,000 間）或頁間的環境、版本、摘要有變動就不產生。
   收據和兩個讀取回應都不含 email、銀行帳號、戶名、分行或聯絡內容；`@` 只出現在 `module_release_ref`。
3. 店主在供貨目錄按「查看供貨方案」，會開 `#/stores/<tenant>/<instance>/supply-offers/<offer_id>`
   （`GET …/supply-catalog/:offer_id`）。頁面依序是商品與供貨版本、以 TWD 標明的逐件成本、出貨與退貨條件、
   合作方式、供應商同意的範圍，以及三種販售方式目前能不能用。供應商後台的預覽與這頁共用同一份呈現。
   申請採用、改價與停止採用沿用原本的命令與收據；店主看得到供應商最新的不同意理由。
   - 展示：供應商同意且店主發布後才會出現在展示頁；還沒申請時顯示「供應商同意後可加入」。
   - 預留：沿用既有的供應商預留設定與發布版本檢查。供應商沒有公開商店時，回 `unknown`。
   - 結帳：「供貨商品需要供應商的代出貨同意，這項功能尚未開放。」

## 不變與已知限制

- 沒有新 migration、旗標、provider、RLS policy 或部署。准入、checkout、付款的門檻不變。
- 「商店准入」每次讀取都會走過所有 tenant。以一間有一項自有庫存商品、提供面交的商店量測：
  完整開店準備 51 次 SQL，買家判斷 16 次。只有當頁商店計算完整準備，頁外的摘要只用買家判斷。
  試辦規模可以接受；商店數變多時要再處理。
- 收據是逐頁讀取的觀察，不是原子快照；開放接單前仍要當下複核。
- 供應商沒有公開商店時，現有的賣家可讀資料無法證明它的預留資格，所以回 `unknown`；
  要正確判斷需要另外審查的 schema 工作，本批沒有放寬跨 tenant 讀取。
- 代出貨同意的模型尚未實作，供貨商品不能結帳。店主向供應商批發買入並自行持有後，
  可以作為自己的庫存商品上架，使用自己的收款與面交設定。
- 建議售價、結構化的最低訂量與交期、採用前的供應商照片仍待後續。

## 合併處理

- `7523cea4`：`storefront-offline-checkout.spec.ts` 的稽核計數保留 #916 `ff002fe5` 的寫法，只計本店的 admission。
  route matrix 移除開店準備分支在 fixture 層補的電商會籍，沿用 #916 `a43e0e8e` 在迴圈內的補法。inventory 重算。
- `ca6a7b79`：`HostedStore.tsx` 同時保留供貨方案頁的路由與賣家後台連結。route matrix 的路由數合併為
  admin 11、tenant 128、middleware 17、selected 177。移除供貨方案分支在 fixture 層補的電商會籍。inventory 重算。
- `f53d3551`：`platform-app.ts` 自動合併，#917 的 Short 播放器 `frame-src` 與 `short_videos_enabled` 和本批的路由並存。
  唯一的衝突是 inventory，依合併後的 tree 重算為 5180 筆，每筆都是受追蹤檔案。
- `2dc2c68d` 與 `35db7702`：各帶一個修正提交，沒有衝突；inventory 與重算結果相同。

## 整合時發現並修正的兩個回歸

兩項都是整合者在合併後的 109 個 runtime 檔批次中發現的；兩個功能分支各自的驗證沒有跑到對應的檔案。
`npm run check:guild-launchpad-contracts` 只比對產生的位元組，抓不到這兩類問題。

1. 供貨方案頁的三個 `published_at` 原本用 `z.string().datetime()`，產生的 JSON Schema pattern 含 `\d`，
   違反 `tests/runtime/guild-launchpad-contracts.test.ts` 的 ASCII 字元類別規則。`8b6d9245` 改用
   `storefront.ts` 已在用的 `IsoTimeSchema`，重新產生 `hosted-distribution`、`hosted-supply-terms`、
   `supplier-console` 三個 schema。伺服器用 `toISOString()` 輸出 UTC 毫秒時間，新舊寫法都接受。
   接受範圍有變：改為只檢查格式，會接受 `+08:00` 這類時區與格式正確但不存在的日期，
   小數秒最多九位，也不再有 `format: date-time`。這些都是讀取回應的欄位，不影響任何寫入命令或權限檢查。
2. 開店準備在 `hosted-commerce-setup` bundle 新增 `store-readiness`、`store-overview`、
   `admin-store-readiness-query`、`admin-store-readiness-page` 四個定義，但
   `tests/runtime/hosted-commerce-setup-contracts.test.ts` 逐一列出所有定義的樣本沒有跟著補。
   `c14a6c93` 依路由實際回應的形狀補上四個合成樣本，保留每個樣本的額外欄位與 `null` 拒絕案例。

## 實跑驗證

所有帳號、商品、銀行資料與准入管理員都是隔離本機 PostgreSQL 上的合成資料。
驗證用的一次性資料庫與 e2e port 不和其他工作共用；browser 都在該回合的 build 之後執行，沒有增加 timeout 或 retry。

日誌在 `/home/thuang/agent-work/fc-575bc725/logs/`，四個整合回合的檔名前綴分別是 `vi-`（`ca6a7b79`）、
`vf-`（`f53d3551`）、`vg-`（`2dc2c68d`）、`vh-`（`35db7702`）。`vi-` 用 `fp_integ575`／`fp_integ575e2e` 與 port 4879；
`vf-`、`vg-`、`vh-` 依序使用 `fp_integ575b`／`fp_integ575be2e` 與 port 4880，沒有同時執行。

| 檢查 | 實際結果 |
| --- | --- |
| `npm run typecheck`、`npm run build` | 四個回合都通過；browser 都在同一回合的 build 之後執行。 |
| 契約 | 四個回合 `npm run check:guild-launchpad-contracts` 都通過（30 個 v1 schema、15 個 bundle、1 個 v2 assembly）。`vg-` 與 `vh-` 重新產生後沒有差異。`vg-` 掃描 45 個 schema 檔的 1230 個 pattern，沒有禁用的字元類別。`test:contracts` 的 pytest 在 `vi-`、`vf-`、`vg-` 都是 969 項通過。 |
| Runtime（`vi-`，109 檔一次執行） | 2018 項中 2016 項通過（約 75 分鐘）。只有上面兩個回歸失敗：`guild-launchpad-contracts` 的 ASCII 字元類別規則與 `hosted-commerce-setup-contracts` 的 bundle 樣本。兩者修正後分別在 `vg-` 與 `vh-` 單檔通過。 |
| Runtime（`vf-`，各檔單獨執行） | `tenant-route-matrix` 72、`commerce-store-readiness` 5、`commerce-store-admissions` 2、`hosted-supply-offer-page` 6、`hosted-distribution` 7、`hosted-store-offering` 12、`hosted-supply-catalog` 19、`seller-console-route` 26、`admin-access-session` 16、`platform-admin` 28、`module-registry` 13、`short-video-embed` 9、`short-video-flag` 2，共 217 項通過。 |
| Runtime（`vg-`，各檔單獨執行） | `guild-launchpad-contracts` 8、`hosted-supply-offer-page` 6、`hosted-distribution` 7、`hosted-store` 30、`supplier-console-state` 87、`supplier-console` 20、`partner-materials-view` 17、`module-registry-schema` 13、`hosted-supply-catalog` 19 全部通過；`hosted-commerce-setup-contracts` 3 項中 1 項失敗，就是上面第 2 個回歸。 |
| Runtime（`vh-`，各檔單獨執行） | `hosted-commerce-setup-contracts` 3（含 66 個 Draft 2020-12 案例）、`guild-launchpad-contracts` 8、`module-registry-schema` 13、`commerce-store-readiness` 5、`commerce-store-admissions` 2、`storefront-presentation-contracts` 4、`platform-admin` 28、`seller-console-route` 26，共 89 項通過。 |
| Browser | `vi-`：17 個檔案共 136 項通過（13.4 分鐘），包括開店準備、離線結帳、賣家後台與設定、平台管理、供貨方案頁、供貨目錄與條件、供應商後台、公會啟動台與會員開店旅程。`vf-`：開店準備、供貨方案頁、離線結帳、公會頁、平台管理與 #917 的三個 Short 檔案共 43 項通過。`vg-`：供貨方案頁、供貨目錄、供貨條件、供應商後台、hosted distribution 與開店準備共 20 項通過。`vh-` 只改測試檔，沒有再跑 browser。 |
| 治理 | `npm run test:governance` 在 `vi-`、`vf-`、`vg-`、`vh-` 都是 618 項通過，每次都在乾淨的已提交 tree 上執行。 |
| Worker | `npm run worker:dry-run` 在 `vi-`、`vf-`、`vg-` 通過，沒有部署。 |
| 模組歸屬 | 以 baseline 與 candidate 的 61 個 descriptors 跑 selectImpact：`vh-` 相對 main `3a6e2506` 共 117 個變動路徑，沒有新增無主路徑；`AdminPanel.tsx`、`admin-client.ts`、`admin-access-session.test.ts` 在 main 上就沒有歸屬。 |
| 來源與文件 | inventory 在 `vf-`、`vg-`、`vh-` 都是 5180 筆，沒有失敗；`git diff --check 3a6e2506` 沒有輸出。 |
| Codex（功能分支） | 開店準備：27 個 runtime 檔 429 項、browser 26 項、治理 618 項、契約 pytest 969 項；修正後 15 個 runtime 檔 143 項通過。供貨方案頁：修正後 8 個 runtime 檔 171 項、browser 3 項通過，並重看 390、768、1440px 的方案頁截圖。完整結果記在兩個工作的本機報告。 |

沒有增加 timeout 或 retry，也沒有使用其他工作樹的 dist。

本批沒有部署、旗標或線上資料變更，也沒有真人試用。
