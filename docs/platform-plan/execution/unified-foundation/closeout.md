# Foundation Complete 收尾

本輪固定研究來源為 `567ae8d3849cfaa319b79c42d9c6c0a48d76f4a9`（包含 #129）。
目前仍未完成共同基礎 sprint。保留 React／Hono／Workers／PostgreSQL／R2，
暫停非必要功能擴張，按原需求收尾。

[現況快照](current-state.json)是已合併版本、已部署版本、schema 觀察、功能狀態、
治理 pins 及 client 支援範圍的唯一彙總入口；每筆都有自己的觀察時間及證據界線。
[需求證據索引](requirement-evidence.json)承接 [INT／GOV](acceptance.md) 與
[R2／AP](source-acceptance.md) 的原文、最低證據層級及所有 168 個 ID。
歷史 handoff／release-readiness 保留當時證據，不再維護另一份 current 狀態。

## 2026-10-27 18:17 UTC：f2c9b2fd 已部署，正式 workflow 清理失敗另列

兩環境已上 `f2c9b2fd`，含 #1144 控制紀錄 GET 修正。[staging](https://github.com/FreeTWAI/freedom-platform/actions/runs/40554821303) 五階段成功；[正式站](https://github.com/FreeTWAI/freedom-platform/actions/runs/40556772743) 完成部署與健康檢查，最後 handoff 報 `release_lease_cleanup_failed`，workflow 與 GitHub deployment 狀態仍保留 failure。
18:16:08–18:16:21Z 重新取得同一個 advisory lease，唯讀核對 pinned journal generation 32／pending=null、DB、Worker 版本與 bindings，並正常釋放。最後 handoff 記錄已存在，先前的鎖已不再占用；沒有持久寫入或重複部署。18:17:56Z 公開 health 為 HTTP 200、`ok`、同版本。

該 source 的 main Verify／CodeQL 與新版映像建置／獨立下載驗證均成功；兩環境使用相同固定 digest。CI 沿既有 delivery_tooling，不重跑無關產品／UI 測試。
GET 暫時錯誤最多共三次、遵守五分鐘內 Retry-After；較長等待、權限／內容不符及 lease 中斷停止。PUT 與未知寫入不自動重送。
正式站較早 `40541461789` 兩次 GET 失敗、`40555710003` 建置失敗全部保留；後者已先結清原備份，再於本機建置失敗。18:04Z 持鎖讀回證實沒有發布意圖、DB／Worker 未變，才發起不帶 recovery hint 的 `40556772743`。GET、建置與最後鎖清理失敗的具體原因仍未確認，不能推定為已證實限流或網路中斷。
原失敗備份 `40492346184` 的 pending 已由較早 staging 發布及 next `40555710003` preflight 結清；原備份仍為失敗，沒有新備份或 floor reset。[收據 followup_control_read_fix](rollout-shared-actions-2026-10-27.json)分別保存原 artifact、digest、workflow 結果與後續唯讀證據。

社群關係依 #1123 啟用；staging 較早已開，本次旗標無變更，next 本次開啟。Checkout／交易 Email 未改；migration catalog 與 `34390b12` 相同。
四帳號已讀回 admin，Environment 已安裝服務憑證與同一映像；可在 Shared release 用自己的帳號選已驗證 SHA，先 staging-next、後 next。實際操作者依紀錄，不能把 arum 的既有 plan 寫成 deploy。
發布側已解除後續 main 等待。新映像首次自然備份成功、真人會員流程、第二操作者還原與原 168 項未驗項分開追蹤；本次不宣稱全流程全綠。
以下歷史觀察保留各自時間。

## 2026-10-27 13:30 UTC 接續：34390b12 已部署，下一版待結清失敗備份

兩環境已由共用 Actions 部署 `34390b12`：staging 09:26 UTC、production 09:32 UTC，五階段均通過。
已重新核對兩份 artifact digest 與執行身分；正式站 13:28 UTC 回讀 HTTP 200、`status=ok`、同 SHA。
[收據的 followup_1330_utc](rollout-shared-actions-2026-10-27.json)保留完整依據。接續程式原先因兩筆相同請求而停止，後來一筆成功、一筆取消；本輪只讀回結果，沒有重複部署。

