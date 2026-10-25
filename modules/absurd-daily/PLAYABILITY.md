# 全遊戲操作與效能修整（2026-10-25）

使用者明確派工：所有遊戲操作、細節、精緻度、效能，要求有趣且順手。從 #1051 `de4fa06ca` 接續獨立一批；70個目錄入口（64料理共9種操作＋6種3D玩法）均在範圍內。本文件先於實作，沿 COOKING／PARTY／原 AD 規則；不重寫獎勵、帳號或自動發文。

## UX-1 導航與再玩

從大廳開啟任何遊戲，記住當時卡片、分類、分頁與捲動位置；返回與瀏覽器上一頁後恢復卡片焦點及位置。沒有大廳歷史的直達連結回頂部。成果可重玩同題、換一道料理／另一款玩法，保持原同題網址語意。切換到遊戲／成果後有明確焦點，skip link只在自身focus時出現，不能因程式focus容器覆蓋標題。

## UX-2 料理操作與回饋

九種操作共用原domain：每次輸入立即判定，連續pointer移動的視覺更新最多每個animation frame一次，不用丟棄中間攪拌軌跡。第二個pointer／非本操作的cancel不能結束主操作；hold按鈕同樣有pointer／keyboard owner。暫停、下一步、重來清除gesture與食材選取，開啟重新做確認時先暫停並保存。

揉壓、倒入、翻面、出爐有對應實際domain的時機區與文字；看得到目前位置、目標與能否操作。切／攪拌／包／擺盤顯示即時成敗和下一個提示，避免只有模糊鼓勵。完成步驟顯示真實評分，延續原可完成和失手可續規則。新增回饋不產生額外分數，也不改舊保存格式。

## UX-3 手機與可及性

開始或繼續後直接定位主要遊戲區。直向場景與操作就近；橫向將場景與主控制並排。保持44px hit區、正常文件流及200%文字可滾動閱讀，不能以縮字或裁切換取同屏。keyboard／visible button與touch共用domain。裝置減少動態時關閉裝飾動畫，不改判定。

## UX-4 渲染與資源

維持RAF平順動畫與原時間／碰撞／raycast權威。僅合批已確認相對變換、可見性及材質不變的模型；動態群組各自保留權威，不能合掉拾取、角色切換、照片投影或陰影差異。所有新geometry隨實例釋放。靜態diagnostic屬性只在值變化時寫入，避免每幀重複DOM mutation。記錄前後實際draw calls／triangles、DOM mutation、載入資產及runtime錯誤；不把SwiftShader測值稱為手機FPS。

## UX-5 驗證與交付

build成功後跑既有全遊戲瀏覽器檔，涵蓋原3、9種料理操作、新3。新增針對導航／多指取消／hold／確認暫停／時機提示／渲染失敗的真實回歸；全64料理仍以純domain完成。視覺覆蓋320、390、667橫向、768、1440與100／125／200%文字，實際PNG及owner檢查分開保存。分享仍本人確認發布，原PNG／同題／站內草稿回歸保留。真人趣味／美術、實體iOS／Android效能仍EXTERNAL_PENDING，不以自動測試代簽。

## UX-6 Append-only pitfall ledger

初始觀察（待重現後定案）：大廳返回強制scrollTo(0)；料理cancel未核對pointer；hold按鈕未保存pointer owner；重新做確認未暫停；多處每幀重寫相同renderer diagnostics。修正後在此追加根因、實跑證據及未驗項，不刪失敗歷史。

### UX-T1：測試誤讀保存envelope（2026-10-25）

首輪新增UX-2案例已用真實主pointer完成兩次揉壓，次pointer up／cancel不會提前結算；在暫停保存比較失敗。錯誤為expected1500、received undefined：斷言讀`envelope.elapsed`，既有格式實際是`envelope.run.elapsed`。修正測試路徑，保留凍結時間與2／4進度要求，不更改保存格式或產品時鐘；首輪trace／PNG／error-context保存在E槽。最終回歸結果待追加。

### UX-P1：rigid合批與diagnostics量測（2026-10-25）

相同production seed42、1440×900、1000ms前景樣本：photo／stamp／cash／chair／tofu／holiday的draw calls從211／96／92／141／56／186降為80／70／64／87／52／86。diagnostic mutations從186／186／186／558／558／558降為3／3／3／68／122／63。原始before／after JSON在E槽；不是實機FPS。合批增加有界geometry而非刪除模型細節；紋理數不增加，不宣稱GPU記憶體下降。

### UX-R1：連續手勢的完成畫面不能延遲到RAF（2026-10-25）

首輪舊料理回歸發現mix相關流程失敗；獨立production重現把64個合法pointermove放在同一frame，接著放手，得到`ui=playing`／`saved=step-result`／`next=false`。根因是本批將連續move延遲paint，pointerup取消pending RAF後，`cancel`收到已完成domain所以沒有再次觸發view；domain循環也已結束。完成／暫停等phase轉換必須立即paint，只合併連續位置更新。E槽保留burst-before JSON／PNG，修正與專用回歸後再追加結果；不改domain分數或降低原料理斷言。

