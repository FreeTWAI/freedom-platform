import sharp from 'sharp';
import {test,expect,type Page} from './fixtures.js';
import {e2eOrigin} from '../../packages/testing/e2e-origin.js';
import {e2eSchema} from '../../packages/testing/e2e-auth-isolation.js';
async function login(page:Page){await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();await expect(page.locator('.shell')).toBeVisible();}
function card(page:Page,text:string){return page.locator('.social-card').filter({has:page.locator('.social-note').filter({hasText:text})});}

test('sharing an existing post uses one native link handoff and cancelling never starts a publishing task',async({page})=>{
 await page.addInitScript(()=>{
  const control={calls:[] as {data:ShareData;active:boolean}[],copies:0,resolve:()=>{},reject:(_error:unknown)=>{}};Object.assign(window,{postShareControl:control});
  Object.defineProperty(navigator,'share',{configurable:true,value:(data:ShareData)=>{control.calls.push({data,active:navigator.userActivation.isActive});return new Promise<void>((resolve,reject)=>{control.resolve=resolve;control.reject=reject;});}});
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{control.copies++;}}});
 });
 await login(page);await page.getByRole('button',{name:'建立貼文',exact:true}).click();const text=`分享連結不建立發文工作 ${Date.now()}`;
 await page.getByLabel('貼文內容',{exact:true}).fill(text);await page.getByRole('button',{name:'發布貼文',exact:true}).click();const post=card(page,text);await expect(post).toBeVisible();
 const attempts:string[]=[];page.on('request',request=>{const url=new URL(request.url());if(url.pathname.includes('SocialCrossPlatformShare-')||request.method()==='POST'&&(url.pathname==='/api/v1/social-posts/notes'||url.pathname==='/api/v1/promotion/links'||url.pathname.endsWith('/public-sharing')))attempts.push(url.pathname);});
 const share=post.getByRole('button',{name:'分享貼文連結',exact:true});await share.click();
 const dialog=page.getByRole('dialog',{name:'分享貼文連結',exact:true}),native=dialog.getByRole('button',{name:'系統分享',exact:true});
 await native.click();await expect(native).toBeDisabled();
 const first=await page.evaluate(()=>(window as any).postShareControl.calls[0]);expect(first.active).toBe(true);
 const postId=(await post.getAttribute('id'))!.slice('social-post-'.length);expect(first.data).toEqual({title:'自由工坊的貼文',url:`${e2eOrigin()}/?social-post=${postId}#social`});
 await page.evaluate(()=>(window as any).postShareControl.reject(new DOMException('cancelled','AbortError')));await expect(native).toBeEnabled();
 await expect(dialog).toBeVisible();expect(await page.evaluate(()=>(window as any).postShareControl.copies)).toBe(0);
 await native.click();await page.evaluate(()=>(window as any).postShareControl.resolve());await expect(share).toBeEnabled();
 expect(await page.evaluate(()=>(window as any).postShareControl.calls.length)).toBe(2);expect(attempts).toEqual([]);
});

