# Seller Console（賣家主控台）

賣家在商店分頁裡的私人營運頁（EC-SPEC-01 §7.5、pages.md 的 E 列）。頁框沿用 Supplier Console 的
`modules/agent-commerce/hosted-ui/ConsoleShell.tsx`；本模組只放賣家頁自己的路由、讀取、命令與頁面。

- 開關：`site.commerce_console_enabled`（console 與 launchpad 都開；不依賴 supplier console，EC-SPEC-10 §2.3）。關閉時
  這些網址回到既有的商店頁，`orders` 維持 v1 預留的 4 段路徑。
- 伺服器決定每一個事實與權限；頁面只顯示 API 回應，項目依 `StoreView.capabilities` 顯示，伺服器仍逐一檢查。
- 第一批頁面：E05 訂單、E09 收款例外、E11 收款設定（`settings/payments`）。出貨、顧客、優惠、發票與報表在之後的里程碑。
- E02「開店準備」位於 `#stores/<tenant>/<instance>/overview`，導覽第一項，只需 `store:read`。
  八項固定清單與接單狀態由共用 server readiness 計算；發布／商品／公開介紹連回商店首頁，
  版本／付款／交付連回收款設定。店主不須另外申請准入，由獨立平台管理員沿原權限確認。
  有 `store:orders:read` 才顯示進行中、待確認收款與待處理問題，超過 99 顯示 `99+`；
  待出貨、退貨與 provider 異常數仍未實作。讀取失敗保留資料時間並明示無法取得，不產生假的 0。
  畫面只列付款／配送種類與狀態，不含銀行、聯絡內容、准入理由或管理員身分。

`orders/reservations` 保留既有預留頁，`orders/<order_ref>` 與 `payments/<case_ref>` 是本批在既定 slug 下新增的明細子路徑。

## 實作入口

- `route.ts`：不依賴 React 的路由、query 白名單、能力導覽及舊頁 fallback；導覽只用 hash。
- `state/attempt.ts`、`state/controller.ts`：保留原 key/body/version 的不確定寫入、session/store 讀取隔離、離開保護與保存後重讀。
- `ui/SellerConsole.tsx`：共用 ConsoleShell、商店名稱、setup/capability 檢查；舊版預留仍由 HostedSellerOrders 自己檢查。
- `ui/Orders.tsx`：E05 清單/明細，分軸狀態、按需聯絡資料、手動退款紀錄。
- `ui/Overview.tsx`、`ui/Readiness.css`：E02 清單與訂單概況；標籤取自 UI-safe 契約常數，與平台准入頁共用。
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
若原 fresh auth 已過期，只重新驗證身分，透過限定收款設定 API 的 `Commerce-Recovery-Verification` header 授權重試；
原 body（含原 proof）、key 與 If-Match 不變。取消驗證仍保留未確認命令，不推定成功或未提交。
這份未確認命令只保留在目前頁面的記憶體，離頁及關閉頁面會提出保護提示；沒有跨重開瀏覽器的命令保存。

## 已知 API 邊界

目前 PortalClient 不提供 Retry-After，付款查詢遭拒後先停用本頁查詢，請稍後重開訂單；無法精準依該 header 自動恢復。
PortalClient 也會將 mutating 5xx 轉成無 problem code 的 network error，因此這些回應會維持不確定狀態、使用原 key 重試；
無法在不改共用 client error 協議的前提下顯示特定 503 code。E09 導覽依 finance:read，但現行例外讀取 API 另要求 orders:read；
伺服器的 403 會顯示權限說明。Order DTO 沒有 lifecycle/inventory 最近變更時間，頁面明示讀取時間，不虛構事件時間。

## 商家接單狀態與庫存

商店編輯器與開店準備共用 `ui/view.ts` 的接單狀態 formatter，事實仍來自既有
`GET .../overview`，不另建准入判斷。入口已開放但商品或交付方式未備妥時，明確
說明買家尚無法完成下單；撤銷准入與平台暫停優先顯示。商店說明缺漏只作提醒。
編輯器使用獨立、綁定店鋪與 session 的讀取區塊；更新狀態不會清掉商品或照片草稿。
403 不提供無效重試，其他讀取失敗可重試。checkout OFF 保留原本兩個橫幅與預留
設定邏輯，而且不發出這個 readiness 請求。v1 預留頁只描述自身資料；console
開放時提供小型次要「結帳訂單」連結。

自有商品顯示庫存、已占用、可售，以及預留中與已付款待出貨；預留不是成交。
庫存編輯下限仍由伺服器的 `stock_below_reserved` 409 決定，沒有新的寫入權限。
