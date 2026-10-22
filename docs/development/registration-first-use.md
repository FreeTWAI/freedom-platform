# 註冊到首次使用：手機表單與歡迎頁

Hao 於 2026-10-22 直接派工，接續既有 #68 註冊簡化，不新增會員制度。
本輪在最新 PR 查核發現 Ted 已接手 #964，因此分開交付：
**#964 負責技能書 CTA／原目的地回流及 Star 修正；本 PR 不修改那些流程。**

## 固定範圍

| 使用情境 | 本輪行為 | 不改的規則 |
| --- | --- | --- |
| 手機建立帳號 | Email 提供 email 鍵盤、不自動大寫；密碼要求放在欄位旁，明確關聯說明與錯誤狀態 | Email、密碼兩個必填；暱稱選填；原 12–128 字元要求及 server 驗證 |
| 確認密碼有沒有打錯 | 主動顯示／隱藏；切模式、送出或隱藏分頁恢復遮蔽；密碼值不改、不保存 | 密碼管理器、登入、重設及 TOTP 流程 |
| 註冊後看到可用資源 | 活動、工作、技能書與公會各自載入；先回來的先顯示 | 原授權 API 與入會要求 |
| 某區讀取失敗 | 只在該區顯示錯誤及重試，不假裝沒有資料，不重抓其他成功區塊 | 不自動重試寫入、不做背景輪詢 |
| 選公會 | 歡迎頁、快速加入及活動選單共用這次授權取得的目錄 | 入會問題、本人確認、技能授權及寫入 API |

沿用已合併的 `createTaskRead`，不再建立第二套讀取狀態機。
讀取作用域綁定目前 client/session generation；卸載或換帳號時取消並忽略晚到回覆。
活動送出後只替換活動讀取，不把儲存成功後的讀取錯誤說成活動未送出。
新的密碼欄位只管理本頁顯示狀態，不記錄、儲存、修剪或自行送出密碼。
五種介面語言均保留；新按鈕使用既有小型次要操作樣式，不修改全域 CSS 或品牌。

## 驗收

先依專案要求在 Node 24、隔離資料庫上 typecheck/build，再跑瀏覽器：

```sh
npm run typecheck
npm run build
node --import tsx --test tests/runtime/task-board-loading.test.ts
npm run test:e2e -- tests/e2e/registration-first-use.spec.ts tests/e2e/calm-experience.spec.ts tests/e2e/onboarding-members.spec.ts tests/e2e/onboarding-recovery.spec.ts tests/e2e/password-recovery.spec.ts tests/e2e/totp.spec.ts
```

新 spec 包含手機兩個必填欄位／密碼切換、送出中遮蔽及失敗保留、慢活動不阻擋技能書、
共用公會目錄、單區失敗獨立重試。使用合成帳號與既有隔離 fixture，不操作正式會員。
所列命令不是已通過證據；實跑結果與未驗項以 PR 本輪紀錄為準。

## 交接與發布

不向 #964 的接手分支推送、不替換其 auth return 改動。兩支都修改 App，但本支只在 import
及表單 JSX 接 PasswordField；整合時保留 #964 的目的地與 session 邏輯。
不增加 OAuth、Passkey、獎勵、埋點、API、migration、依賴、付款或正式旗標。
這是帳號介面與首次使用改善；由核心領域維護者審查並跑必要整合驗證，發布者依既有程序交付。
合併、部署、開放使用分開；未測真機或完成率時，不承諾零延遲、30 秒真人完成或轉換率上升。
