import {test,expect,type Page,type Locator} from './fixtures.js';
import {captureDailyStage,verifyDailyResult} from './helpers/daily-result-stage.js';
import {PerspectiveCamera,Vector3} from 'three';
import sharp from 'sharp';
import {readFileSync} from 'node:fs';
import {stampTarget,RULES} from '../../apps/portal-web/src/games/domain.js';

// Future full-page browser observations. Collection/source math is not a run,
// pixel review, physical touch or human playability acceptance.
const sizes=[{width:320,height:568},{width:390,height:844},{width:667,height:375}];
async function openStamp(page:Page,light:boolean,rejected=false){
    await page.addInitScript(rejected=>{Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:rejected});if(rejected)Element.prototype.requestFullscreen=async()=>{throw new DOMException('Controlled fullscreen rejection','NotAllowedError');};},rejected);
    await page.clock.install({time:new Date('2026-11-09T12:00:00Z')});await page.goto('/play?game=stamp&seed=42');
    await expect(page.locator('[data-game-stage="ready"]')).toBeVisible({timeout:15000});await page.clock.pauseAt(new Date('2026-11-09T12:01:00Z'));
    await overlayContrast(page);await page.getByRole('button',{name:'先蓋一張練習紙',exact:true}).click();
    if(light){await page.getByRole('button',{name:'3D · 改用輕量插畫',exact:true}).click();await expect(page.locator('[data-game-stage="ready"]')).toHaveAttribute('data-daily-renderer','light');await page.getByRole('button',{name:'繼續這一局',exact:true}).click();}
    await expect(page.locator('.fullscreen-game')).toHaveClass(/fullscreen-game--viewport/);await expect(page.locator('.fw-arcade-board')).toBeFocused();
}
async function scaleText(owner:Locator,scale:number){
    await owner.evaluate((el,scale)=>{
        const nodes=[el,...el.querySelectorAll('*')].filter(node=>node instanceof HTMLElement) as HTMLElement[];
        for(const node of nodes)if(node.dataset.stampScaled)node.style.fontSize='';
        const fonts=nodes.map(el=>({el,font:parseFloat(getComputedStyle(el).fontSize)}));
        for(const {el,font}of fonts){el.style.fontSize=`${font*scale}px`;el.dataset.stampScaled='1';}
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
    const paragraphs=page.locator('.daily-stamp-overlay-copy p');expect(await paragraphs.count()).toBeGreaterThan(0);
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
async function projection(page:Page){
    const box=(await page.locator('.fw-arcade-stage').boundingBox())!,aspect=box.width/box.height;
    // Independent camera construction, not importing the product picking helper.
    const fov=aspect<1?2*Math.atan(Math.tan(Math.PI/9)*Math.max(1.7,.90/aspect))*180/Math.PI:40;
    const camera=new PerspectiveCamera(fov,aspect,.1,60);camera.position.set(0,5.3,2.7);camera.lookAt(0,0,.23);camera.updateMatrixWorld(true);
    return {box,camera,pixel:(x:number,z:number)=>{const p=new Vector3(x,.086,z).project(camera);return {x:box.x+(p.x+1)*box.width/2,y:box.y+(1-p.y)*box.height/2};}};
}
async function target(page:Page,index:number){const {pixel}=await projection(page),t=stampTarget(42,index);return pixel(t.x*1.2,t.y*1.5);}
async function contact(page:Page,index:number){const p=await target(page,index);expect(await page.locator('.fw-arcade-stage').evaluate((el,p)=>{const hit=document.elementFromPoint(p.x,p.y);return !!hit&&el.contains(hit);},p)).toBe(true);await page.mouse.click(p.x,p.y);}
async function inspect(page:Page){
    const owner=page.locator('.fullscreen-game'),host=page.locator('.fw-arcade-stage'),{box,pixel,camera}=await projection(page);
    const frame=await owner.boundingBox();expect(frame).not.toBeNull();expect(box.width/frame!.width).toBeGreaterThan(.99);expect(box.height/frame!.height).toBeGreaterThan(.99);
    const viewport=page.viewportSize()!,fullscreen=await owner.evaluate(el=>el.matches(':fullscreen,.fullscreen-game--viewport'));
    // Normal mode retains the product's outer gutters: a 320px viewport has
    // a 296px owner. Renderer/owner ratios above remain strict in both modes.
    const normalWidths:Record<number,number>={320:296,390:358,667:635};
    expect(Math.abs(box.width-(fullscreen?viewport.width:normalWidths[viewport.width]))).toBeLessThan(1);
    expect(box.height).toBeGreaterThanOrEqual(289);
    await expect(page.locator('.daily-stamp .fw-arcade-stage-wrap')).toHaveCSS('max-width','none');
    const canvas=await host.locator('canvas').evaluate((el:HTMLCanvasElement)=>({width:el.width,height:el.height,css:{width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}}));
    expect(canvas.css.width/box.width).toBeGreaterThan(.99);expect(canvas.css.height/box.height).toBeGreaterThan(.99);expect(canvas.width).toBeLessThanOrEqual(960);expect(canvas.height).toBeLessThanOrEqual(720);
    const paper=[[-1.5,-1.85],[1.5,-1.85],[1.5,1.85],[-1.5,1.85]].map(([x,z])=>pixel(x,z));
    // The whole real sheet plus every exact 12-document target must be visible
    // and exposed through the HUD, not merely lie inside a transparent owner.
    for(const p of [...paper,...await Promise.all(Array.from({length:12},(_,i)=>target(page,i)))]){
        expect(p.x).toBeGreaterThan(frame!.x+7);expect(p.x).toBeLessThan(frame!.x+frame!.width-7);expect(p.y).toBeGreaterThan(frame!.y+7);expect(p.y).toBeLessThan(frame!.y+frame!.height-7);
        expect(await host.evaluate((el,p)=>{const hit=document.elementFromPoint(p.x,p.y);return !!hit&&el.contains(hit);},p)).toBe(true);
    }
    for(const name of ['回遊樂場','玩法說明','重新開始這一局','暫停','啪！蓋章'])await visibleControl(page.getByRole('button',{name,exact:true}));await visibleControl(owner.locator('.daily-scene-mode button'));
    const violations=await owner.evaluate(el=>{
        const bad:string[]=[],fields=[...el.querySelectorAll<HTMLElement>('.fw-arcade-toolbar button,.fw-arcade-counter,.daily-stamp-goal,.daily-stamp-facts,.fw-arcade-stamp-button,.daily-scene-mode button')],o=el.getBoundingClientRect();
        for(const [i,node]of fields.entries()){
            const r=node.getBoundingClientRect();if(r.left<o.left||r.right>o.right||r.top<o.top||r.bottom>o.bottom)bad.push(`outside owner: ${node.className}`);
            for(const other of fields.slice(i+1)){const q=other.getBoundingClientRect();if(Math.min(r.right,q.right)-Math.max(r.left,q.left)>1&&Math.min(r.bottom,q.bottom)-Math.max(r.top,q.top)>1)bad.push(`overlap: ${node.className}/${other.className}`);}
            const walk=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);let text:Node|null;
            while((text=walk.nextNode())){if(!text.textContent?.trim()||text.parentElement?.closest('.daily-sr'))continue;const range=document.createRange();range.selectNodeContents(text);for(const t of range.getClientRects()){
                if(t.left<r.left-1||t.right>r.right+1||t.top<r.top-1||t.bottom>r.bottom+1)bad.push(`text outside control: ${node.className}`);
                for(let p:HTMLElement|null=node;p;p=p.parentElement){const style=getComputedStyle(p),b=p.getBoundingClientRect();if(/(hidden|clip|auto|scroll)/.test(`${style.overflowX} ${style.overflowY}`)&&(t.left<b.left-1||t.right>b.right+1||t.top<b.top-1||t.bottom>b.bottom+1))bad.push(`text clipped: ${p.className}`);if(p===el)break;}
            }}
        }
        return bad;
    });expect(violations).toEqual([]);
    expect(await owner.locator('.fw-arcade-controls').evaluate(el=>{const s=getComputedStyle(el);return s.backgroundColor==='rgba(0, 0, 0, 0)'&&s.borderTopWidth==='0px'&&el.scrollHeight<=el.clientHeight+1;})).toBe(true);
    const coveredPaper=await owner.evaluate((el,paper)=>{
        const sheet={left:Math.min(...paper.map(p=>p.x)),right:Math.max(...paper.map(p=>p.x)),top:Math.min(...paper.map(p=>p.y)),bottom:Math.max(...paper.map(p=>p.y))};
        return [...el.querySelectorAll('.fw-arcade-toolbar button,.fw-arcade-counter,.daily-stamp-goal,.daily-stamp-facts,.fw-arcade-stamp-button,.daily-scene-mode button,.fullscreen-game__button,.fullscreen-game__mode-help summary')].filter(node=>{const r=node.getBoundingClientRect();return Math.min(r.right,sheet.right)-Math.max(r.left,sheet.left)>1&&Math.min(r.bottom,sheet.bottom)-Math.max(r.top,sheet.top)>1;}).map(node=>node.className);
    },paper);expect(coveredPaper).toEqual([]);
    return {box,paper,effectiveFov:camera.fov,canvas};
}
for(const light of [false,true])for(const viewport of sizes)for(const scale of [1,2])test(`STAMP world ${light?'light':'native'} ${viewport.width} ${scale*100}%: paper contacts, floating controls, safe text and interruption`,async({page},testInfo)=>{
    await page.setViewportSize(viewport);await openStamp(page,light,true);const owner=page.locator('.fullscreen-game'),board=page.locator('.fw-arcade-board');await scaleText(owner,scale);
    await expect(page.locator('[data-stamp-time]')).toHaveText('不計時');await contact(page,0);await expect(page.locator('.fw-arcade-counter')).toHaveText('0/12');await page.clock.runFor(220);await contact(page,0);await page.clock.runFor(220);
    await expect(page.locator('.fw-arcade-counter')).toHaveText('1/12');await expect(page.locator('[data-stamp-misses]')).toHaveText('歪0');
    const prefix=`stamp-world-${light?'light':'native'}-${viewport.width}x${viewport.height}-${scale*100}pct`,geometry=await inspect(page);
    await testInfo.attach(`${prefix}-geometry.json`,{body:JSON.stringify(geometry),contentType:'application/json'});const png=await owner.screenshot({animations:'disabled'});await testInfo.attach(`${prefix}-viewport.png`,{body:png,contentType:'image/png'});expect((await sharp(png).stats()).channels.some(c=>c.stdev>20)).toBe(true);
    await page.getByRole('button',{name:'退出全螢幕',exact:true}).click();await expect(owner).not.toHaveClass(/fullscreen-game--viewport/);await owner.scrollIntoViewIfNeeded();await inspect(page);await testInfo.attach(`${prefix}-normal.png`,{body:await owner.screenshot(),contentType:'image/png'});
    await page.getByRole('button',{name:'⛶ 全螢幕',exact:true}).click();await expect(owner).toHaveClass(/fullscreen-game--viewport/);
    const before=await page.evaluate(()=>({x:scrollX,y:scrollY,owners:[...document.querySelectorAll('.fullscreen-game,[data-daily-stage],.fw-arcade-controls')].map(e=>[e.scrollLeft,e.scrollTop])}));
    const playingHost=await page.locator('.fw-arcade-stage').boundingBox();
    const help=page.getByRole('button',{name:'玩法說明',exact:true});await help.click();const dialog=page.getByRole('dialog',{name:'玩法說明',exact:true});await scaleText(owner,scale);await expect(dialog).toBeVisible();for(const key of ['Tab','Shift+Tab','Tab']){await page.keyboard.press(key);expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);}await page.keyboard.press('Escape');await expect(help).toBeFocused();
    const resume=page.getByRole('button',{name:'繼續這一局',exact:true});await visibleControl(resume);await overlayContrast(page);expect(await page.locator('.fw-arcade-stage').boundingBox()).toEqual(playingHost);await testInfo.attach(`${prefix}-paused.png`,{body:await owner.screenshot(),contentType:'image/png'});const time=await page.locator('[data-stamp-time]').textContent();await page.clock.runFor(5000);await expect(page.locator('[data-stamp-time]')).toHaveText(time!);await resume.click();await expect(board).toBeFocused();
    const restart=page.getByRole('button',{name:'重新開始這一局',exact:true});await restart.click();await page.keyboard.press('Escape');await expect(restart).toBeFocused();await page.getByRole('button',{name:'繼續這一局',exact:true}).click();
    // Ordinary pointer target after both interruptions, then actual keyboard
    // movement + button release must produce only one additional document.
    await contact(page,1);await expect(board).toBeFocused();await expect(page.locator('.fw-arcade-counter')).toHaveText('2/12');await page.clock.runFor(220);
    const previous=stampTarget(42,1),next=stampTarget(42,2);
    for(const [key,n]of [[next.x>previous.x?'ArrowRight':'ArrowLeft',Math.round(Math.abs(next.x-previous.x)/.06)],[next.y>previous.y?'ArrowDown':'ArrowUp',Math.round(Math.abs(next.y-previous.y)/.06)]] as const)for(let i=0;i<n;i++)await page.keyboard.press(key);
    for(const name of ['回遊樂場','玩法說明','重新開始這一局','暫停','啪！蓋章']){await page.keyboard.press('Tab');await expect(page.getByRole('button',{name,exact:true})).toBeFocused();}
    await page.keyboard.press('Enter');await expect(page.locator('.fw-arcade-counter')).toHaveText('3/12');await expect(page.locator('[data-stamp-misses]')).toHaveText('歪0');
    expect(await page.evaluate(()=>({x:scrollX,y:scrollY,owners:[...document.querySelectorAll('.fullscreen-game,[data-daily-stage],.fw-arcade-controls')].map(e=>[e.scrollLeft,e.scrollTop])}))).toEqual(before);
    const resultCheckpoint=await captureDailyStage(page);
    // Every remaining document is consumed at the actual projected target.
    for(let index=3;index<12;index++){await page.clock.runFor(RULES.stampCooldown);await contact(page,index);if(index<11)await expect(page.locator('.fw-arcade-counter')).toHaveText(`${index+1}/12`);}
    const result=page.getByRole('region',{name:'遊戲成果'});await expect(result).toBeVisible();await expect(result).toContainText('完成 12 份文件');await expect(result).toContainText('多蓋 0 次');await testInfo.attach(`${prefix}-earned-result.png`,{body:await owner.screenshot(),contentType:'image/png'});
    await verifyDailyResult(page,testInfo,{game:'stamp',scale,checkpoint:resultCheckpoint,mode:'rejected',prefix,scaleText});
});

for(const viewport of sizes)test(`STAMP native recovery ${viewport.width}: real context loss preserves paper then explicit light play earns a downloadable result`,async({page},testInfo)=>{
    await page.setViewportSize(viewport);await openStamp(page,false);const owner=page.locator('.fullscreen-game');await contact(page,0);await page.clock.runFor(220);await contact(page,0);await page.clock.runFor(220);
    await page.locator('.fw-arcade-stage canvas').evaluate((canvas:HTMLCanvasElement)=>{const gl=canvas.getContext('webgl2')!,extension=gl.getExtension('WEBGL_lose_context');if(!extension)throw Error('WEBGL_lose_context unavailable');extension.loseContext();});
    await expect(page.getByRole('alert')).toContainText('3D 畫面暫時中斷');await overlayContrast(page);await scaleText(owner,2);await visibleControl(page.getByRole('button',{name:'重試場景',exact:true}));await visibleControl(page.getByRole('button',{name:'用輕量畫面繼續',exact:true}));await testInfo.attach(`stamp-recovery-${viewport.width}-200pct-context-loss.png`,{body:await owner.screenshot(),contentType:'image/png'});
    await page.getByRole('button',{name:'用輕量畫面繼續',exact:true}).click();await expect(page.locator('[data-game-stage="ready"]')).toHaveAttribute('data-daily-renderer','light');await expect(page.locator('.fw-arcade-counter')).toHaveText('1/12');await page.getByRole('button',{name:'繼續這一局',exact:true}).click();await scaleText(owner,2);await inspect(page);
    for(let index=1;index<11;index++){await contact(page,index);await expect(page.locator('.fw-arcade-counter')).toHaveText(`${index+1}/12`);await expect(page.locator('[data-stamp-misses]')).toHaveText('歪0');await page.clock.runFor(220);}
    await page.evaluate(()=>{const original=HTMLCanvasElement.prototype.toDataURL;HTMLCanvasElement.prototype.toDataURL=function(){HTMLCanvasElement.prototype.toDataURL=original;throw Error('Controlled completed-stamp readback failure');};});
    await contact(page,11);await expect(page.getByRole('alert')).toContainText('成果畫面還沒保存');await overlayContrast(page);await scaleText(owner,2);await visibleControl(page.getByRole('button',{name:'重試產生成果圖片',exact:true}));await expect(page.locator('.fw-arcade-counter')).toHaveText('12/12');await testInfo.attach(`stamp-recovery-${viewport.width}-200pct-completed-capture.png`,{body:await owner.screenshot(),contentType:'image/png'});
    await page.getByRole('button',{name:'重試產生成果圖片',exact:true}).click();await expect(page.getByRole('region',{name:'遊戲成果'})).toContainText('多蓋 0 次');
    const event=page.waitForEvent('download');await page.getByRole('link',{name:'下載完整成果 PNG',exact:true}).click();const bytes=readFileSync((await(await event).path())!),meta=await sharp(bytes).metadata();expect([meta.format,meta.width,meta.height]).toEqual(['png',960,1200]);expect((await sharp(bytes).stats()).channels.some(c=>c.stdev>10)).toBe(true);
    await page.getByRole('button',{name:'更多分享方式',exact:true}).click();await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeEnabled();await page.getByRole('button',{name:'關閉分享',exact:true}).click();await testInfo.attach(`stamp-recovery-${viewport.width}-earned-result.png`,{body:await owner.screenshot(),contentType:'image/png'});
});


test('STAMP unavailable WebGL is explicit and its 200% fallback starts real untimed practice',async({page},testInfo)=>{
    await page.setViewportSize(sizes[0]);await page.addInitScript(()=>{
        Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:false});const original=HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,type:string,...args:unknown[]){return ['webgl','webgl2','experimental-webgl'].includes(type)?null:original.apply(this,[type,...args] as Parameters<typeof original>);} as typeof original;
    });
    await page.clock.install({time:new Date('2026-11-09T12:00:00Z')});await page.goto('/play?game=stamp&seed=42');await expect(page.getByRole('alert')).toContainText('此瀏覽器暫時無法開啟 3D 場景');await overlayContrast(page);
    const owner=page.locator('.fullscreen-game');await owner.scrollIntoViewIfNeeded();await scaleText(owner,2);await expect(page.locator('.fw-arcade-stage canvas')).toHaveCount(0);
    const fallback=page.getByRole('button',{name:'用輕量畫面繼續',exact:true});await visibleControl(fallback);await testInfo.attach('stamp-unavailable-320-200pct.png',{body:await owner.screenshot(),contentType:'image/png'});
    await fallback.click();await expect(page.locator('[data-game-stage="ready"]')).toHaveAttribute('data-daily-renderer','light');await page.clock.pauseAt(new Date('2026-11-09T12:01:00Z'));await page.getByRole('button',{name:'先蓋一張練習紙',exact:true}).click();await scaleText(owner,2);await inspect(page);
    await contact(page,0);await expect(page.locator('.fw-arcade-counter')).toHaveText('0/12');await expect(page.locator('[data-stamp-misses]')).toHaveText('歪0');
});
