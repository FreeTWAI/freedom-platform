import type { TabId } from '../types';

export type PortalFeatureMetadata = { title: string; guidance: string };

// Order is the existing navigation-search order. Metadata is not authorization.
export const PORTAL_FEATURE_METADATA = {
  "newbie-village": {title:"新手村任務",guidance:"用三維度反思、15 題本機測驗與方向卡，選擇第一週的小實驗。"},
  profile: {title: "我的個人空間", guidance: "瀏覽自己的貼文、作品與活動；公開分享仍由你另行設定。"},
  "ar": { title: "AR 圖案互動", guidance: "製作衣服或海報圖案，掃描本人公開名片與公開活動，拍照分享。" },
  "community-search": { title: "搜尋社群內容", guidance: "依關鍵字、類型與主題搜尋目前可閱讀的社群內容。" },
  "my-content": { title: "我的內容", guidance: "找回私人草稿，查看本人內容的發布與審核狀態。" },
  "private-ai": { title: "私人工作與 AI", guidance: "建立私人工作、閱讀成果，並逐次確認模型推論的資料與上限。" },
  "home": { title: "會員首頁", guidance: "查看會員摘要與常用入口，從這裡繼續公會和技能書旅程。" },
  "positioning": { title: "我的定位", guidance: "透過情境題整理你的能力與想走的方向；結果由你確認，也可以日後重新探索。" },
  "guilds": { title: "職業公會", guidance: "加入感興趣的職業公會，設定主要公會，查看公會技能書。" },
  "skills": { title: "技能書架", guidance: "預覽技能書，領取已解鎖的內容，選一本開始練習。" },
  "friends": { title: "我的好友", guidance: "查看好友、待回覆邀請與可用的私訊入口。" },
  "members": { title: "工坊夥伴", guidance: "認識工坊夥伴，查看他們願意公開的名片資訊。" },
  "account": { title: "我的名片", guidance: "編輯名片資料、頭像與公開範圍。" },
  "cocreation": { title: "一起開發", guidance: "查看一起開發的作品和參與入口。" },
  "squads": { title: "小隊集合", guidance: "查看小隊與共同進行的協作。" },
  "opensource": { title: "開源投稿", guidance: "貼上 GitHub 網址與介紹，預覽後分享到社群技能書。" },
  "workbench": { title: "我的工作", guidance: "查看自己的工作、認領紀錄與進度。" },
  "showcase": { title: "作品與需求", guidance: "瀏覽作品和需求，尋找合作機會。" },
  "engagement": { title: "合作紀錄", guidance: "查看合作紀錄與目前狀態。" },
  "supplier": { title: "我有東西要賣", guidance: "下載 MD，讓 AI 整理商品並製作內部商店。" },
  "retail": { title: "我可以賣東西", guidance: "挑商品、下載 MD，讓 AI 製作公開商店。" },
  "marketing": { title: "行銷工作室", guidance: "撰寫介紹草稿並記錄分享成果。" },
  "guild-workspace": { title: "公會管理", guidance: "管理你有權負責的公會資訊與技能書。" },
  "business": { title: "業務空間", guidance: "建立業務空間、切換工作區，並邀請仍在本社群的夥伴。" },
  "stores": { title: "我的商店", guidance: "管理商店展示與店主預留紀錄；預留不代表付款或履約。" },
  "reservations": { title: "我的訂單", guidance: "查看本人預留；預留不代表付款或出貨。" },
  "community": { title: "自由工坊社群", guidance: "查看自由工坊的社群入口和公開資訊。" },
  "todos": { title: "待辦清單", guidance: "查看會員待辦事項與可直接前往的操作。" },
  "messages": { title: "我的訊息", guidance: "查看收到的訊息與對話。" },
  "events": { title: "社群活動", guidance: "查看社群活動、審核結果與報名狀態。" },
  "tasks": { title: "社群任務", guidance: "探索工坊工作、GitHub Issue／PR 歷史與已連結 GitHub 的會員排行，查看有來源的驗收紀錄。" },
  "social": { title: "社群分享", guidance: "發布近況與作品、按讚留言，也能分享外部社群連結。" },
  "services": { title: "社員服務", guidance: "列出社員的本業服務。用你的連結分享出去，點擊計入業務推廣排行榜。服務頁是公開的。" },
  "promotion": { title: "推廣排行榜", guidance: "查看六種分享的點擊排行。分數只供比較，不計入經驗或驗收。" },
  "highlights": { title: "活動集錦", guidance: "活動結束後會自動出現在這裡。這一頁是公開的，參加過的夥伴可以補上照片、海報和影片連結。" },
} as const satisfies Record<TabId, PortalFeatureMetadata>;

function metadataField(field: keyof PortalFeatureMetadata): Record<TabId, string> {
  return Object.fromEntries(Object.entries(PORTAL_FEATURE_METADATA).map(([id, entry]) => [id, entry[field]])) as Record<TabId, string>;
}

export const TAB_TITLES = metadataField('title');
export const TAB_GUIDANCE = metadataField('guidance');
