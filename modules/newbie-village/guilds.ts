import type {Career} from './content.js';
// IDs are existing catalog.ts guildBooks entries; definitions quoted from
// migrations/002_positioning_guilds.sql. Suggestions confer no membership or access.
export const CAREER_GUILDS: Record<Career,{guildId:string;name:string;justification:string}[]> = {
  content:[{guildId:'guild_marketing',name:'成長與行銷公會',justification:'公會定義「製作內容、設計活動並觀察成效。」內容獵人的產業文章與貼文可從此練習。'}],
  automation:[{guildId:'guild_ai_vibe',name:'AI 開發公會',justification:'公會定義「把想法與程式做成可重用開源作品。」自動化技師可將重複流程整理成可重用工具。'}],
  coach:[{guildId:'guild_talent_direction',name:'人才與方向公會',justification:'公會定義「協助會員探索方向、學習與陪跑。」知識教練可練習提問與學習陪伴。'}],
  visual:[{guildId:'guild_media_automation',name:'媒體自動化公會',justification:'公會定義「製作影片、字幕與可重用媒體流程。」視覺煉金師可整理創作與交付流程。'}],
  product:[{guildId:'guild_ai_vibe',name:'AI 開發公會',justification:'公會定義「把想法與程式做成可重用開源作品。」產品鍛造師可從小工具與使用說明開始。'}],
  marketing:[{guildId:'guild_marketing',name:'成長與行銷公會',justification:'公會定義「製作內容、設計活動並觀察成效。」行銷操盤手可練習素材與成效回顧。'}],
  outsourcer:[{guildId:'guild_ai_project',name:'AI 專案公會',justification:'公會定義「協調需求、範圍、交付與合作。」外包代理商可練習界定接案與交付範圍。'}],
  consultant:[{guildId:'guild_ai_field',name:'AI 導入與驗證公會',justification:'公會定義「測試、部署、回饋與協助使用者。」導入顧問可從實際使用與回饋驗證痛點。'}],
};
