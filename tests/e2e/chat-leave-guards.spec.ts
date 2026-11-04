import {buildSync} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {test,expect} from './fixtures.js';

// Exercise real React layout-effect setup/cleanup with the production aggregate.
// No platform data or product bypass endpoint is used by this local browser fixture.
test('chat leave guards AND-compose and one child cleanup cannot release a sibling',async({page})=>{
  const script=buildSync({stdin:{resolveDir:fileURLToPath(new URL('../..',import.meta.url)),loader:'tsx',contents:`
    import React,{useLayoutEffect,useRef,useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {useChatLeaveGuards} from './apps/portal-web/src/modules/chat-leave-guards';
    function Child({name,register}){
      const pending=useRef(false);
      useLayoutEffect(()=>{register(()=>!pending.current);return()=>register(null);},[register]);
      return <div><button onClick={()=>{pending.current=true;}}>Start {name}</button><button onClick={()=>{pending.current=false;}}>Confirm {name}</button></div>;
    }
    function Fixture(){
      const parent=useRef(null),register=useRef(guard=>{parent.current=guard;}),guards=useChatLeaveGuards(register.current);
      const [direct,setDirect]=useState(true),[guild,setGuild]=useState(true),[result,setResult]=useState('');
      return <><button onClick={()=>setDirect(value=>!value)}>Toggle direct</button><button onClick={()=>setGuild(value=>!value)}>Toggle guild</button>
        <button onClick={()=>setResult(parent.current()?'allowed':'blocked')}>Leave</button><output>{result}</output>
        {direct&&<Child name="direct" register={guards.direct}/>}{guild&&<Child name="guild" register={guards.guild}/>}
        <Child name="squad" register={guards.squad}/><Child name="world" register={guards.world}/></>;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  `},bundle:true,write:false,format:'iife',platform:'browser'}).outputFiles[0].text;
  await page.route('**/__chat-leave-guard-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div id="root"></div></body></html>'}));
  await page.goto('/__chat-leave-guard-fixture');await page.addScriptTag({content:script});
  const leave=async(expected:string)=>{await page.getByRole('button',{name:'Leave',exact:true}).click();await expect(page.locator('output')).toHaveText(expected);};
  await leave('allowed');await page.getByRole('button',{name:'Start guild',exact:true}).click();await leave('blocked');
  await page.getByRole('button',{name:'Toggle direct',exact:true}).click();await leave('blocked');
  await page.getByRole('button',{name:'Toggle direct',exact:true}).click();await leave('blocked');
  await page.getByRole('button',{name:'Start world',exact:true}).click();await page.getByRole('button',{name:'Confirm guild',exact:true}).click();await leave('blocked');
  await page.getByRole('button',{name:'Toggle guild',exact:true}).click();await leave('blocked');
  await page.getByRole('button',{name:'Confirm world',exact:true}).click();await leave('allowed');
});

// Synthetic composition flags exercise real React child/parent event bubbling.
// This is not a substitute for an operating-system IME or real-device test.
for(const mobile of [false,true])for(const signal of ['composing','legacy-229'] as const)test(`chat keeps the draft open for ${signal} Escape on ${mobile?'phone':'desktop'}`,async({page})=>{
  await page.setViewportSize(mobile?{width:390,height:844}:{width:1280,height:900});
  const bundle=buildSync({stdin:{resolveDir:fileURLToPath(new URL('../..',import.meta.url)),loader:'tsx',contents:`
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {FloatingMessages} from './apps/portal-web/src/modules/FloatingMessages';
    import {ChatInput} from './apps/portal-web/src/modules/ChatWorkspace';
    const client={sessionGeneration:0,get(){throw new Error('Unknown policy must not read');}};
    function Fixture(){
      const [open,setOpen]=useState(true),[draft,setDraft]=useState('保留中文草稿'),[sent,setSent]=useState(0);
      return <div className="app-frame"><main>背景頁面</main>
        <FloatingMessages client={client} preferencesEnabled={null} open={open} onToggle={()=>setOpen(value=>!value)} onClose={()=>setOpen(false)}>
          <ChatInput id="ime-compose" label="訊息草稿" value={draft} onChange={setDraft} onSend={()=>setSent(value=>value+1)} sending={false} hidden={false} mobile={${mobile}}/>
          <button type="button" onClick={()=>setSent(value=>value+1)}>送出測試訊息</button><output aria-label="送出次數">{sent}</output>
        </FloatingMessages></div>;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  `},bundle:true,write:false,format:'iife',platform:'browser',outfile:'chat-ime-fixture.js'}).outputFiles;
  await page.route('**/__chat-ime-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div id="root"></div></body></html>'}));
  await page.goto('/__chat-ime-fixture');
  for(const output of bundle.filter(file=>file.path.endsWith('.css')))await page.addStyleTag({content:output.text});
  await page.addScriptTag({content:bundle.find(file=>file.path.endsWith('.js'))!.text});
  const panel=page.locator('.floating-message-panel'),draft=page.getByRole('textbox',{name:'訊息草稿'}),launcher=page.locator('.floating-messages');
  await expect(panel).toBeVisible();await draft.focus();
  const consumed=await draft.evaluate((node,kind)=>{
    node.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'中'}));
    const event=new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Escape',code:'Escape',isComposing:kind==='composing'});
    if(kind==='legacy-229')Object.defineProperty(event,'keyCode',{value:229});
    node.dispatchEvent(event);return event.defaultPrevented;
  },signal);
  expect(consumed).toBe(false);await expect(panel).toBeVisible();await expect(draft).toBeFocused();
  await expect(draft).toHaveValue('保留中文草稿');await expect(page.getByLabel('送出次數')).toHaveText('0');
  await draft.dispatchEvent('compositionend',{data:'中'});
  await page.keyboard.press('Escape');await expect(panel).toBeHidden();await expect(launcher).toBeFocused();
  await launcher.click();await expect(panel).toBeVisible();await expect(draft).toHaveValue('保留中文草稿');
  await expect(page.getByLabel('送出次數')).toHaveText('0');
});
