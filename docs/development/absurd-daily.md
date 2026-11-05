# 自由工坊・離譜日常 — AD-1

使用者已授權將既有企劃實作並提交 PR；2026-10-23 追加「直接分享到平台」。目標是三款原創短局 3D 網頁遊戲，手機單指、電腦滑鼠／鍵盤皆可完成開始、挑戰、結算、重玩、成果輸出與站內發文預覽。沿用 React，3D 使用精確固定的 Three.js 0.186.1。不是正式競賽、信任分數、現金或 XP；不要求相機權限。

## AD-2 權威狀態與題目

`domain.ts` 是遊戲規則、seed、目標、牌序與結果的唯一來源；renderer 只投影同一個 pose。seed 為 1..4294967295 整數，無效回到固定安全預設。可分享 game+seed 的「同題挑戰」，不能把未上傳的個人成果說成公開結果頁。每次操作帶目前題目 index，過期 pointer、重入及結束後操作都拒絕。注入經前景累計的毫秒時鐘，hidden/blur 主動暫停並清掉 pointer；回來由本人繼續，背景時間不計入。

## AD-3 這張能交嗎？

固定三位客人：搶鏡背景板、雨傘電梯、三隻鴿子一件風衣。每位 12,000 ms、兩張底片，全局至多六張。按快門立即渲染並保留實際畫面；時間和取景影響完成度。任務目標從當時真實世界座標投影得到，不以按鈕次數評分。沒有按快門就沒有照片，不編造作品。可提早進下一位；最後挑選自己的照片。趣事文案描述照片與事件，不是人格／能力評分。

## AD-4 蓋完就下班

先一張不計時練習；完成後十二張正式紙。target 固定在每張紙上，拖曳／點選後放手落印，也提供方向鍵及蓋章按鈕。命中半徑 0.24（手機實際畫面試玩後擴大，讓單指落印更穩定）（紙張歸一化座標）、重入冷卻 220 ms。未命中留下墨跡並增加多蓋次數，不前進；第十二次正確落印立刻停止計時。每張至多保留 24 個墨跡。文件逐漸荒謬，最後確實結束，不用虛假剩餘數。紙堆手風琴、小螃蟹、倒下的印章是投影，不改命中規則。

## AD-5 這疊有一百萬？

10 張一萬、10 張五萬、4 張十萬，合計 24 張有效道具鈔；另有六張票券，總共三十張。最後一張固定十萬，其餘依 seed 洗牌。右收道具鈔，左退票券，方向鍵／按鈕／48 CSS px 滑動等價。分類錯誤彈回，金額、index 不變；結算精確一百萬。所有畫面明示遊戲道具，不宣稱付款／收益。

## AD-6 呈現、載入與生命週期

依 2026-10-23 使用者修正，遊戲採獨立怪奇黏土玩具美術（奶油紙、珊瑚紅、紫色攝影棚與青綠桌面），不強制沿用平台配色。保留原始品牌圖比例，語意文字 >=14 CSS px、表單 >=16、觸控 >=44 且留間距。桌面、320x568、390x844、667x375 橫向、平板均不橫溢。場景 4:3 完整呈現；照片和成果圖 contain，不裁頭。Three/renderer 僅在進入遊戲後載入；像素比上限 1.5，共用幾何及材質，無外部貼圖、字型、追蹤或模型請求。程序模型為原創；模型含曲面、衣領、鈕扣、縫線、眼睛、鏡片及動作，而非方塊替身。靜音預設，聲音僅本人開啟後於操作觸發；reduced-motion 移除閃光、晃動及無關動畫。離頁清 RAF、observer、listener、pointer、WebAudio、幾何、材質、貼圖及 renderer。WebGL 失敗可見且可重試；不可留無期限載入。

## AD-7 成果與站內發文

成果包含真正照片／該局完成紙或票券、客觀統計、趣味文案與 seed。可下載 PNG、系統分享檔案／連結、複製同題連結。share AbortError 不當成失敗、不偷偷下載或發文；其他失敗提供可操作備援。預先生成分享檔避免丟失手機 user activation。本站橫式成果圖把完整畫面 contain 在 1200x675 內，以適配現有貼文縮圖。

「發到自由工坊」只儲存有界的本機待發成果並導向既有登入與發文流程。登入／入會後接回原圖和文案，不能覆寫現有草稿；若已有草稿，由本人選擇是否帶入。預覽必須顯示目前作者，按既有發布才建立貼文；不能直接啟動外部自動發文。待發資料 v1、24 小時、圖片 <=1.2 MB，拒絕未來／畸形資料；讀取不寫入。儲存失敗留在結果頁可重試或下載，不能假稱已保存。公開連結不帶圖片、會員身分或憑證。沒有伺服器排行榜或獎勵。

## AD-8 驗收

規則測試：多 seed 牌數／金額、固定最後牌、方向錯誤不變、過期操作／重入、印章邊界、照片上限和投影、時鐘暫停／恢復、結果資料損毀／過期／quota、分享取消。TypeScript、production build、平台 module/context/inventory 檢查。實際 Three renderer 的手機／桌面截圖及鍵盤／pointer 完整三局、分享檔／剪貼簿失敗、站內帶圖預覽與登入接續。記錄實跑，不將 AI 自測稱為真人喜好、實機效能或分享率證據。真人趣味評估與 iPhone/Android 真機為 EXTERNAL_PENDING。

### AD-6 回復反例（PR #986 審查修正）

