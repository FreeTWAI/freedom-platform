import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {test, expect, type Page} from './fixtures.js';
import {navigate} from './navigation.js';

async function openOwnPost(page: Page, pool: Pool, initiallyLiked = false) {
  const userId = randomUUID(), postId = randomUUID(), email = `like-feedback-${userId}@example.test`;
  const inserted = await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,onboarding_required)
    SELECT $1,community_id,$2,'按讚互動測試會員',password_hash,$3,false FROM users WHERE email='maker@local.test'`, [userId, email, randomUUID()]);
  expect(inserted.rowCount).toBe(1);
  await pool.query(`INSERT INTO community_social_posts(post_id,community_id,author_user_id,kind,platform,title,note,state)
    SELECT $1,community_id,user_id,'note','other','按讚互動測試','每個案例有自己的會員與貼文，不占用其他人的額度。','active' FROM users WHERE user_id=$2`, [postId, userId]);
  if (initiallyLiked) await pool.query('INSERT INTO community_social_likes(post_id,community_id,user_id) SELECT post_id,community_id,author_user_id FROM community_social_posts WHERE post_id=$1', [postId]);
  await page.goto('/');
  await page.getByLabel('電子郵件', {exact: true}).fill(email);
  await page.getByLabel('密碼', {exact: true}).fill('freedom-local-demo');
  await page.getByRole('button', {name: '登入', exact: true}).click();
  await expect(page.locator('.shell')).toBeVisible();
  await navigate(page, '社群分享');
  const post = page.locator(`#social-post-${postId}`);
  await expect(post).toBeVisible();
  return {post, postId, userId, like: post.locator('button.social-post-like')};
}

