import {buildSync} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {test,expect} from './fixtures.js';

// Real React and production formatters. Count work rather than asserting a
// machine-specific timing budget; this is not a real-device latency measurement.
for(const kind of ['guild','squad'])for(const mode of ['desktop','phone','compact'])test(`${kind}/${mode}: typing reuses channel timestamps while search, refresh and selection remain current`,async({page})=>{
  await page.setViewportSize(mode==='phone'?{width:390,height:844}:{width:1280,height:900});
  const time=new Date('2026-11-04T12:00:00Z');await page.clock.install({time});await page.clock.pauseAt(new Date(time.getTime()+1000));
  const bundle=buildSync({stdin:{resolveDir:fileURLToPath(new URL('../..',import.meta.url)),loader:'tsx',contents:`
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {MemberChannels} from './apps/portal-web/src/modules/MemberChannels';
    const fixture={formats:0,reads:[],writes:[],fresh:false};window.__channelFormat=fixture;
    Intl.DateTimeFormat=new Proxy(Intl.DateTimeFormat,{construct(target,args){
      const options=args[1];if(options?.year==='numeric'&&options?.month==='short'&&options?.hour==='2-digit')fixture.formats++;
      return Reflect.construct(target,args);
    }});
    const kind=${JSON.stringify(kind)};
    const room=id=>({kind,channel_key:id,name:id,unread_count:fixture.fresh&&id==='room-0'?7:0,last_message_at:fixture.fresh&&id==='room-0'?'2026-11-05T07:22:33Z':'2026-11-04T06:11:22Z'});
    const client={sessionGeneration:1,get(url){fixture.reads.push(url);
      if(url.startsWith('/me/channels?')){const offset=Number(new URL(url,'http://fixture').searchParams.get('offset'));return Promise.resolve({items:Array.from({length:20},(_,i)=>room('room-'+(offset+i))),unread_count:fixture.fresh?7:0,next_offset:offset===0?20:null});}
      const match=url.match(/^\\/me\\/channels\\/(?:guild|squad)\\/(room-\\d+)\\/messages\\?/);if(match)return Promise.resolve({channel:{kind,channel_key:match[1],name:match[1]},items:[],unread_count:0,retraction_count:'0',next_offset:null});
      throw new Error('Unexpected fixture read: '+url);
    },post(...args){fixture.writes.push(args);throw new Error('No write is permitted in this fixture');}};
    const root=createRoot(document.getElementById('root'));fixture.unmount=()=>root.unmount();
    root.render(<MemberChannels kind={kind} compact={${mode==='compact'}} client={client} session={{user:{user_id:'synthetic-user'}}} onUnread={()=>{}} onNavigate={()=>{throw new Error('Unexpected navigation');}}/>);
  `},bundle:true,write:false,format:'iife',platform:'browser',outfile:'channel-list-format-fixture.js'}).outputFiles;
  await page.route('**/__channel-list-format-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div id="root"></div></body></html>'}));
  await page.goto('/__channel-list-format-fixture');
  for(const output of bundle.filter(file=>file.path.endsWith('.css')))await page.addStyleTag({content:output.text});
  await page.addScriptTag({content:bundle.find(file=>file.path.endsWith('.js'))!.text});
  const unit=kind==='guild'?'公會':'小隊',list=page.locator('ul.member-channel-list'),room=(id:string)=>list.locator(`button[data-channel-key="${id}"]`);
  await expect(list.locator('li')).toHaveCount(20);await page.getByRole('button',{name:`載入更多${unit}頻道`,exact:true}).click();await expect(list.locator('li')).toHaveCount(40);
  const oldLabel=await room('room-0').locator('.chat-peer-preview').textContent();await room('room-0').click();const input=page.getByRole('textbox',{name:/^在 .+ 發言$/});await expect(input).toBeVisible();
  await page.evaluate(()=>{(window as any).__channelFormat.formats=0;});
  for(let i=0;i<12;i++)await input.fill(`保留草稿${i}`);
  await expect(input).toHaveValue('保留草稿11');expect(await page.evaluate(()=>(window as any).__channelFormat.formats)).toBe(0);
  const back=()=>page.getByRole('button',{name:mode==='compact'?`切換${unit}`:`← 返回${unit}列表`,exact:true}).click();
  if(mode!=='desktop'){await expect(list).toBeHidden();await back();}
  // The paused clock isolates immediate filtering; runtime tests cover debounce/API paths.
  const search=page.getByRole('searchbox',{name:`搜尋${unit}頻道`,exact:true});await search.fill('room-39');await expect(list.locator('li')).toHaveCount(1);await expect(room('room-39')).toBeVisible();await search.fill('');await expect(list.locator('li')).toHaveCount(40);
  await page.evaluate(()=>{(window as any).__channelFormat.fresh=true;});await page.getByRole('button',{name:`重新整理${unit}頻道`,exact:true}).click();
  await expect(room('room-0')).toContainText('7 則未讀');await expect(room('room-0').locator('.chat-peer-preview')).not.toHaveText(oldLabel!);expect(await page.evaluate(()=>(window as any).__channelFormat.formats)).toBeGreaterThan(0);
  const descriptionId=await room('room-0').getAttribute('aria-describedby');const visibleLabel=await room('room-0').locator('.chat-peer-preview').textContent();await expect(page.locator(`[id="${descriptionId}"]`)).toHaveText(`${visibleLabel}，7 則未讀`);
  await room('room-1').click();await expect(input).toHaveValue('');if(mode!=='desktop')await back();await room('room-0').click();await expect(input).toHaveValue('保留草稿11');
  expect(await page.evaluate(()=>(window as any).__channelFormat.writes)).toEqual([]);await page.evaluate(()=>(window as any).__channelFormat.unmount());
});
