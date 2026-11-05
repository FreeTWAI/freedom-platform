import {buildSync} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {test,expect} from './fixtures.js';

// Real React handlers, synthetic conversations and read-only responses. Browser
// execution does not replace real-device PWA or API/database authorization tests.
for(const mobile of [false,true])for(const failure of ['pending','backoff'] as const)test(`${mobile?'phone picker':'desktop'} discovers another conversation during ${failure} activity`,async({page})=>{
  await page.setViewportSize(mobile?{width:390,height:844}:{width:1280,height:900});
  const time=new Date('2026-11-04T12:00:00Z');await page.clock.install({time});await page.clock.pauseAt(new Date(time.getTime()+1000));
  const bundle=buildSync({stdin:{resolveDir:fileURLToPath(new URL('../..',import.meta.url)),loader:'tsx',contents:`
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {DirectMessages} from './apps/portal-web/src/modules/MemberMessages';
    const fixture={list:[],activity:[],history:[],unread:[],writes:[],fresh:false};window.__directPoll=fixture;
    const participant=id=>({user_id:id,display_name:id,avatar_url:null,last_seen_at:null,is_online:false});
    const conversation=id=>({participant:participant(id),can_send:true,last_message:{message_id:'message-'+id,sender_ref:id,recipient_ref:'synthetic-me',created_at:'2026-11-04T00:00:00.000Z',read_at:'2026-11-04T00:00:00.000Z',retracted_at:null,body:'preview-'+id},unread_count:id==='new'?7:0});
    const client={sessionGeneration:1,get(url){
      if(url.startsWith('/me/conversations?')){fixture.list.push(url);return Promise.resolve({items:(fixture.fresh?['old','new']:['old']).map(conversation),unread_count:fixture.fresh?7:0,next_offset:null});}
      if(url.endsWith('/activity'))return new Promise((resolve,reject)=>fixture.activity.push({url,resolve,reject}));
      if(url.startsWith('/me/conversations/old/messages?')){fixture.history.push(url);return Promise.resolve({participant:participant('old'),can_send:true,items:[],unread_count:0,retraction_count:'0',next_offset:null});}
      throw new Error('Unexpected fixture read: '+url);
    },post(...args){fixture.writes.push(args);throw new Error('No write is permitted in this fixture');}};
    const root=createRoot(document.getElementById('root'));fixture.unmount=()=>root.unmount();
    root.render(<DirectMessages client={client} session={{user:{user_id:'synthetic-me'}}} onUnread={count=>fixture.unread.push(count)} openPeer={null}/>);
  `},bundle:true,write:false,format:'iife',platform:'browser',outfile:'direct-list-poll-fixture.js'}).outputFiles;
  await page.route('**/__direct-list-poll-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div id="root"></div></body></html>'}));
  await page.goto('/__direct-list-poll-fixture');
  for(const output of bundle.filter(file=>file.path.endsWith('.css')))await page.addStyleTag({content:output.text});
  await page.addScriptTag({content:bundle.find(file=>file.path.endsWith('.js'))!.text});
  const list=page.getByRole('list',{name:'對話列表'}),count=()=>page.evaluate(()=>{const f=(window as any).__directPoll;return{list:f.list.length,activity:f.activity.length,history:f.history.length};});
  await list.locator('button.messages-peer').filter({hasText:'old'}).click();await expect(page.getByRole('button',{name:'搜尋訊息',exact:true})).toBeVisible();
  await page.clock.runFor(1000);await expect.poll(async()=>(await count()).activity).toBe(1);
  if(failure==='backoff'){
    const delays=[4000,8000,16000,32000];
    for(let i=0;i<5;i++){
      await page.evaluate(()=>(window as any).__directPoll.activity.at(-1).reject(new Error('synthetic temporary network error')));
      await expect(page.getByRole('status').filter({hasText:'新訊息更新暫停'})).toBeVisible();
      if(i<4){await page.clock.runFor(delays[i]);await expect.poll(async()=>(await count()).activity).toBe(i+2);}
    }
  }
  if(mobile)await page.getByRole('button',{name:'← 返回對話列表',exact:true}).click();
  const before=await count();await page.evaluate(()=>{(window as any).__directPoll.fresh=true;});
  await page.clock.runFor(failure==='pending'?7000:8000);await expect(list.locator('strong').filter({hasText:/^new$/})).toBeVisible();
  await page.clock.runFor(8000);await expect.poll(async()=>(await count()).list).toBe(before.list+2);
  expect((await count()).activity).toBe(before.activity);expect((await count()).history).toBe(1);
  expect(await page.evaluate(()=>(window as any).__directPoll.unread.at(-1))).toBe(7);
  const final=await count();await page.evaluate(()=>(window as any).__directPoll.unmount());await page.clock.runFor(16000);expect(await count()).toEqual(final);expect(await page.evaluate(()=>(window as any).__directPoll.writes)).toEqual([]);
});
