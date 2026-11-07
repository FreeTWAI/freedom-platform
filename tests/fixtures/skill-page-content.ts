import type { SkillPageContent } from '../../modules/community/skill-page-content.js';

// Synthetic authored content: no claims about a real repository or member.
export const syntheticSkillPage: SkillPageContent = {
  headline: '把零散筆記整理成可追蹤的行動。',
  problem: '團隊開完會後，常把決策與待辦散落在不同筆記中。',
  mechanism: '工具讀取使用者提供的會議文字，依段落分組整理，再輸出摘要、待辦與保留來源的決策紀錄。',
  outcomes: ['整理好的會議摘要', '可指派的行動清單', '保留來源的決策紀錄'],
  flow: {
    title: '從會議筆記到行動',
    lead: '先備妥可分享的會議文字，並依原作文件確認執行環境。',
    steps: [
      { icon: 'doc', title: '準備輸入', note: '提供一份不含私人資料的會議文字。' },
      { icon: 'sliders', title: '執行處理', note: '依文件執行整理，將段落分成摘要與待辦。' },
      { icon: 'check', title: '取得成果', note: '檢查輸出內容並保留可回查的來源。' },
    ],
    caption: '使用者仍需核對整理結果與原始會議內容。',
  },
};
