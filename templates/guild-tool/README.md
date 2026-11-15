# 我的公會工具

依平台[公會工具製作指南](https://freetwai.com/guild-tool.md)複製、建置、發布、預覽並加入；指南是部署限制、橋接與簽章設定的參考。

1. 複製本目錄的內容（包含隱藏的 `.github`）到自己的 Repo 根目錄，保留 `bridge.js`，修改頁面及 `freedom-tool.json`。
2. 使用 Node 24 執行 `npm run check` 和 `npm run build`；發布 `dist/` 後，依指南請會長或受委任成員預覽並加入。

GitHub 專案 Pages 的登錄網址須以斜線結尾：`https://<name>.github.io/<repo>/`。

`main.js` 的 `PLATFORM_ORIGINS` 列出允許嵌入工具的正式站與 staging 精確來源。

同一來源提供的所有內容都共用此工具的存取權，因此 `origin` 只接受網址根目錄，子路徑請使用 `sandboxed`。需要 `origin` 的工具請使用專屬自訂網域。
