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
async function openBookmark(control:ReturnType<Page['locator']>) {
  const menu=control.locator('..').locator('..');
  await menu.locator(':scope > summary').click();
  await control.locator('summary').click();
}
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
  await openBookmark(control);
  await expect(control.getByRole('button',{name:'儲存私人書籤',exact:true})).toBeVisible();expect(posts).toBe(0);
  expect(reads).toEqual([`${endpoint}/post/${id}`]);
  await control.getByRole('button',{name:'儲存私人書籤',exact:true}).click();
  await expect(control.getByRole('button',{name:'移除書籤',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.reload();await openBookmark(control);
  await expect(control.getByRole('button',{name:'移除書籤',exact:true})).toBeVisible();
  await signOut(page);await login(page,'reviewer@local.test');await openBookmark(control);
  const readerMenu=control.locator('..').locator('..');
  for(const name of ['編輯','刪除','隱藏'])await expect(readerMenu.getByRole('button',{name,exact:true})).toHaveCount(0);
  await expect(control.getByRole('button',{name:'儲存私人書籤',exact:true})).toHaveAttribute('aria-pressed','false');
  await signOut(page);await login(page,bookmarkAccount.email);await openBookmark(control);
  await control.getByRole('button',{name:'移除書籤',exact:true}).click();
  await expect(control.getByRole('button',{name:'儲存私人書籤',exact:true})).toBeVisible();
  await page.reload();await openBookmark(control);
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


test('bookmark stays in options, closes without mutation, and returns keyboard focus',async({page,bookmarkAccount})=>{
  const {control}=await createPost(page,bookmarkAccount.email);
  const card=control.locator('xpath=ancestor::article[contains(@class,"social-card")]');
  const menu=card.locator('.social-post-menu');
  let writes=0;page.on('request',r=>{if(new URL(r.url()).pathname===endpoint&&r.method()==='POST')writes++;});
  await expect(control).toBeHidden();
  await expect(card.locator('.social-card-body > .social-post-bookmark')).toHaveCount(0);
  await openBookmark(control);
  await expect(control.getByRole('button',{name:'儲存私人書籤',exact:true})).toBeVisible();
  await control.getByRole('button',{name:'儲存私人書籤',exact:true}).focus();
  await page.keyboard.press('Escape');
  await expect(control).not.toHaveAttribute('open','');
  await expect(control.locator('summary')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).not.toHaveAttribute('open','');
  await expect(menu.locator(':scope > summary')).toBeFocused();
  await openBookmark(control);
  await page.locator('.social-feed-heading').first().click({position:{x:4,y:4}});
  await expect(menu).not.toHaveAttribute('open','');
  await expect(control).not.toHaveAttribute('open','');
  expect(writes).toBe(0);
});

test('unknown bookmark write survives options dismissal and retries the same intent',async({page,bookmarkAccount})=>{
  const {control}=await createPost(page,bookmarkAccount.email);
  const menu=control.locator('..').locator('..');
  const writes:{key:string|null;body:unknown}[]=[];
  await page.route(`**${endpoint}`,async route=>{
    if(route.request().method()!=='POST'){await route.continue();return;}
    writes.push({key:route.request().headers()['idempotency-key']??null,body:route.request().postDataJSON()});
    if(writes.length===1)await route.abort('failed');else await route.continue();
  });
  await openBookmark(control);
  await control.getByRole('button',{name:'儲存私人書籤',exact:true}).click();
  await expect(control.getByRole('alert')).toBeVisible();
  await menu.locator(':scope > summary').click();
  await openBookmark(control);
  await control.getByRole('button',{name:'重試儲存私人書籤',exact:true}).click();
  await expect(control.getByRole('button',{name:'移除書籤',exact:true})).toBeVisible();
  expect(writes).toHaveLength(2);expect(writes[0].key).toBeTruthy();expect(writes[1]).toEqual(writes[0]);
});


test('bookmark options retain readable contrast and touch targets in light and dark themes',async({page,bookmarkAccount})=>{
  const {control}=await createPost(page,bookmarkAccount.email);
  await openBookmark(control);
  await expect(control.getByRole('button',{name:'儲存私人書籤',exact:true})).toBeVisible();
  for(const theme of ['light','dark','versefolk']){
    await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
    for(const target of [control.locator('summary'),control.getByRole('button',{name:'儲存私人書籤',exact:true})]){
      await target.scrollIntoViewIfNeeded();
      const metrics=await target.evaluate(element=>{
        const style=getComputedStyle(element),rect=element.getBoundingClientRect();
        const luminance=(color:string)=>{
          const rgb=color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(x=>{const s=x/255;return s<=0.04045?s/12.92:((s+0.055)/1.055)**2.4;});
          return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;
        };
        const a=luminance(style.color),b=luminance(style.backgroundColor);
        let insideScrollports=true;
        for(let parent=element.parentElement;parent;parent=parent.parentElement){
          const css=getComputedStyle(parent),bounds=parent.getBoundingClientRect();
          if(/auto|scroll|hidden|clip/.test(css.overflowY)&& (rect.top<bounds.top||rect.bottom>bounds.bottom))insideScrollports=false;
          if(/auto|scroll|hidden|clip/.test(css.overflowX)&& (rect.left<bounds.left||rect.right>bounds.right))insideScrollports=false;
        }
        return {contrast:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05),height:rect.height,insideScrollports,unclipped:element.contains(document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2))};
      });
      expect(metrics.contrast,`${theme} contrast`).toBeGreaterThanOrEqual(4.5);expect(metrics.height,`${theme} touch height`).toBeGreaterThanOrEqual(44);expect(metrics.unclipped,`${theme} target stays inside visible viewport`).toBe(true);
      expect(metrics.insideScrollports,`${theme} target is not clipped by a scrolling ancestor`).toBe(true);
    }
  }
});

test('post options fit the visible viewport after resize and scroll without trapping keyboard focus',async({page,bookmarkAccount})=>{
  const {control}=await createPost(page,bookmarkAccount.email),menu=control.locator('..').locator('..');
  await openBookmark(control);
  const save=control.getByRole('button',{name:'儲存私人書籤',exact:true});
  await expect(save).toBeVisible();
  for(const size of [{width:1280,height:720},{width:390,height:420},{width:390,height:844}]){
    await page.setViewportSize(size);
    await menu.scrollIntoViewIfNeeded();
    // Resizing may move the trigger entirely off-screen, which intentionally closes it.
    if(!await menu.evaluate(element=>(element as HTMLDetailsElement).open))await openBookmark(control);
    await expect(save).toBeVisible();
    const panel=menu.locator(':scope > .social-post-menu-actions');
    await expect.poll(async()=>panel.evaluate(element=>{
      const rect=element.getBoundingClientRect(),header=document.querySelector('.community-header')!.getBoundingClientRect();
      return rect.top>=Math.max(0,header.bottom)&&rect.bottom<=window.innerHeight;
    })).toBe(true);
    // Native keyboard scrolling must bring the actual action into the scrollport.
    await control.locator('summary').focus();await page.keyboard.press('Tab');await expect(save).toBeFocused();
    await expect.poll(async()=>save.evaluate(element=>{
      const rect=element.getBoundingClientRect();return element.contains(document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2));
    })).toBe(true);
  }
  await page.keyboard.press('Escape');await expect(control).not.toHaveAttribute('open','');
  await expect(control.locator('summary')).toBeFocused();
  await page.keyboard.press('Escape');await expect(menu).not.toHaveAttribute('open','');
  await expect(menu.locator(':scope > summary')).toBeFocused();
});


