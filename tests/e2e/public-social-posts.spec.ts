import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {test as base,expect,type BrowserContext,type Page} from './fixtures.js';
import {DEMO_COMMUNITY,DEMO_PASSWORD,DEMO_USERS} from '../../packages/testing/seed.js';
import {e2eOrigin} from '../../packages/testing/e2e-origin.js';

type SharingState={enabled:boolean;available:boolean;post_revision:number;media_version:string;version:string;public_path:string|null;image_url:string|null};
type CreatedPost={post_id:string;revision:number;note:string;thumbnail_url:string|null};
type Author={id:string;email:string;name:string;context:BrowserContext;page:Page;csrf:string};

// SQL is confined to identity setup and explicit moderation/account fixtures.
// Publication, edits, withdrawal, authentication, media reads and browser
// navigation use HTTP. The harness owns and drops the entire synthetic schema.
const test=base.extend<{author:Author}>({
  author:async({browser,e2eAuthPool},use)=>{
    const id=randomUUID(),email=`public-post-${id}@example.test`,name=`合成分享作者 ${id.slice(0,8)}`;
    await e2eAuthPool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,onboarding_required)
      SELECT $1,$2,$3,$4,password_hash,$5,false FROM users WHERE user_id=$6`,
    [id,DEMO_COMMUNITY,email,name,randomUUID(),DEMO_USERS[0].user_id]);
    const context=await browser.newContext({baseURL:e2eOrigin()}),page=await context.newPage();
    try{
      const response=await context.request.post('/api/v1/auth/login',{headers:{Origin:e2eOrigin()},data:{email,password:DEMO_PASSWORD}});
      expect(response.status(),await response.text()).toBe(200);
      const session=await response.json();
      await use({id,email,name,context,page,csrf:session.csrf_token});
    }finally{
      await context.close();
      // Keep each synthetic author's posts out of later public and member
      // feeds. The schema teardown removes their rows and command receipts.
      await e2eAuthPool.query("UPDATE community_social_posts SET state='hidden' WHERE author_user_id=$1 AND state='active'",[id]);
      await e2eAuthPool.query('UPDATE users SET active=false WHERE user_id=$1',[id]);
    }
  },
});

function headers(author:Author,version?:string){
  return {Origin:e2eOrigin(),'X-CSRF-Token':author.csrf,'Idempotency-Key':randomUUID(),...(version===undefined?{}:{'If-Match':`"${version}"`})};
}
async function createPost(author:Author,text:string,image=false,metadata:Record<string,unknown>={}):Promise<CreatedPost>{
  const bytes=image?await sharp({create:{width:480,height:300,channels:3,background:'#728a41'}}).png().toBuffer():null;
  const response=await author.context.request.post('/api/v1/social-posts/notes',{headers:headers(author),data:{text,...metadata,...(bytes?{image:{mime_type:'image/png',data_base64:bytes.toString('base64')}}:{})}});
  expect(response.status(),await response.text()).toBe(201);
  return response.json();
}
async function sharing(author:Author,id:string):Promise<SharingState>{
  const response=await author.context.request.get(`/api/v1/social-posts/${id}/public-sharing`);
  expect(response.status(),await response.text()).toBe(200);
  return response.json();
}
async function setSharing(author:Author,id:string,enabled:boolean):Promise<SharingState>{
  const state=await sharing(author,id);
  const response=await author.context.request.post(`/api/v1/social-posts/${id}/public-sharing`,{
    headers:headers(author,state.version),data:{enabled,post_revision:state.post_revision,media_version:state.media_version},
  });
  expect(response.status(),await response.text()).toBe(200);
  return response.json();
}
const publicPath=(id:string)=>`/posts/${id}`;
const publicApi=(id:string)=>`/api/v1/public/shared-posts/${id}`;
const loginPath=(id:string,join=false)=>`/?post_return=${id}${join?'&join=1':''}#account`;
const publicArticle=(page:Page)=>page.locator('article[data-public-post]');
async function signInForm(page:Page,email:string){
  await page.getByLabel('電子郵件',{exact:true}).fill(email);
  await page.getByLabel('密碼',{exact:true}).fill(DEMO_PASSWORD);
  await page.getByRole('button',{name:'登入',exact:true}).click();
}
async function assertUnavailable(page:Page,id:string,privateText:string){
  const response=await page.goto(e2eOrigin()+publicPath(id));
  expect(response?.status()).toBe(404);
  await expect(publicArticle(page)).toHaveCount(0);
  expect(await page.content()).not.toContain(privateText);
  expect((await page.request.get(publicApi(id))).status()).toBe(404);
  expect((await page.request.get(publicApi(id)+'/image')).status()).toBe(404);
}

test('PUBLIC-POST-01 author explicitly opens one version; anonymous no-JS readers see its full text and image without member metadata',async({author,browser})=>{
  const body=`公開閱讀 ${randomUUID()} @${DEMO_USERS[1].display_name}\n${'這篇文字應該完整呈現。'.repeat(60)}\n最後一行仍可閱讀 <img src=x onerror=alert(1)>`;
  const privateLocation=`私人打卡-${randomUUID()}`,privateComment=`會員留言-${randomUUID()}`;
  const post=await createPost(author,body,true,{location_name:privateLocation,mention_ids:[DEMO_USERS[1].user_id]});
  const comment=await author.context.request.post(`/api/v1/social-posts/${post.post_id}/comments`,{headers:headers(author),data:{text:privateComment}});
  expect(comment.status(),await comment.text()).toBe(201);
  const initial=await sharing(author,post.post_id);expect(initial).toMatchObject({enabled:false,available:false,version:'1',public_path:null});
  await author.page.goto(`/?social-post=${post.post_id}#social`);
  const card=author.page.locator(`#social-post-${post.post_id}`);await expect(card).toBeVisible();
  await card.getByRole('button',{name:'分享貼文連結',exact:true}).click();
  const dialog=author.page.getByRole('dialog',{name:'分享貼文連結',exact:true});
  await expect(dialog.getByRole('button',{name:'複製貼文連結',exact:true})).toBeEnabled();
  await expect(dialog.locator('.social-sharing-consent')).not.toHaveAttribute('open','');
  await dialog.locator('.social-sharing-consent > summary').click();
  await expect(dialog.getByRole('button',{name:'開放免登入閱讀',exact:true})).toBeVisible();
  const publication=author.page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===`/api/v1/social-posts/${post.post_id}/public-sharing`);
  await dialog.getByRole('button',{name:'開放免登入閱讀',exact:true}).click();expect((await publication).status()).toBe(200);
  await expect(dialog.getByLabel('貼文連結',{exact:true})).toHaveValue(e2eOrigin()+publicPath(post.post_id));
  expect(await sharing(author,post.post_id)).toMatchObject({enabled:true,available:true,version:'2',public_path:publicPath(post.post_id)});
  const anonymous=await browser.newContext({baseURL:e2eOrigin(),javaScriptEnabled:false}),reader=await anonymous.newPage();
  try{
    const response=await reader.goto(publicPath(post.post_id));expect(response?.status()).toBe(200);expect(response?.headers()['cache-control']).toContain('no-store');
    await expect(publicArticle(reader)).toContainText(body);await expect(publicArticle(reader)).toContainText(author.name);
    await expect(reader.locator('img[src="x"]')).toHaveCount(0);
    const photo=reader.getByAltText('貼文附圖',{exact:true});await expect(photo).toBeVisible();expect(await photo.evaluate(node=>(node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const imageResponse=await reader.request.get(publicApi(post.post_id)+'/image');expect(imageResponse.status()).toBe(200);expect(imageResponse.headers()['content-type']).toContain('image/webp');expect(imageResponse.headers()['cache-control']).toContain('no-store');
    const data=await (await reader.request.get(publicApi(post.post_id))).json();
    expect(data.post).toMatchObject({post_id:post.post_id,note:body,author:{display_name:author.name},image_url:publicApi(post.post_id)+'/image'});
    expect(Object.keys(data.post.author)).toEqual(['display_name']);
    for(const key of ['mentions','location_name','avatar_url','liked','mine','my_points','read_count','comments'])expect(data.post).not.toHaveProperty(key);
    for(const secret of [author.id,author.email,DEMO_USERS[1].user_id,privateLocation,privateComment]){expect(JSON.stringify(data)).not.toContain(secret);expect(await reader.content()).not.toContain(secret);}
    await expect(reader.locator(`a[href="${loginPath(post.post_id)}"]`).first()).toBeVisible();
  }finally{await anonymous.close();}
});

test('PUBLIC-POST-02 old member-only links and unavailable public pages never reveal a private post or its image',async({author,page})=>{
  const secret=`未公開正文-${randomUUID()}`,post=await createPost(author,secret,true);
  await assertUnavailable(page,post.post_id,secret);
  const writes:string[]=[];page.on('request',request=>{if(request.method()!=='GET')writes.push(new URL(request.url()).pathname);});
  await page.goto(`/?social-post=${post.post_id}#social`);
  await expect(page).toHaveURL(e2eOrigin()+publicPath(post.post_id));
  await expect(publicArticle(page)).toHaveCount(0);expect(await page.content()).not.toContain(secret);
  await expect(page.locator(`a[href="/?social-post=${post.post_id}#account"]`)).toBeVisible();
  for(const path of [`/api/v1/social-posts?post_id=${post.post_id}`,`/api/v1/social-posts/${post.post_id}/comments`,`/api/v1/social-posts/${post.post_id}/likers`,post.thumbnail_url!])expect((await page.request.get(path)).status()).toBe(401);
  expect(writes.filter(path=>path.includes('/public-sharing'))).toEqual([]);
});

test('PUBLIC-POST-03 visitors receive at most three short public previews; opening more and member interactions require login',async({author,page})=>{
  const main=await createPost(author,`分享入口-${randomUUID()}`);await setSharing(author,main.post_id,true);
  for(let i=0;i<5;i++){const other=await createPost(author,`其他公開貼文 ${i}\n${'有限預覽。'.repeat(50)}ONLY_MEMBER_TAIL_${i}`);await setSharing(author,other.post_id,true);}
  const privatePost=await createPost(author,`不可出現在公開推薦-${randomUUID()}`);
  await page.goto(publicPath(main.post_id));const related=page.getByRole('region',{name:'更多工坊分享',exact:true});await expect(related).toBeVisible();
  await expect(related.locator('article')).toHaveCount(3);
  const response=await page.request.get(publicApi(main.post_id)+'?limit=100&cursor=ignored&offset=3');expect(response.status()).toBe(200);
  const data=await response.json();expect(data.related).toHaveLength(3);expect(data).not.toHaveProperty('next_cursor');
  for(const item of data.related){expect(item.summary.length).toBeLessThanOrEqual(160);expect(item).not.toHaveProperty('note');expect(item.post_id).not.toBe(main.post_id);expect(item.post_id).not.toBe(privatePost.post_id);}
  expect(JSON.stringify(data)).not.toContain('ONLY_MEMBER_TAIL_');
  const next=related.locator('a[href*="post_return="]').first(),href=await next.getAttribute('href');expect(href).toBeTruthy();
  const target=new URL(href!,e2eOrigin()).searchParams.get('post_return');expect(data.related.map((item:{post_id:string})=>item.post_id)).toContain(target);
  await next.click();await expect(page.getByLabel('電子郵件',{exact:true})).toBeVisible();await expect(publicArticle(page)).toHaveCount(0);
  await signInForm(page,author.email);await expect(page).toHaveURL(e2eOrigin()+publicPath(target!));await expect(publicArticle(page)).toBeVisible();
  await expect(page.getByRole('link',{name:'回原貼文提問與分享心得',exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'更多工坊分享',exact:true}).locator('a[href^="/posts/"]')).toHaveCount(3);
});

test('PUBLIC-POST-04 an existing member signs in and returns to the exact shared post, then opens its original discussion',async({author,page})=>{
  const text=`登入後繼續原篇-${randomUUID()}\n/development/skills/local-workspace-mcp`,post=await createPost(author,text);await setSharing(author,post.post_id,true);
  await page.goto(publicPath(post.post_id));await page.locator(`a[href="${loginPath(post.post_id)}"]`).first().click();
  await signInForm(page,author.email);await expect(page).toHaveURL(e2eOrigin()+publicPath(post.post_id));await expect(publicArticle(page)).toContainText(text);
  await expect(page.locator('.catalog-resource-link')).toHaveAttribute('href','/development/skills/local-workspace-mcp');
  const [onboarding]=await Promise.all([
    page.waitForResponse(response=>response.request().method()==='GET'&&new URL(response.url()).pathname==='/api/v1/me/onboarding'),
    page.getByRole('link',{name:'回原貼文提問與分享心得',exact:true}).click(),
  ]);expect(onboarding.status()).toBe(200);await onboarding.finished();
  await expect(page.locator(`#social-post-${post.post_id}`)).toBeVisible();await expect(page.locator('.social-card')).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get('social-post')).toBe(post.post_id);
});

test('PUBLIC-POST-05 signup returns to public reading before guild onboarding and keeps the private feed protected',async({author,page,e2eAuthPool})=>{
  const post=await createPost(author,`註冊後繼續原篇-${randomUUID()}`);await setSharing(author,post.post_id,true);
  const email=`post-reader-${randomUUID()}@example.test`;
  await page.goto(publicPath(post.post_id));await page.locator(`a[href="${loginPath(post.post_id,true)}"]`).first().click();
  await page.getByLabel('社群顯示名稱',{exact:true}).fill('合成新讀者');
  await page.getByLabel('電子郵件',{exact:true}).fill(email);await page.getByLabel('密碼',{exact:true}).fill(DEMO_PASSWORD);
  await page.getByRole('button',{name:'建立帳號，先逛工坊',exact:true}).click();
  await expect(page).toHaveURL(e2eOrigin()+publicPath(post.post_id));await expect(publicArticle(page)).toContainText(post.note);
  const row=(await e2eAuthPool.query('SELECT onboarding_required,onboarding_completed_at FROM users WHERE email=$1',[email])).rows[0];
  expect(row).toEqual({onboarding_required:true,onboarding_completed_at:null});
  expect((await page.request.get('/api/v1/social-posts')).status()).toBe(403);
  await expect(page.getByRole('heading',{name:'你喜歡怎麼做事？',exact:true})).toHaveCount(0);
});

test('PUBLIC-POST-06 closed registration metadata removes join controls and direct join URLs retain login and the reading return',async({author,page})=>{
  const post=await createPost(author,`暫停註冊仍可閱讀-${randomUUID()}`);await setSharing(author,post.post_id,true);
  // Client capability fixture only; server rejection is covered by the public
  // runtime tests. This local browser harness deliberately enables registration.
  await page.route('**/api/v1/site',async route=>{const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),registration_enabled:false}});});
  try{
    let registrations=0;page.on('request',request=>{if(new URL(request.url()).pathname==='/api/v1/auth/register')registrations++;});
    await page.goto(publicPath(post.post_id));await expect(publicArticle(page)).toContainText(post.note);
    await expect(page.locator('a[href*="join=1"]:visible')).toHaveCount(0);
    await page.goto(loginPath(post.post_id,true));await expect(page.getByRole('button',{name:'登入',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'建立帳號',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'建立帳號，先逛工坊',exact:true})).toHaveCount(0);
    await page.locator(`a[href="${publicPath(post.post_id)}"]`).click();await expect(publicArticle(page)).toContainText(post.note);expect(registrations).toBe(0);
  }finally{
    // The returned article is server-rendered before its site metadata settles.
    // Drain this page's only route before context teardown disposes its response.
    await page.unrouteAll({behavior:'wait'});
  }
});

