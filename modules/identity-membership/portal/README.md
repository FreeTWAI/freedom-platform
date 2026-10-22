# member-profile-ui

會員資料的呈現與編輯輔助：能力選項、在線狀態、夥伴推薦、社群連結與會員設定樣式。

## 負責範圍與相依

以同目錄 `freedom.module.json` 的 `owned_paths` 為來源歸屬清單；現有實作維持原路徑。對外入口列於 `public_exports`，相依模組為 `assets`, `member-card`, `shared`, `portal-shell`。

會員資料、可見範圍、封鎖與 session clock 仍由 member-card／assets 的服務執行。此 UI 子模組不能依前端輸入授予社群連結或會員資料存取。

這份 descriptor 用於貢獻導航、context 與測試影響選取；它不會註冊路由、授予權限、啟用功能旗標或部署服務。既有重疊歸屬保留，讓組合入口與領域測試仍能被選到。它也不是租戶的 runtime module-registry、import 隔離或完整行為驗證。

## 提交變更

1. 先讀上述 instructions 與實際服務契約；只修改這次功能需要的檔案。
2. 新來源檔須加入正確 `owned_paths`；專屬目錄可用 `/**`。新增跨模組使用時更新 `dependencies`，不要以全站萬用路徑取代責任範圍。
3. 沿用既有 session、CSRF、目前權限與版本檢查。新增頁面或 API 仍需在應用組合入口明確接線。
4. 從 repo root 執行 `node scripts/freedom.mjs prepare --base-ref origin/main --scope member-profile-ui`，讀完本次 context；執行 descriptor 檢查、相關測試及 `npm run typecheck`，在 PR 記錄實際結果與未驗項。保留既有 `runtime.full` 與適用的 UI 驗證。
