# 自由工坊節日介面主題

使用者於 2026-10-28 要求參考 Facebook／Google 的節日體驗，並指正三張圖示不足以構成介面主題。本案以原創生成素材與既有會員介面整合；不是替換品牌或複製第三方設計。

## 參考與界線

實際查看官方圖像後，採用其「多個接觸點一致、核心操作不變」的原則：

- [Google Halloween 2024](https://doodles.google/doodle/halloween-2024/)：品牌區與可選遊戲入口形成完整構圖。
- [Google Holidays 2018](https://doodles.google/doodle/holidays-2018-southern-hemisphere-day-3/)：保留品牌辨識，裝飾有主次。
- [Google New Year's Eve 2024](https://doodles.google/doodle/new-years-eve-2024/)：局部底板、材質與光感協調，不必塞滿全頁。
- [Facebook Halloween 2017](https://about.fb.com/news/2017/10/celebrate-halloween-with-spook-tacular-features-from-facebook-and-messenger/)：一般導覽與動態卡保留，節日問候卡連接創作入口。
- [Facebook Halloween reactions 2016](https://about.fb.com/news/2016/10/no-tricks-just-treats-from-facebook-this-halloween/)：官方文字確認季節反應圖案沿用原操作；本案不更改反應語意。
- [Messenger Holiday Features 2021](https://about.fb.com/news/2021/12/messenger-holiday-features/)：背景與元件色一起協調。這是聊天案例，不是 Facebook feed 全站換皮證據。

這些是具年份的研究，不代表目前產品仍提供相同功能。第三方圖片沒有納入產品；原始自由工坊 Logo／字標／首頁連結與離頁保護均保持。

## 實作範圍（依使用者後續修正）

使用者確認萬聖節金屬素材可以保留，但其他節日不必全是液態金屬。保留原品牌辨識、字體、三個基本外觀與萊姆綠主要操作，節日插畫可以各有材質。先前厚描邊卡通家族不納入本候選。

- 會員頂欄：只有克制的細分隔線；字標、首頁連結、位置與尺寸不變，沒有額外圖示或假底部導覽。
- 會員首頁：手機目標 96–120px 的節日問候區；文字與插畫是獨立 grid 欄位，圖片完整 `contain`，不覆蓋文字或裁切原圖。萬聖節採鉻金屬、聖誕／新年採鈷藍／萊姆／米白紙雕。
- 「分享今天的小事」接原有建立貼文流程，不自動發文。關閉後沿原發文器回到動態牆「建立貼文」入口，不新增離頁管理。
- 邊緣只用橫幅內一條短 CSS 幾何線，次要按鈕 hover／分隔線沿用基本主題 token；沒有整頁壁紙，不改正文、錯誤或主操作語意色。
- 現有「設定 → 外觀主題 → 節日主題」提供自動、關閉、萬聖節、聖誕節、新年；只存瀏覽器本機，不存會員資料。
- 沒有自動動畫、聲音、粒子、活動假連結、新 API 或 migration。

自動以 Asia/Taipei 日曆日期計算：10/25–10/31 萬聖節、12/15–12/25 聖誕節、12/28–1/3 西曆新年，包含首尾日。午夜與分頁回前景時更新，離開會員外殼清理 timer/listener；手選主題保留至改選自動或關閉。

## 圖片與效能

[素材 manifest](seasonal-theme-art-manifest.json)記錄生成工具、完整提示詞、原圖及產品 WebP 雜湊，不含私人 Library ID、本地絕對路徑或連線 ID。原圖在私人工作資料保留，不覆寫。圖片權利不因 repo MIT 自動轉授，需維護者審查。

只有三張 hero，每次只載入選中一張：萬聖節 480×320、聖誕與新年 384×384，保留完整構圖與 alpha，不再引用舊九張卡通素材。單張新增下載預算 100KiB。裝飾 empty alt、aria-hidden、固定獨立欄位、低下載優先；圖片失敗仍有可用文字與操作。

## 驗證及完成標準

研究主張：完整但克制的節日氛圍，不犧牲社群閱讀與原操作。對照必須用同一候選、同一日期／視窗／基本主題的「關閉」與三套節日，不拿舊版圖冒充本次 baseline。

- 純測試：台北午夜首尾 ±1ms、跨年／閏日、無效日期、手動／自動／關閉、storage 阻擋與輸入白名單。
- 原生瀏覽器案例：明亮／夜航／敘生 × 390／1280px，保留整頁 before/after 圖；320px 圖片失敗、composer 開關與自動到期；品牌名稱、44px控制、無水平溢出、選單 Esc 返回焦點。
- 手機首頁 hero 實際上限120px；原始 Logo／萊姆綠主要操作／正文色不變；未選主題沒有下載。
- 實際執行與未驗項以 PR 收據為準。此環境不啟動 native browser／PG，local build 或 source review **不代表**原生畫面、真人接受或正式環境通過。必須取得 CI 截圖後 inspect → fix → recapture 才能接受視覺主張。
- 使用公開 R&D／Code Cleanup 方法；私人 canonical Skills provider/revision gate **NOT_RUN**。不宣稱已安裝或完整通過該流程。