test('PUBLIC-POST-07 editing invalidates consent; reopening the reviewed version and withdrawing update HTML, JSON, image and preview metadata',async({author,page})=>{
  const original=`原本公開-${randomUUID()}`,post=await createPost(author,original,true);await setSharing(author,post.post_id,true);
  await page.goto(publicPath(post.post_id));await expect(publicArticle(page)).toContainText(original);
  const changed=`修訂後須重新同意-${randomUUID()}`;
  const edited=await author.context.request.post(`/api/v1/social-posts/${post.post_id}/edit`,{headers:headers(author,String(post.revision)),data:{text:changed}});expect(edited.status(),await edited.text()).toBe(200);
  expect(await sharing(author,post.post_id)).toMatchObject({enabled:true,available:false});await assertUnavailable(page,post.post_id,changed);
  expect(await page.content()).not.toContain(original);
  await author.page.goto(`/?social-post=${post.post_id}#social`);await author.page.locator(`#social-post-${post.post_id}`).getByRole('button',{name:'分享貼文連結',exact:true}).click();
  const dialog=author.page.getByRole('dialog',{name:'分享貼文連結',exact:true});
  // The close control is already visible for invalidated consent (enabled=true).
  // Wait for this explicit publication's acknowledgment, not that stale control.
  const reopening=author.page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===`/api/v1/social-posts/${post.post_id}/public-sharing`);
  await dialog.locator('.social-sharing-consent > summary').click();
  await dialog.getByRole('button',{name:'重新開放目前版本',exact:true}).click();
  const reopened=await reopening;expect(reopened.status()).toBe(200);
  expect(await reopened.json()).toMatchObject({enabled:true,available:true,post_revision:post.revision+1,public_path:publicPath(post.post_id)});
  await expect(dialog.getByLabel('貼文連結',{exact:true})).toHaveValue(e2eOrigin()+publicPath(post.post_id));
  await expect(dialog.getByRole('button',{name:'關閉免登入閱讀',exact:true})).toBeVisible();
  await page.goto(publicPath(post.post_id));await expect(publicArticle(page)).toContainText(changed);await expect(page.getByAltText('貼文附圖',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'關閉免登入閱讀',exact:true}).click();await expect(dialog.getByRole('button',{name:'開放免登入閱讀',exact:true})).toBeVisible();
  await assertUnavailable(page,post.post_id,changed);expect(await page.content()).not.toContain(publicApi(post.post_id)+'/image');
});

