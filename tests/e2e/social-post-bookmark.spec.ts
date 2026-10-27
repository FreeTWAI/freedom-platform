import {randomUUID} from 'node:crypto';
import {test as base, expect, type Page} from './fixtures.js';
import {DEMO_COMMUNITY, DEMO_USERS} from '../../packages/testing/seed.js';
import {e2eSchema} from '../../packages/testing/e2e-auth-isolation.js';
import {navigate, signOut} from './navigation.js';

type BookmarkAccount = {id:string;email:string};
const test=base.extend<{bookmarkAccount:BookmarkAccount}>({
  bookmarkAccount:async({e2eAuthPool,page},use)=>{
    // The shared maker is used by other journeys. Never spend its daily post quota.
    const schema=e2eSchema(process.env.FREEDOM_E2E_SCHEMA);
    const account={id:randomUUID(),email:`bookmark-${randomUUID()}@example.test`};
    const setup=await e2eAuthPool.connect();let makerPosts=0;
    try{
      await setup.query('BEGIN');
      expect((await setup.query('SELECT current_schema() AS schema')).rows[0].schema).toBe(schema);
      makerPosts=(await setup.query('SELECT count(*)::int AS n FROM community_social_posts WHERE author_user_id=$1',[DEMO_USERS[0].user_id])).rows[0].n;
      const inserted=await setup.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,onboarding_required,email_verified_at)
        SELECT $1,$2,$3,'私人書籤合成會員',password_hash,$4,false,now() FROM users WHERE user_id=$5`,
        [account.id,DEMO_COMMUNITY,account.email,randomUUID(),DEMO_USERS[0].user_id]);
      expect(inserted.rowCount).toBe(1);
      await setup.query(`INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state,member_tier)
        VALUES($1,$2,$3,'guild_ai_vibe','active','full')`,[randomUUID(),DEMO_COMMUNITY,account.id]);
      await setup.query('COMMIT');
    }catch(error){await setup.query('ROLLBACK');throw error;}finally{setup.release();}
    try{await use(account);}finally{
      // Stop this case's browser first; cleanup touches only its newly minted owner.
      if(!page.isClosed())await page.close();
      const cleanup=await e2eAuthPool.connect();
      try{
        await cleanup.query('BEGIN');
        expect((await cleanup.query('SELECT current_schema() AS schema')).rows[0].schema).toBe(schema);
        await cleanup.query('DELETE FROM community_content_bookmarks WHERE owner_user_id=$1 AND community_id=$2',[account.id,DEMO_COMMUNITY]);
        await cleanup.query('DELETE FROM community_social_posts WHERE author_user_id=$1 AND community_id=$2',[account.id,DEMO_COMMUNITY]);
        await cleanup.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1',[account.id]);
        await cleanup.query("UPDATE positioning_profession_memberships SET state='left' WHERE user_id=$1 AND community_id=$2",[account.id,DEMO_COMMUNITY]);
        await cleanup.query('UPDATE users SET active=false WHERE user_id=$1 AND community_id=$2 AND email=$3',[account.id,DEMO_COMMUNITY,account.email]);
        expect((await cleanup.query('SELECT count(*)::int AS n FROM community_social_posts WHERE author_user_id=$1',[DEMO_USERS[0].user_id])).rows[0].n).toBe(makerPosts);
        await cleanup.query('COMMIT');
        // Account and audit rows remain only in the run-specific schema, which the runner drops.
      }catch(error){await cleanup.query('ROLLBACK');throw error;}finally{cleanup.release();}
    }
  },
});

const endpoint='/api/v1/community-relations/bookmarks';
async function login(page:Page,email:string) {
  await page.goto('/');
  await page.getByLabel('電子郵件',{exact:true}).fill(email);
  await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  await page.getByRole('button',{name:'登入',exact:true}).click();
  await expect(page.locator('.shell')).toBeVisible();
  await navigate(page,'社群分享');
}
async function createPost(page:Page,email:string) {
  await login(page,email);
  const text=`私人書籤測試 ${Date.now()}`;
  await page.getByRole('button',{name:'建立貼文',exact:true}).click();
  await page.getByLabel('貼文內容',{exact:true}).fill(text);
  await page.getByRole('button',{name:'發布貼文',exact:true}).click();
  const card=page.locator('.social-card').filter({has:page.locator('.social-note').filter({hasText:text})});
  await expect(card).toBeVisible();
  const id=(await card.getAttribute('id'))!.replace('social-post-','');
  return {id,text,control:page.locator(`.social-post-bookmark[data-post-id="${id}"]`)};
}

test('private post bookmark saves only explicitly, persists and is isolated from another member',async({page,bookmarkAccount})=>{
  let posts=0;page.on('request',r=>{if(new URL(r.url()).pathname===endpoint&&r.method()==='POST')posts++;});
  const reads:string[]=[];page.on('request',r=>{if(r.method()==='GET'&&r.url().includes('/community-relations/'))reads.push(new URL(r.url()).pathname);});
  const {id,control}=await createPost(page,bookmarkAccount.email);expect(reads).toEqual([]);
  await control.locator('summary').click();
  await expect(control.getByRole('button',{name:'儲存私人書籤',exact:true})).toBeVisible();expect(posts).toBe(0);
  expect(reads).toEqual([`${endpoint}/post/${id}`]);
  await control.getByRole('button',{name:'儲存私人書籤',exact:true}).click();
  await expect(control.getByRole('button',{name:'移除書籤',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.reload();await control.locator('summary').click();
  await expect(control.getByRole('button',{name:'移除書籤',exact:true})).toBeVisible();
  await signOut(page);await login(page,'reviewer@local.test');await control.locator('summary').click();
  await expect(control.getByRole('button',{name:'儲存私人書籤',exact:true})).toHaveAttribute('aria-pressed','false');
  await signOut(page);await login(page,bookmarkAccount.email);await control.locator('summary').click();
  await control.getByRole('button',{name:'移除書籤',exact:true}).click();
  await expect(control.getByRole('button',{name:'儲存私人書籤',exact:true})).toBeVisible();
  await page.reload();await control.locator('summary').click();
  await expect(control.getByRole('button',{name:'儲存私人書籤',exact:true})).toBeVisible();expect(posts).toBe(2);
});

test('each existing site gate independently hides private bookmark controls without reading relations',async({page,bookmarkAccount})=>{
  const {control}=await createPost(page,bookmarkAccount.email);let requests=0;
  page.on('request',r=>{if(r.url().includes('/community-relations/'))requests++;});
  for(const flag of ['community_search_enabled','community_relations_enabled']){
    await page.route('**/api/v1/site',async route=>{const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),[flag]:false}});});
    await page.reload();await expect(page.locator('.social-card').first()).toBeVisible();await expect(control).toHaveCount(0);
    await page.unroute('**/api/v1/site');
  }
  expect(requests).toBe(0);
});
