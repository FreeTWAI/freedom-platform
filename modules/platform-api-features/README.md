# Platform API 功能組合

此模組將原本 `platform-app.ts` 中的業務 handler 抽為明確註冊函式；實作在 `apps/platform-api/src/features/`。使用 host 傳入的相同 app、pool、origin、runtime 與來源網路能力，註冊時不存取資料庫，也不自動安裝 provider。

公開／登入功能在 memberBoundary 之前；會員功能在之後。實際呼叫位置由 `platform-app.ts` 保持，不能自行搬動 Host/Origin、JSON 限制、會員、CSRF、onboarding、private-cache 或 commerce quarantine 邊界。新增功能須明確接入並驗證開啟及關閉狀態，不能因相鄰旗標開啟而默認啟用。

`context.ts` 提供具型別且唯讀的 host contract；`commands.ts` 保留既有 operation、Idempotency-Key、If-Match 與 actor 轉換。業務狀態與目前權限仍由原 domain module 負責，先核對目前權限才可回放既有結果。

閱讀根貢獻指南與 `docs/development/module-contributions.md`。驗證包括 platform feature registration、既有 JSON body / member boundary runtime tests、typecheck、受影響業務測試及 host CI。路由表相同只能證明掛載與順序；不可取代資料庫、授權或瀏覽器驗收。
