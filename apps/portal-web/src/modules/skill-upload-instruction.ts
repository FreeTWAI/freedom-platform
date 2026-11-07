import { formatIsoLocal } from '../format';
import { seedCopyBlock, type ChatSkillSeed } from './skill-upload-chat';
import { skillPageContentInstruction, skillShareIntroductionInstruction } from './skill-page-content-instruction';

export const SKILL_UPLOAD_GUIDE = '/development/skill-upload';

export type SkillUploadInstructionSecret = {
  token: string;
  expiresAt: string;
  submitUrl: string;
};

/** Format an already validated grant for the member's chosen Agent.
 * This formatter does not validate URLs, authorize uploads, copy or store credentials.
 * The caller owns same-origin/expiry checks and the secret's display lifetime. */
export function agentInstruction(origin: string, secret: SkillUploadInstructionSecret, seed?: ChatSkillSeed | null) {
  const copied = seed ? `${seedCopyBlock(seed)}\n\n` : '';
  return `# 自由工坊 · 技能上傳（私人指令，請勿轉傳）
先閱讀公開指南：${origin}${SKILL_UPLOAD_GUIDE}/SKILL.md（完整欄位規格與插圖格式以指南為準）。

任務：讀取「目前工作目錄」這個 repository 的 README、LICENSE 與程式碼，依實際內容以繁體中文撰寫：
1. title：技能名稱。
2. description：真實介紹，只寫專案確實具備的功能與授權。
3. use_notes：適合誰、需要什麼、第一個使用步驟與限制。
4. ${skillPageContentInstruction}
5. ${skillShareIntroductionInstruction}
6. 插圖（選填）：只依公開指南的格式提供；無法確認格式就省略 cover_image。

規則：
- relationship 預設 curator（推薦／整理者）；只有我明確聲明是原作者、維護者或貢獻者，才改為 author／maintainer／contributor。這是本人自行聲明，不是身分驗證。
- 不捏造使用人數、成效、官方身分或授權；不確定就寫「尚未確認」。
- 不讀取專案中的 .env、cookie、私鑰或客戶資料，不附上其他憑證；只用下方 Authorization 標頭，不使用任何瀏覽器 cookie。
- 本指令只交給我選擇的 Agent，不轉傳、不寫入 Repo、shell history 或日誌。憑證只能用於下方上傳端點。
- 這只會上傳私人草稿；是否公開由我本人在自由工坊預覽後決定。

${copied}POST ${secret.submitUrl}
Authorization: Bearer ${secret.token}
Content-Type: application/json
（一次性憑證，只能上傳這份草稿，${formatIsoLocal(secret.expiresAt)} 到期）

{
  "repository_url": "https://github.com/<owner>/<repository>",
  "title": "技能名稱",
  "description": "真實介紹",
  "use_notes": "如何開始使用與限制",
  "demo_url": null,
  "relationship": "curator",
  "page_content": {
    "headline": "請改為原作可支持的具體效益。",
    "problem": "請依文件描述使用者實際遇到的問題。",
    "mechanism": "請說明這個專案實際接收什麼資料、如何處理，以及產生什麼結果。",
    "outcomes": ["第一個真實產出", "第二個真實產出", "第三個真實產出"],
    "flow": {
      "title": "請填真實流程名稱",
      "lead": "請依原作文件說明使用環境、前置資料與條件。",
      "steps": [
        {"icon": "doc", "title": "實際輸入", "note": "請說明專案需要的真實輸入。"},
        {"icon": "sliders", "title": "核心處理", "note": "請說明程式實際執行的處理。"},
        {"icon": "check", "title": "實際產出", "note": "請說明使用者取得的真實結果。"}
      ],
      "caption": "請用一句話補充這個流程的真實條件與範圍。"
    }
  },
  "share_introductions": ["第 1 則分享短文", "第 2 則分享短文", "……共 100 則，彼此不同"]
}
`;
}
