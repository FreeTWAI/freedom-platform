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

1. 商品品質與供應公會的所有 active 成員（含 intern）可以從舊版入口或已發布的 v2 供貨區塊，建立自己的供貨目錄。電商公會仍須 active full 才能首次開零售店；別的公會正式身分不能替代。
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
