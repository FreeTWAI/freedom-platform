# 原創 3D 日常派對（PT）

## PT-1 派工、問題與範圍

2026-10-25 Hao 明確要求：料理／大廳完成後，繼續做參考派對小遊戲類型的原創 3D 小遊戲，不能照抄。料理與 Playroom 已在 #1050；本批疊在其 commit `bc211f72`，獨立 PR，目標 main。沒有複製 Mario Party 的人物、關卡、UI、音樂、名稱或素材。

玩家價值：不用帳號，30 秒左右玩懂一個荒謬日常，獲得可分享的真實本局成果，再用同一 seed 邀朋友比較。這是單人／輪流挑戰，不宣稱線上多人。暫不新增 API、帳號整合、平台點數、付款、排行、廣告或下載軟體。

原型問題：在 390×844 手機瀏覽器，以可見規則與操作控制，能否完成三款不同的「開始 → 操作改變成績 → 結束 → 分享同題」流程？自動操作只能證明可玩鏈路；真人是否覺得好笑、想重玩，仍 EXTERNAL_PENDING。採三個短局的 bounded playable slice；不擴成大型桌遊。

環境沿用 React 19／TypeScript／Vite／Three 0.186，不新增套件。純 domain、renderer、React 控制各自負責規則、投影與輸入。

## PT-2 共用權威、時鐘與生命週期

`party/catalog.ts` 是常數與輕量目錄；`party/domain.ts` 是唯一可改分數的純函式。狀態為 ready／playing／paused／done，seed 為 1..2³²−1 整數；elapsed 單位 ms，score 非負整數。外部時間輸入只接受有限、正數，單次 advance 上限 1,000ms；倒退、NaN、Infinity、不在 playing 都不變。

UI 使用 RAF 前景時鐘；第一幀不計時，blur／hidden／超過 1,500ms 的卡頓暫停，恢復需本人點繼續，不補算離線時間。背景與暫停停止 RAF。按鍵 repeat 不形成新操作。場景動畫只投影 domain，不憑渲染幀自行加分；減少動態僅關掉裝飾晃動、震動與粒子，操作窗口保持相同。音效預設關閉，由本人開啟。

每次進入路由新建狀態；重新整理／離開清除本局，開始前明示。這批沒有永久遊戲存檔／獎勵可遷移；既有料理保存與 v1 成果交接保持原規則。分享結果來自 frozen done state，只產生一次；圖片失敗保留本局並可重試，不重新計分。

## PT-3 辦公椅逃亡（chair）

30,000ms，3 條路線（−1／0／1），橫移速度 8 lanes/s，左右輸入冷卻 130ms；跳躍 850ms、最高 1.7 單位，落地前不能再跳。22 個 seeded 波次，第一個在 2,200ms，間隔 1,250ms。每波一個會議桌／推車、一個不同路線的假日票。場景速度 6.4 units/s、顯示未來 2,800ms，碰撞採波次穿越時刻的實際橫向位置，不只比目標路線；容差 .46 lane。推車可在跳高 ≥.8 時越過，會議桌須換路。

撞到扣一顆心、減 30 分（下限0）、combo 清零；3 心用盡立即結束。每個避過的障礙 +15；同路假日票 +100＋10×min(combo,10)。波次只結算一次，數量有界22。手指左右滑 ≥28px 換路、點場景跳；另有左右／跳躍44px以上按鈕，方向鍵／A D／Space。

角色為長耳豆豆乘坐有扶手、五爪輪腳的辦公椅；會議桌帶文件、推車帶杯子，假日票為葉片印記。撞擊歪頭／紙張飛散、收票跳字；分數取決於玩家輸入，無假排行榜。

## PT-4 豆腐疊高高（tofu）

底座寬深各3，目標12塊成功堆疊；3次失手或60,000ms結束。每塊高 .48，交替 X／Z 軸，正弦位移幅度2.65；角速度 1.8＋成功層數×.08 rad/s，seed 決定相位。按落下時凍結位置，460ms下落期間拒絕第二次；落地後才追加一個不可變 layer。

