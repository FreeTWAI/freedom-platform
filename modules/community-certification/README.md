# 社群認證（藍勾）

完整流程的來源候選，未部署、未核發任何真實帳號。
`FREEDOM_COMMUNITY_CERTIFICATION_ENABLED` 缺失／false 預設關閉，只有 exact true
才註冊會員與管理路由並顯示入口；Node/Worker 都拒絕無效字串。沒有修改部署旗標。延續 #1128 的產品定義，
不是實名查驗、信用評等、職務或權限；不修改原 policy Draft。

會員從帳號設定申請，人工管理員依社群參與說明核准／拒絕；有效認證可撤銷。
本人可撤回 pending/active，重新申請須重新審核。展示 opt-in 獨立、預設 false，
不因申請或核准自動打開。匿名／OG／PNG／搜尋永不加入徽章。

## 權威與交易

沿 member command 與 adminCommand、原 Origin/CSRF/Access 邊界；不授予新 admin。
管理 review 同時要求 Access 管理身分與同驗證信箱的實際目前會員 session，
不依自填 email 授權。不建立／更動任何身份綁定；模糊匹配、自己審自己拒絕。
狀態／私人 audit／最小 receipt 同交易，review reason 不進公開或本人 DTO。
會員 journal 只記 state/display，不包含申請原文。每次 replay 先驗當前身份／目標，
之後回最小 updated receipt；會員另讀現在狀態、管理 UI 重載佇列，不復活舊藍勾。

鎖序：會員 user SHARE → session SHARE → receipt advisory → certification advisory
→ certification row UPDATE。管理 admin SHARE → admin receipt advisory → reviewer
user/session SHARE → target user SHARE → 相同 certification advisory/row。無 user
鎖升級。初次不存在的 aggregate 是只讀 virtual version 1；每次寫入必須 If-Match，
首次寫入 version 2，資料不刪除重建。重送同 key/body/version 不重複寫。
申請每人 24 小時最多三筆成功操作；失敗回復限流變動。

Admin route 以同一 Request 再呼叫原 Access verifier（原 clock tolerance 不改），
在 domain wait 後與最終 receipt/replay 後重驗相同 subject/email/CSRF；會員 session
以同交易 DB clock 重驗，失敗全部 rollback。沒有新 JWT bypass 或 email-role。

## 個人空間整合

#1135 尚未合併。已提供針對其 exact head 的獨立整合 patch：只在
memberVisitorProfile 的同一 SQL ACL snapshot LEFT JOIN active+opt-in 認證，
authenticated envelope 增 optional community_certification。匿名 schema/reader 不改。
同社群、雙向 block、owner/viewer eligibility 與 visibility 由原 SQL 一併限制。
未套整合 patch 前，帳號設定可使用完整申請／審核流程，但訪客 badge 尚未接線，
因此不能宣稱完整功能已完成。

## Schema 與驗收

main bdcbb742 已納入 Google migration190。本整合候選依序使用主頁191、
封面192、認證193、稱號194；合併前仍須核對主線最大號，未表示已套用。
不修改歷史 SQL，不加 known_gaps，不自動回填/授勳/grant。
新 source 啟用前必須套 canonical migration 並由既有 operator 核對 runtime 權限；
本候選不執行 DB 或授權角色變更。

執行入口：typecheck、runtime community-certification-policy（純）、
community-certification（明確 disposable TEST_DATABASE_URL）、e2e。
來源與實跑證據分開；本環境 DB 尚未獲准啟動，native Chromium 已被 socket
政策拒絕，這兩類驗證不得用 mock 或 compiler 冒充，亦不得以改 sandbox 重試。
