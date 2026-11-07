# 技能書分享介紹與作者名片（2026-11-07）

本次涵蓋全部 55 本目錄技能書，每本 100 則，共 5,500 則分享介紹。每一句都以第一次看見 Repo 的人為對象，說清主要用途、解決的問題與使用價值；不再把 gate、版本、測試、貢獻規範或次要功能當成獨立介紹。

影片自動化工具包第 63 則原為「每個範例都可以重跑：在影片自動化工具包裡改了什麼、結果怎麼變，一目了然。」現改為：

> 讓工具處理重複工，才能把更多心力放回題材與敘事。影片自動化工具包結合影片製作方法與自動化工具，從企劃到剪輯、發布素材都能按自己的頻道需求組織，讓做片更有延續性。

## 編寫與複核

每本先核對固定版本的 README／SKILL 與平台來源資訊，再編寫 10 個情境／定位句及 10 個完整用途／價值句，組成 100 則。刻意重述核心定位，避免為了變化而偏離主題。55 本的 1,100 個基礎句均有原寫作者及另一位 Agent 複核；第二輪修正 13 本、805 則中的術語、能力誤讀及語序。

全 5,500 則檢查數量、唯一性、字數與組合一致性。第二位 Agent 另實讀每本第 1、63、100 則，共 165 則組合；這不等同逐句獨立閱讀全部 5,500 則，也不代表已執行上游軟體。

上傳精靈、聊天提示、下載用 SKILL.md 與 protocol 共用同一編寫標準。格式驗證仍不能自動證明敘述真實，提交者需要依來源複核每一句；設計文件、手動手冊與可執行工具必須分清。

## 首屏與作者名片

書名下方放置大字作者、Star、Fork、分享。首屏分享按鈕與頁面原分享入口使用同一燈箱，保留 `?intro=` 選句及鍵盤焦點返回。

作者按鈕點擊後才讀取名片，使用既有 `MemberECard` 呈現。已核實原創／共同原創作者優先；未有作者認領時，以既有 GitHub 更新取得的來源 Repo／擁有者固定 ID 與目前 OAuth 綁定精確對應，標明「來源帳號」，不把暱稱、自填 GitHub 聯絡資料或投稿者自述關係視為作者證明。

會員投稿使用收錄版本保存的來源帳號固定 ID，標明「收錄來源帳號」；這是該版本的來源，不宣稱目前 Repo 擁有權或已核實原創作者。新投稿沿既有匯入讀取保存對應，不增加名片點擊時的 GitHub 請求；舊資料缺少固定 ID 時，仍需要有效來源快取才能對應。

只顯示會員已公開的名片。身分有歧義、Repo 待重查、認領爭議、會員停用或名片撤回時不返回舊名片。API 回應不快取，每次開啟重新檢查；關閉、切到背景或離頁會清除燈箱內容。尚無公開名片時仍可查看來源 GitHub。

## 各書核心定位與固定來源

