import {test,expect,type Page} from './fixtures.js';
import {PerspectiveCamera,Vector3} from 'three';
import {cashDeck,stampTarget,RULES} from '../../apps/portal-web/src/games/domain.js';
import sharp from 'sharp';
import {captureDailyStage,verifyDailyResult,scaleDailyResultText} from './helpers/daily-result-stage.js';
import {readFileSync} from 'node:fs';

// Authored/collected only. --list does not run a browser, validate pixels, or
// establish human playability. Every result below is earned through real input.
type Game='stamp'|'cash'|'photo';
type Presentation='normal'|'native'|'rejected';
const sizes=[{width:320,height:568},{width:390,height:844},{width:667,height:375}];
async function open(page:Page,game:Game,light:boolean,presentation:Presentation){
    if(presentation!=='native')await page.addInitScript(()=>{
        Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:true});
        Element.prototype.requestFullscreen=async()=>{throw new DOMException('Controlled rejection','NotAllowedError');};
    });
    await page.clock.install({time:new Date('2026-11-09T12:00:00Z')});
    await page.goto(`/play?game=${game}&seed=42`);
    await expect(page.locator('[data-game-stage="ready"]')).toBeVisible({timeout:15000});
    await page.clock.pauseAt(new Date('2026-11-09T12:01:00Z'));
    await page.getByRole('button',{name:game==='stamp'?'先蓋一張練習紙':'開始這一局',exact:true}).click();
    if(light){
        await page.getByRole('button',{name:'3D · 改用輕量插畫',exact:true}).click();
        await expect(page.locator('[data-game-stage="ready"]')).toHaveAttribute('data-daily-renderer','light');
        await page.getByRole('button',{name:'繼續這一局',exact:true}).click();
    }
    const owner=page.locator('.fullscreen-game');
    if(presentation==='normal'){
        await page.getByRole('button',{name:'退出全螢幕',exact:true}).click();
        await owner.scrollIntoViewIfNeeded();
    }
    await presentationIs(page,presentation);
}
async function presentationIs(page:Page,mode:Presentation){
    if(mode==='native')await expect.poll(()=>page.evaluate(()=>document.fullscreenElement?.classList.contains('fullscreen-game'))).toBe(true);
    else{
        expect(await page.evaluate(()=>document.fullscreenElement)).toBeNull();
        if(mode==='rejected')await expect(page.locator('.fullscreen-game')).toHaveClass(/fullscreen-game--viewport/);
        else await expect(page.locator('.fullscreen-game')).not.toHaveClass(/fullscreen-game--viewport/);
    }
}
async function stampContact(page:Page,index:number){
    const box=(await page.locator('.fw-arcade-stage').boundingBox())!,aspect=box.width/box.height;
    const camera=new PerspectiveCamera(aspect<1?2*Math.atan(Math.tan(Math.PI/9)*Math.max(1.7,.90/aspect))*180/Math.PI:40,aspect,.1,60);
    camera.position.set(0,5.3,2.7);camera.lookAt(0,0,.23);camera.updateMatrixWorld(true);
    const t=stampTarget(42,index),p=new Vector3(t.x*1.2,.086,t.y*1.5).project(camera);
    await page.mouse.click(box.x+(p.x+1)*box.width/2,box.y+(1-p.y)*box.height/2);
}
async function earn(page:Page,game:Game){
    if(game==='stamp'){
        await stampContact(page,0);await page.clock.runFor(RULES.stampCooldown);
        for(let i=0;i<12;i++){
            await stampContact(page,i);await page.clock.runFor(RULES.stampCooldown);
            if(i<11)await expect(page.locator('.fw-arcade-counter')).toHaveText(`${i+1}/12`);
        }
    }else if(game==='cash'){
        for(const [i,card]of cashDeck(42).entries()){
            await page.locator('.fw-arcade-board').press(card.valid?'ArrowRight':'ArrowLeft');
            await page.clock.runFor(200);
            if(i<29)await expect(page.locator('[data-cash-progress]')).toHaveText(`${i+1}/30`);
        }
    }else{
        for(let client=0;client<3;client++){
            await page.getByRole('button',{name:'拍照快門',exact:true}).click();
            await expect(page.locator('.fw-arcade-contact-sheet img')).toHaveCount(client+1);
            await page.clock.runFor(300);
            await page.getByRole('button',{name:client===2?'挑選照片':'下一位客人 →',exact:true}).click();
        }
    }
    await expect(page.locator('[data-daily-result]')).toBeVisible();
    if(game==='stamp')await expect(page.locator('[data-daily-result]')).toContainText('完成 12 份文件');
    if(game==='cash')await expect(page.locator('[data-daily-result]')).toContainText('100 萬道具鈔');
}
const share=(page:Page)=>page.locator('[data-daily-result-share]');
const result=(page:Page)=>page.locator('[data-daily-result]');
const opener=(page:Page)=>result(page).getByRole('button',{name:'更多分享方式',exact:true});

