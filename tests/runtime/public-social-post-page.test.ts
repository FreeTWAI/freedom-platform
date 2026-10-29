import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {publicPostCatalogResources,publicSocialPostHtml,unavailableSocialPostHtml} from '../../modules/community/public-social-post-page.js';
import {communityCatalog} from '../../modules/community/catalog.js';
import type {PublicSocialPostPage} from '../../modules/community/public-social-posts.js';
import {anonymousSharedPost,memberPostReturn,publicPostReturn} from '../../apps/portal-web/src/modules/public-post-return.js';

const id='17c80987-1d06-4eb3-9cc4-5cc03a4987ec';
const other='4c80966b-af02-4173-93d3-943fda1c9242';

test('post return accepts one UUID and keeps public reading, legacy member intent and other journeys distinct',()=>{
  assert.equal(publicPostReturn('?post_return='+id),'/posts/'+id);
  assert.equal(publicPostReturn('?post_return='+id.toUpperCase()+'&join=1'),'/posts/'+id);
  assert.equal(memberPostReturn('?social-post='+id,'#account'),'/?social-post='+id+'#social');
  assert.equal(anonymousSharedPost('?social-post='+id,'#social'),'/posts/'+id);
  assert.equal(anonymousSharedPost('?social-post='+id,'#account'),null);
  assert.equal(memberPostReturn('?social-post='+id,'#social'),null);
  for(const value of ['',id+'\n',id+'\r',id+' ',id+'/../other','//elsewhere.test','https://elsewhere.test/',id+'?x=1',id+'#social','00000000-0000-0000-0000-000000000000']){
    assert.equal(publicPostReturn('?post_return='+encodeURIComponent(value)),null,value);
    assert.equal(memberPostReturn('?social-post='+encodeURIComponent(value),'#account'),null,value);
    assert.equal(anonymousSharedPost('?social-post='+encodeURIComponent(value),'#social'),null,value);
  }
  for(const suffix of ['&post_return='+id,'&post_return='+other,'&social-post='+other,'&return_to=%2Fshops%2Fsample%2Fcheckout','&return_to=%2Fevents%2F'+other,'&skill_acquisition=1'])assert.equal(publicPostReturn('?post_return='+id+suffix),null,suffix);
  assert.equal(memberPostReturn('?social-post='+id+'&social-post='+id,'#account'),null);
  assert.equal(memberPostReturn('?social-post='+id+'&return_to=%2Fshops%2Fsample%2Fcheckout','#account'),null);
});

function page():PublicSocialPostPage{
  return {version:'a'.repeat(64),post:{post_id:id,kind:'note',title:'A "title" <tag>',note:'完整內文\n<script>alert(1)</script>\n'+('持續閱讀。'.repeat(120)),url:null,created_at:'2026-10-22T00:00:00.000Z',edited_at:null,author:{display_name:'作者 <img src=x>'},image_url:'/api/v1/public/shared-posts/'+id+'/image'},related:[{post_id:other,title:'另一則 <title>',summary:'這是公開摘要 <script>',author:{display_name:'另一位作者'},path:'/posts/'+other}]};
}

const origin='https://freetwai.com';
const skillIds=['local-workspace-mcp','editkin','positioning-companion','freedom-party-guild-lounge'];
const skillPath=(id:string)=>'/development/skills/'+id;

test('public text resolves at most three distinct known catalog resources in mention order without forwarding share queries',()=>{
  const note=`先試：${origin}${skillPath(skillIds[0])}?intro=17。\n${skillPath(skillIds[0])}\n[剪輯](${skillPath(skillIds[1])})\n「${origin}${skillPath(skillIds[2])}」\n${skillPath(skillIds[3])}`;
  const resources=publicPostCatalogResources(note,origin);
  assert.deepEqual(resources.map(item=>item.id),skillIds.slice(0,3));
  assert.deepEqual(resources.map(item=>item.path),skillIds.slice(0,3).map(skillPath));
  for(const item of resources)assert.equal(item.title,communityCatalog.skill_books.find(book=>book.id===item.id)!.title);
  assert.equal(publicPostCatalogResources(skillPath(skillIds[0])+'.',origin).length,1);
  assert.equal(publicPostCatalogResources('[Local Workspace MCP]('+skillPath(skillIds[0])+')',origin).length,1);
  assert.equal(publicPostCatalogResources('http://127.0.0.1:4311'+skillPath(skillIds[0]),'http://127.0.0.1:4311').length,1);
});

