# Seller Console（賣家主控台）

賣家在商店分頁裡的私人營運頁（EC-SPEC-01 §7.5、pages.md 的 E 列）。頁框沿用 Supplier Console 的
`modules/agent-commerce/hosted-ui/ConsoleShell.tsx`；本模組只放賣家頁自己的路由、讀取、命令與頁面。

- 開關：`site.commerce_console_enabled`（console、supplier console 與 launchpad 都開，EC-SPEC-10 §2.3）。關閉時
  這些網址回到既有的商店頁，`orders` 維持 v1 預留的 4 段路徑。
- 伺服器決定每一個事實與權限；頁面只顯示 API 回應，項目依 `StoreView.capabilities` 顯示，伺服器仍逐一檢查。
- 第一批頁面：E05 訂單、E09 收款例外、E11 收款設定（`settings/payments`）。出貨、顧客、優惠、發票與報表在之後的里程碑。

`orders/reservations` 保留既有預留頁，`orders/<order_ref>` 與 `payments/<case_ref>` 是本批在既定 slug 下新增的明細子路徑。

## 實作入口

- `route.ts`：不依賴 React 的路由、query 白名單、能力導覽及舊頁 fallback；導覽只用 hash。
- `state/attempt.ts`、`state/controller.ts`：保留原 key/body/version 的不確定寫入、session/store 讀取隔離、離開保護與保存後重讀。
- `ui/SellerConsole.tsx`：共用 ConsoleShell、商店名稱、setup/capability 檢查；舊版預留仍由 HostedSellerOrders 自己檢查。
- `ui/Orders.tsx`：E05 清單/明細，分軸狀態、按需聯絡資料、手動退款紀錄。
- `ui/Exceptions.tsx`：E09 零自行推論的 allowed_actions/resolution_codes。
- `ui/Settings.tsx`：E11 版本、綠界帳戶、一次 fresh auth、write-only 金鑰、驗證付款與服務狀態。
- `ui/OfflineSettings.tsx`：同一設定頁的匯款／面交現金及面交取貨設定；銀行帳號依 API 權限顯示完整或末四碼。
  付款設定先驗證輸入，再要求 fresh auth；欄位錯誤留在原表單。面交編輯保留完整 shipping profile 的其他欄位。
- `ui/OfflineOrderActions.tsx`：依每筆訂單的 server actions 提供店家確認匯款、現金收款與面交、已付款訂單交貨；
  顯示訂單編號、金額、日期和不可撤銷的影響，確認後才送出原版本命令。
- `ui/SellerConsole.css`：只在 seller-console 範圍重用現有 tokens；不修改共用頁框。

線下流程首批支援自有庫存的銀行匯款、現金與面交，沿用既有設定及訂單 API，不啟用任何主機開關。
款項是「店家自行確認收到款項」，不表示平台向銀行核實。付款方式取自訂單 DTO，不能從付款軸推論庫存或訂單狀態。
讀取失敗不以空設定覆寫。編輯草稿綁定開始編輯時的版本，412 後須讀取並明確捨棄草稿，不能自動換版本重送。
未知回覆保留原 key/body/If-Match；一般資料更新或撤權後的 403／404 不能替原操作結案。權限恢復後仍重試原命令。
這份未確認命令只保留在目前頁面的記憶體，離頁及關閉頁面會提出保護提示；沒有跨重開瀏覽器的命令保存。

## 已知 API 邊界

目前 PortalClient 不提供 Retry-After，付款查詢遭拒後先停用本頁查詢，請稍後重開訂單；無法精準依該 header 自動恢復。
PortalClient 也會將 mutating 5xx 轉成無 problem code 的 network error，因此這些回應會維持不確定狀態、使用原 key 重試；
無法在不改共用 client error 協議的前提下顯示特定 503 code。E09 導覽依 finance:read，但現行例外讀取 API 另要求 orders:read；
伺服器的 403 會顯示權限說明。Order DTO 沒有 lifecycle/inventory 最近變更時間，頁面明示讀取時間，不虛構事件時間。