偏移絕對值 ≤.12 是完美：貼齊前塊、保留大小、+150＋15×min(combo,10)。其餘按一維區間交集裁切，分數 floor(100×保留長度/原長度)，combo歸零；交集 <.32 視為失手、不增層。另一軸不變，新塊中心為交集中心。邊角只作視覺掉落，不創造新權威物件。drop／advance重送不得重複落地或加分。

點場景／「豆腐落下！」／Space。相機依真實堆疊高度追蹤；搖晃只作裝飾，不變碰撞。原創豆腐有海苔五官、葉片配件、陶瓷餐盤；外層啞光、無白色油亮點、無密集米粒。

## PT-5 假日保衛戰（holiday）

24,000ms／20波，每波1,200ms；六個固定洞口，120..1,020ms可點。一個戴葉子的「休假」，一個戴領帶的「開會」，由seed＋round決定不同格。點休假 +100＋20×min(combo,10)，點開會 −80，空格 −15，分數最低0；錯誤或漏接清combo。每波每格只判一次；action帶round，過期輸入拒絕。

場景以raycaster選洞口，不依賴固定螢幕像素；鍵盤1–6與同步6格文字按鈕提供完整替代。文字、葉子／領帶形狀與顏色共同辨識，不能只靠紅綠色。原創蒸籠小精靈，按錯會冒出一疊文件，不照抄既有遊戲角色。

## PT-6 輸入、載入與視覺合約

入口加入現有 Playroom，全部70款／料理64／觀察1／派對手速5；桌面和手機仍4個分類。新3D卡片使用實際renderer截圖，不把概念圖當遊戲畫面。大廳只載入目錄和靜態WebP，進場才載入PartyGame與Three。

獨立標題／狀態列／4:3場景／操作列／說明，各自有owner；開始、暫停、完成覆層的文案與CTA在正常文件流，文字變大時可增加高度，不裁字或縮小到不可讀。觸控目標≥44px，focus-visible，200%文字時重排。scene touch-action:none僅限遊戲場景，外層照常捲動。

模組／renderer載入上限15秒，失敗顯示重試和回大廳；WebGL失敗／contextlost會停止並暫停本局，重建後本人繼續。卸載取消RAF、timeout、listener、ResizeObserver、音效節點，dispose所有自有geometry/material/texture與context。最多DPR1.5／邏輯640×480；池化有限波次與粒子，不隨遊玩無限新增mesh。目標每場<400 draw calls／150k triangles（實測後記錄）；不把此預算宣稱為實機FPS。

暖奶油背景、墨褐輪廓、鼠尾草綠／陶土紅／蜂蜜黃，與既有插畫廚房同一情緒。幾何細節用輪腳、衣摺、餐盤邊、植物、招牌呈現，禁止亮面環境、密集飯粒、隨機白色亮點。自由工坊原Logo完整保留。

## PT-7 結算與分享

三款共用既有 Result／ResultShare。輸出真正本局畫面、實際分數與條件摘要；X／Threads／FB／IG只開本人選擇的入口，系統分享不能預選目的App。站內沿用v1同分頁草稿，登入後預覽、本人確認發布。game whitelist加入chair／tofu／holiday；舊三款和kitchen保持可讀。seed URL只重現題目，不是可驗證成績或線上對局。

## PT-8 驗收與迭代記錄

最小gate：純domain三種成功／失敗、seed、穿越碰撞、下落冪等、錯波次、非法時間；舊與新分享解析相容；typecheck→build→實際瀏覽器3款完整鏈（含觸控／鍵盤、暫停、重來、contextloss恢復、成果／分享）。保留原料理／舊遊戲受影響回歸。實際renderer截圖：手機390×844、最小320×568、橫式667×375、桌面1440×900，100／125／200%文字與缺圖／錯誤。資源統計與大廳不載Three分開實測。

CI、獨立review、正式會員／社群帳號、實體手機／Safari、外部真人美術／趣味驗收各列真實狀態；本機成功不替代它們。Pitfall與觀察完成後追加本節，禁止預填PASS。