// Existing 36 composition journeys own rejected + normal presentation without
// replaying earned inputs. Only the missing native-fullscreen matrix is added.
for(const game of ['stamp','cash','photo'] as const)for(const light of [false,true])for(const viewport of sizes)for(const scale of [1,2])
test(`Daily result ${game} ${light?'light':'native'} native fullscreen ${viewport.width} ${scale*100}% retains earned stage and frozen input`,async({page},testInfo)=>{
    await page.setViewportSize(viewport);await open(page,game,light,'native');
    await scaleDailyResultText(page.locator('.fullscreen-game'),scale);
    const checkpoint=await captureDailyStage(page);await earn(page,game);
    await verifyDailyResult(page,testInfo,{game,scale,checkpoint,mode:'native',prefix:`daily-result-${game}-${light?'light':'native'}-${viewport.width}-${scale*100}pct`});
});

// Delay only real encoder callbacks, never inject a result or replace the shot.
async function holdExports(page:Page){
    await page.evaluate(()=>{
        const original=HTMLCanvasElement.prototype.toBlob;
        const probe={jobs:[] as (()=>void)[],pngJobs:[] as (()=>void)[],calls:0,held:true,holdPng:true};
        (window as unknown as {dailyExports:typeof probe}).dailyExports=probe;
        HTMLCanvasElement.prototype.toBlob=function(callback,type,quality){
            probe.calls++;
            return original.call(this,blob=>{
                if((type??'image/png')==='image/png'&&probe.holdPng)probe.pngJobs.push(()=>callback(blob));
                else if(type==='image/jpeg'&&probe.held)probe.jobs.push(()=>callback(blob));else callback(blob);
            },type,quality);
        };
    });
}
test.describe('Daily saved-photo touchscreen result controls',()=>{
    test.use({hasTouch:true});
for(const light of [false,true])test(`Daily PHOTO ${light?'light':'native'} selected saved shot and pending exports survive dialog close`,async({page},testInfo)=>{
    await page.setViewportSize(sizes[1]);await open(page,'photo',light,'rejected');await holdExports(page);
    const owner=page.locator('.fullscreen-game');await scaleDailyResultText(owner,2);
    await earn(page,'photo');await scaleDailyResultText(owner,2);
    await expect.poll(()=>page.evaluate(()=>(window as unknown as {dailyExports:{pngJobs:unknown[]}}).dailyExports.pngJobs.length)).toBe(1);
    const pending=result(page).getByRole('button',{name:'成果圖整理中',exact:true});
    await expect(pending).toBeDisabled();await expect(pending).toHaveText('整理中');
    await expect(pending).toHaveAccessibleName(/整理中/);
    expect(await pending.evaluate(el=>{
        const r=el.getBoundingClientRect(),stage=el.closest('[data-daily-stage]')!.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
        const range=document.createRange();range.selectNodeContents(el);
        return r.width>=44&&r.height>=44&&r.left>=stage.left&&r.right<=stage.right+1&&r.top>=stage.top&&r.bottom<=stage.bottom+1&&r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1&&!!hit&&(el===hit||el.contains(hit))&&[...range.getClientRects()].every(t=>t.left>=r.left-1&&t.right<=r.right+1&&t.top>=r.top-1&&t.bottom<=r.bottom+1);
    })).toBe(true);
    expect(await pending.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(28);
    const dockGeometry=await result(page).evaluate(el=>{
        const status=el.querySelector('.daily-result-status')!.getBoundingClientRect(),actions=el.querySelector('.daily-result-actions')!.getBoundingClientRect();
        return {status:{left:status.left,top:status.top,right:status.right,bottom:status.bottom},actions:{left:actions.left,top:actions.top,right:actions.right,bottom:actions.bottom}};
    });
    expect(dockGeometry.status.bottom).toBeLessThanOrEqual(dockGeometry.actions.top);
    await testInfo.attach(`photo-${light?'light':'native'}-390-200pct-pending-png.png`,{body:await owner.screenshot({animations:'disabled'}),contentType:'image/png'});
    await testInfo.attach(`photo-${light?'light':'native'}-390-200pct-pending-dock.json`,{body:JSON.stringify(dockGeometry),contentType:'application/json'});
    await page.evaluate(()=>{const probe=(window as unknown as {dailyExports:{holdPng:boolean;pngJobs:(()=>void)[]}}).dailyExports;probe.holdPng=false;for(const finish of probe.pngJobs.splice(0))finish();});
    await expect(result(page).getByRole('link',{name:'下載完整成果 PNG',exact:true})).toHaveAttribute('href',/^blob:/);
    // Optional JPEG callbacks remain held while the genuine PNG is available.

    const dialogNode=await share(page).elementHandle();expect(dialogNode).not.toBeNull();
    await opener(page).click();
    const choices=share(page).locator('.fw-arcade-photo-choices button');await expect(choices).toHaveCount(3);
    const first=await choices.nth(0).locator('img').getAttribute('src'),last=await choices.nth(2).locator('img').getAttribute('src');
    expect(first).not.toBe(last);await choices.nth(0).click();await expect(choices.nth(0)).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('[data-daily-result-image]')).toHaveAttribute('src',first!);
    const png=result(page).getByRole('link',{name:'下載完整成果 PNG',exact:true});
    // Modal makes the primary row inert, but export publication must proceed.
    await expect(png).toHaveAttribute('href',/^blob:/);
    const url=await png.getAttribute('href');
    await expect.poll(()=>page.evaluate(()=>(window as unknown as {dailyExports:{jobs:unknown[]}}).dailyExports.jobs.length)).toBeGreaterThan(0);
    const calls=await page.evaluate(()=>(window as unknown as {dailyExports:{calls:number}}).dailyExports.calls);
    await share(page).getByRole('button',{name:'關閉分享',exact:true}).click();
    await expect(opener(page)).toBeFocused();await expect(page.locator('[data-daily-result-image]')).toHaveAttribute('src',first!);
    await opener(page).click();
    expect(await dialogNode!.evaluate(el=>el===document.querySelector('[data-daily-result-share]'))).toBe(true);
    await expect(choices.nth(0)).toHaveAttribute('aria-pressed','true');expect(await png.getAttribute('href')).toBe(url);
    expect(await page.evaluate(()=>(window as unknown as {dailyExports:{calls:number}}).dailyExports.calls)).toBe(calls);
    await page.keyboard.press('Escape');await expect(opener(page)).toBeFocused();await presentationIs(page,'rejected');
    await page.evaluate(()=>{const probe=(window as unknown as {dailyExports:{jobs:(()=>void)[];held:boolean}}).dailyExports;probe.held=false;for(const finish of probe.jobs.splice(0))finish();});
    await opener(page).click();await expect(share(page).getByRole('button',{name:'發到自由工坊',exact:true})).toBeEnabled();await page.keyboard.press('Escape');
    const downloaded=page.waitForEvent('download');await png.click();
    const bytes=readFileSync((await(await downloaded).path())!),meta=await sharp(bytes).metadata();
    expect([meta.format,meta.width,meta.height]).toEqual(['png',960,1200]);
    expect((await sharp(bytes).stats()).channels.some(c=>c.stdev>10)).toBe(true);
    // Real browser touch protocol input, not dispatchEvent or a desktop click.
    // This is emulated touchscreen coverage, not physical-device validation.
    expect(await page.evaluate(()=>navigator.maxTouchPoints)).toBeGreaterThan(0);
    await page.evaluate(()=>{
        const touches:{type:string;trusted:boolean;label:string}[]=[];
        (window as unknown as {dailyTouchInputs:typeof touches}).dailyTouchInputs=touches;
        document.addEventListener('pointerdown',event=>{
            if(event.pointerType!=='touch')return;
            const button=(event.target as Element).closest('button');
            touches.push({type:event.pointerType,trusted:event.isTrusted,label:button?.getAttribute('aria-label')??button?.textContent?.trim()??''});
        });
    });
    await opener(page).tap();await expect(share(page)).toBeVisible();
    await expect(choices.nth(0)).toHaveAttribute('aria-pressed','true');
    expect(await png.getAttribute('href')).toBe(url);
    await share(page).getByRole('button',{name:'關閉分享',exact:true}).tap();
    await expect(share(page)).not.toBeVisible();await expect(opener(page)).toBeFocused();await presentationIs(page,'rejected');
    await result(page).getByRole('button',{name:'同一題再來一次',exact:true}).tap();
    await expect(result(page)).toHaveCount(0);await expect(share(page)).toHaveCount(0);
    await expect(page).toHaveURL(/game=photo&seed=42/);
    await expect(page.locator('.fw-arcade-board')).toHaveAttribute('data-completed','false');
    await expect(page.locator('.fw-arcade-contact-sheet img')).toHaveCount(0);
    expect(await dialogNode!.evaluate(el=>el.isConnected)).toBe(false);
    expect(await page.evaluate(()=>(window as unknown as {dailyTouchInputs:unknown[]}).dailyTouchInputs)).toEqual([
        {type:'touch',trusted:true,label:'更多分享方式'},
        {type:'touch',trusted:true,label:'關閉分享'},
        {type:'touch',trusted:true,label:'同一題再來一次'},
    ]);
    await dialogNode!.dispose();
});

});

