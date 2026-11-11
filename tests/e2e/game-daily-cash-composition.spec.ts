import {test,expect,type Page,type Locator} from './fixtures.js';
import {captureDailyStage,verifyDailyResult} from './helpers/daily-result-stage.js';
import {PerspectiveCamera,Vector3} from 'three';
import {cashDeck} from '../../apps/portal-web/src/games/domain.js';
// Authored browser regression: --list is discovery only, not execution or art acceptance.
async function scaleText(owner:Locator,scale:number){
    await owner.evaluate((el,scale)=>{
        const nodes=[el,...el.querySelectorAll('*')].filter(node=>node instanceof HTMLElement) as HTMLElement[];
        for(const node of nodes)if(node.dataset.cashScaled)node.style.fontSize='';
        const fonts=nodes.map(el=>({el,font:parseFloat(getComputedStyle(el).fontSize)}));
        for(const {el,font}of fonts){el.style.fontSize=`${font*scale}px`;el.dataset.cashScaled='1';}
        for(const [side,value]of Object.entries({top:12,right:8,bottom:16,left:8}))(el as HTMLElement).style.setProperty(`--game-safe-${side}`,`${value}px`);
    },scale);
}
async function visibleControl(control:Locator){
    await expect(control).toBeVisible();expect(await control.evaluate(el=>{
        const r=el.getBoundingClientRect(),o=el.closest('.fullscreen-game')!.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
        return r.width>=44&&r.height>=44&&r.left>=o.left-1&&r.top>=o.top-1&&r.right<=o.right+1&&r.bottom<=o.bottom+1&&r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&!!hit&&(el===hit||el.contains(hit));
    })).toBe(true);
}
// Inspect the actual cascade, including translucent cover backgrounds. Both
// black and white underlays bound the possible background luminance.
async function overlayContrast(page:Page){
    const paragraphs=page.locator('.daily-cash-overlay-copy p');expect(await paragraphs.count()).toBeGreaterThan(0);
    const observations=await paragraphs.evaluateAll(nodes=>{
        const rgba=(value:string)=>{const channels=value.match(/[\d.]+/g)!.map(Number);return [...channels.slice(0,3),channels[3]??1];};
        const over=(front:number[],back:number[])=>front.slice(0,3).map((v,i)=>v*front[3]+back[i]*(1-front[3]));
        const luminance=(color:number[])=>color.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
        return nodes.map(node=>{const style=getComputedStyle(node),cover=getComputedStyle(node.closest('.fw-arcade-stage-cover')!),ink=rgba(style.color),background=rgba(style.backgroundColor),surface=rgba(cover.backgroundColor);
            const a=luminance(ink.slice(0,3)),range=[0,255].map(v=>luminance(over(background,over(surface,[v,v,v]))));
            const contrasts=range.map(b=>(Math.max(a,b)+.05)/(Math.min(a,b)+.05));
            return {color:style.color,ink:cover.color,alpha:ink[3],minContrast:a>=range[0]&&a<=range[1]?1:Math.min(...contrasts)};
        });
    });
    for(const observation of observations){expect(observation.color).toBe(observation.ink);expect(observation.alpha).toBe(1);expect(observation.minContrast).toBeGreaterThanOrEqual(4.5);}
}

