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
- 登入時合併本機進度到帳號；未登入只用本機。帳號紀錄只給本人；每步可選回饋與建造者報告見 [COORDINATION.md](COORDINATION.md)。
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
