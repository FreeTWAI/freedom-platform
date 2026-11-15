import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {test,expect,type Browser,type Page} from './member-feature-fixture.js';
import {DEMO_COMMUNITY,DEMO_PASSWORD,DEMO_USERS} from '../../packages/testing/seed.js';

// The public event page (/events/:id, event-page.js) in a real browser against the real API. Its action controls must not look
// live before their handlers exist, and a member action taken while the session is still loading must run exactly once.
// The server can hold the member's GET /api/v1/session before its status line ('headers'), or after its headers and the
// first byte of its body ('body').
type Hold={mode:'headers'|'body';held:Promise<void>;release:()=>void};
let hold:Hold|undefined;
const isSession=(url:string)=>new URL(url).pathname==='/api/v1/session';
function arm(mode:Hold['mode']){let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});hold={mode,held,release};return release;}
test.use({
 memberFeatures:{eventParticipationEnabled:true,eventEmailSender:async()=>{}},
 memberRequestGate:{
  before:async request=>{if(hold?.mode==='headers'&&isSession(request.url))await hold.held;},
  after:async(request,response)=>{
   if(hold?.mode!=='body'||!isSession(request.url))return response;
   const body=await response.text(),held=hold.held,headers=new Headers(response.headers),bytes=new TextEncoder();
   headers.delete('content-length');
   // JSON may begin with whitespace: the browser gets the status line, the headers and one space now, the object on release.
   return new Response(new ReadableStream({async start(controller){controller.enqueue(bytes.encode(' '));await held;controller.enqueue(bytes.encode(body));controller.close();}}),{status:response.status,headers});
  },
 },
});
test.afterEach(()=>{hold?.release();hold=undefined;});

/** An imported open event with a published share, so another member sees 報名, 我也要分享 and the organizer claim form. */
async function seedEvent(pool:Pool){
 const id=randomUUID(),title=`就緒測試活動 ${id.slice(0,8)}`;
 await pool.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,state,visibility,event_kind,source_url,source_host,imported,source_organizer)
  VALUES($1,$2,$3,$4,'按鈕就緒測試',now()+interval '2 days',now()+interval '2 days 1 hour','in_person','合成場地','published','open','other',$5,'www.accupass.com',true,'合成主辦')`,
  [id,DEMO_COMMUNITY,DEMO_USERS[0].user_id,title,`https://www.accupass.com/event/${id}`]);
 await pool.query(`INSERT INTO shares(share_id,community_id,kind,canonical_key,canonical_url,ref_table,ref_id,title,first_sharer_user_id,state)
  VALUES($1,$2,'event',$3,$4,'community_events',$5,$6,$7,'published')`,[randomUUID(),DEMO_COMMUNITY,`event:${id}`,`/events/${id}`,id,title,DEMO_USERS[0].user_id]);
 return id;
}
/** Later specs share this schema, so take the event out of every listing. */
async function retire(pool:Pool,id:string){
 await pool.query("UPDATE shares SET state='retracted' WHERE kind='event' AND ref_id=$1",[id]);
 await pool.query("UPDATE community_events SET state='cancelled' WHERE event_id=$1",[id]);
}
async function signedIn(browser:Browser,baseURL:string){
 const context=await browser.newContext({baseURL,viewport:{width:390,height:844}});
 const login=await context.request.post('/api/v1/auth/login',{headers:{Origin:baseURL},data:{email:DEMO_USERS[1].email,password:DEMO_PASSWORD}});
 expect(login.status()).toBe(200);
 return {context,csrf:(await login.json()).csrf_token as string};
}
/** Every RSVP, share or claim the page sends, with the headers that make it safe to retry. */
function operations(page:Page){
 const writes:{operation:string;csrf?:string;key?:string}[]=[];
 page.on('request',request=>{
  const path=new URL(request.url()).pathname,match=/^\/api\/v1\/(?:public\/)?events\/[0-9a-f-]{36}\/(rsvp|share|claim|register)$/.exec(path);
  if(request.method()==='POST'&&match){const headers=request.headers();writes.push({operation:match[1],csrf:headers['x-csrf-token'],key:headers['idempotency-key']});}
 });
 return writes;
}
const key=expect.stringMatching(/^[0-9a-f-]{36}$/);

