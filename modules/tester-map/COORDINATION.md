# 測試員地圖：#1213 第一個 PR

本次明確派工承接 #1213 最新方向，並依 #1086／#1132 的「可選、不排名、隱私不外洩、沒有黑箱配對」原則實作。下列決策取代本文件先前的排行榜提案與手動上傳提案；不授予合併或部署權限。

- 登入後，自動將本機進度聯集合併到帳號；步驟白名單、去重與固定順序由伺服器決定。同一登入世代重試使用原 Idempotency-Key。成功後才消耗已匯入的訪客紀錄，不將帳號紀錄寫回訪客 localStorage。
- 未登入仍維持原本本機流程。帳號進度與勳章只給本人；勳章由進度與小組推導，不另存成就、分數或稱號。
- 可選的每步回饋只保存 account id、step id、pass/problem、最多 200 字單行純文字與伺服器時間。步驟對應功能由 `quest.ts` 推導，不接受任意 feature id、身分、網址、附件或額外欄位。提醒不要填個資；純文字驗證不能保證使用者沒有輸入個資。
- 測試報告沿用 `activeDevelopmentGuilds(..., 'platform')` 的目前正式會員資格、社群隔離與鎖定規則。一般會員與訪客不能讀報告。每個功能每人只算一次，相關任一步有問題就不算通過；分母只含有提交回饋的人，未回饋的進度不算通過。最多顯示最近五個問題，不回傳測試者身分。
- 公開 Issue 僅預填既有頁面工具「想法」對話框。使用者先搜尋既有 Issue、檢查個資並明確送出；不自動發布，不因回饋建立任何 GitHub 寫入資格。
- 這輪不做排行榜、計分、致謝牆或公開稱號。未來若提公開稱號，另案遵循 migration 194 `social_achievement_*` 同意規則。

## Schema 與 API

暫定 migration `198_tester_map_accounts.sql`，整合時依 main 最高編號重新決定，並同步 migration catalog。兩表：`tester_map_accounts`（本人進度、小組、併發版本）、`tester_map_feedback`（本人／步驟唯一的當前回饋）。帳號實際刪除時 cascade；清除操作清空本人進度與回饋，保留版本以拒絕舊修改。無歷史回饋副本；既有 command receipt 只保存 ACK 與請求摘要，不保存說明文字。

| 方法／路徑 | 用途 |
| --- | --- |
| `GET /api/v1/me/tester-map` | 只讀本人進度、勳章來源與回饋，及報告入口資格 |
| `POST /api/v1/me/tester-map` | `merge`、`progress`、`feedback`、`clear`；會員 session、Origin／CSRF、Idempotency-Key；merge 以外需 If-Match |
| `GET /api/v1/tester-map/report` | 同社群、目前平台開發正式會員可讀的彙總 |

所有回應 private/no-store；寫入每帳號每分鐘最多 120 次。Node 與 Worker 共用 `createPlatformApp`、PostgreSQL／Hyperdrive，沒有 D1 schema 或第二套路由。先套 migration 再切換來源；沒有新旗標或正式設定變更。回退需停用這些路由；DROP 兩表會遺失紀錄，依既有備份政策處理，不修改歷史 migration。

## 驗證入口

```sh
npm run typecheck
npm run check:runtime-text
TEST_DATABASE_URL=<isolated-local-fp-database> node --import tsx --test --test-concurrency=1 tests/runtime/tester-map*.test.ts
npm run build
TEST_DATABASE_URL=<isolated-local-fp-database> npm run test:e2e -- tests/e2e/tester-map.spec.ts tests/e2e/tester-map-account.spec.ts
```

測試使用合成資料，命令列不代表已執行；實際結果見交付記錄。此 source candidate 不代表已部署、真人試用或正式功能驗收。
