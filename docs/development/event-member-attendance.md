# 主辦人工記錄會員到場

這個切片接續獎品文字說明 #1261。只有目前主辦者能在活動專頁逐人確認會員到場或撤回更正；不是正式完成認定、得獎、交付、付款、XP 或抽獎。沒有訪客身份合併、本人自證、代理記錄者、reviewer 名冊權限、批次全選或通知。

## 狀態與畫面

- 報名仍由 RSVP 的 `going/cancelled` 表示，原 `/attendees`、訪客 DTO 與 `attending_count` 不變。
- 尚未有到場資料時顯示「尚未確認到場」，不是「缺席」。首次記錄後可為 `confirmed` 或 `retracted`；撤回不等於認定缺席。
- 主辦逐人經 inline 確認區送出，只有伺服器 ACK 確認原操作，之後另外重讀現在狀態。沒有樂觀到場勾選。
- `recorded_at` 是主辦記錄時間，不能當實際抵達時刻；已結束的 published 活動允許補記，不回填過去時間。
- 報名取消、活動取消或參加者失去資格不抹除原紀錄。主辦讀面涵蓋目前 going 會員及任何已留存到場紀錄的會員，目前仍有記錄權的主辦可更正，不能新增不合資格的確認。
- 畫面明示平台尚未提供完成認定或發獎功能。獎品條件仍只是說明文字，出席不建立任何得獎資格。

## 私有 API 與目前權限

`GET /api/v1/events/:id/attendance?limit=20&offset=0`：目前主辦限定，預設20、上限50、安全整數 offset。穩定按 RSVP created_at/member_ref 排序，不含訪客、email、電話或其他聯絡資料。回應僅含 event/organizer identity、會員摘要、報名/到場狀態、獨立版本、主辦記錄/更正時間與可用動作；`private, no-store`、`Vary: Cookie`。

`POST /api/v1/events/:id/attendance/:memberId`：

- `{action:"confirm"}`
- `{action:"retract",reason:"marked_wrong_member"}` 或 `reason:"not_confirmed"`

不接受其他欄位、主張抵達時間、照片、地址或自由文字。必填既有 Idempotency-Key 與 quoted If-Match，後者是這位會員的 attendance version，不是整場 event version。沒有資料投影版本1；第一次確認寫2，每個真正狀態轉移加1。相同狀態的新 key 可回 `changed:false`，不增加 journal 或版本。

目前 session/active user、同 community、現在主辦與原 subject/RSVP 身份在 receipt replay 前核對。沿既有 event update/cancel 的 `refuseInternGuildExchange`，主辦降為 active intern 時，新確認、撤回及舊 ACK replay 全拒絕；不另創「可更正」權限例外。原本可讀的主辦歷史保持唯讀且明示沒有更正權限。必要 onboarding 被撤銷時，HTTP member boundary 與原 attendees 一樣拒絕讀寫；私有到場讀面也在取得 user/session 鎖後重核當前 onboarding，不依賴較早 HTTP 快照；停用/過期/撤銷 session 亦拒絕。不是把參加者失格與操作者失去權限混為一談。

新 confirm 必須本人以外、published且已開始、目前 going、參加者 active/必要 onboarding/guild範圍皆成立。pending/rejected/future/cancelled活動不接受新增確認。合法主辦 retract 不受活動/RSVP取消或參加者失格阻擋。主辦自己的到場不能自證；若已有錯誤歷史，仍可由有記錄權的當前主辦撤回。

## 交易、回條與更正

沿既有 memberCommand 與 PostgreSQL transaction，不建第二套 command engine。actor user/session → receipt advisory → subject user SHARE NOWAIT → 排序後的 actor/subject canonical guild advisories（try-lock）→ event UPDATE NOWAIT → RSVP/attendance UPDATE NOWAIT；與活動/報名取消以同一 event lock 序列化，但不改整場 event aggregate_version。既有公會 tier/helper writers 並非同一全域鎖序，因此本片新增的 domain row 不等待、guild advisory 只嘗試取得；任一 busy/55P03 即整體 rollback 並回409 attendance_busy，零效應/回條，不自動重試。原本未知命令收到此409仍保持未知。GET的event SHARE仍沿原blocking語義；這不宣稱DDL或所有繼承writer協定的完整死鎖證明。

每會員唯一 row 綁定 event/community/member/rsvp，身份不可更新重綁。row、transition_journal、command_receipt 在同交易保存，最後沿原 session clock 重驗；沒有外部 I/O、outbox或通知。撤回保留row、身份、版本與原確認資料，journal append-only。不是永久刪除。

回條只有 `{acknowledged,event_id,member_ref,action,retraction_reason,command_key,attendance_version,changed}`。沒有舊個資或state。新效應的活動/報名/時間限制放在 command run，不阻擋有權主辦取回先前成功的原 ACK。取消後重播不重寫歷史，舊主辦則不能重播。相同key不同body/version409，缺版本428，新key舊版本412。

client在第一個await前保留原path/member/body/key/version，阻擋same-tick重複。未知結果只由對應canonical ACK解除，GET或後來4xx不冒充失敗。舊ACK不當現在狀態，已知較新版本不接受較舊GET覆蓋。ACK先解除離頁guard，再讀現況；讀取失敗不重送已確認命令。client/session/account/event切換與unmount隔離遲到回應；背景隱藏私有快照，回前景只讀不自動重送。同一路由的父層晚到活動資料即使讓活動消失或主辦身份改變，也只隱藏名單並停止新操作，保留原未知命令與離頁guard；不能把子元件卸載當成操作失敗。保護只限目前頁面，不宣稱crash/reload耐久，也不寫localStorage。

## Migration 與回退

候選200只新增獨立表及RSVP複合唯一鍵，零資料回填。新增身份UPDATE guard不攔DELETE；event/subject/RSVP合法父資料清理可cascade，不新增不可清除的參加者保留鎖。recorder/editor同community FK沿既有journal actor保留邊界，不自訂天數或帳號抹除政策。一般撤回不走父資料清理。

原 main `fb4d100c1aef3853a18f97d554f615f88517693f` 的 RSVP取消只更新state與原row版本，活動取消只更新event，不會引用或覆寫新attendance表，原rsvp_id保留。既有父資料清理沿原語義，不把刪除活動誤稱撤回。本片未因加表就增加全平台runtime capability floor；精確schema ledger、既有能力與durable schema floor守門全部保留。這是來源與pure模型證據，真PostgreSQL升級/並行/rollback仍需實跑。

退回舊UI不提供新紀錄讀取/更正功能，不能宣稱完整可用；一旦已有紀錄，不可DROP表或改寫歷史SQL當回退。release owner仍需核當下精確來源、schema approval與真相容證據。此PR不merge、不部署、不migrate、不改旗標或既有release pins。

## 驗證界線

pure policy/client、完整production domain搭配明示SQL模型與真command/session/receipt orchestration、真ReactDOM合成host的事件/所有權檢查是本機可執行證據。SQL模型不是PostgreSQL鎖/約束/隔離或原子性實測，合成host不是native手機/鍵盤/讀屏或老人小孩驗收。

DB/HTTP與Playwright測試另提供作者稿。本輪DB/migration/native browser/server均 `not_run`；E2E `--list` 僅證明discovery。最新完整typecheck/build因先前拒絕且結果不確定而未重試，不能引用歷史成功當本head通過。精確測試數、source SHA、完整context及官方CI由PR交付紀錄逐次更新。