async function card(page:Page){
 const box=(await page.locator('.fw-arcade-stage').boundingBox())!,a=box.width/box.height;
 const c=new PerspectiveCamera(a<1?2*Math.atan(Math.tan(21*Math.PI/180)*Math.max(2.2,.95/a))*180/Math.PI:42,a,.1,60);c.position.set(0,5.3,2.7);c.lookAt(0,0,.23);c.updateMatrixWorld(true);
 const pixel=(x:number,z:number)=>{const p=new Vector3(x,.33,z).project(c);return {x:box.x+(p.x+1)*box.width/2,y:box.y+(1-p.y)*box.height/2};};
 return {box,center:pixel(0,0),corners:[[-1.6,-1.075],[1.6,-1.075],[1.6,1.075],[-1.6,1.075]].map(([x,z])=>pixel(x,z))};
}
async function inspect(page:Page){
 const owner=page.locator('.fullscreen-game'),host=page.locator('.fw-arcade-stage'),frame=(await owner.boundingBox())!,geometry=await card(page);
 expect(geometry.box.width/frame.width).toBeGreaterThan(.99);expect(geometry.box.height/frame.height).toBeGreaterThan(.99);
 await expect(page.locator('.daily-cash .fw-arcade-stage-wrap')).toHaveCSS('max-width','none');
 for(const p of [geometry.center,...geometry.corners]){
  expect(p.x).toBeGreaterThan(frame.x+7);expect(p.x).toBeLessThan(frame.x+frame.width-7);expect(p.y).toBeGreaterThan(frame.y+7);expect(p.y).toBeLessThan(frame.y+frame.height-7);
  expect(await host.evaluate((el,p)=>{const hit=document.elementFromPoint(p.x,p.y);return !!hit&&el.contains(hit);},p)).toBe(true);
 }
 // Locate by painted text, independently of aria-label. Playwright checks
 // the computed accessible name, not just the attribute or a new-name locator.
 const sortButtons=owner.locator('.fw-arcade-sort-buttons button');await expect(sortButtons).toHaveCount(2);
 for(const label of ['←退券','收鈔→']){
  const control=sortButtons.filter({hasText:label});await expect(control).toHaveText(label);await expect(control).toBeVisible();
  const visible=(await control.innerText()).trim();
  await expect(control).toHaveAccessibleName(new RegExp(visible));
 }
 for(const name of ['回遊樂場','玩法說明','重新開始這一局','暫停','←退券（退回票券）','收鈔→（收取道具鈔）'])await visibleControl(page.getByRole('button',{name,exact:true}));await visibleControl(owner.locator('.daily-scene-mode button'));
 const violations=await owner.evaluate(el=>{
  const fields=[...el.querySelectorAll<HTMLElement>('.fw-arcade-toolbar button,.fw-arcade-counter,.daily-cash-facts,.fw-arcade-sort-buttons button,.daily-scene-mode button')],bad:string[]=[],o=el.getBoundingClientRect();
  for(const [i,node]of fields.entries()){
   const r=node.getBoundingClientRect();if(r.left<o.left||r.right>o.right||r.top<o.top||r.bottom>o.bottom)bad.push(`outside: ${node.className}`);
   for(const other of fields.slice(i+1)){const q=other.getBoundingClientRect();if(Math.min(r.right,q.right)-Math.max(r.left,q.left)>1&&Math.min(r.bottom,q.bottom)-Math.max(r.top,q.top)>1)bad.push(`overlap: ${node.className}/${other.className}`);}
   const walk=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);let text:Node|null;
   while((text=walk.nextNode())){if(!text.textContent?.trim())continue;const range=document.createRange();range.selectNodeContents(text);for(const t of range.getClientRects())if(t.left<r.left-1||t.right>r.right+1||t.top<r.top-1||t.bottom>r.bottom+1)bad.push(`text clipped: ${node.className}`);}
  }return bad;
 });expect(violations).toEqual([]);
 expect(await owner.locator('.fw-arcade-controls').evaluate(el=>{const s=getComputedStyle(el);return s.backgroundColor==='rgba(0, 0, 0, 0)'&&s.borderTopWidth==='0px'&&el.scrollHeight<=el.clientHeight+1;})).toBe(true);
 return geometry;
}
for(const light of [false,true])for(const viewport of [{width:320,height:568},{width:390,height:844},{width:667,height:375}])for(const scale of [1,2])test(`CASH world ${light?'light':'native'} ${viewport.width} ${scale*100}%: whole card, floating controls, actual sorting and interruption`,async({page},testInfo)=>{
 // These native landscape journeys include 30 real sorts and multiple full-scene captures.
 // Both take 38–39s locally and exceeded the 45s case budget on the hosted renderer.
 if(!light&&viewport.width===667)test.setTimeout(90_000);
 await page.setViewportSize(viewport);await page.addInitScript(()=>{Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:true});Element.prototype.requestFullscreen=async()=>{throw new DOMException('Controlled fullscreen rejection','NotAllowedError');};});
 await page.clock.install({time:new Date('2026-11-09T12:00:00Z')});await page.goto('/play?game=cash&seed=42');await expect(page.locator('[data-game-stage="ready"]')).toBeVisible({timeout:15000});await page.clock.pauseAt(new Date('2026-11-09T12:01:00Z'));
 await overlayContrast(page);await page.getByRole('button',{name:'開始這一局',exact:true}).click();
 if(light){await page.getByRole('button',{name:'3D · 改用輕量插畫',exact:true}).click();await expect(page.locator('[data-game-stage="ready"]')).toHaveAttribute('data-daily-renderer','light');await page.getByRole('button',{name:'繼續這一局',exact:true}).click();}
 const owner=page.locator('.fullscreen-game'),board=page.locator('.fw-arcade-board');await scaleText(owner,scale);await expect(owner).toHaveClass(/fullscreen-game--viewport/);await expect(board).toBeFocused();
 const prefix=`cash-world-${light?'light':'native'}-${viewport.width}-${scale*100}pct`,geometry=await inspect(page);await testInfo.attach(`${prefix}-geometry.json`,{body:JSON.stringify(geometry),contentType:'application/json'});await testInfo.attach(`${prefix}-fullscreen.png`,{body:await owner.screenshot(),contentType:'image/png'});
 await page.getByRole('button',{name:'退出全螢幕',exact:true}).click();await owner.scrollIntoViewIfNeeded();await inspect(page);await testInfo.attach(`${prefix}-normal.png`,{body:await owner.screenshot(),contentType:'image/png'});await page.getByRole('button',{name:'⛶ 全螢幕',exact:true}).click();
 const start=(await card(page)).center,deck=cashDeck(42);await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+20,start.y);await page.mouse.up();await expect(page.locator('[data-cash-progress]')).toHaveText('0/30');
 await board.press(deck[0].valid?'ArrowLeft':'ArrowRight');await expect(page.locator('[data-cash-mistakes]')).toHaveText('錯1');await page.clock.runFor(200);
 const help=page.getByRole('button',{name:'玩法說明',exact:true});await help.click();const dialog=page.getByRole('dialog',{name:'玩法說明',exact:true});await expect(dialog).toContainText('目前這張');await page.keyboard.press('Tab');expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);await page.keyboard.press('Escape');await expect(help).toBeFocused();await overlayContrast(page);await visibleControl(page.getByRole('button',{name:'繼續這一局',exact:true}));await page.getByRole('button',{name:'繼續這一局',exact:true}).click();
 const resultCheckpoint=await captureDailyStage(page);
 for(const [index,item]of deck.entries()){
  await page.clock.runFor(200);
  if(index%3===0){const p=(await card(page)).center;await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+(item.valid?60:-60),p.y,{steps:4});await page.mouse.up();}
  else if(index%3===1)await page.getByRole('button',{name:item.valid?'收鈔→（收取道具鈔）':'←退券（退回票券）',exact:true}).click();
  else await board.press(item.valid?'ArrowRight':'ArrowLeft');
  if(index<29)await expect(page.locator('[data-cash-progress]')).toHaveText(`${index+1}/30`);
  // The two-digit facts must remain clear after real sorting, including the
  // shorter normal owner that exposed the original enlarged-text collision.
  if(index===28&&scale===2&&viewport.width===667){
   await page.getByRole('button',{name:'退出全螢幕',exact:true}).click();await owner.scrollIntoViewIfNeeded();await inspect(page);
   await testInfo.attach(`${prefix}-normal-29-cards.png`,{body:await owner.screenshot(),contentType:'image/png'});
   await page.getByRole('button',{name:'⛶ 全螢幕',exact:true}).click();await inspect(page);
  }
 }
 await expect(page.locator('[data-daily-result]')).toBeVisible();await expect(page.locator('[data-daily-result]')).toContainText('100 萬道具鈔');await expect(page.locator('[data-daily-result]')).toContainText('退回 6 張票券');
 await verifyDailyResult(page,testInfo,{game:'cash',scale,checkpoint:resultCheckpoint,mode:'rejected',prefix,scaleText});
});

