# 自由工坊遊戲大廳

公開、免登入的遊戲大廳，按料理、觀察攝影與反應手速分類。包含 64 道料理小遊戲，以及照相館、蓋章、道具鈔分類三款原創 3D 短局遊戲。使用者於 2026-10-23 明確派工原遊戲，2026-10-25 追加大量料理、統一插畫風格與完成後提交 PR。

料理、分類大廳、收藏／本機進度的規格見 [COOKING.md](COOKING.md)。圖集、完整生圖提示詞、尺寸、格位與來源雜湊見 [cooking-art.json](cooking-art.json)。8 張圖集合計 1,718,994 bytes；只有進入遊戲頁才載入。九種操作共用純 domain；SVG 鍋具與插畫圖集保留比例。新方向覆蓋原黏土美術，舊三款保留幾何與玩法並改用無反光 toon 材質。

Playroom新大廳實際production build截圖：[桌面／全部遊戲](review/playroom-desktop.png)、[手機／料理分類](review/playroom-phone.png)。截圖是瀏覽器像素證據，不代表真人美術驗收或實機效能；原始尺寸及雜湊隨source inventory保留，這兩張不進入網站runtime資產。

`apps/portal-web/src/games/` 持有純規則、程序模型、畫面、成果輸出與有界本機待發交接。規則不得依賴 renderer、帳號、平台積分、真實貨幣或伺服器排行榜。`/play` 使用既有 SPA fallback；只在該路徑載入遊戲，Three 再依實際進入場景延後載入。新頁面的角色導覽停用，原因是公開匿名且具有自己的遊戲操作，不讀取會員導覽／角色資料。

站內分享只把圖片和可編輯文案交給既有 SocialZone；由目前登入會員在原發文器確認，原 session、CSRF、圖片處理、idempotency 和 API 可見範圍保持權威。外部分享、下載與同題連結不自動發文。此模組不建立 API、資料表、付費或獎勵。

成果頁共用 X、Threads、Facebook、Instagram 選擇器；選擇只改UI，點入口才開目的平台。IG使用系統分享或下載PNG／複製文案；網址入口不附本機圖片、不代表已發布。沿用原共用 `PlatformLogo`，改歸 shared 的公開純UI入口，避免遊戲載入社群發文工作引擎或形成相依循環。

讀根 AGENTS、CONTRIBUTING、DESIGN 和本次遊戲規格。完整規格、素材來源、驗收與未驗項將記錄在 `docs/development/absurd-daily.md`。descriptor 只記歸屬，不是執行期註冊、帳號授權或發布證據。
