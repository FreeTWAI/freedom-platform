import {test, expect, type Page} from './fixtures.js';
import {navigate, signOut} from './navigation.js';

const endpoint='/api/v1/community-relations/bookmarks';
const writes='**/api/v1/community-relations/bookmarks';
async function login(page:Page,email='maker@local.test') {
  await page.goto('/');
  await page.getByLabel('電子郵件',{exact:true}).fill(email);
  await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  await page.getByRole('button',{name:'登入',exact:true}).click();
  await expect(page.locator('.shell')).toBeVisible();
  await navigate(page,'社群分享');
}
async function createPost(page:Page) {
  await login(page);
  const text=`私人書籤測試 ${Date.now()}`;
  await page.getByRole('button',{name:'建立貼文',exact:true}).click();
  await page.getByLabel('貼文內容',{exact:true}).fill(text);
  await page.getByRole('button',{name:'發布貼文',exact:true}).click();
  const card=page.locator('.social-card').filter({has:page.locator('.social-note').filter({hasText:text})});
  await expect(card).toBeVisible();
  const id=(await card.getAttribute('id'))!.replace('social-post-','');
  return {id,text,control:page.locator(`.social-post-bookmark[data-post-id="${id}"]`)};
}
const gate=()=>{let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return{promise,release};};

