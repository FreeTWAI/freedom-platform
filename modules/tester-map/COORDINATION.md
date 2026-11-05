# 測試員地圖：#1213 第一個 PR

本次明確派工承接 #1213 最新方向，並依 #1086／#1132 的「可選、不排名、隱私不外洩、沒有黑箱配對」原則實作。下列決策取代本文件先前的排行榜提案與手動上傳提案；不授予合併或部署權限。

- 登入後，自動將本機進度聯集合併到帳號；步驟白名單、去重與固定順序由伺服器決定。同一登入世代重試使用原 Idempotency-Key。成功後才消耗已匯入的訪客紀錄，不將帳號紀錄寫回訪客 localStorage。
- 未登入仍維持原本本機流程。帳號進度與勳章只給本人；勳章由進度與小組推導，不另存成就、分數或稱號。
- 可選的每步回饋保存本人／步驟、隨機回饋 id、pass/problem、最多 200 字單行純文字、處理狀態及伺服器時間。步驟對應功能由 `quest.ts` 推導，不接受任意 feature id、身分、網址、附件或額外欄位。提醒不要填個資；純文字驗證不能保證使用者沒有輸入個資。
- 測試報告所有人皆可讀取（包含訪客），沿用 `resolvePublicCommunity` 的站點設定／唯一社群解析；無法決定社群時不回傳任何回饋。只有 triage 沿用 `activeDevelopmentGuilds(..., 'platform')` 的目前正式會員資格、社群隔離與鎖定規則。每個功能每人只算一次，相關任一步有問題就不算通過；分母只含有提交回饋的人，未回饋的進度不算通過。按模組、功能與步驟分組，每步最多顯示 100 筆未修好問題及最近 5 筆其他回饋及處理狀態，不回傳測試者身分。
- 公開 Issue 僅預填既有頁面工具「想法」對話框。使用者先搜尋既有 Issue、檢查個資並明確送出；不自動發布，不因回饋建立任何 GitHub 寫入資格。
- 這輪不做排行榜、計分、致謝牆或公開稱號。未來若提公開稱號，另案遵循 migration 194 `social_achievement_*` 同意規則。

## Schema 與 API

暫定 migration `202_tester_map_accounts.sql`，整合時依 main 最高編號重新決定，並同步 migration catalog。兩表：`tester_map_accounts`（本人進度、小組、併發版本）、`tester_map_feedback`（本人／步驟唯一的當前回饋）。帳號實際刪除時 cascade；清除操作清空本人進度與回饋，保留版本以拒絕舊修改。無歷史回饋副本；既有 command receipt 只保存 ACK 與請求摘要，不保存說明文字。

| 方法／路徑 | 用途 |
| --- | --- |
| `GET /api/v1/me/tester-map` | 只讀本人進度、勳章來源與回饋，及報告入口資格 |
| `POST /api/v1/me/tester-map` | `merge`、`progress`、`feedback`、`clear`；會員 session、Origin／CSRF、Idempotency-Key；merge 以外需 If-Match |
| `GET /api/v1/tester-map/report` | 站點社群公開匿名報告；含原文、結果、狀態、Issue 與總數，以及 can_triage |

所有回應 private/no-store；寫入每帳號每分鐘最多 120 次。Node 與 Worker 共用 `createPlatformApp`、PostgreSQL／Hyperdrive，沒有 D1 schema 或第二套路由。先套 migration 再切換來源；沒有新旗標或正式設定變更。回退需停用這些路由；DROP 兩表會遺失紀錄，依既有備份政策處理，本輪直接編輯尚未發布的 migration 198；已發布的歷史 migration 不變。

## 驗證入口

```sh
npm run typecheck
npm run check:runtime-text
TEST_DATABASE_URL=<isolated-local-fp-database> node --import tsx --test --test-concurrency=1 tests/runtime/tester-map*.test.ts
npm run build
TEST_DATABASE_URL=<isolated-local-fp-database> npm run test:e2e -- tests/e2e/tester-map.spec.ts tests/e2e/tester-map-account.spec.ts
```

測試使用合成資料，命令列不代表已執行；實際結果見交付記錄。此 source candidate 不代表已部署、真人試用或正式功能驗收。

## #1213 回饋處理與新手入口

`ownership.ts` 明列功能與 owning module id；`quest.ts` 明列步驟與功能，不依名稱猜測。報告提供 `modules → features → steps`、通過／問題數及每步最多 100 筆未修好問題及最近 5 筆其他匿名項目，保留既有功能彙總。`GET /tester-map/report?module=<id>` 只接受 allowlist 內模組。

未發布的 migration 198 加入隨機 `feedback_id`、`status`、`issue_number`、`triaged_at`。`POST /tester-map/report/triage` 接受 `{feedback_id,version,status,issue_number}`（seen／issue／fixed；issue 必須有正整數編號），寫入仍需目前平台開發正式會員資格及社群隔離；command 重播仍重查權限，receipt 只存 ACK，journal 只記匿名 row id 與處理狀態。Issue 編號一律保留；結果改成 pass 且原狀態為 issue／fixed 時保留狀態，其餘內容修改重設 sent（處理時間清空）；相同內容重送保留狀態。

