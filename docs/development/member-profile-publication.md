# 個人空間訪客投影：整合候選與歷史設計

## 目前整合狀態（2026-10-27，PR #1147 head `6d0e89d6`）

[Draft PR #1147](https://github.com/FreeTWAI/freedom-platform/pull/1147) 已在 `6d0e89d6744220924e65f8adc632ce68e39483e5` 整合 main `bdcbb74209db4017fd87375d5f5ad79816b21d85` 的 Google 登入與 `190_google_identity.sql`；主頁、封面佈置、社群認證與社群稱號依序暫編 **191–194**。Google190 與所有已發布歷史 SQL 位元組不變，沒有更改 `known_gaps` 或正式環境已套用版本。這是已推送供審查的 Draft，不是已合併、已部署或已啟用；6d 的 hosted runtime 分組已通過，但原生 UI 仍有一項失敗；不能把局部通過當成完整驗收。

下列第一／第二階段內容是 #1135 的歷史設計紀錄，不是目前整合狀態清單；其文字-only DTO、未含認證欄位等限制描述歷史版本。目前佈置與隱藏區塊界線見本文後半，認證與稱號另遵守各模組契約與本人獨立同意。

## 第一階段歷史候選（2026-10-27 整理）

早期基準為 `4d2484286a82e5795826ffe9e743cbaef33b86a6`，提交於 [Draft PR #1135](https://github.com/FreeTWAI/freedom-platform/pull/1135)。[Ted 當時的暫編協調](https://github.com/FreeTWAI/freedom-platform/pull/1135#issuecomment-6442736697) 與未引入 Google SQL 的說明僅適用該早期候選；目前排序已由上方 6d 整合取代。先前 migration 缺號的失敗收據保留。精確檔名納入 `FOUNDATION_NAMES` 只代表辨識 schema，不授予公開、合併或部署權限。

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

## 第二階段歷史候選（當時本地原生與 DB 未驗）

已加入Owner可見範圍設定與草稿預覽、visitor頁面、既有名錄頭像點擊連結、好友incoming/outgoing/accepted/self狀態與既有私訊入口。會員投影使用單一SQL／HTTP回應的 `{profile,actions}`；匿名契約不變，沒有actions。頭像必須另有明確同意、版本綁定及物件讀取前後權限重查；第一階段不接受include_avatar，不把私人頭像URL放入DTO。
好友／私訊只在本人點擊後沿用既有command與server封鎖／會員資格；看個人頁不自動建立對話或送訊息。不把mute當ACL，不發明friends-only私訊限制。
前端必須按client identity＋user/session generation＋target隔離，清除舊快照、取消晚到回應，合併focus/visibility重讀；不使用跨登入持久快取。

## 驗證界線

Pure policy/schema 與 synthetic HTTP 檢查不等於 PostgreSQL ACL／並行交易驗證。必須分開記錄執行環境與精確 head：

- **本地**：6d 候選跑過純測試、TypeScript、portal Vite compile 與瀏覽器測試列舉；本地 PostgreSQL／原生瀏覽器仍為 `not_run`。不重試已知 Chromium/socket 限制、不啟動本地 DB、不安裝套件。
- **較早 head 的 hosted CI**：見下方精確來源紀錄；不是「所有 hosted CI 都未執行」，也不是目前 6d 或正式環境的驗收證明。
- **目前 6d**：hosted runtime 8 個分組通過；原生 UI 為 1,703 通過、58 跳過、1 失敗，詳見下方精確來源。正式環境限制角色 grants、封面儲存／decoder／policy 啟用與更廣泛競態的缺口，不能由有限測試計數推論已關閉。

### 目前 6d hosted 結果（2026-10-27）

`6d0e89d6744220924e65f8adc632ce68e39483e5` 的 [run 40587917162](https://github.com/FreeTWAI/freedom-platform/actions/runs/40587917162)：

- [runtime aggregate job 122503792041](https://github.com/FreeTWAI/freedom-platform/actions/runs/40587917162/job/122503792041)：8 個 runtime 分組通過。
- [原生 UI job 122487202144](https://github.com/FreeTWAI/freedom-platform/actions/runs/40587917162/job/122487202144)：1,703 通過、58 跳過、1 失敗。主題欄位已越過；失敗出現在 `getByLabel('關於我',{exact:true})` 同時匹配文字欄位與區塊顯示 checkbox。該失敗案例後續的取消／重設／封面相關斷言尚不能宣稱通過。

本次後續修正候選以明確 textbox role 限定編輯欄位；上述數字只屬於修正前 6d，不能移作後續 commit 的驗收結果。原生 UI 尚未全綠，也不是正式環境驗收。

### 已核對的較早 hosted 結果（不是 6d 驗收）

`44d58e17260e609828567ef9a4b4b2aeb27a4624` 的 [run 40575890632](https://github.com/FreeTWAI/freedom-platform/actions/runs/40575890632) 已有真實 hosted 執行紀錄：

- [runtime job 122442912400](https://github.com/FreeTWAI/freedom-platform/actions/runs/40575890632/job/122442912400)：社群認證 19、tenant-data catalog 31 項通過。
- [runtime job 122442912051](https://github.com/FreeTWAI/freedom-platform/actions/runs/40575890632/job/122442912051)：社群稱號 17 項通過。
- [runtime aggregate job 122460030424](https://github.com/FreeTWAI/freedom-platform/actions/runs/40575890632/job/122460030424)：8 個 runtime 分組成功。
- [原生 UI job 122442911999](https://github.com/FreeTWAI/freedom-platform/actions/runs/40575890632/job/122442911999)：1,662 通過、1 失敗、58 跳過；失敗為 profile 主題欄位的精確 label 定位。6d 已修正主題 label；新 head 的不同失敗與結果另列上方，不混用兩次結果。

這些是各測試檔案／分組在 44 head 的有限結果，不代表所有封面流程、正式環境角色權限或所有競態均已驗證，也不授權啟用任何功能。

## 跨功能文字／認證界線

顯示名稱、自介、連結皆為本人提供的內容，不是平台或管理員背書。控制字元在 trim 前拒絕，遵守既有名片單行文字規則；HTTPS連結禁止帳密並限制原始與URL解析後長度，僅渲染外連，不由伺服器抓取。React以文字節點顯示，不解讀HTML。
未來社群認證屬帳號層級的人工審核、可撤銷標記，不代表每段自介、名稱或外連已經審核。整合前必須明確決定改名／版本變更政策與對外帳號層級說明，並遵守本人展示同意與此投影ACL；不能直接把目前文字或連結視為已認證。此候選沒有任何認證欄位。

## Local customization candidate (not deployed)

The separate candidate extends the explicit publication, never the private `/me/content`
workspace or legacy directory/e-card. Layout is a strict bounded object: four themes,
five accent presets, four CSS-only cover patterns, plain-text about, at most six manually
entered HTTPS featured links, and the complete ordered/visible four-block list. There is
no arbitrary HTML/CSS/font/remote-image input and no automatic Work or private inventory
projection. Preview/cancel/reset are local; saving persists the whole publication via its
existing CSRF/idempotency/CAS protocol. Resetting appearance does not change visibility or
identity text. Recognition slots do not award anything: social titles/community certification
remain independently consented authenticated projections from their separate candidates.
Community certification is account-level, not review of every user-written bio or link.

Own covers use a separate `member.profile-cover` Asset purpose and existing generic
ObjectStore transport, not account-avatar URLs. Static JPEG/PNG/WebP input is capped at
4 MiB and must fully decode, reject animation, strip metadata and normalize to a bounded
1600×600 WebP (512 KiB maximum). Upload creates a private immutable retained version;
it does not change the currently published image. Explicit `include_cover` and the exact
version are saved with publication settings. Cancel leaves private staged images available
for explicit removal. At most three unselected drafts may admit another upload; deselecting
an existing cover can expose a fourth retained draft, all discoverable. Selected versions
cannot be retired until the publication stops selecting them. Retired bytes remain charged;
this candidate does not activate physical GC or claim deletion from backups.

Publication text and bytes share the same canonical SQL ACL. Member bytes repeat active
session/community/readiness/block checks; public bytes always use anonymous authority,
even with cookies. Every byte read validates exact publication generation + selected cover
version before and after verified object-store I/O, with no DB locks across that I/O.
Responses are no-store, no ETag/304, noindex and same-origin; DTOs contain only version and
generation, never Asset/object IDs or private URLs. A public profile remains visible to a
blocked person who signs out; the editor explicitly warns about this limit.

After Google identity migration190 entered main, migration192 adds layout/consent
columns and the closed Asset domain after profile migration191. Google190 and all
earlier historical SQL bytes remain unchanged. The new policy row defaults unavailable: storage binding,
quota, retention, and production policy activation are operator decisions outside this
code grant. UI displays real availability instead of a fake successful upload. Routes are
unconditionally mounted, so eventual deployment requires the integrated schema first.
Local pure/SSR/mock-HTTP checks are not a DB/privacy proof. Native browser and PostgreSQL
remain `not_run` **locally**; this does not erase separately recorded hosted results on older
heads. Older ab8 text-only evidence and the 44d58e integration evidence above must not be
attributed to current 6d. Production restricted-role grants, storage/decoder/policy activation
and broader cover/concurrency gaps remain separate, unproven acceptance obligations.


## Hidden-block visitor data boundary

A saved block with `visible=false` withholds that block's content from both anonymous
and authenticated visitor JSON (including the owner's visitor view), not only rendering.
The bounded response shape remains stable: hidden `about` becomes an empty string,
`featured` and top-level `links` become empty arrays. Hidden `recognition` omits both
member-envelope certification and social-title payloads; enabling the block still requires
the existing independent feature flags, consent and award/review predicates.
The owner-only settings endpoint retains the full saved content for editing and round trips;
local draft preview never publishes it. Display name, short bio and explicitly selected
cover are outside these four blocks and continue to follow the overall publication ACL.
This does not retract previously received copies, change legacy directory/e-card visibility,
or establish whole-platform privacy, deployment, actual PostgreSQL or native-browser evidence.