test('PUBLIC-POST-08 hidden, deleted and deactivated-author posts stop all public text and image reads',async({author,page,e2eAuthPool})=>{
  const hidden=await createPost(author,`被隱藏-${randomUUID()}`,true);await setSharing(author,hidden.post_id,true);
  // Moderation is tested through its own admin journeys. This fixture changes
  // the stored decision to verify the anonymous consumer's current-state fence.
  await e2eAuthPool.query("UPDATE community_social_posts SET state='hidden' WHERE post_id=$1",[hidden.post_id]);await assertUnavailable(page,hidden.post_id,hidden.note);
  const deleted=await createPost(author,`被作者刪除-${randomUUID()}`,true);await setSharing(author,deleted.post_id,true);
  const removal=await author.context.request.delete(`/api/v1/social-posts/${deleted.post_id}`,{headers:headers(author),data:{}});expect(removal.status(),await removal.text()).toBe(200);await assertUnavailable(page,deleted.post_id,deleted.note);
  const inactive=await createPost(author,`作者已停用-${randomUUID()}`,true);await setSharing(author,inactive.post_id,true);
  await e2eAuthPool.query('UPDATE users SET active=false WHERE user_id=$1',[author.id]);await assertUnavailable(page,inactive.post_id,inactive.note);
});