test('resource parser rejects foreign, ambiguous, encoded, credential, protocol and unknown paths as whole tokens',()=>{
  const path=skillPath(skillIds[0]);
  for(const note of [
    'https://elsewhere.test'+path,origin+'.evil.test'+path,origin+'@evil.test'+path,
    'https://evil.test@freetwai.com'+path,'//freetwai.com'+path,'//'+path,
    'javascript:'+path,'data:text/plain,'+path,'javascript:'+origin+path,
    'https://evil.test/?next=('+path+')','https://evil.test/?next=['+path+']',
    'https://evil.test/?next="'+path+'"','https://evil.test/?next=（'+path+'）',
    'https://evil.test/?next=推薦：'+path,'https://evil.test/?next=[技能]('+path+')',
    '[外站](https://evil.test/?next=('+path+'))',origin+'/?next=('+path+')',
    origin+':443'+path,'http://freetwai.com'+path,origin+'\\'+path,
    '/private/..'+path,'/development/skills/../skills/'+skillIds[0],
    path+'/',path+'/SKILL.md',path+'%2fsecret',path+'%5csecret',path+'\\secret',
    path.replace('/skills/','%2fskills%2f'),path.replace('local','%6cocal'),
    '/development/skills/not-a-catalog-book','/development/submissions/'+id,
    path+'?token=private',path+'?intro=1&token=private',path+'#private',path+'?intro=0',path+'?intro=1000',
  ])assert.deepEqual(publicPostCatalogResources(note,origin),[],note);
  for(const configured of ['javascript:alert(1)',origin+'/untrusted',origin+'?host=evil','https://user@freetwai.com','not an origin']){
    assert.deepEqual(publicPostCatalogResources(origin+path,configured),[],configured);
    assert.equal(publicPostCatalogResources(path,configured).length,1,'safe root-relative reference remains local');
  }
});

test('resource HTML is escaped, no-JS and body-only; it neither claims authorship nor exposes a new public list',()=>{
  const source=page(),book=communityCatalog.skill_books.find(item=>item.id===skillIds[0])!,title=book.title;
  source.post.note=`我的用法 <script>alert(1)</script>\n${origin}${skillPath(book.id)}?intro=7`;
  try{
    book.title='資源 <img src=x onerror="alert(1)"> & 原作';
    const html=publicSocialPostHtml(source,origin,true);
    assert.ok(html.includes('href="'+skillPath(book.id)+'"'));
    assert.ok(html.includes('資源 &lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; 原作'));
    assert.ok(html.includes('原作與授權見資源頁'));assert.ok(html.includes('登入回原貼文交流'));
    assert.ok(html.includes('留言依原有會員資格開放'));assert.ok(html.includes('content="noindex,nofollow"'));
    assert.ok(!html.includes('href="'+skillPath(book.id)+'?'));assert.ok(!html.includes('<img src=x'));
    assert.ok(!html.includes('data-post-follow'));assert.ok(!html.includes('data-post-bookmark'));
  }finally{book.title=title;}
  source.post.note='沒有提到技能資源';source.post.title=origin+skillPath(book.id);source.post.url=origin+skillPath(book.id);
  source.related[0].summary=skillPath(book.id);
  assert.ok(!publicSocialPostHtml(source,origin,false).includes('class="catalog-resources"'));
  assert.ok(!unavailableSocialPostHtml(id).includes('catalog-resources'));
});

test('server HTML provides complete escaped content, real same-origin login paths, public OG and external scripts without JavaScript',()=>{
  const source=page(),html=publicSocialPostHtml(source,'https://freetwai.com',true);
  assert.ok(html.includes('data-public-post="'+id+'"'));assert.ok(html.includes('data-public-version="'+source.version+'"'));
  assert.ok(html.includes('持續閱讀。'.repeat(120)));assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>alert'));assert.ok(!html.includes('<img src=x>'));
  assert.ok(html.includes('href="/?post_return='+id+'#account"'));assert.ok(html.includes('href="/?post_return='+other+'#account"'));
  assert.ok(html.includes('href="/?post_return='+id+'&amp;join=1#account"'));
  assert.ok(html.includes('content="https://freetwai.com/posts/'+id+'"'));
  assert.ok(html.includes('content="https://freetwai.com/api/v1/public/shared-posts/'+id+'/image"'));
  assert.ok(html.includes('src="/public-revalidation.js"'));assert.ok(html.includes('src="/social-post.js"'));
  assert.ok(!/<script(?![^>]*src=)/.test(html));assert.ok(!html.includes('<style'));
  assert.ok(!publicSocialPostHtml(source,'https://freetwai.com',false).includes('join=1'));
});

test('unavailable pages discard public content and OG and offer only a validated legacy member destination',()=>{
  const html=unavailableSocialPostHtml(id);
  assert.ok(html.includes('href="/?social-post='+id+'#account"'));
  assert.ok(!html.includes('data-public-post'));assert.ok(!html.includes('property="og:'));assert.ok(!html.includes('/shared-posts/'));
  for(const invalid of ['<script>alert(1)</script>',id+'\n','https://elsewhere.test']){
    const missing=unavailableSocialPostHtml(invalid);
    assert.ok(!missing.includes(invalid));assert.ok(!missing.includes('social-post='));assert.ok(!missing.includes('property="og:'));
  }
});