test('event actions stay disabled, and their forms cannot submit natively, until the page script installs their handlers',async({browser,baseURL,e2eAuthPool})=>{
 const id=await seedEvent(e2eAuthPool);
 const {context}=await signedIn(browser,baseURL!);
 const guest=await browser.newContext({baseURL,viewport:{width:390,height:844}});
 try{
  for(const viewer of [context,guest]){
   const page=await viewer.newPage(),writes=operations(page),navigations:string[]=[];
   let release!:()=>void;const script=new Promise<void>(resolve=>{release=resolve;});
   await page.route('**/event-page.js',async route=>{await script;await route.continue();});
   page.on('request',request=>{if(request.isNavigationRequest()&&request.frame()===page.mainFrame())navigations.push(request.url());});
   await page.goto('/events/'+id,{waitUntil:'commit'});
   const controls=viewer===context
    ?[page.getByRole('button',{name:'報名',exact:true}),page.getByRole('button',{name:'我也要分享',exact:true}),page.getByRole('button',{name:'送出認領',exact:true})]
    :[page.getByRole('button',{name:'報名',exact:true})];
   if(viewer===context){
    await page.getByText('活動內容',{exact:true}).click();await page.getByText('我是主辦',{exact:true}).click();
    await page.getByLabel('說明',{exact:true}).fill('我是這場活動的主辦者，可以提供來源核實。');
    await page.getByLabel('我是主辦者，願意提供來源核實',{exact:true}).check();
    for(const control of controls)await expect(control).toBeDisabled();
    // Enter in a field would submit the form natively, as a GET to this page carrying the fields in its URL.
    await page.getByLabel('佐證網址',{exact:true}).press('Enter');
   }else{
    await expect(controls[0]).toBeDisabled();
    await page.getByLabel('姓名',{exact:true}).fill('合成訪客');await page.getByLabel('Email',{exact:true}).fill('ready-guest@example.test');
    await page.getByLabel('Email',{exact:true}).press('Enter');
   }
   release();
   for(const control of controls)await expect(control).toBeEnabled();
   expect(navigations).toEqual([new URL('/events/'+id,baseURL).href]);
   expect(new URL(page.url()).search).toBe('');
   expect(writes).toEqual([]);
   if(viewer===guest){
    // Guest registration itself is unchanged once the handler exists.
    await controls[0].click();
    await expect(page.locator('#event-status')).toContainText('報名已確認');
    expect(writes).toEqual([{operation:'register',csrf:undefined,key:undefined}]);
   }
   await page.close();
  }
 }finally{await context.close();await guest.close();await retire(e2eAuthPool,id);}
});

