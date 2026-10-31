/** PT-1..6: lightweight catalog. Never import Three or account code here. */
export type PartyGameId = 'chair' | 'tofu' | 'holiday';
export const PARTY_GAMES = [
  {id:'chair',title:'辦公椅逃亡',subtitle:'騎著椅子下班，別讓會議追上你。',tag:'閃躲 × 跳躍',duration:'30 秒',action:'準時下班',color:'#d7e7df',rule:'左右換路躲開會議桌；跳過推車，沿路收集假日票。',keys:'← → 或 A / D 換路，空白鍵跳躍。'},
  {id:'tofu',title:'豆腐疊高高',subtitle:'今天不蓋房子，蓋一棟嫩豆腐。',tag:'時機 × 平衡',duration:'12 層挑戰',action:'豆腐開工',color:'#f2dfc9',rule:'瞄準下面那塊再落下！越整齊，豆腐大樓越有希望。',keys:'點畫面、按落下按鈕或空白鍵。'},
  {id:'holiday',title:'假日保衛戰',subtitle:'搶救休假精靈，閃開開會小怪。',tag:'辨識 × 反應',duration:'24 秒',action:'搶救我的假日',color:'#e3dff0',rule:'點戴葉子的「休假」；戴領帶的「開會」會偷走分數。',keys:'直接點角色，或按鍵盤 1–6／下方對應按鈕。'},
] as const;
export function partyOf(value:unknown):PartyGameId|null {return PARTY_GAMES.some(g=>g.id===value)?value as PartyGameId:null;}
export const PARTY_RULES = Object.freeze({
  maxAdvanceMs:1000, stallMs:1500, loaderMs:15000, maxDpr:1.5,
  chairMs:30000, chairLives:3, chairWaves:22, waveFirstMs:2200, waveGapMs:1250,
  laneSpeed:8, laneCooldownMs:130, jumpMs:850, jumpHeight:1.7, collisionLane:.46,
  worldSpeed:6.4, horizonMs:2800,
  tofuMs:60000, tofuGoal:12, tofuMisses:3, tofuSize:3, tofuHeight:.48,
  tofuAmplitude:2.65, tofuSpeed:1.8, tofuSpeedStep:.08, tofuFallMs:460,
  tofuPerfect:.12, tofuMinimum:.32,
  holidayMs:24000, holidayRoundMs:1200, holidayOpenMs:120, holidayCloseMs:1020,
  gesturePx:28, uiMs:90,
});
