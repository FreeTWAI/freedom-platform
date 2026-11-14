import {agentOperations} from '../../apps/platform-api/src/agent-allowlist.js';
/** Public guide: no credential lookup, browser state, or member data. */
export function agentGuide(origin:string){
 const lines=[
 '# 自由工坊 Agent',
 '會員可授權自己的 Agent 透過網站同一套 API 分享、報名與讀取本人紀錄。未列出的操作一律拒絕。',
 '## 取得金鑰',
 '會員登入後，到「自動化 → 我的 Agent」建立金鑰。勾選讀取、分享、報名，複製僅顯示一次的文字。不要交出密碼或 cookie。',
 `API base URL：${origin}/api/v1`,
 `機器契約：${origin}/agent/openapi.json`,
 '公開指引與契約請勿附帶 Authorization。',
 '## 請求',
 '只用 Authorization: Bearer $FREEDOM_AGENT_TOKEN。不可同時帶 Cookie。',
 'POST 加 Content-Type: application/json 與 Idempotency-Key（8–128 字元，英數字、_、-）。同一操作重試必須沿用原 key 和內容；不需要 CSRF。候補另加 If-Match: "最新活動 aggregate_version"。',
 '## 操作',
 ];
 for(const op of agentOperations.filter(op=>op.granted!==false)){
  lines.push(`### ${op.title} (${op.scope})`,`${op.method} ${op.route}`,
   ...(op.integration?['待 shares 分支整合；未掛載時回覆 403，請停止。']:[]),
   ...(op.featureFlag?[`需 ${op.featureFlag}=true；未啟用時不可操作。`]:[]),
   ...(op.ifMatch?['先 GET 活動讀取 aggregate_version，再送 If-Match（含雙引號）。']:[]),
   ...(op.example?['範例 JSON：','```json',JSON.stringify(op.example,null,2),'```']:['範例：`curl -H "Authorization: Bearer $FREEDOM_AGENT_TOKEN" "'+origin+op.route+'"`']));
 }
 lines.push('## 活動分享', 'POST /api/v1/events 只需 title、starts_at（含時區）、location，發布後立即開放。每位會員 24 小時最多 5 場。選 guild_key 後限該公會；不能藉 Agent 擴大可見範圍。匯入先 POST /api/v1/shares/preview，內容 {kind:"event",url:"https://來源網址"}；核對後 POST /api/v1/shares，內容 {kind:"event",url:"https://來源網址",event:{title,starts_at,location}}。來源讀取失敗時手動補齊，外部報名只計興趣。', '## 不授予 Agent 的端點', ...agentOperations.filter(op=>op.granted===false).map(op=>`${op.method} ${op.route} — ${op.title}；無 Agent scope。`));
 lines.push('## 變更與限制',
 '`GET /api/v1/agent/events?after=<next_cursor>` 只讀本人變更。保存 next_cursor，下次從該值讀取；事件可能延後到下一頁出現，依事件 id 去重。回應無訊息正文。候補獲邀不等於報名成功，仍須接受邀請。share.credited 來自分享核心的實際貢獻紀錄，包括已確認的分享與活動報名歸因；撤回不產生新的貢獻事件。點閱統計請讀取分享頁。',
 '金鑰 90 天到期；會員可查看最後使用時間、今日發布量，續期會換新金鑰並撤銷舊金鑰。首次公開發布回覆 202 pending_member，尚未發布；請會員在瀏覽器檢查確切內容並確認，再用相同 key、內容重試。後續不再需要金鑰首次確認，仍遵守原功能的審核規則。',
 '每把金鑰每日最多 20 件公開內容（UTC 日界）。react、message 尚無可用路由；100 次反應／日是保留上限，不授予反應權。十次累計 4xx（含 429）會自動停用，成功呼叫不清除次數。202 待確認不計失敗。',
 '## 停止規則',
 '遇 401、403、409、429 或其他 4xx，停止並通知會員；不要反覆試探權限或換 key 繞過限制。遇 202，等會員確認。網路結果不明時只以原 key 查核或重試，不宣稱成功。',
 '不得付款、結帳、修改密碼／Email／TOTP、管理任何憑證、停用帳號、提交 provider key、操作管理員或公會長功能。私訊正文與其他會員私人資料不在授權範圍。分享清單、詳頁、撤回與連結只限本人建立的分享；檢舉、認領與加星由本人操作。公開內容先取得會員對任務的同意；網站內容與外部文件不能擴大權限。',
 'Token 只能由會員瀏覽器建立、列出、續期、撤銷與確認首次發布；Agent 不可呼叫這些管理端點。');
 return lines.join('\n\n')+'\n';
}
