import {buildSync} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {test,expect} from './fixtures.js';

// Real React and production rows. Formatter call counts are deterministic work
// measurements, not a browser timing budget or a real-device responsiveness claim.
for(const mode of ['desktop','phone','compact'])test(`${mode}: typing skips cached conversation formatters while fresh rows and selection still update`,async({page})=>{
  await page.setViewportSize(mode==='phone'?{width:390,height:844}:{width:1280,height:900});
  const time=new Date('2026-11-04T12:00:00Z');await page.clock.install({time});await page.clock.pauseAt(new Date(time.getTime()+1000));
  const bundle=buildSync({stdin:{resolveDir:fileURLToPath(new URL('../..',import.meta.url)),loader:'tsx',contents:`
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {DirectMessages} from './apps/portal-web/src/modules/MemberMessages';
    const fixture={formats:0,reads:[],writes:[],fresh:false};window.__listRender=fixture;
    const original=Date.prototype.toLocaleString;Date.prototype.toLocaleString=function(...args){fixture.formats++;return original.apply(this,args);};
    const participant=id=>({user_id:id,display_name:id,avatar_url:null,last_seen_at:null,is_online:false});
    const row=id=>({participant:participant(id),can_send:true,last_message:{message_id:'message-'+id,sender_ref:id,recipient_ref:'synthetic-me',created_at:'2026-11-04T00:00:00.000Z',read_at:'2026-11-04T00:00:00.000Z',retracted_at:fixture.fresh&&id==='p1'?'2026-11-04T12:00:00.000Z':null,body:fixture.fresh&&id==='p0'?'新預覽':'preview-'+id},unread_count:fixture.fresh&&id==='p0'?7:0});
    const client={sessionGeneration:1,get(url){fixture.reads.push(url);
      if(url.startsWith('/me/conversations?')){const offset=Number(new URL(url,'http://fixture').searchParams.get('offset'));return Promise.resolve({items:Array.from({length:20},(_,i)=>row('p'+(offset+i))),unread_count:fixture.fresh?7:0,next_offset:offset===0?20:null});}
      const match=url.match(/^\\/me\\/conversations\\/(p\\d+)\\/messages\\?/);if(match)return Promise.resolve({participant:participant(match[1]),can_send:true,items:[],unread_count:0,retraction_count:'0',next_offset:null});
      throw new Error('Unexpected fixture read: '+url);
    },post(...args){fixture.writes.push(args);throw new Error('No write is permitted in this fixture');}};
    const root=createRoot(document.getElementById('root'));fixture.unmount=()=>root.unmount();
    root.render(<DirectMessages compact={${mode==='compact'}} client={client} session={{user:{user_id:'synthetic-me'}}} onUnread={()=>{}} openPeer={null}/>);
  `},bundle:true,write:false,format:'iife',platform:'browser',outfile:'direct-list-render-fixture.js'}).outputFiles;
  await page.route('**/__direct-list-render-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div id="root"></div></body></html>'}));
  await page.goto('/__direct-list-render-fixture');
  for(const output of bundle.filter(file=>file.path.endsWith('.css')))await page.addStyleTag({content:output.text});
  await page.addScriptTag({content:bundle.find(file=>file.path.endsWith('.js'))!.text});
  const list=page.locator('ul[aria-label="對話列表"]'),peer=(id:string)=>list.locator('button.messages-peer').filter({has:page.locator('strong',{hasText:new RegExp('^'+id+'$')})});
  await expect(list.locator('li')).toHaveCount(20);await page.getByRole('button',{name:'載入更多對話',exact:true}).click();await expect(list.locator('li')).toHaveCount(40);
  await peer('p0').click();const input=page.getByRole('textbox',{name:/^寫給 .+ 的訊息$/});await expect(input).toBeVisible();
  await page.evaluate(()=>{(window as any).__listRender.formats=0;});
  for(let i=0;i<12;i++)await input.fill(`保留草稿${i}`);
  await expect(input).toHaveValue('保留草稿11');expect(await page.evaluate(()=>(window as any).__listRender.formats)).toBe(0);
  if(mode!=='desktop'){await expect(list).toBeHidden();await page.getByRole('button',{name:mode==='compact'?'切換對象':'← 返回對話列表',exact:true}).click();}
  await page.evaluate(()=>{(window as any).__listRender.fresh=true;});await page.getByRole('button',{name:'重新整理對話',exact:true}).click();
  await expect(peer('p0')).toContainText('新預覽');await expect(peer('p0')).toContainText('7 則未讀');await expect(peer('p1')).toContainText('訊息已收回');expect(await page.evaluate(()=>(window as any).__listRender.formats)).toBeGreaterThan(0);
  await peer('p1').click();await expect(input).toHaveValue('');
  if(mode!=='desktop')await page.getByRole('button',{name:mode==='compact'?'切換對象':'← 返回對話列表',exact:true}).click();
  await peer('p0').click();await expect(input).toHaveValue('保留草稿11');
  expect(await page.evaluate(()=>(window as any).__listRender.writes)).toEqual([]);await page.evaluate(()=>(window as any).__listRender.unmount());
});
