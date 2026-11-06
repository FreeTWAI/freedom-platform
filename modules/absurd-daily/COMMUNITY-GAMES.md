# 社群遊戲投稿：第一階段與未完成範圍

這份增量讓 `/play` 的夥伴準備遊戲投稿，交接到既有 GitHub Issue／PR 審核。
**不是原生檔案上傳、檔案託管、隔離試玩或已上架功能。** 不新增 API、資料表、雲端資源、權限、旗標或自動發布。

## 投稿到審核的流程

1. 在大廳展開「投稿自己的遊戲」，先查看既有 Issue，避免撞工。
2. 填名稱、玩法、手機／鍵盤操作與啟動方法、作者和素材授權。
3. 提供 GitHub repo＋完整 40 字元 commit SHA；沒有 repo 時選「稍後在 GitHub 附原始碼 ZIP」。本頁不讀檔、不解壓、不驗證作品擁有權，也不聲稱已收到附件。
4. 「準備投稿預覽」只在本機產生有界文字。明確勾選願意把所見內容傳給 GitHub 後，才出現前往 GitHub 的連結。點擊不等於提交；本人需登入並在 GitHub 最終確認。ZIP 依 GitHub 格式／大小限制附上；不能附檔時改用原始碼 repo 固定版本。
5. GitHub Issue 編號與討論是收件／審核紀錄，本頁不自行推導成功或新建第二套狀態。關閉、重開或遊戲返回保留當頁記憶體草稿；重載／離站不保存。登入或外站失敗時可重開同一預覽或手動複製文字；再次提交前先查自己的 Issue，避免重複。
6. 維護者核對完整來源、LICENSE／NOTICE、素材權利、固定版本與依賴。附件另記實際 bytes 的 SHA-256，不把檔名／URL 當雜湊。可執行內容先隔離靜態檢查，不在持有平台憑證／正式資料的工作區直接啟動。
7. 有整合價值且來源可審查時，沿既有 contribution workflow 做獨立 PR，補手機、鍵盤、關閉／重開、錯誤恢復與資源釋放測試；經既有必要 CI 與維護者審查後另走正常發布。投稿不授予合併／部署權，不自動加進 catalog。

原作者與素材來源必須保留；repo MIT 不涵蓋沒有另外授權的 Logo、圖像、音樂。使用者自述的作者或 GitHub slug 不是已驗證身分、維護權或貢獻分數。不得提交密碼、token、客戶資料或未授權材料。前端文字驗證無法保證沒有個資，公開前仍由本人檢查。

## 本階段安全邊界

- 不 fetch 投稿 URL，不建立 iframe，不讀 ZIP，不 import／eval 程式碼。欄位只作 React 文字及 GitHub indented code block；不把輸入渲染成 HTML。
- GitHub repo 僅接受固定 `https://github.com/owner/repo` 形狀與完整 SHA，不接受 credentials、query、fragment、分支路徑或任意 host；其存在、內容及權利仍未由平台核實。
- 所有欄位有長度上限，連結最多 8,000 字元；過長明示錯誤，不截掉內容。切到附件模式不把隱藏的 repo／SHA 傳出。修改任何欄位即撤掉舊預覽和同意。
- 外站需明確點擊，無 prefetch、遙測、API 寫入或背景上傳；`noopener noreferrer`／`no-referrer`。預覽連結含投稿內容，可能留在 GitHub／瀏覽器歷史，因此只填可公開資料。
- `/play` 仍匿名可玩，不讀會員資料；投稿需要另外的 GitHub 帳號，不增加平台 GitHub 寫入資格。

## 原生「上傳自己的遊戲並讓別人玩」尚缺的工作

以下是設計待辦，不是已安裝或已驗證的能力。需跨模組審查後另做 implementation PR；本階段不建立新資源或放寬既有政策。