test('a recipient opens the exact old shared post after login; removed content stays unavailable',async({page,browser,e2eAuthPool})=>{
 await login(page);await page.getByRole('button',{name:'建立貼文',exact:true}).click();const text=`直接打開這一篇舊貼文 ${Date.now()}`;
 await page.getByLabel('貼文內容',{exact:true}).fill(text);await page.getByRole('button',{name:'發布貼文',exact:true}).click();const own=card(page,text);await expect(own).toBeVisible();
 const postId=(await own.getAttribute('id'))!.slice('social-post-'.length),tag=`share-filler-${postId}`;
 const recipientContext=await browser.newContext(),recipient=await recipientContext.newPage();
 try{
  await e2eAuthPool.query("UPDATE community_social_posts SET created_at=timestamptz '2000-01-01' WHERE post_id=$1",[postId]);
  await e2eAuthPool.query(`INSERT INTO community_social_posts(community_id,author_user_id,kind,platform,title,note,state)
   SELECT community_id,author_user_id,'note','other',$2,$2,'active' FROM community_social_posts CROSS JOIN generate_series(1,150) WHERE post_id=$1`,[postId,tag]);
  const reads:string[]=[];recipient.on('request',request=>{if(new URL(request.url()).pathname==='/api/v1/social-posts')reads.push(request.url());});
  await recipient.goto(`${e2eOrigin()}/?social-post=${postId}#social`);await expect(recipient).toHaveURL(`${e2eOrigin()}/posts/${postId}`);await expect(card(recipient,text)).toHaveCount(0);
  await recipient.locator(`a[href="/?social-post=${postId}#account"]`).click();await expect(recipient.getByRole('button',{name:'登入',exact:true})).toBeVisible();
  await recipient.getByLabel('電子郵件',{exact:true}).fill('client@local.test');await recipient.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  const [onboarding]=await Promise.all([
   recipient.waitForResponse(response=>response.request().method()==='GET'&&new URL(response.url()).pathname==='/api/v1/me/onboarding'),
   recipient.getByRole('button',{name:'登入',exact:true}).click(),
  ]);expect(onboarding.status()).toBe(200);await onboarding.finished();
  const target=card(recipient,text);await expect(target).toBeVisible();await expect(target).toBeFocused();await expect(recipient.locator('.social-card')).toHaveCount(1);
  expect(reads).toHaveLength(1);expect(new URL(reads[0]).searchParams.get('post_id')).toBe(postId);
  await recipient.setViewportSize({width:320,height:844});expect(await recipient.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await recipient.getByRole('button',{name:'建立貼文',exact:true}).click();const newText=`從指定貼文返回發文 ${Date.now()}`;
  await recipient.getByLabel('貼文內容',{exact:true}).fill(newText);await recipient.getByRole('button',{name:'發布貼文',exact:true}).click();
  await expect(card(recipient,newText)).toBeVisible();expect(new URL(recipient.url()).searchParams.has('social-post')).toBe(false);
  await recipient.goto(`${e2eOrigin()}/?social-post=${postId}#social`);await expect(target).toBeVisible();
  await e2eAuthPool.query("UPDATE community_social_posts SET state='hidden' WHERE post_id=$1",[postId]);await recipient.reload();
  await expect(recipient.getByText('這則貼文已刪除、隱藏，或你目前沒有閱覽權限。',{exact:true})).toBeVisible();await expect(card(recipient,text)).toHaveCount(0);
  await recipient.getByRole('button',{name:'回到動態牆',exact:true}).click();await expect(recipient.locator('.social-card').first()).toBeVisible();expect(new URL(recipient.url()).searchParams.has('social-post')).toBe(false);
 }finally{
  await recipientContext.close();await e2eAuthPool.query('DELETE FROM community_social_posts WHERE title=$1',[tag]);
 }
});

test('wall tools publish topics, mentions, check-ins and pictures; social comments and share controls work at every width',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await login(page);
 await page.getByRole('button',{name:'建立貼文',exact:true}).click();
 const compose=page.getByRole('dialog',{name:'建立貼文',exact:true}),text=`一起分享今日作品 ${Date.now()}`;
 await compose.getByLabel('貼文內容',{exact:true}).fill(text+' #作品');
 await compose.getByLabel('貼文主題').selectOption('work');await compose.getByRole('button',{name:'打卡',exact:true}).click();await compose.getByLabel('打卡地點',{exact:true}).fill('台北松菸');
 await compose.getByRole('button',{name:'標註會員',exact:true}).click();await compose.getByLabel('搜尋標註會員').fill('示範需求者');
 const person=compose.locator('.social-mention-choice').first();await expect(person).toBeVisible();await person.click();
 const png=await sharp({create:{width:480,height:300,channels:3,background:'#728a41'}}).png().toBuffer();
 await compose.getByLabel('貼文圖片（選填）').setInputFiles({name:'作品.png',mimeType:'image/png',buffer:png});await expect(compose.getByAltText('待發布圖片預覽')).toBeVisible();
 await compose.getByRole('button',{name:'發布貼文',exact:true}).click();const post=card(page,text);await expect(post).toBeVisible();await expect(post).toContainText('作品分享');await expect(post).toContainText('台北松菸');await expect(post.locator('.social-note .social-text-link').filter({hasText:'@'})).toHaveCount(1);
 await post.getByRole('button',{name:'讚 · 0',exact:true}).click();
 await expect(post.getByRole('button',{name:'已讚 · 1',exact:true})).toHaveAttribute('aria-pressed','true');
 await post.getByRole('button',{name:'查看按讚名單'}).click();const people=page.getByRole('dialog',{name:'按讚名單',exact:true});await expect(people).toContainText('示範創作者');await page.keyboard.press('Escape');await expect(post.getByRole('button',{name:'查看按讚名單'})).toBeFocused();
 await post.getByRole('button',{name:'留言 · 0',exact:true}).click();await post.getByLabel('寫留言',{exact:true}).fill('看起來不錯 ');
 await post.getByRole('button',{name:'插入 emoji'}).click();await post.getByRole('button',{name:'插入 😂',exact:true}).click();
 await post.getByLabel('留言圖片',{exact:true}).setInputFiles({name:'回覆.png',mimeType:'image/png',buffer:png});await expect(post.getByAltText('留言圖片預覽')).toBeVisible();await post.getByRole('button',{name:'送出留言',exact:true}).click();
 const comment=post.locator('.social-comment').first();await expect(comment).toContainText('看起來不錯 😂');await expect(comment.getByAltText('留言附圖')).toBeVisible();await expect(comment.getByAltText('留言附圖')).toHaveJSProperty('naturalWidth',480);
 await comment.getByRole('button',{name:'留言讚 · 0',exact:true}).click();await expect(comment.getByRole('button',{name:'留言已讚 · 1',exact:true})).toBeVisible();
 await post.getByLabel('寫留言',{exact:true}).fill('保留的草稿');await post.getByRole('button',{name:'選擇貼圖',exact:true}).click();await post.getByRole('button',{name:'工坊夥伴',exact:true}).click();await post.getByRole('button',{name:'預覽貼圖：加油',exact:true}).click();await expect(post.locator('.social-comment')).toHaveCount(1);await post.getByRole('button',{name:'送出這張貼圖',exact:true}).click();await expect(post.locator('.social-comment')).toHaveCount(2);await expect(post.getByLabel('寫留言',{exact:true})).toHaveValue('保留的草稿');await expect(post.locator('.social-comment').last().getByRole('img',{name:'貼圖：加油'})).toBeVisible();
 const stickerComment=post.locator('.social-comment').last();await stickerComment.getByLabel('留言選項',{exact:true}).click();await stickerComment.getByRole('button',{name:'編輯留言',exact:true}).click();await stickerComment.getByLabel('編輯留言',{exact:true}).fill('一起加油 🎉');await stickerComment.getByRole('button',{name:'儲存留言',exact:true}).click();await expect(stickerComment).toContainText('一起加油 🎉');await expect(stickerComment.getByRole('img',{name:'貼圖：加油'})).toBeVisible();
 for(const width of [1440,768,390]){
  await page.setViewportSize({width,height:1000});await page.evaluate(()=>window.scrollTo(0,0));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/social-wall-${width}.png`,fullPage:false});
 }
 await post.locator('.social-comments').screenshot({path:'test-results/social-wall-comments-390.png'});
 for(const theme of ['dark','versefolk']){await page.evaluate(v=>{document.documentElement.dataset.theme=v;window.scrollTo(0,0);},theme);await page.screenshot({path:`test-results/social-wall-${theme}-390.png`,fullPage:false});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 await page.evaluate(()=>{document.documentElement.dataset.theme='light';Object.defineProperty(navigator,'share',{configurable:true,value:undefined});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:(value:string)=>{(window as any).copiedPostLink=value;return Promise.resolve();}}});});
 await post.getByRole('button',{name:'分享貼文連結',exact:true}).click();const share=page.getByRole('dialog',{name:'分享貼文連結',exact:true});
 const link=await share.getByLabel('貼文連結',{exact:true}).inputValue(),postId=(await post.getAttribute('id'))!.slice('social-post-'.length);
 expect(new URL(link).searchParams.get('social-post')).toBe(postId);expect(new URL(link).hash).toBe('#social');
 await expect(share.getByRole('region',{name:'多平台分享'})).toHaveCount(0);await expect(share.getByRole('button',{name:'了解並開啟'})).toHaveCount(0);
 await share.getByRole('button',{name:'複製貼文連結',exact:true}).click();await expect(share.getByRole('status')).toHaveText('已複製貼文連結');expect(await page.evaluate(()=>(window as any).copiedPostLink)).toBe(link);
 await page.keyboard.press('Escape');await expect(post.getByRole('button',{name:'分享貼文連結',exact:true})).toBeFocused();
 await post.getByRole('button',{name:'#作品',exact:true}).click();await expect(page.locator('.social-active-tag')).toContainText('#作品');await expect(card(page,text)).toBeVisible();await page.getByRole('button',{name:'清除標籤篩選',exact:true}).click();
 expect(errors).toEqual([]);
});

test('pasted comment image and unknown delivery keep one upload and comment; reload preserves media and read counts',async({page})=>{
 await login(page);await page.getByRole('button',{name:'建立貼文',exact:true}).click();const text=`貼上照片測試 ${Date.now()}`;await page.getByLabel('貼文內容',{exact:true}).fill(text);await page.getByRole('button',{name:'發布貼文',exact:true}).click();const post=card(page,text);
 await post.getByRole('button',{name:'留言 · 0',exact:true}).click();
 const png=await sharp({create:{width:80,height:50,channels:3,background:'#539db8'}}).png().toBuffer();
 await post.getByLabel('寫留言',{exact:true}).evaluate((area,base64)=>{const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));const data=new DataTransfer();data.items.add(new File([bytes],'clipboard.png',{type:'image/png'}));area.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},png.toString('base64'));
 await expect(post.getByAltText('留言圖片預覽')).toBeVisible();let attempts=0;const keys:string[]=[];
 await page.route('**/api/v1/social-posts/*/comments',async route=>{if(route.request().method()!=='POST'){await route.continue();return;}keys.push(route.request().headers()['idempotency-key']);const response=await route.fetch();if(++attempts===1)await route.abort('failed');else await route.fulfill({response});});
 await post.getByRole('button',{name:'送出留言',exact:true}).click();await expect(post.getByRole('button',{name:'重試留言',exact:true})).toBeEnabled();await post.getByRole('button',{name:'重試留言',exact:true}).click();await expect(post.locator('.social-comment')).toHaveCount(1);expect(keys[0]).toBe(keys[1]);
 await page.reload();await post.getByRole('button',{name:'留言 · 1',exact:true}).click();await expect(post.getByAltText('留言附圖')).toBeVisible();await post.locator('.social-post-header').scrollIntoViewIfNeeded();await expect(post.locator('.social-interaction-summary')).toContainText('已讀 1 人');
 await post.getByLabel('留言選項',{exact:true}).click();await post.getByRole('button',{name:'刪除留言',exact:true}).click();await post.getByRole('button',{name:'確定刪除留言',exact:true}).click();await expect(post.locator('.social-comment')).toHaveCount(0);
});


test('malformed successful image acknowledgements retain the exact upload and never publish without its photo',async({page})=>{
 await login(page);await page.getByRole('button',{name:'建立貼文',exact:true}).click();
 const text=`圖片回應驗證 ${Date.now()}`;await page.getByLabel('貼文內容',{exact:true}).fill(text);await page.getByRole('button',{name:'發布貼文',exact:true}).click();
 const post=card(page,text);await post.getByRole('button',{name:'留言 · 0',exact:true}).click();await post.getByLabel('寫留言',{exact:true}).fill('照片必須一起送出');
 const png=await sharp({create:{width:80,height:50,channels:3,background:'#539db8'}}).png().toBuffer();
 await post.getByLabel('留言圖片',{exact:true}).setInputFiles({name:'ack.png',mimeType:'image/png',buffer:png});await expect(post.getByAltText('留言圖片預覽')).toBeVisible();
 const uploads:{key:string;bytes:string}[]=[],comments:Record<string,unknown>[]=[];let canonical:Record<string,unknown>={};
 const invalid=[{}, {image_id:'not-a-uuid',content_type:'image/webp',byte_size:1}, {image_id:'11111111-1111-4111-8111-111111111111',content_type:'image/png',byte_size:1}, {image_id:'11111111-1111-4111-8111-111111111111',content_type:'image/webp',byte_size:1048577}];
 await page.route('**/api/v1/social-posts/*/comment-images',async route=>{
  uploads.push({key:route.request().headers()['idempotency-key'],bytes:route.request().postDataBuffer()!.toString('base64')});
  const response=await route.fetch();expect(response.status()).toBe(201);canonical=await response.json();
  const malformed=invalid[uploads.length-1];await route.fulfill(malformed?{response,json:malformed}:{response});
 });
 await page.route('**/api/v1/social-posts/*/comments',async route=>{if(route.request().method()==='POST')comments.push(route.request().postDataJSON());await route.continue();});
 for(let i=0;i<invalid.length;i++){
  await post.getByRole('button',{name:i?'重試留言':'送出留言',exact:true}).click();
  await expect(post.getByRole('button',{name:'重試留言',exact:true})).toBeEnabled();await expect(post.getByAltText('留言圖片預覽')).toBeVisible();
  expect(comments).toHaveLength(0);await expect(post.getByLabel('寫留言',{exact:true})).toHaveValue('照片必須一起送出');
 }
 await post.getByRole('button',{name:'重試留言',exact:true}).click();await expect(post.locator('.social-comment')).toHaveCount(1);await expect(post.getByAltText('留言附圖')).toBeVisible();
 expect(uploads).toHaveLength(invalid.length+1);for(const upload of uploads)expect(upload).toEqual(uploads[0]);
 expect(comments).toHaveLength(1);expect(comments[0].image_id).toBe(canonical.image_id);
});

test('removing mention text removes its selected identity from new post and comment commands',async({page})=>{
 await login(page);await page.getByRole('button',{name:'建立貼文',exact:true}).click();const compose=page.getByRole('dialog',{name:'建立貼文',exact:true});
 async function pick(scope:ReturnType<Page['locator']>){await scope.getByRole('button',{name:'標註會員',exact:true}).click();await scope.getByLabel('搜尋標註會員').fill('示範需求者');await scope.locator('.social-mention-choice').first().click();}
 await pick(compose);const text=`已移除標註 ${Date.now()}`;await compose.getByLabel('貼文內容',{exact:true}).fill(text);
 const [postResponse]=await Promise.all([
  page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/v1/social-posts/notes',{timeout:25_000}),
  compose.getByRole('button',{name:'發布貼文',exact:true}).click(),
 ]);
 expect(postResponse.request().postDataJSON().mention_ids).toEqual([]);
 expect(postResponse.status(),await postResponse.text()).toBe(201);
 const post=card(page,text);await post.getByRole('button',{name:'留言 · 0',exact:true}).click();await pick(post);await post.getByLabel('寫留言',{exact:true}).fill('這則留言沒有標註');
 const [commentResponse]=await Promise.all([
  page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/comments'),{timeout:25_000}),
  post.getByRole('button',{name:'送出留言',exact:true}).click(),
 ]);
 expect(commentResponse.request().postDataJSON().mention_ids).toEqual([]);
 expect(commentResponse.status(),await commentResponse.text()).toBe(201);
 await expect(post.locator('.social-comment')).toHaveCount(1);
});

test('sticker previews can be cancelled without publishing, and explicit lost-ACK retry preserves text and image drafts',async({page,e2eAuthPool},testInfo)=>{
 await login(page);const sessionResponse=await page.request.get('/api/v1/session');expect(sessionResponse.status()).toBe(200);const session=await sessionResponse.json();
 const schema=e2eSchema(process.env.FREEDOM_E2E_SCHEMA),fixturePostId=crypto.randomUUID(),text=`貼圖先預覽 ${fixturePostId}`;
 expect((await e2eAuthPool.query('SELECT current_schema() AS schema')).rows[0].schema).toBe(schema);
 // This case exercises comments, not publishing. An exact historical fixture
 // avoids consuming another journey's daily post budget. Linked image targets
 // are immutable, so the normal run-schema teardown owns their cleanup.
 const seeded=await e2eAuthPool.query(`INSERT INTO "${schema}".community_social_posts(post_id,community_id,author_user_id,kind,platform,title,note,state,created_at,updated_at)
  SELECT $1,community_id,user_id,'note','other',$3,$3,'active',timestamptz '2000-01-01',timestamptz '2000-01-01' FROM "${schema}".users WHERE user_id=$2 RETURNING post_id`,[fixturePostId,session.user.user_id,text]);
 expect(seeded.rows.map(row=>row.post_id)).toEqual([fixturePostId]);await page.goto(`/?social-post=${fixturePostId}#social`);const post=card(page,text);
 await expect(post).toHaveCount(1);await expect(page.locator('.social-card')).toHaveCount(1);await expect(post).toHaveAttribute('id',`social-post-${fixturePostId}`);
 await post.getByRole('button',{name:'留言 · 0',exact:true}).click();await post.getByLabel('寫留言',{exact:true}).fill('文字和照片都還沒送');
 const png=await sharp({create:{width:96,height:64,channels:3,background:'#539db8'}}).png().toBuffer();
 await post.getByLabel('留言圖片',{exact:true}).setInputFiles({name:'保留草稿.png',mimeType:'image/png',buffer:png});
 const image=post.getByAltText('留言圖片預覽');await expect(image).toBeVisible();const originalImage=await image.getAttribute('src');
 const postId=(await post.getAttribute('id'))!.slice('social-post-'.length),path=`/api/v1/social-posts/${postId}/comments`;
 const sends:{key:string;body:unknown}[]=[];let uploads=0;page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname.endsWith('/comment-images'))uploads++;});
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route(`**${path}`,async route=>{
  if(route.request().method()!=='POST')return route.continue();
  sends.push({key:route.request().headers()['idempotency-key'],body:route.request().postDataJSON()});const response=await route.fetch();expect(response.status()).toBe(201);
  if(sends.length===1){await gate;return route.abort();}return route.fulfill({response});
 });
 const toggle=post.getByRole('button',{name:'選擇貼圖',exact:true});
 try{
  await toggle.click();await post.getByLabel('搜尋貼圖',{exact:true}).fill('感謝');
  const choice=post.getByRole('button',{name:'預覽貼圖：謝謝',exact:true});await choice.focus();await choice.press('Enter');
  const preview=post.getByRole('group',{name:'貼圖預覽：謝謝',exact:true});await expect(preview).toBeFocused();
  await expect(preview.locator('img')).toHaveJSProperty('naturalWidth',512);await preview.press('Enter');expect(sends).toHaveLength(0);expect(uploads).toBe(0);
  for(const width of [320,1280]){
   await page.setViewportSize({width,height:900});
   for(const [theme,skin] of [['light',''],['dark',''],['versefolk',''],['dark','dragon'],['light','ai-sister']]){
    await page.evaluate(([theme,skin])=>{document.documentElement.dataset.theme=theme;if(skin)document.documentElement.dataset.guideSkin=skin;else delete document.documentElement.dataset.guideSkin;},[theme,skin]);
    await expect(preview).toBeVisible();expect(await preview.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect((await preview.locator('.chat-sticker').boundingBox())!.width).toBeGreaterThan(72);
    for(const label of ['取消預覽','送出這張貼圖'])expect((await preview.getByRole('button',{name:label,exact:true}).boundingBox())!.height).toBeGreaterThanOrEqual(44);
   }
   await preview.screenshot({path:testInfo.outputPath(`sticker-preview-${width}.png`)});
  }
  await preview.getByRole('button',{name:'取消預覽',exact:true}).click();await expect(choice).toBeFocused();await expect(post.getByLabel('搜尋貼圖',{exact:true})).toHaveValue('感謝');
  await choice.click();await preview.press('Escape');await expect(toggle).toBeFocused();await expect(preview).toHaveCount(0);expect(sends).toHaveLength(0);
  await toggle.click();await expect(preview).toHaveCount(0);await choice.click();
  await preview.getByRole('button',{name:'送出這張貼圖',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click();});
  await expect.poll(()=>sends.length).toBe(1);await expect(toggle).toBeDisabled();expect(uploads).toBe(0);release();
  const retry=post.getByRole('button',{name:'重試留言',exact:true});await expect(retry).toBeEnabled();await expect(toggle).toBeDisabled();await retry.click();
  await expect(post.locator('.social-comment')).toHaveCount(1);expect(sends).toHaveLength(2);expect(sends[1]).toEqual(sends[0]);expect(sends[0].body).toEqual({sticker_id:'freetwai-v2-thanks'});expect(uploads).toBe(0);
  expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM community_social_comments WHERE post_id=$1',[postId])).rows[0].n).toBe(1);
  await expect(post.getByLabel('寫留言',{exact:true})).toHaveValue('文字和照片都還沒送');await expect(image).toHaveAttribute('src',originalImage!);
  await post.getByRole('button',{name:'送出留言',exact:true}).click();await expect(post.locator('.social-comment')).toHaveCount(2);expect(uploads).toBe(1);
  await expect(post.locator('.social-comment').last()).toContainText('文字和照片都還沒送');await expect(post.locator('.social-comment').last().getByAltText('留言附圖')).toBeVisible();
 }finally{release();}
});
