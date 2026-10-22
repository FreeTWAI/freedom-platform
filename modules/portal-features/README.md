# Portal 功能組合

此模組負責已登入頁面的靜態註冊、五個功能群、共用 metadata 與型別合約。實作在 `apps/portal-web/src/features/`；業務頁面仍留在原功能目錄。TaskBoard 與公會目錄／工作區的既有 application-composition ownership 保留，這裡另記其頁面組合責任。

`registry.tsx` 是 App 使用的入口；`composition.ts` 拒絕重複、未知或缺漏頁面，組合時不呼叫 renderer。新頁面需同步 Tab、metadata、功能群、導覽及真實行為測試。新檔不會自動註冊。訊息使用既有 overlay；未完成入會的訂單入口共用原 lazy 元件。

App 繼續負責登入、onboarding、session 世代、錯誤邊界與生命週期；不可把另一個帳號的資料或未完成請求帶入目前畫面。旗標缺失預設關閉，明確傳入現有權限與callbacks，不在註冊時額外授權。

閱讀根貢獻指南與 `docs/development/module-contributions.md`。修改後執行 registry runtime tests、typecheck、production build；UI 行為還須對應瀏覽器驗證。descriptor graph 是影響範圍資訊，並非完整 import 隔離證明。
