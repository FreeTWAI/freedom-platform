# Mesh Avatar Studio：2D 虛擬導購候選評估

核對日期：2026-10-29（UTC）。本次只讀上游文件、授權與程式碼；沒有安裝或執行上游軟體、上傳圖片、開啟相機／麥克風、呼叫付費服務或推流。

**決定：保留為選配 2D renderer 候選，不引入整套 Studio、不複製 Miko 素材。這份文件不是平台 UI 整合、功能啟用或正式直播交付。**

## 原作入口與版本

- [原作 GitHub](https://github.com/shinshin86/mesh-avatar-studio)：作者 Yuki Shindo（shinshin86）。
- [官方網站](https://shinshin86.github.io/mesh-avatar-studio/)與[外部 Player](https://shinshin86.github.io/mesh-avatar-studio/play/)：由使用者自行選擇開啟，不是站內 iframe，也不代替使用者授予裝置權限。
- 本次 inspected commit：[`5e1be84b8f22325eb156b00c34370374963c15aa`](https://github.com/shinshin86/mesh-avatar-studio/commit/5e1be84b8f22325eb156b00c34370374963c15aa)。核對時 GitHub compare 該 SHA 與 `main` 為 identical；網站與 Player 仍是可變的外部服務，不保證固定在此版本。
- [固定版本 README](https://github.com/shinshin86/mesh-avatar-studio/blob/5e1be84b8f22325eb156b00c34370374963c15aa/README.md)描述單張插畫的網格變形、眨眼與動作；不是寫實影片生成，也不提供商品、訂單或付款權威。

README 說明 Player 可在 Chrome／Edge 使用，沒有 Studio 的 stream URL；完整本機 Studio 才提供 OBS Browser Source 路線。這是上游文件描述，**本次沒有操作 Player、OBS 或驗證裝置支援**。建立新角色的部分流程會把圖片與遮罩傳給 OpenAI；上游一鍵建立命令及自動批准旗標不是本平台的執行授權，本次不執行。

## 授權必須分開看

| 材料 | 固定來源與觀察 | 本次取用決定 |
| --- | --- | --- |
| Studio 原始碼 | [MIT License](https://github.com/shinshin86/mesh-avatar-studio/blob/5e1be84b8f22325eb156b00c34370374963c15aa/LICENSE)，Copyright 2026 Yuki Shindo | 可評估程式重用；若日後複製或散布，保留適用版權與許可聲明。本次未複製上游程式。 |
| `mesh-avatar` runtime | [package.json](https://github.com/shinshin86/mesh-avatar-studio/blob/5e1be84b8f22325eb156b00c34370374963c15aa/packages/runtime/package.json)標示 `0.4.0`、MIT、ESM；列出的 production dependency 為 `fflate ^0.8.3`。[runtime README](https://github.com/shinshin86/mesh-avatar-studio/blob/5e1be84b8f22325eb156b00c34370374963c15aa/packages/runtime/README.md)說明 bundle 保留 fflate MIT notice，且不包含 Miko 藝術資產。 | 優先評估小型 runtime，而非整個 monorepo。未核對 npm 發布包與此 SHA 的 byte identity、完整依賴安全或 provenance。 |
| Miko 範例角色 | [MIKO_ASSET_TERMS.md](https://github.com/shinshin86/mesh-avatar-studio/blob/5e1be84b8f22325eb156b00c34370374963c15aa/samples/miko-qipao/MIKO_ASSET_TERMS.md)明示獨立角色條款；英文摘要禁止獨立素材散布／素材包，且不得暗示官方關係或主張角色所有權；日文原條款優先。 | 不複製、重包或託管該角色。程式 MIT 不授予所有圖片使用權；日後使用自有或另獲授權素材。此摘要不是完整角色使用許可判定。 |
| MediaPipe／Face Landmarker | 上游 README 列出 MediaPipe Authors 與 Apache-2.0，另有 [vendor license](https://github.com/shinshin86/mesh-avatar-studio/blob/5e1be84b8f22325eb156b00c34370374963c15aa/vendor/mediapipe/LICENSE)。 | 相機追蹤不是本次候選接點所需；不順帶引入套件或模型。若另行採用，須核對實際散布檔與所有適用 notices。 |

## 與既有虛擬導購的關係

2026-10-29 查核時，[PR #1154](https://github.com/FreeTWAI/freedom-platform/pull/1154)仍是未合併 Draft，head 為 `2a4cc3c7bdf940b18aeeb860c9da3ced51c6c2d8`。其[文字彩排核心](https://github.com/FreeTWAI/freedom-platform/blob/2a4cc3c7bdf940b18aeeb860c9da3ced51c6c2d8/modules/virtual-commerce/service.ts)已有唯一 active cue、商品版本／期限、取消 generation 與 activation token；產物只接受 `text-rehearsal`，不是音訊或人物動畫。

候選 renderer 只應負責畫面，不接管商品核准、觀眾／操作員權限或播放排程。現有文字快取不能冒稱影音快取；若後續採用，應另立媒體產物與播放生命週期契約，保留原版本及停止邊界。本次不修改 #1154，也不宣稱該候選已在 main 或正式站。

## 可用介面與待驗風險

- [runtime API](https://github.com/shinshin86/mesh-avatar-studio/blob/5e1be84b8f22325eb156b00c34370374963c15aa/packages/runtime/src/engine/index.ts)包含 `setVoiceLevel`、`setSpeaking`、表情、`stopLipSync` 與 `destroy`；音訊仍由 host app 播放。聲量驅動嘴型不等於已驗證中文音素對齊或 TTS。
- [載入器](https://github.com/shinshin86/mesh-avatar-studio/blob/5e1be84b8f22325eb156b00c34370374963c15aa/packages/runtime/src/format/open.ts)支援 Blob／ArrayBuffer 與 URL。Blob 路徑解包後使用 blob URLs；URL 路徑會 fetch。第一階段應只接受本人選取的合法本地檔案，不暴露任意 URL／資產映射入口，也不自動上傳。
- [引擎實作](https://github.com/shinshin86/mesh-avatar-studio/blob/5e1be84b8f22325eb156b00c34370374963c15aa/packages/runtime/src/engine/createMeshAvatar.js)預設自動啟動動畫；`manual: true` 可由呼叫者 `advance()`。因此可研究由共同時鐘驅動，但不是同步精度證明。切頁／停止／換人物必須清理畫面與遲到回呼；另尊重減少動態效果偏好。
- 同一引擎檔有模組層 image／JSON caches，該檔 `destroy()` 沒有清空這兩個 Map。這是長時與重複換人物需量測的風險，不是已重現的漏記憶體結論。
- [ZIP 實作](https://github.com/shinshin86/mesh-avatar-studio/blob/5e1be84b8f22325eb156b00c34370374963c15aa/packages/runtime/src/format/zip.ts)限制 200 entries、單項 64 MiB、stored compression，並檢查路徑與重複 entry。平台仍需自行限制整包、解碼圖片像素與 GPU／記憶體負載；不能把上游局部檢查當成完整惡意檔驗收。
- 已讀 loader／engine／公開 API 未見相機或麥克風請求，但未做完整相依圖、網路行為或瀏覽器測試，不能宣稱整包經隱私／安全認證。Hosted Player、Studio 的追蹤與建立角色流程必須分開評估。

## 後續最小證明（尚未執行）

1. **來源與素材准入**：核對固定發布包、lockfile、依賴與 notices；使用自有合法 `.mavatar`，不帶入 Miko。保持按需載入、明確啟動，不改 CSP 或預設申請裝置權限。
2. **隔離離線畫面**：只讀本地檔案、無 provider；驗證 WebGL 不可用、錯誤檔、超限、載入失敗、重複開關及切頁。觀察實際網路請求，不能只靠文件保證無外送。
3. **播放生命週期**：先以合成時鐘與假播放器驗單一輸出、過期／取消、遲到完成拒絕及停止後不得復活；再以已授權的既有音訊驗畫面／字幕同步。假時鐘通過不算實際延遲通過。
4. **長時與可及性**：量測重複換人物的記憶體、隱藏頁與恢復、減少動態效果及無動畫 fallback。8 小時、P95 同步誤差 100 ms／回答 3 s 只能作待定義測量起訖與負載的候選目標，並非上游或本平台的實測保證。

相機／麥克風、真 TTS、素材生成、外部直播、OBS、交易串接、費用與部署均不在本次文件提交範圍；後續各自取得授權並驗收，不能由此研究直接啟用。
