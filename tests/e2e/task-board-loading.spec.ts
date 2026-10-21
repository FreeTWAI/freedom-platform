import {test,expect,type Page} from './fixtures.js';
import {navigate} from './navigation.js';

const worksPath='/api/v1/work-items/page';
const projectsPath='/api/v1/co-creation/projects';
const emptyPage={items:[],next_cursor:null};
const project=(id:string)=>({project_id:id,title:`專案 ${id}`,goal:`專案 ${id} 的目標`,repository_url:`https://github.com/example/${id}`,repository_full_name:`example/${id}`});
function barrier(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}
async function login(page:Page){
  await page.goto('/');
  await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');
  await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  await page.getByRole('button',{name:'登入',exact:true}).click();
  await expect(page.getByRole('heading',{name:'會員首頁',level:1,exact:true})).toBeVisible();
}
const workSection=(page:Page)=>page.getByRole('region',{name:'工坊工作列表',exact:true});
const projectSection=(page:Page)=>page.getByRole('region',{name:'GitHub 共創專案',exact:true});

// All intercepted data belongs to synthetic read-only fixtures, never production.
test('task results become usable before a held project list returns',async({page})=>{
  const held=barrier();
  await page.route(url=>url.pathname===worksPath,route=>route.fulfill({json:emptyPage}));
  await page.route(url=>url.pathname===projectsPath,async route=>{await held.promise;await route.fulfill({json:{items:[]}});});
  try{
    await page.setViewportSize({width:390,height:844});
    await login(page);await navigate(page,'社群任務');
    await expect(workSection(page).getByText('目前沒有符合條件的工坊工作。',{exact:true})).toBeVisible();
    await expect(workSection(page)).toHaveAttribute('aria-busy','false');
    await expect(projectSection(page).getByText('正在載入共創專案…',{exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }finally{held.release();}
  await expect(projectSection(page).getByText('目前沒有共創專案。',{exact:true})).toBeVisible();
});

test('work searches and state filters do not reload the independent project list',async({page})=>{
  let projects=0;const searches:string[]=[];
  await page.route(url=>url.pathname===projectsPath,route=>{projects++;return route.fulfill({json:{items:[]}});});
  await page.route(url=>url.pathname===worksPath,route=>{searches.push(new URL(route.request().url()).searchParams.get('search')??'');return route.fulfill({json:emptyPage});});
  await login(page);await navigate(page,'社群任務');
  await expect(projectSection(page).getByText('目前沒有共創專案。',{exact:true})).toBeVisible();
  const baseline=projects;
  const search=page.getByLabel('搜尋任務',{exact:true});
  for(const value of ['設計','文件']){
    await search.fill(value);
    await expect.poll(()=>searches.includes(value)).toBe(true);
    await expect(workSection(page)).toHaveAttribute('aria-busy','false');
  }
  await page.getByRole('combobox',{name:'工坊工作狀態',exact:true}).selectOption('all');
  await expect(workSection(page)).toHaveAttribute('aria-busy','false');
  await search.press('Enter');
  await expect(workSection(page)).toHaveAttribute('aria-busy','false');
  await page.getByRole('button',{name:'清除搜尋',exact:true}).click();
  await expect(search).toHaveValue('');
  await expect(workSection(page)).toHaveAttribute('aria-busy','false');
  expect(projects).toBe(baseline);
});

test('Chinese composition waits until completion, without searching partial text',async({page})=>{
  const searches:string[]=[];
  await page.route(url=>url.pathname===projectsPath,route=>route.fulfill({json:{items:[]}}));
  await page.route(url=>url.pathname===worksPath,route=>{searches.push(new URL(route.request().url()).searchParams.get('search')??'');return route.fulfill({json:emptyPage});});
  await login(page);await navigate(page,'社群任務');
  await expect(workSection(page)).toHaveAttribute('aria-busy','false');
  await page.clock.install();
  const search=page.getByLabel('搜尋任務',{exact:true});
  await search.dispatchEvent('compositionstart');
  await search.fill('設');await page.clock.runFor(300);
  await search.fill('設計');await page.clock.runFor(300);
  expect(searches).not.toContain('設');expect(searches).not.toContain('設計');
  await expect(page.getByText('輸入完成後會自動搜尋。',{exact:true})).toBeVisible();
  await search.dispatchEvent('compositionend',{data:'設計'});await page.clock.runFor(300);
  await expect.poll(()=>searches.includes('設計')).toBe(true);
  expect(searches.filter(value=>value==='設計')).toHaveLength(1);
});

test('Esc-cancelled composition keeps older pages without re-reading page one',async({page})=>{
  const cursors:(string|null)[]=[];
  const item=(id:string)=>({work_item_id:id,title:`分頁工作 ${id}`,objective:'合成工作',gain:'合成收穫',state:'open',claim_window_expires_at:'2099-01-02T00:00:00Z'});
  await page.route(url=>url.pathname===projectsPath,route=>route.fulfill({json:{items:[]}}));
  await page.route(url=>url.pathname===worksPath,route=>{
    const cursor=new URL(route.request().url()).searchParams.get('cursor');cursors.push(cursor);
    return route.fulfill({json:{items:[item(cursor?'older':'first')],next_cursor:cursor?null:'synthetic-next'}});
  });
  await login(page);await navigate(page,'社群任務');
  await workSection(page).getByRole('button',{name:'載入較早的工坊工作',exact:true}).click();
  const older=workSection(page).getByRole('heading',{name:'分頁工作 older',exact:true});
  await expect(older).toBeVisible();
  const baseline=[...cursors];expect(baseline).toEqual([null,'synthetic-next']);
  await page.clock.install();
  const search=page.getByLabel('搜尋任務',{exact:true});
  await search.dispatchEvent('compositionstart');await search.fill('設');
  await page.clock.runFor(300);await search.press('Escape');
  // dispatchEvent does not run a native IME: restore the pre-composition value.
  await search.fill('');await search.dispatchEvent('compositionend',{data:''});
  await page.clock.runFor(300);
  await expect(search).toHaveValue('');
  await expect(page.getByText('輸入完成後會自動搜尋。',{exact:true})).toHaveCount(0);
  await expect(workSection(page)).toHaveAttribute('aria-busy','false');
  await expect(older).toBeVisible();
  await expect(workSection(page).getByRole('heading',{name:'分頁工作 first',exact:true})).toBeVisible();
  expect(cursors).toEqual(baseline);
});

test('failed work reads are not reported as empty and retry independently',async({page})=>{
  let fail=true,projects=0;
  await page.route(url=>url.pathname===worksPath,route=>fail?route.fulfill({status:503,body:''}):route.fulfill({json:emptyPage}));
  await page.route(url=>url.pathname===projectsPath,route=>{projects++;return route.fulfill({json:{items:[project('a')]}});});
  await login(page);await navigate(page,'社群任務');
  await expect(workSection(page).getByText('社群工作暫時無法載入。',{exact:true})).toBeVisible();
  await expect(workSection(page).getByText('目前沒有符合條件的工坊工作。',{exact:true})).toHaveCount(0);
  await expect(workSection(page).getByText('0 件',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('combobox',{name:'選擇共創專案',exact:true})).toBeEnabled();
  const baseline=projects;fail=false;
  await workSection(page).getByRole('button',{name:'重新載入工坊工作',exact:true}).click();
  await expect(workSection(page).getByText('目前沒有符合條件的工坊工作。',{exact:true})).toBeVisible();
  expect(projects).toBe(baseline);
});

test('a failed project list can retry without clearing or refetching work results',async({page})=>{
  let fail=true,works=0;
  await page.route(url=>url.pathname===worksPath,route=>{works++;return route.fulfill({json:emptyPage});});
  await page.route(url=>url.pathname===projectsPath,route=>fail?route.fulfill({status:503,body:''}):route.fulfill({json:{items:[project('a')]}}));
  await login(page);await navigate(page,'社群任務');
  await expect(workSection(page)).toHaveAttribute('aria-busy','false');
  await expect(projectSection(page).getByText('GitHub 共創專案暫時無法載入。',{exact:true})).toBeVisible();
  const baseline=works;fail=false;
  await projectSection(page).getByRole('button',{name:'重新載入共創專案',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'選擇共創專案',exact:true})).toBeEnabled();
  await expect(workSection(page).getByText('目前沒有符合條件的工坊工作。',{exact:true})).toBeVisible();
  expect(works).toBe(baseline);
});

test('manual refresh retains project choices and the selected Issue on failure, but clears them on permission loss',async({page})=>{
  let status=200,activityReads=0;
  await page.route(url=>url.pathname===worksPath,route=>route.fulfill({json:emptyPage}));
  await page.route(url=>url.pathname===projectsPath,route=>status===200
    ?route.fulfill({json:{items:[project('a')]}})
    :route.fulfill({status,json:{code:status===403?'forbidden':'unavailable',detail:'無法讀取專案。'}}));
  await page.route(url=>url.pathname===`${projectsPath}/a/activity`,route=>{
    activityReads++;
    return route.fulfill({json:{issues:[{number:1,title:'保留的 Issue',url:'https://github.com/example/a/issues/1',labels:[],assignees:[]}],checked_at:'2026-10-21T00:00:00Z',truncated:false}});
  });
  await login(page);await navigate(page,'社群任務');
  const picker=page.getByRole('combobox',{name:'選擇共創專案',exact:true});
  const issue=projectSection(page).getByRole('heading',{name:'保留的 Issue',exact:true});
  await picker.selectOption('a');await expect(issue).toBeVisible();
  status=503;await page.getByRole('button',{name:'重新整理',exact:true}).click();
  await expect(projectSection(page).getByText('GitHub 共創專案暫時無法載入。',{exact:true})).toBeVisible();
  await expect.poll(()=>activityReads).toBe(2);
  await expect(projectSection(page).getByText('正在讀取 GitHub Issue…',{exact:true})).toHaveCount(0);
  await expect(picker).toBeEnabled();await expect(picker).toHaveValue('a');
  await expect(picker.getByRole('option',{name:'專案 a',exact:true})).toHaveCount(1);
  await expect(issue).toBeVisible();
  status=403;await page.getByRole('button',{name:'重新整理',exact:true}).click();
  await expect(picker).toBeDisabled();await expect(picker).toHaveValue('');
  await expect(picker.getByRole('option',{name:'專案 a',exact:true})).toHaveCount(0);
  await expect(issue).toHaveCount(0);
});

test('switching projects cancels the old activity request and keeps the selected result',async({page})=>{
  const held=barrier(),started=barrier(),finished=barrier();
  const activity=(title:string)=>({issues:[{number:1,title,url:'https://github.com/example/a/issues/1',labels:[],assignees:[]}],checked_at:'2026-10-21T00:00:00Z',truncated:false});
  await page.route(url=>url.pathname===worksPath,route=>route.fulfill({json:emptyPage}));
  await page.route(url=>url.pathname===projectsPath,route=>route.fulfill({json:{items:[project('a'),project('b')]}}));
  await page.route(url=>url.pathname===`${projectsPath}/a/activity`,async route=>{
    started.release();await held.promise;
    try{await route.fulfill({json:activity('舊專案的 Issue')});}catch(cause){if(!route.request().failure())throw cause;}finally{finished.release();}
  });
  await page.route(url=>url.pathname===`${projectsPath}/b/activity`,route=>route.fulfill({json:activity('目前專案的 Issue')}));
  try{
    await login(page);await navigate(page,'社群任務');
    const picker=page.getByRole('combobox',{name:'選擇共創專案',exact:true});await expect(picker).toBeEnabled();
    await picker.selectOption('a');await started.promise;
    const aborted=page.waitForEvent('requestfailed',request=>new URL(request.url()).pathname===`${projectsPath}/a/activity`);
    await picker.selectOption('b');
    await expect(projectSection(page).getByRole('heading',{name:'目前專案的 Issue',exact:true})).toBeVisible();
    held.release();await finished.promise;
    expect((await aborted).failure()?.errorText).toMatch(/abort|cancel/i);
    await expect(projectSection(page).getByRole('heading',{name:'舊專案的 Issue',exact:true})).toHaveCount(0);
  }finally{held.release();}
});

test('permission loss on a later page clears retained data and never spins indefinitely',async({page})=>{
  await page.route(url=>url.pathname===projectsPath,route=>route.fulfill({json:{items:[]}}));
  await page.route(url=>url.pathname===worksPath,route=>new URL(route.request().url()).searchParams.has('cursor')
    ?route.fulfill({status:403,json:{code:'forbidden',detail:'目前無法讀取這些工作。'}})
    :route.fulfill({json:{items:[],next_cursor:'synthetic-next'}}));
  await login(page);await navigate(page,'社群任務');
  await workSection(page).getByRole('button',{name:'載入較早的工坊工作',exact:true}).click();
  await expect(workSection(page).getByText('社群工作暫時無法載入。',{exact:true})).toBeVisible();
  await expect(workSection(page)).toHaveAttribute('aria-busy','false');
  await expect(workSection(page).getByText('目前沒有符合條件的工坊工作。',{exact:true})).toHaveCount(0);
  await expect(workSection(page).getByRole('button',{name:'重新載入工坊工作',exact:true})).toBeVisible();
});
