# 我的公會工具

1. 複製本目錄到自己的 Repo，保留 `bridge.js`。
2. 修改 `index.html`、`main.js`、`style.css`；在 `freedom-tool.json` 填名稱、識別碼和需要的功能。不要索取平台密碼。
3. Node 24 執行 `npm run check`、`npm run build`。不需安裝依賴。`dist/` 是完整靜態網站；在公會預覽中測試 bridge，直接開檔不會假裝已連線。
4. GitHub Pages 設定 Source 為 GitHub Actions，push main 後由此 Repo 的 workflow 發布；也可將 `dist/` 上傳任何 HTTPS 靜態主機。ES modules 在 opaque frame 需要主機允許匿名 CORS；若不支援，將程式打包為一般 script。不要設定拒絕嵌入的 X-Frame-Options / frame-ancestors。
5. 公會長在「工具 → 新增工具」貼網址、預覽並按「加入啟動台」。同網址的後續發布不需要平台 PR。

預留約 20 分鐘完成範例，不包含首次建立主機帳號、平台部署、等待會長或設計實際功能。
完整契約：平台 `/guild-tool.md`。SDK 也由平台 `/guild-tool/v2/client.js` 提供，建議複製以避免執行期依賴。`npm run check` 檢查範例檔案與 manifest；真實 iframe 契約由平台的 guild-tools.spec.ts 驗證。
