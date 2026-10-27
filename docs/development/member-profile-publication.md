# 個人空間訪客投影：第一階段後端候選

基準 `4d2484286a82e5795826ffe9e743cbaef33b86a6`。本地候選，未發布、未部署、未啟用；**完整功能尚未完成**。
依 [Ted #1043 協調回覆](https://github.com/FreeTWAI/freedom-platform/pull/1043#issuecomment-6442295308)，本地以 `191_member_profile_publications.sql` 暫編開發，不須等 #1043；190仍屬Google候選。合併前由Ted依當時main改成最小空號，同步檔名、部署last與測試期望。現在main189缺190，因此原有嚴格planner應拒絕此暫編catalog；不把190加入known_gaps、不補GoogleSQL、不改planner通融。這是待整合候選，不可套用或部署。runtime grants／隔離DB驗證仍未執行。

## 獨立同意與範圍

這是新的訪客個人空間，不改舊會員目錄與分享名片。`private`不會把目錄／已分享名片／已公開貼文一併隱藏。原 `PersonalSpace` 和 `/me/content` 仍是本人工作區；不讀取或公開私人內容。
沒有設定資料時預設private，沒有自動回填。本人提交顯示名稱、自介、最多五個HTTPS連結；資料是這次明確確認的獨立文字，不隨帳號修改自動公開。禁止額外欄位，沒有email、contacts、私訊、訂單、公會、線上狀態、貢獻或藍勾勾。

- private：只有本人可讀新投影。
- members：符合資格、同社群、未互相封鎖的會員可讀。
- public：任何人免登入可讀，**封鎖無法阻止對方登出閱讀**。每次public提交必須`confirm_public:true`。

## 契約

`GET /api/v1/me/profile-publication`：本人設定，無資料時回private／空文字／空links／null版本；不複製account欄位。
`POST /api/v1/me/profile-publication`：既有session／Origin／CSRF／Idempotency-Key協定。body為`{visibility,display_name,bio,links:[{label,url}],confirm_public?}`，有舊設定必須If-Match；全量更新，不默認保留未知欄位。回目前設定，command receipt只含`updated:true`，重送不回放舊文字。
`GET /api/v1/members/:id/profile`：member boundary與最終session decision-clock檢查；單一SQL同時篩選欄位及權限，private／封鎖／不存在皆404。
`GET /api/v1/public/member-profiles/:id`：永遠匿名public權限，Cookie不擴充DTO。回應只有`{display_name,bio,links,avatar_url:null}`；匿名端不提供friend/DM state。

兩種reader都沒有列表、搜尋、分頁或私人inventory fanout。所有回應no-store、Vary:Cookie、noindex/nofollow，不發ETag，不以If-None-Match回304。每次重新讀目前權限；已下載的內容無法追回。單一SQL快照是文字讀取的權限判定點；不承諾撤銷能抹除已完成讀取。

## 第二階段本地候選（未發布、原生與 DB 未驗）

已加入Owner可見範圍設定與草稿預覽、visitor頁面、既有名錄頭像點擊連結、好友incoming/outgoing/accepted/self狀態與既有私訊入口。會員投影使用單一SQL／HTTP回應的 `{profile,actions}`；匿名契約不變，沒有actions。頭像必須另有明確同意、版本綁定及物件讀取前後權限重查；第一階段不接受include_avatar，不把私人頭像URL放入DTO。
好友／私訊只在本人點擊後沿用既有command與server封鎖／會員資格；看個人頁不自動建立對話或送訊息。不把mute當ACL，不發明friends-only私訊限制。
前端必須按client identity＋user/session generation＋target隔離，清除舊快照、取消晚到回應，合併focus/visibility重讀；不使用跨登入持久快取。

## 驗證界線

Pure policy/schema與synthetic HTTP檢查不等於PostgreSQL ACL／並行交易驗證。DB完整測試、migration／grants、撤銷競態、hosted CI均待具備安全的schema分配與環境。瀏覽器／原生驗證未執行；不重試已知Chromium/socket限制、不使用本地DB、不安裝套件。

## 跨功能文字／認證界線

顯示名稱、自介、連結皆為本人提供的內容，不是平台或管理員背書。控制字元在 trim 前拒絕，遵守既有名片單行文字規則；HTTPS連結禁止帳密並限制原始與URL解析後長度，僅渲染外連，不由伺服器抓取。React以文字節點顯示，不解讀HTML。
未來社群認證屬帳號層級的人工審核、可撤銷標記，不代表每段自介、名稱或外連已經審核。整合前必須明確決定改名／版本變更政策與對外帳號層級說明，並遵守本人展示同意與此投影ACL；不能直接把目前文字或連結視為已認證。此候選沒有任何認證欄位。
