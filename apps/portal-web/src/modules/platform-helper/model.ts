/** Only ordinary member pages: never overlays, administrative or private-AI routes. */
export const HELPER_PAGE_IDS=['guilds','skills','stores','supplier','retail','squads','showcase','todos'] as const;
export type HelperPageId=typeof HELPER_PAGE_IDS[number];
export type HelperPage={readonly id:HelperPageId;readonly title:string;readonly summary:string;readonly steps:readonly string[];readonly note?:string};
export type HelperKnowledge=Readonly<Partial<Record<HelperPageId,HelperPage>>>;
export const HELPER_INTENTS=[
  {id:'start',label:'從哪裡開始'},
  {id:'learn',label:'學 AI'},
  {id:'sell',label:'開店／賣東西'},
  {id:'partners',label:'找合作夥伴'},
] as const;
export type HelperIntentId=typeof HELPER_INTENTS[number]['id'];
export type HelperResult=
  |{kind:'invalid';reason:'empty'|'long'}|{kind:'unknown'}|{kind:'unavailable'}
  |{kind:'clarify';intentIds:HelperIntentId[]}|{kind:'pages';pageIds:HelperPageId[]};
const destinations:Record<HelperIntentId,readonly HelperPageId[]>={
  start:['todos','skills','guilds'],learn:['skills','guilds'],sell:['stores','supplier','retail'],partners:['squads','showcase'],
};
const aliases:Record<HelperIntentId,readonly string[]>={
  start:['從哪裡開始','不知道從哪裡開始','開始','新手入門','入門'],
  learn:['學ai','學習ai','學人工智慧','技能書','技能書架'],
  sell:['開店','賣東西','賣商品','商店','開商店'],
  partners:['找夥伴','找合作夥伴','找人合作','合作','找小隊'],
};
export function availablePage(id:unknown,available:readonly HelperPageId[],knowledge:HelperKnowledge):HelperPage|undefined{
  if(typeof id!=='string'||!HELPER_PAGE_IDS.includes(id as HelperPageId)||!available.includes(id as HelperPageId)||!Object.hasOwn(knowledge,id))return undefined;
  const page=knowledge[id as HelperPageId];
  return page?.id===id&&typeof page.title==='string'&&page.title.trim()&&typeof page.summary==='string'&&page.summary.trim()&&Array.isArray(page.steps)&&page.steps.every(step=>typeof step==='string')&&(page.note===undefined||typeof page.note==='string')?page:undefined;
}
export function chooseIntent(intent:HelperIntentId,available:readonly HelperPageId[],knowledge:HelperKnowledge):HelperResult{
  if(!Object.hasOwn(destinations,intent))return {kind:'unavailable'};
  const pageIds=destinations[intent].filter(id=>availablePage(id,available,knowledge));
  return pageIds.length?{kind:'pages',pageIds}:{kind:'unavailable'};
}
function normalizeClause(value:string):string{
  return value.replace(/^(?:請問|請教)?(?:我)?(?:想要|想|要)?(?:怎麼|如何|可以怎麼)?/u,'').replace(/(?:呢|嗎|吧)?[?？!！。]*$/u,'');
}
export function answerQuestion(input:unknown,available:readonly HelperPageId[],knowledge:HelperKnowledge):HelperResult{
  if(typeof input!=='string'||!input.trim())return {kind:'invalid',reason:'empty'};
  if(input.length>240)return {kind:'invalid',reason:'long'};
  const clauses=input.normalize('NFKC').toLowerCase().replace(/\s+/gu,'').split(/以及|還有|和|與|、|，|,/u).map(normalizeClause);
  const matches=clauses.map(clause=>HELPER_INTENTS.find(intent=>aliases[intent.id].includes(clause))?.id);
  if(matches.some(id=>id===undefined))return {kind:'unknown'};
  const intentIds=[...new Set(matches)] as HelperIntentId[];
  if(intentIds.length>1)return {kind:'clarify',intentIds};
  return chooseIntent(intentIds[0],available,knowledge);
}
