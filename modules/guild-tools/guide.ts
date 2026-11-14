export function guildToolGuide(origin:string){return `# 公會工具：20 分鐘起步

工具是作者獨立部署的靜態網站。平台只登錄網址及允許功能，不載入遠端 JavaScript 到平台頁面。公開遊玩不用入會。平台密碼、Cookie、CSRF、長效 Agent 憑證絕不能送入工具。

## 建立與發布

1. 複製 freedom-platform 的 templates/guild-tool 內容到自己的 Repo 根目錄，包含隱藏的 .github/workflows/pages.yml；保留 bridge.js。修改 index.html、main.js、style.css 及 freedom-tool.json，讓名稱、代號與所需功能符合自己的工具。
2. 使用 Node 24 在 Repo 根目錄執行 npm run check 和 npm run build；不需安裝依賴，dist/ 是完整靜態網站。main.js 的 PLATFORM_ORIGINS 列出允許嵌入工具的正式站與 staging 精確來源；如果使用另一個平台，請先加入它的精確 origin。沒有清單或來源不符時，工具不會連線或傳訊息。
3. GitHub Pages 將 Source 設為 GitHub Actions，推送 main 後由隨附 workflow 檢查、建置並發布 dist/；或將 dist/ 部署到 Cloudflare Pages。部署及雲端帳號由作者自行控制，不需向平台送 PR。20 分鐘不含首次主機帳號、創作實際工具和等待會長。
4. 網站發布後，公會長或獲發布委任的成員在公會「工具 → 新增工具」填名稱與網址，必要時在進階設定選代號、功能與模式；按「預覽」，確認工具連線，再按「加入啟動台」。manifest 是作者自述，平台不會替你帶入其設定。只有會長可修改既有登錄及接受修訂。

範本畫面只顯示公會名稱、登入狀態和簡短操作結果；原始回應供開發者在瀏覽器主控台查看。

本機測試可將 LOCAL_PLATFORM_ORIGIN 設為帶 port 的 http://127.0.0.1 來源，執行 node build.mjs --test-platform-origin "$LOCAL_PLATFORM_ORIGIN"；這個來源只加入產生的 dist，不要發布測試建置，發布前重新執行 npm run build。

平台 Worker 接受 HTTPS 的 \`<name>.github.io\`，以及一或兩層子網域的 \`pages.dev\`、\`netlify.app\`、\`vercel.app\` 與 \`workers.dev\`；網域限小寫 DNS 名稱，網址不得明寫 port（包含 443）。自訂網域須使用 Node 的 DNS 鎖定安全 transport。GitHub 專案 Pages 請填 \`https://<name>.github.io/<repo>/\`。Cloudflare Pages 的 \`dist/_headers\` 讓隔離 frame 可以載入模板的模組。entry_url 必須直接回 HTML，不含帳密、query、fragment 或非標準 port；禁止私有位址與平台自己的網域。同一網站內最多接受三次重新導向，轉到其他網站會被拒絕；最好直接填最後的網址。網站不能拒絕 frame 嵌入。ES modules、圖片 canvas、worker 在 opaque-origin frame 需要主機允許 CORS。

## Manifest

在網站保留 freedom-tool.json（作者自述，不是執行權限）：
\`\`\`json
{"tool_id":"my-tool","title":"我的工具","bridge_version":"freedom.guild-launchpad/v2","profile":"sandboxed","scopes":["context:read","share:compose","device-state:own","ui:open","navigate","resize"],"permissions":[]}
\`\`\`

註冊畫面填名稱、網址；進階設定可選工具代號、scopes、downloads/fullscreen 及 profile。預設 sandboxed，不開額外瀏覽器權限。SDK 應以平台 init 的 tool_id/guild_key 為準。manifest 是作者規格，平台不會自動下載或執行它，也不會由它擴權。

## SDK

複製 [client.js](${origin}/guild-tool/v2/client.js)，避免跨站依賴；也可由此版本網址匯入。
\`\`\`js
import {createGuildTool} from './bridge.js';
const tool = createGuildTool({platformOrigins: ['${origin}']});
await tool.ready();
const context = await tool.request('context.get', {});
// public guild/guild_name/tool/theme/locale/signed_in；會員只有此工具專屬 subject 和此公會 tier。
await tool.request('device-state.put', {key:'note', value:'我的筆記'});
const {value} = await tool.request('device-state.get', {key:'note'});
await tool.request('device-state.put', {key:'note', value:null}); // 刪除自己的鍵
const receipt = await tool.request('share.compose', {text:'本次成果'});
// 使用者按正常「發布」後才有 {status:'published', share_id, url}；也可能 cancelled。
await tool.request('ui.open', {panel:'game-upload'}); // 原生會員上傳，不將私人來源交給工具
await tool.request('resize', {height:700}); // 240..1600
await tool.request('navigate', {action:'tools'}); // start/work/skills/tools/information
\`\`\`

share.compose 支援 kind repository/event/work/link、HTTPS url ≤2048、text ≤500，另可帶 image Blob（PNG/JPEG/WebP，≤2 MiB）；不接受作者、信用、計數或其他 source。Host 設定 source，平台 API 重驗已啟用的工具與 share:compose。訪客先保留文字／圖片草稿於平台分頁儲存，登入後回到相同工具開啟原分享盒，仍須本人按發布；登入換帳號會使舊 frame promise 失效，收據由平台顯示。每個操作需要對應 scope。context:read、share:compose、device-state:own、ui:open、navigate、resize，加上 origin 專用 session:exchange 是完整清單，沒有 generic fetch 或 URL/method proxy。

## Wire 與限制

Host 每次載入送 {version:'freedom.guild-launchpad/v2', type:'init', tool_id, guild_key, nonce}。工具 request 加入 type:'request', request_id, operation, payload，原樣回傳四個 binding 欄位。Response 是同 binding 與 request_id，type:'response'，以及 ok:true/result 或 ok:false/error:{code,message}。必須驗 parent window、exact platform origin、版本、工具、公會和 nonce。SDK 做這些檢查；掛載／重載改 nonce，舊 pending 失效。v1 不相容，不能換版本字串假裝 v2。

預設 sandbox allow-scripts：無 cookies、localStorage、sessionStorage、top navigation、popup 或表單權限。所有持久化走 device-state。每 value 1,300,000 bytes UTF-8、每工具／會員裝置 2,000,000 bytes、64 keys；不列舉其他平台儲存。完整 JSON message 1,400,000 bytes；每分鐘 120 則（包含錯誤訊息）、最多 8 未完成請求、每次掛載最多 1024 request IDs。重複 ID 不重做。Host 不保證工具作者的未來發布內容安全。

## 會長加入

公會 → 工具 → 新增工具，填名稱與 HTTPS 地址 → 預覽 → 加入啟動台。預覽只有公開 context；需要 v2 握手才能按加入。委任成員可登錄並接受新工具的第一版；既有工具的重新登錄及修訂接受都限會長操作。新來源、profile 或 scopes 改變會產生 pending revision，需會長再確認。接受後重新載入平台文件以更新 CSP；新版本同網址發布不需平台動作。

路由 #guilds/<guild_key>/tools/<tool_id>。每公會 16 工具，全站 64 origins；每會員每小時 20 次網址檢查。工具上方顯示來源與功能。會長可停用；三位不同會員檢舉自動停用。停用後新操作被拒絕，已開頁面最遲下一次 5 秒輪詢移除 frame。

## 獨立來源與工具身分

同一來源提供的所有內容都共用此工具的存取權，因此 origin 只接受網址根目錄，子路徑請使用 sandboxed。需要 origin 的工具請使用專屬自訂網域。origin 允許自己的 Cookie/儲存空間，必須控制整個 origin。進階設定選「獨立來源」→建立來源驗證→把 contents 放到回傳的根目錄 /.well-known/freedom-guild-tool.txt → 30 分鐘內預覽。API：POST /api/v1/guilds/:guild/tools/origin-challenges，body {entry_url}；登錄多帶 origin_challenge_id。驗證綁定本次登錄者、公會、origin；平台網址禁止使用。每次修改登錄須重新驗證、由會長接受。

只有已啟用 origin 工具且會長明確允許 session:exchange（進階設定的「工具身分」）可以呼叫 tool.request('session.exchange', {})；context:read 單獨不授予 token。未安裝簽章金鑰時隱藏此選項。主頁用 Cookie + CSRF 呼叫 POST /api/v1/guilds/:guild/tools/:tool/token；Agent 用 read scope 的 fw_agent_ Bearer 及 Idempotency-Key 呼叫同一個 API，空 JSON body。混用 Cookie 與 Bearer 一律拒絕。長效憑證從不傳給工具。

Worker 從 secret FREEDOM_GUILD_TOOL_SIGNING_KEY 安裝工具專用的 P-256 私有 JWK（含 kid）；沒有金鑰或金鑰無效時不啟用交換，API 回 503 tool_tokens_unavailable。平台操作者可在平台 Repo 以 Node 24 產生金鑰，將 WORKER_ENV 設為目標 Wrangler 環境後直接輸入 secret，不將金鑰寫入 repo 或日誌：

\`\`\`sh
node scripts/generate-guild-tool-signing-key.mjs | npx wrangler secret put FREEDOM_GUILD_TOOL_SIGNING_KEY --env "$WORKER_ENV"
\`\`\`

Node 安裝者可提供 ToolSigner（modules/guild-tools/tokens.ts 的 CryptoKey port）；已存在的 execution/machine token 不可當工具 token。換鑰使平台不再驗證舊 token，外部離線快取仍可能接受未到期 token；需要即時權限時使用 status。

回應 {access_token, token_type, expires_in:600, audience, issuer}。JWT 用途 freedom-guild-tool+jwt / guild-tool-identity，audience 是此登錄的 UUID，含 tool_id/guild_key/revision、工具專屬 sub、目前 tier、jti/iat/exp；只有 context:read，不授予平台寫入或任意後端操作。只放記憶體，不放網址或持久化儲存。

後端可複製 [verify-token.mjs](${origin}/guild-tool/v2/verify-token.mjs)，用自己設定的 issuer/audience 和 [JWKS](${origin}/.well-known/guild-tool-jwks.json) 驗證 signature、alg、typ、purpose、期限、scope。不要信任 caller 提供的 issuer/JWKS URL。私有讀寫前還須 POST ${origin}/api/v1/public/guild-tool-token/status，JSON {token,audience}（不要把工具 token 放 Authorization header）；只有 active:true 才繼續。工具停用、版本變更、會員停權、登入或 Agent 撤銷、tier 改變會使狀態失效。離線驗證單獨使用有最多 10 分鐘殘餘效力，不保證立即撤銷。token 絕不通用於中央 API。

管理員在公會管理的「外部工具」可填原因立即停用；會長可在工具頁停用。登錄與每個 revision 及檢舉/停用記錄為 append-only；管理員操作另寫平台管理稽核。
`;}
