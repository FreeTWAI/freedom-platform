# 新手村任務（frontend / static only）

公開入口 `#newbie-village`，會員可由「更多功能 → 認識夥伴」進入。
Jason 與 Hao 哥授權此 repo 使用本機 source 的題目與內容；保留作者署名。
來源是 `quiz-v2.html`（15 題、選項、計分、職業與結果示例）、
`framework.html`（三維度）、`tasks.html` / `index.html`（任務脈絡）。
未引入來源的追蹤、截圖、外部腳本、投稿或資料傳輸功能。

## 本機資料與計分

`content.ts` 保存原題、選項、QUESTIONS_V2、DIMENSION_MAP_V2、8 職業、
第一週行動、典型一天、30 天節奏與卡住時刻。
`scoring.ts` 純函式加總選項分數，複選多於一項每項乘 0.7；三維度獨立計算。
同分以原始職業順序決定（content → automation → coach → visual → product → marketing → outsourcer → consultant）。
六軸圖依原作職業 traits 以答題分數加權，最低 1、取至 0.5，不代表實測能力。
頁面可展開每個回答的分數證據，結果只作反思，這不是診斷測驗。

`guilds.ts` 每職業提供一個既有 catalog.ts guildBooks 公會 ID，
理由引用既有公會定義（migrations/002_positioning_guilds.sql），沒有黑箱人格媒合。
`catalog.ts` 是技能書與公會關係來源，公會名稱與 purpose 的權威 seed 位於上述 SQL；
本頁不新增公會、不改既有定義。本人可查看全部公會與小隊，自行選擇。

任務：閱讀框架 → 完成測驗 → 寫方向卡 → 探索公會／陪跑小隊（連結與本人確認）→ 第一週回顧。
`freedom-newbie-village-v1` localStorage 只保存作答、卡片、回顧與勾選，
防禦式解析、版本檢查、文字限長；可清除。儲存失敗時維持記憶體操作並提示。
勳章只是本機完成標記，不是官方紀錄、XP、報酬或入會證據。
剪貼簿只由本人按鈕觸發；失敗可手動複製。
三維度可不同，不替使用者決定職業、不傳教練或伺服器。

框架使用「受 Holland／Schein／優勢發展觀點啟發」的反思描述，
不使用商業測評主題名稱。AI Twist：Talent × AI × Investment = Strength。
作者原始題目與結果文案維持繁體中文，任務操作介面提供五語。

## 驗證入口

- `npm run typecheck`
- `npm run module:check`
- `node --import tsx --test tests/runtime/newbie-village.test.ts`
- `npm run build`
- `npm run test:e2e -- tests/e2e/newbie-village.spec.ts`（既有隔離 PostgreSQL / Chromium harness）

上述是命令入口，實跑結果另外交付；不代表 CI、部署或真人驗收。
未來資料協作僅見 COORDINATION.md，本輪沒有 schema、API 或旗標變更。

## 授權來源指紋（本次本機檔案）

| 檔案 | SHA-256 |
| --- | --- |
| quiz-v2.html | `314e4c1bef1bb3fe94828f4e90553a86eafd2cd669e43838fa66e3c74b2610a4` |
| framework.html | `f01456fd5a6a872a93ba57820bc96d1af102ef566a915f26bd425b551f29e2a1` |
| tasks.html | `ebf555f23536b1ca8af4875b4d7eb34f201bb0e2ff0be5b38da0e65697a983f0` |
| index.html | `18a56c244f5bf484fcb1da340b382b47dd73bf447b3f069647162e57afeca508` |

來源位於作者授權的本機 `/workspace/newbie-village-logs/source/`，不作 runtime 依賴。
原作結果示例照錄，框架只作受啟發的反思改寫，不宣稱心理測量驗證。