| 技能書 | 分享介紹主軸 | 來源 |
| --- | --- | --- |
| [agent-kit](../../modules/community/share-introductions/agent-kit.json) | AI 工具接自由工坊的開發起點；共用client/protocol與本機示範會員查詢。 | [原作](https://github.com/FreeTWAI/freedom-agent-kit/blob/201fdab8017e2850bafc7b2f1e8dec7e4c0d6233/README.md) |
| [ai-avatar-bot](../../modules/community/share-introductions/ai-avatar-bot.json) | 把能用語音或文字回答網站知識的動畫虛擬角色嵌入網站。 | [原作](https://github.com/YuriCrystal/ai-avatar-bot/blob/d9276a227ea342eebfb9967f9245256406de7d23/README.md) |
| [ai-manga-translator](../../modules/community/share-introductions/ai-manga-translator.json) | 在瀏覽器把外語漫畫翻成可直接疊在原圖上的譯文，並帶入跨頁人名與劇情。 | [原作](https://github.com/greenQQQ/ai-manga-translator/blob/964734a9366b872b4c7ac2069be72124eb3d332e/README.md) |
| [ai-sister](../../modules/community/share-introductions/ai-sister.json) | 本機優先桌面記憶助理，經同意記錄畫面文字、搜尋看過資訊並連回來源。 | [原作](https://github.com/teddashh/AI-Sister/blob/5e03e2bb10b2ff3f843cb029334a0e338c88cfed/README.md) |
| [aiwff-runtime](../../modules/community/share-introductions/aiwff-runtime.json) | 本機 AI 任務引擎，接 Claude CLI 後交辦背景工作、在WebUI看進度並保存成果檔。 | [原作](https://github.com/zaxardery8011-design/aiwff-runtime/blob/94b94abf6d0656de0a5998da4c4141d2e9971a7c/README.zh-TW.md) |
| [anti-gambling-trader-tw](../../modules/community/share-introductions/anti-gambling-trader-tw.json) | 交易紀錄的本機統計分析與投資反詐工具，檢視績效是否有證據、風險和宣稱是否可疑。 | [原作](https://github.com/mars-tw/anti-gambling-trader-tw/blob/9d938b64c80ee29363aed496ba4e61d9110a7222/README.md) |
| [autovtuber](../../modules/community/share-introductions/autovtuber.json) | 以角色表單及具使用權的底模，串起概念圖、人設與 VRM 模型生成的工作站。 | [原作](https://github.com/Lee-unhn/AutoVtuber/blob/1c4d045d5bf602561953adfe914e033364131600/README.md) |
| [bidding-radar-concept](../../modules/community/share-introductions/bidding-radar-concept.json) | 政府標案與補助搜尋工具的開源概念設計，整理公開資料來源、條件篩選與公司資格比對的實作方向。 | [原作](https://github.com/greenQQQ/bidding-radar-concept/blob/a02db6cb6ef754bff3622e88eb10167cf772ca72/README.md) |
| [career-guide](../../modules/community/share-introductions/career-guide.json) | 手動方向探索手冊，從現況與時間出發比較方向、本人選擇可完成的小成果並回顧。 | [原作](https://github.com/FreeTWAI/freedom-skill-career-guide/blob/4f7f7fafec4237ba8c63986ec2c07f026e4e34a8/SKILL.md) |
| [coding-audit-harness](../../modules/community/share-introductions/coding-audit-harness.json) | AI開發驗收框架，將需求對應驗收，實際重跑並把結果綁定程式版本，讓完成宣稱有可查證據。 | [原作](https://github.com/weiwei-alvin/Coding-Audit-Harness/blob/c4526624f65530c009c57b9add233b1060fa01df/README.md) |
| [commercial-production](../../modules/community/share-introductions/commercial-production.json) | 把品牌與商品需求轉成拍攝企劃、鏡位和交付規格的製作入門手冊。 | [原作](https://github.com/FreeTWAI/freedom-skill-commercial-production/blob/7c25e5e5db060950b846ac48bfe44bc5cf32f117/SKILL.md) |
| [community-ops](../../modules/community/share-introductions/community-ops.json) | 接待與活動實作手冊，整理歡迎流程、活動說明、分工與交接摘要。 | [原作](https://github.com/FreeTWAI/freedom-skill-community-ops/blob/44e14e93038caa640ce4ccc4ca22e6326757c24b/SKILL.md) |
| [editkin](../../modules/community/share-introductions/editkin.json) | 讓人與 AI 在可修改時間軸上協作的本機影片剪輯器原始碼。 | [原作](https://github.com/Hao0321/Editkin/blob/41163ea553f79fd58abe5d7bedea91af6a2d1c38/README.zh-TW.md) |
| [event-space](../../modules/community/share-introductions/event-space.json) | 為讀書會、聚會及小型展演整理場地、活動流程、動線與現場分工的手冊。 | [原作](https://github.com/FreeTWAI/freedom-skill-event-space/blob/574c00b651e89248876c2846484c105623076cac/SKILL.md) |
| [freedom-party-guild-lounge](../../modules/community/share-introductions/freedom-party-guild-lounge.json) | 現場活動互動網站，串起手機報到、角色名牌、大屏展示、本人選擇的現場媒合與破冰。 | [原作](https://github.com/davidni0729/freedom-party-guild-lounge/blob/3e86cfcbf4bbd7975be77878cf1aec960f29b169/README.md) |
| [ga4-lp-analytics](../../modules/community/share-introductions/ga4-lp-analytics.json) | GA4 著陸頁分析模板，以區段到達、捲動、CTA 點擊呈現訪客流失漏斗及改善待辦。 | [原作](https://github.com/kieiken/ga4-lp-analytics/blob/2c2b18d564a6bd6de24cd1057bed197af1b97c32/README.md) |
| [gemini-voice-lab](../../modules/community/share-introductions/gemini-voice-lab.json) | 以試聽回饋逐回合調整 Gemini 台灣口語配音，累積可重用的調聲方法。 | [原作](https://github.com/Rumi-3653/gemini-voice-lab/blob/c8f6933127ca1d6ba65d0ce47075cfab4b5a0285/README.md) |
| [hao-studio](../../modules/community/share-introductions/hao-studio.json) | Hao 的個人作品網站原始碼，整合瀏覽器遊戲、AI 創作工具與公開開發紀錄。 | [原作](https://github.com/Hao0321/Hao0321-Studio-WEB/blob/40766413d3263e80d573e7c7928e1816c9f441e0/index.html) |
| [hdsljp-api](../../modules/community/share-introductions/hdsljp-api.json) | 供開發者自行架設的人類圖命盤計算 API，將出生資訊轉為類型、權威、人生角色等命盤資料。 | [原作](https://github.com/kieiken/hdsljp-api/blob/a3fc3b4ff2a3acf0df541da1b83a3688e0be8a19/README.md) |
| [hrflow](../../modules/community/share-introductions/hrflow.json) | 開源人資管理系統，整合員工資料、排班、出勤與請假核准，讓團隊集中管理日常人事。 | [原作](https://github.com/tesdano-crypto/HRSystem-OpenSource/blob/a60cd7b14d25b5a8ab90574247e48a4b4038b11c/README.md) |
| [human-design](../../modules/community/share-introductions/human-design.json) | 共讀實作手冊，整理來源、不同解讀與生活反思，形成可討論的共讀筆記。 | [原作](https://github.com/FreeTWAI/freedom-skill-human-design/blob/74f4a7fc6e6abb2bf36a75980ee72448563385d4/SKILL.md) |
| [human-mode](../../modules/community/share-introductions/human-mode.json) | 結合辨識誤導論證的問答遊戲與五階 AI 提示 Skill，先保留自己的判斷再逐步求助。 | [原作](https://github.com/madeofroc-arch/AI-Detox-Center/blob/b2f5bc19f2f22b18285dfe360a5d77acbda63ca1/README.md) |
| [keynote-pptx-doctor](../../modules/community/share-introductions/keynote-pptx-doctor.json) | 診斷及修復導致 Keynote 無法開啟的 PPTX 結構問題，保留修復副本。 | [原作](https://github.com/kieiken/keynote-pptx-doctor/blob/b7d2a1299f2776e481681d8fa326095cae5053f6/README.md) |
| [line-persona](../../modules/community/share-introductions/line-persona.json) | LINE 原生 AI 分身框架，將本人設定的口吻與知識接入LINE bot，使用自選模型回答常見問題。 | [原作](https://github.com/zaxardery8011-design/line-persona/blob/d07131c9cb45f9037d272a176d7ce788542884f7/README.md) |
| [local-workspace-mcp](../../modules/community/share-introductions/local-workspace-mcp.json) | 讓一般ChatGPT對話透過私人MCP通道使用本機檔案與文件工具，從自有資料製作文件報表圖表。 | [原作](https://github.com/arumwu/local-workspace-mcp/blob/71dfd5d6c4884c218b0c2365eb68fb8dde5d7cc1/README.md) |
| [media-generator](../../modules/community/share-introductions/media-generator.json) | 把圖片、影片與音樂構想轉成適合目標生成平台的提示詞與製作安排。 | [原作](https://github.com/Hao0321/ai-media-generator/blob/edc8aa5227f4a58f9a3a88c7bf3e99bdda2a4361/SKILL.md) |
| [multi-ai-chat](../../modules/community/share-introductions/multi-ai-chat.json) | Chrome側欄外掛，協調已登入ChatGPT/Claude/Gemini/Grok分頁，做分送／交叉審查與整理。 | [原作](https://github.com/teddashh/multi-ai-chat/blob/3ebca72b35986a0f5c8772b12a74f826d4ddafe9/README.zh-TW.md) |
| [multi-ai-desktop](../../modules/community/share-introductions/multi-ai-desktop.json) | 多AI桌面工作台，使用既有登入網頁session，讓多家AI分送、提案、交叉審查及收斂。 | [原作](https://github.com/teddashh/multi-ai-chat-desktop/blob/0f0d044daf6785d0485e8fec8d1c8c579ecd57ab/README.zh-TW.md) |
| [music-mv](../../modules/community/share-introductions/music-mv.json) | 把歌曲情緒與聲音段落連到畫面、分鏡及製作分工的音樂 MV 入門手冊。 | [原作](https://github.com/FreeTWAI/freedom-skill-music-mv/blob/135560530626c13ccf5d13c299e683d7bd8f132a/SKILL.md) |
| [n8n-marketing-flows](../../modules/community/share-introductions/n8n-marketing-flows.json) | 可匯入 n8n 的行銷工作流模板，新聞彙整／貼文草稿／內容檢查等流程接自有模型服務後改用。 | [原作](https://github.com/YuriCrystal/n8n-marketing-flows/blob/46c8e2535430ebe1e9bb4d8b6b335465c4702ffb/README.md) |
| [open-seo-advisor](../../modules/community/share-introductions/open-seo-advisor.json) | 網站SEO健檢與建站顧問Skill/CLI，將技術問題整理成有優先順序的改善清單並提供建站流程骨架。 | [原作](https://github.com/mars-tw/open-seo-advisor-skill/blob/f6178d797b45705b5b77f83507366a72eac34bde/README.md) |
| [partnership](../../modules/community/share-introductions/partnership.json) | 訪談與提案手冊，將模糊需求變成受益者、範圍與小試作明確的一頁合作提案。 | [原作](https://github.com/FreeTWAI/freedom-skill-partnership/blob/40bde2433e7779dd402797104a09aec72f112810/SKILL.md) |
| [photo-border-remover](../../modules/community/share-introductions/photo-border-remover.json) | 在瀏覽器自動偵測並批次裁掉照片外圍白邊，再匯出 PNG。 | [原作](https://github.com/kieiken/photo-border-remover/blob/92df7927148ce6bab202114393365c8bc9e652d1/README.md) |
| [pos-pro](../../modules/community/share-introductions/pos-pro.json) | 小型零售離線優先POS，整合收銀、庫存、會員、進貨、帳務和營運報表。 | [原作](https://github.com/Hao0321/pos-pro/blob/2656945463e95d155fffca19de18014f5f0d75db/README.md) |
| [positioning-companion](../../modules/community/share-introductions/positioning-companion.json) | AI 對話自助定位工具；梳理經驗、限制及選擇，形成定位卡與能驗證方向的小實驗。 | [原作](https://github.com/jason201385-commits/positioning-companion/blob/d06da737b7ad10955b2f0d974bf4acf841492572/README.md) |
| [project-delivery](../../modules/community/share-introductions/project-delivery.json) | 專案規劃與回顧手冊，將需求拆成短迭代的責任、待辦、完成條件與交付成果。 | [原作](https://github.com/FreeTWAI/freedom-skill-project-delivery/blob/8fef03e153463a91e9253705becef6d3a744207e/SKILL.md) |
| [project-hub](../../modules/community/share-introductions/project-hub.json) | 個人本機專案與任務管理畫面，將 Claude Code/Codex 對話執行與工作內容放在一起。 | [原作](https://github.com/kieiken/project-hub/blob/cfe3ab221f03f84d334ae7b97608dd31f3e643be/README.zh-TW.md) |
| [project-template](../../modules/community/share-introductions/project-template.json) | 可運行Node.js新專案範本，含本機頁面、建置、測試與協作文件，用作獨立專案起點。 | [原作](https://github.com/FreeTWAI/freedom-project-template/blob/9bc7cee3f98d21da3156e5a67bfa63dc63a4615e/README.md) |
| [projection-mapping](../../modules/community/share-introductions/projection-mapping.json) | 把投影光雕構想整理成場勘、畫面分區、素材與播放安排的製作手冊。 | [原作](https://github.com/FreeTWAI/freedom-skill-projection-mapping/blob/4d43669501aabbaf329989d32e4e404a80f1a539/SKILL.md) |
| [reconciliation](../../modules/community/share-introductions/reconciliation.json) | 對帳工作手冊，逐筆比對自有訂單與收款來源，整理差異及待確認事項。 | [原作](https://github.com/FreeTWAI/freedom-skill-reconciliation/blob/0cb216a37f1ba5a00cfe467053130f31b710d9cf/SKILL.md) |
| [security-scanner](../../modules/community/share-introductions/security-scanner.json) | 對程式碼、網站及獲授權系統使用既有掃描器，統整排序成單一可讀報告。 | [原作](https://github.com/teddashh/ai-security-scanner/blob/e0e69ba01ec16367982bb28fac08c53749618250/README.zh-TW.md) |
| [short-drama](../../modules/community/share-introductions/short-drama.json) | 將短劇構想發展成角色、分集故事及可交給媒體工具製作的工作流。 | [原作](https://github.com/Hao0321/ai-short-drama/blob/a1a00d3949fedd74edb6830a79d189a2c76920db/SKILL.md) |
| [sns-feedback-collect](../../modules/community/share-introductions/sns-feedback-collect.json) | 給 Codex 的社群貼文成效回顧 Skill，整理 FB/Threads 反應並比較，協助決定觀察或調整內容導流。 | [原作](https://github.com/kieiken/sns-feedback-collect/blob/6d9578f2773a645ac4fea9ed322e0144254202a3/README.md) |
| [social-post](../../modules/community/share-introductions/social-post.json) | 社群內容AI Skill：學習本人語氣、規劃主題與平台貼文草稿，逐篇確認。 | [原作](https://github.com/Hao0321/claude-skill-social-post/blob/c2641ba5ac7d7f722f1cef54b03fbfe553502c7b/social-post/SKILL.md) |
| [storefront](../../modules/community/share-introductions/storefront.json) | 商店模板與本機私人預覽工具，讀取自己平台商店選品及供貨狀態並產生HTML預覽。 | [原作](https://github.com/FreeTWAI/freedom-storefront/blob/9823df79f8eee86008c269437880ed2e49bdc394/README.md) |
| [story-bible](../../modules/community/share-introductions/story-bible.json) | 集中管理角色、場景與世界觀設定，讓編劇、生圖、配音共用同一份創作正本。 | [原作](https://github.com/Rumi-3653/story-bible/blob/d0fa28c9a2bf7f26eaf8f01a8b03c2f4508a9ef5/README.md) |
| [supplier-client](../../modules/community/share-introductions/supplier-client.json) | 供應商本機讀取客戶端，將自己的中央商品／供貨申請讀回供私人工具整理，不重建第二套資料。 | [原作](https://github.com/FreeTWAI/freedom-supplier-client/blob/53fd5b0ac4a1b67ccd71a8cc4ba092ea15bb3534/README.md) |
| [taiwanese-english-checker](../../modules/community/share-introductions/taiwanese-english-checker.json) | 給 AI 的英文檢查規則 Skill，針對台式英文與語氣誤會分級解釋並提供自然改寫，讓人理解修改原因。 | [原作](https://github.com/WilsonAImaster/taiwanese-english-checker/blob/52532373959436a875fd94209bf32df48bfe8dc9/README.md) |
| [typo-studio](../../modules/community/share-introductions/typo-studio.json) | 中文友善的 IG 多頁輪播排版與圖片匯出工具。 | [原作](https://github.com/Hao0321/typo-studio/blob/9d60be439d150af74a79dbcc5a7547c6108c726f/README.md) |
| [ultracode-token-optimization](../../modules/community/share-introductions/ultracode-token-optimization.json) | 給 Ultracode 多代理工作流程的角色分工與交接規則，減少重複溝通及退回重做造成的 token 浪費。 | [原作](https://github.com/kieiken/ultracode-token-optimization/blob/aa7b2bd43da2364602554e954deeecc02e903b7e/README.md) |
| [usage](../../modules/community/share-introductions/usage.json) | macOS 選單列的 Claude/Codex 用量檢視工具，讀本機紀錄顯示推算用量與概算成本。 | [原作](https://github.com/kieiken/usage/blob/e6298d1af0e2127b587b2ff609942896635bdd66/README.md) |
| [video-autopilot](../../modules/community/share-introductions/video-autopilot.json) | 依頻道需求串起長片、短影音與訪談製作的影片自動化框架。 | [原作](https://github.com/Hao0321/video-autopilot-kit/blob/b449e7a57076cbc66db77ccbf2d3978f492af7dc/README.md) |
| [video-to-podcast-toolkit](../../modules/community/share-introductions/video-to-podcast-toolkit.json) | 把訪談影片轉成 Podcast 音檔及海報、字幕、短影音、文案的製作工具。 | [原作](https://github.com/Lee-unhn/video-to-podcast-toolkit/blob/2ea2f0e6f11533ec08cff4d9db3a46859ec7ed4f/README.md) |
| [web-card-game-skill](../../modules/community/share-introductions/web-card-game-skill.json) | 可玩的單人瀏覽器卡牌遊戲，開包收集組牌挑戰電腦對手，開源供研究改造。 | [原作](https://github.com/mars-tw/web-card-game-skill/blob/d690b88ea23333d53d9126c51127ded6b24b4927/README.md) |
| [webchat-mcp](../../modules/community/share-introductions/webchat-mcp.json) | 本機 MCP 橋接服務，讓 MCP 工具透過瀏覽器向網頁 AI 聊天服務提問並取回回答，串入原有工作流。 | [原作](https://github.com/JS-PACKAGE/WebChatMCP.js/blob/a9b5f77874cdb4de669c89a3b7d7fd76d2cd8a44/README.md) |

## 驗證

- 內容檢查：55 本各 100 則，全 5,500 則唯一。
- 型別檢查與正式前端建置。
- 分享入口、指定介紹、社交控制項延遲載入與 CSP 回歸。
- 作者名片 API／資料庫回歸：公開同意、OAuth 對應、認領優先、來源身分變更、資料撤回、匿名 DTO、帳號改名／舊名稱重用與投稿公開狀態。
- Chromium 桌面及 390px／320px 手機：首屏位置、點擊區大小、分享、名片燈箱、Esc／焦點返回、失敗重試、腳本逾時、晚到回應、11 位共同作者與撤回後重讀。

實跑命令及最終結果列於 PR；本文件不將本機驗證宣稱為 CI、審查核准或正式部署。
