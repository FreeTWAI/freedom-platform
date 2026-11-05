import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {test,expect,type Page} from './fixtures.js';
import {navigate} from './navigation.js';
import {DEMO_PASSWORD} from '../../packages/testing/seed.js';

async function openComment(page:Page,pool:Pool){
 const userId=randomUUID(),postId=randomUUID(),commentId=randomUUID(),email=`comment-edit-${userId}@example.test`;
 expect((await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,onboarding_required)
   SELECT $1,community_id,$2,'留言編輯測試會員',password_hash,$3,false FROM users WHERE email='maker@local.test'`,[userId,email,randomUUID()])).rowCount).toBe(1);
 await pool.query(`INSERT INTO community_social_posts(post_id,community_id,author_user_id,kind,platform,title,note,state)
   SELECT $1,community_id,user_id,'note','other','留言編輯測試','每個案例使用獨立會員與留言。','active' FROM users WHERE user_id=$2`,[postId,userId]);
 await pool.query(`INSERT INTO community_social_comments(comment_id,post_id,community_id,author_user_id,body)
   SELECT $1,post_id,community_id,author_user_id,'原留言內容' FROM community_social_posts WHERE post_id=$2`,[commentId,postId]);
 await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill(email);await page.getByLabel('密碼',{exact:true}).fill(DEMO_PASSWORD);
 await page.getByRole('button',{name:'登入',exact:true}).click();await expect(page.locator('.shell')).toBeVisible();await navigate(page,'社群分享');
 const post=page.locator(`#social-post-${postId}`);await expect(post).toBeVisible();await post.getByRole('button',{name:'留言 · 1',exact:true}).click();
 const comment=post.locator('.social-comment'),input=comment.getByRole('textbox',{name:'編輯留言',exact:true});
 async function edit(){await comment.getByLabel('留言選項',{exact:true}).click();await comment.getByRole('button',{name:'編輯留言',exact:true}).click();}
 await edit();return {postId,commentId,userId,post,comment,input,edit,path:`/api/v1/social-posts/${postId}/comments/${commentId}/edit`};
}
async function loseFirstAck(page:Page,path:string){
 const writes:{key:string;match:string;body:{text:string}}[]=[];
 await page.route(`**${path}`,async route=>{
  const request=route.request();expect(request.method()).toBe('POST');writes.push({key:request.headers()['idempotency-key'],match:request.headers()['if-match'],body:request.postDataJSON()});
  if(writes.length!==1)return route.continue();
  const response=await route.fetch();expect(response.status()).toBe(200);await route.abort('failed');
 });return writes;
}
for(const width of [390,1440])test(`unknown comment edit survives cancel, refresh and exact-command recovery at ${width}px`,async({page,e2eAuthPool})=>{
 await page.setViewportSize({width,height:900});const h=await openComment(page,e2eAuthPool),writes=await loseFirstAck(page,h.path),text=`保留編輯 ${randomUUID()}`,draft=`未送出留言 ${randomUUID()}`;
 await h.post.getByRole('textbox',{name:'寫留言',exact:true}).fill(draft);await h.input.fill(text);await h.comment.getByRole('button',{name:'儲存留言',exact:true}).click();
 await expect(h.comment.getByRole('button',{name:'確認上次儲存',exact:true})).toBeEnabled();await expect(h.input).toBeDisabled();
 expect((await e2eAuthPool.query('SELECT body,edit_revision FROM community_social_comments WHERE comment_id=$1',[h.commentId])).rows[0]).toMatchObject({body:text,edit_revision:2});
 await h.comment.getByRole('button',{name:'取消',exact:true}).click();await h.edit();await expect(h.input).toHaveValue(text);await expect(h.input).toBeDisabled();
 await h.post.getByRole('button',{name:'重新載入留言',exact:true}).click();await expect(h.post.getByText('正在載入留言…',{exact:true})).toHaveCount(0);
 await h.comment.getByRole('button',{name:'確認上次儲存',exact:true}).click();await expect(h.input).toHaveCount(0);await expect(h.comment.locator('.social-comment-bubble')).toContainText(text);
 expect(writes).toHaveLength(2);expect(writes[0].key).toMatch(/^[0-9a-f-]{36}$/i);expect(writes[1]).toEqual(writes[0]);expect(writes[0].match).toBe('"1"');expect(writes[0].body).toEqual({text});
 expect((await e2eAuthPool.query('SELECT body,edit_revision FROM community_social_comments WHERE comment_id=$1',[h.commentId])).rows[0]).toMatchObject({body:text,edit_revision:2});
 await expect(h.post.getByRole('textbox',{name:'寫留言',exact:true})).toHaveValue(draft);
});
test('recovering an old comment edit receipt preserves a newer authorized edit',async({page,e2eAuthPool})=>{
 const h=await openComment(page,e2eAuthPool),writes=await loseFirstAck(page,h.path);await h.input.fill('曾經儲存的內容');await h.comment.getByRole('button',{name:'儲存留言',exact:true}).click();
 await expect(h.comment.getByRole('button',{name:'確認上次儲存',exact:true})).toBeEnabled();
 expect((await e2eAuthPool.query("UPDATE community_social_comments SET body='較新的編輯內容',edit_revision=edit_revision+1,edited_at=clock_timestamp() WHERE comment_id=$1 RETURNING edit_revision",[h.commentId])).rows[0].edit_revision).toBe(3);
 await h.post.getByRole('button',{name:'重新載入留言',exact:true}).click();await expect(h.post.getByText('正在載入留言…',{exact:true})).toHaveCount(0);
 await h.comment.getByRole('button',{name:'確認上次儲存',exact:true}).click();await expect(h.input).toHaveValue('較新的編輯內容');await expect(h.input).toBeEnabled();
 await expect(h.comment.getByRole('status')).toHaveText('上次儲存已確認，目前已有較新版本。');expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);
 expect((await e2eAuthPool.query('SELECT body,edit_revision FROM community_social_comments WHERE comment_id=$1',[h.commentId])).rows[0]).toMatchObject({body:'較新的編輯內容',edit_revision:3});
});
test('current hidden-comment authority is checked before replaying an unknown edit',async({page,e2eAuthPool})=>{
 const h=await openComment(page,e2eAuthPool),writes=await loseFirstAck(page,h.path);await h.input.fill('已儲存但回應遺失');await h.comment.getByRole('button',{name:'儲存留言',exact:true}).click();
 await expect(h.comment.getByRole('button',{name:'確認上次儲存',exact:true})).toBeEnabled();expect((await e2eAuthPool.query("UPDATE community_social_comments SET state='hidden' WHERE comment_id=$1",[h.commentId])).rowCount).toBe(1);
 const response=page.waitForResponse(r=>new URL(r.url()).pathname===h.path&&r.request().method()==='POST');await h.comment.getByRole('button',{name:'確認上次儲存',exact:true}).click();expect((await response).status()).toBe(404);
 await expect(h.comment.getByRole('button',{name:'確認上次儲存',exact:true})).toBeEnabled();await expect(h.input).toBeDisabled();expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);
 await h.post.getByRole('button',{name:'重新載入留言',exact:true}).click();await expect(h.comment).toHaveCount(0);
 expect((await e2eAuthPool.query('SELECT state,edit_revision FROM community_social_comments WHERE comment_id=$1',[h.commentId])).rows[0]).toMatchObject({state:'hidden',edit_revision:2});
});