| 工作 | 最低邊界與驗收 | 現有責任入口（不是權限授予） |
| --- | --- | --- |
| 投稿領域與版本 | 會員 session／CSRF、目前社群與作者權限、idempotency、CAS、限額、未知寫入對帳；草稿／quarantined／in_review／rejected／approved／published／withdrawn 明確轉移。更新檔案必建不可變 revision，舊核准不沿用。 | 新領域需明確 descriptor；遊戲產品 `absurd-daily`／community，API composition 與 `command-core`／foundation 協作。 |
| Migration | 投稿、revision、資產引用與 digest、授權聲明、review actor／decision／時間／版本、發布指標與撤回；複合社群 FK、私人 reader、可恢復 command receipt。依當時 main 分配編號，補 migration catalog／reader-writer floor，隔離 DB 正反向／競態驗證。 | `packages/db/`（command-core）、API composition／foundation；本 PR 不預占 migration 編號。 |
| 私有隔離儲存 | 新的 game-bundle purpose/profile、串流實際位元組上限、大小／檔數／壓縮比／解壓時間限制，拒絕 ZIP traversal、絕對路徑、symlink、重複／大小寫碰撞、嵌套壓縮炸彈；不信任副檔名或 MIME。私有 quarantine 與 immutable digest，prepare→verified PUT/GET→fresh-authority finalize、quota、到期／撤回／清理與備份證據。 | `modules/assets/` asset-lifecycle、`packages/asset-storage/`，皆 foundation。現有文字／圖片 profiles 明確拒絕 archive／script，不能挪用。 |
| 安全試玩 | 獨立受控 origin，不能共用主站 cookies／登入憑證／儲存；sandbox 最小 allowlist，禁止 top navigation／popup／下載／表單與未許可能力；不可同時把不可信腳本與主站同源權限交給 iframe。CSP、外連預設拒絕、Permissions-Policy、COOP/COEP 相容性與 SW scope 另設計。 | 遊戲＋殼層／API security composition＋deployment owners；不把 descriptor 或 iframe attribute 當完整隔離證據。 |
| 執行與濫用控制 | 不在主 API process／可信 CI 憑證環境 build 或跑投稿；隔離 runner、無秘密／正式網路、CPU／記憶體／磁碟／時間額度、終止、日誌去密及銷毀。病毒／秘密／相依掃描是輔助，不代表任意程式可信。 | foundation infra/security 與 community 遊戲維護者共同審查，需真正 worker／browser 隔離測試。 |
| 審核／發布／撤下 | 明確 reviewer 能力、不可自我核准、每次現行權限與 exact revision digest 核對；審核不等於發布。公開 reader 只見目前可發布版本，撤回需即時阻擋所有入口與 cache／range；申訴、檢舉、回復與稽核策略。 | 權限／moderation owners 需另行確認，不由公會名或自填 slug 推定；不得借用技能書「本人送出即公開」。 |
| 使用者閉環驗收 | 真正會員上傳→重載找回→被拒後修訂→不同 reviewer 核准→隔離試玩→發布→匿名遊玩→撤下；跨會員／社群拒絕、舊核准、競態、重複與未知操作、惡意包、離線與手機鍵盤必測。 | 跨模組整合；原生環境／真人驗收另列，不能由本機 helper tests 代替。 |

目前 CODEOWNERS 對部署／workflow／descriptor 等保護路徑列出 `teddashh` 與 `detna-vibe-coding`；一般遊戲檔的 descriptor 是 `absurd-daily`／community。這是本次 baseline 的責任索引，不是指定某位成員已接手，也不更動審查規則。

## 本階段驗證範圍

在既有 `tests/runtime/absurd-daily.test.ts` 增加純 draft／URL 邊界案例；在 `tests/e2e/absurd-daily.spec.ts` 增加大廳表單、取消／重開、來源切換、明確外站同意、草稿保留與窄版案例。E2E 只驗本機交接 URL，不向 GitHub 發送真 Issue 或附件。
完整 typecheck／build／runtime／browser 和遠端 exact-head CI 結果以 PR 實跑紀錄為準，不由這份規格宣稱通過。原生檔案上傳、隔離託管、真正 GitHub 會員投稿及真人審核仍未驗收。


## 第二階段基礎：單檔來源檢查（未接線）

`game-upload-source.ts` 新增 `validateGameUploadSource`，接受內部 `{body, contentType}`，只接受明確 `text/html` 的單一 UTF-8 來源，實際串流上限 256 KiB。它重用 asset-storage 的 `readBounded`／`sha256`，拒絕額外 owner、policy、object key、狀態或摘要欄位，來源檔名固定為 `index.html`。無 ZIP／多檔／壓縮／遠端 URL 讀取。上限是本來源格式的保守界線，不代表所有遊戲均適用。

回傳獨立 `ValidatedGameSource`，固定 `trust=unreviewed`、`storageState=not_stored`，含實際 bytes 的 digest／大小與每次回傳新副本的 `copyBytes()`。原 BOM／換行完全保留；來源檢查不保證 HTML 可玩、無秘密、無惡意程式、沒有外連或依賴已鎖版，也不解析／執行／sanitise HTML。摘要只綁本檔，不綁它可能引用的遠端依賴。

這不是 `PreparedRepresentation`／`VerifiedObject`，不可直接交給現有 ObjectStore；沒有增加任何 storage profile／purpose，沒有呼叫 persistence、API、資料庫或提供可玩的 preview。UI 沒有假上傳按鈕。未來 HTTP adapter 使用前必須先檢查現行會員／target 權限，並處理 transport deadline／disconnect cancellation；共享 reader 的位元組上限不是逾時保護。

