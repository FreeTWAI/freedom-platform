# 自由工坊遊戲大廳

公開、免登入的 `/play`：66道料理、3款觀察／反應遊戲、3款派對短局，共72個遊戲入口。原始自由工坊Logo保留。料理依8類搜尋／收藏／完成紀錄瀏覽，所有入口均可由卡片開始；返回恢復原卡片、分類、分頁及捲動位置。

## 目前這一批

- 炒飯、牛排、沙威瑪、炸熱狗使用獨立的自由料理台。食材、逐片熟度、正反面、火力、拋鍋、灑出、包捲、瀝油及醬線由有界純domain保存；3D只投影。成果保留這盤配料與醬線，可拖曳旋轉、雙指／按鈕縮放、顯示實際總分。
- 炸熱狗以原創專用外皮／紙托、分離色素與微表面、可隨旋轉移動的油膜高光與環境柔光呈現；全部起鍋後接續同盤調味。直接觸控選取食物，畫醬以相機定位並保留在成品。這是可審查美術基準，尚未取得使用者接受。
- 牛排使用有凹底、厚盤唇及鏤空耳把的橢圓鑄鐵盤，配倒角木托；其他平盤改為連續曲面的陶盤、細釉色邊與底足。食物、器皿與桌面接觸高度一致，下載沿同一模型。
- 其餘料理沿原9種引導操作；上述4道的引導練習也保留於`practice=1`連結。所有66道有原創3D成品模型；進場才載入Three，不建立66個context。
- UX-15e依使用者兩張原參考，72個大廳／開場改用搞怪手繪插畫、有限平塗色、暖簾與紙片菜單。最初偏寫實食物廣告的生成方向已被否決並替換，沒有把它當接受版本。封面與可操作HTML分開；開始後仍是原本真正3D玩法，成果依本局資料產生。新圖的真人美術接受仍待確認。
- [PLAYABILITY UX-1..15](PLAYABILITY.md)記錄規格、歷次否決、失敗根因與驗證界限；[COOKING](COOKING.md)／[PARTY](PARTY.md)保留原機制契約。最新執行結果見[開發紀錄](../../docs/development/absurd-daily.md)。舊玩具／插畫截圖不作本版美術接受證據。
- [3D預覽收據](cooking-3d-art.json)綁定實際factory、來源hash、圖像bytes與native draw stats。`cooking-art.json`是已退出runtime的歷史插畫來源，原8張atlas已由3D預覽取代。
- [新封面收據](illustrated-art.json)列出72個獨立512×340 WebP、裁切範圍、原圖及輸出hash、內建imagegen與[完整提示詞](art-prompts/taiwan.txt)。原PNG封存於E槽製作目錄，產品只引用專案內的壓縮圖；參考截圖與其角色／商標不隨產品散布。全批2,538,948bytes、最大45,838bytes，按需載入；這是新增封面資產量，不宣稱整站變小。

## 邊界與恢復

`apps/portal-web/src/games/`持有規則、程序模型、操作、成果輸出及有界本分頁交接。沒有新API、資料表、依賴框架、現金、積分、信任值或伺服器排行榜。料理最佳紀錄只存本裝置；本分頁保存暫停後可接續，未知／過期資料拒絕，保存失敗保留記憶體並提供重試。

Three維持既有版本。場景載入期限15秒，晚到的module不建立失去owner的場景；WebGL失敗暫停並保留同局，可重試或使用可操作備援。ready／paused／完成不持續跑場景RAF，卸載釋放自有geometry、material、texture與context。公開遊戲停用會員角色導覽，不讀會員內容。

分享沿既有Result、`PlatformLogo`與SocialZone。可選X、Threads、Facebook、Instagram，或交系統分享／下載PNG／複製同題連結；目的網站不會自動附本機檔案，也不代表已發布。站內交接只帶圖片與可編輯文案，登入後回原發文器，由本人確認發布。原session、CSRF、圖片處理、idempotency及API可見性保持權威。

讀根AGENTS、CONTRIBUTING、DESIGN與本規格。descriptor只記歸屬，不是行為驗收、合併或部署證據。實機Safari／Android效能、真人美術／趣味與社群App實際發布仍需外部驗收，不能由本機編譯或自動測試代簽。

