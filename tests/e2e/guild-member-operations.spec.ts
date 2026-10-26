import {test,expect,type Page,type Route} from './fixtures.js';
import {navigate} from './navigation.js';

const guildKey='guild_event_space',memberId='00000000-0000-4000-8000-000000000123';
const writePath='/api/v1/guilds/'+guildKey+'/members/'+memberId+'/tier';
async function login(page:Page,email='maker@local.test'){
 await page.getByLabel('電子郵件',{exact:true}).fill(email);await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();await expect(page.locator('.shell')).toBeVisible();
}
// Only synthetic fixture traffic is counted. A parsed fixture ACK queues a task
// after its promise continuations; no timing sleep substitutes for settlement.
function installMemberAckProbe({path,guild,user}:{path:string;guild:string;user:string}){
 const root=window as any,fetch=window.fetch,channels:MessageChannel[]=[];let active=true;
 const probe={settled:false,members:0,directory:0,restore:()=>{active=false;window.fetch=fetch;for(const c of channels){c.port1.close();c.port2.close();}}};root.__memberAckProbe=probe;
 window.fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input),location.href),method=init?.method??(input instanceof Request?input.method:'GET'),same=url.origin===location.origin;
  if(same&&method==='GET'&&url.pathname==='/api/v1/members'&&url.searchParams.get('guild_key')===guild)probe.members++;
  if(same&&method==='GET'&&url.pathname==='/api/v1/guilds/directory')probe.directory++;
  let selected=false;if(same&&method==='POST'&&url.pathname===path&&typeof init?.body==='string'){try{selected=JSON.parse(init.body).member_tier==='full';}catch{/* Not this fixture. */}}
  const response=await fetch(input,init);if(!selected)return response;const read=response.text.bind(response);
  response.text=async()=>{const text=await read();let ack=false;try{const value=JSON.parse(text);ack=response.ok&&value.user_id===user&&value.guild_key===guild&&value.member_tier==='full';}catch{/* Not a valid fixture ACK. */}if(ack&&active){const c=new MessageChannel();channels.push(c);c.port1.onmessage=()=>{if(active)probe.settled=true;c.port1.close();c.port2.close();};c.port2.postMessage(null);}return text;};return response;
 };
}
for(const change of ['close-and-reopen','logout-and-login'] as const)test('a held guild member ACK cannot refresh a replacement list after '+change,async({page})=>{
 let viewer='',tier:'intern'|'full'='intern',held:Route|undefined,started!:()=>void,writes=0,failed=false;
 const requested=new Promise<void>(resolve=>started=resolve);
 const guild=()=>({guild_key:guildKey,name:'活動與空間公會',guild_master:{user_id:viewer,display_name:'Synthetic master'},guild_experts:[],purpose:'Synthetic guild',first_step:'Read members',track_count:0,is_primary:false,skill_books:[],membership:null});
 const member=()=>({user_id:memberId,nickname:'目前合成成員',positioning_title:'Synthetic member',primary_guild:{guild_key:guildKey,name:'活動與空間公會'},secondary_guilds:[],capabilities:[],equipment:[],contacts:{},is_self:false,friendship:{state:'none'},last_seen_at:null,is_online:false,guild_roster:{member_tier:tier,aggregate_version:3,expert_aggregate_version:null,expert_active:false}});
 await page.route('**/api/v1/guilds/directory',route=>route.fulfill({json:{items:[guild()]}}));
 await page.route('**/api/v1/me/guild-preferences',route=>route.fulfill({json:{primary_guild_key:null,secondary_guild_keys:[],aggregate_version:1}}));
 await page.route('**/api/v1/me/guild-preferences/v2',route=>route.fulfill({json:{migration_state:'legacy'}}));
 await page.route('**/api/v1/me/skill-books',route=>route.fulfill({json:{items:[]}}));
 await page.route('**/api/v1/guild-applications',route=>route.fulfill({json:{items:[]}}));
 await page.route('**/api/v1/members?*',route=>route.fulfill({json:{items:[member()],total:1,next_offset:null}}));
 const writePattern='**'+writePath;
 const writeHandler=(route:Route)=>{writes++;if(writes===1){held=route;started();return;}tier='full';return route.fulfill({json:{user_id:memberId,guild_key:guildKey,member_tier:'full',aggregate_version:4,changed:true}});};
 await page.route(writePattern,writeHandler);
 try{
  await page.goto('/');await login(page);const original=await(await page.request.get('/api/v1/session')).json();viewer=original.user.user_id;await navigate(page,'職業公會');
  const card=page.getByRole('article',{name:'活動與空間公會',exact:true});
  await card.getByRole('button',{name:'查看成員',exact:true}).click();
  const panel=card.getByRole('region',{name:'活動與空間公會成員',exact:true});
  await expect(panel.getByRole('button',{name:'設為正式成員',exact:true})).toBeVisible();
  await page.evaluate(installMemberAckProbe,{path:writePath,guild:guildKey,user:memberId});
  await panel.getByRole('button',{name:'設為正式成員',exact:true}).click();await requested;
  await card.getByRole('button',{name:'關閉公會視窗',exact:true}).click();
  if(change==='logout-and-login'){
   await page.getByRole('button',{name:'設定',exact:true}).click();await page.getByRole('menuitem',{name:'登出',exact:true}).click();await expect(page.locator('.login-card')).toBeVisible();
   await login(page,'client@local.test');const replacement=await(await page.request.get('/api/v1/session')).json();expect(replacement.user.user_id).not.toBe(original.user.user_id);expect(replacement.csrf_token).not.toBe(original.csrf_token);viewer=replacement.user.user_id;await navigate(page,'會員首頁');await navigate(page,'職業公會');
  }
  await card.getByRole('button',{name:'查看成員',exact:true}).click();await expect(panel.getByRole('button',{name:'設為正式成員',exact:true})).toBeEnabled();
  const searched=page.waitForResponse(response=>response.request().method()==='GET'&&new URL(response.url()).pathname==='/api/v1/members'&&new URL(response.url()).searchParams.get('search')==='目前');
  await panel.getByRole('searchbox',{name:'搜尋公會成員',exact:true}).fill('目前');await(await searched).finished();await expect(panel.locator('.directory-member')).toHaveCount(1);
  const before=await page.evaluate(()=>({members:(window as any).__memberAckProbe.members,directory:(window as any).__memberAckProbe.directory}));
  const old=held!;await old.fulfill({json:{user_id:memberId,guild_key:guildKey,member_tier:'full',aggregate_version:4,changed:true}});held=undefined;
  await page.waitForFunction(()=>(window as any).__memberAckProbe.settled===true);
  expect(await page.evaluate(()=>({members:(window as any).__memberAckProbe.members,directory:(window as any).__memberAckProbe.directory}))).toEqual(before);
  await expect(panel.getByRole('searchbox',{name:'搜尋公會成員',exact:true})).toHaveValue('目前');await expect(panel.getByRole('alert')).toHaveCount(0);
  await panel.getByRole('button',{name:'設為正式成員',exact:true}).click();await expect(panel.locator('.guild-member-tier-full')).toHaveCount(1);expect(writes).toBe(2);
 }catch(error){failed=true;throw error;}
 finally{
  const errors:unknown[]=[];if(held)try{await held.abort();}catch(error){errors.push(error);}
  try{await page.unroute(writePattern,writeHandler);}catch(error){errors.push(error);}
  try{if(!page.isClosed())await page.evaluate(()=>{const root=window as any;root.__memberAckProbe?.restore();delete root.__memberAckProbe;});}catch(error){errors.push(error);}
  if(!failed&&errors.length)throw new AggregateError(errors,'Member operation fixture cleanup failed');
 }
});