## UX-7 使用者否決後的完整遊戲介面重做（先規格，後實作）

使用者明確否決前版：「太醜、不直覺、不好玩的感覺」，並提供 [MIN的Threads料理參考](https://www.threads.com/@min61min41min81/post/De1IzELFK6H)。已實際讀取公開OG封面：大面積有厚度的章魚燒台、油刷／麵糊、圖示食材格、三段火力與下方工具；完整影片未取得，不宣稱已看完。封面只存E槽作研究，不放入產品或公開PR素材。

1. **遊戲主畫面取代長篇表單**：品牌保留；上方只留返回、料理名、目前步驟與暫停。主要畫面＋圖示工具盤，細節說明、精細火力與重新開始在自己的輔助區。原timing百分比改成直覺文字與目標區，數值仍供accessibility讀取。不再用整頁說明作主體。
2. **原創玩具料理台**：64料理共9種操作以同一有界Three renderer呈現立體鍋具、木板、食材、烤箱與手套；啞光toon／清楚輪廓、柔和陰影、大片奶油／杏橙／青綠色，無密集飯粒或白色反光點。使用原插畫料理圖集作完成菜展示，保留比例。機制由原domain決定，不把畫面動畫當完成證明。
3. **直接操作**：原slice／mix／knead／pour／fold／plate手勢保持；pan向上滑或點鍋翻面、boil點鍋撈泡沫、bake點爐門出爐。可見指引對準實際操作位置；鍵盤與按鈕替代仍完整。成功／失手以場景動作和具體短句反饋。
4. **載入／低階回復**：renderer獨立lazy載入，完成初始佈景再開始計時。載入deadline／重試／主動輕量插畫模式；真實WebGL失敗仍可用原SVG操作，不丟domain進度。離頁／卸載釋放RAF、context及geometry。大廳不載3D引擎；有界canvas、DPR與物件數沿用原限制。
5. **全遊戲一致**：6款3D與大廳／成果頁套用同一玩具遊戲機的層次，目錄優先呈現遊戲而非大幅宣傳頁。新派對保留真實碰撞／raycast／分數；豆腐增加對齊落點的實際投影提示，操作更容易理解。
6. **重新驗收**：前版93張幾何通過與35項瀏覽器執行只作前版證據，不算本版美術或玩法驗收。重做後重新build、實際玩9種料理操作／6款3D、手機直橫與大字，保留實際像素並檢查操作owner。使用者已否決的前版截圖不作新美術baseline。真人是否喜歡仍由實際回饋決定。

渲染界限：`KITCHEN_VIEW` 固定640×448、DPR≤1.5、512陰影、15秒載入期限。只在料理入口載入引擎，輕量插畫保留9種操作。每幀直接讀本局權威run，文字低頻刷新不限制道具動畫；paused／ready／完成只在狀態改變時重畫，離頁釋放context。新立體料理台增加入口傳輸成本，必須隨build量測，不能稱作整站減重或手機FPS提升。

### UX-V1：舊樣式干擾新操作台（2026-10-25）

首輪實際手機／桌面截圖發現：大廳仍被舊sidebar grid切欄，手機料理步驟的100% flex-basis把標題擠成直排，mix指引圈偏離碗。根因是沿用舊類別但沒有完整隔離layout ownership。以遊戲根節點`ad-toy-console`隔離玩具介面、明確重設step label與sidebar尺寸；移動碗的位置，使合法攪拌路徑落在碗內。首輪錯誤PNG保留E槽，不作接受baseline。新增正常流overlay及大字幾何驗證，結果待追加。

### UX-T2／T3：重做後的第一輪完整回歸（2026-10-25）

第一輪38項為35 passed、3 failed（13.2分鐘），保留trace／PNG／原log。直接鍋具測試已驗翻面，下一道的fixture在舊料理卸載前寫入session，隨後被舊料理的正常pause保存取代；改成先返回乾淨大廳，再建立由真實domain完成前序步驟的checkpoint，不修改產品的草稿保護。

另兩個失敗是凍結虛擬時鐘後的原生WebP／toBlob交接，不是未完成domain：飯糰100分已落盤。獨立production probe證明3D模式凍結5500ms仍停在done，前進17ms後解碼、成果與PNG均完成；輕量模式無此延遲。原始image load／toBlob事件及時間保存在E槽。fixture先斷言persisted done，再恢復正常frames供原生媒體解碼，完成後才重新凍結；不改完成條件、不放寬產圖deadline。另新增完全不用虛擬時鐘的3D揉壓／包飯糰到可分享成果旅程，與原9操作回歸一起驗證。