- 執行中的 renderer 拋錯與 WebGL context loss 都進入同一個暫停狀態；保留本局資料、停止計時與操作，重建場景後必須本人按「繼續這一局」。回復後時鐘及分類冷卻必須再次前進，不能只有畫面恢復。
- Stage factory 在回傳前任何初始化步驟失敗，也必須移除 canvas 並釋放已取得的 renderer、環境、材質及觀察器；重試不得堆疊 canvas 或殘留 WebGL context。
- 反射環境沿用同一 RoomEnvironment，但 PMREM 明確限制為 64px（原預設 256px），降低首次光影計算；不改遊戲規則、角色模型或手機解析度。使用目前 Three 的 PCFShadowMap，避免已移除常數的相容警告。此調整不代表實機 FPS 已驗收。
- 沿用發文工具既有樣式的初始載入要求；分開遊戲與會員 JavaScript 不得讓 optimizer CSS 變成延遲下載依賴。這項以既有建置測試核對，不刪減原斷言。
- 入口先完成動態 import 再掛載頁面，避免初始 Suspense reveal 的計時器阻塞已暫停時鐘的登入旅程；沿用既有兩個聊天 polling 案例驗回，不修改其時鐘或等待條件。
- 站內分享的瀏覽器案例須在 finally 關閉自己的頁面並刪除自己的唯一測試貼文，避免後續測試帳號的已讀外鍵使聊天室清理失敗。不能擴大刪除範圍或放寬聊天室斷言。
- CI 失敗須讀實際 trace／error context 並記錄原因；完整必要 checks 與最新 head 的獨立審查仍為合併前置，不能用本機通過代替。


## AD-9 美術來源與最新修正

使用者於 2026-10-23 明確指出原模型與畫面缺乏吸引力，並允許遊戲不沿用社群配色。本輪重做為原創怪奇黏土玩具攝影棚：大鼻子西裝客人、會搶鏡的表情背景板、粉紅雨傘與三隻風衣鴿子，搭配拱門、方格地面、柔光燈、植物、角色陰影及環境反射。桌面使用青綠、奶油紙與珊瑚色印章；道具鈔有原創鴿子肖像及六種假票券。主頁卡圖由同一 Three renderer 的真實場景產生，沒有將概念圖當可玩畫面。

原創幾何與 Canvas 紋理由本 PR 的 stage.ts 產生；不需要外部圖片、字型、模型服務或 API key。Three.js 與內建 addon 為 MIT，版本固定在 package-lock；原平台 Logo 保留原圖與比例。所有遊戲樣式限縮在 ad-root 內，站內發文器沿用既有平台樣式與權限。

素材入口：[攝影棚](../../apps/portal-web/public/games/absurd-daily/photo.jpg)、[蓋章桌面](../../apps/portal-web/public/games/absurd-daily/stamp.jpg)、[道具鈔](../../apps/portal-web/public/games/absurd-daily/cash.jpg)。這三張為卡圖，遊戲本身仍即時渲染；成果則保存該局真正的畫面。

## AD-10 發文責任與回復

- 公開入口 `/play` 可免登入玩；首頁遊戲入口另開分頁，保留原分頁編輯中的工作。
- 「發到自由工坊」保存於同分頁 sessionStorage，導到既有登入／入會入口。登入完成後 SocialZone 接回圖片及可改文案，顯示目前會員。若原草稿已有文字，需本人按帶入；已有圖片或超長文字時拒絕覆寫。
- 只有本人按既有「發布貼文」才呼叫原 API。伺服器既有權限、圖片處理、CSRF 與冪等仍負責正式發布。結果不作 XP、收益、信任度或排名證明。
- 取消發文保留草稿。未知網路結果沿用原 idempotency key；收到成功並核對當前 session 後，才清除相符的本機交接。讀取、解析失敗不冒充已保存。瀏覽器禁用儲存時停在成果頁，提供重試與下載。
- 系統分享取消不發文、不自動下載；無分享／剪貼簿權限時顯示可選取連結及下載。連結只含 game + seed，個人成果必須另附圖片或經確認發布到平台。
- 同分頁保存不是跨裝置雲端草稿。關閉分頁、超過 24 小時或清除瀏覽器資料後，應使用先前下載的圖片；不宣稱已上傳。

## AD-11 驗證記錄

規則、平台型別／建置、模組與瀏覽器實跑結果於 PR 記錄。實際執行結果與未驗部分分開列示；不將原型工具鏈的通過稱為平台 CI 通過。真人美術偏好、遊戲趣味／留存，以及 iPhone／Android 真機效能仍須實際驗收。沒有合併、部署、開啟營運旗標或接觸正式會員資料。


### 本機已取得的證據（2026-10-23）

- Node 24：平台 `npm run typecheck`、標準 `npm run build` 成功。保留 Vite 對 3D chunk 超過 500 kB 的提示；不調高警戒值掩蓋。3D 場景為獨立動態 chunk，約 143 kB gzip；公開遊戲選單實際網路紀錄沒有載入 stage／Three。
- `node --import tsx --test tests/runtime/absurd-daily.test.ts`：11 / 11，零 skip，含單調時間避免排隊 render 時間倒退。
- 獨立原型的真實 Chromium/Three 全三局：照片與底片上限、完整 960×1200 PNG、12 份文件、精確一百萬、取消分享、剪貼簿拒絕、quota 回復與待發交接均通過。這一筆不取代平台登入與正式發文旅程。
- 平台 production bundle 實際 Chromium 像素截圖：390 手機及 1440 桌面、三款場景、零 pageerror、無橫向溢出。固定攝影棚合批並共用後，觀察到約 210 次渲染呼叫（原約 268）；屬軟體瀏覽器的結構量測，不是實機 FPS 承諾。
- `module-check` 通過的是 descriptor／source ownership；不冒充整站授權與行為驗證。來源 inventory 另以既有邊界與 POSIX path serialization 計算並核對，非原生 verifier／CI verdict。
- 平台整合瀏覽器旅程另列在 `tests/e2e/absurd-daily.spec.ts`。完整啟動測試資料庫未在初次 180 秒預算內完成；本機延長啟動預算後繼續驗證，不更改 CI 或刪掉必要案例。最終結果記於 PR。

