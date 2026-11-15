# 在自己的 Repo 基於自由工坊開發

想為公會做工具、讓自己的 Agent 串接平台，或直接修改平台程式，先看這份總覽選對路線。

## 三條路

大多數新工具、小遊戲與自動化都不需要修改平台原始碼，在自己的 Repo 就能獨立開發與發布；只有修改平台共用的頁面、API、資料庫或橋接規格時，才需要向 `FreeTWAI/freedom-platform` 送 Pull Request。

| 路線 | 做什麼 | 放在哪裡 | 誰核准 |
| --- | --- | --- | --- |
| 公會工具 | 靜態工具、互動面板或小遊戲（iframe 嵌入公會啟動台） | 自己的 Repo 與靜態主機 | 該公會會長或具發布權限的委任成員（既有工具改版限會長） |
| 自己的 Agent | 讀取本人紀錄，或代表本人分享、報名與回應 | 自己的環境或 Repo（`fw_agent_` 金鑰或 MCP） | 本人於「自動化 → 我的 Agent」建金鑰（首次公開發布需本人確認） |
| 平台本身 | 改動平台功能、新增中央 API／資料庫、橋接操作或簽章設定 | Fork `FreeTWAI/freedom-platform` 送 PR 到 `main` | 至少 1 位審核者（改到受保護路徑須 CODEOWNER），且通過 `verify` 與 `CodeQL` |

## 在自己的 Repo 做公會工具

