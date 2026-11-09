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

// Paint suppression must restore the exact inline style and preserve layout,
// focus and accessibility visibility. Observe the real UI and temporary probe.
function resultPresentation(el:Element){
    const nodes=[{node:el,kind:'result'},...[...el.querySelectorAll('.daily-result-summary,.daily-result-dock,.daily-result-actions > *')].map(node=>({node,kind:'paint'}))];
    for(let node=el.parentElement;node;node=node.parentElement)nodes.push({node,kind:'ancestor'});
    return nodes.map(({node,kind})=>{
        const style=getComputedStyle(node),rect=node.getBoundingClientRect();
        return {kind,tag:node.tagName,className:node.className,name:node.getAttribute('aria-label'),inlineStyle:node.getAttribute('style'),connected:node.isConnected,
            display:style.display,visibility:style.visibility,opacity:style.opacity,fontSize:style.fontSize,checkVisibility:node.checkVisibility(),
            bounds:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},hidden:node.hasAttribute('hidden'),inert:!!node.closest('[inert]'),disabled:node.matches(':disabled'),focused:node===document.activeElement};
    });
}

// The site's style-src 'self' blocks Playwright's injected screenshot <style>.
// CSSOM property writes (also used for 200% text) do not create a stylesheet or
// replace the style attribute string. Restore only the property's value/priority, never
// setAttribute('style', ...). The reference is temporary and is not delivered.
function suppressResultPaint(el:HTMLElement){
    const original={value:el.style.getPropertyValue('opacity'),priority:el.style.getPropertyPriority('opacity'),hadStyle:el.hasAttribute('style')};
    el.style.setProperty('opacity','0','important');return original;
}
function restoreResultPaint(el:HTMLElement,original:ReturnType<typeof suppressResultPaint>){
    if(original.value)el.style.setProperty('opacity',original.value,original.priority);
    else el.style.removeProperty('opacity');
    if(!original.hadStyle&&el.style.length===0)el.removeAttribute('style');
}
// Every delivered PNG contains the unmodified earned result. The same frozen
// stage supplies the reference; opacity leaves layout and visibility intact.
async function stagePixels(page:Page,testInfo:TestInfo,game:DailyResultGame,prefix:string){
    const result=page.locator('[data-daily-result]'),host=page.locator('.fw-arcade-stage');
    const preCompleted=await result.evaluate(resultPresentation);
    let before=preCompleted,after:typeof before|undefined,suppressedBefore:typeof before|undefined,suppressedAfter:typeof before|undefined,checkpoint='completed-capture',failed=false;
    let restorationError:string|undefined,originalDeclaration:ReturnType<typeof suppressResultPaint>|undefined,restoredDeclaration:typeof originalDeclaration;
    try{
        await expect(result).toHaveCSS('background-color','rgba(0, 0, 0, 0)');await expect(result).toHaveCSS('background-image','none');
        const completed=await host.screenshot({animations:'disabled'});
        await testInfo.attach(`${prefix}-completed-stage.png`,{body:completed,contentType:'image/png'});
        checkpoint='completed-presentation';before=await result.evaluate(resultPresentation);
        if(game==='photo'){
            const image=page.locator('[data-daily-result-image]'),selected=result.locator('.fw-arcade-photo-choices [aria-pressed="true"] img');
            await expect(selected).toHaveCount(1);const src=await selected.getAttribute('src');
            await expect(image).toHaveAttribute('src',src!);await expect(image).toHaveJSProperty('naturalWidth',960);await expect(image).toHaveJSProperty('naturalHeight',720);
            expect(src).toMatch(/^data:image\/jpeg;base64,/);
            await testInfo.attach(`${prefix}-selected-saved-photo.jpg`,{body:Buffer.from(src!.split(',')[1],'base64'),contentType:'image/jpeg'});
            checkpoint='complete';return;
        }
        for(const node of before.filter(node=>node.kind!=='ancestor')){
            expect(node.connected).toBe(true);expect(node.opacity).toBe('1');expect(node.visibility).toBe('visible');expect(node.checkVisibility).toBe(true);
            expect(node.bounds.width).toBeGreaterThan(0);expect(node.bounds.height).toBeGreaterThan(0);
        }
        checkpoint='reference-suppression';
        const original=originalDeclaration=await result.evaluate(suppressResultPaint);
        let reference:Buffer,referenceFailed=false;
        try{
            suppressedBefore=await result.evaluate(resultPresentation);
            // Reject a CSP-blocked/no-op probe before capture. Only root paint
            // and its inline opacity declaration may differ from the baseline.
            expect(suppressedBefore[0].opacity).toBe('0');
            expect(suppressedBefore.map((node,i)=>i?node:{...node,opacity:before[0].opacity,inlineStyle:before[0].inlineStyle})).toEqual(before);
            checkpoint='reference-capture';reference=await host.screenshot({animations:'disabled'});
            checkpoint='reference-presentation';suppressedAfter=await result.evaluate(resultPresentation);
            expect(suppressedAfter).toEqual(suppressedBefore);
        }catch(error){referenceFailed=true;throw error;}finally{
            try{
                await result.evaluate(restoreResultPaint,original);
                restoredDeclaration=await result.evaluate(el=>{const node=el as HTMLElement;return {value:node.style.getPropertyValue('opacity'),priority:node.style.getPropertyPriority('opacity'),hadStyle:node.hasAttribute('style')};});
                expect(restoredDeclaration).toEqual(original);
            }
            catch(error){restorationError=String(error);if(!referenceFailed)throw error;}
        }
        checkpoint='restored-presentation';after=await result.evaluate(resultPresentation);
        expect(await result.getAttribute('style')).toBe(before[0].inlineStyle);expect(after).toEqual(before);
        await expect(result).toHaveCSS('opacity','1');await expect(result).toHaveCSS('visibility','visible');await expect(result).toBeVisible();
        checkpoint='restored-controls';
        // toBeVisible does not reject opacity:0. Check restored paint explicitly
        // and recheck the actual four targets, their label bounds and hit tests.
        for(const name of ['系統分享圖片／連結','更多分享方式','同一題再來一次'])await exposed(result.getByRole('button',{name,exact:true}));
        await exposed(result.getByRole('link',{name:'下載完整成果 PNG',exact:true}));
        checkpoint='pixel-coverage';
        const actual=await sharp(completed).removeAlpha().raw().toBuffer({resolveWithObject:true}),base=await sharp(reference).removeAlpha().raw().toBuffer({resolveWithObject:true});
        expect(actual.info).toEqual(base.info);expect((await sharp(reference).stats()).channels.some(c=>c.stdev>20)).toBe(true);
        let unchanged=0;const pixels=actual.info.width*actual.info.height,channels=actual.info.channels;
        for(let i=0;i<pixels;i++){let same=true;for(let c=0;c<channels;c++)if(Math.abs(actual.data[i*channels+c]-base.data[i*channels+c])>2)same=false;if(same)unchanged++;}
        const changed=pixels-unchanged,fraction=unchanged/pixels;
        expect(changed,'the reference must actually remove painted result pixels').toBeGreaterThan(0);
        expect(fraction).toBeGreaterThanOrEqual(.5);
        await testInfo.attach(`${prefix}-stage-exposure.json`,{body:JSON.stringify({unchangedPixels:unchanged,changedPixels:changed,totalPixels:pixels,exposedFraction:fraction,tolerance:2,minimumFraction:.5,reference:'same frozen stage; CSSOM opacity property restored; suppression verified; original inline styles, computed paint and actual controls checked'}),contentType:'application/json'});
        checkpoint='complete';
    }catch(error){failed=true;throw error;}finally{
        // Keep this small record embedded even when the bounded CI archive has
        // no room for a later trace or failure screenshot. Never mask a failure.
        let observationError:string|undefined;
        try{after=await result.evaluate(resultPresentation);}catch(error){observationError=String(error);}
        try{await testInfo.attach(`${prefix}-result-restoration.json`,{body:JSON.stringify({checkpoint,preCompleted,before,suppressedBefore,suppressedAfter,after,originalDeclaration,restoredDeclaration,restorationError,observationError}),contentType:'application/json'});}
        catch(error){if(!failed)throw error;}
    }
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