test('PUBLIC-POST-09 cancelling the share dialog and native handoff never opts a post into public reading or publishes a second post',async({author})=>{
  const post=await createPost(author,`分享取消-${randomUUID()}`),before=await sharing(author,post.post_id);
  await author.page.addInitScript(()=>{
    const control={calls:[] as {data:ShareData;active:boolean}[],copies:0};Object.assign(window,{publicPostShareControl:control});
    Object.defineProperty(navigator,'share',{configurable:true,value:(data:ShareData)=>{control.calls.push({data,active:navigator.userActivation.isActive});return Promise.reject(new DOMException('cancelled','AbortError'));}});
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{control.copies++;}}});
  });
  await author.page.goto(`/?social-post=${post.post_id}#social`);
  const writes:string[]=[];author.page.on('request',request=>{if(request.method()==='POST'&&/\/(?:public-sharing|promotion\/links|social-posts\/notes)$/.test(new URL(request.url()).pathname))writes.push(new URL(request.url()).pathname);});
  const trigger=author.page.locator(`#social-post-${post.post_id}`).getByRole('button',{name:'分享貼文連結',exact:true});await trigger.click();
  const dialog=author.page.getByRole('dialog',{name:'分享貼文連結',exact:true});await expect(dialog).toBeVisible();await author.page.keyboard.press('Escape');await expect(trigger).toBeFocused();
  await trigger.click();await dialog.getByRole('button',{name:'系統分享',exact:true}).click();
  await expect.poll(()=>author.page.evaluate(()=>(window as unknown as {publicPostShareControl:{calls:unknown[]}}).publicPostShareControl.calls.length)).toBe(1);
  const control=await author.page.evaluate(()=>(window as unknown as {publicPostShareControl:{calls:{data:ShareData;active:boolean}[];copies:number}}).publicPostShareControl);
  expect(control.calls[0]).toEqual({data:{title:'自由工坊的貼文',url:`${e2eOrigin()}/?social-post=${post.post_id}#social`},active:true});expect(control.copies).toBe(0);expect(writes).toEqual([]);expect(await sharing(author,post.post_id)).toEqual(before);
});