for(const game of ['stamp','cash','photo'] as const)test(`Daily ${game} completed context loss preserves earned result and download`,async({page})=>{
    await page.setViewportSize(sizes[1]);await open(page,game,false,'rejected');await earn(page,game);
    const summary=await result(page).locator('.daily-result-summary').innerText(),download=result(page).getByRole('link',{name:'下載完整成果 PNG',exact:true});
    await expect(download).toHaveAttribute('href',/^blob:/);const url=await download.getAttribute('href');
    await page.locator('.fw-arcade-stage canvas').evaluate((canvas:HTMLCanvasElement)=>{
        const extension=canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context');
        if(!extension)throw Error('WEBGL_lose_context unavailable');extension.loseContext();
    });
    await expect(result(page)).toBeVisible();await expect(page.locator('[data-daily-overlay]')).toHaveCount(0);
    await expect(page.locator('[data-daily-result-image]')).toBeVisible();
    expect(await result(page).locator('.daily-result-summary').innerText()).toBe(summary);expect(await download.getAttribute('href')).toBe(url);
    await page.clock.runFor(2000);await expect(page.locator('.fw-arcade-board')).toHaveAttribute('data-playing','false');
    await opener(page).click();await expect(share(page)).toBeVisible();await page.keyboard.press('Escape');await expect(opener(page)).toBeFocused();
});