for (const width of [390, 1440]) test(`like feedback is immediate but pending, duplicate taps do not write twice, and unlike persists at ${width}px`, async ({page, e2eAuthPool}) => {
  await page.setViewportSize({width, height: 844});
  await page.emulateMedia({reducedMotion: 'reduce'});
  const {post, postId, like} = await openOwnPost(page, e2eAuthPool);
  let release!: () => void, captured!: () => void, requests = 0;
  const gate = new Promise<void>(r => release = r), seen = new Promise<void>(r => captured = r);
  await page.route(`**/api/v1/social-posts/${postId}/like`, async route => {
    requests++;
    if (requests === 1) { captured(); await gate; }
    await route.continue();
  });
  try {
    const before = await like.boundingBox();
    await like.focus(); await page.keyboard.press('Space'); await seen;
    await expect(like).toHaveText('已讚 · 1'); await expect(like).toHaveAttribute('aria-pressed', 'true');
    expect(await like.locator('.social-like-pulse').evaluate(node => getComputedStyle(node).animationName)).toBe('none');
    await expect(like).toHaveAttribute('aria-busy', 'true'); await expect(like).toBeDisabled();
    await expect(post.getByRole('button', {name: '查看按讚名單', exact: true})).toContainText('0 人按讚');
    await like.dispatchEvent('click'); await page.keyboard.press('Enter'); expect(requests).toBe(1);
    const pending = await like.boundingBox(); expect(pending!.width).toBe(before!.width); expect(pending!.height).toBeGreaterThanOrEqual(44);
    release(); await expect(like).toBeEnabled(); await expect(like).not.toHaveAttribute('aria-busy', 'true');
    await expect(post.getByRole('button', {name: '查看按讚名單', exact: true})).toContainText('1 人按讚');
    expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM community_social_likes WHERE post_id=$1', [postId])).rows[0].n).toBe(1);
    await like.click(); await expect(like).toHaveText('讚 · 0'); await expect(like).toBeEnabled();
    await page.reload(); await expect(like).toHaveAttribute('aria-pressed', 'false'); await expect(like).toHaveText('讚 · 0');
    expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM community_social_likes WHERE post_id=$1', [postId])).rows[0].n).toBe(0);
    expect(requests).toBe(2);
    await page.emulateMedia({reducedMotion: 'reduce'});
    expect(await like.locator('.social-like-icon').evaluate(node => getComputedStyle(node).animationName)).toBe('none');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { release(); }
});

for (const failure of ['lost', 'malformed', 'server-error'] as const) test(`an ${failure} like response rolls back the preview and manually replays the same command`, async ({page, e2eAuthPool}) => {
  const {post, postId, like} = await openOwnPost(page, e2eAuthPool);
  const attempts: {key: string; body: unknown}[] = [];
  await page.route(`**/api/v1/social-posts/${postId}/like`, async route => {
    attempts.push({key: route.request().headers()['idempotency-key'], body: route.request().postDataJSON()});
    if (attempts.length !== 1) return route.continue();
    if (failure === 'server-error') return route.fulfill({status: 503, contentType: 'application/problem+json', body: JSON.stringify({detail: '服務暫時無法回應'})});
    const response = await route.fetch(); expect(response.status()).toBe(200);
    if (failure === 'lost') return route.abort('failed');
    return route.fulfill({response, json: {post_id: postId, liked: true, like_count: '1'}});
  });
  await like.click(); await expect(like).toHaveText('重試按讚 · 0'); await expect(like).toHaveAttribute('aria-pressed', 'false');
  await expect(post.getByRole('alert')).toContainText('最後確認的狀態'); expect(attempts).toHaveLength(1);
  await like.click(); await expect(like).toHaveText('已讚 · 1'); await expect(like).toBeEnabled();
  expect(attempts).toHaveLength(2); expect(attempts[1]).toEqual(attempts[0]);
  expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM community_social_likes WHERE post_id=$1', [postId])).rows[0].n).toBe(1);
  await expect(post.locator('.social-like-error')).toHaveCount(0);
});

test('a known initial rejection restores the original button and a new explicit attempt uses a fresh key', async ({page, e2eAuthPool}) => {
  const {postId, like} = await openOwnPost(page, e2eAuthPool);
  const keys: string[] = [];
  await page.route(`**/api/v1/social-posts/${postId}/like`, async route => {
    keys.push(route.request().headers()['idempotency-key']);
    if (keys.length === 1) return route.fulfill({status: 429, contentType: 'application/problem+json', body: JSON.stringify({detail: '操作太頻繁，請稍後再試。'})});
    return route.continue();
  });
  await like.click(); await expect(like).toBeEnabled(); await expect(like).toHaveText('讚 · 0');
  await like.click(); await expect(like).toHaveText('已讚 · 1'); await expect(like).toBeEnabled();
  expect(keys).toHaveLength(2); expect(keys[1]).not.toBe(keys[0]);
});

function peopleGate() {let release!:()=>void;const wait=new Promise<void>(resolve=>release=resolve);return {wait,release};}
function trackedPeopleRoute(tasks:Set<Promise<void>>,run:(route:import('@playwright/test').Route)=>Promise<void>){
  return (route:import('@playwright/test').Route)=>{
    const task=run(route);tasks.add(task);
    void task.finally(()=>tasks.delete(task)).catch(()=>{});
    return task;
  };
}
for(const width of [390,1440])for(const initiallyLiked of [false,true])test(`open people list refreshes after ${initiallyLiked?'unlike':'like'} ACK and rejects its delayed old snapshot at ${width}px`,async({page,e2eAuthPool})=>{
  await page.setViewportSize({width,height:844});
  const {post,postId,userId,like}=await openOwnPost(page,e2eAuthPool,initiallyLiked);
  const postGate=peopleGate(),postSeen=peopleGate(),oldGetGate=peopleGate(),oldGetSeen=peopleGate();
  const tasks=new Set<Promise<void>>();let posts=0,gets=0;
  const postPattern=`**/api/v1/social-posts/${postId}/like`,getPattern=`**/api/v1/social-posts/${postId}/likes`;
  const postHandler=trackedPeopleRoute(tasks,async route=>{posts++;postSeen.release();await postGate.wait;await route.continue();});
  const getHandler=trackedPeopleRoute(tasks,async route=>{
    gets++;if(gets!==1){await route.continue();return;}
    const response=await route.fetch();expect(response.status()).toBe(200);
    const snapshot=await response.json();expect(snapshot.items.some((m:any)=>m.user_id===userId)).toBe(initiallyLiked);
    oldGetSeen.release();await oldGetGate.wait;await route.fulfill({response});
  });
  await page.route(postPattern,postHandler);await page.route(getPattern,getHandler);
  try{
    await like.focus();await page.keyboard.press('Space');await postSeen.wait;
    await expect(like).toBeDisabled();await expect(like).toHaveAttribute('aria-pressed',String(!initiallyLiked));
    const trigger=post.getByRole('button',{name:'查看按讚名單',exact:true});await trigger.focus();await page.keyboard.press('Enter');await oldGetSeen.wait;
    const dialog=post.getByRole('dialog',{name:'按讚名單',exact:true}),close=dialog.getByRole('button',{name:'關閉名單',exact:true});await expect(dialog).toBeVisible();await close.focus();
    postGate.release();await expect(like).toBeEnabled();await expect(trigger).toContainText(`${initiallyLiked?0:1} 人按讚`);
    if(initiallyLiked)await expect(dialog).toContainText('目前沒有可顯示的按讚會員。');else await expect(dialog).toContainText('按讚互動測試會員');
    await expect(close).toBeFocused();expect(gets).toBe(2);
    oldGetGate.release();await Promise.all([...tasks]);
    if(initiallyLiked)await expect(dialog).not.toContainText('按讚互動測試會員');else await expect(dialog).toContainText('按讚互動測試會員');
    expect(posts).toBe(1);expect(gets).toBe(2);
    expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM community_social_likes WHERE post_id=$1',[postId])).rows[0].n).toBe(initiallyLiked?0:1);
    await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(trigger).toBeFocused();
  }finally{postGate.release();oldGetGate.release();await Promise.all([...tasks]);await page.unroute(postPattern,postHandler);await page.unroute(getPattern,getHandler);}
});

test('closing a pending people dialog keeps it closed and focused after like ACK; reopen reads fresh',async({page,e2eAuthPool})=>{
  const {post,postId,like}=await openOwnPost(page,e2eAuthPool);const gate=peopleGate(),seen=peopleGate(),tasks=new Set<Promise<void>>();let gets=0;
  const pattern=`**/api/v1/social-posts/${postId}/like`,getPattern=`**/api/v1/social-posts/${postId}/likes`;
  const handler=trackedPeopleRoute(tasks,async route=>{seen.release();await gate.wait;await route.continue();}),getHandler=trackedPeopleRoute(tasks,async route=>{gets++;await route.continue();});
  await page.route(pattern,handler);await page.route(getPattern,getHandler);
  try{
    await like.click();await seen.wait;const trigger=post.getByRole('button',{name:'查看按讚名單',exact:true});await trigger.click();
    const dialog=post.getByRole('dialog',{name:'按讚名單',exact:true});await expect(dialog).toContainText('目前沒有可顯示的按讚會員。');await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
    gate.release();await expect(like).toBeEnabled();await expect(trigger).toContainText('1 人按讚');await expect(dialog).not.toBeVisible();await expect(trigger).toBeFocused();expect(gets).toBe(1);
    await page.keyboard.press('Enter');await expect(dialog).toContainText('按讚互動測試會員');expect(gets).toBe(2);
  }finally{gate.release();await Promise.all([...tasks]);await page.unroute(pattern,handler);await page.unroute(getPattern,getHandler);}
});

test('lost like ACK preserves original retry and refreshes the currently open people dialog only after confirmation',async({page,e2eAuthPool})=>{
  const {post,postId,like}=await openOwnPost(page,e2eAuthPool);const firstGate=peopleGate(),firstSeen=peopleGate(),retryGate=peopleGate(),retrySeen=peopleGate(),tasks=new Set<Promise<void>>();let gets=0;
  const attempts:{key:string;body:unknown}[]=[],pattern=`**/api/v1/social-posts/${postId}/like`,getPattern=`**/api/v1/social-posts/${postId}/likes`;
  const handler=trackedPeopleRoute(tasks,async route=>{
    attempts.push({key:route.request().headers()['idempotency-key'],body:route.request().postDataJSON()});
    if(attempts.length===1){const response=await route.fetch();expect(response.status()).toBe(200);firstSeen.release();await firstGate.wait;await route.abort('failed');return;}
    retrySeen.release();await retryGate.wait;await route.continue();
  }),getHandler=trackedPeopleRoute(tasks,async route=>{gets++;await route.continue();});
  await page.route(pattern,handler);await page.route(getPattern,getHandler);
  try{
    await like.click();await firstSeen.wait;const trigger=post.getByRole('button',{name:'查看按讚名單',exact:true});await trigger.click();const dialog=post.getByRole('dialog',{name:'按讚名單',exact:true});
    await expect(dialog).toContainText('按讚互動測試會員');firstGate.release();await expect(like).toHaveText('重試按讚 · 0');expect(gets).toBe(1);
    await page.keyboard.press('Escape');await like.click();await retrySeen.wait;await trigger.click();await expect(dialog).toContainText('按讚互動測試會員');expect(gets).toBe(2);
    retryGate.release();await expect(like).toBeEnabled();await expect(trigger).toContainText('1 人按讚');await expect.poll(()=>gets).toBe(3);await expect(dialog).toContainText('按讚互動測試會員');expect(attempts).toHaveLength(2);expect(attempts[1]).toEqual(attempts[0]);
  }finally{firstGate.release();retryGate.release();await Promise.all([...tasks]);await page.unroute(pattern,handler);await page.unroute(getPattern,getHandler);}
});

test('failed post-ACK people refresh retains safe snapshot and manual retry without repeating unlike',async({page,e2eAuthPool})=>{
  const {post,postId,like}=await openOwnPost(page,e2eAuthPool,true);const gate=peopleGate(),seen=peopleGate(),tasks=new Set<Promise<void>>();let gets=0,posts=0;
  const pattern=`**/api/v1/social-posts/${postId}/like`,getPattern=`**/api/v1/social-posts/${postId}/likes`;
  const handler=trackedPeopleRoute(tasks,async route=>{posts++;seen.release();await gate.wait;await route.continue();}),getHandler=trackedPeopleRoute(tasks,async route=>{gets++;if(gets===2){await route.fulfill({status:503,contentType:'application/problem+json',body:JSON.stringify({detail:'名單暫時無法讀取'})});return;}await route.continue();});
  await page.route(pattern,handler);await page.route(getPattern,getHandler);
  try{
    await like.click();await seen.wait;const trigger=post.getByRole('button',{name:'查看按讚名單',exact:true});await trigger.click();const dialog=post.getByRole('dialog',{name:'按讚名單',exact:true});await expect(dialog).toContainText('按讚互動測試會員');
    gate.release();await expect(like).toBeEnabled();await expect(trigger).toContainText('0 人按讚');await expect(dialog.getByRole('alert')).toBeVisible();await expect(dialog).toContainText('按讚互動測試會員');expect(gets).toBe(2);
    await dialog.getByRole('button',{name:'重試',exact:true}).click();await expect(dialog).toContainText('目前沒有可顯示的按讚會員。');await expect(dialog).not.toContainText('按讚互動測試會員');expect(gets).toBe(3);expect(posts).toBe(1);
  }finally{gate.release();await Promise.all([...tasks]);await page.unroute(pattern,handler);await page.unroute(getPattern,getHandler);}
});