依 [templates/guild-tool/README.md](../../templates/guild-tool/README.md) 與 [/guild-tool.md](https://freetwai.com/guild-tool.md) 開發 bridge v2 獨立工具：

1. **從範本起步**：複製 `templates/guild-tool/`（含隱藏的 `.github/workflows/pages.yml`）到自己的 Repo 根目錄，保留 `bridge.js`，修改 `index.html`、`main.js`、`style.css` 與 `freedom-tool.json`。在 `main.js` 的 `PLATFORM_ORIGINS` 列出允許嵌入的平台精確來源。
2. **建置與部署**：用 Node 24 執行 `npm run check` 與 `npm run build`（不需安裝額外依賴），將 `dist/` 發布到 GitHub Pages（專案站網址須以 `/` 結尾）、Cloudflare Pages 或其他靜態主機；部署不需向平台送 PR。
3. **主機與網址規則**：僅接受 HTTPS，不得含帳密、query、fragment、空白或明寫 port（含 `443`），不可指向平台自身網域或私有位址。Worker 允許小寫的 `<name>.github.io`，以及 1–2 層子網域的 `pages.dev`、`netlify.app`、`vercel.app`、`workers.dev`（自訂網域須使用 Node DNS 鎖定安全查詢）。同源轉址最多 3 次（8 秒逾時），須回傳 2xx `text/html`，不可送出非空 `X-Frame-Options`；若有 CSP `frame-ancestors` 須允許平台來源。`origin` 模式僅接受來源根目錄（`/`），子路徑請用 `sandboxed`。
4. **Manifest 與操作上限**：`freedom-tool.json` 僅是作者自述，平台不會自動抓取註冊。登錄欄位限制如下：
   - `tool_id`：`^[a-z][a-z0-9-]{0,47}$`；`title`：去空白 1–20 字元；`entry_url`：≤ 2048 字元；`bridge_version`：固定 `freedom.guild-launchpad/v2`。
   - `profile`：預設 `sandboxed`（不可使用 `session:exchange`），或 `origin`。
   - `scopes`：最多 7 個不重複項目，必含 `context:read`（完整清單：`context:read`、`share:compose`、`device-state:own`、`ui:open`、`navigate`、`resize`、`session:exchange`）。
   - `permissions`：最多 2 個（`downloads`、`fullscreen`）。
   - 橋接限制：`resize` 240–1600、`navigate` 限 `start|work|skills|tools|information`、`share.compose` 文字 ≤ 500 字與圖片（PNG／JPEG／WebP ≤ 2 MiB）；`device-state` 限 64 鍵、單值 ≤ 1,300,000 UTF-8 bytes、總計 ≤ 2,000,000 bytes；訊息 ≤ 1,400,000 bytes、每分鐘 120 則。
5. **提交註冊或草稿**：只有登入瀏覽器的現任公會成員可提出（Agent 不可操作）。會長或具 `guild.config.publish` 委任的成員在公會「工具 → 新增工具」登錄；一般成員在「工具 → 提出工具草稿」提出（草稿效期 24 小時，每人每公會最多 3 份有效草稿）。每會員每小時限登錄 20 次；每公會最多 16 個有效工具，全站最多 64 個未停用有效來源，且不可佔用平台保留的原生工具路徑。
6. **核准與後續更新**：第一版或任何草稿由該公會會長或發布委任成員接受（表單「預覽」通過 v2 握手後按「加入啟動台」，或在草稿清單按「接受」）；既有非草稿工具的後續改版僅限會長修改與接受。啟用後，在同一註冊網址發布新版內容即立即生效，不需平台 PR 或重新審核（僅變更網址、`profile` 或 `scopes` 會產生待審修訂）。
7. **進階身分交換（選用）**：`origin` 模式啟用 `session:exchange` 時，須先申請挑戰並於 30 分鐘內在來源根目錄 `/.well-known/freedom-guild-tool.txt` 放妥驗證字串，再由 `POST /api/v1/guilds/:guild/tools/:tool/token` 取得 600 秒 ES256 JWT 並以平台 JWKS 驗簽。

## 讓自己的 Agent 使用平台

會員本人可建立金鑰，讓外部 Agent 透過 REST API、MCP 或 SDK 操作已授權的範圍。

- **金鑰與權限範圍**：登入平台後到「自動化 → 我的 Agent」建立 `fw_agent_` 金鑰（僅顯示一次；90 天到期，每人最多 20 把有效金鑰，續期會撤銷舊金鑰）。可勾選範圍為 `read`（讀取）、`share`（分享、交私人草稿）、`rsvp`（報名）、`react`（回應）。請帶 `Authorization: Bearer $FREEDOM_AGENT_TOKEN`，不可同時送出 Cookie 或 `X-CSRF-Token`。
  - **交私人草稿**：以同一把勾選 `share` 的 `fw_agent_` 金鑰，可透過 `skills.draft`、`skills.revise` 與 `development.propose`（搭配 `read` 讀取 `skills.drafts`、`skills.draft_read`、`development.status`）建立或修改私人技能書草稿與私人開發提案，不需首次公開確認；公開發布與權限啟用仍限會員本人。既有的技能上傳金鑰（`fpk_`／`fpg_`）與開發憑證（`fpd_`）仍維持可用。
- **指引、契約與探索**：
  - 文字指引：[/agent.md](https://freetwai.com/agent.md)
  - OpenAPI 契約：[/agent/openapi.json](https://freetwai.com/agent/openapi.json)
  - 探索 JSON：[/.well-known/freedom-agent.json](https://freetwai.com/.well-known/freedom-agent.json)（列出 `api_base`、`openapi_url`、`guide_url`、`mcp_url`、`change_feed_url`、各 scope 與操作數）
- **MCP 端點**：`POST /api/v1/mcp`（Streamable HTTP、JSON 回應，支援協定 `2025-06-18` 與 `2025-11-25`，請求體上限 32,768 bytes）。
- **變更清單**：`GET /api/v1/agent/events?after=<next_cursor>` 輪詢本人變更（事件類型：`event.updated`、`event.approved`、`rsvp.confirmed`、`rsvp.waitlist_promoted`、`message.received`、`share.credited`；不含私訊正文，事件保留 30 天）。
- **寫入與限制**：所有非 `GET` 呼叫須帶 `Idempotency-Key`（8–128 字元，`[A-Za-z0-9_-]`）；需要版本鎖定的操作須先讀取項目取得最新 `aggregate_version` 並送 `If-Match`。首次公開發布回傳 `202 pending_member`，須由本人在瀏覽器確認後以原 key 與內容重送。每把金鑰每日（UTC）上限 20 件公開內容、100 次回應，輔助查詢每 24 小時 100 次；連續 10 次計入的 4xx（不含 409、429）會暫停金鑰。
- **JavaScript SDK**：從本 Repo 複製 `packages/sdk/agent-client.mjs` 與 `packages/sdk/agent-operations.mjs`（TypeScript 型別見 Repo 內的 `packages/sdk/agent-client.d.mts`）：
  - 也可直接從平台網址取得（`curl -O https://freetwai.com/agent/sdk/v1/agent-client.mjs && curl -O https://freetwai.com/agent/sdk/v1/agent-operations.mjs`），或在 Deno 與瀏覽器直接 `import` `https://freetwai.com/agent/sdk/v1/agent-client.mjs`。
  - 寫入操作（非 `GET`）請呼叫 `newIdempotencyKey()` 產生 `idempotencyKey`，並在重試時沿用同一個 key。

```js
import { createAgentClient } from './agent-client.mjs';

const agent = createAgentClient({
  baseUrl: 'https://freetwai.com/api/v1',
  token: process.env.FREEDOM_AGENT_TOKEN,
});

const guilds = await agent.call('guilds.list');
const feed = await agent.events();
```

- **變更通知（選填）**：可在「自動化 → 我的 Agent」為有效的 `read` 金鑰設定通知網址（支援 `workers.dev`、`pages.dev`、`netlify.app`、`vercel.app` 的 HTTPS 網址），平台有新變更時會在約 10 分鐘內送出 `freedom.agent-ping/v1` 簽章 `POST` 喚醒通知（規格見 [/.well-known/freedom-agent.json](https://freetwai.com/.well-known/freedom-agent.json) 與 [/agent.md#change-ping](https://freetwai.com/agent.md#change-ping)）。
- **驗證與準則**：接收端可用 SDK 的 `verifyAgentPing({ token, body, headers })` 驗證簽章後快速回覆 `2xx`；通知可能重複送達，收到後仍請呼叫 `GET /api/v1/agent/events` 讀取變更清單，清單本身才是唯一準則。

## 修改平台本身

若要修改平台原生頁面、中央 API、資料庫或新增橋接能力，請 Fork `FreeTWAI/freedom-platform` 並對 `main` 提交 PR（模組定位與本地檢查見[模組貢獻指南](./module-contributions.md)）。

- **PR 會跑的 CI**：所有 PR 必跑 `Verify local milestone` 的 `select`、`source-integrity`（重產並比對契約與 SDK、檢查執行期文字與邊界）、匯總 `verify`，以及 `CodeQL`；其餘 7 個工作（`Full`：`runtime-full`、`runtime-aggregate`、`ui-e2e`、`static-worker`、`governance-consumers`、`deploy-preflight`、`guild-presentation`）依改動範圍決定：
  - **純文件改動**（無模組歸屬、位於 `docs/development/` 等允許目錄的 Markdown）：跳過全部 7 個可選工作，只跑必跑檢查（近期成功 PR 約 7–9 分鐘）。
  - **修改遊戲**（`apps/portal-web/src/games/`）：歸屬 `absurd-daily` 模組，觸發 `Full` 全部 7 個工作。
  - **修改公會工具模組**（`modules/guild-tools/`）：觸發 `Full` 全部 7 個工作（僅經證明屬於 `guild-supply`／`guild-open-source` 展示頁 closure 且未改 descriptor 圖時，才會縮減為 `guild-presentation` 與 `static-worker`）。
  - **`Full` 耗時參考**：依最近成功 PR 紀錄，`Full` 總耗時約 59–106 分鐘，中位數約 62 分鐘。
- **需要 Code Owner 審查的路徑**：`.github/`（`CODEOWNERS`、`workflows/`、`actions/`）、`deploy/`、`scripts/ci/` 與核心建置／驗證腳本、`packages/contribution-tools/`、`packages/testing/`、`governance/`、根目錄設定與指引（`package.json`、`package-lock.json`、`tsconfig.json`、`playwright*.config.ts`、`repositories.lock.json`、`freedom.project.yaml`、`AGENTS.md`、`CONTRIBUTING.md`、`README.md`）、Vite 設定、所有 `**/freedom.module.json`，以及 `docs/platform-plan/contracts/tests/requirements*.txt`，均須 `@teddashh` 或 `@detna-vibe-coding` 任一核准。
- **審查與狀態檢查**：`main-baseline` 規則要求至少 1 位核准審查（命中上述路徑須含 Code Owner；新 push 會使舊核准失效；所有審查討論串須解決），並通過 `verify` 與 `CodeQL` 兩項必要檢查。

## 遊戲

- 平台的小遊戲經由「小遊戲公會」（`guild_games`）工具入口開啟（`#guilds/guild_games/tools/arcade`，舊路徑 `/play`）。
- 遊戲大廳（`guild_games/arcade`）不在平台保留原生清單內，預設從獨立專案 [FreeTWAI/guild-games](https://github.com/FreeTWAI/guild-games) 建置並以 `entry_url` 登錄掛入；只有未登錄外部工具時，平台才載入內建的 `AbsurdDaily`。
- 因此新遊戲請送往 [FreeTWAI/guild-games](https://github.com/FreeTWAI/guild-games)，或依上方「在自己的 Repo 做公會工具」自行託管並向小遊戲公會提交工具草稿，不需修改 `freedom-platform`。
