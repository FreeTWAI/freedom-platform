# Stage 3 協調提案（未實作，不能視為授權或既有能力）

本輪只做 frontend/static；不修改 assessment.ts、schema、migration、API、feature flag 或 production。
以下需跨模組 Issue、需求與隱私審查後另行提 PR，不能從本機紀錄直接匯入正式資料。

## Assessment kind `lifestyle` v4 與 SHA migration

提議獨立 assessment definition：kind `lifestyle`、version `4`，保留原 15 題、
QUESTIONS_V2、DIMENSION_MAP_V2、複選 0.7、同分順序與六軸算法版本。
定義物件需明定 UTF-8 序列化方式並保存 SHA-256，答案引用不可變版本與 digest。
遷移前記錄舊版 SHA、新版 SHA、差異、題目/選項 ID 映射、相容與不可轉換欄位、回退方法。
這裡的 SHA migration 是未來版本資料遷移提案，沒有新增 SQL 或變更現有 assessment。
無法無損對應的回答不能重算或改寫成 v4，須保留舊結果並由本人選擇重做。
需求 ID／migration 編號須由正式協調決定，不杜撰既有需求已通過。

## CareerProfile 三維度與 consent

提議獨立 CareerProfile revision：personality / lifestyle / capability 的
分數、第一候選、同分資訊、baseline、第一週行動、來源 assessment version+SHA、
scoring version、本人修訂內容與結果時間；職業建議不等於經驗或資格。
原始答案、推導結果與本人文字應分開，有最小保存期限、本人查閱、匯出與刪除方案。
需本人明示 opt-in 才可保存到伺服器，預設不分享；同意記錄包含目的、範圍、
接收者、版本與時間，可撤回。教練／小隊的分享要另一次、針對具名對象與欄位同意，
不能因加入公會或完成測驗自動授權，也不能將 localStorage 當伺服器事實。
需先提議 ACL、稽核與 consent 撤回後的分享撤銷政策，再設計 API。

## CoachingProgramVersion「AI 時代定位 30 天」

提議 pinned program version 與 checkpoints：

| 時點 | 本人選擇的產出 | 回顧 |
| --- | --- | --- |
| Day 1 | 三維度反思、生活底線、方向卡 | 確認可投入時間與是否分享 |
| Day 7 | 第一週最小實驗與證據 | 做了什麼、卡點、下一步 |
| Day 14 | 一次使用者／同儕回饋 | 修改假設，不把回饋當診斷 |
| Day 21 | 一項可展示的小成果 | 範圍、來源、驗收條件 |
| Day 30 | 方向卡修訂與下一輪實驗 | 保留／調整／暫停皆可 |

依 04-module-specifications.md §9.4，以 track、program、語言、時區、format、
可用時段與已接受的 capacity 做可解釋篩選；呈現理由、全部可加入選項與本人選擇。
不得以人格分數黑箱配對，不保證 coach、收入或成交；沒有名額提供候補規則、
其他 cohort、peer group 或公開資源。checkpoints 可跳過、可暫停，無懲罰與強迫打卡。
伺服器進度、跨裝置同步、勳章與 cohort 排程另案評估，這份提案不實作它們。
