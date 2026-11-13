# 我的公會工具

1. 複製本目錄到自己的 Repo，保留 `bridge.js`。
2. 修改 `index.html`、`main.js`、`style.css`；在 `freedom-tool.json` 填名稱、識別碼和需要的功能。不要索取平台密碼。
3. Node 24 執行 `npm run check`、`npm run build`。不需安裝依賴。`dist/` 是完整靜態網站；在公會預覽中測試 bridge，直接開檔不會假裝已連線。
4. GitHub Pages 設定 Source 為 GitHub Actions，push main 後由此 Repo 的 workflow 發布；也可將 `dist/` 上傳任何 HTTPS 靜態主機。ES modules 在 opaque frame 需要主機允許匿名 CORS；若不支援，將程式打包為一般 script。不要設定拒絕嵌入的 X-Frame-Options / frame-ancestors。
5. 公會長在「工具 → 新增工具」貼網址、預覽並按「加入啟動台」。同網址的後續發布不需要平台 PR。

預留約 20 分鐘完成範例，不包含首次建立主機帳號、平台部署、等待會長或設計實際功能。
完整契約：平台 `/guild-tool.md`。SDK 也由平台 `/guild-tool/v2/client.js` 提供，建議複製以避免執行期依賴。`npm run check` 檢查範例檔案與 manifest；真實 iframe 契約由平台的 guild-tools.spec.ts 驗證。

## Worker 正式站

將工具發布到 GitHub Pages 的 `https://<name>.github.io` 或 Cloudflare Pages 的
`https://<name>.pages.dev`（也接受 `https://<preview>.<name>.pages.dev`）。網址使用小寫
DNS 名稱，不含帳密或埠號，直接回傳 HTML，且允許嵌入。自訂網域仍須使用 Node transport。
會長從公會「工具 → 新增工具」登錄，預覽後按「加入啟動台」。需要身分交換時，先依畫面
指示將來源驗證檔放在網站根目錄；GitHub Pages 的專案子路徑不等於控制整個來源。

平台操作者可在平台 repo 根目錄用 Node 24 產生專用金鑰，直接傳給目標 Worker 的 secret；
先將 `WORKER_ENV` 設為要操作的 Wrangler 環境：

```sh
node scripts/generate-guild-tool-signing-key.mjs | npx wrangler secret put FREEDOM_GUILD_TOOL_SIGNING_KEY --env "$WORKER_ENV"
```

金鑰不寫入 repo、部署設定或日誌。不安裝時隱藏身分交換；無效金鑰也不啟用 signer。
一次只使用一把私有 P-256 JWK（含 `kid`）。換鑰會使舊 token 無法通過平台驗證；token
最長十分鐘到期。外部工具若快取舊公鑰，離線驗證仍可能接受未到期 token；需要即時權限時
使用 `/api/v1/public/guild-tool-token/status`。