test('PUBLIC-POST-10 public resources fit short mobile and desktop viewports in all three themes with keyboard return',async({author,page},testInfo)=>{
  const text=`手機閱讀-${randomUUID()}\n${'一段很長但仍然要換行的公開貼文'.repeat(35)}\n/development/skills/local-workspace-mcp\n/development/skills/editkin\n/development/skills/positioning-companion`,post=await createPost(author,text,true);await setSharing(author,post.post_id,true);
  for(const theme of ['light','dark','versefolk']){
    await page.addInitScript(value=>localStorage.setItem('freedom-theme',value),theme);
    for(const width of [320,390,1280]){
      await page.setViewportSize({width,height:420});await page.goto(publicPath(post.post_id));await expect(publicArticle(page)).toContainText(text);
      await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await expect(page.locator('img[src="/brand/freedom-workshop.webp"]')).toBeVisible();
      await expect(page.locator('.catalog-resource-link')).toHaveCount(3);
      const controls=page.locator('a[href*="post_return="]:visible,.catalog-resource-link');expect(await controls.count()).toBeGreaterThan(0);
      for(const control of await controls.all())expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({path:testInfo.outputPath(`public-post-${theme}-${width}.png`),fullPage:true});
    }
  }
  const resource=page.locator('.catalog-resource-link').first();await resource.focus();await expect(resource).toBeFocused();await page.keyboard.press('Enter');
  await expect(page).toHaveURL(e2eOrigin()+'/development/skills/local-workspace-mcp');
  await page.goBack();await expect(page).toHaveURL(e2eOrigin()+publicPath(post.post_id));await expect(page.locator('.catalog-resource-link')).toHaveCount(3);
  const login=page.locator(`a[href="${loginPath(post.post_id)}"]`).first();await login.focus();await expect(login).toBeFocused();await page.keyboard.press('Enter');
  await expect(page.getByLabel('電子郵件',{exact:true})).toBeVisible();await expect(page.locator(`a[href="${publicPath(post.post_id)}"]`)).toBeVisible();
  await page.goBack();await expect(page).toHaveURL(e2eOrigin()+publicPath(post.post_id));await expect(publicArticle(page)).toContainText(text);
});

