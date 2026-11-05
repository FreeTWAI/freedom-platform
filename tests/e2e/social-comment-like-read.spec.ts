import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {test,expect,type Page} from './fixtures.js';
import {navigate} from './navigation.js';
import {DEMO_PASSWORD} from '../../packages/testing/seed.js';

async function openComment(page:Page,pool:Pool){
  const userId=randomUUID(),postId=randomUUID(),commentId=randomUUID(),email=`comment-read-${userId}@example.test`;
  expect((await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,onboarding_required)
    SELECT $1,community_id,$2,'留言讀寫測試會員',password_hash,$3,false FROM users WHERE email='maker@local.test'`,[userId,email,randomUUID()])).rowCount).toBe(1);
  await pool.query(`INSERT INTO community_social_posts(post_id,community_id,author_user_id,kind,platform,title,note,state)
    SELECT $1,community_id,user_id,'note','other','留言讀寫測試','每個案例有自己的會員、貼文與留言。','active' FROM users WHERE user_id=$2`,[postId,userId]);
  await pool.query(`INSERT INTO community_social_comments(comment_id,post_id,community_id,author_user_id,body)
    SELECT $1,post_id,community_id,author_user_id,'保留這則留言的正確按讚狀態' FROM community_social_posts WHERE post_id=$2`,[commentId,postId]);
  await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill(email);await page.getByLabel('密碼',{exact:true}).fill(DEMO_PASSWORD);
  await page.getByRole('button',{name:'登入',exact:true}).click();await expect(page.locator('.shell')).toBeVisible();await navigate(page,'社群分享');
  const post=page.locator(`#social-post-${postId}`),toggle=post.getByRole('button',{name:'留言 · 1',exact:true});
  await expect(post).toBeVisible();await toggle.click();
  const comment=post.locator('.social-comment'),like=comment.getByRole('button',{name:/^留言(?:已讚|讚) ·/});
  await expect(like).toHaveAttribute('aria-pressed','false');return {postId,commentId,userId,post,toggle,comment,like};
}

async function holdNextRead(page:Page,postId:string){
  let release!:()=>void,captured!:(snapshot:any)=>void;const gate=new Promise<void>(resolve=>release=resolve),snapshot=new Promise<any>(resolve=>captured=resolve);
  const pattern=`**/api/v1/social-posts/${postId}/comments`,reads:string[]=[];let first=true;
  const handler=async(route:import('@playwright/test').Route)=>{
    expect(route.request().method()).toBe('GET');reads.push(route.request().url());
    if(!first)return route.continue();first=false;
    const response=await route.fetch();expect(response.status()).toBe(200);captured(await response.json());await gate;await route.fulfill({response});
  };
  await page.route(pattern,handler);return {release,snapshot,reads,dispose:async()=>{release();await page.unroute(pattern,handler);}};
}

for(const width of [390,1440])test(`confirmed comment like and unlike do not roll back behind an older GET at ${width}px`,async({page,e2eAuthPool})=>{
  await page.setViewportSize({width,height:900});const h=await openComment(page,e2eAuthPool),draft=`Unsent draft ${randomUUID()}`;
  await h.post.getByRole('textbox',{name:'寫留言',exact:true}).fill(draft);
  const writes:{body:{liked:boolean};key:string}[]=[];
  page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname===`/api/v1/social-posts/${h.postId}/comments/${h.commentId}/like`)writes.push({body:request.postDataJSON(),key:request.headers()['idempotency-key']});});
  for(const desired of [true,false]){
    const hold=await holdNextRead(page,h.postId);
    try{
      await h.toggle.click();await h.toggle.click();const snapshot=await hold.snapshot;
      expect(snapshot.items).toHaveLength(1);expect(snapshot.items[0].liked).toBe(!desired);
      await h.like.click();await expect(h.like).toHaveAttribute('aria-pressed',String(desired));await expect(h.like).toBeEnabled();
      await h.like.evaluate(node=>{
        const observed:{values:(string|null)[];observer?:MutationObserver}={values:[]};
        observed.observer=new MutationObserver(records=>{for(const record of records)observed.values.push(record.oldValue,node.getAttribute('aria-pressed'));});
        observed.observer.observe(node,{attributes:true,attributeFilter:['aria-pressed'],attributeOldValue:true});
        (node as unknown as {readProbe:typeof observed}).readProbe=observed;
      });
      hold.release();await expect.poll(()=>hold.reads.length).toBe(2);
      await expect(h.post.getByText('正在載入留言…',{exact:true})).toHaveCount(0);
      await expect(h.like).toHaveAttribute('aria-pressed',String(desired));expect(new Set(hold.reads).size).toBe(1);
      const states=await h.like.evaluate(node=>{const probe=(node as unknown as {readProbe:{values:(string|null)[];observer:MutationObserver}}).readProbe;probe.observer.disconnect();return probe.values;});
      expect(states.every(value=>value===String(desired))).toBe(true);
      await expect(h.post.getByRole('textbox',{name:'寫留言',exact:true})).toHaveValue(draft);
      expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM community_social_comment_likes WHERE comment_id=$1 AND user_id=$2',[h.commentId,h.userId])).rows[0].n).toBe(desired?1:0);
    }finally{await hold.dispose();}
  }
  expect(writes.map(write=>write.body)).toEqual([{liked:true},{liked:false}]);expect(writes[0].key).not.toBe(writes[1].key);
});

test('fresh revalidation removes a comment hidden after its like ACK instead of resurrecting its snapshot',async({page,e2eAuthPool})=>{
  const h=await openComment(page,e2eAuthPool),hold=await holdNextRead(page,h.postId);
  try{
    await h.toggle.click();await h.toggle.click();expect((await hold.snapshot).items).toHaveLength(1);
    await h.like.click();await expect(h.like).toHaveAttribute('aria-pressed','true');await expect(h.like).toBeEnabled();
    expect((await e2eAuthPool.query("UPDATE community_social_comments SET state='hidden' WHERE comment_id=$1",[h.commentId])).rowCount).toBe(1);
    hold.release();await expect.poll(()=>hold.reads.length).toBe(2);await expect(h.comment).toHaveCount(0);
    await expect(h.post.getByText('正在載入留言…',{exact:true})).toHaveCount(0);expect(new Set(hold.reads).size).toBe(1);
  }finally{await hold.dispose();}
});
