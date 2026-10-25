import { COOKING_RULES, recipeOf, RECIPES } from './catalog';
import { cookingScore, parseCookingRun, type CookingRun } from './domain';

export const COOKBOOK_KEY='freedom.cooking.cookbook.v1',COOKBOOK_BACKUP='freedom.cooking.cookbook.backup.v1',COOKING_RUN_KEY='freedom.cooking.run.v1';
export const RUN_TTL=7*24*60*60*1000;
export type Cookbook={version:1;savedAt:number;favorites:string[];best:Record<string,{score:number;updatedAt:number;runId:string}>};
export type CookingStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export type BookRead={book:Cookbook;notice:string;available:boolean};
export const emptyCookbook=():Cookbook=>({version:1,savedAt:0,favorites:[],best:{}});
export function parseCookbook(raw:string|null,now=Date.now()):Cookbook|null {
  if(!raw||raw.length>COOKING_RULES.maxSaveBytes)return null;
  try{const x=JSON.parse(raw);if(!x||x.version!==1||!Number.isFinite(x.savedAt)||x.savedAt<0||x.savedAt>now+60000||!Array.isArray(x.favorites)||x.favorites.length>RECIPES.length||x.favorites.some((id:unknown)=>!recipeOf(id))||new Set(x.favorites).size!==x.favorites.length||!x.best||typeof x.best!=='object'||Array.isArray(x.best)||Object.keys(x.best).length>RECIPES.length)return null;
    const best:Cookbook['best']={};for(const [id,value] of Object.entries(x.best)){const r=value as Cookbook['best'][string];if(!recipeOf(id)||!r||!Number.isInteger(r.score)||r.score<10||r.score>100||!Number.isFinite(r.updatedAt)||r.updatedAt<0||r.updatedAt>now+60000||typeof r.runId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(r.runId))return null;best[id]={score:r.score,updatedAt:r.updatedAt,runId:r.runId};}
    return {version:1,savedAt:x.savedAt,favorites:[...x.favorites],best};
  }catch{return null;}
}
/** CK-7: reads are pure, including backup recovery and denied storage. */
export function readCookbook(storage:CookingStorage,now=Date.now()):BookRead{
  try{const raw=storage.getItem(COOKBOOK_KEY),book=parseCookbook(raw,now);if(book)return {book,notice:'',available:true};const backup=parseCookbook(storage.getItem(COOKBOOK_BACKUP),now);return {book:backup??emptyCookbook(),notice:backup?'已讀取上一次有效的食譜備份。':raw?'食譜本資料無法讀取；這次仍可玩，舊備份不會被損毀資料覆蓋。':'',available:true};}catch{return {book:emptyCookbook(),notice:'瀏覽器未允許保存食譜本。這次仍可玩，關閉後進度可能消失。',available:false};}
}
type BookChange={kind:'favorite';id:string}|{kind:'complete';run:CookingRun}|{kind:'retry'};
export function updateCookbook(storage:CookingStorage,memory:Cookbook,change:BookChange,now=Date.now(),preserveFavorites=false):BookRead{
  const read=readCookbook(storage,now),book:Cookbook={...read.book,favorites:[...read.book.favorites],best:{...read.book.best},savedAt:now};
  // Preserve unsaved local progress after a failed write, while taking maxima from a fresh read.
  for(const [id,r] of Object.entries(memory.best)){if(!book.best[id]||r.score>book.best[id].score)book.best[id]=r;}
  if(preserveFavorites||!read.available||!read.book.savedAt||change.kind==='retry')book.favorites=[...memory.favorites];
  if(change.kind==='favorite'&&recipeOf(change.id))book.favorites=book.favorites.includes(change.id)?book.favorites.filter(id=>id!==change.id):[...book.favorites,change.id];
  if(change.kind==='complete') {const run=parseCookingRun(change.run);if(run?.status==='done'){const score=cookingScore(run),old=book.best[run.recipeId];if(!old||score>old.score)book.best[run.recipeId]={score,updatedAt:now,runId:run.id};}}
  const raw=JSON.stringify(book);
  if(!parseCookbook(raw,now))return {book:memory,notice:'食譜本資料無法保存，請重試。',available:false};
  try{const previous=storage.getItem(COOKBOOK_KEY);if(parseCookbook(previous,now))storage.setItem(COOKBOOK_BACKUP,previous!);storage.setItem(COOKBOOK_KEY,raw);if(storage.getItem(COOKBOOK_KEY)!==raw)throw Error('write not retained');return {book,notice:'',available:true};}catch{return {book,notice:'尚未保存到這台裝置。這次的進度還在，請按「重試保存」。',available:false};}
}
export function readCookingRun(storage:CookingStorage,now=Date.now()):{run:CookingRun|null;notice:string}{
  try{const raw=storage.getItem(COOKING_RUN_KEY);if(!raw)return {run:null,notice:''};if(raw.length>COOKING_RULES.maxSaveBytes)return {run:null,notice:'上次的料理進度無法讀取，請重新開始。'};const x=JSON.parse(raw),run=parseCookingRun(x?.run);if(x?.version!==1||!Number.isFinite(x.savedAt)||x.savedAt>now+60000||now-x.savedAt>RUN_TTL||!run)return {run:null,notice:'上次的料理進度已過期或無法讀取，請重新開始。'};return {run,notice:''};}catch{return {run:null,notice:'暫時無法讀取這個分頁的料理進度。'};}
}
export function saveCookingRun(storage:CookingStorage,run:CookingRun,now=Date.now()):boolean{
  if(!parseCookingRun(run))return false;
  const raw=JSON.stringify({version:1,savedAt:now,run});if(raw.length>COOKING_RULES.maxSaveBytes)return false;
  try{storage.setItem(COOKING_RUN_KEY,raw);return storage.getItem(COOKING_RUN_KEY)===raw;}catch{return false;}
}
export function clearCookingRun(storage:CookingStorage,id:string){try{const run=readCookingRun(storage).run;if(run?.id===id)storage.removeItem(COOKING_RUN_KEY);}catch{/* Another tab's or module's data is never cleared. */}}
