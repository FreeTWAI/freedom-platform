import {randomUUID} from 'node:crypto';
import {test,expect} from './fixtures.js';
import {navigate} from './navigation.js';

// #401: synthetic event and registrations in this run's schema; removed afterwards.
test('the organizer opens the registration list in a dialog; guests show only their time and other members see no button',async({page,e2eAuthPool})=>{
  const id=randomUUID(),title=`名單活動 ${id.slice(0,8)}`;
  const starts=new Date(Date.now()+3*24*60*60*1000),ends=new Date(starts.getTime()+2*60*60*1000);
  await e2eAuthPool.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,state,visibility,event_kind,capacity)
    SELECT $1,community_id,user_id,$2,'合成活動說明',$3,$4,'online','線上教室','published','open','other',20 FROM users WHERE email='maker@local.test'`,[id,title,starts.toISOString(),ends.toISOString()]);
  await e2eAuthPool.query(`INSERT INTO community_event_rsvps(rsvp_id,event_id,user_id,state,updated_at) SELECT $1,$2,user_id,'going',now()-interval '2 hours' FROM users WHERE email='reviewer@local.test'`,[randomUUID(),id]);
  await e2eAuthPool.query(`INSERT INTO community_event_guest_rsvps(event_id,email,name,email_sent_at,created_at) VALUES($1,'secret-guest@example.org','不該出現的訪客名',now(),now()-interval '1 hour')`,[id]);
  try{
    await page.goto('/');
    await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
    await page.getByRole('button',{name:'登入',exact:true}).click();
    await navigate(page,'社群活動');
    const card=page.locator('.experience-card',{has:page.getByRole('heading',{name:title})});
    const trigger=card.getByRole('button',{name:'報名名單',exact:true});
    await trigger.click();
    const dialog=page.getByRole('dialog',{name:'報名名單'});
    await expect(dialog).toContainText('目前 2 人報名');
    const rows=dialog.locator('.event-attendee-list li');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('示範需求者');
    await expect(rows.nth(1)).toContainText('公開報名訪客');
    await expect(dialog).not.toContainText('secret-guest@example.org');await expect(dialog).not.toContainText('不該出現的訪客名');
    await page.screenshot({path:'test-results/event-attendees.png'});
    await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(trigger).toBeFocused();
    await page.setViewportSize({width:390,height:844});
    await trigger.click();await expect(rows).toHaveCount(2);
    expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:'test-results/event-attendees-390.png'});
    await dialog.getByRole('button',{name:'關閉',exact:true}).click();await expect(dialog).toBeHidden();

    // Another member sees the event but not the organizer-only list.
    await page.setViewportSize({width:1280,height:900});
    await page.getByRole('button',{name:'設定',exact:true}).click();await page.getByRole('menuitem',{name:'登出',exact:true}).click();
    await page.getByLabel('電子郵件',{exact:true}).fill('client@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
    await page.getByRole('button',{name:'登入',exact:true}).click();
    await navigate(page,'社群活動');
    await expect(card).toBeVisible();
    await expect(card.getByRole('button',{name:'報名名單',exact:true})).toHaveCount(0);
  }finally{
    await e2eAuthPool.query('DELETE FROM community_event_guest_rsvps WHERE event_id=$1',[id]);
    await e2eAuthPool.query('DELETE FROM community_event_rsvps WHERE event_id=$1',[id]);
    await e2eAuthPool.query('DELETE FROM community_events WHERE event_id=$1',[id]);
  }
});

for(const width of [1280,390])test(`registration roster follows accepted Back/Forward navigation and ignores late old reads (${width}px)`,async({page,e2eAuthPool})=>{
  const ids=[randomUUID(),randomUUID()],titles=ids.map((id,index)=>`名單路由 ${index} ${id.slice(0,8)}`);
  const starts=new Date(Date.now()+3*86400000),ends=new Date(starts.getTime()+7200000);
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  let requested!:()=>void;const started=new Promise<void>(resolve=>{requested=resolve;});
  let settled!:()=>void;const finished=new Promise<void>(resolve=>{settled=resolve;});
  let reads=0,holdStarted=false;
  page.on('request',request=>{if(new URL(request.url()).pathname===`/api/v1/events/${ids[0]}/attendees`)reads++;});
  try{
  for(let index=0;index<ids.length;index++){
    await e2eAuthPool.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,state,visibility,event_kind,capacity)
      SELECT $1,community_id,user_id,$2,'名單導航隔離案例',$3,$4,'online','合成教室','published','open','other',20 FROM users WHERE email='maker@local.test'`,[ids[index],titles[index],starts.toISOString(),ends.toISOString()]);
    await e2eAuthPool.query(`INSERT INTO community_event_guest_rsvps(event_id,email,name,email_sent_at,created_at) VALUES($1,$2,'不公開的訪客姓名',now(),now())`,[ids[index],`roster-${index}@example.org`]);
  }
    await page.setViewportSize({width,height:900});await page.goto('/');
    await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();
    await navigate(page,'社群活動');
    const card=(index:number)=>page.locator('.experience-card',{has:page.getByRole('heading',{name:titles[index],exact:true})});
    const dialog=page.getByRole('dialog',{name:'報名名單',exact:true});
    await card(0).getByRole('link',{name:'活動專頁',exact:true}).click();
    await expect(page.getByRole('region',{name:'活動專頁',exact:true})).toBeVisible();
    await card(0).getByRole('button',{name:'報名名單',exact:true}).click();await expect(dialog).toContainText('目前 1 人報名');await expect(dialog).toContainText(titles[0]);const firstReads=reads;
    await page.goBack();await expect.poll(()=>new URL(page.url()).hash).toBe('#events');await expect(dialog).toBeHidden();await expect(card(1)).toBeVisible();
    await page.goForward();await expect.poll(()=>new URL(page.url()).hash).toBe(`#events/${ids[0]}`);await expect(dialog).toBeHidden();expect(reads).toBe(firstReads);
    // Returning is not consent to reopen a private list; an explicit new open
    // reads current server data instead of reusing the previous roster snapshot.
    await e2eAuthPool.query(`INSERT INTO community_event_guest_rsvps(event_id,email,name,email_sent_at,created_at) VALUES($1,'roster-new@example.org','另一個私人姓名',now(),now())`,[ids[0]]);
    const triggerA=card(0).getByRole('button',{name:'報名名單',exact:true});await triggerA.click();await expect(dialog).toContainText('目前 2 人報名');expect(reads).toBe(firstReads+1);
    await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(triggerA).toBeFocused();
    await page.route(url=>url.pathname===`/api/v1/events/${ids[0]}/attendees`,async route=>{
      if(route.request().method()!=='GET'){await route.fallback();return;}
      holdStarted=true;requested();
      try{const response=await route.fetch();await held;await route.fulfill({response});}finally{settled();}
    });
    await triggerA.click();await started;await expect(dialog).toContainText('正在讀取報名名單');
    await page.goBack();await expect.poll(()=>new URL(page.url()).hash).toBe('#events');await expect(dialog).toBeHidden();
    await card(1).getByRole('link',{name:'活動專頁',exact:true}).click();const triggerB=card(1).getByRole('button',{name:'報名名單',exact:true});await triggerB.click();await expect(dialog).toContainText(titles[1]);await expect(dialog).toContainText('目前 1 人報名');
    release();await finished;await expect(dialog).toContainText(titles[1]);await expect(dialog).not.toContainText(titles[0]);await expect(dialog.locator('.event-attendee-list li')).toHaveCount(1);await expect(dialog).not.toContainText('example.org');await expect(dialog).not.toContainText('私人姓名');
    await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(triggerB).toBeFocused();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }finally{
    release();if(holdStarted)await finished;
    await e2eAuthPool.query('DELETE FROM community_event_guest_rsvps WHERE event_id=ANY($1::uuid[])',[ids]);
    await e2eAuthPool.query('DELETE FROM community_events WHERE event_id=ANY($1::uuid[])',[ids]);
  }
});
