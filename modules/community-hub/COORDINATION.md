# 社群資料協調

透過 PR 提供缺少的 Meta Muse AI LINE 邀請、兩個 Facebook 社團名稱與邀請，以及其他 Discord 伺服器名稱與邀請。附管理者確認及公開來源，不提交私人對話或個資。

編輯 groups.ts 對應穩定 id，核對完整名稱與 https 邀請網址後才將 TODO 改為 active；沒有網址則保留 null。只接受 line.me、discord.gg、discord.com、facebook.com。不可猜測網址；邀請是否有效仍需管理者確認。原有入口共用 communityLinks，不另建副本。

新增工作入口須使用既有 TabId，更新五語短說明並跑 runtime 測試。頁面描述的是參與方向，不從群聊推定完成進度。

未來管理員線上編輯連結只是提案，需要另外設計 schema、API、權限、稽核與驗證。本次完全未實作，不授予任何後端或部署權限。
