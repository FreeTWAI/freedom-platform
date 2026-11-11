import {expect,type Page} from '../fixtures.js';

async function partyElapsed(page:Page){return Number(await page.locator('.pt-canvas').getAttribute('data-elapsed'));}

async function partyAdvance(page:Page,target:number){
  for(let i=0;i<80;i++){const at=await partyElapsed(page);if(at>=target||await page.locator('.pt-root').getAttribute('data-party-state')==='done')return;await page.clock.runFor(Math.min(1000,target-at+17));}throw Error('party clock did not advance');
}


async function blockPartyWebGL(page:Page){
  await page.addInitScript(()=>{
    const get=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,kind:string,...args:any[]){
      if(kind==='webgl'||kind==='webgl2'||kind==='experimental-webgl')return null;
      return Reflect.apply(get,this,[kind,...args]);
    } as typeof get;
  });
}

async function openDailyResultShare(page:Page){
  const dialog=page.locator('[data-daily-result-share]');
  if(!await dialog.isVisible())await page.getByRole('button',{name:'更多分享方式',exact:true}).click();
  await expect(dialog).toBeVisible();return dialog;
}

async function socialEntries(page:Page,game:string){
  if(['photo','stamp','cash'].includes(game))await openDailyResultShare(page);
  const requests:string[]=[];const record=(r:{url:()=>string})=>{if(/^https:\/\/(x\.com|www\.(threads\.com|facebook\.com|instagram\.com))\//.test(r.url()))requests.push(r.url());};page.on('request',record);
  for(const label of ['X','Threads','Facebook','Instagram']){
    const button=page.getByRole('button',{name:`分享到 ${label}`,exact:true});await button.click();await expect(button).toHaveAttribute('aria-pressed','true');await expect(page.locator('.fw-arcade-social-targets [aria-pressed=true]')).toHaveCount(1);
    const entry=page.getByRole('link',{name:new RegExp(`^開啟 ${label}`)}),url=new URL((await entry.getAttribute('href'))!);expect(url.protocol).toBe('https:');expect(await entry.getAttribute('rel')).toContain('noopener');
    if(label==='X'||label==='Threads')expect(url.searchParams.get('text')).toContain(`game=${game}`);
    if(label==='Facebook')expect(url.searchParams.get('u')).toContain(`game=${game}`);
    if(label==='Instagram')expect(url.href).toBe('https://www.instagram.com/');
  }
  expect(requests).toEqual([]);page.off('request',record);
}

async function holidayControlHit(control:ReturnType<Page['locator']>){
  await control.scrollIntoViewIfNeeded();await expect(control).toBeVisible();
  const geometry=await control.evaluate(el=>{const b=el.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return {width:b.width,height:b.height,inside:b.left>=0&&b.top>=0&&b.right<=innerWidth&&b.bottom<=innerHeight,hit:!!hit&&(el===hit||el.contains(hit)),childrenInside:[...el.children].every(child=>{const c=child.getBoundingClientRect();return c.left>=b.left-1&&c.top>=b.top-1&&c.right<=b.right+1&&c.bottom<=b.bottom+1;})};});
  expect(geometry.width).toBeGreaterThanOrEqual(44);expect(geometry.height).toBeGreaterThanOrEqual(44);expect(geometry.inside).toBe(true);expect(geometry.hit).toBe(true);expect(geometry.childrenInside).toBe(true);
}

// Range rectangles conservatively include font ascent/descent, unlike client
// boxes or line-height alone. Inspect visible game labels and symbols, including
// aria-hidden visual icons. Responsive HUD/live descriptions are checked when
// painted; only their explicit non-painted/accessibility-only styles are excluded.
function partyPaintedContentFailures(root:Element){
  const bad:string[]=[],safe=root.getBoundingClientRect();
  const contains=(a:DOMRect,b:DOMRect)=>b.left>=a.left-1&&b.top>=a.top-1&&b.right<=a.right+1&&b.bottom<=a.bottom+1;
  const selectors='.fullscreen-game__button,.fullscreen-game__mode-help summary,.pt-holiday-heading button,.pt-holiday-heading h1,.pt-scoreboard strong,.pt-scoreboard strong>span,.pt-target-label,.pt-hole-controls button,.pt-chair-controls button,.pt-tofu-controls button,.pt-tools button,.pt-feedback';
  const responsiveLabels='.pt-scoreboard small,.pt-live-label';
  for(const el of root.querySelectorAll<HTMLElement>(`${selectors},${responsiveLabels}`)){
    const box=el.getBoundingClientRect(),name=el.getAttribute('aria-label')??el.textContent,responsiveLabel=el.matches(responsiveLabels);
    if(responsiveLabel){
      const css=getComputedStyle(el);
      // These labels switch between visible text and a specific sr-only pattern.
      // Do not use zero geometry or overflow clipping as a visibility exemption.
      let notPainted=css.visibility==='hidden'||css.visibility==='collapse';
      for(let parent:Element|null=el;parent&&root.contains(parent);parent=parent.parentElement)if(getComputedStyle(parent).display==='none')notPainted=true;
      if(notPainted)continue;
      if(css.position==='absolute'&&css.width==='1px'&&css.height==='1px'&&css.overflowX==='hidden'&&css.overflowY==='hidden'&&/^inset\(50%(?: 50%){0,3}\)$/.test(css.clipPath)&&css.whiteSpace==='nowrap')continue;
      if(css.clipPath!=='none')bad.push(`painted label uses clipping: ${name}`);
    }
    if(!el.checkVisibility()||box.width<=0||box.height<=0){bad.push(`unpainted required content: ${name}`);continue;}
    const ranges:DOMRect[]=[];
    const text=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
    while(text.nextNode()){
      if(!text.currentNode.textContent?.trim())continue;
      const range=document.createRange();range.selectNodeContents(text.currentNode);ranges.push(...range.getClientRects());
    }
    for(const svg of el.querySelectorAll('svg'))ranges.push(svg.getBoundingClientRect());
    for(const ink of ranges){
      if(!contains(box,ink)||!contains(safe,ink))bad.push(`painted content outside owner: ${name}; owner=${JSON.stringify(box.toJSON())}; ink=${JSON.stringify(ink.toJSON())}`);
      // A fitting button is still wrong when a clipping ancestor hides its ink.
      // display:contents contributes no painted clip box, so continue to the
      // nearest actual ancestor box rather than treating its 0x0 rect as paint.
      for(let parent=el.parentElement;parent&&root.contains(parent);parent=parent.parentElement){
        const css=getComputedStyle(parent);if(css.display==='contents')continue;
        if(responsiveLabel&&css.clipPath!=='none')bad.push(`painted label clipped by ancestor shape: ${name}`);
        const b=parent.getBoundingClientRect(),clipX=/(hidden|clip|auto|scroll)/.test(css.overflowX),clipY=/(hidden|clip|auto|scroll)/.test(css.overflowY);
        if((clipX&&(ink.left<b.left-1||ink.right>b.right+1))||(clipY&&(ink.top<b.top-1||ink.bottom>b.bottom+1)))bad.push(`painted content clipped by ancestor: ${name}`);
      }
    }
  }
  return bad;
}

async function partyCoveredToolsBounds(page:Page){
  // Check the whole direct tool row before any per-control scroll. Long paused,
  // recovery or capture-failure notices must not allocate space over these tools.
  expect(await page.locator('.fullscreen-game[data-game-stage]').evaluate(root=>{
    const bad:string[]=[],outer=root.getBoundingClientRect(),css=getComputedStyle(root),overlay=root.querySelector('.pt-holiday-overlay')!.getBoundingClientRect();
    const safe={left:outer.left+parseFloat(css.paddingLeft),right:outer.right-parseFloat(css.paddingRight),top:outer.top+parseFloat(css.paddingTop),bottom:outer.bottom-parseFloat(css.paddingBottom)};
    for(const button of root.querySelectorAll<HTMLElement>('.pt-tools button')){
      const b=button.getBoundingClientRect(),name=button.getAttribute('aria-label');
      if(!button.checkVisibility()||b.left<safe.left-1||b.right>safe.right+1||b.top<safe.top-1||b.bottom>safe.bottom+1)bad.push(`covered-state tool outside safe surface: ${name}`);
      if(b.width<44||b.height<44)bad.push(`small covered-state tool: ${name}`);
      if(Math.min(b.right,overlay.right)-Math.max(b.left,overlay.left)>1&&Math.min(b.bottom,overlay.bottom)-Math.max(b.top,overlay.top)>1)bad.push(`overlay overlaps tool: ${name}`);
      const hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);if(!hit||!button.contains(hit))bad.push(`covered-state tool is not hit-testable: ${name}`);
    }
    return bad;
  })).toEqual([]);
}

async function partyScrollPaintedStageIntoView(stage:ReturnType<Page['locator']>){
  // Playwright's Chromium scrollIntoViewIfNeeded delegates to CDP's content
  // rectangle. A viewport-height normal stage also has a 2px painted border.
  // Scroll the actual border box, then keep fractional document-scroll rounding
  // on the nonnegative side. The strict viewport/world assertions stay intact.
  await stage.evaluate(root=>{
    root.scrollIntoView({block:'start',inline:'nearest',behavior:'instant'});
    window.scrollBy({top:Math.floor(root.getBoundingClientRect().top),behavior:'instant'});
  });
}


async function holidayModalTextScale(page:Page,factor:number){
  const measurements=await page.locator('.pt-holiday-modal').evaluate((dialog,scale)=>{
    const nodes=[dialog,...dialog.querySelectorAll('*')].filter((node):node is HTMLElement=>node instanceof HTMLElement);
    const before=nodes.map(node=>({node,font:parseFloat(getComputedStyle(node).fontSize),line:parseFloat(getComputedStyle(node).lineHeight)}));
    for(const {node,font,line} of before){node.style.fontSize=`${font*scale}px`;if(Number.isFinite(line))node.style.lineHeight=`${line*scale}px`;}
    return before.map(({node,font,line})=>({font,actualFont:parseFloat(getComputedStyle(node).fontSize),line,actualLine:parseFloat(getComputedStyle(node).lineHeight)}));
  },factor);
  expect(measurements.length).toBeGreaterThan(3);for(const m of measurements){expect(m.actualFont).toBeCloseTo(m.font*factor,2);if(Number.isFinite(m.line))expect(m.actualLine).toBeCloseTo(m.line*factor,2);}
}

export {partyElapsed,partyAdvance,blockPartyWebGL,openDailyResultShare,socialEntries,holidayControlHit,partyPaintedContentFailures,partyCoveredToolsBounds,partyScrollPaintedStageIntoView,holidayModalTextScale};