### 2026-10-25 本輪 pitfall ledger

| ID／類別 | 實際觀察與根因 | 修正與證據 | 狀態 |
| --- | --- | --- | --- |
| PT-T1／fixture false positive | 首輪逃亡3680分、19票、0碰撞；150ms虛擬等待僅128ms前景時間，130ms冷卻內第二鍵被正確拒絕 | `timing-repro.json`保留0→128→272；fixture改以實際elapsed／lane驗證。規則／滿分不變；後續兩次完整22波均4280分 | PASS（修正fixture；原失敗保留） |
| PT-A1／畫面辨識 | 首張實際renderer中，豆腐側面臉被薄層縮扁、洞口號碼位於圓筒內側被遮擋 | 臉放到頂面、號碼移至外表面；`first-*-scene.png`與`polished-*-scene.png`保留開發者前後檢視 | PASS（呈現／來源；真人美術EXTERNAL_PENDING） |
| PT-R1／runtime exception | 暫停後切換動態選項，對GL clear注入拋錯，原本產生pageerror且沒有恢復提示；只有RAF分支捕捉錯誤 | UI與RAF／結算共用safeDraw，停止並保留本局。`render-before.json`與`render-after.json`保留前後；最新瀏覽器重建／繼續後仍120分、零pageerror | PASS |
| PT-U1／fallback stress | 缺圖文字原!important字級會阻擋DOM放大壓力；固定aspect owner可能不足 | 提高selector具體度、取消固定字級優先權、缺圖owner自然長高；最新lobby案例要求實際computed40px與bottom在owner內 | PASS |
| PT-L1／橫向組合 | 低高度畫布與主操作需同時可見，僅document不溢出不足以保證可玩 | 低高度改畫布／主操作並排；667×375三款實際canvas及所有主按鈕均在viewport內。200%另驗flow owner，可捲動保留全文 | PASS（瀏覽器viewport；非實機） |

32項runtime規則／儲存／圖片測試通過。第一次完整遊戲檔28 passed、0 skipped（原19＋新9）；最後加入PT-R1與PT-U1補強後，派對子集10 passed、0 skipped。這是29個不同瀏覽器案例的聯集，不冒充最後重新跑29項全檔；最新改動只在派對controller／樣式／相應案例，原玩法與共用分享未再變更。型別與build在最後瀏覽器執行前通過。完整輸出、trace、截圖、prototype觀察與原始素材在E槽本輪evidence。

本輪沒有真人受試者。自動化證明三款操作會改變真實本局並到達可分享結算；開發者只判讀角色輪廓／圖層與控制幾何。決策CONTINUE：以三款完整短局提交，真人趣味、重玩及實機效能維持EXTERNAL_PENDING，不從本機分數推定留存。

### PT-LIGHT 第一批候選（2026-11-06，未部署）

假日保衛戰新增真正不依賴 WebGL 的六格 DOM／原創 SVG 玩法。載入中、載入失敗或 context loss 都可明選「改用輕量玩法」；不自動跳過失敗或替玩家計時。沿用同一 `PartyRun`、seed、elapsed、pressed、round、分數與20波規則，按開始／繼續後才推進。六格文字、葉子、帽子與領帶一起辨識，不只用顏色。辦公椅與豆腐本批**尚未有可玩輕量備援**，只保留同局暫停、重建3D及返回，介面明示限制。

共用載入 owner 綁定 import、15秒期限、首次 draw、context loss 及 dispose。取消、重試、選輕量版或離頁後，舊 import 不建立場景，舊失敗不能覆蓋新局；首次 draw 拋錯也釋放自己的場景。失敗、重試、blur、hidden、卡頓皆保留 domain 並停止時鐘，重建成功不自動繼續。

