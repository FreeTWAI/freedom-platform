# 手機安裝與主畫面入口

登入頁和會員設定提供「加入主畫面」。瀏覽器提供原生安裝提示時，只在使用者按「安裝自由工坊」後開啟；其他情況提供三步說明。帳號入口的五種語言皆有對應文字。取消或拒絕後仍可看說明；接受提示不提前聲稱安裝完成。

Manifest 的 id、start_url 與 scope 都是同源 `/`，使用 standalone 模式；192／512px 圖示及 iPhone 180px 圖示由既有原始品牌圖等比例置入，保留安全邊界。安裝不攜帶會員或重設密碼 URL。主題同步 theme-color；standalone 不重複顯示安裝入口。

聊天室在桌面保留可調整寬高的浮窗；760px 以下填滿 visualViewport 可用範圍，開啟時隱藏右下泡泡，以外層標題列至少 44×44px 的「收合聊天室」按鈕或瀏覽器上一頁收合。面板跟隨鍵盤造成的可視高度與頂端偏移，外層標題與收合鈕避開 safe-area 和離線狀態列，一般文字輸入與傳送保持可見；貼圖、引用或圖片超出可用高度時，輸入區可捲動以操作各個控制。背景頁面維持原版面。Back／Forward 保留目前登入且未重載頁面的對話草稿；`#messages`、`#messages?guild=<key>` 冷啟動及站內 hash 導覽進入同一面板，冷啟動以會員首頁為底頁。完整操作契約見[會員設定、待辦與訊息](member-settings-messages.md)。

斷線時有狀態提示；恢復網路保留目前頁面的草稿，發布／傳送仍需要本人操作。沒有 service worker、私人 API 快取、離線啟動、背景寫入佇列或推播；此版本需要網路，也不承諾重新載入或系統關閉頁面後恢復記憶體草稿。

`tests/e2e/mobile-install.spec.ts` 的七個 Chromium 回歸案例涵蓋原生 manifest／installability 與 HTTP 圖示、320px 五語說明／焦點、瀏覽器離線與重新連線、一次顯式 API 發文，以及聊天 Back／Forward、深連結與鍵盤邊界。安裝資格案例使用獨立的非無痕暫存設定檔，沿用專案瀏覽器啟動選項，結束時關閉瀏覽器並移除該設定檔；manifest 與安裝資格錯誤仍必須為空。公會深連結以合成頻道回應驗證導覽；native prompt、standalone、safe-area 與固定 layout viewport 下的 visualViewport 鍵盤變化是明示模擬。實際 iPhone／Android 安裝、系統鍵盤與登入儲存仍待真人驗收。

[2026-10-07 歷史效能紀錄](social-platform-performance-2026-10-07.md)保留當時版本、環境與六個安裝案例的結果；這裡列出的七個回歸入口不代表新候選已通過測試、部署或實機驗收。
