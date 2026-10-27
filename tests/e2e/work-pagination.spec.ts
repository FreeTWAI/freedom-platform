import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { DEMO_USERS, DEMO_WORK } from '../../packages/testing/seed.js';
import { navigate } from './navigation.js';
import {openSettingsPanel,closeSettingsMenu} from './settings-menu-helpers.js';
import {EXPERIENCE_PROFILES} from '../../apps/portal-web/src/experience-profiles.js';
import { test, expect, type Page } from './fixtures.js';

async function seedWorks(pool: Pool) {
  const ids = Array.from({length: 30}, () => randomUUID());
  const titles = ids.map((_, index) => `分頁工作 ${String(index + 1).padStart(2, '0')}`);
  const created = ids.map((_, index) => `2099-01-01T00:00:00.123${String(index).padStart(3, '0')}Z`);
  await pool.query(`WITH source AS (
      SELECT community_id,objective,acceptance_criteria,gain,participation_terms,participation_terms_sha256
      FROM work_items WHERE work_item_id=$4
    ), input AS (
      SELECT * FROM unnest($1::uuid[],$2::text[],$3::timestamptz[]) AS value(work_item_id,title,created_at)
    )
    INSERT INTO work_items(work_item_id,community_id,owner_ref,title,objective,acceptance_criteria,gain,state,participation_terms,
      participation_terms_sha256,claim_window_expires_at,due_at,created_at)
    SELECT input.work_item_id,source.community_id,$5,input.title,source.objective,source.acceptance_criteria,source.gain,'open',
      source.participation_terms,source.participation_terms_sha256,'2099-01-02T00:00:00Z','2099-01-03T00:00:00Z',input.created_at
    FROM input CROSS JOIN source`, [ids, titles, created, DEMO_WORK, DEMO_USERS[1].user_id]);
  return ids;
}

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('電子郵件', {exact: true}).fill('maker@local.test');
  await page.getByLabel('密碼', {exact: true}).fill('freedom-local-demo');
  await page.getByRole('button', {name: '登入', exact: true}).click();
  await expect(page.getByRole('heading', {name: '會員首頁', exact: true})).toBeVisible();
}

const paginationHeadings = (page: Page) => page.getByRole('heading', {level: 3, name: /^分頁工作 \d{2}$/});

test('workbench and task board load bounded work pages without losing microsecond peers', async ({page, e2eAuthPool}) => {
  const ids=await seedWorks(e2eAuthPool);
  await page.setViewportSize({width: 1280, height: 900});
  await login(page);
  await navigate(page, '任務協作');
  await expect(paginationHeadings(page)).toHaveCount(24);
  const workbenchMore = page.getByRole('button', {name: '載入較早的社群工作', exact: true});
  await expect(workbenchMore).toBeVisible();
  await workbenchMore.click();
  await expect(paginationHeadings(page)).toHaveCount(30);
  await expect(workbenchMore).toHaveCount(0);

  await page.setViewportSize({width: 390, height: 844});
  await navigate(page, '社群任務');
  await expect(paginationHeadings(page)).toHaveCount(24);
  const taskBoardMore = page.getByRole('button', {name: '載入較早的工坊工作', exact: true});
  await expect(taskBoardMore).toBeVisible();
  await taskBoardMore.click();
  await expect(paginationHeadings(page)).toHaveCount(30);
  await expect(taskBoardMore).toHaveCount(0);

  // The only claimable matching row is older than 29 closed, nonmatching rows.
  await e2eAuthPool.query("UPDATE work_items SET state='claiming_closed' WHERE work_item_id=ANY($1::uuid[])",[ids.slice(1)]);
  await e2eAuthPool.query("UPDATE work_items SET title='較早的 NeedLe%_ 工作' WHERE work_item_id=$1",[ids[0]]);
  await page.getByRole('button',{name:'重新整理',exact:true}).click();
  const older=page.getByRole('heading',{level:3,name:'較早的 NeedLe%_ 工作',exact:true});
  await expect(older).toBeVisible();
  await page.getByLabel('搜尋任務',{exact:true}).fill('needle%_');
  await expect(older).toBeVisible();
  await expect(paginationHeadings(page)).toHaveCount(0);
  await page.getByRole('combobox',{name:'工坊工作狀態',exact:true}).selectOption('all');
  await page.getByLabel('搜尋任務',{exact:true}).fill('分頁工作');
  await expect(paginationHeadings(page)).toHaveCount(24);
  await taskBoardMore.click();await expect(paginationHeadings(page)).toHaveCount(29);
  await expect(taskBoardMore).toHaveCount(0);

  let releaseStale=()=>{};
  const held=new Promise<void>(resolve=>{releaseStale=resolve;});
  let requested=()=>{};
  const started=new Promise<void>(resolve=>{requested=resolve;});
  let finished=()=>{};
  const completed=new Promise<void>(resolve=>{finished=resolve;});
  await page.route('**/api/v1/work-items/page?**',async route=>{
    if(new URL(route.request().url()).searchParams.get('search')!=='missing-review'){await route.continue();return;}
    const response=await route.fetch();requested();await held;
    try{await route.fulfill({response});}catch(cause){if(!route.request().failure())throw cause;}finally{finished();}
  });
  try{
    await page.getByLabel('搜尋任務',{exact:true}).fill('missing-review');await started;
    const aborted=page.waitForEvent('requestfailed',request=>new URL(request.url()).searchParams.get('search')==='missing-review');
    await page.getByLabel('搜尋任務',{exact:true}).fill('needle%_');
    await expect(older).toBeVisible();releaseStale();await completed;
    expect((await aborted).failure()?.errorText).toMatch(/abort|cancel/i);
    await expect(older).toBeVisible();await expect(paginationHeadings(page)).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }finally{releaseStale();}
});

