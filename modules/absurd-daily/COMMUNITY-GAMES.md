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
