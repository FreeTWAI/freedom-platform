# 會員宣傳圖整合契約草案

2026-10-18。第一個 PR 提供獨立的開發預覽、受限排版資料與真實 PNG 輸出。尚未掛載會員功能、API 或儲存用途；不是已發布的 SDK 契約。影片導演台不納入，Editkin 入口由原需求方後續另行安排。AI 生成、模型 API、本機推論及自動發文維持暫緩。

## 使用目的與順序

會員從自己的作品或活動選擇「製作宣傳圖」，套版、選個人素材、修改文字，保存私人草稿並下載整組圖片。下一輪再從商品管理權限帶入商品資料，提供商品文案、活動宣傳、作品介紹及合作提案四類可複製的任務模板。來源內容維持原本的公開與發布流程。

| PR | 交付 | 完成條件 |
| --- | --- | --- |
| 1 本次 | 單頁編輯、1:1／4:5 預覽、PNG、五語介面、來源與授權清單 | 可下載與畫面相同的實際圖片；過長文字顯示錯誤，不能假成功；不進入主站載入路徑 |
| 2 | 私人草稿、個人素材、品牌設定與我的內容 | 目前會員與領域權限、保存版本及容量政策均有真實驗證；換帳號隔離 |
| 3 | 三套模板、1 至 10 頁編輯、PNG／ZIP 整組匯出 | 頁序、字型、缺圖與過期輸出有驗證；不漏頁 |
| 4 | 作品／活動來源與既有分享工具交接 | 原內容狀態不變；分享數量限制明確處理 |
| 5 | 商品資料與四類任務模板 | 店舖權限獨立檢查；完整預覽後自行複製，不執行模型 |

新會員入口、寫入及素材上傳在各自完成前保持關閉。現在只有獨立 preview build，沒有生效中的功能旗標、伺服器路由或資料遷移。

## 排版文件

內部 TypeScript 模型位於 apps/portal-web/src/modules/promotional-content/model.ts。schemaVersion 為 1，比例限定 1:1 或 4:5，accent 是六位十六進位色碼。pages 為 1 至 10 個具唯一穩定 id 的頁面；目前預覽只編輯及輸出一頁。每頁包含 label、title、body、footer，UTF-16 長度上限分別為 48、120、1200、120。主標題必填，拒絕 NUL、非法控制字元與未配對 surrogate，不靜默截字。未知欄位及版本拒絕。

此文件只含排版資料，不包含 owner、scope、權限、URL、base64、檔案路徑或私有物件 key。未來圖片必須由領域驗證後的素材引用另行擴充版本，不能直接把任意 URL 塞進現有文字欄位當作圖片。

未來伺服器的草稿 envelope 擁有草稿 id、本人／社群映射及 aggregate version，從目前登入及領域授權導出。操作必須遵循既有 CSRF、Origin、idempotency 與 expected version 契約。排版 schema 本身不授予寫入或跨社群讀取權，也不代替 private Work 的 execution／Grant 模型。

## 圖片與輸出

正方形輸出 1080 × 1080，直式輸出 1080 × 1350。PNG 使用與預覽相同的 Blob；匯出前驗證內容版本，過期預覽不能下載成新內容。字型載入、排版或編碼失敗時停用下載並顯示可恢復錯誤。

文字先依可用寬高換行與縮字，達最低字級仍放不下時要求使用者修改內容。保留 grapheme、明確換行及可容納的中日文標點。裝飾色不作正文顏色，正文維持紙色背景上的深色對比。

本輪使用作業系統字型，不下載第三方字型；不同裝置的實際字形可能不同。sourceFingerprint 綁定排版內容、比例與 renderer version，並非跨裝置像素一致的保證。畫布在轉成 Blob 後釋放，舊預覽網址在修改或離開時撤銷。

下一輪整組輸出按頁處理，ZIP 包含所有頁面及文案。既有分享工具最多 4 張 JPEG／PNG、每張 10 MiB；5 至 10 頁應完整下載後手動上傳，不能默默截成前四頁。站內動態維持單張封面交接；來源連結仍受目前可見範圍約束。

## 儲存與權限前置

新增創作用途前，先核對 Asset engine、目前領域媒體 adapter、持久化政策、容量、retention 及回復能力。禁止把高畫質創作素材借掛到頭像、動態縮圖或商品照片的用途；個人總容量未設定時不開新上傳。

素材庫先限本人圖片與 Logo。既有圖片須經來源領域授權才能重用，不能因公開可看就推定可再散布。搜尋以受權限約束的引用及 metadata 為主，不複製整個媒體庫。私人衍生物不自動公開；換帳號清除草稿畫面及暫存網址，過期請求不能回填到下一個帳號。

## 開發預覽與驗證

從 repository root 使用 Node 24 及既有 lockfile 的 dependencies：

~~~sh
node node_modules/vite/bin/vite.js build --config apps/portal-web/promo-preview/vite.config.ts
node node_modules/vite/bin/vite.js preview --config apps/portal-web/promo-preview/vite.config.ts
~~~

只監聽 http://127.0.0.1:4492，與主站 build 分開。預覽明示離頁不保存，文字只在記憶體內，不連會員 API、不發送外站請求。主站不 import 這個 preview entry，也不增加主站字型或匯出套件載入。

runtime 案例為 tests/runtime/promotional-content.test.ts。瀏覽器設定為 apps/portal-web/promo-preview/playwright.config.ts，案例沿用中央 fixtures 與獨立測試 schema；API 測試服務只供原 fixture 生命週期，不能把它當成新功能已有 API。先 build 主站及 preview，再以明確的隔離 TEST_DATABASE_URL 執行瀏覽器案例；依 repo 指引指定不重疊的 FREEDOM_E2E_PORT。

~~~sh
node --import tsx --test tests/runtime/promotional-content.test.ts tests/runtime/guild-blocks.test.ts
node node_modules/@playwright/test/cli.js test --config apps/portal-web/promo-preview/playwright.config.ts
~~~

本輪本機驗證：typecheck、主站 build、preview build 通過；18 項 runtime 案例與 10 項 Chromium 案例通過。涵蓋實際 PNG bytes／尺寸、預覽與下載相同、五語、320px／三主題及字型／編碼失敗後重試。Windows 的 guild registry generator 需先把相對路徑反斜線轉成正斜線，這張 PR 包含同一項可攜性修正，不改 registry 內容。

本次測試不代表會員私人保存、正式 R2、完整十頁輪播、真人試用或部署驗收。來源與授權見 [SOURCES](../../../apps/portal-web/src/modules/promotional-content/SOURCES.md)；原 168 項 Foundation 需求的現況索引保持原狀。
