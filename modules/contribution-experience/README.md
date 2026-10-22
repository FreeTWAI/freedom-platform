# 社群模組貢獻入口

此模組負責 `docs/development/module-contributions.md` 與 GitHub PR 模板，讓貢獻者查詢模組、建立骨架、接入平台及如實記錄驗證。

CLI 的實作與 schema 權威仍在 governance 模組的 `packages/contribution-tools/`。不要另建 descriptor 格式、測試執行器、權限機制或可攜 verifier。新文件與模板不改變根 AGENTS、CONTRIBUTING、可信 CI、合併或部署規則。

更新文件時使用實際 CLI 檢查參數，保留新模組建立前後的 context 差異、v1 bundle 與 chunk manifest 的區別、verify unavailable 的真實狀態。不能把本機 metadata 檢查說成完整 runtime/import/授權驗收。
