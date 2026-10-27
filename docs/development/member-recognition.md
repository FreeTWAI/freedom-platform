# 社群認證與合作成果稱號（未接線草案）

基準 `4d2484286a82e5795826ffe9e743cbaef33b86a6`，2026-10-27。使用者同意藍勾定義為「管理員審核、可撤銷的社群認證」，不是實名查驗。此切片只有內部 TypeScript 合約、純函式、測試與 schema 設計；沒有 API、UI、migration、資料寫入、認證授予、旗標或發布。

## 兩種完全分離的標記

- **社群認證**：藍勾＋可讀文字；說明「管理員審核通過的社群標記；非實名查驗、信用評等或履約保證」。不得由貢獻件數、信箱驗證、OAuth、自填名稱、公會職稱或技能書作者認領自動取得。
- **成果稱號**：不同已驗收社群 Work 的里程碑。`community_work_milestones_v1_proposed` 門檻為 1／5／20／50，對應初次貢獻／協作夥伴／持續貢獻者／長期共創者，圖示芽／拼圖／星／多星。這是 Draft review 提議，不是已啟用政策、XP、點數帳本或獎勵。零件無負面標記。

兩者都不授予權限、付款利益、合作保證或排序優勢；沒有達標換藍勾。圖示需有文字及鍵盤／觸控說明，不能只靠色彩或 hover。

## 來源與隱私

沿 [既有成果合約](contribution-cooperation.md) 與 `modules/opportunity-project-work/contribution-roles.ts`：已驗收交付或目前有效的已確認角色，依 Work ID 去重。修改回 pending／撤回的角色不再提供計入依據；若仍有原始有效交付，該 Work 仍計一次。新 helper 的 `current` 只是 SQL adapter 的輸入模型，不是它自行驗證 version/hash。

**所有 helper 都不是授權器或證據驗證器**。未來只允許 server 從 canonical reader 的同一當前權限 snapshot 建立完整成果投影；不接受 client 傳 count、roles、current、profileReadable。不能只數當前分頁，也不能將完整敏感清單傳到瀏覽器才計算。純函式並不證明獨立真人、防分身、防串謀或跨 Work 拆單防灌水。

現有 accepted_count 雖排除 private／tenant Work，仍是會員可見合作紀錄，並非匿名公開資料。首版兩種徽章均限登入同社群，受 profile ACL 及獨立 `showCommunityCertification`／`showContributionBadges` 明確 opt-in；預設皆 false。匿名 DTO **省略欄位**，不是回傳隱藏總數或 false 狀態。公開個人空間也不自動公開徽章或件數。更廣公開須另有具體公開同意／projection 設計。

Profile PR1 不含 badge fields。未來應擴充該候選 `modules/identity-membership/profile-publication.ts` 的 `memberVisitorProfile` canonical SQL 或共用其 predicate，不能把純函式 `canReadVisitorProfile` 當 DB ACL，也不能在 ACL 查詢後另讀造成撤回競態。`publicVisitorProfile` 不接會員成果 reader。

不計私人 Work、聊天、邀請、追蹤、按讚、登入天數、推廣點擊、私人受益回報或未驗收 PR。舊 Issue×5＋PR×20 與 promotion_clicks 保持原顯示用途。沒有自動補歷史分數。

## 後續管理員命令（尚未實作）

沿 `modules/platform-admin/service.ts` 的 adminCommand／audit 與 admin route Access／X-Admin-CSRF 邊界。新增核發、撤銷兩個窄命令；必填原因，If-Match CAS、Idempotency-Key/body hash、目前同社群 active admin 與 subject 檢查。初次狀態以既有 member row 鎖序列化並明訂無紀錄的初始化 precondition；不得自行接受漏掉 CAS 的覆寫。

禁止自核發，以可信 admin/member binding 判定，不靠暱稱；不明確的綁定不得自動猜測。私人核發原因與 before/after/version 只進既有 audit，receipt 只含歷史狀態/version。所有狀態、audit、receipt 同交易，舊 receipt 不恢復已撤銷認證。重播先驗目前 authority；UI 成功／未知結果後回讀目前狀態。

Access verifier 目前只在入站驗 JWT，AdminActor 沒有 member session expiry。新命令須在交易 revalidate callback 再驗同次 Access request、相同主體，保留 verifier 現有 clock tolerance，不調安全設定、不以 member session helper 假裝解決。逾期或權限失效必須 rollback，包括 replay。會員讀取仍沿現行 session DB-clock 檢查。

只建立 active／revoked 狀態與 aggregate version；沒有批次自動授勳、權限 grant、外部通知或收費。本人展示偏好與管理員認證事實分離，撤銷優先於展示。保留／刪除政策待既有資料責任流程決定，不承諾抹除歷史 audit。

## 後續驗收與發布門檻

純測試覆蓋門檻、有限安全整數、相同 Work 重送／多角色／UUID 大小寫、private／tenant／pending 排除、無效證據、獨立 opt-in、匿名省略、撤銷、不同圖示與最小 DTO。

未來 runtime 必測：Access 到期跨鎖、權限撤銷、CSRF、自核發、跨社群、CAS、key 衝突／lost-response replay、audit 原子 rollback、profile 隱私／封鎖與認證撤銷競態、session 期限、切換帳號、晚到 UI 回應；不允許 OG、PNG、快取或搜尋洩露徽章／件數。

[Schema 設計](member-recognition-schema-proposal.sql) 不是 migration。#1043 的 `190_google_identity.sql` 由 jason201385-commits 擁有；實際編號、runtime grants、release compatibility、data catalog、profile 儲存介面需協調後另開完整切片。不得改既有 numbered SQL 或借用 190。

此模組 descriptor 登記實際六檔與 runtime.full，無 public_exports／surfaces／產品 import。新增 module 的 baseline 未映射仍保留 full fallback，不宣稱 trusted CI 或 runtime registration 已完成。完整 typecheck／runtime／browser／發布驗收須各自如實記錄，純函式通過不代替它們。
