# 陪跑主線狀態契約（#1066，PR 1/3）

依 Issue #1066 的 Jason 補充與 Ted 最後留言，先交付純 TypeScript 狀態政策與 runtime 測試。
本輪沒有 migration、schema、API、頁面或 UI；不預留 migration 編號，不代表已部署或正式成果驗收。
原規格見[陪跑模組 §9.4–9.8](../../docs/platform-plan/04-module-specifications.md#94-配對與容量)。

## 1. 自願與角色邊界

免費、志願流程為「選一條路 → 自選真人 → 完成一個小任務 → 卡關求助」。可不參加、可略過，
不影響其他模組資格，不做排名或與他人比較。引路人由會員自選；篩選理由須可解釋，不能黑箱配對。

- 真人服務標示「真人引路人」。#1054 站內助手提供問路／功能說明；NPC 僅為可略過的呈現方式，不能承諾真人時間或名額。
- #1046 tester-map 勳章只依瀏覽器本機進度計算，沒有跨模組後端核發表／API／稱號契約。共用機制待協調，獎勵不阻擋核心 MVP。
- UI PR 的手機「我卡住了」入口須放目前任務旁，說明「卡關不扣分、不公開」；更換真人用語是「申請更換」，由人工處理，不承諾即時自助轉換。
- 陪跑小隊沿用既有小隊概念；本契約不變更其入口、功能或發布狀態。普通清單可獨立使用，不以 NPC、LINE／Discord、稱號或付款為前提。

## 2. 章節、任務與轉移

`MAINLINE_CHAPTERS` 固定 `week1`（第1週）、`week2`（第2週）、`day30`（第30天）。
這是分組與節奏提示，不是期限，不按逾時扣分或依日曆鎖定。實際任務內容由後續版本定義；本輪沒有虛構正式任務目錄。
任務 ID 為 1–64 字元小寫英數／底線／連字號，以英文字母開頭，全目錄唯一。
前置參照整份目錄，可跨章節與向後宣告；全部前置須滿足。拒絕未知參照、重複參照及循環（含自身）。

| 狀態 | 語意 |
| --- | --- |
| `locked` | 前置尚未滿足，系統推導，會員不可直接寫入或操作 |
| `available` | 前置已滿足且尚無操作紀錄，系統推導 |
| `in_progress` | 會員自願開始／恢復 |
| `pending` | `submitted`：會員已送出、等真人引路人確認；或 `waiting`：會員選擇等待。兩者皆未完成，不滿足前置 |
| `done` | 第一階段會員自述完成，非正式成果確認；不代表引路人已確認 |
| `skipped` | 會員自願略過，不扣分，排除進度分母；**滿足前置**，避免選擇略過反而擋住後續 |

允許的動作與轉移只有：

| 來源 | 動作 → 目標 |
| --- | --- |
| `available` | `start` → `in_progress`；`wait` → `pending(waiting)`；`skip` → `skipped` |
| `in_progress` | `submit` → `pending(submitted)`；`wait` → `pending(waiting)`；`self_report_done` → `done`；`skip` → `skipped` |
| `pending`（兩種原因） | `resume` → `in_progress`；`self_report_done` → `done`；`skip` → `skipped` |
| `locked`／`done`／`skipped` | 無手動轉移；本版不提供重新開啟，避免已解鎖相依倒退 |

所有任務皆可自願略過，但須先可用。第一階段不提供真人 `confirm` 動作；等候中的會員仍可自述完成，
這個操作只表示本人回報，不能當成引路人背書。確認身份與權限不是純函式的工作。
紀錄只存 `in_progress`／`pending`／`done`／`skipped`；未知任務、非法狀態、缺 pending 原因、
前置未滿足卻有紀錄，都拒絕。函式回傳新值、不修改輸入、不做 I/O。

## 3. 本人進度與完成邊界

`done / (全部任務 − skipped)`，分母包含 locked、available、pending、in_progress 與 done。
空目錄或全部略過時分母為零，`fraction = null`，不可顯示 100%。略過不是失敗，也不算 done。
當全部任務為 done 或 skipped、且至少有一個 done，才允許會員另行 `selfReportMainlineStage1Done`。
因此百分比 100% 不會自動完成階段；`stage1_done` 只表示第一階段本人自述，該 run 不再接受任務轉移。

摘要僅供會員本人，`audience = member_only`；不含他人資料、排名、求助內容或扣分參數。
卡關／求助是私人 support 訊號，與任務 lifecycle 分開，不能扣分或自動淘汰。
純函式不建立讀取授權：未來接入服務須在每次讀取驗本人身份，不能把此標記當 ACL。
第二階段 Result candidate 尚未接入，摘要固定 `resultCandidate = unavailable`。
本契約不建立 Result、正式完成、XP、報酬、勳章或 coach 成果；Result candidate 與正式 confirmation 仍需後續獨立契約。

## 4. Schema PR 的必要條件（Jason 第 5、6 點，尚未實作）

5. **隱私落到資料與直接讀取規則。** 沿用 `member_squads.kind='coaching'`（047），enrollment／checkpoint 另表。
   同社群關聯須由 composite FK／約束保障；coach scope 須綁開始時間、當前有效 enrollment 與目前引路人，
   只讀必要 profile／目標／進度，不能因 roster 曾顯示就授權。退出、換人、撤回 evidence 分享後，
   詳情、evidence 與其他直接讀取入口皆重驗當前權限；換人前資料是否可分享須明確同意，不能默認全歷史可讀。
   求助預設僅本人可讀；分享給真人前須明示具名對象、最少內容與同意範圍，不自動通知引路人，不進公開名冊、排行榜或社群通知。
   Schema PR 須有跨社群 FK 反例、scope 時間界線、退出／換人／撤回後直接讀取拒絕及競態測試。
6. **真人名額跨模組共用（§9.4）。** Guild／Squad／Program 共用同一 principal 的具時窗容量來源，
   志願及付費皆須真人已接受，不能只靠 coaching 表內跨 program 互斥。
   Schema PR 須定義共同容量來源與候補、暫停、退出、換人、重送的原子保留／釋放及冪等規則，
   以並行測試證明不重複承諾真人時間。無名額仍可讀公開資源與發出不保證回覆的求助。

以上是下一份 PR 的設計與驗收條件，不是已發現的實作漏洞，也不是本輪已交付的資料庫能力。

## 5. 草案取捨與已核對來源

輸入為 DRAFT-mainline-state-contract 與 Issue #1066 的提供快照。草案仍有待核定提案；本契約採題定的六種狀態與三章節，
將草案的 skipped 留分母改為排除。所有任務可略過並滿足前置，避免略過成為後續任務的懲罰；
不採草案的必做／可選區分或恢復 skipped。`done` 定義為本人自述，並非真人確認；pending 與 stage1_done 均不代表正式 Result。
這是本 PR 的明確政策，不宣稱草案已核准此細節。後續 enrollment 必須釘選任務版本，不可靜默改圖或分母；版本載體與更正／重做歷史留 schema PR 定義。

Jason 五點分別落於：第 1 節的真人／助手區分、本機勳章限制、手機任務旁求助；第 2–3 節的主線狀態與階段界線；第 4 節的資料隱私。
§9.4 共用容量補充亦列為 schema PR 條件。

已核對本 worktree 的下列來源：

- [047 coaching kind](../../migrations/047_squad_coaching_channel.sql)、[146 小隊種類](../../migrations/146_squad_management_and_kinds.sql)與 [squad kinds](../../packages/shared/squad-kinds.ts)：沿用 coaching；現有種類仍包含 social，不能把 membership 當 enrollment。
- [154 同社群 FK](../../migrations/154_squad_outcomes.sql)：可參照複合約束；authored outcomes 獨立於 private Results、attendance／XP。
- [tester-map progress](../tester-map/progress.ts)：勳章由本機 done 推導，非中央核發。
- [§9.2–9.8](../../docs/platform-plan/04-module-specifications.md)：member choice、容量與 scope 是設計條件，文件中的端點不代表已有實作。
- [Foundation 收尾入口](../../docs/platform-plan/execution/unified-foundation/closeout.md)：source／部署／原 168 項未驗狀態沿現況快照與證據索引；本 PR 不變更其完成狀態。

純函式測試不涵蓋 DB ACL、容量競態、API、真人接受、瀏覽器或部署。契約 → schema → UI 的三 PR 切分，與第一階段／第二階段 Result 接線是不同界線。
