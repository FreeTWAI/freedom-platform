# 本人個人空間與選單

主要導覽與右上角「設定」以「我的個人空間」為單一個人內容入口，帳號選單另提供「入門指南」和「資料與帳號設定」。`#profile` 內檢視本人內容；「管理草稿與發布」沿用既有旗標與 `#my-content` 深連結，管理清單提供返回個人空間的入口。`#account`、`#todos` 保留原用途，入門指南整理個人資料、公會與領書步驟，不另建任務資料。語言與外觀各有可返回的次級面板，仍保留自動／五語系、五個外觀、安裝與登出。Escape 先返回個人選單，再關閉回頭像；偏好選擇不卸載目前頁面與表單草稿。

## 本人個人空間（source candidate，並非已部署聲明）

`#profile` 僅掛載於現有會員工作區。緊湊摘要使用本人的 `/members/:id` 名稱、頭像、定位與公會名稱，不把聯絡、登入信箱或安全資料帶入摘要。編輯資料與名片分享仍進 `#account` 原流程；此頁沒有複製公開網址、推導分享 token 或自動發布的動作。

內容仍沿 `/me/content` 本人與同社群授權，沒有新增 author query、資料庫 migration 或新的公開投影。按全部／貼文／作品／技能投稿／活動分區，每頁最多六項。這是已取得本人清單的客戶端分頁，不聲稱原 inventory API 已有伺服器端分頁。當頁 active 且有 view action 的動態，才以既有 `/social-posts?post_id=<UUID>` 補讀正文與附圖；最多六個獨立請求，不預讀其他頁。回應必須符合精確 post ID、`mine` 與目前 owner 才呈現，圖片只接受該 post 的既有同源縮圖路徑。其餘類型維持來源狀態、可見範圍與原頁操作，不偽造預覽或追蹤統計。

頁面／帳號／session 世代切換會取消舊讀取，不保留正文 cache；晚到的舊結果不寫入目前畫面。重新整理與回到可見頁時重新驗權，單篇讀取失敗只影響該卡；hidden／deleted 沒有 view 入口。旗標缺失或關閉時不讀 inventory 或 post，只保留資料摘要與明確未開放提示。所有實際讀取仍由來源 API 重驗 session、社群、目前可見狀態；前端檢查不取代伺服器授權。

本人內容管理中的動態 view 也改為固定同源 `/?social-post=<UUID>#social`，不接受 inventory 自帶任意 URL；訪客沿既有單篇分享／登入返回契約，沒有逐篇 publication 的文章不因此公開。作者間可任意瀏覽的公開個人牆、author API、置頂及協作邀請仍是下一階段，需另行定義 opt-in、撤權與跨社群邊界。

驗證入口：`tests/runtime/personal-space.test.ts`、`tests/runtime/personal-content.test.ts`、`tests/e2e/personal-space.spec.ts`。既有選單測試經 `settings-menu-helpers.ts` 真正打開次層，不用 storage/API 取代 UI。測試通過與實際像素驗收、部署分開記錄。

新增介面文字沿五語系字典；使用者原文不翻譯。切換語言不重讀內容、不重設頁次、不改公開或發布設定。
