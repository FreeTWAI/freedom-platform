import type {Page} from './fixtures.js';
const pending=['guild-applications','author-claims','organizer-claims','community-certifications','held-shares','store-admissions','tool-reports','events','review-center'];
const people=['members','admins','guilds','guild-workspace'];
/** Open the retained history/settings workspace through one of the three places. */
export async function adminNavigate(page:Page,key:string){
 const place=pending.includes(key)?'待處理':people.includes(key)?'人員與公會':'系統';
 const trigger=page.getByRole('button',{name:'開啟管理選單',exact:true});if(await page.evaluate(()=>window.matchMedia('(max-width: 960px)').matches)){await trigger.waitFor({state:'visible'});if(await trigger.getAttribute('aria-expanded')!=='true')await trigger.click();}
 await page.getByRole('navigation',{name:'平台管理選單'}).getByRole('button',{name:place,exact:true}).click();
 if(place==='待處理')await page.getByLabel('種類',{exact:true}).selectOption(key);
 if(place==='系統'){await page.getByLabel('系統項目',{exact:true}).selectOption(key);return;}
 await page.getByText(place==='待處理'?'紀錄與設定':'管理設定',{exact:true}).click();
 await page.getByLabel('工作區',{exact:true}).selectOption(key);
}
