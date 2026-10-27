import type {Career} from './content.js';
// IDs are existing catalog.ts guildBooks entries; definitions quoted verbatim from
// migrations/002_positioning_guilds.sql, 009_specialist_guilds.sql and 020_creative_guilds.sql.
// First entry is the primary guild, optional second is a secondary suggestion. Suggestions confer no membership or access.
export const CAREER_GUILDS: Record<Career,{guildId:string;name:string;justification:string}[]> = {
  content:[{guildId:'guild_marketing',name:'成長與行銷公會',justification:'公會定義「製作內容、設計活動並觀察成效。」內容獵人的產業文章與貼文可從此練習。'}],
  automation:[{guildId:'guild_ai_vibe',name:'AI 開發公會',justification:'公會定義「把想法與程式做成可重用開源作品。」自動化技師可將重複流程整理成可重用工具。'},{guildId:'guild_ai_field',name:'AI 導入與驗證公會',justification:'公會定義「測試、部署、回饋與協助使用者。」可把自動化流程交給實際使用者測試並收集回饋。'}],
  coach:[{guildId:'guild_talent_direction',name:'人才與方向公會',justification:'公會定義「協助會員探索方向、學習與陪跑。」知識教練可練習提問與學習陪伴。'},{guildId:'guild_member_operations',name:'會員與社群營運公會',justification:'公會定義「協助會員加入、交流與找到下一步。」可協助新會員找到下一步學習。'}],
  visual:[{guildId:'guild_commercial_production',name:'廣告攝影與影片公會',justification:'公會定義「釐清商業影像需求，協作完成商品攝影、廣告影片與交付版本。」視覺煉金師可從商品照與品牌圖的交付版本練習。'},{guildId:'guild_marketing',name:'成長與行銷公會',justification:'公會定義「製作內容、設計活動並觀察成效。」可替活動與內容製作視覺素材。'}],
  product:[{guildId:'guild_ai_vibe',name:'AI 開發公會',justification:'公會定義「把想法與程式做成可重用開源作品。」產品鍛造師可從小工具與使用說明開始。'},{guildId:'guild_platform_engineering',name:'平台工程公會',justification:'公會定義「維護整合、資料與平台可靠性。」可練習讓自己的工具穩定可靠。'}],
  marketing:[{guildId:'guild_marketing',name:'成長與行銷公會',justification:'公會定義「製作內容、設計活動並觀察成效。」行銷操盤手可練習素材與成效回顧。'},{guildId:'guild_commerce_sales',name:'電商與銷售公會',justification:'公會定義「選貨、經營商店與服務買家。」可陪商店練習服務買家的溝通。'}],
  outsourcer:[{guildId:'guild_ai_project',name:'AI 專案公會',justification:'公會定義「協調需求、範圍、交付與合作。」外包代理商可練習界定接案與交付範圍。'},{guildId:'guild_opportunity_partnership',name:'商機與夥伴公會',justification:'公會定義「理解需求並連結合作夥伴。」可練習理解客戶需求與找合作夥伴。'}],
  consultant:[{guildId:'guild_ai_field',name:'AI 導入與驗證公會',justification:'公會定義「測試、部署、回饋與協助使用者。」導入顧問可從實際使用與回饋驗證痛點。'},{guildId:'guild_ai_project',name:'AI 專案公會',justification:'公會定義「協調需求、範圍、交付與合作。」可練習把導入需求拆成範圍與交付。'}],
  video:[{guildId:'guild_media_automation',name:'媒體自動化公會',justification:'公會定義「製作影片、字幕與可重用媒體流程。」影音導演可把剪輯與字幕整理成可重用流程。'},{guildId:'guild_commercial_production',name:'廣告攝影與影片公會',justification:'公會定義「釐清商業影像需求，協作完成商品攝影、廣告影片與交付版本。」可參與廣告影片的交付版本。'}],
  music:[{guildId:'guild_music_mv',name:'音樂創作與MV公會',justification:'公會定義「把歌曲構想、聲音製作與影像敘事整理成可交付的音樂與 MV。」音律吟遊詩人可從一首可交付的作品開始。'},{guildId:'guild_media_automation',name:'媒體自動化公會',justification:'公會定義「製作影片、字幕與可重用媒體流程。」可練習把 MV 製作整理成可重用流程。'}],
  stage:[{guildId:'guild_projection_mapping',name:'光影光雕公會',justification:'公會定義「協作光影、投影光雕、動態視覺與展演播放設計。」光影造夢師可從一段展演播放設計開始。'},{guildId:'guild_event_space',name:'活動與空間公會',justification:'公會定義「策劃場地、空間動線、讀書會、聚會與實體活動的現場合作。」可參與實體活動的現場合作。'}],
  host:[{guildId:'guild_event_space',name:'活動與空間公會',justification:'公會定義「策劃場地、空間動線、讀書會、聚會與實體活動的現場合作。」聚會召喚師可從一場讀書會或小聚開始。'},{guildId:'guild_member_operations',name:'會員與社群營運公會',justification:'公會定義「協助會員加入、交流與找到下一步。」可協助新會員加入與交流。'}],
  researcher:[{guildId:'guild_human_design',name:'人類圖研究所',justification:'公會定義「以共讀、來源查核與不同觀點研究人類圖詮釋框架，不作診斷或能力定論。」研究考據師可練習共讀與來源查核；不作診斷或能力定論。'},{guildId:'guild_talent_direction',name:'人才與方向公會',justification:'公會定義「協助會員探索方向、學習與陪跑。」可整理學習資料陪伴他人探索方向。'}],
  engineer:[{guildId:'guild_platform_engineering',name:'平台工程公會',justification:'公會定義「維護整合、資料與平台可靠性。」平台架構師可從整合與可靠性練習。'},{guildId:'guild_commerce_settlement',name:'交易整合與對帳公會',justification:'公會定義「協助商家串接自有收款與對帳。」可協助收款串接的技術整合。'}],
  security:[{guildId:'guild_security',name:'資安公會',justification:'公會定義「針對自己有權管理的系統，整理安全檢查、風險與修復驗證。」資安守門人只在自己有權管理的系統練習。'},{guildId:'guild_platform_engineering',name:'平台工程公會',justification:'公會定義「維護整合、資料與平台可靠性。」可協助驗證平台可靠性。'}],
  broker:[{guildId:'guild_opportunity_partnership',name:'商機與夥伴公會',justification:'公會定義「理解需求並連結合作夥伴。」商機牽線人可練習整理雙方需求。'},{guildId:'guild_commerce_sales',name:'電商與銷售公會',justification:'公會定義「選貨、經營商店與服務買家。」可協助商店找到合作通路。'}],
  shopkeeper:[{guildId:'guild_commerce_sales',name:'電商與銷售公會',justification:'公會定義「選貨、經營商店與服務買家。」電商掌櫃可從一間小店與買家服務開始。'},{guildId:'guild_product_quality_supply',name:'商品品質與供應公會',justification:'公會定義「整理實體商品、供貨條件與品質資訊。」可練習把商品與供貨資訊講清楚。'}],
  maker:[{guildId:'guild_product_quality_supply',name:'商品品質與供應公會',justification:'公會定義「整理實體商品、供貨條件與品質資訊。」供應鍛冶師可從一份規格與品質紀錄開始。'},{guildId:'guild_commerce_sales',name:'電商與銷售公會',justification:'公會定義「選貨、經營商店與服務買家。」可了解貨品如何被選進商店。'}],
  accountant:[{guildId:'guild_commerce_settlement',name:'交易整合與對帳公會',justification:'公會定義「協助商家串接自有收款與對帳。」帳房先生可從整理一條付款事件的核對步驟開始。'},{guildId:'guild_commerce_sales',name:'電商與銷售公會',justification:'公會定義「選貨、經營商店與服務買家。」可協助商店整理訂單與收款。'}],
};