test('PUBLIC-POST-11 returning to an open page refreshes revised text, author and related previews; withdrawal removes its text and OG',async({author,page})=>{
  const original=`切回分頁前-${randomUUID()}\n/development/skills/local-workspace-mcp`,post=await createPost(author,original,true);await setSharing(author,post.post_id,true);
  const previous=await createPost(author,`原本相關分享-${randomUUID()}`);await setSharing(author,previous.post_id,true);
  await page.goto(publicPath(post.post_id));await page.bringToFront();await expect(publicArticle(page)).toContainText(original);
  const firstVersion=await publicArticle(page).getAttribute('data-public-version');expect(firstVersion).toMatch(/^[0-9a-f]{64}$/);
  await expect(page.locator('.catalog-resource-link')).toHaveAttribute('href','/development/skills/local-workspace-mcp');
  await expect(page.getByRole('region',{name:'更多工坊分享',exact:true})).toContainText(previous.note);

  const revised=`回來就看到修訂-${randomUUID()}\n/development/skills/editkin`,renamed=`更新後作者 ${randomUUID().slice(0,8)}`;
  const edit=await author.context.request.post(`/api/v1/social-posts/${post.post_id}/edit`,{headers:headers(author,String(post.revision)),data:{text:revised}});expect(edit.status(),await edit.text()).toBe(200);
  await setSharing(author,post.post_id,true);
  const profileResponse=await author.context.request.get('/api/v1/me/account');expect(profileResponse.status()).toBe(200);
  const profile=await profileResponse.json();
  const contacts=Object.fromEntries(Object.entries(profile.contacts as Record<string,{value:string;audiences:string[]}>).map(([key,value])=>[key,key==='email'?{audiences:value.audiences}:{value:value.value,audiences:value.audiences}]));
  const rename=await author.context.request.post('/api/v1/me/account',{headers:headers(author,String(profile.aggregate_version)),data:{nickname:renamed,identity_label:profile.identity_label,contacts}});expect(rename.status(),await rename.text()).toBe(200);
  await setSharing(author,previous.post_id,false);
  const replacement=await createPost(author,`最新相關分享-${randomUUID()}`);await setSharing(author,replacement.post_id,true);
  // No reload or navigation from the test: a real lifecycle listener must
  // compare the server projection and replace this already-open document.
  await expect(publicArticle(page)).toContainText(original);
  const refreshed=page.waitForResponse(response=>response.request().isNavigationRequest()&&new URL(response.url()).pathname===publicPath(post.post_id));
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));expect((await refreshed).status()).toBe(200);
  await expect(publicArticle(page)).toContainText(revised);await expect(publicArticle(page)).toContainText(renamed);
  await expect(page.locator('.catalog-resource-link')).toHaveAttribute('href','/development/skills/editkin');
  await expect(publicArticle(page)).not.toContainText(original);await expect(publicArticle(page)).not.toHaveAttribute('data-public-version',firstVersion!);
  const related=page.getByRole('region',{name:'更多工坊分享',exact:true});await expect(related).toContainText(replacement.note);await expect(related).not.toContainText(previous.note);
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content',revised);

  await setSharing(author,post.post_id,false);
  const withdrawn=page.waitForResponse(response=>response.request().isNavigationRequest()&&new URL(response.url()).pathname===publicPath(post.post_id));
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));expect((await withdrawn).status()).toBe(404);
  await expect(publicArticle(page)).toHaveCount(0);await expect(page.getByRole('heading',{name:'目前無法閱讀這則貼文',exact:true})).toBeVisible();
  await expect(page.locator('.catalog-resources')).toHaveCount(0);
  await expect(page.locator('meta[property^="og:"]')).toHaveCount(0);
  const unavailable=await page.content();for(const value of [original,revised,renamed,replacement.note,publicApi(post.post_id)+'/image'])expect(unavailable).not.toContain(value);
  expect((await page.request.get(publicApi(post.post_id))).status()).toBe(404);expect((await page.request.get(publicApi(post.post_id)+'/image')).status()).toBe(404);
});

test('PUBLIC-POST-12 a malformed successful sharing acknowledgment retains the exact command until its single publication is confirmed',async({author,e2eAuthPool})=>{
  const post=await createPost(author,`公開設定回應須確認-${randomUUID()}`),path=`/api/v1/social-posts/${post.post_id}/public-sharing`;
  const attempts:{key:string;version:string;body:string|null}[]=[];
  await author.page.route(`**${path}`,async route=>{
    const request=route.request();if(request.method()!=='POST'){await route.continue();return;}
    attempts.push({key:request.headers()['idempotency-key'],version:request.headers()['if-match'],body:request.postData()});
    const response=await route.fetch();expect(response.status()).toBe(200);
    // The operation really commits. A missing ACK followed by a contradictory
    // complete ACK must both retry that operation instead of creating one.
    const invalid=attempts.length===1?{}:attempts.length===2?{...await response.json(),available:false,public_path:null}:null;
    await route.fulfill(invalid?{response,json:invalid}:{response});
  });
  await author.page.goto(`/?social-post=${post.post_id}#social`);
  await author.page.locator(`#social-post-${post.post_id}`).getByRole('button',{name:'分享貼文連結',exact:true}).click();
  const dialog=author.page.getByRole('dialog',{name:'分享貼文連結',exact:true});
  await dialog.locator('.social-sharing-consent > summary').click();
  await dialog.getByRole('button',{name:'開放免登入閱讀',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'確認上次設定',exact:true})).toBeEnabled();
  await expect(dialog.getByRole('alert')).toContainText('尚未確認公開設定是否已保存');
  for(const message of ['已關閉免登入閱讀。','已開放免登入閱讀，可以分享連結了。'])await expect(dialog.getByText(message,{exact:true})).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:'複製貼文連結',exact:true})).toBeDisabled();
  expect(attempts).toHaveLength(1);expect(attempts[0].key).toBeTruthy();expect(attempts[0].version).toBe('"1"');
  expect(JSON.parse(attempts[0].body!)).toMatchObject({enabled:true,post_revision:post.revision,media_version:'1'});
  expect(await sharing(author,post.post_id)).toMatchObject({enabled:true,available:true,version:'2'});
  expect((await author.context.request.get(publicApi(post.post_id))).status()).toBe(200);
  await dialog.getByRole('button',{name:'確認上次設定',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'確認上次設定',exact:true})).toBeEnabled();
  await expect(dialog.getByRole('alert')).toContainText('尚未確認公開設定是否已保存');
  for(const message of ['已關閉免登入閱讀。','已開放免登入閱讀，可以分享連結了。'])await expect(dialog.getByText(message,{exact:true})).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:'複製貼文連結',exact:true})).toBeDisabled();
  expect(attempts).toHaveLength(2);expect(attempts[1]).toEqual(attempts[0]);
  await dialog.getByRole('button',{name:'確認上次設定',exact:true}).click();
  await expect(dialog.getByRole('status')).toHaveText('已開放免登入閱讀，可以分享連結了。');
  await expect(dialog.getByRole('button',{name:'關閉免登入閱讀',exact:true})).toBeEnabled();
  await expect(dialog.getByLabel('貼文連結',{exact:true})).toHaveValue(e2eOrigin()+publicPath(post.post_id));
  expect(attempts).toHaveLength(3);for(const attempt of attempts)expect(attempt).toEqual(attempts[0]);
  expect(await sharing(author,post.post_id)).toMatchObject({enabled:true,available:true,version:'2'});
  expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM community_social_publications WHERE post_id=$1',[post.post_id])).rows[0].n).toBe(1);
  expect((await e2eAuthPool.query("SELECT count(*)::int AS n FROM transition_journal WHERE aggregate_type='social_post_publication' AND aggregate_id=$1",[post.post_id])).rows[0].n).toBe(1);
  expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM command_receipts WHERE operation=$1 AND idempotency_key=$2',[`POST ${path}`,attempts[0].key])).rows[0].n).toBe(1);
});