UX-12材質實際畫面：[炸熱狗原生截圖](review/native-corn-dog-20261025.png)、[旋轉短片](review/native-corn-dog-rotation-20261025.mp4)。均取自production createDishStage；這份目錄範例用於觀察材質，玩家成果仍由自己的run生成。影片只屬review素材，不進大廳載入路徑。

UX-13依使用者截圖修正：料理評分只顯示實際總分，移除雷達圖、分項、稱號、評語與星級；分享圖／文案同步簡化。

最新大廳實際畫面：[手機](review/current-lobby-phone-20261025.png)／[桌面](review/current-lobby-desktop-20261025.png)。歷史review圖仍保留各自版本，不能用來代表本批最終評分樣式。
UX-13修正當時的實際旅程（器皿改版前）：[總分頁面](review/current-score-only-20261025.png)／[下載分享圖](review/current-corn-dog-share-20261025.png)。這是自動化實際操作得到的當局分數，與排版100分示意分開保存。

UX-14器皿：[牛排鐵盤示例](review/native-steak-iron-20261025.png)／[陶盤示例](review/native-ceramic-20261025.png)。示例由production renderer產生，與真實玩家完成局分開標記。最新實際旅程：[手機牛排成品](review/current-steak-iron-phone-20261025.png)／[實際下載牛排PNG](review/current-steak-iron-share-20261025.png)。

UX-15e新介面：[桌面大廳](review/illustrated-lobby-desktop-20261026.png)／[手機料理目錄](review/illustrated-kitchen-phone-20261026.png)／[炸熱狗開場](review/corn-dog-illustrated-ready-20261026.png)。均為實際production頁面，生成方向mockup與否決原圖分別封存E槽。50項runtime、最後13條受影響瀏覽器與17張修復追查通過；完整56條首輪的53通過／3失敗及31張首輪的18通過／13失敗仍保留，詳見開發紀錄，不把不同版本加總成一次完整全通過。

## 可重現的原生預覽候選（operator tool，非驗收）

`node modules/absurd-daily/tools/native-previews.mjs` 預設只輸出 dry plan，不建置、不啟動瀏覽器／server、不寫檔。需要另獲准的原生執行環境，且已安裝 Vite／Playwright／sharp／Chromium，才可明確執行：

```sh
node modules/absurd-daily/tools/native-previews.mjs capture /absolute/new-evidence-directory /absolute/installed-chromium
```

輸出目錄必須全新、在 repo 外，不覆寫既有成果。工具使用既有 Vite production config 的 write:false 編譯，保存 emitted module metadata／chunk hash、觀察到的 file-backed transform input hashes 與 declared source inputs；保留 synthetic module ID，不把有限來源清單冒充所有工具鏈／環境的完整證明。只透過 loopback 提供 emitted JS，禁止頁面向外請求，不執行 npm／安裝／skill-client 打包／API／資料庫／部署。這不是完整標準 build。

依序呼叫真正 emitted `createDishStage` 生成全部66道，保存原生PNG、512×384 WebP（quality82）、實際 browser／renderer／DPR、來源／輸出 hash、native calls／geometry／textures／triangles、canvas cleanup及 import／construct／capture wall timing。最後重新驗所有來源／chunk／輸出 bytes、尺寸與預算；少一張、重複、來源漂移、錯誤或失敗都不產生 candidate manifest。成功只寫 evidence 內的 `candidate-manifest.json`，仍待視覺審查；**不自動更新 repo manifest／圖片，不代表遊玩、FPS、GPU memory 回收或完整 CI 通過**。operator 應保留原PNG及receipt，核對66個id與現行catalog後，再另行審查素材更新。

目前已知限制：2026-10-27 own-cloud Chromium 在啟動時因 socket EPERM 中止，0／66生成；不得用修改 sandbox／profile／flags 重試來規避。此工具的純驗證測試不代替原生執行。原 `cooking-3d-art.json` 的來源 gate 仍如實失敗；不能只換 hash 宣稱重新生成。

預算依本工具實際的 `createDishStage` 預覽契約：calls≤100、geometries<100；textures 如實記錄並驗非負整數。既有66張預覽記錄為6–14 textures，不能套用 `kitchen-stage` 引導麵團觸控測試的≤3 textures門檻；後者是另一個場景／取樣契約，仍原樣保留。