四人仍有 repo admin，兩環境部署開關開啟、沒有人工 reviewer 等待。arum 已以自己的帳號完成 [plan](https://github.com/FreeTWAI/freedom-platform/actions/runs/40502413062)；這只驗 GitHub 准入，deploy 被刻意跳過，不能寫成他已實際部署。
主線 `4d248428` 的 Verify／CodeQL 均成功，但目前成功部署版本仍是 `34390b12`。

新的自然排程 [40492346184](https://github.com/FreeTWAI/freedom-platform/actions/runs/40492346184) 已觀察到，兩環境都在 capture 失敗、dump 未開始。這和早上已結清的手動備份是不同事件。
後續 staging 部署及手動備份仍失敗；原操作者讀回指出備份 pending 尚未結清，本輪沒有另讀 live DB，也沒有宣稱已恢復。
修正 [#1133](https://github.com/FreeTWAI/freedom-platform/pull/1133) 已由 detna 審查，整合 [#1134](https://github.com/FreeTWAI/freedom-platform/pull/1134) 驗證中。
沿原操作線完成合併與新 image 安裝，再用原失敗 run ID 經既有 recovery 入口先 staging、後 next；不重設 floor、不為部署重做備份。
最小 CI [#1121](https://github.com/FreeTWAI/freedom-platform/pull/1121) 已通過適用 CI、待獨立審查，不加入這批固定範圍。
原 168 項、功能旗標、會員驗收與第二操作者還原狀態不因這次觀察改成通過。以下早上的紀錄保留其當時範圍。

## 2026-10-27 共用 Actions 發布與備份接手

兩環境已透過 `Shared release` 部署 `1db28383`，staging 04:56 UTC、production 05:02 UTC 完成。
preflight、migration、deploy、health、handoff 五階段均成功；[具日期收據](rollout-shared-actions-2026-10-27.json)保存來源 CI、工具 image、Actions run、artifact digest 與正式站 HTTP 200 回讀。
`teddashh`、`arumwu`、`Hao0321`、`detna-vibe-coding` 權限均已核對；兩環境部署與備份開關已啟用。
四人可用自己的 GitHub 帳號從 [Shared release](https://github.com/FreeTWAI/freedom-platform/actions/workflows/shared-release.yml) 選已驗證的完整 SHA，先 staging-next、再同版本 next，mode 選 deploy；日常 recovery run ID 留空。
使用 Environment 服務憑證與短效映像下載授權，不需操作者的個人機器或分發個人金鑰。

本輪 staging 手動備份全程成功。正式環境 Actions 在完成備份紀錄後收尾失敗；持有原 lease 讀回完整紀錄鏈、DB ledger、Worker 與清理狀態後，確認備份／遠端讀回／隔離 DB 與物件還原／清理已完成、無未結案操作。
原 Actions 失敗保留，精確收尾錯誤原因未確認；沒有為取得綠燈重做整份備份。備份不加入普通發布前置。
每日 05:43 UTC 的新 image 自然排程尚未觀察，手動成功不冒充自然成功；舊 timer 退役由原維運線接續。
這些實跑的操作者均為 teddashh，其他三人的實際操作與第二操作者還原仍待觀察。
原 seed／floor 與 schema189 保留；正式環境舊 BEGIN-only 備份失敗已讀回對帳，原失敗沒有改寫為成功。

主線已前進到 `ea84b93c`，07:16 UTC 查核時 Verify attempt 2 仍執行中、CodeQL 成功；不能當成已部署。
這次沒有啟用 checkout、交易 Email 或其他新商務旗標，也沒有執行登入會員旅程；原 168 項、T-047、真人手機／Safari與 live rollback 的未驗項保留。
以下舊發布紀錄保留各自日期與證據邊界。

## 2026-10-26 main 274f0614 發布完成（搜尋、導覽助手與本機任務）

截至13:49 UTC，兩環境已由S10 `b14916cc` 更新為S11 `274f0614`／schema189；見[發布收據](rollout-main-274f0614-2026-10-26.json)。
技能書加入用途／分類篩選；社群統一文字／連結發文，改善失敗重試、舊讀覆蓋與未知結果確認；公會公告及操作保留原意圖並隔離遲到回應。
功能搜尋可帶詞進社群搜尋；新增確定性站內導覽助手、測試員地圖與新手村；進度／勳章僅本機，非XP或正式驗收，無同步／排行榜。
六個first-parent merges為 #1076／#1079／#1078／#1085／#1087／#1090；shared工具已合併但未啟用，本次由本機Q6發布。
Main Verify 40323233554 attempt1的17 jobs、CodeQL 40323233590的3 jobs成功；READ ONLY ledger188列、schema189與 `36bec661`／189回退下限不變，無migration。
27旗標加contact retention `all`共28設定、各37 vars不變；checkout／交易Email仍OFF，兩個tester quest旗標僅文件、未設定。
Owner原話：「部署流程不要去管備份了. 我們平常有備份就好 + github 本來就有版本的概念, 搞什麼」；本次無before／after備份或backup gate，每日備份為資料復原點、Git為程式復原點。
Timers維持active；deploy／dispatcher步驟拒絕03:00–05:45Z及backup service active。Nightly重綁 `14279926`→`c723ae3d`→`476945eb`，10/27約03:34Z／04:33Z首次S11自然備份尚未觀察。
兩環境首試部署成功；production公開smoke14項通過、health首試符合；admin為Access302，僅驗精確來源CSP，未觀察live admin Worker CSP。
Kit follow-up容量中斷後同session續跑；會員UX、真人手機／Safari、第二操作者、live rollback、原168項與T-047未驗項保留。

## 2026-10-26 main b14916cc 發布完成（導覽、公會與活動載入）

截至05:13 UTC，兩環境已部署 `b14916cc`／schema189，接續 `1f7aee36`／189；完整證據見[發布收據](rollout-main-b14916cc-2026-10-26.json)。
會員取得手機選單停靠頂欄下方並可關閉、導覽項目改名（#1047）；公會目錄可收合主題篩選、顯示符合數量並移動次要設定（#1055）。
公會管理各分頁有用途說明、先列討論；收合討論草稿僅在留於該頁期間保留（#1056）。「提交活動」待第一次列表載入結束才開放，後續重讀不重套此初始gate（#1068）。
三個first-parent merges為 #1069／#1070／#1071；HostedStore拆區無預期行為變更、#1057僅測試；#1038含backup／migrator角色分離修補，已合併但 `RELEASE_ENABLED`／`BACKUP_ENABLED` 均false，本次由本機Q5發布。
Storefront僅修失敗關閉dialog後於React commit再回焦一次；checkout與交易Email仍OFF、無新購物流程，既有授權訂單讀取／忘記瀏覽器路徑未被checkout旗標關閉，本次未驗會員操作。
Main Verify 40244683057 attempt1的17 jobs、CodeQL 40244683121的3 jobs成功；無migration，READ ONLY核對188列ledger，schema189及 `36bec661`／189回退下限不變，Q5未建新floor。
27旗標加contact retention `all`共28設定、各37 vars、路由與cron不變；無新增線上 `FREEDOM_*` 名稱。
四組正式備份讀回／隔離DB與物件還原／清理通過：staging before `7b71eb09`為Q4 wrapper首次觀察到的自然排程，after `ab983996`；production before `ee172b97`在Ted約03:28Z（操作者歷史）原話「快點推」後改為手動、通過IO gate，after pointer為第二次 `acc0a813`。
Production after首試 `cb9c333f`於capture失敗、`daily_backup_cleanup_failed`／cleanupVerified=false；dump547秒後連線中斷。事後唯讀確認無殘留container／session、policy已disabled，未需或執行清理；第二次dump156秒成功，不覆寫首試。
網路probe loss與04:13–04:46Z不穩窗口另列操作者觀察；path watcher於04:47Z健康後才重試，staging after無另錄mtr；不能改寫為全程乾淨路徑。
Q5由Q4加入E觀察timer label與F合格自然備份pointer；Codex約01:55Z容量中斷exit1後同session續跑。Sandbox audit的mount拒絕保留；完整audit其後於sandbox外RUNBOOK steps0／1均exit0、隨後02:13:34Z receive，stdout計數屬操作者歷史、非repo evidence；02:02:45Z fixture驗證四命令exit0另列。
兩次READ ONLY rehearsal均189／188列／floor36bec661，staging為 `timers_active_observed`、production為 `timers_paused_observed`，不是部署授權。
Production公開smoke04:12:20.537Z通過14項、health首試符合；`/` CSP允許youtube-nocookie frame、付款路徑無frame-src；admin兩路徑Access302，未觀察live admin Worker CSP，僅驗精確來源函式。
Dispatcher staging／both transitions通過、最終 `14279926`；首次timer restore因錯過04:33:02Z production slot而拒絕、未啟動timer。依RUNBOOK於05:01:34Z只啟動production timer，catch-up `98d243d1`通過；兩service inactive／PID0後停timers、原程式重跑於05:12:56Z恢復active／enabled，排程／argv不變。
Catch-up是operator啟動timer觸發，S10自然calendar-slot仍 `not_observed_for_new_wrapper`；下次10-27約03:34Z staging／04:33Z production。Deployments success為7324602016／20590722672、7324602177／20590723478。
無staging acceptance window，會員UX為 `not_run`；真人手機／Safari、會員旅程、第二操作者、live rollback、原168項與T-047未驗項保留；隔離還原不授權公開資料。

## 2026-10-25 main 1f7aee36 發布完成（遊戲結束少一次繪製）

截至19:44 UTC，兩環境已部署 `1f7aee36`／schema189，接續 `758cabe2`／189；完整證據見[發布收據](rollout-main-1f7aee36-2026-10-25.json)。
會員幾乎沒有可見變化：最多是 #1058 的 AbsurdDaily 最後分類後少一次重複繪製；其餘為測試、文件、無行為變更的重構或OFF旗標後的程式。
前版以來兩個first-parent merges：#1064原樣整合 #1022／#1023／#1031／#1042；#1067原樣整合 #1053／#1058。
#1042買家同意已發布商店政策仍無作用：兩環境 `FREEDOM_STORE_POLICIES_ENABLED` 不存在、OFF，checkout亦OFF；須由owner開啟兩者才會呈現。
Main Verify 40219224039 attempt1的17個jobs、CodeQL 40219224127的3個jobs成功；無migration，READ ONLY核對188列ledger，schema189與 `36bec661`／189回退下限不變，Q4未建立新floor。
27個既有旗標加contact retention `all`、各37 vars、路由與cron均不變；無新增線上 `FREEDOM_*` 名稱。
Kit在 #1064 合併前以provisional batch head／授權建立；Follow-up0補安全診斷與rehearsal wrappers，Follow-up1改選S8／新授權，Follow-up2改選S9。
S8 Verify 40208964551三次未成功：回條clock flake、native compile timeout後由orchestrator取消、guild-member-tiers timeout連帶duplicate key；細節為操作者歷史。#1053修首項，S8未receive／bind／deploy。
兩組S8 staging before備份 `4b32ec82`（15:56:55.913Z）、`f2efe8e7`（17:22:07.856Z）均passed但未作pointer：前者無法滿足2h窗口，兩者亦早於S9的18:01:38.931Z授權，原證據保留。
四組正式備份通過讀回、隔離DB／物件還原及清理：staging before `be5309c9`／after `f646857e`，production before `384c830a`／after `e7b182bc`；before在Q3 installed after-wrapper run dir，Q4保留pointer。
每次備份前均執行IO／最終hop TCP mtr／DB RTT；staging before丟包10%，after 20次探測30%後重跑30次0%／RTT183ms；production before10%／177ms、after20%／179ms，延遲穩定，僅列操作者觀察，不改寫為乾淨路徑。
兩次READ ONLY rehearsal均為 `rehearsed_readonly_not_deploy_authorized`／189／188列／floor36bec661；staging timers active，production已由step7暫停而inactive，常數 `timers_active_expected` 不代表實際active，符合RUNBOOK10b。
Production公開唯讀smoke19:32:15.364Z通過14項、health首試符合；`/` CSP允許youtube-nocookie frame、付款路徑無frame-src；admin兩路徑Access302，未觀察live admin Worker CSP，僅驗精確來源函式。
Dispatcher staging／both transitions通過，最終綁定 `64bdeee1`；19:44:03.881729Z原timers恢復active／enabled、排程／argv不變；Deployments success為7318209181／20564861826、7318209366／20564862554。
無staging acceptance window，會員UX為 `not_run`；自然排程仍 `not_observed_for_new_wrapper`，真人手機／Safari、會員旅程、第二操作者、live rollback、原168項與T-047未驗項保留。
保留Follow-up2 sandbox的managed mount modes拒絕歷史；完整offline audit其後於sandbox外RUNBOOK steps0／1均exit0，屬操作者歷史、非repo evidence；隔離還原不授權公開資料。

## 2026-10-25 main 758cabe2 發布完成（搜尋可見的 Repo 名稱）

截至11:58 UTC，兩環境已部署 `758cabe2`／schema189，接續 `36bec661`／189；完整證據見[發布收據](rollout-main-758cabe2-2026-10-25.json)。
會員搜尋可用已看見的精選 Repo 名稱找到公開作品（#1021）；其餘 #1026 為16檔測試／CI與相關文件，沒有其他產品變更。
Main Verify 40175861457 attempt1的17個jobs、CodeQL 40175861736的3個jobs成功；檔案verify job10:39:12Z、run更新10:39:13Z，派工10:39:41Z未獨立佐證。
無migration；以READ ONLY逐列核對188列ledger，schema189與兩環境 `36bec661`／189回退下限維持，Q3未建立新floor。
27個既有旗標加contact retention `all`、各37 vars、路由及cron均不變；沒有新增線上 `FREEDOM_*`，代出貨不存在、仍OFF。
四組備份首跑通過讀回、隔離DB／物件還原與清理：staging before `93606d6e`／after `583d0bfb`，production before `61411998`／after `23211552`；before在Q2 run dir，Q3保留pointer。
S6 `0ec26d5c` 在receive前因 #1026 合併而失去current-main資格；Follow-up1改選S7並於08:17:35.841Z建立新授權，S6未發布，舊授權保留。
Kit早期改選腳本曾讀取Q2兩份private template bytes算pin，未印出／複製內容但違反禁讀界線；已停止，後續pin改取既有closure entries，Q2未改。
Step5首試舊Q2 root退出65；step8第二次因 `quote is not defined` 拒絕、無部署provider效果，該次Access已撤銷。Follow-up2／3分別修root與helper並補audit／測試；拒絕證據保留。
每次修正後重跑bind／before pointer／plan，沿用10:31:36.262Z的staging before；最終bind 11:12:51Z、seal 11:13:23Z依mtime，READ ONLY staging gate11:13:35Z為操作者觀察。
Step 7的10:59:19Z snapshot跨rebind保留、timer持續paused，未重跑step 7；每次備份前執行IO／mtr／DB RTT，production before最終hop有10–20% SYN探測丟包但延遲穩定、兩次DB RTT乾淨，僅列觀察。
Production首試11:41Z在首次asset-upload-session遇Cloudflare10013；11:43:04Z GET-only確認仍前版100%、無新version／deployment，同一sealed wrapper於11:43:58–11:44:39Z重試成功，並非publish後redeploy。
Production公開唯讀smoke11:45:06.011Z通過14項；`/` CSP允許youtube-nocookie frame、付款路徑無frame-src；admin兩路徑Access302，未觀察live admin Worker CSP，僅驗精確來源函式。
Dispatcher staging約11:40Z、both約11:57Z綁定 `a423a61e`；11:57:13Z原timers恢復active／enabled，排程／argv不變；Deployments success為7312748338／20543559761、7312748460／20543560249。
無staging acceptance window，會員UX為 `not_run`；自然排程仍 `not_observed_for_new_wrapper`，真人手機／Safari、會員旅程、第二操作者、live rollback、原168項與T-047未驗項保留。
Kit完整offline audit仍因managed mount modes拒絕，不能將內容gates通過寫成完整audit成功；隔離還原不授權公開資料。

## 2026-10-25 main 36bec661 發布完成（已付款取消與會員體驗）

截至05:22 UTC，兩環境已部署 `36bec661`／schema189，接續 `54961dd8`／187；完整證據見[發布收據](rollout-main-36bec661-2026-10-25.json)。
自前版共4個 first-parent merges：#1001、#1015（16支）、#1017（fork head）、#1027（僅CI）；文件設計不算功能或會員驗收。
已付款訂單取消流程已部署，但checkout與交易Email仍OFF，會員目前無法建立付款訂單，不能據此推定正式交易驗收。#1015涵蓋五語發文器、草稿／安全重試、留言修改刪除防舊讀覆蓋、按讚回饋、動態分類／分享入口及已讀通知同步。
聊天重用歷史、有限回條查詢、貼圖預覽再送出並保留草稿；搜尋依登入狀態隔離已上線；返回保留私人清單分頁只在 `FREEDOM_COMMUNITY_RELATIONS_ENABLED` 開啟時呈現，該旗標不存在、仍OFF，會員目前看不到。
另有技能書探索閱讀、免費預覽入口、首頁品牌與學習／公會自主展開、本人空間／頭像選單及已加入公會總覽；共創誌分開Claude／Codex並支援兩社群同日文章。
#1017修正結果清單變動後關閉好友移除／拒絕確認；#1014僅為本人明選公開名片精選貼文設計，未宣稱交付。
Main Verify 40149666118 attempt2的17個jobs與CodeQL 40149666157的3個jobs成功；檔案記錄最後job03:48:05Z、run更新03:48:06Z。
Verify首輪partition1的test_timeout（62檔完成60、無測試失敗）僅有派工提供的操作者紀錄，Q2未見原始報告；不改寫為成功。
Migrations188／189各由環境 `_migrator` 單一交易COMMIT；staging交易890305、production交易892468，ledger各188列。
**兩環境回退下限升為 `36bec661`／189，只能相容前進修復**；代出貨migration已套用，但旗標不存在，仍OFF。
27個既有旗標加contact retention `all`共28項設定、各37 vars、路由與cron均不變；沒有新增線上 `FREEDOM_*` 名稱。
Ted的10月24日18:08:00.318Z原話：「當然要發粄 你的工作就是一職當 orchestrator 確定東西都不會 delay 大家的東西出的去, 不要拖了」；新授權記錄於10月25日01:14:37.562Z。
無staging acceptance window，會員UX為 `not_run`；production公開唯讀smoke05:00:02.174Z通過14項、health首試符合來源，未登入會員或建單。
`/` 線上CSP允許youtube-nocookie frame；`/pay/ecpay/`加43個A無frame-src；admin兩路徑被Access302攔截，未觀察線上admin Worker CSP，僅驗精確來源函式。
四組發布備份皆首跑通過讀回、隔離DB／物件還原及清理：staging before `ecade880`／after `ad86e455`，production before `058c207a`／after `4d310d7f`。
Before以Q既有after wrapper新擷取、保留 `54961dd8`／187；after為 `36bec661`／189；還原不授權公開資料。00:44:05Z receive拒絕S3 `53d528fc` 的 `not_actual_current_merged_main`，Follow-up2於01:14Z改選S5／新授權並保留舊檔。
3b首試因wrapper舊pin退出65、log空且Node未啟動；Follow-up3僅重釘該行並新增永久inline-pin audit，第二次04:12:18Z通過。
步序為觀察：step7 staging before03:57:56Z早於3b重試與bind／plan／seal，使用前代wrapper；pointer於bind後04:13:46Z記錄。
Step8於04:12:08Z暫停timer，04:31Z production夜備未於原時段執行；發布before／after補足，後續Persistent補跑另列。
Production before於04:28／04:31Z因上游延遲未啟動；04:41／04:42Z連續乾淨RTT與04:42Z乾淨precheck後，04:43:42Z才啟動並首跑通過；未複製主機或IP。
Dispatcher staging階段約04:57Z，both為 `2fc4cb83`；timer restore首試啟動後因Persistent補跑而拒絕，補跑 `b1d1ccc0`成功後第二次05:21:20Z完整gate通過，排程／argv未改。
Deployments staging-next／next success（7309017031／20527935508、7309017615／20527938074）；補跑非自然排程，仍為 `not_observed_for_new_wrapper`；真人手機／Safari、會員旅程、第二操作者、live rollback、原168項與T-047未驗項保留。

## 2026-10-24 main 54961dd8 發布完成（共創誌、遊戲與聯絡資料保存）

截至21:26 UTC，兩環境已部署 `54961dd8`／schema187，接續 `c140a346`／185；完整證據見[發布收據](rollout-main-54961dd8-2026-10-24.json)。
會員取得共創誌模板／投稿 API、原話閱讀／排行／成員頁、3D 遊戲與成果分享、手機 PWA 聊天修正、關閉服務表單保留草稿。
自前版共5個 first-parent merges：#991、#985、#1002、#1007、#1003（含 #989／#984／#973／#986／#992）；文件不算會員驗收。
Main Verify 40100005287 的17個 jobs、CodeQL 40100005270 的3個 jobs 全部成功；migrations186／187各由環境 `_migrator` 單一交易COMMIT。
Staging交易870002、production交易873627，ledger各186列；**兩環境回退下限升為 `54961dd8`／187，只能相容前進修復**。
27個既有旗標、路由與cron維持；唯一新增 plain var `FREEDOM_COMMERCE_CONTACT_RETENTION=all`，各37 vars。
Ted於10月23日06:21Z在 #989 決定「4. all, all」；其他不存在旗標仍預設OFF，checkout／交易Email仍OFF。
Ted於10月24日18:08:00.318Z授權：「當然要發粄 你的工作就是一職當 orchestrator 確定東西都不會 delay 大家的東西出的去, 不要拖了」。
無staging acceptance window，會員UX為 `not_run`；production公開唯讀smoke於21:25:09.946Z通過14項，health首試符合來源，未登入會員或建單。
`/` 線上CSP允許youtube-nocookie frame；`/pay/ecpay/`加43個A無frame-src；admin兩路徑被Access302攔截，未觀察線上admin Worker CSP，僅驗精確來源函式。
四組成功備份皆通過遠端讀回、隔離DB／物件還原與清理：staging before `64667475`／after `d68f2715`，production before `f66c3abb`／after `7e0ea7c6`。
Before皆於本日以舊kit的after wrapper新擷取，保留 `c140a346`／185；after為 `54961dd8`／187，production after pointer約21:14Z記錄；還原不授權公開資料。
Seal首試兩環境exit65拒絕、未寫seal；Follow-up2只修expected var順序、render bytes不變，重新釘選helper並重跑steps4／6。
Follow-up3在materialize拒絕前改成忽略readback key順序的精確值比對；record-backup staging before首試因0664拒絕，169個kit檔僅移除group／other位元後重試通過。
Staging after首試 `201d5358`於restore遇EOF，第二次 `6df7dfe5`於capture失敗，皆清理通過、未留下maintenance；第三次才成功。
180秒dump預算／SIGTERM後docker CLI退出0為kit限制，**未修正**；第二次AWS東京路徑Cogent掉包及恢復為操作者觀察，與失敗收據分開。
Production step15於20:54:15Z退出1，但Worker已發布；provider listing延遲，沒有redeploy。Follow-up4新增GET-only reconciliation。
Reconcile首試21:10Z因把含runtime驗證首行的log當單份JSON而拒絕；Follow-up5修parse／加preflight，操作者記錄 `local_inputs_ok`，第二次21:24:41.936Z簽發receipt，**不是deploy helper成功收據**。
兩環境dispatcher已綁定 `4dba0c67`；21:25:57Z恢復原timers，03:30／04:30 UTC、5分鐘隨機延遲、Persistent及service argv未改。
Deployments staging-next／next皆記success（7304702552／20509123861、7304703178／20509126735）；新wrapper自然排程仍為 `not_observed_for_new_wrapper`。
真人手機／Safari、會員旅程、第二操作者、live rollback、原168項需求與T-047未驗項保留；不以CI、部署或備份還原推定完成。

## 2026-10-23 main c140a346 發布完成（商店／供貨、公開閱讀與 migration 173–185）

**截至11:28 UTC，staging 與 production 都已部署 `c140a346`／schema185，
四組成功 before／after 備份、隔離還原與清理通過，兩環境 dispatcher 已綁定本次來源，
原 timer 已恢復 active／enabled。公開 smoke 只在 production 執行；新 dispatcher 的自然排程備份待10月24日確認。會員 UX 驗收未執行。**
來源為 #990 合併後的 main，接續兩環境原 `cf7e518b`／schema172；main Verify 39903035598 的17個 jobs
與 CodeQL 39903035600 的3個 jobs 全部通過。
13 個 migration（173–185）以各環境 `_migrator` 在一個交易內套用，兩環境 ledger 都是184列、COMMIT 已確認
（staging 交易 792282、production 交易 793952）；兩環境的回退下限從此是 `c140a346`／185。
27個旗標與路由、cron 維持不變。8個新旗標不存在，等同關閉：訂單通知、店家自行寄送（宅配）、商店外觀、分類、相簿、
賣場政策、商品規格、供貨方案照片。checkout／交易 Email 仍為 OFF。

從前版起有22個 first-parent merges，含 #963（11支，#961再含 #957／#959）、#975、#977與 #981批次。
商店／供貨包含準備進度、准入審核、占用庫存、照片自動儲存與上架、搜尋篩選與中斷恢復；
公開閱讀包含貼文有限摘要、技能書註冊回流、公會資源與12本會員分享技能書。
另含首頁／任務／導覽分區載入與取消、好友確認、訊息載入意圖、活動邀請額度與保存鎖定修正，
以及管理介面與宣傳圖開發預覽。分類、面交訂單卡與店家自行寄送仍受原旗標限制；
文件、CI、開發預覽及已部署程式都不當作會員驗收。逐PR範圍見[本次發布收據](rollout-main-c140a346-2026-10-23.json)。

Ted 於06:19:04.087 UTC 回答是否今天發布：「要，今天上」，並記錄先 staging再 production、
備份／migrator／health／receipt都做的指示。無 staging acceptance window，member UX acceptance為 `not_run`；
真實手機與 Safari未驗。Production公開唯讀 smoke於09:35:12.732 UTC通過14項，未登入正式會員或建立訂單。
`/` 線上 Worker CSP 已確認允許 youtube-nocookie frame，`/pay/ecpay/` 加43個 A 無 frame-src；
`/admin` 與 `/admin/github/callback` 在 Worker 前被 Access 以302攔截，**未觀察線上 admin Worker CSP**，
僅驗精確部署來源函式（`liveAdminWorkerCsp=not_observed_access_protected`、`adminCspSource=exact_source_function`）。
Smoke內嵌 `priorFailedAttempt` 仍是前輪 Short歷史紀錄，本輪首試失敗另行保留。

Staging before `271ae1a1` 於08:39:48.552 UTC、after `906eec4f` 於08:58:05.063 UTC建立，均首試通過、各還原66個物件。
Production before第二次 `cb1981d5` 於09:18:01.863 UTC、after `47a9f8d7` 於11:13:13.618 UTC建立，各還原53個物件；
after首試通過，dump為7,313,644 bytes。Before來源為 `cf7e518b`／172，after來源與operator為 `c140a346`／185；
四組遠端讀回、資料庫與物件隔離還原、素材政策與清理通過，production另驗10項座標約束；不把還原當新線上ledger查詢。

Production before首試約11秒以 `daily_backup_installation_or_record_failed` 失敗，沒有run dir；
原因為複製的adapter相對匯入 `./capture-boundary-diagnostics.mjs` 缺檔。
Kit新增symlink指向前輪已釘選 `366a7edc…` 原檔，乾跑import通過後才重跑，已綁定hash未改；
**symlink本身未釘選，bind-time admission若重跑會拒絕**，後續步驟未重跑該admission。
Production smoke首試09:34:28 UTC以 `ERR_ASSERTION` 失敗，health仍回 `cf7e518b`；
操作者交接記錄部署後約12秒的edge傳播延遲、六次GET確認後原樣重跑通過；六次中間回覆未見獨立檔案。
Production after的IO gate從09:35起反覆拒絕，11:13才通過後執行備份，沒有繞過；其他本機工作造成負載為操作者觀察。

9a的 `reset-failed` 後兩個service皆inactive，但腳本以 `timers_changed_after_reset` 拒絕，**不列腳本通過**。
操作者觀察只有衍生 `NextElapseUSecRealtime` 改變：5分鐘隨機延遲且 `FixedRandomDelay=no` 會重抽；
OnCalendar、Persistent、enablement等設定未變。沒有重試或補造 `reset.json`。
操作者交接另記離線稽核三項absence assertions因證據已建立而失敗，非gate且未放寬；
目前 `offline-audit.log` 卻保留準備期passed摘要，未找到該三項失敗的獨立輸出，兩者分開記錄。

兩個日常backup service於10月23日03:33／04:34 UTC以exit65失敗；操作者記錄其前有10月22日13:33 UTC
主機Node 24.21.0→24.22.1更新，本次dispatcher已釘選新Node。
Staging階段約09:31:28 UTC由 `0a478a84` 換為 `b4c16179`，兩環境約11:27:18 UTC綁定 `b76f639d`；
11:27:30 UTC恢復原timer，`unitOrScheduleChanged=false`，03:30／04:30 UTC、5分鐘隨機延遲、Persistent與service argv維持。
下次排程為10月24日03:30:53／04:31:38 UTC，**新dispatcher自然備份尚未觀察**。
GitHub Deployments staging-next／next於11:27:41／11:27:45 UTC各記success
（deployment 7277015615／7277016870，status 20386963738／20386970127）；
原168項需求、T-047、第二操作者與真人成果未驗項保留。

## 2026-10-20 main cf7e518b 發布完成（供貨／零售公會資格與修正）

**截至22:28 UTC，staging 與 production 都已部署 `cf7e518b`／schema172，
四組成功 before／after 備份、隔離還原與清理通過，兩環境 dispatcher 已綁定本次來源，
原 timer 已恢復 active／enabled。會員 UX 驗收未執行。**
來源為 #928 的 main，接續兩環境原 `3a6e2506`；main Verify 39426654402 的17個 jobs
與 CodeQL 39426654398 的3個 jobs 全部通過。本輪沒有 migration，27個旗標、路由與 cron 維持；
Supplier／Commerce console 與 Short 保持 ON，checkout／交易 Email 保持 OFF，
供貨素材／上傳與選品照片仍為 staging開、production關。完整證據見
[供貨／零售公會發布收據](rollout-commerce-cohorts-2026-10-20.json)。

#916：供應商／電商公會的 active intern／full 成員可開始各自首次供貨／零售設定，獨立店家准入與 checkout 門檻保留；同儕確認無發布時額外步驟。
#903：會員服務遺失寫入回覆後保留原儲存／封面操作，並帶入選填欄位驗證與隱藏確認修正。
#922：合作摘要載入時保留供貨狀態列高度，讓「供貨條件」按鈕維持位置。
#926（TSY3991）：切換全螢幕 Short 時保留對話框內的鍵盤焦點。
另含 #914 fork PR CodeQL、#924 batch（#903／#913／#915／#920／#922）與 #928 runtime DB 清理時限修正；文件與 CI 不當作會員驗收。

Ted 於20:52:45.424 UTC 回答是否今晚發布 main cf7e518b：「1. 要」。
依既有方針無 staging acceptance window，member UX acceptance 為 `not_run`；真實手機與 Safari 未驗。
Production 公開唯讀 smoke 於22:14:50.469 UTC 通過14項，未登入正式會員或建立訂單。
`/` 線上 Worker CSP 已確認允許 youtube-nocookie frame，`/pay/ecpay/` 加43個 A 無 frame-src；
`/admin` 與 `/admin/github/callback` 在 Worker 前被 Access 以302攔截，**未觀察線上 admin Worker CSP**，
僅驗精確部署來源函式（`liveAdminWorkerCsp=not_observed_access_protected`、`adminCspSource=exact_source_function`）。
Smoke 的 `priorFailedAttempt` 是前輪 Short kit 的歷史失敗與 Access 修正背景，並非本輪失敗嘗試。

兩環境 before 備份於本日21:17／21:31 UTC 在前輪 Short kit 新擷取，來源仍為 `3a6e2506`，均首試通過。
Staging after 首試 `54e05840` 於21:45:42.694 UTC 建立，在 capture 以 `daily_backup_phase_failed` 失敗，
清理通過，沒有 seal／offsite／restore。非私密檔案證據為 dump 3,089,221 bytes、stderr空，
66個物件只寫入62個、間隔約4.6秒，最後一個後約4.7秒出現失敗；首個缺失物件在 before 與第二次皆擷取成功。
例外文字未保留，**確切原因未知**；與暫時物件讀取失敗相符僅是推論，不能以既往 capture 失敗推定原因。
第二次 `6d8aeb25` 使用新的通過 IO gate 與同一 `f8cec4d4` adapter，未改 kit，通過後才綁定。
Production after `c567ffd4` 於22:15:37.685 UTC 建立、首試通過；成功備份各還原66／48個物件，
172 floor與素材政策通過，production另驗10項座標約束；不把隔離還原當成新線上 ledger查詢。

日常兩個 backup timers 曾為發布暫停；dispatcher 約22:13:45 UTC完成 staging階段後，兩環境綁定為 `0a478a84`，
22:28:23 UTC由 `restore-timers.py` 恢復，原03:30／04:30 UTC、5分鐘隨機延遲、Persistent與service argv維持。
觀察到下次排程為10月21日03:32:29／04:32:56 UTC，**新 dispatcher 自然備份尚未觀察**。
GitHub Deployments staging-next／next 已各記錄 success；原168項需求、T-047、第二操作者與真人成果未驗項保留。

## 2026-10-20 Short 短影音發布完成

**截至07:16 UTC，staging 與 production 都已部署 `3a6e2506`／schema172，
Short 已對所有人開啟；四組成功 before／after 備份、隔離還原與清理通過，
兩環境 dispatcher 已綁定本次來源，原 timer 已恢復 active／enabled。會員 UX 驗收未執行。**
來源為 #917 的正常 merge，帶入 TSY3991 的 #897「Short — 成員分享的 YouTube Shorts 上滑瀏覽」
（refs #739）；main Verify 39376522961 的17個 jobs 與 CodeQL 39376522955 的3個 jobs 全部通過。
本輪沒有 migration；唯一新增 `FREEDOM_SHORT_VIDEOS_ENABLED=true`，兩環境 feature bindings
由26增至27；Supplier／Commerce console 保持 ON，checkout／交易 Email 保持 OFF，
其他旗標、路由與 cron 未變。完整證據見[Short 發布收據](rollout-short-videos-2026-10-20.json)。

Ted 於04:50:30.325 UTC 指示：「我覺得他那個如果測試都好 就不用在 staging 測成這樣了, 可以直接先上線給大家測了」。
依此無 staging acceptance window，member UX acceptance 為 `not_run`；真實手機與 Safari 未驗。
Production 第二次公開唯讀 smoke 通過14項：`/` 線上 header 已確認
`frame-src https://www.youtube-nocookie.com;`，`/pay/ecpay/` 加43個 A 的線上 Worker CSP 無 frame-src。
`/admin` 與 `/admin/github/callback` 的匿名請求在 Worker 前被 Access 以302攔截，
**未觀察線上 admin Worker CSP**；僅補驗精確部署來源函式
（`liveAdminWorkerCsp=not_observed_access_protected`、`adminCspSource=exact_source_function`）。
未登入正式會員或建立訂單，不能以 smoke 通過代替真人使用。

Production 首次 before-set `217429d6` 因 docker exec pg_dump 退出0卻產生截斷 dump，
在 `pg_restore: … end of file` 失敗，清理通過；第二次 `0416acf8` 完成還原後才綁定。
本輪 before 為10月20日新擷取的 `240cf677` 備份，run dir 位於前輪 kit，沒有沿用10月19日舊 set。
兩環境各次成功備份均還原66個／48個物件、核對172 floor與素材政策；production 另核對10項座標約束。
最初 plan 因 deploy out dir 不存在而拒絕，另行完成後才 seal／deploy，原拒絕紀錄保留。

兩項 kit 修正經 orchestrator 審查：`kit-quiescence` 改以 `MainPID=0` 且 service inactive
判斷停止，保留 systemd 的歷史 `ExecMainPID`；`smoke-access` 修正首次6項通過後在 `/admin`
遇到 unexpected redirect 的檢查，改驗 Access redirect 並補 exact-source CSP，其他既有 assertions 維持。
首次 smoke 失敗收據與兩份修正 diff 保留，第二次收據記錄 `priorFailedAttempt`，沒有覆寫失敗。
Dispatcher 為 `562f005a`；原03:30／04:30 UTC、5分鐘隨機延遲、Persistent及service argv維持，
觀察到下次排程為10月21日03:33:09／04:32:18 UTC，**新 dispatcher 自然備份尚未觀察**。
GitHub Deployments 的 staging-next／next 已各記錄 success；原168項需求、T-047、第二操作者與真人成果未驗項保留。

## 2026-10-19 商店公開說明與會員啟用邊界發布完成

**截至23:06 UTC，staging 與 production 都已部署 `240cf677`／schema172，
限定驗收、發布後備份與隔離還原通過，兩環境 dispatcher 已綁定本次來源，
原 timer 已恢復 active／enabled。這是操作收據支持的程式發布，三項真人成果仍待驗收。**
來源為 #911 的實際 main，Verify 39326252768 的17個 jobs與 CodeQL 39326246130
的3個 jobs全部通過；公會局部 CI 的已合併／驗證不等於非核心作者已完成自主交付。
本輪沒有 migration；Supplier／Commerce console 保持 ON，checkout／交易 Email 保持 OFF，
其他旗標、路由與 cron 未變。完整證據見[商店會員流程發布收據](rollout-merchant-readiness-2026-10-19.json)。

店主可在既有「商店資料 → 商店介紹」填寫客服、交付及售後說明，沿儲存／預覽／發布流程，
讓買家頁呈現同一份「商店說明與聯絡」；不從會員或銀行資料推導公開資訊。
Seller console 已解除對 Supplier console 開關的相依，既有權限、准入與 checkout 前置仍保留。
22:53 UTC 的 production 唯讀盤點為1個已啟用店面，離線付款、交付設定與
獨立准入各為0；店主實際設定與真人供應商／店主／買家旅程尚未完成，既有測試同意不需重問。

Staging 的普通合成會員後台與匿名公開頁已通過；店面驗收使用首次導航前設定的
390／1440視窗，確認公開說明、草稿隔離、錨點、checkout OFF與分享目的地。
Session、fixture及臨時 Access清理通過。先前三次跨 resize失敗仍保留，沒有改稱通過；
有界本機試驗支持 no-JS、smooth anchor與resize交互作用，尚未證明原生瀏覽器缺陷或
Playwright獨有原因。**固定初始尺寸通過不代表跨尺寸已修復，也不能據此稱正式站故障。**
Production 僅做公開唯讀檢查與資產核對，未登入會員、下單或宣稱真人採用。

發布前備份沿用已完成的兩份 `10ad8d2d` 發布後備份，保留原來源與日期，沒有冒稱新擷取。
本輪新 staging／production備份分別完整還原66個／48個物件，172 floor、素材政策與清理通過；
只有production另核對10項座標約束及canonical saved floor，staging此項不適用。
Dispatcher為`ef99163d`；原03:30／04:30 UTC與5分鐘隨機延遲、Persistent設定及service argv維持。
觀察到下次排程為10月20日03:34:58／04:32:12 UTC，**新 wrapper自然執行尚未觀察**。
`12940c71`／`10ad8d2d`歷史收據及既有未驗項保留，不新增第四條發布工作線。

## 2026-10-19 三項成果的程式發布完成

**截至21:51 UTC，staging 與 production 都已部署 `10ad8d2d`／schema172，
各自限定驗收、before／after 備份與隔離還原通過；兩環境 operator 已綁定本次來源，
兩個原 timer 已恢復 active／enabled。這是程式發布完成，真人產品旅程仍待驗收。**
這次來源包含 #910 的公會局部 CI、店面品牌呈現、作品介紹與清楚目的地的分享頁，
另含公開資料隱私修正。沒有 migration；旗標、路由與 cron 未改，
Supplier／Commerce console 保持開啟，checkout／交易 Email 保持關閉。
分環境狀態見[本輪發布紀錄](rollout-three-outcomes-2026-10-19.json)。

Staging 的自有合成普通會員已完成店主／供應商桌面與手機後台，兩者 transport error為零，
匿名 API 拒絕、公開書架、品牌店面、明示目的地的手動外連及撤下後隱藏均通過。
Session、公開與普通會員 fixture、臨時 Access 清理各有收據。
分享計分與外部請求使用攔截驗證，沒有建立訂單，也不宣稱真實採用或真人交易完成。

Production 完成公開唯讀 health、版本／旗標、protocol、首頁、匿名拒絕及介紹／店面／分享資產核對，
沒有登入正式會員或建立訂單。21:37 的唯讀盤點為1個店面且已啟用，但獨立准入、離線付款設定、
交付設定各為0；這些仍由店主沿既有流程完成，不能以部署成功代替可交易。
兩環境新備份分別還原66個物件／142089 bytes與48個物件／629894 bytes，172 floor與清理通過，
production另核對素材政策及10項座標約束。日常 dispatcher 為`999e640b`，原排程未改；
下次排程為10月20日03:30:31 UTC（staging）及04:31:38 UTC（production）。
新 wrapper 的自然執行尚未觀察，不能以手動還原或 timer恢復代替。

原驗收在 producer 檢查後累積3個 supplier error，被 finalizer拒絕；其原因未在原收據記錄。
後續三次失敗保留。新的獨立 recheck 補齊實際商品載入等待及手機隱藏導覽的 owner存在判斷，
最後才通過整體驗收，沒有放寬 error gate或改動本次產品來源。
#911 已另於21:16 UTC合併為 `240cf677`，不包含在本次 `10ad8d2d` 發布；
截至21:51 UTC，其主線 Verify仍在執行。
真人會員設定、獨立准入、買家交易及兩位非核心公會作者自主交付仍需各自驗收。

## 2026-10-19 會員商務後台啟用（前一輪完成紀錄）

**截至18:04 UTC，staging 與 production 都已部署 `12940c71`／schema172，
Supplier 與 Commerce console 已開啟；checkout 與交易 Email 仍關閉。**
這次沿用既有 schema，沒有執行 migration；其他旗標、路由與 cron 保持原值。
供貨素材／上傳與選品照片仍是 staging開、production關。完整版本、旗標與
逐環境證據見[會員後台發布收據](rollout-member-consoles-2026-10-19.json)。
使用者已確認供應商與電商公會成員同意參與測試，這不等於真人驗收已完成，
也不代替店主自己的公開、付款與交付設定或獨立准入。

Staging 的自有合成普通會員，已走正常登入、店主／供應商權限與桌面／手機後台；
店主訂單清單可見，匿名 API 被拒絕。這次只驗後台進入與閱讀，沒有下單或代填店家設定。
合成 fixture、session 與臨時 Access 已分別確認清理。Production 完成公開唯讀
health、版本／旗標、protocol、首頁與匿名拒絕檢查，沒有登入正式會員或建立訂單。
真人供應商、店主與買家的完整旅程仍待完成。

兩環境都有新的 before／after 資料庫與物件備份、遠端讀回、隔離還原、172 floor
與清理證據。Production 首次 after-set `9fae9f1d` 在 capture失敗、清理成功，
根因仍未確定；另用具名、固定雜湊的 diagnostic adapter／wrapper 完成新 set
`46f64b85`，不改寫舊失敗。Staging 的初次備份初始化、兩次 browser harness失敗，
以及 production 的 runtime closure拒絕與 cache隔離修復也分開保留。

日常 dispatcher 已安裝為 `bc9cf6f1`，兩個原 timer恢復 active／enabled，排程未改；
觀察到下一次為10月20日03:30:11 UTC（staging）與04:34:11 UTC（production）。
**新 wrapper 的自然排程尚未觀察**，不能以手動還原、安裝或既有 service結果代替。
Schema 證據使用各次成功備份的 authenticated preflight時間窗，還原檢查不冒稱
新一次 live DB讀取。所有舊失敗、私有內容／授權讀取 floor、production座標約束、
原168項需求、T-047 與第二操作者未驗項保留。

本輪繼續以公會自主交付、可信商店／供貨、專業介紹／分享三個成果收尾。
包含 #901、#906–#909 的整合 PR
[#910](https://github.com/FreeTWAI/freedom-platform/pull/910) 已於19:31 UTC合併為
`main@10ad8d2d`（tree `919f8e86`）。截至20:22 UTC的觀察，該主線
[Verify 39311717186](https://github.com/FreeTWAI/freedom-platform/actions/runs/39311717186)
與 [CodeQL 39311715398](https://github.com/FreeTWAI/freedom-platform/actions/runs/39311715398)
已分別完成17及3個 jobs，全部通過；完整 run 與 jobs 收據綁定同一主線來源。
這是合併後主線的 CI 證據，不代替部署、公開資產或會員驗收；原 PR 失敗紀錄保留。
店面、介紹、分享與公會改動不包含在本次 `12940c71` 發布。
下一步以實際版本、公開資產與清理後證據完成新一輪驗收及發布；
新部署另寫收據，不改寫本次紀錄。會員設定與適用交易驗收沿既有有限商務交接繼續，
不新增第四條工作線，也不把後台啟用稱為完整電商或 Foundation完成。

以下10月17日及更早段落保留當時觀察；當前具日期快照以上方收據與`current-state.json`為準。

## 2026-10-17 Commerce 與離線買家流程收尾

#863 的後端與 schema168–170 已部署兩環境，接著 #875 補齊買家報價、確認下單、
凍結匯款／面交說明、未知回覆重試及取消流程。新版本 `d39370a1` 與主線 #862 的
schema171 已部署 staging、production；完整來源與部署證據見[本輪收據](rollout-commerce-buyer-2026-10-17.json)。主線另於16:19 UTC
合併 #864／schema172，由其原工作流程接續發布；本輪收據只證明 `d39370a1`／171
在所列時間的狀態，不把後續主線或另一輪部署算入本輪。
兩輪發布均完成實際資料庫＋物件備份與隔離還原、保留 floor 及資源清理；新日常
備份工具已安裝，原 timer 已恢復。新工具的自然排程尚未觀察。

買家來源的完整 Verify attempt 2 通過17個 jobs、435個 runtime檔／
6393個案例及1105個不重複 browser案例。
第一輪第6區資料庫清理逾時仍記為失敗；原 artifact與完整日誌已保留，根因未確定，
未放寬 timeout 或測試門檻。#863 原 staging before-restore逾時與明確 restore-only
補驗也分開保留，不改寫原失敗。首次 schema171 staging嘗試因演練漏建7個既有媒體欄位權限，
在COMMIT前回滾；唯讀核對後恢復舊服務，補齊演練並通過13案，再以新套件與新備份部署。
原失敗與恢復收據保留，遷移檢查未放寬。

**Commerce console／checkout／email仍關閉**；供應商 console維持 staging開、production關。
這是程式與限定雲端部署結案，不是開放真實交易，也不是完整 M3／M4 或 Foundation完成。
原168項需求、T-047、真人使用、真實OAuth／provider交易與第二操作者恢復未驗項保留。
Staging使用自有合成會員；production只做公開唯讀驗收。既有166／167／170證據及
production座標約束保留，schema171後禁止回退舊Worker，還原環境仍須隔離與現行授權對帳。

以下2026-10-14／15記錄為歷史觀察；當前具日期快照以上方收據與`current-state.json`為準。

## 2026-10-14 安全修補與組織搬遷發布現況

**最新營運證據截至10月15日07:04 UTC：** 兩環境仍為 `938516ee`／schema166，
沒有再次部署或重套 migration。Production 新 set `20c800a8` 於06:46 UTC、
staging 新 set `8abd2a28` 於07:02 UTC 完成遠端讀回、隔離 DB＋物件還原、
schema166 floor、捕獲期間 GC 證據及清理；舊失敗 set 的結果全部保留。
Production 的10項還原座標約束也通過：5項採精確審查的 PG18 deparser 形式，
其餘5項保持原定義；沒有通用正規化或修改原 SQL／floor／live verifier。

07:04 UTC 已原子替換日常 dispatcher 為 `86888671`，兩個版本化 wrapper 使用上述
完整還原所驗證的 adapter；舊 binding、wrapper、證據及 timer／service 檔案未改。
這次安裝沒有執行備份或 provider 操作。**新 operator 的自然排程尚未觀察**，
安裝時記錄的下一次為10月16日04:33 UTC（production）及04:46 UTC（staging）；
不能把手動完整還原或安裝成功當作排程成功。原 service 的失敗狀態也未改綠。

新收據及雜湊見[發布收據](rollout-security-2026-10-14.json)與[現況快照](current-state.json)。
真實 GitHub OAuth／會員操作／webhook、獨立 Maintainer #72、真人與第二操作者驗收
仍未完成；還原環境保持隔離，T-047 的現行授權／撤權對帳不因備份成功而結案。

### 截至05:29 UTC的發布與失敗紀錄（保留歷史結果）

追蹤 [#234](https://github.com/FreeTWAI/freedom-platform/issues/234)。本次選定安全發布
`938516ee`（tree `089a3774`）已部署 staging，Worker `368a5d67`、schema166；
本次沒有重套已存在的166。限定驗收以原非 browser 階段及 `zh-TW` locale browser
補驗組成，HTML 與10個入口資產 bytes 相符；原 selector timeout 保留，合成帳號與
Access 憑證已清理。部署前備份完成同一 set 的還原恢復；部署後 `e9ac7afd` 的
遠端讀回、DB＋59個物件還原、166 floor 與清理已通過，兩次早先 capture 失敗保留。
Staging 日常備份 dispatcher 已於10月14日20:29 UTC 切到938。

10月15日既有 staging timer 的 `fc39f036` 另於04:59 UTC capture失敗；05:04 UTC
唯讀對帳確認零殘留、兩個政策開關關閉且59個 reference pins 保留。這不改寫上述
`e9ac7afd` 的完整還原成功；新的 staging operator 修正僅備妥，尚未執行或安裝。

Production 於10月15日03:06 UTC 建立的新 before-set `87ec37e7` 已完整還原驗證，
取代因時效需要更新的成功舊 set。03:20 UTC 已確認 migration166 COMMIT；後續
不變表 assertion 因兩個背景 telemetry 表變動而失敗，原紀錄保留。03:28 UTC 的
唯讀對帳確認264／266表雜湊相同，另外兩表為 GitHub feed 與 credential health metadata；
9項政策、33張 RLS 表、唯讀權限與10項獨立記錄的座標 constraints 通過。
沒有重跑SQL，也不宣稱所有背景 writer 已停止或266表完全未變。
03:30 UTC 已部署相容938（Worker `24c6c843`），正式路由與原 cron 恢復。公開 health、
protocol、5張圖片、匿名權限／Origin 拒絕、HTML 與10個入口資產 bytes 及 live floor
驗收通過；未建立正式會員登入／browser／OAuth session，同來源 staging 證據明確沿用。
Production after-backup `480cd1f2` 於03:41 UTC dump逾時失敗；03:44 UTC 獨立對帳
確認該次資源已清理，原 `cleanupVerified=false` 失敗收據保留。第二次 `28c818b7`
只把 production dump 上限改為300秒，含 Docker啟動等待的整體預算仍逾時，04:03 UTC 確認失敗；
04:09 UTC 已獨立對帳零殘留資源。兩份原失敗保留，仍沒有成功的 production after-restore。
04:15 UTC 已把 production dispatcher 切至原 canonical166 adapter，避免排程繼續使用
不相容的165 operator；此為明列「after-backup待完成」的可回復設定修正，staging／timers
與實際 backup／restore／cleanup gates 不變，不以安裝紀錄代替成功還原。
既有 daily timer 於04:34 UTC 自行啟動 `19f7e10e`，確認選用938／原166 adapter；
04:43 UTC 仍在 capture 失敗。180秒 dump 子程序預算包含約72秒容器準備，實際執行約109秒
就被終止，部分輸出不能視為有效備份。04:46 UTC 唯讀對帳確認該次零殘留資源、政策關閉，
47個物件 pins 保留；原失敗不改寫，沒有另外手動重跑。三次 production after 均未完成還原。

05:06 UTC 啟動一次經審查的 production `e021ebfc`：容器準備移到 capture 前，
實際 dump仍保留180秒、核心流程1200秒上限。6,229,149 bytes的 DB dump、47個物件
與遠端讀回完成，但05:24 UTC 在restore階段失敗，原 `cleanupVerified=false` 保留。
05:29 UTC 獨立唯讀對帳確認該set零殘留容器／volume／DB session／dump client，
兩個政策開關關閉且47個 reference pins保留；沒有重新capture或宣稱還原成功。
本節營運證據截止於這次對帳；4份原失敗保留，修正版尚未安裝到日常 dispatcher，
完整 production after-restore仍未完成。
04:07 UTC 唯讀觀察有21筆 FreeTWAI repo、零舊座標，但沒有部署後同步紀錄。
04:27 UTC 排程診斷確認設定與目前版本相符，provider 的 scheduled 紀錄卻停在03:20；
04:10–04:21 的同版本觀察有295次成功 HTTP、零 scheduled 事件。這支持排程交付／傳播
缺口，provider 根因尚未確定。04:33 UTC 僅執行一次移除後立即恢復原 cron，兩次請求均
獲確認且版本／路由不變。04:53 UTC 的單次補驗已確認04:40:18自然 scheduled 成功，
feed watermark 推進至04:50:21，21／21筆新座標 repo 已同步，舊座標與錯誤均為零。
排程資料集本身沒有版本欄位；部署 binding 與另讀 traffic 均維持24c6／938。
自然同步的限定驗收已通過，不再加跑後續觀察；整輪仍待成功 production after-backup
與其座標 fence 還原驗證，這次同步結果不代替真人 OAuth／webhook 驗收。
精確時間與證據雜湊見[本輪具日期發布收據](rollout-security-2026-10-14.json)。
10月15日04:38 UTC 另讀回 Agent Kit／Storefront 的 main 已有有效 repo ruleset：
一位有效核准、App 綁定必要 checks、禁止刪除／force push、無 bypass；兩倉未啟用
CODEOWNERS review。這是兩倉的具日期觀察，沒有更動設定或宣稱全部 consumer 已驗收。

### 已合併來源與未部署範圍

06:47 UTC 已合併 main `1e584aa8` 包含後續 #658、#659 與 #680；#659 的4792 runtime、950個不重複
browser案例與5個公會 preview通過，原622／657一併收斂。這些後續來源與 #680
均不包含在本次938發布，AR167沒有部署。T-047、真實 GitHub OAuth／會員操作、
獨立 Maintainer #72 安裝、真人試用與第二操作者恢復仍未完成。資料與歷史 pins 的處理見
[Repo 串接搬遷說明](../../../development/repository-integration.md#2026-10-14-發布觀察)。

#680 舊 head `93c6dc3f` 的第二次 Verify仍失敗：runtime分區3只完成55／62檔
後逾時，已完成830案例零失敗且清理通過，仍不是整套成功。Browser原兩個失敗案例
已通過，但供貨案例 `hosted-supply-catalog.spec.ts:436` 單案120秒逾時；原 trace未保留，
不能判定是哪個操作卡住，也不能直接歸類偶發。後續候選保留原作者與既有3支PR範圍，
補上有界CI容量、去重與診斷改善；最新 head 經核准及必要 checks 後合併為 `1e584aa8`，
舊 head 的失敗結果不改綠。

以下具日期的歷史 source／rollout 保留，不冒充當前環境。

## 2026-10-11 產品就緒工作順序

**最新使用回饋（Ted 於本次對話轉述）：** 詢問的十人都認為啟動台混亂、看不懂如何使用。這是使用者轉述的負面體驗證據，沒有個別訪談紀錄；不可記為十人成功採用。Ted 進一步指出問題是整個 UI 缺乏功能層次與整合，不只是主按鈕不明顯。這輪優先整理功能歸屬、重複入口、工作區與管理邊界；補提示文字或收合原清單本身不能結案。程式與合成瀏覽器驗證仍不替代改版後的真人重新驗收。

本節依 Ted 最新派工，取代以下具日期歷史紀錄中的「下一步」排序。保留共同核心與原 168 項要求；這輪凍結新承諾擴張，以會員自主完成、公會長獨立開發為驗收。完整庫存外移與本人 CLI／BYOK 保留原範圍，排在這輪產品就緒之後；T-047 的隔離還原與當前撤權對帳持續有效。

[追蹤 #234](https://github.com/FreeTWAI-AI/freedom-platform/issues/234)承接所有工作包，不另開一套需求編號。下表從 `31166e52` 的來源對帳延續，保留 2026-10-12 UTC 的工程／發布觀察；不是完整真人試用驗收。當時兩環境為 R24 `dcb39351`，拒絕離開時保留未儲存活動草稿與媒體，明確捨棄才清除，結果不明的保存以原內容與冪等鍵重試且只建立一場活動。R21 產品流程與 migration165、R22 管理草稿與核准供貨區塊、R23 供貨商品庫分區及 [R24 收據](rollout-r24-2026-10-12.json)均保留；目前各環境版本以上方2026-10-14觀察為準。

| 使用者承諾／來源 | 原入口與已存在能力 | 本輪實際結果與剩餘條件 | 整合責任與驗收者 |
| --- | --- | --- | --- |
| 會員能理解功能層次（#234、#461） | 會員首頁、全站導覽、公會啟動台 | R21 已部署：首頁依工作目的分組，全站主要導覽與其他功能分開，公會分「工作／資源／管理」，管理權限仍逐次檢查。staging 實際載入畫面與三主題／手機寬度核對；十人原本的負面回饋仍保留，尚未請他們重驗，不以改完程式宣告易用。 | root 完成工程與發布；Ted 與自願會員驗找入口、理解與自主完成。 |
| 供應商不用開零售店即可供貨（#445、#449、#234） | 供應公會 → 同一供貨商品庫、商品／庫存、條件／同意與訂單 | R20 已交付商品庫的預留開放／停止 UI，R21 再驗不需 retail slug／publication，兩店各自定價／取得同意、三件持久 hold、只讀自身訂單、停止後重登與取消釋放。沒有以 API 代操作必要會員步驟。R23 再以普通合成會員走完三區切換、商品／編輯／條件草稿保留及原供貨與預留流程；手機與桌面三主題畫面已檢視。真人供貨用途仍待試用。 | root 工程／發布完成；現有擁有者與自願供應會員驗用途。 |
| 店主願意分享店面與商品（#234、#413、#453） | `#stores` 編輯／預覽／發布、`/shops/{slug}` 與已發布商品專頁 | R21 已部署品牌優先店面、商品專頁、OG 與登入後接續指定商品預留；私人草稿不輸出公開 metadata，保留 noindex。staging 實際商品連結、手機頁及未付款預留通過；素材仍是明示合成內容，尚無經同意的完整真實商家案例、外部分享服務或真人分享意願證據。 | root 工程／合成視覺驗證；Ted 與自願店主驗內容與用途。 |
| 開源作者分享並返回管理（#254、#260、#457） | 原投稿與本人同意、分享連結、`#my-content` 返回本人內容 | R21 已部署穩定 ID 編輯／整件撤下、再次预覽與同意；實測公開→撤下舊連結404→重新公開新連結→再次撤下。驗收發現「我的內容」原 flag 關閉，已在兩環境啟用既有能力，驗本人／他人隔離與登出撤權。Schema165 實際部署及還原 guard 已拒絕舊 Worker。完整分頁仍屬 #349；真人作者用途待驗。 | root 領域／設定／發布完成；作者本人同意，Ted 與自願作者驗自主分享。 |
| 活動主辦分享、報名與返回管理（#256、#257、#456） | `#events` 建立、原審核、活動頁、報名／取消與本人內容 | R21 已部署提交前預覽、IANA 時區與私人資訊分隔。staging 普通合成會員建立，由既有合成幹部經 UI 審核；匿名分享、另一會員報名／取消、重讀與主辦者返回取消活動皆通過。58 案是同 source／設定的分段實測，非一場不中斷執行。R24 再以普通合成會員在 1440 與 390 寬度核對拒絕與接受離開、hash、返回、直接活動網址、beforeunload、送出中阻擋，以及遺失回應後以同一冪等鍵重試且只留下一場活動。真人主辦者仍待驗；日曆是快照，通知未聲稱實際投遞。 | root 雲端旅程／隱私驗證；自願主辦者驗自主完成。 |
| 會長可以獨立新增區塊（#234、#451、GOV-07） | 原草稿／預覽／發布／回復，沿用 module descriptors 與嚴格 v1 | R21 已部署版本化 v2 組裝；供應與開源兩個真 API 樣板及免 DB 預覽已交付。新區塊不需中央公會特判；v1 歷史與預設配置不被自動改寫。#467 實際只改自己的供應元件並經 detna review 合併；兩位非核心公會作者交付仍未驗，Agent 範例不替代。 | root 平台邊界；兩位非核心公會開發者驗獨立交付，尚未邀請。 |
| 局部改動不承擔全平台日常成本（#438、#458、#466、C6／C7） | baseline／candidate descriptor 圖、反向相依、固定必要 verify | 2026-10-12 搬遷前觀察：組織 ruleset `24469536` 只更新 workflow SHA 至 `14f82aa2`，保留當時 approvals、CodeQL 與禁止 bypass。此為歷史安裝證據；目前 Free 的 repository ruleset／CODEOWNERS 審查方式見下方治理主路徑與現況快照。該 main 的完整 15 jobs／895 browser 先通過；安裝後 #467 的必要 CI 388 秒完成，38 runtime／15 整合 browser／3 preview 及 static-worker 通過，無手改 inventory。未知、核心、descriptor、新 import 等仍廣範圍；main 整合仍產生完整來源封存及實際還原證據。 | root 平台工具／runner；公會作者負責自己的元件。已證明安裝路徑，真人貢獻體驗另驗。 |

可明示限制後試用：未付款的 30 分鐘預留、日曆快照、尚未啟用的 Email 摘要。不可顯示假付款／寄送／佣金成功；停止新單仍保留合法歷史讀取與釋放。#349 的分頁／呼叫端、#255 的 Email 排程與 #260 作者同意等尾巴保持原 issue，不因其他 PR 已關而消失。

受控試用先準備少量自願會員與兩位公會開發者，記錄「要完成什麼、入口、是否自己完成、維護者協助次數、重新登入、失敗恢復、可分享成果、卡點 owner／修复」。人數是規劃，沒有既有採用數字；目前真人、非核心作者交付及第二操作者恢復皆未驗。未取得同意不發邀請、不搬運真實內容；負載驗證另用合成資料。

## 判定方式

- `not_run`：尚無足以支持實作或執行的映射。
- `implemented`：找到相關實作，仍缺原要求的必要驗收；不表示整條需求已實作完整。
- `partial`：已有部分實際執行證據，必要情境或最低環境尚未齊備。
- `blocked`：列出使整合驗收無法進行的具體相依條件及責任人，不能代替一般未完成工作。
- `accepted`：原要求所有必要正反例及最低證據均具備，附 source／candidate／環境。

測試原始碼存在不等於本輪測試通過；本機、隔離 CI、真實 GitHub、browser、
cloud、正式營運證據不得互換。Feature OFF 是發布設定，不是驗收結果。
168 是來源要求數，額外 R2 G／AP INV 原則與每列的多個必要 case 仍然保留。
後续 PR 更新同一索引的對應列，不以新增檔案、測試或 commit 數當作完成率。

## 八個完成門檻

| 門檻 | 收尾結果 | 整合責任 |
| --- | --- | --- |
| FC-00 | 現況、Agent 入口及 168 項需求可對帳，歷史不冒充 current | 整合 owner；A–D 各自維護證據 |
| FC-01 | 真人／執行端／網站服務各自驗身分，共用交易與稽核；所有私人讀面、replay／finalize 撤權通過 | A，D 協作 |
| FC-02 | 七類共用儲存、writer／reader floor、legacy bytes、GC／retention 有驗收結果 | B |
| FC-03 | 當前版本可還原，另一位有權操作者在新環境可接手 | B |
| FC-04 | 每倉適用 profile、實際 library 解析及呼叫、全部入口與正確 context | C，A／D 協作 |
| FC-05 | 偽造／過期／違規被拒，合法修改與升級可通過；一個有效 review 加明確合併授權 | C |
| FC-06 | 本人 CLI／BYOK、Grant／Attempt、私人 Result、Stop／Revoke、重連及 Extension／neo 交接 | D |
| FC-07 | 同一候選版本完成會員、私人 AI、contributor、第二操作者恢復四條流程 | 整合 owner |

## 第一批小工作包（保留研究起點）

每包固定來源、隔離 worktree、可改範圍及必要反例。共用 manifest／索引／入口由整合
owner 協調。依賴未齊時保留缺口，不把它改成 N/A 或自動移到下一個 sprint。

FC-00 本批先統一中央入口與索引。
[有界 context 證據](context-chunks-evidence-2026-10-05.json)在 exact candidate `664c05b` 接受 GOV-07 的 context-tool 層級：乾淨 worktree 的 root／deep module 都取得完整規則。GOV-09 client/subagent 接線與 GOV-10/12 hosted CI 仍有獨立未驗項。
Agent Kit README 的「先完成定位」仍需對齊中央
「定位可稍後補做」；各倉入口接線與真實完整 prepare 通過前，FC-00 不算完成。

| 工作包／原要求 | 已確認的缺口 | 下一個可驗收結果 |
| --- | --- | --- |
| C1：GOV-16、R2:D04 | `verify.needs` 及 aggregate 的第二份 job 清單都漏掉 `deploy-preflight` | 將 preflight 納入；full 必須 success，docs 可正常 skip，missing／failure／cancelled 拒絕。獨立審查後再升級 installed workflow pin |
| A1：R2:A03、FC-01（session 到期回歸） | 已以實際 receipt lock wait 重現並修補七個 media adapter 及 ordinary member command 的 session deadline 缺口（見下方證據） | 用隔離 PostgreSQL 的 receipt SELECT／INSERT barrier 跨過到期時間重現；保留既有 digest／namespace，修補後證明授權有效的 replay 正常 |
| B1：R2:S02/M05、FC-02 | 已以 DML-only role 重現 asset＋bytes INSERT，新增 migration116 修補；舊 SQL 與 bridge bytes 保留 | 先以 restricted runtime role 驗證 r2_only 下 INSERT／UPDATE 反例；若重現，以新增 migration 封口並保留合法 R2 寫入及 bridge backfill |
| C2：GOV-07/09/10/12 | DESIGN.md 與全 scope 大小阻礙已修補；完整分片仍保持每件 artifact 上限及全部規則 | 精確允許 DESIGN.md，保留任意根檔拒絕；後續有界分段載入含 baseline/candidate/delta 的完整必要規則，不能靜默截斷或縮 scope 避開未知修改 |
| D1：AP:AUTH-13/14/15、UF:INT-07/09/25 | 中央 device/bootstrap／member broker 已存在；Kit client 及 official CLI adapter 尚未完成 | Kit 接既有 API；一條受控真實 CLI／BYOK 工作走 Grant→Attempt→Result→修改→Stop／Revoke／換端，不拿 CLI pong 代替平台驗收 |
| C3：GOV-03/04/05/06/23 | 四倉有界 runtime 尚不證明共用 library 被呼叫，其餘五倉缺適用 profile | 真實 build resolution＋call path；unused import／自寫同形 client 必須失敗；cron／queue／MCP／bridge 按適用入口納管 |
| C4：GOV-04/06/20 | directory profile 固定完整 markup/styles bytes | 保留授權、escaping、URL／資料／輸出邊界反例；合法 style／wrapper／可及性修改可通過。獨立審查信任材料及 reference 升級 |
| B2：R2:S10/M06/M07/M08 | daily backup 明確要求 GC OFF；retention 只有 planner；歷史 unsettled PUT 尚未結案 | 先核對當前 schema 的 restore／reader floor；將持續 pins 與有界 retention executor 接回既有 coordinator，再驗 GC 相容，不直接開 flag |
| B3：R2:M07、AP:OPS-07、UF:INT-18 | 現有排程與恢复依賴原操作者主機 | 第二個有權操作者從新環境、受控秘密來源完成隔離 restore，驗舊授權不復活、unknown 不重播；列出 RPO／資料遺失範圍 |
| A2：UF:INT-04、GOV-25/26/29 | service/site schema 不代表 service adapter 已完成 | 具名 service entry 驗權，保留身分用途與環境分離；禁止改寫已驗證交易核心 |
| A3：R2:D09、GOV-05 | App／API 與 surface descriptors 有責任漂移 | 把工作 UI／路徑掛載拆回既有模組，驗證原業務、三主題、mobile、焦點、autosave 與聊天行為 |
| C5：UF:INT-23 | migration scanner/helper 仍 NNN | migration v2 同時升級兩個 runner，驗逆序 merge 與空庫 replay；保留所有已套用名稱／digest |
| C6：UF:INT-17、R2:D02/D03 | 一般修改仍 full CI | 影響映射保守 fallback，驗 Command／ArtifactRef 與 runtime MD 選中對應 jobs，不改最低證據 |
| C7：FC-05／原交付計畫 | 日常全倉 inventory 尚無 release 替代 | release/archive 的 artifact 與歷史 migration 完整性檢查接妥前，保留既有檢查 |

上表保留最初工作包。A1 receipt 到期與 B1 social bytes writer 已用隔離 PostgreSQL 重現並修補；精確版本、正反例及尚缺的雲端驗收見需求證據索引。C2 的完整 context 分段已在乾淨 worktree 驗收，GOV-07 依其原訂 context-tool 證據層級接受。其他套件、CLI 與治理來源修補仍是待審候選。

A1 的 [隔離 PostgreSQL 證據](receipt-session-evidence-2026-10-05.json)記錄修補前 21 個到期反例、修補後七個 media adapter 與 ordinary member 的拒絕／有效 replay；它只關閉 receipt 等待跨 session 到期的子項，未接受整列 R2:A03。

B1 的 [隔離 PostgreSQL／native local R2 證據](social-writer-evidence-2026-10-05.json)記錄三個 INSERT 反例與合法 R2、bridge、crypto bytea 正例。這只關閉 social thumbnail writer 缺口；R2:S02/M05 的全 purpose／目標環境驗收仍未完成。
現有 member broker 已經掛載並重查 owner／Grant／資料權限，不重新發明一套機器交易核心。
單純綁死 generic journal 的 target 會破壞「collection 建立新 Work」的合法不同 target，
不採用這個未證實的修補建議。

## 治理主路徑決策

2026-10-14 15:09 UTC 讀回中央 [main-baseline `25011111`](https://github.com/FreeTWAI/freedom-platform/rules/25011111)：
目前使用 GitHub Free 的 repository ruleset、PR 審查與 base branch 的
[CODEOWNERS](../../../../.github/CODEOWNERS) 保護 CI 控制檔。已啟用 code-owner review，
要求至少一份核准、最新 push 後核准、撤銷過期 review、解決討論，以及綁定來源 App 的
嚴格 `verify`／`CodeQL` checks；禁止刪除與 force push，沒有 bypass actors。
具日期讀回見[現況快照](current-state.json)的 `governance_current`；舊組織 pins 與
Directory queue 僅保留原日期的歷史證據，不推定各 consumer 的當前保護。

目前主路徑依賴維護者審查與必要 checks；同名 check、相同 App 與
`job.workflow_sha` checkout 不恢復舊 Enterprise 組織固定 workflow SHA 的保證，
也不表示 candidate 程式在獨立沙箱內執行。
Detached check publisher 保留為尚未安裝的選配能力；沒有離線／外部執行需求時，
不增加第二個必要 publisher 或人工批准。此決策取代舊 P2 文件「必須安裝
detached publisher」的工作順序，不撤回 GOV-02／19 或 artifact 的來源、簽章、
版本、撤銷與 ReleaseSet 驗收。

受審查的 selector／aggregate 不代表 candidate 提供的所有測試都是獨立 harness。
升級既有 workflow 時，先以可信來源的必要行為反例與合法修改正例建立邊界，
再做 fork 隔離、supersession／新 base、偽造 check 及空測試集的真實 GitHub 驗收。
不得把不可信 fork 程式與正式秘密放在同一有權工作中。
一份有效 review 及明確合併授權即可，不新增同義簽核。

## 本輪研究與實測界線

四線共 12 個 Grok CLI 工作包，指定 `grok-4.7`，provider 回報實際 alias
`grok-4.7-build`；另有兩份 `agy` `claude-opus-5-5-high` 審查。
部分 Grok 初次在 plan／turn limit 停止，已從原 session 接續取得結論；不把
退出碼 0 當成研究完成。兩份 Opus 使用給定的公開來源節錄，沒有工具執行。
所有建議另由整合者及各線核對來源；模型呼叫本身不是產品證據。

目前的本機修補結果記在 [patch evidence](closeout-patch-evidence.json)。這些結果
不等於已合併、installed pin 已切換或已部署，也未執行正式 DB／R2 私有操作。
正式站 fresh health、Access 回應、既有 operator 及 GitHub 證據分別見現況快照。

後續每次回報列出：關閉的原要求、新增／解除的實際阻礙，以及證據的
source／candidate／環境。FC-07 未通過前不宣告 Foundation Complete。

## 候選整合觀察（2026-10-05）

正式 source／部署／pins 仍以本頁開頭的具日期快照為準。平台 #130–152 各自取得有效 review 後，已由 #154（`558e4843`）以 merge commit 保留每個已審 head 一併合併；Agent Kit #17/#18 另行處理。每份 review 保留自己的來源與最低證據；合併不代表已部署、已升級 installed workflow pin 或已執行正式 migration。共用 library producer `057201218b6d4ae3e96b4ab838677f2b484b55fa` 保持固定。

原 168 項中，GOV-07 已依 context-tool tier 接受；R2:M07 已依當前候選 schema116 的完整 DB＋R2 restore tier 接受；UF:INT-04 已依固定候選 `533523f3f608f549e43fe1d2c9b59c27e796c0ec` 的 DB＋HTTP tier 接受（有效 site key 指定他人 principal／private Asset 即拒，own-site 與真 owner 正例成功），不代表雲端 rollout 或完整 service credential 生命週期。第二操作者接手仍是 FC-03，完整外部執行恢復仍是 AP:OPS-07，沒有借這一列的成功結案。其他原要求的狀態／反例／owner 以 [需求證據索引](requirement-evidence.json) 為準。

[跨包整合證據](composition-evidence-2026-10-05.json) 記錄 `697a995dc8f9ff15c77af62e3146d0721e67b550` 的核心、治理、備份與真實 CLI/build 回歸；只增加 App 拆分的 `de4bbee05baa893314f44839f82b75aad7f43cd9` 另通過真實會員 browser journeys。App 業務已拆回既有模組；API 掛載／完整 surface coverage 仍在收尾。這些是本機精確版本觀察，不是 FC-07 四條完整目標流程的驗收。

Agent Kit candidate `ff273fce3b65f7ebda3e6f0918d58e8ede2520ca` 已有共用 command／SDK 的實際 CLI 呼叫證據。舊 installed host 仍要求舊 profile；必須完成配套 review 與 host 升級才能採用，不能由 consumer lock 自行切換信任。其他入口仍不宣告 invocation coverage。

#130 的 `9f2630527de88ab4893b8ec2fd434259e063b15f` 與 #131 的 `44435955dbe7ae2f854fbb47daf3ec1f50fc5fba` 已直接查到完整 verify、CodeQL 與 deploy-preflight success；此觀察不代表已安裝 preflight 修正的新 workflow pin或已部署。原生 Grok startup／prompt ingress、真正 machine BYOK 的 Grant／Attempt／Result、GOV-25/26/29 的 service 用途、migration DAG profile／release floor、GC／retention 與第二操作者仍各有明確待辦。

## 2026-10-05 收尾 review 索引

下列 review 各自保留 exact head 與證據界線，不改寫現況快照的已部署版本／治理 pins。原168列由整合 owner 在 landing 對帳：各 PR 的列變更依自身 fork point 計算後套用，UF:INT-23 採 #149 的超集證據。

| 工作包 | review 與可驗證結果 | 仍未完成 |
| --- | --- | --- |
| C1 | [#130](https://github.com/FreeTWAI-AI/freedom-platform/pull/130)：aggregate 包含 deploy-preflight，full/missing/fail/cancel/docs-skip 分開判定 | installed workflow 升級與真實正反例；舊 hosted partial retry 超過原900秒窗口，不能記 pass |
| A1 | [#132](https://github.com/FreeTWAI-AI/freedom-platform/pull/132)：receipt SELECT/INSERT 等待跨過 session 到期會拒絕，合法 replay 保留 | 其餘私人讀面與正式環境驗收 |
| B1 | [#133](https://github.com/FreeTWAI-AI/freedom-platform/pull/133)：新 migration116 阻止 asset 標籤繞回 DB bytes，正常 R2 與 bridge 保留 | 正式 migration/floor、legacy bytes 退出 |
| C2 | [#134](https://github.com/FreeTWAI-AI/freedom-platform/pull/134)：完整分段 context 與独立 verifier 相依閉合；GOV-07 在 exact664 candidate 滿足原context-tool層級 | supported launcher/client、subagent 實際採用及 hosted 邊界 |
| D1 | [#135](https://github.com/FreeTWAI-AI/freedom-platform/pull/135)：sessionless device SDK、一次性 response-loss 與撤銷反例 | Grant/Attempt、私人Result、本人CLI與持久重連；僅AUTH13/14部分證據 |
| C3 | [#136](https://github.com/FreeTWAI-AI/freedom-platform/pull/136)：host 選定的 library profile 與 canonical 合法升級 | 實際 library invocation、其餘repo/entry、installed tuple 升級 |
| B2 前置 | [#137](https://github.com/FreeTWAI-AI/freedom-platform/pull/137)：未知 archive object 同時阻擋 prune 及舊 capture pin release | retention executor、GC日常啟用、第二操作者接手 |
| C4 | [#138](https://github.com/FreeTWAI-AI/freedom-platform/pull/138)：真實 build 容許合法CSS/ARIA修改並拒絕資料/安全反例 | 獨立review後 hosted canary 與固定workflow升級；非browser視覺驗收 |
| B3 前置 | [#139](https://github.com/FreeTWAI-AI/freedom-platform/pull/139)：daily snapshot pins 保護退役原物件；R2:M07 在 exact `ae239d38` 的完整 DB＋R2 restore tier 接受 | 第二操作者新環境接手（FC-03）、AP:OPS-07 外部恢復、雲端 readback |
| D2a | [#140](https://github.com/FreeTWAI-AI/freedom-platform/pull/140)：有界 native text 程序邊界、preclaim lease fencing；真實 Grok 在 claim／context 前即判定不可用 | 實際模型推論、authenticated receipt 與 Result finalize |
| A2 前置 | [#141](https://github.com/FreeTWAI-AI/freedom-platform/pull/141)：shop key 在交易等待中到期即拒絕並 rollback，含 replay | 共用 site/service principal 見 #151 |
| C3 producer | [#142](https://github.com/FreeTWAI-AI/freedom-platform/pull/142)：固定 producer `057201218b` 匯出 canonical device command 與 launcher | Agent Kit 配套 review 與 installed host 升級 |
| C3 | [#143](https://github.com/FreeTWAI-AI/freedom-platform/pull/143)：固定 host 下實際執行 Agent Kit canonical device CLI；candidate lock 不能選 authority | 其他入口 invocation coverage |
| App 拆分 | [#144](https://github.com/FreeTWAI-AI/freedom-platform/pull/144)：portal 業務 panel 移回既有模組 | 完整 App/API 責任切分與 surface audit |
| C5a | [#145](https://github.com/FreeTWAI-AI/freedom-platform/pull/145)：單一有界 migration planner；缺漏、修改或未知的 applied ledger 拒絕 | host 核准的 DAG profile、release floor |
| C3 | [#146](https://github.com/FreeTWAI-AI/freedom-platform/pull/146)：只允許已審的前一版與目前 consumer tuple；未知／混合 tuple 拒絕 | installed native workflow pin 升級 |
| D2a | [#147](https://github.com/FreeTWAI-AI/freedom-platform/pull/147)：機器 text command 以真實簽章 device 與 locked SQL authority admission | 掛載的 machine HTTP endpoint（D2b）、broker 與 Result |
| D2a | [#148](https://github.com/FreeTWAI-AI/freedom-platform/pull/148)：model／Asset authority ports 共用，member constructor 權限不變 | 具體 machine adapter、broker dispatch、Result 整合 |
| C5b | [#149](https://github.com/FreeTWAI-AI/freedom-platform/pull/149)：兩個 migration 入口共用 pinned runner，A→B／B→A／空 catalog 結果一致 | DAG profile 與 release-floor set 語意（C5c）、雲端執行 |
| C6 | [#150](https://github.com/FreeTWAI-AI/freedom-platform/pull/150)：bounded frontend 葉節點修改保留必要 jobs，只略過無關 consumer／deploy jobs | installed workflow 升級；不宣告 hosted 成本節省 |
| A2 | [#151](https://github.com/FreeTWAI-AI/freedom-platform/pull/151)：site service authority；UF:INT-04 在 exact `533523f3` 的 DB＋HTTP tier 接受 | GOV-25/26/29、雲端 rollout、service credential 生命週期 |
| API 組合 | [#152](https://github.com/FreeTWAI-AI/freedom-platform/pull/152)：私人 AI transport 安裝路徑集中到單一 classifier | 完整 App/API 責任與 surface 義務 |

同一整合程式候選 `3bc3eb6843d0e7112fc231212a1e7169094cad08` 的本機 HTTP/DB、治理工具、schema116 七類媒體 restore 都有實跑結果；FC-07 所需四條完整流程仍未齊全，不能用這些回歸結果代替。

## 2026-10-06 收尾 review 索引

#154 land #130–#152 之後，#155–#159 與 #161 各自取得有效 review，依序以 merge commit 合併（括號內為 merge commit）。需求證據索引只在對應列附加各 PR exact head 的執行證據，沒有任何列改變狀態，accepted 仍是 3 列。合併不代表已部署、已升級 installed workflow pin，或已在任何環境套用 migration 116–119。

| 工作包 | review 與可驗證結果 | 仍未完成 |
| --- | --- | --- |
| 整合 | [#154](https://github.com/FreeTWAI-AI/freedom-platform/pull/154)（`558e4843`）：#130–#152 的已審 head 以 merge commit 一次 land，需求索引依各 review 的 fork point 重算 | installed workflow pin 升級、部署、migration 116–118 套用 |
| C7 | [#155](https://github.com/FreeTWAI-AI/freedom-platform/pull/155)（`cc06e7ed`）：exact Git source tree 的 archive／verify／restore 工具；`570d1aba` 完整還原後 `git write-tree` 與 source tree 相同 | daily 全倉 inventory 不變；release workflow、ReleaseSet 與 inventory 移位未接；不關閉任何原要求列 |
| C5c | [#156](https://github.com/FreeTWAI-AI/freedom-platform/pull/156)（`81610f93`）：release-compatibility host v3，exact `(name, sha256)` 集合、host-only DAG profile 與相依閉合；v2 host 不變 | 安裝到 preflight／operator、真實 `v2_` migration |
| B3 | [#157](https://github.com/FreeTWAI-AI/freedom-platform/pull/157)（`70ed4724`）：producer 程序與 container 結束後，新程序只靠 handover 檔與 operator 提供的 identity 還原 sealed media recovery set | 第二位授權操作者在新環境接手（FC-03）、外部 recovery generation；不關閉任何原要求列 |
| D2b | [#158](https://github.com/FreeTWAI-AI/freedom-platform/pull/158)（`e8484245`）：已登記 device 以 DPoP＋SQL admission 執行 machine model Step；一次性 broker 授權只存 digest，broker 重讀 SQL 後跑既有 BYOK Step；migration 119 | 真 BYOK、Worker／key profile 安裝、reader floor、CLI custody、重連、Extension／neo |
| B4 | [#159](https://github.com/FreeTWAI-AI/freedom-platform/pull/159)（`b8fa58a8`）：還原較舊的 DB snapshot 後，SQL 中已被 rotate 的 credential 回到 active，但 fresh broker 讀到外部 authority floor 4，claim／issue／bridge／rotate 都被拒絕，provider 不會被呼叫（owned 雙 PG18、本機 Miniflare authority） | 與部署的獨立 authority 及遠端 generation readback 結合、第二位操作者、雲端 R2 |
| 頭像 | [#161](https://github.com/FreeTWAI-AI/freedom-platform/pull/161)（`626e56c3`）：沒有 model key 與 BYOK 已撤銷的會員在 Private AI 關閉時，把頭像存到 `r2_only` 共用 R2（ui-e2e 第三個 pass，本機 Miniflare R2） | 雲端 R2 上的同版本正例、綁定整合 candidate |

### 10 月 6 日：installed workflow pin 與 staging／production rollout

中央 `24469536` 的 required workflow 已固定到 `d1c9e18f`（#167 合併後的 main），C1（#130）與 C6（#150）的
selector／aggregate 現在由 installed pin 執行；C6 沒有另做 hosted 正反例。一次性 probes 實際驗到：換 pin 後舊綠燈被拒、
close／reopen 重驗、base 前進後 strict freshness 拒絕、選中的 deploy-preflight 失敗被拒、竄改加偽造綠燈被拒、
fork 竄改被拒；hostile fork 在執行 `test:governance` 的 jobs 只取得 Contents／Metadata 唯讀 token、Secret source None，
列出的部署／R2／provider／signing／OIDC 變數都不存在，push 被拒；預設 `persist-credentials` 下候選程式仍讀得到該唯讀 token。以 main 為目標的正例 green，負例 merge 405。
GOV-15 依此改為 `partial`；GOV-16／R2:D04／GOV-17／R2:D07 附加證據但不改狀態，accepted 仍是 3 列。
候選 npm script 可讓選中的 suite 跑 0 tests 而 verify 仍成功（probe E），這個缺口未修。

同一 d1c9 先部署到 staging：37 個 selected checks，migration 114–119 由 staging migrator 套用，
`FREEDOM_SHOP_KEY_POLICY` 為 `legacy-compatible`。owner 於 20:34Z 核准後，21:13Z 部署到 production，取代 hotfix `e07d61d2`：
migration 前的備份做過隔離還原與遠端 readback（第一次在 capture 階段因單一 R2 物件讀取逾時失敗，重跑一次通過），
migration 114–119 由 production migrator 套用，`FREEDOM_SHOP_KEY_POLICY` 用與 staging 相同的 `legacy-compatible`；
22 個唯讀公開 checks 通過，5 次 fresh health 都是 d1c9，兩個環境的 backup pin 都改成 d1c9。這些是 selected checks，不是 foundation acceptance。

同日第二輪：owner 於 21:35Z 核准後，main `8d2213d7`（d1c9 之後的 #180／#182／#162）於 21:52Z 部署到 staging：
37 個 selected checks 通過，部署後 cron 有寫入，after-rollout 備份做過隔離還原與遠端 readback。
22:12Z 再以同一份 dist 部署到 production：22 個唯讀公開 checks 通過，5 次 fresh health 都是 8d2213d7，
after-rollout 備份通過，部署後 cron 有寫入；兩個環境的 backup pin 都改成 8d2213d7。同樣是 selected checks，不是 foundation acceptance。
這一輪沒有 migration（兩個 ledger 唯讀確認到 119、無 pending），`FREEDOM_SHOP_KEY_POLICY` 維持 `legacy-compatible`。
#162 的具名 prepared statement 只在 Private AI 開啟（兩邊都關）或尚未部署的 credential broker 才會執行，
所以這一輪沒有在 Hyperdrive 上驗到它。回滾是重新部署 `d1c9e18f`，不需要還原資料。
改成 `purpose-bound-only` 前要先完成 agent-commerce 的 controlled legacy exit。
細節見[現況快照](current-state.json)與[治理安裝紀錄](governance-installation-2026-10-04.md)。

### 10 月 7 日：installed workflow pin 升級至 6ffdf94a

中央 `24469536` 的 required workflow 於 11:15:36 UTC 改固定到 `6ffdf94a`（#195 合併後的 main；workflow 變更來自 #189 與 #195）。
10 月 6 日 probe E 的缺口在 required suites 上已修正：node:test、pytest 與瀏覽器 suites 由固定 commit 的 runner 執行，
對照審查過的基準清單，每個檔案、每個 case 都要有結果，候選的 test scripts 與 Playwright／pytest 篩選設定不再決定 suite 內容。
一次性 probes 實際驗到：換 pin 後舊綠燈被拒、close／reopen 重驗；候選改掉 test scripts 並放入敵意 Playwright／pytest 設定時，
每個 pinned suite 的數量仍與良性對照相同（e2e 516／89、contracts pytest 671／16、governance 439／33、runtime 3,212 tests）；
刪除審查過的測試檔或加上 skip 時，各家族都失敗且 merge 405。以 main 為目標的正例 green，負例 merge 405。
GOV-16／R2:D04／GOV-17／R2:D07 附加證據但不改狀態；GOV-15 仍只有 d1c9 的 fork 證據（這次沒有 fork 可測），accepted 仍是 3 列。
build、typecheck、dry-run 與 `check:*` 腳本仍由候選定義，候選可以把它們改成空操作；候選程式也仍與 trusted runner 在同一台 runner 上執行。
這次只改 CI 規則，沒有部署；當時 production 與 staging 仍是 `8d2213d7`。
細節見[治理安裝紀錄](governance-installation-2026-10-04.md)與[本次證據](../../verification/main-ruleset-2026-10-07.json)。

### 10 月 7 日：第三輪 staging／production rollout（main 687dee87）

owner 於 12:38Z 回覆「1.2.3.4 都你決定就好 除非你覺得該我決定」，把這次發布交給整合 owner 決定；
整合 owner 決定先 staging、再 production dark：套用 migration 120–124，兩邊都不設定 `FREEDOM_GUILD_LAUNCHPAD_ENABLED`。
main `687dee87`（8d2213d7 之後合併的 21 個 PR，其中 #225 一起合併 #187／#203／#208／#210／#105）於 14:10Z 部署到 staging：
migration 前的備份做過隔離還原與遠端 readback，migration 120–124 由 staging migrator 套用，43 個 selected checks 通過，部署後 cron 有寫入。
14:25Z 再以同一份 dist 部署到 production：migration 前的備份同樣做過隔離還原與遠端 readback，120–124 由 production migrator 套用，
27 個唯讀公開 checks 通過，5 次 fresh health 都是 687dee87，部署後 cron 有寫入；
兩個環境的 after-rollout 備份都做過隔離還原與遠端 readback，backup pin 都改成 687dee87。同樣是 selected checks，不是 foundation acceptance。
兩個 ledger 在 migration 後都確認 123 個 migration 檔全部套用到 124，沒有 pending 或 mismatch；capacity 與 authority policy 列都是 0，
所以若開啟 flag，tenant 寫入會回 `policy_unconfigured`。`FREEDOM_SHOP_KEY_POLICY` 維持 `legacy-compatible`，Private AI 兩邊仍關閉。

相容性：migration 前對兩個 live 資料庫做 precheck，12 項 constraint 檢查都是 0 筆違反，也沒有缺少的 drop target；
在 scratch 資料庫比對 schema，47 個既有物件有變更，全部只是放寬：每項只加 tenant 分支或 8d2213d7 留 NULL 的欄位，
新 foreign key 是 MATCH SIMPLE，新 trigger 只作用於 tenant_execution 列。
回滾是把受影響的 Worker 重新部署成 `8d2213d7`，不需要還原 schema；若要還原資料，從 migration 前的備份開始（production `ce4913c6`、staging `723736c4`）。

- staging：rollout 第 1 次因 prep.sh 缺唯讀 plan 步驟在部署前停止；acceptance 第 1 次 `guild_categories_unmounted` 失敗（flag 關閉時路由不存在，匿名 GET 回 401 `login_required` 而非預期的 404，檢查已修正），第 2 次因新的 Access service token 尚未生效失敗（改為先輪詢 readiness），第 3 次 43／43 通過。
- production：第一次 migration 在 commit 120–124、runtime grants 與 30-verify-readonly 後停在 `operator_privileges_unchanged`（media operator 權限快照多出 8 筆 column 列，是 migration 123 在 assets、asset_upload_intents 新增的欄位經既有 table-level INSERT／SELECT grant 帶出；去掉即與 migration 前的 hash 相同，沒有 GRANT 變動），由 finish script 重跑唯讀驗證與 login probes 後寫出 receipt；public acceptance 第 1 次在部署後數秒 `presence_bundle_matches_build` 失敗，該檔隨後三次以 HTTP 200 回傳 build 的 sha256，第 2 次 27／27 通過。

#198（JSON body 讀取沒有上限）由本輪的 #203 修正。staging 從外部看不到 Worker 是否提前停止讀取：
Cloudflare 會保留未結束的 chunked request body，約 15 秒後 reset（fetch probe 15,192 ms 後 TypeError；raw TLS probe 送出 40,053 bytes，15,133 ms 後 ECONNRESET）。
提前停止由 verify run 37630943060 的 `tests/runtime/platform-json-body.test.ts` 證明（未讀完就 cancel source；宣告超量的 body 不會被讀取），
staging 的 `json_stream_limit_413` check 則證明有界路徑已上線。

限制：guild launchpad 的表已建立，但 flag 不設定時不會使用，也沒有寫入任何 capacity／authority policy 列；
#162 的具名 prepared statement 只在 Private AI 開啟（兩邊都關）或尚未部署的 credential broker 才會執行，這一輪仍沒有在 Hyperdrive 上驗到它；
selected checks 不是完整 foundation acceptance，production checks 是唯讀 HTTP。
細節見[現況快照](current-state.json)。

### 10 月 7 日：第四輪 staging／production rollout（main e8cd72e8，migration 125）

owner 於 22:22Z 核准：staging 立即部署 main `e8cd72e8`（第一個包含 migration 125 的版本），staging 通過後 production 部署同一個 SHA，
兩邊都不設定 `FREEDOM_GUILD_LAUNCHPAD_ENABLED`；部署後在 Discord 公告重新登入（文字由 owner 核准）。
`e8cd72e8` 是 `687dee87` 之後合併的 #228、#229、#206、#226、#235、#243、#241；#243 一起合併 #231／#240，#241 一起合併 #205／#207。

- staging：migration 前的備份做過隔離還原與遠端 readback，125 由 staging migrator 套用並重套 runtime grants、通過唯讀驗證。
  在部署新版本前，先對已 migrate 的 staging 跑舊版 `687dee87` 的 acceptance，43／43 通過，作為回滾證據。
  22:46Z 部署 `e8cd72e8`，47 個 selected checks 通過（含新的 cookie 檢查），部署後 cron 有寫入。
- production：migration 前的備份同樣做過隔離還原與遠端 readback，125 由 production migrator 套用；media operator 的權限快照前後相同。
  23:07Z 以同一份 dist 部署，29 個唯讀公開 checks 通過，5 次 fresh health 都是 `e8cd72e8`，部署後 cron 有寫入。
- 兩個環境的 after-rollout 備份都做過隔離還原與遠端 readback，backup pin 都改成 `e8cd72e8`。
  production 的 after-rollout 備份到第 4 次才通過：第 1、3 次執行中 pg 連線出錯（socket 逾時；exporter 被自己 120 秒的 idle-in-transaction 上限終止），程序直接結束、沒跑 cleanup，`asset_maintenance_policy` 停在 enabled，第 2 次因此在 preflight 失敗。每次都由 migrator 執行 adapter 自己的 cleanup 語句關回去，期間沒有任何 tombstone、deletion fence 或物件刪除。coordinator 的修正（延長 exporter 上限、加 error listener）另開 PR。
  備份裡 snapshot evidence 的列數，在 18 張 row security 表上都與 migrator 讀到的相同。

Row security：125 在 18 張表啟用（不 FORCE）row security，共 29 條 policy，另加 4 個 invoker STABLE 的 context 讀取函式。
migration 前兩邊都沒有 row security 表，18 張表都由 migrator 擁有，runtime 角色沒有 BYPASSRLS，備份角色有 BYPASSRLS（owner 選定，當天下午授予）。
兩邊都還沒有任何 tenant 列，所以 probe 只能證明「沒有綁定 context 的 runtime 看得到全部非 tenant 列」與「備份角色看得到全部列」，
沒有實際綁定過 tenant。

登入 Cookie：HTTPS 網站改為只讀 `__Host-freedom_session`（#241 的 #207）。舊名稱 `freedom_local_session` 回 401，
重複的 `__Host-` cookie 回 403 `credential_kind_rejected`；所以部署後每位會員都會被登出一次。23:07Z 已在 Discord #📜│公告 發出重新登入公告。

回滾是把受影響的 Worker 重新部署成 `687dee87`，不需要還原 schema：沒有綁定 context 的請求仍看得到所有非 tenant 列，
`687dee87` 從不綁定 context，flag 關閉時也不寫 tenant 列，而且它的 acceptance 已在 migrate 後的 staging 通過。
若要還原資料，從 migration 前的備份開始（production `5cc20f05`、staging `914c5e68`）。

限制：guild launchpad 仍未啟用，row security 只由 migration probe 與 CI 驗證，沒有真實 tenant 流量；
每日備份的 operator source `c3e5a537` 早於 `packages/db/snapshot-evidence.ts` 的 fail-closed `row_security = off`，完整性靠備份角色的 BYPASSRLS 與上面的列數比對；
selected checks 不是完整 foundation acceptance，production checks 是唯讀 HTTP。
細節見[現況快照](current-state.json)。

### 10 月 8 日：第五輪 staging／production rollout（main c84829e2，migration 126、127）

`c84829e2` 是 #227 的 merge，也就是 M1 候選版本 X。它包含 `e8cd72e8` 之後合併的 #238、#245、#264、#244、#248、#246、#242、#227；
#244 一起合併 #204、#222、#236、#237，帶進 migration 126（`oss_projects.public_metadata_revised`）與 127（`sessions.prune_retained_at` 加三個外鍵索引）。
staging 依 owner 的委派部署；production 由 owner 在看過 staging 證據與 #237 的刪除筆數後核准（2026-10-08T05:20Z，「Deploy X now」）。兩邊都不設定 `FREEDOM_GUILD_LAUNCHPAD_ENABLED`。

- staging：migration 前的備份做過隔離還原與遠端 readback，126、127 由 staging migrator 套用並重套 runtime grants、通過唯讀驗證。
  部署前先對已 migrate 的 staging 跑舊版 `e8cd72e8` 的 acceptance，47／47 通過，作為回滾證據。
  05:08Z 部署 `c84829e2`，47 個 selected checks 通過，部署後 cron 有寫入。
- production：migration 前的備份同樣做過隔離還原與遠端 readback，126、127 由 production migrator 套用；media operator 的權限快照前後相同。
  05:32Z 以同一份 dist 部署，29 個唯讀公開 checks 通過，5 次 fresh health 都是 `c84829e2`，部署後 cron 有寫入。
- 兩個環境的 after-rollout 備份都做過隔離還原與遠端 readback，backup pin 都改成 `c84829e2`。

#237 的定期清除：每次 cron 從 `auth_rate_limits`、`login_attempts`（視窗超過 1 天）、`password_reset_tokens`（過期超過 1 天）與 `sessions`
（過期或撤銷超過 1 天；保留每位會員最新的一個 session，以及仍被外鍵參照的 session）各刪最多 500 筆。驗證方式是在舊版仍執行時固定一個 cutoff 計算可清除的筆數，
X 的 cron 跑過後在同一個 cutoff 重算：staging sessions 137→0、rate limit 50→0、login attempts 16→0、reset tokens 2→0；因外鍵保留的 session 0 筆；持有 session 的會員 30→32；production sessions 429→0、rate limit 1711→710、login attempts 197→0、reset tokens 13→0；因外鍵保留的 session 0 筆；持有 session 的會員 410→410。這些刪除只能從 migration 前的備份還原。

回滾是把受影響的 Worker 重新部署成 `e8cd72e8`，不需要還原 schema：126、127 只新增欄位與索引，`e8cd72e8` 不讀寫它們，
而且它的 acceptance 已在 migrate 後的 staging 通過。回滾後清除就停止；已刪除的資料只能從 migration 前的備份（production `bdc249cd`、staging `2e0c96e2`）還原。

限制：guild launchpad 仍未啟用，tenant 路由沒有掛載，row security 只由 migration probe 與 CI 驗證；
每日備份的 operator source 仍是 `c3e5a537`，#264 已合併但要等 operator source 重新 pin 才生效；
selected checks 不是完整 foundation acceptance，production checks 是唯讀 HTTP。
細節見[現況快照](current-state.json)。

### 10 月 8 日：staging 啟動台試開（X，flag 只在 staging 開啟）

owner 在 2026-10-07 核准只在 staging 試開的計畫與暫時容量值。第五輪讓兩個環境都執行 X 之後，整合負責人依同一份核准把試開改到 X。
production 不受影響：flag 仍未設定，也沒有 capacity policy 列。

- 05:51Z：staging migrator 以 #227 的 `scripts/tenant-policy.ts`（status → plan → `apply --execute`，expect revision `none`）寫入預設範圍的暫時
  capacity policy：10／3／2／1000／104857600／2／0，plan_ref `interim-default-20261007`，revision 1。
- 主力偏好的 backfill 狀態唯讀記錄為 blocked：還有 28 位舊會員未對應，其中 27 位的舊主力公會沒有已核准的分類（`unknown_category`）。
  這不是 gate；三分類看板只在 `migration_state` 為 `switched` 時顯示，是否切換由 owner 另外決定。
- 06:03Z 開始的試開前備份做過隔離還原與遠端讀回。
- 06:11Z 以第五輪同一份 dist 重新部署 staging，唯一的變更是 `FREEDOM_GUILD_LAUNCHPAD_ENABLED=true`（Worker 版本 `7b7050c2`）。
  部署前後的 live readback 都確認 production 仍是 X、flag 未設定。47 個 selected checks 通過：網站回報 launchpad 啟用，
  匿名讀得到公開分類清單（catalog revision 18：3 個區塊、12 個已核准、6 個待審）；其餘檢查與第五輪相同。

回滾是把 staging 以同一份 dist 重新部署、不設 flag；policy 列與試開期間建立的 tenant 資料會保留。

試開本身不是 guild launchpad 的驗收；guild-work 驗收見下一節。

### 10 月 8 日：staging guild-work verifier（X）

- 06:30–06:31Z：owner 用自己的 Cloudflare Access 身分，在 staging 管理後台（公會管理 → 設定公會長）把示範帳號 `maker@local.test`
  設為 `guild_product_quality_supply` 與 `guild_commerce_sales` 的公會長。兩個公會原本都沒有公會長，所以沒有取代任何人；
  任命時 maker 成為兩個公會的正式成員。走的是產品流程，沒有直接改資料庫。公會長不是平台管理員，verifier 用到的 tenant 路由
  只檢查公會正式成員與 tenant 角色，不看公會幹部。
- 06:31Z–06:32Z：整合負責人以 60 分鐘的 Access 授權執行 X 的 `scripts/verify-guild-work.mjs --expect-sha c84829e21a2b43753b32bb18ebb8f4ac739175eb`（#242），
  結束後撤銷授權。served SHA 等於 X，4 項檢查全部通過：
  - preconditions：網站回報 launchpad 啟用，build identity 等於 X。
  - A creates：會員 A（maker）建立 tenant 與業務空間，開啟手動工作，存一個 Work、一份筆記 Result 與一個 64 KiB 附件 Result（真實 R2）。
  - A logs out and back in：登出再登入後讀回相同的 ID、版本與位元組 digest，並存下筆記的下一個版本。
  - B and anonymous are refused：另一位會員 B（`reviewer@local.test`）與只有 Access 的匿名者，對所有已發給 A 的內容路徑
    以 GET、HEAD、Range 存取都被拒絕。
- receipt `20261008T063130038Z-83185463`（SHA-256 `185e6746928b71be17388d1c7ae656998d5b831e4400acc3dc348b28f1959b78`）保存在 operator journal；內含 tenant ID，所以不公開。
- 依 `acceptance-progress.json` 記錄：T-005 通過；T-023 依 M1 範圍只驗權限半部，`variants.M1` 通過，完整案例記為 partial
  （X 沒有匯出路由，匯出還原沒有執行）。
- 06:33Z 開始的試開後備份做過隔離還原與遠端讀回。

M1 仍未接受：28 個 M1 案例中其餘 26 個尚未執行，M1 也還沒有指定 candidate_sha。production 的開啟見下一節。

### 10 月 8 日：production 開啟 guild launchpad（X）

owner 在 06:47Z 看過 staging 的 guild-work 結果後決定開啟 production（「271 合 , production 開」），容量值選「跟 staging 一樣」。
staging 不受影響：仍是 X、flag 開啟。

- 06:55Z：production migrator 以 #227 的 `scripts/tenant-policy.ts`（status → plan → `apply --execute`，expect revision `none`）
  寫入預設範圍的暫時 capacity policy：10／3／2／1000／104857600／2／0，plan_ref `interim-default-20261007`，revision 1，與 staging 相同。
- 主力偏好的 backfill 狀態唯讀記錄為 blocked：還有 305 位舊會員未對應，其中 156 位的舊主力公會沒有已核准的分類
  （`unknown_category`）。三分類看板在 production 同樣隱藏。
- 06:56Z 開始的開啟前備份做過隔離還原與遠端讀回。
- 07:05Z 以第五輪同一份 dist 重新部署 production，唯一的變更是 `FREEDOM_GUILD_LAUNCHPAD_ENABLED=true`（Worker 版本 `2871eefe`）。
  部署前後的 live readback 都確認 staging 仍是 X、flag 開啟。29 個公開的 selected checks 通過：網站回報 launchpad 啟用，
  匿名讀得到公開分類清單（catalog revision 24：3 個區塊、12 個已核准、12 個待審）；
  其餘檢查與第五輪相同。新的 DNS 解析下 4 次 health 讀回都是 X。production 沒有建立任何帳號。
- 07:05Z 開始的開啟後備份做過隔離還原與遠端讀回。

回滾是把 production 以同一份 dist 重新部署、不設 flag；policy 列與開啟期間建立的 tenant 資料會保留。

production 沒有示範帳號，所以 guild-work verifier 只在 staging 執行；production 的開啟不是 M1 驗收，M1 仍未接受。
`tenant_authority_policies` 兩邊都是 0 列，經營權移交與復原會回 403 `policy_unconfigured`，政策值（OPEN-02／03）由 owner 決定。

### 10 月 8 日：第六輪 staging／production rollout（main d2900cf4，migration 128～130）

`d2900cf4` 是 #278 的 merge。它在 X（`c84829e2`）之後帶進 P-D1（#239，migration 128：應用目錄、模組實例登錄、啟動操作與容量保留）、
P-D2a（#269，129：實例暫停與恢復）與 P-D2b（#278，130：實例封存），以及 #273、#271（#265、#266）、#275、#277。
兩個環境的 `FREEDOM_GUILD_LAUNCHPAD_ENABLED` 都維持 `true`，所以這些路由隨部署上線。staging 依 owner 的委派部署；
production 由 owner 決定直接上線（「太囉嗦了 你全部把它做一做就 go live 不用測這麼多 浪費時間  去live 測就好 死不了人」、「我選 直接部署直接上線」），不跑 staging 驗收，到 live 再測。

- 兩個環境各自先做 migration 前的備份（staging `469c43e9`、production `a972e586`），都做過隔離還原與遠端讀回。
- 128 對 X 不相容：它把 `module_instances.module_release_ref`／`contract_ref` 與 `deployment_bindings.contract_ref` 改成 NOT NULL，
  X 建立新的 manual-work 實例會失敗。所以每個環境都是 migration 後立刻部署 `d2900cf4`。
- staging：migrator 套用 128～130，重套 runtime grants（含 128 的 definition 表授權段落）並通過唯讀驗證，08:22Z 部署（Worker 版本 `eafb925e`）。
  128 的 backfill 寫入 1 個 installation、1 個模組連結（對應 1 個既有的 manual-work 綁定）。
- production：同樣由 migrator 套用並驗證，media operator 的權限快照前後相同；08:24Z 以同一份 dist 部署（Worker 版本 `2114352b`），
  29 個唯讀公開 checks 通過，4 次 fresh health 都是 `d2900cf4`。128 的 backfill 寫入 0 個 installation、0 個模組連結（對應 0 個既有的 manual-work 綁定）。
- row security：128 在 9 張新 tenant 表啟用（不強制），每張一條 policy，合計 27 張表、38 條 policy；三張 definition 表對 runtime 只有 SELECT。
  兩邊 migrate 後，runtime 與備份角色在同一個 snapshot 的登入 probe 都通過。
- 兩個環境部署後的備份（staging `9cc41da1`、production `98b497d5`）都做過隔離還原與遠端讀回，backup pin 都改成 `d2900cf4`。
  staging 部署後 cron 有寫入（最後同步 08:40Z，last_error 8→8）；production 部署後 cron 有寫入（最後同步 08:41Z，last_error 6→6）。

回滾：128 之後不能再部署 X。可以關閉 flag，或修正後再部署；schema 只能從 migration 前的備份還原。

限制：P-D1／P-D2a／P-D2b 的 T-ID 案例（T-008、T-016、T-017、T-018、T-021、T-022、T-024、T-051、T-055、T-057、T-058）沒有執行，staging 也沒有跑驗收；production checks 是唯讀 HTTP，兩邊都沒有建立帳號。
這次 rollout 不是 M1 驗收，M1 仍未接受。每日備份的 operator source 仍是 `c3e5a537`。細節見[現況快照](current-state.json)。

### 10 月 8 日：第七輪 staging／production rollout（main 3685d626，migration 131）

`3685d626` 是 #282 的 merge。它在第六輪（`d2900cf4`）之後帶進 P-B2b（#279，migration 131：成員的模組實例權限）與
P-D3a（#282，無 migration：公會應用卡與啟動流程），以及 #274、#280（都不改 runtime）。
兩個環境的 `FREEDOM_GUILD_LAUNCHPAD_ENABLED` 都維持 `true`，所以這些路由與畫面隨部署上線。staging 依 owner 的委派部署；
production 由 owner 於 12:31Z 決定照第六輪的方式直接發（「直接發 (Recommended)」），不跑 staging 驗收，到 live 再測。

- 兩個環境各自先做 migration 前的備份（staging `7c9b4233`、production `a34872cb`），都做過隔離還原與遠端讀回。
- 131 新增 `tenant_module_permissions`（一般的實例成員授權；匯出與限定用途的授權由 CHECK 擋下），並重建
  `preserve_module_instance_identity()`，讓實例的 `module_release_ref` 也不可變更。`d2900cf4` 不寫這張表也不改 `module_release_ref`，
  所以 131 對它相容；仍然是 migration 後立刻部署 `3685d626`。
- staging：migrator 套用 131，重套 runtime grants（131 沒有 GRANT，通用授權涵蓋新表）並通過唯讀驗證，12:57Z 部署（Worker 版本 `2222f11c`）。
- production：同樣由 migrator 套用並驗證，media operator 的權限快照前後相同；12:59Z 以同一份 dist 部署（Worker 版本 `e2e064cd`），
  29 個唯讀公開 checks 通過，4 次 fresh health 都是 `3685d626`。
- row security：131 在 `tenant_module_permissions` 啟用（不強制），一條 tenant policy（`tenant_module_permissions_tenant`），合計 28 張表、39 條 policy；
  新表目前 staging 0 列、production 0 列。兩邊 migrate 後，runtime 與備份角色在同一個 snapshot 的登入 probe 都通過。
- 兩個環境部署後的備份（staging `60e7f34d`、production `2547f645`）都做過隔離還原與遠端讀回，backup pin 都改成 `3685d626`。
  staging 部署後 cron 有寫入（最後同步 13:11Z，last_error 8→8）；production 部署後 cron 有寫入（最後同步 13:11Z，last_error 6→6）。

回滾：重新部署 `d2900cf4` 或關閉 flag，不需要退回 migration；128 之後仍然不能部署 X（`c84829e2`）。schema 只能從 migration 前的備份還原。

限制：P-B2b 的 T-ID 案例（T-013、T-015、T-022、T-047）與 P-D3a 的畫面流程沒有執行驗收，staging 也沒有跑驗收；production checks 是唯讀 HTTP，兩邊都沒有建立帳號。
這次 rollout 不是 M1 驗收，M1 仍未接受。每日備份的 operator source 仍是 `c3e5a537`。細節見[現況快照](current-state.json)。

### 10 月 8 日：第八輪 staging／production rollout（main e89cd0c8，migration 132、133）

`e89cd0c8` 是 #287 的 merge。它在第七輪（`3685d626`）之後帶進 #193 的社群整合（#284，migration 132：社群貼文的按讚、留言與純文字貼文；
migration 133：新貼圖）與 P-D3a 的目錄修正（#287，無 migration）。第七輪的收據 #286 不在本輪發布的 `e89cd0c8` 內；本 PR 承接該收據，計畫隨本 PR 一起合併。
兩個環境的 `FREEDOM_GUILD_LAUNCHPAD_ENABLED` 都維持 `true`；#284 的會員功能不受這個 flag 控制，隨部署上線。staging 依 owner 的委派部署；
production 由 owner 於 13:49Z 決定在 #287 合併後照第七輪的方式直接發（「#287 合併後直接發 (Recommended)」），不跑 staging 驗收，到 live 再測。

- 兩個環境各自先做 migration 前的備份（staging `9492971b`、production `87d02a52`），都做過隔離還原與遠端讀回。
- 132 讓 `community_social_posts` 多了 `kind`（預設 `link`；`note` 沒有網址），用 `social_post_content` 取代 066 的 note CHECK，並新增
  `community_social_likes` 與 `community_social_comments`。133 把兩個 sticker_id CHECK 從 4 個放寬到 52 個 id。兩者對 `3685d626` 都只是新增或放寬，
  既有資料都符合新的 CHECK；仍然是 migration 後立刻部署 `e89cd0c8`。
- staging：migrator 套用 132、133，重套 runtime grants（兩者都沒有 GRANT，通用授權涵蓋新表）並通過唯讀驗證，14:32Z 部署（Worker 版本 `f9284c0b`）。
- production：同樣由 migrator 套用並驗證。media operator 對 `community_social_posts` 有表層級授權，所以新欄位 `kind` 多出衍生的欄位權限列
  （SELECT），其餘權限快照前後相同；14:34Z 以同一份 dist 部署（Worker 版本 `4c40169a`），33 個唯讀公開 checks 通過，4 次 fresh health 都是 `e89cd0c8`。
- row security 不變：28 張表、39 條 policy。migrate 後新表在 staging 有 0 個讚、0 則留言，
  production 有 0 個讚、0 則留言；兩邊 runtime 與備份角色在同一個 snapshot 的登入 probe 都通過。
- 兩個環境部署後的備份（staging `770211b6`、production `691eed94`）都做過隔離還原與遠端讀回，backup pin 都改成 `e89cd0c8`。
  staging 部署後 cron 有寫入（最後同步 14:51Z，last_error 8→8）；production 部署後 cron 有寫入（最後同步 14:51Z，last_error 6→6）。另有 2 次備份失敗後清理 maintenance policy，經過記在私人收據。

回滾：重新部署 `3685d626`，不需要退回 migration；部署後新增的純文字貼文、按讚、留言與新貼圖，`3685d626` 只能部分顯示。128 之後仍然不能部署 X（`c84829e2`）。
schema 只能從 migration 前的備份還原。

限制：#284 與 #287 沒有執行驗收，staging 也沒有跑驗收；production checks 是唯讀 HTTP，兩邊都沒有建立帳號。
這次 rollout 不是 M1 驗收，M1 仍未接受。每日備份的 operator source 仍是 `c3e5a537`。細節見[現況快照](current-state.json)。

### 10 月 8 日：installed workflow pin 升級至 709600a0

中央 `24469536` 的 required workflow 於 17:09:27 UTC 改固定到 `709600a0`（#288 合併後的 main）。
#288 放寬容量：UI e2e 預設 pass 上限 30→40 分鐘、`ui-e2e` job 40→50 分鐘；單一測試 timeout、worker 數、retry 與 skip 規則都沒變。
完整 pin 也同步了已審查的 runtime baseline（`FULL_RUNTIME_BASELINE` +66、−0），判定規則不變。
依 Ted 同意的精簡 probe：刪除基準檔（E2）與加 skip（E3）都失敗且 merge 405；以 main 為目標的負例（MN）merge 405，
正例是第七／八輪收據 #291，在新 pin 下通過並依一般流程合併。S、E0／E1b、E2p／E3p 與 fork 探測沒有重做，沿用 10 月 7 日與 10 月 6 日的證據；
GOV-16／R2:D04 附加證據但不改狀態，accepted 仍是 3 列。這次只改 CI 規則，沒有部署；production 與 staging 仍是 `e89cd0c8`。
細節見[治理安裝紀錄](governance-installation-2026-10-04.md)與[本次證據](../../verification/main-ruleset-2026-10-08.json)。

### 10 月 8 日：第九輪 staging／production rollout（main cc72c3fd，無 migration）

`cc72c3fd` 是 #297 的 merge。它在第八輪（`e89cd0c8`）之後帶進公會首頁設定（D1）：沒有自訂首頁的公會改用平台預設 revision 2，
電商公會（`guild_commerce_sales`）與廣告攝影公會（`guild_commercial_production`）各有自己的區塊順序，並推薦平台已提供的應用；
會員看到推薦應用的名稱，正式成員看到主要動作，公會長可以編輯推薦。同一範圍內的 #288（CI 容量）、#296（inventory 順序）與 #291（第七／八輪收據）不改 runtime。
兩個環境的 `FREEDOM_GUILD_LAUNCHPAD_ENABLED` 都維持 `true`。staging 依 owner 的委派部署；production 由 owner 於 19:00Z 決定在 #297 合併後
照第八輪的方式直接發（「#297 合併後直接發 (Recommended)」），不跑 staging 驗收，到 live 再測。

- 沒有 migration：部署前兩邊的資料庫都唯讀確認仍在 133、沒有待套用或不一致的 migration，row security 仍是 28 張表、39 條 policy。
- staging 19:19Z 部署（Worker 版本 `3a5a5308`）；production 19:20Z 以同一份 dist 部署（Worker 版本 `d80f2817`），33 個唯讀公開 checks 通過，4 次 fresh health 都是 `cc72c3fd`。
- staging 與 production 兩個公會的公開首頁都是 revision 2、區塊順序符合各自的設定（推薦應用：manual-workspace）。
- 兩個環境部署後的備份（staging `fc6da97b`、production `f12747a0`）都做過隔離還原與遠端讀回，backup pin 都改成 `cc72c3fd`。
  staging 部署後 cron 有寫入（最後同步 19:41Z，last_error 8→8）；production 部署後 cron 有寫入（最後同步 19:41Z，last_error 6→6）。另有 1 次備份失敗後清理 maintenance policy，經過記在私人收據。

回滾：重新部署 `e89cd0c8`，沒有 migration，也沒有資料變更；部署後公會長存的草稿或發布仍是同一個 v1 格式，`e89cd0c8` 可以讀。128 之後仍然不能部署 X（`c84829e2`）。

限制：#297 沒有執行驗收，staging 也沒有跑驗收；production checks 是唯讀 HTTP 與兩個公會的公開首頁，兩邊都沒有建立帳號。
部署後另一個 session 用 staging 示範帳號做了會員實測：電商公會的正式成員看到主要動作「選品／營運待辦」，非成員看到加入提示，公會長存的推薦草稿重新進入後仍在、公開首頁不變；廣告攝影公會沒有正式成員的示範帳號，production 沒有登入實測。
這次 rollout 不是 M1 驗收，M1 仍未接受。每日備份的 operator source 仍是 `c3e5a537`。細節見[現況快照](current-state.json)。

## 2026-10-10 R15：社群修補與 schema148 正式發布

本次真正受保護合併的 #427 `2d5f158c` 已發布至 staging 與正式站，與 reviewed `fccc1739` 同 tree；
必要 Verify38052439063 的14 jobs及CodeQL通過，兩環境使用相同dist。正式站套用142–148；
staging在R15前已是148，本輪沒有重套migration。兩邊147筆ledger、RLS33表／45 policies，runtime無BYPASS。

staging實際商店24、社群26、小隊16、公開入口34項通過；正式站公開34／登入19項HTTP檢查通過。
社群驗收前三次工具失敗（body長度量測、編輯未完成登出、等待錯誤HTTP verb）保留，
最後修正量測與等待後同產品source通過。這不是正式一般會員完整瀏覽器旅程，也不宣告Foundation／M1完成。

發布前後四份備份均完成磁碟DB／物件還原與異地readback。staging-after保留6照片／4留言圖片，
production-after3照片／0留言圖片；synthetic資料完成指定清理，歷史物件保留供恢復。
daily operator及兩環境runtime pins皆2d5，排程／GC／retention不變；臨時staging Access已撤銷。
留言圖片兩邊為r2_only／64MiB。e977不能作143私人資料寫入後回退；19c6只在留言圖片啟用前適用，
現在修復必須保留media.comment-image.asset.v1 reader。沒有以本機11項回退證據冒稱live回退演練。

細節見 [R15發布收據](rollout-r15-2026-10-10.json) 與 [現況快照](current-state.json)。
較早 [e977發布紀錄](rollout-2026-10-10.json) 保留歷史，不代表目前release。#425／#426尚未包含在此發布。

## 2026-10-10 R16：舊 PR 集中整合與 schema160 發布

#434 `b9ed788c` 已透過受保護合併並發布至 staging 與正式站，與 reviewed `907b2516` 同 tree。
必要 Verify 38092198284 全部通過；精確案例數與選定環境驗收見 [R16 發布收據](rollout-r16-2026-10-10.json)。
兩環境套用149–160、159筆ledger；使用相同dist，資料庫／物件恢復與遠端readback通過。
訊息圖片啟用r2_only，purpose保存容量64MiB，單張上傳上限仍為2MiB；
保留既有留言圖片與商品照片政策，搜尋、封鎖及通知偏好已啟用。
TOTP使用分環境金鑰並完成合成帳號驗收；異地主機／第二操作者金鑰恢復仍未驗證。
Banner以大於512KiB的原圖驗收瀏覽器自動轉換；不以API傳输上限要求使用者手動壓圖。
這些是選定雲端流程的實測，不代表Foundation／M1完成。真實投遞、真人試用、正式政策、
真實指標baseline及Maintainer App等未完成事項保持獨立追蹤；不以source存在自動關單。
臨時staging Access已撤銷，兩環境backup pins同步，GC／retention保持OFF。

本批範圍已結束；後續主交付依 [#234](https://github.com/FreeTWAI-AI/freedom-platform/issues/234#issuecomment-6103127315)
集中在跨店訂單共用庫存：A的10件商品由B／C以各自獲同意的版本及售價接單，6＋5並行不得超賣，
quote／submit重驗當前供貨與權限，取消／到期只釋放一次，各方只讀必要訂單資訊。
接著交付一次庫存單模組外移及一條本人CLI／BYOK的Grant→Result→Stop／Revoke／重連流程。
T-047還原後tenant撤權存續尚未完成；隔離還原成功不代表可公開服務，重新開放前須與當前授權權威對帳。
真人反覆使用、供貨狀態理解與失敗恢復仍需經同意的實際回饋，不以合成驗收推定。

## 2026-10-11 R17：跨店共用庫存預留

#439 `df20b66a` 經必要 CI 與 detna 複核後受保護合併，已發布到 staging 及正式站。
兩環境使用相同 artifact，schema 到161；既有 TOTP 金鑰、媒體政策與原 reader 下限保留。
平台預留入口已啟用，但既有店鋪沒有自動開放；供貨與銷售店主仍須各自選擇接受預留。
staging 以正常註冊、現有合成會長批准、A 供貨與 B/C 各自同意售價完成旅程：
10件庫存面對6＋5並行需求不超賣，重新登入取消、真實30分鐘到期只釋放一次；
供應商只見必要供貨資訊，撤回後拒絕舊 quote，歷史訂單保留。
合成帳號及店鋪已停用／封存，四份 DB＋物件恢復與遠端讀回通過，臨時 Access 已撤銷。
完整結果與限制見 [R17 收據](rollout-r17-2026-10-11.json)。

本次沒有付款、履約、遠端庫存或完整 Agent 執行；真人反覆使用也不能由合成驗收推定。
後續分別完成庫存單模組外移，以及本人 CLI／BYOK 的 Grant→Result→Stop／Revoke／重連。
T-047 還原後撤權對帳仍未完成；還原環境保持隔離，確認當前權限後才能重新開放。

## 2026-10-11 R18：持久庫存預留紀錄與安全交接

#441 `9d7d84bc` 經必要 CI 與 detna 複核後受保護合併，已發布到 staging 及正式站。
兩環境使用相同來源與前端 dist，schema 到162；既有 TOTP 金鑰、媒體政策與原 reader 下限保留。
升級前先暫停新單並驗證 HTTP 拒絕、零在途交易／預留與零開放店鋪；
升級後先確認 schema162 writer 才恢復原平台入口，但既有店鋪沒有自動開放；供貨與銷售店主仍須各自選擇接受預留。
staging 以正常註冊、現有合成會長批准、A 供貨與 B/C 各自同意售價完成旅程：
10件庫存面對6＋5並行需求不超賣，同／新 idempotency key 重試保留同一 hold；
重新登入取消、真實30分鐘到期只釋放一次；舊式僅改餘額的 SQL 寫入被拒。
這是舊 writer SQL 反例，不宣稱實際執行舊 Worker binary。
供應商只見必要供貨資訊，撤回後拒絕舊 quote，歷史訂單保留。
合成帳號及店鋪已停用／封存，四份 DB＋物件恢復與遠端讀回通過，臨時 Access 已撤銷。
完整結果與限制見 [R18 收據](rollout-r18-2026-10-11.json)。

schema162 已提交後不能直接回退 pre162 Worker；保留 writer 下限，以相容修補恢復。
本次沒有付款、履約、遠端庫存或完整 Agent 執行；真人反覆使用也不能由合成驗收推定。
後續分別完成庫存單模組外移，以及本人 CLI／BYOK 的 Grant→Result→Stop／Revoke／重連。
T-047 還原後撤權對帳仍未完成；還原環境保持隔離，確認當前權限後才能重新開放。

## 2026-10-11 R19：供應商獨立供貨商品庫

#445 `31166e52` 經必要 CI 與揭露作者參與的 AI 協助 review 後受保護合併，已部署 staging 與正式站。供應公會正式成員可直接建立供貨商品庫、商品、庫存及供貨條件，不需加入電商公會或先填商店網址、啟用零售展示頁。兩間零售店各自提出售價並取得供應商同意；改價需重新確認，撤回阻止後續發布。staging 正常合成會員完整旅程通過，沒有供應商 retail slug／publication；成本與私人條件不進公開 DTO。這不是真人採用證據。

兩環境追加 migration163／164，到164共163筆，022歷史缺號不變。schema164供貨讀寫下限與162庫存下限一併保留，不能只退回舊 Worker。交接時用既有GLP與相依圖片開關短暫停止舊商店讀寫，確認單一版本、等待60秒並核對沒有更早runtime交易後才升級；新Worker上線後恢復原設定。店主預留opt-in、金鑰與媒體政策保留。四份 DB＋物件備份完成磁碟還原、遠端讀回與清理；自有合成帳號／空間封存，臨時 staging Access 已撤銷。完整版本、檢查與限制見 [R19 收據](rollout-r19-2026-10-11.json)。

#447 的 contribution source／migration163 也包含在本次來源；本輪未另宣稱其完整雲端使用者旅程。付款、履約、外部庫存權威、T-047、第二操作者恢復與 Foundation 原未驗項仍各自保留。


### 10 月 11 日：商店與商品分享的產品收尾候選（#234）

本段是 `31166e52` 上的程式候選，不是已部署或真人自主使用紀錄。
公開店面先呈現品牌、商品與詳情入口；沿既有已發布投影提供
`/shops/:slug/products/:sku`。商品入口保留選擇到登入後的預留資格確認，
只有目前公開且已開放預留的商品才帶入數量，仍由本人查看內容並確認，
不自動送出命令。既有未付款 30 分鐘預留、查詢與取消權限不變。

商店／商品的分享標題、摘要、canonical 與圖片只取已發布的 allowlist，
網域使用 host 配置，不採用來訪 Host／forwarded header。草稿預覽與找不到頁
不提供 OG，預覽不連到可能過期的公開商品；公開 HTML 使用 no-store，
既有 noindex 保留。已儲存但未發布的文案／照片不改公開版本，撤下及
目前的 tenant／instance／owner／部署限制仍沿原公開讀取規則生效。
分享服務自行保存的遠端預覽不在本地 cache 控制範圍內，不承諾撤下能刪除第三方快取。

會員流程的本機證據為 53 runtime、14 browser 全過：商品連結→登入→數量→
確認內容→本人確認預留→新 session 讀回→取消與釋放庫存，另保留 draft、
未知結果、CAS、無權限、平台／商店未開放及找不到商品反例。第一次 runtime
51／53 是兩個新測試誤用本機 URL 作為配置的分享網域；第二輪 53 全過，
browser 13／14 是新連結的可存取名稱空白差異；補明確名稱後整輪 14 全過。
失敗 trace 與原條件保留，沒有放寬 timeout、減少案例或以拼接結果代替完整一輪。

最後另以真實圖片 bytes、隔離的合成 object provider 跑 14 項 browser 全過，涵蓋
上傳／換圖／發布／移除與 OG 封面；照片未發布時仍讀舊版。手機 390、平板
768、桌面 1440 與會員明亮／夜航／敘生截圖已查看，缺圖區塊縮短。
使用磁碟 PostgreSQL 18，每輪容器與 volume 均有移除確認。

本候選仍需受保護 CI、review 與部署驗收。合成商店及測試照片不是會員採用，
有授權的完整品牌內容、實際分享服務讀取及真人手機操作仍待有限試用。
平台維護者負責本段公開讀面與登入接續；店主決定內容與是否發布。
供貨 owner opt-in 由 #449 承接；公會組裝由 #451 承接；開源與活動代表流程、
兩位非核心公會作者、installed CI 及第二操作者恢復仍保留原未完成條件。

## 2026-10-12：供貨會員自助流程的 R20 發布

[#449](https://github.com/FreeTWAI-AI/freedom-platform/pull/449) 已經受保護合併並以
`72236f58` 部署 staging 與 production。供應商可在自己的供貨商品庫開啟或停止
未付款庫存預留，不必建立零售店；停止後仍可查看既有供貨訂單，買家取消預留後釋放庫存。
[發布證據](rollout-r20-2026-10-12.json)記錄 staging 的 33 項合成會員旅程、
兩環境各 36 項公開檢查及 production 的 22 項帳號 HTTP 檢查。

本輪無 schema 遷移，保留 supply164／inventory162 floor、既有權限與 admission。
四份發布前後備份均完成資料庫及物件還原、遠端讀回與清理。Production 第一次
發布後備份在 capture 失敗，原因未確定；保留失敗紀錄，以相同固定 adapter
完成重試，沒有重複部署或放寬 timeout。真人使用、第二操作者與 T-047 還原後
撤權對帳仍未完成；商店呈現、公會擴充、CI 實裝、開源及活動收尾分開驗收。

## 2026-10-12 R21：會員入口層次與產品流程發布

#461 的首頁／導覽／公會工作、資源、管理分層，以及 #466 的 CI 環境與清理修正，
以受保護合併 `14f82aa2` 發布至 staging／production；reviewed `633d9c70` 與合併來源同 tree。
detna-vibe-coding 的來源 review 有 AI 參與揭露，並非獨立真人使用驗收。
自然 main Verify38230347332 的 15 jobs 成功，完整 browser 895 案／146 檔；
CodeQL 主線三種分析通過，兩環境使用相同 dist。

兩環境追加 migration165，164 筆 ledger 的既有名稱與 digest 保留，022 歷史缺號不變。
新 sharing-visibility floor 與供貨164／庫存162 floor 同時生效；即使關閉新單，
也不得回退到會讀出已撤下分享內容的舊72236 Worker。實際部署 guard 與隔離還原均驗證拒絕。

staging 公開 HTTP 40 項、會員流程共 58 項通過，供貨／商品分享、作品與活動採同 source／
設定的分段實測，沒有宣稱單次不中斷。保留前次失敗收據；其中真正產品設定缺口是
`FREEDOM_PERSONAL_CONTENT_ENABLED` 關閉，啟用既有已審功能後驗本人內容與登出拒絕，
再把相同設定部署 production。其餘既有 release flags、媒體政策、金鑰與預留設定保留。
production 完成 40 項公開與 25 項合成帳號 HTTP 檢查，沒有聲稱正式會員完整瀏覽器旅程。

四份發布前後備份均完成資料庫／物件還原、遠端讀回與清理；production 發布後首輪在啟動
隔離還原目標時失敗，遠端讀回已驗證且清理完成。保留首次失敗，待主機 I/O 降低後，
對同一 set／manifest 重跑還原，46 個物件與資料庫均核對通過，未重新擷取或改寫遠端備份；
首輪失敗原因尚未獨立確定。發布後另驗 durable schema165 floor。backup operator 與兩環境 runtime pins 同步14f82，排程不變、GC 保持關閉。
臨時 staging Access 撤銷、自有合成帳號停用與空間封存；T-047 當前撤權對帳、第二操作者
接手、真人試用與兩位非核心公會作者交付仍未完成，還原環境保持隔離。

公會局部 CI 已實際安裝，#467 以單一元件修改通過新路徑並經 detna review 合併。
#467 與管理分頁草稿保留 #462 是後续來源；R21 runtime 仍明確固定14f82。
逐項收據與失敗界線見 [R21 收據](rollout-r21-2026-10-12.json)；
此輪不宣告 Foundation／M1 完成，也不宣告真人採用。

## 2026-10-12 R22：管理分頁草稿與供貨區塊整理

#462 經 detna-vibe-coding 對 `3b2d5abf` review 後受保護合併為 `14ffd70a`，包含已審 #467。
原公告、技能書、討論等已訪問且仍有權的管理頁在切換分頁時保留本地草稿；撤權仍移除
對應管理內容，新 session 不沿用舊私有草稿。已核准的供貨區塊將唯一商品庫的返回動作
置於主要層級，流程說明預設收合；未自動把既有公會 v1 配置改成 v2。

staging 與 production 使用同一 source／dist，既有 schema165 的 164 筆 ledger 經唯讀
核對，沒有 migration、角色／授權或 feature flag 變更。staging 公開40項與既有合成
幹部實際管理草稿 12 項通過；沒有發布公告、討論或修改別人的權限。正式站公開40項
與合成帳號 HTTP 25 項通過。首次管理腳本因精確 textarea 標籤與登出缺少 JSON 格式失敗；
原始失敗保留，唯一自有 session 已逐筆核對撤銷後，修正腳本重跑。沒有修改應用來源
或其他人的 session／權限。正式發布前讀取 Cloudflare plan 時第一次請求失敗，當時
尚未產生 plan 或 deploy intent，沒有更動正式 Worker／資料庫；保留已驗證的前備份，
只重試一次唯讀 plan 後成功，正式部署執行一次。發布前後四份資料庫／物件備份均完成隔離還原、遠端
讀回與清理，臨時 Access 已撤銷，operator 與 runtime pins 同步14ffd70a。

完整自然 main 回歸另記於收據；#462 PR 的完整 browser899案／146檔已通過。晚到回應、
撤權與 unknown-result 重送由原審查 CI 驗證，不冒稱在雲端對既有會員權限注入故障。
還原沿用 schema165 分享可見性、供貨與庫存下限；先前 R21 本身仍相容，pre165 的
72236 Worker 不相容。T-047 當前撤權對帳與第二操作者仍未結案。

本機 context 發現兩個舊管理檔案未登錄歸屬，完整152片規則已讀且未減少 scope；
保留自動 `surface_unmapped` 報告，逐項核對全倉規則與完整 CI。交接同時僅補
`application-composition` 對 `GuildWorkspace.tsx` 與其 browser spec 的 ownership，
不改工具判定或縮减測試；修補後本機 context 無 blocker，30項 context 測試通過。
首次 #459 CI 發現新人指南的共同殼層測試清單仍缺這份管理頁 spec；已在本機重現，
同步增加 `guild-workspace.spec.ts` 的驗證義務。既有 selector 與 browser runner 測試
驗證這項補齊；installed pin 不變，舊 pin 遇到新增歸屬仍保守選擇完整 browser。
此修補隨本 PR 接受 review，沒有倒改已部署的 immutable source。

R22 是工程與部署驗證，不代替最初十位會員重新評估介面，或兩位非核心公會作者的實際
交付。真人使用與尚未完成的原要求繼續由本頁上方對帳，不以 PR 清零結案。

## 2026-10-12 R23：供貨商品庫分區

#468 經 detna-vibe-coding 對整合後 `25cb3488` review，受保護合併為 `2bd62c25`。
供貨商品庫分成「商品」「供貨合作」「預留與訂單」；新增商品表單按需開啟，
切區保留新增、編輯及供貨條件的未儲存輸入。共同結果提示與既有權限、版本及重送
防護保留，不改商品、庫存或同意的資料權威。

同 source／dist 已部署 staging 與 production；兩邊既有 schema165 ledger 唯讀核對，
沒有 migration、既有會員授權或 feature flag 變更。staging 公開 HTTP 40 項、
普通合成會員旅程 43 項通過：供應商不建立零售店，兩店各自定價並取得同意，
供應商經 UI 開放／停止預留、讀回自己的訂單，買家取消後釋放庫存；重登仍返回同一商品庫。
三種主題的手機／平板／桌面畫面另有實際檢視。正式站公開 HTTP 40 項及合成帳號
25 項通過。新建合成會員／空間已停用或封存，唯一自有幹部 session 已撤銷。
首次腳本於唯讀登入狀態查詢遇到 ECONNRESET，當次尚未進入商品旅程；原失敗及完整清理
紀錄保留，換發自有臨時 Access 後重跑。腳本只對唯讀 GET 的連線中斷允許一次重試，
寫入不自動重送，應用來源與部署未變更。

四份前後備份完成資料庫與物件隔離還原、遠端讀回及清理；臨時 staging Access 已撤銷，
備份 operator 與兩環境 pins 同步 `2bd62c25`。自然 main 必要 CI 全部成功，完整 browser
900 案／146 檔／六 profiles。先前 main `2dd43a6f` 的零售店預留控制項缺失失敗仍保留，
根因未定；本候選與自然 main 首次通過，沒有藉重跑、放寬 timeout 或診斷補丁抹去原失敗。

完整可核對資訊見 [R23 收據](rollout-r23-2026-10-12.json)。這次驗證沒有真人易用性或
會員採用證據；十位會員的原負面回饋、兩位非核心公會作者交付、T-047 當前撤權對帳及
第二還原操作者仍待完成。還原環境保持隔離；pre165 Worker 不可回滾使用。

## 2026-10-12 R24：活動草稿離開防護與結果不明保存

#470 經 detna-vibe-coding 對 `915147c9` 要求修改，核准 `3725c5df`，受保護合併為 `dcb39351`。
變更只在前端與 E2E。拒絕離開（路由、hash、返回、直接活動網址、beforeunload）時保留
未儲存活動草稿與媒體，只有明確捨棄才清除；待送或結果不明的保存凍結原路徑、內容、版本與
冪等鍵，重試不會重複建立活動，已知拒絕後恢復編輯。

同 source／dist（`774eb37a`）已部署 staging 與 production；兩邊既有 schema165 ledger 唯讀核對，
沒有 migration、既有會員授權或 feature flag 變更。staging 公開 HTTP 40 項、活動檢查
25 項通過。正式站公開 HTTP 40 項及合成帳號 25 項通過。新建合成活動已取消，session 已撤銷，
帳號已停用，空間已封存。

四份前後備份完成資料庫與物件隔離還原、遠端讀回及清理；臨時 staging Access 已撤銷，
備份 operator 與兩環境 pins 同步 `dcb39351`。自然 main 第一次：runtime-full partition 4
的 60 檔、738 項測試通過後，測試資料庫 DROP 回 `query_read_timeout`，清理失敗，根因未定，
該次紀錄保留。審查者同意後的同來源第二次，全部 15 jobs 與 905 browser 案（146 檔、
六 profiles）通過；沒有改來源、workflow pin、timeout 或清理規則。其後 main 前進到
`ae161e35`（#471，只改本機 E2E runner、其測試與文件，未部署）；該次 credential-ingest
1 案失敗仍未結，根因未定。

完整可核對資訊見 [R24 收據](rollout-r24-2026-10-12.json)。這次驗證沒有真人易用性或
會員採用證據；十位會員的原負面回饋、兩位非核心公會作者交付、T-047 當前撤權對帳及
第二還原操作者仍待完成。還原環境保持隔離；pre165 Worker 不可回滾使用。
