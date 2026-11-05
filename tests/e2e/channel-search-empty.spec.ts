import {buildSync} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {test,expect} from './fixtures.js';

// Real React list/search handlers with controlled read-only responses. No product
// bypass endpoint or real member data; API/DB authorization is a separate tier.
for(const kind of ['guild','squad'] as const)for(const mobile of [false,true])test(`${kind} search keeps empty states and pagination with their query on ${mobile?'phone':'desktop'}`,async({page})=>{
  await page.setViewportSize(mobile?{width:390,height:844}:{width:1280,height:900});
  const time=new Date('2026-11-04T12:00:00Z');await page.clock.install({time});await page.clock.pauseAt(new Date(time.getTime()+1000));
  const bundle=buildSync({stdin:{resolveDir:fileURLToPath(new URL('../..',import.meta.url)),loader:'tsx',contents:`
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {MemberChannels} from './apps/portal-web/src/modules/MemberChannels';
    const fixture={calls:[],navigations:[]};window.__channelSearch=fixture;
    const client={get(url){if(!url.startsWith('/me/channels?kind='))throw new Error('Unexpected fixture read');return new Promise((resolve,reject)=>fixture.calls.push({url,resolve,reject}));},post(){throw new Error('No write is permitted in this fixture');}};
    createRoot(document.getElementById('root')).render(<MemberChannels client={client} session={{user:{user_id:'synthetic-member'}}} kind="${kind}" active={false} onUnread={()=>{}} onNavigate={tab=>fixture.navigations.push(tab)}/>);
  `},bundle:true,write:false,format:'iife',platform:'browser',outfile:'channel-search-fixture.js'}).outputFiles;
  await page.route('**/__channel-search-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div id="root"></div></body></html>'}));
  await page.goto('/__channel-search-fixture');
  for(const output of bundle.filter(file=>file.path.endsWith('.css')))await page.addStyleTag({content:output.text});
  await page.addScriptTag({content:bundle.find(file=>file.path.endsWith('.js'))!.text});
  const unit=kind==='guild'?'公會':'小隊',input=page.getByRole('searchbox',{name:`搜尋${unit}頻道`});
  const membership=page.getByText(`你還沒有加入任何${unit}，加入後會出現該${unit}的閒聊頻道。`,{exact:true});
  const cta=page.getByRole('button',{name:kind==='guild'?'前往職業公會':'前往小隊集合',exact:true});
  const more=page.getByRole('button',{name:`載入更多${unit}頻道`,exact:true});
  const count=()=>page.evaluate(()=>(window as any).__channelSearch.calls.length);
  const room=(name:string,key=name)=>({kind,channel_key:key,name,unread_count:0,last_message_at:null});
  const finish=async(index:number,items:ReturnType<typeof room>[],next:number|null=null)=>{
    await expect.poll(count).toBe(index+1);
    await page.evaluate(({index,items,next})=>(window as any).__channelSearch.calls[index].resolve({items,next_offset:next,unread_count:17}),{index,items,next});
  };
  await finish(0,Array.from({length:20},(_,i)=>room(`已加入${i}`,`joined-${i}`)),20);await expect(more).toBeEnabled();
  await input.fill('不存在');await expect(more).toBeDisabled();await expect(membership).toHaveCount(0);await expect(count()).resolves.toBe(1);
  await page.clock.runFor(250);await expect.poll(count).toBe(2);await expect(more).toBeDisabled();
  await finish(1,[]);await expect(page.getByText('沒有符合的頻道，請換個關鍵字。',{exact:true})).toBeVisible();await expect(cta).toHaveCount(0);
  await input.fill('');await expect(membership).toHaveCount(0);await expect(cta).toHaveCount(0);
  await page.clock.runFor(250);await expect.poll(count).toBe(3);await expect(membership).toHaveCount(0);
  await page.evaluate(()=>(window as any).__channelSearch.calls[2].reject(new Error('synthetic network failure')));
  await expect(page.getByRole('alert')).toContainText('重新整理失敗');await expect(membership).toHaveCount(0);await expect(cta).toHaveCount(0);
  await page.getByRole('button',{name:`重新整理${unit}頻道`,exact:true}).click();
  await finish(3,[room('已加入的頻道')],20);await expect(page.getByRole('button',{name:'已加入的頻道',exact:true})).toBeVisible();
  await input.fill('新搜尋');await expect(more).toBeDisabled();await page.clock.runFor(250);
  await finish(4,[room('新搜尋第一頁','new-first')],20);await expect(more).toBeEnabled();await more.click();
  await expect.poll(count).toBe(6);
  const url=await page.evaluate(()=>(window as any).__channelSearch.calls[5].url as string),params=new URL(url,'https://fixture.invalid').searchParams;
  expect(params.get('search')).toBe('新搜尋');expect(params.get('offset')).toBe('20');
  await finish(5,[room('新搜尋第二頁','new-second')]);
  await expect(page.getByRole('button',{name:'新搜尋第一頁',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'新搜尋第二頁',exact:true})).toBeVisible();
  await input.fill('');await page.clock.runFor(250);await finish(6,[]);
  await expect(membership).toBeVisible();await expect(cta).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__channelSearch.navigations)).toEqual([]);
});