test('PUBLIC-POST-13 a delayed signed-in capability response cannot overwrite a newer signed-out reading state',async({author})=>{
  const post=await createPost(author,`登出後仍可閱讀-${randomUUID()}`);await setSharing(author,post.post_id,true);
  const related=await createPost(author,`登出後須先登入的其他篇-${randomUUID()}`);await setSharing(author,related.post_id,true);
  let reads=0,release!:()=>void,started!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;}),requested=new Promise<void>(resolve=>{started=resolve;});
  await author.page.bringToFront();
  await author.page.route('**/api/v1/session',async route=>{
    const sequence=++reads,response=await route.fetch();
    expect(response.status()).toBe(sequence===1?200:401);
    if(sequence===1){started();await pending;}
    await route.fulfill({response});
  });
  try{
    await author.page.goto(publicPath(post.post_id));await requested;
    await expect(publicArticle(author.page)).toContainText(post.note);
    await author.page.evaluate(()=>{
      const link=document.querySelector('[data-post-login]')!,changes:string[]=[];
      Object.assign(window,{publicCapabilityChanges:changes});
      new MutationObserver(()=>changes.push(link.textContent??'')).observe(link,{attributes:true,childList:true});
    });
    const logout=await author.context.request.post('/api/v1/auth/logout',{headers:headers(author),data:{}});
    expect(logout.status(),await logout.text()).toBe(200);
    expect((await author.context.request.get('/api/v1/session')).status()).toBe(401);
    const signedOut=author.page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/session'&&response.status()===401);
    await author.page.evaluate(()=>window.dispatchEvent(new Event('focus')));expect((await signedOut).status()).toBe(401);
    // This observes the newer capability update even though the SSR already
    // starts with a login invitation. No sleep or fabricated session is used.
    await expect.poll(()=>author.page.evaluate(()=>(window as any).publicCapabilityChanges.length)).toBeGreaterThan(0);
    expect(reads).toBe(2);
    const stale=author.page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/session'&&response.status()===200);
    release();expect(await (await stale).finished()).toBeNull();
    // After the old body arrives, allow the next browser paint to flush its
    // promise continuations and any attempted capability DOM updates.
    await author.page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));
    await expect(author.page.locator('[data-post-login]')).toHaveText('登入回原貼文交流');
    await expect(author.page.locator('[data-post-login]')).toHaveAttribute('href',loginPath(post.post_id));
    await expect(author.page.locator(`[data-related-post="${related.post_id}"]`)).toHaveAttribute('href',loginPath(related.post_id));
    await expect(author.page.locator('[data-post-join]')).toBeVisible();
    expect(await author.page.evaluate(()=>(window as any).publicCapabilityChanges)).not.toContain('回原貼文提問與分享心得');
    await expect(publicArticle(author.page)).toContainText(post.note);
  }finally{release();if(!author.page.isClosed())await author.page.unrouteAll({behavior:'wait'});}
});

