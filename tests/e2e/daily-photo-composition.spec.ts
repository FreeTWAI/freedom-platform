import {test,expect,type Page,type Locator} from './fixtures.js';
import sharp from 'sharp';
import {RULES} from '../../apps/portal-web/src/games/domain.js';

// These are future real-browser observations, not visual acceptance from DOM
// bounds. Keep the full-stage PNGs for human composition/subject review.
const sizes=[{width:320,height:568},{width:390,height:844},{width:667,height:375}];
async function openPhoto(page:Page,light:boolean){
  await page.addInitScript(()=>Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:false}));
  await page.clock.install({time:new Date('2026-11-08T12:00:00Z')});
  await page.goto('/play?game=photo&seed=42');
  await expect(page.locator('[data-game-stage="ready"]')).toBeVisible({timeout:15000});
  await page.clock.pauseAt(new Date('2026-11-08T12:01:00Z'));
  await page.getByRole('button',{name:'開始這一局',exact:true}).click();
  if(light){
    await page.getByRole('button',{name:'3D · 改用輕量插畫',exact:true}).click();
    await expect(page.locator('[data-game-stage="ready"]')).toHaveAttribute('data-daily-renderer','light');
    await page.getByRole('button',{name:'繼續這一局',exact:true}).click();
  }
  await expect(page.locator('.fullscreen-game')).toHaveClass(/fullscreen-game--viewport/);
  await expect(page.locator('.fw-arcade-board')).toBeFocused();
}
async function scaleText(owner:Locator,factor:number){
  // Text-only enlargement, not CSS zoom or a physical-phone safe-area claim.
  // Snapshot computed sizes first so descendants do not compound the scaling.
  await owner.evaluate((el,factor)=>{
    const elements=[el,...el.querySelectorAll('*')].filter(e=>e instanceof HTMLElement) as HTMLElement[];
    for(const node of elements)if(node.dataset.photoScaled)node.style.fontSize='';
    const text=elements.map(el=>({el,font:parseFloat(getComputedStyle(el).fontSize)}));
    for(const {el,font}of text){el.style.fontSize=`${font*factor}px`;el.dataset.photoScaled='1';}
    for(const [side,value]of Object.entries({top:12,right:8,bottom:16,left:8}))(el as HTMLElement).style.setProperty(`--game-safe-${side}`,`${value}px`);
  },factor);
}
async function visibleWithoutScroll(control:Locator){
  await expect(control).toBeVisible();
  expect(await control.evaluate(el=>{
    const r=el.getBoundingClientRect(),owner=el.closest('.fullscreen-game')!.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return r.width>=44&&r.height>=44&&r.left>=owner.left-1&&r.right<=owner.right+1&&r.top>=owner.top-1&&r.bottom<=owner.bottom+1&&r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1&&!!hit&&(el===hit||el.contains(hit));
  })).toBe(true);
}
async function textBounds(owner:Locator){
  const violations=await owner.evaluate(el=>{
    const bad:string[]=[];
    const selectors='.fw-arcade-toolbar button,.fw-arcade-counter,.daily-photo-film,.daily-photo-goal,.daily-photo-feedback,.daily-photo-failure,.fw-arcade-pan-pad button,.fw-arcade-zoom>span,.fw-arcade-shutter small,.daily-photo-next,.daily-photo-album,.daily-scene-mode button';
    for(const target of el.querySelectorAll<HTMLElement>(selectors)){
      const walker=document.createTreeWalker(target,NodeFilter.SHOW_TEXT);let text:Node|null;
      while((text=walker.nextNode())){
        if(!text.textContent?.trim()||text.parentElement?.closest('.daily-sr'))continue;
        const range=document.createRange();range.selectNodeContents(text);
        for(const rect of range.getClientRects()){
          if(!rect.width||!rect.height)continue;
          const own=target.getBoundingClientRect();
          if(rect.left<own.left-1||rect.right>own.right+1||rect.top<own.top-1||rect.bottom>own.bottom+1)bad.push(`${target.className}: text outside its control`);
          let parent:HTMLElement|null=target;
          while(parent){
            const style=getComputedStyle(parent),clip=/(hidden|clip|scroll|auto)/.test(`${style.overflowX} ${style.overflowY}`),p=parent.getBoundingClientRect();
            if(clip&&(rect.left<p.left-1||rect.right>p.right+1||rect.top<p.top-1||rect.bottom>p.bottom+1))bad.push(`${target.className}: text clipped by ${parent.className}`);
            if(parent===el)break;parent=parent.parentElement;
          }
        }
      }
    }
    return bad;
  });
  expect(violations).toEqual([]);
}
async function readableOverlay(page:Page){
  const paragraphs=page.locator('.daily-photo-overlay-copy p');
  await expect(paragraphs.first()).toBeVisible();
  const metrics=await paragraphs.evaluateAll(nodes=>nodes.map(node=>{
    const rgb=(value:string)=>value.match(/[\d.]+/g)!.map(Number);
    const luminance=(color:number[])=>color.slice(0,3).map(value=>{const c=value/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
    const foreground=rgb(getComputedStyle(node).color),cover=node.closest('.fw-arcade-stage-cover')!,background=rgb(getComputedStyle(cover).backgroundColor),alpha=background[3]??1,ink=luminance(foreground);
    // The cover is translucent over a live world. Bound contrast against both
    // possible backdrop extremes instead of assuming an opaque cream surface.
    const paperBounds=[0,255].map(backdrop=>luminance(background.slice(0,3).map(c=>c*alpha+backdrop*(1-alpha))));
    const contrasts=paperBounds.map(paper=>(Math.max(ink,paper)+.05)/(Math.min(ink,paper)+.05));
    const canMatchInk=ink>=Math.min(...paperBounds)&&ink<=Math.max(...paperBounds);
    return {text:node.textContent,color:getComputedStyle(node).color,background:getComputedStyle(cover).backgroundColor,opaqueInk:(foreground[3]??1)===1&&Number(getComputedStyle(node).opacity)===1,minContrast:canMatchInk?1:Math.min(...contrasts)};
  }));
  for(const metric of metrics){expect(metric.opaqueInk,JSON.stringify(metric)).toBe(true);expect(metric.minContrast,JSON.stringify(metric)).toBeGreaterThanOrEqual(4.5);}
}
async function inspectComposition(page:Page){
  const owner=page.locator('.fullscreen-game'),stage=page.locator('.fw-arcade-stage');
  const geometry=await stage.evaluate(el=>{
    const rect=el.getBoundingClientRect(),owner=el.closest('.fullscreen-game')!.getBoundingClientRect();
    // A meaningful clear central world area, not just a large transparent div.
    const clear=[.45,.5,.55].flatMap(x=>[.4,.55,.7].map(y=>{
      const hit=document.elementFromPoint(rect.left+rect.width*x,rect.top+rect.height*y);
      return !!hit&&el.contains(hit);
    }));
    const canvas=el.querySelector('canvas')!;
    const wrap=el.closest('.fw-arcade-stage-wrap')!,wrapRect=wrap.getBoundingClientRect();
    return {wrap:{width:wrapRect.width,height:wrapRect.height,maxWidth:getComputedStyle(wrap).maxWidth},stage:{width:rect.width,height:rect.height},owner:{width:owner.width,height:owner.height},canvas:{width:canvas.width,height:canvas.height,cssWidth:canvas.getBoundingClientRect().width,cssHeight:canvas.getBoundingClientRect().height},client:{width:el.clientWidth,height:el.clientHeight},dpr:window.devicePixelRatio||1,renderer:el.getAttribute('data-daily-renderer'),clear};
  });
  expect(geometry.wrap.maxWidth).toBe('none');
  expect(geometry.wrap.width/geometry.owner.width).toBeGreaterThan(.99);
  expect(geometry.stage.width/geometry.owner.width).toBeGreaterThan(.99);
  expect(geometry.stage.height/geometry.owner.height).toBeGreaterThan(.99);
  expect(geometry.stage.width).toBeGreaterThan(250);expect(geometry.stage.height).toBeGreaterThan(240);
  expect(geometry.canvas.cssWidth/geometry.stage.width).toBeGreaterThan(.99);expect(geometry.canvas.cssHeight/geometry.stage.height).toBeGreaterThan(.99);
  // Backing pixels obey the unchanged renderer budgets; a tall native canvas
  // is intentionally only 222px wide at 390x844/DPR1 while its CSS world is 390px.
  const {width,height}=geometry.client;
  if(geometry.renderer==='native'){
    const scale=Math.min(1,640/width,480/height),dpr=Math.min(geometry.dpr,RULES.maxDpr);
    expect([geometry.canvas.width,geometry.canvas.height]).toEqual([Math.floor(Math.max(1,Math.round(width*scale))*dpr),Math.floor(Math.max(1,Math.round(height*scale))*dpr)]);
  }else{
    expect(geometry.renderer).toBe('light');const scale=Math.min(geometry.dpr,1.5,960/width,720/height);
    expect([geometry.canvas.width,geometry.canvas.height]).toEqual([Math.max(1,Math.round(width*scale)),Math.max(1,Math.round(height*scale))]);
  }
  expect(geometry.canvas.width).toBeLessThanOrEqual(960);expect(geometry.canvas.height).toBeLessThanOrEqual(720);expect(geometry.clear.every(Boolean)).toBe(true);
  for(const name of ['回遊樂場','玩法說明','重新開始這一局','暫停','鏡頭往左','鏡頭往上','鏡頭往下','鏡頭往右','拍照快門','下一位客人 →','檢視本局照片與評語'])await visibleWithoutScroll(page.getByRole('button',{name,exact:true}));
  const toolbar=await owner.locator('.fw-arcade-toolbar>button').evaluateAll(buttons=>buttons.slice(0,3).map(button=>{const r=button.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,position:getComputedStyle(button).position};}));
  expect(toolbar).toHaveLength(3);
  // At narrow widths the shared Daily stylesheet moves Restart to a dock.
  // PHOTO must override that actual cascade and keep Back/Help/Restart in one
  // non-overlapping row, with no scroll or force-click hiding a misplaced button.
  expect(toolbar[2].position).toBe('static');
  for(let i=1;i<toolbar.length;i++){expect(toolbar[i].top).toBeCloseTo(toolbar[0].top,1);expect(toolbar[i].left-toolbar[i-1].right).toBeGreaterThanOrEqual(5);}
  await visibleWithoutScroll(page.getByRole('slider',{name:'鏡頭廣角',exact:true}));
  await visibleWithoutScroll(owner.locator('.daily-scene-mode button'));
  await textBounds(owner);
  const overlappingHud=await owner.evaluate(el=>{
    const bounds=el.getBoundingClientRect(),hud=[...el.querySelectorAll('.fw-arcade-counter,.daily-photo-film,.daily-photo-goal,.daily-photo-feedback')];
    const controls=[...el.querySelectorAll('button,input')].filter(node=>!node.closest('.daily-sr')&&node.getBoundingClientRect().width>0);
    return hud.flatMap((node,index)=>{const r=node.getBoundingClientRect(),bad:string[]=[];
      if(r.left<bounds.left||r.top<bounds.top||r.right>bounds.right||r.bottom>bounds.bottom)bad.push(`${node.className}: outside owner`);
      for(const other of [...hud.slice(index+1),...controls]){const o=other.getBoundingClientRect();if(Math.min(r.right,o.right)-Math.max(r.left,o.left)>1&&Math.min(r.bottom,o.bottom)-Math.max(r.top,o.top)>1)bad.push(`${node.className}: overlaps ${other.className}`);}
      return bad;
    });
  });
  expect(overlappingHud).toEqual([]);
  expect(await page.locator('.fw-arcade-controls').evaluate(el=>{const s=getComputedStyle(el);return s.backgroundColor==='rgba(0, 0, 0, 0)'&&s.borderTopWidth==='0px'&&el.scrollHeight<=el.clientHeight+1;})).toBe(true);
  return geometry;
}
for(const light of [false,true])for(const viewport of sizes)for(const scale of [1,2]){
  test(`PHOTO world ${light?'light':'native'} ${viewport.width} ${scale*100}%: full canvas, unclipped HUD, real actions and modal return`,async({page},testInfo)=>{
    await page.setViewportSize(viewport);await openPhoto(page,light);
    const owner=page.locator('.fullscreen-game'),board=page.locator('.fw-arcade-board'),shutter=page.getByRole('button',{name:'拍照快門',exact:true});
    await scaleText(owner,scale);
    await shutter.click();await page.clock.runFor(200);
    await expect(page.locator('[data-photo-film]')).toHaveText('1 張');
    await expect(page.locator('[data-photo-goal]')).toHaveText('臉和雙腳');await expect(page.locator('[data-photo-goal]')).toBeVisible();
    await expect(page.locator('[data-photo-feedback]')).toHaveText(/^已存[0-3]★$/);await expect(page.locator('[data-photo-feedback]')).toBeVisible();
    await expect(page.locator('.fw-arcade-contact-sheet img')).toHaveCount(1);
    const geometry=await inspectComposition(page),prefix=`photo-world-${light?'light':'native'}-${viewport.width}x${viewport.height}-${scale*100}pct`;
    const png=await owner.screenshot({animations:'disabled'});await testInfo.attach(`${prefix}-viewport.png`,{body:png,contentType:'image/png'});
    const stats=await sharp(png).stats();expect(stats.channels.some(c=>c.stdev>20)).toBe(true);
    await testInfo.attach(`${prefix}-geometry.json`,{body:JSON.stringify(geometry),contentType:'application/json'});
    await page.getByRole('button',{name:'退出全螢幕',exact:true}).click();await expect(owner).not.toHaveClass(/fullscreen-game--viewport/);
    // Reveal the owner once after exit, never an individual action. Both
    // presentation PNGs retain the identical first shot at the frozen 200ms.
    await owner.scrollIntoViewIfNeeded();await inspectComposition(page);
    await testInfo.attach(`${prefix}-normal.png`,{body:await owner.screenshot({animations:'disabled'}),contentType:'image/png'});
    await page.getByRole('button',{name:'⛶ 全螢幕',exact:true}).click();await expect(owner).toHaveClass(/fullscreen-game--viewport/);
    // All snapshots above show the same real first shot at 200ms. Now verify
    // pointer/keyboard actions without scrolling controls into view for them.
    const before=await page.evaluate(()=>({x:scrollX,y:scrollY,owners:[...document.querySelectorAll('.fullscreen-game,[data-daily-stage],.fw-arcade-controls')].map(e=>[e.scrollLeft,e.scrollTop])}));
    for(const name of ['鏡頭往左','鏡頭往上','鏡頭往下','鏡頭往右'])await page.getByRole('button',{name,exact:true}).click();
    await page.getByRole('slider',{name:'鏡頭廣角',exact:true}).press('End');
    await shutter.press('Enter');await expect(page.locator('[data-photo-film]')).toHaveText('0 張');await expect(shutter).toBeDisabled();
    expect(await page.evaluate(()=>({x:scrollX,y:scrollY,owners:[...document.querySelectorAll('.fullscreen-game,[data-daily-stage],.fw-arcade-controls')].map(e=>[e.scrollLeft,e.scrollTop])}))).toEqual(before);
    const album=page.getByRole('button',{name:'檢視本局照片與評語',exact:true});await album.click();await scaleText(owner,scale);
    const photos=page.getByRole('dialog',{name:'本局照片與評語',exact:true});await expect(photos.locator('img')).toHaveCount(2);await page.keyboard.press('Escape');await expect(album).toBeFocused();
    const resume=page.getByRole('button',{name:'繼續這一局',exact:true});await visibleWithoutScroll(resume);await readableOverlay(page);
    await testInfo.attach(`${prefix}-paused.png`,{body:await owner.screenshot({animations:'disabled'}),contentType:'image/png'});
    await resume.click();await expect(board).toBeFocused();
    const help=page.getByRole('button',{name:'玩法說明',exact:true});await help.click();await scaleText(owner,scale);const dialog=page.getByRole('dialog',{name:'玩法說明',exact:true});
    await expect(dialog).toContainText('三位客人各有 12 秒、兩張底片');
    await testInfo.attach(`${prefix}-help.png`,{body:await page.screenshot({animations:'disabled'}),contentType:'image/png'});
    for(const key of ['Tab','Shift+Tab','Tab']){await page.keyboard.press(key);expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);}
    await page.keyboard.press('Escape');await expect(help).toBeFocused();await resume.click();
    const restart=page.getByRole('button',{name:'重新開始這一局',exact:true});await restart.click();await page.keyboard.press('Escape');await expect(restart).toBeFocused();await resume.click();
    await page.getByRole('button',{name:'下一位客人 →',exact:true}).click();await expect(page.locator('[data-photo-client]')).toHaveText('2/3');await expect(page.locator('[data-photo-film]')).toHaveText('2 張');
    await expect(page.locator('[data-photo-goal]')).toHaveText('全身全傘');await expect(page.locator('[data-photo-goal]')).toBeVisible();await expect(page.locator('[data-photo-feedback]')).toHaveText('等時機');await expect(board).toHaveAttribute('data-playing','true');await textBounds(owner);
    // Use real discoverable controls at the same wide-zoom target tested by
    // the independent framing probe; keep the actual saved result observable.
    await page.getByRole('slider',{name:'鏡頭廣角',exact:true}).press('End');
    for(let press=0;press<2;press++){await page.getByRole('button',{name:'鏡頭往右',exact:true}).click();await page.getByRole('button',{name:'鏡頭往上',exact:true}).click();}
    await page.clock.runFor(300);await shutter.click();await expect(page.locator('[data-photo-feedback]')).toHaveText('已存3★');
    await testInfo.attach(`${prefix}-umbrella-reachable.png`,{body:await owner.screenshot({animations:'disabled'}),contentType:'image/png'});
    // A real timed transition must reveal the third goal without pausing or
    // asking the player to open Help while those twelve seconds run out.
    await page.clock.fastForward(12016);await expect(page.locator('[data-photo-client]')).toHaveText('3/3');await expect(page.locator('[data-photo-goal]')).toHaveText('三鴿同框');await expect(page.locator('[data-photo-goal]')).toBeVisible();await expect(board).toHaveAttribute('data-playing','true');await expect(page.locator('[data-daily-overlay]')).toHaveCount(0);await textBounds(owner);
    await testInfo.attach(`${prefix}-third-client-goal.png`,{body:await owner.screenshot({animations:'disabled'}),contentType:'image/png'});

  });
}
for(const viewport of sizes)test(`PHOTO recovery ${viewport.width}: explicit light fallback and failed capture preserve visible film`,async({page},testInfo)=>{
  await page.setViewportSize(viewport);await page.addInitScript(()=>{
    Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:false});
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,type:string,...args:unknown[]){return ['webgl','webgl2','experimental-webgl'].includes(type)?null:original.apply(this,[type,...args] as Parameters<typeof original>);} as typeof original;
  });
  await page.clock.install({time:new Date('2026-11-08T12:00:00Z')});await page.goto('/play?game=photo&seed=42');
  await expect(page.getByRole('alert')).toContainText('此瀏覽器暫時無法開啟 3D 場景');await readableOverlay(page);
  await testInfo.attach(`photo-recovery-${viewport.width}-native-unavailable.png`,{body:await page.locator('.fullscreen-game').screenshot(),contentType:'image/png'});
  await scaleText(page.locator('.fullscreen-game'),2);
  await visibleWithoutScroll(page.getByRole('button',{name:'用輕量畫面繼續',exact:true}));
  await testInfo.attach(`photo-recovery-${viewport.width}-200pct-native-unavailable.png`,{body:await page.locator('.fullscreen-game').screenshot(),contentType:'image/png'});
  await page.getByRole('button',{name:'用輕量畫面繼續',exact:true}).click();await expect(page.locator('[data-game-stage="ready"]')).toHaveAttribute('data-daily-renderer','light');
  await page.clock.pauseAt(new Date('2026-11-08T12:01:00Z'));await page.getByRole('button',{name:'開始這一局',exact:true}).click();
  await scaleText(page.locator('.fullscreen-game'),2);
  await page.evaluate(()=>{const original=HTMLCanvasElement.prototype.toDataURL;HTMLCanvasElement.prototype.toDataURL=function(){HTMLCanvasElement.prototype.toDataURL=original;throw Error('Controlled capture failure');};});
  const shutter=page.getByRole('button',{name:'拍照快門',exact:true});await shutter.click();await expect(page.locator('[data-photo-film]')).toHaveText('2 張');await expect(page.locator('.daily-photo-failure')).toHaveText('未存，按快門');await expect(page.locator('.daily-photo-failure')).toHaveAccessibleName('照片未保存，請再按快門。完整錯誤可在玩法說明檢視。');await expect(page.locator('[data-photo-feedback]')).toHaveCount(0);
  // The alert mounts after the first enlargement. Scale it too, then prove
  // this recovery checkpoint really exercises doubled alert text.
  const normalFailureFont=await page.locator('.daily-photo-failure').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
  await scaleText(page.locator('.fullscreen-game'),2);
  expect(await page.locator('.daily-photo-failure').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(normalFailureFont*2,5);
  for(const field of ['data-photo-film','data-photo-time','data-photo-client','data-photo-goal'])await expect(page.locator(`[${field}]`)).toBeVisible();
  await textBounds(page.locator('.fullscreen-game'));
  const coveredAlert=await page.locator('.daily-photo-failure').evaluate(alert=>{
    const r=alert.getBoundingClientRect(),owner=alert.closest('.fullscreen-game')!,bounds=owner.getBoundingClientRect();
    const other=[...owner.querySelectorAll('.fw-arcade-counter,.daily-photo-film,.daily-photo-goal,.daily-photo-feedback,button,input,.fw-arcade-zoom>span')].filter(node=>!node.closest('.daily-sr'));
    return r.left<bounds.left||r.right>bounds.right||r.top<bounds.top||r.bottom>bounds.bottom||other.some(node=>{const p=node.getBoundingClientRect();return p.width>0&&p.height>0&&Math.min(r.right,p.right)-Math.max(r.left,p.left)>1&&Math.min(r.bottom,p.bottom)-Math.max(r.top,p.top)>1;});
  });
  expect(coveredAlert).toBe(false);
  await visibleWithoutScroll(shutter);await testInfo.attach(`photo-recovery-${viewport.width}-200pct-capture-failed.png`,{body:await page.locator('.fullscreen-game').screenshot(),contentType:'image/png'});
  await shutter.click();await expect(page.locator('[data-photo-film]')).toHaveText('1 張');await expect(page.locator('.daily-photo-failure')).toHaveCount(0);await expect(page.locator('.fw-arcade-contact-sheet img')).toHaveCount(1);
});
