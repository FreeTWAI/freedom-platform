# 測試員地圖：伺服器端進度、勳章與自願排行榜（協調提案）

狀態：**提案，尚未實作，需團隊協調後才能開工**。本文件不授權任何 migration、API、旗標或正式資料變更；合併與上線由 Ted 決定。

## 目前做法與限制

- 分關任務、步驟完成與勳章只存在瀏覽器 `localStorage`（鍵名 `freedom-tester-map-progress-v1`，見 `progress.ts`）。不送伺服器、不建資料表、不讀 session。
- 換裝置或清除瀏覽資料，進度就會消失；任何人都能在本機改值。因此頁面明寫：進度與勳章**不是**官方紀錄、XP、獎勵或貢獻證明。
- 功能測試狀態（`coverage.ts`）仍由 PR 更新，和個人進度無關。
- 排行榜只顯示「規劃中，需團隊協調」，不公開任何人的進度。

## 為什麼需要協調

伺服器端進度會新增會員資料、公開投影與排名，涉及 schema、migration、API 邊界、隱私、旗標與防灌水。依 AGENTS.md 與協作規則，必須先協調。Issue #262 也要求參與指標不得暴露私人內容。既有的 `PromotionBoards`（推廣排行榜）明確不計入經驗或獎勵；`SkillBookBadges` 是技能書徽章，概念不同。兩者都不應被重用成測試勳章。

## 提案資料模型（名稱與編號待協調）

Migration 編號依合併當時主線的下一號決定（撰寫時最新為 `189_hosted_drop_ship.sql`），不得預先佔號。

1. `tester_quest_progress`：每位會員、每個步驟一列
   - `user_id uuid`，參照 `users`，刪除帳號時一併刪除
   - `community_id`：沿用既有社群隔離
   - `quest_version text`：例如 `2026-10-test-week`，任務內容改版時不混算
   - `step_id text`：只接受 `quest.ts` 當時版本的步驟 ID，由伺服器白名單驗證
   - `completed_at timestamptz`，使用伺服器時間
   - 主鍵 `(user_id, quest_version, step_id)`，同一步重送具冪等性
   - 不存自由文字、截圖或回報內容；回報仍走 GitHub Issue。
2. `tester_quest_preferences`
   - `user_id`、`quest_version`
   - `group_id`：只接受 A–E
   - `leaderboard_opt_in boolean`，預設 `false`
   - `leaderboard_alias text`：選填的顯示名稱，長度上限並過濾 Email 與網址
   - `opted_in_at`、`updated_at`
3. 勳章不另建資料表：一律由 `tester_quest_progress` 以純函式推導，與 `progress.ts` 的 `testerMedals` 共用規則，避免兩套來源不一致。

## 隱私與自願參與

- 預設私人：只有本人看得到自己的進度與勳章。
- 排行榜必須本人明確開啟；可隨時關閉，關閉後立刻從排行榜消失。
- 排行榜只顯示 `leaderboard_alias`（或隨機代號）、完成步數與勳章數。不顯示 Email、公會、測試小組、完成時間序列、裝置或任何貼文內容。
- 未登入訪客只能看匿名彙總（每關完成人數，低於門檻例如 5 人時不顯示），不能看個人列表。
- 刪除帳號或撤回同意時刪除對應列；備份保留期間依既有政策。
- 不把進度轉成 XP、等級、報酬或職務證明，也不作為 PR 或貢獻審查的依據。

## API（會員路由放在 `memberBoundary` 之後）

| 方法與路徑 | 用途 | 權限 |
| --- | --- | --- |
| `GET /api/v1/me/tester-quest` | 本人進度、小組、是否加入排行榜 | 會員 session |
| `PUT /api/v1/me/tester-quest/steps/:step_id` | 標記完成（冪等） | 會員 session、CSRF、Idempotency-Key |
| `DELETE /api/v1/me/tester-quest/steps/:step_id` | 取消完成 | 同上 |
| `PUT /api/v1/me/tester-quest/preferences` | 小組、加入或退出排行榜、代號 | 同上 |
| `DELETE /api/v1/me/tester-quest` | 清除本人全部進度 | 同上 |
| `GET /api/v1/tester-quest/leaderboard` | 已同意者的代號、步數、勳章數（分頁、上限 100） | 會員 session；訪客只拿匿名彙總 |

- 回應不含其他會員的 `user_id`。
- 錯誤沿用既有 Problem 格式。
- 本機進度可在登入後由本人確認「上傳這台裝置的進度」，不得自動合併。

## 旗標

- 新增 `FREEDOM_TESTER_QUEST_SYNC_ENABLED`，`/api/v1/site` 回報 `tester_quest_sync_enabled`，預設關閉。
- 排行榜另用 `FREEDOM_TESTER_QUEST_LEADERBOARD_ENABLED`，必須在同步開啟後才可開啟。
- 旗標只由維護者在部署設定開啟，本模組與 PR 不改正式旗標。
- 旗標關閉時，頁面維持目前的本機模式。

## 防灌水

- 每位會員每個步驟只算一次（主鍵）；完成時間以伺服器為準。
- 每位會員每分鐘完成或取消的次數設上限，沿用既有限流。
- 步驟 ID 由伺服器白名單驗證，未知 ID 回 400。
- 同一關的所有步驟在極短時間內全部完成時，只標記為「待確認」，不進排行榜（門檻待協調）。
- 排行榜只排步數與勳章數，不設獎品，並寫明不是官方評比。
- 管理員可隱藏明顯濫用的排行榜代號，操作寫入既有稽核紀錄。

## 不在範圍內

- 不做 XP、等級、金錢或實物獎勵，也不和公會職務、貢獻證明或 PR 審查掛鉤。
- 不把測試回報存進平台；回報仍是公開 GitHub Issue（頁面工具「想法」）。
- 不追蹤瀏覽行為或自動判定步驟完成；完成與否由本人標記。
- 不公開個人進度時間軸，不做跨社群排名。
- 不重用推廣排行榜或技能書徽章的資料與元件。

## 驗收條件（實作時）

- Migration 有正向與回退說明，並以隔離的 PostgreSQL 測試。
- 會員路由測試涵蓋：未登入 401、CSRF 錯誤、未知步驟 400、重送冪等、清除後為空。
- 排行榜測試涵蓋：未同意者不出現、撤回後立即消失、回應不含 Email 或 user_id、訪客只拿匿名彙總且低於門檻時不顯示。
- 旗標關閉時，現有本機進度的行為與 e2e（`TESTER-004`）不變。
