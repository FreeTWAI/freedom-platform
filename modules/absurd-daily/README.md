# 自由工坊遊戲大廳

公開、免登入的遊戲大廳，按料理、觀察攝影與派對手速分類。包含 64 道料理小遊戲，以及照相館、蓋章、道具鈔分類、辦公椅逃亡、豆腐疊高高、假日保衛戰六款原創 3D 短局遊戲，合計70款。使用者於 2026-10-23 明確派工原遊戲，2026-10-25 追加大量料理、統一插畫風格、全面重設大廳，接著要求原創3D派對與完成後提交PR。

新三款派對的規則、時間／碰撞與來源界線見 [PARTY.md](PARTY.md)，實際renderer預覽與來源hash見 [party-art.json](party-art.json)。目前三張640×480 WebP共53,318 bytes；程序模型不另下載素材，進場才載入renderer。手機／鍵盤可完成三種不同玩法，短局離頁重新開始。分享沿用原成果預覽，由本人確認發布；沒有新增即時多人連線、社群API串接、付費、積分或排行榜。

料理、分類大廳、收藏／本機進度的規格見 [COOKING.md](COOKING.md)。圖集、完整生圖提示詞、尺寸、格位與來源雜湊見 [cooking-art.json](cooking-art.json)。8 張圖集合計 1,718,994 bytes；按目前頁面與分類載入。九種操作共用純 domain；目前以原創啞光玩具料理台呈現，沿用Three，640×448、DPR≤1.5、512陰影。可主動切換輕量插畫；載入／WebGL失敗仍保留同一盤及完整SVG操作。完成菜仍用原插畫圖集；沒有密集飯粒或白色反光粒子。

先前Playroom版本的production build截圖：[桌面／全部遊戲](review/playroom-desktop.png)、[手機／料理分類](review/playroom-phone.png)。這些是歷史像素證據；使用者已否決前版美術／直覺性，不能作目前美術接受baseline。原始尺寸及雜湊隨source inventory保留，這兩張不進入網站runtime資產。

先前原創派對接續截圖：[桌面派對目錄](review/party-lobby-desktop.png)、[手機辦公椅逃亡](review/party-phone.png)。當時矩陣涵蓋5種viewport、100／125／200% DOM文字壓力與開始／暫停，共59張實際截圖；這是舊版幾何證據，非本版、實機或真人趣味驗收。

`apps/portal-web/src/games/` 持有純規則、程序模型、畫面、成果輸出與有界本機待發交接。規則不得依賴 renderer、帳號、平台積分、真實貨幣或伺服器排行榜。`/play` 使用既有 SPA fallback；只在該路徑載入遊戲，Three 再依實際進入場景延後載入。新頁面的角色導覽停用，原因是公開匿名且具有自己的遊戲操作，不讀取會員導覽／角色資料。

站內分享只把圖片和可編輯文案交給既有 SocialZone；由目前登入會員在原發文器確認，原 session、CSRF、圖片處理、idempotency 和 API 可見範圍保持權威。外部分享、下載與同題連結不自動發文。此模組不建立 API、資料表、付費或獎勵。

成果頁共用 X、Threads、Facebook、Instagram 選擇器；選擇只改UI，點入口才開目的平台。IG使用系統分享或下載PNG／複製文案；網址入口不附本機圖片、不代表已發布。沿用原共用 `PlatformLogo`，改歸 shared 的公開純UI入口，避免遊戲載入社群發文工作引擎或形成相依循環。

讀根 AGENTS、CONTRIBUTING、DESIGN 和本次遊戲規格。完整規格、素材來源、驗收與未驗項將記錄在 `docs/development/absurd-daily.md`。descriptor 只記歸屬，不是執行期註冊、帳號授權或發布證據。

全遊戲修整與本次重做見 [PLAYABILITY.md](PLAYABILITY.md) UX-1..7：大廳先呈現遊戲；料理推薦只在料理分類。主場景、圖示工具與單句動作提示各有獨立空間；直接點鍋翻面／撈泡沫、點爐門出爐，保留鍵盤替代。返回找回原卡片，成果能接下一道／玩法。豆腐輪廓取自當前真實落點；6款3D rigid合批保留照片評分／碰撞／raycast。最新測試／量測見開發文件；不以本機分數代表信任或報酬。