test('a member action taken while the session headers or body are held runs once, with the session CSRF token, when it arrives',async({browser,baseURL,e2eAuthPool})=>{
 const id=await seedEvent(e2eAuthPool);
 const {context,csrf}=await signedIn(browser,baseURL!);
 try{
  const page=await context.newPage(),writes=operations(page),status=page.locator('#event-status');
  // 1. Session headers held: 報名.
  let release=arm('headers');
  const sent=page.waitForRequest(request=>isSession(request.url()));
  await page.goto('/events/'+id);await sent;
  const register=page.getByRole('button',{name:'報名',exact:true});
  await register.click();
  await expect(status).toHaveText('處理中…');await expect(register).toBeDisabled();
  expect(writes).toEqual([]);
  release();
  await expect(page.getByText('已報名',{exact:true})).toBeVisible();
  expect(writes).toEqual([{operation:'rsvp',csrf,key}]);
  expect((await e2eAuthPool.query("SELECT count(*)::int n FROM community_event_rsvps WHERE event_id=$1 AND user_id=$2",[id,DEMO_USERS[1].user_id])).rows[0].n).toBe(1);
  // 2. Session headers received, body held: 我也要分享.
  release=arm('body');
  const headers=page.waitForResponse(response=>isSession(response.url()));
  await page.reload();await headers;
  const share=page.getByRole('button',{name:'我也要分享',exact:true});
  await share.click();
  await expect(status).toHaveText('處理中…');await expect(share).toBeDisabled();
  expect(writes).toHaveLength(1);
  release();
  await expect(status).toHaveText('分享連結已建立');await expect(page.getByLabel('我的分享連結',{exact:true})).toBeVisible();
  expect(writes.slice(1)).toEqual([{operation:'share',csrf,key}]);
  // 3. Session headers held: the organizer claim, submitted with Enter.
  release=arm('headers');
  const again=page.waitForRequest(request=>isSession(request.url()));
  await page.reload();await again;
  await page.getByText('活動內容',{exact:true}).click();await page.getByText('我是主辦',{exact:true}).click();
  await page.getByLabel('說明',{exact:true}).fill('我是這場活動的主辦者，可以提供來源核實。');
  await page.getByLabel('我是主辦者，願意提供來源核實',{exact:true}).check();
  await page.getByLabel('佐證網址',{exact:true}).press('Enter');
  await expect(status).toHaveText('處理中…');await expect(page.getByRole('button',{name:'送出認領',exact:true})).toBeDisabled();
  expect(writes).toHaveLength(2);
  release();
  await expect(status).toHaveText('認領已送出，等待來源核實');
  expect(writes.slice(2)).toEqual([{operation:'claim',csrf,key}]);
  expect(new URL(page.url()).search).toBe('');
  expect((await e2eAuthPool.query('SELECT count(*)::int n FROM community_event_organizer_claims WHERE event_id=$1 AND user_id=$2',[id,DEMO_USERS[1].user_id])).rows[0].n).toBe(1);
 }finally{await context.close();await retire(e2eAuthPool,id);}
});

test('a failed session read is retried by the next click, and an expired session offers sign-in',async({browser,baseURL,e2eAuthPool})=>{
 const id=await seedEvent(e2eAuthPool);
 const {context,csrf}=await signedIn(browser,baseURL!);
 try{
  const page=await context.newPage(),writes=operations(page),status=page.locator('#event-status'),signIn=page.getByRole('link',{name:'登入',exact:true});
  let answer:'unavailable'|'expired'|'real'='unavailable';
  await page.route('**/api/v1/session',route=>answer==='real'?route.continue():route.fulfill(answer==='unavailable'
   ?{status:503,json:{status:503,code:'service_unavailable'}}:{status:401,json:{status:401,code:'unauthenticated'}}));
  await page.goto('/events/'+id);
  const register=page.getByRole('button',{name:'報名',exact:true});
  await register.click();
  await expect(status).toHaveText('無法確認登入狀態，請再試一次。');
  await expect(register).toBeEnabled();await expect(signIn).toBeHidden();
  expect(writes).toEqual([]);
  answer='real';
  await register.click();
  await expect(page.getByText('已報名',{exact:true})).toBeVisible();
  expect(writes).toEqual([{operation:'rsvp',csrf,key}]);
  // The page was rendered for a member whose session has since ended.
  answer='expired';
  await page.reload();
  await expect(status).toHaveText('登入已過期，請重新登入。');
  await expect(signIn).toBeVisible();await expect(signIn).toHaveAttribute('href',`/events/${id}?app=1`);
  const share=page.getByRole('button',{name:'我也要分享',exact:true});
  await share.click();
  await expect(status).toHaveText('登入已過期，請重新登入。');await expect(signIn).toBeVisible();await expect(share).toBeEnabled();
  expect(writes).toHaveLength(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{await context.close();await retire(e2eAuthPool,id);}
});
