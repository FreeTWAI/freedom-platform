# tester-map

人才與方向公會社群測試週（2026-10-26 至 2026-11-01）的「測試員地圖」。志工選擇 A–E 小組後，照分關任務一步步測試平台功能：每一步寫明開哪裡、試什麼、確認什麼，以及怎麼用「想法」回報。完成步驟與關卡可獲得勳章。下方保留完整功能清單、負責小組與測試狀態。

## 負責範圍

- 模組 ID：`tester-map`；維護角色：`community`（不是 GitHub 寫入權或業務授權）。
- 頁面：會員區 `#tester-map`；未登入時同一個 `/#tester-map` 以公開頁呈現，從「自由工坊社群」頁連入。
- `areas.ts`：測試區、功能、A–E 小組，以及 2026-10-25 在公開 `/api/v1/site` 觀察到的旗標開關。功能名稱依介面順序附五種語言。
- `coverage.ts`：每項功能的狀態（未測／測試中／已測／有問題）。「有問題」必須附公開 GitHub Issue 編號。
- `service.ts`：純函式，負責驗證、統計與依小組篩選。
- `quest.ts`：8 個關卡、各步驟的五語說明與 A–E 建議路線。每一步都對應 `areas.ts` 的功能；預設關閉的功能只留在清單裡。
- `progress.ts`：未登入的本機進度，鍵名 `freedom-tester-map-progress-v1`；防禦性解析，寫入失敗不影響操作。勳章一律由私人進度推導，不是正式驗收、XP、獎勵或職務證明。
- `account.ts`：帳號進度聯集、嚴格回饋驗證與純彙總規則；`account-service.ts`／`repository.ts`：會員交易、版本比對及 PostgreSQL 讀寫。
- 登入時合併本機進度到帳號；未登入只用本機。帳號進度只給本人；每步可選回饋與公開匿名報告見 [COORDINATION.md](COORDINATION.md)。
- `apps/portal-web/src/modules/tester-map/`：帳號同步與五語回饋／報告 UI。`TesterMap.tsx` 只接入 hook、狀態與步驟元件，保留其他 PR 的分享接線空間。
- 不做排行榜、計分、致謝牆或公開稱號，不使用 migration 194 的公開成就資料。

## 更新方式

1. 測試狀態一律用 PR 更新 `coverage.ts`，一次改一項。不要寫姓名、Email、截圖或其他個資。
2. 新增或調整任務步驟時，`features` 只能填 `areas.ts` 的功能 ID；測試會檢查每個可測功能都有步驟、每關都有步驟。
3. 平台新增頁面、`modules/development/pages.ts` 頁面 ID 或 `/api/v1/site` 旗標時，在 `areas.ts` 補上對應功能與 `coverage.ts` 狀態。`tests/runtime/tester-map.test.ts` 會核對 TabId、開發頁面 ID 與 site 旗標，漏掉任何一項都會失敗。
4. 公開網站旗標改變時，更新 `TESTER_FLAGS` 與 `TESTER_FLAGS_OBSERVED_AT`。
5. 回報管道沿用每頁的「想法」頁面工具（建立 GitHub Issue）。站內檢舉（`member_reporting`）未開放，不能列為回報方式。

```sh
node --import tsx --test tests/runtime/tester-map.test.ts
npm run typecheck
npm run module:check
npm run build
npx playwright test tests/e2e/tester-map.spec.ts
```

模組 metadata 與測試通過，不代表功能已上線、已驗收或已部署。

## #1213 回饋處理與新手入口

`ownership.ts` 明列功能與 owning module id；`quest.ts` 明列步驟與功能，不依名稱猜測。報告提供 `modules → features → steps`、通過／問題數及每步最多 100 筆未修好問題及最近 5 筆其他匿名項目，保留既有功能彙總。`GET /tester-map/report?module=<id>` 只接受 allowlist 內模組。

未發布的 migration 198 加入隨機 `feedback_id`、`status`、`issue_number`、`triaged_at`。`POST /tester-map/report/triage` 接受 `{feedback_id,version,status,issue_number}`（seen／issue／fixed；issue 必須有正整數編號），寫入仍需目前平台開發正式會員資格及社群隔離；command 重播仍重查權限，receipt 只存 ACK，journal 只記匿名 row id 與處理狀態。Issue 編號一律保留；結果改成 pass 且原狀態為 issue／fixed 時保留狀態，其餘內容修改重設 sent（處理時間清空）；相同內容重送保留狀態。

私人進度只給本人；所有人可讀匿名回饋報告，不投影測試者身分或穩定化名。頁面提供一鍵通過、有問題的選填單行說明、狀態 chip 與簡短致謝。無進度時顯示三步開始卡及開啟第一步的按鈕；參與自願、不計分、不排名。未動 promotion.ts 或分享入口（#1214）。此為 source candidate，未部署。

## 2026-11-04 #1215 修補決策

訪客進度只存在這個瀏覽器；登入後進度私人保存到帳號。Jason 決定所有回饋報告（含說明原文）公開且匿名，請勿填個資；沒有測試者身分、穩定化名或帳號資料。私人 done/group 僅本人可讀。回應 can_triage 只控制操作呈現，伺服器仍檢查目前建造者資格。

每模組同一步只附到排序第一個功能，feature_ids 列出同模組其他對應功能。模組 passed/problems 由唯一的步驟加總，完整功能人數是各功能獨立統計，不能跨功能加總。每步／功能最多 100 筆未修好的 problem，優先顯示，再附最近 5 筆其他項目（功能 issues 的其他項目限 fixed 問題）；完整總數不受顯示上限影響。

version 是 updated_at 與 triaged_at 的組合摘要（不含身分），在 FOR UPDATE 鎖內比對；新操作過期回 409 tester_feedback_conflict，已成功的同 key 重播仍回原 ACK。UI 衝突後提示並重讀；確定的 4xx 解除表單鎖，未知結果保留同 key 重試。

沒有新增 migration 或 schema。198 尚未發布，本輪僅修正原本宣稱 feedback 私人的註解；SQL 定義不變，整合仍須依主線決定 migration 編號。