for(const viewport of [{width:320,height:568},{width:390,height:844},{width:667,height:375}])test(`CASH dynamic recovery ${viewport.width}: 200% two-action sheet scrolls after completed capture and real context loss`,async({page},testInfo)=>{
 // Includes the completed run, genuine context loss, recovery geometry and export.
 if(viewport.width===667)test.setTimeout(90_000);
 await page.setViewportSize(viewport);await page.addInitScript(()=>Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:false}));
 await page.clock.install({time:new Date('2026-11-09T12:00:00Z')});await page.goto('/play?game=cash&seed=42');await expect(page.locator('[data-game-stage="ready"]')).toBeVisible({timeout:15000});await page.clock.pauseAt(new Date('2026-11-09T12:01:00Z'));
 await page.getByRole('button',{name:'開始這一局',exact:true}).click();await page.getByRole('button',{name:'退出全螢幕',exact:true}).click();
 const owner=page.locator('.fullscreen-game'),board=page.locator('.fw-arcade-board');await owner.scrollIntoViewIfNeeded();await expect(owner).not.toHaveClass(/fullscreen-game--viewport/);
 const deck=cashDeck(42);for(const item of deck.slice(0,29)){await board.press(item.valid?'ArrowRight':'ArrowLeft');await page.clock.runFor(200);}
 await page.evaluate(()=>{const original=HTMLCanvasElement.prototype.toDataURL;HTMLCanvasElement.prototype.toDataURL=function(){HTMLCanvasElement.prototype.toDataURL=original;throw Error('Controlled completed-cash readback failure');};});
 await board.press(deck[29].valid?'ArrowRight':'ArrowLeft');await expect(page.getByRole('alert')).toContainText('成果畫面還沒保存');
 await page.locator('.fw-arcade-stage canvas').evaluate((canvas:HTMLCanvasElement)=>{const gl=canvas.getContext('webgl2')!,extension=gl.getExtension('WEBGL_lose_context');if(!extension)throw Error('WEBGL_lose_context unavailable');extension.loseContext();});
 const retry=page.getByRole('button',{name:'重試產生成果圖片',exact:true}),fallback=page.getByRole('button',{name:'用輕量畫面恢復',exact:true}),sheet=page.locator('[data-daily-overlay]');
 await expect(retry).toBeDisabled();await expect(fallback).toHaveCount(1);
 // Crucially scale only AFTER the dynamic second recovery action exists.
 await scaleText(owner,2);await expect(page.locator('[data-cash-progress]')).toHaveText('30/30');await expect(page.locator('.fw-arcade-counter')).toHaveText('100 / 100 萬');
 await expect(sheet).toHaveCSS('overflow-y','auto');await expect(sheet).toHaveCSS('justify-content','flex-start');
 const initial=await sheet.evaluate(el=>({top:el.scrollTop,height:el.clientHeight,scrollHeight:el.scrollHeight}));expect(initial.top).toBe(0);
 const frame=(await owner.boundingBox())!,bounds=(await sheet.boundingBox())!;expect(bounds.width/frame.width).toBeGreaterThan(.9);expect(bounds.y).toBeGreaterThan(frame.y+54);expect(bounds.y+bounds.height).toBeLessThanOrEqual(frame.y+frame.height-15);
 for(const action of [retry,fallback]){
  expect(await action.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(28);
  await action.scrollIntoViewIfNeeded();await visibleControl(action);
  expect(await action.evaluate(el=>{const r=el.getBoundingClientRect(),s=el.closest('[data-daily-overlay]')!.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(el);return [...range.getClientRects()].every(t=>t.left>=r.left-1&&t.right<=r.right+1&&t.top>=r.top-1&&t.bottom<=r.bottom+1&&t.top>=s.top&&t.bottom<=s.bottom);})).toBe(true);
 }
 for(const name of ['回遊樂場','玩法說明','重新開始這一局'])await visibleControl(page.getByRole('button',{name,exact:true}));
 // Real traversal from the retained board focus, not programmatic focus on
 // fallback. Every actionable stop must hit its visible painted target.
 await expect(owner.locator('.daily-scene-mode')).toHaveAttribute('inert','');
 const back=page.getByRole('button',{name:'回遊樂場',exact:true}),help=page.getByRole('button',{name:'玩法說明',exact:true}),restart=page.getByRole('button',{name:'重新開始這一局',exact:true}),presentation=owner.locator('.fullscreen-game__button').first();
 const step=async(key:string,target:Locator)=>{await page.keyboard.press(key);await expect(target).toBeFocused();await visibleControl(target);};
 await expect(board).toBeFocused();await sheet.evaluate(el=>{el.scrollTop=0;});
 for(const target of [back,help,restart,fallback])await step('Tab',target);
 for(const target of [restart,help,back,board,presentation])await step('Shift+Tab',target);
 for(const target of [board,back,help,restart,fallback])await step('Tab',target);
 // Enter presentation by keyboard, then prove both ends of its actual trap.
 for(const target of [restart,help,back,board,presentation])await step('Shift+Tab',target);
 await page.keyboard.press('Space');await expect(owner).toHaveClass(/fullscreen-game--viewport/);await expect(presentation).toBeFocused();
 await step('Shift+Tab',fallback);await step('Tab',presentation);
 const modeHelp=owner.locator('.fullscreen-game__mode-help summary');
 for(const target of [modeHelp,board,back,help,restart,fallback])await step('Tab',target);
 for(const target of [restart,help,back,board,modeHelp,presentation,fallback])await step('Shift+Tab',target);
 await expect(owner.locator('.daily-scene-mode')).toHaveAttribute('inert','');
 await testInfo.attach(`cash-dynamic-recovery-${viewport.width}-200pct.png`,{body:await owner.screenshot(),contentType:'image/png'});
 await page.keyboard.press('Enter');await expect(page.locator('[data-game-stage="ready"]')).toHaveAttribute('data-daily-renderer','light');await expect(retry).toBeEnabled();await expect(fallback).toHaveCount(0);await expect(owner.locator('.daily-scene-mode')).not.toHaveAttribute('inert','');
 await retry.click();await expect(page.getByRole('region',{name:'遊戲成果'})).toContainText('100 萬道具鈔');await expect(page.getByRole('region',{name:'遊戲成果'})).toContainText('退回 6 張票券');await expect(page.getByRole('region',{name:'遊戲成果'})).toContainText('分錯 0 次');
});
