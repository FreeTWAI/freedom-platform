export const pendingLabels = {
  'guild-applications':'公會申請', 'community-certifications':'社群認證審核',
  'author-claims':'作者認領審核', 'organizer-claims':'主辦認領', 'held-shares':'檢舉處理',
  'store-admissions':'商店准入', 'tool-reports':'工具檢舉', events:'公開活動審核', 'review-center':'PR 審核',
} as const;
export const peopleLabels = {members:'會員管理', admins:'管理員名單', guilds:'公會管理', 'guild-workspace':'技能書維護者'} as const;
export const systemLabels = {github:'GitHub 連結', credentials:'系統憑證', errors:'系統錯誤日誌', audit:'操作紀錄'} as const;
export const adminLabels = {inbox:'待處理', people:'人員與公會', system:'系統', ...pendingLabels, ...peopleLabels, ...systemLabels};
export type AdminTab = keyof typeof adminLabels;
export type PendingKind = keyof typeof pendingLabels;
export function placeOf(tab:AdminTab):'inbox'|'people'|'system' {
  return tab==='people'||tab in peopleLabels?'people':tab==='system'||tab in systemLabels?'system':'inbox';
}
export function locationTab():AdminTab {
  if(window.location.pathname==='/admin/github/callback')return 'github';
  const view=new URLSearchParams(window.location.search).get('view');
  return view&&Object.hasOwn(adminLabels,view)?view as AdminTab:'inbox';
}

/** Follow the existing bounded pages when opening a deep-linked object. */
export async function objectPage<T>(client:{request<T>(path:string):Promise<T>},path:string,id:string|null,key:keyof T):Promise<{items:T[];next_offset:number|null}>{
 let offset=0;
 for(let page=0;page<100;page++){
  const url=new URL(path,'https://admin.invalid');url.searchParams.set('offset',String(offset));
  const result=await client.request<{items:T[];next_offset?:number|null}>(url.pathname+url.search);
  if(!id||result.items.some(row=>row[key]===id)||result.next_offset==null)return {...result,next_offset:result.next_offset??null};
  if(result.next_offset<=offset)throw Error('清單分頁未前進。');offset=result.next_offset;
 }
 throw Error('清單超過讀取上限。');
}
