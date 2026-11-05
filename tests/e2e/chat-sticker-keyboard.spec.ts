import {buildSync} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {test,expect} from './fixtures.js';

// Real React handlers, nested inside the production chat and a sending form.
// Synthetic composition flags are not an operating-system IME/device test.
for(const mobile of [false,true])for(const signal of ['composing','legacy-229'] as const)test(`sticker search preserves composing Escape on ${mobile?'phone':'desktop'} (${signal})`,async({page})=>{
  await page.setViewportSize(mobile?{width:390,height:844}:{width:1280,height:900});
  const bundle=buildSync({stdin:{resolveDir:fileURLToPath(new URL('../..',import.meta.url)),loader:'tsx',contents:`
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {FloatingMessages} from './apps/portal-web/src/modules/FloatingMessages';
    import {ChatInput} from './apps/portal-web/src/modules/ChatWorkspace';
    import {ChatExtras} from './apps/portal-web/src/modules/ChatContent';
    const client={sessionGeneration:0,get(){throw new Error('Unknown policy must not read');}};
    function Fixture(){
      const [open,setOpen]=useState(true),[draft,setDraft]=useState('保留中文草稿'),[sent,setSent]=useState(0);
      const [rich,setRich]=useState({reply:{message_id:'reply-1',sender_ref:'member-1',sender_name:'工坊夥伴',body:'保留回覆內容'}});
      return <div className="app-frame"><main>背景頁面</main>
        <FloatingMessages client={client} preferencesEnabled={null} open={open} onToggle={()=>setOpen(value=>!value)} onClose={()=>setOpen(false)}>
          <form onSubmit={event=>{event.preventDefault();setSent(value=>value+1);}}>
            <ChatInput id="sticker-ime-compose" label="訊息草稿" value={draft} onChange={setDraft} onSend={()=>setSent(value=>value+1)} sending={false} hidden={false} mobile={${mobile}}/>
            <ChatExtras draft={rich} onChange={value=>setRich(current=>({...current,...value}))} onSendSticker={()=>setSent(value=>value+1)} disabled={false} target="member-1"/>
            <button type="submit">送出測試訊息</button><output aria-label="送出次數">{sent}</output>
          </form>
        </FloatingMessages></div>;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  `},bundle:true,write:false,format:'iife',platform:'browser',outfile:'chat-sticker-keyboard-fixture.js'}).outputFiles;
  await page.route('**/__chat-sticker-keyboard-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div id="root"></div></body></html>'}));
  await page.goto('/__chat-sticker-keyboard-fixture');
  for(const output of bundle.filter(file=>file.path.endsWith('.css')))await page.addStyleTag({content:output.text});
  await page.addScriptTag({content:bundle.find(file=>file.path.endsWith('.js'))!.text});
  const panel=page.locator('.floating-message-panel'),picker=page.getByRole('region',{name:'工坊貼圖'});
  const toggle=page.getByRole('button',{name:'選擇貼圖',exact:true}),search=page.getByRole('searchbox',{name:'搜尋貼圖'});
  const draft=page.getByRole('textbox',{name:'訊息草稿'}),reply=page.getByLabel('回覆的訊息');
  await toggle.click();await expect(picker).toBeVisible();await search.fill('加');await search.focus();
  const consumed=await search.evaluate((node,kind)=>{
    node.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'加'}));
    const event=new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Escape',code:'Escape',isComposing:kind==='composing'});
    if(kind==='legacy-229')Object.defineProperty(event,'keyCode',{value:229});
    node.dispatchEvent(event);return event.defaultPrevented;
  },signal);
  expect(consumed).toBe(false);await expect(picker).toBeVisible();await expect(panel).toBeVisible();
  await expect(search).toBeFocused();await expect(search).toHaveValue('加');
  await expect(draft).toHaveValue('保留中文草稿');await expect(reply).toContainText('保留回覆內容');
  await expect(page.getByLabel('送出次數')).toHaveText('0');
  await search.dispatchEvent('compositionend',{data:'加'});
  await page.keyboard.press('Escape');await expect(picker).toBeHidden();await expect(panel).toBeVisible();await expect(toggle).toBeFocused();
  await toggle.click();await expect(search).toHaveValue('加');await search.focus();
  await page.keyboard.press('Enter');await expect(page.getByLabel('送出次數')).toHaveText('0');
  await expect(picker).toBeVisible();await expect(search).toHaveValue('加');
  await page.getByRole('button',{name:'關閉貼圖',exact:true}).click();
  await expect(picker).toBeHidden();await expect(panel).toBeVisible();await expect(toggle).toBeFocused();
  await expect(draft).toHaveValue('保留中文草稿');await expect(reply).toContainText('保留回覆內容');
  await expect(page.getByLabel('送出次數')).toHaveText('0');
});
