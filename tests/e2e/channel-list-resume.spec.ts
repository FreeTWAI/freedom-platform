import {buildSync} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {test,expect} from './fixtures.js';

// Real React handlers with controlled lifecycle events and read-only responses.
// This fixture is not a claim about a real device's PWA event sequence or API/DB authorization.
for(const kind of ['guild','squad'] as const)for(const mobile of [false,true])test(`${kind} list resumes without focus on ${mobile?'phone':'desktop'} and fences old responses`,async({page})=>{
  await page.setViewportSize(mobile?{width:390,height:844}:{width:1280,height:900});
  const time=new Date('2026-11-04T12:00:00Z');await page.clock.install({time});await page.clock.pauseAt(new Date(time.getTime()+1000));
  const bundle=buildSync({stdin:{resolveDir:fileURLToPath(new URL('../..',import.meta.url)),loader:'tsx',contents:`
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {MemberChannels} from './apps/portal-web/src/modules/MemberChannels';
    const fixture={calls:[],unread:[],visibility:'visible',online:true};window.__channelResume=fixture;
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>fixture.visibility});
    Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>fixture.online});
    fixture.event=(name,value)=>{if(name==='visibilitychange'){fixture.visibility=value;document.dispatchEvent(new Event(name));}else{if(name==='online')fixture.online=true;if(name==='offline')fixture.online=false;window.dispatchEvent(new Event(name));}};
    const client={get(url){if(!url.startsWith('/me/channels?kind='))throw new Error('Unexpected fixture read');return new Promise((resolve,reject)=>fixture.calls.push({url,resolve,reject}));},post(){throw new Error('No write is permitted in this fixture');}};
    const root=createRoot(document.getElementById('root'));fixture.unmount=()=>root.unmount();
    root.render(<MemberChannels client={client} session={{user:{user_id:'synthetic-member'}}} kind="${kind}" active={false} onUnread={value=>fixture.unread.push(value)} onNavigate={()=>{throw new Error('Unexpected navigation');}}/>);
  `},bundle:true,write:false,format:'iife',platform:'browser',outfile:'channel-resume-fixture.js'}).outputFiles;
  await page.route('**/__channel-resume-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div id="root"></div></body></html>'}));
  await page.goto('/__channel-resume-fixture');
  for(const output of bundle.filter(file=>file.path.endsWith('.css')))await page.addStyleTag({content:output.text});
  await page.addScriptTag({content:bundle.find(file=>file.path.endsWith('.js'))!.text});
  const count=()=>page.evaluate(()=>(window as any).__channelResume.calls.length);
  const finish=async(index:number,key:string,unread=0)=>{
    await page.evaluate(({index,key,unread,kind})=>(window as any).__channelResume.calls[index].resolve({items:[{kind,channel_key:key,name:key,unread_count:unread,last_message_at:null}],unread_count:unread,next_offset:null}),{index,key,unread,kind});
  };
  await expect.poll(count).toBe(1);await finish(0,'original');await expect(page.locator('[data-channel-key="original"]')).toBeVisible();
  await page.evaluate(()=>{const f=(window as any).__channelResume;f.event('visibilitychange','hidden');f.event('visibilitychange','visible');});
  await expect.poll(count).toBe(2); // Visibility alone, without a focus event, is sufficient.
  await page.evaluate(()=>{const f=(window as any).__channelResume;f.event('online');f.event('focus');f.event('focus');});
  expect(await count()).toBe(2);await finish(1,'fresh',7);await expect(page.locator('[data-channel-key="fresh"]')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>(window as any).__channelResume.unread.at(-1))).toBe(7);
  await page.evaluate(()=>(window as any).__channelResume.event('focus'));await expect.poll(count).toBe(3);
  await page.evaluate(()=>{const f=(window as any).__channelResume;f.event('offline');f.event('focus');});expect(await count()).toBe(3);
  await page.evaluate(()=>{const f=(window as any).__channelResume;f.event('online');f.event('focus');});await expect.poll(count).toBe(4);
  await finish(3,'reconnected',9);await expect(page.locator('[data-channel-key="reconnected"]')).toBeVisible();
  await finish(2,'stale',1);await expect(page.locator('[data-channel-key="stale"]')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>(window as any).__channelResume.unread.at(-1))).toBe(9);
  const unit=kind==='guild'?'公會':'小隊';await page.getByRole('searchbox',{name:`搜尋${unit}頻道`}).fill('different');
  await page.evaluate(()=>{const f=(window as any).__channelResume;f.event('visibilitychange','hidden');f.event('visibilitychange','visible');});await expect.poll(count).toBe(5);
  expect(await page.evaluate(()=>(window as any).__channelResume.calls[4].url)).toContain('search=different');
  await page.evaluate(()=>{const f=(window as any).__channelResume;f.unmount();f.event('online');f.event('focus');f.event('visibilitychange','visible');});
  await finish(4,'unmounted',99);await page.clock.runFor(1000);expect(await count()).toBe(5);
  expect(await page.evaluate(()=>(window as any).__channelResume.unread.at(-1))).toBe(9);
});