test('PUBLIC-POST-14 no-JS visitors can read three known resources from public text, return, and see no invented empty shelf',async({author,browser})=>{
  const paths=['local-workspace-mcp','editkin','positioning-companion','freedom-party-guild-lounge'].map(id=>'/development/skills/'+id);
  // Node public-page metadata uses the configured canonical origin, not the fixture request Host.
  const note=`我的實作用法-${randomUUID()}\nhttps://freetwai.com${paths[0]}?intro=7\n${paths[0]}\n${paths.slice(1).join('\n')}\nhttps://elsewhere.test${paths[0]}\n${e2eOrigin()}@elsewhere.test${paths[0]}\n/development/skills/unknown-book`;
  const post=await createPost(author,note);await setSharing(author,post.post_id,true);
  const empty=await createPost(author,`分享心得但沒有技能連結-${randomUUID()}`);await setSharing(author,empty.post_id,true);
  const anonymous=await browser.newContext({baseURL:e2eOrigin(),javaScriptEnabled:false,viewport:{width:320,height:420}}),reader=await anonymous.newPage(),writes:string[]=[];
  reader.on('request',request=>{if(request.method()!=='GET')writes.push(request.url());});
  try{
    const response=await reader.goto(publicPath(post.post_id));expect(response?.status()).toBe(200);
    expect(response?.headers()['cache-control']).toContain('no-store');expect(response?.headers()['x-robots-tag']).toBe('noindex, nofollow');
    await expect(publicArticle(reader)).toContainText(note);await expect(publicArticle(reader)).toContainText(author.name);
    const resources=reader.getByRole('region',{name:'貼文提到的技能資源',exact:true});await expect(resources).toBeVisible();
    await expect(resources.locator('a')).toHaveCount(3);
    expect(await resources.locator('a').evaluateAll(links=>links.map(link=>link.getAttribute('href')))).toEqual(paths.slice(0,3));
    await expect(resources).toContainText('原作與授權見資源頁');
    await resources.locator('a').first().click();await expect(reader).toHaveURL(e2eOrigin()+paths[0]);
    await expect(reader.getByRole('heading',{name:'Local Workspace MCP 本機工作助手',exact:true})).toBeVisible();
    await reader.goBack();await expect(reader).toHaveURL(e2eOrigin()+publicPath(post.post_id));
    await expect(reader.locator('[data-post-login]')).toHaveAttribute('href',loginPath(post.post_id));
    await reader.goto(publicPath(empty.post_id));await expect(reader.locator('.catalog-resources')).toHaveCount(0);
    await expect(reader.locator('[data-post-login]')).toHaveText('登入回原貼文交流');
    expect(await reader.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(writes).toEqual([]);
  }finally{await anonymous.close();}
});

test('PUBLIC-POST-16 shared controls and concise sharing retain readable states at 320/390/1280 in all three themes',async({author})=>{
  const post=await createPost(author,`收合的完整預覽 ${randomUUID()} ${'保留全文。'.repeat(100)}`);
  await author.page.addInitScript(()=>{
    Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{throw new DOMException('cancelled','AbortError');}});
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new DOMException('denied','NotAllowedError');}}});
  });
  await author.page.goto(`/?social-post=${post.post_id}#social`);
  const trigger=author.page.locator(`#social-post-${post.post_id}`).getByRole('button',{name:'分享貼文連結',exact:true});
  const dialog=author.page.getByRole('dialog',{name:'分享貼文連結',exact:true});
  for(const theme of ['light','dark','versefolk'])for(const width of [320,390,1280]){
    await author.page.setViewportSize({width,height:800});await author.page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await trigger.click();const copy=dialog.getByRole('button',{name:'複製貼文連結',exact:true});await expect(copy).toBeEnabled();
    await expect(dialog.locator('.social-share-preview')).not.toBeVisible();await expect(dialog.locator('.social-share-link input')).not.toBeVisible();
    await expect(dialog.locator('.social-share-audience')).toHaveText('僅限登入且有閱覽權限的會員。');
    await expect(copy).toBeInViewport();await expect(dialog.getByRole('button',{name:'系統分享',exact:true})).toBeInViewport();
    expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
    for(const variant of ['', 'btn-secondary','btn-primary','btn-ghost','btn-module']){
      await dialog.evaluate((node,variant)=>{const probe=document.createElement('button');probe.type='button';probe.className=`btn ${variant}`;probe.dataset.controlProbe='true';probe.textContent='共用控制項驗證';node.append(probe);},variant);
      const probe=dialog.locator('[data-control-probe]');
      for(const state of ['enabled','hover','focus','disabled']){
        if(state==='hover')await probe.hover();if(state==='focus')await probe.focus();if(state==='disabled')await probe.evaluate(node=>(node as HTMLButtonElement).disabled=true);
        const colors=await probe.evaluate(node=>{
          const style=getComputedStyle(node);let bg=style.backgroundColor;let parent=node.parentElement;
          while(bg==='rgba(0, 0, 0, 0)'&&parent){bg=getComputedStyle(parent).backgroundColor;parent=parent.parentElement;}
          const lum=(rgb:string)=>{const v=rgb.match(/[\d.]+/g)!.slice(0,3).map(Number).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return v[0]*.2126+v[1]*.7152+v[2]*.0722;};
          const a=lum(style.color),b=lum(bg);return {contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),opacity:style.opacity,height:node.getBoundingClientRect().height,outline:style.outlineStyle,border:style.borderStyle};
        });
        expect(colors.contrast,`${theme}/${width}/${variant}/${state}`).toBeGreaterThanOrEqual(4.5);expect(colors.height).toBeGreaterThanOrEqual(44);
        if(state==='focus')expect(colors.outline).not.toBe('none');if(state==='disabled'){expect(colors.opacity).toBe('1');expect(colors.border).toBe('dashed');await expect(probe).toBeDisabled();}
      }
      await probe.evaluate(node=>node.remove());
    }
    await copy.click();await expect(dialog.getByLabel('貼文連結',{exact:true})).toBeFocused();await expect(dialog.locator('.social-share-link')).toHaveAttribute('open','');
    await dialog.getByRole('button',{name:'系統分享',exact:true}).click();expect(await sharing(author,post.post_id)).toMatchObject({enabled:false,available:false,version:'1'});
    await author.page.keyboard.press('Escape');await expect(trigger).toBeFocused();
  }
});
