import {test,expect,type Page} from './fixtures.js';
import {navigate} from './navigation.js';

const eventId='71000000-0000-4000-8000-000000000001';
const maker='20000000-0000-4000-8000-000000000001',helper='31000000-0000-4000-8000-000000000001';
const own=(state:string|null,version:number)=>({state,version,event_closed:false});
const helperPage=(state:string,version:number)=>({items:[{user_id:helper,nickname:'合成幫手',state,version}],total:1,next_offset:null,event_closed:false});
const variants=[
  {action:'offer',organizer:false,before:null,after:'applied',button:'我要幫忙，送出申請',status:'等主辦回覆',width:390},
  {action:'withdraw',organizer:false,before:'applied',after:'withdrawn',button:'撤回幫忙申請',status:'已撤回',width:390},
  {action:'accept',organizer:true,before:'applied',after:'accepted',button:'接受 合成幫手',status:'主辦已接受',width:1280},
  {action:'decline',organizer:true,before:'applied',after:'declined',button:'婉拒 合成幫手',status:'這次未被接受',width:1280},
] as const;
// Synthetic visibility events exercise the actual app handlers. These are not
// OS suspension or real-device PWA acceptance tests. All helper/event data is
// local route fixture data; auth uses the existing disposable-schema runner.
async function lifecycle(page:Page,state:'hidden'|'visible'){
  await page.evaluate(value=>{
    Object.defineProperty(document,'visibilityState',{configurable:true,value});
    document.dispatchEvent(new Event('visibilitychange'));
    if(value==='visible'){window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('pageshow'));}
  },state);
}
for(const variant of variants)test(`helper ${variant.action} resumes interrupted ACK readback at ${variant.width}px`,async({page})=>{
  await page.setViewportSize({width:variant.width,height:844});
  await page.goto('/');const origin=new URL(page.url()).origin;
  const eventPath=`/api/v1/events/${eventId}`,helperPath=variant.organizer?`${eventPath}/helpers`:`${eventPath}/helpers/me`;
  const commandPath=variant.organizer?`${eventPath}/helpers/${helper}/decision`:helperPath;
  const matches=(url:URL,path:string)=>url.origin===origin&&url.pathname===path;
  const event={event_id:eventId,organizer_ref:variant.organizer?maker:helper,organizer_name:'合成主辦',title:'幫手前景恢復合成活動',description:'只測試本機合成旅程',help_need:'協助報到',registration_policy:'community_member',starts_at:new Date(Date.now()+86400000).toISOString(),ends_at:new Date(Date.now()+90000000).toISOString(),mode:'in_person',location:'合成場地',event_kind:'other',topic:null,online_url:null,visibility:'workshop',banner_url:null,video_url:null,banner_orientation:null,video_mime:null,capacity:null,state:'published',aggregate_version:1,attending_count:0,my_rsvp:null,guild_key:null,review_guild_key:null,can_review:false,review_reason:null};
  let state:string|null=variant.before,version=variant.organizer?1:variant.before?2:1,commandSeen=false,readbackHeld=false,readsAfterCommand=0,release!:()=>void,reached!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),held=new Promise<void>(resolve=>{reached=resolve;});
  const commands:{path:string;body:unknown}[]=[],unexpectedWrites:string[]=[];
  const listener=(request:import('@playwright/test').Request)=>{const url=new URL(request.url());if(url.origin===origin&&request.method()==='POST'&&url.pathname.startsWith(eventPath)&&url.pathname!==commandPath)unexpectedWrites.push(url.pathname);};
  page.on('request',listener);
  await page.route(url=>matches(url,'/api/v1/events'),route=>route.request().method()==='GET'?route.fulfill({json:{items:[event]}}):route.continue());
  await page.route(url=>matches(url,eventPath),route=>route.request().method()==='GET'?route.fulfill({json:event}):route.continue());
  await page.route(url=>matches(url,helperPath)||matches(url,commandPath),async route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.method()==='GET'&&matches(url,helperPath)){
      if(commandSeen){readsAfterCommand++;if(!readbackHeld){readbackHeld=true;reached();await gate;}}
      await route.fulfill({json:variant.organizer?helperPage(state!,version):own(state,version)});return;
    }
    if(request.method()==='POST'&&matches(url,commandPath)){
      commands.push({path:url.pathname,body:request.postDataJSON()});state=variant.after;version++;commandSeen=true;
      await route.fulfill({json:own(state,version)});return;
    }
    await route.continue();
  });
  try{
    await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();
    await navigate(page,'社群活動');await page.getByRole('link',{name:'活動專頁',exact:true}).click();
    const panel=page.getByRole('region',{name:variant.organizer?'管理幫手':'申請幫忙',exact:true});
    await panel.getByRole('button',{name:variant.button,exact:true}).click();await held;
    await lifecycle(page,'hidden');await lifecycle(page,'visible');await lifecycle(page,'hidden');await lifecycle(page,'visible');
    expect(readsAfterCommand).toBe(1);await expect(panel.getByRole('button',{name:'重新讀取幫忙狀態'})).toBeDisabled();
    release();await expect(panel).toContainText(variant.status);await expect(panel.getByRole('button',{name:'重新讀取幫忙狀態'})).toBeEnabled();
    await expect(panel.getByText('正在讀取幫忙資料…',{exact:true})).toHaveCount(0);expect(readsAfterCommand).toBe(2);expect(commands).toEqual([{path:commandPath,body:variant.organizer?{decision:variant.action}:{action:variant.action}}]);expect(unexpectedWrites).toEqual([]);
  }finally{
    release();await page.unrouteAll({behavior:'wait'});page.off('request',listener);
    await page.evaluate(()=>{delete (document as unknown as {visibilityState?:string}).visibilityState;});
  }
});