test('pending write remains disabled after options reopen; late ACK requires same-intent reconciliation',async({page,bookmarkAccount})=>{
  const {control}=await createPost(page,bookmarkAccount.email),menu=control.locator('..').locator('..');
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const writes:{key:string|null;body:unknown}[]=[];
  await page.route(`**${endpoint}`,async route=>{
    if(route.request().method()!=='POST'){await route.continue();return;}
    writes.push({key:route.request().headers()['idempotency-key']??null,body:route.request().postDataJSON()});
    if(writes.length!==1){await route.continue();return;}
    const response=await route.fetch();await gate;await route.fulfill({response});
  });
  await openBookmark(control);
  await control.getByRole('button',{name:'儲存私人書籤',exact:true}).click();
  try{
    await expect(control.getByRole('button',{name:'正在儲存…',exact:true})).toBeDisabled();
    await menu.locator(':scope > summary').click();await openBookmark(control);
    await expect(control.getByRole('button',{name:'正在儲存…',exact:true})).toBeDisabled();
    expect(writes).toHaveLength(1);
  }finally{release();}
  await expect(control.getByRole('button',{name:'重試儲存私人書籤',exact:true})).toBeEnabled();
  await control.getByRole('button',{name:'重試儲存私人書籤',exact:true}).click();
  await expect(control.getByRole('button',{name:'移除書籤',exact:true})).toBeVisible();
  expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);
  await control.getByRole('button',{name:'移除書籤',exact:true}).focus();await page.keyboard.press('Tab');
  await expect(menu).not.toHaveAttribute('open','');
});
