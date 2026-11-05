# 遊戲大廳接上既有新版 Logo

使用者回報遊戲大廳仍顯示舊版 Logo。本次只替換公開遊戲 header 的來源與尺寸，
保留原生首頁連結、遊戲／分享流程及原 namespace，不重新生成或加工品牌圖片。

## 來源與權利

- 重用 [#1201](https://github.com/FreeTWAI/freedom-platform/pull/1201) 的既有透明 PNG，
  來源提交 `4bbcdfcc2b59aa8ca6a48c3f60052c48c58226da`。
- 原路徑：`apps/portal-web/public/brand/freedom-workshop-compact-transparent.png`。
- Git blob：`feff6c97dc59d0a4a849d6d1754994cce53cea7f`。
- SHA-256：`f33136a09613c25752b1a24ad8aa9ef76dde93f31425bb6c5e201fe6d51aa10e`。
- 85,753 bytes，396×132 RGBA。圖片與 #1201 逐 byte 相同；原作者、品牌權利、
  AI 去背及輸出來源說明仍以該 PR 為準，不把素材重新標為本次原創或 MIT。

main 尚無該 PNG，因此本候選帶入相同檔案；與 #1201／Ted 的
[#1266](https://github.com/FreeTWAI/freedom-platform/pull/1266) 整合時保留相同 blob，
不能覆寫其餘品牌、遊戲或全螢幕改動。
[#1061](https://github.com/FreeTWAI/freedom-platform/pull/1061) 的遊戲整體改善仍沿既有作者分支；
本修補不重開該功能，也不修改 Ted 分支。

## 尺寸與驗證邊界

圖片保留 3:1 固有比例，以本元素的 132×44 CSS 尺寸顯示，不受舊主題的
46–72px 寬度上限壓縮。header 可換行，窄螢幕保留 Logo 與兩個首頁入口的
44px 觸控高度，不修改共用 BrandPoster 的 16:9 契約或全站 CSS。

新增 runtime 檢查實際 header JSX、原生連結與來源 PNG 的 hash／解碼／透明角落。
新增 320／390／1440px 原生瀏覽器案例，檢查最終 computed 尺寸、完整載入、
頁面不橫向溢出、首頁連結及上一頁恢復，並附 header 截圖。
這些作者稿本身不是原生執行證據；實跑結果、未跑原因與 exact-head CI 另記 PR。
本次不宣稱小遊戲或 Logo 已部署。