// Real application/theme cascade with synthetic page responses. The existing test
// above retains the separate real-PostgreSQL pagination coverage.
async function expectWorkPaginationColors(action:import('@playwright/test').Locator,focused=false){
  const observed=await action.evaluate(async element=>{
    // Force style resolution, then wait for the existing color transitions rather
    // than sampling the .16s intermediate palette after hover/profile changes.
    void getComputedStyle(element).color;
    for(let ancestor:Element|null=element;ancestor;ancestor=ancestor.parentElement){
      const animations=ancestor.getAnimations().filter(animation=>animation instanceof CSSTransition&&/^(?:color|background-color|outline-color|border(?:-(?:top|right|bottom|left))?-color)$/.test(animation.transitionProperty));
      if(animations.some(animation=>animation.playState==='paused'))throw Error('Paused color transition');
      await Promise.all(animations.map(animation=>animation.finished.catch(()=>{})));
    }
    const style=getComputedStyle(element);
    const rgba=(value:string)=>{
      const match=/^rgba?\(([^)]+)\)$/.exec(value);
      if(!match)throw Error('Unsupported computed color: '+value);
      const parts=match[1].split(',').map(value=>Number(value.trim()));
      if(![3,4].includes(parts.length)||parts.some(value=>!Number.isFinite(value))||parts.slice(0,3).some(value=>value<0||value>255))throw Error('Invalid RGB color');
      const alpha=parts[3]??1;if(alpha<0||alpha>1)throw Error('Invalid alpha');
      return {rgb:parts.slice(0,3),alpha};
    };
    const luminance=(value:string)=>{
      const parsed=rgba(value);if(parsed.alpha!==1)throw Error('Expected opaque measured color');
      const c=parsed.rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
      return c[0]*.2126+c[1]*.7152+c[2]*.0722;
    };
    if(style.backgroundImage!=='none')throw Error('Unexpected action background image');
    for(let ancestor=element.parentElement;ancestor;ancestor=ancestor.parentElement){
      const outer=getComputedStyle(ancestor);
      if(Number(outer.opacity)!==1)throw Error('Unexpected ancestor opacity');
    }
    // Focus contrast is button-side only: the dark page has a gradient, whose
    // adjacent pixels are not established by this opaque-button color check.
    const ratio=(a:string,b:string)=>{const v=[luminance(a),luminance(b)].sort((a,b)=>a-b);return(v[1]+.05)/(v[0]+.05);};
    return {text:ratio(style.color,style.backgroundColor),focus:ratio(style.outlineColor,style.backgroundColor),
      outline:style.outlineStyle,outlineWidth:parseFloat(style.outlineWidth),focusVisible:element.matches(':focus-visible'),
      height:element.getBoundingClientRect().height,opacity:Number(style.opacity)};
  });
  expect(observed.text).toBeGreaterThanOrEqual(4.5);
  expect(observed.height).toBeGreaterThanOrEqual(44);
  expect(observed.opacity).toBe(1);
  if(focused){
    expect(observed.focusVisible).toBe(true);expect(observed.outline).not.toBe('none');
    expect(observed.outlineWidth).toBeGreaterThanOrEqual(2);expect(observed.focus).toBeGreaterThanOrEqual(3);
  }
}

const paginationPages=[
  {pageName:'任務協作',selector:'.workbench-load-more',loadName:'載入較早的社群工作'},
  {pageName:'社群任務',selector:'.task-board-load-more',loadName:'載入較早的工坊工作'},
];
// One authenticated journey per page. Existing pagination/loading tests retain
// the two-width and failure/retry coverage; these cases only exercise appearance.
for(const panel of paginationPages)test(`${panel.pageName} pagination keeps five profile palettes`,async({page})=>{
  await page.setViewportSize({width:1280,height:900});
  await page.route('**/api/v1/co-creation/projects',route=>route.fulfill({json:{items:[]}}));
  await page.route('**/api/v1/work-items/page*',route=>route.fulfill({json:{items:[],next_cursor:'synthetic-workbench-cursor'}}));
  await login(page);await navigate(page,panel.pageName);
  const action=page.locator(panel.selector);
  await expect(action).toHaveAccessibleName(panel.loadName);await expect(action).toBeVisible();
  for(const profile of Object.values(EXPERIENCE_PROFILES)){
    await openSettingsPanel(page,'appearance');
    await page.getByRole('menuitemradio',{name:profile.label,exact:true}).click();
    await closeSettingsMenu(page);
    await expect(page.locator('html')).toHaveAttribute('data-experience-profile',profile.id);
    expect(await page.evaluate(()=>localStorage.getItem('freedom-theme'))).toBe(profile.id);
    await action.scrollIntoViewIfNeeded();await expect(action).toBeVisible();
    // Clear the previous sample's pointer/focus before checking the idle state.
    await page.mouse.move(0,0);await page.getByRole('button',{name:'設定',exact:true}).focus();
    await expectWorkPaginationColors(action);
    await action.hover();await expectWorkPaginationColors(action);
    await action.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
    await expect(action).toBeFocused();await expectWorkPaginationColors(action,true);
  }
});
