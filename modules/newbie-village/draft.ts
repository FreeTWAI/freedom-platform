import {CLASSES_V2,type Career,type Dimension} from './content.js';
import {CAREER_GUILDS} from './guilds.js';
export const DIRECTION_DRAFT_BASE_URL='https://freetwai.com';
export function directionDraft({dimensionWinners,primary,baseline,action,checkin}:{dimensionWinners:Record<Dimension,Career>;primary:Career;baseline:string;action:string;checkin:string}) {
  const guildLines=CAREER_GUILDS[primary].map((g,i)=>`${i===0?'主公會':'副公會'}：${g.name}（${DIRECTION_DRAFT_BASE_URL}/#guilds/${g.guildId}）`).join('\n');
  return `方向卡（本人選擇的草稿）\n做自己：${CLASSES_V2[dimensionWinners.personality].name}\n過生活：${CLASSES_V2[dimensionWinners.lifestyle].name}\n用強項：${CLASSES_V2[dimensionWinners.capability].name}\n過生活底線：${baseline}\n第一週行動：${action}\n完成條件與回顧：${checkin}\n${guildLines}\n公會僅供建議，由本人另行選擇。`;
}
