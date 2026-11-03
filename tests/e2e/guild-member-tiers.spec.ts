import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {test,expect,type Browser,type BrowserContext,type Page,type TestInfo} from './fixtures.js';
import {navigate} from './navigation.js';
import {DEMO_COMMUNITY,DEMO_PASSWORD} from '../../packages/testing/seed.js';
import {hashPassword} from '../../modules/identity-membership/service.js';

const guildKey='guild_projection_mapping';
const notice='你是這個公會的實習成員：可以閱讀公會內容、在公會聊天室聊天。想發布或編輯，可以在聊天室跟會長打聲招呼，會長能把你設為正式成員。';
const internWrite='實習成員可以閱讀公會內容、在公會聊天室聊天；請會長把你設為正式成員後再發布或編輯。';
const cap='每個公會最多 3 位公會專家，請先移除一位再任命。';
const widths=[{width:1280,height:900},{width:820,height:900},{width:390,height:844}];
type Person={user_id:string;email:string;display_name:string;tier:'intern'|'full';expert?:boolean;master?:boolean};
type Fixture={guildName:string;people:Person[];master:Person;intern:Person;extra:Person};

function createFixture():Fixture{
 const run=randomUUID().slice(0,8);
 const people:Person[]=[
  {user_id:randomUUID(),email:`tier-master-${run}@example.test`,display_name:`層級會長 ${run}`,tier:'full',master:true},
  {user_id:randomUUID(),email:`tier-intern-${run}@example.test`,display_name:`層級實習 ${run}`,tier:'intern'},
  {user_id:randomUUID(),email:`tier-expert-a-${run}@example.test`,display_name:`層級專家甲 ${run}`,tier:'full',expert:true},
  {user_id:randomUUID(),email:`tier-expert-b-${run}@example.test`,display_name:`層級專家乙 ${run}`,tier:'full',expert:true},
  {user_id:randomUUID(),email:`tier-extra-${run}@example.test`,display_name:`層級候補 ${run}`,tier:'full'},
 ];
 return {guildName:'',people,master:people[0],intern:people[1],extra:people[4]};
}
async function seed(db:Pool,fixture:Fixture){
 const {people,master}=fixture;
 fixture.guildName=(await db.query('SELECT name FROM positioning_guild_catalog WHERE guild_key=$1',[guildKey])).rows[0].name as string;
 for(const person of people){
  await db.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,onboarding_required) VALUES($1,$2,$3,$4,$5,$6,false)`,[person.user_id,DEMO_COMMUNITY,person.email,person.display_name,hashPassword(DEMO_PASSWORD),randomUUID()]);
  await db.query(`INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state,member_tier) VALUES($1,$2,$3,$4,'active',$5)`,[randomUUID(),DEMO_COMMUNITY,person.user_id,guildKey,person.tier]);
  if(person.expert)await db.query('INSERT INTO positioning_guild_experts(community_id,guild_key,user_id,active,appointed_by_user_id) VALUES($1,$2,$3,true,$4)',[DEMO_COMMUNITY,guildKey,person.user_id,master.user_id]);
 }
 await db.query('INSERT INTO positioning_guild_officers(community_id,guild_key,user_id) VALUES($1,$2,$3)',[DEMO_COMMUNITY,guildKey,master.user_id]);
}
async function cleanup(db:Pool,fixture:Fixture){
 const ids=fixture.people.map(person=>person.user_id);
 await db.query('DELETE FROM positioning_guild_experts WHERE community_id=$1 AND guild_key=$2 AND user_id=ANY($3::uuid[])',[DEMO_COMMUNITY,guildKey,ids]);
 await db.query('DELETE FROM positioning_guild_officers WHERE community_id=$1 AND guild_key=$2 AND user_id=ANY($3::uuid[])',[DEMO_COMMUNITY,guildKey,ids]);
 await db.query('DELETE FROM member_notifications WHERE community_id=$1 AND recipient_ref=ANY($2::uuid[])',[DEMO_COMMUNITY,ids]);
 await db.query('DELETE FROM member_skill_book_grants WHERE community_id=$1 AND user_id=ANY($2::uuid[])',[DEMO_COMMUNITY,ids]);
 await db.query('DELETE FROM command_receipts WHERE user_id=ANY($1::uuid[])',[ids]);
 await db.query('DELETE FROM outbox WHERE transition_id IN (SELECT transition_id FROM transition_journal WHERE actor_ref=ANY($1::uuid[]))',[ids]);
 await db.query('DELETE FROM transition_journal WHERE actor_ref=ANY($1::uuid[])',[ids]);
 await db.query('DELETE FROM positioning_profession_memberships WHERE community_id=$1 AND user_id=ANY($2::uuid[])',[DEMO_COMMUNITY,ids]);
 await db.query('DELETE FROM sessions WHERE user_id=ANY($1::uuid[])',[ids]);
 await db.query('DELETE FROM users WHERE user_id=ANY($1::uuid[])',[ids]);
}
async function open(context:BrowserContext,person:Person){
 await context.route(url=>!['127.0.0.1','localhost'].includes(url.hostname),route=>route.abort());
 const page=await context.newPage();
 await page.goto('/');
 await page.getByLabel('電子郵件',{exact:true}).fill(person.email);
 await page.getByLabel('密碼',{exact:true}).fill(DEMO_PASSWORD);
 await page.getByRole('button',{name:'登入',exact:true}).click();
 await expect(page.getByRole('button',{name:'設定',exact:true})).toBeVisible();
 return {context,page};
}
async function withFixture(db:Pool,browser:Browser,baseURL:string,person:'intern'|'master',run:(fixture:Fixture,session:Awaited<ReturnType<typeof open>>)=>Promise<void>){
 // Record every intended ID before the first insert so partial seeds are owned too.
 const fixture=createFixture();
 let context:BrowserContext|undefined;
 const errors:unknown[]=[];
 try{
  await seed(db,fixture);
  context=await browser.newContext({baseURL,viewport:widths[0]});
  const session=await open(context,fixture[person]);
  await run(fixture,session);
 }catch(error){errors.push(error);}
 finally{
  try{await context?.close();}catch(error){errors.push(error);}
  // A timed-out/disposed browser must not strand the shared guild officer key.
  try{await cleanup(db,fixture);}catch(error){errors.push(error);}
 }
 if(errors.length===1)throw errors[0];
 if(errors.length>1)throw new AggregateError(errors,'Guild member tier fixture failed',{cause:errors[0]});
}
async function noOverflow(page:Page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
async function memberRow(page:Page,name:string){
 const dialog=page.getByRole('dialog');
 const search=dialog.getByRole('searchbox',{name:'搜尋公會成員'});
 await search.fill(name);
 await dialog.getByRole('button',{name:'搜尋成員',exact:true}).click();
 const row=dialog.locator('.directory-member');
 await expect(row).toHaveCount(1);
 await expect(row).toContainText(name);
 return row;
}

// Diagnostic-only: preserve immediate navigation/click semantics. Never collect
// text, values, arbitrary attributes, URLs or raw hashes (which can be secrets).
function activityDiagnostics(){
 const records:Record<string,string|number|boolean|null>[]=[];
 let unavailable=false;
 const receive=(value:unknown)=>{
  if(records.length>=200||!value||typeof value!=='object')return;
  const input=value as Record<string,unknown>,record:Record<string,string|number|boolean|null>={};
  const choices:Record<string,string[]>={kind:['initial','mutation','pointerdown','pointerup','click','click-bubble','scroll','hashchange','popstate'],route:['events','other'],target:['submit','form','calendar','other'],tag:['BUTTON','FORM','SELECT','INPUT','DIV','SPAN','SECTION','OTHER']};
  for(const [key,allowed] of Object.entries(choices))if(typeof input[key]==='string'&&allowed.includes(input[key] as string))record[key]=input[key] as string;
  if(!record.kind)return;
  for(const key of ['time','x','y','scrollX','scrollY','buttonX','buttonY','buttonWidth','buttonHeight'])if(typeof input[key]==='number'&&Number.isFinite(input[key]))record[key]=input[key] as number;
  for(const key of ['button','disabled','form','calendar','trusted'])if(typeof input[key]==='boolean')record[key]=input[key] as boolean;
  records.push(record);
 };
 return {
  receive,
  async install(page:Page){
   try{
    await page.exposeBinding('__guildActivityDiagnostic',(_source,value:unknown)=>receive(value));
    await page.evaluate(()=>{
     const buttonSelector='[data-guide-anchor="events:submit-event"]',formSelector='.experience-panel > form.experience-editor',calendarSelector='[data-guide-anchor="events:calendar"]';
     const emit=(kind:string,event?:Event)=>{
      const button=document.querySelector<HTMLButtonElement>(buttonSelector),rect=button?.getBoundingClientRect();
      const element=event?.target instanceof Element?event.target:null;
      const pointer=event instanceof MouseEvent?event:null;
      const record={kind,time:performance.now(),route:location.hash==='#events'?'events':'other',
       target:element?.closest(buttonSelector)?'submit':element?.closest(formSelector)?'form':element?.closest(calendarSelector)?'calendar':'other',
       tag:element&&['BUTTON','FORM','SELECT','INPUT','DIV','SPAN','SECTION'].includes(element.tagName)?element.tagName:'OTHER',
       x:pointer?.clientX,y:pointer?.clientY,scrollX,scrollY,button:Boolean(button),disabled:button?.disabled,
       buttonX:rect?.x,buttonY:rect?.y,buttonWidth:rect?.width,buttonHeight:rect?.height,
       form:Boolean(document.querySelector(formSelector)),calendar:Boolean(document.querySelector(calendarSelector)),trusted:event?.isTrusted};
      // Received records survive disposal in Node; in-flight bindings may be
      // lost when the page closes. This is best-effort evidence, not a full trace.
      void (window as unknown as {__guildActivityDiagnostic:(value:unknown)=>Promise<void>}).__guildActivityDiagnostic(record).catch(()=>{});
     };
     let last='',count=0;
     const observe=(kind:string,event?:Event)=>{
      if(count>=200)return;
      if(kind!=='initial'&&location.hash!=='#events'&&kind!=='hashchange'&&kind!=='popstate')return;
      if(kind==='mutation'){
       const state=[Boolean(document.querySelector(buttonSelector)),Boolean(document.querySelector(formSelector)),Boolean(document.querySelector(calendarSelector))].join(':');
       if(state===last)return;last=state;
      }
      count++;emit(kind,event);
     };
     for(const kind of ['pointerdown','pointerup','click'])document.addEventListener(kind,event=>{
      observe(kind,event);
     },{capture:true,passive:true});
     document.addEventListener('click',event=>observe('click-bubble',event),{passive:true});
     window.addEventListener('scroll',event=>observe('scroll',event),{passive:true});
     window.addEventListener('hashchange',event=>observe('hashchange',event));
     window.addEventListener('popstate',event=>observe('popstate',event));
     new MutationObserver(()=>observe('mutation')).observe(document.body,{childList:true,subtree:true});
     observe('initial');
    });
   }catch{unavailable=true;}
  },
  async attach(info:TestInfo){
   try{await info.attach('guild-activity-timing',{body:Buffer.from(JSON.stringify({version:1,delivery:'best-effort-until-page-disposal',unavailable,limit:200,records})),contentType:'application/json'});}catch{/* Diagnostics must never replace the original failure. */}
  },
 };
}

test('an intern sees the calm notice and a disabled guild-exchange submit at phone, tablet and desktop',async({browser,baseURL,e2eAuthPool},testInfo)=>{
 test.setTimeout(120_000);
 const diagnostics=activityDiagnostics();
 try{await withFixture(e2eAuthPool,browser,baseURL!,'intern',async(fixture,session)=>{
  await diagnostics.install(session.page);
  for(const viewport of widths){
   await session.page.setViewportSize(viewport);
   await navigate(session.page,'職業公會');
   const card=session.page.getByRole('article',{name:fixture.guildName,exact:true});
   await card.scrollIntoViewIfNeeded();
   await expect(card.getByRole('status')).toHaveText(notice);
   await noOverflow(session.page);
  }
  await session.page.setViewportSize(widths[0]);
  await navigate(session.page,'社群活動');
  await session.page.getByRole('button',{name:'辦活動'}).click();
  await session.page.getByText('更多設定：活動類型、人數、公會與參與範圍',{exact:true}).click();
  await session.page.getByLabel('活動類型').selectOption('guild_skill_exchange');
  await session.page.getByRole('combobox',{name:/^主辦公會/}).selectOption({label:fixture.guildName});
  const submit=session.page.getByRole('button',{name:'送出審核',exact:true});
  for(const viewport of widths){
   await session.page.setViewportSize(viewport);
   await expect(submit).toBeDisabled();
   await expect(session.page.getByText(internWrite)).toBeVisible();
   await noOverflow(session.page);
  }
 });}catch(error){await diagnostics.attach(testInfo);throw error;}
});

test('the guild master promotes an intern, appoints an expert, and sees the 3/3 refusal',async({browser,baseURL,e2eAuthPool})=>{
 test.setTimeout(120_000);
 await withFixture(e2eAuthPool,browser,baseURL!,'master',async(fixture,session)=>{
  await navigate(session.page,'職業公會');
  const card=session.page.getByRole('article',{name:fixture.guildName,exact:true});
  await card.getByRole('button',{name:'查看成員',exact:true}).click();
  const dialog=session.page.getByRole('dialog');
  await expect(dialog.locator('.guild-expert-count')).toHaveText('專家 2/3');
  const intern=await memberRow(session.page,fixture.intern.display_name);
  await expect(intern.locator('.guild-member-tier-intern')).toHaveText('實習成員');
  await intern.getByRole('button',{name:'設為正式成員',exact:true}).click();
  await expect(intern.locator('.guild-member-tier-full')).toHaveText('正式成員');
  await intern.getByRole('button',{name:'任命專家',exact:true}).click();
  await expect(intern.locator('.guild-member-expert')).toHaveText('公會專家');
  await expect(dialog.locator('.guild-expert-count')).toHaveText('專家 3/3');
  const extra=await memberRow(session.page,fixture.extra.display_name);
  await expect(extra.getByRole('button',{name:'任命專家',exact:true})).toBeDisabled();
  await expect(dialog.getByText(cap).first()).toBeVisible();
  for(const viewport of widths){
   await session.page.setViewportSize(viewport);
   await expect(dialog.locator('.guild-expert-count')).toHaveText('專家 3/3');
   await expect(extra.getByRole('button',{name:'任命專家',exact:true})).toBeDisabled();
   await expect(dialog.getByText(cap).first()).toBeVisible();
   await noOverflow(session.page);
  }
 });
});