for(const action of ['replay','next','back','history'] as const)test(`Daily earned CASH ${action} disposes old stage and stale result`,async({page})=>{
    await page.setViewportSize(sizes[1]);await open(page,'cash',true,'rejected');await earn(page,'cash');
    const oldBoard=await page.locator('.fw-arcade-board').elementHandle(),oldDialog=await share(page).elementHandle();
    const download=result(page).getByRole('link',{name:'下載完整成果 PNG',exact:true});await expect(download).toHaveAttribute('href',/^blob:/);
    const oldUrl=await download.getAttribute('href');
    if(action==='replay')await result(page).getByRole('button',{name:'同一題再來一次',exact:true}).click();
    else if(action==='history'){
        await result(page).getByRole('button',{name:'同一題再來一次',exact:true}).click();await page.goBack();
    }else{
        await opener(page).click();await share(page).getByRole('button',{name:action==='next'?'換個玩法 →':'回遊樂場',exact:true}).click();
    }
    await expect(result(page)).toHaveCount(0);await expect(share(page)).toHaveCount(0);
    expect(await oldBoard!.evaluate(el=>el.isConnected)).toBe(false);expect(await oldDialog!.evaluate(el=>el.isConnected)).toBe(false);
    expect(await page.evaluate(async url=>{try{await fetch(url!);return false;}catch{return true;}},oldUrl)).toBe(true);
    await page.clock.runFor(2000);await expect(result(page)).toHaveCount(0);
    if(action==='back')await expect(page).toHaveURL(/\/play$/);
    else if(action==='next')await expect(page).not.toHaveURL(/game=cash/);
    else{await expect(page).toHaveURL(/game=cash&seed=42/);await expect(page.locator('.fw-arcade-counter')).toHaveText('0 / 100 萬');}
    await oldBoard!.dispose();await oldDialog!.dispose();
});