私人進度只給本人；所有人可讀匿名回饋報告，不投影測試者身分或穩定化名。頁面提供一鍵通過、有問題的選填單行說明、狀態 chip 與簡短致謝。無進度時顯示三步開始卡及開啟第一步的按鈕；參與自願、不計分、不排名。未動 promotion.ts 或分享入口（#1214）。此為 source candidate，未部署。

先前 #1213 本機驗證（歷史，非本輪結果）：`npm run typecheck`、`npm run build`、`npm run module:check`、`git diff --check` 通過；在另建的本機隔離 PostgreSQL／明確 `TEST_DATABASE_URL` 上，`node --import tsx --test --test-concurrency=1 tests/runtime/tester-map*.test.ts` 27/27 通過，build 後 `npm run test:e2e -- tests/e2e/tester-map.spec.ts tests/e2e/tester-map-account.spec.ts` 9/9 通過。`node --test deploy/cloudflare/test/*.test.mjs` 871/871、`python3 -m pytest -q docs/platform-plan/execution/tools/tests/` 303/303 通過。首次 API／瀏覽器嘗試因未提供 DB 而未執行案例，補建隔離 DB 後通過；瀏覽器首輪 8/9，修正說明文字呈現及精確定位後全數重跑通過。未提交、合併或部署。

## 2026-11-04 #1215 修補決策

訪客進度只存在這個瀏覽器；登入後進度私人保存到帳號。Jason 決定所有回饋報告（含說明原文）公開且匿名，請勿填個資；沒有測試者身分、穩定化名或帳號資料。私人 done/group 僅本人可讀。回應 can_triage 只控制操作呈現，伺服器仍檢查目前建造者資格。

每模組同一步只附到排序第一個功能，feature_ids 列出同模組其他對應功能。模組 passed/problems 由唯一的步驟加總，完整功能人數是各功能獨立統計，不能跨功能加總。每步／功能最多 100 筆未修好的 problem，優先顯示，再附最近 5 筆其他項目（功能 issues 的其他項目限 fixed 問題）；完整總數不受顯示上限影響。

version 是 updated_at 與 triaged_at 的組合摘要（不含身分），在 FOR UPDATE 鎖內比對；新操作過期回 409 tester_feedback_conflict，已成功的同 key 重播仍回原 ACK。UI 衝突後提示並重讀；確定的 4xx 解除表單鎖，未知結果保留同 key 重試。

沒有新增 migration 或 schema。198 尚未發布，本輪僅修正原本宣稱 feedback 私人的註解；SQL 定義不變，整合仍須依主線決定 migration 編號。

### 本輪驗證（2026-11-04，未提交工作樹）

基於 `5f2c4f279a435ad556c18c04a554a80570194601`，分支 `feat/tester-map-account-feedback-1213`；沒有 commit、push、reset、切分支、merge 或 deploy。

| 實跑命令 | 最終結果 |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0；保留大於 500 kB chunk 的建置警告 |
| `npm run module:check` | passed，issues/warnings 為空；只證明 descriptor/source ownership，不是完整授權或 runtime audit |
| `git diff --check` | exit 0 |
| `TEST_DATABASE_URL=postgres://fp@127.0.0.1:55433/fp_test node --import tsx --test --test-concurrency=1 tests/runtime/tester-map*.test.ts` | 32/32，0 failed/skipped/cancelled/todo |
| `TEST_DATABASE_URL=postgres://fp@127.0.0.1:55433/fp_test npm run test:e2e -- tests/e2e/tester-map.spec.ts tests/e2e/tester-map-account.spec.ts` | build 後 Chromium 11/11，0 failed，27.9 秒；設定將 TEST_DATABASE_URL 傳給另建隔離 schema 的伺服器與 fixture |
| `node --test deploy/cloudflare/test/*.test.mjs` | 871/871，0 failed/skipped/cancelled/todo |

回歸包含：117 筆混合回饋的保留上限、同模組多功能步驟去重及總數、真正 FOR UPDATE 等待期間的過期版本拒絕、Issue／fixed 重測歷史、匿名及一般會員讀報告、禁止一般會員 triage、本人進度隔離、設定／不明預設社群、兩個訪客登入入口，以及 422 後修改重送與 409 後提示／重讀。

過程中失敗均保留在本機紀錄：初次 typecheck 缺少登入翻譯；runtime 的舊 Issue 清除預期及未命中同模組映射的測試案例已更正。瀏覽器先為 8/11（跨模組定位器不明確），再為 10/11（409 同時顯示未知結果錯誤）；修正定位器與實際錯誤呈現後完整重跑通過。測試伺服器仍輸出 GitHub provider fixture 警告；不代表真實 GitHub 操作已驗證。沒有跳過案例或把本機結果當成可信 CI、部署或真人驗收。
