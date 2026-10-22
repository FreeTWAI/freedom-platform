# portal-shell

會員網站的共用外殼：入口啟動、頁面導覽、語系、請求回饋、session context、安裝提示與共用版型。

## 負責範圍與相依

以同目錄 `freedom.module.json` 的 `owned_paths` 為來源歸屬清單；現有實作維持原路徑。對外入口列於 `public_exports`，相依模組為 `development`, `development-access`, `member-card`, `member-communications`, `newcomer-guides`, `shared`, `social-feed`。

領域頁面與業務服務仍由各功能模組持有。`App.tsx` 和應用啟動仍是 application-composition 的明確組合點；這個目錄只集中維護說明與 descriptor，沒有複製或搬動產品程式。

這份 descriptor 用於貢獻導航、context 與測試影響選取；它不會註冊路由、授予權限、啟用功能旗標或部署服務。既有重疊歸屬保留，讓組合入口與領域測試仍能被選到。它也不是租戶的 runtime module-registry、import 隔離或完整行為驗證。

## 提交變更

1. 先讀上述 instructions 與實際服務契約；只修改這次功能需要的檔案。
2. 新來源檔須加入正確 `owned_paths`；專屬目錄可用 `/**`。新增跨模組使用時更新 `dependencies`，不要以全站萬用路徑取代責任範圍。
3. 沿用既有 session、CSRF、目前權限與版本檢查。新增頁面或 API 仍需在應用組合入口明確接線。
4. 從 repo root 執行 `node scripts/freedom.mjs prepare --base-ref origin/main --scope portal-shell`，讀完本次 context；執行 descriptor 檢查、相關測試及 `npm run typecheck`，在 PR 記錄實際結果與未驗項。保留既有 `runtime.full` 與適用的 UI 驗證。