test('private post bookmark saves only explicitly, persists and is isolated from another member',async({page})=>{
  let posts=0;page.on('request',r=>{if(new URL(r.url()).pathname===endpoint&&r.method()==='POST')posts++;});
  const {control}=await createPost(page);
  await control.locator('summary').click();
  await expect(control.getByRole('button',{name:'儲存私人書籤',exact:true})).toBeVisible();expect(posts).toBe(0);
  await control.getByRole('button',{name:'儲存私人書籤',exact:true}).click();
  await expect(control.getByRole('button',{name:'移除書籤',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.reload();await control.locator('summary').click();
  await expect(control.getByRole('button',{name:'移除書籤',exact:true})).toBeVisible();
  await signOut(page);await login(page,'reviewer@local.test');await control.locator('summary').click();
  await expect(control.getByRole('button',{name:'儲存私人書籤',exact:true})).toHaveAttribute('aria-pressed','false');
  await signOut(page);await login(page);await control.locator('summary').click();
  await control.getByRole('button',{name:'移除書籤',exact:true}).click();
  await expect(control.getByRole('button',{name:'儲存私人書籤',exact:true})).toBeVisible();
  await page.reload();await control.locator('summary').click();
  await expect(control.getByRole('button',{name:'儲存私人書籤',exact:true})).toBeVisible();expect(posts).toBe(2);
});

test('passive feed never traverses relation providers and the disclosure is keyboard and phone usable in five languages',async({page})=>{
  const reads:string[]=[];page.on('request',r=>{if(r.method()==='GET'&&r.url().includes('/community-relations/'))reads.push(new URL(r.url()).pathname);});
  const {id,control}=await createPost(page);expect(reads).toEqual([]);
  await page.setViewportSize({width:320,height:844});
  const summary=control.locator('summary');await summary.focus();await page.keyboard.press('Enter');
  const save=control.getByRole('button',{name:'儲存私人書籤',exact:true});await expect(save).toBeVisible();
  expect(reads).toEqual([`${endpoint}/post/${id}`]);
  expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  for(const [language,label] of [['en','Private bookmark'],['ja','非公開ブックマーク'],['ko','비공개 북마크'],['es','Marcador privado'],['zh-Hant','私人書籤']]){
    await page.evaluate(value=>{localStorage.setItem('freedom-interface-language-v1',value);window.dispatchEvent(new StorageEvent('storage',{key:'freedom-interface-language-v1'}));},language!);
    await expect(summary).toHaveText(label!);
  }
  expect(reads).toHaveLength(1);await save.focus();await page.keyboard.press('Escape');
  await expect(control).not.toHaveAttribute('open','');await expect(summary).toBeFocused();
});

test('a committed write with a lost response retries the original tuple once without duplicate persistence',async({page,e2eAuthPool})=>{
  const {id,control}=await createPost(page);const attempts:{key:string|undefined;body:string|null}[]=[];
  await page.route(writes,async route=>{
    if(route.request().method()!=='POST'){await route.continue();return;}
    attempts.push({key:route.request().headers()['idempotency-key'],body:route.request().postData()});
    const response=await route.fetch();
    if(attempts.length===1)await route.abort('failed');else await route.fulfill({response});
  });
  await control.locator('summary').click();await control.getByRole('button',{name:'儲存私人書籤',exact:true}).click();
  await expect(control.getByRole('button',{name:'重試儲存私人書籤',exact:true})).toBeVisible();expect(attempts).toHaveLength(1);
  await control.locator('summary').click();await control.locator('summary').click();
  await expect(control.getByRole('button',{name:'重試儲存私人書籤',exact:true})).toBeVisible();expect(attempts).toHaveLength(1);
  await control.getByRole('button',{name:'重試儲存私人書籤',exact:true}).click();
  await expect(control.getByRole('button',{name:'移除書籤',exact:true})).toBeVisible();
  expect(attempts).toHaveLength(2);expect(attempts[0]!.key).toBeTruthy();expect(attempts[1]).toEqual(attempts[0]);
  const saved=await e2eAuthPool.query("SELECT count(*)::int AS n FROM community_content_bookmarks WHERE content_kind='post' AND content_id=$1 AND owner_user_id='20000000-0000-4000-8000-000000000001'",[id]);
  expect(saved.rows[0].n).toBe(1);
  const journal=await e2eAuthPool.query("SELECT count(*)::int AS n FROM transition_journal WHERE aggregate_type='community_content_bookmark' AND command='select' AND data->>'id'=$1",[id]);expect(journal.rows[0].n).toBe(1);
});

test('rapid activation and closing during an acknowledged write cannot duplicate or misapply its result',async({page})=>{
  const {control}=await createPost(page),held=gate(),seen=gate();const attempts:{key:string|undefined;body:string|null}[]=[];
  await page.route(writes,async route=>{
    if(route.request().method()!=='POST'){await route.continue();return;}
    attempts.push({key:route.request().headers()['idempotency-key'],body:route.request().postData()});
    const response=await route.fetch();if(attempts.length===1){seen.release();await held.promise;}await route.fulfill({response});
  });
  try{
    await control.locator('summary').click();const save=control.getByRole('button',{name:'儲存私人書籤',exact:true});
    await save.evaluate(element=>{(element as HTMLButtonElement).click();(element as HTMLButtonElement).click();});await seen.promise;
    await expect(control.getByRole('button',{name:'正在儲存…',exact:true})).toBeDisabled();expect(attempts).toHaveLength(1);
    await control.locator('summary').click();await control.locator('summary').click();held.release();
    await expect(control.getByRole('button',{name:'重試儲存私人書籤',exact:true})).toBeEnabled();
    await expect(control.getByRole('button',{name:'移除書籤',exact:true})).toHaveCount(0);
    await control.getByRole('button',{name:'重試儲存私人書籤',exact:true}).click();
    await expect(control.getByRole('button',{name:'移除書籤',exact:true})).toBeVisible();expect(attempts).toHaveLength(2);expect(attempts[1]).toEqual(attempts[0]);
  }finally{held.release();}
});

test('late reads across logout and malformed snapshots never enable a stale write',async({page})=>{
  const {id,control}=await createPost(page),held=gate(),seen=gate();let reads=0,posts=0;
  page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname===endpoint)posts++;});
  await page.route(`**${endpoint}/post/${id}`,async route=>{
    reads++;
    if(reads===1){seen.release();await held.promise;await route.fulfill({json:{kind:'post',id,selected:true,available:true}});}
    else if(reads===2)await route.fulfill({json:{kind:'post',id:'wrong-post',selected:true,available:true}});
    else await route.continue();
  });
  try{
    await control.locator('summary').click();await seen.promise;await signOut(page);await login(page,'reviewer@local.test');held.release();
    await control.locator('summary').click();await expect(control.getByRole('button',{name:'重新讀取',exact:true})).toBeVisible();
    await expect(control.getByRole('button',{name:'移除書籤',exact:true})).toHaveCount(0);
    await expect(control.getByRole('button',{name:'儲存私人書籤',exact:true})).toHaveCount(0);expect(posts).toBe(0);
    await control.getByRole('button',{name:'重新讀取',exact:true}).click();await expect(control.getByRole('button',{name:'儲存私人書籤',exact:true})).toBeVisible();expect(posts).toBe(0);
  }finally{held.release();}
});

test('each existing site gate independently hides private bookmark controls without reading relations',async({page})=>{
  const {control}=await createPost(page);let requests=0;
  page.on('request',r=>{if(r.url().includes('/community-relations/'))requests++;});
  for(const flag of ['community_search_enabled','community_relations_enabled']){
    await page.route('**/api/v1/site',async route=>{const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),[flag]:false}});});
    await page.reload();await expect(page.locator('.social-card').first()).toBeVisible();await expect(control).toHaveCount(0);
    await page.unroute('**/api/v1/site');
  }
  expect(requests).toBe(0);
});
