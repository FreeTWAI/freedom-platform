# 2026-10-19 供應商／電商會員資格主線整合交接

這是具日期的本機候選證據，沿 [#234](https://github.com/FreeTWAI/freedom-platform/issues/234) 與
[#889](https://github.com/FreeTWAI/freedom-platform/pull/889) 的[既有有限啟用工作線](work-plan.md)收尾。
不取代 [Foundation 現況入口](../unified-foundation/closeout.md)，也不宣告部署或真人驗收。

## 固定來源與交付

- 基準：`main@10ad8d2d9db105fbc102a24481fda52140182c0f`（含 #910）。
- 工作分支：`integration/commerce-cohort-531ad028-20261019`。
- 功能提交：`cfb2cd91643954dbf67a1d7d17e53a03721c5f91`。
- 恢復流程修正：`bc9f05848e33bfa3a9aa993241847e2ab8addc02`；下列最終建置與恢復流程驗證固定此來源。
- 工作樹：`/home/thuang/agent-work/fp-commerce-cohort-main-531ad028`。

本批將原本機 `b23cfeb1` 的供貨準備入口與 `85c40a86` 的會員規則移到已合併主線，
並把交易測試改接 schema172 已有的付款／面交功能。保留 #909 的店家品牌優先店面。
沒有新 migration，也沒有引入原 `feat/functional-completion-531ad028` 的 schema173–201、
發票／政策設定或新物流 provider。原工作樹停在 `91d3de9a`，不應整支合入主線；
遷移保存的 patch／stash 未套用。

## 會員實際行為

1. 商品品質與供應公會的所有 active 成員（含 intern）可以從舊版入口或已發布的 v2 供貨區塊，建立自己的供貨目錄。電商公會仍須 active full 才能首次開零售店；別的公會正式身分不能替代。（2026-10-20 起電商公會 intern 也可以，見文末〈2026-10-20 電商公會實習成員開放〉。）
2. 目錄資格、產生方案與啟動使用相同規則；第一次供貨／零售建檔在生命週期與資料列等待之後再次檢查。供貨安裝本身不代表有零售開店資格。公會身分不授予其他事業的資料、庫存或店家准入。
3. 既有事業繼續依 tenant／instance 授權處理商品與訂單，後來的公會變動不會刪除工作或直接停止履行既有義務。其他應用維持原正式會員規則。
4. 供貨概覽將新增商品、素材授權、供貨申請、合作與預留串成明確入口；空目錄才展開初始步驟。讀取失敗不視為零，唯讀協作者不顯示編輯引導。
5. 啟動在交易內確定被會員資格拒絕時，不再保留為未知結果。會員資格恢復後可重新產生方案；真正未知回覆與提交後才發生的讀取授權錯誤仍保留原操作。

會員同意測試的範圍依 Ted 已確認的兩個公會，不再另找一批具名受邀者。
這項同意與建立資格不等於交易准入或真人完成驗收。

## 實跑驗證

所有帳號、商品、銀行資料及准入管理員都是隔離本機合成資料。
日誌、畫面與 JSON 收據位於 `/home/thuang/agent-work/fc-functional-completion-531ad028/`，
本批檔名前綴為 `cohort-integration-`。

| 檢查 | 實際結果與來源 |
| --- | --- |
| `npm run typecheck`、`npm run build` | 初輪與最終 `bc9f0584` 均通過；每輪 browser 均在相應 build 之後執行。 |
| Runtime | `hosted-store-offering`、`hosted-supply-catalog`、`hosted-store`、`guild-blocks` 共62項通過；registry runtime role、workspace 等待／降級、原 full-member 行為及 unavailable-only catalog 另7項通過。共69個不同案例。API／領域來源在後續純前端修正中未改。 |
| 契約 | `npm run check:guild-launchpad-contracts` 通過。 |
| 第一輪 browser | `cfb2cd91` 的7項通過：供貨 S1、供貨引導／讀取失敗、跨事業慢回覆、唯讀權限、v2 intern 入口、正式電商會員開店、真實准入下的離線交易。 |
| 最終 browser | `bc9f0584` 的5項通過：供貨 S1 加入真 API 資格拒絕與恢復、v2 intern 入口、會員正式開店、原啟動回覆遺失、提交後授權錯誤恢復。兩輪共9個不同案例，不把重跑相加為新案例。 |
| 畫面 | 已讀供貨引導320／1440px、店主面交390px與主線公開店面截圖；瀏覽器另核對390／768／1440px適用畫面及橫向溢位。 |
| 治理 | `npm run test:governance` 在兩次乾淨功能提交均618項通過；最終來源為 `bc9f0584`。 |
| Worker | `npm run worker:dry-run` 的 local／staging-next／next 三次均通過，沒有部署。 |
| Context | 固定基準 prepare 讀齊198 chunks／194 sources，baseline／candidate 規則齊備，完整性檢查通過、無 blockers；這是 local assurance。 |
| 來源與文件 | `bc9f0584` 的 `verify-source-boundaries.py --event push` 本機檢查通過：5149個受追蹤檔、171個既有 migration SQL 不變、1762個本機連結無錯。事件參數不是已 push 的證據。inventory 核對5148 hashes通過；交接文件另作提交前路徑與雜湊核對。 |

Runtime 使用 `node --import tsx --test --test-concurrency=1`；registry 篩選為
`runtime role completes|runtime role sees|two launches on one workspace|demotion while|full member still launches|unavailable-only catalog`。
第一輪 browser 選取 `SC-E2E-01|supplier preparation|SC-E2E-30|SC-E2E-52|guild_product_quality_supply leader|ordinary seller UI|registered intern obtains`；
最終選取 `SC-E2E-01|guild_product_quality_supply leader|registered intern obtains|lost launch response|post-commit authorization error`。
沒有增加 timeout 或 retry，也沒有使用舊工作樹的 dist。

真實 SQL 准入案例驗證：店主在 UI 設定匯款／現金與面交；准入前公開商品不可下單，
由非該 tenant 成員的合成本機管理員透過既有 admin API 准入後，買家下單、回訪，
店主在 UI 確認收款與交貨。撤銷准入後，新單被拒，舊未付款訂單仍可取消且釋回庫存；
兩個 admin audit 與兩個控制事件一致，公開商品頁沒有銀行帳號。未使用允許全部店家的 admission stub。
店主確認收款不等於平台核實銀行入帳。

首次 context refresh 與 inventory 更新重疊而被拒；凍結檔案後重讀通過，原失敗 log 保留。
來源檢查最初缺參數，補齊後又因新工作樹根目錄可被群組寫入而拒絕；只將自己的新工作樹根改為755，再通過檢查，沒有修改 verifier。

本輪 PostgreSQL 容器 `fp-commerce-cohort-main-531ad028` 與同名前綴的 `-data` volume
已於2026-10-19 20:31 UTC移除；移除前測試 schema 與其他連線均為0，移除後依本輪 label 確認零殘留。
收據為 `cohort-integration-cleanup.json`。

## 既有發布線的下一步

以這個 main-based 分支做精確來源 review／適用 CI 與整合，不必重開供貨／結帳專案。
本輪沒有 push、建立 PR、merge、部署或變更線上資料與旗標。

讀到的 [#234 19:33 UTC整合對帳](https://github.com/FreeTWAI/freedom-platform/issues/234#issuecomment-6262757310)
記錄兩環境已部署 `12940c71`／schema172，Supplier／Commerce console ON，checkout／Email OFF；
本批 `10ad8d2d` 基準及上述新提交不能套用該部署收據。這是沿用具日期的 root 對帳，本輪未另登入正式環境核實。

Root release owner 依 #889 接續已同意會員的實際店家、付款／面交設定、安裝版本及全部未撤銷准入對帳，
再完成既有有限啟用與會員實際操作。供應商與店主自行完成、真實商品素材及非開發買家的理解仍需實際證據；
本機合成流程不能代替。原真人、跨供應商履約與 provider 未驗項保持原責任，不升為此次候選的新前置。

## 2026-10-20 同步 main

這段記錄 main 前進後的重新整合，不改上列已記錄的結果。

- 新工作分支：`integration/commerce-cohort-20261020`。由 `02dd8ca9`（上列兩個提交與本文件）合入
  `main@e0f510c34eb605e5a395b6d239316df677776768`，合併提交為 `93dbcf2f6e0d4d7ed8a4a7033f5734fbb4007b08`。
  合併訊息修正前的 `35fe9ec9` 是同一個 tree（`56150917`），部分檢查在那一版執行。
- main 帶入 #911（`240cf677`：店家公開服務資訊，Seller console 不再依賴 Supplier console 開關）與 #912（上線紀錄）。
- 三個衝突：
  - `tests/e2e/storefront-cart-fixture.ts` 的 `CartControls` 同時保留 `realAdmission` 與 `supplierConsoleEnabled`，後者預設與 `offline` 相同。
  - `tests/e2e/storefront-offline-checkout.spec.ts` 合成一條店家旅程。Supplier console 關閉時，店家發布公開服務資訊、設定匯款／面交並完成訂單；下單仍經真實 SQL 准入：准入前不能下單，撤銷後拒絕新單，舊單仍可處理。
  - inventory 依兩邊聯集重算，共 5152 筆。
- 仍然沒有新 migration、API 或旗標變更。

| 檢查 | 實際結果 |
| --- | --- |
| `npm run typecheck`、`npm run build` | 通過；browser 都在這次 build 之後執行。 |
| Browser | `storefront-offline-checkout`、三個 `supplier-console*`、`guild-block-composition` 共 28 項通過；另以名稱選取 8 項通過，其中 `guild-launchpad-applications` 的兩項恢復流程與 `hosted-store-member-journey` 的 intern 開店不在上列檔案，共 31 個不同案例。沒有增加 timeout 或 retry。 |
| Runtime | 受影響的 105 個 runtime 檔（`--test-concurrency=1`）在本段提交時仍在執行；至 04:28 UTC 已通過 978 項、0 失敗。最終結果記在 PR。 |
| 全套 `npm test` | 同時在另一個一次性資料庫執行，本段提交時尚未完成（至 04:28 UTC 已通過 1370 項、0 失敗）；最終結果記在 PR。 |
| 契約 | `test:contracts` 的 pytest 969 項通過。本機沒有系統 pytest，改用 uv 安裝 `requirements-static.txt` 固定版本執行同一命令。`check:guild-launchpad-contracts` 通過。 |
| 治理 | `npm run test:governance` 618 項通過。 |
| Worker | `npm run worker:dry-run` 的 local／staging-next／next 三次都通過，沒有部署。 |
| Inventory | `verify:inventory`：5152 hashes、1772 個本機連結、0 failures；`git diff --check e0f510c3` 乾淨。 |
| 模組歸屬 | 以全部 descriptors 跑 selectImpact，沒有新增無主路徑。 |
| Context | `prepare --base-ref e0f510c3` 產生 144 chunks／140 sources，`--check complete` 通過、無 blockers。整合者逐一核對本分支改動的規則（agent-commerce、module-registry、guild-supply README 與 module-registry descriptor），其餘與 main 相同的規則沒有逐片重讀。 |

本輪 PostgreSQL 是一次性容器 `fp-pg-575bc725`（磁碟 volume，trust auth 只綁 127.0.0.1）；日誌在
`/home/thuang/agent-work/fc-575bc725/logs/`。沒有部署、沒有變更旗標或線上資料，也沒有使用共用的本機開發資料庫。

## 2026-10-20 電商公會實習成員開放

這段記錄 PR #916 審查期間的範圍更新與 CI 修正。上列「會員實際行為」第 1 點中「電商公會仍須 active full」已由本段取代，其餘結果不變。

- 範圍：detna-vibe-coding 在 [#916](https://github.com/FreeTWAI/freedom-platform/pull/916#issuecomment-6283552687)
  轉述 owner 最新指示：「電商的也開放, 因為都沒人在 approve.」開放對象是供應商與電商兩個公會的 active intern／full 成員，
  電商成員不必等升為 full 才能開始自己的零售設定。這調整的是首次設定資格；不升等會員、不改管理員權限，也不放寬店家資料權限。
- 規則仍集中在 `modules/module-registry/membership.ts`，目錄資格、產生方案、啟動，以及首次 `/setup`、`/supply-profile` 都用同一份規則：

| 入口 | 資格 | 拒絕碼 |
| --- | --- | --- |
| 供貨：商品品質與供應公會頁的 `hosted-store` | 供應商公會 active intern／full | `guild_member_required` |
| 零售：其他公會頁的 `hosted-store`、首次 `/setup` | 電商公會 active intern／full；任何公會頁都用同一碼 | `commerce_guild_member_required`（取代 `commerce_guild_full_member_required`，電商公會頁也不再改用 `guild_full_member_required`） |
| 首次 `/supply-profile` | 供應商或電商公會 active intern／full | `guild_member_required` |
| 其他應用（含 talent 與 `manual-workspace`） | 該公會 active full | `guild_full_member_required` |

- 不能冒用：`left` 會籍、別的公會或別的社群的會籍、別人的會籍都不算；跨 tenant 的方案與啟動回 404 `tenant_not_found`，跨 instance 的讀取與設定回 404 `not_found`。
- 不變：店家准入、checkout、付款與既有交易責任。intern 開的店在獨立管理員准入前不能下單，准入後才可結帳；撤銷後拒絕新單、舊單仍可處理。
- 畫面：電商公會 intern 的主要動作改為「建立我的商店」，由伺服器資格決定是否可按；訪客在電商與供應商公會頁看到「先加入這個公會，實習成員也可以開始設定。」
- 契約：`contracts/guild-launchpad/v1/module-registry.ts` 與 `tenant.ts` 的 enum 改名，沒有保留舊碼別名；產生的 schema 不列這個 enum，重新產生後沒有位元差異。
- 驗證腳本 `scripts/verify-cloud-candidate-supplier.ts` 只把兩個現行拒絕碼視為「合成帳號不符資格」而略過；本輪沒有對遠端執行。

### 提交

f4bd0257 的 CI 診斷修正（只改測試）：

- `ee2e4a19`：`guild-launchpad-profiles.spec.ts` 的 supplier intern 改為斷言可「開始供貨設定」；`guild-launchpad-applications.spec.ts` 切到零售工具的案例補電商會籍。
- `a43e0e8e`：route-matrix「T-022 4」的 P／N／O／M 在迴圈內補電商會籍（`ON CONFLICT DO NOTHING`），原 eligibility 與跨 tenant／外洩斷言全部保留。
- `ff002fe5`：offline checkout 的稽核計數限定為本店 admission，預期值仍為 2。

電商實習成員開放：

- `001a4762` feat(commerce): let commerce guild interns start their own retail setup
- `07a88f0a` test(commerce): preserve independent admission for intern-owned stores
- `dfd5cb2a` docs(commerce): describe the two guild cohorts for first setup
- 本段文件與 inventory 的提交。

### 驗證

本段所有帳號、商品、銀行資料與准入管理員都是隔離本機 PostgreSQL 上的合成資料。

| 檢查 | 實際結果 |
| --- | --- |
| `npm run typecheck`、`npm run build` | Codex 與整合者分別在 `dfd5cb2a` 執行，都通過；browser 都在 build 之後執行。 |
| 契約 | `npm run check:guild-launchpad-contracts` 通過（30 個 v1 schema、15 個 bundle、1 個 v2 assembly）；`contracts:guild-launchpad` 重新產生沒有差異。`test:contracts` 的 pytest 969 項通過（同上段，用 uv 安裝固定版本）。 |
| Runtime（整合者，各檔單獨執行） | `hosted-supply-catalog` 19、`hosted-store-offering` 12、`hosted-store` 30、`commerce-store-admissions` 2、`tenant-route-matrix` 72、`module-registry` 13、`module-registry-review` 93、`guild-blocks` 10，共 251 項通過、0 失敗。 |
| Runtime（Codex） | 第一次 focused run 32 項通過、1 項失敗：新跨 tenant 案例把資料庫的 digest 字串直接送出，API 先回 422；修正請求格式後該檔單獨 19 項通過，預期的 404 與錯誤碼未改。較大的 64 檔批次在本段提交時仍在執行，結果記在 PR。 |
| Browser（Codex） | 八個檔案（`guild-launchpad-profiles`、`guild-launchpad`、`guild-block-composition`、`guild-launchpad-applications`、`hosted-store-member-journey`、`supplier-console`、`storefront-offline-checkout`、`cloud-candidate-supplier`）在最後 build 前後各跑一次，都是 106 項通過；同一組案例，不相加。 |
| Browser（整合者） | `guild-launchpad-applications`、`guild-launchpad-profiles`、`hosted-store-member-journey`、`cloud-candidate-supplier`、`storefront-offline-checkout` 共 96 項通過（7.4 分鐘）。沒有增加 timeout 或 retry。 |
| 畫面 | 已看電商公會 intern 的主要動作與整頁截圖（1280／390px）：「成員身分：實習成員」、「建立我的商店」與交易未啟用提示清楚；手機只有一個滿寬主按鈕，沒有橫向溢位。 |
| Hosted CI | `ff002fe5` 的 22 項 check 通過、2 項 skipped（含 ui-e2e）。 |
| 模組歸屬 | 以全部 descriptors 跑 selectImpact，沒有新增無主路徑。 |
| Context | Codex 以 `prepare --base-ref ff002fe5` 讀齊 150 chunks／146 sources，`--check complete` 通過、無 blockers；這是 local assurance。 |

上段「同步 main」記為執行中的兩項：受影響的 105 個 runtime 檔最終 1952 項中 1951 項通過，唯一失敗是 `T-022 4`，由 `a43e0e8e` 修正後單檔 72 項通過；全套 `npm test` 的結果記在 PR。
本段沒有部署、旗標或線上資料變更，也沒有對遠端執行部署驗證腳本。
