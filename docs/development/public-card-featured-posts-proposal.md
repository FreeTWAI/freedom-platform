# 公開名片的本人精選貼文：待審設計提案

日期：2026-10-24。研究基準：`54961dd83fbfba721ae54bcddd8e759b7a06915f`。

**狀態：proposal，未實作。** 本文件只交接產品邊界、候選 API／storage 與驗證計畫，
不修改目前公開同意、正式資料、SQL、runtime grants、旗標或部署設定。
文件通過審查不等於會員已同意展示，也不表示公開作者牆已完成。

## 1. 現有能力與缺口

- [公開貼文規格](share-promotion.md#單篇貼文免登入閱讀)與
  [reader](../../modules/community/public-social-posts.ts)已提供單篇公開全文、核准附圖及最多三則有限摘要。
  現行規格明確沒有匿名動態列表、游標或任意筆數參數。
- [公開名片](../../modules/identity-membership/member-sharing.ts)只依可撤銷 token 回傳已核准的名片投影；
  [訪客畫面](../../apps/portal-web/src/modules/PublicMemberPage.tsx)沒有作者貼文清單。
- [#1010](https://github.com/FreeTWAI/freedom-platform/pull/1010)是本人個人空間，使用受驗證的 `/me/content`；
  不是訪客作者牆，也不授予本提案讀取私人 inventory 的權限。
- [#971](https://github.com/FreeTWAI/freedom-platform/pull/971)已合併的單篇公開同意，
  不可推定為作者全量 discovery、作者索引或自動公開新文章的同意。

下一個最小候選是「公開貼文精選」：作者另外明確選擇最多三則已公開的本人貼文，
放在原公開名片下。沒有分頁、搜尋、推薦補位、全部貼文或任意 author ID 查詢。
訪客可以沿原 `/posts/<uuid>` 讀取全文；閱讀不強迫註冊，討論與會員互動仍走原登入／資格檢查。
本案不新增追蹤、邀請、寄信、外站自動分享、成效追蹤或站外連結抓取。

## 2. 三個獨立同意，不互相代替

1. 名片分享本身已開啟，token 有效。
2. 每則貼文的當前文字與圖片已由原作者明確開放免登入閱讀。
3. 本人另外確認把所選版本展示於公開名片；精選預設關閉、清單為空。

前兩項成立不會自動勾選第三項。migration 不回填精選；不根據舊分享、名片連結、
按讚、已登入或曾經公開來推定新同意。精選保存不得呼叫 `setSocialPostSharing` 開放任何貼文，
也不得替本人開啟名片分享。名片關閉時仍可查看自己的設定，但不能新啟用精選。

### 本人確認畫面的候選文案

> 在公開名片展示這些貼文
>
> 你選了 {N} 則目前已開放免登入閱讀的本人貼文。啟用後，任何取得你的公開名片連結的人，
> 包含未登入或被你封鎖的訪客，都可能看見這些摘要並前往公開原文。
> 這不會公開其他貼文、留言、私人互動或聯絡資料。
> 你可隨時關閉精選或移除單則；若也要停止原文的公開閱讀，請另外關閉該貼文的公開分享。
> 已被他人下載或外站快取的副本無法保證收回。

確認框預設未勾選，主按鈕為「確認展示這 {N} 則」，次按鈕為「取消」。
預覽列出選中的當前文字與核准附圖，供本人判斷；必須同時顯示上述公開範圍。
新增、替換或來源版本改變都重新確認。純移除或關閉可立即執行，不強迫再次接受公開文案。
送出前取消、關閉對話框或瀏覽器返回不會建立公開命令。送出後的未知結果不觸發額外命令；
原命令可能已成功，必須用同 key／同 body 查核，不宣稱斷線或關閉畫面會回滾。

公開頁不提供會員雙向封鎖保證。現有公開 reader 即使收到 cookie 仍回 public projection；
不能用會員 API fallback 去補公開資料，不能宣稱「被封鎖者看不到」。
會員頁、好友、私訊及討論的既有封鎖／ACL 規則保持獨立且不放寬。

## 3. 本人編輯與候選 API

以下為待審名稱與 DTO，不是已註冊 endpoint 或 SDK。

- 本人設定讀取：`GET /api/v1/me/member-card-featured-posts`。
- 本人明確保存：`POST /api/v1/me/member-card-featured-posts`。
- 公開精選讀取：`GET /api/v1/public/member-cards/:token/featured-posts`。

本人由已知的站內 `/posts/<uuid>` 連結加入，或未來在該本人貼文的現有公開分享畫面開啟選取器。
第一階段不用 `/me/content`、不新增可列舉作者全文的 member API，也不遍歷動態分頁尋找作者。
網址僅解析目前平台同源、精確單篇路徑與合法 UUID；拒絕外站、query、fragment、重複 ID 及非本人貼文，
不對輸入網址發送網路請求。最多三個 ID 的驗證／預覽為有界 server 操作。

本人 GET 只回精選設定與可用性，不是全作者 inventory。預覽的正文／圖只能由既有公開投影提供；
已失效項僅供本人看到不可用狀態與移除操作，不能保留舊正文／附圖。

保存 body 包含 `enabled`、有序選取 ID、本人預覽的 publication／post／media pins，以及明確確認版本；
schema 拒絕未知欄位、超額與重複 ID。pins 不能由客戶端自行宣告為有效，server 必須逐筆比對。
啟用時至少一則、最多三則；關閉時不新增／替換選取。
寫入沿既有 session／onboarding、Origin、CSRF、Idempotency-Key、If-Match 與 journal。

- CAS 保護精選 aggregate；跨頁或另一裝置已改過時回 conflict，重新讀取並讓本人判斷。
- 在同一交易重新核對目前 session、名片 share generation、作者／社群、貼文當前公開 pins。
- 新增／啟用與來源版本不同時整筆拒絕，不默默保存不同版本或部分成功。
- 未知結果保留原 key、body 與 expected version；不自動建立新命令。重播前重驗目前權威，
  已撤回、名片換碼或來源改版不能靠舊成功 receipt 復活。
- 移除／關閉只縮減精選，不關閉原貼文的 public-sharing，不修改名片其他欄位。
- journal 保存最小操作事實／版本與選取數，不複製正文、圖片、token 或會員私人資料。

## 4. 公開讀面與撤銷一致性

公開 DTO 只含最多三則 `{post_id, title, summary, path}` 及整份 opaque freshness digest。
`summary` 最多 160 個 Unicode 字元，path 由 server 建構為 `/posts/<uuid>`。
不回 author user ID、selection pins、token generation、總篇數、不可用項數、游標、私人互動或會員聯絡資料。
第一階段精選只顯示文字摘要；全文／圖片沿原單篇頁和媒體 reader，不建第二套媒體 URL。

所有 query 參數均不屬合約；不得透過 `authorId`、`limit`、`cursor` 擴大結果。
正式錯誤碼與 duplicate-query 處理在實作審查時固定，至少保證未知參數不能控制讀取範圍。

同一 SQL snapshot 先驗有效 token、名片 enabled、當前 share generation、有效作者，再讀最多三筆選取，
逐筆套用現有 `PUBLIC_VISIBLE` 的公開社群、active post／author、onboarding、非驗收帳號、
publication enabled、post revision、media version、thumbnail digest 與 media-ready 檢查。
再比對選取時保存的 publication pins；不得以任何私人來源補齊。

- token 不存在、關閉或已輪替：通用 404，不回舊名片或精選 metadata。
- 精選未啟用：有效名片下回空陣列；名片其他內容照舊。
- 單則撤回、隱藏、刪除或改版：該項立即不再符合新讀取，不透露原來有幾項，不補上其他文章。
- 來源重新公開：publication version 已變，舊選取仍不顯示，需本人重新預覽並確認。
- 名片關閉／換碼後再開啟：舊精選同意不可自動移轉至新 generation；重新確認才能展示。
  不應直接把一般名片文案更新的 aggregate version 當 token generation，具體欄位見下節。
- 精選同意移除或關閉：後續 snapshot 不回精選；已公開的單篇原文不因此撤回。

競態的承諾是「依讀取／寫入的權威 snapshot 與序列化邊界一致」，不能保證已送出的 HTTP 回應被遠端收回。
保存與名片 rotate／disable、貼文 edit／hide／delete／public-sharing 必須有固定鎖順序或等價可證明的同步邊界；
實作前先盤點所有 writer，補可重現 SQL barrier 測試，不能只靠寫入前的一次檢查。
任何外部 I/O 之後的敏感內容讀取依既有 domain-media 再驗，不引入先讀私人圖再遮罩的方案。

HTML／JSON 沿 no-store、noindex,nofollow；精選不進靜態 PNG 名片下載、OG 文案、離線快取或本機持久 storage。
在 pagehide／卸載清除精選 DOM；pageshow、focus、visibility 恢復先清除再有界重驗，沒有背景輪詢。
讀取失敗不顯示過期資料；empty 與 error 分開。換 token、登入帳號或 client generation 時取消 pending request，
晚到的成功不能復活前一張名片或已撤下的精選。相同事件去重，禁止重複請求風暴。
第三方快取及已下載副本無法保證刪除，確認畫面須保留此限制。

## 5. Storage 不能假借現有 links

[member-sharing.ts](../../modules/identity-membership/member-sharing.ts) 的 `links` 是最多八組嚴格 `{label,url}`，
既有 [migration 068](../../migrations/068_member_card_designs.sql) 只有一般名片連結 JSON；
`profile_link_prefs` 僅處理 contact/social keys，見 [migration 075](../../migrations/075_member_card_profile_links.sql)。
兩者沒有精選公開同意、來源版本 pins 或撤回語意，不擴充任意 JSON 來躲過新契約。
本人現在可手動貼單篇連結，但這不等同精選摘要功能已完成。

建議獨立精選 aggregate 與有序 selection rows；正式表名、migration 編號尚未分配。
至少需要 owner／community、enabled（default false）、aggregate version、明確 consent revision、
與目前名片 token generation 的綁定，以及最多三個唯一 post ID／序位與 publication pins。
不得保存可公開的原始 token 副本；名片目前的 aggregate_version 也受一般設定更新影響，
不能未經設計就當成專用 token generation。需協調專用 generation／不可逆綁定及輪替失效規則。
一般名片文字修改不應偷偷重新授予精選同意。
現有 `readPublicCards` 已將 token 的 SHA-256 前 16 個 hex 字元作為推廣 generation，
但它是推廣連結識別用途，尚不是精選同意或安全綁定契約；不得未經審查直接沿用截短 digest。
可評估完整不可逆 token digest 作綁定，或新增專用 generation，需在 storage 設計時定案。

資料庫須有可驗證的 owner／community 關聯、唯一序位／post、容量上限與來源 FK／刪除策略；
若三筆上限需以 transaction lock 等方式保證，必須含併發驗證。來源刪除可清除 selection 或使其不可用，
但不得把先前正文或圖片留在公開快取。不得回填歷史同意。

本文件不新增 SQL、grants 或 migration 編號。實作前由維護者協調當時 main 與所有 open migrations，
確認 schema → 最小 runtime 權限 → source 的相容順序及安全回滾下限。
若需擴張 ACL、啟用正式功能或更動公開政策，先取得該步驟授權；不能因文件已寫好直接執行。
舊程式繼續處理名片時，不能覆寫新選取或忽略必要撤銷；混版 writer 相容性是交付 gate。

## 6. Owner、依賴與整合順序

研究時的 [member-card descriptor](../../apps/portal-web/src/modules/freedom.module.json) 與
[public-social-post-sharing descriptor](../../modules/community/public-social-sharing/freedom.module.json)
均由 foundation owner_role 管理；路由組裝另需 platform-api-features／host 的對應 owner 核對。
未來跨模組 imports、owned paths、surfaces 及測試義務須明確登記，不能因本文件沒有選中 runtime module 就省略。
CODEOWNERS 的治理審查責任不等同對每個產品檔案的 blanket approval。

1. 維護者接受這個限定精選的產品／公開同意合約，確認匿名不提供會員封鎖保證。
2. 協調 storage、share generation、所有 writer 鎖順序、runtime grants 與混版／回滾計畫。
3. 先交付並驗證 default-off 的 server 合約，再接本人預覽確認與公開名片 UI。
4. 整合時重查最新 main、全作者 PR（含 drafts）與 owners；重新取得實際 API／UI 範圍的完整 context。
5. 完整隔離測試、獨立安全／UX review 及精確 commit hosted CI 後，另走既有發布授權流程。

2026-10-24 16:03 UTC 查核到 17 個 open PR（15 draft）：
Hao0321 的 #1013、#1012、#1011、#1010、#1006、#1005、#1004、#1000、#999、#998、#997、#995、#994、#993；
arumwu 的 #1008；teddashh 的 #1001、#996。沒有同題精選實作，這是當時快照而非永久認領。
已查近期 merged #1003 batch、#1007、#1002 及公開貼文 #971。PR 作者不是正式部署或 privacy 授權人。

- 不複製 #1010 的私人 `/me/content` 預覽；不改其本人空間或頭像選單。
- 不重寫 #1011 的 App／menu；名片下方精選為獨立後續 UI slice。
- #1005 的發文分享、#999 按讚、#994 留言不屬本案；不引入其未合併程式。
- 不依賴 #1012 公會入口或 #1013 貼圖預覽；不存在必須先合併它們的產品依賴。

## 7. 未來驗證清單（本文件未執行這些產品測試）

- 同意：舊帳號／舊公開貼文預設無精選；未勾選／取消／返回不寫入；每次新增及版本改變須重新確認。
- ACL：非本人、跨社群、inactive／未完成加入／驗收帳號、無 session／過期 session，均不得保存；
  公開 DTO 無私人欄位，帶 cookie 也不增加內容，會員側封鎖與討論門檻原樣保留。
- 有界：0／1／3／4 項、重複 ID／序位、非法 UUID／URL、外站／query／fragment，沒有任意 author 搜尋或分頁。
- 版本：post edit、圖片 replacement、publication revoke／republish、hidden／delete、asset unavailable，
  均使舊 pin 不可見；舊成功 receipt 與 unknown retry 不復活，重新展示需要新的本人確認。
- 名片：disable、rotate、重新開啟、一般設定修改與同時保存，覆蓋 generation 綁定與混版 writer。
- 競態：用真 SQL barriers 排定保存與撤回／刪除／rotate 的先後，驗證原子性、固定鎖順序、
  session clock 跨期、兩裝置 CAS、同 key 重播與不同 key 並發；不能只靠延遲 sleep 猜測。
- 撤銷／快取：no-store／noindex、無 OG／PNG 精選副本、pagehide、bfcache、focus／visibility、
  404／網路失敗清除、換 token／帳號的晚回應、重複點擊／重複事件去重；公開原文仍依原 reader 驗權。
- UX：空清單與錯誤分開，關閉／移除不阻塞，320／390／1280 px、鍵盤焦點、五語系、所有現行主題與 reduced motion。
- Storage：non-owner restricted runtime role 的允許讀寫與禁止 DDL／不相關 policy 變更，
  migration 預設值／無 backfill、FK／刪除行為、三筆併發上限、舊新 source 混版及安全回滾證據。

本 PR 的驗證只應是文件連結／路徑、diff、設計獨立檢查與實際 hosted docs CI。
未實作的 runtime／browser／migration 測試一律不得寫成 passed；文件或 CI 綠燈不代表產品已上線。