兩種畫面的六格操作共用 down-time round：pointer、Space、Enter 跨波放開不命中新目標。Space／Enter 由按下記錄、放開提交，repeat 不生成新操作；取消／失焦／lost capture 拒絕舊輸入。沒有前置 down 的輔助科技 click 仍可用。原生window capture先取消Escape的持有輸入；無重來確認時放行外層退出，有確認時先消耗該鍵取消確認並回焦點，下一次Escape才退出全視窗，不改共用Fullscreen。重來確認先聚焦「確定重來」，取消或 Escape 回到「重新開始」。輕量格不播放裝飾動畫，減少動態不改判定窗口。

輕量成果是**本局紀錄 SVG 成果卡，不是3D截圖**，只接受 done run，記錄真實分數、搶救數、誤選數、最長連擊、elapsed與seed。可直接下載SVG，完全不需要WebGL／Canvas2D；既有Result分享仍可將同一張SVG轉成PNG，轉檔失敗沿原重試提示，不捏造成功或代發。沒有換Logo資產、API、排行榜或貢獻值。

驗證界線：本 worktree 沒有 node_modules，且不可安裝或借用依賴；typecheck、build、完整runtime與瀏覽器均 `not_run`。新增純邏輯測試可用 Node 24 對 production helper/domain 執行；其實跑結果隨交付列明，不當作React、原生瀏覽器、PNG解碼或真人美術驗收。新增瀏覽器案例待正常已備妥依賴的受控runner執行：WebGL確實不可用仍完整20波5100分／SVG與PNG，context loss同局接續／重試、跨波pointer與兩鍵、AT、全視窗Escape同波取消、取消焦點與卸載。手機320、橫向／200%文字、Safari及真人趣味仍需實機／視覺確認。

本地實跑：Node 24 讀取上述 production pure modules，從既有runtime檔抽取原樣 PT-LIGHT-PURE 區塊（不是改寫規則的替身），新增6案加原派對7案，同輪13/13通過、0 skipped；首次本地loader不解析絕對`.js`來源而未載入測試，補正只做本機TS路徑解析後通過。四個非TSX變更檔以Node內建type stripping驗語法，並非型別檢查。`module-check`通過但保留主線三項`surface_unmapped`警告（GuildMemberCard、hosted-store-read-error、social-achievements-state），`git diff --check`通過。實際React controller非native案亦因esbuild不存在而`not_run`，不計入13案。

### PT-LIGHT CI Escape修正（2026-11-06，候選未重跑瀏覽器）

Verify 42182160341／job127774498252 的真實trace、error-context與截圖顯示：持有Space→Escape→放開已通過退出與0分驗證；重來確認的Escape後，確認列消失、重新開始回焦點、暫停與120分保留，仍在全視窗。artifact13488462863的ZIP SHA256為cd958981b0e93792078ead12b4bae886cdda96c44cb87b08669720030ef4a23e。原測試把取消內層與退出外層當成同一鍵；window capture先卸載確認按鈕，也不能當可靠的React傳播契約。

本修正只在重來確認開啟時明確消耗Escape，普通持有取消仍不阻擋Fullscreen。E2E保留原取消／焦點／分數／退出斷言，拆成先取消內層、再退出外層，補暫停與elapsed不變；沒有加timeout、retry或改分數。新增直接執行production callback的純測試，驗兩種傳播與同局保留；這不是React事件送達證據。本地純測試14/14、0 skip；typecheck、build、完整runtime／React及瀏覽器仍not_run，待新來源CI。另一個event-member-journey的Route失敗屬別scope，本批未改。

### PT-ACTION-LIGHT 重建候選（2026-11-06，未發布／未部署）

以已發布 #1292 的 `324f0f0e9328a8a328d883cbcac4dcd3d20ae63d` 為新獨立 checkout 基底，重新實作辦公椅與豆腐輕量玩法。先前遺失候選的程式與測試證據不沿用。三款都能在載入中、失敗或 context loss 後明選輕量版；同一 PartyRun 保留並暫停，只有本人開始／繼續才計時。重試3D沿同一有界 loader owner，不另建 domain、套件、API、分數或存檔。

