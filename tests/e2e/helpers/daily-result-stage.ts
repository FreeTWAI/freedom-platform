import {expect,type Page,type Locator} from '../fixtures.js';
import type {TestInfo} from '@playwright/test';
import sharp from 'sharp';

export type DailyResultGame='stamp'|'cash'|'photo';
export async function captureDailyStage(page:Page){
    const board=await page.locator('.fw-arcade-board').elementHandle(),stage=await page.locator('[data-daily-stage]').elementHandle();
    const renderer=await page.locator('.fw-arcade-stage canvas,.fw-arcade-stage svg').first().elementHandle();
    expect(board).not.toBeNull();expect(stage).not.toBeNull();expect(renderer).not.toBeNull();
    return {board:board!,stage:stage!,renderer:renderer!,bounds:await page.locator('.fw-arcade-stage').boundingBox()};
}
export async function scaleDailyResultText(owner:Locator,scale:number){
    await owner.evaluate((el,scale)=>{
        const nodes=[el,...el.querySelectorAll('*')].filter(node=>node instanceof HTMLElement) as HTMLElement[];
        for(const node of nodes)if(node.dataset.resultBaseFont)node.style.fontSize=node.dataset.resultBaseFont;
        const fonts=nodes.map(node=>({node,size:parseFloat(getComputedStyle(node).fontSize)}));
        for(const {node,size}of fonts){node.dataset.resultBaseFont=`${size}px`;node.style.fontSize=`${size*scale}px`;}
        for(const [side,value]of Object.entries({top:12,right:8,bottom:16,left:8}))(el as HTMLElement).style.setProperty(`--game-safe-${side}`,`${value}px`);
    },scale);
}
async function labelInName(control:Locator){
    const visible=(await control.innerText()).replace(/\s+/g,' ').trim();
    expect(visible).not.toBe('');
    await expect(control).toHaveAccessibleName(new RegExp(visible.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
}
async function visibleLabels(owner:Locator){
    for(const control of await owner.locator('button:visible,a:visible,summary:visible').all())await labelInName(control);
}
async function exposed(control:Locator){
    await expect(control).toBeVisible();await labelInName(control);
    expect(await control.evaluate(el=>{
        const r=el.getBoundingClientRect(),o=el.closest('[data-daily-stage]')!.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
        const range=document.createRange();range.selectNodeContents(el);
        const textFits=[...range.getClientRects()].every(t=>t.left>=r.left-1&&t.right<=r.right+1&&t.top>=r.top-1&&t.bottom<=r.bottom+1);
        return textFits&&r.width>=44&&r.height>=44&&r.left>=o.left&&r.right<=o.right+1&&r.top>=o.top&&r.bottom<=o.bottom+1&&r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1&&!!hit&&(hit===el||el.contains(hit));
    })).toBe(true);
}
async function presentationIs(page:Page,mode:'normal'|'native'|'rejected'){
    if(mode==='native')await expect.poll(()=>page.evaluate(()=>document.fullscreenElement?.classList.contains('fullscreen-game'))).toBe(true);
    else{
        expect(await page.evaluate(()=>document.fullscreenElement)).toBeNull();
        if(mode==='rejected')await expect(page.locator('.fullscreen-game')).toHaveClass(/fullscreen-game--viewport/);
        else await expect(page.locator('.fullscreen-game')).not.toHaveClass(/fullscreen-game--viewport/);
    }
}

// These future screenshot assertions operate on real earned state. Temporarily
// hiding only the result is a pixel reference, never the delivered evidence or
// an input workaround. Restore the exact style before any other assertion.
async function stagePixels(page:Page,testInfo:TestInfo,game:DailyResultGame,prefix:string){
    const result=page.locator('[data-daily-result]'),host=page.locator('.fw-arcade-stage');
    await expect(result).toHaveCSS('background-color','rgba(0, 0, 0, 0)');await expect(result).toHaveCSS('background-image','none');
    const completed=await host.screenshot({animations:'disabled'});
    await testInfo.attach(`${prefix}-completed-stage.png`,{body:completed,contentType:'image/png'});
    if(game==='photo'){
        const image=page.locator('[data-daily-result-image]'),selected=result.locator('.fw-arcade-photo-choices [aria-pressed="true"] img');
        await expect(selected).toHaveCount(1);const src=await selected.getAttribute('src');
        await expect(image).toHaveAttribute('src',src!);await expect(image).toHaveJSProperty('naturalWidth',960);await expect(image).toHaveJSProperty('naturalHeight',720);
        expect(src).toMatch(/^data:image\/jpeg;base64,/);
        await testInfo.attach(`${prefix}-selected-saved-photo.jpg`,{body:Buffer.from(src!.split(',')[1],'base64'),contentType:'image/jpeg'});
        return;
    }
    const oldStyle=await result.getAttribute('style');let reference:Buffer;
    try{await result.evaluate(el=>(el as HTMLElement).style.setProperty('visibility','hidden','important'));reference=await host.screenshot({animations:'disabled'});}
    finally{await result.evaluate((el,style)=>{if(style===null)el.removeAttribute('style');else el.setAttribute('style',style);},oldStyle);}
    expect(await result.getAttribute('style')).toBe(oldStyle);await expect(result).toBeVisible();
    const actual=await sharp(completed).removeAlpha().raw().toBuffer({resolveWithObject:true}),base=await sharp(reference!).removeAlpha().raw().toBuffer({resolveWithObject:true});
    expect(actual.info).toEqual(base.info);expect((await sharp(reference!).stats()).channels.some(c=>c.stdev>20)).toBe(true);
    let unchanged=0;const pixels=actual.info.width*actual.info.height,channels=actual.info.channels;
    for(let i=0;i<pixels;i++){let same=true;for(let c=0;c<channels;c++)if(Math.abs(actual.data[i*channels+c]-base.data[i*channels+c])>2)same=false;if(same)unchanged++;}
    const fraction=unchanged/pixels;expect(fraction).toBeGreaterThanOrEqual(.5);
    await testInfo.attach(`${prefix}-stage-exposure.json`,{body:JSON.stringify({unchangedPixels:unchanged,totalPixels:pixels,exposedFraction:fraction,tolerance:2,minimumFraction:.5,reference:'same frozen stage; only result visibility temporarily hidden and exact style restored'}),contentType:'application/json'});
}

export async function verifyDailyResult(page:Page,testInfo:TestInfo,options:{game:DailyResultGame;scale:number;prefix:string;mode:'native'|'rejected';checkpoint:Awaited<ReturnType<typeof captureDailyStage>>;scaleText?:(owner:Locator,scale:number)=>Promise<void>}){
    const {game,scale,prefix,checkpoint}=options,owner=page.locator('.fullscreen-game'),result=page.locator('[data-daily-result]'),dialog=page.locator('[data-daily-result-share]');
    await expect(result).toBeVisible();await visibleLabels(result);
    const sameNodes=async()=>{
        expect(await checkpoint.board.evaluate(el=>el===document.querySelector('.fw-arcade-board'))).toBe(true);
        expect(await checkpoint.stage.evaluate(el=>el===document.querySelector('[data-daily-stage]'))).toBe(true);
        expect(await checkpoint.renderer.evaluate(el=>el.isConnected&&el===document.querySelector('.fw-arcade-stage canvas,.fw-arcade-stage svg'))).toBe(true);
    };
    await sameNodes();expect(await page.locator('.fw-arcade-stage').boundingBox()).toEqual(checkpoint.bounds);
    await (options.scaleText??scaleDailyResultText)(owner,scale);
    await expect(page.locator('.fw-arcade-board')).toHaveAttribute('data-completed','true');await expect(page.locator('.fw-arcade-board')).toHaveAttribute('data-playing','false');
    expect(await result.evaluate(el=>!!el.closest('[data-daily-stage]'))).toBe(true);
    await expect(page.locator('.fw-arcade-controls')).toBeHidden();await expect(page.locator('.fw-arcade-controls')).toHaveAttribute('inert','');await expect(page.locator('[data-daily-overlay]')).toHaveCount(0);
    await expect(result.getByRole('link',{name:'下載完整成果 PNG',exact:true})).toHaveAttribute('href',/^blob:/);
    const summary=await result.locator('.daily-result-summary').innerText(),calls=await page.locator('.fw-arcade-stage').getAttribute('data-render-calls');
    const facts=page.locator('[data-photo-time],[data-stamp-time],[data-cash-progress],.fw-arcade-counter'),clockFacts=await facts.allTextContents();
    await page.locator('.fw-arcade-board').focus();for(const key of ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space'])await page.keyboard.press(key);await page.clock.runFor(5000);
    expect(await facts.allTextContents()).toEqual(clockFacts);expect(await result.locator('.daily-result-summary').innerText()).toBe(summary);expect(await page.locator('.fw-arcade-stage').getAttribute('data-render-calls')).toBe(calls);
    async function inspect(mode:'normal'|'native'|'rejected'){
        await sameNodes();await presentationIs(page,mode);
        const before=await page.evaluate(()=>({x:scrollX,y:scrollY}));
        for(const name of ['系統分享圖片／連結','更多分享方式','同一題再來一次'])await exposed(result.getByRole('button',{name,exact:true}));await exposed(result.getByRole('link',{name:'下載完整成果 PNG',exact:true}));
        await stagePixels(page,testInfo,game,`${prefix}-${mode}`);
        const more=result.getByRole('button',{name:'更多分享方式',exact:true});await more.click();await expect(dialog).toBeVisible();expect(await dialog.evaluate(el=>el.matches(':modal'))).toBe(true);
        const geometry=await dialog.evaluate(el=>{
            const r=el.getBoundingClientRect(),stage=el.closest('[data-daily-stage]')!.getBoundingClientRect();
            return {dialog:{left:r.left,top:r.top,right:r.right,bottom:r.bottom},stage:{left:stage.left,top:stage.top,right:stage.right,bottom:stage.bottom}};
        });
        expect(geometry.dialog.left).toBeGreaterThanOrEqual(geometry.stage.left+8);expect(geometry.dialog.right).toBeLessThanOrEqual(geometry.stage.right-8);
        expect(geometry.dialog.top).toBeGreaterThanOrEqual(geometry.stage.top+12);expect(geometry.dialog.bottom).toBeLessThanOrEqual(geometry.stage.bottom-16);
        await visibleLabels(dialog);
        const close=dialog.getByRole('button',{name:'關閉分享',exact:true});await exposed(close);await expect(close).toBeFocused();
        await testInfo.attach(`${prefix}-${mode}-share-open.png`,{body:await owner.screenshot({animations:'disabled'}),contentType:'image/png'});
        await testInfo.attach(`${prefix}-${mode}-share-geometry.json`,{body:JSON.stringify(geometry),contentType:'application/json'});
        for(const key of ['Tab','Shift+Tab','Tab']){await page.keyboard.press(key);expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);}
        await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(more).toBeFocused();await presentationIs(page,mode);
        const fullscreenShare=owner.getByRole('button',{name:'分享成果',exact:true});await fullscreenShare.click();await expect(dialog).toBeVisible();await expect(close).toBeFocused();await close.click();await expect(fullscreenShare).toBeFocused();
        await presentationIs(page,mode);expect(await page.evaluate(()=>({x:scrollX,y:scrollY}))).toEqual(before);
    }
    await inspect(options.mode);
    if(options.mode==='rejected'){
        await page.getByRole('button',{name:'退出全螢幕',exact:true}).click();await owner.scrollIntoViewIfNeeded();await inspect('normal');
        await page.getByRole('button',{name:'⛶ 全螢幕',exact:true}).click();await presentationIs(page,'rejected');await sameNodes();await expect(result).toBeVisible();
    }
    await checkpoint.board.dispose();await checkpoint.stage.dispose();await checkpoint.renderer.dispose();
}