### PR #986 審查後回歸（2026-10-23）

舊 head `5432561f` 的 Verify 39835211178 失敗，獨立審查要求修正執行中 renderer 例外的暫停狀態。已讀原 CI 的 browser trace／error context 與 partition 6 receipt，未將失敗歸類為機器波動：

- 3D 檔案請求皆成功，但首次建立光影環境阻塞到五秒 ready 斷言之後；限制 PMREM 尺寸並改用目前的陰影常數，保留原五秒斷言。
- 初始 lazy/Suspense 入口讓兩個暫停虛擬時鐘的既有登入案例停在 loading；改由入口 import 完成後掛載。
- partition 6 失敗的是既有 optimizer CSS 初始圖譜斷言，已恢復 eager stylesheet；原案例未修改。
- 新分享案例留下貼文，後續 synthetic chat 帳號讀取後使清理卡在已讀外鍵，進而累積貼圖；只清理本案例自己的貼文，聊天原案例未修改。

整合 main `c140a346` 後，本輪 Node 24 型別／標準建置、11 個遊戲規則加 5 個既有文字歷史／樣式規則全部通過。以同一隔離 schema 依序跑遊戲 8 個、兩個 polling 案例、聊天搜尋、貼圖與未知圖片發布等共 **29 個瀏覽器案例，29 passed、0 skipped（4.9 分鐘）**。新增的兩個故障注入分別驗真正 render 呼叫拋錯後保留進度並恢復冷卻，以及 factory 回傳前失敗後 canvas 為零、舊 WebGL context 已釋放、重試只有一個 canvas。這是本機結果；新 head 的完整 CI、獨立重新審查與實機／真人驗收仍各自成立。


## 2026-10-25：料理與分類大廳擴充

原三款玩法保留。新 [COOKING 規格](../../modules/absurd-daily/COOKING.md) 定義 64 道料理、八類、九種操作、收藏／最近一盤本機保存與原成果分享接續。最新插畫方向覆蓋本文原黏土材質描述；原3D改為無反光toon材質，移除PMREM環境生成，保留原640×480邏輯尺寸、DPR上限及實際投影評分。

[素材清單](../../modules/absurd-daily/cooking-art.json) 記錄內建image_gen的完整提示、來源SHA256、WebP雜湊、尺寸及frame。原始PNG與迭代圖保存在E槽；網站只取用8張WebP（總計1,718,994 bytes）。沒有複製Cooking Mama角色、商標或素材。實際手機／平板／桌面瀏覽器證據與本批測試結果見PR；CI、真人美術與實機驗收分開記錄。

### Playroom重設與本機證據（2026-10-25）

使用者要求大廳全面重新設計後，改為桌面側邊分類、手機四格入口，推薦遊戲、料理手帳與獨立收藏操作；8道逐批顯示。大字時減少卡片欄數，分類列可滑動，開始／收藏hit區分開。實際瀏覽器截圖見[桌面](../../modules/absurd-daily/review/playroom-desktop.png)及[手機](../../modules/absurd-daily/review/playroom-phone.png)。

- Node24純規則／儲存／圖集完整性：23 passed，0 skipped。64道均從start實際驅動9種domain操作到result，另驗原三款、壞資料、備份、quota與社群URL編碼。
- 平台production build後的完整遊戲瀏覽器檔：19 passed，0 skipped（2.2分鐘）。包含舊8案例、4道真實pointer／鍵盤旅程覆蓋9種操作、登入接回成果、社群入口／native payload、保留未完成進度、放大文字owner bounds、Playroom類型與分頁／收藏hit區。
- 320×568、390×844、667×375、768×1024、1440×900，100／125／200% DOM文字壓力：大廳與開始／暫停共46張實際截圖；成果分享另15張。自動幾何檢查未見document橫向溢出、44px以下按鈕或pageerror；可滑動分類列另屬自己的scroll owner。這不是OS字體縮放或實機測試，也不是人類美感簽核。
- 標準型別與build成功；保留Three chunk超過500kB提示，未放寬警戒值。Three僅進原三款才載入；大廳初次網路紀錄只有一張料理atlas，沒有stage／Three。8張atlas合計約1.64MiB，按分類載入。
- 4×2圖集以實際alpha輪廓clip顯示，成果PNG仍為960×1200、站內圖1200×675；X／Threads入口帶文字與題目網址，Facebook只帶連結，IG由系統選單或下載／複製自行附圖。目的平台登入／發布與真實iOS／Android分享仍EXTERNAL_PENDING。
- 所有開發／暫存／圖片原稿／瀏覽器證據保存在E槽。沒有資料庫migration、會員獎勵、貢獻值變更、merge或deploy。新head完整CI與獨立審查仍由既有流程負責。

## 2026-10-25：日常派對三款原創3D小遊戲

料理與大廳已獨立提交 #1050（`bc211f72`）。本批接續 [PARTY 規格](../../modules/absurd-daily/PARTY.md)，不再往料理PR加內容。三種真實操作：辦公椅換路／跳推車、豆腐落點／區間交集裁切、六格蒸籠raycast／休假與開會辨識。目錄合計70款，仍為四個分類入口。