辦公椅 SVG 讀實際 x，不以目標 lane 瞬移；顯示真 seed 波次、2800ms horizon、1250ms間距與850ms跳躍。會議桌須換路，推車可跳，葉票與道具以形狀區別。豆腐以真 layers 的 x/z/width/depth 畫三面，移動塊讀 current axis/position，落下凍結 fall.from，綠虛線標示 fall.kept，460ms後才用 domain 新層；.12完美與裁切規則不變。減少動態不停止必要移動、跳躍或落下。

原生與輕量按鈕共用持有輸入規則：Chair resolved 波次／Tofu turn 在按下記錄，跨波／跨落地放開不操作新波；重複、blur、pointer cancel、lost capture、Escape、重試及卸載取消。AT無前置down的click仍可操作，新down可恢復disabled節點吞掉release的情況。場景手勢亦綁原波／turn。沿#1292確認層先消耗Escape並回焦、下一鍵才退出全視窗；不修改共用Fullscreen。

兩款新增done-only本局SVG，豆腐直接畫每一個真實完成層，辦公椅只報總票數、碰撞、波次、心數與連擊，明說未保存逐波路線，不捏造歷史或3D截圖。既有Result收到同張成果，保留PNG轉檔與重試流程。原Logo與素材、renderer、domain/catalog、分享發布權限都未改動。

新本機驗證：Node24以內建TS stripping及只解本checkout相對TS來源的loader，抽取runtime檔原樣pure區塊與既有7條domain案例，22/22通過，0失敗／skip。新增8條涵蓋真投影／幾何、完成4280／2925、成果polygon界線、production按鈕與場景handlers、stop/retry/fallback及必要RAF時序；保留原7條holiday/loader/Escape pure案例。首輪21/22，真SVG底座超出保留區2px，修正production transform後原界線斷言通過，不放寬斷言。

沒有node_modules，且未安裝、借用依賴或換cache。typecheck、build、完整runtime／React harness、瀏覽器均 `not_run`；新瀏覽器來源不是已跑證據。待原環境正常runner驗WebGL完全不可用時兩款全局、同局重試／取消焦點／卸載、按住跨波與跨落地、全視窗Escape、reduced motion與SVG/PNG。豆腐測試在暫停clock先啟動game RAF、再讀同timestamp probe並對照原domain，避免以30fps SVG舊render猜完美窗口。手機／橫式／200%文字、Safari、真人美術與趣味仍未驗收。#1292尚未合main時不宣稱獨立發布前提成立。

### PT-ACTION-LIGHT 移植目前 main（2026-11-06，未部署）

#1292 已隨 #1286 合入 `eb1c8ecf982cf0d8595238082c8c52d1770a29a6`，本候選從該 main 建立獨立分支，移植完成保存的 `0556f6d` 七檔 patch，沒有使用遺失或受拒的舊物件。main 的派對 production 與 #1292 相同；保留整合後共用測試所有新增內容及 Fullscreen 的 result share／native modal Escape 契約。runtime 只去除候選重複的 `stripTypeScriptTypes` import，沿用 main 已存在的 import。反向移除候選 patch 後，兩份共用測試的完整 bytes 都等於此 main，沒有整檔覆蓋。

此新 main worktree 重新執行 production pure／controller 區塊：22/22 通過、0失敗／skip，不以先前候選結果代替。Node內建TS stripping僅確認三個非TSX變更檔語法，不是型別檢查。`module-check`、`git diff --check` 通過；module-check 保留 main 三項 surface_unmapped 警告。根與精確7 paths context 已重新取得，變更規則全文讀取，未變內容與先前實讀原文完整比對；完成檢查只代表本機規則齊備。aggregate verify exit 2／unavailable：descriptors與producer preview bytes通過，runtime因無測試DB、UI因adapter unavailable、surface coverage因registration behavior audit required而not_run，沒有縮小原gate。

依賴不存在且禁止安裝／借用；typecheck、build、完整runtime、React與瀏覽器仍not_run，待本次 draft 的自然CI。舊章節的未發布、未合main及測試紀錄保留為當時歷史，不代表目前 main 或新候選已通過完整驗收。真人美術／趣味、實機與Safari仍未驗，沒有 merge或部署。