// Execute the actual E2E transition, without launching a browser or duplicating
// its wait/ACK logic. The two contexts can otherwise race a publication commit.
const publicJourney=readFileSync(new URL('../e2e/public-social-posts.spec.ts',import.meta.url),'utf8');
const reopenJourney=publicJourney.slice(publicJourney.indexOf("test('PUBLIC-POST-07"),publicJourney.indexOf("test('PUBLIC-POST-08"));
const reopenTransition=reopenJourney.slice(reopenJourney.indexOf('  const dialog='),reopenJourney.indexOf('  await page.goto(publicPath(post.post_id));await expect(publicArticle(page)).toContainText(changed)'));
const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
function reopenHarness(source=reopenTransition){
  const response=deferred<unknown>(),body=deferred<unknown>(),events:string[]=[];
  const path='/api/v1/social-posts/'+id+'/public-sharing';
  const locator={getByRole:()=>locator,getByLabel:()=>locator,
    locator:(selector:string)=>{assert.equal(selector,'.social-sharing-consent > summary');return {click:async()=>{events.push('consent-details');}};},
    click:async()=>{assert.ok(events.includes('consent-details'),'publication stays behind the explicit disclosure');events.push('click');}};
  const author={page:{getByRole:()=>locator,waitForResponse:(match:(value:unknown)=>boolean)=>{
    const candidate=(method:string,pathname:string)=>({request:()=>({method:()=>method}),url:()=>`https://example.test${pathname}`});
    assert.equal(match(candidate('GET',path)),false);
    assert.equal(match(candidate('POST',path+'/other')),false);
    assert.equal(match(candidate('POST',path.replace(id,other))),false);
    assert.equal(match(candidate('POST',path)),true);
    events.push('response-listener');return response.promise;
  }}};
  const expect=(actual:unknown)=>({
    toBe:(expected:unknown)=>assert.equal(actual,expected),
    toMatchObject:(expected:Record<string,unknown>)=>{for(const [key,value] of Object.entries(expected))assert.deepEqual((actual as Record<string,unknown>)[key],value);events.push('ack');},
    toHaveValue:async(expected:string)=>{assert.equal(expected,'https://example.test/posts/'+id);events.push('public-link');},
    // Invalidated consent keeps the close control visible even while saving.
    toBeVisible:async()=>{events.push('visible');},
  });
  const run=new AsyncFunction('author','post','expect','publicPath','e2eOrigin',source);
  const complete=run(author,{post_id:id,revision:1},expect,(value:string)=>'/posts/'+value,()=> 'https://example.test').then(()=>{events.push('visitor-navigation');});
  return {response,body,events,complete,ack:{enabled:true,available:true,post_revision:2,public_path:'/posts/'+id}};
}
const flushReopen=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('reopen journey waits for its exact POST and complete ACK before public navigation',async()=>{
  const h=reopenHarness();await flushReopen();
  assert.deepEqual(h.events,['response-listener','consent-details','click']);
  h.response.resolve({status:()=>200,json:()=>h.body.promise});await flushReopen();
  assert.deepEqual(h.events,['response-listener','consent-details','click']);
  h.body.resolve(h.ack);await h.complete;
  assert.deepEqual(h.events,['response-listener','consent-details','click','ack','public-link','visible','visitor-navigation']);
});

test('reopen journey rejects incomplete or unavailable ACKs before visiting public content',async()=>{
  for(const ack of [{},{enabled:true,available:false,post_revision:2,public_path:null},{enabled:true,available:true,post_revision:1,public_path:'/posts/'+id},{enabled:true,available:true,post_revision:2,public_path:'/posts/'+other}]){
    const h=reopenHarness(),rejected=assert.rejects(h.complete);
    h.response.resolve({status:()=>200,json:async()=>ack});await rejected;assert.ok(h.events.includes('click'));
    assert.ok(!h.events.includes('public-link'));assert.ok(!h.events.includes('visitor-navigation'));
  }
});

test('reopen journey rejects a non-200 response before reading its body or navigating',async()=>{
  const h=reopenHarness(),rejected=assert.rejects(h.complete);
  h.response.resolve({status:()=>409,json:async()=>{assert.fail('rejected response must not confirm publication');}});
  await rejected;assert.ok(h.events.includes('click'));assert.ok(!h.events.includes('ack'));assert.ok(!h.events.includes('visitor-navigation'));
});

test('reopen journey negative control rejects publication when disclosure expansion is removed',async()=>{
  const changed=reopenTransition.replace("  await dialog.locator('.social-sharing-consent > summary').click();",'');
  assert.notEqual(changed,reopenTransition);
  const h=reopenHarness(changed);await assert.rejects(h.complete,/publication stays behind the explicit disclosure/);
  assert.ok(!h.events.includes('click'));assert.ok(!h.events.includes('visitor-navigation'));
});