新增測試涵蓋原 bytes／digest／副本隔離、不執行 script、拒絕 caller authority、無讀取 MIME 拒絕、精確上限／超量取消、多位元 UTF-8／跨 chunk、非法內容、固定無秘密錯誤與不釋放他人的 reader。這些只證明來源檢查，不是 native upload、quarantine 持久化、HTTP／Worker、發布、瀏覽器隔離或真人驗收。

下一個必要 implementation：新 game target／revision 與私有 quarantine policy schema、精確 profile／engine target／object-write-effect admission、會員 owner-scoped routes 和完整 prepare／write／finalize／撤回測試。接續審核／發布 origin 前，任何已存來源仍不得公開 serving 或執行。所有新增 migration 編號與 catalog 需依當時主線協調；本階段未新增 migration，未改現有 catalog 或其測試。

## 第三階段候選：會員私有保存，未開放

`game-quarantine.ts`／[私有來源契約](GAME-QUARANTINE.md) 接上目前會員權限、私人草稿與不可變來源版本、既有 Asset lifecycle 和撤回 API。單檔來源存為非執行的 application/octet-stream，仍為 unreviewed；沒有來源 GET、試玩、審核、發布或前端上傳 UI。Migration203 為本候選暫定編號，canonical policy 預設關閉，未執行或部署。

舊「第二階段」段落描述當時 helper-only 的範圍；helper 的 not_stored 語義不變，不能自己授予保存。第三階段另由 server-owned domain adapter 取得當下政策／quota，執行 verified PUT／GET 與原子 finalize。實際 PG／runtime／HTTP／Worker／R2、備份還原與真人驗收仍需證據，不能以 source 靜態測試代替。

## 第四階段候選：會員自行選檔與私有保存 UI

大廳另外提供「上傳自己的遊戲（會員私有保存）」。匿名遊戲與下方 GitHub 公開投稿仍是獨立選項；只有本人按「使用目前會員帳號開啟」才讀取 session。沿用 PortalClient、同源 cookie、CSRF、原 owner API，沒有增加登入、權限、公開來源或 reviewer 入口。

1. 可建立僅含名稱／介紹的私人草稿，或貼上已知 UUID 冷讀本人草稿。建立不代表來源保存已開放。沒有列表 API；重載後不會自動找回所有草稿，必須自行保留編號。
2. 只有當下 owner GET 明確回傳 upload_available=true 才開放選檔。送出前再次讀取權限／版本／政策；政策關閉或版本改變不送出新來源。UI 沒有啟用預設關閉的政策。
3. 本人選擇一個 .html，最多 256 KiB。瀏覽器只做有界檔案讀取、fatal UTF-8／控制字元檢查；不解析 HTML、不建立來源 iframe／URL、不下載依賴，也不執行遊戲。原 BOM、換行與所有 bytes 封成不可變 Blob，以 exact text/html 傳送，不以解碼字串重建。
4. 選檔只留在本頁記憶體；勾選本人有權提供檔案並按「傳送檔案到私有保存」才送出。這個同意不是公開授權或安全保證。原始碼、檔案、操作鍵不存 localStorage／sessionStorage，不進 URL 或 UI 預覽。
5. 重複點擊只持有一個操作。未知結果保留原 session／target／key／If-Match／bytes，僅明確重試同一操作。已知 target 的重試先 GET 核對目前讀取資格，GET 不代表原操作已完成，不改寫舊操作；政策關閉／撤回仍可能有歷史回條。create 未收回條時沒有 UUID，只有相同 session／原 create 的重試，不猜測新建哪一份。
6. 回條需吻合原操作的識別、名稱／介紹、精確版本／來源版本／狀態。任何 malformed success 都仍是未知。歷史回條不當成目前狀態；另做 owner GET，拒絕低於已知版本的資料。cold read 失敗時不提供上傳／撤回。
7. 可見頁面每 60 秒、focus／visibility 及每次 API 工作前核對 user ID 和 CSRF。帳號／session 改變或拒絕時結束舊工作區，清除檔案與操作，晚到回應不能恢復。暫時網路失敗先隱藏私人 UI，保留未知操作供本人重新確認登入，不默默改用新 session。
8. 撤回需明確確認，維持不可恢復停止新上傳、保留來源歷史與容量，不是刪除。關閉／pagehide／離站會清除本頁資料；選檔或未確認寫入有離頁警告。關閉不是撤回，未知操作可能已保存，重載會失去尚未取得 UUID 的 create 重試資料。

這個候選只是讓會員使用私有保存 API。未部署／啟用政策、未跑真人會員驗收，沒有審核授權、隔離執行 origin、可玩預覽、公開上架或來源下載。安全試玩與 reviewer 設計仍依上表分開審查；現有 native-game-previews／CDP 效能觀察不是任意上傳程式的 sandbox。
