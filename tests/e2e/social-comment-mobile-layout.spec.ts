import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {test,expect,type Page} from './fixtures.js';
async function openPost(page:Page,pool:Pool){
 // Each case owns its posting allowance; never consume the shared demo member's daily quota.
 const userId=randomUUID(),email=`mobile-comment-${userId}@example.test`;
 const inserted=await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,onboarding_required)
  SELECT $1,community_id,$2,'手機留言測試會員',password_hash,$3,false FROM users WHERE email='maker@local.test'`,[userId,email,randomUUID()]);
 expect(inserted.rowCount).toBe(1);
 await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill(email);await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();
 const trigger=page.getByRole('button',{name:'建立貼文',exact:true});await trigger.click();
 const text=`手機留言版面 ${randomUUID()}`;await page.getByLabel('貼文內容',{exact:true}).fill(text);await page.getByRole('button',{name:'發布貼文',exact:true}).click();
 const post=page.locator('.social-card').filter({has:page.locator('.social-note').filter({hasText:text})});await expect(post).toBeVisible();
 await post.getByRole('button',{name:'留言 · 0',exact:true}).click();return {post,trigger};
}

test('mobile comment focus yields the launcher space, including toolbar controls, while desktop and open inbox remain intact',async({page,e2eAuthPool})=>{
 await page.setViewportSize({width:390,height:844});const {post,trigger}=await openPost(page,e2eAuthPool);
 const composer=post.locator('.social-comment-composer'),area=composer.getByRole('textbox',{name:'寫留言',exact:true}),bubble=page.locator('.floating-messages'),start=page.locator('.social-composer-start');
 await area.fill('保留手機留言草稿');
 // A reduced viewport is a layout check, not a simulated native iOS keyboard.
 for(const size of [{width:390,height:844},{width:390,height:420},{width:760,height:600}]){
  await page.setViewportSize(size);await area.focus();await expect(start).toHaveCSS('position','static');await expect(bubble).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  for(const name of ['上傳留言照片','插入 emoji','標註會員','送出留言']){
   const control=composer.getByRole('button',{name,exact:true});await control.focus();await expect(control).toBeFocused();await expect(bubble).toBeHidden();
  }
 }
 await composer.getByRole('button',{name:'插入 emoji',exact:true}).click();await composer.getByRole('button',{name:'插入 😀',exact:true}).focus();await expect(bubble).toBeHidden();await page.keyboard.press('Escape');
 await composer.getByRole('button',{name:'標註會員',exact:true}).click();await composer.getByRole('searchbox',{name:'搜尋標註會員',exact:true}).focus();await expect(bubble).toBeHidden();await page.keyboard.press('Escape');
 await area.focus();await page.keyboard.press('Tab');await expect(composer.getByRole('button',{name:'上傳留言照片',exact:true})).toBeFocused();await expect(bubble).toBeHidden();
 await page.setViewportSize({width:761,height:600});await area.focus();await expect(start).toHaveCSS('position','sticky');await expect(bubble).toBeVisible();
 await page.setViewportSize({width:390,height:420});const toggle=post.getByRole('button',{name:'留言 · 0',exact:true});await toggle.click();await expect(bubble).toBeVisible();await expect(toggle).toBeFocused();await toggle.click();await expect(area).toHaveValue('保留手機留言草稿');
 await area.focus();await expect(bubble).toBeHidden();await toggle.focus();await expect(bubble).toBeVisible();
 await bubble.click();const panel=page.locator('.floating-message-panel');await expect(panel).toBeVisible();await expect(bubble).toHaveAttribute('aria-expanded','true');await expect(panel.getByRole('button',{name:'收合聊天室',exact:true})).toBeVisible();
 await panel.getByRole('button',{name:'收合聊天室',exact:true}).click();await expect(panel).toBeHidden();await expect(bubble).toBeFocused();await expect(area).toHaveValue('保留手機留言草稿');
 // The original post launcher and modal draft/focus return remain usable.
 await trigger.click();await page.getByLabel('貼文內容',{exact:true}).fill('保留發文草稿');await page.keyboard.press('Escape');await expect(trigger).toBeFocused();await trigger.click();await expect(page.getByLabel('貼文內容',{exact:true})).toHaveValue('保留發文草稿');await page.keyboard.press('Escape');
});

test('mobile comment collapse retains an unknown send and retries the original idempotency key exactly once',async({page,e2eAuthPool})=>{
 await page.setViewportSize({width:390,height:420});const {post}=await openPost(page,e2eAuthPool);const area=post.getByRole('textbox',{name:'寫留言',exact:true}),bubble=page.locator('.floating-messages');
 await area.fill('未知送出不能清掉這份草稿');const keys:string[]=[],bodies:string[]=[];
 await page.route('**/api/v1/social-posts/*/comments',async route=>{
  if(route.request().method()!=='POST')return route.continue();keys.push(route.request().headers()['idempotency-key']);bodies.push(route.request().postData()??'');
  const response=await route.fetch();if(keys.length===1)return route.abort('failed');return route.fulfill({response});
 });
 await post.getByRole('button',{name:'送出留言',exact:true}).click();const retry=post.getByRole('button',{name:'重試留言',exact:true});await expect(retry).toBeEnabled();await expect(area).toBeDisabled();
 const toggle=post.getByRole('button',{name:'留言 · 0',exact:true});await toggle.click();await expect(bubble).toBeVisible();await toggle.click();await expect(area).toHaveValue('未知送出不能清掉這份草稿');await expect(area).toBeDisabled();
 await retry.focus();await expect(bubble).toBeHidden();await retry.click();await expect(area).toBeEnabled();await expect(area).toHaveValue('');await expect(post.locator('.social-comment')).toHaveCount(1);expect(keys).toHaveLength(2);expect(keys[0]).toBeTruthy();expect(keys[1]).toBe(keys[0]);expect(bodies[1]).toBe(bodies[0]);
});