類型參考限於可切換的小玩法與容易理解的控制；參閱 [Nintendo官方介紹](https://www.nintendo.com/us/store/products/super-mario-party-jamboree-switch/)。本批的人物、模型、配色、題目與文案由本專案實作，沒有引入該遊戲的角色、商標、音樂、關卡或UI素材。這是單人短局和同seed輪流挑戰，不宣稱即時多人。

- 純domain持有elapsed、碰撞、層數、combo與score；renderer只投影。前景第一幀不計時，blur／hidden／過長卡頓暫停；本人繼續，不補算背景。音效預設關閉，減少動態不變更判定窗口。
- 控制與文字各自擁有正常文件流；開始後移到遊戲區，手機橫向把場景與操作放並排。觸控、鍵盤、可見大按鈕同步，角色有葉子／領帶和文字提示，不只靠顏色。
- [素材收據](../../modules/absurd-daily/party-art.json)綁定實際Three renderer來源SHA與3張640×480 WebP，總46,506 bytes。縮圖由本機production build實際場景擷取；不是概念圖或另一款遊戲的截圖。原始PNG與瀏覽器證據在E槽。
- 三款樣本時刻的 draw calls／triangles 分別143／67,840、56／24,424、186／84,508；這是桌面Chromium軟體WebGL的結構量測，非最高負載或實機FPS。模型、材質、圖像與粒子數量有界，每次卸載釋放自有context。大廳使用靜態縮圖，進場才載入Three。
- 原Result／社群Logo選擇、系統分享、下載、同題連結與v1同分頁草稿沿用；僅加入新game whitelist。舊3款／kitchen保持相容。站內仍進登入與可編輯預覽，由本人發布，沒有社群API串接或自動發文。
- 32項純規則／存取／圖像完整性測試實跑通過、0 skipped；涵蓋全22波逃亡、12層豆腐、20波假日、失敗／非法時間與舊結果解析。標準typecheck與build通過，原Three大chunk提示保留。

### 本輪觀察與待驗

首輪派對瀏覽器子集5 passed／1 failed，原始trace、截圖與錯誤輸出保留。逃亡取得3680分／19票／0碰撞，與滿分4280的fixture預期不符；獨立重現確認第一個150ms虛擬等待只形成128ms遊戲前景時間，未達130ms換路冷卻。修正fixture以實際前景時間與路線斷言驅動，沒有降低分數要求、改冷卻或改碰撞規則。

同輪豆腐在實際瀏覽器完成12層、2925分；假日以raycast／鍵盤完成20波、5100分並接回登入後發文預覽；blur、真正WebGL context loss、重建與重新開始選擇均通過。放大文字owner和載入失敗返回也已通過。後續完整回歸與截圖矩陣的最終結果追加於下方及PR，不把前輪失敗改成PASS。

本輪屬自動化可玩鏈和開發者畫面檢視；真人第一眼理解、趣味／重玩、真實手機／Safari、登入社群App與實際發布仍EXTERNAL_PENDING。迭代決策CONTINUE：保留三款完整短局，交付可審查PR，讓真人試玩後再調難度／笑點；不因編譯成功宣稱好玩。沒有資料庫migration、真實報酬、信任值、merge或deploy。

最終本機回歸：完整遊戲檔 **28 passed／0 skipped（5.8分鐘）**。之後補上UI動作的繪圖拋錯恢復、缺圖大字owner，再build並跑派對子集 **10 passed／0 skipped（3.9分鐘）**；包含原分數保留與重建繼續。兩次聯集為29種不同案例，沒有宣稱最後重跑29項全檔。最後型別／build均通過；32項純規則仍與本次domain／素材一致。完整pitfall記於PARTY PT-8，不覆寫首輪失敗。

最後production build的畫面矩陣共 **59張、0幾何失敗**：5種viewport（320×568／390×844／667×375／768×1024／1440×900）×3種DOM文字比例×3款ready，加手機直／橫向playing／paused與兩張大廳。檢查document overflow、按鈕44px、owner bounds及pageerror；200%可增加文件高度，不宣稱全部內容同屏。冷大廳的資源紀錄另核對實際emitted Three引擎chunk的hash，未載入引擎或PartyGame／stage。可審查原始像素見[桌面派對目錄](../../modules/absurd-daily/review/party-lobby-desktop.png)與[手機操作](../../modules/absurd-daily/review/party-phone.png)；其餘PNG、geometry及資源記錄保留E槽。

## 2026-10-25：全遊戲操作與渲染修整

接續 #1051 `de4fa06ca`，以 [PLAYABILITY 規格](../../modules/absurd-daily/PLAYABILITY.md) UX-1..6 獨立交付。70個入口共用原位置返回／焦點恢復、同題再玩與下一道／下一玩法。64料理沿9種原domain操作增加明確時機、具體失手提示與pointer／keyboard owner；重新做確認先暫停保存。沒有改舊checkpoint格式、規則分數或平台貢獻。

6款3D只合批rigid群組，保留動態子物件、照片anchors、raycast與陰影；蒸籠proxy移到只供raycaster的layer。相同1440×900／seed42／1000ms樣本的draw calls：photo 211→80、stamp96→70、cash92→64、chair141→87、tofu56→52、holiday186→86。診斷DOM mutations分別186→3、186→3、186→3、558→68、558→122、558→63。這是Chromium SwiftShader的同時刻結構量測，不是峰值或手機FPS；合批增加有界geometry，不宣稱GPU記憶體下降。texture數不增加；新geometry與原context一起釋放。原始before／after JSON與實際PNG在E槽。

程序預覽隨本次renderer重新擷取，3張640×480 WebP共49,872 bytes；party-art除renderer外追加合批helper／domain／catalog的來源hash。此數字是更新後的圖像體積，前節46,506仍為 #1051 的歷史證據。料理插畫8張atlas保持原樣，沒引入另一套引擎或素材框架。真人美術、趣味／留存與實機仍EXTERNAL_PENDING；最終回歸與畫面結果隨本批PR記錄。

### 使用者否決後：玩具料理台與遊戲機介面

上述49,872 bytes與效能表是本批前段優化版本；使用者隨後否決美術、直覺性與好玩程度，並提供 [Threads參考](https://www.threads.com/@min61min41min81/post/De1IzELFK6H)。本機實際取得公開OG封面，觀察料理台、工具、圖示食材與三段火力的層次；完整影片未取得。參考圖只存E槽研究，未複製為產品素材。

[PLAYABILITY UX-7](../../modules/absurd-daily/PLAYABILITY.md#ux-7-使用者否決後的完整遊戲介面重做先規格後實作)先規格再實作。64道／9種操作現在使用原創程序鍋具、木板、烤箱、麵糰與貓掌手套；保留原插畫完成菜。單句動作提示、主場景與工具盤取代長表單，詳細食譜／鍵盤在可展開區。翻面、撈泡沫與出爐能直接點場景；所有輸入仍走既有domain，沒有改分數、保存格式、會員貢獻或自動發文。

大廳先呈現可玩的項目，料理推薦只在料理分類。6款3D與成果頁共用新的玩具配色／控制層次；推車／會議桌有跳／躲標示，蒸籠角色有休假／開會標示，豆腐落點輪廓使用目前權威位置。三張真實派對縮圖重新擷取為53,318 bytes，綁定新renderer來源hash。

Three仍為既有引擎，料理新增10.64KB／gzip4.62KB的延後場景程式；共享引擎539.51KB／gzip134.57KB。料理第一次進場會增加引擎載入，大廳不載入；不把新增立體畫面稱作全站減重。640×448、DPR≤1.5、512陰影、15秒期限；初始佈景未就緒不能開始，失敗自動用可操作插畫，同一盤仍保留。每幀讀取本局run以維持道具跟手，文字刷新頻率不限制動畫。ready／paused／完成不持續跑場景RAF，卸載釋放context。

## 2026-10-25最新交付：夜市自由料理與全3D成品

此節是本批最後的產品範圍；前文64道、插畫atlas與玩具台的數字是各歷史階段，不代表目前接受基線。使用者再次否決美術後，以[PLAYABILITY UX-8..10](../../modules/absurd-daily/PLAYABILITY.md)追加明確規格。

### 玩什麼

- **酥炸熱狗**：拿熱狗、裹麵糊、控油溫、逐支選取翻面、起鍋瀝油、拖曳擠醬。正反面熟度與瀝油毫秒真正影響本局結果。
- **招牌沙威瑪**：鋪餅皮、旋轉烤柱削肉、加生菜／番茄、畫醬線、三折包捲。有限烤肉、實際餡料與薄麵皮開口呈現在成品。
- **炒飯／牛排**：自由配料、火力、翻炒／逐片翻面。允許大份量、灑出與燒焦；四維評分、份量與短句依實際run產生，沒有平台獎勵。
- 以上4道預設自由模式；`practice=1`保留原引導操作。其餘62道沿原9種操作，合計66道／8類；另有6款既有3D短局，大廳共72個入口。最佳紀錄仍是本機遊戲紀錄。

### 看得到的改變

本批實際讀取參考網站送至瀏覽器的[漢堡排成品](https://piko2game.com/hamburg/plate3d.js?v=13)、[章魚燒](https://piko2game.com/takoyaki/app.js?v=57)與[可麗餅](https://piko2game.com/crepe/crepe.js?v=49)前端。確認其Three.js、自訂食材紋理、局部熟色／roughness、變形麵皮與厚醬線；沒有複製原始碼或資產。完整玩法未逐一實際遊玩，不宣稱逆向還原整個系統。

產品以本倉原創256px有界程序紋理與有機幾何重做：不規則立體牛排、酥皮、開口薄餅皮／可見餡料、啞光飯丘，暖主光、冷補光與近距離透視。陶器與木器各自使用材質，避免盤子也出現烤斑。native成品預覽取代舊8張插畫atlas；大廳只載WebP，進場／成果才載Three。真正成果viewer使用本局份量／醬線，拖曳旋轉、雙指或按鈕縮放，不重新計分。下載／站內／各社群交接仍由本人確認。

### 可靠性與成本

自由模式獨立純domain／版本1本分頁保存，最多16份食材、8條32點醬線、300秒前景時間。未知／過期資料拒絕，恢復預設暫停，失焦／背景不烹調；storage失敗仍可玩並重試保存。15秒載入期限、晚到拒絕、真實context loss保留同盤。所有自有3D資源隨場景釋放。陰影最多1024，DPR≤1.5。沒有API、DB migration、新引擎、真實付款、平台分數或自動發文。

本次型別／build、40項純規則／保存／素材完整性已跑；最新瀏覽器與像素矩陣結果在下方追加，不能用前階段41／14項代替此輪。瀏覽器渲染是Chromium SwiftShader證據；真人美術是否喜歡、趣味／重玩與實機Safari／Android效能仍EXTERNAL_PENDING。

### UX-11：實際拆解參考，停止把功能測試當美術驗收

使用者再次否決UX-10並提供[Claude作品](https://claude.ai/artifact/WNtp2iZo5yJyZr81iSA9W9)。2026-10-25以公開瀏覽器開啟，主頁顯示Page not found，作品frame請求403；沒有取得模型，不能判斷它的網格、材質或生成工具，已請使用者補截圖或匯出檔。`fried-rice.vercel.app`目前開到另一份錄音工具，也不當成截圖中炒飯的技術證據。

本次可驗的參考是piko2game的公開前端與實際瀏覽器：啟動章魚燒／可麗餅，漢堡排完成實際觸控切洋蔥、拖放材料到碗、揉拌到17%。沒有強制解鎖後續工序，沒有宣稱完整通關或真人覺得好玩。普通mouse操作曾未推進揉拌，改用真正CDP touch輸入後取得進度；這也是輸入種類要實驗的證據。原始畫面、DOM、來源與操作記錄保留E槽研究目錄，不把其程式、貼圖或截圖提交為本產品資產。

| 從公開前端核對的做法 | 本輪落地範圍 |
| --- | --- |
| [漢堡排成品](https://piko2game.com/hamburg/plate3d.js?v=13)有專用肉質／表面粗糙度、形狀與環境反射 | 原創環境柔光以既有Three的RoomEnvironment／PMREM生成，擁有自己的render target與釋放責任；不下載HDR |
| [章魚燒](https://piko2game.com/takoyaki/app.js?v=57)的食材與局部熟色有不同幾何／材質 | 炸熱狗改為專用封閉微不規則外皮、逐面熟色，色素／高度／粗糙度分離；不以大褐斑當大凹凸 |
| [可麗餅](https://piko2game.com/crepe/crepe.js?v=49)的麵皮與配料高度影響形變 | 炸熱狗醬線先由實際相機射線定位，再依同盤食物高度貼合；沒有宣稱已做可麗餅的空間厚度／折疊解算 |
| 畫面集中一道料理，工具和食物動作直接對應 | 炸熱狗全數起鍋後自動切紙托調味視角，點到哪一支就選取／翻那一支；保留鍵盤與可見按鈕 |

本批新增的是一份可近看、可操作的炸熱狗美術基準，以及共用材質／光照邊界；其他62道仍為原創有界程序成品，不宣稱它們已達參考精緻度或逐道美術通過。`PLAYABILITY`保留每次使用者否決與失敗歷史。新的原生像素放進PR供審閱，真人接受、美術喜好與實機手感仍待回饋；不會因測試數目變多就將它們改成PASS。


### UX-12：油亮高光，與白色閃點分開

使用者追加「都沒有亮晶晶的感覺」後，沿既有Three MeshPhysicalMaterial區分醬汁、炸油、炸衣、熟肉、米飯、陶瓷、紙托與木桌。醬汁／油膜／陶瓷有較低roughness與clearcoat；炸衣保留微表面及有限油亮，米飯更柔和，木紙維持粗糙。食物不添加glitter粒子，也不改本局熟度、分數、保存或分享內容。

環境圖加入兩張原創大面積柔光板，由現有RoomEnvironment／PMREM在各renderer內產生並釋放，不下載HDR。第一版實際截圖觀察到補光使炸衣偏白，已降低環境／補光並保留金黃基色。先build，再以實際production createDishStage取得四道×四個角度及炸熱狗旋轉短片；[截圖](../../modules/absurd-daily/review/native-corn-dog-20261025.png)／[短片](../../modules/absurd-daily/review/native-corn-dog-rotation-20261025.mp4)是本版素材，不是Claude或其他遊戲畫面。短片由本機canvas錄製轉MP4，保留在review而不進遊戲載入路徑。

原生四道樣本draw calls為21／31／17／17、最高88,348triangles／9個geometry，pageerror為0；保留DPR≤1.5、256px程序材質、1024陰影與無idle RAF。此為軟體WebGL結構證據，不是手機FPS或人類美術接受。其他62道同步採用相同器皿／食物材質分層，模型細節仍保留前述待驗界線。

### 本輪缺陷與回歸的實際界線

- UX-R2累積灑出重量：先重現「spilled food cannot return to the pan」，修正不減／不回增的上限，獨立domain7項通過。
- UX-P2引導台多兩張材質：先前21項子集20通過／1失敗，touch本身有到1/4，失敗為texture5>3；移除兩張額外圖，未放寬預算。UX-12首次build後的11項瀏覽器子集全部通過（3.1分鐘），包含原失敗、冷大廳、viewer旋轉／雙指／context釋放、4道實際料理成果、載入期限及炸熱狗觸控／調味。
- 該輪牛排實際成果截圖另暴露醬線固定高度懸空；UX-R3先加入原生網格bounds回歸，取得FAIL後改為最多256次向下定位當盤表面，曲線不會以其他醬線作為往上疊的目標。修正後該回歸PASS，run的JSON保持不變。
- UX-R3後最終來源的42項規則／保存／有界原生網格／素材hash回歸全部通過、0 skipped；標準typecheck與production build通過。更新後66張WebP合計699,078bytes、最高31draw calls／88,348triangles／10geometries、pageerror0，所有生成後context均已釋放。舊8張插畫atlas合計1,718,994bytes；這是靜態預覽傳輸體積變化，不是整站程式減重或手機FPS。

第一次11項使用隔離PostgreSQL schema，結束後0連線、schema／role清理完成。UX-R3後的受影響瀏覽器子集及完整畫面矩陣在下一段追加，不把前版11項直接算成最後來源全檔通過。
### UX-13：總分介面與分享同步

使用者在檢視實際牛排畫面後要求移除雷達／分項、只出分數。已將料理結果改成料理名稱、可旋轉成品及單一總分；刪除稱號、評語、星級與重複總分。引導料理的內層畫面不再另烙一次分數，完整分享PNG／文案統一由外層加實際總分；展開預覽改為真正的完整分享成品。

新分數頁以真正production頁面完成18張直向／橫向／桌面、100／125／200% DOM文字檢查，0幾何失敗／0 pageerror。這批使用合法完成run，另將顯示文字改為最大100分作排版壓力；收據保留原本算出的文字，100分示意不算實際贏得100分的遊玩證據。其後只修改大廳與派對的小字角色，未改該分數頁材質或元件。

前一份完整156張矩陣實際為108通過／48失敗：15個可見11–12px字體案例已修至14px；33個owner報告是helper誤量收合details內的不可見按鈕，實際PNG未顯示。修正helper的可見性判定並保留原物理owner規則，另觀察展開後按鈕。原始失敗JSON／PNG保留，後續只重跑失敗與受影響最大字體場景，不將前輪稱為全綠。

### 最後交付檢查（UX-13）

- 最終受影響瀏覽器子集 **7 passed／0 skipped（4.5分鐘）**：兩種引導料理分享旅程、4道自由料理真實操作→自己的總分→實際下載PNG／分享入口，以及炸熱狗真正touch選取、逐支翻面與同盤調味。總分與domain相同，頁面沒有雷達／分項／稱號，完整PNG已實際下載檢視。這是最後7項子集，不稱為全51項重跑。
- 其後僅補無3D備援原圖的一段重複數字，重新production build。實際公開頁刻意不載原生module，經按鈕加熱狗／上桌，當局26分；觀察canvas文字記錄，原圖0次分數、完整portrait恰1次分數、0 POST／0 pageerror。沒有注入分數或把示意100分算成遊玩結果。
- UX-V6的55張追查為52通過／3橫向提示字級失敗；以root＋真實父節點解決後，**9張針對性實際像素全部通過**，包含三個失敗與200%邊界。33個收合details誤判另以原生checkVisibility=false／非零bbox證據確認，展開後按鈕owner檢查通過。這些與前版156及18張分數頁分開記錄。
- 標準typecheck、build、**42項**規則／保存／素材回歸通過；source ownership 80模組、0issues／0unknown。Three>500kB提示保留。隔離DB的兩輪子集均清到0連線／0剩餘schema，沒有操作正式DB。

最終可審閱畫面：[總分頁](../../modules/absurd-daily/review/current-score-only-20261025.png)、[實際下載PNG](../../modules/absurd-daily/review/current-corn-dog-share-20261025.png)、[手機大廳](../../modules/absurd-daily/review/current-lobby-phone-20261025.png)、[桌面大廳](../../modules/absurd-daily/review/current-lobby-desktop-20261025.png)。原生亮澤截圖／影片見UX-12。畫面與操作檢查不替代真人美術／趣味接受或實機效能；本輪沒有merge或deploy。


### UX-14：牛排鐵盤與完整器皿結構

使用者否決UX-13畫面的白盤，明確指定牛排使用鐵盤。新版成品改為橢圓鑄鐵盤、凹入盛裝面、厚盤唇、真正鏤空耳把與倒角木托；單份牛排重新置中，配菜實際貼合盛裝面。其他平盤改成連續曲面的陶盤，具盤腹、細窄釉色盤沿、盤底與底足，取代疊圓柱／粗圓環。專用紙舟、碗杯依料理用途保留。完成料理台與可旋轉成品使用同一模型，下載與分享同步；無WebGL時的牛排備援也使用鐵盤／木托輪廓。

UX-V7首輪實際native發現木托穿入鐵盤，原圖保留E槽；修正旋轉後厚度方向，並以實際模型射線核對暴露的盛裝面是鑄鐵、耳把孔洞下方為木托、牛排底部接觸盛裝面。食物先落盤再投影醬線；所有成品與桌面也依真實模型底部對齊，避免浮空。分數仍只有總分，domain／保存／會員規則不變。

最終標準typecheck／production build通過，Three>500kB提醒保留。43項規則／保存／模型有限範圍／一次釋放／來源hash回歸通過，0 skipped。66張新版512×384 WebP總共657,556bytes，最高31draw calls／93,468triangles／10geometries，無pageerror、各context已釋放；這是本機軟體WebGL結構與資產證據，不能當實體手機FPS或美術接受。之前699,078bytes的UX-13版本保留其觀察時間。

原生器皿例圖：[牛排鐵盤](../../modules/absurd-daily/review/native-steak-iron-20261025.png)、[陶盤](../../modules/absurd-daily/review/native-ceramic-20261025.png)，兩者為目錄食材示例，不算玩家獲得的成績。實際完成旅程與下載證據另列在後。


UX-14最終受影響瀏覽器子集 **5 passed／0 skipped（2.4分鐘）**：四道自由料理由正常控制完成、同局總分、旋轉／縮放／回正、實際下載PNG與分享入口，以及熱狗真正touch選取／翻面／起鍋／擠醬。實際牛排另擷取390×844直向與667×375橫向；下載圖片及viewer均使用鐵盤，單一92分與domain相同。這五項與UX-13的七項、UX-12的十一項分開記錄，不稱全檔重跑。

無3D的公開實際按鈕旅程另通過：刻意不載原生module，加牛排／上桌，當局43分，備援為黑鐵盤／木托；原圖沒有分數，完整portrait只有一次分數，0 POST／0 pageerror。沒有注入成績。隔離測試schema結束後0連線、0剩餘schema，未接觸正式DB。

本輪實際旅程：[手機牛排](../../modules/absurd-daily/review/current-steak-iron-phone-20261025.png)／[下載PNG](../../modules/absurd-daily/review/current-steak-iron-share-20261025.png)。八類native接觸表已檢視器皿用途與高度，但不把它當其他62道全部精細美術已通過或真人接受。素材來源hash及生成factory與最終production build一致。

## UX-15e：依原參考重做搞怪手繪遊戲介面（2026-10-26）

使用者提供日系搞怪食物、暖簾、木台和紙片菜單參考；首批生成卻偏半寫實食物廣告，已被明確否決。保留該失敗紀錄，重新直接讀兩張原圖，將它們作為內建imagegen的style reference。新版以簡單墨線、有限平塗紙色、原創少筆畫角色與幽默動作呈現；沒有複製參考的蛋角色、商標或宣傳文字，也沒有將新圖自行標為使用者已接受。

先完成炸熱狗完整介面方向圖，再把圖中情境接入真正公開頁：按鈕、文字和選擇仍是HTML，開始後是本局3D。原生實際操作已走過開始、加料、裹衣；[手機開場](../../modules/absurd-daily/review/corn-dog-illustrated-ready-20261026.png)是產品頁截圖，並非把生成mockup當可玩證據。其後暫行延伸全部66道料理與6款其他遊戲，每款有獨立插畫。

[封面收據](../../modules/absurd-daily/illustrated-art.json)記錄72個512×340 WebP、每格裁切、來源及輸出hash、完整prompt和工具。PNG封存E槽，不作產品下載路徑。全批2,538,948bytes、單張最高45,838bytes；固定圖片owner、contain保留完整主體、按需載入和可操作的失敗備援。這是新增封面體積，不稱為整站減重。牛排鐵盤／木托、總分、實際成品、存檔和本人確認分享不回退。

本批亦回應四項審查：StrictMode清理釋放舊匯出owner，重播可重試完成局，舊promise不能清掉新owner；holiday canvas保留pointer down時的round，跨回合release不可操作替代目標；未開始的自由料理預覽／初始載入失敗不接管別道checkpoint，明確開始或確認重做才接管；牛排mesh帶原portions索引，配菜不造成偏移。保留main的完成局少一次繪製與測試。

首輪新runtime三項通過，涵蓋實際controller閉包跨回合、原生網格的交錯配菜索引及72素材hash／大小／尺寸／prompt。完整瀏覽器與最終像素結果在收尾時追加，舊43項／5條不作本版通過證據。

### 本批收斂與實跑界線

本機合入main `b267f472f`，保留其社群發文／會員操作與AD-6重建ready等待；衝突只有既有來源inventory，以原source_files邊界重新產生。沒有改寫其他作者或另造平行社群流程。

- 完整56條瀏覽器首輪 **53 passed／3 failed（19.5分鐘）**。兩個新測試的Blob URL／凍結時間冷卻假設，以及一個仍期待舊ready備援的selector不符新版開場。改為真正下載PNG驗格式／尺寸、等待原冷卻、分別驗開場與開始後的備援。原trace保留，不標成完整全通過。
- 31個實際畫面首輪 **18 passed／13 failed**，揭露八類手帳13／12px角色、四個大廳受舊lazy selector覆寫成cover，以及缺圖數鈔在320px／200%文字裁切。限定新root、補14px角色、缺圖owner改正常流增高，並清掉封面span繼承的badge inset。**17個相同失敗及相鄰場景全部通過**；沒有降低字級或owner門檻。實際桌面開場提示的對比亦補回靛藍底／奶油文字。
- 大廳實際載入紀錄：1440／768／320／667px初始封面請求分別14／14／3／5張，均沒有Three或場景module請求；按分類捲動後逐圖decode，無404／pageerror。未一次下載72張，不稱為整站程式減重。
- 更新後66道production factory重新輸出、來源hash及compiled factory收據一致：657,556bytes、最高31calls／93,468triangles／10geometries，0 pageerror，各context釋放。這次索引metadata修正未改食物外觀；生成收據與本輪來源重新綁定，不挪用舊收據。
- 兩份runtime全檔首輪46通過／4失敗，是合入的數鈔closure fixture漏接現有draw拆分與診斷／錯誤回呼，導致VM找不到draw後又找不到setReady。加入真正draw與syncDiagnostics、補UI ports，保留原本一次結算、重試與事件順序斷言；**50 passed／0 skipped**。瀏覽器的正常數鈔、capture失敗、實際下載也在首輪通過，沒有為過測改回產品邏輯。

實際新圖：[桌面大廳](../../modules/absurd-daily/review/illustrated-lobby-desktop-20261026.png)／[手機料理目錄](../../modules/absurd-daily/review/illustrated-kitchen-phone-20261026.png)／[炸熱狗開場](../../modules/absurd-daily/review/corn-dog-illustrated-ready-20261026.png)。PNG為production頁面，生成的完整mockup另存E槽；兩種證據分開。真人畫風接受、真人趣味與實體Safari／Android效能仍是外部待驗，不以本機軟體WebGL或像素檢查代簽。

最後在`b267f472f`合入及版面修正後，**13 passed／0 skipped（4.4分鐘）**：包含原三個失敗、四項審查回歸、真正下載PNG、跨回合native輸入、主線AD-6重建等待、會員登入／既有草稿不覆寫／確認才發文、外部分享與clipboard失敗、派對200%及引導料理大字。這是受影響子集，不說完整56條已在同一最後版本全數重跑。兩輪隔離schema皆清到0連線／0剩餘schema，沒有使用正式資料。標準typecheck／production build通過、Three>500kB提示仍保留；descriptor source ownership為81模組、0issues／0unknown，本機context完整且0blockers，均不代替遠端CI、review、merge或deploy。
