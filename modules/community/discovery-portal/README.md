# community-discovery

社群探索的展示與組合：技能書入口、分享與標記、公會目錄分析，以及公開服務頁樣式。

## 負責範圍與相依

以同目錄 `freedom.module.json` 的 `owned_paths` 為來源歸屬清單；現有實作維持原路徑。對外入口列於 `public_exports`，相依模組為 `community`, `development`, `github-social`, `member-card`, `portal-shell`, `shared`, `skill-submissions`。

目錄、公開服務內容與分析結果由 community 服務產生；GitHub 連結與技能書提交沿用原模組。分析報告及技能書參照不建立授權、支付或自動公會異動。

這份 descriptor 用於貢獻導航、context 與測試影響選取；它不會註冊路由、授予權限、啟用功能旗標或部署服務。既有重疊歸屬保留，讓組合入口與領域測試仍能被選到。它也不是租戶的 runtime module-registry、import 隔離或完整行為驗證。

## 提交變更

1. 先讀上述 instructions 與實際服務契約；只修改這次功能需要的檔案。
2. 新來源檔須加入正確 `owned_paths`；專屬目錄可用 `/**`。新增跨模組使用時更新 `dependencies`，不要以全站萬用路徑取代責任範圍。
3. 沿用既有 session、CSRF、目前權限與版本檢查。新增頁面或 API 仍需在應用組合入口明確接線。
4. 從 repo root 執行 `node scripts/freedom.mjs prepare --base-ref origin/main --scope community-discovery`，讀完本次 context；執行 descriptor 檢查、相關測試及 `npm run typecheck`，在 PR 記錄實際結果與未驗項。保留既有 `runtime.full` 與適用的 UI 驗證。
